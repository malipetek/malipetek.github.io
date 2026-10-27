-- What an agent is doing while it works: its tool calls, its messages, the
-- node's own milestones (worktree, fallback, verify, push). The node sends
-- them in small batches as they happen, so a running ticket shows real steps
-- instead of "working…". Bounded per run (see STEP_LIMIT in src/node.ts).
CREATE TABLE run_steps (
  run_id  INTEGER NOT NULL REFERENCES ticket_runs(id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,             -- 1, 2, 3 … per run, in arrival order
  at      INTEGER NOT NULL,             -- unix seconds, the node's clock
  kind    TEXT NOT NULL CHECK (kind IN ('tool', 'text', 'error', 'node')),
  text    TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);
