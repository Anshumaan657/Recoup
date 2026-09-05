import { z } from "zod";

const strictBoolean = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .transform((val) => {
    if (typeof val === "boolean") return val;
    return val === "true";
  });

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().url().optional(),
  AI_MODEL: z.string().optional(),
  RECOVERY_GRACE_SECONDS: z.coerce.number().int().positive().default(90),
  MAX_RECOVERY_ATTEMPTS: z.coerce.number().int().positive().default(1),
  ENABLE_RAZORPAY_LINKS: strictBoolean.default(false),
  DEMO_MODE: strictBoolean.default(true),
  APPROVAL_THRESHOLD_PAISE: z.coerce.number().int().positive().default(500000),
});

const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

let serverEnv: z.infer<typeof serverEnvSchema> | null = null;
let clientEnv: z.infer<typeof clientEnvSchema> | null = null;

export function getServerEnv(): z.infer<typeof serverEnvSchema> {
  if (serverEnv) return serverEnv;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    const messages = Object.entries(errors)
      .map(([field, msgs]) => `${field}: ${msgs.join(", ")}`)
      .join("; ");
    throw new Error(`Invalid server environment: ${messages}`);
  }

  serverEnv = parsed.data;
  return serverEnv;
}

export function resetServerEnvCache(): void {
  serverEnv = null;
}

export function getClientEnv(): z.infer<typeof clientEnvSchema> {
  if (clientEnv) return clientEnv;

  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    const messages = Object.entries(errors)
      .map(([field, msgs]) => `${field}: ${msgs.join(", ")}`)
      .join("; ");
    throw new Error(`Invalid client environment: ${messages}`);
  }

  clientEnv = parsed.data;
  return clientEnv;
}

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

export const envKeys = {
  server: [
    "DATABASE_URL",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
    "AI_API_KEY",
    "AI_BASE_URL",
    "AI_MODEL",
    "RECOVERY_GRACE_SECONDS",
    "MAX_RECOVERY_ATTEMPTS",
    "ENABLE_RAZORPAY_LINKS",
    "DEMO_MODE",
  ] as const,
  client: ["NEXT_PUBLIC_APP_URL"] as const,
} as const;