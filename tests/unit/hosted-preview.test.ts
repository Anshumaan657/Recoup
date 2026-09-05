import { describe, expect, it } from "vitest";
import {
  HOSTED_DEMO_CASES,
  HOSTED_DEMO_METRICS,
  hostedDemoDetail,
  hostedDemoReplayResponse,
} from "@/lib/demo/hosted-preview";

describe("hosted judge preview", () => {
  it("exposes the canonical, deterministic 60-case result", () => {
    expect(HOSTED_DEMO_CASES).toHaveLength(60);
    expect(HOSTED_DEMO_METRICS).toMatchObject({
      attempted: 36,
      contacted: 36,
      recovered: 20,
      stopped: 16,
      manualReview: 8,
      duplicatesPrevented: 8,
      totalCases: 60,
      totalAtRiskPaise: 12_484_000,
      recoveredPaise: 3_828_000,
      dataset: "synthetic",
    });
    expect(hostedDemoReplayResponse()).toMatchObject({
      status: "completed",
      synthetic: true,
      reused: true,
      metrics: HOSTED_DEMO_METRICS,
    });
  });

  it("returns masked case details without payment-link URLs", () => {
    const detail = hostedDemoDetail(HOSTED_DEMO_CASES[0].id);
    expect(detail).not.toBeNull();
    expect(detail?.customerEmail).toMatch(/^.\*{3}@example\.com$/);
    expect(detail).not.toHaveProperty("paymentLinkUrl");
    expect(detail?.auditTimeline).toHaveLength(3);
    expect(hostedDemoDetail("missing")).toBeNull();
  });
});
