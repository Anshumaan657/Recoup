import { describe, expect, it } from "vitest";
import {
  formatCurrency,
  formatPercent,
  getActionPresentation,
  getStatusPresentation,
  humanize,
  maskPaymentId,
} from "@/components/dashboard/presentation";

describe("dashboard presentation helpers", () => {
  it("formats paise as truthful en-IN currency and decimal rates as percentages", () => {
    expect(formatCurrency(12_484_000)).toMatch(/₹1,24,840/);
    expect(formatCurrency(3_828_000)).toMatch(/₹38,280/);
    expect(formatPercent(0.306632)).toBe("30.7%");
  });

  it("maps known and unknown statuses and actions to readable labels", () => {
    expect(getStatusPresentation("manual_review")).toEqual({ label: "Manual review", tone: "amber" });
    expect(getStatusPresentation("recovered")).toEqual({ label: "Recovered", tone: "emerald" });
    expect(getActionPresentation("create_payment_link").label).toBe("Create payment link");
    expect(getActionPresentation(null).label).toBe("Pending decision");
    expect(humanize("gateway_timeout")).toBe("Gateway Timeout");
  });

  it("exposes only a masked payment identifier", () => {
    expect(maskPaymentId("pay_demo_12345678")).toBe("pay_••••5678");
  });
});
