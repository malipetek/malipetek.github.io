# AGENTS.md

## Admin workbench (one app, two hosts)
- Source: `packages/admin-ui/src` (React, plain JSX). It talks only through `api(method, path, body)`.
- Web: `src/pages/portal/admin.astro` mounts `src/components/AdminWorkbench.jsx` (portal session in localStorage).
- Harness: `packages/dsh-admin/src/client.jsx` → build with `node packages/dsh-admin/build.mjs` (writes `client.js`, React comes from the Harness). Host commands `/admin api …` and `/admin localinfo` in `packages/dsh-admin/index.js`. Host changes need a Harness restart.
- Local web dev against production data: `PUBLIC_CHAT_ENDPOINT=https://malipetek-intercom.malipetek.workers.dev npx astro dev --port 4321 --host 127.0.0.1` (the Worker's CORS allows only :4321).

## Client portal
- `/portal` (and `/portal/ticket`, the address in emails) mount `src/components/portal/ClientPortal.jsx`: React, hash routes (`#/ticket/12`), styles in `src/styles/client-portal.css`. The overview's 3D board is `initBoard` in `src/lib/workshop3d.ts` (the homepage machine with the client's own requests on it). Onboarding (`/portal/start`) is still the old Astro page.

## Marketing automation
- Desk: **Admin → Marketing** (`packages/admin-ui/src/marketing.jsx`); API and the send engine in `worker/src/marketing.ts`, schema in migration `0023_marketing.sql`.
- Email goes out from `hello@malipetek.dev` through the `MARKETING` send binding on the 5-minute cron; replies, opt-outs and bounces come back through the `hello@` branch of `worker/src/inbound.ts`.
- X/LinkedIn: `marketing/publisher` posts queued drafts from a real Chrome profile (no paid API), polled every 15 minutes by launchd, bearer `MARKETING_TOKEN` on `/marketing/publisher/*`.
- Prospects: `marketing/prospector/extract.mjs` reads only the URLs it is given; `marketing/prospector/directory.mjs` crawls one directory within robots.txt, depth and page budget. Both write the importable CSV. Setup order, gates and compliance: `marketing/automation.md`.

## Deploy
- Two Cloudflare credentials, neither covers everything: the shell's `CLOUDFLARE_API_TOKEN` has D1 (migrations, `d1 execute`) but no R2; the wrangler OAuth login (`env -u CLOUDFLARE_API_TOKEN …`) has R2 but no D1. Worker deploys work with either. Always pass `CLOUDFLARE_ACCOUNT_ID=a60af2542282e283101650bebed42dcf`. Apply migrations and check they succeeded before deploying a Worker that needs them.
- Worker: `pnpm --dir worker test` then `pnpm --dir worker deploy`; new migrations first with `npx wrangler d1 migrations apply malipetek-portal --remote` (in `worker/`). Attachments need the R2 bucket once: `npx wrangler r2 bucket create malipetek-portal-files`.
- Site: `npx astro build && npx wrangler deploy` at the repo root. A "workers/routes" API error after "Uploaded malipetek-site" has been harmless; check the live page.

## Fleet
- Nodes: MacBook (launchd `dev.malipetek.node`, runs from this repo's `fleet/`) and G500 (`ssh DTNMachineG500`, systemd user unit `malipetek-node`, runs from the git checkout `~/malipetek-src/fleet`: after pushing, `ssh DTNMachineG500 'git -C ~/malipetek-src pull -q && systemctl --user restart malipetek-node'`). Its `fleet-agents` Harness profile links the external-agents plugin from `~/.dsh/plugins/dsh-external-agents`.

## Client sites (malipetek.online)
- Serving worker: `sites-worker/` (`malipetek-sites`, routes `*.malipetek.online/*` + apex). Deploy: `cd sites-worker && npx wrangler deploy`.
- Deploys are immutable in R2 `malipetek-sites` (manifests + content-addressed blobs); `sites.preview_deploy`/`production_deploy` are pointers. Publish/rollback only move pointers.
- Nodes build the worktree (`malipetek.site.json` in the repo says how) and upload deploys via `/node/sites/:slug/deploys`; a pending `tickets.build_requested_at` means a client's agent asked for a preview build (`/node/builds/:ticketId`).

