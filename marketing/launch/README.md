# Launch

Everything needed to get the first paying clients into the portal, in the order
it should happen. Written for a launch with **no paying clients yet** — so the
proof is the machine and the meter, not testimonials.

Read with:

- `../kit.md` — the standing copy kit (hooks, pitch, objections).
- `../../src/lib/offer.js` — the canonical wording and prices.
- `../../src/lib/pricing.js` — the arithmetic.
- `proof.md` — the only numbers allowed.
- `landscape.md` — internal competitive frame. Never quoted publicly.

## Situation in one paragraph

The system is built and running: a client portal, two fleet nodes, an admin
workbench, preview and production hosting on `malipetek.online`, an MCP
endpoint, and a ChatGPT plugin submitted to the directory. What does not exist
is demand. Five pilot jobs have run end to end and billed $2.18–$8.25. The
launch is a **first-clients** launch: sell the offer, use the pilot data to
show the meter is real, and get the first ten paying requests.

## Audience

Business owners who need software work done and do not want a team to manage.
The sharpest subset right now: people who built most of a site or app with AI
and stalled on the last mile — the bug that keeps coming back, the deploy, the
payments, the thing that only breaks for real customers.

Not the target: developers shopping for a framework, agencies looking for
white-label volume (worth a conversation later), or anyone who needs a six-week
rebuild.

## The message

In this order, everywhere:

1. **Price.** "Software help, by the minute. A one-minute fix is $1.67. No
   quote, no minimum."
2. **The last mile.** "You can vibe code most of it. The last mile is where you
   need a developer."
3. **How.** "The agent types. I sign off." Supports the first two; never leads.

Proof sits underneath, in `proof.md`: first five pilot jobs, $2.18–$8.25, AI
cost 8–18 cents, five of five runs finished.

## Competitive frame

Compete with categories, not companies. The buyer is weighing four things, and
`WHY_NOT` in `offer.js` already answers all four: doing it themselves, a chatbot
subscription, a freelancer or agency, the cheapest developer. Keep it that way.

- **Do not name competitors** in public copy, emails, listings or the site.
  Naming invites comparison shopping and dates the copy.
- **Do not chase "vibe code cleanup" or "rescue" SEO.** That category is crowded
  with fixed-quote agencies priced in projects. Keep "the last mile" and "small
  fixes".
- **Small jobs are the product, not the loss leader.** Every competitor has a
  floor: a package, a minimum session, an audit, a monthly subscription. A
  $2–$8 job is the differentiator.
- **The moat is the portal, the meter and the sign-off** — not the agent. Lead
  with those.
- **Use the pilot range, not only the minute rate.** "$1.67 a minute" is the
  hook; "$2.18–$8.25 for the first five jobs" is the number a buyer can hold.

Detail and sources: `landscape.md` (internal).

## Goal

**30 days:** 100 targeted touches, 10 replies, 5 requests filed, 3 paid jobs.
**90 days:** 10 paid jobs, 3 repeat requests, 1 referral, one published case
study with permission.

Those are targets, not forecasts. If the numbers come in lower, change the
channel or the message, not the honesty.

## The sequence

### Week 0 — assets and instrumentation

- [ ] Read `proof.md`; re-run the query so the numbers are current.
- [ ] Produce the one-pager (`one-pager.md`) as a PDF.
- [ ] Record the 90s explainer and the 15s cut (`video.md`).
- [ ] Smoke-test the portal end to end with a fresh email: sign-in, request,
      budget, approval, run, price line.
- [ ] Pick one demo project to record. Never show another person's ticket.
- [ ] Update LinkedIn headline, X bio, GitHub bio, email signature
      (`social.md`).
- [ ] Build the target list: 20 warm, 50 cold. One row each: name, business,
      the specific small gap, the sentence you will open with.
- [ ] Decide attribution (see "Tracking gaps" below).

### Week 1 — warm, and the video

- [ ] Send the 20 warm emails (`outreach.md`), one at a time, no BCC.
- [ ] Publish the 90s video on the site (hero secondary link) and LinkedIn.
- [ ] Post 1 on LinkedIn: the machine, with the video.
- [ ] Reply to every response the same day. The first reply is the product.

### Week 2 — cold batch one

- [ ] Send 25 cold emails, 20–25 a day maximum, plain text.
- [ ] Follow up week-1 non-responders on day 4 (`outreach.md`).
- [ ] Post 2 on LinkedIn: the pilot numbers, from `proof.md`.
- [ ] Publish the first essay: "The last mile of a vibe-coded app". Link the
      portal once, at the end.

### Week 3 — cold batch two and surfaces

- [ ] Send 25 more cold emails; follow up batch one.
- [ ] One community post, following that community's self-promotion rules
      (`social.md`).
- [ ] Submit the directory listings (`social.md`): ChatGPT plugin (already in
      review), MCP directories, one "available for work" listing.
- [ ] Post 3 on LinkedIn: a real, anonymized before/after diff.

### Week 4 — read the numbers and narrow

- [ ] Count: touches, replies, sign-ins, requests, approvals, paid jobs,
      average bill, time to first reply.
- [ ] Ask every client, after a good job: "Know one person with a small fix?"
- [ ] If a paying client agrees, write the first case study — real name only
      with written permission.
- [ ] Double the best channel, drop the worst. Do not add a third.

## Channels, ranked

| Channel | Who | Why it is here | When |
| --- | --- | --- | --- |
| Warm network and past collaborators | People from Customily, TRUTH NYC, PAX Digital, Bemeir, and personal contacts | Highest reply rate; they already trust the person | Week 1 |
| Cold email, local small businesses | One specific, small gap on their site | The offer is built for exactly this; no call needed | Weeks 2–3 |
| LinkedIn, build in public | Business owners and peers | The video and the pilot numbers do the selling | Weekly |
| X | Peers and indie builders | Cheap repost of LinkedIn; not a primary channel | Ongoing |
| Communities | Indie Hackers, local business groups | Borrowed attention; follow the rules or it backfires | Week 3 |
| Directories | ChatGPT plugin, MCP lists | Passive discovery; low effort, one-time | Week 3 |
| Blog / SEO | People searching "last mile", "fix my site" | Slow, compounding; two posts is enough to start | Weeks 2–4 |
| Referrals | Existing clients | Cheapest paid job you will ever get | Week 4+ |

Two channels done well beat six done badly. If capacity is tight, keep warm
email and LinkedIn, and delay the rest.

## Tracking gaps

Be honest about what cannot be measured yet:

1. **No web analytics on the site.** There is no first-party page-view or
   referrer data. Adding Cloudflare Web Analytics (cookieless, one beacon) is
   the smallest fix. Until then, the funnel starts at a portal sign-in.
2. **No campaign field on tickets.** `tickets.source` records `portal`,
   `email`, `dsh` or `schedule` — not the campaign. UTM links will not be
   attributable.

For this launch, do the low-tech version: in the first reply to every new
request, ask "how did you hear about this?" and note the answer in the thread.
If paid acquisition starts later, add `utm_source`/`utm_campaign` capture at
sign-in and a `campaign` column before spending money.

What is measurable today: sign-ins, requests filed, approval rate, paid jobs,
average bill, and time from request to first reply — all in D1.

## Assets checklist

| Asset | File | State |
| --- | --- | --- |
| Proof sheet | `proof.md` | done |
| Competitive frame | `landscape.md` | done (internal) |
| One-pager | `one-pager.md` | copy done; PDF to make |
| Warm + cold email sequences | `outreach.md` | done |
| Social posts, listings, bios | `social.md` | done |
| 90s explainer + cutdowns | `video.md` | plan and script done; record |
| Demo project for recording | portal | pick one |
| Portal smoke test | — | to do |
| Attribution decision | this file | to do |

## Risks and the honest answer

| Risk | Answer |
| --- | --- |
| No social proof | Lead with the machine and the meter. Say "first five pilot jobs", never "clients". |
| Pilot sample is tiny | Use it to prove the bill, not demand. Do not compute a success rate. |
| "So AI writes my code?" | "It does the typing. I approve the job and check the result. You choose how closely." |
| Scope creep | Say no to rebuilds; hands-on work goes by the clock, not autopilot. |
| Price confusion | Always the same sentence: measured minutes at $100/hour by the second, AI at cost, no minimum. |
| Support load | One thread per request; answer in the thread. Do not open a second channel. |
| Cold email deliverability | Plain text, low volume, real personalization, one-line opt-out, no attachments on first touch. |
| Legal | Privacy and terms already cover the portal; no client names without written permission; honour opt-outs. |

## What not to do

- Do not run ads before attribution exists.
- Do not mass-BCC, buy a list, or scrape emails.
- Do not name a competitor, quote their pricing, or position this as a "vibe
  code cleanup" shop.
- Do not promise a turnaround time the system does not enforce.
- Do not publish a client's name, site, diff or ticket without permission.
- Do not call pilot jobs "clients", or invent a testimonial. Ever.
