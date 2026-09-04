import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const gracePeriod = 90 * 1000;

  await prisma.auditEvent.deleteMany();
  await prisma.notificationOutbox.deleteMany();
  await prisma.webhookReceipt.deleteMany();
  await prisma.recoveryCase.deleteMany();

  const cases = [
    {
      originalPaymentId: "pay_test_insufficient_funds_001",
      orderId: "order_INR_50000",
      amount: 50000,
      currency: "INR",
      customerName: "Rajesh Kumar",
      customerEmail: "rajesh@example.com",
      customerContact: "+919876543210",
      paymentMethod: "upi",
      failureCode: "INSUFFICIENT_FUNDS",
      failureReason: "Insufficient balance in account",
      failureSource: "bank",
      failureStep: "payment_processing",
      attemptCount: 0,
      status: "waiting",
      graceExpiresAt: new Date(now.getTime() + gracePeriod),
    },
    {
      originalPaymentId: "pay_test_bank_downtime_002",
      orderId: "order_INR_75000",
      amount: 75000,
      currency: "INR",
      customerName: "Priya Sharma",
      customerEmail: "priya@example.com",
      customerContact: "+919876543211",
      paymentMethod: "netbanking",
      failureCode: "BANK_DOWN",
      failureReason: "Bank server unavailable",
      failureSource: "bank",
      failureStep: "authorization",
      attemptCount: 0,
      status: "waiting",
      graceExpiresAt: new Date(now.getTime() + gracePeriod),
    },
    {
      originalPaymentId: "pay_test_auth_failure_003",
      orderId: "order_INR_30000",
      amount: 30000,
      currency: "INR",
      customerName: "Amit Patel",
      customerEmail: "amit@example.com",
      customerContact: "+919876543212",
      paymentMethod: "card",
      failureCode: "AUTH_FAILED",
      failureReason: "Authentication failed - incorrect OTP",
      failureSource: "customer",
      failureStep: "authentication",
      attemptCount: 0,
      status: "waiting",
      graceExpiresAt: new Date(now.getTime() + gracePeriod),
    },
    {
      originalPaymentId: "pay_test_user_cancelled_004",
      orderId: "order_INR_100000",
      amount: 100000,
      currency: "INR",
      customerName: "Sneha Singh",
      customerEmail: "sneha@example.com",
      customerContact: "+919876543213",
      paymentMethod: "upi",
      failureCode: "USER_CANCELLED",
      failureReason: "Customer cancelled the payment",
      failureSource: "customer",
      failureStep: "payment_confirmation",
      attemptCount: 0,
      status: "waiting",
      graceExpiresAt: new Date(now.getTime() + gracePeriod),
    },
    {
      originalPaymentId: "pay_test_gateway_error_005",
      orderId: "order_INR_25000",
      amount: 25000,
      currency: "INR",
      customerName: "Vikram Mehta",
      customerEmail: "vikram@example.com",
      customerContact: "+919876543214",
      paymentMethod: "wallet",
      failureCode: "GATEWAY_ERROR",
      failureReason: "Technical error at payment gateway",
      failureSource: "gateway",
      failureStep: "payment_processing",
      attemptCount: 0,
      status: "waiting",
      graceExpiresAt: new Date(now.getTime() + gracePeriod),
    },
    {
      originalPaymentId: "pay_test_high_value_006",
      orderId: "order_INR_500000",
      amount: 500000,
      currency: "INR",
      customerName: "Corporate Client Ltd",
      customerEmail: "finance@corporate.example.com",
      customerContact: "+919876543215",
      paymentMethod: "netbanking",
      failureCode: "HIGH_RISK",
      failureReason: "Transaction flagged as high risk",
      failureSource: "risk",
      failureStep: "risk_check",
      attemptCount: 0,
      status: "waiting",
      graceExpiresAt: new Date(now.getTime() + gracePeriod),
      requiresApproval: true,
    },
  ];

  for (const c of cases) {
    const createdCase = await prisma.recoveryCase.create({
      data: {
        ...c,
        auditEvents: {
          create: [
            {
              eventType: "payment_failed_received",
              message: `Payment failed: ${c.failureReason}`,
              metadata: JSON.stringify({
                failureCode: c.failureCode,
                failureSource: c.failureSource,
                failureStep: c.failureStep,
              }),
            },
            {
              eventType: "grace_started",
              message: `Grace period started, expires at ${c.graceExpiresAt?.toISOString()}`,
              metadata: JSON.stringify({ graceSeconds: 90 }),
            },
          ],
        },
      },
    });
    console.log(`Created case: ${createdCase.id} (${createdCase.originalPaymentId})`);
  }

  console.log("Seeding completed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });