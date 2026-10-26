# @malipetek/dsh-file-editor

An editable workspace file tree for the DeepSeek Harness Web UI, in the right
Sidebar: browse the session workspace, open a file in a text editor, and create,
rename and delete entries — the file-explorer half of an IDE that the shipped
tree deliberately leaves out.

## What it adds

The shipped `workspace.files` page is a viewer. Its own documentation lists what
it does not do: "No search, artifact filter, drag-and-drop, rename, context menu,
or current-file highlight." This plugin is the same tree with the mutations and
an editor beside it:

- **Browse** — one level at a time, directories first, natural name order,
  dotfiles shown like any other entry, live updates from filesystem watches.
- **Edit** — click a file to open it in a monospace editor in the lower half of
  the panel. `⌘S`/`Ctrl+S` saves, Tab indents by two spaces, Revert restores what
  was loaded.
- **Create** — `＋` creates a file and opens it; the folder button creates a
  directory. Both land in the directory you last clicked, shown in the toolbar.
- **Rename and delete** — hover a row for its two actions. Deleting a folder
  needs an explicit confirmation, and deleting anything that contains the
  workspace root is refused outright.
- **Conflict safety** — a save carries the version the editor loaded. If an agent
  (or anything else) rewrote the file in the meantime, the save is refused and the
  panel offers **Overwrite** or **Reload from disk** instead of quietly winning.
  A file that changed while the buffer was clean reloads by itself.

It registers its **own** page type, so the shipped `Files` page and its `⌘P`
shortcut keep working. Open the new one from the Sidebar guide ("Files (edit)")
or with `⌘⇧E`/`Ctrl+Shift+E`.

## How it is built

Two halves, no build step, no runtime dependency on any Harness package.

**Host** (`index.js`) registers one command, `/editor`, and performs every
mutation. Writes go through `ctx.fs`, so the session's sandbox mode and the
version guard apply exactly as they do for the model's own `write` tool.
`ctx.fs` has no create-directory, rename or delete — its documentation lists that
as a seam limitation — so those three use `node:fs` and reproduce the same mode
fence first: `read-only` refuses, `workspace-write` requires every target to live
under the session workspace or a temporary root, `danger-full-access` does not
confine. Containment is checked against the real path of the deepest existing
ancestor, so a symlink cannot step outside between the check and the write.

The command sets `recordInput: false`. A command's input is normally replayed
from the session log, and this one carries whole files; duplicating them into
every resume is not acceptable, and the file on disk is the authoritative
artefact. The outcome line is still recorded.

**Client** (`client.js`) draws the panel. Reads never touch the command: listing,
`stat`, complete-file bytes and change watches all come from the shipped
`workspaceFiles` Remote, which is already live and already bounded. Only
mutations are commands — a mutation is the thing the Host has to authorize, and a
command is the one Client-callable Host entry point a third-party bundle may add.

State is plain React state and the page type sets `keepMounted: true`, so
switching Sidebar tabs keeps the open file, the expanded tree and an unsaved
edit. That is why there is no slot store and no `@deepseek-ai/dsh-client-store`
import.

### Wire format

`/editor {"op":…}` — the payload is one JSON object. The Client parses the
`CODE: message` prefix of a failed result.

| `op` | Fields | Meaning |
|---|---|---|
| `write` | `path`, `content`, `version?`, `force?` | Create (`version` omitted) or save (`version` = the loaded version). `force` overwrites unconditionally. |
| `mkdir` | `path` | Create a directory, creating missing parents. |
| `rename` | `from`, `to` | Move one entry; the destination must not exist. |
| `delete` | `path`, `recursive?` | Remove a file, or a folder with `recursive: true`. |

Codes the Client branches on: `STALE`, `EXISTS`, `DENIED`, `NOT_FOUND`,
`TOO_LARGE`, `NOT_FILE`, `NOT_EMPTY`, `NO_WORKSPACE`, `BAD_REQUEST`.

## Configuration

None. The workspace and the sandbox mode come from the session, and the panel
reads the root from the sessions store.

## Files it writes

`$DSH_HOME/file-editor/host.json` records the version, process and load time the
Host actually activated — the same "which build is running" record
`dsh-action-cards` keeps. Override the directory with `DSH_FILE_EDITOR_DIR`.

## Known limitations

- **One editor buffer per tab.** There is no tab strip of open files.
- **A save carries the whole file.** The Client-to-Host channel is a command
  line, so a single save is capped at 4 MiB; larger files refuse rather than
  truncate. Very large files also cannot be opened, because the shipped
  `workspaceFiles` Remote caps a complete read at 32 MiB.
- **Binary files are refused.** Content that is not valid UTF-8 is reported as
  binary instead of being decoded with replacement characters, which would
  corrupt it on the next save.
- **One root.** The tree is rooted at the session's working directory. The
  shipped directory listing is workspace-scoped, so it cannot browse above it.
- **No search, no multi-select, no drag-and-drop.** Each is its own project.

## Verification

Verified against a throwaway `dsh web` profile carrying this bundle:
the Host row activated (`$DSH_HOME/file-editor/host.json`), the Client bundle
was served in the composed module group, the page opened from the Sidebar guide
with no console error, and a file was created, edited, saved, renamed and deleted
through the panel with the bytes checked on disk.

## License

MIT
