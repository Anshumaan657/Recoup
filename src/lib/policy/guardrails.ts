import { getServerEnv } from "@/lib/validation/env";
import { RecoveryStatus, RecoveryAction } from "@/types/domain";
import { DecisionContext } from "@/lib/agent/decision-schema";

export interface GuardrailResult {
  allowed: boolean;
  violations: string[];
}

function isTerminalStatus(status: RecoveryStatus): boolean {
  return (
    status === RecoveryStatus.recovered ||
    status === RecoveryStatus.closed ||
    status === RecoveryStatus.manual_review
  );
}

export function evaluateGuardrails(ctx: DecisionContext): GuardrailResult {
  const violations: string[] = [];
  const env = getServerEnv();

  if (!ctx.graceExpired) {
    violations.push("Grace period has not expired");
  }

  if (ctx.attemptCount >= ctx.maxAttempts) {
    violations.push(`Maximum recovery attempts (${ctx.maxAttempts}) exceeded`);
  }

  if (ctx.currency !== "INR") {
    violations.push(`Currency ${ctx.currency} not supported; only INR allowed`);
  }

  if (ctx.amount <= 0) {
    violations.push("Amount must be positive");
  }

  if (!ctx.hasEmail && !ctx.hasContact) {
    violations.push("No contact channel available (email or phone required)");
  }

  if (ctx.enableRazorpayLinks && !ctx.hasEmail) {
    violations.push("Payment link requires verified email");
  }

  const approvalThreshold = env.APPROVAL_THRESHOLD_PAISE ?? 500000;
  if (ctx.amount >= approvalThreshold) {
    violations.push(`Amount ${ctx.amount} paise exceeds approval threshold ${approvalThreshold}`);
  }

  return {
    allowed: violations.length === 0,
    violations,
  };
}

export function validateDecisionAgainstGuardrails(
  decision: { action: RecoveryAction; requiresApproval: boolean; customerMessage?: string },
  ctx: DecisionContext
): GuardrailResult {
  const violations: string[] = [];

  if (decision.action === RecoveryAction.create_payment_link) {
    if (!ctx.enableRazorpayLinks) {
      violations.push("Payment links disabled (ENABLE_RAZORPAY_LINKS=false)");
    }
    if (!ctx.hasEmail) {
      violations.push("Payment link requires verified email");
    }
  }

  if (decision.requiresApproval) {
    const approvalThreshold = getServerEnv().APPROVAL_THRESHOLD_PAISE ?? 500000;
    if (ctx.amount < approvalThreshold && !ctx.failureCode?.includes("FRAUD")) {
      violations.push("Approval required but amount below threshold and no fraud indicator");
    }
  }

  if (
    decision.action === RecoveryAction.create_payment_link ||
    decision.action === RecoveryAction.suggest_alternate_method
  ) {
    if (!ctx.hasEmail && !ctx.hasContact) {
      violations.push("Contact channel required for notification");
    }
  }

  const sensitivePatterns = [
    /pin/i,
    /otp/i,
    /cvv/i,
    /card.number/i,
    /bank.password/i,
    /credential/i,
  ];

  if (
    decision.customerMessage &&
    sensitivePatterns.some((pattern) => pattern.test(decision.customerMessage!))
  ) {
    violations.push("Customer message contains prohibited sensitive wording");
  }

  return {
    allowed: violations.length === 0,
    violations,
  };
}

export function isEligibleForRecovery(
  status: RecoveryStatus,
  graceExpired: boolean
): boolean {
  return status === RecoveryStatus.waiting && graceExpired;
}
