# Integration test

The offline suites ([`dev-preflight.mjs`](../dev-preflight.mjs),
[`dev-smoke.mjs`](../dev-smoke.mjs), [`dev-client-smoke.mjs`](../dev-client-smoke.mjs))
run in plain Node. They cover the plugin's logic thoroughly, but their `fs` and
`shell` are *shims shaped like* the real services. This directory closes that gap:
it drives the plugin's own `propose_action` tool and `/actions` command against
the services themselves, mounted inside a real DSH profile.

What that actually proves, per run:

- `ctx.sandboxPolicy.resolve({ session })` returns a session-scoped policy, and
  the real `dsh-fs-sandbox` **refuses a write outside the workspace** through this
  path — while allowing one inside it;
- `ctx.fs.writeText` accepts the exact five-argument call the plugin makes, and
  the four-argument `ctx.fs.editText`, and really creates the file, its parent
  directories, and really applies the find-and-replace;
- `ctx.shell.execute(ctx.shell.resolve({ … }))` runs under Seatbelt in the session
  workspace, returns a real exit code, and surfaces stdout;
- a non-zero exit becomes a failure outcome rather than an exception;
- the outcome reaches the agent as a well-formed, frozen user message;
- the real tool registry **accepts the definition** (which runs the real
  `assertSupportedJsonSchema` on the output schema) and **projects it onto the
  model-facing tool list** with its parameters intact — the path that would break
  the agent's turn, not this plugin, if the schema were malformed.

```sh
./dev-integration/setup.sh    # wire a throwaway profile (copies `desktop`)
./dev-integration/run.sh      # boot it; prints the checks and the tally
```

Both scripts respect `DSH_BIN`, `DSH_SOURCE_PROFILE` and
`DSH_ACTION_CARDS_VERIFY_ROOT`. Everything lives under one scratch `DSH_HOME`
(`/tmp/dsh-action-cards-verify` by default), so the running app's sessions,
storages and action store are never touched. The profile is named `verify`; the
CLI refuses to touch `desktop` while the Electron app is running, which is why
setup copies it rather than editing it.

## Why the driver applies the plugin itself

The driver needs a handle on the tool and the command, and the loader does not
publish one. So it imports the plugin and calls its `apply` against a context
whose `tools` and `commands` registries are recording stubs, while every other
property forwards to the real context. The plugin therefore runs its real code
against real services; only the two registrations are captured rather than
published. The plugin is kept out of the profile's bundle list so nothing is
registered twice.

## The scratch session

`sandboxPolicy.resolve` reads the session's log to find a mode override, so the
driver passes a stand-in session with the four fields that path touches
(`header`, `seq`, `inheritedEventCount`, `snapshotEvents`) and an empty event log,
which yields the deployment default mode — exactly what a fresh session gets. The
policy, the filesystem and the shell are all real; only the session object is not.
