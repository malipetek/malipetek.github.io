# Marketing automation

Three parts, one desk. Everything is queued and recorded in **Admin → Marketing**;
nothing sends that the desk does not hold.

| Part | Cadence | Lives in |
| --- | --- | --- |
| Email sequences | every 5 minutes, Worker cron | [worker/src/marketing.ts](../worker/src/marketing.ts) |
| X and LinkedIn posts | every 15 minutes on this Mac | [publisher/](publisher/README.md) |
| Prospect lists | by hand, per batch | [prospector/](prospector/README.md) |

## One-time setup, in this order

```sh
# 1. Schema. The shell token has D1; the account id is required.
cd worker
CLOUDFLARE_ACCOUNT_ID=a60af2542282e283101650bebed42dcf \
  npx wrangler d1 migrations apply malipetek-portal --remote
npx wrangler d1 execute malipetek-portal --remote \
  --command "SELECT name FROM sqlite_master WHERE name LIKE 'marketing_%'"
cd ..

# 2. The publisher's shared secret. Paste the same value into
#    marketing/publisher/.env afterwards.
cd worker && npx wrangler secret put MARKETING_TOKEN && cd ..

# 3. Deploy.
pnpm --dir worker test && pnpm --dir worker deploy
```

Two dashboard steps that no command covers:

- **Email Routing** (Email → Email Routing → Routes): `hello@malipetek.dev` →
  **Send to a Worker** → `malipetek-intercom`. The existing `reply@` and `new@`
  rules stay. Do not also forward `hello@` somewhere: the Worker forwards the
  mail Ali should read, so a second rule would double it.
- **Sending**: `hello@malipetek.dev` is on the already-onboarded
  `malipetek.dev` sending domain, so DNS is done. The binding is
  `MARKETING` in `worker/wrangler.jsonc`, separate from the portal's own
  mail, so a cold-email reputation problem cannot spill into magic links.

Then, in the desk: **Marketing → Settings** → postal address, from name, caps,
send window → **Live**. Until that toggle is on, the cron does nothing and says
`paused` when asked to run.

Finally the publisher: `marketing/publisher/publish.sh --login`, then
`marketing/publisher/install.sh`.

## The gates

A run sends email only when all of these hold:

| Gate | Default |
| --- | --- |
| `live` | off |
| `MARKETING` binding present | — |
| Postal address set | empty |
| Inside the send window, local time | 08:00–17:00, offset +180 min |
| Weekdays only | on |
| Daily cap across all sequences | 20 |
| Per run, every 5 minutes | 5 |
| Contact not replied / opted out / bounced | enforced per message |

An import also pauses any contact without a `gap` (the specific observation),
because the cold sequences are written around one. Nothing half-written leaves.

## Replies, opt-outs, bounces

- **Any reply** stops that contact's remaining sequence and mails Ali. A polite
  question should not keep receiving follow-ups.
- **"no", "stop", "unsubscribe", "remove me"** (and the usual variants) mark the
  contact `opted_out`, cancel everything queued and mail Ali once. The address
  stays, so an import can never add it back.
- **Bounces** arrive as a delivery report on `hello@`; the contact is marked
  `bounced` and its queue cancelled.
- **Unknown senders** and mail that fails the DMARC/DKIM check are forwarded to
  Ali and logged, but never treated as that contact's reply.

All of it is visible in the desk's event list.

## Pausing everything

| What | How | Effect |
| --- | --- | --- |
| Cold email | Marketing → Settings → **Paused** | cron sends nothing; queued rows keep their dates |
| Social | `marketing/publisher/install.sh remove` | no posts; queued posts stay `scheduled` |
| One contact | Contacts → **Opt out** | its queue is cancelled |

Nothing is lost by pausing, and resuming picks up whatever is still due.

## Watching it

- **Desk → Marketing**: sent today, next due, the last events, and every failure
  with the provider's reason. Retry from the Queue tab.
- `npx wrangler tail malipetek-intercom --format pretty` for `marketing_send`,
  `inbound_marketing`, `inbound_bounce`.
- `marketing/publisher/publish.log` for posts.

## Compliance, in one page

- Anti-spam law needs a real postal address on every commercial email. The cron
  refuses to run without one, and every message carries the address and
  `Reply "no" and I will not write again.`
- Cold contacts are **business addresses published for contact**, written to
  about their own site: legitimate interest. Personal addresses (a named
  person's inbox on a team page) are not imported.
- `source_url` on every contact is the evidence of where the address was
  public. Keep it; that is the answer to "where did you get my address".
- Everyone who replies, positively or not, becomes a real conversation. Reply
  as yourself.
- **Erasure request**: remove the row and its messages.

  ```sh
  cd worker
  npx wrangler d1 execute malipetek-portal --remote \
    --command "DELETE FROM marketing_contacts WHERE email = 'someone@example.com'"
  ```

  Opting out is enough to never be contacted again; erasure is for someone who
  asks that the record itself go. Events keep the history with no contact
  attached.

Do not import bought lists, or anything the prospector did not read from a
public page. Directory crawls are fine when the directory allows crawling, the
rows are checked first, and the `gap` is written by hand. A profile page with
no address, a member who turns out to be a chain, or a listing that links to a
personal blog is a row to drop. The cost of one complaint is higher than any
batch.

## What still needs a person

- writing the one observation per cold contact (`gap`);
- reading a prospect CSV before importing it;
- signing the publisher in, and re-signing when a session expires;
- answering replies.

The automation carries the queue and the record; it does not decide who to
write to or what to say about them.
