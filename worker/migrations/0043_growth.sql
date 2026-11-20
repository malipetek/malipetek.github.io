-- The growth loops: guide tickets, observed contacts, domain MX cache.

-- A guide cycle ticket is marked the same way an SEO cycle is: 1 while open,
-- 2 once the reply (or its PR) was handled. guide_target is the desk target
-- the guide answers, so a retry window can read it back.
ALTER TABLE tickets ADD COLUMN guide_cycle INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN guide_target TEXT;
CREATE INDEX tickets_guide_cycle ON tickets(guide_cycle, created_at);

-- One MX lookup per domain per month: mx 1 has records, 0 has none, and a
-- lookup that never answered leaves no row, so it is asked again next time.
CREATE TABLE marketing_domains (
  domain     TEXT PRIMARY KEY,
  mx         INTEGER NOT NULL,
  checked_at INTEGER NOT NULL
);

-- What the site observation wrote for a contact: when it ran and which kind
-- of gap it found ('none' and 'unreachable' are answers too).
ALTER TABLE marketing_contacts ADD COLUMN observed_at INTEGER;
ALTER TABLE marketing_contacts ADD COLUMN gap_kind TEXT;
