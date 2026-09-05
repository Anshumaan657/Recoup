import { resetDemoOwnedRows } from "../src/lib/demo/simulator";
import { prisma } from "../src/lib/db/prisma";
import { getServerEnv } from "../src/lib/validation/env";

async function main() {
  if (!getServerEnv().DEMO_MODE) {
    throw new Error("DEMO_MODE must be true to reset synthetic evaluation data");
  }
  const removedRuns = await resetDemoOwnedRows();
  process.stdout.write(
    `${JSON.stringify({ synthetic: true, removedRuns }, null, 2)}\n`
  );
}

main()
  .catch(() => {
    process.stderr.write("Demo reset failed\n");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
