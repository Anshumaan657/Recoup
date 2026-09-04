# Phase 7 Prompt — Merchant Dashboard

```text
Implement only Phase 7 of RecoverAI in /Users/anshumaansharma0404gmail.com/Desktop/Recoup. Require a clean, committed Phase 6 state. Do not broaden product scope with authentication, marketing pages, extra communication channels, or unrelated analytics.

Goal: build a polished, responsive merchant working surface that makes the five-minute demo immediately understandable.

Visual thesis: a high-trust fintech operations console—deep navy/ink background or shell, crisp neutral working surfaces, electric cyan for active recovery, emerald only for verified recovered money, amber for waiting/manual review, and red only for errors. Use deliberate typography, compact but breathable density, subtle borders, accessible focus rings, and restrained motion. Do not use a giant marketing hero, glassmorphism everywhere, decorative stock imagery, fake testimonials, or unexplained charts.

First viewport must show:
- RecoverAI identity and "Test Mode / Synthetic Demo" badge.
- Revenue at risk, verified revenue recovered, recovery rate, and duplicate charges prevented.
- A prominent but bounded "Replay 60-case demo" control with confirmation, loading, success, and error states.
- The beginning of the recovery case table without requiring a splash-screen click.

Implement components listed in docs/PROJECT_STRUCTURE.md. Use accessible semantic tables on desktop and a readable stacked representation on narrow screens. Case rows show masked customer, amount formatted from paise, normalized failure reason, action, status, and relative/absolute time. Filters: status and action only. Default newest first. Include loading skeleton, empty state with replay action, API error with retry, and no-results state.

Selecting a case opens an accessible detail sheet/panel, not a new marketing page. Show original payment id in copyable masked form, state, amount, failure signals, model vs fallback indicator, proposed/approved action, guardrail result, payment-link status, and chronological audit timeline. Clearly distinguish "recovered by agent", "late capture—recovery stopped", and "manual review".

Interaction rules:
- Replay cannot be double-submitted and refreshes metrics/cases after success.
- URL query parameters may store filters; no unnecessary global state library.
- Use server rendering for initial data when practical and client components only for filters, replay, and detail interaction.
- All controls support keyboard navigation, visible focus, descriptive labels, and 44px touch targets where appropriate.
- Respect reduced motion, 200% text zoom, and WCAG AA contrast.
- Never render untrusted model text as HTML.

Use truthful product copy. Currency uses en-IN and INR. Show "Synthetic evaluation" near simulated metrics. Do not claim real merchant revenue. Add metadata title "RecoverAI — Revenue Recovery Autopilot" and a concise description; do not create a social image unless explicitly requested.

Tests:
- Component tests for metric formatting, status/action mapping, loading/empty/error states, replay success/error and double-click protection, filters, case detail, audit ordering, and malicious model text escaping.
- Playwright happy path at desktop and mobile widths: load seeded dashboard, replay, observe metrics, filter, open case, verify timeline, keyboard close panel.
- Run an automated accessibility check if already compatible; otherwise document manual keyboard/landmark/contrast checks without inventing results.

Quality gates: typecheck, lint, unit/integration tests, Playwright tests, and production build pass. Inspect responsive behavior; no horizontal page overflow at 375px.

Commit exactly once:
git diff --check
git status --short
git add -A
git diff --cached --check
git commit -m "feat: build RecoverAI merchant operations dashboard"
git status --short

Report the commit hash, implemented states/interactions, accessibility checks, and verification results. Stop after Phase 7.
```
