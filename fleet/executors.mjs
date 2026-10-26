/*
 * The executors a node can hand work to. Each takes a prompt and a worktree,
 * runs one agent there, and resolves `{ ok, text, costUsd?, model?, turns? }`.
 * None of them commits, pushes, or leaves the worktree: the node does the git.
 *
 *   claude    Claude Code headless. The only executor client work may use: an
 *             allow-listed tool set, no MCP, no web, no inherited settings.
 *   opencode  `opencode run`, one subprocess per run. System work only.
 *   dsh       `dsh --profile headless`, one subprocess per run. System work
 *             only — the Harness one-shot, on whichever provider its profile
 *             is set to (DeepSeek, OpenCode Go, …). Runs with `--json`, so
 *             the result carries the Harness `sessionId`.
 *   dsh-claude, dsh-opencode, dsh-devin
 *             The same dsh run, with an overlay patch that has the Harness
 *             drive Claude Code (claude-agent-acp), OpenCode (`opencode acp`)
 *             or Devin (`devin acp`) as an external ACP agent. Still a
 *             Harness session. System only.
 *   devin     Devin over ACP (JSON-RPC on stdio). System work only — it
 *             auto-approves its own permission prompts, as the old Slack
 *             bridge did, which is fine for Ali's repos and wrong for a client's.
 *
 * Every executor gets `signal`; aborting it kills the agent. That is how a
 * cancel from the admin view, a lost lease, or the run timeout reaches it.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';

/** Run a command without a shell; resolve { code, stdout, stderr }. */
export function run(cmd, args, { cwd, input, signal, env, finishOn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    // A process that has said its last word but does not exit (dsh after its
    // `final` event, holding MCP connections open): give it a moment, then end it.
    let finished = false;
    child.stdout.on('data', (d) => {
      stdout += d;
      if (finishOn && !finished && finishOn.test(stdout)) {
        finished = true;
        setTimeout(() => child.kill('SIGTERM'), 3000).unref();
      }
    });
    child.stderr.on('data', (d) => (stderr += d));
    const kill = () => {
      stderr += '\n[node] stopped';
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    };
    signal?.addEventListener('abort', kill, { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', kill);
      resolve({ code: finished && !signal?.aborted ? 0 : code, stdout, stderr });
    });
    // A child that exits before reading its stdin (a missing binary, a
    // version probe) makes this write fail with EPIPE. Unhandled, that error
    // takes the whole node down; the exit code already says what happened.
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

/* ——————————————————————— claude ——————————————————————— */

export const CLIENT_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  // Enough to finish its own work: stage and commit. Pushing stays with the
  // node, which holds the credentials and knows where the work should land.
  'Bash(git add:*)',
  'Bash(git commit:*)',
  'Bash(ls:*)',
];
/** Ali's own work may run commands — tests, builds — but still not push. */
export const SYSTEM_TOOLS = [...CLIENT_TOOLS, 'Bash'];

async function claude({ prompt, cwd, system, kind, config, signal }) {
  const tools = kind === 'client' ? config.allowedTools ?? CLIENT_TOOLS : config.systemAllowedTools ?? SYSTEM_TOOLS;
  const args = [
    '-p',
    '--output-format', 'json',
    '--permission-mode', 'dontAsk', // anything not allowed below is denied, no prompt
    '--allowedTools', ...tools,
    '--disallowedTools', 'WebFetch', 'WebSearch', 'Bash(git push:*)', 'Bash(git remote:*)', 'Bash(git config:*)',
    '--strict-mcp-config', // no MCP servers at all — none of Ali's connectors
    '--setting-sources', 'local', // fresh worktree has no local settings → no inherited allow rules
    '--append-system-prompt', system,
    '--max-budget-usd', String(config.maxBudgetUsd ?? 5),
  ];
  if (config.model) args.push('--model', config.model);
  const res = await run(config.bin ?? 'claude', args, { cwd, input: prompt, signal });
  let result = {};
  try {
    result = JSON.parse(res.stdout);
  } catch {
    /* non-JSON output: fall through to stderr */
  }
  return {
    ok: res.code === 0 && result.is_error !== true,
    text:
      (typeof result.result === 'string' && result.result.trim()) ||
      res.stderr.trim().slice(-2000) ||
      `claude exited with code ${res.code}`,
    costUsd: typeof result.total_cost_usd === 'number' ? result.total_cost_usd : undefined,
    turns: result.num_turns,
    model: config.model,
  };
}

/* ——————————————————————— opencode ——————————————————————— */

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');

/**
 * opencode 2.x renamed `--dangerously-skip-permissions` to `--auto` and dropped
 * `--dir` (the agent runs in its cwd either way). Ask the binary once.
 */
const autoFlags = new Map();
async function opencodeAutoFlag(bin) {
  if (!autoFlags.has(bin)) {
    const help = await run(bin, ['run', '--help']).catch(() => ({ stdout: '', stderr: '' }));
    autoFlags.set(bin, /--auto\b/.test(help.stdout + help.stderr) ? '--auto' : '--dangerously-skip-permissions');
  }
  return autoFlags.get(bin);
}

async function opencode({ prompt, cwd, system, config, signal }) {
  const args = ['run', '--format', 'json'];
  if (config.auto !== false) args.push(await opencodeAutoFlag(config.bin ?? 'opencode'));
  if (config.model) args.push('-m', config.model);
  args.push(`${system}\n\n${prompt}`);
  const res = await run(config.bin ?? 'opencode', args, { cwd, signal });
  const texts = [];
  let cost = 0;
  for (const line of res.stdout.split('\n')) {
    try {
      const ev = JSON.parse(line);
      const t = ev?.part?.text ?? ev?.text;
      if (typeof t === 'string' && t.trim()) texts.push(t);
      const c = ev?.part?.cost ?? ev?.cost;
      if (typeof c === 'number') cost += c;
    } catch {
      /* not an event line */
    }
  }
  return {
    ok: res.code === 0,
    text: texts.join('\n').trim() || stripAnsi(res.stdout).trim().slice(-2000) || stripAnsi(res.stderr).trim().slice(-2000) || '(no output)',
    costUsd: cost > 0 ? cost : undefined,
    model: config.model,
  };
}

/* ——————————————————————— dsh ——————————————————————— */

/**
 * Read `dsh --json` output: one JSON event per line. Pure, so it can be tested
 * without a Harness.
 *
 * @param stdout - everything dsh wrote to stdout.
 * @returns `{ sessionId, text, completed, usage: { inputTokens, outputTokens,
 *   totalTokens }, turns }`. When no line parses as JSON (a dsh without
 *   `--json`), `text` is the whole stdout and `sessionId` is null.
 */
export function parseDshEvents(stdout) {
  const out = {
    sessionId: null,
    text: '',
    completed: false,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    turns: 0,
  };
  const raw = String(stdout ?? '');
  let parsed = 0;
  let finalText = null;
  const chunks = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let ev;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!ev || typeof ev !== 'object') continue;
    parsed += 1;
    if (ev.type === 'session' && typeof ev.sessionId === 'string' && !out.sessionId) out.sessionId = ev.sessionId;
    else if (ev.type === 'final' && typeof ev.text === 'string') finalText = ev.text;
    else if (ev.type === 'text' && typeof ev.text === 'string') chunks.push(ev.text);
    else if (ev.type === 'status' && ev.phase === 'step_end' && ev.usage && typeof ev.usage === 'object') {
      for (const key of ['inputTokens', 'outputTokens', 'totalTokens']) {
        if (typeof ev.usage[key] === 'number') out.usage[key] += ev.usage[key];
      }
    } else if (ev.type === 'status' && ev.phase === 'turn_end') {
      out.turns += 1;
      if (ev.reason?.kind === 'completed') out.completed = true;
    }
  }
  if (parsed === 0) {
    out.text = raw.trim();
    return out;
  }
  out.text = (finalText ?? chunks.join('')).trim();
  return out;
}

/** Defaults for the Harness-driven external agents. */
export const DSH_AGENTS = {
  claude: { provider: 'acp-claude', label: 'Claude Code', command: 'claude-agent-acp', args: [], model: 'opus' },
  opencode: { provider: 'acp-opencode', label: 'opencode', command: 'opencode', args: ['acp'], model: 'opencode/deepseek-v4.1-flash-free' },
  devin: { provider: 'acp-devin', label: 'Devin', command: 'devin', args: ['acp'], model: 'swe-2-high' },
};

/**
 * The YAML patch-list overlay that makes the Harness drive an external ACP
 * agent (Claude Code or OpenCode) as its model. Pure.
 *
 * @param agent - 'claude' | 'opencode'.
 * @param config - the executor's config: `agentCommand?`, `model?`.
 * @returns the overlay as YAML text.
 */
export function dshAgentOverlay(agent, config = {}) {
  const chosen = DSH_AGENTS[agent];
  if (!chosen) throw new Error(`unknown dsh agent "${agent}"`);
  // JSON strings are valid YAML double-quoted scalars.
  const q = (s) => JSON.stringify(String(s));
  const lines = [
    '- id: external-agents',
    '  name: "@malipetek/dsh-external-agents"',
    '  config:',
    '    discover: false',
    '    expose: explicit',
    '    envMode: minimal',
    '    agents:',
  ];
  for (const [id, a] of Object.entries(DSH_AGENTS)) {
    const command = id === agent && config.agentCommand ? config.agentCommand : a.command;
    lines.push(
      `      - id: ${id}`,
      `        label: ${q(a.label)}`,
      `        command: ${q(command)}`,
      `        args: [${a.args.map(q).join(', ')}]`,
    );
  }
  const model = config.model ?? chosen.model;
  lines.push(
    '- id: agent-default-model',
    '  name: "@deepseek-ai/dsh-agent-default-model"',
    '  config:',
    `    provider: ${chosen.provider}`,
  );
  if (model) lines.push(`    model: ${q(model)}`);
  return lines.join('\n') + '\n';
}

/**
 * The Harness profile the agent executors run under: the headless bundle plus
 * `@malipetek/dsh-external-agents`, which the plain `headless` profile lacks
 * (without it dsh answers NO_ADAPTER). Set up once per machine; see fleet/README.md.
 */
export const AGENT_PROFILE = 'fleet-agents';

/** Whether a profile has the external-agents plugin installed. */
export function agentProfileReady(profile = AGENT_PROFILE, dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')) {
  return existsSync(join(dshHome, 'profiles', profile, 'node_modules', '@malipetek', 'dsh-external-agents', 'package.json'));
}

/** Write the overlay for `agent` next to the node config; returns its path. */
function writeAgentOverlay(agent, config) {
  const dir = config.overlayDir ?? join(homedir(), '.config', 'malipetek-runner');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `dsh-agent-${agent}.patch.yml`);
  writeFileSync(file, dshAgentOverlay(agent, config));
  return file;
}

/**
 * The DeepSeek Harness one-shot with `--json`: events on stdout, diagnostics
 * on stderr. The provider and its credentials come from the Harness profile on
 * this machine (DeepSeek, OpenCode Go and the rest), never from the brief —
 * or, with `agent`, an overlay that has the Harness drive Claude Code or
 * OpenCode over ACP, so the run is still a Harness session with a session id.
 */
async function dsh({ prompt, cwd, system, config, signal }, agent) {
  const args = ['--profile', config.profile ?? (agent ? AGENT_PROFILE : 'headless')];
  if (agent) args.push('--patch', writeAgentOverlay(agent, config));
  args.push('--json', '-');
  const res = await run(config.bin ?? 'dsh', args, {
    cwd,
    input: `${system}\n\n${prompt}`, // `-` reads the task from stdin, so a long thread stays out of argv
    signal,
    finishOn: /^\{"type":"final"/m,
  });
  const parsed = parseDshEvents(res.stdout);
  // dsh exits 0 even when the turn ended in an error (a missing adapter, a
  // provider limit); the turn_end reason is the truth.
  const turnError = /"phase":"turn_end"[^\n]*"kind":"error"[^\n]*?"message":"([^"]*)"/.exec(res.stdout)?.[1];
  return {
    ok: res.code === 0 && !signal?.aborted && !turnError && parsed.text.length > 0,
    text: parsed.text || (turnError ? `dsh: ${turnError}` : '') || res.stderr.trim().slice(-2000) || `dsh exited with code ${res.code}`,
    sessionId: parsed.sessionId,
    turns: parsed.turns || undefined,
    model: agent ? config.model ?? DSH_AGENTS[agent].model : config.model,
  };
}

const dshClaude = (opts) => dsh(opts, 'claude');
const dshOpencode = (opts) => dsh(opts, 'opencode');
const dshDevin = (opts) => dsh(opts, 'devin');

/** Executors whose runs are Harness sessions (their log can be uploaded). */
export const DSH_FAMILY = ['dsh', 'dsh-claude', 'dsh-opencode', 'dsh-devin'];

/* ——————————————————————— fallback ——————————————————————— */

/** The account an executor spends: a quota hit on one form covers the other. */
export const ACCOUNT = {
  claude: 'anthropic',
  'dsh-claude': 'anthropic',
  devin: 'devin',
  'dsh-devin': 'devin',
  opencode: 'opencode',
  'dsh-opencode': 'opencode',
  dsh: 'dsh',
};

/**
 * System work's order when nothing is pinned, and the fallback order after a
 * quota error: Harness executors first, so the run has a conversation to open;
 * then the cheap Harness provider, Devin SWE-2 (free) and OpenCode's free
 * DeepSeek; the plain CLIs last. Devin runs directly: under the Harness its
 * ACP turns come back empty (EMPTY_TURN), so dsh-devin is pin-only for now.
 */
export const SYSTEM_ORDER = ['dsh-claude', 'dsh', 'devin', 'dsh-opencode', 'claude', 'opencode'];

/** Whether a failed run's text reads as a spend, usage or rate limit. */
export function isQuotaError(text) {
  return /spend limit|usage limit|rate.?limit|quota|limit resets|too many requests|\b429\b|insufficient (credit|balance|funds)|credit balance|out of credits|exceeded your/i.test(
    String(text ?? ''),
  );
}

/**
 * The executors to try, in order: the claimed one, then every other one this
 * node runs in SYSTEM_ORDER. Client work never leaves its sandboxed executor.
 */
export function fallbackChain(first, available, kind) {
  if (kind === 'client') return [first];
  return [first, ...SYSTEM_ORDER.filter((e) => e !== first && available.includes(e))];
}

const SESSION_FILE = 'session.v4.jsonl.zstd';

/**
 * Find a Harness session's log: `$DSH_HOME/sessions/<encoded cwd>/<id>/session.v4.jsonl.zstd`.
 * The cwd encoding is the Harness's business, so scan rather than rebuild it.
 *
 * @param sessionId - from the `session` event.
 * @param dshHome - defaults to $DSH_HOME, else ~/.dsh.
 * @returns `{ file, dir }` (dir = the encoded directory name) or null.
 */
export function findSessionLog(sessionId, dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')) {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(sessionId)) return null;
  const root = join(dshHome, 'sessions');
  let dirs;
  try {
    dirs = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, sessionId, SESSION_FILE);
    if (existsSync(file)) return { file, dir: entry.name };
  }
  return null;
}

/* ——————————————————————— devin (ACP) ——————————————————————— */

function devinApiKey() {
  try {
    const text = readFileSync(join(homedir(), '.local/share/devin/credentials.toml'), 'utf8');
    return text.match(/windsurf_api_key\s*=\s*"(.+)"/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * One Devin ACP session for one run: spawn, initialize, authenticate, open a
 * session in the worktree, prompt, collect the reply, exit. A process per run
 * costs a few seconds and buys isolation — the old bridge shared one process
 * and had to grow a stall watchdog to unwedge it.
 */
async function devin({ prompt, cwd, system, config, signal }) {
  const proc = spawn(config.bin ?? 'devin', ['acp'], { cwd, env: process.env });
  const pending = new Map();
  let nextId = 1;
  let text = '';
  let lastActivity = Date.now();
  const stallMs = (config.stallMinutes ?? 20) * 60_000;

  proc.stdin.on('error', () => {}); // a dying agent must not take the node with it (EPIPE)
  const send = (msg) => proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  const call = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      send({ id, method, params });
    });

  readline.createInterface({ input: proc.stdout }).on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    lastActivity = Date.now();
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.id !== undefined && msg.method === 'session/request_permission') {
      const options = msg.params?.options ?? [];
      const pick = options.find((o) => o.kind === 'allow_always') ?? options.find((o) => o.kind === 'allow_once') ?? options[0];
      send({ id: msg.id, result: { outcome: { outcome: 'selected', optionId: pick?.optionId } } });
    } else if (msg.id !== undefined && msg.method) {
      send({ id: msg.id, result: null }); // unknown request: answer rather than stall the agent
    } else if (msg.method === 'session/update') {
      const u = msg.params?.update;
      if (u?.sessionUpdate === 'agent_message_chunk') text += u.content?.text ?? '';
    }
  });
  proc.stderr.on('data', () => {});

  const exited = new Promise((resolve) =>
    proc.on('exit', () => {
      for (const resolvePending of pending.values()) resolvePending({ error: { message: 'devin acp exited' } });
      pending.clear();
      resolve();
    }),
  );
  const stop = () => proc.kill('SIGKILL');
  signal?.addEventListener('abort', stop, { once: true });
  const watchdog = setInterval(() => {
    if (Date.now() - lastActivity > stallMs) stop();
  }, 30_000);

  try {
    const init = await call('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      clientInfo: { name: 'malipetek-node', version: '1' },
    });
    if (init.error) throw new Error(`initialize: ${init.error.message}`);
    const key = devinApiKey();
    const auth = await call('authenticate', { methodId: 'devin-browser', meta: { api_key: key }, _meta: { api_key: key } });
    if (auth.error) throw new Error(`authenticate: ${auth.error.message}`);
    const session = await call('session/new', { cwd, mcpServers: [] });
    if (session.error) throw new Error(`session/new: ${session.error.message}`);
    const sessionId = session.result.sessionId;
    await call('session/set_config_option', { sessionId, configId: 'mode', value: config.mode ?? 'bypass' });
    if (config.model) await call('session/set_config_option', { sessionId, configId: 'model', value: config.model });
    const reply = await call('session/prompt', { sessionId, prompt: [{ type: 'text', text: `${system}\n\n${prompt}` }] });
    if (reply.error) throw new Error(reply.error.message);
    return { ok: true, text: text.trim() || '(no output)', model: config.model };
  } catch (error) {
    return { ok: false, text: `${text.trim() ? `${text.trim()}\n\n` : ''}devin: ${error.message}` };
  } finally {
    clearInterval(watchdog);
    signal?.removeEventListener('abort', stop);
    proc.kill('SIGTERM');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
  }
}

export const EXECUTORS = { claude, opencode, dsh, 'dsh-claude': dshClaude, 'dsh-opencode': dshOpencode, 'dsh-devin': dshDevin, devin };
