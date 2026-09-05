import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as replayPost } from "@/app/api/demo/replay/route";
import { GET as metricsGet } from "@/app/api/metrics/route";
import { GET as recoveriesGet } from "@/app/api/recoveries/route";
import { GET as recoveryDetailGet } from "@/app/api/recoveries/[id]/route";
import { resetServerEnvCache } from "@/lib/validation/env";
import { assertSafeTestDatabaseUrl } from "../test-database";

const prisma = new PrismaClient();

beforeAll(async () => prisma.$connect());
afterAll(async () => prisma.$disconnect());

beforeEach(async () => {
  assertSafeTestDatabaseUrl();
  process.env.DEMO_MODE = "true";
  process.env.ENABLE_RAZORPAY_LINKS = "false";
  process.env.MAX_RECOVERY_ATTEMPTS = "3";
  resetServerEnvCache();
  await prisma.auditEvent.deleteMany();
  await prisma.notificationOutbox.deleteMany();
  await prisma.webhookReceipt.deleteMany();
  await prisma.recoveryCase.deleteMany();
  await prisma.demoRun.deleteMany();
});

function replayRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/demo/replay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Phase 6 demo APIs", () => {
  it("validates the bounded request and rejects replay outside demo mode", async () => {
    expect((await replayPost(replayRequest({ payment: { amount: 1 } }))).status).toBe(400);
    expect((await replayPost(replayRequest({ seed: "123", reset: true }))).status).toBe(400);
    expect((await replayPost(replayRequest({ seed: 0 }))).status).toBe(400);

    process.env.DEMO_MODE = "false";
    resetServerEnvCache();
    expect((await replayPost(replayRequest({}))).status).toBe(403);
  });

  it("replays deterministically and exposes stable masked contracts", async () => {
    const firstResponse = await replayPost(
      replayRequest({ seed: 20_260_905, reset: true })
    );
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first).toMatchObject({
      status: "completed",
      synthetic: true,
      reused: false,
      metrics: {
        attempted: 36,
        contacted: 36,
        recovered: 20,
        stopped: 16,
        manualReview: 8,
        duplicatesPrevented: 8,
        totalCases: 60,
        totalAtRiskPaise: 12_484_000,
        recoveredPaise: 3_828_000,
        recoveryRate: 0.30663248958667094,
        dataset: "synthetic",
      },
    });

    const repeatedResponse = await replayPost(
      replayRequest({ seed: 20_260_905 })
    );
    expect(repeatedResponse.status).toBe(200);
    const repeated = await repeatedResponse.json();
    expect(repeated.reused).toBe(true);
    expect(repeated.metrics).toEqual(first.metrics);

    const resetResponse = await replayPost(
      replayRequest({ seed: 20_260_905, reset: true })
    );
    expect(resetResponse.status).toBe(200);
    expect((await resetResponse.json()).metrics).toEqual(first.metrics);

    const metrics = await (await metricsGet()).json();
    expect(metrics).toMatchObject({
      runId: first.runId,
      synthetic: true,
      attempted: 36,
      recovered: 20,
      duplicatesPrevented: 8,
      recoveredPaise: 3_828_000,
      dataset: "synthetic",
    });

    const listResponse = await recoveriesGet(
      new NextRequest(
        "http://localhost:3000/api/recoveries?synthetic=true&limit=100&offset=0"
      )
    );
    expect(listResponse.status).toBe(200);
    const list = await listResponse.json();
    expect(list.pagination).toEqual({ total: 60, limit: 100, offset: 0 });
    expect(list.data[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        amountPaise: expect.any(Number),
        status: expect.any(String),
        synthetic: true,
        hasPaymentLink: expect.any(Boolean),
      })
    );
    expect(list.data[0]).not.toHaveProperty("paymentLinkUrl");
    if (list.data[0].customerEmail) {
      expect(list.data[0].customerEmail).toMatch(/^.\*{3}@example\.com$/);
    }

    const detailResponse = await recoveryDetailGet(
      new NextRequest(`http://localhost:3000/api/recoveries/${list.data[0].id}`),
      { params: { id: list.data[0].id } }
    );
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json();
    expect(detail.data).toEqual(
      expect.objectContaining({
        id: list.data[0].id,
        synthetic: true,
        auditTimeline: expect.any(Array),
      })
    );
    expect(detail.data).not.toHaveProperty("paymentLinkUrl");
    expect(detail.data.auditTimeline.length).toBeGreaterThanOrEqual(3);
  }, 30_000);

  it("protects a seed from concurrent replay", async () => {
    const responses = await Promise.all([
      replayPost(replayRequest({ seed: 123_456, reset: true })),
      replayPost(replayRequest({ seed: 123_456, reset: true })),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(
      await prisma.demoRun.count({ where: { seed: 123_456 } })
    ).toBe(1);
  }, 30_000);

  it("returns stable empty and not-found contracts", async () => {
    const metrics = await (await metricsGet()).json();
    expect(metrics).toMatchObject({
      runId: null,
      synthetic: true,
      totalCases: 0,
      totalAtRiskPaise: 0,
      recoveredPaise: 0,
      recoveryRate: 0,
    });
    const list = await (
      await recoveriesGet(
        new NextRequest("http://localhost:3000/api/recoveries?limit=10")
      )
    ).json();
    expect(list).toEqual({
      data: [],
      pagination: { total: 0, limit: 10, offset: 0 },
    });
    expect(
      (
        await recoveryDetailGet(
          new NextRequest("http://localhost:3000/api/recoveries/missing"),
          { params: { id: "missing" } }
        )
      ).status
    ).toBe(404);
  });

  it("serves the deterministic read-only hosted preview without database state", async () => {
    process.env.HOSTED_DEMO_MODE = "true";
    resetServerEnvCache();

    const metrics = await (await metricsGet()).json();
    expect(metrics).toMatchObject({
      synthetic: true,
      totalCases: 60,
      recoveredPaise: 3_828_000,
      duplicatesPrevented: 8,
    });

    const response = await recoveriesGet(
      new NextRequest("http://localhost:3000/api/recoveries?status=recovered&limit=5")
    );
    const list = await response.json();
    expect(response.status).toBe(200);
    expect(list.data).toHaveLength(5);
    expect(list.pagination.total).toBe(20);

    const replay = await (await replayPost(replayRequest({ reset: true }))).json();
    expect(replay).toMatchObject({ status: "completed", reused: true, synthetic: true });
    expect(await prisma.recoveryCase.count()).toBe(0);
    expect(await prisma.demoRun.count()).toBe(0);
  });
});
