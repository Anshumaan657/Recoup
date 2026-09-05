import { createDemoDataset, DEFAULT_DEMO_SEED, DEMO_DATASET_VERSION } from "@/lib/demo/dataset";
import { maskContact, maskEmail, maskName } from "@/lib/demo/api-view";
import type { RecoveryMetrics } from "@/lib/recovery/metrics";

const GENERATED_AT = "2026-01-15T10:30:00.000Z";
const RUN_ID = `hosted-${DEMO_DATASET_VERSION}-${DEFAULT_DEMO_SEED}`;
const HOSTED_DATASET = createDemoDataset();

function caseStatus(outcome: string) {
  if (outcome === "recovered") return "recovered";
  if (outcome === "manual_review") return "manual_review";
  if (outcome === "attempted_not_recovered") return "contacted";
  return "closed";
}

function selectedAction(outcome: string) {
  if (outcome === "recovered" || outcome === "attempted_not_recovered") return "create_payment_link";
  if (outcome === "manual_review") return "manual_review";
  return "no_action";
}

function stoppedReason(outcome: string) {
  if (outcome === "late_capture") return "late_capture";
  if (outcome === "stopped_unrecoverable") return "unrecoverable";
  return null;
}

function buildSummary(index: number) {
  const scenario = HOSTED_DATASET[index];
  const { input, expected } = scenario;
  const attempted = expected.outcome === "recovered" || expected.outcome === "attempted_not_recovered";
  const createdAt = input.createdAt;
  const updatedAt = new Date(Date.parse(createdAt) + 15 * 60_000).toISOString();
  return {
    id: input.caseId,
    originalPaymentId: input.originalPaymentId,
    orderId: input.orderId,
    amountPaise: input.amountPaise,
    currency: input.currency,
    customerName: maskName(input.customerName),
    customerEmail: maskEmail(input.customerEmail),
    customerContact: maskContact(input.customerContact),
    paymentMethod: input.paymentMethod,
    failureReason: input.failureReason,
    attemptCount: attempted ? 1 : 0,
    status: caseStatus(expected.outcome),
    selectedAction: selectedAction(expected.outcome),
    requiresApproval: expected.outcome === "manual_review",
    hasPaymentLink: attempted,
    recoveredAmountPaise: expected.outcome === "recovered" ? input.amountPaise : null,
    stoppedReason: stoppedReason(expected.outcome),
    synthetic: true,
    createdAt,
    updatedAt,
  };
}

export const HOSTED_DEMO_CASES = HOSTED_DATASET.map((_, index) => buildSummary(index));

const totalAtRiskPaise = HOSTED_DEMO_CASES.reduce((total, item) => total + item.amountPaise, 0);
const recoveredPaise = HOSTED_DEMO_CASES.reduce(
  (total, item) => total + (item.recoveredAmountPaise ?? 0),
  0
);

export const HOSTED_DEMO_METRICS: RecoveryMetrics = {
  attempted: 36,
  contacted: 36,
  recovered: 20,
  stopped: 16,
  manualReview: 8,
  duplicatesPrevented: 8,
  totalCases: HOSTED_DEMO_CASES.length,
  totalAtRiskPaise,
  recoveredPaise,
  recoveryRate: recoveredPaise / totalAtRiskPaise,
  generatedAt: GENERATED_AT,
  dataset: "synthetic",
};

export function hostedDemoMetricsResponse() {
  return {
    runId: RUN_ID,
    datasetVersion: DEMO_DATASET_VERSION,
    synthetic: true,
    ...HOSTED_DEMO_METRICS,
    definitions: {
      attempted: "Cases where a recovery intervention was executed",
      contacted: "Attempted cases with an outbox customer intervention",
      stopped: "Late-capture or unrecoverable cases stopped before recovery",
      duplicatesPrevented: "Original late captures that stopped duplicate collection",
      recoveryRate: "recoveredPaise divided by totalAtRiskPaise",
    },
  };
}

export function hostedDemoReplayResponse() {
  return {
    status: "completed" as const,
    runId: RUN_ID,
    seed: DEFAULT_DEMO_SEED,
    datasetVersion: DEMO_DATASET_VERSION,
    synthetic: true,
    reused: true,
    metrics: HOSTED_DEMO_METRICS,
  };
}

export function hostedDemoDetail(id: string) {
  const summary = HOSTED_DEMO_CASES.find((item) => item.id === id);
  if (!summary) return null;
  const scenario = HOSTED_DATASET.find((item) => item.input.caseId === id)!;
  const decisionAt = new Date(Date.parse(summary.createdAt) + 2 * 60_000).toISOString();
  const completedAt = summary.updatedAt;
  const auditTimeline = [
    {
      id: `${id}-failed`,
      eventType: "payment_failed_received",
      message: `Synthetic payment failed: ${scenario.input.failureReason}`,
      metadata: { synthetic: true, failureCode: scenario.input.failureCode },
      createdAt: summary.createdAt,
    },
    {
      id: `${id}-decision`,
      eventType: summary.status === "manual_review" ? "manual_review_requested" : "decision_created",
      message: summary.status === "manual_review" ? "Synthetic case requires manual review" : `Synthetic policy decision: ${summary.selectedAction}`,
      metadata: { synthetic: true, fallbackUsed: true, approved: summary.status !== "manual_review" },
      createdAt: decisionAt,
    },
    {
      id: `${id}-outcome`,
      eventType: summary.status === "recovered" ? "recovery_succeeded" : summary.status === "closed" ? "recovery_stopped" : "payment_link_created",
      message: summary.status === "recovered"
        ? "Synthetic recovery payment verified"
        : summary.stoppedReason === "late_capture"
          ? "Late capture verified; recovery stopped"
          : summary.status === "closed"
            ? "Synthetic recovery stopped by policy"
            : "Synthetic payment link created",
      metadata: { synthetic: true, stoppedReason: summary.stoppedReason ?? undefined },
      createdAt: completedAt,
    },
  ];
  return {
    ...summary,
    failureCode: scenario.input.failureCode,
    decisionReason: "Deterministic fallback evaluated by the policy layer for the hosted preview.",
    confidence: summary.status === "manual_review" ? 0.4 : 0.82,
    paymentLinkExpiry: summary.hasPaymentLink
      ? new Date(Date.parse(summary.createdAt) + 24 * 60 * 60_000).toISOString()
      : null,
    recoveredAt: summary.status === "recovered" ? completedAt : null,
    auditTimeline,
  };
}
