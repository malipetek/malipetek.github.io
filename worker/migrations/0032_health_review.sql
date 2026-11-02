-- Health checks and the pre-review Ali reads before the diff.
--
-- health_checks holds one row per check (the callback URLs, each node, the
-- deployed commit, the queue). The cron rewrites every row each run; the
-- timestamps are what make a failure mail once and a recovery mail once.
--
-- run_reviews is the cheap agent's verdict on a finished run: what the client
-- asked, whether the project's own build passed, and one line to read instead
-- of the diff. A run has at most one review.

CREATE TABLE health_checks (
  name          TEXT PRIMARY KEY,
  status        TEXT NOT NULL CHECK (status IN ('ok', 'fail', 'skip')),
  detail        TEXT NOT NULL DEFAULT '',
  latency_ms    INTEGER,
  checked_at    INTEGER NOT NULL,
  failing_since INTEGER,
  alerted_at    INTEGER,
  resolved_at   INTEGER
);

CREATE TABLE run_reviews (
  run_id            INTEGER PRIMARY KEY REFERENCES ticket_runs(id) ON DELETE CASCADE,
  ticket_id         INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  verdict           TEXT NOT NULL CHECK (verdict IN ('pass', 'attention', 'fail', 'skip')),
  headline          TEXT NOT NULL DEFAULT '',
  points            TEXT NOT NULL DEFAULT '[]',
  build_ok          INTEGER,
  build_output      TEXT,
  model             TEXT,
  created_at        INTEGER NOT NULL
);
CREATE INDEX run_reviews_ticket ON run_reviews(ticket_id, created_at DESC);

-- The project's own verify command, reported by the node that ran it, so the
-- review can say "build passed" without trusting the agent's prose.
ALTER TABLE ticket_runs ADD COLUMN verify_ok INTEGER;
ALTER TABLE ticket_runs ADD COLUMN verify_command TEXT;
ALTER TABLE ticket_runs ADD COLUMN verify_output TEXT;

-- Before/after pictures of a hosted site's preview, captured by the node that
-- ran the change. Stored in R2; the review links them instead of describing a
-- page in prose.
CREATE TABLE run_screenshots (
  run_id     INTEGER NOT NULL REFERENCES ticket_runs(id) ON DELETE CASCADE,
  ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('before', 'after')),
  r2_key     TEXT NOT NULL,
  page_url   TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, kind)
);
CREATE INDEX run_screenshots_ticket ON run_screenshots(ticket_id, created_at DESC);
