-- Attachments. The bytes live in R2 (binding FILES) under tickets/<ticket>/<id>;
-- a file belongs to one message and is visible exactly where that message is.
CREATE TABLE ticket_files (
  id          TEXT PRIMARY KEY,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  message_id  INTEGER NOT NULL REFERENCES ticket_messages(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX ticket_files_ticket ON ticket_files(ticket_id, created_at);
CREATE INDEX ticket_files_message ON ticket_files(message_id);
