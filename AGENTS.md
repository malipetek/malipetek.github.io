# AGENTS.md

## Admin workbench (one app, two hosts)
- Source: `packages/admin-ui/src` (React, plain JSX). It talks only through `api(method, path, body)`.
- Web: `src/pages/portal/admin.astro` mounts `src/components/AdminWorkbench.jsx` (portal session in localStorage).
- Harness: `packages/dsh-admin/src/client.jsx` → build with `node packages/dsh-admin/build.mjs` (writes `client.js`, React comes from the Harness). Host commands `/admin api …` and `/admin localinfo` in `packages/dsh-admin/index.js`. Host changes need a Harness restart.
- Local web dev against production data: `PUBLIC_CHAT_ENDPOINT=https://malipetek-intercom.malipetek.workers.dev npx astro dev --port 4321 --host 127.0.0.1` (the Worker's CORS allows only :4321).

## Deploy
- Two Cloudflare credentials, neither covers everything: the shell's `CLOUDFLARE_API_TOKEN` has D1 (migrations, `d1 execute`) but no R2; the wrangler OAuth login (`env -u CLOUDFLARE_API_TOKEN …`) has R2 but no D1. Worker deploys work with either. Always pass `CLOUDFLARE_ACCOUNT_ID=a60af2542282e283101650bebed42dcf`. Apply migrations and check they succeeded before deploying a Worker that needs them.
- Worker: `pnpm --dir worker test` then `pnpm --dir worker deploy`; new migrations first with `npx wrangler d1 migrations apply malipetek-portal --remote` (in `worker/`). Attachments need the R2 bucket once: `npx wrangler r2 bucket create malipetek-portal-files`.
- Site: `npx astro build && npx wrangler deploy` at the repo root. A "workers/routes" API error after "Uploaded malipetek-site" has been harmless; check the live page.

## Fleet
- Nodes: MacBook (launchd `dev.malipetek.node`, runs from this repo's `fleet/`) and G500 (`ssh DTNMachineG500`, systemd user unit `malipetek-node`, code in `~/malipetek-fleet/`; copy `fleet/*.mjs` there and restart after changes).
