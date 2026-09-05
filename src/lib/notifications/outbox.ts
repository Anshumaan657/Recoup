import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { AuditEventType, NotificationOutbox } from "@/types/domain";

type DbClient = Prisma.TransactionClient | PrismaClient;

export interface NotificationParams {
  recoveryCaseId: string;
  channel: "email" | "sms";
  recipient: string;
  message: string;
}

export function sanitizeCustomerMessage(message: string): string {
  const normalized = message
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  if (!normalized) throw new Error("Notification message cannot be empty");
  if (/\b(pin|otp|cvv|password|card\s*number)\b/i.test(normalized)) {
    throw new Error("Notification message contains prohibited sensitive wording");
  }
  return normalized;
}

export async function queueNotificationWithAudit(
  db: DbClient,
  params: NotificationParams
): Promise<NotificationOutbox> {
  const message = sanitizeCustomerMessage(params.message);
  const notification = await db.notificationOutbox.create({
    data: {
      recoveryCaseId: params.recoveryCaseId,
      channel: params.channel,
      recipient: params.recipient,
      message,
      status: "pending",
    },
  });
  await db.auditEvent.create({
    data: {
      recoveryCaseId: params.recoveryCaseId,
      eventType: AuditEventType.notification_queued,
      message: `Notification queued via ${params.channel}`,
      metadata: JSON.stringify({
        channel: params.channel,
        notificationId: notification.id,
      }),
    },
  });
  return notification as NotificationOutbox;
}

export async function queueNotification(
  params: NotificationParams
): Promise<NotificationOutbox> {
  try {
    return await prisma.$transaction((tx) =>
      queueNotificationWithAudit(tx, params)
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.notificationOutbox.findUnique({
        where: { recoveryCaseId: params.recoveryCaseId },
      });
      if (existing) return existing as NotificationOutbox;
    }
    throw error;
  }
}

export async function queueSingleNotificationIfNotExists(
  recoveryCaseId: string,
  channel: "email" | "sms",
  message: string
): Promise<NotificationOutbox | null> {
  const recoveryCase = await prisma.recoveryCase.findUnique({
    where: { id: recoveryCaseId },
    select: { customerEmail: true, customerContact: true },
  });
  if (!recoveryCase) return null;
  const recipient =
    channel === "email" ? recoveryCase.customerEmail : recoveryCase.customerContact;
  if (!recipient) return null;
  return queueNotification({ recoveryCaseId, channel, recipient, message });
}

export async function markNotificationSent(
  id: string,
  providerReference: string
): Promise<NotificationOutbox> {
  return prisma.notificationOutbox.update({
    where: { id },
    data: { status: "sent", providerReference, sentAt: new Date() },
  }) as Promise<NotificationOutbox>;
}
