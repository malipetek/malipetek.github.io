# @malipetek/dsh-git-graph

Source control in the DeepSeek Harness right Sidebar: the working tree with
staging, discarding and committing; a commit graph across every ref; branches;
and `fetch`, `pull` and `push` — plus a note of what the agent changed last turn.

## What it adds

Three views behind one header that always shows the branch and its tracking
state.

**Changes** — staged, unstaged, untracked and conflicted entries, with per-file
**Stage**, **Unstage** and **Discard**, and **Stage all** / **Unstage all** per
section. Clicking a file opens its unified diff. The commit box below takes a
message and offers **Commit**, **Commit and push**, `include tracked changes`
(`-a`) and `amend`.

**History** — the commit graph across every ref, newest first, with lane
colouring, ref chips (branch, `HEAD`, tag), author and date. Clicking a commit
shows its metadata, changed files and patch.

**Branches** — local branches with the current one marked, one-click switch,
delete, a create-and-switch field, and the remotes with a **Fetch** control.
`fetch`, `pull` and `push` also sit in the header.

Above the change list, a one-line note reports the change recorder's summary for
the newest turn: how many files the agent changed, and the added and deleted line
counts. The change list itself is live, so the panel is also the direct answer to
"what did the agent just do to my working tree".

Open it from the Sidebar guide ("Source control") or with `⌘⇧G`/`Ctrl+Shift+G`.

## How it is built

Two channels, chosen by what each operation is.

**Reads** — status, history, diffs, commit detail and the recorder's summary —
are authenticated `GET` routes registered inside Connection's `/api` fence
(`ctx.connection.fetch.register`). They must be polled, and a session command
cannot be used for that: every `commands.execute` appends `command/run` and
`command/done` to the session log and renders a row in the transcript, which is
right for an action the user took and absurd for a status poll every three
seconds. The panel polls only what the visible view needs — status every 3s,
branches every 5s, history every 8s — and stops entirely when its tab is not the
visible one. Branches and history are asked for only by the views that show them.

**Mutations** — stage, unstage, discard, commit, commit-and-push, branch create /
switch / delete, fetch, pull, push, init — are session commands (`/git-graph`).
They are deliberate user actions, they belong in the transcript, and a command is
the one Client-callable Host entry point a third-party bundle may add.

Every git process runs through `ctx.shell`, the sandboxed shell seam, with the
session's own workdir and resolved sandbox policy — the same executor the model's
bash tool uses. Two consequences worth stating:

- The sandbox governs **file effects only**, so a push is never blocked by being
  in a workspace-write session, while a `read-only` session still cannot let git
  write refs or the index. A denial surfaces as a message, never a silent retry.
- `GIT_TERMINAL_PROMPT=0` is set on the network operations, so a missing
  credential fails with git's own message instead of hanging on a prompt no one
  can answer.

The repository root is resolved with `git rev-parse --show-toplevel` once per
session and cached. Git is never invoked with a client-supplied directory: the
`sessionId` is resolved to a live Session through `ctx.sessions`, and its
`header.cwd` is the only working directory the plugin will use.

## Routes

All `GET`, all answering JSON with `cache-control: no-store`.

| Route | Query | Returns |
|---|---|---|
| `/api/git-graph.state` | `sessionId`, `history=1`, `branches=1` | `{ ok, repo }`, where `repo` is `null`-ish (`{reason}`) outside a repository, or `{ root, branch, detached, upstream, ahead, behind, staged, unstaged, untracked, conflicted, branches, remotes, commits }` |
| `/api/git-graph.diff` | `sessionId`, `kind` = `worktree`\|`staged`\|`untracked`\|`commit`, `path`, `hash` | `{ ok, diff, truncated }` |
| `/api/git-graph.commit` | `sessionId`, `hash` | `{ ok, commit, files, patch, truncated }` |
| `/api/git-graph.agent` | `sessionId` | `{ ok, available, seq, summary }` from the workspace change recorder |

## The `/git-graph` command

`/git-graph {"op":…}` — one JSON object, parsed by the Host, with a `CODE: message`
prefix on failure.

| `op` | Fields |
|---|---|
| `stage`, `unstage`, `discard` | `paths: []` |
| `stage-all`, `unstage-all` | — |
| `commit` | `message`, `all?`, `amend?`, `signoff?` |
| `commit-and-push` | `message` |
| `branch-create` | `name`, `checkout?`, `startPoint?` |
| `branch-switch`, `branch-delete` | `name`, `force?` |
| `fetch`, `pull`, `push` | `remote?`, `branch?` for push |
| `init` | — |

## Configuration

None. The repository, remotes and credentials come from the session's workspace
and environment.

## Files it writes

`$DSH_HOME/git-graph/host.json` records the version, command, routes and process
the Host actually activated. Override the directory with `DSH_GIT_GRAPH_DIR`.

## Known limitations

- **No interactive git.** No rebase, merge, cherry-pick, stash, conflict
  resolution or hunk-level staging. Conflicts are listed and can be staged, but
  resolving them is the agent's job or the terminal's.
- **`pull` is `--ff-only`.** A divergent branch reports that instead of starting a
  merge that the panel cannot finish.
- **No credential management.** Push works when git already has credentials for
  the remote — an SSH agent, a credential helper, or an HTTPS token in the
  keychain. Otherwise git's own message is shown.
- **The graph is a lane approximation.** Lanes are assigned by a standard
  swimlane pass over `--all --topo-order`, which is faithful for ordinary
  histories and can differ from `git log --graph` on pathological octopus merges.
- **History is capped** at 120 commits per read, and the shell caps each stream
  at 64 KB, so a very large patch arrives marked truncated.

## Verification

Verified against a throwaway `dsh web` profile whose workspace was a scratch
repository with a feature branch, a staged file, a modified file and an untracked
file: both halves activated, the page opened from the Sidebar guide with no
console error, the three views rendered, a working-tree diff and a commit patch
loaded over the routes, and stage / commit / branch operations ran through the
command.

## License

MIT
