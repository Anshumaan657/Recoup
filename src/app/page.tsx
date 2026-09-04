import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      <div className="max-w-2xl w-full text-center space-y-8">
        <header className="space-y-4">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-50">
            RecoverAI
          </h1>
          <p className="text-xl text-slate-600 dark:text-slate-400">
            Track 3 · AI Revenue Recovery
          </p>
        </header>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-8 space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-4 py-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Foundation ready
          </div>

          <p className="text-slate-600 dark:text-slate-400">
            Project scaffold complete. Ready for Phase 2: Domain Model & Persistence.
          </p>
        </div>

        <nav className="flex items-center justify-center gap-4 text-sm text-slate-500 dark:text-slate-500">
          <Link
            href="/api/health"
            className="hover:text-cyan-600 dark:hover:text-cyan-400 underline underline-offset-2"
          >
            Health check
          </Link>
          <span aria-hidden="true">·</span>
          <a
            href="https://github.com/razorpay/buildathon"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-cyan-600 dark:hover:text-cyan-400 underline underline-offset-2"
          >
            Buildathon Track 3
          </a>
        </nav>

        <footer className="text-xs text-slate-400 dark:text-slate-500">
          <p>All money actions are test-mode/demo-only. No live charges.</p>
        </footer>
      </div>
    </main>
  );
}