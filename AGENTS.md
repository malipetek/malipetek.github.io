# AGENTS.md

## Admin workbench (one app, two hosts)
- Source: `packages/admin-ui/src` (React, plain JSX). It talks only through `api(method, path, body)`.
- Web: `src/pages/portal/admin.astro` mounts `src/components/AdminWorkbench.jsx` (portal session in localStorage).
- Harness: `packages/dsh-admin/src/client.jsx` → build with `node packages/dsh-admin/build.mjs` (writes `client.js`, React comes from the Harness). Host commands `/admin api …` and `/admin localinfo` in `packages/dsh-admin/index.js`. Host changes need a Harness restart.
- Local web dev against production data: `PUBLIC_CHAT_ENDPOINT=https://malipetek-intercom.malipetek.workers.dev npx astro dev --port 4321 --host 127.0.0.1` (the Worker's CORS allows only :4321).

## Client portal
- `/portal` (and `/portal/ticket`, the address in emails) mount `src/components/portal/ClientPortal.jsx`: React, hash routes (`#/ticket/12`), styles in `src/styles/client-portal.css`. The overview's 3D board is `initBoard` in `src/lib/workshop3d.ts` (the homepage machine with the client's own requests on it). Onboarding (`/portal/start`) is `src/components/portal/Start.jsx`, mounted in a static Astro shell like the portal itself.

## Intercom (the talk section)
- `src/components/Intercom.astro` streams from `PUBLIC_CHAT_ENDPOINT` (`/api` in production) through `src/lib/chatBackend.js`. The site Worker owns `malipetek.dev/*`, so it proxies `/api/*` to `malipetek-intercom` over the `INTERCOM` service binding (`src/pages/api/[...path].ts`); `/mcp` and `/.well-known/*` take the same hop.
- The assistant is a Flue agent (`worker/src/agents/intercom.ts`) on DeepSeek `deepseek-v4-flash` with `DEEPSEEK_API_KEY`; `/chat` answers 503 without that secret. It used to run a free OpenRouter model, which kept being withdrawn.

## Languages (i18n)
- Locales: `src/lib/locales.js` (35, English source). Clients pick theirs in the portal (globe button) → `users.locale` + `users.translation` (`deepseek | cloudflare | off`); Ali can set both in Admin → Clients.
- Ticket bridge: `worker/src/translate.ts`. Client messages are translated to English for Ali, his email and the agent brief; Ali's replies are translated into the client's language. Originals are never changed; translations live in `message_translations` (migration `0025_i18n.sql`). DeepSeek is the main engine (secret `DEEPSEEK_API_KEY`), Workers AI m2m100 (`AI` binding) the fallback. System lines stay English in the database and are translated in the portal by `systemLine` in `TicketView.jsx`.
- Interface strings: `src/i18n/messages/<locale>.json`, English in `en-US.json`, `t()` from `useT()` in the portal. After adding or changing English keys: `DEEPSEEK_API_KEY=… node scripts/i18n-sync.mjs` (also regenerates `src/i18n/mail.js`: the Worker's mail, status and preview-widget strings).
- Site: the homepage exists once per locale at `/<code>/` (English stays at `/`). `src/components/Home.astro` holds the markup and takes a `t`; `src/lib/site.js` builds it from the same catalogs (`site.*` keys, plus `offer.*` for the copy that lives in `src/lib/offer.js`). `Base.astro` takes `locale` and `languagePicker` and emits `hreflang`. Other pages are still English only.

## Marketing automation
- Desk: **Admin → Marketing** (`packages/admin-ui/src/marketing.jsx`); API and the send engine in `worker/src/marketing.ts`, schema in migration `0023_marketing.sql`.
- Email goes out from `hello@malipetek.dev` through the `MARKETING` send binding on the 5-minute cron; replies, opt-outs and bounces come back through the `hello@` branch of `worker/src/inbound.ts`.
- X/LinkedIn: `marketing/publisher` posts queued drafts from a real Chrome profile (no paid API), polled every 15 minutes by launchd, bearer `MARKETING_TOKEN` on `/marketing/publisher/*`.
- Writing the posts: no one does it by hand. The five-minute cron (`ensureContentCycle` in `worker/src/content.ts`) files an approved system ticket on `malipetek-dev-site` when the queue is thin; a fleet agent writes 2 X + 1 LinkedIn post and ends with an `<<<OUTBOX` JSON block; `finishContentCycle` (called from `node.ts` and portal `run-result`) checks and schedules them Tue/Thu/Sat. The last dozen posts in `marketing_messages` are the agent's memory — the brief lists them — and the desk's Marketing → Settings → Voice notes are appended to every brief.
- Prospects: `marketing/prospector/extract.mjs` reads only the URLs it is given; `marketing/prospector/directory.mjs` crawls one directory within robots.txt, depth and page budget; `marketing/prospector/osm.mjs` turns an OSM state file (`--pbf`, offline via `osmium`) or one Overpass query into business websites; `marketing/prospector/bulk.mjs` reads those homepages (`collect`) and has Jev/TypeSafe keep the US small businesses (`qualify`); `marketing/prospector/verify.mjs` drops addresses whose domain has no MX before import. Setup order, gates and compliance: `marketing/automation.md`.

## Deploy
- **master is the only deploy branch.** Merge into master; `.github/workflows/deploy.yml` runs the Worker typecheck, unit and e2e suites, applies D1 migrations, then deploys the intercom Worker, the site Worker and `malipetek-sites`, each with `BUILD_SHA=$GITHUB_SHA`. Nothing is deployed from a laptop: `pnpm deploy` and `pnpm --dir worker deploy` run `scripts/require-ci.mjs` and refuse unless `CI=true` (break-glass: `ALLOW_LOCAL_DEPLOY=1`). Do not use `npx wrangler deploy` by hand either; a route change that skips the build is exactly how a deploy went missing.
- The workflow needs one repo secret, `CLOUDFLARE_API_TOKEN`, with **Workers Scripts:Edit, Workers Routes:Edit, D1:Edit, and Zone:Read** on `malipetek.dev` and `malipetek.online`. `CLOUDFLARE_ACCOUNT_ID` is set in the workflow. If a deploy fails on permissions, fix the token — do not fall back to a laptop.
- Migrations: add `worker/migrations/NNNN_name.sql`, merge to master, and the workflow applies it before the Worker deploy. Never apply one by hand to production; `d1_migrations` makes the step idempotent.
- Attachments/site deploys need the R2 buckets once: `npx wrangler r2 bucket create malipetek-portal-files` and `npx wrangler r2 bucket create malipetek-sites`.
- **Agents work in their own worktree**, never the shared checkout: `scripts/agent-worktree.sh <branch>` creates one from `origin/master` (under `~/.cache/malipetek-runner/worktrees/`) and prints its path. Commit there, push the branch, open a PR. One agent, one branch, one folder; the shared checkout stays clean for Ali.
- Health: `https://malipetek.dev/portal/admin#health` (web) or Harness → Admin → Health. The five-minute cron checks the callback and redirect URLs, each OAuth client's return address, every node's heartbeat and version, the live `BUILD_SHA` against master, project clone errors, stuck tickets and stopped site setup. It mails once when a check fails and once when it recovers; it is the only source of those alerts now.

## Fleet
- Nodes: MacBook (launchd `dev.malipetek.node`, runs from this repo's `fleet/`) and G500 (`ssh DTNMachineG500`, systemd user unit `malipetek-node`, runs from the git checkout `~/malipetek-src/fleet`: after pushing, `ssh DTNMachineG500 'git -C ~/malipetek-src pull -q && systemctl --user restart malipetek-node'`). Its `fleet-agents` Harness profile links the external-agents plugin from `~/.dsh/plugins/dsh-external-agents`.

## Client sites (malipetek.online)
- Serving worker: `sites-worker/` (`malipetek-sites`, routes `*.malipetek.online/*` + apex). It deploys with everything else from master (the Deploy workflow); no separate manual deploy.
- Previews carry a feedback launcher (`public/preview-feedback.js`): note, voice note (transcribed by Workers AI Whisper) or annotated screenshot → a normal client ticket on that site's project. `sites-worker` injects it into preview HTML at serve time; client-Cloudflare previews get it at upload time (`worker/src/cloudflare-sites.ts`). Auth is `sites.feedback_token` (migration 0030), appended as `?mf=` to the portal's `feedbackUrl`; `POST /api/portal/preview-feedback` is the one portal route without a session. The widget's copy follows the client's `users.locale` (`GET /api/portal/preview-feedback/config`, keys `preview.*`). Screenshot rendering is vendored in `public/vendor/modern-screenshot.js`.
- Deploys are immutable in R2 `malipetek-sites` (manifests + content-addressed blobs); `sites.preview_deploy`/`production_deploy` are pointers. Publish/rollback only move pointers.
- Nodes build the worktree (`malipetek.site.json` in the repo says how) and upload deploys via `/node/sites/:slug/deploys`; a pending `tickets.build_requested_at` means a client's agent asked for a preview build (`/node/builds/:ticketId`).

