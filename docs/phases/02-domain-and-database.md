# Phase 2 Prompt — Domain Model and SQLite Persistence

```text
Implement only Phase 2 of RecoverAI in /Users/anshumaansharma0404gmail.com/Desktop/Recoup. Phase 1 must already be committed. Do not implement HTTP webhooks, model calls, payment links, the batch simulator, or dashboard UI.

Start by reading README.md, docs/PROJECT_STRUCTURE.md, docs/GIT_WORKFLOW.md, the current package.json, and every Phase 1 source/config file relevant to persistence. Run git status --short and stop if unexpected changes exist.

Build the domain and persistence layer with Prisma + SQLite.

Required enums and states:
- RecoveryStatus: waiting, eligible, contacted, recovered, closed, manual_review.
- RecoveryAction: retry_later, suggest_alternate_method, create_payment_link, manual_review, no_action.
- AuditEventType: payment_failed_received, grace_started, late_capture_received, decision_created, decision_rejected, payment_link_created, notification_queued, recovery_succeeded, recovery_stopped, manual_review_requested, provider_error.

Required records:
1. RecoveryCase: internal id, unique originalPaymentId, orderId, amount in integer paise, currency, customer name/email/contact when available, payment method, normalized failure code/reason/source/step, attemptCount, status, selectedAction, decisionReason, confidence, requiresApproval, graceExpiresAt, paymentLinkId/url/expiry, recoveredAmount, recoveredAt, stoppedReason, timestamps, and relations.
2. AuditEvent: id, recoveryCaseId, eventType, human-readable message, structured metadata JSON, createdAt. Audit rows are append-only.
3. WebhookReceipt: unique eventKey, providerEvent, payloadHash, processedAt, outcome. This provides idempotency even if Razorpay lacks a unique event id.
4. NotificationOutbox: id, recoveryCaseId, channel, recipient, message, status, providerReference, sentAt, createdAt.

Tasks:
- Define src/types/domain.ts as the application-facing contracts. Do not leak Prisma-generated types through service boundaries.
- Create prisma/schema.prisma with useful indexes on status, createdAt, originalPaymentId, orderId, and foreign keys.
- Create the initial migration and prisma/seed.ts with 6 small representative records only.
- Implement src/lib/db/prisma.ts with a development-safe singleton.
- Implement src/lib/recovery/state-machine.ts as the sole authority for valid transitions. Recovered and closed are terminal; late capture can close waiting/eligible/contacted cases; invalid transitions must return a typed failure or throw a domain-specific error.
- Add repository/service helpers required to create a case, append an audit event transactionally, retrieve a case with timeline, list cases with stable newest-first ordering, and reset demo data. Keep persistence logic server-only.
- Replace database script placeholders with working Prisma commands.
- Create docs/ARCHITECTURE.md with a concise system context, state transition table, invariants, trust boundaries, and data-retention note.

Tests must cover every valid and invalid state transition, paise-only amount handling, uniqueness of originalPaymentId and webhook eventKey, transactional case+audit creation, terminal-state protection, and stable ordering. Tests must use an isolated test database and must not modify prisma/dev.db.

Quality gates:
- npm run db:generate passes.
- A fresh database can be created from migrations and seeded.
- npm run typecheck, npm run lint, npm test, and npm run build pass.
- No local database is staged.

Commit exactly once at the end:
git diff --check
git status --short
git add -A
git diff --cached --check
git commit -m "feat: add recovery domain and persistence model"
git status --short

Report the commit hash, migration name, schema invariants, and verification results. Stop after Phase 2.
```
