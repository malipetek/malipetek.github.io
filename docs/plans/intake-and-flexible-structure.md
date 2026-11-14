# Intake tickets, flexible projects/sites, and the connection fixes

Status: plan, ready to implement. Written 2026-11-01 after troubleshooting on
production data. Read `AGENTS.md` first (deploy rules, two Cloudflare
credentials, `pnpm --dir worker deploy` — not bare `wrangler deploy`, which
ships a stale `vite build`).

## 0. What is actually broken (findings)

### 0.1 Cloudflare connect: `redirect_uri` mismatch — config, not code
- The Worker sends `redirect_uri=https://malipetek.dev/api/portal/cloudflare/callback`
  (`worker/src/cfconnect.ts:49`, `callbackUrl = siteUrl + /api/portal/cloudflare/callback`).
- Probing `dash.cloudflare.com/oauth2/auth` with client
  `ec178fe1350572efdadc6a872ee2f817` shows the **only registered redirect** is
  `https://ptechsolutions-intercom.malipetek.workers.dev/portal/cloudflare/callback`
  (that one goes to the login page; the malipetek.dev one goes to `oauth/error`).
- Our side of the malipetek.dev callback works: `GET /api/portal/cloudflare/callback?error=access_denied`
  → 302 `/portal/?cloudflare=declined#/connections`.
- The full scope list (`account-settings.read memberships.read user-details.read
  workers-scripts.edit workers-routes.write zone.read dns.write`) is accepted.

**Fix (Ali, Cloudflare dashboard → the OAuth client → redirect URLs):** add
`https://malipetek.dev/api/portal/cloudflare/callback`. Keep the workers.dev one
until the new one is verified. No code change. Do **not** switch the code back
to workers.dev: clients' browsers have failed to resolve that host before (the
GitHub install callback for `mapetek` was lost that way).

While there: enable the refresh-token grant if offered (connections otherwise
expire after the first access token; `cfaccess.ts` already refreshes).

Verify after: rerun the probe —
```sh
r=$(python3 -c "import urllib.parse;print(urllib.parse.quote('https://malipetek.dev/api/portal/cloudflare/callback',safe=''))")
curl -s -o /dev/null -w "%{redirect_url}\n" "https://dash.cloudflare.com/oauth2/auth?response_type=code&client_id=ec178fe1350572efdadc6a872ee2f817&redirect_uri=$r&scope=user-details.read&state=probeprobeprobe1234"
# expect dash.cloudflare.com/login?login_challenge=…, not /oauth/error
```

### 0.2 "Tickets not taken due to repo issues" — the repo belongs to the wrong owner
Production data for `malipetek2@gmail.com`:
- One project, `ai-automation-for-my-business`, `repo = https://github.com/malipetek/ai-automation-for-my-business`
  — a repo in **Ali's** account, created by the old flow before client GitHub connections existed.
- `github_installation_id = NULL`, although the user **has** an installation
  (`177507997`, account `malipetek2`).
- `linkProjects` (`worker/src/github.ts:181`) only links a project whose repo URL
  starts with `github.com/<installation account>/`, so it can never link this one.
  It works today only because the node falls back to Ali's own git credential.
- Tickets: #10 declined, #18 in review. Nothing is queued right now, so the
  "stuck" tickets were the earlier ones on projects with no clonable repo.

General causes, all visible in code:
1. A project's repo owner is not tied to who connected GitHub — `repo` is free text.
2. The node's clone failure is the only signal; the portal shows "waiting for a node".
   (`8fc7f182` added `/node/projects/:slug/clone-failed` + `repo_error`; keep it.)
3. A ticket with no project can never be claimed
   (`worker/src/queue.ts:708`: "No project set — it cannot be claimed").
   Clients can file without a project (`portal.ts:1510`), so those wait forever.

### 0.3 Onboarding friction
`src/components/portal/Start.jsx` (504 lines) asks for project name, brief,
code location, site, first request before anything happens. Every decision is
up front, and wrong answers (repo owner, site slug = task title) are hard to undo.

### 0.4 Rigid relations
- Clients cannot move a ticket between projects (only admin:
  `PATCH /admin/tickets/:id { projectId }`, `portal.ts:1807`).
- Sites cannot move between projects at all.
- The portal's 3D board (`Board.jsx` → `initBoard` in `src/lib/workshop3d.ts`)
  shows tickets by status only; projects and sites are not on it.

## 1. Reset `malipetek2@gmail.com` (needs Ali's go-ahead before running)

Ali offered to wipe this account to retest onboarding. Run once, only after he
confirms. Removes portal data only — **not** the GitHub repo
`malipetek/ai-automation-for-my-business` (delete that on GitHub if wanted),
and **keeps** the user row, its GitHub installation and Cloudflare connection
so connecting does not have to be redone.

1. `GET /admin/…` export first (or `wrangler d1 export`) so it can be undone.
2. For each of the user's projects: `DELETE /admin/projects/:id` is refused
   while requests are open → decline open tickets first, then delete via the
   admin endpoint (it removes sites, deploys, R2 files and `user_projects`).
3. Then remove the remaining tickets of the user (cascades messages, runs,
   steps, files; delete their R2 attachments via the existing file helper):
   ```sql
   DELETE FROM tickets WHERE user_id = (SELECT id FROM users WHERE email = 'malipetek2@gmail.com');
   UPDATE users SET onboarded_at = NULL WHERE email = 'malipetek2@gmail.com'; -- if the column exists; check schema
   ```
4. Leftover worktrees/folders on nodes: `~/.cache/malipetek-runner/{projects,worktrees}/ai-automation-for-my-business*`
   on the MacBook and G500 — remove after the project is gone.

## 2. Intake ticket: start without a project, autonomous, handled by a portal agent

### Idea
A new client writes one sentence. That creates a ticket with **no project**
and `kind = 'intake'`. It runs **without Ali's approval**, because the agent
that works it can only touch the client's own portal records — never code,
never a node, never a deploy to live. Its job: set the account up (projects,
sites, repo, hosting), point the client to connections it needs, and file the
real work as normal tickets (which still need approval).

### Why a Worker-side agent, not a fleet node
Fleet runs need a repo folder; an intake ticket has none (that is the
`queue.ts:708` dead end). Portal management is API calls, not git. Run it in
the Worker as a Flue agent like `worker/src/agents/intercom.ts`
(DeepSeek `deepseek-v4-flash`, `DEEPSEEK_API_KEY`), one Durable Object per
intake ticket. Cost is tiny and it answers in seconds.

### Data
Migration `0028_intake.sql`:
- `tickets.kind` gains `'intake'` (it is a free TEXT column today; add a CHECK
  only if the table rebuild is cheap — otherwise validate in code).
- `tickets.site_id TEXT REFERENCES sites(id) ON DELETE SET NULL` — optional,
  lets a request target a specific site of a project (see §3).
- `ticket_actions` (audit of what the intake agent did):
  `id, ticket_id, action, args_json, result_json, created_at`.

### Flow
1. `POST /portal/tickets` with no `projectId` from a client with **no
   projects** (or with `intake: true`) → `kind = 'intake'`, `status = 'in_progress'`,
   `worked_by = 'portal_agent'` (extend the CHECK on `worked_by` via the
   migration, or reuse `client_agent` — pick one and document it).
2. The Worker starts the intake agent (`waitUntil`) with the ticket thread as
   input. Every client reply on an intake ticket wakes it again
   (`POST /portal/tickets/:id/messages` → hand to the agent instead of
   relaying to Ali's mail as the only action; still copy Ali).
3. The agent answers in the thread (`author = 'agent'`; reuse the existing
   author value used by runs, check `ticket_messages` constraints) and calls tools.
4. When it files the real work (`intake_file_request`), those tickets are
   ordinary `kind = 'client'` tickets with `status = 'new'` → Ali approves as today.
5. The intake ticket goes to `review` when the agent says setup is done; the
   client (or Ali) closes it. Ali sees intake tickets in Admin with the
   `ticket_actions` log rendered as the run card.

### The agent's tools (Worker functions, scoped to the ticket's `user_id`)
All call existing portal code paths — refactor the route handlers in
`portal.ts` into plain functions taking `(env, user, args)` so routes and
tools share them. No new authority beyond what the client could click.

| tool | does | existing code to reuse |
| --- | --- | --- |
| `intake_state` | client's projects, sites, repos, connections (GitHub installations, Cloudflare connection + expiry), open tickets | `/portal/me`, `/portal/github`, `/portal/cloudflare` handlers |
| `create_project` | name, brief, kind (`new`/`existing`) → project + `user_projects` | `POST /portal/projects` (`portal.ts:985`), minus its auto-ticket |
| `set_project_repo` | choose: create in the client's GitHub / use existing `owner/name` (must be visible to one of their installations) / none | `ensureRepo` (`ghapp.ts:110`), repo routes around `portal.ts:2416` |
| `add_site` / `remove_site` / `move_site` | sites under projects | `POST /portal/projects/:id/site` (`portal.ts:1192`), site delete |
| `set_site_host` | `ours` or `cloudflare` (only if connected and not expired) | `portal.ts:1255` |
| `move_request` | ticket → other project (and optional site) of the same client | new, see §3 |
| `file_request` | new client ticket on a project, `status = 'new'` | `POST /portal/tickets` |
| `link` | returns a portal deep link (see below) for the agent to put in its reply | — |

Hard limits (enforce in the tool layer, test each):
- Only the ticket owner's records. Every lookup joins `user_projects`.
- No approve, no publish/rollback, no deletion of a project that has history,
  no executor/priority changes, no admin fields.
- At most N tool calls per wake (e.g. 20) and M wakes per ticket per day.
- Every call → `ticket_actions` row + a short system line in the thread
  ("Created project *Bakery site*"), so the client sees what changed.

### Deep links the agent (and every other agent) may give
Add `portalLinks(env)` in `worker/src/shared.ts` returning absolute URLs:
- Connections: `https://malipetek.dev/portal/#/connections`
- GitHub connect: the signed install URL from `/portal/github` (`installUrl`) — never a bare app URL
- Cloudflare connect: the signed `/portal/cloudflare/connect` URL
- Project: `#/project/<id>`, ticket: `#/ticket/<id>`, requests: `#/requests`, billing: `#/billing`

Use the same helper in: the intake agent's prompt, the fleet prompt for client
work (`fleet/prompt.mjs`, so code agents can say "connect GitHub here" instead
of failing), the MCP client tools (`worker/src/clientTools.ts`), and the queue
explanation (`queue.ts` `explainEligibility`).

## 3. Flexible relations: tickets ↔ projects ↔ sites

Model stays: project 1—N sites, ticket N—0..1 project, ticket N—0..1 site
(new `site_id`, must belong to the ticket's project or be NULL).

Client endpoints (new, in `portal.ts`, each checks `user_projects`):
- `PATCH /portal/tickets/:id { projectId, siteId }` — move a request. Refuse
  while `in_progress` (a run holds a worktree of the old project); allowed for
  `new`, `approved`, `review`, `done`. On move: clear `land_requested_at`,
  post a system line "Moved from *A* to *B*". Approval is kept for `approved`
  only if Ali's setting allows (default: moving an approved ticket sends it
  back to `new` — the scope changed).
- `PATCH /portal/sites/:id { projectId }` — move a site to another of the
  client's projects. Re-evaluate `is_primary` on both sides (oldest remaining
  becomes primary, as delete does today in `fe3bc095`).
- MCP: `portal_move_request`, `portal_move_site` in `clientTools.ts` so a
  client's own assistant can do it too.

Queue/node: when a ticket has `site_id`, the build targets that site instead
of the project's primary (`/node/builds/:ticketId` and the run report's deploy
step). Today all sites of a project share one build — keep that; `site_id`
only chooses which address gets the preview pointer.

UI:
- Ticket page (`TicketView.jsx`): project/site shown as a chip with a
  **Move** button → modal with two selects. (Ali dislikes inline forms; use a modal.)
- Project page: sites list gets **Move to project…** per site.
- Admin ticket details: project select already exists; add the site select.

## 4. Dashboard: show the structure on the conveyor

Extend the portal board, don't replace it:
- **Lanes = projects.** `initBoard` gets `options.lanes: [{id, name, sites:[{id,name,url,live}]}]`
  and each item gets `lane` (project id or `null`). One belt per project,
  stacked front to back; the stations (new → shipped) stay as columns.
- **Unsorted hopper.** Project-less tickets (intake included) sit in a
  hopper at the start of the front belt, labelled "Getting set up".
- **Sites as outputs.** At the end of each belt, one small "shipping dock"
  per site with its address; shipped tickets slide into the dock of their
  `site_id` (or the primary). Clicking a dock opens the site.
- **Moving is visible.** When a ticket's lane changes between polls, animate
  it hopping belts (reduced-motion: just reposition).
- **Fallback.** The list under the board groups by project → site → ticket
  (same grouping as the ChatGPT card `board-v2`); that's also the
  no-WebGL/mobile view.
- Keep the camera framing working with 1–6 lanes; above 6, collapse the
  quiet projects (no open tickets) into one "Other projects" belt.

Files: `src/components/portal/Board.jsx`, `src/lib/workshop3d.ts`
(`initBoard`, `heroMachine` — add a lane parameter rather than a second
machine builder), `src/styles/client-portal.css`. Render it with a mocked
`/portal/me` before shipping (screenshot 1, 3 and 7 projects).

## 5. Onboarding, fool-proof

Replace the multi-step `Start.jsx` form with:
1. One question: "What do you need?" (textarea) + optional attachments.
2. Two optional buttons under it: **Connect GitHub**, **Connect Cloudflare**
   (signed URLs), each with one line on why. Skippable.
3. Submit → creates the intake ticket (§2) and opens it; the agent's first
   reply appears within seconds and asks only what it cannot infer.

The old form's knowledge moves into the agent prompt (what a project is,
`new` vs `existing`, default: repo in the client's GitHub if connected, else
our hosting with a repo created later; site address from the project name,
never from a ticket title).

Defaults the agent must apply (these are the "obvious" rules Ali asked for):
- GitHub connected → create or reuse the repo **in the client's account**
  (`set_project_repo`); never in `malipetek/…` for client work.
- A project whose repo a node **failed to clone** (`repo_error` set, no
  installation linked) → tell the client to connect GitHub with the deep link
  (the `unconnected` list on `/portal/github` — surface it in the agent's
  state). Never infer "unreadable" from who owns the repo or from a missing
  installation: public repos, `malipetek/…` repos and any repo a node's own
  credential reaches clone fine. Only a reported clone failure is evidence
  (commit 266bd878 removed an owner-name guess for exactly this reason).
- Cloudflare connected and not expired → offer hosting on their account;
  expired → give the reconnect link, host with us meanwhile.

## 6. Repo ownership fixes (independent of §2, do first)

1. `linkProjects` second pass: if a project's repo is not under any
   installation account, ask GitHub (installation token,
   `GET /repos/{owner}/{repo}`) whether one of the user's installations can
   see it (collaborator access, org repo). Link if yes.
2. Admin + client UI: show the repo's state explicitly — `no repo` /
   `in your GitHub (owner/name)` / `in malipetek's GitHub` / `not readable:
   connect GitHub` (only after a reported clone failure) / `create failed:
   <repo_error>` — with the one action that
   fixes each (create in my GitHub, connect GitHub, choose another repo).
3. "Move repo to the client" admin action for legacy projects like
   `ai-automation-for-my-business`: GitHub transfer API needs admin on both
   sides, so instead offer "create a fresh repo in the client's account and
   push the current default branch there" (a node job, like land: new
   `projects.repo_migrate_requested_at`, node pushes `origin/main` to the new
   remote, then the Worker swaps `repo` + `github_installation_id`).
4. Queue explanation (`queue.ts` `explainEligibility`): use `repo_error`
   and the ownership state, never "it clones on its next sync" once a clone
   has failed.

## 7. GitHub App settings (Ali, once)
Not re-checked here (the `malipetek2` installation registered itself, so the
Setup URL may already be right). Confirm in github.com/settings/apps/malipetek-dev:
- Setup URL: `https://malipetek.dev/api/auth/github/callback`
- Webhook URL: `https://malipetek.dev/api/hooks/github`
- For auto-create in §5/§6: Repository permission **Administration: write**
  (`ghapp.ts` already asks for it only on the create token).

Also add an admin **Reconcile installations** button: list
`GET /app/installations` with the app JWT, upsert `github_installations`,
and match unknown ones to users by the `state` cache or by GitHub login.

## 8. Order of work

1. §0.1 + §7 config (Ali) — unblocks Cloudflare and GitHub callbacks.
2. §6 repo ownership (smallest code, fixes stuck tickets for real).
3. §3 flexible relations (endpoints + modals), with tests.
4. §2 intake agent + tools + audit log, with tests.
5. §5 onboarding swap (depends on §2).
6. §4 board lanes (depends on §3's data).
7. §1 reset malipetek2 (after Ali confirms), then Ali runs onboarding end to end.

## 9. Tests (worker e2e, `worker/test/e2e.mjs`)
- Intake: a new client's project-less ticket becomes `intake`, is not
  claimable by nodes, never reaches `approved` on its own, and its agent's
  tools refuse another client's project, approve, publish and delete.
  Mock DeepSeek with a fixed tool-call script (the suite already fakes
  Cloudflare; add a fake chat-completions endpoint the same way).
- Move: client moves a `new` ticket between own projects (ok), into a foreign
  project (403/400), while `in_progress` (409); an `approved` ticket returns to `new`.
- Site move: primary flag stays consistent on both projects.
- Repo: project with a foreign-owner repo gets linked when an installation can
  read it; `explainEligibility` shows the clone error.
- Board data: `/portal/me` returns `lanes` grouped project → sites.

Run `node --test fleet/*.test.mjs` and `pnpm --dir worker test` before every
deploy; render portal changes in a browser before calling them done.

## 10. Acceptance (what Ali will try)
1. Fresh account → onboarding is one textbox → intake reply in seconds.
2. Agent creates the project with a sensible name, a site with a sensible
   address, a repo in the client's GitHub (if connected), and files the first
   real request, which shows up in Ali's "Needs you".
3. Client moves that request to another project from the ticket page; the
   board animates it to the other belt.
4. Cloudflare connect completes and returns to Connections with "connected".
5. No ticket sits in "waiting for a node" without a reason and a link that fixes it.
