-- Local runner output gets its own author. SQLite can't alter a CHECK
-- constraint, so the table is rebuilt (nothing references it by FK).

CREATE TABLE ticket_messages_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author      TEXT NOT NULL CHECK (author IN ('client', 'ali', 'system', 'runner')),
  body        TEXT NOT NULL,
  internal    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
INSERT INTO ticket_messages_new (id, ticket_id, author, body, internal, created_at)
  SELECT id, ticket_id, author, body, internal, created_at FROM ticket_messages;
DROP TABLE ticket_messages;
ALTER TABLE ticket_messages_new RENAME TO ticket_messages;
CREATE INDEX ticket_messages_ticket ON ticket_messages(ticket_id, id);
