-- A run a node handed back because it was shutting down (a restart, an update).
-- It is closed as failed for the history, but it is not an attempt: it neither
-- counts toward maxAttempts nor sends the item to review.
ALTER TABLE ticket_runs ADD COLUMN released INTEGER NOT NULL DEFAULT 0;
