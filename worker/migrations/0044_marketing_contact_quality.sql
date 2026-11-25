-- source_url already exists (0023_marketing.sql).
ALTER TABLE marketing_contacts ADD COLUMN trigger TEXT;
ALTER TABLE marketing_contacts ADD COLUMN trigger_url TEXT;
ALTER TABLE marketing_contacts ADD COLUMN verified_at INTEGER;
ALTER TABLE marketing_contacts ADD COLUMN quality_hold TEXT;
ALTER TABLE marketing_messages ADD COLUMN role_override_reason TEXT;
ALTER TABLE marketing_messages ADD COLUMN sequence_kind TEXT;
