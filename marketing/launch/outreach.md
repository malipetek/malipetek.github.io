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
> I've started something I call vibe contracting: you connect to my service, and I help you use AI and deploy what you build.
>
> It costs $100 an hour, billed by the second, so most jobs come to less than $10.
>
> I'm looking for the first few jobs to put through it. Is there something on {site} you have been putting off? If not, an introduction to someone who could use it would help just as much.
>
> Muhammet

### Follow-up, day 4

**Subject:** Re: A small experiment (and a favour)

> Hi {name},
>
> What is the smallest thing on {site} you have been meaning to fix? Small jobs are where this costs least: you pay for the minutes I spend, and the agent's part costs cents.
>
> Muhammet

### Follow-up, day 10

**Subject:** Re: A small experiment (and a favour)

> Hi {name},
>
> I will stop filling your inbox. If something small comes up, the door is open: malipetek.dev/portal.
>
> Muhammet

---

## Cold A: someone who built it with AI

For a site or app with the marks of a fast AI build: inconsistent spacing, a
placeholder that made it live, a form that does nothing, a mobile layout that
breaks.

### First email

**Subject:** Vibe contracting

> Hi {name},
>
> Do you want help using AI on your business and getting your projects online?
>
> It's called vibe contracting: you connect to my service, and I, a veteran programmer, help you use AI and deploy what you build.
>
> It costs $100 an hour, billed by the second, so most jobs come to less than $10.
>
> Reply with what you're working on and I'll tell you how I'd help.
>
> Muhammet
> malipetek.dev

Without a written observation, the queue sends this instead (it makes no claim about the site):

> Hi {name},
>
> Do you want help using AI on your business and getting your projects online?
>
> It's called vibe contracting: you connect to my service, and I, a veteran programmer, help you use AI and deploy what you build.
>
> It costs $100 an hour, billed by the second, so most jobs come to less than $10.
>
> Reply with what you're working on and I'll tell you how I'd help.
>
> Muhammet
> malipetek.dev

### Follow-up, day 4

**Subject:** Re: Vibe contracting

> Hi {name},
>
> Did you see my note about vibe contracting? If you are working on something, reply with a line and I'll tell you how I'd help.
>
> Muhammet

Without a written observation, the queue sends this instead (it makes no claim about the site):

> Hi {name},
>
> Did you see my note about vibe contracting? If you are working on something, reply with a line and I'll tell you how I'd help.
>
> Muhammet

### Follow-up, day 10

**Subject:** Re: Vibe contracting

> Hi {name},
>
> Last note from me. If you want help with AI or getting a project online later, it's here: malipetek.dev
>
> Muhammet

Without a written observation, the queue sends this instead (it makes no claim about the site):

> Hi {name},
>
> Last note from me. If you want help with AI or getting a project online later, it's here: malipetek.dev
>
> Muhammet

---

## Cold B: a business owner with a small list

For a local business, a small shop, a restaurant or a studio: someone with a
site that is mostly fine and a list of small things that never get done.

### First email

**Subject:** Vibe contracting for {site}

> Hi {name},
>
> Do you want help using AI on your business and getting your projects online?
>
> It's called vibe contracting: you connect to my service, and I, a veteran programmer, help you use AI and deploy what you build.
>
> It costs $100 an hour, billed by the second, so most jobs come to less than $10.
>
> Reply with what you're working on and I'll tell you how I'd help.
>
> Muhammet
> malipetek.dev

Without a written observation, the queue sends this instead (it makes no claim about the site):

> Hi {name},
>
> Do you want help using AI on your business and getting your projects online?
>
> It's called vibe contracting: you connect to my service, and I, a veteran programmer, help you use AI and deploy what you build.
>
> It costs $100 an hour, billed by the second, so most jobs come to less than $10.
>
> Reply with what you're working on and I'll tell you how I'd help.
>
> Muhammet
> malipetek.dev

### Follow-up, day 4

**Subject:** Re: Vibe contracting for {site}

> Hi {name},
>
> Did you see my note about vibe contracting? If you are working on something, reply with a line and I'll tell you how I'd help.
>
> Muhammet

### Follow-up, day 10

**Subject:** Re: Vibe contracting for {site}

> Hi {name},
>
> Last note from me. If you want help with AI or getting a project online later, it's here: malipetek.dev
>
> Muhammet

---

## No website: an email on the map, no site

For a business OpenStreetMap lists with an email and no website
(`marketing/prospector/osm.mjs` writes these to a `-mail-only-` CSV).

### First email

**Subject:** A website for {business}

> Hi {name},
>
> I found {business} on OpenStreetMap. The listing has your email but no website.
>
> I build small business sites. An AI agent does the typing, and I approve the job and check the result before anything goes live. You pay for my time by the second, at $100 an hour, with no quote and no minimum. A one-page site with your services, hours and phone number is a short job.
>
> If you want one, reply with a line about the business and I will tell you what it would take.
>
> Muhammet
> malipetek.dev

### Follow-up, day 4

**Subject:** Re: A website for {business}

> Hi {name},
>
> Should I sketch a one-page site for {business}, or is it not worth it right now? Either answer helps me.
>
> Muhammet

### Follow-up, day 10

**Subject:** Re: A website for {business}

> Hi {name},
>
> Last note from me. If you want a site later, you can ask through malipetek.dev/portal, with no call or quote first.
>
> Muhammet

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
