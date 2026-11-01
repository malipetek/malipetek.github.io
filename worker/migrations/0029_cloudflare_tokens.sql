-- A Cloudflare connection can be an OAuth grant (an hour, refreshable only if
-- the client was configured to issue refresh tokens) or an API token the
-- client pastes (valid until they revoke it). The token path exists because
-- the `malipetek` OAuth client does not accept `offline_access`, so its grants
-- cannot be refreshed.
ALTER TABLE cloudflare_connections ADD COLUMN kind TEXT NOT NULL DEFAULT 'oauth';
ALTER TABLE cloudflare_connections ADD COLUMN label TEXT;
