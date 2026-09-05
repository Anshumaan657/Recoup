import { prisma } from "@/lib/db/prisma";
import { RecoveryCase, RecoveryDecision, PolicyResult, AuditEventType, RecoveryStatus, RecoveryAction } from "@/types/domain";
import { DecisionContext } from "@/lib/agent/decision-schema";
import { evaluateGuardrails, validateDecisionAgainstGuardrails, isEligibleForRecovery } from "./guardrails";
import { evaluateCaseWithAgent } from "@/lib/agent/recovery-agent";
import { appendAuditEvent } from "@/lib/recovery/service";

function toRecoveryStatus(s: string): RecoveryStatus {
  return s as RecoveryStatus;
}

function toRecoveryAction(s: string | null): RecoveryAction | null {
  return s as RecoveryAction | null;
}

function mapRecoveryCase(rc: {
  id: string;
  originalPaymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  customerName: string | null;
  customerEmail: string | null;
  customerContact: string | null;
  paymentMethod: string | null;
  failureCode: string | null;
  failureReason: string | null;
  failureSource: string | null;
  failureStep: string | null;
  attemptCount: number;
  status: string;
  selectedAction: string | null;
  decisionReason: string | null;
  confidence: number | null;
  requiresApproval: boolean;
  graceExpiresAt: Date | null;
  paymentLinkId: string | null;
  paymentLinkUrl: string | null;
  paymentLinkExpiry: Date | null;
  recoveredAmount: number | null;
  recoveredAt: Date | null;
  stoppedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}): RecoveryCase {
  return {
    ...rc,
    status: toRecoveryStatus(rc.status),
    selectedAction: toRecoveryAction(rc.selectedAction),
  };
}

export async function buildDecisionContext(case_: RecoveryCase): Promise<DecisionContext> {
  return {
    caseId: case_.id,
    originalPaymentId: case_.originalPaymentId,
    amount: case_.amount,
    currency: case_.currency,
    failureCode: case_.failureCode,
    failureReason: case_.failureReason,
    failureSource: case_.failureSource,
    failureStep: case_.failureStep,
    paymentMethod: case_.paymentMethod,
    attemptCount: case_.attemptCount,
    graceExpired: case_.graceExpiresAt ? new Date() > case_.graceExpiresAt : false,
    hasEmail: !!case_.customerEmail,
    hasContact: !!case_.customerContact,
    maxAttempts: (await import("@/lib/validation/env")).getServerEnv().MAX_RECOVERY_ATTEMPTS,
    enableRazorpayLinks: (await import("@/lib/validation/env")).getServerEnv().ENABLE_RAZORPAY_LINKS,
    approvalThresholdPaise: (await import("@/lib/validation/env")).getServerEnv().APPROVAL_THRESHOLD_PAISE,
  };
}

export async function evaluatePolicy(case_: RecoveryCase): Promise<PolicyResult> {
  if (!isEligibleForRecovery(case_.status, case_.graceExpiresAt ? new Date() > case_.graceExpiresAt : false)) {
    return {
      proposedDecision: null as any,
      approvedDecision: null,
      rejectedReasons: ["Case not eligible for recovery"],
      fallbackUsed: false,
    };
  }

  const ctx = await buildDecisionContext(case_);
  const guardrailCheck = evaluateGuardrails(ctx);
  if (!guardrailCheck.allowed) {
    return {
      proposedDecision: null as any,
      approvedDecision: null,
      rejectedReasons: guardrailCheck.violations,
      fallbackUsed: false,
    };
  }

  const proposedDecision = await evaluateCaseWithAgent(case_.id, ctx);

  const decisionGuardrailCheck = validateDecisionAgainstGuardrails(proposedDecision, ctx);
  if (!decisionGuardrailCheck.allowed) {
    return {
      proposedDecision,
      approvedDecision: null,
      rejectedReasons: decisionGuardrailCheck.violations,
      fallbackUsed: proposedDecision.fallbackUsed ?? false,
    };
  }

  if (proposedDecision.requiresApproval) {
    return {
      proposedDecision,
      approvedDecision: null,
      rejectedReasons: ["Requires manual approval"],
      fallbackUsed: proposedDecision.fallbackUsed ?? false,
    };
  }

  return {
    proposedDecision,
    approvedDecision: proposedDecision,
    rejectedReasons: [],
    fallbackUsed: proposedDecision.fallbackUsed ?? false,
  };
}

export async function applyPolicyDecision(
  case_: RecoveryCase,
  policyResult: PolicyResult
): Promise<RecoveryCase> {
  if (!policyResult.approvedDecision) {
    if (policyResult.rejectedReasons.includes("Requires manual approval")) {
      const updated = await prisma.recoveryCase.update({
        where: { id: case_.id },
        data: {
          status: RecoveryStatus.manual_review,
          selectedAction: RecoveryAction.manual_review,
          requiresApproval: true,
          decisionReason: policyResult.rejectedReasons.join("; "),
        },
      });
      await appendAuditEvent(case_.id, {
        eventType: AuditEventType.manual_review_requested,
        message: "Manual review required",
        metadata: { reasons: policyResult.rejectedReasons, fallbackUsed: policyResult.fallbackUsed },
      });
      return mapRecoveryCase(updated);
    }

    const updated = await prisma.recoveryCase.update({
      where: { id: case_.id },
      data: {
        status: RecoveryStatus.closed,
        selectedAction: RecoveryAction.no_action,
        decisionReason: policyResult.rejectedReasons.join("; "),
      },
    });
    await appendAuditEvent(case_.id, {
      eventType: AuditEventType.decision_rejected,
      message: "Recovery decision rejected by policy",
      metadata: { reasons: policyResult.rejectedReasons, fallbackUsed: policyResult.fallbackUsed },
    });
    return mapRecoveryCase(updated);
  }

  const decision = policyResult.approvedDecision!;
  const updated = await prisma.recoveryCase.update({
    where: { id: case_.id },
    data: {
      status: RecoveryStatus.eligible,
      selectedAction: decision.action,
      decisionReason: decision.reason,
      confidence: decision.confidence,
      requiresApproval: decision.requiresApproval,
    },
  });

  await appendAuditEvent(case_.id, {
    eventType: AuditEventType.decision_created,
    message: `Recovery decision: ${decision.action}`,
    metadata: {
      action: decision.action,
      reason: decision.reason,
      delaySeconds: decision.delaySeconds,
      confidence: decision.confidence,
      fallbackUsed: policyResult.fallbackUsed,
      fallbackReason: decision.fallbackReason,
    },
  });

  return mapRecoveryCase(updated);
}

export async function evaluateDueCases(limit = 50): Promise<PolicyResult[]> {
  const env = (await import("@/lib/validation/env")).getServerEnv();
  const now = new Date();

  const dueCasesRaw = await prisma.recoveryCase.findMany({
    where: {
      status: RecoveryStatus.waiting,
      graceExpiresAt: { lte: now },
      attemptCount: { lt: env.MAX_RECOVERY_ATTEMPTS },
    },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  const dueCases = dueCasesRaw.map(mapRecoveryCase);
  const results: PolicyResult[] = [];

  for (const case_ of dueCases) {
    const ctx = await buildDecisionContext(case_);
    const guardrailCheck = evaluateGuardrails(ctx);
    if (!guardrailCheck.allowed) {
      results.push({
        proposedDecision: null as any,
        approvedDecision: null,
        rejectedReasons: guardrailCheck.violations,
        fallbackUsed: false,
      });
      continue;
    }

    const policyResult = await evaluatePolicy(case_);
    await applyPolicyDecision(case_, policyResult);
    results.push(policyResult);
  }

  return results;
}