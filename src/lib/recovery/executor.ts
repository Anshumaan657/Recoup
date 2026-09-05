import { prisma } from "@/lib/db/prisma";
import { queueNotificationWithAudit } from "@/lib/notifications/outbox";
import {
  buildPaymentLinkParams,
  cancelPaymentLink,
  createPaymentLink,
  PaymentLinkRequest,
  PaymentLinkResponse,
} from "@/lib/razorpay/payment-links";
import { RazorpayProviderError } from "@/lib/razorpay/client";
import { getServerEnv } from "@/lib/validation/env";
import { AuditEventType, RecoveryAction, RecoveryStatus } from "@/types/domain";

export type ExecutionOutcome =
  | "payment_link_created"
  | "notification_queued"
  | "retry_scheduled"
  | "manual_review"
  | "closed"
  | "stopped"
  | "already_executed"
  | "not_ready"
  | "provider_error";

export interface ExecutionResult {
  caseId: string;
  outcome: ExecutionOutcome;
  status: RecoveryStatus;
  duplicate: boolean;
  simulated?: boolean;
}

interface ExecutionDependencies {
  now?: Date;
  linkTtlSeconds?: number;
  retryDelaySeconds?: number;
  createLink?: (
    request: PaymentLinkRequest
  ) => Promise<PaymentLinkResponse>;
  cancelLink?: (paymentLinkId: string) => Promise<void>;
}

function auditData(
  caseId: string,
  eventType: AuditEventType,
  message: string,
  metadata: Record<string, unknown>
) {
  return {
    recoveryCaseId: caseId,
    eventType,
    message,
    metadata: JSON.stringify(metadata),
  };
}

function statusOf(value: string): RecoveryStatus {
  return value as RecoveryStatus;
}

function terminal(status: string): boolean {
  return [
    RecoveryStatus.recovered,
    RecoveryStatus.closed,
    RecoveryStatus.manual_review,
  ].includes(status as RecoveryStatus);
}

function isSafePaymentLinkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "rzp.io";
  } catch {
    return false;
  }
}

function notificationTarget(recoveryCase: {
  customerEmail: string | null;
  customerContact: string | null;
}): { channel: "email" | "sms"; recipient: string } | null {
  if (recoveryCase.customerEmail) {
    return { channel: "email", recipient: recoveryCase.customerEmail };
  }
  if (recoveryCase.customerContact) {
    return { channel: "sms", recipient: recoveryCase.customerContact };
  }
  return null;
}

async function stopIneligibleCase(
  caseId: string,
  reason: "customer_opt_out" | "link_expired" | "max_attempts" | "invalid_decision"
): Promise<ExecutionResult> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.recoveryCase.findUnique({ where: { id: caseId } });
    if (!current) throw new Error(`Recovery case ${caseId} not found`);
    if (terminal(current.status)) {
      return {
        caseId,
        outcome: "already_executed",
        status: statusOf(current.status),
        duplicate: true,
      };
    }
    const status =
      reason === "max_attempts" || reason === "invalid_decision"
        ? RecoveryStatus.manual_review
        : RecoveryStatus.closed;
    const updated = await tx.recoveryCase.update({
      where: { id: caseId },
      data: {
        status,
        stoppedReason: reason,
        ...(status === RecoveryStatus.manual_review
          ? {
              selectedAction: RecoveryAction.manual_review,
              requiresApproval: true,
            }
          : {}),
      },
    });
    await tx.auditEvent.create({
      data: auditData(
        caseId,
        status === RecoveryStatus.manual_review
          ? AuditEventType.manual_review_requested
          : AuditEventType.recovery_stopped,
        status === RecoveryStatus.manual_review
          ? reason === "max_attempts"
            ? "Recovery attempt limit reached; manual review required"
            : "Recovery decision is missing or invalid; manual review required"
          : reason === "customer_opt_out"
            ? "Recovery stopped after customer opt-out"
            : "Recovery stopped because the payment link expired",
        { reason }
      ),
    });
    return {
      caseId,
      outcome: status === RecoveryStatus.manual_review ? "manual_review" : "stopped",
      status: statusOf(updated.status),
      duplicate: false,
    };
  });
}

async function executeSimpleDecision(
  caseId: string,
  action: RecoveryAction,
  now: Date,
  retryDelaySeconds: number
): Promise<ExecutionResult> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.recoveryCase.findUnique({ where: { id: caseId } });
    if (!current || current.status !== RecoveryStatus.eligible) {
      if (!current) throw new Error(`Recovery case ${caseId} not found`);
      return {
        caseId,
        outcome: "already_executed",
        status: statusOf(current.status),
        duplicate: true,
      };
    }

    if (action === RecoveryAction.retry_later) {
      const nextActionAt = new Date(now.getTime() + retryDelaySeconds * 1000);
      const updated = await tx.recoveryCase.update({
        where: { id: caseId },
        data: { graceExpiresAt: nextActionAt },
      });
      await tx.auditEvent.create({
        data: auditData(
          caseId,
          AuditEventType.decision_created,
          "Recovery retry scheduled",
          { action, nextActionAt: nextActionAt.toISOString() }
        ),
      });
      return {
        caseId,
        outcome: "retry_scheduled",
        status: statusOf(updated.status),
        duplicate: false,
      };
    }

    if (action === RecoveryAction.manual_review) {
      const updated = await tx.recoveryCase.update({
        where: { id: caseId },
        data: {
          status: RecoveryStatus.manual_review,
          requiresApproval: true,
        },
      });
      await tx.auditEvent.create({
        data: auditData(
          caseId,
          AuditEventType.manual_review_requested,
          "Recovery sent for manual review",
          { action }
        ),
      });
      return {
        caseId,
        outcome: "manual_review",
        status: statusOf(updated.status),
        duplicate: false,
      };
    }

    const updated = await tx.recoveryCase.update({
      where: { id: caseId },
      data: {
        status: RecoveryStatus.closed,
        stoppedReason: "no_action",
      },
    });
    await tx.auditEvent.create({
      data: auditData(
        caseId,
        AuditEventType.recovery_stopped,
        "Recovery closed without customer action",
        { action: RecoveryAction.no_action }
      ),
    });
    return {
      caseId,
      outcome: "closed",
      status: statusOf(updated.status),
      duplicate: false,
    };
  });
}

async function executeAlternateMethod(caseId: string): Promise<ExecutionResult> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.recoveryCase.findUnique({ where: { id: caseId } });
    if (!current || current.status !== RecoveryStatus.eligible) {
      if (!current) throw new Error(`Recovery case ${caseId} not found`);
      return {
        caseId,
        outcome: "already_executed",
        status: statusOf(current.status),
        duplicate: true,
      };
    }
    const target = notificationTarget(current);
    if (!target) {
      const updated = await tx.recoveryCase.update({
        where: { id: caseId },
        data: {
          status: RecoveryStatus.manual_review,
          requiresApproval: true,
        },
      });
      await tx.auditEvent.create({
        data: auditData(
          caseId,
          AuditEventType.manual_review_requested,
          "No customer contact channel; manual review required",
          { reason: "missing_contact" }
        ),
      });
      return {
        caseId,
        outcome: "manual_review",
        status: statusOf(updated.status),
        duplicate: false,
      };
    }
    const reserved = await tx.recoveryCase.updateMany({
      where: { id: caseId, status: RecoveryStatus.eligible },
      data: {
        status: RecoveryStatus.contacted,
        attemptCount: { increment: 1 },
      },
    });
    if (reserved.count !== 1) {
      return {
        caseId,
        outcome: "already_executed",
        status: RecoveryStatus.contacted,
        duplicate: true,
      };
    }
    await queueNotificationWithAudit(tx, {
      recoveryCaseId: caseId,
      channel: target.channel,
      recipient: target.recipient,
      message:
        "Your payment was not completed. Please retry using another available payment method.",
    });
    return {
      caseId,
      outcome: "notification_queued",
      status: RecoveryStatus.contacted,
      duplicate: false,
    };
  });
}

async function recordProviderFailure(
  caseId: string,
  error: unknown,
  maxAttempts: number
): Promise<ExecutionResult> {
  const category =
    error instanceof RazorpayProviderError ? error.category : "provider";
  const code =
    error instanceof RazorpayProviderError ? error.code : "UNEXPECTED_PROVIDER_ERROR";
  return prisma.$transaction(async (tx) => {
    const current = await tx.recoveryCase.findUnique({ where: { id: caseId } });
    if (!current) throw new Error(`Recovery case ${caseId} not found`);
    if (current.status !== RecoveryStatus.contacted || current.paymentLinkId) {
      return {
        caseId,
        outcome: "stopped",
        status: statusOf(current.status),
        duplicate: true,
      };
    }
    const exhausted = current.attemptCount >= maxAttempts;
    const updated = await tx.recoveryCase.update({
      where: { id: caseId },
      data: {
        status: exhausted ? RecoveryStatus.manual_review : RecoveryStatus.eligible,
        ...(exhausted
          ? { requiresApproval: true, stoppedReason: "max_attempts" }
          : {}),
      },
    });
    await tx.auditEvent.create({
      data: auditData(
        caseId,
        AuditEventType.provider_error,
        "Payment Link provider request failed",
        { category, code, retryable: !exhausted }
      ),
    });
    if (exhausted) {
      await tx.auditEvent.create({
        data: auditData(
          caseId,
          AuditEventType.manual_review_requested,
          "Recovery attempt limit reached after provider failure",
          { reason: "max_attempts" }
        ),
      });
    }
    return {
      caseId,
      outcome: "provider_error",
      status: statusOf(updated.status),
      duplicate: false,
    };
  });
}

export async function executeRecoveryCase(
  caseId: string,
  dependencies: ExecutionDependencies = {}
): Promise<ExecutionResult> {
  const now = dependencies.now ?? new Date();
  const env = getServerEnv();
  const [recoveryCase, existingNotification] = await Promise.all([
    prisma.recoveryCase.findUnique({ where: { id: caseId } }),
    prisma.notificationOutbox.findUnique({ where: { recoveryCaseId: caseId } }),
  ]);
  if (!recoveryCase) throw new Error(`Recovery case ${caseId} not found`);

  if (terminal(recoveryCase.status)) {
    return {
      caseId,
      outcome: "already_executed",
      status: statusOf(recoveryCase.status),
      duplicate: true,
    };
  }
  if (recoveryCase.stoppedReason === "customer_opt_out") {
    return stopIneligibleCase(caseId, "customer_opt_out");
  }
  if (recoveryCase.paymentLinkId) {
    if (recoveryCase.paymentLinkExpiry && recoveryCase.paymentLinkExpiry <= now) {
      return stopIneligibleCase(caseId, "link_expired");
    }
    return {
      caseId,
      outcome: "already_executed",
      status: statusOf(recoveryCase.status),
      duplicate: true,
    };
  }
  if (existingNotification) {
    return {
      caseId,
      outcome: "already_executed",
      status: statusOf(recoveryCase.status),
      duplicate: true,
    };
  }
  if (
    recoveryCase.status !== RecoveryStatus.eligible ||
    (recoveryCase.graceExpiresAt && recoveryCase.graceExpiresAt > now)
  ) {
    return {
      caseId,
      outcome: "not_ready",
      status: statusOf(recoveryCase.status),
      duplicate: false,
    };
  }
  if (recoveryCase.attemptCount >= env.MAX_RECOVERY_ATTEMPTS) {
    return stopIneligibleCase(caseId, "max_attempts");
  }

  const action = recoveryCase.selectedAction as RecoveryAction | null;
  if (!action) {
    return stopIneligibleCase(caseId, "invalid_decision");
  }
  if (
    action === RecoveryAction.retry_later ||
    action === RecoveryAction.manual_review ||
    action === RecoveryAction.no_action
  ) {
    const boundedDelay = Math.min(
      86_400,
      Math.max(60, dependencies.retryDelaySeconds ?? 900)
    );
    return executeSimpleDecision(caseId, action, now, boundedDelay);
  }
  if (action === RecoveryAction.suggest_alternate_method) {
    return executeAlternateMethod(caseId);
  }

  const reserved = await prisma.recoveryCase.updateMany({
    where: {
      id: caseId,
      status: RecoveryStatus.eligible,
      paymentLinkId: null,
      attemptCount: { lt: env.MAX_RECOVERY_ATTEMPTS },
    },
    data: {
      status: RecoveryStatus.contacted,
      attemptCount: { increment: 1 },
    },
  });
  if (reserved.count !== 1) {
    const current = await prisma.recoveryCase.findUniqueOrThrow({ where: { id: caseId } });
    return {
      caseId,
      outcome: "already_executed",
      status: statusOf(current.status),
      duplicate: true,
    };
  }

  const reservedCase = await prisma.recoveryCase.findUniqueOrThrow({ where: { id: caseId } });
  const expiresAt = new Date(
    now.getTime() + Math.max(300, dependencies.linkTtlSeconds ?? 3600) * 1000
  );
  const request = buildPaymentLinkParams({
    caseId,
    amount: reservedCase.amount,
    currency: reservedCase.currency,
    customerName: reservedCase.customerName,
    customerEmail: reservedCase.customerEmail,
    customerContact: reservedCase.customerContact,
    expiresAt,
  });

  let link: PaymentLinkResponse;
  try {
    link = await (dependencies.createLink ?? createPaymentLink)(request);
  } catch (error) {
    return recordProviderFailure(caseId, error, env.MAX_RECOVERY_ATTEMPTS);
  }

  if (
    link.amount !== reservedCase.amount ||
    link.currency !== reservedCase.currency ||
    link.reference_id !== request.reference_id ||
    !isSafePaymentLinkUrl(link.short_url)
  ) {
    return recordProviderFailure(
      caseId,
      new RazorpayProviderError("invalid_response", 502, "LINK_MISMATCH"),
      env.MAX_RECOVERY_ATTEMPTS
    );
  }

  let persisted;
  try {
    persisted = await prisma.$transaction(async (tx) => {
      const current = await tx.recoveryCase.findUniqueOrThrow({ where: { id: caseId } });
      if (current.status !== RecoveryStatus.contacted || current.paymentLinkId) {
        return null;
      }
      const updated = await tx.recoveryCase.update({
        where: { id: caseId },
        data: {
          paymentLinkId: link.id,
          paymentLinkUrl: link.short_url,
          paymentLinkExpiry: new Date(link.expire_by * 1000),
        },
      });
      await tx.auditEvent.create({
        data: auditData(
          caseId,
          AuditEventType.payment_link_created,
          link.simulated
            ? "Simulated recovery Payment Link created"
            : "Razorpay recovery Payment Link created",
          {
            paymentLinkId: link.id,
            referenceId: link.reference_id,
            expiresAt: new Date(link.expire_by * 1000).toISOString(),
            simulated: Boolean(link.simulated),
          }
        ),
      });
      const target = notificationTarget(current);
      if (target) {
        await queueNotificationWithAudit(tx, {
          recoveryCaseId: caseId,
          channel: target.channel,
          recipient: target.recipient,
          message: `Your payment was not completed. Use this secure recovery link: ${link.short_url}`,
        });
      }
      return updated;
    });
  } catch (error) {
    try {
      await (dependencies.cancelLink ?? cancelPaymentLink)(link.id);
    } catch {
      // Cancellation is best effort; the link was not persisted locally.
    }
    return recordProviderFailure(caseId, error, env.MAX_RECOVERY_ATTEMPTS);
  }

  if (!persisted) {
    try {
      await (dependencies.cancelLink ?? cancelPaymentLink)(link.id);
    } catch {
      // The case remains stopped; cancellation is best effort and no new action is persisted.
    }
    const current = await prisma.recoveryCase.findUniqueOrThrow({ where: { id: caseId } });
    return {
      caseId,
      outcome: "stopped",
      status: statusOf(current.status),
      duplicate: true,
    };
  }

  return {
    caseId,
    outcome: "payment_link_created",
    status: statusOf(persisted.status),
    duplicate: false,
    simulated: Boolean(link.simulated),
  };
}

export async function cancelRecoveryLinkAfterCapture(caseId: string): Promise<void> {
  const recoveryCase = await prisma.recoveryCase.findUnique({ where: { id: caseId } });
  if (
    !recoveryCase ||
    recoveryCase.status !== RecoveryStatus.closed ||
    !recoveryCase.paymentLinkId
  ) {
    return;
  }
  try {
    await cancelPaymentLink(recoveryCase.paymentLinkId);
  } catch (error) {
    const category =
      error instanceof RazorpayProviderError ? error.category : "provider";
    await prisma.auditEvent.create({
      data: auditData(
        caseId,
        AuditEventType.provider_error,
        "Payment Link cancellation failed after late capture",
        { category, operation: "cancel_payment_link" }
      ),
    });
  }
}
