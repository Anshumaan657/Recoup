-- CreateTable
CREATE TABLE "recovery_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "original_payment_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "customer_name" TEXT,
    "customer_email" TEXT,
    "customer_contact" TEXT,
    "payment_method" TEXT,
    "failure_code" TEXT,
    "failure_reason" TEXT,
    "failure_source" TEXT,
    "failure_step" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "selected_action" TEXT,
    "decision_reason" TEXT,
    "confidence" REAL,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "grace_expires_at" DATETIME,
    "payment_link_id" TEXT,
    "payment_link_url" TEXT,
    "payment_link_expiry" DATETIME,
    "recovered_amount" INTEGER,
    "recovered_at" DATETIME,
    "stopped_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recovery_case_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_events_recovery_case_id_fkey" FOREIGN KEY ("recovery_case_id") REFERENCES "recovery_cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "webhook_receipts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event_key" TEXT NOT NULL,
    "provider_event" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "processed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recovery_case_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider_reference" TEXT,
    "sent_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_outbox_recovery_case_id_fkey" FOREIGN KEY ("recovery_case_id") REFERENCES "recovery_cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "recovery_cases_original_payment_id_key" ON "recovery_cases"("original_payment_id");

-- CreateIndex
CREATE INDEX "recovery_cases_status_idx" ON "recovery_cases"("status");

-- CreateIndex
CREATE INDEX "recovery_cases_created_at_idx" ON "recovery_cases"("created_at");

-- CreateIndex
CREATE INDEX "recovery_cases_original_payment_id_idx" ON "recovery_cases"("original_payment_id");

-- CreateIndex
CREATE INDEX "recovery_cases_order_id_idx" ON "recovery_cases"("order_id");

-- CreateIndex
CREATE INDEX "audit_events_recovery_case_id_idx" ON "audit_events"("recovery_case_id");

-- CreateIndex
CREATE INDEX "audit_events_event_type_idx" ON "audit_events"("event_type");

-- CreateIndex
CREATE INDEX "audit_events_created_at_idx" ON "audit_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_receipts_event_key_key" ON "webhook_receipts"("event_key");

-- CreateIndex
CREATE INDEX "webhook_receipts_event_key_idx" ON "webhook_receipts"("event_key");

-- CreateIndex
CREATE INDEX "webhook_receipts_provider_event_idx" ON "webhook_receipts"("provider_event");

-- CreateIndex
CREATE INDEX "webhook_receipts_processed_at_idx" ON "webhook_receipts"("processed_at");

-- CreateIndex
CREATE INDEX "notification_outbox_recovery_case_id_idx" ON "notification_outbox"("recovery_case_id");

-- CreateIndex
CREATE INDEX "notification_outbox_status_idx" ON "notification_outbox"("status");

-- CreateIndex
CREATE INDEX "notification_outbox_created_at_idx" ON "notification_outbox"("created_at");
