# Marketing kit

Wording for emails, posts, bios and replies. The site's own copy lives in
`src/lib/offer.js`; this file reuses it and must stay as true as it is. Prices
come from `src/lib/pricing.js` — if the rate changes, change the numbers here.

Rules: no model names, no "AI-powered", no "revolutionary", no invented results
or testimonials. Plain words a business owner does not have to look up.

Launch assets live in `launch/`: plan, proof, one-pager, outreach, social and
video. The only approved results are in `launch/proof.md` — pilot jobs on my own
and demo projects, not clients. Do not call them clients.

## The name: vibe contracting

The service is a category of its own, and it needs a name people can repeat.
**Vibe contracting** is that name. Use it the same way everywhere (site, posts,
email, replies, bios) so it can stick the way "vibe coding" did.

**Definition** (the first time a reader meets the term):

> Vibe contracting: you describe the change in plain words, an AI agent builds
> it, and a developer who answers for the result signs off before it ships.
> Billed by the minute, not by the project.

**Contrast** (once per piece, at most):

> Vibe coding is you and an AI. Vibe contracting is an AI and a developer who
> signs for its work.

Why this name and not another:

- It keeps the term the reader already knows, and "contracting" adds what vibe
  coding lacks: someone hired, who answers for the work.
- "Vibe coding agency" is a crowded, generic label. "Managed vibe coding" is
  another company's product name. "Software factory" collides with a known AI
  coding brand and an old enterprise term. Do not use any of these to describe
  this service.
- "Agentic engineering" describes engineers supervising agents. It is a
  practice, not a service anyone buys. Do not borrow it.

How to use it:

- Lowercase in running text ("vibe contracting"), capitalised only at the start
  of a sentence or as a label. A person doing it is a "vibe contractor"; Ali is
  one. The verb works too: "I vibe-contracted the checkout fix."
- Define it once, early, then use it plainly. Do not explain it twice in one
  piece, and do not put it in quotes after the first use.
- It names the model, not a vibe: the point is that a developer signs. Never
  use it to suggest the work is casual or unreviewed.
- The two ways in are both vibe contracting: Ali's agents do the work, or the
  client's own assistant does it and Ali reviews (bring your own agent).
- The factory is the picture, not the name: the portal and the site show a
  workshop where requests move along a belt. Say "workshop" or "the belt" when
  describing that picture; do not call the service a factory.

## The hooks, in order

**1. Price (primary — leads everything):**

> **Software help, by the minute.** A one-minute fix is $1.67. No quote, no minimum.

**2. The last mile (secondary — who it is for right now):**

> You can vibe code most of it. The last mile is where you need a developer:
> the bug it keeps bringing back, the deploy, the payments, the thing that only
> breaks for real customers. Get that help at a fraction of the price, billed
> by the second, not by a quote.

**3. How (supports, never leads):**

> **The agent types. I sign off.** Vibe contracting: agent-built, developer-signed.

Short alternates:

- Fractional help. Not a quote.
- You pay for my minutes, not the hours it would have taken.
- Vibe coded it? I do the last mile.
- No quote, no call, no minimum invoice.

## The pitch

**One line.** Vibe contracting from a one-person dev shop: you send a
request, I approve it, the agent builds it, and I check it before you see it.

**Thirty seconds.** Most small software jobs — a fix on the site, a new form,
an integration that broke — are too small for an agency and too risky to hand
to a chatbot. Here you write what you need in plain words. I read it and decide
whether it is the right thing to build. An AI agent does the typing on a sealed
copy of your project, so nothing live is touched. I check the result before it
goes anywhere, as closely as you ask. You pay for the minutes I actually spend,
billed by the second, plus what the AI cost — no markup, no minimum.

## Why buy this (the buyer's case)

| You might instead… | The difference |
| --- | --- |
| keep vibe coding it yourself | Do — most of it. When it stalls at the last mile, send me that part. A one-minute fix is $1.67 of my time, and you never wait for a quote. |
| use a ChatGPT subscription | It writes code. It does not put it in your project, run it, or answer for it. Here a developer approves the job before it starts and checks it before you see it. |
| hire a freelancer or an agency | No quote, no call, no minimum invoice. A small fix does not wait until it is worth someone's afternoon: it is $1.67 of my time. |
| hire the cheapest developer you can find | On small jobs this is cheaper, because the agent does the hours and you pay for my minutes. And the person who signs off is the one you write to. |

What keeps it safe — each is something the system enforces, not a promise:

- Nothing starts until I approve the request.
- The agent works on a sealed copy of your project. It cannot publish, deploy,
  or touch anything live.
- Set a budget and I will not pass it without asking.
- If a machine stops mid-job, the job goes back in the queue instead of
  stalling.
- Every message, change and decision is in one thread you can read.

## Objections, answered

**"So an AI writes my code?"** It does the typing. I decide what gets built,
and nothing reaches you until I have checked it. You choose how closely: a
quick check that it runs, or every changed line.

**"What will it cost?"** My time at $100 an hour, billed by the second, plus
the AI run at cost. A change the agent finishes on its own is a minute or two
of my time — about $1.67 to $3.34. Something customers touch, where I read
every line, is typically around five minutes — about $8.34. Set a budget and I
stop and ask before passing it.

**"What if it breaks something?"** It works on a copy, never on what is live.
Nothing ships until I have looked at it.

**"Do I need a call first?"** No. Sign in with your email and write what you
need — in the portal, by email, or in the chat on the site.

**"What can't you do?"** I say no to work that is the wrong thing to build, and
I tell you why. Big rebuilds go by the clock, with me on them, not on autopilot.

## Email

The emails that are sent live in `worker/src/marketing.ts` (`SEQUENCES`), and
`launch/outreach.md` is generated from them. Read them there; do not keep a
second copy here, because copies drift.

Two rules for any email in our name:

- Never write "I looked at your site" without having looked. A contact without
  a written observation gets the plain version of each email, which makes no
  claim about their site.
- Run the draft through `marketing/style/README.md` before it ships.

## Bios

- **Short:** Software help, by the minute. The last mile of your vibe-coded app,
  without a quote — malipetek.dev
- **Longer:** Vibe contracting from a one-person dev shop. You send a
  request, I approve it, the agent builds it, I check it before you see it. You
  pay for my minutes, by the second. malipetek.dev
