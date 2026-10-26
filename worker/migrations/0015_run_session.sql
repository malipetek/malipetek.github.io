-- The DeepSeek Harness session a run worked in, so its conversation can be opened from any machine.
--   session_id   the Harness session id, e.g. session-db44e5d2-8897-4d5e-9a9f-b96070283d22
--   session_dir  the session's folder under ~/.dsh/sessions/ on the node, e.g. --Users-malipetek-...-run12--
--   session_log  1 when the node uploaded the session log to R2 (sessions/tickets/<ticket>/run-<run>.jsonl.zstd)
ALTER TABLE ticket_runs ADD COLUMN session_id TEXT;
ALTER TABLE ticket_runs ADD COLUMN session_dir TEXT;
ALTER TABLE ticket_runs ADD COLUMN session_log INTEGER NOT NULL DEFAULT 0;
