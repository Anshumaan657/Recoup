# Phase 6 Prompt — Seeded Demo Simulator and Evaluation

```text
Implement only Phase 6 of RecoverAI in /Users/anshumaansharma0404gmail.com/Desktop/Recoup. Require a clean worktree with Phases 1–5 committed. Do not perform final dashboard visual work yet.

Goal: provide a transparent, repeatable evaluation of at least 50 synthetic payment failures and expose measured revenue outcomes without pretending simulated results are production data.

Create a fixed, versioned dataset of exactly 60 synthetic cases. Use integer paise and realistic but fake Indian D2C orders. Include balanced examples of insufficient funds, bank/network downtime, authentication failure, user cancellation, technical gateway failure, suspected risk, unknown failure, missing contact, opted-out customer, high-value manual review, duplicate webhook, late authorization, and payment-link success/failure. Use reserved example domains and obviously synthetic phone numbers; no real PII.

Define a seeded outcome model independent from the agent decision code. Each record must have a predetermined event sequence/outcome so reruns are identical. Include at least: 8 late captures, 8 unrecoverable/stopped cases, 8 manual-review/no-contact cases, 20 successful recoveries, and remaining attempted-but-not-recovered cases. Do not tune the policy by reading hidden outcome fields.

Implement POST /api/demo/replay:
- Available only when DEMO_MODE=true.
- Accept only a validated optional seed/reset flag; do not accept arbitrary payment data.
- Reset demo-owned rows transactionally without touching non-demo rows.
- Replay signed webhook fixtures through the same ingestion/service path as production logic, advance an injected clock beyond grace periods, run decisioning and execution, and apply predetermined capture/payment-link events.
- Return summary metrics and run id. Repeated runs with the same seed must produce identical totals.

Implement GET /api/metrics with attempted, contacted, recovered, stopped, manualReview, duplicatesPrevented, totalAtRiskPaise, recoveredPaise, recoveryRate, and generatedAt. Define denominators explicitly and exclude late captures from agent-recovered revenue. Implement GET /api/recoveries, GET /api/recoveries/[id], scripts/replay-demo.ts, and scripts/reset-demo.ts. Endpoints must use stable JSON shapes, correct status codes, no secrets, and only necessary masked PII.

Record duplicate prevention when a potential recovery is stopped because the original payment captured after failure. Do not count ignored duplicate webhook deliveries as duplicate-charge prevention. Label every metric response and stored run as synthetic/demo.

Tests:
- Exact fixture count/category distribution.
- Determinism across two resets/replays.
- Correct rupee/paise arithmetic and zero-division handling.
- Late captures excluded from recovered revenue.
- Duplicate deliveries do not change counts.
- API validation, DEMO_MODE=false rejection, reset isolation, repeated replay, concurrent replay protection, and stable list/detail JSON contracts.

Update README.md with one-command demo instructions and the metric definitions. Add an evaluation section to ARCHITECTURE.md identifying synthetic-data limitations.

Quality gates: database reset + replay succeeds, expected metrics are asserted in tests, typecheck/lint/tests/build pass, and no generated database is staged.

Commit exactly once:
git diff --check
git status --short
git add -A
git diff --cached --check
git commit -m "feat: add deterministic recovery evaluation simulator"
git status --short

Report the commit hash, dataset composition, exact expected metrics, API contracts, and verification results. Stop after Phase 6.
```
