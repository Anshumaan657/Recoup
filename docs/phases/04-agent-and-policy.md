# Phase 4 Prompt — Recovery Agent and Deterministic Policy

```text
Implement only Phase 4 of RecoverAI in /Users/anshumaansharma0404gmail.com/Desktop/Recoup. Require a clean worktree and committed Phases 1–3. Do not call Razorpay Payment Link APIs, send notifications, build the simulator, or finish the dashboard.

Goal: convert an eligible failed-payment case into a structured, explainable RecoveryDecision, then validate it through deterministic guardrails. The model may recommend; code owns authorization.

Define RecoveryDecision with Zod in src/lib/agent/decision-schema.ts:
- action: retry_later | suggest_alternate_method | create_payment_link | manual_review | no_action
- reason: nonempty concise string, maximum 300 characters
- delaySeconds: integer 0..86400
- customerMessage: plain text, maximum 500 characters, no sensitive payment data
- confidence: number 0..1
- requiresApproval: boolean
- model/fallback metadata stored separately from customer-visible text

Implement these fixed policies:
- A case is eligible only after graceExpiresAt and only from waiting.
- Never act on recovered/closed/manual_review cases, opted-out customers, missing all contact channels, non-INR currency, nonpositive/oversized amount, or attemptCount >= MAX_RECOVERY_ATTEMPTS.
- Never ask for PIN, OTP, CVV, full card number, bank password, or credentials.
- Insufficient funds -> retry_later with a respectful delayed message.
- Bank/network/technical failures -> create_payment_link or suggest_alternate_method after grace.
- Authentication/user-cancelled failures -> suggest_alternate_method; no pressure language.
- Suspected fraud, unknown high-risk reason, confidence below 0.65, or amount >= configurable approval threshold -> manual_review.
- Payment-link actions require a verified email/contact, ENABLE_RAZORPAY_LINKS, and policy approval.
- Maximum one customer notification in this MVP.

Implement src/lib/agent/recovery-agent.ts using an OpenAI-compatible client configured by AI_BASE_URL, AI_API_KEY, and AI_MODEL. Request strict JSON and parse it with Zod. Supply only minimum necessary, redacted context. Use a timeout and no automatic unbounded retries. If configuration is absent, the request fails, JSON is invalid, the output violates schema, or content violates safety rules, use src/lib/agent/fallback-rules.ts and record the fallback reason.

Implement src/lib/policy/policy-engine.ts and guardrails.ts. The result must distinguish proposedDecision, approvedDecision, rejected reasons, and whether fallback was used. Persist decision_created for approved decisions or decision_rejected/manual_review_requested otherwise. Every state change and reason must be auditable.

Expose a service function that evaluates all due waiting cases in a bounded batch, but do not add a scheduler. It must be deterministic under a fixed clock and safe to call repeatedly.

Tests:
- Table-test each failure category and every fixed policy.
- Model valid output, invalid JSON, invalid enum, overlong message, timeout, missing configuration, prompt-injection text inside provider descriptions, prohibited credential request, low confidence, opt-out, missing contact, late/terminal state, max attempts, and repeated evaluation.
- Assert no raw PII or secrets are sent in model context and fallback is deterministic.

Quality gates: typecheck, lint, tests, and build pass. Document in ARCHITECTURE.md why the LLM is advisory and the policy engine is authoritative.

Commit exactly once:
git diff --check
git status --short
git add -A
git diff --cached --check
git commit -m "feat: add explainable recovery decisions and guardrails"
git status --short

Report the commit hash, decision schema, enforced guardrails, fallback behavior, and test results. Stop after Phase 4.
```
