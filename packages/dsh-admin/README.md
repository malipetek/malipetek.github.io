# Admin

The malipetek.dev portal, inside the Harness: the ticket queue with approve,
reply and private notes, plus the clients and projects that decide who may file
against what.

## What it is

A panel in the sidebar (**Admin**) and a page in the main slot, plus two agent
tools over the same operations.

- **Tickets** — filter by status, open one to read the thread, set a status,
  reply to the client, or leave a note the client never sees.
- **Clients & projects** — every registered address with the projects linked to
  it, and a form to create a project. A project slug is what the local runner
  maps to a folder on disk, so a ticket is only workable once its project exists
  and the runner knows the slug.
- **Tools** — `admin_tickets` (list, get, reply, note, set_status) and
  `admin_directory` (clients, projects, create_project, link, unlink), so an
  agent can triage the queue without the panel.

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
/admin project <name…> <slug>       create a project
/admin link <clientId> <projectId>
/admin unlink <clientId> <projectId>
```

## Endpoints it uses

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/tickets` | the queue |
| GET | `/admin/tickets/:id` | one ticket with its thread |
| PATCH | `/admin/tickets/:id` | status |
| POST | `/admin/tickets/:id/messages` | reply or private note |
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
