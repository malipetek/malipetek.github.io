-- Hosting in the client's own Cloudflare account, and sites that are chosen
-- rather than derived from a task title.
--
-- `sites.host` has allowed 'cloudflare' since 0017, but nothing ever set it.
-- These columns remember which grant and account a site uses, which Worker
-- scripts represent its two channels, and the addresses Cloudflare gave them.
-- `cloudflare_*_deploy` records the deploy already mirrored, so a cron sweep
-- or a page refresh does not re-upload an unchanged site.
ALTER TABLE sites ADD COLUMN cloudflare_connection_id INTEGER REFERENCES cloudflare_connections(id);
ALTER TABLE sites ADD COLUMN cloudflare_account_id TEXT;
ALTER TABLE sites ADD COLUMN cloudflare_preview_script TEXT;
ALTER TABLE sites ADD COLUMN cloudflare_production_script TEXT;
ALTER TABLE sites ADD COLUMN cloudflare_preview_url TEXT;
ALTER TABLE sites ADD COLUMN cloudflare_production_url TEXT;
ALTER TABLE sites ADD COLUMN cloudflare_preview_deploy TEXT;
ALTER TABLE sites ADD COLUMN cloudflare_production_deploy TEXT;
ALTER TABLE sites ADD COLUMN cloudflare_error TEXT;
ALTER TABLE sites ADD COLUMN cloudflare_deployed_at INTEGER;

-- The deploy a mirror wrote, for the same "already there" check at deploy level.
ALTER TABLE site_deploys ADD COLUMN cloudflare_at INTEGER;
