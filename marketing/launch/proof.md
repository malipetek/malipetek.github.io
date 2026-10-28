# Proof

The only numbers marketing may use, where they came from, and how to say them.

Read this before writing any email, post or page. If a claim is not in this
file or in `src/lib/offer.js`, it is not approved.

## What the data is

Five client jobs that actually ran through the fleet and were billed, between
2026-10-10 and 2026-10-27. They were **pilot jobs on my own and demo
projects**, not paying clients. One project is literally named "Demo Bakery".

That is the honest frame: this proves the machine and the meter work. It does
not prove demand, retention or client satisfaction, because there are no
paying clients yet.

Source: production D1 `malipetek-portal`, `tickets` joined to `ticket_runs`,
filtered to `kind = 'client' AND price_cents > 0`. Client names, emails and
project slugs are deliberately not reproduced here.

## The numbers

**Four Checked jobs** (agent works, Ali reads every changed line):

| | |
| --- | --- |
| Bills | $2.18, $3.33, $3.71, $5.32 |
| Average bill | **$3.64** |
| Ali's measured time | 1m15s to 3m05s, average **2m06s** |
| AI cost, at cost | $0.08 to $0.18 per job, average **$0.12** |

**One Hands-on job** (Ali works with the agent):

| | |
| --- | --- |
| Bill | **$8.25** |
| Ali's measured time | **4m54s** |
| AI cost, at cost | **$0.08** |

**All five together:**

| | |
| --- | --- |
| Total billed | **$22.79** |
| Average bill | **$4.56** |
| Median bill | **$3.71** |
| Ali's total time | **13m19s** |
| Total AI cost | **$0.56** |
| Agent runs completed | **5 of 5** |
| Average agent run | **37 seconds** (range 22–55s) |

Every bill equals measured time at $100/hour plus the AI run at cost, each
rounded up to the cent. Example: 2m08s is $3.56 of time, the run cost $0.15,
the bill is $3.71. The arithmetic is in `src/lib/pricing.js` and the Worker
bills with the same file.

## What this proves

1. A small job produces a small, itemised bill — not an estimate, not a minimum.
2. The pipeline finishes: request, approval, agent run, check, bill, thread.
3. AI cost is noise next to Ali's measured minutes: 8–18 cents on a $2–$8 job.
4. The agent is fast on small work: half a minute to a minute per run.

## What this does not prove

- That anyone will pay. All five were internal or demo projects.
- A success rate. Five jobs is not a sample; the fleet's overall run history
  includes failures on system tasks, which are not client work.
- Anything about big, urgent or regulated work. These were small changes.
- That outcomes were independently verified. Ali checked them; no client did.

## Approved lines

Use these verbatim, or change only the surrounding sentence.

- "The first five jobs that went through the system billed between $2.18 and
  $8.25."
- "Four of them were Checked: two to five dollars, about two minutes of my
  time on average."
- "The AI cost eight to eighteen cents a job. The rest is my measured minutes."
- "All five agent runs finished. The average run took 37 seconds."
- "They were pilot jobs on my own and demo projects — not paying clients yet."
- "A bill is measured time at $100 an hour, by the second, plus the AI at cost.
  There is no minimum and no markup."

## Do not say

- "Five happy clients", "our customers", or anything implying paying users.
- "Save 80%", "10× cheaper", or any comparison that is not in `offer.js`.
- "99% success", "always works", "fully autonomous".
- "$1.67 average". $1.67 is the one-minute rate, not the observed average.
- "AI-powered", "revolutionary", model names, or invented testimonials.
- Any client or project name without written permission.

## When the data changes

Re-run the query and update the table. Keep the same filters so the numbers
stay comparable. If a paying client lands, add a separate section — do not
quietly fold them into the pilot numbers.

```sql
-- Aggregate (run in worker/, against malipetek-portal)
SELECT attention,
       COUNT(*) n,
       MIN(human_seconds) min_s, MAX(human_seconds) max_s,
       AVG(human_seconds) avg_s,
       MIN(price_cents) min_c, MAX(price_cents) max_c,
       AVG(price_cents) avg_c,
       SUM(price_cents) sum_c,
       SUM(ai_micro_usd) ai_micro
FROM tickets
WHERE kind = 'client' AND status = 'done' AND price_cents > 0
GROUP BY attention;

SELECT r.status, COUNT(*) n,
       ROUND(AVG(COALESCE(r.finished_at, r.started_at) - r.started_at), 0) avg_s
FROM ticket_runs r JOIN tickets t ON t.id = r.ticket_id
WHERE t.kind = 'client'
GROUP BY r.status;
```

Run with `CLOUDFLARE_ACCOUNT_ID=a60af2542282e283101650bebed42dcf` from
`worker/`:

```sh
npx wrangler d1 execute malipetek-portal --remote --json --command "…"
```
