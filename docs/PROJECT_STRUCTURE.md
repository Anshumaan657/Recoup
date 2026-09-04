# Target Project Structure

The phase prompts must produce this structure. Do not create alternate directories for the same responsibility.

```text
Recoup/
├── .env.example
├── .gitignore
├── .nvmrc
├── README.md
├── package.json
├── package-lock.json
├── next.config.ts
├── postcss.config.mjs
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
├── eslint.config.mjs
├── .github/
│   └── workflows/ci.yml
├── .openai/
│   └── hosting.json                 # Only if deployment requires it
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DEMO_SCRIPT.md
│   ├── GIT_WORKFLOW.md
│   ├── PROJECT_STRUCTURE.md
│   └── phases/01...08
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts
│   └── migrations/
├── public/
├── scripts/
│   ├── replay-demo.ts
│   └── reset-demo.ts
├── fixtures/
│   └── webhooks/
│       ├── payment-failed.json
│       ├── payment-captured.json
│       └── payment-link-paid.json
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── demo/replay/route.ts
│   │   │   ├── metrics/route.ts
│   │   │   └── recoveries/
│   │   │       ├── route.ts
│   │   │       └── [id]/route.ts
│   │   ├── webhooks/razorpay/route.ts
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── dashboard/
│   │   │   ├── audit-timeline.tsx
│   │   │   ├── case-table.tsx
│   │   │   ├── dashboard-shell.tsx
│   │   │   ├── metric-card.tsx
│   │   │   └── replay-button.tsx
│   │   ├── recoveries/case-detail.tsx
│   │   └── ui/                      # Reusable accessible primitives only
│   ├── lib/
│   │   ├── agent/
│   │   │   ├── decision-schema.ts
│   │   │   ├── fallback-rules.ts
│   │   │   └── recovery-agent.ts
│   │   ├── db/prisma.ts
│   │   ├── notifications/outbox.ts
│   │   ├── policy/
│   │   │   ├── guardrails.ts
│   │   │   └── policy-engine.ts
│   │   ├── razorpay/
│   │   │   ├── client.ts
│   │   │   ├── payment-links.ts
│   │   │   └── signatures.ts
│   │   ├── recovery/
│   │   │   ├── metrics.ts
│   │   │   ├── service.ts
│   │   │   └── state-machine.ts
│   │   └── validation/env.ts
│   └── types/domain.ts
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
```

Generated directories such as `node_modules/`, `.next/`, `coverage/`, `playwright-report/`, and the local SQLite database must remain ignored.
