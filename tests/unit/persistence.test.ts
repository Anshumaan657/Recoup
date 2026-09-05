import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createRecoveryCaseWithAudit,
  appendAuditEvent,
  getRecoveryCaseWithTimeline,
  getRecoveryCaseByOriginalPaymentId,
  listRecoveryCases,
  updateRecoveryCaseStatus,
  incrementAttemptCount,
  createWebhookReceipt,
  findWebhookReceiptByEventKey,
  queueNotification,
  markNotificationSent,
  resetDemoData,
} from "@/lib/recovery/service";
import { RecoveryStatus, RecoveryAction, AuditEventType } from "@/types/domain";
import {
  assertSafeTestDatabaseUrl,
  TEST_DATABASE_URL,
} from "../test-database";

const prisma = new PrismaClient({
  datasources: { db: { url: TEST_DATABASE_URL } },
});

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  assertSafeTestDatabaseUrl();
  await prisma.auditEvent.deleteMany();
  await prisma.notificationOutbox.deleteMany();
  await prisma.webhookReceipt.deleteMany();
  await prisma.recoveryCase.deleteMany();
});

function createBaseCaseData(overrides: Partial<{
  originalPaymentId: string;
  orderId: string;
  amount: number;
  customerName: string;
  customerEmail: string;
  customerContact: string;
  paymentMethod: string;
  failureCode: string;
  failureReason: string;
  failureSource: string;
  failureStep: string;
  status: RecoveryStatus;
  graceExpiresAt: Date;
  requiresApproval: boolean;
  selectedAction: RecoveryAction | null;
  decisionReason: string | null;
  confidence: number | null;
  paymentLinkId: string | null;
  paymentLinkUrl: string | null;
  paymentLinkExpiry: Date | null;
  recoveredAmount: number | null;
  recoveredAt: Date | null;
  stoppedReason: string | null;
}> = {}) {
  const now = new Date();
  return {
    originalPaymentId: overrides.originalPaymentId ?? "pay_test_001",
    orderId: overrides.orderId ?? "order_INR_10000",
    amount: overrides.amount ?? 10000,
    currency: "INR",
    customerName: overrides.customerName ?? "Test User",
    customerEmail: overrides.customerEmail ?? "test@example.com",
    customerContact: overrides.customerContact ?? "+919999999999",
    paymentMethod: overrides.paymentMethod ?? "upi",
    failureCode: overrides.failureCode ?? "TEST_CODE",
    failureReason: overrides.failureReason ?? "Test failure",
    failureSource: overrides.failureSource ?? "test",
    failureStep: overrides.failureStep ?? "test_step",
    attemptCount: 0,
    status: overrides.status ?? RecoveryStatus.waiting,
    selectedAction: overrides.selectedAction ?? null,
    decisionReason: overrides.decisionReason ?? null,
    confidence: overrides.confidence ?? null,
    requiresApproval: overrides.requiresApproval ?? false,
    graceExpiresAt: overrides.graceExpiresAt ?? new Date(now.getTime() + 90000),
    paymentLinkId: overrides.paymentLinkId ?? null,
    paymentLinkUrl: overrides.paymentLinkUrl ?? null,
    paymentLinkExpiry: overrides.paymentLinkExpiry ?? null,
    recoveredAmount: overrides.recoveredAmount ?? null,
    recoveredAt: overrides.recoveredAt ?? null,
    stoppedReason: overrides.stoppedReason ?? null,
  };
}

describe("Persistence Layer", () => {
  describe("createRecoveryCaseWithAudit", () => {
    it("creates case and audit events transactionally", async () => {
      const caseData = createBaseCaseData({ originalPaymentId: "pay_test_unique_001" });
      const auditEvents = [
        {
          eventType: AuditEventType.payment_failed_received,
          message: "Payment failed",
          metadata: { code: "TEST_CODE" },
        },
        {
          eventType: AuditEventType.grace_started,
          message: "Grace started",
          metadata: { seconds: 90 },
        },
      ];

      const created = await createRecoveryCaseWithAudit(caseData, auditEvents);

      expect(created.id).toBeDefined();
      expect(created.originalPaymentId).toBe("pay_test_unique_001");
      expect(created.amount).toBe(10000);

      const withTimeline = await getRecoveryCaseWithTimeline(created.id);
      expect(withTimeline).not.toBeNull();
      expect(withTimeline!.auditEvents).toHaveLength(2);
      expect(withTimeline!.auditEvents[0].eventType).toBe(AuditEventType.payment_failed_received);
      expect(withTimeline!.auditEvents[1].eventType).toBe(AuditEventType.grace_started);
    });

    it("enforces unique originalPaymentId", async () => {
      const caseData = createBaseCaseData({ originalPaymentId: "pay_test_duplicate_001" });

      await createRecoveryCaseWithAudit(caseData, []);

      await expect(createRecoveryCaseWithAudit(caseData, [])).rejects.toThrow();
    });
  });

  describe("appendAuditEvent", () => {
    it("appends audit event to existing case", async () => {
      const created = await createRecoveryCaseWithAudit(
        createBaseCaseData({ originalPaymentId: "pay_test_append_001" }),
        []
      );

      await appendAuditEvent(created.id, {
        eventType: AuditEventType.decision_created,
        message: "Decision created",
        metadata: { action: "create_payment_link" },
      });

      const withTimeline = await getRecoveryCaseWithTimeline(created.id);
      expect(withTimeline!.auditEvents).toHaveLength(1);
      expect(withTimeline!.auditEvents[0].eventType).toBe(AuditEventType.decision_created);
    });
  });

  describe("getRecoveryCaseByOriginalPaymentId", () => {
    it("finds case by originalPaymentId", async () => {
      await createRecoveryCaseWithAudit(
        createBaseCaseData({ originalPaymentId: "pay_test_find_001" }),
        []
      );

      const found = await getRecoveryCaseByOriginalPaymentId("pay_test_find_001");
      expect(found).not.toBeNull();
      expect(found!.originalPaymentId).toBe("pay_test_find_001");
    });

    it("returns null for non-existent payment ID", async () => {
      const found = await getRecoveryCaseByOriginalPaymentId("pay_nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("listRecoveryCases", () => {
    it("returns cases in newest-first order", async () => {
      await createRecoveryCaseWithAudit(
        createBaseCaseData({ originalPaymentId: "pay_test_list_001" }),
        []
      );

      await new Promise((r) => setTimeout(r, 10));

      await createRecoveryCaseWithAudit(
        createBaseCaseData({
          originalPaymentId: "pay_test_list_002",
          orderId: "order_INR_20000",
          amount: 20000,
          customerName: "Test User 2",
          customerEmail: "test2@example.com",
          customerContact: "+919999999998",
          paymentMethod: "card",
          failureCode: "TEST_CODE2",
          failureReason: "Test failure 2",
        }),
        []
      );

      const result = await listRecoveryCases({ limit: 10 });
      expect(result.data).toHaveLength(2);
      expect(result.data[0].originalPaymentId).toBe("pay_test_list_002");
      expect(result.data[1].originalPaymentId).toBe("pay_test_list_001");
    });

    it("filters by status", async () => {
      await createRecoveryCaseWithAudit(
        createBaseCaseData({ originalPaymentId: "pay_test_filter_001" }),
        []
      );

      const created = await getRecoveryCaseByOriginalPaymentId("pay_test_filter_001");
      if (created) {
        await updateRecoveryCaseStatus(created.id, RecoveryStatus.eligible);
      }

      const waiting = await listRecoveryCases({ status: RecoveryStatus.waiting });
      const eligible = await listRecoveryCases({ status: RecoveryStatus.eligible });

      expect(waiting.data).toHaveLength(0);
      expect(eligible.data).toHaveLength(1);
    });

    it("supports pagination", async () => {
      for (let i = 0; i < 5; i++) {
        await createRecoveryCaseWithAudit(
          createBaseCaseData({
            originalPaymentId: `pay_test_page_${i}`,
            orderId: `order_INR_${i}`,
          }),
          []
        );
      }

      const page1 = await listRecoveryCases({ limit: 2, offset: 0 });
      const page2 = await listRecoveryCases({ limit: 2, offset: 2 });

      expect(page1.data).toHaveLength(2);
      expect(page2.data).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page2.total).toBe(5);
    });
  });

  describe("updateRecoveryCaseStatus", () => {
    it("updates status and action", async () => {
      const created = await createRecoveryCaseWithAudit(
        createBaseCaseData({ originalPaymentId: "pay_test_update_001" }),
        []
      );

      const updated = await updateRecoveryCaseStatus(
        created.id,
        RecoveryStatus.eligible,
        RecoveryAction.retry_later
      );

      expect(updated.status).toBe(RecoveryStatus.eligible);
      expect(updated.selectedAction).toBe(RecoveryAction.retry_later);
    });

    it("throws on terminal state transition", async () => {
      const created = await createRecoveryCaseWithAudit(
        createBaseCaseData({
          originalPaymentId: "pay_test_terminal_001",
          status: RecoveryStatus.recovered,
          recoveredAmount: 10000,
          recoveredAt: new Date(),
        }),
        []
      );

      await expect(
        updateRecoveryCaseStatus(created.id, RecoveryStatus.closed)
      ).rejects.toThrow("Cannot transition from terminal state");
    });

    it("throws on invalid transition", async () => {
      const created = await createRecoveryCaseWithAudit(
        createBaseCaseData({ originalPaymentId: "pay_test_invalid_001" }),
        []
      );

      await expect(
        updateRecoveryCaseStatus(created.id, RecoveryStatus.contacted)
      ).rejects.toThrow("Invalid transition");
    });
  });

  describe("incrementAttemptCount", () => {
    it("increments attempt count", async () => {
      const created = await createRecoveryCaseWithAudit(
        createBaseCaseData({ originalPaymentId: "pay_test_attempt_001" }),
        []
      );

      const updated = await incrementAttemptCount(created.id);
      expect(updated.attemptCount).toBe(1);

      const updated2 = await incrementAttemptCount(created.id);
      expect(updated2.attemptCount).toBe(2);
    });
  });

  describe("WebhookReceipt idempotency", () => {
    it("creates webhook receipt", async () => {
      const receipt = await createWebhookReceipt(
        "evt_test_001",
        "payment.failed",
        "hash123",
        "created"
      );

      expect(receipt.eventKey).toBe("evt_test_001");
      expect(receipt.providerEvent).toBe("payment.failed");
      expect(receipt.payloadHash).toBe("hash123");
      expect(receipt.outcome).toBe("created");
    });

    it("enforces unique eventKey", async () => {
      await createWebhookReceipt("evt_test_002", "payment.failed", "hash123", "created");
      await expect(
        createWebhookReceipt("evt_test_002", "payment.failed", "hash456", "duplicate")
      ).rejects.toThrow();
    });

    it("finds existing receipt by eventKey", async () => {
      await createWebhookReceipt("evt_test_003", "payment.failed", "hash123", "created");
      const found = await findWebhookReceiptByEventKey("evt_test_003");
      expect(found).not.toBeNull();
      expect(found!.outcome).toBe("created");
    });
  });

  describe("NotificationOutbox", () => {
    it("queues notification", async () => {
      const created = await createRecoveryCaseWithAudit(
        createBaseCaseData({ originalPaymentId: "pay_test_notif_001" }),
        []
      );

      const notif = await queueNotification({
        recoveryCaseId: created.id,
        channel: "email",
        recipient: "test@example.com",
        message: "Your payment failed",
        status: "pending",
        providerReference: null,
      });

      expect(notif.id).toBeDefined();
      expect(notif.recoveryCaseId).toBe(created.id);
      expect(notif.status).toBe("pending");
    });

    it("marks notification as sent", async () => {
      const created = await createRecoveryCaseWithAudit(
        createBaseCaseData({ originalPaymentId: "pay_test_notif_002" }),
        []
      );

      const notif = await queueNotification({
        recoveryCaseId: created.id,
        channel: "email",
        recipient: "test@example.com",
        message: "Your payment failed",
        status: "pending",
        providerReference: null,
      });

      const sent = await markNotificationSent(notif.id, "provider_ref_123");
      expect(sent.status).toBe("sent");
      expect(sent.providerReference).toBe("provider_ref_123");
      expect(sent.sentAt).not.toBeNull();
    });
  });

  describe("resetDemoData", () => {
    it("deletes all demo data", async () => {
      await createRecoveryCaseWithAudit(
        createBaseCaseData({ originalPaymentId: "pay_test_reset_001" }),
        [
          {
            eventType: AuditEventType.payment_failed_received,
            message: "Payment failed",
            metadata: {},
          },
        ]
      );

      await resetDemoData();

      const cases = await prisma.recoveryCase.findMany();
      const audits = await prisma.auditEvent.findMany();
      const receipts = await prisma.webhookReceipt.findMany();
      const notifs = await prisma.notificationOutbox.findMany();

      expect(cases).toHaveLength(0);
      expect(audits).toHaveLength(0);
      expect(receipts).toHaveLength(0);
      expect(notifs).toHaveLength(0);
    });
  });

  describe("Paise-only amount handling", () => {
    it("stores amounts as integer paise", async () => {
      const created = await createRecoveryCaseWithAudit(
        createBaseCaseData({
          originalPaymentId: "pay_test_paise_001",
          orderId: "order_INR_12345",
          amount: 12345,
        }),
        []
      );

      expect(created.amount).toBe(12345);
      expect(typeof created.amount).toBe("number");
      expect(Number.isInteger(created.amount)).toBe(true);
    });
  });
});
