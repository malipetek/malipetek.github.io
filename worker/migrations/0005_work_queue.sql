-- The work queue: tickets become work items, machines become nodes, and a run
-- holds its ticket through a lease instead of hope.
--
-- Before this, one poller on one laptop took approved tickets, and a run that
-- died left its ticket `in_progress` for ever. "The runner is down" and "there
-- is nothing to do" looked the same. Now every node says when it was last seen,
-- every run expires unless its node renews it, and an approved item that no
-- live node can take is a state the admin view can name.

-- What kind of work it is. A client ticket comes from the portal or by email;
-- a system task is Ali's own, filed from the Harness, and needs no client.
ALTER TABLE tickets ADD COLUMN kind TEXT NOT NULL DEFAULT 'client';
-- Where it came from: portal | email | dsh | schedule.
ALTER TABLE tickets ADD COLUMN source TEXT NOT NULL DEFAULT 'portal';
-- Higher runs first; ties go to the item that has waited longest.
ALTER TABLE tickets ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
-- Capabilities a node must have to take it, as a JSON array: ["os:macos"].
ALTER TABLE tickets ADD COLUMN requires TEXT NOT NULL DEFAULT '[]';
-- Pin an executor (claude, opencode, dsh, devin). NULL lets the node choose.
-- Client work only ever runs on the sandboxed claude executor.
ALTER TABLE tickets ADD COLUMN executor TEXT;
-- When the admin was last told nothing could take this item, so a stall is
-- reported once rather than every five minutes.
ALTER TABLE tickets ADD COLUMN stalled_alerted_at INTEGER;

-- A machine that runs work: this MacBook, the G500, later a Cloudflare sandbox.
CREATE TABLE nodes (
  id            TEXT PRIMARY KEY,           -- stable name, e.g. 'macbook'
  hostname      TEXT NOT NULL DEFAULT '',
  os            TEXT NOT NULL DEFAULT '',   -- macos | linux | cloud
  -- JSON arrays the node reports on every heartbeat.
  capabilities  TEXT NOT NULL DEFAULT '[]', -- e.g. ["os:macos","xcode"]
  executors     TEXT NOT NULL DEFAULT '[]', -- e.g. ["claude","opencode"]
  slugs         TEXT NOT NULL DEFAULT '[]', -- project slugs it holds a folder for
  slots         INTEGER NOT NULL DEFAULT 1, -- runs it will hold at once
  version       TEXT NOT NULL DEFAULT '',
  -- 1 = take no new work (finish what is running). Set from the admin view.
  draining      INTEGER NOT NULL DEFAULT 0,
  last_seen_at  INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);

-- A run is held by a node until its lease runs out.
ALTER TABLE ticket_runs ADD COLUMN node_id TEXT;
ALTER TABLE ticket_runs ADD COLUMN lease_expires_at INTEGER;
ALTER TABLE ticket_runs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;
-- Set by the admin; the node sees it on its next heartbeat and stops the run.
ALTER TABLE ticket_runs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0;

-- The reaper: running runs whose lease has lapsed.
CREATE INDEX ticket_runs_lease ON ticket_runs(status, lease_expires_at);
-- The claim: approved items, best first.
CREATE INDEX tickets_queue ON tickets(status, priority DESC, updated_at);
