import { closeSync, existsSync, openSync } from "fs";
import { isAbsolute, resolve } from "path";
import { execFileSync } from "child_process";

const repositoryRoot = process.cwd();
const prismaBinary = resolve(repositoryRoot, "node_modules", ".bin", "prisma");
const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";

function resolveSqlitePath(url: string): string {
  if (!url.startsWith("file:")) {
    throw new Error("Local setup supports only a file: SQLite DATABASE_URL");
  }
  const configuredPath = url.slice("file:".length);
  if (!configuredPath || configuredPath.includes("?") || configuredPath.includes("#")) {
    throw new Error("DATABASE_URL must identify one plain SQLite .db file");
  }
  const databasePath = isAbsolute(configuredPath)
    ? resolve(configuredPath)
    : resolve(repositoryRoot, "prisma", configuredPath);
  if (!databasePath.endsWith(".db")) {
    throw new Error("DATABASE_URL must end in .db");
  }
  return databasePath;
}

function main(): void {
  const databasePath = resolveSqlitePath(databaseUrl);
  if (!existsSync(prismaBinary)) {
    throw new Error("Prisma is not installed; run npm ci first");
  }

  // Prisma 5 on macOS can fail when creating an absolute-path SQLite file.
  // Opening in append mode creates only the configured file and never truncates it.
  closeSync(openSync(databasePath, "a"));
  execFileSync(prismaBinary, ["migrate", "deploy"], {
    cwd: repositoryRoot,
    env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
    stdio: "inherit",
  });
  console.log(`Database migrations ready: ${databasePath}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown database setup failure";
  console.error(`Database setup failed: ${message}`);
  process.exitCode = 1;
}
