-- Marketing at volume: where each address came from, which country it is in,
-- which provider sent each email, and which queued emails Ali rewrote by hand.

-- The label an import carried (`osm-co-mail-only`, `bulk-tranco-2026-10`…), so
-- bounce, reply and complaint rates can be read per source.
ALTER TABLE marketing_contacts ADD COLUMN source_kind TEXT;
-- ISO 3166-1 alpha-2 when known; consent-only countries are never mailed cold.
ALTER TABLE marketing_contacts ADD COLUMN country TEXT;
CREATE INDEX marketing_contacts_source ON marketing_contacts(source_kind);

-- `cloudflare` or `ses`; the provider's message id goes in external_id.
ALTER TABLE marketing_messages ADD COLUMN provider TEXT;
-- Set when Ali edits a queued email; "Re-render scheduled" leaves these alone.
ALTER TABLE marketing_messages ADD COLUMN edited_at INTEGER;

-- Everything imported before labels existed came from the first CSV batch.
UPDATE marketing_contacts SET source_kind = 'first-import' WHERE source_kind IS NULL AND source = 'csv';
UPDATE marketing_messages SET provider = 'cloudflare' WHERE channel = 'email' AND status = 'sent' AND provider IS NULL;
