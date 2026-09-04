# RecoverAI Architecture

## System Context

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Razorpay   │────▶│  Webhook     │────▶│  Recovery Case  │
│  Webhooks   │     │  Ingestion   │     │  State Machine  │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
                    ┌──────────────┐     ┌────────▼────────┐
                    │  Merchant    │◀────│  Recovery Agent │
                    │  Dashboard   │     │  + Policy       │
                    └──────────────┘     └────────┬────────┘
                                                   │
                    ┌──────────────┐     ┌────────▼────────┐
                    │  Audit Trail │◀────│  Execution      │
                    │  & Metrics   │     │  (Payment Link) │
                    └──────────────┘     └─────────────────┘
```

## Core Components

### 1. Webhook Ingestion (`src/app/webhooks/razorpay/route.ts`)
- Verifies HMAC-SHA256 signatures using `RAZORPAY_WEBHOOK_SECRET`
- Validates payload with Zod schemas
- Idempotent via `WebhookReceipt` table (eventKey = providerEventId or hash)
- Creates `RecoveryCase` on `payment.failed`, handles `payment.captured` (late capture), `payment_link.paid`

### 2. Recovery Domain (`src/types/domain.ts`, `prisma/schema.prisma`)
- **RecoveryCase**: Core entity tracking failed payment recovery lifecycle
- **AuditEvent**: Append-only log of all state changes and decisions
- **WebhookReceipt**: Idempotency guard for webhook deliveries
- **NotificationOutbox**: Outbox pattern for customer notifications

### 3. State Machine (`src/lib/recovery/state-machine.ts`)
Single authority for valid status transitions. Terminal states: `recovered`, `closed`.

### 4. Recovery Agent + Policy (`src/lib/agent/`, `src/lib/policy/`)
- Agent proposes `RecoveryDecision` via LLM (advisory only)
- Policy engine validates against deterministic guardrails
- Guardrails enforce: grace period, max attempts, opt-out, contact availability, currency, amount limits, approval thresholds

### 5. Execution (`src/lib/razorpay/`, `src/lib/recovery/service.ts`)
- Creates Razorpay Payment Links (test mode) or simulates in DEMO_MODE
- Transactional reservation pattern prevents duplicate actions
- Reconciles provider "already exists" responses

### 6. Demo Simulator (`scripts/replay-demo.ts`, `src/app/api/demo/replay/route.ts`)
- 60 synthetic cases with predetermined outcomes
- Deterministic replay via injected clock
- Metrics: attempted, contacted, recovered, stopped, manualReview, duplicatesPrevented, recoveryRate

## State Transition Table

| From \ To | waiting | eligible | contacted | recovered | closed | manual_review |
|-----------|---------|----------|-----------|-----------|--------|---------------|
| waiting   | ✓       | ✓        | ✗         | ✗         | ✓*     | ✓             |
| eligible  | ✗       | ✓        | ✓         | ✗         | ✓*     | ✓             |
| contacted | ✗       | ✗        | ✓         | ✓         | ✓*     | ✓             |
| manual_review | ✗    | ✗        | ✓         | ✓         | ✓      | ✓             |
| recovered | ✗       | ✗        | ✗         | ✓         | ✗      | ✗             |
| closed    | ✗       | ✗        | ✗         | ✗         | ✓      | ✗             |

* Late capture (`payment.captured` for original payment) forces transition to `closed` from `waiting`, `eligible`, or `contacted`.

### Valid Action → Status Mappings
| Action | From Status | To Status |
|--------|-------------|-----------|
| `retry_later` | waiting | eligible |
| `create_payment_link` | eligible | contacted |
| `suggest_alternate_method` | eligible | contacted |
| `manual_review` | any non-terminal | manual_review |
| `no_action` | any non-terminal | closed |

## Invariants

1. **Signature Verification**: Every webhook must pass HMAC-SHA256 verification before processing
2. **Idempotency**: `WebhookReceipt.eventKey` unique constraint prevents duplicate processing
3. **Grace Period**: No recovery action before `graceExpiresAt` (default 90s after failure)
4. **LLM Advisory Only**: Model proposes; policy engine authorizes; code executes
5. **Single Notification**: At most one customer notification per case (MVP)
6. **Late Capture Stops Recovery**: Original payment capture closes case, cancels pending links
7. **Verified Revenue Only**: Revenue recorded only on `payment_link.paid` or late capture
8. **Integer Paise**: All amounts stored as integer paise (no floating point)
9. **Terminal State Protection**: `recovered` and `closed` are absorbing states
10. **Demo Labeling**: All demo metrics explicitly labeled "synthetic"

## Trust Boundaries

```
┌─────────────────────────────────────────────────────────┐
│                    Server (Trusted)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Webhook     │  │ State       │  │ Policy Engine   │  │
│  │ Verification│  │ Machine     │  │ (Authoritative) │  │
│  └─────────────┘  └─────────────┘  └────────┬────────┘  │
│         │                │                   │           │
│         ▼                ▼                   ▼           │
│  ┌─────────────────────────────────────────────────┐    │
│  │           Prisma / SQLite (Source of Truth)      │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    Client (Untrusted)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Dashboard   │  │ API Calls   │  │ User Input      │  │
│  │ (Read-only) │  │ (Validated) │  │ (Sanitized)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                 External Providers                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Razorpay    │  │ LLM API     │  │ Notification    │  │
│  │ (Test Mode) │  │ (Advisory)  │  │ (Outbox)        │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

- **Server** owns: secrets, state transitions, policy decisions, payment link creation
- **Client** receives: read-only data, masked PII, no secrets
- **LLM** receives: redacted context (no PII, no secrets), returns structured JSON only
- **Razorpay** receives: test-mode API calls only, idempotent reference IDs

## Data Retention

| Entity | Retention | Notes |
|--------|-----------|-------|
| RecoveryCase | 7 years | Financial audit requirement |
| AuditEvent | 7 years | Append-only, immutable |
| WebhookReceipt | 90 days | Idempotency window |
| NotificationOutbox | 30 days | After sent/failed |

## Failure Modes

| Scenario | Handling |
|----------|----------|
| Invalid webhook signature | 400 response, no persistence |
| Duplicate webhook | Return original outcome, no duplicate case |
| LLM timeout/invalid JSON | Fallback rules, audit `fallbackUsed=true` |
| Payment Link creation fails | `provider_error` audit, retry-safe state |
| Late capture during grace | Close case, stop recovery, audit `recovery_stopped` |
| Concurrent execution attempt | Reservation pattern, second returns conflict |
| Database unavailable | 500, no partial state changes (transactions) |

## Production Readiness Gaps

- [ ] PostgreSQL instead of SQLite (concurrency, replication)
- [ ] Authentication/authorization on dashboard
- [ ] Scheduler for periodic eligible case evaluation (cron/queue)
- [ ] Real notification channels (WhatsApp, SMS, Email providers)
- [ ] Observability: structured logging, metrics, tracing
- [ ] Rate limiting on webhook endpoint
- [ ] Backup/restore strategy for SQLite
- [ ] Webhook secret rotation mechanism