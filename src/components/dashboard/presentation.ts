export type Tone = "cyan" | "emerald" | "amber" | "red" | "slate";

export interface Presentation {
  label: string;
  tone: Tone;
}

const STATUS_PRESENTATION: Record<string, Presentation> = {
  waiting: { label: "Waiting", tone: "amber" },
  eligible: { label: "Eligible", tone: "cyan" },
  contacted: { label: "Contacted", tone: "cyan" },
  recovered: { label: "Recovered", tone: "emerald" },
  closed: { label: "Closed", tone: "slate" },
  manual_review: { label: "Manual review", tone: "amber" },
};

const ACTION_PRESENTATION: Record<string, Presentation> = {
  retry_later: { label: "Retry later", tone: "cyan" },
  suggest_alternate_method: { label: "Suggest another method", tone: "cyan" },
  create_payment_link: { label: "Create payment link", tone: "cyan" },
  manual_review: { label: "Manual review", tone: "amber" },
  no_action: { label: "No action", tone: "slate" },
};

export function humanize(value: string | null | undefined, fallback = "Not available") {
  if (!value) return fallback;
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getStatusPresentation(status: string): Presentation {
  return STATUS_PRESENTATION[status] ?? { label: humanize(status), tone: "slate" };
}

export function getActionPresentation(action: string | null): Presentation {
  if (!action) return { label: "Pending decision", tone: "slate" };
  return ACTION_PRESENTATION[action] ?? { label: humanize(action), tone: "slate" };
}

export function formatCurrency(paise: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatRelativeTime(value: string, now = Date.now()): string {
  const deltaSeconds = Math.round((new Date(value).getTime() - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en-IN", { numeric: "auto" });
  if (Math.abs(deltaSeconds) < 60) return formatter.format(deltaSeconds, "second");
  const minutes = Math.round(deltaSeconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

export function maskPaymentId(value: string): string {
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
