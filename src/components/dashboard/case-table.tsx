import { ArrowUpRight, ShieldCheck } from "lucide-react";
import type { RecoverySummary } from "./dashboard-types";
import {
  formatCurrency,
  formatDateTime,
  formatRelativeTime,
  getActionPresentation,
  getStatusPresentation,
  humanize,
} from "./presentation";

interface CaseTableProps {
  cases: RecoverySummary[];
  onSelect: (caseId: string) => void;
}

function Customer({ recoveryCase }: { recoveryCase: RecoverySummary }) {
  const primary = recoveryCase.customerName ?? recoveryCase.customerEmail ?? recoveryCase.customerContact ?? "Masked customer";
  const secondary = recoveryCase.customerName
    ? recoveryCase.customerEmail ?? recoveryCase.customerContact
    : recoveryCase.customerContact;
  return (
    <div className="customer-cell">
      <span>{primary}</span>
      {secondary ? <small>{secondary}</small> : null}
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  const presentation = getStatusPresentation(value);
  return <span className={`status-pill status-pill--${presentation.tone}`}>{presentation.label}</span>;
}

function Action({ value }: { value: string | null }) {
  const presentation = getActionPresentation(value);
  return <span className="action-label">{presentation.label}</span>;
}

export function CaseTable({ cases, onSelect }: CaseTableProps) {
  return (
    <>
      <div className="case-table-wrap">
        <table className="case-table">
          <caption className="sr-only">Synthetic failed-payment recovery cases</caption>
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">Amount</th>
              <th scope="col">Failure signal</th>
              <th scope="col">Agent action</th>
              <th scope="col">Status</th>
              <th scope="col">Updated</th>
              <th scope="col"><span className="sr-only">Open details</span></th>
            </tr>
          </thead>
          <tbody>
            {cases.map((recoveryCase) => (
              <tr key={recoveryCase.id}>
                <td><Customer recoveryCase={recoveryCase} /></td>
                <td className="amount-cell">{formatCurrency(recoveryCase.amountPaise, recoveryCase.currency)}</td>
                <td>
                  <span className="failure-cell">{humanize(recoveryCase.failureReason, "Unknown failure")}</span>
                  <small>{humanize(recoveryCase.paymentMethod, "Method unavailable")}</small>
                </td>
                <td><Action value={recoveryCase.selectedAction} /></td>
                <td><StatusPill value={recoveryCase.status} /></td>
                <td>
                  <time dateTime={recoveryCase.updatedAt} title={formatDateTime(recoveryCase.updatedAt)}>
                    {formatRelativeTime(recoveryCase.updatedAt)}
                  </time>
                </td>
                <td>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => onSelect(recoveryCase.id)}
                    aria-label={`Open recovery case for ${recoveryCase.customerName ?? "masked customer"}`}
                  >
                    <ArrowUpRight size={17} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="case-card-list" aria-label="Synthetic failed-payment recovery cases">
        {cases.map((recoveryCase) => (
          <article className="case-card" key={recoveryCase.id}>
            <div className="case-card__top">
              <Customer recoveryCase={recoveryCase} />
              <p>{formatCurrency(recoveryCase.amountPaise, recoveryCase.currency)}</p>
            </div>
            <div className="case-card__signal">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>{humanize(recoveryCase.failureReason, "Unknown failure")}</span>
            </div>
            <div className="case-card__meta">
              <div>
                <span>Agent action</span>
                <Action value={recoveryCase.selectedAction} />
              </div>
              <div>
                <span>Status</span>
                <StatusPill value={recoveryCase.status} />
              </div>
            </div>
            <button className="button button--secondary button--full" type="button" onClick={() => onSelect(recoveryCase.id)}>
              Inspect decision <ArrowUpRight size={17} aria-hidden="true" />
            </button>
          </article>
        ))}
      </div>
    </>
  );
}
