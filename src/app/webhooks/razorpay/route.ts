import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/validation/env";
import { verifyRazorpaySignature } from "@/lib/razorpay/signatures";
import { isSupportedEvent, getSchemaForEvent, SupportedWebhookEvent } from "@/lib/validation/webhooks";
import {
  handlePaymentFailedInTransaction,
  handlePaymentCapturedInTransaction,
  handlePaymentLinkPaidInTransaction,
  findWebhookReceiptByEventKey,
} from "@/lib/recovery/service";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function deriveEventKey(event: SupportedWebhookEvent, rawBody: Buffer): string {
  const topLevelEventId = (event as Record<string, unknown>).id;
  if (topLevelEventId && typeof topLevelEventId === "string" && topLevelEventId.startsWith("evt_")) {
    return `razorpay:event:${topLevelEventId}`;
  }

  const providerEventId = (event.payload.payment as Record<string, unknown>)?.id
    ?? (event.payload.payment_link as Record<string, unknown>)?.id;

  const eventType = event.event;
  const paymentOrLinkId = providerEventId ?? "unknown";
  const createdAt = String(event.created_at);
  const payloadHash = sha256(rawBody);

  return `razorpay:${eventType}:${paymentOrLinkId}:${createdAt}:${payloadHash}`;
}

async function handleWithIdempotency(
  eventKey: string,
  providerEvent: string,
  payloadHash: string,
  handler: () => Promise<{ outcome: string; caseId?: string; isDuplicate: boolean }>
) {
  try {
    return await handler();
  } catch (error) {
    const prismaError = error as Prisma.PrismaClientKnownRequestError;
    const meta = prismaError.meta as { target?: string[] } | undefined;
    if (prismaError.code === "P2002" && meta?.target?.includes("event_key")) {
      const existingReceipt = await findWebhookReceiptByEventKey(eventKey);
      if (existingReceipt) {
        return {
          outcome: existingReceipt.outcome,
          caseId: undefined,
          isDuplicate: true,
        };
      }
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  const env = getServerEnv();
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return NextResponse.json(
      { status: "error", message: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  const signature = request.headers.get("x-razorpay-signature");
  if (!signature) {
    return NextResponse.json(
      { status: "error", message: "Missing signature header" },
      { status: 401 }
    );
  }

  let rawBody: Buffer;
  try {
    rawBody = Buffer.from(await request.arrayBuffer());
  } catch {
    return NextResponse.json(
      { status: "error", message: "Failed to read request body" },
      { status: 400 }
    );
  }

  if (!verifyRazorpaySignature(rawBody, signature, webhookSecret)) {
    return NextResponse.json(
      { status: "error", message: "Invalid signature" },
      { status: 401 }
    );
  }

  let parsedEvent: SupportedWebhookEvent;
  try {
    const jsonBody = JSON.parse(rawBody.toString("utf-8"));
    const eventType = jsonBody.event;

    if (!isSupportedEvent(eventType)) {
      return NextResponse.json(
        { status: "ignored", duplicate: false, reason: "unsupported_event" },
        { status: 200 }
      );
    }

    const schema = getSchemaForEvent(eventType);
    if (!schema) {
      return NextResponse.json(
        { status: "ignored", duplicate: false, reason: "unsupported_event" },
        { status: 200 }
      );
    }

    parsedEvent = schema.parse(jsonBody);
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid webhook payload" },
      { status: 400 }
    );
  }

  const eventKey = deriveEventKey(parsedEvent, rawBody);
  const providerEvent = parsedEvent.event;
  const payloadHash = sha256(rawBody);

  const existingReceipt = await findWebhookReceiptByEventKey(eventKey);
  if (existingReceipt) {
    return NextResponse.json(
      { status: existingReceipt.outcome, duplicate: true },
      { status: 200 }
    );
  }

  let result: { outcome: string; caseId?: string; isDuplicate: boolean };

  try {
    switch (parsedEvent.event) {
      case "payment.failed": {
        result = await handleWithIdempotency(eventKey, providerEvent, payloadHash, () =>
          handlePaymentFailedInTransaction(
            { payment: parsedEvent.payload.payment as Record<string, unknown> },
            rawBody,
            eventKey,
            providerEvent,
            payloadHash
          )
        );
        break;
      }
      case "payment.captured": {
        result = await handleWithIdempotency(eventKey, providerEvent, payloadHash, () =>
          handlePaymentCapturedInTransaction(
            { payment: parsedEvent.payload.payment as Record<string, unknown> },
            eventKey,
            providerEvent,
            payloadHash
          )
        );
        break;
      }
      case "payment_link.paid": {
        result = await handleWithIdempotency(eventKey, providerEvent, payloadHash, () =>
          handlePaymentLinkPaidInTransaction(
            { payment_link: parsedEvent.payload.payment_link as Record<string, unknown> },
            eventKey,
            providerEvent,
            payloadHash
          )
        );
        break;
      }
      default:
        result = { outcome: "ignored_unsupported_event", caseId: undefined, isDuplicate: false };
    }
  } catch {
    console.error("Webhook processing failed");
    return NextResponse.json(
      { status: "error", message: "Internal processing failure" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { status: result.outcome, duplicate: result.isDuplicate, caseId: result.caseId },
    { status: 200 }
  );
}
