# Admin

The management portal for malipetek.dev, inside the Harness: the ticket queue
with approve, reply and private notes; the work queue and the fleet of machines
that run agents on it; Ali's own system tasks; and the clients and projects
that decide who may file against what.

## What it is

A panel in the sidebar (**Admin**) and a page in the main slot, plus two agent
tools over the same operations.

The page is the shared admin workbench, `packages/admin-ui`: the same React app
that `malipetek.dev/portal/admin` serves. Like an editor, it has an activity
bar, a project explorer, tabs, a status bar and a ⌘K palette. Like a task
tracker, it has **Needs you**, a drag-and-drop **Board**, a sortable **All work**
list, and ticket pages with the thread, the agent's runs, a composer for client
replies or private notes (with **Add note and run again**), and a details pane.
Here every portal call is an `/admin api <METHOD> <path> [json]` line run by
the Host half, which holds the token. The panel sends those lines to a loopback
HTTP bridge the Host opens (found once with `/admin bridge`), not as Harness
commands: the Harness logs every command and its full result into the session,
and the workbench polls, so one session grew to 10,000 commands and 430 MB.
If the bridge is unreachable the panel falls back to commands; the Harness build adds *This machine* to Fleet
and the token field to Settings.

`client.js` is generated: edit `src/client.jsx` or `packages/admin-ui`, then run
`node packages/dsh-admin/build.mjs`.

The sections below describe the previous panel (kept in `client.js.bak-workbench-2026-10-23`).

Four tabs under a **health strip** that is always visible: every node with a
green / orange / red dot, the queue with how many items are stuck, what is
running, and how many tickets wait for approval or review. A node in the strip
opens its details.

Anything that creates or edits more than one value opens a modal, and choices
from a known set — capabilities, agents, priority, alert times — are chips and
segmented buttons, never typed. Anything that emails a client or stops work asks
first.

- **Tickets** — search and filter, open one to read the thread, approve or
  decline, and reply or leave a private note from one composer. Routing
  (priority, needs, agent) shows on the ticket with an **Edit routing** modal.
- **Fleet** — the control room.
  - *This machine*: the local node (`fleet/node.mjs`) as launchd sees it and as
    it reports itself, with Start / Stop / Restart (or Install) and its log.
  - *Nodes*: every machine the queue knows — online or since when offline, busy
    slots, executors, capabilities, projects — with Drain and Forget.
  - *Queue*: every approved item in claim order with the node that will take it,
    or the reason none can (no folder, node offline, missing capability). Below
    it, a form to file a **system task**: title, project, brief, priority,
    required capabilities, executor. Filing approves it.
  - *Running* runs with a Cancel button, and *recent* runs with node, executor,
    model, cost and duration. A row opens its ticket.
- **Ticket routing** — on any ticket: priority, required capabilities, and the
  pinned executor (client tickets are always `claude`).
- **Clients & projects** — every registered address with the projects linked to
  it, and a form to create a project. Each project row shows the folder its slug
  resolves to and a field to point it elsewhere; that mapping is written into the
  local runner config, the same one the runner reads when a ticket is claimed. A
  ticket is only workable once its project exists and the runner knows where it
  lives.
- **Tools** — `admin_tickets` (list, get, reply, note, set_status),
  `admin_directory` (clients, projects, create_project, set_folder, link,
  unlink), `admin_work` (claim, report, fleet — for doing a ticket inside the
  Harness), and `admin_fleet` (queue, nodes, local, file_task, route, cancel,
  drain, undrain, node_control), so an agent can run the whole system without
  the panel.

## Signing in

The panel needs a **portal session token**, not your Harness login.

1. Sign in at <https://malipetek.dev/portal> with a magic link.
2. In that page's browser console: `localStorage.getItem('portal-session')`.
3. Paste the value into the panel's sign-in box.

It is stored Host-side at `~/.dsh/admin/config.json` (mode 600) and never
reaches the browser page. Sessions last 30 days; when one expires the panel says
so instead of showing stale data.

## How it works

- The **Host half** (`index.js`) holds the token and calls the Worker with
  Node's `fetch`. No CORS allow-list has to grow to include the Harness origin,
  and the token stays out of the page.
- **Reads** go through `~/.dsh/admin/state.json`, a snapshot the Host refreshes
  every minute and on demand, which the Client reads over the session-scoped
  file Remote. Opening a ticket writes `~/.dsh/admin/open-ticket.json`, because
  a thread is only worth fetching when someone looks at it.
- **Writes** travel as `/admin …` commands through `remote.commands.execute`, so
  a button press spends no model turn and never enters the conversation. The
  agent's tools call the same functions — there is no second implementation.
- **Sessions** — a global panel gets no Session of its own, so the Client half
  borrows one for every Host call: the Session the main view retains first (the
  one you are looking at), then the rest of the list newest first, up to four.
  A candidate another process owns answers `session/writer-held`, which is a
  reason to ask the next one rather than to give up — the Harness's own ACP
  host keeps a blank Session in the list that way.

## Command surface

```
/admin                              status and help
/admin refresh                      fetch tickets, clients and projects now
/admin open <id>                    load one ticket and its thread for the panel
/admin login <token>                store the portal session token
/admin endpoint <url>               point at another portal Worker
/admin logout                       forget the token
/admin status <id> <status>         set a ticket status
/admin reply <id> <text>            reply to the client (emails them)
/admin note <id> <text>             internal note
/admin attach <id> {"paths":["~/Desktop/spec.pdf"],"text":"…","internal":false}
                                    post local files (a private note unless internal is false)
/admin download /admin/tickets/<id>/files/<fileId>
                                    save an attachment to ~/Downloads (the panel's file chips use this)
/admin session <runId> <sessionId> <sessionDir>
                                    make a dsh run's Harness conversation openable here: found under
                                    ~/.dsh/sessions/*/<sessionId>/ (or $DSH_HOME), else the log its node
                                    uploaded is downloaded to ~/.dsh/sessions/<sessionDir>/<sessionId>/
                                    (never over an existing file). Answers {"sessionId","path","imported"};
                                    the run card's "Open conversation" uses it, then opens the session
/admin project <name…> <slug>       create a project
/admin folder <slug> <path>         point a project at a local folder (`-` clears)
/admin link <clientId> <projectId>
/admin unlink <clientId> <projectId>
/admin task {"title","brief","slug",…}  file a system task (approved)
/admin route <id> {"priority"?,"requires"?,"executor"?}
/admin cancel <runId>               stop a run; its item goes to review
/admin drain <node> | undrain <node> | forget <node>
/admin node start|stop|restart|install   this machine's node (launchd)
/admin nodeset <node> {"slots"?,"capabilities"?,"executors"?,"alertOfflineMinutes"?}
/admin settings {"stallMinutes"?,"maxAttempts"?,"notifyRunFinished"?,"defaultPriority"?}
/admin local {"nodeId"?,"slots"?,"timeoutMinutes"?,"maxBudgetUsd"?,"claudeModel"?,…}
/admin projectlocal <slug> {"path"?,"verify"?,"baseRef"?}
```

- **Settings** — the queue settings every node shares (stuck-work alert, give-up
  count, run-finished email, default priority), this machine's node config
  (name, parallel runs, capabilities, agents, timeout, Claude budget and model,
  folders), and the portal connection. Per-project folder, verify command and
  base branch are in Directory → the project.

## Endpoints it uses

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/tickets` | the queue |
| GET | `/admin/tickets/:id` | one ticket with its thread |
| PATCH | `/admin/tickets/:id` | status |
| POST | `/admin/tickets/:id/messages` | reply or private note |
| GET | `/admin/runs` | running and recent runs |
| POST | `/admin/runs/:id/cancel` | stop a run |
| GET | `/admin/runs/:id/session` | a dsh run's uploaded session log (zstd), for `/admin session` |
| GET | `/admin/nodes` | every node, online state, running runs |
| PATCH / DELETE | `/admin/nodes/:id` | drain / forget a node |
| GET | `/admin/queue` | approved items with who takes them, or why nobody can |
| POST | `/admin/work` | file a system task |
| GET / PATCH | `/admin/settings` | queue settings, plus the capability and agent catalogs |
| GET | `/admin/clients` | clients and their project links |
| GET | `/admin/projects` | projects |
| POST | `/admin/projects` | create a project |
| PUT/DELETE | `/admin/clients/:userId/projects/:projectId` | link or unlink |

## Limits worth knowing

- The snapshot is polled every 15 seconds while the panel is open; there is no
  push stream yet, so a change made elsewhere appears within that window.
- Status changes and public replies email the client. That is the portal's
  behaviour, not the panel's.
- The panel shows the Worker's own status labels, so it cannot drift from what
  the portal accepts.
- Project folders belong to the local runner, not the portal: the panel edits the
  `projects` entry in `~/.config/malipetek-runner/config.json` and leaves
  `projectsRoot` and everything else alone. Clearing a slug falls back to
  `<projectsRoot>/<slug>`.
