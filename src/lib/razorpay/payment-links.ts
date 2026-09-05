import { createHash } from "crypto";
import { getServerEnv } from "@/lib/validation/env";
import { RazorpayProviderError, razorpayPost } from "./client";

export interface PaymentLinkRequest {
  amount: number;
  currency: "INR";
  reference_id: string;
  description: string;
  customer?: { name?: string; email?: string; contact?: string };
  expire_by: number;
  reminder_enable: false;
  notify: { email: boolean; sms: boolean };
  notes: { recovery_case_id: string };
}

export interface PaymentLinkResponse {
  id: string;
  entity: "payment_link";
  amount: number;
  currency: string;
  status: string;
  short_url: string;
  reference_id: string;
  description: string;
  customer?: { name?: string; email?: string; contact?: string } | null;
  expire_by: number;
  created_at: number;
  notes: Record<string, string>;
  simulated?: boolean;
}

function validateRequest(params: PaymentLinkRequest): void {
  if (!Number.isSafeInteger(params.amount) || params.amount <= 0) {
    throw new RazorpayProviderError("configuration", 400, "INVALID_AMOUNT");
  }
  if (params.currency !== "INR") {
    throw new RazorpayProviderError("configuration", 400, "INVALID_CURRENCY");
  }
  if (!/^recovery_[A-Za-z0-9_-]+$/.test(params.reference_id)) {
    throw new RazorpayProviderError("configuration", 400, "INVALID_REFERENCE");
  }
}

export function createSimulatedPaymentLink(
  params: PaymentLinkRequest
): PaymentLinkResponse {
  const digest = createHash("sha256")
    .update(params.reference_id)
    .digest("hex")
    .slice(0, 16);
  return {
    id: `plink_demo_${digest}`,
    entity: "payment_link",
    amount: params.amount,
    currency: params.currency,
    status: "created",
    short_url: `https://rzp.io/i/demo-${digest}`,
    reference_id: params.reference_id,
    description: params.description,
    customer: params.customer,
    expire_by: params.expire_by,
    created_at: Math.floor(Date.now() / 1000),
    notes: params.notes,
    simulated: true,
  };
}

function reconcileConflict(
  error: RazorpayProviderError,
  params: PaymentLinkRequest
): PaymentLinkResponse | null {
  const link = error.safeDetails.paymentLink;
  if (!link || typeof link !== "object") return null;
  const existing = link as Record<string, unknown>;
  if (
    typeof existing.id !== "string" ||
    existing.reference_id !== params.reference_id ||
    existing.amount !== params.amount ||
    existing.currency !== params.currency ||
    typeof existing.short_url !== "string"
  ) {
    return null;
  }
  return {
    id: existing.id,
    entity: "payment_link",
    amount: params.amount,
    currency: params.currency,
    status: "created",
    short_url: existing.short_url,
    reference_id: params.reference_id,
    description: params.description,
    customer: params.customer,
    expire_by:
      typeof existing.expire_by === "number"
        ? existing.expire_by
        : params.expire_by,
    created_at: Math.floor(Date.now() / 1000),
    notes: params.notes,
  };
}

export async function createPaymentLink(
  params: PaymentLinkRequest,
  timeoutMs?: number
): Promise<PaymentLinkResponse> {
  validateRequest(params);
  const env = getServerEnv();
  const hasCredentials = Boolean(
    env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
  );

  if (!env.ENABLE_RAZORPAY_LINKS || !hasCredentials) {
    if (env.DEMO_MODE) return createSimulatedPaymentLink(params);
    throw new RazorpayProviderError(
      "configuration",
      500,
      !env.ENABLE_RAZORPAY_LINKS ? "LINKS_DISABLED" : "CONFIG_MISSING"
    );
  }

  try {
    return await razorpayPost<PaymentLinkResponse>(
      "/payment_links",
      params as unknown as Record<string, unknown>,
      timeoutMs
    );
  } catch (error) {
    if (error instanceof RazorpayProviderError && error.status === 400) {
      const reconciled = reconcileConflict(error, params);
      if (reconciled) return reconciled;
    }
    throw error;
  }
}

export async function cancelPaymentLink(paymentLinkId: string): Promise<void> {
  if (!/^plink_[A-Za-z0-9_-]+$/.test(paymentLinkId)) return;
  const env = getServerEnv();
  if (
    paymentLinkId.startsWith("plink_demo_") ||
    !env.ENABLE_RAZORPAY_LINKS ||
    !env.RAZORPAY_KEY_ID ||
    !env.RAZORPAY_KEY_SECRET
  ) {
    return;
  }
  await razorpayPost<Record<string, unknown>>(
    `/payment_links/${paymentLinkId}/cancel`,
    {}
  );
}

export function buildPaymentLinkParams(input: {
  caseId: string;
  amount: number;
  currency: string;
  customerName: string | null;
  customerEmail: string | null;
  customerContact: string | null;
  description?: string;
  expiresAt: Date;
  providerNotifications?: boolean;
}): PaymentLinkRequest {
  if (input.currency !== "INR") {
    throw new RazorpayProviderError("configuration", 400, "INVALID_CURRENCY");
  }
  const customer = {
    ...(input.customerName ? { name: input.customerName.slice(0, 100) } : {}),
    ...(input.customerEmail ? { email: input.customerEmail } : {}),
    ...(input.customerContact ? { contact: input.customerContact } : {}),
  };
  return {
    amount: input.amount,
    currency: "INR",
    reference_id: `recovery_${input.caseId}`,
    description: (input.description ?? "Complete your pending payment").slice(0, 255),
    ...(Object.keys(customer).length ? { customer } : {}),
    expire_by: Math.floor(input.expiresAt.getTime() / 1000),
    reminder_enable: false,
    notify: {
      email: Boolean(input.providerNotifications && input.customerEmail),
      sms: Boolean(input.providerNotifications && input.customerContact),
    },
    notes: { recovery_case_id: input.caseId },
  };
}
