import { prisma } from "@/lib/db/prisma";
import { RecoveryStatus } from "@/types/domain";
import { RecoveryMetrics } from "@/lib/recovery/metrics";

const STOPPED_REASONS = [
  "late_capture",
  "unrecoverable",
  "customer_opt_out",
];

export async function calculateStoredDemoMetrics(
  runId: string,
  generatedAt: Date
): Promise<RecoveryMetrics> {
  const cases = await prisma.recoveryCase.findMany({
    where: { demoRunId: runId, isSynthetic: true },
    select: {
      amount: true,
      attemptCount: true,
      status: true,
      stoppedReason: true,
      recoveredAmount: true,
    },
  });

  const totalAtRiskPaise = cases.reduce((sum, item) => sum + item.amount, 0);
  const recoveredPaise = cases.reduce(
    (sum, item) =>
      item.status === RecoveryStatus.recovered
        ? sum + (item.recoveredAmount ?? 0)
        : sum,
    0
  );
  const attempted = cases.filter(({ attemptCount }) => attemptCount > 0).length;

  return {
    attempted,
    contacted: attempted,
    recovered: cases.filter(({ status }) => status === RecoveryStatus.recovered).length,
    stopped: cases.filter(({ stoppedReason }) =>
      stoppedReason ? STOPPED_REASONS.includes(stoppedReason) : false
    ).length,
    manualReview: cases.filter(
      ({ status }) => status === RecoveryStatus.manual_review
    ).length,
    duplicatesPrevented: cases.filter(
      ({ stoppedReason }) => stoppedReason === "late_capture"
    ).length,
    totalCases: cases.length,
    totalAtRiskPaise,
    recoveredPaise,
    recoveryRate:
      totalAtRiskPaise === 0 ? 0 : recoveredPaise / totalAtRiskPaise,
    generatedAt: generatedAt.toISOString(),
    dataset: "synthetic",
  };
}
