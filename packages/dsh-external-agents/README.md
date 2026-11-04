# @malipetek/dsh-external-agents

Run **external agents that speak the [Agent Client Protocol](https://agentclientprotocol.com)
over stdio** from inside DeepSeek Harness — Claude Code, Devin, opencode, or
another DeepSeek Harness — and choose which one handles a task.

This is the DeepSeek Harness equivalent of Zed's
[External Agents](https://zed.dev/docs/ai/external-agents) and of the agent
picker in Devin Desktop: the external agent runs as its own process, owns its
own session, and owns its own login. DeepSeek Harness orchestrates; it does not
speak for the other agent.

## Why this shape: the compliance boundary

Anthropic's [Claude Code legal page](https://code.claude.com/docs/en/legal-and-compliance)
forbids a third party from collecting, storing, or intermediating Claude
credentials — offering a Claude.ai login inside another application, or routing
Free/Pro/Max credentials on someone's behalf. The January–February 2026
enforcement action that got accounts suspended targeted exactly that: harnesses
using a subscription token to call the API as if they were the official client.

The same page permits the opposite arrangement in as many words:

> Nor does it prevent an end user from signing in to the **unmodified Claude
> Code binary with their own Claude subscription, including where a platform
> hosts Claude Code** as described under *Can customers offer Claude Code in
> their products?*

That is this plugin. It spawns the vendor's own agent process and lets that
process authenticate. It never reads, copies, stores, or forwards a credential.

**The boundary is enforced in code, not just documented.** The child receives a
minimal environment (`envMode: 'minimal'`, the default) that deliberately
excludes every `ANTHROPIC_*`, `CLAUDE_*`, `ACP_*`, and `DEVIN_*` variable. So
DeepSeek Harness's own provider configuration — `ANTHROPIC_BASE_URL`,
`ANTHROPIC_AUTH_TOKEN`, provider keys — cannot reach the external agent. Two
consequences follow, both intended:

- The external agent cannot be pointed at a third-party endpoint, so it can only
  ever talk to its own provider.
- The external agent cannot be used as a **model backend** for this harness.

That second point rules out the popular reverse design, where a harness serves
its own conversations from a Claude subscription. It is refused structurally
rather than left to judgement, and `allowAnthropicRouting: true` exists only so
turning it back on is a deliberate act.

If you publish or share this plugin, the conditions from the same page still
apply: do not modify or bundle the Claude Code binary, do not remove an
authentication method, do not pay for or intermediate another person's usage,
and do not use Anthropic's names or logos as your own product name or in a way
that implies endorsement. Calling this plugin "External Agents" and describing
it accurately is fine; calling it "Claude Code for DeepSeek" is not.

## Install

From npm:

```sh
dsh plugin --profile desktop add @malipetek/dsh-external-agents
```

From a checkout, or a packed tarball:

```sh
dsh plugin --profile desktop add link:/path/to/dsh-external-agents
dsh plugin --profile desktop add ./malipetek-dsh-external-agents-0.2.1.tgz
```

Or use the **Plugins** page in the Web sidebar. Either way, **restart the app**:
the Host half composes into a live profile, but the running JavaScript
generation has to be replaced before a new bundle is loaded.

## Agent instructions

Paste this into a DeepSeek Harness agent to install and configure it end to end.

```text
Install the external-agents plugin in this harness and set up delegation.

1. Install it:
   dsh plugin --profile <profile> add <tarball path, link:/path or package name>
   Restart the app afterwards — the plugin's Host half loads at startup.

2. Confirm the harness has a subagent service. Delegation cannot work without it:
   the plugin logs "<id> delegate bridge on; subagent service ..." at load. If it
   says "not visible yet", that is expected — it is resolved per call. A
   delegation that fails with "no subagent service mounted" means the profile
   genuinely lacks it; mount @deepseek-ai/dsh-subagent,
   @deepseek-ai/dsh-subagent-spawn-in-process and @deepseek-ai/dsh-tool-subagent.

3. If an external ACP agent is the default model, disable the LLM session-title
   hook in the profile's cordis.patch.yml. It asks the turn's own route for a
   title, which is a second concurrent prompt on the same ACP session, and the
   real turn then ends EMPTY_TURN:

     - id: session-title-llm
       disabled: true

4. Give the agent a delegation target, on its entry in cordis.patch.yml:

     - id: claude
       command: claude-agent-acp
       delegate:
         llmProvider: opencode-go
         model: deepseek-v4.1-flash

   `llmProvider` and `model` are the worker's route; leave them out and workers
   inherit the parent's model, which for an ACP agent means another Claude Code
   process. Add `provider` to choose a different subagent backend.

5. Verify. Start a conversation on that agent and ask: "Call the delegate tool
   with task 'list the files here' and report exactly what it returned."
   Then check the plugin log for three lines:

     [claude] delegate shim will run on /path/to/node
     [delegate] session-… → list the files here
     [delegate] session-… done → …

   The first proves a Node binary was found (process.execPath is the app itself,
   not Node). The second proves the tool reached the agent. The third carries the
   worker's answer. If the second never appears, the MCP server did not connect —
   check that the command in the agent's --mcp-config is Node, not the harness.
```

## Configuration

One Host row, configured in the profile's `cordis.patch.yml`. Explicit `agents`
win; otherwise `discover: true` probes `PATH` for the shipped catalog.

```yaml
- id: external-agents
  name: '@malipetek/dsh-external-agents'
  config:
    discover: true
    envMode: minimal
    agents:
      - id: claude
        label: Claude Code
        command: claude-agent-acp
        args: []
      - id: devin
        label: Devin
        command: devin
        args: ['acp']
      - id: opencode
        label: opencode
        command: opencode
        args: ['acp']
      - id: dsh
        label: DeepSeek Harness
        command: dsh
        args: ['--profile', 'acp']
```

| Field | Default | Meaning |
| --- | --- | --- |
| `agents` | `[]` | Explicit agent entries. When empty, the catalog is probed. |
| `discover` | `true` | Probe `PATH` for the shipped catalog when `agents` is empty. |
| `envMode` | `minimal` | `minimal` passes only what a program needs to run; `inherit` starts from this process's environment but still withholds the routing variables. |
| `allowAnthropicRouting` | `false` | Forward `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` in `inherit` mode. See above. |
| `xdgRoot` | unset | Redirect an agent's XDG data/cache/state directories. **Isolation, not a performance knob** — an agent's saved login lives in its XDG data directory, so redirecting it makes the agent look logged out. |
| `maxTranscript` | `400` | Updates retained per connection. |
| `cwd` | the process directory | Fallback workspace for an external agent. Prefer the initiating session's own directory, which is read at call time. |
| `expose` | `explicit` | Which agents reach the model picker. Reading a catalogue means starting the agent, so `explicit` limits that to agents you listed; `all` includes discovered ones. |

Per agent: `id`, `label`, `command`, `args`, `env`, `cwd`, `timeoutMs`
(default `300000`), `approval` — `allow` (default), `deny`, or `cancel`, which
decides how the client answers the agent's `session/request_permission` prompts —
and `llmProvider`, the provider route the agent is exposed under (default
`acp-<id>`), which is what the model picker groups by. Every permission decision
is recorded and reported with the result, because in `allow` mode that record is
the only place you can see what the external agent was permitted to do.

Two more per-agent fields shorten the picker:

| Field | Default | Meaning |
| --- | --- | --- |
| `models` | unset | A curated list for the picker. **Wins outright** and needs no ACP session, so the picker opens instantly. Entries are an id, or `{ id, name, description }`. |
| `modelInclude` | unset | Globs an advertised model must match to be shown. Applied only when `models` is unset. |
| `modelExclude` | unset | Globs an advertised model must not match. Applied after `modelInclude`. |

`*` matches any run of characters and `?` a single one; matching ignores case and
is anchored. So `swe-*` matches `swe-2-high`, and `fusion-*` matches every Fusion
pairing.

### Keeping the list short

An agent's roster is usually far longer than it is useful. Devin advertises
**122 models, 62 of them `fusion-*` pairings of two others** — which is what made
its group unwieldy. Two ways to fix it:

```yaml
# Keep the live roster, drop the noise.
- id: devin
  command: devin
  args: ['acp']
  modelExclude: ['fusion-*', 'MODEL_*']

# Or state exactly what you want, with the agent's own names.
- id: devin
  command: devin
  args: ['acp']
  models:
    - id: adaptive
      name: Adaptive
    - id: claude-opus-5-5-medium
      name: Claude Opus 5.5
    - id: swe-2-high
      name: SWE-2
```

The curated form is also the faster one: it never starts the agent to build the
menu. A model you list that the agent does not actually offer is refused at
selection time and the agent keeps its own choice, so a stale entry cannot fail a
turn.

### The catalog

| id | Command | Notes |
| --- | --- | --- |
| `claude` | `claude-agent-acp` | The maintained ACP adapter, formerly `@zed-industries/claude-code-acp`, now `@agentclientprotocol/claude-agent-acp`. It drives Claude Code's own SDK, so authentication stays inside the official client. Install it separately (`pnpm add -g @agentclientprotocol/claude-agent-acp`); npm is blocked on this machine. **Verified end to end**: 13 models, a `mode` selector (Manual / Accept edits / Plan / Auto / Bypass permissions) and `thought_level`, and a completed turn signed in with Claude Code's own login while the plugin passed it no credential at all. |
| `devin` | `devin acp` | Cognition ships and documents this ACP server for Zed, JetBrains, and Xcode. **Verified end to end**: 122 models over ACP, plus `mode` and `thought_level`. |
| `opencode` | `opencode acp` | Its `acp` subcommand exists and is described as "Start an Agent Client Protocol server". No prompt has been run through it from here. |
| `dsh` | `dsh --profile acp` | DeepSeek Harness as an external agent to itself. Reachable because `dsh-acp-app` already ships an ACP server. Not yet exercised. |

## Use

A model-facing tool, so an agent can hand work to a different agent without a
shell command:

| `action` | Effect |
| --- | --- |
| `list` | Every configured agent, its state, command, and live session |
| `ask` | One task to one agent (`agent`, `prompt`, optional `cwd`, `timeoutMs`); returns its transcript |
| `close` | Terminate an agent's process |

And a Host command, so a panel — or you — can reach the same registry:

```
/external-agents list
/external-agents ask <agent> <prompt>
/external-agents close <agent>
/external-agents close-all
```

Connections are **lazy and long-lived**: nothing spawns until the first prompt,
and the process is reused after that, because starting an agent is expensive.
Devin, for instance, connects every MCP server it knows about before
`session/new` settles — around five seconds on a warm machine.

## The picker

There is no new UI surface, because DeepSeek Harness already has the picker this
needs — and the right one is next to the input box, not in the sidebar.

`conversation.input.model` is the composer's model seat, and
`@deepseek-ai/dsh-client-ui-model-selection` builds each session's directory from
the host's live LLM catalog via `ModelDirectoryResolver` (`ctx.modelDirectories`).
The catalog is `ctx.llm.listProviders()`, which is nothing but the registered
adapter routes. So **registering one adapter per external agent is what puts that
agent in the composer's picker**, grouped by provider, with the agent's own
models nested underneath. Choosing "Devin → SWE-2" picks the agent *and* its
model in one gesture, exactly like Devin Desktop.

The agent's models are not guessed. They arrive over ACP: `session/new` returns
`configOptions`, and the option whose `category` is `model` is the agent's live
roster. Devin answers with its real list — Fusion combinations, Claude Opus 4.6,
GPT-5.x, Kimi, DeepSeek V4 Pro, the SWE family. Selecting one is written straight
back with `session/set_config_option`, so a choice made in the harness's picker
becomes a choice made in the agent.

Two ACP options beyond `model` are also exposed by agents — `mode`
(Code / Smart / Ask / Plan / Bypass for Devin) and `thought_level` — and are read
into the same catalogue, though the harness's picker currently renders the model
one.

### What happens on each turn

The agent loop sends each turn through `ctx.llm.stream`, which is a cordis
waterfall, so this plugin's adapter answers it:

1. The loop drives every turn inside `ctx.agents.withInitiator(agent, …)`, an
   `AsyncLocalStorage` chain. Calling `ctx.agents.currentInitiator()` from inside
   the adapter names the exact DSH session, which is how one DSH session maps to
   one ACP session. (The request itself carries only `provider`, `model`,
   `messages`, `requestId` and `signal` — no session id.)
2. Only the newest **human** turn is forwarded. The external agent keeps its own
   conversation, so replaying the whole transcript into it would duplicate
   context.
3. Harness-injected runtime context is stripped out of that turn. The harness
   appends a snapshot — a time sample, the workspace, the approval policy — as a
   `user` message *after* the human's, so "the last user message" is not the
   instruction. Sending it as one made the agent answer *"no new instruction came
   through"* to an ordinary question, and made your message appear to vanish. A
   context-only message is skipped; context appended to the human's own text is
   cut off and the rest kept.
4. `agent_message_chunk` becomes `text-delta` and `agent_thought_chunk` becomes
   `reasoning-delta`, streamed as they arrive.
5. **Images travel with the turn.** The harness hands an adapter a durable
   reference (`{ attachment: { attachmentId, mediaType } }`), not bytes;
   `ctx.attachments.imageHostPath(ref)` owns the mapping into its
   content-addressed store, so the plugin reads that file and sends ACP
   `{ type: 'image', data, mimeType }` blocks beside the text. The route only
   advertises `inputModalities: ['image']` when a resolver is actually available —
   claiming it without one makes the harness route images to an adapter that
   cannot read them. An **image-only turn** (a screenshot with no caption) is a
   real request: it used to be classified as "no human turn" and answered with
   nothing, which is one cause of a session that appears to sit empty.

### Progress while it works

A long agentic run shows almost no text until the end, so the transcript read as
"working" with no evidence. Tool activity is now projected as **reasoning** lines —
`→ Write file`, `→ failed` — which are visible, collapse with the agent's thinking,
and are inert.

They are deliberately *not* `tool-call` chunks: that would tell this harness to run
a tool the other agent already executed in its own process, a second execution of
the same side effect. Reasoning is the only channel in the stream that renders
without being executed.

Two rules keep the log readable: **one line per distinct tool** (an agent that runs
`shell` twenty times reads as one line), and **success is silent** — only a failure
is worth a line. An earlier version printed every invocation and every completion,
which buried the transcript in nine identical `→ shell → completed` rows.

The consequence remains honest: you see the agent's answer and the shape of its
work, not its tool output.

### Delegation: letting the agent command harness workers

An external agent can be given **one** harness capability: `delegate`. Configure it
per agent and the plugin serves a loopback MCP endpoint; the agent spawns
`mcp-forward.mjs`, which relays each call with a per-session bearer token.

```yaml
agents:
  - id: claude
    command: claude-agent-acp
    delegate: { llmProvider: opencode-go, model: deepseek-v4.1-flash }
```

A `delegate` call becomes:

```js
ctx.subagents.startActivation({
  provider: 'spawn',
  request: { prompt: [{ type: 'text', text: task }], parent, agentOptions },
  delivery: 'caller',
})
```

Three deliberate choices:

- **One tool, not the registry.** Invoking a tool's `execute` directly skips
  `tools/pre-execute` and `ctx.tools.guard` — the approval gate. Delegation is a
  service with its own admission, depth and capacity rules, so the bridge uses it.
- **Per-session tokens.** A call is attributed to the harness session that spawned
  that session's shim, which is how it reaches the right live parent agent.
- **Workers are pinned** by `agentOptions`, so a delegation runs on a native route
  rather than recursing into another Claude Code process.

Verified end to end against real `claude-agent-acp` with a fake `ctx.subagents`:
the agent called `delegate`, the endpoint built
`{provider:'spawn', delivery:'caller', prompt:[…], agentOptions:{provider:'opencode-go',
model:'deepseek-v4.1-flash'}, parent:{id:'agent-1'}}`, and the agent reported the
result. `node test/mcp-forward-spike.mjs claude-agent-acp`.

### Usage and cache

ACP marks `session/prompt`'s `usage` field **unstable**, so agents are not obliged to
report it — but the ones that do report the provider's own accounting, including
`cachedReadTokens`. That is the only honest source of a cache-hit rate: a character
estimate cannot know what was cached.

The adapter prefers the reported object and falls back to the estimate only when
the agent sends nothing. `totalTokens` is taken as reported, never recomputed —
opencode includes cached reads in it, so `input + output` does not match.

Verified live against opencode on `opencode-go/deepseek-v4.1-flash`, two turns of
the same conversation:

```
turn 1  input=16226  cached=0      output=3  total=16229     (cold: nothing to reuse)
turn 2  input=3443   cached=16000  output=4  total=19447     (the prefix was reused)
```

The second turn is the point: **16,000 of ~19,400 tokens came from cache**. Before
this, the estimate reported the whole conversation as uncached input, so every
external-agent conversation read as "0% cache hit" even when the provider was
caching heavily.

```sh
node test/usage-live.mjs opencode acp --model opencode-go/deepseek-v4.1-flash
node test/usage-probe.mjs opencode acp --model opencode-go/deepseek-v4.1-flash
```

The probe also shows ACP's `usage_update` notification, which carries context
`used`/`size` and a **cost** in USD — not mapped to the harness's `TokenUsage`,
which has no cost field, but logged for diagnosis.

### Why not a real Agent driver instead

Routing the *main* chat to an external agent as a first-class DSH agent would be
more faithful, and it is not reachable from a plugin. `ctx.agents.setFactory` is
exclusive:

```js
if (this.factory !== void 0) throw new Error("an agent factory is already registered");
```

so a plugin cannot sit beside `dsh-agent-loop`, and `ctx.agents.register(agent)`
would mean building a conforming `Agent` plus its session and owning prompt
delivery through the `agent/inbox/spliced` projection and assistant-message
commitment — reimplementing the loop rather than extending it. The adapter route
reaches the same user-visible outcome through the seam the architecture actually
offers.

## Permissions

An agent that wants to write a file, run a command or reach the network may ask
first, over `session/request_permission`. Claude Code sends exactly one request
per write. Devin sends **none** — measured, under both `allow` and `deny`, it
wrote the file either way. That asymmetry is the whole story of this section:
a client-side policy only governs an agent that chooses to ask.

**The default is `allow`.** An external agent is treated as a full-access
collaborator, so nothing it does is gated on a prompt the user did not ask for.
That is a deliberate posture rather than an oversight: these agents are meant to
run unattended, and a stricter default would be enforced against Claude Code
while Devin ignores it entirely — inconsistency dressed up as safety.

**`approval: ask` is the opposite posture, opt-in.** Each request is routed to
the harness's own approval seam, `ctx.approval` — the same service the native
tools use — so an external agent's edit is gated like a native one and audited in
the session log as an `approval/asked` + `approval/decided` pair. `ctx.approval`
treats a request as needing an **open turn**, which is why the adapter captures
the initiating agent at the start of the stream rather than when the request
arrives: that request is handled from the child's stdout event, outside the
initiator chain the loop established. Under a harness approval policy of `never`,
`ask` makes external agents read-only — which is that policy applied to a second
kind of tool, not a bug.

**Every policy fails closed.** No seam, no answerer, no initiating agent, a
handler that throws, an approval outcome of `unavailable`, or a policy that
cannot find a matching option all resolve to *refused*. An answer is never
fabricated.

That last rule is not hypothetical. The first version chose
`options.find(pattern) ?? options[0]` — a fallback to "whatever was offered
first" — so a `deny` policy matched nothing, selected `allow-with-updates`, and
**recorded the decision as `denied` while letting the write through**. The probe
that caught it is still here:

```sh
node test/permission-probe.mjs claude-agent-acp --model=haiku
```

It runs the same file-writing request twice and reports whether the file
appeared. With the bug: `deny` → `allow-with-updates`, file written, decision
logged as `denied`. Now:

| | `deny` | `allow` |
| --- | --- | --- |
| Claude Code: option selected | `reject` | `allow-once` |
| Claude Code: file created | **no** | yes |
| Claude Code: agent said | *"The Write call was refused with 'User refused permission to run tool'"* | `DONE` |
| Devin: permission requests | 0 | 0 |
| Devin: file created | **yes** | yes |

The agent is told *why* it was refused, so a refusal never looks like a silent
failure — and the option is matched by ACP's own `kind` (`allow_once`,
`reject_once`, …) before its name or id, so a confusingly named option cannot
flip the answer.

Two consequences worth knowing:

- **`approval` only governs an agent that asks.** It cannot contain Devin, which
  never sends a request. Containment for such an agent lives in the agent's own
  configuration — Devin's `~/.config/devin/config.json` `permissions.allow` list,
  or its permission mode. Note that `--permission-mode` is a top-level `devin`
  flag and **not** an `acp` subcommand flag: `devin acp --permission-mode X` is an
  argument error, while `devin --permission-mode X acp` and the
  `DEVIN_PERMISSION_MODE` environment variable both work, the latter settable
  through a per-agent `env`.
- **The `external_agents` tool shares the same default.** It is a delegation the
  user already sees as a tool call rather than a session turn, so it does not
  consume the approval seam unless `approval: ask` is set on the agent.

## Workspace

An external agent is started in the **session's** workspace, read from
**`session.header.cwd`**.

The naming is worth spelling out, because the input and the property do not
match and three plausible spellings are all wrong:

```js
ctx.sessions.create(id, { meta: { cwd } })   // `meta` is the INPUT
session.header.cwd                            // what a live Session exposes
```

The store validates the `cwd` from `meta` and keeps it as the session **header**
— "detached, deep-frozen creation metadata (format version, cwd, lineage…)" — and
the harness's own code reads it the same way. `session.meta.cwd`, `session.cwd`
and `session.metadata.cwd` all resolve to nothing, and because a wrong property
degrades to the fallback rather than throwing, the mistake is invisible: the
plugin does not fail, it just points the agent somewhere else.

That fallback is the second trap. The desktop harness is launched from its own
profile directory (`~/.dsh/profiles/desktop`), so falling back to `process.cwd()`
sends every external agent there instead of the user's project, and the agent
reports the wrong directory as though it were broken. Two guards now:

- the plugin warns once, naming the directory, when it has to fall back;
- `external_agents` action `list` reports the resolved workspace and says which
  it was:

```
workspace: /Users/malipetek/Documents/Documents/Projects/Leziz  (from the session)
workspace: /Users/malipetek/.dsh/profiles/desktop  (FALLBACK — the session declared no workspace, …)
```

An explicit per-agent `cwd` still overrides the session workspace.

### Unknown is not the same as moved

`ensureSession(cwd)` treats `undefined` as **"I could not tell"**, not as "the
workspace changed", and falls back to the workspace that key already used — in
memory, then on disk — before the configured default. Conflating the two was a
silent, per-turn context loss: any turn that failed to resolve a workspace looked
like a directory move, so the session was closed and the agent began a fresh
conversation. Because ACP fixes `cwd` at creation a *real* move still restarts the
conversation, so that case logs a warning naming both paths, and
`test/context-retention.mjs churn` pins the behaviour.

### When it still goes wrong

Guessing has cost real time here, so the plugin records its decisions instead.
`note()` appends one line to `~/.dsh/external-agents/diagnostics.log` for: the
build that loaded, every agent spawn, and every session decision — `asked` /
`known` / `wanted` / existing, then `NEW`, `RESUME ok`, or `RESUME failed` with
the agent's reason. `external_agents` action `diagnostics` returns that tail plus
the running build:

```
build 2026-10-13a-sticky-workspace
workspace: /Users/…/Projects/Leziz  (from the session)

2026-10-13T07:41:02.113Z [devin] ensure key=session-95b7… asked=/Users/…/Leziz known=(none) wanted=/Users/…/Leziz existing=(none)
2026-10-13T07:41:02.118Z [devin] NEW key=session-95b7… session=aquatic-stetson cwd=/Users/…/Leziz
```

`PLUGIN_BUILD` is bumped whenever a fix lands, so "which code is actually
running?" is answerable without guessing — three separate attempts to read the
session workspace were each wrong, and every one of them failed silently.

## Continuity

An ACP session belongs to the agent **process**. Nothing about it lives in the
harness, so without help every plugin reload and every app restart begins a new
conversation — and the failure is silent: the agent answers as though it had
never seen you, with nothing in the transcript to explain why.

So each conversation's ACP session id is written to a small JSON file under
`~/.dsh/external-agents/sessions/<agent>.json`, keyed by the DSH session it
belongs to. The next process reads it and adopts the same session:

- `session/resume` when the agent advertises `sessionCapabilities.resume` —
  restores without replay.
- `session/load` when it advertises `loadSession` — the older path, which replays
  history to the client. Harmless here: a session being adopted has no update sink
  yet, so the replay is discarded rather than shown twice.
- Neither → the entry is dropped with a warning and a new session is created,
  which is honest rather than quiet.

The capability check reads `agentCapabilities` **inside** the initialize result.
Reading it from the top level makes every agent look incapable of resuming, which
is exactly how this failed the first time.

Verified against Devin, over a real process restart:

```
--- process 1: plant ---
  created ACP session: wobbly-century  (pid 79849)
  reply: "OK"
  process 1 killed (this is what a reload does)
--- process 2: recall, with the same store ---
  [debug] resumed wobbly-century for "resume-probe"
  resumed rather than recreated: yes
  reply: "7"
```

```sh
node test/context-retention.mjs raw devin acp       # one process, two turns
node test/session-resume.mjs devin acp              # across a restart
```

`context-retention.mjs` exists because "the agent forgot" has two very different
causes that need separating: within one process, both the raw client and the
adapter retain context correctly — so a loss is about session identity, not about
the protocol or the agent.

### Forks, switches, and turns another agent took

Three ways the same mismatch appears, and one mechanism for all of them: the
harness holds a conversation the agent's own session does not.

- **A fork** inherits a prefix of its parent's transcript, so the UI shows the
  conversation while a brand-new agent session has seen none of it.
- **A provider switch** (`acp-claude` → `acp-devin`, mid-conversation) hands the
  new agent a new session, so it starts at the newest message with no history —
  it answers "no new instruction came through" to a perfectly good question.
- **An alternating conversation**: when providers take turns, each agent's session
  only knows the turns *it* answered, so coming back leaves a hole exactly where
  the other worked.

**The first turn of any session that does not know the conversation carries the
transcript**, under a preamble marking it as established context rather than the
request. Sent once: after that the agent holds the history itself.

**Coming back to an agent sends only what it missed.** The adapter remembers the
text it last produced; if that reply is no longer the newest assistant turn,
another agent answered in between, and the turns after it are sent — under a
different preamble. If the anchor reply is gone (compaction, a restart), it falls
back to the full transcript rather than guessing.

**A retried turn is never caught up twice.** The harness retries a failed model
request with the same request id and the same messages; priming again on that
retry re-sends history the attempt already delivered, and the agent reads it as the
user repeating themselves — it says so, out loud, and spends the turn working out
what changed. The adapter remembers the request id it primed and skips the catch-up
on any retry of it.

**The budget is 48,000 characters by default and configurable** (`primeMaxChars`
per agent or profile-wide; `0` disables the catch-up). It used to be a hardcoded
12,000 that no config could reach, and the cut kept only the **tail** — which
handed a successor the last two turns of a 342-turn conversation and lost
everything that made them make sense. Over budget, both ends are kept: the
beginning holds what was asked for and decided, the end holds where things stand.

Verified live against Devin, with each fact present *only* in the primed history:

```
Part 1 — fresh session, history only in the harness:
  primed a new session with 150 chars of history (fork, switch or lost session)
  reply: "HALCYON-7"

Part 2 — another agent changes it while this one is swapped out:
  primed 154 chars another agent handled since the last reply
  reply: "HALCYON-9"
```

```sh
node test/primer-live.mjs devin acp          # both halves, end to end
node test/images-live.mjs devin acp           # an image reaches the agent, including image-only turns
node test/context-retention.mjs fork devin acp
```


## Verification

Zero harness imports and zero ACP SDK imports: the client speaks the protocol
with `node:child_process` and `JSON.stringify`, so it cannot fail on module
resolution inside a composed profile, and it is testable on its own.

```sh
# 67 tests, no network, no credentials. Catalogues are checked against the
# harness's own validation rule (including a deliberately hostile one), and the
# permission paths are checked against the shape that produced the deny bug.
node --test test/client.test.mjs test/plugin.test.mjs test/llm-adapter.test.mjs test/permission.test.mjs

# Live checks. Each needs an authenticated agent, spends a little of that
# account's usage, and needs write access to the agent's own home directory
# (its log and its credential store live there).
node test/integration-devin.mjs          # the delegation tool path
node test/integration-llm-devin.mjs      # the picker's catalogue and a streamed turn
node test/permission-probe.mjs claude-agent-acp --model=haiku   # does deny actually block a write
node test/agent-catalogue.mjs devin acp  # what any ACP agent contributes to the picker
node test/context-retention.mjs adapter devin acp   # two turns in one process
node test/session-resume.mjs devin acp              # two processes, one conversation
ASK="Reply with exactly READY." node test/agent-catalogue.mjs claude-agent-acp
```

The suite runs against `test/mock-agent.mjs`, a minimal ACP agent that advertises
real `configOptions`: the handshake, streamed message and thought chunks, a tool
call, a `session/request_permission` round trip, both approval policies, a prompt
that never settles (timeout), a missing command, disposal, fragment resolution,
the exact tool and command registrations `apply()` makes, one provider
registration per configured agent, and the whole chunk protocol — text, reasoning,
usage, exactly one terminal `finish`, and the deliberate absence of tool-call
chunks. `test/permission.test.mjs` adds the permission paths: an unmatched intent
returning nothing, a `deny` with only allow options offered cancelling, `kind`
outranking a misleading name, a per-turn handler overriding the static policy,
and every unanswerable approval — absent seam, absent agent, thrown error,
`unavailable`, `cancelled`, and an unknown outcome — resolving to a refusal.

The live checks have been run against `devin acp` and `claude-agent-acp`. Against
Devin: the delegation path did a handshake, a session, a streamed thought chunk,
the text `READY` and `stopReason: end_turn`, and the picker path read its real
122-model catalogue over ACP, streamed a turn as
`reasoning-delta, text-delta, usage, finish` with `{kind:'stop'}`, and wrote the
selected model back with `session/set_config_option`. Against Claude Code: 13
models, a `mode` and a `thought_level` selector, a completed turn signed in with
Claude Code's own login while the plugin handed it no credential whatsoever, and
the permission probe above — `deny` refusing the write outright and `allow`
permitting it.

## Usage and the agent's own selectors

**Usage is estimated, not measured.** ACP's semantic updates carry no token
accounting, so the real counts are unknowable from this side of the wire.
Reporting zeros was worse than an estimate: the harness concluded nothing had
accumulated, so compaction had nothing to act on and the transcript grew
unbounded. `estimateUsage()` now reports four characters per token over the
request the harness assembled plus the assistant text streamed back.
`inputTokens` describes the *harness's* request, not the subset forwarded to the
agent, because it is the harness transcript that its context accounting bounds.

**Mode and reasoning level live behind a command.** Agents publish selectors
(`mode`, `thought_level`) with their session, but the harness's UI renders only
`model`. Without a way to reach them they sat at the agent's default forever:

```
/external-agents options devin                 list every selector and its current value
/external-agents set devin mode plan           switch the session mode
/external-agents set devin thought high        `thought` aliases `thought_level`
```

The command reads and writes the same ACP session the picker is using, so a
change applies to the conversation you are in rather than to a detached one, and
a value the agent does not offer is refused with its actual choices named.

## After the turn ends

An ACP turn ends when `session/prompt` resolves. **A finished harness turn cannot
be reopened** — only a new message starts another one — so an agent that says
"I'll let you know when it's done" and then does has nowhere to put the message.
That is not a timeout and not a dropped connection: the agent chose to end its
turn, and the protocol has no unsolicited assistant message.

Two things follow, one mechanical and one human.

**Mechanically, nothing is lost.** Updates that arrive after the turn resolved are
retained (timestamped, bounded, also written to the diagnostics log) instead of
being dropped on the floor, and `/external-agents pending` reports them:

```
/external-agents pending            every agent's post-turn updates
/external-agents pending claude     just one
```

`list` shows a `N pending` marker on any agent holding some. A new turn clears
the buffer, so "pending" always means *since the last turn*.

**Humanly, the fix is to not ask for it.** If the work can be done in the turn,
an agent should do it in the turn rather than promise a later report. That is a
workflow rule, so it belongs in the per-agent `instructions` option, which is
sent once at the start of a session:

```yaml
- id: claude
  instructions: >-
    Complete the work inside this turn. Do not end your turn with a promise to
    report back later, and do not leave a watch or background process running
    across turns. If something genuinely cannot finish within the turn, say so
    plainly and state that the user must ask again.
```

This is the honest boundary of the design: a harness turn is the unit of
conversation, and an external agent can end one but cannot reach back into it.

## A turn that says nothing

Two ways an answer can exist on the agent's side and never reach your screen, both
now handled.

**Block indexes followed the wrong order.** The harness's stream requires block
indexes allocated in *first-seen* order and reused for later deltas of the same
block. The adapter used a fixed text=0 / reasoning=1 pair, so a thinking agent —
which thinks before it answers — produced reasoning at 1 before text at 0. A
message assembled from out-of-order blocks can render as nothing. Indexes are now
allocated per kind as they first appear.

**A turn with no visible text was reported as success.** This route has no tools
of its own, so a turn that emitted no text did nothing visible; calling that
`stop` produced a bare "Completed", which reads as *"it replied and I never saw
it"*. It now ends with `EMPTY_TURN`, and the message includes how many characters
of reasoning came through, so "the answer went into a thought" is distinguishable
from "the agent said nothing at all".

Each turn's tally also goes to the diagnostics log:

```
[acp-claude] turn done updates=14 text=812c reasoning=1904c stop=end_turn
```

`text=0` on a turn you expected an answer from is the signal.

## Limitations

- **The external agent runs with your full user permissions.** The Plugin
  Manager's own documentation is explicit that installed Host code executes
  in-process outside the workspace sandbox, and a child process of a plugin is
  no different. A delegated agent is not confined to the session workspace.
- **The agent's tool activity is invisible.** Its tools run in its own process
  and are not projected into the transcript, because a projected tool call would
  make this harness try to run it a second time. You see the answer, not the work.
- **Reading a catalogue starts the agent.** The picker's contents come from a live
  ACP session, so the first time the picker asks, that agent is spawned and a
  session opened — Devin connects its MCP servers first, which takes seconds. The
  result is cached for the process. `expose: explicit` keeps that to agents you
  actually listed.
- **An agent with no model option shows an empty group.** If `session/new` carries
  no `model`-category option, that provider appears in the picker with nothing
  under it.
- **One malformed catalogue row fails the whole group.** `LlmRuntime.listModels()`
  validates every entry and rejects the provider with `INVALID_CATALOG` instead of
  skipping the bad row — it requires `provider` on each entry to equal the route,
  a non-empty string `id` and `name`, a string `description` when present, and
  unique ids. The adapter therefore declares `provider` and drops any entry with
  an empty or non-string value or name, or a repeated id, before the harness sees
  it. Omitting `provider` is what made all three groups fail to load the first
  time; the regression tests now run this exact rule.
- **No streaming to the `ask` tool's caller.** `ask` returns once the turn
  settles, so a long delegation blocks that one tool call. The picker path does
  stream. Cancellation is wired through `session/cancel` and the caller's abort
  signal.
- **Continuity depends on the agent keeping its own sessions.** The id is
  remembered and adopted via `session/load` or `session/resume`, so a reload or
  restart continues the conversation — but an agent that has garbage-collected or
  expired that session drops the entry with a warning and starts fresh. An agent
  advertising neither method cannot continue across processes at all. A *new* DSH
  session is a new conversation by design, so it starts fresh too.
- **`session/list` is still unused.** Stale ids are dropped lazily on a failed
  adopt rather than pruned by asking the agent what it still holds.
- **`opencode` and `dsh` catalog entries are offered, not verified.** `devin` has
  been exercised end to end through both halves, and `claude` through the picker
  path (catalogue and a completed turn). `opencode` exposes the `acp` subcommand
  but no prompt has been run through it, `dsh --profile acp` has not been tried at
  all, and through the picker neither has. Neither has any filtering configured,
  so their groups may be long.

