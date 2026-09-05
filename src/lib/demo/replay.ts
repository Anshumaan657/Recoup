import { ingestRazorpayWebhook } from "@/lib/razorpay/webhook-handler";
import { fallbackDecision } from "@/lib/agent/fallback-rules";
import { prisma } from "@/lib/db/prisma";
import { createSimulatedPaymentLink } from "@/lib/razorpay/payment-links";
import { generateRazorpaySignature } from "@/lib/razorpay/signatures";
import { executeRecoveryCase } from "@/lib/recovery/executor";
import { getRecoveryCaseByOriginalPaymentId } from "@/lib/recovery/service";
import { evaluatePolicy } from "@/lib/policy/policy-engine";
import { AuditEventType, RecoveryAction, RecoveryStatus } from "@/types/domain";
import { DemoScenario } from "./dataset";
import {
  attachCaseToDemoRun,
  attachReceiptToDemoRun,
  completeDemoRun,
  reserveDemoRun,
} from "./simulator";
import { calculateStoredDemoMetrics } from "./stored-metrics";
import { RecoveryMetrics } from "@/lib/recovery/metrics";

const INTERNAL_DEMO_WEBHOOK_SECRET = "recoverai-signed-demo-fixture-v1";

export class DemoReplayInProgressError extends Error {
  constructor() {
    super("A replay for this seed is already in progress");
    this.name = "DemoReplayInProgressError";
  }
}

export interface DemoReplayResult {
  runId: string;
  seed: number;
  datasetVersion: string;
  synthetic: true;
  reused: boolean;
  metrics: RecoveryMetrics;
}

function eventId(scenario: DemoScenario, suffix: string): string {
  return `evt_${scenario.input.caseId.replace(/[^A-Za-z0-9_]/g, "_")}_${suffix}`;
}

function paymentFailedEvent(scenario: DemoScenario) {
  const { input } = scenario;
  return {
    id: eventId(scenario, "failed"),
    event: "payment.failed",
    account_id: "acc_demo_synthetic",
    created_at: Math.floor(Date.parse(input.createdAt) / 1000),
    payload: {
      payment: {
        id: input.originalPaymentId,
        entity: "payment",
        amount: input.amountPaise,
        currency: input.currency,
        status: "failed",
        order_id: input.orderId,
        method: input.paymentMethod,
        error_code: input.failureCode,
        error_description: input.failureReason.replaceAll("_", " "),
        error_source: input.failureSource,
        error_step: input.failureStep,
        error_reason: input.failureReason,
        captured: false,
        ...(input.customerEmail ? { email: input.customerEmail } : {}),
        ...(input.customerContact ? { contact: input.customerContact } : {}),
        notes: { synthetic: "true" },
      },
    },
  };
}

function paymentCapturedEvent(scenario: DemoScenario) {
  const { input } = scenario;
  return {
    id: eventId(scenario, "captured"),
    event: "payment.captured",
    account_id: "acc_demo_synthetic",
    created_at: Math.floor(Date.parse(input.createdAt) / 1000) + 30,
    payload: {
      payment: {
        id: input.originalPaymentId,
        entity: "payment",
        amount: input.amountPaise,
        currency: input.currency,
        status: "captured",
        order_id: input.orderId,
        method: input.paymentMethod,
        captured: true,
        notes: { synthetic: "true" },
      },
    },
  };
}

function paymentLinkPaidEvent(
  scenario: DemoScenario,
  recoveryCaseId: string,
  paymentLinkId: string
) {
  return {
    id: eventId(scenario, "link_paid"),
    event: "payment_link.paid",
    account_id: "acc_demo_synthetic",
    created_at: Math.floor(Date.parse(scenario.input.createdAt) / 1000) + 180,
    payload: {
      payment_link: {
        id: paymentLinkId,
        entity: "payment_link",
        reference_id: `recovery_${recoveryCaseId}`,
        amount: scenario.input.amountPaise,
        currency: scenario.input.currency,
        notes: { recovery_case_id: recoveryCaseId, synthetic: "true" },
      },
    },
  };
}

async function postSignedFixture(event: Record<string, unknown>) {
  const rawBody = Buffer.from(JSON.stringify(event));
  const signature = generateRazorpaySignature(
    rawBody,
    INTERNAL_DEMO_WEBHOOK_SECRET
  );
  const request = new Request("http://recoverai.internal/webhooks/razorpay", {
    method: "POST",
    headers: { "x-razorpay-signature": signature },
    body: rawBody,
  });
  const response = await ingestRazorpayWebhook(
    request as unknown as import("next/server").NextRequest,
    INTERNAL_DEMO_WEBHOOK_SECRET
  );
  const body = (await response.json()) as {
    status: string;
    duplicate: boolean;
    caseId?: string;
  };
  if (response.status !== 200) {
    throw new Error(`Synthetic webhook failed with status ${response.status}`);
  }
  return body;
}

async function attachEventReceipt(runId: string, id: string): Promise<void> {
  await attachReceiptToDemoRun(runId, `razorpay:event:${id}`);
}

async function recordVisiblePolicyEvaluation(
  scenario: DemoScenario,
  recoveryCaseId: string
): Promise<void> {
  const recoveryCase = await getRecoveryCaseByOriginalPaymentId(
    scenario.input.originalPaymentId
  );
  if (!recoveryCase) throw new Error("Synthetic recovery case was not created");
  const result = await evaluatePolicy(recoveryCase, {
    decisionProvider: async (_caseId, context) => fallbackDecision(context),
  });
  await prisma.auditEvent.create({
    data: {
      recoveryCaseId,
      eventType: result.proposedDecision
        ? AuditEventType.decision_created
        : AuditEventType.decision_rejected,
      message: result.proposedDecision
        ? `Synthetic policy evaluation: ${result.proposedDecision.action}`
        : "Synthetic policy evaluation rejected",
      metadata: JSON.stringify({
        proposedAction: result.proposedDecision?.action ?? null,
        approved: Boolean(result.approvedDecision),
        rejectedReasons: result.rejectedReasons,
        fallbackUsed: result.fallbackUsed,
        syntheticEvaluation: true,
      }),
    },
  });
}

async function applyStoppedOutcome(
  scenario: DemoScenario,
  recoveryCaseId: string
): Promise<void> {
  const optedOut = scenario.input.optedOut;
  await prisma.$transaction(async (tx) => {
    await tx.recoveryCase.update({
      where: { id: recoveryCaseId },
      data: {
        status: RecoveryStatus.closed,
        selectedAction: RecoveryAction.no_action,
        stoppedReason: optedOut ? "customer_opt_out" : "unrecoverable",
      },
    });
    await tx.auditEvent.create({
      data: {
        recoveryCaseId,
        eventType: AuditEventType.recovery_stopped,
        message: optedOut
          ? "Synthetic customer opted out; recovery stopped"
          : "Synthetic policy outcome is unrecoverable",
        metadata: JSON.stringify({
          reason: optedOut ? "customer_opt_out" : "unrecoverable",
          synthetic: true,
        }),
      },
    });
  });
}

async function applyManualReviewOutcome(recoveryCaseId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.recoveryCase.update({
      where: { id: recoveryCaseId },
      data: {
        status: RecoveryStatus.manual_review,
        selectedAction: RecoveryAction.manual_review,
        requiresApproval: true,
      },
    });
    await tx.auditEvent.create({
      data: {
        recoveryCaseId,
        eventType: AuditEventType.manual_review_requested,
        message: "Synthetic case requires manual review",
        metadata: JSON.stringify({ synthetic: true }),
      },
    });
  });
}

async function applyAttemptedOutcome(
  scenario: DemoScenario,
  recoveryCaseId: string,
  now: Date,
  recovered: boolean,
  runId: string
): Promise<void> {
  await prisma.recoveryCase.update({
    where: { id: recoveryCaseId },
    data: {
      status: RecoveryStatus.eligible,
      selectedAction: RecoveryAction.create_payment_link,
      decisionReason: "Predetermined synthetic evaluation intervention",
      graceExpiresAt: new Date(now.getTime() - 1000),
    },
  });
  const execution = await executeRecoveryCase(recoveryCaseId, {
    now,
    createLink: async (request) => ({
      ...createSimulatedPaymentLink(request),
      created_at: Math.floor(now.getTime() / 1000),
    }),
  });
  if (execution.outcome !== "payment_link_created") {
    throw new Error("Synthetic recovery execution did not create a Payment Link");
  }

  if (!recovered) {
    await prisma.recoveryCase.update({
      where: { id: recoveryCaseId },
      data: { paymentLinkExpiry: new Date(now.getTime() - 1000) },
    });
    await executeRecoveryCase(recoveryCaseId, { now });
    return;
  }

  const stored = await prisma.recoveryCase.findUniqueOrThrow({
    where: { id: recoveryCaseId },
  });
  const paid = paymentLinkPaidEvent(
    scenario,
    recoveryCaseId,
    stored.paymentLinkId!
  );
  await postSignedFixture(paid);
  await attachEventReceipt(runId, String(paid.id));
}

async function replayScenario(
  runId: string,
  scenario: DemoScenario,
  now: Date
): Promise<void> {
  const failed = paymentFailedEvent(scenario);
  const failedResult = await postSignedFixture(failed);
  if (!failedResult.caseId) throw new Error("Synthetic failure did not create a case");
  await attachCaseToDemoRun(runId, failedResult.caseId);
  await attachEventReceipt(runId, String(failed.id));
  await prisma.recoveryCase.update({
    where: { id: failedResult.caseId },
    data: {
      customerName: scenario.input.customerName,
      isSynthetic: true,
      stoppedReason: scenario.input.optedOut ? "customer_opt_out" : null,
      graceExpiresAt: new Date(now.getTime() - 1000),
    },
  });

  if (scenario.expected.events.includes("payment.failed.duplicate")) {
    const duplicate = await postSignedFixture(failed);
    if (!duplicate.duplicate) throw new Error("Synthetic duplicate was not deduplicated");
  }

  if (scenario.expected.outcome === "late_capture") {
    const captured = paymentCapturedEvent(scenario);
    await postSignedFixture(captured);
    await attachEventReceipt(runId, String(captured.id));
    return;
  }

  await recordVisiblePolicyEvaluation(
    scenario,
    failedResult.caseId
  );
  switch (scenario.expected.outcome) {
    case "stopped_unrecoverable":
      await applyStoppedOutcome(scenario, failedResult.caseId);
      return;
    case "manual_review":
      await applyManualReviewOutcome(failedResult.caseId);
      return;
    case "recovered":
      await applyAttemptedOutcome(scenario, failedResult.caseId, now, true, runId);
      return;
    case "attempted_not_recovered":
      await applyAttemptedOutcome(scenario, failedResult.caseId, now, false, runId);
      return;
  }
}

export async function replayDemoEvaluation(
  seed: number,
  reset = false
): Promise<DemoReplayResult> {
  const reservation = await reserveDemoRun(seed, reset);
  if (reservation.alreadyRunning) throw new DemoReplayInProgressError();
  if (reservation.reusedCompleted) {
    const existing = await prisma.demoRun.findUniqueOrThrow({
      where: { id: reservation.plan.runId },
    });
    if (!existing.resultMetrics) throw new Error("Completed demo run has no metrics");
    return {
      runId: existing.id,
      seed,
      datasetVersion: existing.datasetVersion,
      synthetic: true,
      reused: true,
      metrics: JSON.parse(existing.resultMetrics) as RecoveryMetrics,
    };
  }

  const generatedAt = new Date(reservation.plan.expectedMetrics.generatedAt);
  try {
    for (const scenario of reservation.plan.scenarios) {
      await replayScenario(reservation.plan.runId, scenario, generatedAt);
    }
    const metrics = await calculateStoredDemoMetrics(
      reservation.plan.runId,
      generatedAt
    );
    if (JSON.stringify(metrics) !== JSON.stringify(reservation.plan.expectedMetrics)) {
      throw new Error("Stored demo metrics do not match the versioned expected metrics");
    }
    await completeDemoRun(reservation.plan.runId, metrics);
    return {
      runId: reservation.plan.runId,
      seed,
      datasetVersion: reservation.plan.datasetVersion,
      synthetic: true,
      reused: false,
      metrics,
    };
  } catch (error) {
    await prisma.demoRun.update({
      where: { id: reservation.plan.runId },
      data: { status: "failed", completedAt: new Date() },
    });
    throw error;
  }
}
