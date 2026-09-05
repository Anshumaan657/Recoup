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
- Verifies HMAC-SHA256 signatures using `RAZORPAY_WEBHOOK_SECRET` (HTTP 401 for invalid/missing)
- Validates payload with Zod schemas
- Idempotent via `WebhookReceipt` table (eventKey = provider event.id or computed hash)
- Atomic transactions for all supported events
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

#### LLM Advisory Role
The LLM (Recovery Agent) is **strictly advisory**:
- **Proposes only**: The agent outputs a `RecoveryDecision` JSON based on case context
- **No execution authority**: The agent cannot create payment links, send notifications, or modify state
- **Redacted context**: Only minimum necessary, non-PII data is sent to the LLM (amount, failure codes, method, attempt count)
- **Structured output**: Strict JSON schema validated by Zod; invalid output triggers deterministic fallback
- **Timeout & failure handling**: 10s timeout; network errors, invalid JSON, schema violations, or safety violations all trigger fallback

#### Policy Engine Authority
The Policy Engine is the **sole authority** for authorization:
- **Guardrail evaluation**: Runs deterministic checks (grace period, max attempts, currency, contact channels, amount limits, approval thresholds)
- **Decision validation**: Validates proposed action against guardrails (e.g., payment links require email + ENABLE_RAZORPAY_LINKS)
- **Final authorization**: Only approved decisions transition the case; rejected decisions are audited with reasons
- **Fallback integration**: When LLM fails, deterministic fallback rules apply and are audited with `fallbackUsed=true`
- **Audit trail**: Every decision (proposed, approved, rejected) creates `decision_created`, `decision_rejected`, or `manual_review_requested` audit events with full reasoning

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
| Invalid webhook signature | 401 response, no persistence |
| Missing webhook signature | 401 response, no persistence |
| Duplicate webhook | Return original outcome, no duplicate case |
| LLM timeout/invalid JSON | Fallback rules, audit `fallbackUsed=true` |
| Payment Link creation fails | `provider_error` audit, retry-safe state |
| Late capture during grace | Close case, stop recovery, audit `recovery_stopped` |
| Concurrent execution attempt | Reservation pattern, second returns conflict |
| Database unavailable | 500, no partial state changes (transactions) |

## Synthetic Evaluation Boundaries

The 60-case Phase 6 dataset is a deterministic demonstration benchmark, not a
claim about production conversion. Identities use reserved example data,
outcomes are predetermined outside agent-visible inputs, and every metric is
labeled synthetic. Replay sends signed fixtures through production webhook
ingestion, evaluates visible context with the deterministic fallback policy,
and exercises guarded execution. A separate event plan supplies external
outcomes such as capture, expiry, and Payment Link payment. The result
demonstrates safety and repeatability, not an expected real-world recovery rate.

Synthetic cases and webhook receipts belong to a `DemoRun`; deleting a demo run
cascades only through demo-owned data and preserves merchant-owned rows.

## Production Readiness Gaps

- [ ] PostgreSQL instead of SQLite (concurrency, replication)
- [ ] Authentication/authorization on dashboard
- [ ] Scheduler for periodic eligible case evaluation (cron/queue)
- [ ] Real notification channels (WhatsApp, SMS, Email providers)
- [ ] Observability: structured logging, metrics, tracing
- [ ] Rate limiting on webhook endpoint
- [ ] Backup/restore strategy for SQLite
- [ ] Webhook secret rotation mechanism
