-- Set when Ali reads a queued email in the desk's review mode and lets it go.
-- With the "review first emails" setting on, only reviewed (or hand-edited)
-- first emails are sent; follow-ups ride on the first one.
ALTER TABLE marketing_messages ADD COLUMN reviewed_at INTEGER;
CREATE INDEX marketing_messages_review ON marketing_messages(channel, status, step, scheduled_at);
