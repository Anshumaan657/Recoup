# Phase 1 Prompt — Project Foundation

```text
You are implementing Phase 1 of RecoverAI, a Razorpay Buildathon Track 3 project. Work only inside /Users/anshumaansharma0404gmail.com/Desktop/Recoup. This phase establishes a runnable foundation; do not implement the database, webhook processing, AI decisioning, recovery execution, simulator, or final dashboard yet.

Before changing anything:
1. Read README.md, docs/PROJECT_STRUCTURE.md, and docs/GIT_WORKFLOW.md.
2. Run pwd, find . -maxdepth 3 -type f | sort, and git status if this is already a Git repository.
3. Preserve the existing docs/phases files exactly except for corrections required to make commands executable.

Technical decisions are fixed:
- Node.js 20 LTS, npm, TypeScript strict mode.
- Next.js App Router with React and Tailwind CSS.
- Source code under src/ and import alias @/* -> src/*.
- Prisma with SQLite will be added in Phase 2.
- Zod will validate environment variables and external payloads.
- Vitest for unit/integration tests and Playwright for later end-to-end tests.
- Use server components by default; add "use client" only to interactive components.
- Never expose Razorpay secrets or AI keys to browser code.

Tasks:
1. Initialize Git only if .git is absent: git init && git branch -M main.
2. Create a production-quality package.json and npm lockfile. Use current mutually compatible stable releases; do not use prerelease packages. Required runtime packages for the complete project are next, react, react-dom, zod, @prisma/client, prisma, openai, lucide-react, clsx, tailwind-merge, and recharts. Required development packages are TypeScript types, ESLint with Next configuration, Tailwind/PostCSS, Vitest with jsdom, Testing Library, and Playwright.
3. Create .nvmrc containing 20, a strict tsconfig.json, Next/PostCSS/ESLint/Vitest/Playwright configs, and a comprehensive .gitignore. Ignore .env files except .env.example, local *.db files and Prisma journal files, .next, node_modules, coverage, test reports, and editor/OS artifacts.
4. Create .env.example with placeholders only: DATABASE_URL=file:./dev.db, NEXT_PUBLIC_APP_URL=http://localhost:3000, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, AI_API_KEY, AI_BASE_URL, AI_MODEL, RECOVERY_GRACE_SECONDS=90, MAX_RECOVERY_ATTEMPTS=1, ENABLE_RAZORPAY_LINKS=false, and DEMO_MODE=true. Add short comments explaining which settings are optional in demo mode.
5. Implement src/lib/validation/env.ts. Validate server variables lazily so builds and tests do not require real credentials. Secrets must never be prefixed NEXT_PUBLIC_.
6. Create src/app/layout.tsx, src/app/globals.css, and src/app/page.tsx. The page should be a minimal recognizable RecoverAI shell with the product name, "Track 3 · AI Revenue Recovery", and a clear "Foundation ready" status. Do not build the dashboard yet.
7. Add npm scripts: dev, build, start, lint, typecheck, test, test:watch, test:coverage, test:e2e, db:generate, db:migrate, db:seed, demo:replay, and demo:reset. Scripts that depend on Phase 2+ files may be placeholders that print an explicit phase dependency and exit successfully; replace them in the owning phase.
8. Update README.md with prerequisites, setup commands, environment setup, available scripts, phase order, and an explicit warning that all money actions are test-mode/demo-only.

Quality gates:
- npm install completes and package-lock.json is committed.
- npm run typecheck, npm run lint, npm test, and npm run build all pass.
- No secret value, API key, generated output, or database file is staged.
- The page is responsive and keyboard-readable, but visual polish is deferred.

At the end, inspect all changes, then run:
git diff --check
git status --short
git add -A
git diff --cached --check
git commit -m "chore: establish RecoverAI project foundation"
git status --short

The final status must be clean. Report the commit hash, files created, commands run, and test/build results. Stop after this commit; do not begin Phase 2.
```
