import { describe, expect, it } from "vitest";
import {
  createDemoDataset,
  DEFAULT_DEMO_SEED,
  DEMO_CASE_COUNT,
  DEMO_CATEGORY_COUNTS,
  getAgentVisibleDemoCases,
} from "@/lib/demo/dataset";
import { simulatePredeterminedOutcome } from "@/lib/demo/outcome-model";
import {
  calculateScenarioMetrics,
  paiseToRupees,
} from "@/lib/recovery/metrics";
import { createDemoRunPlan } from "@/lib/demo/simulator";

describe("versioned synthetic demo dataset", () => {
  it("contains exactly 60 cases with the fixed category distribution", () => {
    const dataset = createDemoDataset();
    const categoryCounts = dataset.reduce<Record<string, number>>((counts, item) => {
      counts[item.category] = (counts[item.category] ?? 0) + 1;
      return counts;
    }, {});

    expect(dataset).toHaveLength(DEMO_CASE_COUNT);
    expect(categoryCounts).toEqual(DEMO_CATEGORY_COUNTS);
    expect(DEMO_CATEGORY_COUNTS).toEqual({
      insufficient_funds: 5,
      bank_network_downtime: 5,
      authentication_failure: 5,
      user_cancellation: 5,
      technical_gateway_failure: 5,
      suspected_risk: 4,
      unknown_failure: 4,
      missing_contact: 4,
      opted_out_customer: 4,
      high_value_manual_review: 4,
      duplicate_webhook: 4,
      late_authorization: 4,
      payment_link_success: 4,
      payment_link_failure: 3,
    });
  });

  it("has the required predetermined outcome composition", () => {
    const outcomes = createDemoDataset().reduce<Record<string, number>>((counts, item) => {
      counts[item.expected.outcome] = (counts[item.expected.outcome] ?? 0) + 1;
      return counts;
    }, {});
    expect(outcomes).toEqual({
      recovered: 20,
      attempted_not_recovered: 16,
      stopped_unrecoverable: 8,
      manual_review: 8,
      late_capture: 8,
    });
  });

  it("uses only fake reserved contact data and integer paise", () => {
    for (const { input, category } of createDemoDataset()) {
      expect(Number.isSafeInteger(input.amountPaise)).toBe(true);
      expect(input.amountPaise).toBeGreaterThan(0);
      if (input.customerEmail) expect(input.customerEmail).toMatch(/@example\.com$/);
      if (input.customerContact) expect(input.customerContact).toMatch(/^\+910{6,}/);
      if (category === "missing_contact") {
        expect(input.customerEmail).toBeNull();
        expect(input.customerContact).toBeNull();
      }
    }
  });

  it("is identical for the same seed and different for another seed", () => {
    expect(createDemoDataset(DEFAULT_DEMO_SEED)).toEqual(
      createDemoDataset(DEFAULT_DEMO_SEED)
    );
    expect(createDemoDataset(DEFAULT_DEMO_SEED + 1)).not.toEqual(
      createDemoDataset(DEFAULT_DEMO_SEED)
    );
    expect(createDemoRunPlan()).toEqual(createDemoRunPlan());
  });

  it("does not expose hidden outcomes to agent-visible inputs", () => {
    const visible = getAgentVisibleDemoCases();
    expect(visible).toHaveLength(60);
    for (const item of visible) {
      expect(item).not.toHaveProperty("expected");
      expect(item).not.toHaveProperty("category");
      expect(item.synthetic).toBe(true);
    }
  });

  it("keeps duplicate delivery events from changing case metrics", () => {
    const duplicateScenarios = createDemoDataset().filter(
      ({ category }) => category === "duplicate_webhook"
    );
    expect(duplicateScenarios).toHaveLength(4);
    expect(
      duplicateScenarios.every(({ expected }) =>
        expected.events.includes("payment.failed.duplicate")
      )
    ).toBe(true);
    const metrics = calculateScenarioMetrics(
      duplicateScenarios,
      new Date("2026-01-01T00:00:00Z")
    );
    expect(metrics.totalCases).toBe(4);
    expect(metrics.recovered).toBe(2);
    expect(metrics.duplicatesPrevented).toBe(2);
  });

  it("keeps the outcome model independent and excludes late captures from revenue", () => {
    const dataset = createDemoDataset();
    const lateCaptures = dataset.filter(
      ({ expected }) => expected.outcome === "late_capture"
    );
    expect(lateCaptures).toHaveLength(8);
    for (const scenario of lateCaptures) {
      expect(simulatePredeterminedOutcome(scenario)).toMatchObject({
        attempted: false,
        recoveredPaise: 0,
        duplicatePrevented: true,
      });
    }
  });
});

describe("synthetic recovery metrics", () => {
  it("uses integer paise arithmetic and a stable metric contract", () => {
    const metrics = calculateScenarioMetrics(
      createDemoDataset(),
      new Date("2026-01-15T12:00:00.000Z")
    );
    expect(metrics).toMatchObject({
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
      generatedAt: "2026-01-15T12:00:00.000Z",
    });
    expect(Number.isSafeInteger(metrics.totalAtRiskPaise)).toBe(true);
    expect(Number.isSafeInteger(metrics.recoveredPaise)).toBe(true);
    expect(metrics.recoveryRate).toBe(
      metrics.recoveredPaise / metrics.totalAtRiskPaise
    );
    expect(paiseToRupees(metrics.recoveredPaise)).toBe(
      metrics.recoveredPaise / 100
    );
  });

  it("returns a zero recovery rate for an empty batch", () => {
    expect(
      calculateScenarioMetrics([], new Date("2026-01-01T00:00:00Z"))
    ).toEqual({
      attempted: 0,
      contacted: 0,
      recovered: 0,
      stopped: 0,
      manualReview: 0,
      duplicatesPrevented: 0,
      totalCases: 0,
      totalAtRiskPaise: 0,
      recoveredPaise: 0,
      recoveryRate: 0,
      generatedAt: "2026-01-01T00:00:00.000Z",
      dataset: "synthetic",
    });
  });
});
