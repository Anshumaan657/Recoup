import { Bot, Check, CircleStop, Clock3, Link2, ShieldAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AuditTimelineEntry } from "./dashboard-types";
import { formatDateTime, humanize } from "./presentation";

const EVENT_ICONS: Record<string, LucideIcon> = {
  decision_created: Bot,
  decision_rejected: ShieldAlert,
  payment_link_created: Link2,
  recovery_succeeded: Check,
  recovery_stopped: CircleStop,
  manual_review_requested: ShieldAlert,
};

function metadataEntries(metadata: Record<string, unknown>) {
  return Object.entries(metadata).filter(([, value]) =>
    ["string", "number", "boolean"].includes(typeof value)
  );
}

export function AuditTimeline({ events }: { events: AuditTimelineEntry[] }) {
  const orderedEvents = [...events].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  );

  return (
    <ol className="audit-timeline" aria-label="Chronological audit timeline">
      {orderedEvents.map((event) => {
        const Icon = EVENT_ICONS[event.eventType] ?? Clock3;
        const metadata = metadataEntries(event.metadata);
        return (
          <li key={event.id}>
            <span className="audit-timeline__icon"><Icon size={15} aria-hidden="true" /></span>
            <div className="audit-timeline__body">
              <div className="audit-timeline__heading">
                <p>{humanize(event.eventType)}</p>
                <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
              </div>
              <p className="audit-timeline__message">{event.message}</p>
              {metadata.length > 0 ? (
                <dl className="audit-metadata">
                  {metadata.map(([key, value]) => (
                    <div key={key}>
                      <dt>{humanize(key)}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
