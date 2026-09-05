export const DEMO_DATASET_VERSION = "recoverai-demo-v1";
export const DEFAULT_DEMO_SEED = 20_260_905;
export const DEMO_CASE_COUNT = 60;

export type DemoCategory =
  | "insufficient_funds"
  | "bank_network_downtime"
  | "authentication_failure"
  | "user_cancellation"
  | "technical_gateway_failure"
  | "suspected_risk"
  | "unknown_failure"
  | "missing_contact"
  | "opted_out_customer"
  | "high_value_manual_review"
  | "duplicate_webhook"
  | "late_authorization"
  | "payment_link_success"
  | "payment_link_failure";

export type PredeterminedOutcome =
  | "recovered"
  | "late_capture"
  | "stopped_unrecoverable"
  | "manual_review"
  | "attempted_not_recovered";

export type DemoEvent =
  | "payment.failed"
  | "payment.failed.duplicate"
  | "grace.elapsed"
  | "decision.executed"
  | "payment.captured"
  | "payment_link.paid"
  | "payment_link.expired"
  | "policy.stopped"
  | "customer.opted_out"
  | "manual_review.requested";

export interface DemoCaseInput {
  caseId: string;
  orderId: string;
  originalPaymentId: string;
  amountPaise: number;
  currency: "INR";
  customerName: string;
  customerEmail: string | null;
  customerContact: string | null;
  paymentMethod: "card" | "upi" | "netbanking" | "wallet";
  failureCode: string;
  failureReason: string;
  failureSource: string;
  failureStep: string;
  optedOut: boolean;
  createdAt: string;
  synthetic: true;
}

export interface DemoScenario {
  input: DemoCaseInput;
  category: DemoCategory;
  expected: {
    outcome: PredeterminedOutcome;
    events: DemoEvent[];
  };
}

interface CategoryPlan {
  category: DemoCategory;
  outcomes: PredeterminedOutcome[];
}

const CATEGORY_PLAN: CategoryPlan[] = [
  { category: "insufficient_funds", outcomes: ["recovered", "recovered", "recovered", "recovered", "attempted_not_recovered"] },
  { category: "bank_network_downtime", outcomes: ["recovered", "recovered", "recovered", "attempted_not_recovered", "attempted_not_recovered"] },
  { category: "authentication_failure", outcomes: ["recovered", "recovered", "recovered", "attempted_not_recovered", "attempted_not_recovered"] },
  { category: "user_cancellation", outcomes: ["recovered", "recovered", "late_capture", "late_capture", "attempted_not_recovered"] },
  { category: "technical_gateway_failure", outcomes: ["recovered", "recovered", "attempted_not_recovered", "attempted_not_recovered", "attempted_not_recovered"] },
  { category: "suspected_risk", outcomes: ["stopped_unrecoverable", "stopped_unrecoverable", "stopped_unrecoverable", "stopped_unrecoverable"] },
  { category: "unknown_failure", outcomes: ["attempted_not_recovered", "attempted_not_recovered", "attempted_not_recovered", "attempted_not_recovered"] },
  { category: "missing_contact", outcomes: ["manual_review", "manual_review", "manual_review", "manual_review"] },
  { category: "opted_out_customer", outcomes: ["stopped_unrecoverable", "stopped_unrecoverable", "stopped_unrecoverable", "stopped_unrecoverable"] },
  { category: "high_value_manual_review", outcomes: ["manual_review", "manual_review", "manual_review", "manual_review"] },
  { category: "duplicate_webhook", outcomes: ["recovered", "recovered", "late_capture", "late_capture"] },
  { category: "late_authorization", outcomes: ["late_capture", "late_capture", "late_capture", "late_capture"] },
  { category: "payment_link_success", outcomes: ["recovered", "recovered", "recovered", "recovered"] },
  { category: "payment_link_failure", outcomes: ["attempted_not_recovered", "attempted_not_recovered", "attempted_not_recovered"] },
];

const PAYMENT_METHODS: DemoCaseInput["paymentMethod"][] = [
  "card",
  "upi",
  "netbanking",
  "wallet",
];
const STANDARD_AMOUNTS = [49_900, 79_900, 129_900, 199_900, 249_900, 349_900];

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function failureFor(category: DemoCategory) {
  switch (category) {
    case "insufficient_funds":
      return ["BAD_REQUEST_ERROR", "insufficient_funds", "bank", "payment_authorization"];
    case "bank_network_downtime":
      return ["GATEWAY_ERROR", "bank_unavailable", "bank", "payment_processing"];
    case "authentication_failure":
      return ["BAD_REQUEST_ERROR", "authentication_failed", "customer", "payment_authentication"];
    case "user_cancellation":
      return ["BAD_REQUEST_ERROR", "payment_cancelled", "customer", "payment_authentication"];
    case "technical_gateway_failure":
      return ["SERVER_ERROR", "gateway_timeout", "gateway", "payment_processing"];
    case "suspected_risk":
      return ["FRAUD_RISK", "suspected_fraud", "razorpay", "risk_check"];
    case "unknown_failure":
      return ["UNKNOWN_ERROR", "unknown_failure", "unknown", "unknown"];
    case "missing_contact":
      return ["BAD_REQUEST_ERROR", "contact_unavailable", "customer", "payment_authorization"];
    case "opted_out_customer":
      return ["BAD_REQUEST_ERROR", "customer_opted_out", "customer", "payment_authorization"];
    case "high_value_manual_review":
      return ["HIGH_VALUE", "approval_required", "merchant", "policy_review"];
    case "duplicate_webhook":
      return ["BAD_REQUEST_ERROR", "insufficient_funds", "bank", "payment_authorization"];
    case "late_authorization":
      return ["GATEWAY_ERROR", "authorization_delayed", "bank", "payment_authorization"];
    case "payment_link_success":
      return ["BAD_REQUEST_ERROR", "retry_with_link", "customer", "payment_authorization"];
    case "payment_link_failure":
      return ["BAD_REQUEST_ERROR", "retry_with_link", "customer", "payment_authorization"];
  }
}

function eventsFor(
  category: DemoCategory,
  outcome: PredeterminedOutcome
): DemoEvent[] {
  const events: DemoEvent[] = ["payment.failed"];
  if (category === "duplicate_webhook") events.push("payment.failed.duplicate");
  switch (outcome) {
    case "late_capture":
      return [...events, "payment.captured"];
    case "stopped_unrecoverable":
      return [
        ...events,
        ...(category === "opted_out_customer" ? (["customer.opted_out"] as DemoEvent[]) : []),
        "grace.elapsed",
        "policy.stopped",
      ];
    case "manual_review":
      return [...events, "grace.elapsed", "manual_review.requested"];
    case "recovered":
      return [...events, "grace.elapsed", "decision.executed", "payment_link.paid"];
    case "attempted_not_recovered":
      return [...events, "grace.elapsed", "decision.executed", "payment_link.expired"];
  }
}

export function createDemoDataset(seed = DEFAULT_DEMO_SEED): DemoScenario[] {
  if (!Number.isSafeInteger(seed) || seed < 1) throw new Error("Demo seed must be a positive integer");
  const random = seededRandom(seed);
  const scenarios: DemoScenario[] = [];
  const baseTime = Date.parse("2026-01-15T09:00:00.000Z");

  for (const plan of CATEGORY_PLAN) {
    for (const outcome of plan.outcomes) {
      const number = scenarios.length + 1;
      const suffix = String(number).padStart(3, "0");
      const [failureCode, failureReason, failureSource, failureStep] = failureFor(plan.category);
      const highValue = plan.category === "high_value_manual_review";
      const amountPaise = highValue
        ? 599_900 + Math.floor(random() * 5) * 100_000
        : STANDARD_AMOUNTS[Math.floor(random() * STANDARD_AMOUNTS.length)];
      const missingContact = plan.category === "missing_contact";
      scenarios.push({
        input: {
          caseId: `demo-${seed}-${suffix}`,
          orderId: `order_demo_${seed}_${suffix}`,
          originalPaymentId: `pay_demo_${seed}_${suffix}`,
          amountPaise,
          currency: "INR",
          customerName: `Synthetic Customer ${suffix}`,
          customerEmail: missingContact ? null : `customer-${suffix}@example.com`,
          customerContact: missingContact ? null : `+91000000${suffix}`,
          paymentMethod: PAYMENT_METHODS[(number - 1) % PAYMENT_METHODS.length],
          failureCode,
          failureReason,
          failureSource,
          failureStep,
          optedOut: plan.category === "opted_out_customer",
          createdAt: new Date(baseTime + number * 60_000).toISOString(),
          synthetic: true,
        },
        category: plan.category,
        expected: { outcome, events: eventsFor(plan.category, outcome) },
      });
    }
  }

  if (scenarios.length !== DEMO_CASE_COUNT) {
    throw new Error(`Demo dataset must contain exactly ${DEMO_CASE_COUNT} cases`);
  }
  return scenarios;
}

export function getAgentVisibleDemoCases(seed = DEFAULT_DEMO_SEED): DemoCaseInput[] {
  return createDemoDataset(seed).map(({ input }) => ({ ...input }));
}

export const DEMO_CATEGORY_COUNTS: Readonly<Record<DemoCategory, number>> =
  Object.freeze(
    CATEGORY_PLAN.reduce(
      (counts, plan) => ({ ...counts, [plan.category]: plan.outcomes.length }),
      {} as Record<DemoCategory, number>
    )
  );
