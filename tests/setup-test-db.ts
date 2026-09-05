import { execFileSync } from "child_process";
import { closeSync, existsSync, openSync, rmSync } from "fs";
import { resolve } from "path";
import {
  assertSafeTestDatabaseUrl,
  TEST_DATABASE_URL,
  TEST_DB_PATH,
} from "./test-database";

const MIGRATIONS_DIR = resolve(process.cwd(), "prisma", "migrations");
const MIGRATION_LOCK = resolve(MIGRATIONS_DIR, "migration_lock.toml");
const PRISMA_BIN = resolve(process.cwd(), "node_modules", ".bin", "prisma");

export function initializeTestDatabase(): void {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const safePath = assertSafeTestDatabaseUrl();

  if (!existsSync(MIGRATIONS_DIR) || !existsSync(MIGRATION_LOCK)) {
    throw new Error("Committed Prisma migrations are required before tests can run");
  }

  if (!existsSync(PRISMA_BIN)) {
    throw new Error("Prisma is not installed; run npm ci before npm test");
  }

  rmSync(safePath, { force: true });
  rmSync(`${safePath}-journal`, { force: true });
  // Pre-create only the asserted-safe target. This avoids a Prisma 5 macOS
  // schema-engine failure when the engine itself creates an absolute-path DB.
  closeSync(openSync(safePath, "wx"));

  execFileSync(PRISMA_BIN, ["migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "inherit",
  });

  if (!existsSync(safePath)) {
    throw new Error(`Prisma did not create the expected test database at ${safePath}`);
  }
}

function main(): void {
  try {
    initializeTestDatabase();
    console.log(`Test database ready: ${TEST_DB_PATH}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown setup failure";
    console.error(`Test database setup failed: ${message}`);
    process.exitCode = 1;
  }
}

main();
