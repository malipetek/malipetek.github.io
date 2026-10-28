-- Marketing, in the same store as the portal: who we may write to, what we
-- queued, and what happened. Times are unix seconds.
--
-- The worker only ever sends to a contact row, never to a bare address: that
-- is where the opt-out, the source and the reason we may write live. A contact
-- with status opted_out or bounced is never picked up again.

CREATE TABLE marketing_contacts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT,
  business        TEXT,
  -- The public page the address came from, and how it got here:
  -- manual | warm | csv | site | inbound.
  site            TEXT,
  source          TEXT NOT NULL DEFAULT 'manual',
  source_url      TEXT,
  -- The one specific, true observation the first email opens with.
  gap             TEXT,
  -- Why we may write: legitimate_interest | consent | existing_relationship.
  consent_basis   TEXT NOT NULL DEFAULT 'legitimate_interest',
  status          TEXT NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'queued', 'contacted', 'replied', 'opted_out', 'bounced', 'paused')),
  notes           TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  last_contacted_at INTEGER,
  opted_out_at    INTEGER
);
CREATE INDEX marketing_contacts_status ON marketing_contacts(status, updated_at DESC);
CREATE INDEX marketing_contacts_email ON marketing_contacts(email);

-- One row per intended send or post. Email rows carry the rendered text, so
-- what went out can be read back after a template changes.
CREATE TABLE marketing_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  channel       TEXT NOT NULL CHECK (channel IN ('email', 'x', 'linkedin')),
  kind          TEXT NOT NULL,
  contact_id    INTEGER REFERENCES marketing_contacts(id) ON DELETE SET NULL,
  campaign      TEXT NOT NULL DEFAULT 'launch',
  step          INTEGER NOT NULL DEFAULT 0,
  to_email      TEXT,
  subject       TEXT,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  scheduled_at  INTEGER,
  sent_at       INTEGER,
  external_id   TEXT,
  error         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX marketing_messages_due ON marketing_messages(status, scheduled_at);
CREATE INDEX marketing_messages_contact ON marketing_messages(contact_id, status);
CREATE INDEX marketing_messages_channel ON marketing_messages(channel, status, scheduled_at);

-- The audit trail: every send, failure, reply, opt-out and publication.
CREATE TABLE marketing_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER REFERENCES marketing_messages(id) ON DELETE SET NULL,
  contact_id  INTEGER REFERENCES marketing_contacts(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,
  detail      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX marketing_events_created ON marketing_events(created_at DESC);
CREATE INDEX marketing_events_contact ON marketing_events(contact_id, created_at DESC);
