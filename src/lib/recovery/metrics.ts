import { DemoScenario } from "@/lib/demo/dataset";
import { simulatePredeterminedOutcome } from "@/lib/demo/outcome-model";

export interface RecoveryMetrics {
  attempted: number;
  contacted: number;
  recovered: number;
  stopped: number;
  manualReview: number;
  duplicatesPrevented: number;
  totalCases: number;
  totalAtRiskPaise: number;
  recoveredPaise: number;
  recoveryRate: number;
  generatedAt: string;
  dataset: "synthetic";
}

export function paiseToRupees(paise: number): number {
  if (!Number.isSafeInteger(paise)) throw new Error("Paise must be a safe integer");
  return paise / 100;
}

export function calculateScenarioMetrics(
  scenarios: readonly DemoScenario[],
  generatedAt = new Date()
): RecoveryMetrics {
  const ids = new Set<string>();
  let attempted = 0;
  let contacted = 0;
  let recovered = 0;
  let stopped = 0;
  let manualReview = 0;
  let duplicatesPrevented = 0;
  let totalAtRiskPaise = 0;
  let recoveredPaise = 0;

  for (const scenario of scenarios) {
    if (ids.has(scenario.input.caseId)) {
      throw new Error(`Duplicate demo case id: ${scenario.input.caseId}`);
    }
    ids.add(scenario.input.caseId);
    if (!Number.isSafeInteger(scenario.input.amountPaise) || scenario.input.amountPaise <= 0) {
      throw new Error(`Invalid paise amount for ${scenario.input.caseId}`);
    }
    totalAtRiskPaise += scenario.input.amountPaise;
    const result = simulatePredeterminedOutcome(scenario);
    if (result.attempted) attempted += 1;
    if (result.contacted) contacted += 1;
    if (result.recoveredPaise > 0) recovered += 1;
    if (result.stopped) stopped += 1;
    if (result.manualReview) manualReview += 1;
    if (result.duplicatePrevented) duplicatesPrevented += 1;
    recoveredPaise += result.recoveredPaise;
  }

  return {
    attempted,
    contacted,
    recovered,
    stopped,
    manualReview,
    duplicatesPrevented,
    totalCases: scenarios.length,
    totalAtRiskPaise,
    recoveredPaise,
    recoveryRate: totalAtRiskPaise === 0 ? 0 : recoveredPaise / totalAtRiskPaise,
    generatedAt: generatedAt.toISOString(),
    dataset: "synthetic",
  };
}
