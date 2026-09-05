import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/validation/env";
import { verifyRazorpaySignature } from "@/lib/razorpay/signatures";
import {
  getSchemaForEvent,
  isSupportedEvent,
  SupportedWebhookEvent,
} from "@/lib/validation/webhooks";
import {
  findWebhookReceiptByEventKey,
  handlePaymentCapturedInTransaction,
  handlePaymentFailedInTransaction,
  handlePaymentLinkPaidInTransaction,
} from "@/lib/recovery/service";
import { cancelRecoveryLinkAfterCapture } from "@/lib/recovery/executor";

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function deriveEventKey(event: SupportedWebhookEvent, rawBody: Buffer): string {
  const topLevelEventId = (event as Record<string, unknown>).id;
  if (
    typeof topLevelEventId === "string" &&
    topLevelEventId.startsWith("evt_")
  ) {
    return `razorpay:event:${topLevelEventId}`;
  }
  const providerEventId =
    (event.payload.payment as Record<string, unknown>)?.id ??
    (event.payload.payment_link as Record<string, unknown>)?.id;
  return `razorpay:${event.event}:${providerEventId ?? "unknown"}:${String(
    event.created_at
  )}:${sha256(rawBody)}`;
}

async function handleWithIdempotency(
  eventKey: string,
  handler: () => Promise<{
    outcome: string;
    caseId?: string;
    isDuplicate: boolean;
  }>
) {
  try {
    return await handler();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const target = (error.meta as { target?: string[] } | undefined)?.target;
      if (target?.includes("event_key")) {
        const existing = await findWebhookReceiptByEventKey(eventKey);
        if (existing) {
          return {
            outcome: existing.outcome,
            caseId: undefined,
            isDuplicate: true,
          };
        }
      }
    }
    throw error;
  }
}

export async function ingestRazorpayWebhook(
  request: NextRequest,
  internalWebhookSecret?: string
) {
  const webhookSecret =
    internalWebhookSecret ?? getServerEnv().RAZORPAY_WEBHOOK_SECRET;
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
    const jsonBody = JSON.parse(rawBody.toString("utf8")) as {
      event?: string;
    };
    if (!jsonBody.event || !isSupportedEvent(jsonBody.event)) {
      return NextResponse.json(
        { status: "ignored", duplicate: false, reason: "unsupported_event" },
        { status: 200 }
      );
    }
    const schema = getSchemaForEvent(jsonBody.event);
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

  try {
    let result: {
      outcome: string;
      caseId?: string;
      isDuplicate: boolean;
    };
    switch (parsedEvent.event) {
      case "payment.failed":
        result = await handleWithIdempotency(eventKey, () =>
          handlePaymentFailedInTransaction(
            { payment: parsedEvent.payload.payment as Record<string, unknown> },
            rawBody,
            eventKey,
            providerEvent,
            payloadHash
          )
        );
        break;
      case "payment.captured":
        result = await handleWithIdempotency(eventKey, () =>
          handlePaymentCapturedInTransaction(
            { payment: parsedEvent.payload.payment as Record<string, unknown> },
            eventKey,
            providerEvent,
            payloadHash
          )
        );
        if (!result.isDuplicate && result.outcome === "closed" && result.caseId) {
          await cancelRecoveryLinkAfterCapture(result.caseId);
        }
        break;
      case "payment_link.paid":
        result = await handleWithIdempotency(eventKey, () =>
          handlePaymentLinkPaidInTransaction(
            {
              payment_link: parsedEvent.payload.payment_link as Record<
                string,
                unknown
              >,
            },
            eventKey,
            providerEvent,
            payloadHash
          )
        );
        break;
      default:
        result = {
          outcome: "ignored_unsupported_event",
          caseId: undefined,
          isDuplicate: false,
        };
    }
    return NextResponse.json(
      {
        status: result.outcome,
        duplicate: result.isDuplicate,
        caseId: result.caseId,
      },
      { status: 200 }
    );
  } catch {
    console.error("Webhook processing failed");
    return NextResponse.json(
      { status: "error", message: "Internal processing failure" },
      { status: 500 }
    );
  }
}
