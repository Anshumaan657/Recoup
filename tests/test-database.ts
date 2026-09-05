import { resolve, sep } from "path";

export const TEST_DB_PATH = resolve(process.cwd(), "prisma", "test.db");
export const TEST_DATABASE_URL = `file:${TEST_DB_PATH}`;

export function assertSafeTestDatabaseUrl(
  databaseUrl: string | undefined = process.env.DATABASE_URL
): string {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set; refusing destructive test database access");
  }

  if (!databaseUrl.startsWith("file:")) {
    throw new Error("Test DATABASE_URL must use the file: protocol");
  }

  const rawPath = databaseUrl.slice("file:".length);
  if (!rawPath) {
    throw new Error("Test DATABASE_URL does not contain a database path");
  }

  const resolvedPath = resolve(rawPath);
  if (resolvedPath.endsWith(`${sep}dev.db`)) {
    throw new Error("Refusing destructive test access to dev.db");
  }

  if (resolvedPath !== TEST_DB_PATH) {
    throw new Error(`Refusing destructive test access outside ${TEST_DB_PATH}`);
  }

  return resolvedPath;
}
