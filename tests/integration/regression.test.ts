import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";
import { POST } from "@/app/webhooks/razorpay/route";
import { generateRazorpaySignature } from "@/lib/razorpay/signatures";
import {
  findWebhookReceiptByEventKey,
  getRecoveryCaseByOriginalPaymentId,
  getRecoveryCaseWithTimeline,
  resetDemoData,
} from "@/lib/recovery/service";
import { AuditEventType, RecoveryStatus } from "@/types/domain";
import {
  assertSafeTestDatabaseUrl,
  TEST_DATABASE_URL,
  TEST_DB_PATH,
} from "../test-database";

const prisma = new PrismaClient();
const TEST_WEBHOOK_SECRET = "recoverai-test-only-webhook-secret";
const TRIGGERS = [
  "fail_payment_failed_audit",
  "fail_receipt_outcome_update",
  "fail_late_capture_audit",
] as const;

beforeAll(async () => {
  assertSafeTestDatabaseUrl();
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  assertSafeTestDatabaseUrl();
  for (const trigger of TRIGGERS) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger}`);
  }
  await resetDemoData();
});

function loadFixture(name: string): Buffer {
  return readFileSync(join(process.cwd(), "fixtures", "webhooks", `${name}.json`));
}

async function postWebhook(payload: Buffer, secret = TEST_WEBHOOK_SECRET) {
  const signature = generateRazorpaySignature(payload, secret);
  const request = new Request("http://localhost:3000/webhooks/razorpay", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": signature,
    },
    body: payload.toString("utf-8"),
  });

  return POST(request as unknown as import("next/server").NextRequest);
}

async function databaseCounts() {
  const [receipts, cases, audits] = await Promise.all([
    prisma.webhookReceipt.count(),
    prisma.recoveryCase.count(),
    prisma.auditEvent.count(),
  ]);
  return { receipts, cases, audits };
}

async function dropTrigger(name: (typeof TRIGGERS)[number]) {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name}`);
}

describe("Corrective hardening regressions", () => {
  describe("test database isolation", () => {
    it("uses the canonical migrated test database", async () => {
      expect(process.env.DATABASE_URL).toBe(TEST_DATABASE_URL);
      expect(assertSafeTestDatabaseUrl()).toBe(TEST_DB_PATH);

      const tables = await prisma.$queryRaw<{ name: string }[]>`
        SELECT name FROM sqlite_master WHERE type = 'table'
      `;
      const names = tables.map(({ name }) => name);
      expect(names).toContain("recovery_cases");
      expect(names).toContain("audit_events");
      expect(names).toContain("webhook_receipts");
      expect(names).toContain("notification_outbox");
    });

    it("refuses unsafe database URLs", () => {
      const originalUrl = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;
      try {
        expect(() => assertSafeTestDatabaseUrl()).toThrow("not set");
      } finally {
        process.env.DATABASE_URL = originalUrl;
      }
      expect(() => assertSafeTestDatabaseUrl("postgresql://localhost/recoup")).toThrow(
        "file: protocol"
      );
      expect(() => assertSafeTestDatabaseUrl("file:/tmp/dev.db")).toThrow("dev.db");
      expect(() => assertSafeTestDatabaseUrl("file:/tmp/other-test.db")).toThrow(
        "outside"
      );
      expect(assertSafeTestDatabaseUrl(TEST_DATABASE_URL)).toBe(TEST_DB_PATH);
    });
  });

  describe("idempotency keys", () => {
    it("uses a top-level evt_ id when present", async () => {
      const body = JSON.parse(loadFixture("payment-failed").toString("utf-8"));
      body.id = "evt_test_123";
      const response = await postWebhook(Buffer.from(JSON.stringify(body)));
      expect(response.status).toBe(200);

      const receipt = await findWebhookReceiptByEventKey("razorpay:event:evt_test_123");
      expect(receipt?.eventKey).toBe("razorpay:event:evt_test_123");
    });

    it("uses the documented fallback when event id is absent", async () => {
      const response = await postWebhook(loadFixture("payment-failed"));
      expect(response.status).toBe(200);

      const [receipt] = await prisma.webhookReceipt.findMany();
      expect(receipt.eventKey).toMatch(
        /^razorpay:payment\.failed:pay_test_insufficient_funds_001:\d+:[a-f0-9]{64}$/
      );
    });

    it("serializes two simultaneous duplicate deliveries", async () => {
      const payload = loadFixture("payment-failed");
      const [first, second] = await Promise.all([postWebhook(payload), postWebhook(payload)]);
      const bodies = await Promise.all([first.json(), second.json()]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(bodies.map((body) => body.duplicate).sort()).toEqual([false, true]);
      expect(await databaseCounts()).toEqual({ receipts: 1, cases: 1, audits: 2 });
    });
  });

  describe("transaction rollback", () => {
    it("rolls back a handler failure and permits a clean retry", async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER fail_payment_failed_audit
        BEFORE INSERT ON audit_events
        WHEN NEW.event_type = 'payment_failed_received'
        BEGIN
          SELECT RAISE(ABORT, 'injected payment audit failure');
        END
      `);

      const payload = loadFixture("payment-failed");
      try {
        const failed = await postWebhook(payload);
        expect(failed.status).toBe(500);
        expect(await databaseCounts()).toEqual({ receipts: 0, cases: 0, audits: 0 });
      } finally {
        await dropTrigger("fail_payment_failed_audit");
      }

      const retry = await postWebhook(payload);
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ status: "created", duplicate: false });
      expect(await databaseCounts()).toEqual({ receipts: 1, cases: 1, audits: 2 });
    });

    it("rolls back when the final receipt outcome cannot be stored", async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER fail_receipt_outcome_update
        BEFORE UPDATE OF outcome ON webhook_receipts
        WHEN OLD.outcome = 'processing'
        BEGIN
          SELECT RAISE(ABORT, 'injected receipt outcome failure');
        END
      `);

      const payload = loadFixture("payment-failed");
      try {
        const failed = await postWebhook(payload);
        expect(failed.status).toBe(500);
        expect(await databaseCounts()).toEqual({ receipts: 0, cases: 0, audits: 0 });
      } finally {
        await dropTrigger("fail_receipt_outcome_update");
      }

      const retry = await postWebhook(payload);
      expect(retry.status).toBe(200);
      expect(await databaseCounts()).toEqual({ receipts: 1, cases: 1, audits: 2 });
    });

    it("rolls back every late-capture mutation and then permits retry", async () => {
      const failure = loadFixture("payment-failed");
      const capture = loadFixture("payment-captured");
      await postWebhook(failure);

      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER fail_late_capture_audit
        BEFORE INSERT ON audit_events
        WHEN NEW.event_type = 'late_capture_received'
        BEGIN
          SELECT RAISE(ABORT, 'injected late capture audit failure');
        END
      `);

      try {
        const failed = await postWebhook(capture);
        expect(failed.status).toBe(500);
        const unchanged = await getRecoveryCaseByOriginalPaymentId(
          "pay_test_insufficient_funds_001"
        );
        expect(unchanged?.status).toBe(RecoveryStatus.waiting);
        expect(await databaseCounts()).toEqual({ receipts: 1, cases: 1, audits: 2 });
      } finally {
        await dropTrigger("fail_late_capture_audit");
      }

      const retry = await postWebhook(capture);
      expect(retry.status).toBe(200);
      const closed = await getRecoveryCaseByOriginalPaymentId(
        "pay_test_insufficient_funds_001"
      );
      expect(closed?.status).toBe(RecoveryStatus.closed);
      expect(closed?.stoppedReason).toBe("late_capture");
      const timeline = await getRecoveryCaseWithTimeline(closed!.id);
      expect(timeline?.auditEvents.map(({ eventType }) => eventType)).toEqual([
        AuditEventType.payment_failed_received,
        AuditEventType.grace_started,
        AuditEventType.late_capture_received,
        AuditEventType.recovery_stopped,
      ]);
      expect(await databaseCounts()).toEqual({ receipts: 2, cases: 1, audits: 4 });
    });
  });

  describe("failure normalization", () => {
    it("prefers error_reason, uses description for audit text, and leaves name null", async () => {
      await postWebhook(loadFixture("payment-failed"));
      const recoveryCase = await getRecoveryCaseByOriginalPaymentId(
        "pay_test_insufficient_funds_001"
      );
      expect(recoveryCase?.failureReason).toBe("insufficient_funds");
      expect(recoveryCase?.customerName).toBeNull();
      expect(recoveryCase?.customerEmail).toBe("customer@example.com");

      const timeline = await getRecoveryCaseWithTimeline(recoveryCase!.id);
      expect(timeline?.auditEvents[0].message).toBe(
        "Payment failed: Insufficient balance in account"
      );
    });

    it("falls back to error_description when error_reason is absent", async () => {
      const body = JSON.parse(loadFixture("payment-failed").toString("utf-8"));
      delete body.payload.payment.error_reason;
      await postWebhook(Buffer.from(JSON.stringify(body)));
      const recoveryCase = await getRecoveryCaseByOriginalPaymentId(
        "pay_test_insufficient_funds_001"
      );
      expect(recoveryCase?.failureReason).toBe("Insufficient balance in account");
    });
  });

  describe("payment-link verification", () => {
    async function createCaseAndLinkEvent(overrides: Record<string, unknown> = {}) {
      const failedResponse = await postWebhook(loadFixture("payment-failed"));
      const { caseId } = await failedResponse.json();
      const event = JSON.parse(loadFixture("payment-link-paid").toString("utf-8"));
      event.payload.payment_link.notes.recovery_case_id = caseId;
      Object.assign(event.payload.payment_link, overrides);
      return { caseId: caseId as string, payload: Buffer.from(JSON.stringify(event)) };
    }

    it.each([
      ["amount", { amount: 99999 }, "amount_mismatch"],
      ["currency", { currency: "USD" }, "currency_mismatch"],
      ["missing amount", { amount: undefined }, "amount_mismatch"],
      ["missing currency", { currency: undefined }, "currency_mismatch"],
    ])("moves the case to manual review for %s mismatch", async (_label, overrides, outcome) => {
      const { caseId, payload } = await createCaseAndLinkEvent(overrides);
      const response = await postWebhook(payload);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: outcome, caseId });

      const recoveryCase = await getRecoveryCaseWithTimeline(caseId);
      expect(recoveryCase?.status).toBe(RecoveryStatus.manual_review);
      expect(recoveryCase?.requiresApproval).toBe(true);
      expect(recoveryCase?.auditEvents.slice(-2).map(({ eventType }) => eventType)).toEqual([
        AuditEventType.provider_error,
        AuditEventType.manual_review_requested,
      ]);
      expect(recoveryCase?.recoveredAmount).toBeNull();
    });

    it("records the original case amount for a valid paid link exactly once", async () => {
      const { caseId, payload } = await createCaseAndLinkEvent();
      const first = await postWebhook(payload);
      const second = await postWebhook(payload);
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({ status: "recovered", duplicate: false });
      expect(await second.json()).toMatchObject({ status: "recovered", duplicate: true });

      const recoveryCase = await getRecoveryCaseWithTimeline(caseId);
      expect(recoveryCase?.status).toBe(RecoveryStatus.recovered);
      expect(recoveryCase?.recoveredAmount).toBe(recoveryCase?.amount);
      expect(
        recoveryCase?.auditEvents.filter(
          ({ eventType }) => eventType === AuditEventType.recovery_succeeded
        )
      ).toHaveLength(1);
    });

    it("does not reopen a case closed by late capture", async () => {
      const failed = await postWebhook(loadFixture("payment-failed"));
      const { caseId } = await failed.json();
      await postWebhook(loadFixture("payment-captured"));

      const event = JSON.parse(loadFixture("payment-link-paid").toString("utf-8"));
      event.payload.payment_link.notes.recovery_case_id = caseId;
      const response = await postWebhook(Buffer.from(JSON.stringify(event)));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "duplicate", duplicate: true });

      const recoveryCase = await getRecoveryCaseWithTimeline(caseId);
      expect(recoveryCase?.status).toBe(RecoveryStatus.closed);
      expect(recoveryCase?.recoveredAmount).toBeNull();
    });
  });
});
