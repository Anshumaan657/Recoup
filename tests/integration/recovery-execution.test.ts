import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";
import { POST } from "@/app/webhooks/razorpay/route";
import { queueNotification } from "@/lib/notifications/outbox";
import { RazorpayProviderError } from "@/lib/razorpay/client";
import { PaymentLinkRequest, PaymentLinkResponse } from "@/lib/razorpay/payment-links";
import { executeRecoveryCase } from "@/lib/recovery/executor";
import { generateRazorpaySignature } from "@/lib/razorpay/signatures";
import { resetDemoData } from "@/lib/recovery/service";
import { resetServerEnvCache } from "@/lib/validation/env";
import { AuditEventType, RecoveryAction, RecoveryStatus } from "@/types/domain";
import { assertSafeTestDatabaseUrl } from "../test-database";

const prisma = new PrismaClient();
const webhookSecret = "recoverai-test-only-webhook-secret";
let sequence = 0;

beforeAll(async () => prisma.$connect());
afterAll(async () => prisma.$disconnect());

beforeEach(async () => {
  assertSafeTestDatabaseUrl();
  process.env.DEMO_MODE = "true";
  process.env.ENABLE_RAZORPAY_LINKS = "false";
  process.env.MAX_RECOVERY_ATTEMPTS = "3";
  process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  resetServerEnvCache();
  await resetDemoData();
  sequence += 1;
});

async function createCase(
  action: RecoveryAction,
  overrides: Record<string, unknown> = {}
) {
  return prisma.recoveryCase.create({
    data: {
      originalPaymentId: `pay_phase5_${sequence}_${action}`,
      orderId: `order_phase5_${sequence}`,
      amount: 50_000,
      currency: "INR",
      customerName: "Test Customer",
      customerEmail: "customer@example.com",
      customerContact: "+919999999999",
      paymentMethod: "card",
      failureCode: "BAD_REQUEST_ERROR",
      failureReason: "payment_failed",
      failureSource: "customer",
      failureStep: "payment_authentication",
      attemptCount: 0,
      status: RecoveryStatus.eligible,
      selectedAction: action,
      decisionReason: "Phase 5 test decision",
      confidence: 0.9,
      requiresApproval: false,
      graceExpiresAt: new Date(Date.now() - 60_000),
      ...overrides,
    },
  });
}

function providerLink(request: PaymentLinkRequest): PaymentLinkResponse {
  return {
    id: "plink_test_phase5",
    entity: "payment_link",
    amount: request.amount,
    currency: request.currency,
    status: "created",
    short_url: "https://rzp.io/i/phase5",
    reference_id: request.reference_id,
    description: request.description,
    customer: request.customer,
    expire_by: request.expire_by,
    created_at: Math.floor(Date.now() / 1000),
    notes: request.notes,
  };
}

async function postWebhook(payload: Buffer) {
  const signature = generateRazorpaySignature(payload, webhookSecret);
  return POST(
    new Request("http://localhost:3000/webhooks/razorpay", {
      method: "POST",
      headers: { "x-razorpay-signature": signature },
      body: payload.toString("utf8"),
    }) as unknown as import("next/server").NextRequest
  );
}

describe("bounded recovery execution", () => {
  it("creates and labels a simulated link, notification, and one attempt", async () => {
    const recoveryCase = await createCase(RecoveryAction.create_payment_link);

    const result = await executeRecoveryCase(recoveryCase.id);

    expect(result).toMatchObject({
      outcome: "payment_link_created",
      status: RecoveryStatus.contacted,
      duplicate: false,
      simulated: true,
    });
    const stored = await prisma.recoveryCase.findUniqueOrThrow({
      where: { id: recoveryCase.id },
      include: { auditEvents: true, notifications: true },
    });
    expect(stored.attemptCount).toBe(1);
    expect(stored.paymentLinkId).toMatch(/^plink_demo_/);
    expect(stored.notifications).toHaveLength(1);
    expect(stored.auditEvents.map(({ eventType }) => eventType)).toEqual(
      expect.arrayContaining([
        AuditEventType.payment_link_created,
        AuditEventType.notification_queued,
      ])
    );
    const linkAudit = stored.auditEvents.find(
      ({ eventType }) => eventType === AuditEventType.payment_link_created
    );
    expect(JSON.parse(linkAudit!.metadata).simulated).toBe(true);
  });

  it("persists a successful mocked Razorpay result", async () => {
    const recoveryCase = await createCase(RecoveryAction.create_payment_link);
    const createLink = vi.fn(async (request: PaymentLinkRequest) => providerLink(request));

    const result = await executeRecoveryCase(recoveryCase.id, { createLink });

    expect(result.simulated).toBe(false);
    expect(createLink).toHaveBeenCalledTimes(1);
    expect((createLink.mock.calls[0] as [PaymentLinkRequest])[0]).toMatchObject({
      amount: 50_000,
      currency: "INR",
      reference_id: `recovery_${recoveryCase.id}`,
      reminder_enable: false,
      notify: { email: false, sms: false },
      notes: { recovery_case_id: recoveryCase.id },
    });
  });

  it("records provider failures without recording revenue", async () => {
    const recoveryCase = await createCase(RecoveryAction.create_payment_link);
    const result = await executeRecoveryCase(recoveryCase.id, {
      createLink: async () => {
        throw new RazorpayProviderError("timeout", 504, "TIMEOUT");
      },
    });

    expect(result).toMatchObject({
      outcome: "provider_error",
      status: RecoveryStatus.eligible,
    });
    const stored = await prisma.recoveryCase.findUniqueOrThrow({
      where: { id: recoveryCase.id },
      include: { auditEvents: true },
    });
    expect(stored.recoveredAmount).toBeNull();
    expect(stored.paymentLinkId).toBeNull();
    expect(stored.auditEvents.at(-1)?.eventType).toBe(AuditEventType.provider_error);
    expect(stored.auditEvents.at(-1)?.metadata).not.toContain("secret");
  });

  it("executes the same case only once", async () => {
    const recoveryCase = await createCase(RecoveryAction.create_payment_link);
    const first = await executeRecoveryCase(recoveryCase.id);
    const second = await executeRecoveryCase(recoveryCase.id);

    expect(first.duplicate).toBe(false);
    expect(second).toMatchObject({ outcome: "already_executed", duplicate: true });
    expect(await prisma.notificationOutbox.count()).toBe(1);
  });

  it("atomically reserves concurrent executions", async () => {
    const recoveryCase = await createCase(RecoveryAction.create_payment_link);
    const createLink = vi.fn(async (request: PaymentLinkRequest) => providerLink(request));
    const results = await Promise.all([
      executeRecoveryCase(recoveryCase.id, { createLink }),
      executeRecoveryCase(recoveryCase.id, { createLink }),
    ]);

    expect(results.filter(({ outcome }) => outcome === "payment_link_created")).toHaveLength(1);
    expect(results.filter(({ duplicate }) => duplicate)).toHaveLength(1);
    expect(createLink).toHaveBeenCalledTimes(1);
    expect(await prisma.notificationOutbox.count()).toBe(1);
  });

  it("moves an over-attempt case to manual review", async () => {
    const recoveryCase = await createCase(RecoveryAction.create_payment_link, {
      attemptCount: 3,
    });
    const result = await executeRecoveryCase(recoveryCase.id);
    expect(result).toMatchObject({
      outcome: "manual_review",
      status: RecoveryStatus.manual_review,
    });
  });

  it("closes an expired linked case", async () => {
    const recoveryCase = await createCase(RecoveryAction.create_payment_link, {
      status: RecoveryStatus.contacted,
      paymentLinkId: "plink_test_expired",
      paymentLinkUrl: "https://rzp.io/i/expired",
      paymentLinkExpiry: new Date(Date.now() - 1000),
    });
    const result = await executeRecoveryCase(recoveryCase.id);
    expect(result).toMatchObject({ outcome: "stopped", status: RecoveryStatus.closed });
    const stored = await prisma.recoveryCase.findUniqueOrThrow({
      where: { id: recoveryCase.id },
    });
    expect(stored.stoppedReason).toBe("link_expired");
  });

  it("stops an opted-out case before customer contact", async () => {
    const recoveryCase = await createCase(RecoveryAction.create_payment_link, {
      stoppedReason: "customer_opt_out",
    });
    const result = await executeRecoveryCase(recoveryCase.id);
    expect(result).toMatchObject({ outcome: "stopped", status: RecoveryStatus.closed });
    expect(await prisma.notificationOutbox.count()).toBe(0);
  });

  it("deduplicates concurrent notification requests", async () => {
    const recoveryCase = await createCase(RecoveryAction.suggest_alternate_method);
    const params = {
      recoveryCaseId: recoveryCase.id,
      channel: "email" as const,
      recipient: "customer@example.com",
      message: "Please retry using another payment method.",
    };
    const [first, second] = await Promise.all([
      queueNotification(params),
      queueNotification(params),
    ]);
    expect(first.id).toBe(second.id);
    expect(await prisma.notificationOutbox.count()).toBe(1);
    expect(await prisma.auditEvent.count()).toBe(1);
  });

  it("refuses an already-notified eligible case", async () => {
    const recoveryCase = await createCase(RecoveryAction.create_payment_link);
    await queueNotification({
      recoveryCaseId: recoveryCase.id,
      channel: "email",
      recipient: "customer@example.com",
      message: "Please retry using another payment method.",
    });

    const result = await executeRecoveryCase(recoveryCase.id);
    expect(result).toMatchObject({
      outcome: "already_executed",
      duplicate: true,
    });
    expect(await prisma.notificationOutbox.count()).toBe(1);
    expect(
      await prisma.recoveryCase.findUniqueOrThrow({ where: { id: recoveryCase.id } })
    ).toMatchObject({ attemptCount: 0, paymentLinkId: null });
  });

  it("refuses execution when capture arrives immediately before action", async () => {
    const recoveryCase = await createCase(RecoveryAction.create_payment_link, {
      originalPaymentId: "pay_test_insufficient_funds_001",
    });
    const capture = readFileSync(
      join(process.cwd(), "fixtures", "webhooks", "payment-captured.json")
    );
    expect((await postWebhook(capture)).status).toBe(200);

    const result = await executeRecoveryCase(recoveryCase.id);
    expect(result).toMatchObject({ outcome: "already_executed", duplicate: true });
    expect(result.status).toBe(RecoveryStatus.closed);
    expect(await prisma.notificationOutbox.count()).toBe(0);
  });

  it("cancels pending notification state after capture following link creation", async () => {
    const recoveryCase = await createCase(RecoveryAction.create_payment_link, {
      originalPaymentId: "pay_test_insufficient_funds_001",
    });
    await executeRecoveryCase(recoveryCase.id);
    const capture = readFileSync(
      join(process.cwd(), "fixtures", "webhooks", "payment-captured.json")
    );
    expect((await postWebhook(capture)).status).toBe(200);

    const stored = await prisma.recoveryCase.findUniqueOrThrow({
      where: { id: recoveryCase.id },
      include: { notifications: true },
    });
    expect(stored.status).toBe(RecoveryStatus.closed);
    expect(stored.stoppedReason).toBe("late_capture");
    expect(stored.notifications[0].status).toBe("cancelled");
    expect((await executeRecoveryCase(recoveryCase.id)).duplicate).toBe(true);
  });

  it("records a paid recovery exactly once", async () => {
    const recoveryCase = await createCase(RecoveryAction.create_payment_link);
    await executeRecoveryCase(recoveryCase.id);
    const stored = await prisma.recoveryCase.findUniqueOrThrow({ where: { id: recoveryCase.id } });
    const fixture = JSON.parse(
      readFileSync(
        join(process.cwd(), "fixtures", "webhooks", "payment-link-paid.json"),
        "utf8"
      )
    );
    fixture.payload.payment_link.id = stored.paymentLinkId;
    fixture.payload.payment_link.amount = stored.amount;
    fixture.payload.payment_link.currency = stored.currency;
    fixture.payload.payment_link.notes.recovery_case_id = stored.id;
    const payload = Buffer.from(JSON.stringify(fixture));

    const first = await postWebhook(payload);
    const second = await postWebhook(payload);
    expect((await first.json()).status).toBe("recovered");
    expect((await second.json()).duplicate).toBe(true);
    const recovered = await prisma.recoveryCase.findUniqueOrThrow({
      where: { id: recoveryCase.id },
      include: { auditEvents: true },
    });
    expect(recovered.recoveredAmount).toBe(50_000);
    expect(
      recovered.auditEvents.filter(
        ({ eventType }) => eventType === AuditEventType.recovery_succeeded
      )
    ).toHaveLength(1);
  });

  it("rejects a paid event for a contradictory Payment Link id", async () => {
    const recoveryCase = await createCase(RecoveryAction.create_payment_link);
    await executeRecoveryCase(recoveryCase.id);
    const fixture = JSON.parse(
      readFileSync(
        join(process.cwd(), "fixtures", "webhooks", "payment-link-paid.json"),
        "utf8"
      )
    );
    fixture.payload.payment_link.id = "plink_test_contradictory";
    fixture.payload.payment_link.amount = recoveryCase.amount;
    fixture.payload.payment_link.currency = recoveryCase.currency;
    fixture.payload.payment_link.notes.recovery_case_id = recoveryCase.id;

    const response = await postWebhook(Buffer.from(JSON.stringify(fixture)));
    expect((await response.json()).status).toBe("payment_link_id_mismatch");
    const stored = await prisma.recoveryCase.findUniqueOrThrow({
      where: { id: recoveryCase.id },
    });
    expect(stored.status).toBe(RecoveryStatus.manual_review);
    expect(stored.recoveredAmount).toBeNull();
  });

  it("executes retry, alternate-method, manual-review, and no-action decisions", async () => {
    const retry = await createCase(RecoveryAction.retry_later);
    expect((await executeRecoveryCase(retry.id)).outcome).toBe("retry_scheduled");
    expect((await executeRecoveryCase(retry.id)).outcome).toBe("not_ready");

    const alternate = await createCase(RecoveryAction.suggest_alternate_method, {
      originalPaymentId: `pay_phase5_${sequence}_alternate`,
    });
    expect((await executeRecoveryCase(alternate.id)).outcome).toBe("notification_queued");

    const manual = await createCase(RecoveryAction.manual_review, {
      originalPaymentId: `pay_phase5_${sequence}_manual`,
    });
    expect((await executeRecoveryCase(manual.id)).status).toBe(RecoveryStatus.manual_review);

    const noAction = await createCase(RecoveryAction.no_action, {
      originalPaymentId: `pay_phase5_${sequence}_none`,
    });
    expect((await executeRecoveryCase(noAction.id)).status).toBe(RecoveryStatus.closed);
  });
});
