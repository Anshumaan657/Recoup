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
