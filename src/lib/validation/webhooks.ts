import { z } from "zod";

const baseRazorpayEntity = z.object({
  id: z.string().min(1),
  entity: z.string().min(1),
});

const paymentEntity = baseRazorpayEntity.extend({
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  status: z.string(),
  order_id: z.string().min(1),
  method: z.string().optional(),
  error_code: z.string().optional(),
  error_description: z.string().optional(),
  error_source: z.string().optional(),
  error_step: z.string().optional(),
  error_reason: z.string().optional(),
  captured: z.boolean().optional(),
  email: z.string().email().optional(),
  contact: z.string().optional(),
  notes: z.record(z.string()).optional(),
}).passthrough();

const paymentLinkEntity = baseRazorpayEntity.extend({
  id: z.string().min(1),
  reference_id: z.string().optional(),
  notes: z.record(z.string()).optional(),
  amount: z.number().int().positive().optional(),
  currency: z.string().length(3).optional(),
}).passthrough();

const webhookEnvelope = z.object({
  event: z.string().min(1),
  account_id: z.string().optional(),
  created_at: z.number().int().positive(),
  payload: z.object({
    payment: paymentEntity.optional(),
    payment_link: paymentLinkEntity.optional(),
  }).passthrough(),
}).passthrough();

export const paymentFailedSchema = webhookEnvelope.refine(
  (data) => data.event === "payment.failed" && data.payload.payment !== undefined,
  { message: "Expected event payment.failed with payment payload" }
);

export const paymentCapturedSchema = webhookEnvelope.refine(
  (data) => data.event === "payment.captured" && data.payload.payment !== undefined,
  { message: "Expected event payment.captured with payment payload" }
);

export const paymentLinkPaidSchema = webhookEnvelope.refine(
  (data) => data.event === "payment_link.paid" && data.payload.payment_link !== undefined,
  { message: "Expected event payment_link.paid with payment_link payload" }
);

export const supportedEventSchemas = {
  "payment.failed": paymentFailedSchema,
  "payment.captured": paymentCapturedSchema,
  "payment_link.paid": paymentLinkPaidSchema,
} as const;

export type PaymentFailedEvent = z.infer<typeof paymentFailedSchema>;
export type PaymentCapturedEvent = z.infer<typeof paymentCapturedSchema>;
export type PaymentLinkPaidEvent = z.infer<typeof paymentLinkPaidSchema>;
export type SupportedWebhookEvent = PaymentFailedEvent | PaymentCapturedEvent | PaymentLinkPaidEvent;

export function isSupportedEvent(event: string): boolean {
  return event in supportedEventSchemas;
}

export function getSchemaForEvent(event: string) {
  return supportedEventSchemas[event as keyof typeof supportedEventSchemas];
}