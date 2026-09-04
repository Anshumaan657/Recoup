import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getServerEnv } from "@/lib/validation/env";
import { verifyRazorpaySignature } from "@/lib/razorpay/signatures";
import { isSupportedEvent, getSchemaForEvent, SupportedWebhookEvent } from "@/lib/validation/webhooks";
import {
  handlePaymentFailed,
  handlePaymentCaptured,
  handlePaymentLinkPaid,
  createWebhookReceipt,
  findWebhookReceiptByEventKey,
  updateWebhookReceiptOutcome,
} from "@/lib/recovery/service";
import { createHash } from "crypto";

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function deriveEventKey(event: SupportedWebhookEvent, rawBody: Buffer): string {
  const providerEventId = (event.payload.payment as Record<string, unknown>)?.id
    ?? (event.payload.payment_link as Record<string, unknown>)?.id;

  if (providerEventId && typeof providerEventId === "string" && providerEventId.startsWith("evt_")) {
    return `razorpay:event:${providerEventId}`;
  }

  const eventType = event.event;
  const paymentOrLinkId = providerEventId ?? "unknown";
  const createdAt = String(event.created_at);
  const payloadHash = sha256(rawBody);

  return `razorpay:${eventType}:${paymentOrLinkId}:${createdAt}:${payloadHash}`;
}

async function insertWebhookReceipt(
  eventKey: string,
  providerEvent: string,
  payloadHash: string,
  outcome: string
) {
  return createWebhookReceipt(eventKey, providerEvent, payloadHash, outcome);
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

  let receipt;
  try {
    receipt = await insertWebhookReceipt(eventKey, providerEvent, payloadHash, "processing");
  } catch (error: unknown) {
    const prismaError = error as { code?: string };
    if (prismaError.code === "P2002") {
      const existingReceipt = await findWebhookReceiptByEventKey(eventKey);
      if (existingReceipt) {
        return NextResponse.json(
          { status: existingReceipt.outcome, duplicate: true },
          { status: 200 }
        );
      }
    }
    return NextResponse.json(
      { status: "error", message: "Failed to record webhook receipt" },
      { status: 500 }
    );
  }

  let outcome: string;
  let caseId: string | undefined;
  let isDuplicateCase = false;

  try {
    switch (parsedEvent.event) {
      case "payment.failed": {
        const result = await handlePaymentFailed(
          { payment: parsedEvent.payload.payment as Record<string, unknown> },
          rawBody,
          eventKey
        );
        outcome = result.isDuplicate ? "duplicate" : "created";
        caseId = result.recoveryCase.id;
        isDuplicateCase = result.isDuplicate;
        break;
      }
      case "payment.captured": {
        const result = await handlePaymentCaptured(
          { payment: parsedEvent.payload.payment as Record<string, unknown> },
          eventKey
        );
        outcome = result.wasAlreadyClosed ? "duplicate" : (result.recoveryCase ? "closed" : "ignored_no_case");
        caseId = result.recoveryCase?.id;
        isDuplicateCase = result.wasAlreadyClosed;
        break;
      }
      case "payment_link.paid": {
        const result = await handlePaymentLinkPaid(
          { payment_link: parsedEvent.payload.payment_link as Record<string, unknown> },
          eventKey
        );
        if (!result.recoveryCase) {
          outcome = "ignored_unknown_payment_link";
        } else {
          outcome = result.isDuplicate ? "duplicate" : "recovered";
          caseId = result.recoveryCase.id;
          isDuplicateCase = result.isDuplicate;
        }
        break;
      }
      default:
        outcome = "ignored_unsupported_event";
    }
  } catch (error) {
    console.error("Webhook handling error:", error);
    outcome = "error";
  }

  try {
    await updateWebhookReceiptOutcome(receipt.id, outcome);
  } catch {
    // If we can't update the receipt, the outcome is still recorded as "processing"
    // This is acceptable for idempotency since the receipt exists
  }

  const isDuplicate = receipt.outcome !== "processing" && receipt.outcome !== outcome;
  return NextResponse.json(
    { status: outcome, duplicate: isDuplicateCase, caseId },
    { status: 200 }
  );
}