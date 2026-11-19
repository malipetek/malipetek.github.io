# MCP request cards — design

Date: 2026-11-17
Status: proposed
Repo: `malipetek.github.io` (portal Worker and MCP server)

## Intent

Give a client one clear card for a request: what they asked for, where the work
is, and a simple picture of how it moves from a change branch to the live site.
The card teaches the git ideas — branch, preview, merge, deploy — in the
client’s own work, without showing a developer’s commit graph.

The existing portal board stays the account overview. This card is for one
request.

## Why

A list of statuses does not explain why a change is not live yet. A two-lane
story does: “your change” runs beside “the live site” and joins it only when the
work is merged or published. The client can see that a preview is safe, that
review is separate, and that publishing is the moment the change reaches
production.

## Goals

- One request card with two tabs: **Summary** and **Delivery**.
- Summary: status, project, cost and budget, branch and commit when known,
  preview and live links, and the next step in plain words.
- Delivery: a two-lane story graph built from real portal events. Real branch
  names and short commit IDs appear where the portal has them.
- A text fallback for hosts without MCP Apps.
- Client-scoped data only; no internal notes, admin costs, or other accounts.
- Inline HTML, CSS and JavaScript. No external fonts, scripts, images or
  network calls.

## Non-goals

- A true commit DAG (parents, merges, all history) in this version.
- Project-wide history across all requests. That is a later board view.
- The “technical details” toggle. It is the next step after the story graph,
  and it needs GitHub or repository access.
- Changing publishing, review, or approval rules.

## Constraints

- The Worker runs no git and holds no repository credentials. Available data is
  in D1: `tickets` timestamps and land fields, `ticket_runs` branch/commit/shared
  fields, and `site_deploys` commit and ticket fields.
- MCP Apps: each card is a `ui://` resource with `text/html;profile=mcp-app`;
  the tool points at it with `_meta.ui.resourceUri`; the host passes
  `structuredContent` through `ui/notifications/tool-result`.
- OpenAI UI submission requires `_meta.ui.domain` and a declared
  `_meta.ui.csp`. The existing board lacks both; add them to both resources.
- The existing board is a single hand-written HTML resource. Reuse its bridge
  and styling approach; do not add a bundler or framework.
- The card must work inline and fullscreen, at narrow and wide widths.

## Approaches considered

1. **Story graph from portal data.** Two lanes and event nodes. No repository
   access. Teaches branch, preview, merge and publish. Smallest, clearest.
2. **True commit graph from GitHub.** Real commits, parents and merge commits.
   Needs repository access, caching and error handling; a non-technical client
   reads it as noise.
3. **Hybrid.** Story graph now; a “technical details” toggle later that reveals
   real commit history. Chosen by the client.

## Design

### One card, two tabs

Use one tool and one resource rather than separate task and git cards. The
summary gives the context the graph needs; two tabs keep one request in one
place. If the graph later needs its own entry point, it can be split without
changing the data contract.

### Tool: `request_card`

- Read-only, client scope.
- Input: `request_id` (required), `view` (`summary` or `delivery`, optional;
  selects the initial tab).
- Description: “Show one request as a card: a plain-language summary and a
  delivery graph (branch, preview, review, merge or publish). Use when the
  client asks to see a request, where their change is, or whether it is merged
  or live.”
- `_meta.ui.resourceUri`: `ui://malipetek/request-v1.html`.
- `_meta['openai/ui']`: `availableDisplayModes: ['inline', 'fullscreen']`,
  `preferredDisplayMode: 'inline'`.
- `_meta['openai/toolInvocation/invoking']` and `.../invoked` strings.
- Do not attach UI to `portal_request`; ordinary reads stay text. Do not change
  `portal_board`.

### Resource: `ui://malipetek/request-v1.html`

- New `worker/src/requestUi.ts`, exporting the URI, MIME, HTML, the text
  summary and the pure event builder.
- `resources/list` returns the board and this resource.
- `resources/read` serves the HTML with:
  - `_meta.ui.prefersBorder: true`
  - `_meta.ui.csp: { connectDomains: [], resourceDomains: [] }`
  - `_meta.ui.domain: 'https://ptechsolutions.net'` (proposal; confirm at
    submission)
  - `_meta['openai/ui']` display modes and `widgetDescription`
- Add the same CSP/domain metadata to the existing board resource.

### Data endpoint

Add `GET /portal/tickets/:id/delivery` on the client portal, using the caller’s
session or client agent token. Ownership is the same as
`GET /portal/tickets/:id`. Response:

```json
{
  "request": {
    "id": 12,
    "title": "Add holiday hours",
    "status": "in_progress",
    "source": "assistant",
    "worked_by": "client_agent",
    "created_at": 0,
    "updated_at": 0,
    "build_requested_at": null,
    "published_at": null,
    "price_cents": null,
    "budget_cents": null
  },
  "project": { "id": "...", "name": "Demo Bakery Site" },
  "site": {
    "state": "ready",
    "live": false,
    "has_preview": true,
    "preview_url": "https://...",
    "production_url": "https://..."
  },
  "runs": [
    {
      "id": 1,
      "status": "ok",
      "branch": "malipetek/ticket-12",
      "commit_sha": "abc...",
      "shared_to": "origin",
      "shared_ref": "malipetek/ticket-12",
      "finished_at": 0
    }
  ],
  "deploys": [
    { "id": "...", "commit_sha": "abc...", "files": 12, "bytes": 1000, "created_at": 0 }
  ],
  "land": { "requested_at": null, "ref": null, "sha": null }
}
```

- `runs`: `ticketRuns` restricted to the fields above; no summaries or internal
  reports.
- `deploys`: `listDeploys` for the project, filtered to this ticket, newest
  first, at most 20.
- `site`: `siteView`/`siteState` for the request’s project and site.
- No review notes, admin costs, internal messages or other accounts.
- One or two queries plus the existing helpers; no migration.

### Event builder

A pure function maps the response to ordered events:

- `opened` — request `created_at`.
- `change_sent` — a run or deploy belonging to the request, when present.
- `preview_built` — the first deploy for the request, with its short commit.
- `review` — request status `review`; timestamp only when known.
- `landed` — `land.sha` or `land.ref`; use `updated_at` as the time.
- `published` — `published_at`.

Rules:

- Never invent an event. If a timestamp or branch is absent, omit the node and
  show a plain “not yet” state.
- Branch and commit are optional. Use `branch` from a run, `commit_sha` from a
  run or deploy. Show short IDs only.
- The two lanes are `Live site` and `Your change`. The lanes join at `landed` or
  `published`.
- A legend explains “branch — a separate copy”, “preview — a safe build”, and
  “merge / publish — joins the live site”.

### UI

**Summary tab**

- Title, status pill, project.
- “Next step” sentence from status.
- Cost so far and budget when present.
- Branch and commit when known.
- Preview and live links as buttons.
- A short “What this means” line: “Your change is separate from the live site.”

**Delivery tab**

- Two lanes with event nodes and dates.
- The merge/publish node is the only place the lanes join.
- Empty states: “No branch yet”, “No preview build yet”, “Not merged yet”.
- No external assets; use inline CSS and the board’s card styling conventions.
- Accessible: semantic headings, keyboard-reachable links, reduced-motion
  friendly, no color-only status.

### Text fallback

`requestCardSummary` returns a short plain-text version: request, status,
project, cost/budget, branch/commit, preview/live links, and the next step.
Register `request_card` in `UI_TOOLS` so the model gets the same facts.

## Security and privacy

- Use the client token/session path; never the admin routes.
- Return only fields the client already sees.
- Escape every value; insert data with `textContent`, never `innerHTML`.
- No network access from the card; CSP allowlists are empty.
- The resource is public HTML, but the data is per-request and only reaches the
  card through the authenticated tool result.

## Tests

- Unit: event builder for new, in progress, preview, review, landed, published,
  and missing branch/commit cases; summary text.
- E2E: `request_card` with a client token returns the UI resource URI,
  structured content and text; `resources/read` returns HTML with CSP/domain;
  another client cannot read the request; a missing request returns an error.
- Manual: inline and fullscreen in ChatGPT, narrow and wide, with and without a
  preview.

## Rollout

- Worker deploy only; no database migration and no site deploy.
- Add the missing CSP/domain metadata to the existing board in the same change.
- Reconnect the connector to pick up the new tool and resource.
- The technical-details toggle is a later change and needs a GitHub/repository
  data source.

## Open decisions

1. **Scope:** one request per card. Approved here unless corrected.
2. **Shape:** one card with two tabs, not two separate cards.
3. **Domain:** `https://ptechsolutions.net` for `_meta.ui.domain`; confirm
   against OpenAI’s submission requirements before upload.

## What is left to the builder

- Exact copy and visual treatment of the two tabs.
- Which statuses map to which “next step” sentence.
- Whether `view` is worth exposing or the card always opens on Summary.
- The later technical-details data source and toggle.
