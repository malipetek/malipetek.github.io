# Fleet

The machines that do the work. Each one runs `node.mjs`: it heartbeats to the
portal Worker, leases approved work it is eligible for, runs an agent in a
throwaway git worktree, commits to a local branch, and reports the diff back as
a private note. A good run's commit is pushed to the ticket's own branch on the
repo's remote (`malipetek/task-7`, `malipetek/ticket-12`), so the next run picks
it up on any node.

Where else it lands is the project's `push` policy: `main` (also fast-forwards
the default branch — the default for a system task, because the point of filing
one is that it is finished when the run is), a branch name such as `preview` (so
a client can look at a change without Ali), `branch` (only the work branch — the
default for a client request, because on a hosted project the default branch is
what deploys), or `none`. Named branches are only ever fast-forwarded; nothing
is forced onto them.

It replaces the old ticket runner (one machine, silent when down) and the
ShipFit Slack bridge in `~/devin-outpost` (several machines, but its queue was a
Slack thread and it approved its own permissions).

```sh
cp fleet/config.example.json ~/.config/malipetek-runner/config.json   # then edit it
node fleet/node.mjs --projects   # what this node would claim
node fleet/node.mjs --once       # one item at most, then exit
fleet/install.sh                 # supervise it (launchd on macOS, systemd on Linux)
```

## How work reaches a node

1. A request arrives: the portal, an email to `new@`, or a system task filed
   from the Harness Admin panel. Client requests wait in **new** until Ali
   approves; filing a system task approves it.
2. Every 30 seconds each node heartbeats with what it can do: its OS and other
   **capabilities**, its **executors**, the project **slugs** it holds folders
   for, and its **slots**.
3. A node with a free slot claims the best item it is eligible for: highest
   priority, then longest waiting. Eligible means the node holds the project's
   folder, has every capability the item requires, and runs its pinned executor.
   The claim is a **lease**; every heartbeat renews it.
4. If a node goes quiet (lid closed, crash), its lease lapses within three
   minutes and the item goes back to the queue for another node. After three
   lapses it goes to review instead.
5. Files attached to the ticket (screenshots, PDFs, private notes' files too)
   are downloaded into `.malipetek-files/` in the worktree for the run, named in
   the prompt, and deleted before the commit. A node can fetch a ticket's files
   only while it holds a run on it.
6. A follow-up run starts from the last good run's commit, wherever it ran:
   fetched from origin's ticket branch, or, when that node could not push (a
   read-only repo, no remote), from a git bundle it left in the portal's R2
   bucket. The run card in the Admin panel says which: "pushed · malipetek/task-7",
   "shared as bundle", or "only on g500" for a run that could share neither.
   Pushes use `--force-with-lease` against the tip the run started from and
   `--no-verify` (a repo's pre-push hook is not ours to run). A run whose policy
   lands it on the default branch does both pushes — the work branch for the next
   run, the default branch for the person — and a default-branch push that would
   not fast-forward is refused and named in the note, never forced.
7. If Ali changes the status while a run works (requeue, done, decline), the
   run is stopped. Its late report is still recorded and its AI cost counted,
   but it never moves the ticket.

When nothing can take an item, the Admin panel's **Queue** says why — no node
holds the folder, the node that does is offline and since when, nothing has the
capability. After 30 minutes stuck, Ali gets one email.

## Executors

| executor | for | how |
| --- | --- | --- |
| `claude` | client and system work | Claude Code headless. Client work gets read/edit tools plus `git add`/`git commit` (it is asked to finish its own work), no MCP, no web, no inherited settings. System work may also run Bash (never `git push` — the node pushes). |
| `opencode` | approved client and system work | `opencode run --auto` — open permissions, not sandboxed |
| `dsh` | approved client and system work | `dsh --profile headless --json -` — the Harness in one shot, on whichever provider that profile uses (DeepSeek, OpenCode Go, …). |
| `dsh-claude` | approved client and system work | The same Harness run, driving Claude Code as an external ACP agent (`claude-agent-acp`). Offered when `dsh` and `claude-agent-acp` are both on PATH. |
| `dsh-opencode` | approved client and system work | The same Harness run, driving OpenCode as an external ACP agent (`opencode acp`). Offered when `dsh` and `opencode` are both on PATH. |
| `devin` | approved client and system work | Devin over ACP; auto-approves its own permission prompts — open permissions, not sandboxed |
| `dsh-devin` | approved client and system work | The same Harness run, driving Devin as an external ACP agent (`devin acp`). Experimental — Devin's ACP adapter returns empty turns, so nodes don't advertise it yet. |

Client work defaults to `claude` (the only sandboxed executor) and falls back
through the client order `claude → dsh-claude → dsh → dsh-devin → dsh-opencode →
devin → opencode` on a usage limit: Ali approves every request before it runs.
A client ticket can also be pinned to any executor.

System work with no pinned executor takes the first of these the node runs —
Harness executors first, so the run has a conversation to open:
`dsh-claude → dsh → dsh-devin → dsh-opencode → devin → claude → opencode`. When a run fails
on a usage limit (spend/usage/rate limit, 429, insufficient balance), the node
retries the same worktree on the next executor that spends a different account
(a Claude limit skips `claude` *and* `dsh-claude`), says what it switched in the
run note, and reports the executor that actually finished.

`dsh-claude` and `dsh-opencode` work through an overlay patch the node writes
next to its config (`~/.config/malipetek-runner/dsh-agent-<agent>.patch.yml`)
and passes as `dsh --profile <profile> --patch <overlay> --json -`. It
registers the two ACP agents and sets the Harness's default model to
`acp-claude` / `acp-opencode`, and disables the Harness's LLM session titles:
those ask the turn's own route — the external agent — for a title while the
turn starts on it, and the ACP adapter hands the title's answer back as the
turn's (the task never ran, or the turn ended `EMPTY_TURN`). They need a Harness profile with
`@malipetek/dsh-external-agents` in its bundles — the node runs them under
`fleet-agents` by default (the plain `headless` profile lacks the plugin and
answers NO_ADAPTER), and only offers them when that profile exists. Config:
`executors["dsh-claude"]` and `executors["dsh-opencode"]` take `bin` (default
`dsh`), `profile` (default `fleet-agents`), `agentCommand` (default
`claude-agent-acp` / `opencode`) and `model` (default `opus` for Claude;
`opencode/deepseek-v4.1-flash-free` for OpenCode).

### Harness sessions

Every `dsh`-family run reads the Harness's `--json` event stream for its
session id, final answer and turn count. After the run, before reporting, the
node finds the session's log at
`$DSH_HOME/sessions/<encoded cwd>/<sessionId>/session.v4.jsonl.zstd`
(`DSH_HOME` defaults to `~/.dsh`) and, when it is at most 50 MB, uploads it with
`PUT /node/runs/:runId/session?nodeId=…` so the Admin panel on any machine can
open the conversation. The result carries `sessionId`, `sessionDir` (the
encoded directory name) and `sessionLog` (true only when the upload was
accepted). A failed upload is logged and never fails the run. If `dsh`'s
stdout holds no JSON events at all, the whole stdout becomes the summary, with
no session id (the pre-`--json` behaviour).

## Config

`~/.config/malipetek-runner/config.json` — see `config.example.json`.

- `node.id` — the stable name the queue knows this machine by (`macbook`, `g500`).
- `node.capabilities` — extra capabilities beyond `os:<os>`, which is automatic.
- `node.executors` — which to offer; default is whichever binaries are on PATH.
- `projects.<slug>.verify` — a command run in the worktree after the agent
  finishes. A failure marks the run failed. It comes from this file, never from
  the brief.
- `push` — `'none'`, `'branch'`, or a branch name, per project or node-wide.
  `'main'` means the main line (resolved through `defaultBranch`); `'preview'`
  or any other name is that branch literally, so a client can look at a change
  without Ali. Unset asks the kind rule: a system task lands on `main`, a client
  request on its work branch. On a hosted site the portal owns the `preview`
  branch, so the node leaves it alone. See `share.mjs`.
- `defaultBranch` — the branch `push: 'main'` means. Unset asks the repo's
  `origin/HEAD`, then `main`.

- `autoClone` (default true) / `cloneRoot` (default
  `~/.cache/malipetek-runner/projects`) — a project the portal names a repo for,
  with no folder here, is cloned into `cloneRoot` with this machine's own git
  credentials: https or ssh only, no submodules, no credential prompts. A clone
  is fetched before every run and starts from the ref the portal gives
  (`origin/preview` for a hosted site, falling back to `origin/HEAD`). A GitHub
  https URL that fails to clone is retried over ssh. When the portal has no repo
  for a project, any node holding a folder for it reports that folder's `origin`
  (credentials stripped), so the other nodes clone it on their next sync — a
  repo already set in the portal is never overwritten.

The Harness Admin panel writes `projects.<slug>` folder mappings into the same
file.

Every run parks the repo's own agent settings (`.claude/settings.local.json`,
`.claude/settings.json`, `.mcp.json`) outside the worktree for its duration and
restores them before the commit. A client repo can carry hooks, and Claude Code
reads `settings.local.json` even under `--setting-sources local`.

### A model key for `dsh`

The shipped `headless` profile disables the Harness credential store, so
`dsh headless` reads provider keys from the environment only. On a node, run
`./set-model-key.sh deepseek` (or `opencode-go`): it asks for the key with hidden input, proves it with one real
task, then writes `~/.config/malipetek-runner/node.env` (mode 600) and dsh's own
`~/.dsh/.credentials.yaml`, points the headless profile at that provider with the
credential store re-enabled (so `dsh headless` works in an SSH session too), adds a systemd drop-in so the service reads
the file, adds `dsh` to the node's agents, and restarts the node. A key that
fails the test changes nothing.

## Health and remote settings

Every heartbeat carries a health report (`health.mjs`): load, memory, disk,
battery, Tailscale IP, whether the node runs as a service, each agent's version,
and the services it watches — Tailscale by default, or a `node.watch` list in
the config (`[{ "name": "…", "process" | "launchd" | "systemd": "…" }]`). Both
admin views show it per node, so a stopped process on the G500 is visible
without a shell on it.

A node's parallel runs, capabilities, offered agents and offline email alert can
be changed from either admin view; the change reaches the node on its next
heartbeat and wins over its config file. Edits to the config file itself (the
Harness panel writes it) are picked up within 30 seconds without a restart.

## Operating it

- **Menu bar:** symlink `fleet/swiftbar/node.30s.sh` into SwiftBar's plugin
  folder for a green / orange / red dot.
- **Logs:** `~/Library/Logs/malipetek-node/node.log` (macOS),
  `journalctl --user -u malipetek-node` (Linux).
- **Local state:** `~/.cache/malipetek-node/status.json`, which the Admin panel
  and the menu-bar dot both read.
- **Restart:** `fleet/install.sh restart`. On SIGTERM the node stops its runs
  without reporting them, so their leases lapse and the work goes back to the
  queue rather than into review.
- **Drain:** from the Admin panel. The node finishes what it has and claims
  nothing new.

## Adding the G500

```sh
git clone … && cd malipetek.github.io
cp fleet/config.example.json ~/.config/malipetek-runner/config.json
# set node.id "g500", the token, and the projects it holds
loginctl enable-linger "$USER"
fleet/install.sh
```

A Cloudflare sandbox node later is the same contract: heartbeat, claim, report.
