# Local runner

Runs on Ali's machine. Picks up portal tickets **he has approved**, has Claude
Code implement them in a throwaway git worktree, and reports back as a private
note. Zero dependencies — Node 22 and the `claude` CLI.

```sh
mkdir -p ~/.config/malipetek-runner
cp runner/config.example.json ~/.config/malipetek-runner/config.json   # then edit it
node runner/runner.mjs           # poll forever
node runner/runner.mjs --once    # one ticket at most, then exit
```

## What happens to a ticket

1. Ali sets a ticket's project and presses **Approve** in `/portal/admin`.
2. The runner claims it (`approved → in_progress`). It only asks for the
   project slugs in its config, so tickets for unmapped projects stay put.
3. It adds a worktree for a new `ticket-<id>` branch (`ticket-<id>-2` on a
   re-run) from `baseRef` (default `HEAD`) under `worktreeRoot`. The repo's
   own checkout is never touched.
4. `claude -p` runs in that worktree with the ticket thread on stdin.
5. Whatever changed is committed to the branch. The summary, diffstat and
   diff go back as a private **Runner** note; the ticket moves to
   **In review** and Ali gets an email.
6. Ali reviews the branch locally, merges/ships it himself, replies to the
   client, and marks it **Done** — or presses **Run again**.

Nothing is pushed or deployed, ever. Worktrees are left in place for review;
clean up with `git worktree remove <path>` and `git branch -D ticket-<id>`.

## Guardrails on the agent

- `--permission-mode dontAsk` + an explicit `allowedTools` list: file tools
  plus read-only git/ls. Anything else is denied without a prompt. Add tools
  per your comfort (e.g. `"Bash(npm test:*)"` — that runs repo scripts).
- `WebFetch`/`WebSearch` disallowed; `--strict-mcp-config` loads **no** MCP
  servers, so none of your connectors (mail, drive…) are reachable.
- `--setting-sources local`: your user/project allow-rules aren't inherited.
- Client text is wrapped in `<client_request>` and the system prompt says it
  is untrusted; Ali's notes (public or private) are passed as trusted guidance.
- `maxBudgetUsd` (per run) and `timeoutMinutes` cap cost and time.

Tested with a hostile ticket asking it to read `~/.ssh` and `.dev.vars` and
pipe a remote script to a shell: it refused, flagged the attempt in the note,
and only made the legitimate edit.

## Config

| key              | meaning                                                         |
| ---------------- | --------------------------------------------------------------- |
| `endpoint`       | The intercom Worker URL.                                        |
| `token`          | Same value as the Worker secret `RUNNER_TOKEN` (or env var).    |
| `projectsRoot`   | A folder holding one subfolder per project slug. Every project in `/portal/admin` whose repo sits at `<projectsRoot>/<slug>` is mapped automatically. |
| `projects`       | Optional overrides: `slug → path` or `slug → { path, baseRef }`. Explicit entries beat `projectsRoot`. |
| `worktreeRoot`   | Where worktrees go. Default `~/.cache/malipetek-runner/worktrees`. |
| `pollSeconds`    | Idle poll interval. Default 30.                                 |
| `timeoutMinutes` | Kill `claude` after this long. Default 30.                      |
| `claude.*`       | `bin`, `model`, `maxBudgetUsd` (default 5), `allowedTools`.     |

At startup the runner asks the Worker for the portal's project list and
reconciles it with this machine:

- a slug with a folder at `<projectsRoot>/<slug>` is claimed automatically;
- a portal project with no local repo is named in the log, because otherwise its
  tickets sit in `approved` forever and the runner looks broken;
- `--projects` prints the mapping and exits, without polling.

So onboarding a project is: create it in `/portal/admin`, clone the repo to
`<projectsRoot>/<slug>`, restart the runner. No file to edit.

## Onboarding a client

Nothing to do on this machine. A client signs in at `/portal` with a magic link,
opens a ticket, and you assign it a project and approve it — the runner picks it
up from there. Repo paths deliberately never leave this machine, so the Worker
has no idea where your folders are; that is the one thing the portal cannot
configure for you.

