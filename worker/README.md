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

One-time setup:

```sh
cd worker
wrangler d1 create malipetek-portal        # paste database_id into wrangler.jsonc
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

### Local runner (`src/runner.ts` ↔ `../runner/`)

`POST /runner/claim` and `POST /runner/tickets/:id/result`, authenticated by
the `RUNNER_TOKEN` secret (unset → 503, runner disabled). Claim only ever
returns tickets in `approved`. See `../runner/README.md`.

```sh
wrangler secret put RUNNER_TOKEN   # any long random string; same value in the runner config
```

Local dev: `wrangler d1 migrations apply malipetek-portal --local`, then
`pnpm dev`. With `DEV_RETURN_LINK=1` and `SITE_URL=http://localhost:4321` in
`.dev.vars`, the sign-in form shows the magic link instead of emailing it.
