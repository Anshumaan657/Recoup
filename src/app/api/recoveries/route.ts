import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { maskContact, maskEmail, maskName } from "@/lib/demo/api-view";
import { RecoveryAction, RecoveryStatus } from "@/types/domain";
import { HOSTED_DEMO_CASES } from "@/lib/demo/hosted-preview";
import { getServerEnv } from "@/lib/validation/env";

const querySchema = z.object({
  status: z.nativeEnum(RecoveryStatus).optional(),
  action: z.nativeEnum(RecoveryAction).optional(),
  synthetic: z.enum(["true", "false"]).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(100)).default("50"),
  offset: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0)).default("0"),
});

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { status: "invalid_request", message: "Invalid recovery query" },
      { status: 400 }
    );
  }
  const { status, action, synthetic, limit, offset } = parsed.data;
  if (getServerEnv().HOSTED_DEMO_MODE) {
    const filtered = HOSTED_DEMO_CASES.filter((item) =>
      (!status || item.status === status) &&
      (!action || item.selectedAction === action) &&
      (!synthetic || item.synthetic === (synthetic === "true"))
    ).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return NextResponse.json({
      data: filtered.slice(offset, offset + limit),
      pagination: { total: filtered.length, limit, offset },
    });
  }
  const where = {
    ...(status ? { status } : {}),
    ...(action ? { selectedAction: action } : {}),
    ...(synthetic ? { isSynthetic: synthetic === "true" } : {}),
  };
  const [cases, total] = await Promise.all([
    prisma.recoveryCase.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
      skip: offset,
    }),
    prisma.recoveryCase.count({ where }),
  ]);
  return NextResponse.json({
    data: cases.map((item) => ({
      id: item.id,
      originalPaymentId: item.originalPaymentId,
      orderId: item.orderId,
      amountPaise: item.amount,
      currency: item.currency,
      customerName: maskName(item.customerName),
      customerEmail: maskEmail(item.customerEmail),
      customerContact: maskContact(item.customerContact),
      paymentMethod: item.paymentMethod,
      failureReason: item.failureReason,
      attemptCount: item.attemptCount,
      status: item.status,
      selectedAction: item.selectedAction,
      requiresApproval: item.requiresApproval,
      hasPaymentLink: Boolean(item.paymentLinkId),
      recoveredAmountPaise: item.recoveredAmount,
      stoppedReason: item.stoppedReason,
      synthetic: item.isSynthetic,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    pagination: { total, limit, offset },
  });
}
