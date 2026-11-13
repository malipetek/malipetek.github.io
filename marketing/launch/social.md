# Social, listings and bios

Posts for LinkedIn, X and communities; directory blurbs; the bios that should
match. Ali's voice (`../style/voice.md`), no
"AI-powered", no model names, no invented results.

Every number here comes from `proof.md`. If a post needs a number that is not
there, do not write the post.

## Framing

The reader has never heard of this. Each post is a first introduction:

- Say plainly what the service is and who it is for, in the first line, before
  anything else. The service is **vibe contracting**: use the term, and define
  it in one plain sentence the first time it appears in a post (see
  `marketing/kit.md` → "The name"). Not every post has to lead with the term,
  but none should describe the service under another name.
- Pricing is not the subject. One plain sentence at most, only when the post
  needs it, and never as the opening line. The launch posts below explain the
  meter; later posts should not keep re-explaining it.
- Do not assume the reader has seen another post, the site, or the portal.

## Cadence

- LinkedIn: 3 posts a week for four weeks, then 1–2 a week. Reply to every
  comment.
- X: one thread a week, plus short singles. Repost LinkedIn ideas, rewritten,
  not copy-pasted the same hour.
- Communities: one post each, following their rules. One is enough.
- Directory listings: submit once, then leave them alone.

Hashtags: none, or at most two (`#buildinpublic`, `#smallbusiness`). They are
not the distribution.

---

## LinkedIn

### Post 1: the machine (launch, with video)

> I turned my contracting work into a pipeline, and I call it vibe contracting:
> you write what you need, I approve it, an AI agent does the typing in a
> sealed copy of the project, and I check the result before it ships. You see
> a preview first and publish when you are happy with it.
>
> You pay for my minutes, by the second, so a one-minute fix is $1.67. There is
> no quote, no call and no minimum.
>
> 90 seconds of how it works: [video]
>
> The first five pilot jobs billed between $2.18 and $8.25. They were pilot
> jobs on my own and demo projects, not clients yet, and each bill came from
> the meter.

### Post 2: the pilot numbers

> First five jobs through the system:
>
> - $2.18 to $8.25 per job
> - average $4.56
> - 13 minutes 19 seconds of my time in total
> - $0.56 of AI, at cost
> - five of five runs finished; average run 37 seconds
>
> They were pilot jobs on my own and demo projects, not paying clients. Each
> one got a small, itemised bill: my measured minutes at $100/hour, by the
> second, plus the AI at cost, with no minimum and no markup.

### Post 3: one real change

> One real job through the system: 2 files changed, 91 lines added and 5
> removed. It took 3m05s of my time and $0.18 of AI at cost, $5.32 in total.
>
> I spent most of those three minutes reading the diff. The agent did the
> typing, and I decided what shipped.

### Post 4: the last mile (essay, no pitch until the end)

> You can vibe code most of an app. It usually stalls on the last part: a bug
> the AI keeps bringing back, a deploy that worked yesterday, or the payments
> integration.
>
> An agency would want a call, a quote and a minimum for that. A chatbot writes
> the code but never puts it in your project or answers for it.
>
> I take that part as a vibe contractor. You send the piece that stalled and I
> approve the job. An AI agent does the typing on a sealed copy of your
> project, so it cannot touch what is live, and I check the result before you
> see it. You pay for the minutes I spend, by the second: a one-minute fix is
> $1.67, with no quote, call or minimum.
>
> malipetek.dev/portal

---

## X

### Thread

> 1/ You can vibe code most of an app. It stalls on the last part: the bug that
> keeps coming back, or the payments.
>
> 2/ I take that part. I call it vibe contracting: I approve the job, an AI
> agent does the typing in a sealed copy of your project, and I check it
> before it ships.
>
> 3/ You pay for my time at $100/hour, by the second, plus the AI at cost. A
> one-minute fix is $1.67, with no quote and no minimum.
>
> 4/ First five pilot jobs: $2.18 to $8.25 each, $0.56 of AI in total, 13m19s
> of my time, and all five runs finished.
>
> 5/ Those were pilot jobs on my own and demo projects, not clients yet. Every
> bill came from the meter.
>
> 6/ malipetek.dev/portal

### Singles

- A one-minute fix is $1.67, with no quote, no call and no minimum.
- Vibe contracting: an AI agent does the typing, and I sign off on every
  change before it ships.
- A real job: 2 files, 91 lines, 3m05s of my time, $5.32.
- "So AI writes my code?" It does the typing. I approve the job and check the
  result, as closely as you ask.

---

## Communities

Read the rules before posting. Most communities allow one "show" post and ban
links in the body; put the link in a comment if that is the rule. One post,
then participate like a person.

### Indie Hackers: Show IH

> **Vibe contracting: a metered dev shop where an agent does the typing and a
> human signs off on the work**
>
> The problem I kept running into: small software jobs are too small for an
> agency and too risky to hand to a chatbot. So I built the middle.
>
> You write the request. I approve it. An agent works in a sealed copy of the
> project. I check the result before it ships. You pay for measured minutes,
> by the second, plus the AI at cost.
>
> The first five pilot jobs (my own and demo projects, not clients) billed
> $2.18–$8.25. The interesting number is the AI: 8–18 cents a job. The rest is
> my time.
>
> The agent was the easy part. Most of the work went into the queue, the
> leases, the preview branch, and a bill that explains itself.
>
> Happy to answer questions about the pipeline. Link in the comments.

### Local business group: promotion thread only

> Small website fixes, by the minute. If something on your site has been on the
> list for months, like opening hours or a form that does not send, I can take
> it. You pay for my minutes, by the second; a
> one-minute fix is $1.67. No quote, no call, no minimum. Happy to tell you
> whether it fits before anything starts.

### Reddit

Most small-business subreddits ban self-promotion outside a weekly thread. Use
the thread, or do not post. The one-liner:

> I fix the last mile of small sites and vibe-coded apps: agent does the typing,
> human approves and checks. Metered by the second, no quote. Happy to answer
> questions here; not dropping a link unless asked.

---

## Directory listings

### ChatGPT plugin

Already submitted. The listing text lives in
`packages/chatgpt-plugin/plugin.json` — that file is the source of truth. Do not
rewrite it here; if it changes, change it there.

### MCP directories (Smithery, Glama, mcp.so, PulseMCP)

Use the same short text everywhere:

> **malipetek** — One MCP endpoint for malipetek.dev: a public agentic-coding
> knowledgebase plus a client portal. Public tools read and search the
> knowledgebase with no key. Portal tools file, track and budget software work
> for a signed-in client. Streamable HTTP, protocol 2025-06-18.

Longer, where the field allows:

> malipetek.dev is a vibe contracting service: an AI agent builds, and one
> developer signs off on every change. Its MCP server exposes a public knowledgebase of real agentic-coding
> problems (search, read, list) and a client portal (projects, requests, replies,
> budgets, preview and publish). Reading needs no authentication. Writing needs a
> key the owner mints, or the client's own portal key.

Note: this audience is developers and agents, not the buyer. It is passive
discovery; do not count it as a launch channel.

### "Available for work" listing (HN freelancer thread, local boards)

> **Software help, by the minute.** Vibe contracting from a one-person dev shop:
> you send a request, I approve it, the agent builds it on a sealed copy
> of your project, and I check it before you see it. You pay for my minutes,
> billed by the second: a one-minute fix is $1.67, with no quote and no minimum.
> Serverless, small jobs welcome. malipetek.dev

---

## Bios

### LinkedIn headline

> Vibe contracting · software help, by the minute

### LinkedIn about

> I do vibe contracting: an AI agent does the typing, and I sign off on every
> change before it ships.
>
> You send a request: a fix, a feature, an integration that broke. I approve it
> before anything starts. The agent does the typing in a sealed copy of your
> project, so nothing live is touched. I check the result before you see it, as
> closely as you ask.
>
> You pay for the minutes I actually spend, billed by the second, plus the AI at
> cost. A one-minute fix is $1.67. No quote, no call, no minimum.
>
> malipetek.dev

### X bio

> Software help, by the minute. The last mile of your vibe-coded app, without a
> quote. malipetek.dev

### GitHub bio

> Software help, by the minute. malipetek.dev

### Email signature

> Ali Petek
> Vibe contracting, by the minute · malipetek.dev/portal

---

## Comment and reply bank

- **"What does it cost?"** My time at $100/hour, by the second, plus the AI at
  cost. A one-minute fix is $1.67. No minimum.
- **"Is this just ChatGPT?"** It is a developer with an agent doing the typing.
  I approve the job and check the diff before it ships.
- **"How do you keep it from breaking things?"** The agent works on a sealed
  copy, never on what is live. You see a preview first, and I read the result.
- **"Do you do X?"** Tell me what X is and I will say honestly whether it is a
  fit.
- **"Cool project."** Thanks. The queue and the bill took most of the work.
  (Then stop. Do not pitch in the replies.)
