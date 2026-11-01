-- Intake tickets and flexible relations.
--
-- An intake ticket is a request with no project: the client writes what they
-- need, a Worker-side agent sets the account up and files real work. It is
-- never claimed by a fleet node (the queue only claims approved items).
--
-- `site_id` lets a request name one of its project's sites; the build still
-- uses the project's main site unless the request says otherwise.
--
-- `ticket_actions` is the audit log of what the intake agent did: one row per
-- tool call, rendered in the thread and the admin view.
ALTER TABLE tickets ADD COLUMN site_id TEXT REFERENCES sites(id) ON DELETE SET NULL;
-- A short lease so two wakes of the same intake ticket never run the agent at once.
ALTER TABLE tickets ADD COLUMN intake_lock_at INTEGER;
CREATE INDEX tickets_site ON tickets(site_id);

CREATE TABLE ticket_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  args_json   TEXT,
  result_json TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX ticket_actions_ticket ON ticket_actions(ticket_id, id);
