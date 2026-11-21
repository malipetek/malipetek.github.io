# @malipetek/dsh-action-cards

The agent stops telling you to create a file by hand. It **proposes** the action,
you fill in the values it left blank, and one click applies it.

Asking a model for a snippet you then have to paste, edit and save is the worst
part of working with an agent. You asked for a config file; it answered with a
code block containing `YOUR_API_KEY`; now you are in a text editor. Action cards
close that gap: the proposal arrives as a form **in the Actions panel**, with an
input for every value the agent could not know, a preview of the exact bytes, and
an Apply button. The Host performs the action under the same file sandbox and
confinement the built-in tools use, then tells the agent what actually happened.

## What the agent can propose

| Step kind | What it does | Editing it |
| --- | --- | --- |
| `write_file` | Creates or replaces a text file. Parent directories are created. | The path and the whole body. |
| `edit_file` | Replaces one exact piece of text in an existing file, so a value can change without rewriting the file. | The search text, the replacement, and whether every occurrence is replaced. |
| `run_command` | Runs one shell command in the session workspace, sandboxed, with a two-minute deadline and capped output. | The command line and the working directory. |

Any step may declare `fields`. Each field becomes an input in the Actions panel,
and `{{name}}` anywhere in that step's path, content, search, replacement, command
or working directory is replaced with what you type. A `secret: true` field
renders as a password box. This is the "replace a value in the snippet" case: the
agent writes the file it means, leaves `{{KOOFR_TOKEN}}` where your token goes,
and you supply it in the panel instead of in an editor.

## What the agent has

Two tools. `propose_action` puts a proposal in front of you. `return_action` lets
the agent send one back — after you have answered **You do it** — with the reason
it cannot carry the job out, and optionally what it would need from you. It exists
so that "I can't, and here is why" is a thing the agent can say, rather than
something it has to smuggle into prose where nothing can act on it.

The agent is told to reach for it only when it genuinely cannot proceed, and not
merely because the work is tedious: that is what the original proposal was for.

## Three surfaces, one proposal

- **A review popup over the composer** (`conversation.input.overlay`, the anchor
  the slash menu and the command popup already use). It appears only while
  something is waiting on you: one line saying how many, what the first one is,
  and **Review**. Review opens the same editable form the panel uses, in place, so
  the answer is given where the notice was — and it offers the link out to the
  panel for everything the popup does not list. It can be hidden for the current
  count only: a notice you can never get back is one you stop using, and a new
  proposal brings it back.
- **The Actions panel**, a page in the right Sidebar
  (`ctx.sidebarRightTabs.register` + the `sidebar.right.pane.tab` seat), holds the
  editable form too and lists every proposal with `Waiting` / `Applied` / `Failed` /
  `Handed back` / `Dismissed` filters — including the settled ones the popup stops
  showing.

  Each proposal there is a card, because it is an artifact rather than a turn, but
  the exchange beneath it is a thread: the agent's reason and your answer are
  bubbles, and the reply box is a composer whose send button **is** `You do it`.
  Apply is a chip beside it, because doing the work here and asking the agent to
  are different intents.

  The panel re-reads the store every couple of seconds while it is open, so an
  action taken here — and an agent answering a hand-back with `return_action` —
  appears without pressing Refresh. Acting also pins that card into view: the
  default view is `Waiting`, so otherwise a card would vanish the instant it was
  answered, taking its own outcome with it. Changing the view releases the pins.
- **A one-line row** in the transcript, keyed into `tool.call.toolview` under the
  `propose_action` wire tool name. It says what was proposed and offers the way
  in — deliberately not a form. See below.

The popup sits over the composer rather than in the composer's `dock` row beside
the stats pills. The dock row is reachable, but a message about an action reads as
part of the composer, and in the dock row it read as a chip off to one side; the
overlay anchor is the one plugin seat that draws directly above the input without
this plugin guessing at an offset. Its slot `order` is negative, so the slash menu
and the command popup paint over it — while one of those is open, it is the thing
being read.

### Three ways to answer

| Button | What it does |
| --- | --- |
| **Apply** | The Host performs the action, under the session's sandbox, and tells the agent the outcome. |
| **You do it** | Declines the work and hands it back: the agent is told to carry it out itself, and nothing is executed here. |
| **Dismiss** | Retires the proposal without telling anyone. |

And the agent has an answer of its own. If it genuinely cannot do the job — the
token is in an account it cannot read, the decision is yours — it calls
`return_action` with a reason, and the panel shows that reason with a field for
**how it should proceed**. Until you answer, **You do it** is refused: without
that the exchange is two parties restating their positions. Apply and Dismiss
stay available throughout, and a returned action counts as waiting, on the notice
and in the panel alike.

**You do it** exists because the agent sometimes proposes work it could have done
itself, and proposing it is a way of handing over the responsibility. The message
it sends names the steps but **not** the field values: those are masked in the
panel so a token does not travel through the conversation, and forwarding them
here would spend that for nothing.

## Why the transcript keeps only a row

If you watch something appear while the agent is working and vanish the moment it
stops, that is the transcript's design, not a fault. `dsh-client-ui-chat` selects a
presentation policy from the persisted transcript mode:

```js
detailed: { foldCompletedTurns: true, stepGrouping: "history", … }
compact:  { foldCompletedTurns: true, stepGrouping: "collapsed", … }
standard: { foldCompletedTurns: true, stepGrouping: "collapsed", … }

const grouped = policy.stepGrouping === "collapsed"
  || (policy.stepGrouping === "history" && turnLocation?.status !== "open");
```

Every mode folds a completed turn (`foldCompletedTurns: true`), and a tool call is
a **step** — so it folds with the turn, exactly like the `bash` and `read` rows
beside it. There is no transcript mode in which a settled turn keeps its steps
expanded.

**An earlier version put the editable form here.** It looked better in a
screenshot and was worse in the hand: the form appeared while the agent worked,
then folded away the instant it stopped — frequently mid-edit. A control that
disappears while you are using it is worse than one that was never offered, so the
form moved to the panel and the transcript kept a line that has nothing to lose by
folding.

`conversation.chat.turnTail` is the one seat that would survive the fold — it is a
separate node kind, and the chat's own `lastContent` lookup skips `turn-tail` and
`turn-process` alike. It was not used because it receives `{ turn, seq, openFile }`
and not the tool call, so matching a proposal to its turn needs a mapping nothing
in the API provides. Worth revisiting if the inline form is ever wanted back.

## Why the Host does the work

The panel never touches the filesystem. Applying sends your edited values and the
steps to the Host through `ctx.remote.commands.execute`, which runs
`/actions apply …` — no model turn, and nothing added to the transcript. On this
side the two halves share exactly one file, `actions.json`; the tool result carries the
proposal itself, so a missing or pruned store degrades the history but never
blocks an apply.

A third-party plugin cannot register a Remote namespace of its own, which is why
the Client drives a Cordis command rather than a bespoke RPC. This is the same
route `dsh-projects-manager` uses for `/projects`.

## What the Host checks before you commit

When the proposal arrives, the Host looks at each target and records what it
found, so the panel can warn you **before** you spend an apply finding out:

- a `write_file` whose target already exists says *overwrites an existing file*;
- an `edit_file` says *the text to replace occurs 3 times*, or *is not in the
  file*, instead of failing later with `FS_AMBIGUOUS_EDIT` or `FS_EDIT_NOT_FOUND`;
- a check that cannot be made — because the path or the search text is itself a
  `{{placeholder}}` — is deferred rather than reported as a misleading zero.

The same findings go back to the agent in the tool result, so it learns its own
proposal would clobber a file.

## Execution, honestly

- **Writes go through `ctx.fs` with the session's resolved `sandboxPolicy`.**
  Never `node:fs`. A write outside the workspace fails closed with
  `FS_SANDBOX_DENIED`, and the panel shows the reason. Commands go through
  `ctx.shell` with the Seatbelt confinement the `bash` tool uses.
- **A `write_file` overwrites without the read-before-write guard.** That guard
  exists to stop an *agent* clobbering a file it never read; on this path the panel
  is the guard, because a human looked at the path and the content and pressed
  Apply. The pre-flight check is what told them it would overwrite.
- **Execution stops at the first failure.** The step after a failed write usually
  depends on it, so a second, confusing failure is not useful. The panel and the
  agent both get the step that broke and why.
- **Applying wakes the agent with the outcome.** You asked for the Host to report
  back, so it does: the agent learns what really happened rather than assuming its
  proposal was followed. This costs one model turn per apply. Set
  `REPORT_TO_AGENT = false` in `index.js` to make applies silent.
- **Nothing is applied until you press the button.** The tool result says so in as
  many words, because a model that believes its own proposal already happened is
  worse than no proposal at all.

## Configuration

| Constant | File | Value |
| --- | --- | --- |
| `STATE_DIR` | `index.js` | `$DSH_HOME/action-cards` (`DSH_HOME`, else `~/.dsh`) |
| `STORE_PATH` | `index.js` | `$STATE_DIR/actions.json` |
| `DEFAULT_STORE_PATH` | `client.js` | `/Users/malipetek/.dsh/action-cards/actions.json` |
| `MAX_STEPS` | both | `8` |
| `MAX_FIELDS` | both | `24` |
| `MAX_FIELD_CHARS` | both | `20000` |
| `MAX_ITEMS` | `index.js` | `200` records before decided ones are pruned |
| `DEFAULT_COMMAND_TIMEOUT_MS` | `index.js` | `120000` |
| `MAX_REPORT_CHARS` | `index.js` | `1200` |
| `REPORT_TO_AGENT` | `index.js` | `true` |
| `TAB_KIND` / `TAB_ID` | `client.js` | `action-cards` / `@malipetek/dsh-action-cards/actions` |
| `TOKEN` | both | `/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g` |

The Client half cannot read the Host environment, so `DEFAULT_STORE_PATH` is an
absolute literal. It is only a fallback: the resolved path travels to the row in
the tool result's metadata, and the row prefers it. If `DSH_HOME` is not
`~/.dsh`, the conversation row still works and the Sidebar panel reads the
literal — change `DEFAULT_STORE_PATH` to match. `DSH_ACTION_CARDS_DIR` overrides
`STATE_DIR` for smoke tests only; the running app never sets it.

## Install

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add ~/Documents/Documents/Projects/malipetek.github.io/packages/dsh-action-cards
```

Then enable the `@malipetek/dsh-action-cards` bundle in Settings → Plugins and
**restart the app**. The profile watches configuration by default but has
`root: []`, so a changed module needs a fresh JavaScript generation.

### One canonical copy

**This directory is the one the app installs and the one that gets published**, so
it is the only copy that matters — edit it here.

A second copy exists inside the agent workspace at
`~/Documents/deepseek-harness/default-workspace/dsh-action-cards`, kept
byte-identical by [`dev-sync.sh`](dev-sync.sh):

```sh
./dev-sync.sh            # mirror this copy into the workspace
./dev-sync.sh --check    # report drift, exit non-zero, change nothing
```

That mirror is not decoration. The `desktop` profile was once repointed from the
workspace copy to this one, and every later fix landed in the workspace copy
instead: the app kept loading a snapshot from hours earlier, and the symptom —
a change that is definitely saved and definitely not taking effect — is
indistinguishable from caching. `--check` is how to rule that out, and
`dev-preflight.mjs` is what to run before trusting any change.

It is already installed in the `desktop` profile as a `link:` dependency, with the
bundle appended to `dsh.profile.bundles` — so only a restart is outstanding. A
`dsh --profile <name> --dump-config` against a copy of the profile confirms the
composition, because the CLI refuses to touch the `desktop` profile while the
Electron app is running.

## Try it

Ask for something with a value only you have:

> Create `config/uploader.json` with my Koofr email and an app token I'll paste
> in, and then dry-run the uploader.

The agent should call `propose_action`. A one-line row appears in the conversation,
and the review popup appears directly above the chat input reading *1 action is
waiting for you* — press **Review** for the form: two inputs, one of them masked,
and Apply / You do it / Dismiss.

The model is told to reach for this tool whenever a step has to happen in your
environment, so it does not need asking twice; if it answers with a code block
anyway, say *propose that as an action*. If it proposes something it could have
done itself, **You do it** sends the job back.

The command surface, if you want it from the keyboard:

```
/actions list              every proposal and its status
/actions apply <id> {json} apply one proposal with the user's values
/actions delegate <id> {json}  hand the work back, with an optional note saying how
/actions dismiss <id>      mark one proposal dismissed
/actions prune             drop every decided proposal
```

## Development

None of it needs the app to test:

```sh
node dev-preflight.mjs      # packaging + tool schemas: the rules the DSH loaders and registry enforce
node dev-smoke.mjs          # host: proposal, substitution, write, edit, command, failures
node dev-client-smoke.mjs   # client: registrations, the row, the panel, the notice
./dev-react/setup.sh && node dev-react/render.mjs   # client, under real React in a real DOM
./dev-integration/setup.sh && ./dev-integration/run.sh   # host, against the real sandbox and shell
```

`dev-preflight.mjs` reproduces the loader's own rules, so a packaging mistake is
caught here rather than in the app's log after a restart: the Client bundle
registers a factory whose id must equal the package name, `exports["./client"]`
must resolve, the bundle patch must insert the package, the Host half must import
with nothing but node builtins, and both tool schemas must stay inside the
keyword subset the registry enforces.

`dev-smoke.mjs` runs the Host half against a scratch workspace with an `fs` and
`shell` shim shaped like the real services, so the substitution and every failure
path are exercised. `dev-client-smoke.mjs` runs the browser bundle against a
miniature React and walks the element tree — fast, dependency-free, and enough to
catch a component that throws.

[`dev-react/`](dev-react/README.md) goes further: it mounts the real bundle with
`react-dom/client` into jsdom and drives it as a person would — typing into the
masked field through React's own event system, clicking Apply, and asserting that
the edited value, the steps, the action id and the session scope all arrive. It
also proves the `preparing` → `start` phase change remounts instead of breaking
the rules of hooks, which the miniature runtime cannot detect.

[`dev-integration/`](dev-integration/README.md) closes the last gap, driving the
plugin against the real `ctx.fs`, `ctx.shell` and `ctx.sandboxPolicy`.

None of these are shipped: `package.json` `files` omits them.

The Host half logs one line at startup, in the same style as the other local
plugins, so a mount can be confirmed without the UI:

```
[action-cards] ready — propose_action, return_action and /actions, store /Users/you/.dsh/action-cards/actions.json
```

It also writes `$STATE_DIR/doctor.json`, in the same spirit as
`dsh-projects-manager`'s doctor, recording what it reached and whether its two
registrations succeeded. Every service this plugin uses is read lazily through
`ctx.get`, so a missing one degrades quietly; this file is what makes the
difference between "loaded" and "loaded but cannot write a file" visible from
disk:

```json
{
  "plugin": "action-cards",
  "version": "1.1.0",
  "probe": "settled",
  "tool": "ready",
  "toolError": null,
  "returnTool": "ready",
  "returnToolError": null,
  "command": "ready",
  "services": { "fs": "ready", "sandboxPolicy": "ready", "shell": "ready", "shellEnv": "ready", "sessions": "ready" },
  "store": "/Users/you/.dsh/action-cards/actions.json"
}
```

The Client half announces itself once at mount with `/actions hello`, which writes
`$STATE_DIR/client.json`. Together those two files are how a change is confirmed
to be **live** rather than merely saved — a browser fetches the Client bundle, so
a stale one behaves exactly like a working one until it can be asked what version
it is:

```json
{ "at": 1791645139436, "client": "1.1.0", "host": "1.1.0", "sessionId": "…" }
```

`client.json` missing while `doctor.json` is current means the Client bundle is
stale; both missing means the app never loaded the plugin. Bump `PLUGIN_VERSION`
in `index.js` and `CLIENT_VERSION` in `client.js` together.

### Integration test — the real services

The suites above run in plain Node, against shims shaped like the real services.
[`dev-integration/`](dev-integration/README.md) closes that gap: it mounts the
plugin in a throwaway profile and drives its own tool and command against the real
`ctx.fs`, `ctx.shell` and `ctx.sandboxPolicy` — 29 checks, including the sandbox
refusing a write outside the workspace.

```sh
./dev-integration/setup.sh && ./dev-integration/run.sh
```

### A trap worth knowing about

`await import('@deepseek-ai/dsh-llm')` **does not resolve from a
profile-installed plugin.** The Harness packages live inside the application's
asar; a plugin's realpath is its workspace directory, and the profile's own
`node_modules` holds only `@local/*`. The import fails with
`ERR_MODULE_NOT_FOUND`, and because first-party code wraps such deliveries in a
`try`, the failure is silent.

Both other local plugins take that route — `dsh-projects-manager`'s
`/projects remind` cannot deliver its briefing for this reason. This plugin
attempts the import first and falls back to building the message itself, which is
`createUserMessage` verbatim: `{ ...input, role: 'user', id }`, deep-frozen, with a
`source.kind` of `action-cards`. That is the same shape `@deepseek-ai/dsh-schedule`
uses to deliver a reminder, and the Client treats an unrecognised `source.kind` the
same way it treats `schedule` — no special case, no breakage.

### The tool schema subset is smaller than JSON Schema

The Harness enforces a subset: `type`, `oneOf`, `properties`, `required`,
`additionalProperties`, `items`, `enum`, `const`, plus the annotations
`description`, `title`, `default`, `examples`. Nothing else.

`ctx.tools.register()` asserts this on the **output** schema and rejects the tool
outright. It does *not* assert on `parameters` — but an out-of-subset keyword
there is silently ignored by argument validation and by the generated PTC types,
so it reaches the provider unenforced and merely misleads the model.

This plugin's first draft used `minItems`/`maxItems` on `steps`, which is exactly
that trap: the model would read "up to 9 steps are fine" while `normalizeProposal`
rejected them. The bounds now live in the step's `description`, where the model
actually reads them, and `normalizeProposal` is the only enforcement — with a
clearer message than a schema violation would give. No shipped tool uses an
out-of-subset keyword, so this is worth checking before adding one.
[`dev-preflight.mjs`](dev-preflight.mjs) now fails the build if one reappears.

## Limitations

- One proposal is one tool call. An apply is all-or-following-nothing-at-the-first-
  failure; there is no per-step retry, and a failed apply leaves a new proposal
  rather than resuming the old one.
- The store is a single JSON file rewritten whole. It is written atomically, and a
  torn read is tolerated, but concurrent applies from two windows serialise
  through one queue per process.
- The Sidebar panel reads the store, not the transcript, so a proposal made before
  the store existed shows on its row and not in the list.
- A `run_command` step cannot be made interactive: it runs to completion, capped at
  64 KB per stream, and its exit code is the outcome. Use the terminal tool for
  anything that needs a TTY.
- Applying an `edit_file` whose file changed since the proposal fails with
  `FS_STALE_VERSION` rather than forcing the edit. Re-propose it.
- Copy is plain English rather than routed through the Client locale service, so it
  does not switch language. This matches `dsh-projects-panel`.
- The outcome message is hand-built, because the message factory cannot be imported
  from a plugin (above). It is reproduced field for field, and the inbox projection
  admits it on the same terms as a factory-built one, but a future change to
  `createUserMessage` would not be caught by a type error here.
- The panel only appears in the right Sidebar's guide (the strip's add control) or
  via the row's *Open* button. There is no always-visible seat for a
  contributed tab.
