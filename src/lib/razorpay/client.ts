import { getServerEnv } from "@/lib/validation/env";

const RAZORPAY_API_BASE_URL = "https://api.razorpay.com/v1";
const DEFAULT_TIMEOUT_MS = 10_000;

export class RazorpayProviderError extends Error {
  constructor(
    public readonly category:
      | "configuration"
      | "timeout"
      | "network"
      | "provider"
      | "invalid_response",
    public readonly status: number,
    public readonly code: string,
    public readonly safeDetails: Record<string, unknown> = {}
  ) {
    super(`Razorpay request failed (${category})`);
    this.name = "RazorpayProviderError";
  }
}

function safeProviderDetails(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const body = value as Record<string, unknown>;
  const providerError =
    body.error && typeof body.error === "object"
      ? (body.error as Record<string, unknown>)
      : body;
  const safe: Record<string, unknown> = {};
  for (const key of ["code", "field", "reason", "source", "step"]) {
    const candidate = providerError[key];
    if (typeof candidate === "string") safe[key] = candidate.slice(0, 120);
  }
  const existing = providerError.payment_link ?? body.payment_link;
  if (existing && typeof existing === "object") {
    const link = existing as Record<string, unknown>;
    safe.paymentLink = {
      id: typeof link.id === "string" ? link.id : undefined,
      amount: typeof link.amount === "number" ? link.amount : undefined,
      currency: typeof link.currency === "string" ? link.currency : undefined,
      reference_id:
        typeof link.reference_id === "string" ? link.reference_id : undefined,
      short_url: typeof link.short_url === "string" ? link.short_url : undefined,
      expire_by: typeof link.expire_by === "number" ? link.expire_by : undefined,
    };
  }
  return safe;
}

export async function razorpayRequest<T>(
  path: "/payment_links" | `/payment_links/${string}/cancel`,
  options: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const env = getServerEnv();
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new RazorpayProviderError("configuration", 500, "CONFIG_MISSING");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(options.headers);
  headers.set(
    "Authorization",
    `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64")}`
  );
  headers.set("Accept", "application/json");
  headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${RAZORPAY_API_BASE_URL}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new RazorpayProviderError("timeout", 504, "TIMEOUT");
    }
    throw new RazorpayProviderError("network", 502, "NETWORK_ERROR");
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      if (response.ok) {
        throw new RazorpayProviderError("invalid_response", 502, "INVALID_JSON");
      }
    }
  }

  if (!response.ok) {
    const details = safeProviderDetails(body);
    const code =
      typeof details.code === "string" ? details.code : "PROVIDER_ERROR";
    throw new RazorpayProviderError("provider", response.status, code, details);
  }

  return body as T;
}

export function razorpayPost<T>(
  path: "/payment_links" | `/payment_links/${string}/cancel`,
  body: Record<string, unknown>,
  timeoutMs?: number
): Promise<T> {
  return razorpayRequest<T>(
    path,
    { method: "POST", body: JSON.stringify(body) },
    timeoutMs
  );
}
