# Publisher

Posts what the Marketing desk queued for X and LinkedIn, from Ali's own signed-in
browser. There is no paid write API in this design: X charges a monthly fee for
posting access, so this drives a real Chrome profile instead.

The desk holds the queue and the record. A post is composed in **Admin → Marketing →
Compose**, channel `x` or `linkedin`. The publisher claims it (status goes
`scheduled → sending`), types it into the site, reports `sent` or `failed`, and the
desk shows it either way. A claim older than 30 minutes is handed back, so a crash
never strands a post.

## One-time setup

```sh
# 1. The shared secret the Worker checks on /marketing/publisher/*
cd worker && npx wrangler secret put MARKETING_TOKEN && cd ..

# 2. The same value in the publisher's env file
cp marketing/publisher/.env.example marketing/publisher/.env
$EDITOR marketing/publisher/.env

# 3. Sign in once. Chrome opens with X and LinkedIn; do both by hand, press Enter.
marketing/publisher/publish.sh --login
```

`--login` keeps the session in `.profile/`, which is gitignored and stays on this
machine. It starts your installed Chrome with that profile — not a browser
Playwright launched — and attaches over the DevTools protocol, so Google sign-in
works. Set `CHROME_PATH` in `.env` only if Chrome lives somewhere unusual.

The desk is addressed at `https://malipetek.dev/api` by default. Keep it there:
`*.workers.dev` resolves but answers 404/1042, and the publisher then polls
nothing and reports nothing — the queue simply stops moving. If polls ever stop,
run `publish.sh --dry-run`; a 404 means the host, not the browser.

## Running

```sh
marketing/publisher/publish.sh --dry-run   # what is due, without claiming it
marketing/publisher/publish.sh             # post what is due, ask before each one
marketing/publisher/publish.sh --auto      # post without asking
marketing/publisher/publish.sh --channel=x # one channel only
```

One pass per run. Chrome starts only when there is a post in hand, so an idle run is
one HTTP request and no browser.

Limits: 3 posts per run, 4 per day across both channels (`.publish.day.json`). The
daily cap is deliberate; a steady account is worth more than a burst.

## Scheduling

```sh
marketing/publisher/install.sh          # every 15 minutes, --auto, log to publish.log
marketing/publisher/install.sh remove   # stop and delete
```

The job is `dev.malipetek.marketing-publisher` in `~/Library/LaunchAgents`. To have it
ask first instead, delete `--auto` from the installed plist and reload it.

## When it breaks

| Symptom in `publish.log` | What it means |
| --- | --- |
| `not_signed_in` | The session expired. Re-run `--login`; the post stays `failed` in the desk, press Retry. |
| `composer_empty` / timeout on a button | X or LinkedIn changed their DOM. Update the selectors in `postX` / `postLinkedIn`. |
| `too_long` | The post is over 280 (X) or 3000 (LinkedIn) characters. Shorten it in the desk. |
| `skipped_by_operator` | You answered `n`. Retry from the desk when ready. |
| `chrome_already_open` | A Chrome window from an earlier run is still using `.profile`. Quit it and retry. |
| `chrome_not_found` | Chrome is not where expected. Put its path in `CHROME_PATH` in `.env`. |

Failures are never retried silently; every one is recorded against the post and shown
in the desk's Queue tab.

## The honest caveat

Automating a personal account is against X's and LinkedIn's user agreements, and
either can restrict an account that looks automated. The limits above, the human
session, and the low volume keep this in the same shape as a person posting by hand,
but the risk is Ali's to accept. If an account is ever restricted, stop the job with
`install.sh remove`, then post by hand from the desk's copy.
