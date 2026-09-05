"use client";

import {
  Activity,
  AlertTriangle,
  BadgeIndianRupee,
  CheckCircle2,
  Filter,
  IndianRupee,
  RotateCcw,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CaseDetail } from "@/components/recoveries/case-detail";
import { CaseTable } from "./case-table";
import type {
  DashboardMetrics,
  RecoveriesResponse,
  RecoveryDetail,
  RecoverySummary,
} from "./dashboard-types";
import { MetricCard } from "./metric-card";
import { formatCurrency, formatDateTime, formatPercent } from "./presentation";
import { ReplayButton } from "./replay-button";

const STATUS_FILTERS = [
  ["all", "All statuses"],
  ["waiting", "Waiting"],
  ["eligible", "Eligible"],
  ["contacted", "Contacted"],
  ["recovered", "Recovered"],
  ["closed", "Closed"],
  ["manual_review", "Manual review"],
] as const;

const ACTION_FILTERS = [
  ["all", "All actions"],
  ["retry_later", "Retry later"],
  ["suggest_alternate_method", "Suggest another method"],
  ["create_payment_link", "Create payment link"],
  ["manual_review", "Manual review"],
  ["no_action", "No action"],
] as const;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  return response.json() as Promise<T>;
}

function LoadingCases() {
  return (
    <div className="case-loading" aria-label="Loading recovery cases">
      {[0, 1, 2, 3].map((item) => <div className="skeleton skeleton--row" key={item} />)}
    </div>
  );
}

export function DashboardShell() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [cases, setCases] = useState<RecoverySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RecoveryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextMetrics, recoveryResponse] = await Promise.all([
        fetchJson<DashboardMetrics>("/api/metrics"),
        fetchJson<RecoveriesResponse>("/api/recoveries?synthetic=true&limit=100&offset=0"),
      ]);
      setMetrics(nextMetrics);
      setCases(recoveryResponse.data);
    } catch {
      setError("The recovery workspace could not be loaded. Check the local server and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const loadDetail = useCallback(async (caseId: string) => {
    setSelectedCaseId(caseId);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const response = await fetchJson<{ data: RecoveryDetail }>(`/api/recoveries/${encodeURIComponent(caseId)}`);
      setDetail(response.data);
    } catch {
      setDetailError("The audit record is temporarily unavailable.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedCaseId(null);
    setDetail(null);
    setDetailError(null);
  }, []);

  const filteredCases = useMemo(() => cases.filter((recoveryCase) =>
    (statusFilter === "all" || recoveryCase.status === statusFilter) &&
    (actionFilter === "all" || recoveryCase.selectedAction === actionFilter)
  ), [actionFilter, cases, statusFilter]);

  const hasFilters = statusFilter !== "all" || actionFilter !== "all";
  const totalAtRisk = metrics?.totalAtRiskPaise ?? 0;
  const recovered = metrics?.recoveredPaise ?? 0;
  const stillAtRisk = Math.max(0, totalAtRisk - recovered);

  async function replayDemo() {
    await fetchJson("/api/demo/replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reset: true }),
    });
    await loadDashboard();
  }

  return (
    <div className="dashboard-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><TrendingUp size={20} /></span>
          <div><strong>RecoverAI</strong><span>Revenue Recovery Autopilot</span></div>
        </div>
        <div className="topbar__actions">
          <span className="mode-badge"><span aria-hidden="true" /> Test Mode · Synthetic Demo</span>
          <ReplayButton onReplay={replayDemo} compact />
        </div>
      </header>

      <main className="dashboard-main">
        <section className="dashboard-intro" aria-labelledby="dashboard-title">
          <div>
            <span className="eyebrow">Merchant operations</span>
            <h1 id="dashboard-title">Recovery command center</h1>
            <p>Explainable, policy-bound interventions across a deterministic 60-case evaluation.</p>
          </div>
          <div className="run-summary" aria-label="Evaluation status">
            <span><Activity size={15} aria-hidden="true" /> Evaluation status</span>
            <strong>{loading ? "Loading…" : metrics?.runId ? "Run complete" : "Awaiting replay"}</strong>
            <small>{metrics?.generatedAt && metrics.generatedAt !== new Date(0).toISOString() ? `Generated ${formatDateTime(metrics.generatedAt)}` : "No synthetic run recorded"}</small>
          </div>
        </section>

        <section className="metrics-grid" aria-label="Synthetic evaluation metrics">
          <MetricCard
            label="Revenue at risk"
            value={formatCurrency(totalAtRisk)}
            detail={`${metrics?.totalCases ?? 0} synthetic failed payments`}
            icon={<IndianRupee size={18} />}
            tone="amber"
            loading={loading}
          />
          <MetricCard
            label="Verified recovered"
            value={formatCurrency(recovered)}
            detail={`${metrics?.recovered ?? 0} simulated recoveries verified`}
            icon={<BadgeIndianRupee size={18} />}
            tone="emerald"
            loading={loading}
          />
          <MetricCard
            label="Recovery rate"
            value={formatPercent(metrics?.recoveryRate ?? 0)}
            detail="Recovered value ÷ value at risk"
            icon={<TrendingUp size={18} />}
            tone="cyan"
            loading={loading}
          />
          <MetricCard
            label="Duplicates prevented"
            value={String(metrics?.duplicatesPrevented ?? 0)}
            detail="Late captures stopped safely"
            icon={<ShieldCheck size={18} />}
            tone="cyan"
            loading={loading}
          />
        </section>

        <section className="operations-strip" aria-label="Recovery evaluation breakdown">
          <div className="recovery-progress">
            <div className="recovery-progress__labels">
              <div><span>Synthetic value recovered</span><strong>{formatCurrency(recovered)}</strong></div>
              <div><span>Remaining value at risk</span><strong>{formatCurrency(stillAtRisk)}</strong></div>
            </div>
            <div className="progress-track" aria-label={`${formatPercent(metrics?.recoveryRate ?? 0)} of synthetic value recovered`}>
              <span style={{ width: `${Math.min(100, Math.max(0, (metrics?.recoveryRate ?? 0) * 100))}%` }} />
            </div>
          </div>
          <dl className="operations-counts">
            <div><dt>Contacted</dt><dd>{metrics?.contacted ?? 0}</dd></div>
            <div><dt>Stopped</dt><dd>{metrics?.stopped ?? 0}</dd></div>
            <div><dt>Manual review</dt><dd>{metrics?.manualReview ?? 0}</dd></div>
          </dl>
        </section>

        <section className="cases-panel" aria-labelledby="cases-title">
          <header className="cases-panel__header">
            <div>
              <span className="eyebrow">Decision queue</span>
              <h2 id="cases-title">Recovery cases</h2>
              <p>{loading ? "Loading cases…" : `${filteredCases.length} of ${cases.length} cases shown · newest first`}</p>
            </div>
            <div className="filter-group">
              <span className="filter-label"><Filter size={15} aria-hidden="true" /> Filters</span>
              <label>
                <span className="sr-only">Filter by status</span>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  {STATUS_FILTERS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </label>
              <label>
                <span className="sr-only">Filter by agent action</span>
                <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
                  {ACTION_FILTERS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </label>
            </div>
          </header>

          {loading ? <LoadingCases /> : error ? (
            <div className="state-panel" role="alert">
              <AlertTriangle size={24} aria-hidden="true" />
              <h3>Recovery data is unavailable</h3>
              <p>{error}</p>
              <button className="button button--secondary" type="button" onClick={() => void loadDashboard()}>
                <RotateCcw size={16} aria-hidden="true" /> Retry loading
              </button>
            </div>
          ) : cases.length === 0 ? (
            <div className="state-panel">
              <CheckCircle2 size={25} aria-hidden="true" />
              <h3>No synthetic evaluation yet</h3>
              <p>Replay the seeded batch to populate 60 transparent recovery outcomes.</p>
              <ReplayButton onReplay={replayDemo} />
            </div>
          ) : filteredCases.length === 0 ? (
            <div className="state-panel">
              <Filter size={24} aria-hidden="true" />
              <h3>No cases match these filters</h3>
              <p>Clear the filters to return to the complete evaluation.</p>
              <button className="button button--secondary" type="button" onClick={() => { setStatusFilter("all"); setActionFilter("all"); }}>
                Clear filters
              </button>
            </div>
          ) : <CaseTable cases={filteredCases} onSelect={(caseId) => void loadDetail(caseId)} />}
        </section>

        <footer className="dashboard-footer">
          <span><ShieldCheck size={15} aria-hidden="true" /> Policy-bound test environment</span>
          <p>Synthetic evaluation only. No live merchant revenue or customer charges.</p>
        </footer>
      </main>

      <CaseDetail
        open={selectedCaseId !== null}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        onClose={closeDetail}
        onRetry={() => selectedCaseId && void loadDetail(selectedCaseId)}
      />
    </div>
  );
}
