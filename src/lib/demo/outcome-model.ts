import { DemoEvent, DemoScenario, PredeterminedOutcome } from "./dataset";

export interface SimulatedOutcome {
  caseId: string;
  outcome: PredeterminedOutcome;
  events: DemoEvent[];
  attempted: boolean;
  contacted: boolean;
  recoveredPaise: number;
  stopped: boolean;
  manualReview: boolean;
  duplicatePrevented: boolean;
  synthetic: true;
}

/**
 * This model deliberately reads only the scenario's predetermined event plan.
 * It never imports or inspects the recovery agent or policy implementation.
 */
export function simulatePredeterminedOutcome(
  scenario: DemoScenario
): SimulatedOutcome {
  const outcome = scenario.expected.outcome;
  const attempted =
    outcome === "recovered" || outcome === "attempted_not_recovered";
  return {
    caseId: scenario.input.caseId,
    outcome,
    events: [...scenario.expected.events],
    attempted,
    contacted: attempted,
    recoveredPaise: outcome === "recovered" ? scenario.input.amountPaise : 0,
    stopped:
      outcome === "late_capture" || outcome === "stopped_unrecoverable",
    manualReview: outcome === "manual_review",
    duplicatePrevented: outcome === "late_capture",
    synthetic: true,
  };
}
