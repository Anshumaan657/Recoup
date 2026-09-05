"use client";

import {
  AlertTriangle,
  Bot,
  Check,
  Copy,
  Link2,
  RotateCcw,
  ShieldCheck,
  UserRoundSearch,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AuditTimeline } from "@/components/dashboard/audit-timeline";
import type { RecoveryDetail } from "@/components/dashboard/dashboard-types";
import {
  formatCurrency,
  formatDateTime,
  formatPercent,
  getActionPresentation,
  getStatusPresentation,
  humanize,
  maskPaymentId,
} from "@/components/dashboard/presentation";

interface CaseDetailProps {
  open: boolean;
  detail: RecoveryDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
}

function OutcomeBanner({ detail }: { detail: RecoveryDetail }) {
  if (detail.status === "recovered") {
    return (
      <div className="outcome-banner outcome-banner--success">
        <Check size={18} aria-hidden="true" />
        <div><strong>Recovered by agent</strong><span>Payment verified and revenue recorded.</span></div>
      </div>
    );
  }
  if (detail.stoppedReason === "late_capture") {
    return (
      <div className="outcome-banner outcome-banner--safe">
        <ShieldCheck size={18} aria-hidden="true" />
        <div><strong>Late capture — recovery stopped</strong><span>Duplicate collection was prevented.</span></div>
      </div>
    );
  }
  if (detail.status === "manual_review") {
    return (
      <div className="outcome-banner outcome-banner--warning">
        <UserRoundSearch size={18} aria-hidden="true" />
        <div><strong>Manual review</strong><span>Automation paused until a merchant reviews this case.</span></div>
      </div>
    );
  }
  return null;
}

export function CaseDetail({ open, detail, loading, error, onClose, onRetry }: CaseDetailProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(
        sheetRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  const policy = useMemo(() => {
    const decision = detail?.auditTimeline.find((event) => event.eventType === "decision_created");
    const fallbackUsed = decision?.metadata.fallbackUsed === true;
    const approved = decision?.metadata.approved;
    const rejectedReasons = decision?.metadata.rejectedReasons;
    return {
      source: fallbackUsed ? "Deterministic fallback" : "Model-assisted decision",
      guardrail: approved === false || (Array.isArray(rejectedReasons) && rejectedReasons.length > 0)
        ? "Escalated by policy"
        : "Approved by policy",
    };
  }, [detail]);

  async function copyPaymentId() {
    if (!detail) return;
    const maskedId = maskPaymentId(detail.originalPaymentId);
    try {
      await navigator.clipboard.writeText(maskedId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  if (!open) return null;

  const status = detail ? getStatusPresentation(detail.status) : null;
  const action = detail ? getActionPresentation(detail.selectedAction) : null;

  return (
    <div className="sheet-layer">
      <button className="sheet-backdrop" type="button" tabIndex={-1} onClick={onClose} aria-label="Close case details" />
      <aside ref={sheetRef} className="case-sheet" role="dialog" aria-modal="true" aria-labelledby="case-sheet-title">
        <header className="case-sheet__header">
          <div>
            <span className="eyebrow">Recovery intelligence</span>
            <h2 id="case-sheet-title">Case detail</h2>
          </div>
          <button ref={closeButtonRef} className="icon-button icon-button--large" type="button" onClick={onClose} aria-label="Close case details">
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        {loading ? (
          <div className="sheet-loading" aria-label="Loading recovery case">
            <div className="skeleton skeleton--title" />
            <div className="skeleton skeleton--panel" />
            <div className="skeleton skeleton--panel" />
          </div>
        ) : error ? (
          <div className="state-panel state-panel--compact" role="alert">
            <AlertTriangle size={22} aria-hidden="true" />
            <h3>Case details could not load</h3>
            <p>{error}</p>
            <button className="button button--secondary" type="button" onClick={onRetry}>
              <RotateCcw size={16} aria-hidden="true" /> Retry
            </button>
          </div>
        ) : detail && status && action ? (
          <div className="case-sheet__content">
            <OutcomeBanner detail={detail} />

            <section className="case-overview" aria-labelledby="overview-title">
              <div className="case-overview__headline">
                <div>
                  <span id="overview-title">Payment amount</span>
                  <strong>{formatCurrency(detail.amountPaise, detail.currency)}</strong>
                </div>
                <span className={`status-pill status-pill--${status.tone}`}>{status.label}</span>
              </div>
              <dl className="detail-grid">
                <div><dt>Customer</dt><dd>{detail.customerName ?? detail.customerEmail ?? "Masked customer"}</dd></div>
                <div><dt>Payment method</dt><dd>{humanize(detail.paymentMethod)}</dd></div>
                <div className="detail-grid__wide">
                  <dt>Original payment ID</dt>
                  <dd className="copy-value">
                    <code>{maskPaymentId(detail.originalPaymentId)}</code>
                    <button type="button" onClick={copyPaymentId} aria-label="Copy masked payment ID">
                      {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                    </button>
                    <span className="sr-only" role="status">{copied ? "Masked payment ID copied" : ""}</span>
                  </dd>
                </div>
              </dl>
            </section>

            <section className="detail-section" aria-labelledby="signals-title">
              <div className="section-heading"><AlertTriangle size={17} aria-hidden="true" /><h3 id="signals-title">Failure signals</h3></div>
              <dl className="detail-grid">
                <div><dt>Reason</dt><dd>{humanize(detail.failureReason)}</dd></div>
                <div><dt>Code</dt><dd>{humanize(detail.failureCode)}</dd></div>
                <div><dt>Attempts</dt><dd>{detail.attemptCount}</dd></div>
                <div><dt>First seen</dt><dd>{formatDateTime(detail.createdAt)}</dd></div>
              </dl>
            </section>

            <section className="detail-section" aria-labelledby="decision-title">
              <div className="section-heading"><Bot size={17} aria-hidden="true" /><h3 id="decision-title">Decision &amp; guardrails</h3></div>
              <div className="decision-card">
                <div><span>Decision source</span><strong>{policy.source}</strong></div>
                <div><span>Proposed / approved action</span><strong>{action.label}</strong></div>
                <div><span>Guardrail result</span><strong>{policy.guardrail}</strong></div>
                <div><span>Confidence</span><strong>{detail.confidence === null ? "Not scored" : formatPercent(detail.confidence)}</strong></div>
                <p>{detail.decisionReason ?? "No decision explanation recorded."}</p>
              </div>
            </section>

            <section className="detail-section" aria-labelledby="link-title">
              <div className="section-heading"><Link2 size={17} aria-hidden="true" /><h3 id="link-title">Payment link</h3></div>
              <dl className="detail-grid">
                <div><dt>Status</dt><dd>{detail.hasPaymentLink ? (detail.status === "recovered" ? "Paid" : "Created") : "Not created"}</dd></div>
                <div><dt>Expiry</dt><dd>{detail.paymentLinkExpiry ? formatDateTime(detail.paymentLinkExpiry) : "Not applicable"}</dd></div>
              </dl>
            </section>

            <section className="detail-section" aria-labelledby="timeline-title">
              <div className="section-heading"><ShieldCheck size={17} aria-hidden="true" /><h3 id="timeline-title">Audit timeline</h3></div>
              <AuditTimeline events={detail.auditTimeline} />
            </section>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
