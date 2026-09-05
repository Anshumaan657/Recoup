# RecoverAI — Failed-Payment Recovery Autopilot

RecoverAI is a Razorpay Buildathon Track 3 project for Indian D2C merchants. It ingests failed-payment events, waits for late authorization, selects a bounded recovery action, creates a Razorpay test-mode Payment Link when appropriate, records an audit trail, and measures recovered revenue.

This repository is intentionally scaffold-only. Implement it sequentially using the prompts in `docs/phases/`. Do not skip phases, and create exactly one reviewed Git commit at the end of every phase.

## Phase order

1. `01-foundation.md`
2. `02-domain-and-database.md`
3. `03-webhook-ingestion.md`
4. `04-agent-and-policy.md`
5. `05-recovery-execution.md`
6. `06-demo-simulator.md`
7. `07-dashboard.md`
8. `08-quality-and-delivery.md`

Read `docs/PROJECT_STRUCTURE.md` for the target layout and `docs/GIT_WORKFLOW.md` for repository rules.

---

## Prerequisites

- Node.js 20 LTS (`.nvmrc` pinned)
- npm 10+
- Razorpay Test Mode account (for Phases 3+)

## Quick Start

```bash
# Clone and enter
cd Recoup

# Install dependencies
npm ci

# Copy environment template
cp .env.example .env
# Edit .env with your values (see Environment Setup below)

# Generate Prisma client (Phase 2+)
npm run db:generate

# Run development server
npm run dev
```

Visit `http://localhost:3000` — you should see "RecoverAI · Track 3 · AI Revenue Recovery" with a "Foundation ready" badge.

## Environment Setup

Copy `.env.example` to `.env` and fill in values:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes (Phase 2+) | SQLite file path, e.g. `file:./dev.db` |
| `NEXT_PUBLIC_APP_URL` | Yes | Public URL for callbacks, e.g. `http://localhost:3000` |
| `RAZORPAY_KEY_ID` | Phase 3+ | Test mode key from Razorpay Dashboard |
| `RAZORPAY_KEY_SECRET` | Phase 3+ | Test mode secret from Razorpay Dashboard |
| `RAZORPAY_WEBHOOK_SECRET` | Phase 3+ | Webhook secret from Razorpay Dashboard |
| `AI_API_KEY` | Phase 4+ | OpenAI-compatible API key |
| `AI_BASE_URL` | Phase 4+ | e.g. `https://api.openai.com/v1` |
| `AI_MODEL` | Phase 4+ | e.g. `gpt-4o-mini` |
| `RECOVERY_GRACE_SECONDS` | No | Late-capture window, default `90` |
| `MAX_RECOVERY_ATTEMPTS` | No | Max retries per case, default `1` |
| `ENABLE_RAZORPAY_LINKS` | No | Real Payment Links when `true`, default `false` |
| `DEMO_MODE` | No | Enables simulator & fallbacks, default `true` |

**Demo Mode Notes:**
- When `DEMO_MODE=true` (default), AI and Razorpay credentials are optional; deterministic fallbacks are used.
- `ENABLE_RAZORPAY_LINKS=false` forces simulated links even with valid credentials.
- All money actions are **TEST MODE ONLY**. No live charges ever occur.

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Run production server |
| `npm run lint` | ESLint check |
| `npm run typecheck` | TypeScript strict check |
| `npm run test` | Unit/integration tests (Vitest) |
| `npm run test:watch` | Watch mode tests |
| `npm run test:coverage` | Coverage report |
| `npm run test:e2e` | End-to-end tests (Playwright) |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Run migrations |
| `npm run db:seed` | Seed database |
| `npm run demo:replay` | Run 60-case evaluation (Phase 6) |
| `npm run demo:reset` | Reset demo data (Phase 6) |

## Architecture Overview

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

Key invariants:
- **Signature verification** on every webhook (HMAC-SHA256)
- **Idempotency** via `WebhookReceipt` table
- **Grace period** prevents action before late authorization
- **LLM proposes, policy authorizes** — model never executes
- **At most one notification/action** per case (MVP)
- **Integer paise** for all amounts
- **Demo results labeled synthetic** and reproducible

## Razorpay Test Mode Webhook Setup

1. Create a test-mode webhook in Razorpay Dashboard → Webhooks
2. URL: `https://your-domain/webhooks/razorpay`
3. Events: `payment.failed`, `payment.captured`, `payment_link.paid`
4. Copy signing secret to `RAZORPAY_WEBHOOK_SECRET`
5. For local dev, use ngrok: `ngrok http 3000`

## Webhook Signature Verification

- Invalid or missing `X-Razorpay-Signature` header returns HTTP 401
- Signature verified using HMAC-SHA256 with `RAZORPAY_WEBHOOK_SECRET`
- Verification uses constant-time comparison to prevent timing attacks

## Supported Events

| Event | Purpose |
|-------|---------|
| `payment.failed` | Create recovery case, start grace period |
| `payment.captured` | Late capture — close case, stop recovery |
| `payment_link.paid` | Mark case recovered, record revenue |

## API Summary

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/razorpay` | Ingest Razorpay webhooks |
| `GET` | `/api/recoveries` | List recovery cases |
| `GET` | `/api/recoveries/:id` | Case detail with audit timeline |
| `GET` | `/api/metrics` | Revenue metrics |
| `POST` | `/api/demo/replay` | Run 60-case evaluation (demo only) |

## Metric Definitions

| Metric | Definition |
|--------|------------|
| `attempted` | Cases where recovery action was taken |
| `contacted` | Cases where customer was notified |
| `recovered` | Cases with verified payment link payment |
| `stopped` | Cases closed by late capture |
| `manualReview` | Cases escalated for human review |
| `duplicatesPrevented` | Late captures that stopped duplicate charges |
| `totalAtRiskPaise` | Sum of original failed payment amounts |
| `recoveredPaise` | Sum of verified recovered amounts |
| `recoveryRate` | `recoveredPaise / totalAtRiskPaise` |

## Test Commands

```bash
# All quality gates
npm run typecheck && npm run lint && npm test && npm run build

# With coverage
npm run test:coverage

# E2E (requires dev server)
npm run dev & npm run test:e2e
```

## Limitations

- **Test mode only** — no live money movement
- **Single notification channel** — email/SMS stubbed via outbox
- **No authentication** — dashboard is open (add auth for production)
- **SQLite** — single-node; use Postgres for production
- **No scheduler** — demo uses manual replay; add cron for production
- **Synthetic data** — demo metrics are deterministic, not real merchant data

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `npm ci` fails | Ensure Node 20 (`nvm use`) |
| `prisma generate` fails | Run `npm run db:generate` after install |
| Webhook signature invalid | Check `RAZORPAY_WEBHOOK_SECRET` matches Dashboard |
| AI fallback always used | Set `AI_API_KEY` and `AI_BASE_URL` |
| Port 3000 in use | `lsof -ti:3000 \| xargs kill` |

## License

MIT — Built for Razorpay Buildathon Track 3.