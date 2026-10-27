# Plan: own hosting, and bring-your-own agent, GitHub and Cloudflare

Status: planned 2026-10-27, not built. Decisions are Ali's; open items are at
the end.

## Why

GPTflare (`gptflare.site`, `api.gptflare.site`) hosted client sites through a
Custom GPT with Actions. The site looks bad and the approach is outdated:
ChatGPT now has apps (plugins) on MCP. We keep the capability — a client can
get a static site — and build it ourselves.

The platform stays the product. Agents, ChatGPT included, are ways into it:

- A client can connect **any agent over MCP**, or install **our ChatGPT
  plugin**, so their own subscription does the work with our tools and they
  pay less for AI. Optional: our fleet does the work by default.
- A client can connect **GitHub** to have us work on their repo, or keep new
  projects in their account. Optional: by default the repo is ours.
- A client can host in **their own Cloudflare account**. Optional: by default
  the site is on `malipetek.online`.

Rules that do not change: every request is approved by Ali; client work lands
only on `malipetek/<ticket>-<id>`; nothing reaches production until it is
published; the attention level decides how closely Ali checks. A client's own
agent gets no more access than our fleet.

## Phase 1 — Hosting on malipetek.online, GPTflare removed

`malipetek.online` is on the same Cloudflare account
(`a60af2542282e283101650bebed42dcf`) and unused. A separate domain keeps client
pages off `malipetek.dev`'s site boundary (cookies, same-site requests), as
github.io does for github.com.

### Addresses

- Production: `<slug>.malipetek.online`
- Preview: `<slug>--preview.malipetek.online`
- Both are one level deep, so the free Universal SSL wildcard covers them. Do
  not use `x.sites.malipetek.online` (needs Advanced Certificate Manager).
- DNS: a proxied wildcard `*` record; the apex `malipetek.online` can redirect
  to `malipetek.dev`.
- Reserved slugs: `www`, `api`, `admin`, `portal`, `mail`, `preview`, anything
  ending `--preview`.
- Client domains later: Cloudflare for SaaS custom hostnames on this zone
  (first 100 free), stored as `sites.custom_domain`.

### Storage and serving

- R2 bucket `malipetek-sites` (create with the wrangler OAuth login; the shell
  token has no R2 — see AGENTS.md).
- New Worker `malipetek-sites` (`sites-worker/` in this repo), route
  `*.malipetek.online/*`, bindings: R2 bucket, read-only D1 (`malipetek-portal`)
  or a KV mirror of pointers if D1 reads are too slow per request.
- Deploys are immutable: `sites/<slug>/<deployId>/<path>`, plus a
  `manifest.json` (path → sha256, size, content type).
- Request → host → slug and channel (preview or production) → that channel's
  deploy id → R2 object. `index.html` for directories, `404.html` fallback,
  optional SPA fallback flag per site.
- Headers: long cache for hashed assets, short for HTML; strict CSP default,
  `X-Content-Type-Options`, `Referrer-Policy`, no cookies set. Previews add
  `X-Robots-Tag: noindex`.
- Static only. No server code, no Functions.

### Data (worker migration 0017)

```sql
CREATE TABLE sites (
  project_id     TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  slug           TEXT NOT NULL UNIQUE,
  state          TEXT NOT NULL CHECK (state IN ('allocating','ready','failed')),
  host           TEXT NOT NULL DEFAULT 'ours' CHECK (host IN ('ours','cloudflare')), -- phase 4
  preview_deploy     TEXT,
  production_deploy  TEXT,
  custom_domain  TEXT,
  error          TEXT,
  failure_alerted_at INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE TABLE site_deploys (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ticket_id   INTEGER,           -- the run that produced it, when one did
  commit_sha  TEXT,
  files       INTEGER NOT NULL,
  bytes       INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
DROP TABLE platform_accounts;
DROP TABLE project_sites;
```

Limits per deploy (constants in `sites.ts`, replacing `PREVIEW_LIMITS`):
file count, per-file and total size, no `..` / `.git` / absolute paths.

### Flow

1. **Allocate** (`POST /portal/projects/:id/site`, also offered at the end of
   onboarding for `kind = 'new'`): pick a free slug from the project slug,
   create the source repo from a starter template (phase 2 decides where it
   lives), upload a placeholder deploy, point preview and production at it.
   `allocating → ready | failed`. No sign-in email. The cron retries
   `allocating` and mails Ali once per failure (keep `takeNewSiteFailures`).
2. **Build**: a run on a site project still starts from the preview base
   (`/node/projects` hands `baseRef`). When the run finishes, the node runs the
   project's build (`npm ci && npm run build`, output dir from the template's
   config) in its worktree.
3. **Upload**: node → `POST /node/sites/:slug/deploys` with the manifest; the
   Worker answers which hashes it lacks; node uploads only those
   (`PUT /node/sites/:slug/deploys/:id/files/:sha`); `POST …/:id/finish`
   validates and records the deploy, then points **preview** at it. Thread
   note: "The preview has this change: <link>. Nothing is live until it is
   published." (keep the wording from `node.ts`).
4. **Publish**: `POST /admin/projects/:id/site/publish` (and the client route
   when `clientPublish` is on) points production at the preview's deploy.
5. **Rollback**: `POST /admin/projects/:id/site/rollback {deployId}` points
   production at an older deploy. Client route only with `clientPublish`.
6. Old deploys: keep the last N (setting, default 20) plus whatever a channel
   points at; the cron deletes the rest from R2.

### Templates from GPTflare

The only part of GPTflare worth keeping is its Astro templates, if any are
good. Before deleting anything: list the starter repos in the GPTflare-Sites
GitHub org, screenshot each, keep the good ones in `templates/<name>/` (static
output, no Keystatic dependency unless it builds statically), each with a
`template.json` (name, description, build command, output dir). Drop the rest.

### Removal

- Delete `worker/src/platform.ts`, the `platform_*` MCP tools in `kb.ts`,
  `src/pages/platform.astro`, `test/mock-platform.mjs` and its e2e cases.
- Rewrite `worker/src/sites.ts` around the new tables; keep the idempotent
  `advanceSite` + cron shape and the once-per-failure alert.
- Settings: drop `sitesDomain: 'gptflare.site'` (the domain becomes a constant
  or `sitesDomain: 'malipetek.online'`); keep `clientPublish`.
- Copy: GPTflare mentions in `src/pages/portal/index.astro` (site setup
  steps), `src/pages/agents.astro`, `public/llms.txt`,
  `public/.well-known/mcp-server.json`, `worker/README.md`.
- Secrets: `wrangler secret delete PLATFORM_GPT_API_KEY`; drop
  `PLATFORM_URL` from `shared.ts`.
- The one existing `project_sites` row (stuck in `provisioning`) is not in
  production; it goes with the table.

### Tests

Worker e2e: allocate, deploy with dedupe, limits refused, preview ≠
production until publish, rollback, a client cannot reach another client's
site routes, reserved slugs refused. Serving Worker: host parsing, index /
404 / SPA fallback, preview noindex.

## Phase 2 — GitHub App

**App created 2026-10-27** (github.com/settings/apps/malipetek-dev):
slug `malipetek-dev`, App ID 5495973, Client ID `Iv23liVCtH8c4lhyKCrH`,
installable on any account. Redirect URI
`https://malipetek-intercom.malipetek.workers.dev/auth/github/callback`,
webhook `…/hooks/github`, "Request user authorization during installation"
on, device flow off. Secrets already on the Worker: `GITHUB_APP_ID`,
`GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`,
`GITHUB_WEBHOOK_SECRET`. Not yet installed anywhere — do that once the
webhook route exists.

One GitHub App owned by Ali, installable on a client's account or org.

- Permissions: contents read/write, pull requests read/write, metadata read.
  Webhook: installation created/deleted/repositories changed.
- The Worker holds the app's private key (secret) and mints short-lived
  installation tokens. A node asks for one per run
  (`POST /node/runs/:id/git-token`), scoped to that project's repo only. No
  stored credentials on nodes. This also settles "can nodes clone private
  repos".
- Our own org's repos use the same app installed on our org, so there is one
  code path.
- Data (migration 0018):
  - `github_installations (installation_id PK, user_id, account_login,
    account_type, created_at, removed_at)`
  - `projects.repo_source TEXT CHECK IN ('ours','github_app','zip','none')`
    replacing the meaning of `repo_kind`; `projects.repo_full_name`.
- Onboarding step "Where your code lives": *We keep it* (default; repo in our
  org) or *Connect GitHub* (install the app, pick a repo, or let us create the
  new project's repo in their account).
- Revoking on GitHub removes access; the webhook marks the installation
  removed and the project falls back to "needs a repo" in admin.

## Phase 3 — Your agent, our tools; the ChatGPT plugin; handoff setting

### One tool set for every agent

The MCP server (`/mcp`, OAuth already in `oauth.ts`, agent tokens `cat_…`)
exposes the platform. Same tools for ChatGPT, Claude, Cursor, Codex, anything.

Existing client tools stay: `portal_projects`, `portal_requests`,
`portal_request`, `portal_file_request`, `portal_reply`, `portal_set_budget`,
`portal_withdraw`.

New, for a client's own agent doing the work on an approved request:

- `project_context` — brief, request thread, site state, template build
  config. Read only.
- `workspace_files` / `workspace_read` — file tree and file contents at the
  request's base (preview base for site projects). Read only.
- `submit_change` — changed files for an approved request; written to
  `malipetek/ticket-<id>` (never the preview or default branch), with the
  deploy limits. Marks the ticket's work as `by: client_agent`.
- `preview_build` — ask for a build and preview deploy of that branch; returns
  the link when ready.
- `site_status` / `site_deploys` — preview and production links, history.
- `site_publish` / `site_rollback` — only when `clientPublish` is on; marked
  destructive so the client confirms.

Each tool carries read-only / destructive annotations. The tools only accept
work on requests Ali approved; review still follows the attention level.

Owner tools (Ali's own token, never through client OAuth; the consent page
keeps refusing the admin email): approve / decline, queue and fleet status,
publish, rollback.

### The ChatGPT plugin

- The same MCP server as a ChatGPT app. The tools return an HTML widget
  alongside text for: the request list (mini four-dot strips), one request
  (step strip, now/next line, budget gauge — from `src/lib/tracker.ts`), and
  a site card (preview / production links, last deploys).
- First test in developer mode with a client account (e.g.
  altermalipetek@gmail.com) end to end: connect, file a request, Ali
  approves, the client's ChatGPT submits a change, preview link appears.
  Directory submission after that.

### Pricing

Work done by the client's own agent has AI cost $0 on our bill; they pay only
Ali's minutes. Tickets record `worked_by: 'fleet' | 'client_agent'`; the price
breakdown and the step strip show it ("Built by your agent").

### Onboarding

After the brief, three optional steps, each skippable with a default:

| | Default | Optional |
| --- | --- | --- |
| Agent | our fleet | any MCP agent (address + token), or our ChatGPT plugin |
| Code | repo in our org | Connect GitHub (phase 2) |
| Hosting | malipetek.online | your Cloudflare account (phase 4) |

### Handoff, per client

`users.handoff TEXT CHECK IN ('preview','pull_request') DEFAULT 'preview'`,
set by Ali in admin; onboarding suggests `pull_request` when GitHub is
connected.

- `preview`: the client sees a preview link and a Publish button (theirs or
  Ali's, per `clientPublish`). The portal and plugin never say PR, branch or
  merge.
- `pull_request`: finished work opens a pull request in their repo with the
  preview link in the description; they merge. Merging to their default
  branch triggers a production deploy only if they opt in.

## Phase 4 — Hosting in the client's Cloudflare account

Cloudflare has had self-managed OAuth clients since 2026-06-03: the client
picks which accounts to share and sees the scopes; grants are revocable; a
new OAuth client is private until its domain is verified (then it is public
with a verified badge). Scope names follow API-token permissions; the list is
at `GET https://api.cloudflare.com/client/v4/oauth/scopes`.

- Done (2026-10-27): scope list checked — Workers scripts, routes, R2 and
  DNS scopes all exist. OAuth client `malipetek` registered under Ali's
  account, client ID `ec178fe1350572efdadc6a872ee2f817` (private for now;
  needs a logo + the TXT-verified domain to go public — the verification TXT
  is already live on `malipetek.dev`, verification is polling). Client ID/secret live in the `malipetek-intercom` Worker secrets
  `CLOUDFLARE_OAUTH_CLIENT_ID` / `CLOUDFLARE_OAUTH_CLIENT_SECRET`; redirect
  URL `https://malipetek-intercom.malipetek.workers.dev/portal/cloudflare/callback`;
  verification TXT `cloudflare_oauth_client_publisher=…` added at
  `malipetek.dev` apex. Scopes: Workers Edit + Workers Routes Edit required;
  DNS Write + Zone Read optional; Account Settings / Memberships / User
  Details Read required.
- Store the refresh token encrypted (key in a Worker secret);
  `cloudflare_connections (user_id, account_id, scopes, token_enc,
  created_at, revoked_at)`.
- Deploy: the same immutable deploy, uploaded as a Workers static-assets
  version into their account (`<slug>` script, preview as a non-default
  version or a second script). Publish and rollback switch versions there.
  `sites.host = 'cloudflare'`.
- They pay Cloudflare directly; for a static site the free tier usually
  covers it. This is the answer for clients who do not want to pay us for
  hosting.

## Order

1. Phase 1 (hosting + template review + GPTflare removal).
2. Phase 2 (GitHub App).
3. Phase 3 (tools, plugin, onboarding steps, handoff).
4. Phase 4 (client Cloudflare), after the scope check.

Each phase: migrations applied and checked before the Worker deploy
(AGENTS.md), `pnpm --dir worker test` green, site deployed, checked live.

## Open

- Price of hosting on `malipetek.online` for metered clients (free, per site
  per month, or included in something). Phase 4 gives a no-cost alternative.
- Which GPTflare templates are good enough to keep (decided when reviewed).
- Whether a merge in a `pull_request` client's repo should auto-publish.
- A logo for the Cloudflare OAuth client (required to make it public; the
  `malipetek` client is private until then — fine for building against).
- Before building: Ali approves creating the GitHub App under his account.
