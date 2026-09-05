import { describe, it, expect, beforeEach, vi } from "vitest";
import { recoveryDecisionSchema, decisionContextSchema } from "@/lib/agent/decision-schema";
import { RecoveryAction } from "@/types/domain";

describe("Decision Schema", () => {
  it("validates a correct RecoveryDecision", () => {
    const decision = {
      action: RecoveryAction.retry_later,
      reason: "Insufficient funds",
      delaySeconds: 3600,
      customerMessage: "Please add funds",
      confidence: 0.9,
      requiresApproval: false,
    };
    expect(() => recoveryDecisionSchema.parse(decision)).not.toThrow();
  });

  it("rejects invalid action", () => {
    const decision = {
      action: "invalid_action",
      reason: "Test",
      delaySeconds: 0,
      customerMessage: "Test",
      confidence: 0.5,
      requiresApproval: false,
    };
    expect(() => recoveryDecisionSchema.parse(decision)).toThrow();
  });

  it("rejects empty reason", () => {
    const decision = {
      action: RecoveryAction.retry_later,
      reason: "",
      delaySeconds: 0,
      customerMessage: "Test",
      confidence: 0.5,
      requiresApproval: false,
    };
    expect(() => recoveryDecisionSchema.parse(decision)).toThrow();
  });

  it("rejects reason over 300 chars", () => {
    const decision = {
      action: RecoveryAction.retry_later,
      reason: "a".repeat(301),
      delaySeconds: 0,
      customerMessage: "Test",
      confidence: 0.5,
      requiresApproval: false,
    };
    expect(() => recoveryDecisionSchema.parse(decision)).toThrow();
  });

  it("rejects customerMessage over 500 chars", () => {
    const decision = {
      action: RecoveryAction.retry_later,
      reason: "Test",
      delaySeconds: 0,
      customerMessage: "a".repeat(501),
      confidence: 0.5,
      requiresApproval: false,
    };
    expect(() => recoveryDecisionSchema.parse(decision)).toThrow();
  });

  it("rejects confidence below 0", () => {
    const decision = {
      action: RecoveryAction.retry_later,
      reason: "Test",
      delaySeconds: 0,
      customerMessage: "Test",
      confidence: -0.1,
      requiresApproval: false,
    };
    expect(() => recoveryDecisionSchema.parse(decision)).toThrow();
  });

  it("rejects confidence above 1", () => {
    const decision = {
      action: RecoveryAction.retry_later,
      reason: "Test",
      delaySeconds: 0,
      customerMessage: "Test",
      confidence: 1.1,
      requiresApproval: false,
    };
    expect(() => recoveryDecisionSchema.parse(decision)).toThrow();
  });

  it("rejects negative delaySeconds", () => {
    const decision = {
      action: RecoveryAction.retry_later,
      reason: "Test",
      delaySeconds: -1,
      customerMessage: "Test",
      confidence: 0.5,
      requiresApproval: false,
    };
    expect(() => recoveryDecisionSchema.parse(decision)).toThrow();
  });

  it("rejects delaySeconds over 86400", () => {
    const decision = {
      action: RecoveryAction.retry_later,
      reason: "Test",
      delaySeconds: 86401,
      customerMessage: "Test",
      confidence: 0.5,
      requiresApproval: false,
    };
    expect(() => recoveryDecisionSchema.parse(decision)).toThrow();
  });

  it("accepts optional modelMetadata", () => {
    const decision = {
      action: RecoveryAction.retry_later,
      reason: "Test",
      delaySeconds: 0,
      customerMessage: "Test",
      confidence: 0.5,
      requiresApproval: false,
      modelMetadata: { model: "gpt-4", tokens: 100 },
    };
    expect(() => recoveryDecisionSchema.parse(decision)).not.toThrow();
  });

  it("accepts fallback fields", () => {
    const decision = {
      action: RecoveryAction.retry_later,
      reason: "Test",
      delaySeconds: 0,
      customerMessage: "Test",
      confidence: 0.5,
      requiresApproval: false,
      fallbackUsed: true,
      fallbackReason: "LLM timeout",
    };
    expect(() => recoveryDecisionSchema.parse(decision)).not.toThrow();
  });
});

describe("DecisionContext Schema", () => {
  it("validates a correct DecisionContext", () => {
    const ctx = {
      caseId: "case_123",
      originalPaymentId: "pay_123",
      amount: 10000,
      currency: "INR",
      failureCode: "INSUFFICIENT_FUNDS",
      failureReason: "Insufficient funds",
      failureSource: "bank",
      failureStep: "payment_processing",
      paymentMethod: "upi",
      attemptCount: 0,
      graceExpired: true,
      hasEmail: true,
      hasContact: true,
      maxAttempts: 1,
      enableRazorpayLinks: false,
      approvalThresholdPaise: 500000,
    };
    expect(() => decisionContextSchema.parse(ctx)).not.toThrow();
  });

  it("accepts nullable fields", () => {
    const ctx = {
      caseId: "case_123",
      originalPaymentId: "pay_123",
      amount: 10000,
      currency: "INR",
      failureCode: null,
      failureReason: null,
      failureSource: null,
      failureStep: null,
      paymentMethod: null,
      attemptCount: 0,
      graceExpired: true,
      hasEmail: false,
      hasContact: false,
      maxAttempts: 1,
      enableRazorpayLinks: false,
      approvalThresholdPaise: 500000,
    };
    expect(() => decisionContextSchema.parse(ctx)).not.toThrow();
  });
});