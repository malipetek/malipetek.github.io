/**
 * @malipetek/dsh-external-agents — Host half.
 *
 * Brings external agents that speak the Agent Client Protocol (ACP) over stdio
 * into DeepSeek Harness: Claude Code, Devin, opencode, or another DeepSeek
 * Harness. Each external agent runs as its own child process, owns its own
 * session and its own authentication, and is addressed by a stable slug.
 *
 * ## Why this shape, and not "Claude as DSH's model"
 *
 * Anthropic's Claude Code legal page draws the line at authentication, not at
 * user interface. It forbids a third party from collecting, storing or
 * intermediating Claude credentials — routing Free/Pro/Max credentials on a
 * user's behalf — while expressly permitting an end user to sign in to the
 * *unmodified* Claude Code binary with their own subscription "including where
 * a platform hosts Claude Code". So this plugin never handles a credential: it
 * spawns the vendor's own agent process and lets that process sign in.
 *
 * That property is enforced in code, not just documented. The child receives a
 * minimal environment by default (`envMode: 'minimal'`), which deliberately
 * excludes every `ANTHROPIC_*`, `CLAUDE_*`, `ACP_*` and `DEVIN_*` variable. The
 * consequence is structural: DSH's own provider configuration cannot reach the
 * external agent, so the agent cannot be pointed at a third-party endpoint and
 * cannot be used as a model backend for this harness. Passing
 * `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` through requires the explicit
 * `allowAnthropicRouting: true`, which exists only so the refusal is a decision
 * rather than an accident.
 *
 * ## No harness imports
 *
 * Like the other out-of-tree bundles, this module imports nothing from the
 * Harness and nothing from `@agentclientprotocol/sdk`. It speaks the protocol
 * with `node:child_process` and `JSON.stringify`, so it cannot fail on module
 * resolution inside a composed profile. The ACP client below is therefore
 * usable — and tested — on its own, without a Harness running.
 *
 * @module @malipetek/dsh-external-agents
 */

import { spawn } from 'node:child_process';
import { accessSync, appendFileSync, constants, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

/**
 * A Node executable for spawning the MCP shim.
 *
 * `process.execPath` is wrong here: inside the desktop app it is the harness
 * binary, so the agent would spawn another harness instead of the shim and MCP
 * would never connect. The shebang is not relied on either — an ACP agent
 * spawns without a shell, so a PATH miss would fail the same way.
 *
 * @returns an absolute path when one exists, else `node` for PATH.
 */
function nodeBinary() {
  const candidates = [
    process.env.DSH_NODE,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return 'node';
}
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { fileURLToPath } from 'node:url';
import { AcpModelAdapter, DEFAULT_PRIME_MAX_CHARS, pickOption } from './llm-adapter.js';
import { createDelegateEndpoint } from './delegate.mjs';

/** ACP protocol version this client speaks. */
export const PROTOCOL_VERSION = 1;

/** Session key used by callers that keep one session per connection. */
const DEFAULT_KEY = 'default';

/** Session key reserved for reading the agent's advertised model catalogue. */
const CATALOGUE_KEY = 'catalogue';

/**
 * Identifies the code that is actually running.
 *
 * Bumped whenever a fix lands, and written to the diagnostics log on load. Three
 * attempts to read the session workspace were each wrong in a different way, and
 * every one of them failed silently — so the first question on the next report
 * has to be "which build is this?", and it has to be answerable without guessing.
 */
export const PLUGIN_BUILD = '2026-11-06a-instructions-on-change';

/** Where the plugin records what it decided, for exactly this kind of question. */
export const DIAGNOSTICS_FILE = '~/.dsh/external-agents/diagnostics.log';

/** Keep the diagnostics log bounded; it is a debugging aid, not a ledger. */
const DIAGNOSTICS_MAX_BYTES = 512 * 1024;

/**
 * Where diagnostics go, overridable by the environment so a test run does not
 * write noise into the file someone is about to read to debug a real problem.
 * @returns the log path, `~` allowed.
 */
function diagnosticsFile() {
  return process.env.DSH_EXTERNAL_AGENTS_LOG ?? DIAGNOSTICS_FILE;
}

/**
 * Append one line to the diagnostics log.
 *
 * Never throws: a plugin that fails because its debugging aid failed would be
 * worse than one with no debugging aid.
 *
 * @param message - the line to record.
 * @param file - the log file, `~` allowed.
 */
export function note(message, file = diagnosticsFile()) {
  try {
    const path = resolve(expandHome(file));
    mkdirSync(dirname(path), { recursive: true });
    try {
      if (statSync(path).size > DIAGNOSTICS_MAX_BYTES) writeFileSync(path, '');
    } catch {
      // No file yet, so nothing to rotate.
    }
    appendFileSync(path, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Diagnostics must never be the reason something breaks.
  }
}

/**
 * Read the tail of the diagnostics log.
 * @param lines - how many trailing lines to return.
 * @returns the tail, or a note saying there is none.
 */
export function diagnosticsTail(lines = 40) {
  try {
    const text = readFileSync(resolve(expandHome(diagnosticsFile())), 'utf8');
    return text.split('\n').filter(Boolean).slice(-lines).join('\n') || '(diagnostics log is empty)';
  } catch {
    return `(no diagnostics yet at ${DIAGNOSTICS_FILE})`;
  }
}

/** Names inherited in `envMode: 'minimal'`. Auth and provider variables are absent by design. */
const MINIMAL_ENV_KEYS = [
  'PATH', 'HOME', 'SHELL', 'TERM', 'LANG', 'LC_ALL', 'LC_CTYPE', 'USER', 'LOGNAME',
  'TMPDIR', 'TZ', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec', 'PATHEXT', 'WINDIR',
];

/**
 * Variables that decide *where* an agent sends its requests and *as whom*. In
 * `envMode: 'inherit'` these are still withheld unless `allowAnthropicRouting`
 * is set, because forwarding them is the configuration that gets accounts
 * actioned.
 */
const ROUTING_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_URL'];

/** External agents offered by `discover` when no explicit agents are configured. */
const CATALOG = [
  { id: 'claude', label: 'Claude Code', commands: ['claude-agent-acp', 'claude-code-acp'], args: [] },
  { id: 'devin', label: 'Devin', commands: ['devin'], args: ['acp'] },
  { id: 'opencode', label: 'opencode', commands: ['opencode'], args: ['acp'] },
  { id: 'dsh', label: 'DeepSeek Harness', commands: ['dsh'], args: ['--profile', 'acp'] },
];

/** Human-readable reason strings for ACP stop reasons. */
const STOP_REASONS = {
  end_turn: 'completed',
  max_tokens: 'hit its token limit',
  max_turn_requests: 'hit its request limit',
  refusal: 'refused the task',
  cancelled: 'was cancelled',
};

/**
 * Expand a leading `~` and resolve the result.
 * @param path - a path that may start with `~`.
 * @returns an absolute path.
 */
function expandHome(path) {
  if (typeof path !== 'string') return path;
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Decide whether an executable exists, resolving bare names against PATH.
 * @param command - an absolute path or a bare executable name.
 * @returns the usable command, or null when nothing matched.
 */
export function findCommand(command) {
  if (typeof command !== 'string' || command.length === 0) return null;
  if (command.includes('/')) {
    try {
      accessSync(expandHome(command), constants.X_OK);
      return expandHome(command);
    } catch {
      return null;
    }
  }
  const pathValue = process.env.PATH ?? '';
  for (const dir of pathValue.split(':')) {
    if (dir.length === 0) continue;
    const candidate = join(dir, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here; keep looking.
    }
  }
  return null;
}

/**
 * Build the environment for an external agent.
 *
 * `minimal` hands over only what a program needs to run. `inherit` starts from
 * this process's environment but still withholds the routing variables unless
 * the caller has explicitly opted in.
 *
 * @param mode - `'minimal'` or `'inherit'`.
 * @param extra - per-agent variables, applied last.
 * @param allowAnthropicRouting - forward the routing variables in `inherit` mode.
 * @returns the child's environment.
 */
export function buildEnv(mode, extra = {}, allowAnthropicRouting = false) {
  let base;
  if (mode === 'inherit') {
    base = { ...process.env };
  } else {
    base = {};
    for (const key of MINIMAL_ENV_KEYS) {
      if (process.env[key] !== undefined) base[key] = process.env[key];
    }
  }
  if (!allowAnthropicRouting) {
    for (const key of ROUTING_KEYS) delete base[key];
  }
  return { ...base, ...extra };
}

/**
 * Make the per-agent XDG directories the child will write into.
 *
 * External agents keep logs, session databases and caches under the XDG
 * directories. Pointing them at the harness home keeps that traffic out of the
 * session workspace and satisfies a workspace-scoped file sandbox, which
 * otherwise kills the child at startup with `EPERM` before it answers
 * `initialize`.
 *
 * @param root - the per-agent root, `~` allowed.
 * @returns environment variables naming the three directories.
 */
export function xdgEnv(root) {
  const base = resolve(expandHome(root));
  const env = {};
  for (const [key, leaf] of [['XDG_DATA_HOME', 'data'], ['XDG_CACHE_HOME', 'cache'], ['XDG_STATE_HOME', 'state'], ['XDG_CONFIG_HOME', 'config']]) {
    const dir = join(base, leaf);
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // A read-only home is the child's problem to report, not ours to hide.
    }
    env[key] = dir;
  }
  return env;
}

/**
 * A durable map from a caller's session key to the ACP session that
 * conversation lives in.
 *
 * ACP sessions belong to the agent process, so without this every plugin reload
 * or app restart quietly begins a new conversation: the agent behaves as if it
 * had forgotten everything, and nothing in the transcript says why. Storing the
 * id and its workspace lets the next process call `session/resume` and carry on.
 */
export class SessionStore {
  /**
   * @param file - the JSON file to read and write; its directory is created.
   */
  constructor(file) {
    this.file = file;
    this.entries = new Map();
    this.error = undefined;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      for (const [key, value] of Object.entries(parsed?.sessions ?? {})) {
        if (value !== null && typeof value === 'object' && typeof value.sessionId === 'string') {
          this.entries.set(key, { sessionId: value.sessionId, cwd: value.cwd });
        }
      }
    } catch {
      // No store yet, or an unreadable one. Starting empty is the safe answer.
    }
  }

  /**
   * @param key - the caller's session key.
   * @returns `{ sessionId, cwd }`, or undefined.
   */
  get(key) {
    return this.entries.get(key);
  }

  /**
   * @param key - the caller's session key.
   * @param value - `{ sessionId, cwd }`.
   */
  set(key, value) {
    this.entries.set(key, value);
    this.#flush();
  }

  /** @param key - the caller's session key. */
  forget(key) {
    if (this.entries.delete(key)) this.#flush();
  }

  /** Write the store back, recording rather than throwing on failure. */
  #flush() {
    if (this.file === undefined) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, `${JSON.stringify({ version: 1, sessions: Object.fromEntries(this.entries) }, null, 2)}\n`);
      this.error = undefined;
    } catch (error) {
      this.error = String(error?.message ?? error);
    }
  }
}

/**
 * One external agent: its child process, its ACP session, and the request
 * bookkeeping that connects the two.
 *
 * A connection is lazy — nothing spawns until the first prompt — and long
 * lived, because starting an agent is expensive (Devin, for instance, connects
 * every MCP server it knows about before `session/new` settles).
 */
export class AcpConnection {
  /**
   * @param options - resolved agent settings.
   */
  constructor(options) {
    this.id = options.id;
    this.label = options.label ?? options.id;
    this.command = options.command;
    this.args = options.args ?? [];
    this.cwd = options.cwd ?? process.cwd();
    this.env = options.env ?? {};
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 1_800_000;
    /**
     * How long a prompt may go *silent* before it is abandoned and cancelled.
     * Restarted by every update, so a turn that keeps making progress is never
     * cut off — a fixed total budget cannot tell a long task from a hung one, and
     * five minutes was short enough to kill ordinary agentic work mid-edit.
     */
    this.idleTimeoutMs = Number.isFinite(options.idleTimeoutMs) ? options.idleTimeoutMs : 300_000;
    // Reading a catalogue happens while a user waits for a picker to open, so it
    // is bounded far more tightly than a turn is: an unresponsive agent yields an
    // empty group instead of a stalled menu.
    this.catalogueTimeoutMs = Number.isFinite(options.catalogueTimeoutMs) ? options.catalogueTimeoutMs : 20_000;
    /**
     * MCP servers to hand this agent when it opens a session, per harness session
     * key. This is how the delegation bridge reaches an external agent: the agent
     * spawns the shim, the shim relays to this plugin.
     */
    this.mcpServersProvider = typeof options.mcpServersProvider === 'function'
      ? options.mcpServersProvider
      : () => [];
    /** In-flight session creation, so concurrent callers share one ACP session. */
    this.creating = new Map();
    this.approval = options.approval ?? 'allow';
    this.maxTranscript = Number.isFinite(options.maxTranscript) ? options.maxTranscript : 400;
    /** How many post-turn updates to keep for `pending`. */
    this.maxLate = Number.isFinite(options.maxLate) ? options.maxLate : 50;
    this.logger = options.logger;
    /** Durable key → ACP session map, so a reload resumes instead of restarting. */
    this.sessionStore = options.sessionStore;
    /**
     * The workspace each key was last known to be in. Held across a child
     * restart, and seeded from the store, so a turn that cannot resolve a
     * workspace reuses the one already learned instead of "moving" the agent and
     * tearing its conversation down.
     */
    this.knownCwd = new Map();

    this.state = 'idle';
    this.detail = 'not started';
    this.child = null;
    /**
     * ACP sessions carried by this one connection, keyed by the caller's own
     * key. ACP runs several sessions per connection independently, so one child
     * process can serve many DSH sessions without them sharing context.
     */
    this.sessions = new Map();
    /** ACP session id → the caller's key, for routing updates back. */
    this.byAcpId = new Map();

    this.#nextId = 1;
    this.#pending = new Map();
    this.#buffer = '';
  }

  /** The default session's ACP id, for callers that keep a single session. */
  get sessionId() {
    return this.sessions.get(DEFAULT_KEY)?.sessionId ?? null;
  }

  /** The default session's transcript. */
  get transcript() {
    return this.sessions.get(DEFAULT_KEY)?.transcript ?? [];
  }

  /** The default session's permission decisions. */
  get permissions() {
    return this.sessions.get(DEFAULT_KEY)?.permissions ?? [];
  }

  #nextId;
  #pending;
  #buffer;

  /**
   * Start the child and complete the ACP handshake once.
   * @returns this connection, ready for a prompt.
   */
  async start() {
    if (this.state === 'ready') return this;
    if (this.state === 'starting') {
      await this.#started;
      return this;
    }
    if (this.state === 'disposed') throw new Error(`agent "${this.id}" was disposed`);

    const resolved = findCommand(this.command);
    if (resolved === null) {
      this.state = 'failed';
      this.detail = `command not found: ${this.command}`;
      throw new Error(this.detail);
    }

    this.state = 'starting';
    this.detail = 'starting';
    // A new child knows nothing of the sessions the previous one held, so the
    // in-memory records must not survive it. The durable store does, which is
    // what lets `ensureSession` resume the conversation instead of starting a
    // new one — the difference between an agent that remembers and one that
    // looks like it has forgotten everything.
    this.sessions.clear();
    this.byAcpId.clear();
    // `knownCwd` deliberately survives: it is what a child restart must not lose.
    note(`[${this.id}] spawning ${resolved} (build ${PLUGIN_BUILD})`);
    this.child = spawn(resolved, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.on('error', (error) => this.#fail(error));
    this.child.on('exit', (code, signal) => {
      if (this.state === 'disposed') return;
      this.#fail(new Error(`agent "${this.id}" exited (code=${code} signal=${signal})`));
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.#ingest(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text.length > 0) this.logger?.debug?.(`external-agents[${this.id}]: ${text.slice(0, 400)}`);
    });

    this.#started = (async () => {
      // Keep what the agent said about itself: which session-lifecycle methods
      // it supports is the difference between resuming a conversation and
      // silently starting a new one.
      this.abilities = await this.#request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      });
      this.state = 'ready';
      this.detail = 'ready';
    })();
    await this.#started;
    return this;
  }

  #started = null;

  /**
   * Adopt an ACP session that already exists, so a conversation survives the
   * process that opened it.
   *
   * Two methods can do this and an agent may offer either, so both are tried in
   * order of specificity: `session/resume` (gated by
   * `sessionCapabilities.resume`) restores a session without replay, and
   * `session/load` (gated by `loadSession`) is the older path, which replays the
   * history to the client — harmless here, because a session being adopted has no
   * update sink yet, so the replay is discarded rather than shown twice.
   *
   * ACP fixes `cwd` at session creation, so the adopted session is verified
   * against the directory being asked for; a mismatch is refused rather than
   * silently continuing someone else's session in the wrong tree.
   *
   * @param sessionId - the ACP session id to adopt.
   * @param cwd - the workspace it must belong to.
   * @param key - the caller's session key.
   * @param timeoutMs - how long the agent may take to answer.
   * @returns the session record.
   */
  async resumeSession(sessionId, cwd, key = DEFAULT_KEY, timeoutMs = this.timeoutMs) {
    await this.start();
    const wanted = resolve(cwd ?? this.cwd);
    const existing = this.sessions.get(key);
    if (existing !== undefined) return existing;

    // The initialize result nests these under `agentCapabilities`; reading them
    // from the top level makes every agent look incapable of resuming.
    const capabilities = this.abilities?.agentCapabilities ?? {};
    const canResume = capabilities.sessionCapabilities?.resume !== undefined;
    const canLoad = capabilities.loadSession === true;
    if (!canResume && !canLoad) {
      throw new Error(`agent "${this.id}" supports neither session/resume nor session/load`);
    }
    const method = canResume ? 'session/resume' : 'session/load';
    const result = await this.#request(method, {
      sessionId,
      cwd: wanted,
      mcpServers: await this.mcpServersProvider(key),
    }, timeoutMs);
    const session = {
      // `session/load` may answer with the id it adopted; `session/resume`
      // echoes the request.
      sessionId: typeof result?.sessionId === 'string' && result.sessionId.length > 0 ? result.sessionId : sessionId,
      cwd: wanted,
      configOptions: Array.isArray(result?.configOptions) ? result.configOptions : [],
      modes: result?.modes,
      transcript: [],
      sink: null,
      permission: null,
      permissions: [],
      // A resumed session already carries its own history, so there is nothing
      // to catch it up on.
      primed: true,
      late: [],
    };
    this.sessions.set(key, session);
    this.byAcpId.set(sessionId, key);
    this.detail = `resumed ${sessionId}`;
    return session;
  }

  /**
   * Ensure an ACP session exists for one key and working directory.
   *
   * ACP fixes `cwd` at session creation, so a changed directory means a new
   * session. That makes the directory load-bearing, and the important detail is
   * that a caller which *cannot tell* what the workspace is must not be allowed
   * to look like a caller that moved: a `cwd` of `undefined` means "unknown", and
   * unknown falls back to the workspace this key already used — in memory, then
   * on disk — before it falls back to the configured default.
   *
   * Without that distinction the two cases are indistinguishable, and every turn
   * that failed to resolve a workspace would "move" the agent, close its session
   * and start a fresh conversation. That is a silent, per-turn context loss.
   *
   * @param cwd - the workspace, or undefined when the caller cannot tell.
   * @param key - the caller's session key.
   * @returns the session record, including the agent's configuration options.
   */
  async ensureSession(cwd, key = DEFAULT_KEY, timeoutMs = this.timeoutMs) {
    // Two callers can ask for the same session at once — a turn and the harness's
    // session-title request do exactly that — and each used to open its own ACP
    // session, leaving one of them holding a conversation with zero updates. One
    // creation per key, with the others waiting on it.
    const inFlight = this.creating.get(key);
    if (inFlight !== undefined) return inFlight;
    const created = this.#createSession(cwd, key, timeoutMs).finally(() => this.creating.delete(key));
    this.creating.set(key, created);
    return created;
  }

  /**
   * The single creation path behind {@link ensureSession}.
   * @param cwd - requested working directory, or undefined.
   * @param key - harness session key.
   * @param timeoutMs - bound on `session/new`.
   * @returns the session record.
   */
  async #createSession(cwd, key, timeoutMs) {
    await this.start();
    const remembered = this.sessionStore?.get(key);
    const known = this.knownCwd.get(key) ?? remembered?.cwd;
    const asked = cwd === undefined ? undefined : resolve(cwd);
    const wanted = asked ?? known ?? resolve(this.cwd);
    const moved = asked !== undefined && known !== undefined && asked !== known;

    const existing = this.sessions.get(key);
    note(
      `[${this.id}] ensure key=${key} asked=${asked ?? '(unknown)'} known=${known ?? '(none)'} `
      + `wanted=${wanted} existing=${existing?.cwd ?? '(none)'}${moved ? ' MOVED' : ''}`,
    );
    if (moved) {
      // ACP fixes cwd at session creation, so this is the one case where a
      // conversation genuinely cannot continue. Say so loudly, because the
      // symptom otherwise is an agent that quietly forgot everything.
      this.logger?.warn?.(
        `external-agents[${this.id}]: workspace for "${key}" moved from "${known}" to "${asked}"; `
        + `an ACP session cannot change directory, so the agent starts a new conversation`,
      );
    }
    if (existing !== undefined && existing.cwd === wanted) {
      this.knownCwd.set(key, wanted);
      return existing;
    }
    if (existing !== undefined) await this.closeSession(key);

    // A conversation this key had before is worth more than a fresh one. This is
    // what makes context survive a plugin reload or an app restart; without it
    // the agent simply starts over and reads as if it had forgotten everything.
    if (remembered !== undefined && remembered.sessionId !== undefined && remembered.cwd === wanted) {
      try {
        const resumed = await this.resumeSession(remembered.sessionId, wanted, key, timeoutMs);
        this.knownCwd.set(key, wanted);
        note(`[${this.id}] RESUME ok key=${key} session=${remembered.sessionId} cwd=${wanted}`);
        this.logger?.debug?.(`external-agents[${this.id}]: resumed ${remembered.sessionId} for "${key}"`);
        return resumed;
      } catch (error) {
        note(`[${this.id}] RESUME failed key=${key} session=${remembered.sessionId} error=${String(error?.message ?? error)}`);
        this.logger?.warn?.(
          `external-agents[${this.id}]: could not resume session ${remembered.sessionId} for "${key}" `
          + `(${String(error?.message ?? error)}); starting a new one`,
        );
        this.sessionStore?.forget(key);
      }
    }

    const result = await this.#request('session/new', { cwd: wanted, mcpServers: await this.mcpServersProvider(key) }, timeoutMs);
    const session = {
      sessionId: result?.sessionId ?? null,
      cwd: wanted,
      // The agent's own selectors: `session/new` returns them, and the `model`
      // category is what feeds the harness's model picker.
      configOptions: Array.isArray(result?.configOptions) ? result.configOptions : [],
      modes: result?.modes,
      transcript: [],
      sink: null,
      /** Per-turn permission handler, when the caller supplied one. */
      permission: null,
      permissions: [],
      /**
       * Whether the agent already knows the conversation this session belongs
       * to. A brand-new session knows nothing, and the harness may be holding a
       * transcript it does not — a **fork** inherits a prefix of the parent's
       * history, so the UI shows the conversation while the agent has never seen
       * it. The first turn catches it up.
       */
      primed: false,
      late: [],
    };
    if (session.sessionId === null) throw new Error(`agent "${this.id}" returned no session id`);
    note(`[${this.id}] NEW key=${key} session=${session.sessionId} cwd=${wanted}`);
    this.sessions.set(key, session);
    this.byAcpId.set(session.sessionId, key);
    this.knownCwd.set(key, wanted);
    // Remember it, so the next process can pick this conversation back up.
    this.sessionStore?.set(key, { sessionId: session.sessionId, cwd: wanted });
    return session;
  }

  /**
   * The agent's advertised configuration option in one category.
   * @param key - the caller's session key.
   * @param category - an ACP config category, such as `model` or `mode`.
   * @returns the option, or undefined when the agent declares none.
   */
  option(key, category) {
    return (this.sessions.get(key)?.configOptions ?? []).find((entry) => entry?.category === category);
  }

  /**
   * The models the agent advertises, flattened from ACP's option groups.
   * @param key - the caller's session key.
   * @returns `{ value, name, description }` entries in the agent's own order.
   */
  modelOptions(key) {
    return selectValues(this.option(key, 'model'));
  }

  /**
   * The agent's own display name for a model value.
   * @param model - a model value the agent advertised.
   * @returns the display name, or null when this agent never advertised it.
   */
  modelName(model) {
    for (const session of this.sessions.values()) {
      const found = selectValues(session.configOptions.find((entry) => entry?.category === 'model'))
        .find((entry) => entry.value === model);
      if (found !== undefined) return found.name;
    }
    return null;
  }

  /**
   * Read the agent's model catalogue, opening the reserved catalogue session if
   * needed. Opening a session is the only way to learn an ACP agent's models:
   * they arrive with `session/new`, not with `initialize`.
   *
   * @param cwd - the workspace to open the catalogue session in.
   * @returns the agent's model entries.
   */
  async catalogueModels(cwd) {
    const session = await this.ensureSession(cwd, CATALOGUE_KEY, this.catalogueTimeoutMs);
    return selectValues(session.configOptions.find((entry) => entry?.category === 'model'));
  }

  /**
   * Write one of the agent's configuration options, so a choice made in the
   * harness's picker becomes a choice made in the agent.
   *
   * @param key - the caller's session key.
   * @param configId - the option id, such as `model`.
   * @param value - the value to select.
   * @returns the option after the change, or undefined when it is not advertised.
   */
  async selectOption(key, configId, value) {
    const session = this.sessions.get(key);
    if (session === undefined) return undefined;
    const option = session.configOptions.find((entry) => entry?.id === configId);
    if (option === undefined) return undefined;
    if (option.currentValue === value) return option;
    // Never send a value the agent does not offer: an unadvertised model would
    // fail the protocol call, and one bad model choice should not fail a turn.
    const advertised = selectValues(option);
    if (advertised.length > 0 && !advertised.some((entry) => entry.value === value)) {
      this.logger?.warn?.(`external-agents[${this.id}]: the agent does not offer "${configId}" value "${value}"; keeping "${option.currentValue}"`);
      return undefined;
    }
    const result = await this.#request('session/set_config_option', {
      sessionId: session.sessionId,
      configId,
      value,
    }, 30_000);
    if (Array.isArray(result?.configOptions)) session.configOptions = result.configOptions;
    else option.currentValue = value;
    return session.configOptions.find((entry) => entry?.id === configId);
  }

  /**
   * Send one prompt and wait for the turn to settle.
   *
   * @param text - the task for the external agent.
   * @param options - `cwd`, `timeoutMs`, an update sink, and an abort signal.
   * @returns the assistant text, every update, and the ACP stop reason.
   */
  async prompt(text, options = {}) {
    const key = options.key ?? DEFAULT_KEY;
    const session = await this.ensureSession(options.cwd, key);
    const previous = session.sink;
    const previousPermission = session.permission;
    // A new turn supersedes anything the agent said after the previous one.
    session.late = [];
    const updates = [];
    const firstPermission = session.permissions.length;
    session.sink = (update) => {
      // Only this turn's updates belong to this prompt: a session carries
      // several prompts, and an earlier turn's text is not this call's answer.
      updates.push(update);
      session.transcript.push(update);
      if (session.transcript.length > this.maxTranscript) session.transcript.shift();
      options.onUpdate?.(update);
    };
    // A caller may decide this turn's permission requests — that is how a choice
    // reaches the harness's own approval seam. Without one the static policy
    // below answers instead.
    session.permission = typeof options.onPermission === 'function' ? options.onPermission : null;
    try {
      // A turn may carry images as well as text; ACP takes one ordered block list.
      const promptBlocks = Array.isArray(options.blocks) && options.blocks.length > 0
        ? options.blocks
        : [{ type: 'text', text }];
      const response = await this.#request(
        'session/prompt',
        { sessionId: session.sessionId, prompt: promptBlocks },
        // A prompt is bounded by *silence*, not by elapsed time: the timer is
        // restarted by every update the agent sends. An explicit `timeoutMs` is
        // honoured as that same budget, so callers that predate the split — the
        // delegation tool, and any config already setting it — keep meaning what
        // they meant.
        options.idleTimeoutMs ?? options.timeoutMs ?? this.idleTimeoutMs,
        options.signal,
        {
          onIssue: (id) => { session.promptId = id; },
          onTimeout: () => this.cancel(key),
        },
      );
      return {
        text: textOf(updates),
        updates,
        stopReason: response?.stopReason ?? 'end_turn',
        // ACP's `usage` is marked unstable and most agents omit it, but when it is
        // there it carries the provider's real counts — including cache reads.
        usage: response?.usage,
        permissions: session.permissions.slice(firstPermission),
      };
    } finally {
      session.sink = previous;
      session.permission = previousPermission;
      session.promptId = undefined;
    }
  }

  /**
   * Ask the agent to stop the turn in flight.
   * @param key - the caller's session key.
   * @returns nothing; cancellation is best effort by protocol.
   */
  cancel(key = DEFAULT_KEY) {
    const session = this.sessions.get(key);
    if (this.child === null || session === undefined) return;
    this.#notify('session/cancel', { sessionId: session.sessionId });
  }

  /**
   * Record that the agent has been told the conversation's history, so the
   * catch-up is sent once per session rather than every turn.
   *
   * @param key - the caller's session key.
   * @returns nothing.
   */
  /**
   * What the agent said after its turn ended, and before the next one began.
   * @param key - the caller's session key.
   * @returns the retained updates, oldest first.
   */
  lateUpdates(key = DEFAULT_KEY) {
    return this.sessions.get(key)?.late ?? [];
  }

  markPrimed(key = DEFAULT_KEY) {
    const session = this.sessions.get(key);
    if (session !== undefined) session.primed = true;
  }

  /**
   * Close one ACP session but keep the child alive.
   * @param key - the caller's session key.
   * @returns nothing.
   */
  async closeSession(key = DEFAULT_KEY) {
    const session = this.sessions.get(key);
    if (session === undefined) return;
    this.sessions.delete(key);
    this.byAcpId.delete(session.sessionId);
    // Deliberately closed, so do not offer to resume it later.
    this.sessionStore?.forget(key);
    try {
      await this.#request('session/close', { sessionId: session.sessionId }, 10_000);
    } catch {
      // A session that cannot close cleanly is not worth failing a prompt for.
    }
  }

  /**
   * Concatenate the assistant's text chunks from a session's transcript.
   * @param key - the caller's session key.
   * @returns the assistant text so far.
   */
  text(key = DEFAULT_KEY) {
    return textOf(this.sessions.get(key)?.transcript ?? []);
  }

  /**
   * Terminate the child and reject everything still in flight.
   * @returns nothing.
   */
  dispose() {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    this.detail = 'disposed';
    const child = this.child;
    this.child = null;
    if (child !== null) {
      try {
        child.kill('SIGTERM');
        const kill = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Already gone.
          }
        }, 2_000);
        if (typeof kill.unref === 'function') kill.unref();
      } catch {
        // Already gone.
      }
    }
    this.#fail(new Error(`agent "${this.id}" was disposed`));
  }

  /** @returns a compact status record for the list action. */
  describe() {
    const session = this.sessions.get(DEFAULT_KEY);
    return {
      id: this.id,
      label: this.label,
      command: this.command,
      args: this.args,
      state: this.state,
      detail: this.detail,
      sessionId: session?.sessionId ?? null,
      sessions: this.sessions.size,
      cwd: session?.cwd ?? null,
      permissions: this.permissions.length,
      // What arrived after a turn ended, across sessions; surfaced by `list`.
      late: [...this.sessions.values()].reduce((total, entry) => total + (entry.late?.length ?? 0), 0),
    };
  }

  /**
   * Record a protocol or process failure against every waiting request.
   * @param error - the failure to propagate.
   */
  #fail(error) {
    if (this.state !== 'disposed') {
      this.state = 'failed';
      this.detail = String(error?.message ?? error);
    }
    for (const [, entry] of this.#pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.#pending.clear();
  }

  /**
   * Split a stdout chunk into newline-delimited JSON-RPC frames.
   * @param chunk - text received from the child.
   */
  #ingest(chunk) {
    this.#buffer += chunk;
    let index;
    while ((index = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, index).trim();
      this.#buffer = this.#buffer.slice(index + 1);
      if (line.length === 0) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.logger?.debug?.(`external-agents[${this.id}]: non-JSON stdout: ${line.slice(0, 200)}`);
        continue;
      }
      this.#dispatch(message);
    }
  }

  /**
   * Route one decoded frame: a response, a server request, or a notification.
   * @param message - the decoded JSON-RPC frame.
   */
  #dispatch(message) {
    if (message?.id !== undefined && message.method === undefined) {
      const entry = this.#pending.get(message.id);
      if (entry === undefined) return;
      this.#pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error !== undefined) entry.reject(new Error(`${entry.method}: ${message.error.message ?? JSON.stringify(message.error)}`));
      else entry.resolve(message.result);
      return;
    }
    if (message?.method === undefined) return;
    if (message.id !== undefined) {
      void this.#answer(message);
      return;
    }
    this.#notifyIn(message.method, message.params);
  }

  /**
   * Answer a request the agent addressed to this client.
   * @param message - the decoded request frame.
   */
  async #answer(message) {
    if (message.method === 'session/request_permission') {
      const outcome = await this.#decidePermission(message.params);
      this.#reply(message.id, { outcome });
      return;
    }
    this.#reply(message.id, undefined, { code: -32601, message: `unsupported client method: ${message.method}` });
  }

  /**
   * Choose a permission outcome under the configured policy.
   *
   * The choice is recorded, because in `allow` mode this is the only place a
   * user can later see what the external agent was permitted to do.
   *
   * @param params - the `session/request_permission` parameters.
   * @returns the ACP outcome object.
   */
  async #decidePermission(params) {
    const options = Array.isArray(params?.options) ? params.options : [];
    const title = params?.toolCall?.title ?? 'a tool call';
    // Permission decisions belong to the session that asked, not to whichever
    // session happens to be driving right now.
    const session = this.sessions.get(this.byAcpId.get(params?.sessionId));
    const records = session?.permissions ?? [];

    // A per-turn handler takes precedence: that is how a decision reaches the
    // harness's own approval seam. It may decline to answer, in which case the
    // static policy below applies.
    const handler = session?.permission;
    if (typeof handler === 'function') {
      try {
        const outcome = await handler(params, { title, options });
        if (outcome !== undefined && outcome !== null) {
          records.push({ title, decision: outcome.outcome ?? 'selected', optionId: outcome.optionId });
          return outcome;
        }
      } catch (error) {
        this.logger?.warn?.(`external-agents[${this.id}]: permission handler failed, refusing "${title}": ${String(error?.message ?? error)}`);
        records.push({ title, decision: 'cancelled', reason: 'handler failed' });
        return { outcome: 'cancelled' };
      }
    }
    return this.#policyPermission(options, records, title);
  }

  /**
   * Answer under the configured static policy, failing closed.
   *
   * If no option matches the policy the request is cancelled. It is never
   * answered with "whatever was offered first": that fallback once selected
   * `allow-with-updates` while the policy was `deny`, and let an agent write the
   * file it had been told not to write.
   *
   * @param options - the options the agent offered.
   * @param records - the session's decision log.
   * @param title - what the agent wants to do.
   * @returns the ACP outcome object.
   */
  #policyPermission(options, records, title) {
    const want = this.approval === 'deny' ? 'reject' : this.approval === 'allow' ? 'allow' : 'cancel';
    if (want === 'cancel') {
      records.push({ title, decision: 'cancelled' });
      return { outcome: 'cancelled' };
    }
    const chosen = pickOption(options, want);
    if (chosen === undefined) {
      records.push({ title, decision: 'cancelled', reason: `no "${want}" option was offered` });
      this.logger?.warn?.(`external-agents[${this.id}]: policy "${this.approval}" found no ${want} option for "${title}"; cancelling`);
      return { outcome: 'cancelled' };
    }
    const decision = want === 'allow' ? 'allowed' : 'denied';
    records.push({ title, decision, optionId: chosen.optionId });
    this.logger?.debug?.(`external-agents[${this.id}]: ${decision} permission for ${title}`);
    return { outcome: 'selected', optionId: chosen.optionId };
  }

  /**
   * Handle a notification addressed to this client, routing it to the session
   * it names.
   * @param method - the notification method.
   * @param params - its parameters.
   */
  #notifyIn(method, params) {
    if (method !== 'session/update') return;
    const update = params?.update;
    if (update === undefined) return;
    const key = this.byAcpId.get(params?.sessionId);
    if (key === undefined) return;
    // Any update means the agent is working, so the wait restarts. A timeout has
    // to measure *silence*, not elapsed time: real agentic turns routinely run
    // longer than any fixed budget worth setting, and a total-timeout kills them
    // mid-task while they are still making progress.
    this.#touch(key);
    const session = this.sessions.get(key);
    if (session === undefined) return;
    if (typeof session.sink === 'function') {
      session.sink(update);
      return;
    }
    // The turn is over. ACP has no way to deliver an unsolicited message into a
    // finished harness turn, so anything the agent says now would otherwise be
    // dropped — which is exactly why an agent that says "I'll let you know when
    // this finishes", and then does, looks silent until you poke it.
    this.#recordLate(session, update);
  }

  /**
   * Keep something the agent said after its turn ended.
   *
   * This cannot reopen the turn — only a new prompt can — but it turns a silent
   * loss into something the user can read, and it is what `/external-agents
   * pending` reports.
   *
   * @param session - the session record.
   * @param update - the ACP `session/update` payload.
   * @returns nothing.
   */
  #recordLate(session, update) {
    const line = renderUpdate(update);
    // Tool chatter and empty chunks are not worth a notification.
    if (line.length === 0) return;
    session.late.push({ at: Date.now(), kind: update.sessionUpdate, text: line });
    if (session.late.length > this.maxLate) session.late.shift();
    note(`[${this.id}] late update after the turn ended (${update.sessionUpdate}): ${line.slice(0, 120)}`);
    this.detail = 'the agent spoke after its turn ended';
  }

  /**
   * Restart the wait for the prompt in flight on one session.
   * @param key - the caller's session key.
   * @returns nothing.
   */
  #touch(key) {
    const session = this.sessions.get(key);
    if (session?.promptId === undefined) return;
    const entry = this.#pending.get(session.promptId);
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      this.#pending.delete(session.promptId);
      session.promptId = undefined;
      this.cancel(key);
      entry.reject(new Error(`session/prompt timed out after ${entry.timeoutMs}ms of silence`));
    }, entry.timeoutMs);
    if (typeof entry.timer.unref === 'function') entry.timer.unref();
  }

  /**
   * Issue a request and await its response.
   * @param method - the ACP method.
   * @param params - its parameters.
   * @param timeoutMs - how long to wait.
   * @param signal - an optional abort signal.
   * @returns the response result.
   */
  #request(method, params, timeoutMs = this.timeoutMs, signal, hooks) {
    const child = this.child;
    if (child === null || child.stdin.destroyed) return Promise.reject(new Error(`agent "${this.id}" is not running`));
    const id = this.#nextId++;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        // A prompt that times out leaves the agent still working, and an ACP
        // session runs one prompt at a time — so failing to cancel it is what
        // makes the *next* prompt fail as well.
        hooks?.onTimeout?.();
        // A prompt waits on *silence*; say so, so the message does not read like
        // a total budget that was exceeded while the agent was busy working.
        rejectPromise(new Error(hooks?.onTimeout === undefined
          ? `${method} timed out after ${timeoutMs}ms`
          : `${method} timed out after ${timeoutMs}ms of silence`));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      this.#pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer, method, timeoutMs });
      hooks?.onIssue?.(id);
      if (signal !== undefined) {
        if (signal.aborted) {
          clearTimeout(timer);
          this.#pending.delete(id);
          rejectPromise(new Error(`${method} aborted`));
          return;
        }
        signal.addEventListener('abort', () => {
          const entry = this.#pending.get(id);
          if (entry === undefined) return;
          clearTimeout(timer);
          this.#pending.delete(id);
          this.cancel();
          rejectPromise(new Error(`${method} aborted`));
        }, { once: true });
      }
      this.#write({ jsonrpc: '2.0', id, method, params });
    });
  }

  /**
   * Write a frame to the child.
   * @param message - the frame to send.
   */
  #write(message) {
    try {
      this.child?.stdin.write(`${JSON.stringify(message)}\n`);
    } catch (error) {
      this.#fail(error);
    }
  }

  /**
   * Send a notification to the agent.
   * @param method - the notification method.
   * @param params - its parameters.
   */
  #notify(method, params) {
    this.#write({ jsonrpc: '2.0', method, params });
  }

  /**
   * Answer an agent request.
   * @param id - the request id being answered.
   * @param result - the success payload.
   * @param error - the failure payload, when there is no result.
   */
  #reply(id, result, error) {
    this.#write(error === undefined
      ? { jsonrpc: '2.0', id, result: result ?? {} }
      : { jsonrpc: '2.0', id, error });
  }
}

/**
 * The set of configured external agents, created lazily and addressed by slug.
 */
export class AgentRegistry {
  /**
   * @param settings - normalized plugin settings.
   * @param logger - an optional Harness logger.
   */
  constructor(settings, logger) {
    this.settings = settings;
    this.logger = logger;
    this.connections = new Map();
    for (const agent of settings.agents) {
      // An agent's credential store lives in its XDG data directory, so
      // redirecting XDG is an isolation choice with a real cost: the agent
      // will look logged out until it signs in again in the new location.
      // Off by default, which leaves every agent on its normal home.
      const redirected = settings.xdgRoot === null
        ? {}
        : xdgEnv(join(resolve(expandHome(settings.xdgRoot)), agent.id));
      this.connections.set(agent.id, new AcpConnection({
        ...agent,
        maxTranscript: settings.maxTranscript,
        catalogueTimeoutMs: settings.catalogueTimeoutMs,
        idleTimeoutMs: settings.idleTimeoutMs,
        logger,
        // One store per agent: the ids are the agent's own, and combining them
        // would let one agent's id be offered to another.
        sessionStore: settings.persistSessions
          ? new SessionStore(join(resolve(expandHome(settings.sessionStoreDir)), `${agent.id}.json`))
          : undefined,
        env: buildEnv(settings.envMode, { ...redirected, ...agent.env }, settings.allowAnthropicRouting),
      }));
    }
  }

  /** @returns every configured agent, as status records. */
  list() {
    return [...this.connections.values()].map((connection) => connection.describe());
  }

  /**
   * Resolve an agent by slug, label, or unique fragment.
   * @param reference - what the caller called the agent.
   * @returns the connection.
   */
  resolve(reference) {
    const wanted = String(reference ?? '').trim().toLowerCase();
    if (wanted.length === 0) throw new Error('an agent id is required');
    const exact = this.connections.get(wanted);
    if (exact !== undefined) return exact;
    const matches = [...this.connections.values()].filter((connection) =>
      connection.id.toLowerCase().includes(wanted) || connection.label.toLowerCase().includes(wanted));
    if (matches.length === 1) return matches[0];
    if (matches.length === 0) {
      throw new Error(`no external agent matches "${reference}". Configured: ${[...this.connections.keys()].join(', ') || '(none)'}`);
    }
    throw new Error(`"${reference}" matches ${matches.map((match) => match.id).join(', ')}; name one exactly`);
  }

  /**
   * Run one prompt against one agent.
   * @param reference - which agent.
   * @param text - the task.
   * @param options - `cwd`, `timeoutMs`, `signal`, `onUpdate`.
   * @returns the agent's result plus its identity.
   */
  async ask(reference, text, options = {}) {
    const connection = this.resolve(reference);
    const result = await connection.prompt(text, options);
    return { agent: connection.id, label: connection.label, ...result };
  }

  /**
   * Terminate one agent, or every agent when no reference is given.
   * @param reference - which agent to stop.
   * @returns the ids that were stopped.
   */
  close(reference) {
    if (reference === undefined || String(reference).trim().length === 0) {
      const ids = [...this.connections.keys()];
      this.disposeAll();
      return ids;
    }
    const connection = this.resolve(reference);
    connection.dispose();
    return [connection.id];
  }

  /** @returns nothing; terminates every child. */
  disposeAll() {
    for (const connection of this.connections.values()) connection.dispose();
  }
}

/**
 * Flatten an ACP select option's values, following one level of groups.
 *
 * ACP lets an agent return either a flat list of values or a list of named
 * groups, so both shapes have to reach the picker as one flat list.
 *
 * @param option - a `SessionConfigOption` of type `select`.
 * @returns `{ value, name, description }` entries.
 */
export function selectValues(option) {
  if (option === null || typeof option !== 'object' || option.type !== 'select') return [];
  const options = Array.isArray(option.options) ? option.options : [];
  const values = [];
  for (const entry of options) {
    if (entry !== null && typeof entry === 'object' && Array.isArray(entry.options)) {
      for (const nested of entry.options) {
        if (nested?.value === undefined) continue;
        values.push({ value: nested.value, name: nested.name ?? nested.value, description: nested.description });
      }
      continue;
    }
    if (entry?.value === undefined) continue;
    values.push({ value: entry.value, name: entry.name ?? entry.value, description: entry.description });
  }
  return values;
}

/**
 * Concatenate the assistant's text chunks from a list of updates.
 * @param updates - ACP session updates.
 * @returns the assistant text they carry.
 */
export function textOf(updates) {
  let out = '';
  for (const update of updates) {
    if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
      out += update.content.text;
    }
  }
  return out;
}

/**
 * Render one ACP update as a single transcript line.
 * @param update - the ACP session update.
 * @returns a line of text, or an empty string for updates not worth showing.
 */
export function renderUpdate(update) {
  switch (update?.sessionUpdate) {
    case 'agent_message_chunk':
      return update.content?.type === 'text' ? update.content.text : `[${update.content?.type ?? 'content'}]`;
    case 'agent_thought_chunk':
      return update.content?.type === 'text' ? `· ${update.content.text}` : '';
    case 'tool_call':
      return `→ ${update.title ?? update.toolCallId ?? 'tool call'} (${update.status ?? 'pending'})`;
    case 'tool_call_update':
      return update.status === undefined ? '' : `→ ${update.toolCallId ?? 'tool call'}: ${update.status}`;
    case 'plan':
      return '· plan updated';
    case 'user_message_chunk':
      return '';
    default:
      return '';
  }
}

/**
 * Render a list of connections as text.
 * @param registry - the registry to describe.
 * @returns a multi-line report.
 */
function listText(registry) {
  const agents = registry.list();
  if (agents.length === 0) {
    return 'No external agents are configured. Set `agents` in the external-agents config, or enable `discover` and install an ACP agent.';
  }
  return agents.map((agent) => {
    const args = agent.args.length > 0 ? ` ${agent.args.join(' ')}` : '';
    const session = agent.sessionId === null ? '' : `  session=${agent.sessionId}`;
    const late = agent.late > 0 ? `  ${agent.late} pending` : '';
    const sessions = agent.sessions > 1 ? `  sessions=${agent.sessions}` : '';
    return `${agent.state.padEnd(9)} ${agent.id.padEnd(10)} ${agent.label}  (${agent.command}${args})  ${agent.detail}${session}${sessions}${late}`;
  }).join('\n');
}

/**
 * Render one agent result as the text a model or a user reads.
 * @param result - the registry's result.
 * @returns a formatted transcript.
 */
export function resultText(result) {
  const lines = [`${result.label} (${result.agent}) — ${STOP_REASONS[result.stopReason] ?? result.stopReason}`];
  let lastKind = null;
  for (const update of result.updates) {
    const line = renderUpdate(update);
    if (line.length === 0) continue;
    if (update.sessionUpdate !== lastKind) {
      if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') lines.push('');
      lastKind = update.sessionUpdate;
    }
    lines.push(line);
  }
  if (result.text.trim().length === 0) lines.push('(no assistant text)');
  if (result.permissions.length > 0) {
    const granted = result.permissions.filter((entry) => entry.decision !== 'denied').length;
    lines.push('', `permissions: ${granted} allowed, ${result.permissions.length - granted} denied/cancelled`);
  }
  return lines.join('\n');
}

/**
 * Discover the agents to offer: explicit entries win, otherwise probe PATH for
 * the shipped catalog.
 *
 * @param config - the raw plugin config.
 * @returns resolved agent settings.
 */
export function resolveAgents(config) {
  const explicit = Array.isArray(config.agents) ? config.agents : [];
  if (explicit.length > 0) {
    return explicit
      .filter((agent) => agent !== null && typeof agent === 'object' && typeof agent.id === 'string')
      .map((agent) => ({
        id: agent.id,
        label: agent.label ?? agent.id,
        command: agent.command,
        args: Array.isArray(agent.args) ? agent.args : [],
        env: agent.env ?? {},
        cwd: agent.cwd,
        timeoutMs: agent.timeoutMs,
        approval: agent.approval,
        // The LLM provider route this agent is exposed under, which is what the
        // composer's picker groups by.
        llmProvider: typeof agent.llmProvider === 'string' && agent.llmProvider.length > 0
          ? agent.llmProvider
          : `acp-${agent.id}`,
        // What the picker shows: a curated list outright, or globs applied to
        // whatever the agent advertises.
        models: Array.isArray(agent.models) ? agent.models : [],
        instructions: typeof agent.instructions === 'string' ? agent.instructions : undefined,
        // How much transcript to hand a newly attached agent session.
        primeMaxChars: Number.isFinite(agent.primeMaxChars) ? agent.primeMaxChars : undefined,
        // Delegation bridge for this agent: `true`, or `{ provider, llmProvider, model }`.
        delegate: agent.delegate === true || (typeof agent.delegate === 'object' && agent.delegate !== null)
          ? agent.delegate
          : undefined,
        modelInclude: Array.isArray(agent.modelInclude) ? agent.modelInclude : [],
        modelExclude: Array.isArray(agent.modelExclude) ? agent.modelExclude : [],
      }));
  }
  if (config.discover === false) return [];
  const found = [];
  for (const entry of CATALOG) {
    for (const command of entry.commands) {
      const resolved = findCommand(command);
      if (resolved === null) continue;
      found.push({ id: entry.id, label: entry.label, command: resolved, args: entry.args, env: {}, llmProvider: `acp-${entry.id}`, discovered: true });
      break;
    }
  }
  return found;
}

/**
 * Normalize the row's config into settings.
 * @param config - the raw plugin config.
 * @returns resolved settings.
 */
function normalizeSettings(config) {
  return {
    agents: resolveAgents(config),
    envMode: config.envMode === 'inherit' ? 'inherit' : 'minimal',
    allowAnthropicRouting: config.allowAnthropicRouting === true,
    xdgRoot: typeof config.xdgRoot === 'string' && config.xdgRoot.trim().length > 0 ? config.xdgRoot.trim() : null,
    maxTranscript: Number.isFinite(config.maxTranscript) ? config.maxTranscript : 400,
    // The workspace an external agent is pointed at. Prefer the initiating
    // session's own directory at call time; this is the fallback.
    cwd: typeof config.cwd === 'string' && config.cwd.trim().length > 0 ? config.cwd.trim() : process.cwd(),
    // Which agents may appear in the model picker. Reading an ACP agent's model
    // catalogue means starting it and opening a session, so opening the picker
    // would otherwise launch every discovered agent at once. 'explicit' keeps
    // that to agents you actually listed; 'all' includes discovered ones.
    expose: config.expose === 'all' ? 'all' : 'explicit',
    // A picker is waiting on a catalogue read, so it must not wait long.
    catalogueTimeoutMs: Number.isFinite(config.catalogueTimeoutMs) ? config.catalogueTimeoutMs : 20_000,
    // How long a prompt may go silent before it is abandoned and cancelled.
    idleTimeoutMs: Number.isFinite(config.idleTimeoutMs) ? config.idleTimeoutMs : 300_000,
    // Remember which ACP session each conversation lives in, so a plugin reload
    // or an app restart resumes it instead of silently starting over.
    persistSessions: config.persistSessions !== false,
    sessionStoreDir: typeof config.sessionStoreDir === 'string' && config.sessionStoreDir.trim().length > 0
      ? config.sessionStoreDir.trim()
      : '~/.dsh/external-agents/sessions',
    // How much transcript to hand an agent that is attaching to a conversation it
    // did not start — a fork, a provider switch, or a turn another agent took.
    // Zero disables the catch-up; an agent then starts from the newest turn only.
    primeMaxChars: Number.isFinite(config.primeMaxChars) ? config.primeMaxChars : DEFAULT_PRIME_MAX_CHARS,
  };
}

/**
 * The workspace a DSH session runs in.
 *
 * The session's creation metadata is supplied as `ctx.sessions.create(id, {
 * meta: { cwd } })`, but that `meta` is only the *input*: the store validates it
 * and keeps it as the session **header**, which is why the answer is
 * `session.header.cwd`. Three other spellings were tried before reading the
 * package source, and every one of them silently resolved to the fallback —
 * the desktop harness is launched from its own profile directory, so a wrong
 * property here points every external agent at `~/.dsh/profiles/desktop`
 * instead of the user's project. That is invisible from the outside: the agent
 * simply reports the wrong working directory and looks broken.
 *
 * @param initiating - the live agent that started the turn, when known.
 * @param fallback - what to use when the session declares no workspace.
 * @returns an absolute working directory.
 */
export function sessionWorkspace(initiating, fallback) {
  const session = initiating?.session;
  return session?.header?.cwd
    ?? session?.meta?.cwd
    ?? session?.cwd
    ?? session?.metadata?.cwd
    ?? fallback;
}

/**
 * Host entry point.
 *
 * No service is declared as a hard dependency: the ACP client is Node-only, so
 * the plugin stays inert but loadable in a profile without `tools` or
 * `commands`, and picks those up through `ctx.inject`.
 *
 * @param ctx - the Host plugin context.
 * @param config - the row's `config` from the bundle patch.
 * @returns a disposer that terminates every external agent.
 */
export function apply(ctx, config = {}) {
  const settings = normalizeSettings(config);
  const registry = new AgentRegistry(settings, ctx.logger);
  note(`plugin loaded (build ${PLUGIN_BUILD}) with ${settings.agents.length} agent(s): ${settings.agents.map((a) => a.id).join(', ') || '(none)'}`);

  // The workspace of whichever session is driving right now. Read lazily and
  // defensively: `agents` may not be mounted yet when this plugin loads, and a
  // delegation outside any session has no session workspace to inherit.
  let warnedAboutWorkspace = false;
  const currentWorkspace = () => {
    try {
      const resolved = sessionWorkspace(ctx.agents?.currentInitiator?.() ?? null, settings.cwd);
      // A silent fallback here once sent every external agent to the harness's
      // own launch directory, which reads as "the agent is broken" rather than
      // "the agent is in the wrong place". Say so once.
      if (resolved === settings.cwd && !warnedAboutWorkspace) {
        warnedAboutWorkspace = true;
        ctx.logger?.warn?.(
          `external-agents: no session workspace was found, so external agents will run in `
          + `"${settings.cwd}" — the harness's own directory. Set \`cwd\` in this plugin's config if that is not what you want.`,
        );
      }
      return resolved;
    } catch {
      return settings.cwd;
    }
  };

  /**
   * The session key the picker path would use right now.
   *
   * The command path reads and writes the same ACP session the picker is using,
   * so a mode set here applies to the conversation the user is actually in
   * rather than to a detached one.
   *
   * @returns the DSH session id, or the default key outside a session.
   */
  const currentSessionKey = () => {
    try {
      return ctx.agents?.currentInitiator?.()?.session?.id ?? DEFAULT_KEY;
    } catch {
      return DEFAULT_KEY;
    }
  };

  /**
   * Say where an external agent will actually run, and whether that came from
   * the session.
   *
   * Surfaced by the `list` action on purpose. Getting this wrong is invisible
   * from the outside — the agent just reports a working directory that is not
   * the one the user opened — and asking the agent is a slow way to find out.
   *
   * @returns a one-line description of the resolved workspace.
   */
  const workspaceReport = () => {
    try {
      const declared = sessionWorkspace(ctx.agents?.currentInitiator?.() ?? null, undefined);
      return declared === undefined
        ? `${settings.cwd}  (FALLBACK — the session declared no workspace, so this is the harness's own directory)`
        : `${declared}  (from the session)`;
    } catch {
      return `${settings.cwd}  (FALLBACK — no initiating session)`;
    }
  };

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.effect(() => {
      try {
        const dispose = toolCtx.tools.register({
          name: 'external_agents',
          description: [
            'Work with an external coding agent that runs in its own process and owns its own login',
            '(for example Claude Code, Devin, opencode, or another DeepSeek Harness).',
            'Action "list" shows which agents are configured and running;',
            'action "ask" sends one task to one agent and returns its transcript;',
            'action "close" ends an agent\'s process.',
            'Prefer this over shelling out when a task should be handled by a different agent than this one.',
          ].join(' '),
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['action'],
            properties: {
              action: {
                type: 'string',
                enum: ['list', 'ask', 'close', 'diagnostics'],
                description: 'What to do. "diagnostics" reports which build is running and what it decided about sessions and workspaces.',
              },
              agent: {
                type: 'string',
                description: 'Agent id, label, or a unique fragment of either. Required for "ask" and "close".',
              },
              prompt: {
                type: 'string',
                description: 'The task to hand to the external agent. Required for "ask". Make it self-contained: the agent does not see this conversation.',
              },
              cwd: {
                type: 'string',
                description: 'Absolute working directory for the external agent. Defaults to the session workspace.',
              },
              timeoutMs: {
                type: 'number',
                description: 'How long to wait for the external agent, in milliseconds.',
              },
            },
          },
          output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
          },
          async execute(args, execution) {
            const action = String(args?.action ?? 'list');
            // Failures become text rather than a thrown Harness error: a login
            // that expired or a prompt that timed out is information the model
            // should be able to relay, not an opaque tool crash.
            try {
              if (action === 'list') return `${listText(registry)}\n\nworkspace: ${workspaceReport()}`;
              if (action === 'diagnostics') {
                return `build ${PLUGIN_BUILD}\nworkspace: ${workspaceReport()}\n\n${diagnosticsTail(40)}`;
              }
              if (action === 'close') {
                const stopped = registry.close(args?.agent);
                return `Stopped: ${stopped.join(', ') || '(none)'}`;
              }
              if (action === 'ask') {
                const prompt = String(args?.prompt ?? '').trim();
                if (prompt.length === 0) return 'Action "ask" needs a prompt.';
                const result = await registry.ask(args?.agent, prompt, {
                  // Default to THIS session's workspace, so a delegation lands in
                  // the user's project rather than wherever the harness happens
                  // to have been launched from.
                  cwd: typeof args?.cwd === 'string' && args.cwd.trim().length > 0 ? args.cwd.trim() : currentWorkspace(),
                  timeoutMs: Number.isFinite(args?.timeoutMs) ? args.timeoutMs : undefined,
                  signal: execution?.signal,
                });
                return resultText(result);
              }
              return `Unknown action "${action}". Use list, ask, or close.`;
            } catch (error) {
              return `External agent failed: ${String(error?.message ?? error)}`;
            }
          },
        });
        return dispose;
      } catch (error) {
        ctx.logger?.warn(`external-agents: model tool unavailable: ${String(error)}`);
        return () => undefined;
      }
    }, 'external-agents: external_agents tool');
  });

  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.effect(() => commandCtx.commands.register({
      name: 'external-agents',
      description: 'Work with external ACP agents: list, ask, close, options, set, pending',
      recordInput: false,
      input: { hint: '<list|ask|close|options|set|pending> [agent] [selector] [value]' },
      handler: async ({ rawInput }) => {
        const [verb = 'list', ...rest] = String(rawInput ?? '').trim().split(/\s+/).filter(Boolean);
        if (verb === 'list') return { kind: 'success', text: listText(registry) };
        // What the agent said after its turn ended. A finished harness turn cannot
        // be reopened — only a new prompt can — but the alternative is silently
        // dropping it, which looks like the agent never followed up.
        if (verb === 'pending') {
          const key = currentSessionKey();
          const reference = rest[0];
          const ids = reference === undefined
            ? [...registry.connections.keys()]
            : [registry.resolve(reference).id];
          const lines = [];
          for (const id of ids) {
            const late = registry.connections.get(id)?.lateUpdates(key) ?? [];
            if (late.length === 0) continue;
            lines.push(`${id}: ${late.length} update(s) after its turn ended`);
            for (const entry of late.slice(-10)) {
              lines.push(`  ${new Date(entry.at).toISOString().slice(11, 19)}  ${entry.text.slice(0, 200)}`);
            }
          }
          return { kind: 'success', text: lines.length === 0
            ? 'Nothing arrived after a turn ended. Only a new message can continue the conversation.'
            : lines.join('\n') };
        }
        if (verb === 'close' || verb === 'close-all') {
          const stopped = registry.close(verb === 'close-all' ? undefined : rest[0]);
          return { kind: 'success', text: `Stopped: ${stopped.join(', ') || '(none)'}` };
        }
        // The agent's own selectors — session mode, reasoning level and so on —
        // are reachable over ACP but appear nowhere in the harness's UI, so
        // without this they sit at whatever the agent chose forever.
        if (verb === 'options' || verb === 'set') {
          const reference = rest[0];
          if (reference === undefined) {
            return { kind: 'error', text: 'Usage: /external-agents options <agent>  |  /external-agents set <agent> <selector> <value>' };
          }
          const connection = registry.resolve(reference);
          const key = currentSessionKey();
          try {
            // A selector is published with the session, so one has to exist.
            await connection.ensureSession(currentWorkspace(), key);
          } catch (error) {
            return { kind: 'error', text: `${connection.id}: ${String(error?.message ?? error)}` };
          }
          const selectors = (connection.sessions.get(key)?.configOptions ?? [])
            .filter((option) => option?.type === 'select');
          if (verb === 'options') {
            if (selectors.length === 0) return { kind: 'success', text: `${connection.id} advertises no selectors.` };
            const lines = selectors.map((option) => {
              const current = selectValues(option).find((value) => value.value === option.currentValue);
              const values = selectValues(option).map((value) => value.value).join(', ');
              return `${(option.id ?? '?').padEnd(14)} ${String(current?.name ?? option.currentValue ?? '-')}\n`
                + `${' '.repeat(14)} ${values}`;
            });
            return { kind: 'success', text: `${connection.id}:\n${lines.join('\n')}` };
          }
          const [selector, ...valueParts] = rest.slice(1);
          const value = valueParts.join(' ');
          if (selector === undefined || value.length === 0) {
            return { kind: 'error', text: `Usage: /external-agents set ${reference} <selector> <value>` };
          }
          // A friendly alias, because the ACP id is `thought_level`.
          const configId = selector === 'thought' || selector === 'reasoning' ? 'thought_level' : selector;
          const applied = await connection.selectOption(key, configId, value);
          return applied === undefined
            ? { kind: 'error', text: `${connection.id} does not offer "${configId}" with value "${value}". Run /external-agents options ${connection.id}.` }
            : { kind: 'success', text: `${connection.id} ${configId} = ${applied.currentValue}` };
        }
        if (verb === 'ask') {
          const agent = rest.shift();
          const prompt = rest.join(' ').trim();
          if (agent === undefined || prompt.length === 0) {
            return { kind: 'error', text: 'Usage: /external-agents ask <agent> <prompt>' };
          }
          const result = await registry.ask(agent, prompt);
          return { kind: 'success', text: resultText(result) };
        }
        return { kind: 'error', text: `Unknown subcommand "${verb}". Use list, ask, close, options, set, or pending.` };
      },
    }), 'external-agents: command');
  });

  // The agent picker.
  //
  // DSH's model picker is provider-grouped, and `ctx.llm.listProviders()` is
  // built straight from the registered adapter routes, while each session's
  // directory comes from the host's live LLM catalog. So registering one adapter
  // per external agent is what makes that agent selectable in the composer,
  // with the agent's own ACP-advertised models nested beneath it. No client
  // plugin, no sidebar, no new surface: the picker the composer already has
  // becomes the agent picker.
  ctx.inject(['llm', 'agents'], (llmCtx) => {
    llmCtx.effect(() => {
      const disposers = [];
      const delegateEndpoints = [];
      // The agent loop drives every turn inside `ctx.agents.withInitiator(…)`,
      // an AsyncLocalStorage chain, so this — called from within the request —
      // names the exact DSH session the turn belongs to.
      const initiatingAgent = () => {
        try {
          return llmCtx.agents.currentInitiator?.() ?? null;
        } catch {
          return null;
        }
      };
      // Deliberately `undefined` when the session declares nothing, rather than
      // the configured fallback: `ensureSession` needs to tell "this session is
      // at /X" apart from "I could not find out", so it can hold on to the
      // workspace it already learned instead of switching directories and
      // tearing the conversation down with it.
      const sessionCwd = () => sessionWorkspace(initiatingAgent(), undefined);
      // `ctx.approval` when the profile composes it. Read through `get()` so a
      // profile without the seam is not an error, and so a missing channel
      // becomes a refusal rather than a crash.
      const approvalService = () => {
        try {
          return llmCtx.get?.('approval') ?? undefined;
        } catch {
          return undefined;
        }
      };
      /**
       * Read one durable image attachment as bytes.
       *
       * The harness hands an adapter a reference (`{ attachmentId, mediaType }`),
       * not data. `ctx.attachments.imageHostPath` owns the mapping into its
       * content-addressed store, so this reads that file — read-only, no harness
       * import — and hands ACP the base64 it wants.
       */
      const imageResolver = () => {
        let attachments;
        try {
          attachments = llmCtx.get?.('attachments');
        } catch {
          attachments = undefined;
        }
        if (typeof attachments?.imageHostPath !== 'function') return undefined;
        return (ref) => {
          const hostPath = attachments.imageHostPath(ref);
          if (typeof hostPath !== 'string' || hostPath.length === 0) return undefined;
          try {
            // Refuse an absurd file rather than base64 it into the request.
            if (statSync(hostPath).size > 20 * 1024 * 1024) return undefined;
            return { data: readFileSync(hostPath).toString('base64'), mimeType: ref?.mediaType };
          } catch {
            return undefined;
          }
        };
      };
      const resolveImage = imageResolver();
      for (const [id, connection] of registry.connections) {
        const entry = settings.agents.find((candidate) => candidate.id === id);
        if (entry === undefined) continue;
        // A discovered agent is reachable through the tool, but only an agent
        // you listed is worth starting just to populate a picker.
        if (settings.expose === 'explicit' && entry.discovered === true) continue;
        // Delegation bridge: one tool (`delegate`) over MCP, so an external agent on
      // a subscription can command harness workers without the harness lending it
      // the whole tool registry — and without bypassing the approval gate.
      let delegateEndpoint;
      let delegateTurnStart;
      if (entry.delegate !== undefined && entry.delegate !== false) {
        const getSubagents = () => {
          for (const holder of [ctx, llmCtx]) {
            try {
              const found = holder.get?.('subagents');
              if (found !== undefined && found !== null) return found;
            } catch {
              // A context without that service is a normal miss.
            }
          }
          return undefined;
        };
        {
          const delegate = entry.delegate === true ? {} : entry.delegate;
          delegateEndpoint = createDelegateEndpoint({
            getSubagents,
            provider: typeof delegate.provider === 'string' ? delegate.provider : 'spawn',
            ...(Number.isFinite(delegate.timeoutMs) ? { timeoutMs: delegate.timeoutMs } : {}),
            ...(Number.isFinite(delegate.progressEveryMs) ? { progressEveryMs: delegate.progressEveryMs } : {}),
            agentOptions: delegate.model === undefined
              ? undefined
              : {
                ...(typeof delegate.llmProvider === 'string' ? { provider: delegate.llmProvider } : {}),
                model: delegate.model,
              },
            log: (line) => note(line),
          });
          delegateEndpoints.push(delegateEndpoint);
          note(`[${entry.id}] delegate bridge on; subagent service ${getSubagents() === undefined ? 'not visible yet (resolved per call)' : 'visible'}`);
          const ready = delegateEndpoint.listen();
          const shim = fileURLToPath(new URL('./mcp-forward.mjs', import.meta.url));
          const node = nodeBinary();
          note(`[${entry.id}] delegate shim will run on ${node}`);
          connection.mcpServersProvider = async (key) => [{
            name: 'dsh',
            type: 'stdio',
            command: node,
            args: [shim, '--url', await ready, '--token', delegateEndpoint.tokenFor(key)],
            env: [],
          }];
          delegateTurnStart = (key, agent) => delegateEndpoint.bind(key, agent);
        }
      }
      const adapter = new AcpModelAdapter({
          connection,
          provider: entry.llmProvider,
          label: entry.label,
          logger: ctx.logger,
          resolveCwd: sessionCwd,
          resolveSessionKey: () => initiatingAgent()?.session?.id ?? null,
          resolveInitiatingAgent: initiatingAgent,
          // The harness's own approval seam, when the profile composes one.
          // Read through `get()` so a profile without it is not an error.
          approvalService: approvalService(),
          // Only present when the profile composes `ctx.attachments`; without it
          // the adapter does not advertise image input.
          resolveImage,
          onTurnStart: delegateTurnStart,
          // `ask` (the default) routes the decision to that seam; `allow`,
          // `deny` and `cancel` answer directly for unattended runs.
          approvalPolicy: entry.approval,
          instructions: entry.instructions,
          // Per-agent budget wins; otherwise the profile-wide default.
          primeMaxChars: Number.isFinite(entry.primeMaxChars) ? entry.primeMaxChars : settings.primeMaxChars,
          note,
          models: entry.models,
          modelInclude: entry.modelInclude,
          modelExclude: entry.modelExclude,
        });
        try {
          disposers.push(llmCtx.llm.registerAdapter([entry.llmProvider], adapter));
        } catch (error) {
          ctx.logger?.warn?.(`external-agents: provider "${entry.llmProvider}" not registered: ${String(error?.message ?? error)}`);
        }
      }
      return () => {
        try {
          delegateEndpoints.forEach((endpoint) => endpoint.close());
        } catch {
          // Closing a listener is best effort; the process owns the rest.
        }
        for (const handle of disposers) {
          try {
            if (typeof handle === 'function') handle();
            else if (typeof handle?.dispose === 'function') handle.dispose();
            else if (typeof handle?.replace === 'function') handle.replace([]);
          } catch {
            // Withdrawal is best effort; the fiber owns the real lifetime.
          }
        }
      };
    }, 'external-agents: llm adapters');
  });

  return () => registry.disposeAll();
}
