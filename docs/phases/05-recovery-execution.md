# Phase 5 Prompt — Guarded Recovery Execution

```text
Implement only Phase 5 of RecoverAI in /Users/anshumaansharma0404gmail.com/Desktop/Recoup. Begin from a clean, committed Phase 4 state. Do not build the 50-case simulator or final dashboard in this phase.

Goal: safely execute an approved recovery decision through a Razorpay standard Payment Link or simulated notification outbox, with strict stopping rules and auditability.

Implement src/lib/razorpay/client.ts with server-only fetch, Basic Authentication from RAZORPAY_KEY_ID/SECRET, an AbortController timeout, typed provider errors, and redacted logging. Implement payment-links.ts for POST https://api.razorpay.com/v1/payment_links only. Send integer paise, INR, unique reference_id derived from the recovery case, short description, customer details when present, expire_by, reminder_enable=false, notify.email/SMS only when intentionally enabled, and notes.recovery_case_id. Do not implement UPI-only links or live-mode assumptions.

Execution rules:
- Re-read the case immediately before action and refuse terminal, not-yet-eligible, opted-out, over-attempt-limit, already-linked, or already-notified cases.
- Use a transaction/reservation pattern so two workers cannot create two actions for the same case. Make reference_id idempotent and reconcile an "already exists" provider response before retrying.
- When ENABLE_RAZORPAY_LINKS=false or credentials are absent in DEMO_MODE, create a deterministic simulated link and label it simulated in metadata; outside DEMO_MODE, missing credentials is a provider error.
- Persist link id/url/expiry, increment attemptCount once, move eligible -> contacted, and append payment_link_created.
- Implement notifications/outbox.ts. Queue at most one sanitized customer message per case; do not integrate an external WhatsApp provider. Append notification_queued.
- retry_later remains eligible with a next-action timestamp or equivalent bounded representation; suggest_alternate_method queues one message and becomes contacted; manual_review becomes manual_review; no_action becomes closed with a reason.
- A later original payment capture cancels any cancellable link when feasible, closes the case, and prevents notifications or further action. A payment_link.paid event marks recovered once.
- Provider timeouts/errors append provider_error and leave a retry-safe state; never record revenue until a verified paid/captured event.

Add an internal/demo-only execution endpoint only if necessary; it must be disabled when DEMO_MODE=false and must not accept arbitrary URLs, amounts, recipients, or decisions from the client.

Tests must cover successful simulated link, successful mocked Razorpay call, exact request body, provider 4xx/5xx/timeout, duplicate execution, concurrent execution, reference conflict reconciliation, max attempt, expired link, opt-out, notification deduplication, capture immediately before action, capture after link creation, paid link, and no double-counted revenue.

Quality gates: typecheck, lint, tests, and build pass. No real notification or live money action is allowed during tests.

Commit exactly once:
git diff --check
git status --short
git add -A
git diff --cached --check
git commit -m "feat: execute bounded payment recovery workflows"
git status --short

Report the commit hash, live-vs-demo behavior, failure handling, concurrency protection, and test results. Stop after Phase 5.
```
