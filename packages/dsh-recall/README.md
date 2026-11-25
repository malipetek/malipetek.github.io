# @malipetek/dsh-recall

One thread across every project: search and read every past conversation
from wherever you are, and catch up on a project without switching windows.

DeepSeek Harness already writes every session to disk. That record is the only
place the answer to *"what did we decide about the admin app?"* exists — but it
is useless if you have to reopen that project, in that window, with that agent.
This plugin makes the store addressable from any session.

- **`recall` tool** — search conversations, read one back, list the portfolio, or
  catch up on a project (card + open work + recent runs + conversations).
- **`/recall …`** — the same without spending a model turn.
- **Always learning** — a background index over the session store, refreshed
  incrementally from logs whose mtime moved.

## Why this exists

The operator works across ~150 projects and several agents (Claude Code, Devin,
Antigravity, native workers). Reconstructing "where were we?" by hand is what
made one thread impossible: every switch cost a paragraph of re-explanation.
Retrieval belongs in the agent, not in the person's memory.

## Using it

Ask in any thread:

> catch me up on the admin app

The agent calls `recall` with `action: "catch_up"`, and gets back:

1. the project's settled facts from `~/.dsh/context/projects/<slug>.md`;
2. what is still open for it (`needs.json` — blocked agents, failed runs,
   blocked pipeline stages, proposals);
3. recent delegated work from the ledger;
4. its last few conversations with the line that shows what each was about.

Then it can say where things stand and continue, without you opening anything.

Other actions:

| Action | What it returns |
| --- | --- |
| `search` | Conversations matching words, best first, with the matching line and the session id |
| `session` | One conversation as a compact transcript (18k char budget) |
| `projects` | Every project with conversation history, most recently active first |
| `catch_up` | Everything needed to resume one project, as above |

From the composer, without a model turn:

```text
/recall admin deploy          # search
/recall catch-up admin-ui     # the full picture for one project
/recall session session-abc…  # read one back
/recall projects              # the portfolio
```

## How the index works

| Step | Detail |
| --- | --- |
| Read | `zstd -dc` on `<workspace>/<session>/session.v4.jsonl.zstd`. The CLI is required: Node's zstd decoder stops after the first frame, and DSH writes several — decoding with Node silently returns only the header record. |
| Extract | Human turns (never the harness's injected runtime snapshots or `<system-reminder>` blocks), the agent's messages, tool names, commands. Turns are clipped to 700 chars, messages to 420; a session keeps its first 8 and last 32 turns. |
| Skip | A log with nothing asked and nothing said is not indexed: aborted runs and tool-only sessions are not conversations. |
| Hide | Sessions whose working directory is a temp dir, and delegated worker sessions (`origin: "subagent"` / `delegationDepth > 0`), are hidden from the portfolio and from `search` by default. Worker runs belong to the work ledger; pass `includeWorkers: true` to search them. |
| Store | `~/.dsh/recall/index.json` — one summary per conversation, newest first. `INDEX_VERSION` invalidates the file when the shape changes. |
| Refresh | At most once every 5 minutes, and only logs whose mtime or size moved are re-read. A full rebuild of 793 logs (579 conversations) takes ~16s; a no-op refresh is a directory stat pass. |
| Scope | The 900 most recently touched sessions (`DSH_RECALL_KEEP`), so the index stays a few megabytes. |

`session` falls back to reading a log directly when the id is older than the
retained window, so an old conversation stays reachable.

## Files it writes

| Path | Purpose |
| --- | --- |
| `~/.dsh/recall/index.json` | The conversation index. Delete it to force a rebuild. |

Nothing else is written: no session, project or other plugin's store is touched.

## Ranking

For a search, what the person asked weighs most, then the project name, then the
path/tools, then what the agent said. A conversation matching every word of the
query outranks one sharing a single word, and recency breaks ties rather than
deciding them.

## Limitations

- **Summaries, not full text.** A very long conversation is searchable by its
  opening and closing turns; the middle is not indexed. `session` reads the
  retained summary, not every record.
- **Lexical, not semantic.** "deploy" will not find "ship" unless both appear.
- **This machine only.** A conversation held in Devin's or Antigravity's own
  app, outside DSH, is not in the session store and cannot be indexed here.
- **zstd CLI required.** Without `zstd` on `PATH`, the index cannot be built and
  the tool reports that no conversations are indexed.
- Worker sessions are hidden by design; their result is recorded in the work
  ledger (`~/.dsh/context/work/`) instead.

## Install

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add \
  /Users/malipetek/Documents/Documents/Projects/malipetek.github.io/packages/dsh-recall
```

The profile also lists the bundle in `dsh.profile.bundles`. A JavaScript change
needs an app restart; configuration does not.

## Verifying

```sh
node --test test/memory.test.mjs   # parsing, ranking, incremental refresh
node test/probe.mjs "deploy" ptechsolutions-site
```

The probe builds the real index (writing `~/.dsh/recall/index.json`) and prints
the portfolio, a search, one transcript and a catch-up. Set `DSH_RECALL_KEEP=60`
for a fast run.
