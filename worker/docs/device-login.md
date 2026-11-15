# Device sign-in for PTech Admin (custom-scheme PKCE)

PTech Admin is a desktop app, so it cannot read a magic-link inbox by itself.
It signs in with the standard device-authorization idea, narrowed to custom
scheme PKCE: the app opens a portal page in the browser, a portal **admin**
approves, and the app redeems a one-time code with the verifier only it holds.

- Worker: `worker/src/device.ts` (storage + checks), `worker/src/portal.ts`
  (routes), `worker/migrations/0040_device_login.sql` (table).
- Portal page: `src/pages/portal/device.astro` in `PTechGroup/ptechsolutions`.
- Binding rules: only a **browser session** of an **admin** may approve; an
  agent token (`cat_…`) is refused, exactly like `/admin/*`.

## Environment

| Name | Kind | Purpose |
| --- | --- | --- |
| `ADMIN_EMAILS` | var | Comma-separated portal admin addresses. Trimmed, matched case-insensitively. Everyone listed signs in with the admin role. |
| `ADMIN_EMAIL` | var | Legacy single admin address, still read. It is also the primary: invite-mail names and marketing test sends use the first configured admin. |
| `PORTAL_URL` / `SITE_URL` | var | `siteUrl(env)` builds `verificationUrl` from `PORTAL_URL` first (`https://ptechsolutions.net`). |
| `RATE_LIMIT` | KV binding | Per-IP limits on start, info and token. |
| `DB` | D1 binding | `device_authorizations`, `users`, `sessions`. |

`ADMIN_EMAILS` is additive: an unset or empty value changes nothing, and
`ADMIN_EMAIL` keeps working. A magic link only ever **raises** an existing
account to admin; it never demotes, so removing an address from
`ADMIN_EMAILS` does not take the role away from an account that already has it.

## Contract

All bodies are JSON. Responses on error are `{ "error": "<code>" }`.

### 1. `POST /auth/device/start` — public, IP rate-limited

Request:

```json
{ "challenge": "<base64url(sha256(verifier)), 43 chars>", "label": "PTech Admin", "state": "optional-opaque" }
```

- `challenge` is required: base64url **without padding** of the SHA-256 of a
  verifier made by the app. The verifier is 43–128 characters from
  `[A-Za-z0-9-._~]` (RFC 7636 §4.1).
- `label` is optional, trimmed to 80 characters; the consent page shows it.
- `state` is optional, at most 200 characters; it is echoed only in the
  approval redirect. It is **not** put in `verificationUrl`.

Response `200`:

```json
{
  "deviceCode": "<opaque token>",
  "verificationUrl": "https://ptechsolutions.net/portal/device?code=<encoded deviceCode>",
  "expiresAt": 1760000000
}
```

`expiresAt` is a Unix timestamp in seconds, 10 minutes after the start.
Errors: `bad_challenge` (400), `bad_label` / `bad_state` (400), `rate_limited`
(429).

Storage: `device_hash = sha256(deviceCode)`, `challenge_hash = sha256(verifier)`
as lowercase hex, the label, state, `created_at`, `expires_at`. No raw device
code is stored.

### 2. `GET /portal/device?code=…` — the browser page

The page gets the app's label (and confirms the code is still alive) from one
auxiliary endpoint:

- `GET /auth/device/info?code=<deviceCode>` (public, IP rate-limited) →
  `{ "label": "PTech Admin" | null, "expiresAt": 1760000000 }`, or 404
  `{ "error": "invalid_code" }` for an expired, used or unknown code. This is
  an auxiliary endpoint for the page; the desktop app does not need it.
- The person signs in with the existing email + six-digit code flow in the same
  window (or a magic link opened in another tab of the same browser, which the
  verify page sends back). `GET /portal/me` decides the role.
- A non-admin sees **“This account is not a portal admin”** and cannot approve.
- An admin sees the app label and **Approve / Cancel**. Cancel shares nothing.

### 3. `POST /portal/device/approve` — browser session + admin

Headers: `Authorization: Bearer <portal session>` (an agent token is refused).

Request:

```json
{ "deviceCode": "<the code from the start response>" }
```

Response `200`:

```json
{ "redirect": "ptech-admin://auth?code=<code>", "code": "<one-time authorization code>" }
```

If the start request supplied `state`, the redirect carries it:
`ptech-admin://auth?code=<code>&state=<encoded state>`.

The code is a random 32-byte token, valid for **5 minutes**, stored only as
`sha256(code)`, and bound to the approving admin's `user.id` and the original
`challenge_hash`. One approval per device code.

Errors: `forbidden` (403 — client account or agent token), `bad_device_code`
(400), `invalid_code` (400 — unknown, expired, already approved or used).

### 4. `POST /auth/device/token` — public, IP rate-limited

Request:

```json
{ "code": "<authorization code>", "verifier": "<the original verifier>" }
```

Checks, in one atomic claim: the code has been approved (`user_id` set), is
unused, is inside its 5-minute window, and
`sha256(verifier) === challenge_hash`. Only then is `used_at` set.

Response `200`:

```json
{
  "session": "<opaque portal session token>",
  "user": { "id": "…", "email": "admin@example.com", "name": "…", "role": "admin", "locale": "en-US" }
}
```

This is a normal portal session: 30 days, stored as SHA-256, housekeeping runs
in the same batch (`createSession` in `worker/src/sessions.ts`, shared with
`/auth/verify` and `/auth/code`).

Every failure — wrong verifier, expired code, used code, unknown code — is
`401 { "error": "invalid_code" }`; the response never says which check failed.
`rate_limited` (429) is the only other answer.

## Desktop app notes

1. Make a verifier: 32 random bytes base64url (43 chars) is enough.
2. Compute `challenge = base64url(sha256(verifier))` with no `=` padding.
3. `POST /auth/device/start`; open `verificationUrl` in the system browser.
4. Register the `ptech-admin://` scheme and wait for
   `ptech-admin://auth?code=…&state=…`.
5. `POST /auth/device/token` with the code and the verifier; use `session` as a
   bearer token on every portal request. Do not keep the verifier or code.
6. A browser may not hand the custom scheme off automatically. The consent page
   also shows an **Open PTech Admin** link with the same redirect, so the person
   can finish by hand.

Call `start` and `token` from the app's native HTTP client, which sends no
`Origin` header. The portal-wide origin allow-list still applies to browser
origins, so a webview that sends an unfamiliar `Origin` is refused with
`origin_not_allowed` before it reaches these routes.

## Deploying

Do not deploy from an agent session. For the record, the migration is applied
before the Worker that needs it:

```sh
cd worker
npx wrangler d1 migrations apply malipetek-portal --remote
npx wrangler deploy
```

Set `ADMIN_EMAILS` as a plain variable in `worker/wrangler.jsonc` (or the
dashboard) — it is not a secret. Example: `"a@example.com,b@example.com"`.
Locally, `wrangler d1 migrations apply malipetek-portal --local` applies
migration `0040` to the dev database.
