# Outreach

Warm and cold email, LinkedIn DMs, and the replies to what people actually
ask. Plain text. One ask per email. No attachments on the first touch. No
tracking pixels.

Replace `{site}`, `{business}`, `{gap}` and `{name}` every time. `{gap}` is one
specific, true observation about their site. When a contact has none, the
queue sends the plain version of each email instead, which makes no claim
about the site. Never write "I looked at your site" without having looked.

The opt-out line is not optional. Keep it in every cold email.

## The personalization formula

**One observation → the last mile → one ask.**

Bad: "I help businesses grow with AI-powered software solutions."
Good: "Your opening hours still say summer, and it is October. That is the kind
of last-mile thing I fix."

If the observation is not true, the whole email is spam. Check the site.

---

<!-- Generated from SEQUENCES in worker/src/marketing.ts (the copy that is sent). Edit the templates there, then run `node --experimental-strip-types --no-warnings scripts/build-outreach.mjs` in worker/ and press "Re-render scheduled" in Admin → Marketing. -->

## Warm: past collaborators and people who know the work

Use for Customily, TRUTH NYC, PAX Digital, Bemeir, and personal contacts.

### First email

**Subject:** A small experiment (and a favour)

> Hi {name},
>
> I have changed how I take on small software jobs. You write what you need, I approve it, an AI agent builds it on a copy of the project, and I check the result before it ships. I call it vibe contracting. You pay for my time by the second, so a one-minute fix is $1.67, with no quote and no minimum.
>
> I am looking for the first few real jobs to put through it. Is there a small thing on {site} you have been putting off? I would rather it were yours than a stranger's.
>
> No pressure if not. If you know someone with a small fix, I would take the introduction.
>
> Ali

### Follow-up, day 4

**Subject:** Re: A small experiment (and a favour)

> Hi {name},
>
> What is the smallest thing on {site} you have been meaning to fix? Small jobs are where this costs least: you pay for the minutes I spend, and the agent's part costs cents.
>
> Ali

### Follow-up, day 10

**Subject:** Re: A small experiment (and a favour)

> Hi {name},
>
> I will stop filling your inbox. If something small comes up, the door is open: malipetek.dev/portal.
>
> Ali

---

## Cold A: someone who built it with AI

For a site or app with the marks of a fast AI build: inconsistent spacing, a
placeholder that made it live, a form that does nothing, a mobile layout that
breaks.

### First email

**Subject:** The last mile of {business}

> Hi {name},
>
> I looked at {site} and noticed this: {gap}.
>
> If you built the site with an AI tool, this is usually where the tool stops helping. I finish that part. An AI agent does the typing on a copy of your project, and I approve the job and check the result before anything goes live. I call it vibe contracting.
>
> You pay for my time by the second, so a one-minute fix is $1.67. There is no quote and no minimum.
>
> If you want it fixed, reply with a line and I will tell you whether it is a quick job.
>
> Ali
> malipetek.dev

Without a written observation, the queue sends this instead (it makes no claim about the site):

> Hi {name},
>
> If you built {site} with an AI tool, you may have reached the point where the tool stops helping: a bug it keeps bringing back, or a deploy that fails.
>
> I finish that part. An AI agent does the typing on a copy of your project, and I approve the job and check the result before anything goes live. I call it vibe contracting.
>
> You pay for my time by the second, so a one-minute fix is $1.67. There is no quote and no minimum.
>
> If something on the site needs fixing, reply with a line and I will tell you whether it is a quick job.
>
> Ali
> malipetek.dev

### Follow-up, day 4

**Subject:** Re: The last mile of {business}

> Hi {name},
>
> Do you want that fixed, or is it not worth the trouble? Either answer helps me.
>
> Ali

Without a written observation, the queue sends this instead (it makes no claim about the site):

> Hi {name},
>
> Is there anything on {site} you want fixed, or is now a bad time? Either answer helps me.
>
> Ali

### Follow-up, day 10

**Subject:** Re: The last mile of {business}

> Hi {name},
>
> Last note from me. If it becomes worth fixing, it is $1.67 a minute of my time and no quote to wait for: malipetek.dev/portal.
>
> Ali

Without a written observation, the queue sends this instead (it makes no claim about the site):

> Hi {name},
>
> Last note from me. If something on {site} becomes worth fixing, it is $1.67 a minute of my time and no quote to wait for: malipetek.dev/portal.
>
> Ali

---

## Cold B: a business owner with a small list

For a local business, a small shop, a restaurant or a studio: someone with a
site that is mostly fine and a list of small things that never get done.

### First email

**Subject:** The smallest thing on {business}

> Hi {name},
>
> I noticed this on {site}: {gap}. Jobs that size tend to wait for months, because nobody wants to hire a developer for a short job.
>
> Short jobs are what I do. An AI agent does the typing on a copy of your site, and I approve the job and check the result before it goes live. I call it vibe contracting. You pay for my time by the second, so a one-minute fix is $1.67, and there is no call or quote first.
>
> Is there a small fix on {site} you have been putting off? Reply with it and I will tell you if it fits.
>
> Ali
> malipetek.dev

Without a written observation, the queue sends this instead (it makes no claim about the site):

> Hi {name},
>
> Most business sites carry a short list of small fixes that never get done, like old opening hours or a contact form that stopped sending. They wait because nobody wants to hire a developer for a short job.
>
> Short jobs are what I do. An AI agent does the typing on a copy of your site, and I approve the job and check the result before it goes live. I call it vibe contracting. You pay for my time by the second, so a one-minute fix is $1.67, and there is no call or quote first.
>
> Is there a small fix on {site} you have been putting off? Reply with it and I will tell you if it fits.
>
> Ali
> malipetek.dev

### Follow-up, day 4

**Subject:** Re: The smallest thing on {business}

> Hi {name},
>
> What is the smallest thing on {site} you have been meaning to fix? Small jobs are where this costs least: you pay for the minutes I spend, and the agent's part costs cents.
>
> Ali

### Follow-up, day 10

**Subject:** Re: The smallest thing on {business}

> Hi {name},
>
> I will leave it here. If a small fix ever gets annoying enough, you can send it through malipetek.dev/portal without a call or a quote.
>
> Ali

---

## LinkedIn DM

Only after a real interaction — a comment, a shared group, a post reply. Do not
open with a pitch.

> Thanks for the note on {post}. Since you mentioned {problem}: that is the
> exact kind of last-mile thing I do now — an agent types, I approve and check
> it, you pay for my minutes by the second. If it is useful, the portal is
> malipetek.dev/portal. If not, no follow-up from me.

---

## Reply bank

Answer in the thread, in plain words, within the same day where possible.

**"How much will it cost?"**

> My time at $100 an hour, billed by the second, plus the AI at cost. A
> one-minute fix is $1.67. The first five pilot jobs billed $2.18–$8.25. You can
> set a budget and I will stop and ask before passing it. The final bill is the
> time actually spent, not an estimate.

**"So an AI writes my code?"**

> It does the typing. I decide what gets built, and nothing reaches you until I
> have checked it. You choose how closely: a quick check that it runs, or every
> changed line.

**"What if it breaks something?"**

> It works on a sealed copy of your project, never on what is live. Nothing
> ships until I have looked at it, and changes go to a preview first.

**"Can you sign an NDA?"**

> Send it over and I will read it. If it is standard, yes.

**"I need a fixed quote first."**

> Then this is not the right fit. It is metered, not quoted: you pay for the
> minutes spent, by the second, plus the AI at cost. If you need a fixed price
> before anything starts, say so and I will tell you honestly that I cannot
> give you one.

**"Can you rebuild the whole site?"**

> A rebuild is hands-on work, by the clock, with me on it — not autopilot. Send
> me what you have and what you want, and I will tell you whether it is worth
> doing at all.

**"Not right now."**

> Understood. Want me to check back in a month, or leave it with you?

**"What stack do you use?"**

> Whatever the project already uses, deployed serverless where it fits. I do not
> lead with frameworks; I lead with whether the thing works and who checks it.

**"Do you do {unfamiliar thing}?"**

> I will look at it and tell you honestly. If it is not something I should
> touch, I will say so rather than learn on your bill.

---

## Sending rules

- **Volume:** 20–25 cold emails a day, maximum. Warm emails one at a time.
- **Format:** plain text, no images, no attachments, no link shorteners.
- **One link:** the portal, and only when the email asks for an action.
- **Opt-out:** keep the one-line opt-out in every cold email; honour "no"
  immediately and permanently.
- **No fake familiarity:** "I loved your recent post" when you did not read it
  is worse than no personalization.
- **No model names** in outreach. "Agent" is enough.
- **No promises** about turnaround, uptime or results. The system enforces
  approval, sealed copies and budgets; say those, not guarantees.
- **Log it:** one row per target in the list, with date, channel, reply and
  outcome. Without it, week 4 has nothing to read.

## Subject lines that fit the voice

- The last mile of {business}
- The smallest thing on {business}
- A small experiment (and a favour) — warm only
- One fix, by the minute
- No quote, no call, no minimum

Do not use: "Quick question", "Following up", "AI-powered solution", anything
with an emoji, anything that implies a prior relationship that does not exist.
