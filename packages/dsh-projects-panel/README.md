# @malipetek/dsh-projects-panel

A DeepSeek Harness UI plugin that turns the projects folder into a browsable
panel inside the Harness Web UI.

- **Sidebar row + main page.** Registers one panel into `sidebar.panellist` (the
  nav icon) and the matching page into the root-scoped `main` keyed slot under
  the same id, `projects`.
- **Cards.** One card per directory in the projects folder, showing the name, its
  package description when it has one, the absolute path, and badges for git,
  staleness, liked, archived and open count.
- **Like and archive.** A star marks a favourite; archive hides a project from
  the normal views without touching the folder.
- **Filter views and sorting.** `All` / `Stale` / `Liked` / `Archived` chips, a
  search box over name, path and description, and sorting by last activity, name
  in either direction, or when you last opened it.
- **Switch between projects.** Opening a card adopts that directory as a
  Workspace and reveals it, so the Session continues in that project.

## Why there are two halves

The desktop composition mounts the **native** directory picker
(`dsh-host-directory-picker-auto` resolves to `native` on macOS). That backend
serves `pick()` — an OS chooser — and has **no `list` capability**, so
`ctx.uiWorkspace.listDirectory` fails with `directory-picker/unavailable`.
Directory listing through the browser is only possible against the `browse`
backend, which the shipped desktop composition does not mount.

Rather than swap the app's picker (which would replace the macOS folder chooser
with the in-app dialog app-wide), the Host half builds the list itself:

1. `index.js` scans the folder with Node, writes one JSON line per project to
   `/Users/malipetek/.dsh/projects-panel/index.jsonl`, and keeps it fresh from a
   folder watch plus a five-minute re-scan.
2. `client.js` reads that file through the existing session-scoped file Remote
   (`remote.workspaceFiles.read`) and renders it.

This also yields metadata the directory-picker listing never had — last activity,
git presence, and package description — which is what the `Stale` view needs.

## Configuration

Constants live at the top of each file and some are mirrored in both:

| Constant | File | Value |
| --- | --- | --- |
| `PROJECTS_ROOT` | both | `/Users/malipetek/Documents/Documents/Projects` |
| `INDEX_PATH` | `index.js` | `/Users/malipetek/.dsh/projects-panel/index.jsonl` |
| `INDEX_PATH` | `client.js` | same absolute literal — change both together |
| `RESCAN_INTERVAL_MS` | `index.js` | `300000` (5 min) |
| `STALE_DAYS` | `client.js` | `90` |
| `STORE_KEY` | `client.js` | `dsh.projects.panel.v1` |

`INDEX_PATH` is a literal rather than `DSH_HOME`-derived because the Client half
cannot read the Host environment. If `DSH_HOME` is not `~/.dsh`, change the
constant in **both** files.

Like, archive, and open history are browser-local (`localStorage`), so they are
per-browser and survive reloads. Nothing is written into the projects folder.

## Install

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add /Users/malipetek/Documents/deepseek-harness/default-workspace/dsh-projects-panel
```

Then select the Projects row in the sidebar. **Restart the app** after changing
either half: the profile watches configuration by default but has `root: []`, so
module changes are not watched and a fresh JavaScript generation needs a restart.

## Limitations

- The index is a snapshot refreshed by a watch and a timer, so a brand-new
  project appears within a few seconds and a project's *date* updates within five
  minutes.
- `lastActivity` is the newest of the project directory, `.git/index`, `.git/HEAD`
  and `package.json`. Editing a file in place moves none of those, so a long
  editing session inside a mature project can still read as stale.
- Reading the index needs an open Session to authorize the Remote call.
- Panel copy is plain English rather than routed through the Client locale
  service, so it does not switch language.
