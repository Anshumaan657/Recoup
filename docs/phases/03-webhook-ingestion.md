# Phase 3 Prompt — Secure Razorpay Webhook Ingestion

```text
Implement only Phase 3 of RecoverAI in /Users/anshumaansharma0404gmail.com/Desktop/Recoup. The prior phases must be committed and git status --short must be clean. Do not implement model decisioning, Payment Link creation, the evaluation simulator, or dashboard polish.

Goal: build POST /webhooks/razorpay with signature verification, schema validation, idempotency, late-capture handling, and an auditable result.

Required behavior:
1. Read the raw request body exactly once. Verify header X-Razorpay-Signature using HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET) and crypto.timingSafeEqual. Do not parse or persist an unverified payload. In DEMO_MODE only, allow explicitly signed fixture events; never create a production bypass flag.
2. Validate only the supported minimum event shape with Zod while tolerating unknown Razorpay fields. Supported events: payment.failed, payment.captured, payment_link.paid. Reject unsupported events with a documented 200 ignored response so Razorpay does not retry forever.
3. Derive an idempotency key from a provider event id when present; otherwise use event type + payment id + created_at + SHA-256 raw payload hash. Insert WebhookReceipt transactionally. Replays must return the original outcome without duplicating cases or audit events.
4. payment.failed: create one RecoveryCase per original payment, normalize Razorpay error_code, error_description, error_source, error_step, and error_reason, set waiting, set graceExpiresAt from RECOVERY_GRACE_SECONDS, and append payment_failed_received and grace_started audit events.
5. payment.captured for the original payment: if a nonterminal recovery exists, move it to closed with stoppedReason=late_capture, increment no money, and append late_capture_received plus recovery_stopped. If the failure event arrives later, keep the case closed and never reopen it.
6. payment_link.paid: correlate using notes/recovery_case_id or stored paymentLinkId. Mark the case recovered exactly once, set recoveredAmount equal to the case amount, and append recovery_succeeded. Unknown links must be safely ignored and audited globally only if a suitable mechanism exists.
7. Return small JSON responses with status, duplicate flag, caseId if applicable, and no customer PII.

Create sanitized fixtures in fixtures/webhooks for all three event types. Never use real customer data. Add src/lib/razorpay/signatures.ts and any focused Zod schemas under src/lib/validation. Keep the route thin; orchestration belongs in src/lib/recovery/service.ts.

Integration tests must use actual raw JSON buffers and generated HMAC signatures. Cover valid signature, missing/invalid signature, malformed JSON, malformed supported event, unsupported event, duplicate delivery, two simultaneous duplicate requests, failure then capture, capture then failure, repeated capture, payment-link success, and unknown payment link. Assert exact case/audit counts and no duplicate recovery amount.

Quality gates: typecheck, lint, all tests, and build pass. No logs may contain full payloads, email addresses, phone numbers, secrets, or signatures.

Commit exactly once:
git diff --check
git status --short
git add -A
git diff --cached --check
git commit -m "feat: ingest Razorpay webhooks safely"
git status --short

Report the commit hash, supported events, idempotency method, and test results. Stop after Phase 3.
```
