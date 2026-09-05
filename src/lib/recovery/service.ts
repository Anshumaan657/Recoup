import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";
import {
  RecoveryCase,
  AuditEvent,
  WebhookReceipt,
  NotificationOutbox,
  RecoveryStatus,
  RecoveryAction,
  AuditEventType,
  RecoveryCaseWithTimeline,
  ListCasesOptions,
  PaginatedResult,
} from "@/types/domain";
import { transition, isTerminal, applyLateCapture } from "@/lib/recovery/state-machine";
import { getServerEnv } from "@/lib/validation/env";

function toRecoveryStatus(s: string): RecoveryStatus {
  return s as RecoveryStatus;
}

function toRecoveryAction(s: string | null): RecoveryAction | null {
  return s as RecoveryAction | null;
}

function toAuditEventType(s: string): AuditEventType {
  return s as AuditEventType;
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

function mapAuditEvent(ae: {
  id: string;
  recoveryCaseId: string;
  eventType: string;
  message: string;
  metadata: string;
  createdAt: Date;
}): AuditEvent {
  return {
    ...ae,
    eventType: toAuditEventType(ae.eventType),
    metadata: JSON.parse(ae.metadata) as Record<string, unknown>,
  };
}

function mapRecoveryCaseWithTimeline(rc: {
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
  auditEvents: Array<{
    id: string;
    recoveryCaseId: string;
    eventType: string;
    message: string;
    metadata: string;
    createdAt: Date;
  }>;
}): RecoveryCaseWithTimeline {
  return {
    ...mapRecoveryCase(rc),
    auditEvents: rc.auditEvents.map(mapAuditEvent),
  };
}

export async function createRecoveryCaseWithAudit(
  data: Omit<RecoveryCase, "id" | "createdAt" | "updatedAt">,
  auditEvents: Array<Omit<AuditEvent, "id" | "recoveryCaseId" | "createdAt">>
): Promise<RecoveryCase> {
  return prisma.$transaction(async (tx) => {
    const recoveryCase = await tx.recoveryCase.create({
      data: {
        ...data,
        status: data.status,
        selectedAction: data.selectedAction ?? null,
      },
    });
    await tx.auditEvent.createMany({
      data: auditEvents.map((ae) => ({
        ...ae,
        recoveryCaseId: recoveryCase.id,
        eventType: ae.eventType,
        metadata: JSON.stringify(ae.metadata),
      })),
    });
    return mapRecoveryCase(recoveryCase);
  });
}

export async function appendAuditEvent(
  recoveryCaseId: string,
  event: Omit<AuditEvent, "id" | "recoveryCaseId" | "createdAt">
): Promise<AuditEvent> {
  const created = await prisma.auditEvent.create({
    data: {
      ...event,
      recoveryCaseId,
      eventType: event.eventType,
      metadata: JSON.stringify(event.metadata),
    },
  });
  return mapAuditEvent(created);
}

export async function getRecoveryCaseWithTimeline(
  id: string
): Promise<RecoveryCaseWithTimeline | null> {
  const recoveryCase = await prisma.recoveryCase.findUnique({
    where: { id },
    include: {
      auditEvents: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!recoveryCase) return null;
  return mapRecoveryCaseWithTimeline(recoveryCase);
}

export async function getRecoveryCaseByOriginalPaymentId(
  originalPaymentId: string
): Promise<RecoveryCase | null> {
  const rc = await prisma.recoveryCase.findUnique({
    where: { originalPaymentId },
  });
  if (!rc) return null;
  return mapRecoveryCase(rc);
}

export async function listRecoveryCases(
  options: ListCasesOptions = {}
): Promise<PaginatedResult<RecoveryCase>> {
  const { status, action, limit = 50, offset = 0 } = options;
  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (action) where.selectedAction = action;

  const [data, total] = await Promise.all([
    prisma.recoveryCase.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.recoveryCase.count({ where }),
  ]);

  return { data: data.map(mapRecoveryCase), total, limit, offset };
}

export async function updateRecoveryCaseStatus(
  id: string,
  newStatus: RecoveryStatus,
  action?: RecoveryAction,
  additionalData: Record<string, unknown> = {}
): Promise<RecoveryCase> {
  const existing = await prisma.recoveryCase.findUnique({ where: { id } });
  if (!existing) throw new Error(`Recovery case ${id} not found`);

  if (isTerminal(toRecoveryStatus(existing.status))) {
    throw new Error(`Cannot transition from terminal state ${existing.status}`);
  }

  const validatedStatus = transition(toRecoveryStatus(existing.status), newStatus, action);
  if (validatedStatus !== newStatus) {
    throw new Error(`Invalid transition from ${existing.status} to ${newStatus}`);
  }

  const updated = await prisma.recoveryCase.update({
    where: { id },
    data: {
      status: newStatus,
      selectedAction: action ?? existing.selectedAction,
      ...additionalData,
    },
  });
  return mapRecoveryCase(updated);
}

export async function incrementAttemptCount(
  id: string
): Promise<RecoveryCase> {
  const updated = await prisma.recoveryCase.update({
    where: { id },
    data: { attemptCount: { increment: 1 } },
  });
  return mapRecoveryCase(updated);
}

export async function createWebhookReceipt(
  eventKey: string,
  providerEvent: string,
  payloadHash: string,
  outcome: string
): Promise<WebhookReceipt> {
  return prisma.webhookReceipt.create({
    data: { eventKey, providerEvent, payloadHash, outcome },
  });
}

export async function findWebhookReceiptByEventKey(
  eventKey: string
): Promise<WebhookReceipt | null> {
  return prisma.webhookReceipt.findUnique({ where: { eventKey } });
}

export async function updateWebhookReceiptOutcome(
  id: string,
  outcome: string
): Promise<WebhookReceipt> {
  return prisma.webhookReceipt.update({
    where: { id },
    data: { outcome },
  });
}

export async function queueNotification(
  data: Omit<NotificationOutbox, "id" | "createdAt" | "sentAt">
): Promise<NotificationOutbox> {
  return prisma.notificationOutbox.create({ data });
}

export async function markNotificationSent(
  id: string,
  providerReference: string
): Promise<NotificationOutbox> {
  return prisma.notificationOutbox.update({
    where: { id },
    data: { status: "sent", providerReference, sentAt: new Date() },
  });
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function handlePaymentFailedInTransaction(
  payload: { payment: Record<string, unknown> },
  rawBody: Buffer,
  eventKey: string,
  providerEvent: string,
  payloadHash: string
): Promise<{ outcome: string; caseId?: string; isDuplicate: boolean }> {
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.webhookReceipt.create({
      data: { eventKey, providerEvent, payloadHash, outcome: "processing" },
    });

    try {
      const payment = payload.payment as Record<string, unknown>;
      const originalPaymentId = String(payment.id);
      const orderId = String(payment.order_id);
      const amount = Number(payment.amount);
      const currency = String(payment.currency);
      const customerName = null;
      const customerEmail = payment.email ? String(payment.email) : null;
      const customerContact = payment.contact ? String(payment.contact) : null;
      const paymentMethod = payment.method ? String(payment.method) : null;
      const failureCode = payment.error_code ? String(payment.error_code) : null;
      const errorDescription = payment.error_description
        ? String(payment.error_description)
        : null;
      const failureReason = payment.error_reason ? String(payment.error_reason)
        : errorDescription;
      const failureSource = payment.error_source ? String(payment.error_source) : null;
      const failureStep = payment.error_step ? String(payment.error_step) : null;

      const env = getServerEnv();
      const graceExpiresAt = new Date(Date.now() + env.RECOVERY_GRACE_SECONDS * 1000);

      const existingCase = await tx.recoveryCase.findUnique({ where: { originalPaymentId } });
      if (existingCase) {
        await tx.webhookReceipt.update({
          where: { id: receipt.id },
          data: { outcome: "duplicate" },
        });
        return { outcome: "duplicate", caseId: existingCase.id, isDuplicate: true };
      }

      const recoveryCase = await tx.recoveryCase.create({
        data: {
          originalPaymentId,
          orderId,
          amount,
          currency,
          customerName,
          customerEmail,
          customerContact,
          paymentMethod,
          failureCode,
          failureReason,
          failureSource,
          failureStep,
          attemptCount: 0,
          status: RecoveryStatus.waiting,
          selectedAction: null,
          decisionReason: null,
          confidence: null,
          requiresApproval: false,
          graceExpiresAt,
          paymentLinkId: null,
          paymentLinkUrl: null,
          paymentLinkExpiry: null,
          recoveredAmount: null,
          recoveredAt: null,
          stoppedReason: null,
        },
      });

      await tx.auditEvent.createMany({
        data: [
          {
            recoveryCaseId: recoveryCase.id,
            eventType: AuditEventType.payment_failed_received,
            message: `Payment failed: ${errorDescription ?? "Unknown reason"}`,
            metadata: JSON.stringify({
              failureCode,
              errorDescription,
              failureSource,
              failureStep,
              eventKey,
              rawBodyHash: sha256(rawBody),
            }),
          },
          {
            recoveryCaseId: recoveryCase.id,
            eventType: AuditEventType.grace_started,
            message: `Grace period started, expires at ${graceExpiresAt.toISOString()}`,
            metadata: JSON.stringify({ graceSeconds: env.RECOVERY_GRACE_SECONDS }),
          },
        ],
      });

      await tx.webhookReceipt.update({
        where: { id: receipt.id },
        data: { outcome: "created" },
      });

      return { outcome: "created", caseId: recoveryCase.id, isDuplicate: false };
    } catch (error) {
      await tx.webhookReceipt.update({
        where: { id: receipt.id },
        data: { outcome: "error" },
      });
      throw error;
    }
  });
}

export async function handlePaymentCapturedInTransaction(
  payload: { payment: Record<string, unknown> },
  eventKey: string,
  providerEvent: string,
  payloadHash: string
): Promise<{ outcome: string; caseId?: string; isDuplicate: boolean }> {
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.webhookReceipt.create({
      data: { eventKey, providerEvent, payloadHash, outcome: "processing" },
    });

    try {
      const payment = payload.payment as Record<string, unknown>;
      const originalPaymentId = String(payment.id);
      const orderId = String(payment.order_id);
      const amount = Number(payment.amount);
      const currency = String(payment.currency);

      const existingCase = await tx.recoveryCase.findUnique({ where: { originalPaymentId } });
      if (!existingCase) {
        const closedCase = await tx.recoveryCase.create({
          data: {
            originalPaymentId,
            orderId,
            amount,
            currency,
            customerName: null,
            customerEmail: null,
            customerContact: null,
            paymentMethod: null,
            failureCode: null,
            failureReason: null,
            failureSource: null,
            failureStep: null,
            attemptCount: 0,
            status: RecoveryStatus.closed,
            selectedAction: null,
            decisionReason: null,
            confidence: null,
            requiresApproval: false,
            graceExpiresAt: null,
            paymentLinkId: null,
            paymentLinkUrl: null,
            paymentLinkExpiry: null,
            recoveredAmount: null,
            recoveredAt: null,
            stoppedReason: "late_capture",
          },
        });

        await tx.auditEvent.createMany({
          data: [
            {
              recoveryCaseId: closedCase.id,
              eventType: AuditEventType.late_capture_received,
              message: "Late capture received before failure event, case closed",
              metadata: JSON.stringify({ eventKey, capturedAt: new Date().toISOString() }),
            },
            {
              recoveryCaseId: closedCase.id,
              eventType: AuditEventType.recovery_stopped,
              message: "Recovery stopped due to late capture",
              metadata: JSON.stringify({ stoppedReason: "late_capture", eventKey }),
            },
          ],
        });

        await tx.webhookReceipt.update({
          where: { id: receipt.id },
          data: { outcome: "closed" },
        });

        return { outcome: "closed", caseId: closedCase.id, isDuplicate: false };
      }

      if (isTerminal(toRecoveryStatus(existingCase.status))) {
        await tx.webhookReceipt.update({
          where: { id: receipt.id },
          data: { outcome: "duplicate" },
        });
        return { outcome: "duplicate", caseId: existingCase.id, isDuplicate: true };
      }

      const lateCaptureStatus = applyLateCapture(toRecoveryStatus(existingCase.status));
      if (!lateCaptureStatus) {
        await tx.webhookReceipt.update({
          where: { id: receipt.id },
          data: { outcome: "ignored_no_case" },
        });
        return { outcome: "ignored_no_case", caseId: existingCase.id, isDuplicate: false };
      }

      const updatedCase = await tx.recoveryCase.update({
        where: { id: existingCase.id },
        data: {
          status: lateCaptureStatus,
          stoppedReason: "late_capture",
        },
      });

      await tx.notificationOutbox.updateMany({
        where: {
          recoveryCaseId: updatedCase.id,
          status: "pending",
        },
        data: { status: "cancelled" },
      });

      await tx.auditEvent.createMany({
        data: [
          {
            recoveryCaseId: updatedCase.id,
            eventType: AuditEventType.late_capture_received,
            message: "Late capture received, stopping recovery",
            metadata: JSON.stringify({ eventKey, capturedAt: new Date().toISOString() }),
          },
          {
            recoveryCaseId: updatedCase.id,
            eventType: AuditEventType.recovery_stopped,
            message: "Recovery stopped due to late capture",
            metadata: JSON.stringify({ stoppedReason: "late_capture", eventKey }),
          },
        ],
      });

      await tx.webhookReceipt.update({
        where: { id: receipt.id },
        data: { outcome: "closed" },
      });

      return { outcome: "closed", caseId: updatedCase.id, isDuplicate: false };
    } catch (error) {
      await tx.webhookReceipt.update({
        where: { id: receipt.id },
        data: { outcome: "error" },
      });
      throw error;
    }
  });
}

export async function handlePaymentLinkPaidInTransaction(
  payload: { payment_link: Record<string, unknown> },
  eventKey: string,
  providerEvent: string,
  payloadHash: string
): Promise<{ outcome: string; caseId?: string; isDuplicate: boolean }> {
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.webhookReceipt.create({
      data: { eventKey, providerEvent, payloadHash, outcome: "processing" },
    });

    try {
      const paymentLink = payload.payment_link as Record<string, unknown>;
      const paymentLinkId = String(paymentLink.id);
      const notes = (paymentLink.notes as Record<string, string>) ?? {};
      const recoveryCaseId = notes.recovery_case_id;

      if (!recoveryCaseId) {
        await tx.webhookReceipt.update({
          where: { id: receipt.id },
          data: { outcome: "ignored_unknown_payment_link" },
        });
        return { outcome: "ignored_unknown_payment_link", caseId: undefined, isDuplicate: false };
      }

      const existingCase = await tx.recoveryCase.findUnique({ where: { id: recoveryCaseId } });
      if (!existingCase) {
        await tx.webhookReceipt.update({
          where: { id: receipt.id },
          data: { outcome: "ignored_unknown_payment_link" },
        });
        return { outcome: "ignored_unknown_payment_link", caseId: undefined, isDuplicate: false };
      }

      if (
        existingCase.status === RecoveryStatus.recovered ||
        existingCase.status === RecoveryStatus.closed
      ) {
        await tx.webhookReceipt.update({
          where: { id: receipt.id },
          data: { outcome: "duplicate" },
        });
        return { outcome: "duplicate", caseId: existingCase.id, isDuplicate: true };
      }

      if (existingCase.paymentLinkId && existingCase.paymentLinkId !== paymentLinkId) {
        await tx.recoveryCase.update({
          where: { id: existingCase.id },
          data: {
            status: RecoveryStatus.manual_review,
            selectedAction: RecoveryAction.manual_review,
            requiresApproval: true,
            decisionReason: "Payment link identifier mismatch",
          },
        });
        await tx.auditEvent.createMany({
          data: [
            {
              recoveryCaseId: existingCase.id,
              eventType: AuditEventType.provider_error,
              message: "Payment link identifier mismatch",
              metadata: JSON.stringify({
                expectedPaymentLinkId: existingCase.paymentLinkId,
                receivedPaymentLinkId: paymentLinkId,
                eventKey,
              }),
            },
            {
              recoveryCaseId: existingCase.id,
              eventType: AuditEventType.manual_review_requested,
              message: "Manual review required for payment link identifier mismatch",
              metadata: JSON.stringify({ reason: "payment_link_id_mismatch", eventKey }),
            },
          ],
        });
        await tx.webhookReceipt.update({
          where: { id: receipt.id },
          data: { outcome: "payment_link_id_mismatch" },
        });
        return {
          outcome: "payment_link_id_mismatch",
          caseId: existingCase.id,
          isDuplicate: false,
        };
      }

      const webhookAmount = paymentLink.amount ? Number(paymentLink.amount) : null;
      const webhookCurrency = paymentLink.currency ? String(paymentLink.currency) : null;

      if (webhookAmount === null || webhookAmount !== existingCase.amount) {
        await tx.recoveryCase.update({
          where: { id: existingCase.id },
          data: {
            status: RecoveryStatus.manual_review,
            selectedAction: RecoveryAction.manual_review,
            requiresApproval: true,
            decisionReason: "Payment link amount mismatch",
          },
        });
        await tx.webhookReceipt.update({
          where: { id: receipt.id },
          data: { outcome: "amount_mismatch" },
        });
        await tx.auditEvent.createMany({
          data: [
            {
              recoveryCaseId: existingCase.id,
              eventType: AuditEventType.provider_error,
              message: "Payment link amount mismatch",
              metadata: JSON.stringify({
                expectedAmount: existingCase.amount,
                receivedAmount: webhookAmount,
                eventKey,
              }),
            },
            {
              recoveryCaseId: existingCase.id,
              eventType: AuditEventType.manual_review_requested,
              message: "Manual review required for payment link amount mismatch",
              metadata: JSON.stringify({ reason: "amount_mismatch", eventKey }),
            },
          ],
        });
        return { outcome: "amount_mismatch", caseId: existingCase.id, isDuplicate: false };
      }

      if (webhookCurrency === null || webhookCurrency !== existingCase.currency) {
        await tx.recoveryCase.update({
          where: { id: existingCase.id },
          data: {
            status: RecoveryStatus.manual_review,
            selectedAction: RecoveryAction.manual_review,
            requiresApproval: true,
            decisionReason: "Payment link currency mismatch",
          },
        });
        await tx.webhookReceipt.update({
          where: { id: receipt.id },
          data: { outcome: "currency_mismatch" },
        });
        await tx.auditEvent.createMany({
          data: [
            {
              recoveryCaseId: existingCase.id,
              eventType: AuditEventType.provider_error,
              message: "Payment link currency mismatch",
              metadata: JSON.stringify({
                expectedCurrency: existingCase.currency,
                receivedCurrency: webhookCurrency,
                eventKey,
              }),
            },
            {
              recoveryCaseId: existingCase.id,
              eventType: AuditEventType.manual_review_requested,
              message: "Manual review required for payment link currency mismatch",
              metadata: JSON.stringify({ reason: "currency_mismatch", eventKey }),
            },
          ],
        });
        return { outcome: "currency_mismatch", caseId: existingCase.id, isDuplicate: false };
      }

      const updatedCase = await tx.recoveryCase.update({
        where: { id: existingCase.id },
        data: {
          status: RecoveryStatus.recovered,
          recoveredAmount: existingCase.amount,
          recoveredAt: new Date(),
          paymentLinkId,
        },
      });

      await tx.auditEvent.create({
        data: {
          recoveryCaseId: updatedCase.id,
          eventType: AuditEventType.recovery_succeeded,
          message: "Recovery succeeded via payment link",
          metadata: JSON.stringify({ paymentLinkId, amount: existingCase.amount, eventKey }),
        },
      });

      await tx.webhookReceipt.update({
        where: { id: receipt.id },
        data: { outcome: "recovered" },
      });

      return { outcome: "recovered", caseId: updatedCase.id, isDuplicate: false };
    } catch (error) {
      await tx.webhookReceipt.update({
        where: { id: receipt.id },
        data: { outcome: "error" },
      });
      throw error;
    }
  });
}

export async function resetDemoData(): Promise<void> {
  await prisma.$transaction([
    prisma.auditEvent.deleteMany(),
    prisma.notificationOutbox.deleteMany(),
    prisma.webhookReceipt.deleteMany(),
    prisma.recoveryCase.deleteMany(),
  ]);
}
