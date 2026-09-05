-- Phase 5 permits at most one customer notification per recovery case.
DROP INDEX IF EXISTS "notification_outbox_recovery_case_id_idx";
CREATE UNIQUE INDEX "notification_outbox_recovery_case_id_key"
ON "notification_outbox"("recovery_case_id");
