import type { ReactNode } from "react";
import type { Tone } from "./presentation";

const TONE_CLASSES: Record<Tone, string> = {
  cyan: "metric-card--cyan",
  emerald: "metric-card--emerald",
  amber: "metric-card--amber",
  red: "metric-card--red",
  slate: "metric-card--slate",
};

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone: Tone;
  loading?: boolean;
}

export function MetricCard({
  label,
  value,
  detail,
  icon,
  tone,
  loading = false,
}: MetricCardProps) {
  return (
    <article className={`metric-card ${TONE_CLASSES[tone]}`} aria-label={label}>
      <div className="metric-card__topline">
        <p>{label}</p>
        <span aria-hidden="true">{icon}</span>
      </div>
      {loading ? (
        <div className="skeleton skeleton--metric" aria-label={`Loading ${label}`} />
      ) : (
        <p className="metric-card__value">{value}</p>
      )}
      <p className="metric-card__detail">{detail}</p>
    </article>
  );
}
