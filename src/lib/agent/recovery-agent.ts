import { getServerEnv } from "@/lib/validation/env";
import { RecoveryDecision, DecisionContext, recoveryDecisionSchema } from "./decision-schema";
import { fallbackDecision } from "./fallback-rules";

const AGENT_TIMEOUT_MS = 10000;

interface AgentConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

function getAgentConfig(): AgentConfig | null {
  const env = getServerEnv();
  if (!env.AI_API_KEY || !env.AI_BASE_URL || !env.AI_MODEL) {
    return null;
  }
  return {
    apiKey: env.AI_API_KEY,
    baseUrl: env.AI_BASE_URL,
    model: env.AI_MODEL,
  };
}

function buildPrompt(ctx: DecisionContext): string {
  return `You are a recovery decision agent for failed payments. Analyze the case and return a JSON decision.

Case Context:
- Payment ID: ${ctx.originalPaymentId}
- Amount: ${ctx.amount} ${ctx.currency}
- Failure Code: ${ctx.failureCode ?? "unknown"}
- Failure Reason: ${ctx.failureReason ?? "unknown"}
- Failure Source: ${ctx.failureSource ?? "unknown"}
- Failure Step: ${ctx.failureStep ?? "unknown"}
- Payment Method: ${ctx.paymentMethod ?? "unknown"}
- Attempt Count: ${ctx.attemptCount}/${ctx.maxAttempts}
- Grace Expired: ${ctx.graceExpired}
- Has Email: ${ctx.hasEmail}
- Has Contact: ${ctx.hasContact}
- Razorpay Links Enabled: ${ctx.enableRazorpayLinks}

Return ONLY valid JSON matching this schema:
{
  "action": "retry_later" | "suggest_alternate_method" | "create_payment_link" | "manual_review" | "no_action",
  "reason": "concise reason (max 300 chars)",
  "delaySeconds": 0-86400,
  "customerMessage": "plain text for customer (max 500 chars, no sensitive data)",
  "confidence": 0.0-1.0,
  "requiresApproval": boolean
}

Rules:
- retry_later: for insufficient funds, set delay 300-3600s
- create_payment_link: only if grace expired, has email/contact, links enabled
- suggest_alternate_method: for auth failures, user cancelled, bank issues
- manual_review: fraud, high risk, unknown reason, low confidence, amount >= ${ctx.approvalThresholdPaise} paise
- no_action: when no recovery appropriate
- NEVER ask for PIN, OTP, CVV, card number, bank password
- Customer message must be safe, no sensitive data`;
}

async function callLLM(config: AgentConfig, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: "You are a payment recovery decision agent. Output only valid JSON." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from LLM");
    }
    return content;
  } finally {
    clearTimeout(timeoutId);
  }
}

function sanitizeForLogging(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...obj };
  const sensitiveKeys = ["apiKey", "secret", "password", "token", "key"];
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((k) => key.toLowerCase().includes(k))) {
      sanitized[key] = "[REDACTED]";
    }
  }
  return sanitized;
}

export async function proposeRecoveryDecision(ctx: DecisionContext): Promise<RecoveryDecision> {
  const config = getAgentConfig();

  if (!config) {
    return fallbackDecision(ctx);
  }

  const prompt = buildPrompt(ctx);

  try {
    const rawResponse = await callLLM(config, prompt);
    const parsed = JSON.parse(rawResponse);

    const validated = recoveryDecisionSchema.parse(parsed);

    if (validated.customerMessage.length > 500) {
      throw new Error("Customer message exceeds 500 characters");
    }
    if (validated.reason.length > 300) {
      throw new Error("Reason exceeds 300 characters");
    }

    return {
      ...validated,
      fallbackUsed: false,
      modelMetadata: { model: config.model, provider: "llm" },
    };
  } catch (error) {
    return fallbackDecision(ctx);
  }
}

function createRedactedContext(ctx: DecisionContext): Record<string, unknown> {
  return {
    caseId: ctx.caseId,
    amount: ctx.amount,
    currency: ctx.currency,
    failureCode: ctx.failureCode,
    failureSource: ctx.failureSource,
    failureStep: ctx.failureStep,
    paymentMethod: ctx.paymentMethod,
    attemptCount: ctx.attemptCount,
    graceExpired: ctx.graceExpired,
    hasEmail: ctx.hasEmail,
    hasContact: ctx.hasContact,
  };
}

export async function evaluateCaseWithAgent(
  caseId: string,
  ctx: DecisionContext
): Promise<RecoveryDecision> {
  const decision = await proposeRecoveryDecision(ctx);
  return decision;
}