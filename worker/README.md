# malipetek.dev intercom worker

The Cloudflare Worker behind the orange intercom on the home page. It is a
separate package with its own dependencies and is **not** part of the Astro
build. The static site talks to it over `PUBLIC_CHAT_ENDPOINT`; when that env
var is unset the front end falls back to the local mock in
`src/lib/chatBackend.js`, so `pnpm dev` still works with zero setup.

The assistant is a [Flue](https://flueframework.com) agent
(`src/agents/intercom.ts`). Each visitor session maps to one Durable Object
conversation, so history persists on the platform — `/chat` only forwards the
newest message and polls the conversation snapshot until the turn settles.

## Endpoints

| Method | Path       | Body                                          | Does                                                       |
| ------ | ---------- | --------------------------------------------- | ---------------------------------------------------------- |
| POST   | `/chat`    | `{ messages, turnstileToken }`                | Verifies the visitor, then relays the agent's reply.       |
| POST   | `/handoff` | `{ email, message, summary, turnstileToken }` | Stores the note in Directus and emails it via the binding. |
| GET    | `/health`  | —                                             | Returns `{ ok: true }`.                                    |
| *      | `/auth/*`, `/portal/*`, `/admin/*` | see `src/portal.ts`     | Client portal (below).                                     |
| *      | `/kb/*`    | see `src/kb.ts`                               | Public knowledgebase (below).                              |
| *      | `/mcp`     | JSON-RPC 2.0                                  | MCP server — knowledgebase + GPTflare tools.               |

`/chat` responds with `text/event-stream`. Each event is one `data:` line:

```txt
data: {"type":"chunk","text":"..."}
data: {"type":"end","kind":"answer","handoff":null}
data: {"type":"end","kind":"handoff","handoff":"one-paragraph summary"}
```

The first successful response also carries an `x-intercom-session` header. The
client sends it back as `x-session` so Turnstile only has to run **once per
session**; after that the signed token is accepted (30 minute TTL, bound to the
caller's IP).

## Chat flow

1. `POST /chat` with the conversation so far. On the first call the client also
   sends a Turnstile token.
2. The Worker rate-limits by `cf-connecting-ip` (20 requests / 5 min) and
   verifies Turnstile (skipped if `TURNSTILE_SECRET_KEY` is unset, for local dev).
3. It mints the session token, derives the visitor's conversation id
   (HMAC of the IP — stable across renewals, unguessable without the secret),
   and admits the newest user message to `POST /agents/intercom/<id>`.
4. It polls the conversation snapshot until the submission settles, then relays
   the assistant text — or the `request_handoff` summary — as the SSE
   vocabulary above.

The `/agents/*` mount is internal-only: its middleware requires the same
signed session, so the agent can't be driven without passing Turnstile first.
When the agent calls `request_handoff`, the client morphs the composer into
the email card, pre-filled with the summary.

## Email — Cloudflare Email Service

Handoffs are emailed through the `send_email` binding (requires the Workers
Paid plan and an onboarded domain):

1. In the Cloudflare dashboard: **Email Service → Email Sending → Onboard
   Domain**, choose `malipetek.dev`, accept the DNS records.
2. The `from` address (`CONTACT_FROM_EMAIL`, default `intercom@malipetek.dev`)
   must live on the onboarded domain.
3. The binding is pinned with `destination_address = "malipetek@gmail.com"`, so
   every send lands in that inbox regardless of code.

Directus storage stays optional: if `DIRECTUS_URL`/`DIRECTUS_TOKEN` are set the
note is also written to `contact_messages`. If neither email nor Directus is
configured, `/handoff` returns 502 `delivery_failed`.

## Secrets and configuration

Secrets are **never** committed. For local dev, copy `.dev.vars.example` to
`.dev.vars` (git-ignored). For deploys, set them with Wrangler:

```sh
cd worker
wrangler secret put OPENROUTER_API_KEY
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put DIRECTUS_URL
wrangler secret put DIRECTUS_TOKEN
wrangler secret put SESSION_SECRET
```

Non-secret vars live in `wrangler.jsonc` under `vars` (`CONTACT_FROM_EMAIL`).

| Name                   | Kind    | Purpose                                                  |
| ---------------------- | ------- | -------------------------------------------------------- |
| `OPENROUTER_API_KEY`   | secret  | OpenRouter key for the Flue `openrouter` provider (Qwen). 503 without it. |
| `TURNSTILE_SECRET_KEY` | secret  | Turnstile secret. Unset = skip verification (dev only).  |
| `DIRECTUS_URL`         | secret  | Optional. Directus base URL.                             |
| `DIRECTUS_TOKEN`       | secret  | Optional. Directus token (static token or scoped token). |
| `CONTACT_FROM_EMAIL`   | var     | From address (on the onboarded Email Service domain).    |
| `SESSION_SECRET`       | secret  | Signs session tokens + conversation ids. Long random string. |
| `EMAIL`                | binding | `send_email` — Cloudflare Email Service.                 |
| `FLUE_INTERCOM_AGENT`  | binding | Durable Object — generated by Flue, one per visitor session. |
| `RATE_LIMIT`           | binding | KV namespace for per-IP rate limiting.                   |

### KV for rate limiting

Create the namespace once and paste its id into `wrangler.jsonc`:

```sh
wrangler kv namespace create RATE_LIMIT
```

KV is eventually consistent, so the limiter is a soft cap — fine for keeping a
single abuser from hammering the model.

### Turnstile

Create a Turnstile widget for `malipetek.dev` (plus `localhost` for dev). Put
the **secret** in `TURNSTILE_SECRET_KEY` and the **site key** in the front
end's `PUBLIC_TURNSTILE_SITEKEY`.

## Directus

`/handoff` POSTs to `{DIRECTUS_URL}/items/contact_messages` with:

```json
{ "email": "...", "message": "...", "summary": "...", "source": "intercom" }
```

The `contact_messages` collection must accept those fields.

## Develop, typecheck, deploy

```sh
pnpm --dir worker install
pnpm --dir worker typecheck        # tsc --noEmit
pnpm --dir worker dev              # vite dev (local workerd, reads .dev.vars)
pnpm --dir worker deploy           # vite build && wrangler deploy
```

Run the script, not `wrangler deploy` on its own. A bare `wrangler deploy`
uploads whatever is already in `dist/`, so an edit to `src/` ships nothing and
looks like a successful deploy — the version id changes and the old code keeps
running. `typecheck` does not build either.

### Tests

```sh
pnpm --dir worker test:unit        # pure parts, under a second
pnpm --dir worker test:e2e         # the real dev server, about four minutes
pnpm --dir worker test:e2e budget  # only groups whose name contains "budget"
pnpm --dir worker test             # typecheck + both — run this before a deploy
```

`test/e2e.mjs` starts `vite dev` on a free port with its own throwaway state
folder (`MALIPETEK_E2E_STATE`: a fresh D1 with every migration, empty KV) and a
mock GPTflare control plane (`test/mock-platform.mjs`, injected through
`MALIPETEK_E2E_VARS`), so it never touches your dev database and runs beside
`pnpm dev`. It covers onboarding, hosted sites (isolation, the cron, failure
and retry, publishing), the queue (approval, leases, single billing), runs
reaching the preview, budgets, spending totals, Harness session logs
(`sessionlog`: upload, result, admin download), and the real `fleet/node.mjs`
running once against a repo that carries hook settings. It needs
`DEV_RETURN_LINK=1` and an empty (or test) `TURNSTILE_SECRET_KEY` in
`.dev.vars`, and it refuses to start otherwise.

Flue generates `.flue-vite/` and `.flue-vite.wrangler.jsonc` at build time —
both are git-ignored. Changing the agent's **function name** changes its
durable identity: express it as a `renamed_classes` migration in
`wrangler.jsonc`, don't delete the old tag.

## Regenerating the persona

`src/persona.md` is generated from `PRODUCT.md`, `src/lib/experience.js`, and
the project entries, so it can't drift from the site:

```sh
pnpm --dir worker build:persona
```

Re-run it after adding real projects or changing the work history. The agent
loads it as its instructions via `persona.md?raw`.

## CORS

Locked to `https://malipetek.dev`, `http://localhost:4321`, and
`http://127.0.0.1:4321`. Requests with any other `Origin` get a 403 and no CORS
headers. Requests without an `Origin` (server-to-server, curl) are allowed.

## Input caps

- `/chat`: at most 20 messages, 2000 chars each, 4000 chars total.
- `/handoff`: valid email ≤ 254 chars, message/summary ≤ 4000 chars each.
- `/chat` waits at most 25 s for the agent turn to settle before returning an
  error end event (the UI shows the email fallback).

## Client portal

Clients sign in at `malipetek.dev/portal` with a magic link, file requests,
and follow a ticket thread. Ali (whoever signs in as `ADMIN_EMAIL`) gets
`/portal/admin`: a ticket queue, Approve/Decline, private notes, and the
client ↔ project links. Code: `src/portal.ts`; schema: `migrations/`.

- **Storage:** D1 (`DB`). Sessions and magic-link tokens are stored only as
  SHA-256 hashes. Local repo paths are never stored here — a project only has
  a `slug`, which the (future) local runner maps to a folder on Ali's machine.
- **Approval:** a ticket starts as `new`. Only the admin can move it to
  `approved`; nothing in the Worker acts on a ticket by itself.
- **Mail:** client mail (links, replies, status changes) goes through the
  unpinned `MAILER` binding from `portal@malipetek.dev`; notices to Ali go
  through the pinned `EMAIL` binding. Private notes are never emailed.
- **Attachments** (`src/files.ts`, rules shared in `../src/lib/attachments.js`):
  any message — portal, email reply, `new@`, Ali's reply or private note — can
  carry up to 5 files of 10 MB (30 per ticket): images, PDF, text, CSV, JSON,
  zip, Word, Excel; never SVG or HTML. Send them as multipart form data with a
  `body` field and `files` parts to the same message routes. Bytes live in R2
  (`FILES`), served only as `attachment` with `nosniff` and a sandbox CSP. A
  file is visible wherever its message is: files on private notes reach Ali and
  the agent, never the client. Nodes fetch them from
  `GET /node/tickets/:id/files/:fileId?nodeId=` only while they hold a run.
- **Awaiting reply:** a client message on a filed ticket sets
  `client_waiting_since`; Ali's public reply, a status change, or
  `POST /admin/tickets/:id/answered` ("No reply needed") clears it. The
  workbench lists these under "Answer the client".
- **Unread:** opening a ticket sets `client_seen_at`; the client's list marks
  a request "new reply" when Ali or a status change spoke after that.
- **Search:** `GET /admin/search?q=` (3+ characters) finds tickets by any
  message in the thread, private notes and agent reports included. The
  workbench filter uses it.
- **Withdraw:** `POST /portal/tickets/:id/withdraw` (and the `portal_withdraw`
  tool) declines a request the client filed, only while it is `new` and nothing
  has run on it.
- **Status changes stop runs:** moving a ticket while a run works cancels the
  run. Its late report is recorded and its AI cost counted (unless the ticket is
  done or declined, whose bill is closed), but it never moves the ticket.

One-time setup:

```sh
cd worker
wrangler d1 create malipetek-portal        # paste database_id into wrangler.jsonc
wrangler d1 migrations apply malipetek-portal --remote
wrangler r2 bucket create malipetek-portal-files   # attachments; the deploy fails without it
```

`migrations apply` is the one command that needs the account named explicitly
when the API token can reach more than one account — without it the API answers
`7403  The given account is not valid or is not authorized to access this
service`, which reads like a permissions problem rather than a missing
selector:

```sh
CLOUDFLARE_ACCOUNT_ID=a60af2542282e283101650bebed42dcf \
  wrangler d1 migrations apply malipetek-portal --remote
```

`portal@malipetek.dev` must be allowed to send on the onboarded domain (same
Email Service setup as the intercom). On the site, the portal uses the same
`PUBLIC_CHAT_ENDPOINT` and `PUBLIC_TURNSTILE_SITEKEY`.

### Email threading (Email Routing → `src/inbound.ts`)

Every ticket email carries `Reply-To: reply+<ticket>.<c|a>.<sig>@malipetek.dev`.
Replying from any inbox posts into the thread — `c` as the client, `a` as Ali.
The sig is an HMAC of ticket + role (`SESSION_SECRET`), and the envelope sender
must also match the ticket's client (or `ADMIN_EMAIL`), else the mail bounces.
Quoted history is cut at the `##- Reply above this line -##` marker.
Registered clients can also open a ticket by mailing `new@malipetek.dev`.

Dashboard setup, once: **Email Routing → Settings → enable subaddressing**,
then route `reply@malipetek.dev` and `new@malipetek.dev` to this Worker.

### Work queue and fleet nodes (`src/queue.ts`, `src/node.ts` ↔ `../fleet/`)

Tickets are work items: `kind` client (portal, email) or system (Ali's own,
filed from the Harness with `POST /admin/work`), each with a `priority`, the
capabilities it `requires` (`["os:macos"]`), and an optional pinned `executor`.
Machines are **nodes**. Each heartbeats to `POST /node/heartbeat` every 30s and
leases work with `POST /node/claim`; the lease lapses three minutes after the
node goes quiet, and the reaper puts the item back (or, after three lapses or a
cancel, into review). `GET /admin/queue` says for every approved item which node
will take it, or why none can. A cron every five minutes reaps and mails Ali
once about anything stuck for 30 minutes. All `/node/*` routes use the
`RUNNER_TOKEN` secret (unset → 503). See `../fleet/README.md`.

**Landing finished work.** A run leaves its commit on a work branch
(`malipetek/task-7`), and where else it goes is the project's `push` policy.
The admin can also ask for a ticket's branch to go to the project's main line
from the UI: `POST /admin/tickets/:id/land` records the request, the node that
holds the folder sees it in its next heartbeat and pushes it
(`POST /node/land/:id/result` reports back). Git only accepts a fast-forward,
so this can never rewrite `main`; a refusal is recorded as a private note.

**Harness sessions.** A run made through the DeepSeek Harness (executors
`dsh`, `dsh-claude`, `dsh-opencode`; client work still only ever runs on
`claude`) reports `sessionId` (e.g. `session-db44e5d2-…`) and `sessionDir`
(its folder under `~/.dsh/sessions/` on the node) with its result; both are
held to a strict shape (no `/`, no `..`) and dropped when off, never a reason to
refuse the report (migration 0015). The node uploads the session log with
`PUT /node/runs/:runId/session?nodeId=` — raw zstd-compressed JSONL, at most
50 MB, only while it holds the run, stored in R2 at
`sessions/tickets/<ticket>/run-<run>.jsonl.zstd` — and says `sessionLog: true`,
which is only recorded when the object is really there. The admin views (on any
machine) fetch it with `GET /admin/runs/:runId/session`: the bytes as
`application/zstd`, with `x-session-id` and `x-session-dir` headers; 404 unless
a log was recorded. The run rows in the admin ticket and fleet views carry
`session_id`, `session_dir` and `session_log`; the client routes never do. The
Harness's own report (`POST /admin/tickets/:id/run-result`) may name the
session but cannot claim a stored log.

```sh
wrangler secret put RUNNER_TOKEN   # any long random string; same value in the runner config
```

### Hosted sites (`src/sites.ts`)

A `new` project gets a hosted site from the GPTflare control plane without Ali:

- `POST /portal/projects/:id/site` starts it. The platform mails a sign-in link
  to the address the client **already verified with us**, so each client has
  their own platform account and cannot reach anyone else's sites. The platform
  key stays a Worker secret.
- `advanceSite` is one idempotent step: `signin → creating → provisioning →
  ready` (or `failed`). `GET /portal/projects/:id/site` advances it while the
  client watches; the five-minute cron advances the rest and mails Ali once
  per failure. `POST /admin/projects/:id/site/retry` restarts a stopped site
  and reuses the platform's site id, so a retry never makes a second site.
- Once ready, `/node/projects` hands nodes the repo and `baseRef:
  origin/preview`; a claim says `preview: true`; the node returns the changed
  files and the Worker writes them with `edit-preview` (≤40 files, 512 KB each,
  2 MB total, no `..` or `.git` paths). Production changes only on a publish:
  `POST /admin/projects/:id/site/publish`, or the client's own
  `POST /portal/projects/:id/site/publish` when the `clientPublish` setting is on
  (off by default).
- Settings: `sitesDomain` (default `gptflare.site`) builds the URLs when the
  platform names only the site's slug; `clientPublish`.
- The platform's replies are read defensively and the last one is kept in
  `project_sites.last_payload`, shown in both admin views.

Local dev: `wrangler d1 migrations apply malipetek-portal --local`, then
`pnpm dev`. With `DEV_RETURN_LINK=1` and `SITE_URL=http://localhost:4321` in
`.dev.vars`, the sign-in form shows the magic link instead of emailing it.

## Knowledgebase (`src/kb.ts`)

The public "agentic coding knowledgebase" — problem/solution pairs from real
sessions. It lives in its own D1 (`KB_DB`, database `agentic-coding-kb`), which
the site Worker binds read-only for the `/kb` pages.

| Method | Path                    | Auth            | Does                                            |
| ------ | ----------------------- | --------------- | ----------------------------------------------- |
| GET    | `/kb/entries`           | public          | List/search (`q`, `status`, `language`, `tag`). |
| GET    | `/kb/entries/:idOrSlug` | public          | One entry with markdown bodies.                 |
| GET    | `/kb/stats`             | public          | Counts and languages.                           |
| POST   | `/kb/entries`           | key **or** admin| Create an entry.                                |
| PATCH  | `/kb/entries/:id`       | key **or** admin| Patch; a key only its own entries.              |
| GET/POST/DELETE | `/kb/keys`     | admin only      | Mint, list, revoke agent keys (`ack_…`).        |

Reads are public on purpose. Writes need a key minted by the admin — there is no
self-serve route, because "anyone can read, only we author" has to be enforced
somewhere the internet cannot reach. Keys are stored as SHA-256 and shown once.

`q` is never passed to FTS5 raw: tokens are stripped of FTS operators, quoted,
prefix-matched (`"migra"*` → `migration`) and ANDed. Without that, `?q=foo OR
bar"` is a 500.

Seeded entries came out of real sessions; when one of your agents solves
something worth keeping, `create_knowledge` over MCP is the intended path.

## MCP (`src/kb.ts` + `src/platform.ts` + `src/clientTools.ts`)

`POST /mcp` speaks the **streamable HTTP** transport at protocol `2025-06-18`,
so ChatGPT apps, Claude and any MCP client can mount the same tools: session ids
(echoed, not required), SSE when the client asks for it, `202` for notification
posts, batch requests, and `Origin` validation so a random web page cannot drive
it. `https://malipetek.dev/mcp` proxies here, so the public URL is the site's.

Tool failures come back as a result with `isError: true`, not a protocol error —
that is what lets a model read the message and correct itself.

Tools are the knowledgebase, the client's portal, and the GPTflare control-plane
bridge. `tools/list` hides `platform_*` from everyone but Ali's session.

| Group      | Auth                          | Examples                                                          |
| ---------- | ----------------------------- | ----------------------------------------------------------------- |
| `*_knowledge` | public read; `ack_` to write | `search_knowledge`, `get_knowledge`, `create_knowledge`           |
| `portal_*`    | a client's agent token (`cat_`) | `portal_projects`, `portal_requests`, `portal_request`, `portal_file_request`, `portal_reply`, `portal_set_budget`, `portal_withdraw` |
| `platform_*`  | admin session, then the platform's own sign-in | `platform_list_sites`, `platform_read_file`, `platform_edit_preview`, `platform_approve_preview` |

**Agent tokens.** A client makes one in the portal (*Connect an assistant*);
it is shown once and stored as a SHA-256 (`agent_tokens`, migration 0009), at
most five live per client, each revocable. A token acts as that client on the
`/portal/*` routes, and the `portal_*` tools are those same routes called
in-process — so ownership, validation, rate limits and the mail to Ali are the
browser's, not a copy. A token can never reach `/admin/*` (even one an admin
somehow held), cannot mint or revoke tokens, and is not a knowledgebase author.
It works with any MCP client that can send a header (Claude, Cursor, the
Harness, …).

**OAuth (`src/oauth.ts`, migration 0010)** for clients that will not take a
pasted key — ChatGPT's connectors. Discovery starts at
`https://malipetek.dev/.well-known/oauth-protected-resource/mcp` (the site
proxies `/.well-known/oauth-*` here); the issuer is the site, the consent page
is `/portal/authorize` on the site (it uses the client's portal session, and
sends a signed-out client through the magic link and back), and the
registration and token endpoints are this Worker's own origin — the site's
Astro CSRF guard refuses form-encoded POSTs, which a token request is.
Dynamic registration is open but grants nothing; PKCE S256 is required;
redirect URIs match exactly; codes are single-use, ten minutes, bound to the
client, redirect URI, user and challenge. The access token is an ordinary agent
token labelled with the app's name, so it appears in the portal with Revoke,
and reconnecting the same app replaces it. Consent refuses up front when five
other assistants are already connected. In ChatGPT: add a connector with the
URL `https://malipetek.dev/mcp` and OAuth authentication.

### GPTflare control plane

`src/platform.ts` bridges `api.gptflare.site` — the control plane that creates
and edits Astro + Keystatic sites (draft → provision → preview → approve →
production). It replaces the Custom-GPT Actions path:

- the platform key lives in the `PLATFORM_GPT_API_KEY` secret, not in a GPT
  configuration or a browser-automation script;
- every tool requires **our** admin auth first, then the platform's own
  per-conversation sign-in (`platform_start_auth` → magic link →
  `authRequestId` threaded through later calls).

```sh
wrangler secret put PLATFORM_GPT_API_KEY   # from the control plane's own .env
```

The platform's error strings are passed through untouched (`AUTH_REQUEST_EXPIRED`,
"the user must complete sign-in") because they are written to be acted on.

Deprecated: `platform-mcp.malipetek.workers.dev` is a retired mock that now
answers every JSON-RPC call with a pointer to `https://malipetek.dev/mcp`.

