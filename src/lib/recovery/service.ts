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
import { transition, isTerminal } from "@/lib/recovery/state-machine";

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

export async function resetDemoData(): Promise<void> {
  await prisma.$transaction([
    prisma.auditEvent.deleteMany(),
    prisma.notificationOutbox.deleteMany(),
    prisma.webhookReceipt.deleteMany(),
    prisma.recoveryCase.deleteMany(),
  ]);
}