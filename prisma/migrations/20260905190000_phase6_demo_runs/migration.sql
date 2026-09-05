-- Demo runs own only synthetic recovery cases, allowing isolated resets.
CREATE TABLE "demo_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dataset_version" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "synthetic" BOOLEAN NOT NULL DEFAULT true,
    "expected_metrics" TEXT,
    "result_metrics" TEXT,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" DATETIME
);

ALTER TABLE "recovery_cases" ADD COLUMN "demo_run_id" TEXT
REFERENCES "demo_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recovery_cases" ADD COLUMN "is_synthetic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "webhook_receipts" ADD COLUMN "demo_run_id" TEXT
REFERENCES "demo_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "demo_runs_dataset_version_seed_key"
ON "demo_runs"("dataset_version", "seed");
CREATE INDEX "demo_runs_status_idx" ON "demo_runs"("status");
CREATE INDEX "demo_runs_started_at_idx" ON "demo_runs"("started_at");
CREATE INDEX "recovery_cases_demo_run_id_idx" ON "recovery_cases"("demo_run_id");
CREATE INDEX "webhook_receipts_demo_run_id_idx" ON "webhook_receipts"("demo_run_id");
