import { describe, it, expect } from "vitest";
import { fallbackDecision, evaluateGuardrails } from "@/lib/agent/fallback-rules";
import { DecisionContext } from "@/lib/agent/decision-schema";
import { RecoveryAction } from "@/types/domain";

function createBaseCtx(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    caseId: "case_123",
    originalPaymentId: "pay_123",
    amount: 10000,
    currency: "INR",
    failureCode: "TEST_CODE",
    failureReason: "Test reason",
    failureSource: "test",
    failureStep: "test_step",
    paymentMethod: "upi",
    attemptCount: 0,
    graceExpired: true,
    hasEmail: true,
    hasContact: true,
    maxAttempts: 1,
    enableRazorpayLinks: false,
    approvalThresholdPaise: 500000,
    ...overrides,
  };
}

describe("Fallback Rules", () => {
  describe("fallbackDecision", () => {
    it("returns retry_later for insufficient funds", () => {
      const ctx = createBaseCtx({
        failureCode: "INSUFFICIENT_FUNDS",
        failureReason: "Insufficient funds",
      });
      const decision = fallbackDecision(ctx);
      expect(decision.action).toBe(RecoveryAction.retry_later);
      expect(decision.reason).toContain("Insufficient funds");
      expect(decision.delaySeconds).toBeGreaterThan(0);
      expect(decision.fallbackUsed).toBe(true);
    });

    it("returns retry_later for insufficient funds reason text", () => {
      const ctx = createBaseCtx({
        failureCode: "OTHER",
        failureReason: "insufficient funds detected",
      });
      const decision = fallbackDecision(ctx);
      expect(decision.action).toBe(RecoveryAction.retry_later);
    });

    it("returns create_payment_link for bank failure with email and links enabled", () => {
      const ctx = createBaseCtx({
        failureCode: "BANK_DOWN",
        failureReason: "Bank server down",
        enableRazorpayLinks: true,
        hasEmail: true,
      });
      const decision = fallbackDecision(ctx);
      expect(decision.action).toBe(RecoveryAction.create_payment_link);
      expect(decision.reason).toContain("Bank or network failure");
    });

    it("returns suggest_alternate_method for bank failure without links", () => {
      const ctx = createBaseCtx({
        failureCode: "BANK_DOWN",
        failureReason: "Bank server down",
        enableRazorpayLinks: false,
      });
      const decision = fallbackDecision(ctx);
      expect(decision.action).toBe(RecoveryAction.suggest_alternate_method);
    });

    it("returns suggest_alternate_method for auth failure", () => {
      const ctx = createBaseCtx({
        failureCode: "AUTH_FAILED",
        failureReason: "Invalid OTP",
      });
      const decision = fallbackDecision(ctx);
      expect(decision.action).toBe(RecoveryAction.suggest_alternate_method);
      expect(decision.reason).toContain("Authentication failure");
    });

    it("returns suggest_alternate_method for user cancelled", () => {
      const ctx = createBaseCtx({
        failureCode: "USER_CANCELLED",
        failureReason: "Customer cancelled payment",
      });
      const decision = fallbackDecision(ctx);
      expect(decision.action).toBe(RecoveryAction.suggest_alternate_method);
      expect(decision.reason).toContain("cancelled");
    });

    it("returns manual_review for fraud codes", () => {
      const ctx = createBaseCtx({
        failureCode: "HIGH_RISK",
        failureReason: "Transaction flagged as high risk",
      });
      const decision = fallbackDecision(ctx);
      expect(decision.action).toBe(RecoveryAction.manual_review);
      expect(decision.requiresApproval).toBe(true);
      expect(decision.confidence).toBeLessThan(0.65);
    });

    it("returns manual_review for unknown high risk reason", () => {
      const ctx = createBaseCtx({
        failureCode: "UNKNOWN_ERROR",
        failureReason: "Some unknown error",
        failureSource: "unknown",
        failureStep: "unknown",
      });
      const decision = fallbackDecision(ctx);
      expect(decision.action).toBe(RecoveryAction.manual_review);
    });

    it("returns manual_review for unmatched cases with failure code", () => {
      const ctx = createBaseCtx({
        failureCode: "SOME_OTHER_CODE",
        failureReason: "Some other reason",
      });
      const decision = fallbackDecision(ctx);
      expect(decision.action).toBe(RecoveryAction.manual_review);
    });

    it("always sets fallbackUsed to true", () => {
      const ctx = createBaseCtx();
      const decision = fallbackDecision(ctx);
      expect(decision.fallbackUsed).toBe(true);
      expect(decision.fallbackReason).toContain("fallback");
    });
  });

  describe("evaluateGuardrails", () => {
    it("passes for valid context", () => {
      const ctx = createBaseCtx();
      const result = evaluateGuardrails(ctx);
      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("fails when grace period not expired", () => {
      const ctx = createBaseCtx({ graceExpired: false });
      const result = evaluateGuardrails(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations).toContain("Grace period has not expired");
    });

    it("fails when max attempts exceeded", () => {
      const ctx = createBaseCtx({ attemptCount: 1, maxAttempts: 1 });
      const result = evaluateGuardrails(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations).toContain("Maximum recovery attempts exceeded");
    });

    it("fails for non-INR currency", () => {
      const ctx = createBaseCtx({ currency: "USD" });
      const result = evaluateGuardrails(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations).toContain("Non-INR currency not supported");
    });

    it("fails for non-positive amount", () => {
      const ctx = createBaseCtx({ amount: 0 });
      const result = evaluateGuardrails(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations).toContain("Non-positive amount");
    });

    it("fails when no contact channels", () => {
      const ctx = createBaseCtx({ hasEmail: false, hasContact: false });
      const result = evaluateGuardrails(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations).toContain("No contact channel available");
    });

    it("fails when payment links enabled but no email", () => {
      const ctx = createBaseCtx({ enableRazorpayLinks: true, hasEmail: false });
      const result = evaluateGuardrails(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations).toContain("Payment link requires verified email");
    });

    it("fails when amount exceeds approval threshold", () => {
      const ctx = createBaseCtx({ amount: 600000, approvalThresholdPaise: 500000 });
      const result = evaluateGuardrails(ctx);
      expect(result.allowed).toBe(false);
      expect(result.violations[0]).toContain("exceeds approval threshold");
    });
  });
});