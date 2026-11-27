# PTech product rules

Read this before building anything in the portal, the Worker, the fleet, the
admin UI or the PTech Admin desktop plugin. These rules exist because quick
fixes kept adding parallel paths (manual keys next to OAuth, a credential
dropdown next to ownership, Cloudflare hard-coded where any host belongs).
A change that breaks a rule is not done, even if its tests pass.

## 1. Extend what exists; never add a parallel path

- Before writing a component, endpoint, tool action or table, find the one
  that already does the job and extend it. If two exist, the change that
  touches them merges them.
- A fix states which path it replaces. If it only adds one, it is a patch,
  and it needs a reason written in the change.
- Remove the old path in the same change, or record it in the backlog
  (section 7) with what removes it.

## 2. Ownership decides credentials

- A project has one owner (`projects.owner_user_id`). Clients attached
  through `user_projects` can read the project; they do not lend credentials
  to it.
- Credentials a project uses (repo access, hosting, deploy) come only from
  the owner's connections. No UI, endpoint or agent action lets anyone attach
  another user's credential to a project. No fallback that picks "some grant
  that covers the account".
- A project with no owner cannot use client credentials until an owner is set.

## 3. Integrations are OAuth; nobody pastes keys for them

- GitHub is the GitHub App installation. Cloudflare is the "Ptech Solutions"
  OAuth client. Neither is ever a pasted token or a typed repo name.
- Vendors without OAuth (Shopify, App Store Connect, Google Play, Expo, cloud
  providers) may use stored secrets, owner-only, through the one integrations
  catalog.

## 4. Deployment is provider-agnostic

- A deploy target is `{provider, resource, productionBranch}`. Cloudflare
  Pages and Workers are providers; ours (ptechsolutions.dev) and others are
  too. Provider-specific code lives behind the provider, not in routes,
  prompts or UI copy.
- One rule for every provider: ticket work deploys to a preview from the
  ticket branch; only the production branch goes live, and only on publish.

## 5. The superagent is a second interface to the same app

- Every user-facing method the app offers exists as a superagent action,
  calling the same endpoint, with the same defaults, behind the approval gate.
  A UI action without a superagent action is a gap, not a choice.
- New capabilities are built once (endpoint), then exposed twice (UI and
  superagent action) in the same change.
- Enforced by the parity check in `packages/dsh-admin` (known gaps live in its
  baseline; a new gap fails the tests).

## 6. UI: reuse the primitives

- The admin UI's primitives are in `packages/admin-ui/src/ui.jsx` and
  `packages/admin-ui/src/ui/`: Button, Field, Segmented, Chips, Modal,
  Confirm, Menu/OverflowMenu/useContextMenu, Toast, PageHeader, Panel,
  EmptyState, Skeleton, DataTable, Inspector, FilterBar, SaveBar,
  StateIndicator, ProjectPicker. Use them; do not re-create them in a feature
  file, the portal or the desktop plugin.
- A native `<select>` is only for a small fixed set of options (statuses,
  languages, agents). A list that grows (projects, clients, sites, runs,
  contacts) uses a searchable picker. A credential or account is never picked
  at all; it follows from ownership.
- Every confirmation is the in-page `Confirm`. Never `window.confirm`,
  `alert` or `prompt` (Electron can answer them without showing anything).
- Enforced by `pnpm ui:check` in ptechsolutions-site (`scripts/ui-conformance.mjs`,
  gates A1-A9; A8 flags growing lists in a native select, A9 native dialogs;
  known cases live in its baseline, which only shrinks).

## 7. Backlog of known violations

Each item names what removes it. Work on an area removes its items; nothing
new is added to this list without the product manager's agreement.

- Existing projects with clients but no owner (today: demo-bakery, three
  clients) cannot use client credentials. Every creation path now sets an
  owner and the project page has Make owner. Removed by: an admin choosing
  the owner on each such project (rule 2).
- Portal integrations catalog asks for a Cloudflare API token and a GitHub
  repo name (`solutions.js` catalog, `Connections.jsx`); `kind='token'`
  Cloudflare grants still read. Removed by: OAuth only (rule 3).
- `CLOUDFLARE_*` project secrets as a deploy fallback (`worker/src/node.ts`,
  hosting read). Removed by: OAuth only (rule 3).
- Deploy code and route names hard-code Cloudflare (`hosting.ts`,
  `fleet/prompt.mjs` deploySection, `node.ts` env names); sites mirror and
  fleet deploys are two deploy systems. Removed by: provider registry (rule 4).
- Superagent gaps: marketing and SEO desks, land on main, publish/rebuild/
  rollback site, repo setup, invites resend/revoke, memberships, client
  settings, no-reply-needed, attachments, creating a ticket on a project (no
  endpoint exists for admins). The exact list is
  `packages/dsh-admin/superagent-parity.baseline.json`. Removed by: parity
  work (rule 5).
- Two admin-ui sources: the plugin bundles `packages/admin-ui` in this repo
  while ptechsolutions-site holds the source of truth (rule 1).
- UI duplicates: `UiButton`, `MoreMenu`, `SplitPane`/`SeoSplit`, the plugin's
  `PtaButton`/`StatusPill`/`EmptyState`/toasts, portal `cp-*` copies of
  Field/Segmented/EmptyState/Toast; the growing-list `<select>`s tolerated in
  the UI gate baseline. Removed by: rule 6.
