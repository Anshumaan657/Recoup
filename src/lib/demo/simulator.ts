import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  createDemoDataset,
  DEFAULT_DEMO_SEED,
  DEMO_DATASET_VERSION,
  DemoScenario,
} from "./dataset";
import { calculateScenarioMetrics, RecoveryMetrics } from "@/lib/recovery/metrics";

export interface DemoRunPlan {
  runId: string;
  seed: number;
  datasetVersion: string;
  scenarios: DemoScenario[];
  expectedMetrics: RecoveryMetrics;
  synthetic: true;
}

const METRICS_TIME = new Date("2026-01-15T12:00:00.000Z");

export function createDemoRunPlan(seed = DEFAULT_DEMO_SEED): DemoRunPlan {
  const scenarios = createDemoDataset(seed);
  const digest = createHash("sha256")
    .update(`${DEMO_DATASET_VERSION}:${seed}`)
    .digest("hex")
    .slice(0, 20);
  return {
    runId: `demo_run_${digest}`,
    seed,
    datasetVersion: DEMO_DATASET_VERSION,
    scenarios,
    expectedMetrics: calculateScenarioMetrics(scenarios, METRICS_TIME),
    synthetic: true,
  };
}

export async function resetDemoOwnedRows(seed?: number): Promise<number> {
  const result = await prisma.demoRun.deleteMany({
    where:
      seed === undefined
        ? { synthetic: true }
        : { synthetic: true, datasetVersion: DEMO_DATASET_VERSION, seed },
  });
  return result.count;
}

export async function reserveDemoRun(
  seed = DEFAULT_DEMO_SEED,
  reset = false
): Promise<{
  plan: DemoRunPlan;
  alreadyRunning: boolean;
  reusedCompleted: boolean;
}> {
  const plan = createDemoRunPlan(seed);
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.demoRun.findUnique({
        where: {
          datasetVersion_seed: { datasetVersion: DEMO_DATASET_VERSION, seed },
        },
      });
      if (existing?.status === "running") {
        return { plan, alreadyRunning: true, reusedCompleted: false };
      }
      if (existing && !reset) {
        return {
          plan,
          alreadyRunning: existing.status !== "completed",
          reusedCompleted: existing.status === "completed",
        };
      }
      if (existing) await tx.demoRun.delete({ where: { id: existing.id } });
      await tx.demoRun.create({
        data: {
          id: plan.runId,
          datasetVersion: plan.datasetVersion,
          seed: plan.seed,
          status: "running",
          synthetic: true,
          expectedMetrics: JSON.stringify(plan.expectedMetrics),
        },
      });
      return { plan, alreadyRunning: false, reusedCompleted: false };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { plan, alreadyRunning: true, reusedCompleted: false };
    }
    throw error;
  }
}

export async function attachCaseToDemoRun(
  runId: string,
  recoveryCaseId: string
): Promise<void> {
  await prisma.recoveryCase.update({
    where: { id: recoveryCaseId },
    data: { demoRunId: runId, isSynthetic: true },
  });
}

export async function attachReceiptToDemoRun(
  runId: string,
  eventKey: string
): Promise<void> {
  await prisma.webhookReceipt.update({
    where: { eventKey },
    data: { demoRunId: runId },
  });
}

export async function completeDemoRun(
  runId: string,
  resultMetrics?: RecoveryMetrics
): Promise<void> {
  await prisma.demoRun.update({
    where: { id: runId },
    data: {
      status: "completed",
      completedAt: new Date(),
      resultMetrics: resultMetrics ? JSON.stringify(resultMetrics) : undefined,
    },
  });
}
