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

<!-- Generated from SEQUENCES in worker/src/marketing.ts (the copy that is sent). Edit the templates there, then run `node --experimental-strip-types --no-warnings scripts/build-outreach.mjs` in worker/; the cron re-renders the queue by itself on the next tick. -->

## Warm: past collaborators and people who know the work

Use for Customily, TRUTH NYC, PAX Digital, Bemeir, and personal contacts.

### First email

**Subject:** a favour?

> Hi {name},
>
> I started PTech Solutions. A developer checks what an AI agent builds, and clients pay by the second.
>
> Do you have a website change you want done?
> Do you know someone who does?
>
> 1. They write it at ptechsolutions.net/portal.
> 2. A developer approves it. An AI agent does the work.
> 3. They check a preview. It goes live when they say yes.
>
> $100 an hour, billed by the second. No minimum.
>
> Muhammet
> PTech Solutions

### Follow-up, day 4

**Subject:** a favour?

> Hi {name},
>
> Is there one change you want on {site}?
> Or one person I should write to?
>
> Reply with it.
>
> Muhammet

### Follow-up, day 10

**Subject:** a favour?

> Hi {name},
>
> This is my last email.
>
> If you need a website change later: ptechsolutions.net/portal
>
> Muhammet
> PTech Solutions

---

## Cold A: someone who built it with AI

For a site or app with the marks of a fast AI build: inconsistent spacing, a
placeholder that made it live, a form that does nothing, a mobile layout that
breaks.

### First email

**Subject:** saw this on {site}

> Hi {name},
>
> {gap}
>
> I fix exactly that kind of last-mile thing. The agent does the typing in a sealed copy; I check it and sign off before anything goes live.
>
> The first five pilot jobs came to $2.18–$8.25, no minimum, and you see the price before I start. If it is a five-minute fix, I do it for free.
>
> Want me to fix this one? Reply “yes” and I will tell you what it takes.
>
> Muhammet
> ptechsolutions.net
>
> Not useful? Reply “stop” and I will not write again.

### Follow-up, day 4

**Subject:** saw this on {site}

> Hi {name},
>
> Should I take that fix? A one-line reply is enough. If it is not a fit, tell me and I will stop.
>
> Not useful? Reply “stop” and I will not write again.

### Follow-up, day 10

**Subject:** saw this on {site}

> Hi {name},
>
> Last note from me. If it comes up later, the door is open: ptechsolutions.net/portal. No call, no quote.
>
> Muhammet
>
> Not useful? Reply “stop” and I will not write again.

---

## Cold B: a business owner with a small list

For a local business, a small shop, a restaurant or a studio: someone with a
site that is mostly fine and a list of small things that never get done.

### First email

**Subject:** {business} — quick one

> Hi {name},
>
> I saw you are updating {trigger}.
>
> {gap}
>
> I do small last-mile fixes: the agent types, I check and sign off, and you see the price before I start. The first five pilot jobs were $2.18–$8.25, no minimum.
>
> Want me to take this one? Reply with the page and I will tell you what it costs.
>
> Muhammet
> ptechsolutions.net
>
> Not useful? Reply “stop” and I will not write again.

### Follow-up, day 4

**Subject:** {business} — quick one

> Hi {name},
>
> Should I take that fix? A one-line reply is enough. If it is not a fit, tell me and I will stop.
>
> Not useful? Reply “stop” and I will not write again.

### Follow-up, day 10

**Subject:** {business} — quick one

> Hi {name},
>
> Last note from me. If it comes up later, the door is open: ptechsolutions.net/portal. No call, no quote.
>
> Muhammet
>
> Not useful? Reply “stop” and I will not write again.

---

## Cold: opens on the observation of their site

The challenger arm: the same offer as Cold A, but the email opens on the
one true thing the desk observed on their site. Only contacts the
observation writer has reached get this sequence.

### First email

**Subject:** {site}

> Hi {name},
>
> {gap}
>
> Do you want it fixed?
>
> 1. Reply "yes".
> 2. An AI agent makes the fix. A developer checks it.
> 3. You check a preview. It goes live when you say yes.
>
> Price: $100 an hour, billed by the second. A one-minute fix costs $1.67. No minimum.
>
> Muhammet
> PTech Solutions
> ptechsolutions.net
>
> Not useful? Reply “stop” and I will not write again.

### Follow-up, day 4

**Subject:** {site}

> Hi {name},
>
> Do you want the fix on {site}?
> Reply "yes" or "no".
>
> Muhammet
>
> Not useful? Reply “stop” and I will not write again.

### Follow-up, day 10

**Subject:** {site}

> Hi {name},
>
> This is my last email.
>
> If you need a website change later: ptechsolutions.net/portal
>
> Muhammet
>
> Not useful? Reply “stop” and I will not write again.

---

## No website: an email on the map, no site

For a business OpenStreetMap lists with an email and no website
(`marketing/prospector/osm.mjs` writes these to a `-mail-only-` CSV).

### First email

**Subject:** a website for {business}?

> Hi {name},
>
> {business} is on OpenStreetMap with an email address and no website.
>
> Do you want a website?
>
> 1. Reply "yes" with one line about the business.
> 2. We build a preview. The first preview of a new site is free.
> 3. It goes live only when you say yes.
>
> After that: $100 an hour, billed by the second. No minimum.
>
> Muhammet
> PTech Solutions
> ptechsolutions.net
>
> Not useful? Reply “stop” and I will not write again.

### Follow-up, day 4

**Subject:** a website for {business}?

> Hi {name},
>
> Do you want a website for {business}?
> Reply "yes" or "no".
>
> Muhammet
>
> Not useful? Reply “stop” and I will not write again.

### Follow-up, day 10

**Subject:** a website for {business}?

> Hi {name},
>
> This is my last email.
>
> If you need a website change later: ptechsolutions.net/portal
>
> Muhammet
>
> Not useful? Reply “stop” and I will not write again.

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
