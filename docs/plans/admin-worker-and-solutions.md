# Plan: the admin's machine as a worker, and solution kinds beyond websites

Status: audited and being built 2026-11-20.

## Audit 1: the admin's machine as a fleet worker

What exists:
- The Fleet view has a "This machine" card (Harness only) with Start, Stop and Restart.
  It shows the launchd state and the log tail.
- Node cards have Drain/Resume and an Edit modal (slots, agents, capabilities).

Gaps:
1. No onboarding. Nothing tells a new admin that this machine runs approved tickets with their own
   subscriptions: Claude Code (Claude plan, Opus), OpenCode Go (Flash), the DeepSeek API key and Devin (SWE-2).
   Nothing says that runs use CPU, battery, disk under `~/.cache/malipetek-runner` and network.
2. No consent record. The node runs once it is installed.
3. The status is only visible on the Fleet tab. Outside that tab you cannot see that the machine is working.
4. Opting out means "Stop", which kills the runs that are going. "Pause" (drain) is on another card.
   No per-subscription opt-out is visible: the executor override exists, but it is hidden in Edit.

Built:
- `packages/admin-ui/src/machine.jsx`:
  - `MachineStatusPill`: always visible in the app header. It shows taking work / pausing / paused / off /
    not set up, busy slots, and the subscriptions it lends. A click opens the panel.
  - `MachineOnboarding`: a first-run explainer with explicit opt-in and the choice of which subscriptions to lend.
  - `MachinePanel`: replaces ThisMachine. It has Pause (drain: running work finishes), Resume, Stop now,
    per-subscription toggles (`overrides.executors`) and the consent record.
- Host commands (`packages/dsh-admin`): `machine-consent get|set <json>` stores
  `~/.dsh-admin/machine-consent.json` `{ version, acceptedAt, declinedAt, lend: [executor ids] }`.

## Audit 2: solution kinds

Today everything is a website. The capability catalog knows xcode/android/docker, but projects have no
kind of work, and clients have no way to hand over the accounts that such work needs.

Catalog (`worker/src/solutions.ts`, mirrored in `packages/admin-ui/src/solutions.js`):

| id | label | fleet requires | integrations |
|---|---|---|---|
| web | Website | — | github?, cloudflare? |
| shopify | Shopify store / theme / app | — | shopify |
| mobile-ios | iOS app | os:macos, xcode | app-store-connect, github? |
| mobile-android | Android app | android | google-play, github? |
| mobile-cross | Cross-platform app (Expo / React Native / Flutter) | — | expo?, app-store-connect?, google-play? |
| app-release | App Store and Play submissions | os:macos | app-store-connect, google-play |
| server | Server or container for the client | docker | hetzner? / digitalocean? / fly? |
| aws | Manage the client's AWS | — | aws |
| gcp | Manage the client's Google Cloud | — | gcp |
| ai-workspace | Skills and MCP servers for the client's team | — | — |

Each integration names the project secrets it needs (stored in the existing `project_secrets`, encrypted),
the fields shown to the client and setup steps in plain language. It also has a `verify` check that runs
in the Worker (`worker/src/integrations.ts`).

### API contract

- Migration `0044_project_solutions.sql`: `ALTER TABLE projects ADD COLUMN solutions TEXT NOT NULL DEFAULT '[]'`.
- `GET /portal/admin/solutions` → `{ solutions: Solution[], integrations: Integration[] }`.
- `PUT /portal/admin/projects/:id/solutions` body `{ solutions: string[] }` → `{ ok, solutions }`.
- `GET /portal/admin/projects/:id/integrations` → `{ solutions, integrations: [{ id, label, required, connected,
  missing: string[], verifiedAt, verifyError }] }`.
- `POST /portal/admin/projects/:id/integrations/:integration/verify` → `{ ok, detail | error }`.
- Client side (project member): `GET /portal/projects/:id/integrations` (same shape, no values) and
  `PUT /portal/projects/:id/integrations/:integration` body `{ fields: { NAME: value } }`. Write-only: a client
  never reads a value back. Names must belong to that integration.
- A ticket on a project gets `requires` from the union of its solutions' fleet requirements when the ticket
  does not set its own.

Types:
```ts
type Field = { name: string; label: string; secret: boolean; multiline?: boolean; placeholder?: string; optional?: boolean };
type Integration = { id: string; label: string; vendor: string; fields: Field[]; steps: string[]; docs: string; scope: string };
type Solution = { id: string; label: string; summary: string; requires: string[]; integrations: { id: string; optional: boolean }[]; deliverables: string[]; questions: string[] };
```

## Local toolbox (skills and MCP servers on the admin's machine)

`packages/dsh-admin/local-toolbox.mjs` reads and edits:
- the Claude Code MCP servers (`~/.claude.json` `mcpServers`) and skills (`~/.claude/skills/*/SKILL.md`),
- the OpenCode MCP servers (`~/.config/opencode/opencode.json` `mcp`),
- the Harness plugins (`~/.dsh/plugins`).

Host command: `toolbox list` and `toolbox <add-mcp|remove-mcp|toggle-mcp> <json>`.
UI: `packages/admin-ui/src/toolbox.jsx`, in Settings → "This machine's tools". Every write keeps a `.bak` first.
