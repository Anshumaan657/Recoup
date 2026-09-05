import { RecoveryAction, RecoveryStatus } from "@/types/domain";
import { RecoveryDecision, DecisionContext } from "./decision-schema";

const INSUFFICIENT_FUNDS_CODES = ["INSUFFICIENT_FUNDS", "LOW_BALANCE", "NOT_ENOUGH_FUNDS"];
const BANK_FAILURE_CODES = ["BANK_DOWN", "BANK_ERROR", "BANK_TIMEOUT", "BANK_UNAVAILABLE"];
const NETWORK_FAILURE_CODES = ["NETWORK_ERROR", "TIMEOUT", "GATEWAY_TIMEOUT", "CONNECTION_ERROR"];
const TECHNICAL_FAILURE_CODES = ["TECHNICAL_ERROR", "SYSTEM_ERROR", "INTERNAL_ERROR", "GATEWAY_ERROR"];
const AUTH_FAILURE_CODES = ["AUTH_FAILED", "INVALID_OTP", "INVALID_PIN", "AUTHENTICATION_FAILED"];
const USER_CANCELLED_CODES = ["USER_CANCELLED", "CUSTOMER_CANCELLED", "PAYMENT_CANCELLED"];
const FRAUD_CODES = ["HIGH_RISK", "SUSPECTED_FRAUD", "FRAUD_DETECTED", "RISK_DECLINE"];

const INSUFFICIENT_FUNDS_REASONS = ["insufficient funds", "low balance", "not enough money"];
const BANK_FAILURE_REASONS = ["bank down", "bank error", "bank unavailable", "bank timeout"];
const NETWORK_FAILURE_REASONS = ["network error", "timeout", "connection error", "gateway timeout"];
const AUTH_FAILURE_REASONS = ["auth failed", "invalid otp", "invalid pin", "authentication failed"];
const USER_CANCELLED_REASONS = ["user cancelled", "customer cancelled", "payment cancelled"];

function normalizeReason(reason: string | null): string {
  return (reason ?? "").toLowerCase();
}

function matchesAny(reason: string | null, patterns: string[]): boolean {
  if (!reason) return false;
  const normalized = normalizeReason(reason);
  return patterns.some((p) => normalized.includes(p.toLowerCase()));
}

function isInsufficientFunds(ctx: DecisionContext): boolean {
  return (
    matchesAny(ctx.failureCode, INSUFFICIENT_FUNDS_CODES) ||
    matchesAny(ctx.failureReason, INSUFFICIENT_FUNDS_REASONS)
  );
}

function isBankOrNetworkFailure(ctx: DecisionContext): boolean {
  return (
    matchesAny(ctx.failureCode, [...BANK_FAILURE_CODES, ...NETWORK_FAILURE_CODES, ...TECHNICAL_FAILURE_CODES]) ||
    matchesAny(ctx.failureReason, [...BANK_FAILURE_REASONS, ...NETWORK_FAILURE_REASONS])
  );
}

function isAuthFailure(ctx: DecisionContext): boolean {
  return (
    matchesAny(ctx.failureCode, AUTH_FAILURE_CODES) ||
    matchesAny(ctx.failureReason, AUTH_FAILURE_REASONS)
  );
}

function isUserCancelled(ctx: DecisionContext): boolean {
  return (
    matchesAny(ctx.failureCode, USER_CANCELLED_CODES) ||
    matchesAny(ctx.failureReason, USER_CANCELLED_REASONS)
  );
}

function isFraudOrHighRisk(ctx: DecisionContext): boolean {
  return (
    matchesAny(ctx.failureCode, FRAUD_CODES) ||
    ctx.failureSource === "risk" ||
    ctx.failureStep === "risk_check"
  );
}

function isUnknownHighRisk(ctx: DecisionContext): boolean {
  const hasKnownReason =
    isInsufficientFunds(ctx) ||
    isBankOrNetworkFailure(ctx) ||
    isAuthFailure(ctx) ||
    isUserCancelled(ctx) ||
    isFraudOrHighRisk(ctx);
  return !hasKnownReason && (ctx.failureCode ?? "").length > 0;
}

export function fallbackDecision(ctx: DecisionContext): RecoveryDecision {
  let action: RecoveryAction;
  let reason: string;
  let delaySeconds: number;
  let customerMessage: string;
  let confidence = 0.5;
  let requiresApproval = false;

  if (isInsufficientFunds(ctx)) {
    action = RecoveryAction.retry_later;
    reason = "Insufficient funds detected; retry after delay";
    delaySeconds = 3600;
    customerMessage = "We noticed your payment couldn't go through due to insufficient funds. Please ensure adequate balance and we'll retry shortly.";
  } else if (isBankOrNetworkFailure(ctx)) {
    action = ctx.enableRazorpayLinks && ctx.hasEmail
      ? RecoveryAction.create_payment_link
      : RecoveryAction.suggest_alternate_method;
    reason = "Bank or network failure detected; offering recovery option";
    delaySeconds = 0;
    customerMessage = "Your payment couldn't be processed due to a temporary issue. You can try again using this secure link or choose another payment method.";
  } else if (isAuthFailure(ctx)) {
    action = RecoveryAction.suggest_alternate_method;
    reason = "Authentication failure; suggesting alternative payment method";
    delaySeconds = 0;
    customerMessage = "We couldn't verify your payment. Please try using a different payment method to complete your purchase.";
  } else if (isUserCancelled(ctx)) {
    action = RecoveryAction.suggest_alternate_method;
    reason = "Customer cancelled payment; offering alternative method";
    delaySeconds = 0;
    customerMessage = "It looks like the payment was cancelled. You can try again with a different payment method whenever you're ready.";
  } else if (isFraudOrHighRisk(ctx) || isUnknownHighRisk(ctx)) {
    action = RecoveryAction.manual_review;
    reason = isFraudOrHighRisk(ctx) ? "Suspected fraud or high-risk transaction" : "Unknown failure reason requiring manual review";
    delaySeconds = 0;
    customerMessage = "We need to review this transaction manually. Our team will contact you shortly.";
    requiresApproval = true;
    confidence = 0.4;
  } else {
    action = RecoveryAction.no_action;
    reason = "No matching fallback rule; no action taken";
    delaySeconds = 0;
    customerMessage = "";
    confidence = 0.3;
  }

  return {
    action,
    reason,
    delaySeconds,
    customerMessage,
    confidence,
    requiresApproval,
    fallbackUsed: true,
    fallbackReason: "LLM unavailable or output invalid; using deterministic fallback",
    modelMetadata: { fallbackRule: "deterministic" },
  };
}

export function evaluateGuardrails(ctx: DecisionContext): { allowed: boolean; violations: string[] } {
  const violations: string[] = [];

  if (!ctx.graceExpired) {
    violations.push("Grace period has not expired");
  }

  if (ctx.attemptCount >= ctx.maxAttempts) {
    violations.push("Maximum recovery attempts exceeded");
  }

  if (ctx.currency !== "INR") {
    violations.push("Non-INR currency not supported");
  }

  if (ctx.amount <= 0) {
    violations.push("Non-positive amount");
  }

  if (!ctx.hasEmail && !ctx.hasContact) {
    violations.push("No contact channel available");
  }

  if (ctx.enableRazorpayLinks && !ctx.hasEmail) {
    violations.push("Payment link requires verified email");
  }

  const approvalThreshold = 500000;
  if (ctx.amount >= approvalThreshold) {
    violations.push(`Amount ${ctx.amount} paise exceeds approval threshold ${approvalThreshold}`);
  }

  return {
    allowed: violations.length === 0,
    violations,
  };
}