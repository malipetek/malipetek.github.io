# @malipetek/dsh-ai-workspace

A DeepSeek Harness plugin that gives a project's **long-running dev processes** a
managed home: it discovers them, runs them in the background, captures their
output to log files, shows them in a live panel, and tells the agent to read
those logs instead of re-running `pnpm dev` / `pnpm build` / `tsc --watch`.

It is the DeepSeek Harness port of the `ai-workspace` VS Code extension. The
premise is the one worth preserving: if the dev processes are already running and
their output is already captured, an agent never needs to start a second copy —
which would fight over ports and duplicate work.

## Why there are two halves, and why there is a panel

The extension opened one terminal per process. **A DeepSeek Harness plugin cannot
do that**: terminal creation is Agent-gated (`ctx.terminals` refuses any owner
that is not a live registered Agent with `OWNER_NOT_LIVE`), and the one UI-facing
controller only allocates a *discovered shell*, never an arbitrary command, with
a sidebar tab kind that is hardwired.

So this bundle pairs:

- **`index.js` (Host)** — discovery, process supervision, log capture, the agent
  instruction, and the `/ai-workspace` command.
- **`client.js` (Client)** — a sidebar row plus a page whose grid of process
  cards is the closest available thing to those small terminal windows. Each card
  carries a live tail of that process's log.

The halves talk through a file, not a bespoke RPC, because an out-of-tree plugin
cannot declare its own Remote. The Host writes a compact JSON snapshot to
`~/.dsh/ai-workspace/status.json`; the Client reads it through the existing
session-scoped `remote.workspaceFiles` Remote, exactly as the Projects panel
does.

## What it does

- **Discovery** — scans `projectsRoot` one level deep for projects carrying
  `.ai-workspace.json` (or the legacy `.claude-workspace.json`), and re-scans
  every 60 s so a project added while the profile runs shows up. Extra roots can
  be listed explicitly.
- **Onboarding** — every *other* project that has a package manifest or a compose
  file shows up as a not-yet-configured candidate, with an offline proposal for
  its dev processes. See [Onboarding](#onboarding-other-projects).
- **Supervision** — spawns each process detached in its own process group, so the
  whole group can be terminated; counts error-looking output lines with the
  extension's own pattern set; and detects the first bound-port announcement
  (`Local: http://localhost:5173`, `listening on port 3000`) for the card badge.
- **Port management** — before starting a process, works out which port it wants,
  and if that port is taken, moves it and injects the new one through the flag,
  argument or environment variable that runtime understands. See
  [Port management](#port-management).
- **Capture** — mirrors stdout and stderr into
  `<project>/.ai-workspace/logs/<name>.log`. That file is the durable artifact the
  agent reads, and it survives restarts (`/ai-workspace restart`, or the Restart
  button, appends a separator rather than truncating).
- **Panel** — one section per project, one card per process, each with status,
  command, port, error count, restart count, a 132 px live log tail, and
  Start / Restart / Stop buttons, plus Refresh, Live/Paused, Rescan, Start all and
  Stop all. It follows the Host's push feed, so a card updates when the Host
  writes. A **filter box** narrows projects, processes and candidates at once —
  necessary at 144 projects — and a collapsible **Not onboarded** backlog sits
  below the managed projects.
- **Agent instruction** — a compact system-prompt section that states the rule
  ("do not run build/dev/watch/test commands"), names the running projects, and
  points at the tool. It renders as an empty string while nothing runs, so an idle
  plugin costs no prompt tokens, and it is bounded so a large workspace cannot
  bloat a request.
- **Model-facing tool** — `ai_workspace` lets the agent read a process's captured
  output, list error-like lines, see the onboarding backlog, and start / stop /
  restart a process, without a shell command. See
  [Model-facing tool](#model-facing-tool).
- **Agent dispatch** — `/ai-workspace init <project>` hands the agent a turn that
  inspects the project's manifests and writes `.ai-workspace.json`;
  `/ai-workspace fix <project>` does the same for a config that is missing,
  malformed, or out of date. Both work on a project that has no config yet, and
  the turn is seeded with what the offline detector already found.

## Onboarding other projects

A project is only managed once it has a config file, so a folder of 143 projects
with 4 configs would leave 139 invisible. Onboarding closes that gap.

**Nothing is ever written without you asking.** Detection is read-only: the
candidate list and every proposal are computed in memory and shown in the panel.
A file appears in your repo only when you press **Onboard**, run
`/ai-workspace onboard <project>`, or run an explicit `--all`.

### What the detector proposes

It reads `package.json` scripts, the lockfile that names the package manager
(`pnpm` / `yarn` / `bun` / `npm`), and shallow-parses a compose file for its
service names. The rules come from what real projects look like:

| Situation | Proposal |
| --- | --- |
| A conventional `dev` / `develop` / `serve` / `start` script | That one script, named after the project. |
| Both `dev` and `start` | `dev` only — `start` is its production twin, and running both fights over a port. |
| `check:watch`, `test:*`, `lint:*`, `build:watch`, `docs:dev` | Ignored. These are helpers, not app servers. |
| `dev:api`, `dev:web`, … with no plain `dev` | One process per sibling server. |
| Both `dev` and `dev:*` siblings | `dev` only, with the siblings named in a note — a root `dev` usually orchestrates them. |
| A bare `watch` and nothing else | `watch`, at low confidence: a compile watcher is a real long-running process, but it could be a test watcher in disguise. |
| A compose file and no scripts | One `docker compose up`, however many services it declares, with the services named in a note. |
| A compose file beside a `dev` script | `dev` only, with a note — assume the script does not start the infra, and add it only if it does not. |
| No conventional script (`docs:dev` only, or just `test`) | Nothing. The project is marked as needing an agent. |

Proposals are **high confidence** (one unambiguous long-running process) or
**needs review** (sibling servers, a compose stack, or a bare `watch`).

### The panel

The **Not onboarded (N)** section lists every candidate with its manager, a
confidence badge, the proposed commands, and the detector's notes. It carries
view chips — **All**, **High**, **Review**, **Agent** — so the agent-territory
projects can be isolated from the batch-onboardable ones. Each card has:

- **Onboard** — write the proposal to `.ai-workspace.json`. Disabled when the
  detector found nothing to propose.
- **Ask agent** — dispatch an agent turn for the projects a heuristic should not
  guess at.

plus **Onboard all high-confidence (N)**, which writes only the unambiguous ones.

Once a project is onboarded, its card header offers **Offboard**, which removes
`.ai-workspace.json` and stops that project's processes, returning it to the
backlog. It asks for a second click first, and it **only ever removes the file
this plugin writes** — a project configured by a hand-written
`.claude-workspace.json` shows no such control, and asking for it by command is
refused with an explanation. Offboarding is deliberately not exposed to the
`ai_workspace` tool: removing a config is the user's call.

### Commands

```
/ai-workspace candidates            list the backlog with each proposal
/ai-workspace onboard <project>     write the detected config for one project
/ai-workspace onboard --all         write every high-confidence proposal
/ai-workspace onboard --all --low   write every proposal, including "needs review"
/ai-workspace offboard <project>    remove the plugin's config and stop its processes
/ai-workspace init <project>        dispatch an agent to write the config
/ai-workspace fix <project>         dispatch an agent to repair a config
```

### Choosing between the detector and an agent

The detector is instant and free, and it is right about the ordinary case — a
single app with a `dev` script. Reach for the agent when the detector says
**needs review** or finds nothing: monorepos where several packages each need
their own process, compose stacks whose infra must be started separately, and
script names that do not follow the convention. `init` hands the agent the
detector's reading as a hypothesis, so it confirms or corrects rather than
starting from nothing.


## Port management

The prompt section tells the agent not to start a second copy of a dev server
because "a second copy causes port conflicts". This is the half that makes that
safe for *your* processes too: before a process starts, the plugin works out
which port it wants, and moves it if that port is already taken.

**Working out the port**, in priority order:

1. `"port": N` on the process — explicit intent wins.
2. A port named on the command line (`--port 5173`, `-p 3000`, `PORT=4000`, `localhost:8080`).
3. The project's own config: `PORT=` in `.env` / `.env.local` / `.env.development`, or `server: { port: … }` in a Vite/Astro/Rsbuild config.
4. The runtime's default (Vite 5173, Astro 4321, Next/Nuxt/Remix 3000, Angular 4200, Storybook 6006, Jupyter-free Node servers 3000, uvicorn/gunicorn 8000, Flask 5000, Phoenix 4000, …).

**Working out the runtime** means unwrapping the launcher first: `pnpm dev` runs
the `dev` script body, which is where `vite` actually appears. Each package
manager forwards extra arguments differently, so injection respects that — `npm`
needs `--`, `deno task` forwards nothing and falls back to `$PORT`.

**Injecting the port** uses whatever the runtime understands: a `--port` / `-p`
flag (replacing one already present), a bare positional argument
(`manage.py runserver`), or `PORT` in the environment. `docker compose` is left
alone entirely — its ports come from the compose file, and injecting a flag would
break it.

Two details worth knowing:

- **The claim set spans every project.** Live probing alone cannot stop two of
  our own processes starting at the same instant from both seeing a port free,
  so a claim set guards that race. Two Vite apps in different repositories cannot
  both land on 5173.
- **A pinned port is honoured.** The extension this ports had `free && !forced`
  in its decision, which meant `"port": 5173` was *never* used as-is — it always
  shifted to 5174. That is fixed here: a pinned port that is free is used.

When a port moves, the reason is written into the log, shown as a `port moved`
badge in the panel, and returned by the `ai_workspace` tool's `logs` action. When
no injection path is known, the plugin still assigns a port through `$PORT` and
says "verify it binds" rather than silently claiming success.

## Project config — `.ai-workspace.json`

The same shape the VS Code extension uses, so existing repos work unchanged:

```json
{
  "processes": [
    { "name": "frontend", "command": "pnpm dev", "cwd": "./frontend" },
    { "name": "backend",  "command": "pnpm start:dev", "cwd": "./backend" },
    { "name": "database", "command": "docker compose up db", "autoStart": false }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `name` | Short unique slug. Becomes the log filename and the card title. |
| `command` | Exact shell command, run by a login shell in the project. |
| `cwd` | Path relative to the project root. Defaults to the root. |
| `env` | Extra environment variables for this process. |
| `autoStart` | `false` opts the process out of "Start all" and of `autoStart` mounting. |
| `port` | A number pins that exact port; `false` opts this process out of port management. |

## Plugin config

Set in `cordis.patch.yml`. A matching override in the profile's own
`cordis.patch.yml` replaces this `config` wholesale, so restate every field you
need.

| Field | Default | Meaning |
| --- | --- | --- |
| `projectsRoot` | `/Users/malipetek/Documents/Documents/Projects` | Folder scanned one level deep for project configs. |
| `projects` | `[]` | Extra absolute project roots outside `projectsRoot`. |
| `autoDiscover` | `true` | Scan `projectsRoot` at all. |
| `autoStart` | `false` | Start the processes when the plugin mounts. |
| `managePorts` | `true` | Move a process to a free port when the one it wants is taken. |
| `flushMs` | `1000` | How often the Host rewrites the status snapshot. |
| `maxTailLines` | `30` | Trailing log lines carried into the snapshot. |
| `writeAgentsMd` | `false` | Also maintain a marked section in the project's `AGENTS.md` / `CLAUDE.md`. |

`autoStart` is **off by default** on purpose: installing the bundle must not
spawn servers on its own. Press **Start all** in the panel, or turn it on once
you trust the discovered configs.

### Enabling auto-start

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- id: ai-workspace
  name: '@malipetek/dsh-ai-workspace'
  config:
    projectsRoot: /Users/malipetek/Documents/Documents/Projects
    projects: []
    autoStart: true
    flushMs: 1000
    maxTailLines: 30
    writeAgentsMd: false
```

## Commands

The panel's buttons execute a Host-registered command, because a root-scoped
panel has no other way to call into the Host:

```
/ai-workspace status
/ai-workspace candidates
/ai-workspace rescan
/ai-workspace onboard <project>
/ai-workspace onboard --all [--low]
/ai-workspace offboard <project>
/ai-workspace start   <project> [process]
/ai-workspace stop    <project> [process]
/ai-workspace restart <project> [process]
/ai-workspace start-all
/ai-workspace stop-all
/ai-workspace init    <project> [extra instruction]
/ai-workspace fix     <project> [extra instruction]
```

`<project>` matches a project's exact root, its exact folder name, or a unique
fragment of either. Omitting it acts on every project. `init` and `fix` accept
either a managed project or a not-yet-onboarded candidate.

Note that each button click appends `command/run` + `command/done` to the
session log and shows a command row in the conversation — that is how the
Harness records command lifecycles, not something this plugin can suppress
(`recordInput: false` only hides the arguments).

## Agent instructions

Two channels, in order of importance:

1. **System-prompt section** (`ai-workspace.dev-processes`, order 1500). Native to
   DeepSeek Harness, active for every session while the bundle is enabled, and
   empty when nothing is running, so an idle plugin costs no prompt tokens.

   It is deliberately **compact**: the total count, up to 12 project names with
   their running processes, a capped roll-up of what is showing error-like
   output, and the rule. Detail lives behind the `ai_workspace` tool, because a
   per-process table is fine for four projects and a liability for forty — it
   would put a forty-row table into every request and churn the KV prefix on
   every change. `/ai-workspace status` and the panel still show everything.
2. **`AGENTS.md` / `CLAUDE.md` section** — off by default. DeepSeek Harness
   already loads those files, but so do other tools (Claude Code, Cursor…), so
   this exists to carry the same instruction outside the Harness. It only ever
   edits a file that already exists; it never creates one.

## Model-facing tool

The bundle registers one tool, `ai_workspace`, so the agent reads captured output
directly instead of shelling out:

| Action | Effect |
| --- | --- |
| `status` | Every managed process, its state, port and error count |
| `logs` | The recent output of one process (`project`, `process`, `lines`) |
| `errors` | Error-like lines across every process, or one project |
| `candidates` | Projects with no config yet, with the detected proposal for each |
| `start` / `stop` / `restart` | Lifecycle for one project or process |
| `rescan` | Re-read the projects folder now |

`logs` and `errors` read at most the last 256 KB of a log file and return at most
200 lines, so a chatty dev server cannot flood the transcript. `start` without a
project names one rather than starting everything — bulk control stays in the
panel's **Start all**.

Registration hands the tool registry a plain JSON Schema and imports no DeepSeek
Harness package, so it cannot fail on module resolution (the same shape
`dsh-projects-manager` uses). If it ever does fail, the reason is recorded in
`status.json` under `wiring.tool` instead of disappearing into the Host log.

This is what makes the plugin's premise hold: an agent that can read a process's
output with one tool call has no reason to start a second copy of your dev
server to find out what happened.

## Install

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add /Users/malipetek/Documents/deepseek-harness/default-workspace/dsh-ai-workspace
```

**Restart the app** after changing either half. The profile composes configuration
changes live — the Host half of this plugin activates through HMR, which is why
`status.json` appears immediately — but it watches no modules (`root: []`), so the
browser needs a fresh JavaScript generation before the sidebar row and page
appear.

## Later edits

The profile links this directory (`link:`), so editing `index.js` or `client.js`
in place affects the installed plugin directly. Each change still needs the app
restarted before the running JavaScript generation is replaced.

## Limitations

- **No UI terminals.** Explained above; the panel is the substitute.
- **The panel follows the Host's push feed.** The `workspaceFiles.changes` stream
  announces each snapshot rewrite, so a card updates when the Host writes rather
  than up to one poll later. Polling stays installed as the fallback — at 15 s
  once the feed is live, at 3 s when it could not open — and the header says
  which is in use (`streaming` / `polling`). A dropped or unsupported feed
  degrades to polling instead of breaking the page.
  The file Remote also exposes a `changes` stream that could make this push-based.
- **Reading the snapshot needs an open Session** to authorize the Remote call.
- **macOS process-tree containment is best effort.** The Host spawns detached and
  signals the group, but macOS has no stronger persistent process-range owner, so
  a grandchild that escapes the group (a container daemon, a detached worker) can
  outlive a Stop. The same caveat applies to the extension's `killTree`.
- **`cwd` is resolved at discovery time**, and a running process keeps its
  original definition across a re-scan; change a command and restart the process
  to apply it.
- **Onboarding detection is a heuristic**, by design. It reads script *names*, not
  script bodies, so a project whose `dev` script is a one-shot must be corrected by
  hand; and the compose reader is a shallow line parser that needs the standard
  two-space service indentation. Anything it gets wrong, `/ai-workspace fix`
  hands to an agent.
- **Onboarding writes into your repos.** One `.ai-workspace.json` per project, only
  on an explicit action, and never over an existing file — but it does add an
  untracked file that will show up in `git status` until you commit or ignore it.
  Logs go to `.ai-workspace/logs/` in the same tree.
- **UI copy is English-only, but routed.** The panel's copy is keyed and rendered
  through the locale service: the bundle registers an `ai-workspace` namespace and
  declares it on both slot registrations, so the renderer injects the reactive `t`
  seat and the sidebar label is a locale-aware thunk. Only `en` is registered —
  the locale fallback chain always resolves it, so another language shows English
  copy rather than blanks, and adding `zh` is a translation with no code change.
  The **display** metadata read by the Plugin Manager lives separately in
  `locale/en.json`, because the client bundle cannot read a JSON file at runtime.
- **The prompt section is a summary, not an inventory.** It names at most 12
  projects and 6 erroring processes. `/ai-workspace status` and the `ai_workspace`
  tool's `status` action report everything.

## Differences from the VS Code extension

| | VS Code extension | This plugin |
| --- | --- | --- |
| Observation | One real terminal per process | One card with a log tail per process |
| Restart | `rs` + Enter in the terminal | Restart button / `/ai-workspace restart` |
| Port management | Detects collisions and injects a free port | Detects collisions and injects a free port, across every project at once |
| Delegated AI tasks | Manages them as logged processes | Not ported |
| Project discovery | Detects manifests, optionally validated by `opencode` | Offline detector over the whole projects folder, plus `init` / `fix` agent dispatch |
| Instruction channel | Writes `AGENTS.md` | System-prompt section (+ optional `AGENTS.md`) |
