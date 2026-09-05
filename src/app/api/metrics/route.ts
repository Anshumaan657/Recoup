import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { RecoveryMetrics } from "@/lib/recovery/metrics";
import { hostedDemoMetricsResponse } from "@/lib/demo/hosted-preview";
import { getServerEnv } from "@/lib/validation/env";

export const dynamic = "force-dynamic";

const EMPTY_METRICS: RecoveryMetrics = {
  attempted: 0,
  contacted: 0,
  recovered: 0,
  stopped: 0,
  manualReview: 0,
  duplicatesPrevented: 0,
  totalCases: 0,
  totalAtRiskPaise: 0,
  recoveredPaise: 0,
  recoveryRate: 0,
  generatedAt: new Date(0).toISOString(),
  dataset: "synthetic",
};

export async function GET() {
  if (getServerEnv().HOSTED_DEMO_MODE) {
    return NextResponse.json(hostedDemoMetricsResponse());
  }
  const run = await prisma.demoRun.findFirst({
    where: { synthetic: true, status: "completed", resultMetrics: { not: null } },
    orderBy: { completedAt: "desc" },
  });
  const metrics = run?.resultMetrics
    ? (JSON.parse(run.resultMetrics) as RecoveryMetrics)
    : EMPTY_METRICS;
  return NextResponse.json({
    runId: run?.id ?? null,
    datasetVersion: run?.datasetVersion ?? null,
    synthetic: true,
    ...metrics,
    definitions: {
      attempted: "Cases where a recovery intervention was executed",
      contacted: "Attempted cases with an outbox customer intervention",
      stopped: "Late-capture or unrecoverable cases stopped before recovery",
      duplicatesPrevented: "Original late captures that stopped duplicate collection",
      recoveryRate: "recoveredPaise divided by totalAtRiskPaise",
    },
  });
}
