import { DEFAULT_DEMO_SEED } from "../src/lib/demo/dataset";
import { replayDemoEvaluation } from "../src/lib/demo/replay";
import { prisma } from "../src/lib/db/prisma";
import { getServerEnv } from "../src/lib/validation/env";

async function main() {
  if (!getServerEnv().DEMO_MODE) {
    throw new Error("DEMO_MODE must be true to replay synthetic evaluation data");
  }
  const result = await replayDemoEvaluation(DEFAULT_DEMO_SEED, true);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main()
  .catch(() => {
    process.stderr.write("Demo replay failed\n");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
