import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  maskContact,
  maskEmail,
  maskName,
  redactAuditMetadata,
} from "@/lib/demo/api-view";
import { hostedDemoDetail } from "@/lib/demo/hosted-preview";
import { getServerEnv } from "@/lib/validation/env";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (getServerEnv().HOSTED_DEMO_MODE) {
    const detail = hostedDemoDetail(params.id);
    return detail
      ? NextResponse.json({ data: detail })
      : NextResponse.json(
          { status: "not_found", message: "Recovery case not found" },
          { status: 404 }
        );
  }
  const recoveryCase = await prisma.recoveryCase.findUnique({
    where: { id: params.id },
    include: { auditEvents: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  if (!recoveryCase) {
    return NextResponse.json(
      { status: "not_found", message: "Recovery case not found" },
      { status: 404 }
    );
  }
  return NextResponse.json({
    data: {
      id: recoveryCase.id,
      originalPaymentId: recoveryCase.originalPaymentId,
      orderId: recoveryCase.orderId,
      amountPaise: recoveryCase.amount,
      currency: recoveryCase.currency,
      customerName: maskName(recoveryCase.customerName),
      customerEmail: maskEmail(recoveryCase.customerEmail),
      customerContact: maskContact(recoveryCase.customerContact),
      paymentMethod: recoveryCase.paymentMethod,
      failureCode: recoveryCase.failureCode,
      failureReason: recoveryCase.failureReason,
      attemptCount: recoveryCase.attemptCount,
      status: recoveryCase.status,
      selectedAction: recoveryCase.selectedAction,
      decisionReason: recoveryCase.decisionReason,
      confidence: recoveryCase.confidence,
      requiresApproval: recoveryCase.requiresApproval,
      hasPaymentLink: Boolean(recoveryCase.paymentLinkId),
      paymentLinkExpiry: recoveryCase.paymentLinkExpiry?.toISOString() ?? null,
      recoveredAmountPaise: recoveryCase.recoveredAmount,
      recoveredAt: recoveryCase.recoveredAt?.toISOString() ?? null,
      stoppedReason: recoveryCase.stoppedReason,
      synthetic: recoveryCase.isSynthetic,
      createdAt: recoveryCase.createdAt.toISOString(),
      updatedAt: recoveryCase.updatedAt.toISOString(),
      auditTimeline: recoveryCase.auditEvents.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        message: event.message,
        metadata: redactAuditMetadata(
          JSON.parse(event.metadata) as Record<string, unknown>
        ),
        createdAt: event.createdAt.toISOString(),
      })),
    },
  });
}
