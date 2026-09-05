import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getServerEnv,
  resetServerEnvCache,
} from "@/lib/validation/env";
import { TEST_DATABASE_URL } from "../test-database";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  resetServerEnvCache();
  vi.resetModules();
});

describe("Strict Boolean Environment Parsing", () => {
  it("parses boolean true as true", () => {
    process.env.ENABLE_RAZORPAY_LINKS = "true";
    process.env.DEMO_MODE = "true";
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

    const env = getServerEnv();
    expect(env.ENABLE_RAZORPAY_LINKS).toBe(true);
    expect(env.DEMO_MODE).toBe(true);
  });

  it("parses boolean false as false", () => {
    process.env.ENABLE_RAZORPAY_LINKS = "false";
    process.env.DEMO_MODE = "false";
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

    const env = getServerEnv();
    expect(env.ENABLE_RAZORPAY_LINKS).toBe(false);
    expect(env.DEMO_MODE).toBe(false);
  });

  it("uses defaults when values are missing", () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

    const env = getServerEnv();
    expect(env.ENABLE_RAZORPAY_LINKS).toBe(false);
    expect(env.DEMO_MODE).toBe(true);
  });

  it("rejects invalid string values like 'yes'", () => {
    process.env.ENABLE_RAZORPAY_LINKS = "yes";
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

    expect(() => getServerEnv()).toThrow("Invalid server environment");
  });

  it("rejects invalid string values like 'no'", () => {
    process.env.ENABLE_RAZORPAY_LINKS = "no";
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

    expect(() => getServerEnv()).toThrow("Invalid server environment");
  });

  it("rejects '1' as invalid boolean", () => {
    process.env.ENABLE_RAZORPAY_LINKS = "1";
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

    expect(() => getServerEnv()).toThrow("Invalid server environment");
  });

  it("rejects '0' as invalid boolean", () => {
    process.env.ENABLE_RAZORPAY_LINKS = "0";
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

    expect(() => getServerEnv()).toThrow("Invalid server environment");
  });

  it("rejects empty string as invalid boolean", () => {
    process.env.ENABLE_RAZORPAY_LINKS = "";
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

    expect(() => getServerEnv()).toThrow("Invalid server environment");
  });

  it("rejects arbitrary strings as invalid boolean", () => {
    process.env.ENABLE_RAZORPAY_LINKS = "maybe";
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

    expect(() => getServerEnv()).toThrow("Invalid server environment");
  });

  it("does not cache stale values across calls", async () => {
    process.env.ENABLE_RAZORPAY_LINKS = "true";
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

    const env1 = getServerEnv();
    expect(env1.ENABLE_RAZORPAY_LINKS).toBe(true);

    process.env.ENABLE_RAZORPAY_LINKS = "false";
    vi.resetModules();
    const { getServerEnv: getServerEnvFresh } = await import("@/lib/validation/env");
    const env2 = getServerEnvFresh();
    expect(env2.ENABLE_RAZORPAY_LINKS).toBe(false);
  });
});
