-- Fleet health and settings.
--
-- A node now reports its health with every heartbeat — load, memory, disk,
-- battery, the executors it found and the services it watches — so a stopped
-- process on the G500 shows up in the admin views instead of only as silence.
-- And a node's settings can be changed from the admin views: the overrides are
-- stored here and handed back on the next heartbeat, so a remote machine is
-- reconfigured without a shell on it.

-- JSON, the node's last health report. See fleet/node.mjs `health()`.
ALTER TABLE nodes ADD COLUMN health TEXT NOT NULL DEFAULT '{}';
-- JSON, settings Ali set from an admin view: { slots?, capabilities?, executors? }.
-- They win over the node's own config file.
ALTER TABLE nodes ADD COLUMN overrides TEXT NOT NULL DEFAULT '{}';

-- System-wide settings, one row per key. Code holds the defaults; a row exists
-- only once Ali changes something.
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- When Ali was last told this node went offline, so it is said once per outage.
-- Whether to say it at all is a per-node override (alertOfflineMinutes).
ALTER TABLE nodes ADD COLUMN offline_alerted_at INTEGER;
