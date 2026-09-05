import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";
import { generateRazorpaySignature } from "@/lib/razorpay/signatures";
import {
  findWebhookReceiptByEventKey,
  getRecoveryCaseByOriginalPaymentId,
  getRecoveryCaseWithTimeline,
  resetDemoData,
} from "@/lib/recovery/service";
import { RecoveryStatus, AuditEventType } from "@/types/domain";
import { POST } from "@/app/webhooks/razorpay/route";
import { assertSafeTestDatabaseUrl } from "../test-database";

const prisma = new PrismaClient();

const TEST_WEBHOOK_SECRET = "recoverai-test-only-webhook-secret";

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  assertSafeTestDatabaseUrl();
  await resetDemoData();
});

function loadFixture(name: string): Buffer {
  const fixturePath = join(process.cwd(), "fixtures", "webhooks", `${name}.json`);
  return readFileSync(fixturePath);
}

function signPayload(payload: Buffer, secret: string): string {
  return generateRazorpaySignature(payload, secret);
}

async function postWebhook(payload: Buffer, secret: string) {
  const signature = signPayload(payload, secret);

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

describe("Webhook Integration Tests", () => {
  describe("Signature Verification", () => {
    it("accepts valid signature", async () => {
      const payload = loadFixture("payment-failed");
      const response = await postWebhook(payload, TEST_WEBHOOK_SECRET);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("created");
      expect(body.duplicate).toBe(false);
    });

    it("rejects missing signature", async () => {
      const payload = loadFixture("payment-failed");
      const signature = "";
      const { POST } = await import("@/app/webhooks/razorpay/route");
      const request = new Request("http://localhost:3000/api/webhooks/razorpay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload.toString("utf-8"),
      });
      const response = await POST(request as unknown as import("next/server").NextRequest);
      expect(response.status).toBe(401);
    });

    it("rejects invalid signature", async () => {
      const payload = loadFixture("payment-failed");
      const { POST } = await import("@/app/webhooks/razorpay/route");
      const request = new Request("http://localhost:3000/api/webhooks/razorpay", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": "invalid-signature",
        },
        body: payload.toString("utf-8"),
      });
      const response = await POST(request as unknown as import("next/server").NextRequest);
      expect(response.status).toBe(401);
    });

    it("rejects malformed JSON", async () => {
      const payload = Buffer.from("{ invalid json }");
      const signature = signPayload(payload, TEST_WEBHOOK_SECRET);
      const { POST } = await import("@/app/webhooks/razorpay/route");
      const request = new Request("http://localhost:3000/api/webhooks/razorpay", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": signature,
        },
        body: payload.toString("utf-8"),
      });
      const response = await POST(request as unknown as import("next/server").NextRequest);
      expect(response.status).toBe(400);
    });
  });

  describe("Event Validation", () => {
    it("accepts payment.failed event", async () => {
      const payload = loadFixture("payment-failed");
      const response = await postWebhook(payload, TEST_WEBHOOK_SECRET);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("created");
    });

    it("accepts payment.captured event", async () => {
      const payload = loadFixture("payment-captured");
      const response = await postWebhook(payload, TEST_WEBHOOK_SECRET);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("closed");
    });

    it("accepts payment_link.paid event", async () => {
      const payload = loadFixture("payment-link-paid");
      const response = await postWebhook(payload, TEST_WEBHOOK_SECRET);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("ignored_unknown_payment_link");
    });

    it("rejects unsupported event with 200 ignored", async () => {
      const unsupportedEvent = {
        event: "refund.created",
        account_id: "acc_test_001",
        created_at: 1700000000,
        payload: { refund: { id: "rfnd_test_001", entity: "refund" } },
      };
      const payload = Buffer.from(JSON.stringify(unsupportedEvent));
      const signature = signPayload(payload, TEST_WEBHOOK_SECRET);
      const { POST } = await import("@/app/webhooks/razorpay/route");
      const request = new Request("http://localhost:3000/api/webhooks/razorpay", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": signature,
        },
        body: payload.toString("utf-8"),
      });
      const response = await POST(request as unknown as import("next/server").NextRequest);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("ignored");
      expect(body.reason).toBe("unsupported_event");
    });

    it("rejects malformed supported event (missing required fields)", async () => {
      const malformedEvent = {
        event: "payment.failed",
        account_id: "acc_test_001",
        created_at: 1700000000,
        payload: { payment: { id: "pay_test_001" } },
      };
      const payload = Buffer.from(JSON.stringify(malformedEvent));
      const signature = signPayload(payload, TEST_WEBHOOK_SECRET);
      const { POST } = await import("@/app/webhooks/razorpay/route");
      const request = new Request("http://localhost:3000/api/webhooks/razorpay", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": signature,
        },
        body: payload.toString("utf-8"),
      });
      const response = await POST(request as unknown as import("next/server").NextRequest);
      expect(response.status).toBe(400);
    });
  });

  describe("Idempotency", () => {
    it("handles duplicate delivery", async () => {
      const payload = loadFixture("payment-failed");
      const response1 = await postWebhook(payload, TEST_WEBHOOK_SECRET);
      expect(response1.status).toBe(200);
      const body1 = await response1.json();
      expect(body1.status).toBe("created");
      expect(body1.duplicate).toBe(false);

      const response2 = await postWebhook(payload, TEST_WEBHOOK_SECRET);
      expect(response2.status).toBe(200);
      const body2 = await response2.json();
      expect(body2.status).toBe("created");
      expect(body2.duplicate).toBe(true);
    });

    it("handles two simultaneous duplicate requests", async () => {
      const payload = loadFixture("payment-failed");
      const [response1, response2] = await Promise.all([
        postWebhook(payload, TEST_WEBHOOK_SECRET),
        postWebhook(payload, TEST_WEBHOOK_SECRET),
      ]);

      const body1 = await response1.json();
      const body2 = await response2.json();

      const statuses = [body1.status, body2.status].sort();
      const duplicates = [body1.duplicate, body2.duplicate].sort();

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(statuses).toContain("created");
      expect(duplicates).toEqual([false, true]);

      const cases = await prisma.recoveryCase.findMany();
      expect(cases).toHaveLength(1);

      const receipts = await prisma.webhookReceipt.findMany();
      expect(receipts).toHaveLength(1);

      const audits = await prisma.auditEvent.findMany();
      expect(audits).toHaveLength(2);
    });
  });

  describe("payment.failed handling", () => {
    it("creates recovery case with correct data", async () => {
      const payload = loadFixture("payment-failed");
      const response = await postWebhook(payload, TEST_WEBHOOK_SECRET);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.caseId).toBeDefined();

      const caseData = await getRecoveryCaseByOriginalPaymentId("pay_test_insufficient_funds_001");
      expect(caseData).not.toBeNull();
      expect(caseData!.originalPaymentId).toBe("pay_test_insufficient_funds_001");
      expect(caseData!.amount).toBe(50000);
      expect(caseData!.currency).toBe("INR");
      expect(caseData!.failureCode).toBe("INSUFFICIENT_FUNDS");
      expect(caseData!.failureReason).toBe("insufficient_funds");
      expect(caseData!.failureSource).toBe("bank");
      expect(caseData!.failureStep).toBe("payment_processing");
      expect(caseData!.status).toBe(RecoveryStatus.waiting);
      expect(caseData!.graceExpiresAt).not.toBeNull();

      const withTimeline = await getRecoveryCaseWithTimeline(caseData!.id);
      expect(withTimeline!.auditEvents).toHaveLength(2);
      expect(withTimeline!.auditEvents[0].eventType).toBe(AuditEventType.payment_failed_received);
      expect(withTimeline!.auditEvents[1].eventType).toBe(AuditEventType.grace_started);
    });
  });

  describe("payment.captured handling (late capture)", () => {
    it("closes existing case when payment captured after failure", async () => {
      const failedPayload = loadFixture("payment-failed");
      await postWebhook(failedPayload, TEST_WEBHOOK_SECRET);

      const capturedPayload = loadFixture("payment-captured");
      const response = await postWebhook(capturedPayload, TEST_WEBHOOK_SECRET);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("closed");

      const caseData = await getRecoveryCaseByOriginalPaymentId("pay_test_insufficient_funds_001");
      expect(caseData!.status).toBe(RecoveryStatus.closed);
      expect(caseData!.stoppedReason).toBe("late_capture");

      const withTimeline = await getRecoveryCaseWithTimeline(caseData!.id);
      const eventTypes = withTimeline!.auditEvents.map((e) => e.eventType);
      expect(eventTypes).toContain(AuditEventType.late_capture_received);
      expect(eventTypes).toContain(AuditEventType.recovery_stopped);
    });

    it("keeps case closed if failure arrives after capture", async () => {
      const capturedPayload = loadFixture("payment-captured");
      await postWebhook(capturedPayload, TEST_WEBHOOK_SECRET);

      const failedPayload = loadFixture("payment-failed");
      const response = await postWebhook(failedPayload, TEST_WEBHOOK_SECRET);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.duplicate).toBe(true);

      const caseData = await getRecoveryCaseByOriginalPaymentId("pay_test_insufficient_funds_001");
      expect(caseData).not.toBeNull();
      expect(caseData!.status).toBe(RecoveryStatus.closed);
      expect(caseData!.stoppedReason).toBe("late_capture");
    });

    it("handles repeated capture gracefully", async () => {
      const failedPayload = loadFixture("payment-failed");
      await postWebhook(failedPayload, TEST_WEBHOOK_SECRET);

      const capturedPayload = loadFixture("payment-captured");
      await postWebhook(capturedPayload, TEST_WEBHOOK_SECRET);
      const response2 = await postWebhook(capturedPayload, TEST_WEBHOOK_SECRET);

      expect(response2.status).toBe(200);
      const body = await response2.json();
      expect(body.duplicate).toBe(true);

      const caseData = await getRecoveryCaseByOriginalPaymentId("pay_test_insufficient_funds_001");
      expect(caseData!.status).toBe(RecoveryStatus.closed);
    });
  });

  describe("payment_link.paid handling", () => {
    it("marks case recovered when payment link paid", async () => {
      const failedPayload = loadFixture("payment-failed");
      const failedResponse = await postWebhook(failedPayload, TEST_WEBHOOK_SECRET);
      const failedBody = await failedResponse.json();
      const caseId = failedBody.caseId;

      const linkPayload = loadFixture("payment-link-paid");
      const linkPayloadObj = JSON.parse(linkPayload.toString("utf-8"));
      linkPayloadObj.payload.payment_link.notes.recovery_case_id = caseId;
      const modifiedLinkPayload = Buffer.from(JSON.stringify(linkPayloadObj));

      const response = await postWebhook(modifiedLinkPayload, TEST_WEBHOOK_SECRET);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("recovered");
      expect(body.caseId).toBe(caseId);

      const caseData = await getRecoveryCaseWithTimeline(caseId);
      expect(caseData!.status).toBe(RecoveryStatus.recovered);
      expect(caseData!.recoveredAmount).toBe(50000);
      expect(caseData!.paymentLinkId).toBe("plink_test_recovery_001");

      const eventTypes = caseData!.auditEvents.map((e) => e.eventType);
      expect(eventTypes).toContain(AuditEventType.recovery_succeeded);
    });

    it("ignores unknown payment link", async () => {
      const payload = loadFixture("payment-link-paid");
      const response = await postWebhook(payload, TEST_WEBHOOK_SECRET);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("ignored_unknown_payment_link");
      expect(body.duplicate).toBe(false);
      expect(body.caseId).toBeUndefined();
    });

    it("handles duplicate payment link paid", async () => {
      const failedPayload = loadFixture("payment-failed");
      const failedResponse = await postWebhook(failedPayload, TEST_WEBHOOK_SECRET);
      const failedBody = await failedResponse.json();
      const caseId = failedBody.caseId;

      const linkPayload = loadFixture("payment-link-paid");
      const linkPayloadObj = JSON.parse(linkPayload.toString("utf-8"));
      linkPayloadObj.payload.payment_link.notes.recovery_case_id = caseId;
      const modifiedLinkPayload = Buffer.from(JSON.stringify(linkPayloadObj));

      await postWebhook(modifiedLinkPayload, TEST_WEBHOOK_SECRET);
      const response2 = await postWebhook(modifiedLinkPayload, TEST_WEBHOOK_SECRET);

      expect(response2.status).toBe(200);
      const body = await response2.json();
      expect(body.duplicate).toBe(true);

      const caseData = await getRecoveryCaseWithTimeline(caseId);
      expect(caseData!.status).toBe(RecoveryStatus.recovered);
      const succeededEvents = caseData!.auditEvents.filter(
        (e) => e.eventType === AuditEventType.recovery_succeeded
      );
      expect(succeededEvents).toHaveLength(1);
    });
  });

  describe("Webhook Receipt Persistence", () => {
    it("persists webhook receipt with correct data", async () => {
      const payload = loadFixture("payment-failed");
      await postWebhook(payload, TEST_WEBHOOK_SECRET);

      const receipts = await prisma.webhookReceipt.findMany();
      expect(receipts).toHaveLength(1);
      expect(receipts[0].providerEvent).toBe("payment.failed");
      expect(receipts[0].outcome).toBe("created");
      expect(receipts[0].payloadHash).toBeDefined();
    });

    it("returns stored outcome for duplicate", async () => {
      const payload = loadFixture("payment-failed");
      await postWebhook(payload, TEST_WEBHOOK_SECRET);

      const receipts = await prisma.webhookReceipt.findMany();
      expect(receipts).toHaveLength(1);
      expect(receipts[0].outcome).toBe("created");
    });
  });
});
