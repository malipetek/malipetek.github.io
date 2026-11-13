# Ali's voice

Everything we publish in Ali's name (posts, cold email, replies, bios) should
read the way he talks. This file says how, as rules about the writing itself.
Where it disagrees with the older "dry voice" wording in `kit.md` or
`launch/social.md`, this file wins.

## The offer comes first, and it is one thing

Plain and short. The whole pitch is three answers, in this order:

1. **What is it?** Vibe contracting: you connect to the service, and a veteran
   programmer (Muhammet) helps you use AI and deploy your projects.
2. **What does it cost?** $100 an hour, billed by the second, so most jobs come
   to less than $10.
3. **A question** they can answer in a line ("Reply with what you're working
   on.").

The approved first email in `worker/src/marketing.ts` (`SEQUENCES`, `cold_a`)
is the model: an opening question ("Do you want help using AI on your business
and getting your projects online?"), then the three answers. Nothing else.

- **No example tasks.** Opening hours, contact forms, menus and the like were
  pilot jobs, not what the service is. Do not list tasks to explain the offer.
- **Never assume how their site was built, and never knock their tools.** It
  may be hand-made, a builder site or vibe coded; it does not matter. No "your
  AI probably has bugs", no "where the tool stops helping".
- One idea per piece. If a sentence explains a second thing, cut it.
- Read it as a busy shop owner: if any sentence needs a second read, rewrite it.
- Email is signed **Muhammet**.

## Show the style, never announce it

The style is in how the sentences work. It is never a thing the text says
about itself or about Ali. A sentence like "I'm bad at sales emails, so I'll
say it plainly" is a sales move pretending not to be one, which is the exact
opposite of this voice. Never write:

- anything about Ali's writing, selling or marketing ability ("I'm not a
  marketer", "I'm bad at this", "I'm just a programmer")
- anything announcing honesty or directness ("to be honest", "honestly",
  "I'll be blunt", "I'll just say it", "plainly")
- anything describing the email or post itself ("a quick note", "this isn't a
  sales pitch", "short email")

If the reader can tell what kind of person wrote it, it worked. If the text
has to tell them, rewrite it.

## How he writes

Inferred from how he talks. Apply them; do not quote them.

1. **Literal.** Say exactly what happens, in the order it happens: who does
   what, on what, and what it costs. Concrete nouns. No metaphors, slogans or
   taglines, no "journey", "partner", "solution".
2. **No social smoothing.** No compliments on the reader's business, no "hope
   you're well", no rapport lines, no flattery about their site. Start with the
   thing itself.
3. **No persuasion devices.** No urgency, scarcity, fear of missing out,
   rhetorical questions stacked up, objection-handling, or social proof. Make
   the offer once and leave the decision to the reader.
4. **The reasoning is visible.** He explains why, as a chain: this happens
   because of that, so this. Give the real reason even when a marketer would
   leave it out (for example that a job is small, or that the reader can do
   most of it themselves).
5. **Things a marketer would hide, he says.** That most of the work can be done
   by the reader's own AI tool. That he only needs the part it couldn't do.
   That the cheapest option is usually the right one. Saying these is the
   point; do not soften them.
6. **Uneven rhythm.** Longer sentences joined with commas or semicolons, the
   way someone talks while thinking, then a short one. Do not tidy it into
   three neat paragraphs of equal length, and do not build lists of three.
7. **Stops when done.** When the point is made, end. A flat close ("That's
   it.", a plain question, the link) is fine; a closing line built to be
   remembered is not.
8. **Opinions as his, flatly.** "Most of what you think AI can't do, it can do
   now." No hedging stack ("arguably", "in many cases"), no pretending an
   opinion is a measurement.

## What he offers (the content, in any words)

These are facts about the service as Ali frames it. Say them in fresh words
that fit the piece:

- The reader does as much as they can with their own AI agent (ChatGPT,
  Claude, whatever they use) and sends Ali the part it couldn't finish.
- Most of what people think AI can't do for their business can be done now
  with a few things set up the right way; setting those up is Ali's job.
- Ali checks what an agent did before it goes live, so the reader's
  vibe-coded work stays in check.
- He points the reader to the cheapest thing that does the job.
- No course or curriculum: the reader tries things, and Ali helps when they
  break.
- The connector puts the portal inside the reader's own assistant, so they
  send work from the chat they already use (`/agents` on the site).
- Billed by the second, by one person.

## Stories and claims

Never invent a friend, a client, a conversation, a feeling or a result. A
personal story only goes into a piece if Ali wrote it for that purpose (for
example in the desk's Marketing → Settings → Voice notes). The samples Ali gave
to describe this voice are not material to retell.

## Rules that still hold

- Correct spelling, a capital "I", straight quotes. The voice is in sentence
  shape and what gets said, not in typos.
- No em dashes. `worker/src/content.ts` (`SLOP`) refuses them, along with
  "not X, but Y", "the truth is", stock AI words, invented audiences, and
  self-labels about style ("I'm bad at sales", "to be honest").
- Prices and results only from `launch/proof.md` and `src/lib/offer.js`.
- Name the category once, plainly: vibe contracting (`kit.md`, "The name").
- The reader's own tools (ChatGPT, Claude) may be named. Never name the models
  or providers that run our agents.
- Afterwards run the draft through `README.md` in this folder (humanizer,
  stop-slop). Under 40/50 means rewrite. Score Authenticity by asking whether
  the text would still sound like Ali with his name taken off.
