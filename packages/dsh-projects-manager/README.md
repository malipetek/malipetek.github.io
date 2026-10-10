# @malipetek/dsh-projects-manager

A DeepSeek Harness plugin that tracks how much each project is *actually*
moving, scores stalls against each project's own working pace, and reminds you
before work quietly stops.

It sits on top of [`@malipetek/dsh-projects-panel`](../dsh-projects-panel), which
answers *"what projects do I have?"*. This one answers *"which of them am I
losing?"*. The two are independent: nothing in the Projects panel changes, and
this plugin keeps its own index.

- **Momentum page.** A ranked list of what is cooling or stalling, why, and the
  controls to change it.
- **App-wide reminder.** A dismissible banner over the whole frame, so a stall is
  visible without opening a panel.
- **Scheduled review.** A cron task runs the model as your projects manager on
  weekday mornings; it reads a briefing and writes the nudge.
- **Direct commands.** Snooze, set a pace, or record a next action from the panel
  or as `/projects …` — no model turn, no conversation entry.

## What makes the metadata "smarter"

A directory listing can only tell you when files were touched. That is a poor
proxy for work: a build, a `git checkout`, or a sync moves mtimes without anyone
working on the project. This plugin reads three independent signals.

### 1. DSH work history — the one that matters most

DSH already knows when you genuinely worked on a project, because it recorded
it. The Host half reads:

| Source | What it yields |
| --- | --- |
| `~/.dsh/storages/workspace.json` | Workspace path → Session ids |
| `~/.dsh/storages/session_projcache/sessions/*.json` | Each Session's `cwd`, turn count, LLM time, and `lastPromptAt` |

`lastPromptAt` is the last time a human actually typed something into a Session
whose working directory was that project. That is a far better "last worked on"
signal than any file timestamp, and it is available for no other editor.

It also distinguishes *opened and abandoned* from *never started*: a project with
Sessions but zero turns becomes `never-started` — you opened it and never asked
for anything.

### 2. Git velocity and drift

Two read-only git invocations per repository:

- `git status --porcelain --branch` → branch, ahead/behind, modified and
  untracked counts.
- `git log --since=180.days --format=%ct` → commit cadence, used both for
  velocity **and** to learn the project's own pace.

Velocity is a *change*: commits in the last 14 days against the 14 before. Drift
is uncommitted work accumulating without landing.

### 3. Stated intent

Some things are only knowable from you. Per project you can record a next action,
an expected pace in days, a snooze, or an ignore. This is host-owned state at
`~/.dsh/projects-manager/intent.json`, so the briefing and the cron review see it
too.

## How a stall is scored

A global "90 days untouched" threshold is useless across 143 projects that range
from daily work to abandoned 2021 experiments. Instead each project is compared
**against its own baseline**.

The baseline is learned from the gaps between that project's distinct activity
days (commits and DSH prompts), taken at the 75th percentile — so "unusual for
me" means genuinely unusual, not merely below median — and floored at 3 days so
an ordinary weekend does not read as decline. A repository that normally commits
daily and has now been quiet for five days is flagged; a repository that normally
moves fortnightly is not.

| State | Meaning |
| --- | --- |
| `never-started` | Opened in DSH, never prompted, nothing committed |
| `stalling` | Quiet for longer than 2× its own pace |
| `cooling` | Quiet for longer than its own pace |
| `active` | Within its own pace |
| `dormant` | Quiet for more than 5× its own pace |
| `unstarted` | No commits in 180 days and no DSH history |
| `ignored` | You asked not to be told again |

Risk blends three factors over that baseline: how long the project has been quiet
(55%), how far its commit rate has fallen (30%), and how much uncommitted work is
piling up (15%). Only `never-started`, `stalling` and `cooling` raise a reminder,
and `unstarted` projects stay silent — otherwise 121 abandoned folders would bury
the eight that matter.

## The scheduled review

The cron trigger is DSH's own Schedule subsystem rather than a timer in this
plugin, so it survives restarts, persists its tasks, and can restore a cold
Session to run the turn. It is delivered by the optional bundle
`@deepseek-ai/dsh-experimental-schedule-bundle`, which is enabled in the
`desktop` profile.

The default task is `0 9 * * 1-5` in your local zone, titled *Projects review*.
Each run delivers this instruction into its originating Session:

> Act as my projects manager. Read `~/.dsh/projects-manager/manager-brief.md` …

The judgement lives in the briefing file rather than in the prompt, so you can
read exactly what the model will see.

Set it up once from the panel's **Set up weekday review** button, by `/projects
cron <expression>`, or by asking the agent to schedule it. Manage it afterwards
on the **Automation tasks** page that enabling the bundle adds to the sidebar.

## Commands

`/projects …` runs directly against the Host — no model message is created and
nothing enters the conversation. The panel calls the same commands through
`remote.commands.execute`.

| Command | Effect |
| --- | --- |
| `/projects` | Summary of what needs attention |
| `/projects scan` | Rescan the folder now |
| `/projects list [state]` | List projects, optionally filtered by state |
| `/projects snooze <name> [days]` | Hide until then (default 14) |
| `/projects cadence <name> <days>` | Set the expected pace |
| `/projects next <name> <text>` | Record the next action |
| `/projects resume <name>` | Clear snooze and ignore |
| `/projects ignore <name>` | Stop reporting a project |
| `/projects cron [expression]` | Create or replace the review reminder |
| `/projects remind` | Run the review in this Session now |

A project may be named by any unambiguous prefix. An ambiguous name is refused
with the candidates rather than guessed at.

## Model-facing tool

One tool, `projects_manager`, registered on the Host context and visible to root
agents, with actions `brief`, `list`, `intent`, `schedule` and `rescan`.

It is registered by handing the tool registry a definition directly — the
registry accepts a JSON Schema for `parameters`, so this plugin imports no
DeepSeek Harness package at all and cannot fail to register on module resolution.
A single schema keeps the per-request token cost to one tool.

## Files it writes

Everything lands in `/Users/malipetek/.dsh/projects-manager/`:

| File | Purpose |
| --- | --- |
| `index.jsonl` | One record per project; read by the Client half |
| `manager-brief.md` | The model-readable briefing the cron review reads |
| `intent.json` | Your stated next actions, paces, snoozes and ignores |
| `cache.json` | Last scan summary: duration, state counts, attention list |
| `doctor.json` | Wiring report: whether the tool registered and Schedule is mounted |

Nothing is ever written into the projects folder.

## Configuration

Constants live at the top of each half and some are mirrored:

| Constant | File | Value |
| --- | --- | --- |
| `PROJECTS_ROOT` | `index.js` | `/Users/malipetek/Documents/Documents/Projects` |
| `STATE_DIR` | `index.js` | `/Users/malipetek/.dsh/projects-manager` |
| `INDEX_PATH` | `client.js` | same absolute literal — change both together |
| `RESCAN_INTERVAL_MS` | `index.js` | `300000` (5 min) |
| `HISTORY_DAYS` | `index.js` | `180` |
| `LEARNED_MIN_CADENCE_DAYS` | `index.js` | `3` |
| `DEFAULT_CRON` | `index.js` | `0 9 * * 1-5` |
| `BANNER_HOLD_MS` | `client.js` | `25000` |

`STATE_DIR` is a literal rather than `DSH_HOME`-derived because the Client half
cannot read the Host environment. `DSH_PROJECTS_MANAGER_DIR` overrides it for the
local smoke tests only; the running app never sets it and `client.js` ignores it.

Snoozes, pace and next actions are host-owned so the scheduled review sees them.
The reminder banner's dismissal is browser-local.

## Install

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add \
  /Users/malipetek/Documents/deepseek-harness/default-workspace/dsh-projects-manager
```

Enable the Schedule bundle by listing `@deepseek-ai/dsh-experimental-schedule-bundle`
in the profile's `dsh.profile.bundles`.

Enabling a bundle is picked up live, but **a change to either JavaScript half
needs an app restart**: the profile watches configuration, and module
registrations are not reloaded. Confirm wiring afterwards by reading
`doctor.json`.

## Verifying

Two local suites run without the app and are excluded from the published
`files` list:

```sh
node dev-smoke.mjs          # collectors, scoring, briefing, commands, tool
node dev-client-smoke.mjs   # renders the page and the banner against a mock React
```

`dev-smoke.mjs` writes its output to `.smoke-state/` by default via
`DSH_PROJECTS_MANAGER_DIR`, so it never touches real state. Pass `--reset` to
clear the test intent store.

## Limitations

- **A restart is required** after changing either half. Configuration changes
  apply live; module changes do not.
- The learned pace needs at least three distinct activity days; below that it
  falls back to 14 days and reports `cadenceSource: "default"`.
- `git log` reads 180 days, so a project quiet for longer looks `unstarted` rather
  than `dormant`.
- Drift counting treats a vendored or generated directory inside a repository as
  uncommitted work, which can dominate the score.
- The folder watch is non-recursive and activity inside a project fires no event,
  so a project's date refreshes on the 5-minute interval at the latest.
- Panel and banner copy is plain English rather than routed through the Client
  locale service, so it does not switch language.
- `/projects remind` needs `@deepseek-ai/dsh-llm` to build the follow-up message;
  if that import ever fails the command reports the briefing path instead of
  starting a turn.
