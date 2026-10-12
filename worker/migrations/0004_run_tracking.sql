-- Agentic run tracking.
--
-- A ticket is the unit of client work; a run is one attempt at it by one
-- executor. Until now a run left only a private `runner` message, so the
-- database could not answer "who did this, with what, and what did it cost" —
-- every executor was recorded as the same word.
--
-- The message author stays `runner` (the CHECK in 0002 would need another table
-- rebuild to widen it), and the attribution lives here instead, where it can be
-- queried and summed.
CREATE TABLE ticket_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id      INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  -- What did the work: 'runner' (the local claude runner), 'claude-code',
  -- 'opencode', 'devin', 'dsh', or anything else a caller names.
  executor       TEXT NOT NULL DEFAULT 'runner',
  -- Provider model id when the executor can name it, else NULL.
  model          TEXT,
  status         TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  -- Cost at cost, in micro-dollars (integer money) with the raw figure kept so
  -- a re-price stays possible.
  cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  cost_usd       REAL NOT NULL DEFAULT 0,
  branch         TEXT,
  diff_stat      TEXT,
  diff           TEXT,
  summary        TEXT NOT NULL DEFAULT '',
  started_at     INTEGER NOT NULL,
  finished_at    INTEGER
);

-- One ticket's history, newest last.
CREATE INDEX ticket_runs_ticket ON ticket_runs(ticket_id, id);
-- The fleet view: what is running right now.
CREATE INDEX ticket_runs_open ON ticket_runs(status, started_at);
