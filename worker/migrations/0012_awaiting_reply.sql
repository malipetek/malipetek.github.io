-- When the client wrote last and Ali has not answered since. Set by a client
-- message (portal, agent token, email reply); cleared by Ali's public reply, a
-- status change he makes (the client is mailed about it), or "No reply needed".
-- NULL = nobody is waiting on Ali.
ALTER TABLE tickets ADD COLUMN client_waiting_since INTEGER;

-- Backfill: open threads whose last public word is the client's, after filing.
UPDATE tickets SET client_waiting_since = (
  SELECT m.created_at FROM ticket_messages m
   WHERE m.ticket_id = tickets.id AND m.internal = 0 AND m.author IN ('client', 'ali')
   ORDER BY m.id DESC LIMIT 1
)
WHERE status <> 'new' AND kind = 'client' AND (
  SELECT m.author FROM ticket_messages m
   WHERE m.ticket_id = tickets.id AND m.internal = 0 AND m.author IN ('client', 'ali')
   ORDER BY m.id DESC LIMIT 1
) = 'client'
AND (SELECT count(*) FROM ticket_messages m WHERE m.ticket_id = tickets.id AND m.author = 'client') > 1;

-- When the client last opened the ticket, so their list can mark what is new
-- since. NULL = never opened in the portal (mail-only clients).
ALTER TABLE tickets ADD COLUMN client_seen_at INTEGER;
