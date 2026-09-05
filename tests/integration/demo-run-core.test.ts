import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  attachCaseToDemoRun,
  attachReceiptToDemoRun,
  completeDemoRun,
  createDemoRunPlan,
  reserveDemoRun,
  resetDemoOwnedRows,
} from "@/lib/demo/simulator";
import { RecoveryStatus } from "@/types/domain";
import { assertSafeTestDatabaseUrl } from "../test-database";

const prisma = new PrismaClient();

beforeAll(async () => prisma.$connect());

afterAll(async () => {
  assertSafeTestDatabaseUrl();
  await prisma.demoRun.deleteMany();
  await prisma.$disconnect();
});

beforeEach(async () => {
  assertSafeTestDatabaseUrl();
  await prisma.auditEvent.deleteMany();
  await prisma.notificationOutbox.deleteMany();
  await prisma.webhookReceipt.deleteMany();
  await prisma.recoveryCase.deleteMany();
  await prisma.demoRun.deleteMany();
});

async function createRecoveryCase(originalPaymentId: string) {
  return prisma.recoveryCase.create({
    data: {
      originalPaymentId,
      orderId: `order_${originalPaymentId}`,
      amount: 10_000,
      currency: "INR",
      attemptCount: 0,
      status: RecoveryStatus.waiting,
      requiresApproval: false,
    },
  });
}

describe("demo run core", () => {
  it("builds a deterministic run id, dataset, and expected metrics", () => {
    const first = createDemoRunPlan(12345);
    const second = createDemoRunPlan(12345);
    expect(first).toEqual(second);
    expect(first.runId).toMatch(/^demo_run_[a-f0-9]{20}$/);
    expect(first.scenarios).toHaveLength(60);
    expect(first.expectedMetrics.recovered).toBe(20);
    expect(first.synthetic).toBe(true);
  });

  it("reserves one versioned run and reports an existing active run", async () => {
    const first = await reserveDemoRun(12345);
    const second = await reserveDemoRun(12345);
    expect(first.alreadyRunning).toBe(false);
    expect(second.alreadyRunning).toBe(true);
    expect(await prisma.demoRun.count()).toBe(1);
    const stored = await prisma.demoRun.findUniqueOrThrow({
      where: { id: first.plan.runId },
    });
    expect(stored.synthetic).toBe(true);
    expect(JSON.parse(stored.expectedMetrics!)).toEqual(first.plan.expectedMetrics);
  });

  it("marks a reserved run completed", async () => {
    const { plan } = await reserveDemoRun(9876);
    await completeDemoRun(plan.runId);
    expect(
      await prisma.demoRun.findUniqueOrThrow({ where: { id: plan.runId } })
    ).toMatchObject({ status: "completed" });
  });

  it("resets only demo-owned cases and preserves non-demo rows", async () => {
    const normal = await createRecoveryCase("pay_normal_preserved");
    const synthetic = await createRecoveryCase("pay_synthetic_deleted");
    const { plan } = await reserveDemoRun(4567);
    await attachCaseToDemoRun(plan.runId, synthetic.id);
    await prisma.webhookReceipt.createMany({
      data: [
        {
          eventKey: "normal-event",
          providerEvent: "payment.failed",
          payloadHash: "normal-hash",
          outcome: "created",
        },
        {
          eventKey: "synthetic-event",
          providerEvent: "payment.failed",
          payloadHash: "synthetic-hash",
          outcome: "created",
        },
      ],
    });
    await attachReceiptToDemoRun(plan.runId, "synthetic-event");

    expect(await resetDemoOwnedRows(4567)).toBe(1);
    expect(await prisma.recoveryCase.findUnique({ where: { id: synthetic.id } })).toBeNull();
    expect(await prisma.recoveryCase.findUnique({ where: { id: normal.id } })).not.toBeNull();
    expect(
      await prisma.webhookReceipt.findUnique({ where: { eventKey: "synthetic-event" } })
    ).toBeNull();
    expect(
      await prisma.webhookReceipt.findUnique({ where: { eventKey: "normal-event" } })
    ).not.toBeNull();
  });

  it("a reset flag replaces the prior run deterministically", async () => {
    const first = await reserveDemoRun(7654);
    await completeDemoRun(first.plan.runId);
    const second = await reserveDemoRun(7654, true);
    expect(second.plan).toEqual(first.plan);
    expect(second.alreadyRunning).toBe(false);
    expect(await prisma.demoRun.count()).toBe(1);
    expect(
      await prisma.demoRun.findUniqueOrThrow({ where: { id: second.plan.runId } })
    ).toMatchObject({ status: "running" });
  });
});
