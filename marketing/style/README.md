# Writing style: no machine tells

Everything public in our voice (posts, emails, site copy, bios, replies) goes
through this before it ships. It exists because our generated posts were
accurate and still read as machine-written.

**Start with [`voice.md`](voice.md)**: Ali's own words, what makes them sound
like him, and the only stories that may be told in his name. This file and the
two skills below are the pass that comes after it: they remove machine tells,
and `voice.md` says what should be left.

Two vendored skills do the heavy lifting. Both are MIT-licensed; their licence
files sit next to them.

| Skill | What it is for |
| --- | --- |
| [`humanizer/SKILL.md`](humanizer/SKILL.md) | The catalogue: 26 patterns from Wikipedia's "Signs of AI writing", each with examples, and a method (mark, rewrite, check again). By Siqi Chen (blader/humanizer). |
| [`stop-slop/SKILL.md`](stop-slop/SKILL.md) | The short version: eight rules, a pre-send checklist and a 50-point score. Phrase and structure lists in `references/`. By Hardik Pandya. |

## How to use them

1. Read `voice.md`, then write the draft in that voice from the facts
   (`marketing/launch/proof.md`, `src/lib/offer.js`).
2. Mark every tell in it, using humanizer's catalogue. Strongest first.
3. Rewrite the whole piece around its point. Do not patch phrase by phrase.
4. Score it with stop-slop's five dimensions (Directness, Rhythm, Trust,
   Authenticity, Density). Under 40 of 50: rewrite again. (The skill says 35;
   we hold posts to 40.)
5. Read it as the reader: a business owner who has never heard of us.

## Our rules on top of the skills

- **Say what happened, not what it means.** "Three minutes of my time, $5.32"
  beats any sentence about what that number proves.
- **No invented audience.** No "the question I hear most", "people always ask",
  "clients tell me". There are no clients yet; `proof.md` says so. Write what
  you did or what the reader can do. Real moments Ali lived are allowed, and
  only the ones listed in `voice.md`.
- **End on a fact, a question, the link, or a flat "that's it".** Never on a
  punchline, a moral, or a one-line paragraph built to be quoted. Ali's way of
  stopping is to let the air out, not to land a line.
- **No staged fragments.** "Wrong opening hours. A broken form. A page that
  fails on a phone." is a slide, not a sentence. Write one sentence with the
  examples in it, and use two examples, not three.
- **Lists are for things a reader will scan.** A post with two bullet lists is
  a brochure. Most posts need none.
- **Name the category once, plainly.** "Vibe contracting" is our term (see
  `marketing/kit.md`, "The name"). Define it in a sentence; do not dramatise it.
- **Plain marks.** Commas, full stops and colons. No em dashes in posts and
  email. Straight quotes.

## What the Worker refuses

`worker/src/content.ts` (`SLOP`) rejects a generated post outright when it
contains one of these, because they are the tells that survived every rewrite
we tried. A refused post is not scheduled, and the cycle note says why.

- an em dash
- "not X, but Y" / "it's not X, it's Y" / "not just X"
- throat-clearing: "here's what", "here's the thing", "here's why", "the truth
  is", "let that sink in", "make no mistake", "full stop"
- stock AI words: delve, tapestry, testament, game-changer, seamless(ly),
  leverage, unlock, elevate, empower, supercharge, robust, pivotal,
  ever-evolving, "in today's", "in a world where", "at its core"
- invented audience: "the question I hear most", "people always ask", "clients
  tell me"

Everything else in the two skills is judgement, and the score in step 4 is
where it gets applied.
