# Phase 8 Prompt — Final QA, Documentation, and Buildathon Delivery

```text
Implement only Phase 8 of RecoverAI in /Users/anshumaansharma0404gmail.com/Desktop/Recoup. Require a clean worktree and committed Phases 1–7. This is a hardening and delivery phase: do not add new product features.

Goal: make the repository reproducible, secure, measurable, and ready for a Razorpay Buildathon reviewer to run and understand in minutes.

Audit the implementation against these non-negotiable claims:
- Failed-payment webhooks are signature-verified and idempotent.
- A grace period prevents action before late authorization can arrive.
- The LLM only proposes; deterministic policy authorizes.
- At most one recovery notification/action occurs per case in this MVP.
- Original capture stops recovery; verified Payment Link payment records revenue once.
- All amounts are integer paise internally.
- Demo results are labeled synthetic and reproducible.
- No secret or PII leaks to logs, client bundles, fixtures, API responses, Git history, or model prompts.

Tasks:
1. Run a focused code/security review. Fix only verified defects, unsafe defaults, flaky tests, accessibility issues, inaccurate copy, dead placeholders, and documentation drift.
2. Ensure .env.example exactly matches validated environment keys. Confirm production defaults disable demo-only endpoints and simulated links.
3. Complete .github/workflows/ci.yml for npm ci, Prisma generation, typecheck, lint, tests, build, and optionally Playwright when browser installation is configured. Use least permissions and no repository secrets for pull-request validation.
4. Rewrite README.md as the evaluator entry point: problem, solution, architecture diagram in Mermaid, safety model, AI's bounded role, setup, env table, database migration/seed, demo replay, test-mode Razorpay webhook setup, supported events, API summary, metric definitions, test commands, limitations, and troubleshooting. Every claim must match the code.
5. Complete docs/DEMO_SCRIPT.md as a timed five-minute pitch:
   0:00–0:35 problem and merchant impact;
   0:35–1:05 architecture and guardrails;
   1:05–2:05 failed event -> grace -> decision -> link;
   2:05–2:45 late capture stops recovery;
   2:45–3:25 verified recovery updates rupees;
   3:25–4:15 replay 60 cases and explain metrics;
   4:15–5:00 audit trail, limitations, close.
   Include exact clicks, expected values from the deterministic dataset, narration, and fallback steps if Razorpay test mode is unavailable.
6. Add a concise API table and state-machine diagram to docs/ARCHITECTURE.md. Document threat model, idempotency, concurrency control, trust boundaries, failure modes, and what would be needed for production.
7. Run a fresh-clone simulation without deleting the working repository: use a temporary directory or npm ci after safely moving only generated artifacts. Apply migrations, seed/replay, and verify the expected metrics.
8. Confirm there are no TODO/FIXME placeholders in runtime code, no ignored failing tests, no type suppression without rationale, no console logging of external payloads, and no dependency with an unresolved critical audit finding. Do not perform a breaking major-version upgrade in this phase.
9. If deployment is explicitly configured, verify the production build and documented environment requirements. Do not deploy or publish unless the user explicitly requests it.

Final verification commands must include:
npm ci
npm run db:generate
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm audit --omit=dev
git diff --check
git status --short

Fix failures that are caused by the project. Report any external/provider limitation honestly; never disable a safety check merely to make a demo pass.

Commit exactly once:
git diff --check
git status --short
git add -A
git diff --cached --check
git commit -m "chore: harden and document Buildathon release"
git status --short
git log --oneline --decorate -8

The final worktree must be clean. Report the final commit hash, full verification matrix, deterministic demo metrics, known limitations, and exact local run commands. Stop after Phase 8; do not create tags, push, deploy, or rewrite history unless explicitly asked.
```
