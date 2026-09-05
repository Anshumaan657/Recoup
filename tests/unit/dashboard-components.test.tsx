import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditTimeline } from "@/components/dashboard/audit-timeline";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import type { DashboardMetrics, RecoveryDetail, RecoverySummary } from "@/components/dashboard/dashboard-types";
import { ReplayButton } from "@/components/dashboard/replay-button";
import { CaseDetail } from "@/components/recoveries/case-detail";

const metrics: DashboardMetrics = {
  runId: "demo-run",
  datasetVersion: "v1",
  synthetic: true,
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
  generatedAt: "2026-09-05T10:00:00.000Z",
  dataset: "synthetic",
};

const recoveredCase: RecoverySummary = {
  id: "case-recovered",
  originalPaymentId: "pay_demo_recovered_0001",
  orderId: "order-1",
  amountPaise: 250_000,
  currency: "INR",
  customerName: "A***",
  customerEmail: "a***@example.com",
  customerContact: "******1234",
  paymentMethod: "upi",
  failureReason: "insufficient_funds",
  attemptCount: 1,
  status: "recovered",
  selectedAction: "create_payment_link",
  requiresApproval: false,
  hasPaymentLink: true,
  recoveredAmountPaise: 250_000,
  stoppedReason: null,
  synthetic: true,
  createdAt: "2026-09-05T09:00:00.000Z",
  updatedAt: "2026-09-05T10:00:00.000Z",
};

const manualCase: RecoverySummary = {
  ...recoveredCase,
  id: "case-manual",
  originalPaymentId: "pay_demo_manual_0002",
  customerName: "B***",
  status: "manual_review",
  selectedAction: "manual_review",
  requiresApproval: true,
  hasPaymentLink: false,
  recoveredAmountPaise: null,
  failureReason: "risk_threshold_exceeded",
};

const detail: RecoveryDetail = {
  ...recoveredCase,
  failureCode: "BAD_REQUEST_ERROR",
  decisionReason: "Send a bounded recovery link. <img src=x onerror=alert(1)>",
  confidence: 0.92,
  paymentLinkExpiry: "2026-09-06T10:00:00.000Z",
  recoveredAt: "2026-09-05T10:00:00.000Z",
  auditTimeline: [
    { id: "b", eventType: "recovery_succeeded", message: "Recovery verified", metadata: {}, createdAt: "2026-09-05T10:00:00.000Z" },
    { id: "a", eventType: "decision_created", message: "Safe action selected", metadata: { fallbackUsed: true, approved: true }, createdAt: "2026-09-05T09:30:00.000Z" },
  ],
};

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  }));
}

function installDashboardFetch(caseData: RecoverySummary[] = [recoveredCase, manualCase]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url === "/api/metrics") return jsonResponse(metrics);
    if (url.startsWith("/api/recoveries?") ) return jsonResponse({ data: caseData, pagination: { total: caseData.length, limit: 100, offset: 0 } });
    if (url === "/api/recoveries/case-recovered") return jsonResponse({ data: detail });
    return jsonResponse({ status: "completed" });
  });
}

afterEach(() => vi.restoreAllMocks());

describe("merchant dashboard", () => {
  it("shows loading and then renders metrics and filtered cases", async () => {
    installDashboardFetch();
    render(<DashboardShell />);
    expect(screen.getByLabelText("Loading recovery cases")).toBeInTheDocument();
    expect(await screen.findByText(/₹1,24,840/)).toBeInTheDocument();
    expect(screen.getAllByText("A***").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "manual_review" } });
    expect(screen.queryByText("A***")).not.toBeInTheDocument();
    expect(screen.getAllByText("B***").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Filter by agent action"), { target: { value: "no_action" } });
    expect(screen.getByText("No cases match these filters")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByText("A***").length).toBeGreaterThan(0);
  });

  it("renders empty and API error states with recovery actions", async () => {
    const fetchMock = installDashboardFetch([]);
    const { unmount } = render(<DashboardShell />);
    expect(await screen.findByText("No synthetic evaluation yet")).toBeInTheDocument();
    unmount();

    fetchMock.mockImplementation(() => jsonResponse({}, 500));
    render(<DashboardShell />);
    expect(await screen.findByText("Recovery data is unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry loading" })).toBeInTheDocument();
  });

  it("opens a case detail and exposes the chronological audit trail", async () => {
    installDashboardFetch();
    render(<DashboardShell />);
    await screen.findByText(/₹1,24,840/);
    fireEvent.click(screen.getAllByRole("button", { name: /Open recovery case for A/ })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Case detail" });
    expect(within(dialog).getByText("Recovered by agent")).toBeInTheDocument();
    expect(within(dialog).getByText("Deterministic fallback")).toBeInTheDocument();
    expect(within(dialog).getByText("Approved by policy")).toBeInTheDocument();
    expect(within(dialog).getByText("Recovery verified")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("replay control", () => {
  it("requires confirmation, blocks double submission, and reports success", async () => {
    let resolveReplay!: () => void;
    const onReplay = vi.fn(() => new Promise<void>((resolve) => { resolveReplay = resolve; }));
    render(<ReplayButton onReplay={onReplay} />);
    fireEvent.click(screen.getByRole("button", { name: "Replay 60-case demo" }));
    const confirm = screen.getByRole("button", { name: "Confirm replay" });
    fireEvent.click(confirm);
    expect(onReplay).toHaveBeenCalledTimes(1);
    const loadingButton = screen.getByRole("button", { name: /Running evaluation/ });
    expect(loadingButton).toBeDisabled();
    fireEvent.click(loadingButton);
    expect(onReplay).toHaveBeenCalledTimes(1);
    resolveReplay();
    expect(await screen.findByRole("button", { name: /Demo refreshed/ })).toBeInTheDocument();
  });

  it("shows a bounded error and retries without another confirmation", async () => {
    const onReplay = vi.fn().mockRejectedValueOnce(new Error("failed")).mockResolvedValueOnce(undefined);
    render(<ReplayButton onReplay={onReplay} />);
    fireEvent.click(screen.getByRole("button", { name: "Replay 60-case demo" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm replay" }));
    const retry = await screen.findByRole("button", { name: "Retry replay" });
    expect(screen.getByText("Replay failed. Your previous run is unchanged.")).toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(onReplay).toHaveBeenCalledTimes(2));
  });
});

describe("case detail safety", () => {
  it("orders audits and renders malicious model text as escaped text", () => {
    const { container } = render(
      <CaseDetail open detail={detail} loading={false} error={null} onClose={() => undefined} onRetry={() => undefined} />
    );
    expect(screen.getByText(detail.decisionReason!)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    const timeline = screen.getByRole("list", { name: "Chronological audit timeline" });
    const messages = within(timeline).getAllByText(/Safe action selected|Recovery verified/);
    expect(messages.map((item) => item.textContent)).toEqual(["Safe action selected", "Recovery verified"]);
  });

  it("sorts same API events chronologically", () => {
    render(<AuditTimeline events={detail.auditTimeline} />);
    const listItems = screen.getAllByRole("listitem");
    expect(listItems[0]).toHaveTextContent("Safe action selected");
    expect(listItems[1]).toHaveTextContent("Recovery verified");
  });
});
