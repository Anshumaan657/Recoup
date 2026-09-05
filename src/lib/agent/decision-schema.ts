import { z } from "zod";
import { RecoveryAction } from "@/types/domain";

export const recoveryDecisionSchema = z.object({
  action: z.nativeEnum(RecoveryAction),
  reason: z.string().min(1).max(300),
  delaySeconds: z.number().int().min(0).max(86400),
  customerMessage: z.string().max(500),
  confidence: z.number().min(0).max(1),
  requiresApproval: z.boolean(),
  modelMetadata: z.record(z.unknown()).optional(),
  fallbackUsed: z.boolean().optional(),
  fallbackReason: z.string().optional(),
});

export type RecoveryDecision = z.infer<typeof recoveryDecisionSchema>;

export const decisionContextSchema = z.object({
  caseId: z.string(),
  originalPaymentId: z.string(),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  failureCode: z.string().nullable(),
  failureReason: z.string().nullable(),
  failureSource: z.string().nullable(),
  failureStep: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  attemptCount: z.number().int().nonnegative(),
  graceExpired: z.boolean(),
  hasEmail: z.boolean(),
  hasContact: z.boolean(),
  maxAttempts: z.number().int().positive(),
  enableRazorpayLinks: z.boolean(),
  approvalThresholdPaise: z.number().int().positive(),
});

export type DecisionContext = z.infer<typeof decisionContextSchema>;