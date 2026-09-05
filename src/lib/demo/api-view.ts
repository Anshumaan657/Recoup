const REDACTED_METADATA_KEY = /(email|contact|recipient|signature|secret|token|authorization)/i;

export function maskEmail(value: string | null): string | null {
  if (!value) return null;
  const [local, domain] = value.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

export function maskContact(value: string | null): string | null {
  if (!value) return null;
  const suffix = value.replace(/\D/g, "").slice(-4);
  return suffix ? `******${suffix}` : "***";
}

export function maskName(value: string | null): string | null {
  if (!value) return null;
  return `${value.slice(0, 1)}***`;
}

export function redactAuditMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      REDACTED_METADATA_KEY.test(key) ? "[REDACTED]" : value,
    ])
  );
}
