import { beforeEach, describe, expect, it } from "vitest";
import { validateDecisionAgainstGuardrails } from "@/lib/policy/guardrails";
import { resetServerEnvCache } from "@/lib/validation/env";
import { RecoveryAction } from "@/types/domain";
import type { DecisionContext } from "@/lib/agent/decision-schema";

const context: DecisionContext = {
  caseId: "case_safe",
  originalPaymentId: "pay_safe",
  amount: 25_000,
  currency: "INR",
  failureCode: "BANK_DOWN",
  failureReason: "Bank unavailable",
  failureSource: "bank",
  failureStep: "payment_authorization",
  paymentMethod: "upi",
  attemptCount: 0,
  graceExpired: true,
  hasEmail: true,
  hasContact: true,
  maxAttempts: 1,
  enableRazorpayLinks: false,
  approvalThresholdPaise: 500_000,
};

beforeEach(() => {
  process.env.APPROVAL_THRESHOLD_PAISE = "500000";
  resetServerEnvCache();
});

describe("decision message guardrail", () => {
  it("blocks sensitive credential requests", () => {
    const result = validateDecisionAgainstGuardrails(
      {
        action: RecoveryAction.no_action,
        requiresApproval: false,
        customerMessage: "Please send us your OTP to complete payment.",
      },
      context
    );
    expect(result.allowed).toBe(false);
    expect(result.violations).toContain(
      "Customer message contains prohibited sensitive wording"
    );
  });

  it("allows ordinary recovery copy", () => {
    const result = validateDecisionAgainstGuardrails(
      {
        action: RecoveryAction.no_action,
        requiresApproval: false,
        customerMessage: "Please try your payment again when convenient.",
      },
      context
    );
    expect(result.allowed).toBe(true);
  });
});
