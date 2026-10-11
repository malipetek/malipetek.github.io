/**
 * Host half of the **AI Workspace** bundle.
 *
 * This is the DeepSeek Harness port of the `ai-workspace` VS Code extension. The
 * idea it preserves: a project's long-running development processes should
 * already be running, with their output captured to log files, so that an agent
 * never has to re-run `pnpm dev` / `pnpm build` / `tsc --watch` — it reads the
 * logs instead. Re-running them fights over ports and duplicates work.
 *
 * DeepSeek Harness gives a third-party plugin no way to create a UI-visible
 * terminal (terminal creation is Agent-gated), so the observation surface is the
 * Client half of this bundle: a live panel of process cards fed by the JSON
 * snapshot this half writes. The agent-facing half is a system-prompt section
 * plus a `/ai-workspace` command.
 *
 * What this half owns:
 *
 * - **Discovery** — scans a projects root one level deep for projects carrying
 *   an `.ai-workspace.json` (or the legacy `.claude-workspace.json`).
 * - **Supervision** — spawns each configured process detached, so the whole
 *   process group can be terminated, and counts error-looking output lines.
 * - **Capture** — mirrors every process's stdout and stderr into
 *   `<project>/.ai-workspace/logs/<name>.log`, the durable artifact the agent
 *   reads, and keeps a bounded tail of it for the panel.
 * - **Publication** — rewrites a compact JSON snapshot under `$DSH_HOME` that
 *   the Client half reads through the existing session-scoped file Remote.
 * - **Instruction** — contributes a system-prompt section listing the running
 *   processes and their log paths, and returns an empty section when nothing is
 *   running so it costs nothing.
 *
 * Only Node built-ins are imported. A Host-only bundle needs no dependencies,
 * no build step and no install scripts, and Node's own `child_process` is the
 * one primitive that gives a local dev server its full ambient environment:
 * `ctx.subprocess` deliberately scrubs credential-shaped variables, which would
 * break exactly the servers this plugin exists to run.
 *
 * @module @malipetek/dsh-ai-workspace
 */
import { spawn } from 'node:child_process';
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

/* ------------------------------------------------------------------ *
 * Constants mirrored in client.js — change both halves together
 * ------------------------------------------------------------------ */

/**
 * Where the status snapshot is written. The Client half cannot read the Host
 * environment, so it rebuilds this same path from the Host home published on the
 * Remote host facts.
 */
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');
const STATUS_PATH = join(DSH_HOME, 'ai-workspace', 'status.json');

/** Project config filenames, newest first. */
const CONFIG_NAMES = ['.ai-workspace.json', '.claude-workspace.json'];

/** Directory inside a project that holds this plugin's runtime state. */
const STATE_DIR = '.ai-workspace';

/** Marker lines delimiting the optional AGENTS.md section. */
const MARKER_START = '<!-- ai-workspace:start -->';
const MARKER_END = '<!-- ai-workspace:end -->';

/**
 * Default projects root, mirroring the Projects panel. `DSH_PROJECTS_ROOT`
 * overrides it and the profile's `cordis.patch.yml` can set `projectsRoot`
 * outright; the `~/Documents/Documents/Projects` default is the author's own
 * layout, so prefer one of those over editing this line.
 */
const DEFAULT_PROJECTS_ROOT = process.env.DSH_PROJECTS_ROOT || join(homedir(), 'Documents', 'Documents', 'Projects');

/** Directories never treated as projects while scanning the projects root. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'target', '.next', '.cache']);

/**
 * Matches bound-port announcements such as `Local: http://localhost:5173` or
 * `listening on port 3000`. Ported from the extension's PTY watcher.
 */
const PORT_LINE_RE = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})|\bport[:\s]+(\d{2,5})\b/i;

/** ANSI escape sequences, stripped before a line is classified or stored. */
const ANSI_RE = /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

/**
 * Lines matching this pattern count as "error-like" for the panel's error
 * counter. Carried over verbatim from the extension's `util.ts` so the two
 * implementations report the same numbers.
 */
const ERROR_RE = new RegExp([
  'error', 'Error', 'ERROR',
  'failed', 'Failed', 'FAILED',
  'exception', 'Exception', 'EXCEPTION',
  'panic', 'PANIC',
  'fatal', 'Fatal', 'FATAL',
  'warning', 'Warning', 'WARN',
  '\\berr\\b', 'Cannot', 'cannot',
  'TypeError', 'SyntaxError', 'ReferenceError',
  'CompileError', 'ParseError',
  'ENOENT', 'EACCES', 'EPERM', 'EADDRINUSE', 'already in use',
  'segfault', 'Segmentation',
  'TS[0-9]+:', 'ESLint', 'error\\[E[0-9]+\\]'
].join('|'));

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/**
 * Remove ANSI escape sequences from terminal text.
 * @param text - raw text, possibly containing colour codes.
 * @returns the text without escape sequences.
 */
function stripAnsi(text) {
  return text.replace(ANSI_RE, '');
}

/**
 * Decide whether one output line should count as an error.
 * @param line - an ANSI-free line of process output.
 * @returns true when the line looks like an error, warning or failure.
 */
function isErrorLine(line) {
  return ERROR_RE.test(line);
}

/**
 * Create a directory and every missing parent.
 * @param dir - absolute directory path.
 */
function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

/**
 * Report whether a process is still alive.
 * @param pid - the process id to probe.
 * @returns true when the signal can be delivered.
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a number of milliseconds.
 * @param ms - delay in milliseconds.
 * @returns a promise settling after the delay.
 */
function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * Terminate a whole process tree, best effort, never throwing.
 *
 * Children are spawned detached, so each is its own process-group leader and a
 * negative pid addresses the group. macOS has no stronger containment
 * primitive, so a descendant that escapes the group may survive; that matches
 * the behaviour of the extension this ports.
 *
 * @param pid - the group leader's process id.
 * @param graceMs - how long to wait for a graceful exit before SIGKILL.
 * @returns a promise settling once the tree is gone or the ladder is exhausted.
 */
async function killTree(pid, graceMs = 1500) {
  if (process.platform === 'win32') {
    await new Promise((done) => {
      try {
        spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' }).on('exit', done).on('error', done);
      } catch {
        done();
      }
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return;
    await sleep(100);
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

/**
 * Read a JSON file, returning undefined instead of throwing.
 * @param file - absolute path to parse.
 * @returns the parsed value, or undefined when unreadable or malformed.
 */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ *
 * Reading captured logs
 * ------------------------------------------------------------------ */

/** Largest slice of the end of a log file any reader will load. */
const LOG_READ_BYTES = 256 * 1024;

/** Bounds on a caller-supplied line count. */
const LOG_MIN_LINES = 1;
const LOG_MAX_LINES = 200;

/** Bounds on the prompt section, so a large workspace cannot bloat a request. */
const PROJECT_SUMMARY_LIMIT = 12;
const ERROR_HIGHLIGHT_LIMIT = 6;

/**
 * Clamp a requested line count into the range a tool call may ask for.
 * @param value - the requested count, possibly absent or not a number.
 * @param fallback - the count to use when none was given.
 * @returns a whole number of lines within bounds.
 */
function clampLines(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), LOG_MIN_LINES), LOG_MAX_LINES);
}

/**
 * Read the end of a file as text, without loading a whole large log.
 * @param file - absolute path to read.
 * @param maxBytes - how much of the file's end to load.
 * @returns the decoded tail, or undefined when the file cannot be read.
 */
function readTailText(file, maxBytes = LOG_READ_BYTES) {
  let handle;
  try {
    const size = statSync(file).size;
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    if (length === 0) return '';
    handle = openSync(file, 'r');
    const buffer = Buffer.alloc(length);
    readSync(handle, buffer, 0, length, start);
    const text = buffer.toString('utf8');
    // A non-zero start almost certainly cuts a line in half; drop the fragment
    // rather than reporting a mangled first line.
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } catch {
    return undefined;
  } finally {
    if (handle !== undefined) {
      try { closeSync(handle); } catch { /* already closed */ }
    }
  }
}

/**
 * The last few lines of a log file.
 * @param file - absolute path to read.
 * @param count - how many lines to keep.
 * @returns the lines, oldest first.
 */
function tailLines(file, count) {
  const text = readTailText(file);
  if (text === undefined) return [];
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-count);
}

/**
 * The error-like lines from the end of a log file.
 * @param file - absolute path to read.
 * @param count - how many matching lines to keep.
 * @returns the matching lines, oldest first.
 */
function errorLines(file, count) {
  const text = readTailText(file);
  if (text === undefined) return [];
  return text.split(/\r?\n/).filter((line) => isErrorLine(line)).slice(-count);
}

/* ------------------------------------------------------------------ *
 * Onboarding detection
 * ------------------------------------------------------------------ */

/** Lockfiles that identify the package manager, most specific first. */
const MANAGER_LOCKS = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

/** Compose files, in priority order. */
const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

/** The conventional long-running script names, most canonical first. */
const PRIMARY_SCRIPTS = ['dev', 'develop', 'serve', 'start'];

/**
 * Separator-delimited words that mark a script as a helper rather than an app
 * server. `check:watch`, `build:watch`, `test:unit`, `docs:dev` and
 * `deploy:dev` all fail this test, while `dev`, `start` and `dev:astro` pass.
 */
const NON_SERVER_RE = /(^|:)(watch|test|lint|check|build|format|typecheck|types|docs?|storybook|deploy|migrate|seed|generate|prepare|clean|preview|analyze)($|:)/i;

/** A process name derived from a project folder or script suffix. */
function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'app';
}

/**
 * Identify a project's package manager from its lockfile.
 * @param root - absolute project root.
 * @returns the manager executable name.
 */
function packageManagerOf(root) {
  for (const [lock, manager] of MANAGER_LOCKS) {
    if (existsSync(join(root, lock))) return manager;
  }
  return 'npm';
}

/**
 * Read the service names out of a compose file with a deliberately shallow
 * parser: enough to name what a `docker compose up` would start, without
 * pulling in a YAML dependency.
 * @param file - absolute path to the compose file.
 * @returns the top-level service names under `services:`.
 */
function composeServicesOf(file) {
  try {
    const text = readFileSync(file, 'utf8');
    const start = text.search(/^services:\s*$/m);
    if (start < 0) return [];
    const block = text.slice(start + text.slice(start).indexOf('\n') + 1);
    const services = [];
    for (const line of block.split('\n')) {
      if (/^\S/.test(line) && line.trim().length > 0) break; // left the services block
      const match = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/);
      if (match !== null) services.push(match[1]);
    }
    return services;
  } catch {
    return [];
  }
}

/**
 * Propose an AI Workspace configuration for a project that has none.
 *
 * The rules encode what the projects folder actually looks like: nearly every
 * JavaScript project has a conventional `dev` script, the interesting secondary
 * scripts are almost all type-checkers (`check:watch`) or production
 * alternatives (`start`) that must NOT be started alongside `dev` without
 * fighting over a port, and a compose file describes one stack rather than one
 * process per service.
 *
 * @param root - absolute project root.
 * @returns the proposal, its confidence, and the reasoning behind it.
 */
function detectProject(root) {
  const name = basename(root);
  const pkg = readJson(join(root, 'package.json'));
  const scripts = pkg !== null && typeof pkg === 'object' && pkg.scripts !== null && typeof pkg.scripts === 'object'
    ? Object.keys(pkg.scripts)
    : [];
  const manager = packageManagerOf(root);
  const composeFile = COMPOSE_FILES.find((file) => existsSync(join(root, file)));
  const composeServices = composeFile === undefined ? [] : composeServicesOf(join(root, composeFile));

  const serverish = scripts.filter((script) => !NON_SERVER_RE.test(script));
  let primary = PRIMARY_SCRIPTS.find((candidate) => serverish.includes(candidate));
  // A bare `watch` is the last resort: for a compile-only project (a VS Code
  // extension, a library) it is the one genuinely long-running process, but it
  // is also the shape most likely to be a test or lint watcher in disguise, so
  // it is proposed only when nothing better exists and never as high confidence.
  let primaryIsWatcher = false;
  if (primary === undefined && scripts.includes('watch')) {
    primary = 'watch';
    primaryIsWatcher = true;
  }
  // Only `dev:x` / `develop:x` / `serve:x` count as sibling servers of a
  // monorepo; `start:x`, `tauri:dev` and `worker:dev` are too varied to guess.
  const siblings = serverish.filter((script) => /^(dev|develop|serve):/.test(script));

  const proposal = [];
  const notes = [];
  let confidence = 'high';

  if (primary !== undefined) {
    proposal.push({ name: slugify(name), command: `${manager} run ${primary}` });
    if (primaryIsWatcher) {
      notes.push(`the only long-running script is a bare \`${primary}\` — confirm it is the process worth watching`);
    }
    if (siblings.length > 0) {
      notes.push(`also long-running: ${siblings.map((s) => `${manager} run ${s}`).join(', ')}`);
    }
    if (primaryIsWatcher || siblings.length > 0) confidence = 'low';
  } else if (siblings.length > 0) {
    for (const script of siblings) {
      proposal.push({ name: slugify(script.split(':').slice(1).join('-')), command: `${manager} run ${script}` });
    }
    confidence = siblings.length === 1 ? 'high' : 'low';
  }

  if (composeFile !== undefined) {
    if (proposal.length === 0) {
      // One compose stack is one process, however many services it declares.
      proposal.push({ name: 'compose', command: 'docker compose up' });
      confidence = 'high';
      if (composeServices.length > 0) {
        notes.push(`starts ${composeServices.length} service(s): ${composeServices.slice(0, 8).join(', ')}${composeServices.length > 8 ? ', …' : ''}`);
      }
    } else {
      notes.push(`${composeFile} also exists — add it if ${primary === undefined ? 'the dev scripts' : `\`${manager} run ${primary}\``} does not start its services`);
    }
  }

  if (proposal.length === 0) {
    confidence = 'low';
    notes.push(scripts.length === 0
      ? 'no scripts to read — an agent should inspect the project'
      : `no conventional dev script among: ${scripts.slice(0, 10).join(', ')}${scripts.length > 10 ? ', …' : ''}`);
  }

  return {
    name,
    root,
    manager,
    scripts,
    composeFile,
    composeServices,
    proposal,
    // `start` is the production twin of `dev`, not an extra service, so it is
    // never offered as an alternative to a process that already runs the app.
    alternatives: serverish.filter((script) => script !== primary && script !== 'start'),
    notes,
    confidence,
  };
}

/* ------------------------------------------------------------------ *
 * Port management
 * ------------------------------------------------------------------ */

/**
 * How one dev runtime accepts a port, and what it binds by default.
 *
 * `flag` is appended (or substituted into the command when a template with
 * `{port}` is given), `positional` appends a bare number, `env` sets variables,
 * and `unmanaged` marks a runtime whose ports come from its own configuration —
 * `docker compose` publishes whatever the compose file says, so never inject.
 */
const RUNTIMES = [
  { name: 'docker', match: /\bdocker( |-)compose\b|\bdocker compose\b/, unmanaged: true },
  { name: 'vite', match: /\bvite\b/, defaultPort: 5173, flag: '--port' },
  { name: 'astro', match: /\bastro\b/, defaultPort: 4321, flag: '--port' },
  { name: 'next', match: /\bnext (dev|start)\b/, defaultPort: 3000, flag: '-p' },
  { name: 'nuxt', match: /\bnuxt( dev|start)?\b/, defaultPort: 3000, flag: '--port' },
  { name: 'angular', match: /\bng (serve|s)\b/, defaultPort: 4200, flag: '--port' },
  { name: 'storybook', match: /storybook/, defaultPort: 6006, flag: '-p' },
  { name: 'webpack', match: /webpack(-dev-server| serve)/, defaultPort: 8080, flag: '--port' },
  { name: 'expo', match: /\bexpo start\b/, defaultPort: 8081, flag: '--port' },
  { name: 'remix', match: /\bremix dev\b/, defaultPort: 3000, flag: '--port' },
  { name: 'json-server', match: /\bjson-server\b/, defaultPort: 3000, flag: '--port' },
  { name: 'uvicorn', match: /\buvicorn\b/, defaultPort: 8000, flag: '--port' },
  { name: 'gunicorn', match: /\bgunicorn\b/, defaultPort: 8000, flag: '-b 0.0.0.0:{port}' },
  { name: 'flask', match: /\bflask run\b/, defaultPort: 5000, flag: '--port' },
  { name: 'django', match: /\brunserver\b/, defaultPort: 8000, positional: true },
  { name: 'rails', match: /\brails (s|server)\b/, defaultPort: 3000, flag: '-p' },
  { name: 'phoenix', match: /phx\.server/, defaultPort: 4000, env: ['PORT'] },
  { name: 'serve', match: /\bserve\b/, defaultPort: 3000, flag: '-l' },
  { name: 'http-server', match: /\bhttp-server\b/, defaultPort: 8080, flag: '-p' },
  { name: 'live-server', match: /\blive-server\b/, defaultPort: 8080, flag: '--port' },
  // Generic Node-ish servers: PORT is the broadest convention and 3000 the
  // de-facto default for express, nest and hand-rolled servers.
  { name: 'node', match: /\b(node|tsx|ts-node|nodemon|bun|deno|pm2)\b/, defaultPort: 3000, env: ['PORT'] },
];

/** Package-manager prefixes whose next word names a package.json script. */
const SCRIPT_RUNNER_RE = /^\s*(pnpm|npm|yarn|bun|deno)\s+(?:run\s+|task\s+)?([\w:.-]+)(.*)$/;

/** Runner subcommands that name a package rather than a script. */
const RUNNER_SUBCOMMAND_RE = /^(dlx|x|exec|install|add|test|build)$/;

/** Direct executors that wrap the real command. */
const EXECUTOR_RE = /^\s*(npx|pnpx|bunx|pnpm dlx|pnpm exec|yarn dlx)\s+(.+)$/;

/** Ports named directly on the command line. */
const EXPLICIT_PORT_RES = [
  /--port[ =](\d{2,5})/,
  /-p[ =](\d{2,5})\b/,
  /\bPORT=(\d{2,5})\b/,
  /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/,
  /runserver\s+(?:[\d.]+:)?(\d{2,5})/,
];

/**
 * Read a project's package.json scripts.
 * @param cwd - the directory the command runs in.
 * @returns the scripts map, or an empty object.
 */
function readScripts(cwd) {
  const pkg = readJson(join(cwd, 'package.json'));
  return pkg !== undefined && pkg.scripts !== null && typeof pkg.scripts === 'object' ? pkg.scripts : {};
}

/**
 * Unwrap script runners to the command that actually runs, and learn how extra
 * arguments reach it.
 *
 * `pnpm dev` means "run the `dev` script", so the runtime is only discoverable
 * from the script body — and a port argument has to reach that body, which each
 * runner does differently (`npm` needs a `--` separator, `deno task` forwards
 * nothing at all).
 *
 * @param command - the configured shell command.
 * @param cwd - the directory the command runs in.
 * @param depth - recursion guard.
 * @returns the innermost command text and how args are forwarded to it.
 */
function resolveCommand(command, cwd, depth = 0) {
  if (depth > 2) return { inner: command, forward: 'direct' };

  const runner = command.match(SCRIPT_RUNNER_RE);
  if (runner !== null && !RUNNER_SUBCOMMAND_RE.test(runner[2])) {
    const body = readScripts(cwd)[runner[2]];
    if (typeof body === 'string') {
      const inner = resolveCommand(body + (runner[3] ?? ''), cwd, depth + 1);
      if (runner[1] === 'npm') inner.forward = 'dashdash';
      else if (runner[1] === 'deno') inner.forward = 'env-only';
      else inner.forward = 'append';
      return inner;
    }
  }

  const executor = command.match(EXECUTOR_RE);
  if (executor !== null) {
    const inner = resolveCommand(executor[2], cwd, depth + 1);
    inner.forward = 'append';
    return inner;
  }

  return { inner: command, forward: 'direct' };
}

/**
 * Find the runtime a command belongs to.
 * @param inner - the unwrapped command text.
 * @returns the matching runtime, or undefined.
 */
function detectRuntime(inner) {
  return RUNTIMES.find((runtime) => runtime.match.test(inner));
}

/**
 * A port named directly on the command line.
 * @param command - the shell command.
 * @returns the port, or undefined.
 */
function explicitPort(command) {
  for (const pattern of EXPLICIT_PORT_RES) {
    const match = command.match(pattern);
    if (match !== null) return Number(match[1]);
  }
  return undefined;
}

/**
 * A port sniffed from the project's own configuration: a `PORT=` entry in a
 * dotenv file, or `server: { port: … }` in a Vite/Astro/Rsbuild config.
 * @param cwd - the project directory.
 * @returns the port, or undefined.
 */
function configFilePort(cwd) {
  try {
    for (const name of ['.env', '.env.local', '.env.development']) {
      const file = join(cwd, name);
      if (!existsSync(file)) continue;
      const match = readFileSync(file, 'utf8').match(/^\s*PORT\s*=\s*(\d{2,5})/m);
      if (match !== null) return Number(match[1]);
    }
    for (const name of readdirSync(cwd)) {
      if (!/^(vite|astro|rsbuild)\.config\.[jt]sx?$/.test(name)) continue;
      const match = readFileSync(join(cwd, name), 'utf8').match(/server\s*:\s*\{[^}]*?port\s*:\s*(\d{2,5})/s);
      if (match !== null) return Number(match[1]);
    }
  } catch {
    // Best effort: an unreadable config just means no sniffed port.
  }
  return undefined;
}

/**
 * Probe whether a port can be bound right now.
 * @param port - the port to try.
 * @returns true when nothing on the machine holds it.
 */
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '0.0.0.0');
  });
}

/**
 * Allocate a free port, preferring to walk upward from the one that was wanted
 * so the new port stays in the same neighbourhood.
 * @param preferred - the first candidate.
 * @param claimed - ports already claimed by other managed processes.
 * @returns the allocated port.
 */
function allocatePort(preferred, claimed) {
  return (async () => {
    for (let port = preferred; port < preferred + 100; port += 1) {
      if (!claimed.has(port) && await isPortFree(port)) return port;
    }
    // Fall back to an OS-assigned ephemeral port.
    return await new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.once('listening', () => {
        const assigned = server.address().port;
        server.close(() => resolve(assigned));
      });
      server.listen(0, '0.0.0.0');
    });
  })();
}

/**
 * The arguments that carry a port to a runtime.
 * @param runtime - the detected runtime.
 * @param port - the port to inject.
 * @returns the argument text, possibly empty.
 */
function flagArgs(runtime, port) {
  if (runtime.flag !== undefined) {
    return runtime.flag.includes('{port}') ? runtime.flag.replace('{port}', String(port)) : `${runtime.flag} ${port}`;
  }
  if (runtime.positional === true) return String(port);
  return '';
}

/**
 * Decide the port for one process and return the command and environment that
 * enforce it.
 *
 * `claimed` guards against two of our own processes racing for the same port;
 * the live probe guards against everything else on the machine.
 *
 * @param def - the process definition.
 * @param command - the configured shell command.
 * @param cwd - the directory the command runs in.
 * @param env - the environment the process will be given.
 * @param claimed - ports already claimed by other managed processes.
 * @param enabled - whether port management is on at all.
 * @returns the plan: the port, the possibly rewritten command and env, and a note.
 */
async function planProcessPort(def, command, cwd, env, claimed, enabled) {
  const unchanged = { command, env, port: undefined, changed: false, note: undefined };
  if (!enabled || def.port === false) return unchanged;

  const resolved = resolveCommand(command, cwd);
  const runtime = detectRuntime(resolved.inner);
  if (runtime?.unmanaged === true) {
    return { ...unchanged, note: `${runtime.name} publishes its own ports — left unmanaged` };
  }

  const desired = (typeof def.port === 'number' ? def.port : undefined)
    ?? explicitPort(command)
    ?? configFilePort(cwd)
    ?? runtime?.defaultPort;
  if (desired === undefined) return unchanged;

  const pinned = typeof def.port === 'number';

  // Take the port that was wanted whenever it is actually free. The extension
  // this ports had `free && !forced` here, which meant a *pinned* port was never
  // used as-is: it was always shifted to `desired + 1`. Pinning one process to a
  // port it can have should not move it.
  if (!claimed.has(desired) && await isPortFree(desired)) {
    claimed.add(desired);
    return { command, env, port: desired, changed: false, note: undefined };
  }

  const port = await allocatePort(desired + 1, claimed);
  claimed.add(port);
  const reason = pinned ? `pinned port ${desired} in use` : `port ${desired} in use`;

  const canInject = runtime !== undefined && (runtime.flag !== undefined || runtime.positional === true);
  if (canInject && resolved.forward !== 'env-only') {
    const args = flagArgs(runtime, port);
    // Replace an explicit port already in the command before appending.
    const replaced = command.replace(/--port[ =]\d{2,5}/, `--port ${port}`).replace(/-p[ =]\d{2,5}\b/, `-p ${port}`);
    let next = replaced;
    if (replaced === command) {
      // The body is what receives the argument, so the separator the runner
      // needs has to be appended to the outer command.
      next = resolved.forward === 'dashdash' ? `${command} -- ${args}` : `${command} ${args}`;
    }
    return { command: next, env, port, changed: true, note: `${reason} → assigned ${port} (${runtime.name})` };
  }

  // No known injection path: fall back to the PORT convention and say so.
  return {
    command,
    env: { ...env, PORT: String(port) },
    port,
    changed: true,
    note: `${reason} → assigned ${port} via $PORT (verify it binds)`,
  };
}

/* ------------------------------------------------------------------ *
 * Managed process
 * ------------------------------------------------------------------ */

/**
 * One supervised development process: a child process group, the log file its
 * output is mirrored into, and the derived status the panel renders.
 */
class ManagedProcess {
  /**
   * @param project - the owning project record.
   * @param def - the process definition from the project's config file.
   * @param options - supervisor hooks.
   * @param options.maxTailLines - trailing log lines kept in memory.
   * @param options.onChange - called whenever observable state changes.
   * @param options.managePorts - whether to plan a port before spawning.
   * @param options.claimedPorts - ports already claimed by sibling processes.
   */
  constructor(project, def, options) {
    this.project = project;
    this.name = def.name;
    /** The command as configured, for display. */
    this.command = def.command;
    /** The command actually run, after any port injection. */
    this.spawnCommand = def.command;
    this.cwd = def.cwd && def.cwd !== '.' ? resolve(project.root, def.cwd) : project.root;
    this.env = def.env && typeof def.env === 'object' ? def.env : undefined;
    /** Injected environment for the current spawn (a moved $PORT, for example). */
    this.spawnEnv = undefined;
    this.autoStart = def.autoStart !== false;
    this.requestedPort = typeof def.port === 'number' ? def.port : def.port === false ? false : undefined;
    this.managePorts = options.managePorts !== false;
    this.claimedPorts = options.claimedPorts;
    this.logFile = join(project.root, STATE_DIR, 'logs', `${def.name}.log`);

    this.status = 'idle';
    this.exitCode = null;
    this.errorCount = 0;
    this.port = undefined;
    /** Why the port moved, when it did. Surfaced in the panel and the log. */
    this.portNote = undefined;
    this.pid = undefined;
    this.startedAt = undefined;
    this.restarts = 0;

    this.child = undefined;
    this.logStream = undefined;
    this.expectedExit = false;
    this.lineBuffer = '';
    this.portDetected = false;
    this.tail = [];

    this.maxTailLines = options.maxTailLines;
    this.onChange = options.onChange;
  }

  /**
   * Release the port this process claimed, so a later sibling can take it.
   */
  releasePort() {
    if (typeof this.port === 'number' && this.claimedPorts !== undefined) {
      this.claimedPorts.delete(this.port);
    }
  }

  /**
   * Record one chunk of output: mirror it to the log, keep the tail bounded,
   * count error lines and watch for the first bound-port announcement.
   * @param chunk - decoded text from stdout or stderr.
   */
  ingest(chunk) {
    this.logStream?.write(chunk);
    this.lineBuffer += stripAnsi(chunk);
    let index;
    while ((index = this.lineBuffer.indexOf('\n')) >= 0) {
      const line = this.lineBuffer.slice(0, index).replace(/\r$/, '');
      this.lineBuffer = this.lineBuffer.slice(index + 1);
      this.pushTail(line);
      if (isErrorLine(line)) this.errorCount += 1;
      if (this.port === undefined) {
        const match = line.match(PORT_LINE_RE);
        const port = match ? Number(match[1] ?? match[2]) : NaN;
        if (Number.isInteger(port)) this.port = port;
      }
    }
  }

  /**
   * Append one line to the bounded tail.
   * @param line - an ANSI-free output line.
   */
  pushTail(line) {
    this.tail.push(line);
    if (this.tail.length > this.maxTailLines) {
      this.tail.splice(0, this.tail.length - this.maxTailLines);
    }
  }

  /**
   * Write a line to the log file only (never to a terminal, since there is no
   * terminal): used for lifecycle headers and separators.
   * @param text - the text to append.
   */
  note(text) {
    try {
      this.logStream?.write(text);
    } catch {
      /* the stream is already closed; the log simply misses this note */
    }
  }

  /**
   * Spawn the child process group. Assumes no child is currently running.
   */
  spawnChild() {
    ensureDir(dirname(this.logFile));
    if (this.logStream === undefined) {
      this.logStream = createWriteStream(this.logFile, { flags: 'a' });
    }

    const shell = process.env.SHELL && isAbsolute(process.env.SHELL) ? process.env.SHELL : '/bin/sh';
    const env = { ...process.env, ...this.env, ...this.spawnEnv };
    const header = `\n=== '${this.spawnCommand}' started ${new Date().toISOString()} (cwd: ${this.cwd}) ===\n`;
    this.note(header);
    if (this.portNote !== undefined) this.note(`[ai-workspace] ${this.portNote}\n`);
    this.pushTail(`=== started ${new Date().toISOString()} ===`);

    let child;
    try {
      child = spawn(shell, ['-lc', this.spawnCommand], {
        cwd: this.cwd,
        env,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      this.status = 'failed';
      this.exitCode = -1;
      this.note(`[ai-workspace] failed to start: ${String(error)}\n`);
      this.pushTail(`failed to start: ${String(error)}`);
      this.onChange();
      return;
    }

    this.child = child;
    this.status = 'running';
    this.exitCode = null;
    this.pid = child.pid;
    this.startedAt = Date.now();
    this.portDetected = false;
    this.lineBuffer = '';

    child.stdout?.on('data', (data) => { this.ingest(data.toString('utf8')); this.onChange(); });
    child.stderr?.on('data', (data) => { this.ingest(data.toString('utf8')); this.onChange(); });

    child.on('error', (error) => {
      this.note(`[ai-workspace] spawn error: ${error.message}\n`);
      this.pushTail(`spawn error: ${error.message}`);
      this.finish(-1);
    });

    child.on('exit', (code, signal) => {
      const detail = code ?? signal ?? 'signal';
      this.note(`[ai-workspace] process exited with code ${detail}\n`);
      this.pushTail(`process exited with code ${detail}`);
      this.finish(typeof code === 'number' ? code : -1);
    });

    this.onChange();
  }

  /**
   * Settle the process state after its child exited.
   * @param code - the exit code, or -1 when the child never started.
   */
  finish(code) {
    this.exitCode = code;
    this.pid = undefined;
    if (this.expectedExit) {
      this.status = 'stopped';
    } else if (code === 0) {
      this.status = 'exited';
    } else {
      this.status = 'failed';
    }
    this.child = undefined;
    this.onChange();
  }

  /**
   * Plan the port this process will bind, rewriting the command or environment
   * when the port it wants is already taken.
   *
   * This is what actually prevents the collision the prompt section warns the
   * agent about: rather than discovering at runtime that two Vite apps both want
   * 5173, the second one is moved to a free port before it starts.
   */
  async planPort() {
    const def = { port: this.requestedPort };
    const plan = await planProcessPort(def, this.command, this.cwd, this.env ?? {}, this.claimedPorts ?? new Set(), this.managePorts);
    this.spawnCommand = plan.command;
    this.spawnEnv = plan.env === this.env ? undefined : plan.env;
    this.port = plan.port;
    this.portNote = plan.note;
  }

  /**
   * Start the process when it is not already running.
   * @returns a promise resolving true when a start was attempted.
   */
  async start() {
    if (this.status === 'running' || this.status === 'starting') return false;
    this.status = 'starting';
    this.expectedExit = false;
    this.errorCount = 0;
    this.port = undefined;
    this.portNote = undefined;
    // Return the previous claim before probing, so a restart can reuse its own
    // port rather than being pushed off it.
    this.releasePort();
    try {
      await this.planPort();
    } catch (error) {
      this.status = 'failed';
      this.portNote = `port planning failed: ${String(error)}`;
    }
    this.spawnChild();
    return true;
  }

  /**
   * Stop the process and its whole group, keeping the log file.
   * @returns a promise settling once the tree is gone.
   */
  async stop() {
    this.expectedExit = true;
    const pid = this.child?.pid ?? this.pid;
    if (pid !== undefined) await killTree(pid);
    this.releasePort();
    if (this.child === undefined) {
      // Already exited on its own; reflect the requested state anyway.
      this.status = this.status === 'running' ? 'stopped' : this.status;
    }
    this.onChange();
  }

  /**
   * Stop, then start again, appending one separator to the same log so the
   * process keeps a single continuous history.
   * @returns a promise settling once the process is running again.
   */
  async restart() {
    await this.stop();
    this.restarts += 1;
    this.expectedExit = false;
    this.note(`\n=== RESTARTED ${new Date().toISOString()} ===\n`);
    this.pushTail(`=== restarted ${new Date().toISOString()} ===`);
    await this.planPort();
    this.spawnChild();
  }

  /**
   * Stop and release the log stream. Called when the plugin unloads.
   * @returns a promise settling once the tree is gone.
   */
  async dispose() {
    await this.stop();
    try {
      this.logStream?.end();
    } catch {
      /* already ended */
    }
    this.logStream = undefined;
  }

  /**
   * The panel-facing projection of this process.
   * @returns plain JSON-safe state.
   */
  snapshot() {
    return {
      name: this.name,
      command: this.command,
      cwd: this.cwd,
      status: this.status,
      exitCode: this.exitCode,
      errorCount: this.errorCount,
      port: this.port,
      portNote: this.portNote,
      /** Set when port management rewrote the command, for display. */
      effectiveCommand: this.spawnCommand === this.command ? undefined : this.spawnCommand,
      pid: this.pid,
      startedAt: this.startedAt,
      restarts: this.restarts,
      autoStart: this.autoStart,
      logFile: this.logFile,
      tail: this.tail,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Supervisor
 * ------------------------------------------------------------------ */

/**
 * Owns discovery and every managed process across all configured projects, and
 * publishes the JSON snapshot the Client half reads.
 */
class Supervisor {
  /**
   * @param config - the plugin's resolved configuration.
   * @param logger - the plugin's Cordis logger.
   */
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.projects = [];
    this.candidates = [];
    this.processes = new Map();
    /**
     * Ports claimed by this profile's processes, across every project. Guards
     * the launch race that a live probe alone cannot: two of our own processes
     * starting at the same moment would both see the port free.
     */
    this.claimedPorts = new Set();
    this.dirty = false;
    this.lastFlush = 0;
    this.lastDiscover = 0;
    /**
     * What actually mounted, mirrored into the snapshot so a wiring failure is
     * visible from the panel instead of only in the Host log.
     */
    this.wiring = { tool: 'pending' };

    const flushMs = Number.isFinite(config.flushMs) && config.flushMs > 0 ? config.flushMs : 1000;
    this.flushMs = flushMs;
    this.timer = setInterval(() => {
      if (this.dirty) this.flush();
    }, flushMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  /**
   * A stable key for one process, unique across projects.
   * @param projectRoot - absolute project root.
   * @param processName - the process name.
   * @returns the map key.
   */
  static key(projectRoot, processName) {
    return `${projectRoot}\u0000${processName}`;
  }

  /**
   * Mark the snapshot stale and flush immediately when the interval is due.
   */
  touch() {
    this.dirty = true;
    if (Date.now() - this.lastFlush >= this.flushMs) this.flush();
  }

  /**
   * Scan the projects root and the explicit project list, rebuild the project
   * table, and reconcile running processes against the discovered definitions.
   * A process that is still running keeps running across a rescan unless its
   * definition disappeared.
   */
  discover() {
    const roots = [];

    if (this.config.autoDiscover !== false) {
      const projectsRoot = this.config.projectsRoot ?? DEFAULT_PROJECTS_ROOT;
      try {
        const entries = readdirSync(projectsRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
          if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
          roots.push(join(projectsRoot, entry.name));
        }
      } catch (error) {
        this.logger?.warn(`ai-workspace: cannot scan ${projectsRoot}: ${String(error)}`);
      }
    }

    for (const extra of Array.isArray(this.config.projects) ? this.config.projects : []) {
      if (typeof extra === 'string' && extra.trim().length > 0) roots.push(resolve(extra.trim()));
    }

    const projects = [];
    const candidates = [];
    for (const root of roots) {
      const configName = CONFIG_NAMES.find((name) => existsSync(join(root, name)));
      if (configName === undefined) {
        // No config yet: this is an onboarding candidate, not a managed
        // project. A folder with no manifest at all is not worth proposing.
        const candidate = detectProject(root);
        if (candidate.scripts.length > 0 || candidate.composeFile !== undefined) candidates.push(candidate);
        continue;
      }

      const file = join(root, configName);
      const record = { name: basename(root), root, configFile: file, source: configName, processes: [], error: undefined };

      const raw = readJson(file);
      if (raw === undefined) {
        record.error = `${configName} is not valid JSON`;
        projects.push(record);
        continue;
      }

      const defs = Array.isArray(raw.processes) ? raw.processes : [];
      for (const def of defs) {
        if (def === null || typeof def !== 'object') continue;
        if (typeof def.name !== 'string' || def.name.trim().length === 0) continue;
        if (typeof def.command !== 'string' || def.command.trim().length === 0) continue;
        const clean = {
          name: def.name.trim(),
          command: def.command.trim(),
          cwd: typeof def.cwd === 'string' ? def.cwd : undefined,
          env: def.env && typeof def.env === 'object' ? def.env : undefined,
          autoStart: def.autoStart !== false,
          // `number` pins a port, `false` opts out of port management.
          port: typeof def.port === 'number' ? def.port : def.port === false ? false : undefined,
        };

        const key = Supervisor.key(root, clean.name);
        let managed = this.processes.get(key);
        if (managed === undefined) {
          managed = new ManagedProcess(record, clean, {
            maxTailLines: Number.isFinite(this.config.maxTailLines) && this.config.maxTailLines > 0
              ? this.config.maxTailLines
              : 30,
            managePorts: this.config.managePorts !== false,
            claimedPorts: this.claimedPorts,
            onChange: () => this.touch(),
          });
          this.processes.set(key, managed);
        } else {
          // Keep the live object (and any running child) but refresh its origin
          // and the port policy, which the config file may have changed.
          managed.project = record;
          managed.managePorts = this.config.managePorts !== false;
          managed.requestedPort = clean.port;
        }
        record.processes.push(managed);
      }
      projects.push(record);
    }

    // Forget processes whose definition vanished on rescan, stopping them first.
    const live = new Set();
    for (const project of projects) {
      for (const managed of project.processes) live.add(Supervisor.key(project.root, managed.name));
    }
    for (const [key, managed] of this.processes) {
      if (!live.has(key)) {
        this.processes.delete(key);
        void managed.dispose();
      }
    }

    this.projects = projects;
    this.candidates = candidates.sort((left, right) => left.name.localeCompare(right.name));
    this.lastDiscover = Date.now();
    if (this.config.writeAgentsMd === true) {
      for (const project of projects) this.writeAgentsSection(project);
    }
    this.dirty = true;
    this.flush();
    this.logger?.info(`ai-workspace: ${projects.length} project(s), ${this.processes.size} process(es), ${candidates.length} candidate(s)`);
    return projects;
  }

  /**
   * Rescan, but at most once per interval, so a tool call that reads state
   * twice in a row does not re-read 140 manifests each time.
   * @param maxAgeMs - how stale the last scan may be.
   * @returns true when a scan ran.
   */
  discoverIfStale(maxAgeMs = 5000) {
    if (Date.now() - this.lastDiscover < maxAgeMs) return false;
    this.discover();
    return true;
  }

  /**
   * Every process, flattened across projects.
   * @returns the managed processes.
   */
  all() {
    return [...this.processes.values()];
  }

  /**
   * Find a project by exact root, exact name, or unique name fragment.
   * @param needle - the user-supplied project reference.
   * @returns the matching project record, or undefined.
   */
  findProject(needle) {
    if (needle === undefined || needle.length === 0) return this.projects.length === 1 ? this.projects[0] : undefined;
    const exact = this.projects.find((project) => project.root === needle || project.name === needle);
    if (exact !== undefined) return exact;
    const matches = this.projects.filter((project) => project.root.includes(needle) || project.name.includes(needle));
    return matches.length === 1 ? matches[0] : undefined;
  }

  /**
   * Find an un-onboarded candidate by exact root, exact name, or unique fragment.
   * @param needle - the user-supplied project reference.
   * @returns the matching candidate, or undefined.
   */
  findCandidate(needle) {
    if (needle === undefined || needle.length === 0) return undefined;
    const exact = this.candidates.find((candidate) => candidate.root === needle || candidate.name === needle);
    if (exact !== undefined) return exact;
    const matches = this.candidates.filter((candidate) => candidate.root.includes(needle) || candidate.name.includes(needle));
    return matches.length === 1 ? matches[0] : undefined;
  }

  /**
   * Resolve a project reference to either a managed project or a candidate, so
   * that commands such as `init` and `fix` can name a project that has no
   * config file yet.
   * @param needle - the user-supplied project reference.
   * @returns a project-shaped record, or undefined.
   */
  findAny(needle) {
    const project = this.findProject(needle);
    if (project !== undefined) return project;
    const candidate = this.findCandidate(needle);
    if (candidate === undefined) return undefined;
    return {
      name: candidate.name,
      root: candidate.root,
      configFile: join(candidate.root, CONFIG_NAMES[0]),
      source: undefined,
      processes: [],
      error: undefined,
      onboarded: false,
    };
  }

  /**
   * Write the detected config for one candidate project, then rescan so it
   * becomes a managed project. Never overwrites an existing config.
   * @param ref - project root, name, or unique fragment.
   * @returns a `{ ok, lines }` summary.
   */
  onboard(ref) {
    const candidate = this.findCandidate(ref);
    if (candidate === undefined) return { ok: false, lines: [`no un-onboarded project matches "${ref ?? ''}"`] };
    if (candidate.proposal.length === 0) {
      return { ok: false, lines: [`nothing detected for ${candidate.name} — run /ai-workspace init ${candidate.name} to have an agent inspect it`] };
    }
    const file = join(candidate.root, CONFIG_NAMES[0]);
    if (existsSync(file)) return { ok: false, lines: [`${candidate.name} already has a config file`] };
    try {
      writeFileSync(file, `${JSON.stringify({ processes: candidate.proposal }, null, 2)}\n`, 'utf8');
    } catch (error) {
      return { ok: false, lines: [`cannot write ${file}: ${String(error)}`] };
    }
    this.discover();
    return { ok: true, lines: [`onboarded ${candidate.name} → ${candidate.proposal.map((p) => p.command).join(', ')}`] };
  }

  /**
   * Write detected configs for every candidate that has a proposal.
   * @param onlyHigh - restrict to high-confidence proposals (the default).
   * @returns a `{ ok, lines }` summary naming each project written.
   */
  onboardAll(onlyHigh = true) {
    const eligible = this.candidates.filter((candidate) => candidate.proposal.length > 0 && (!onlyHigh || candidate.confidence === 'high'));
    if (eligible.length === 0) {
      return { ok: true, lines: [onlyHigh ? 'no high-confidence proposals to onboard' : 'nothing to onboard'] };
    }
    const lines = [];
    for (const candidate of eligible) {
      const file = join(candidate.root, CONFIG_NAMES[0]);
      if (existsSync(file)) { lines.push(`skipped ${candidate.name} (a config appeared)`); continue; }
      try {
        writeFileSync(file, `${JSON.stringify({ processes: candidate.proposal }, null, 2)}\n`, 'utf8');
        lines.push(`${candidate.name} → ${candidate.proposal.map((p) => p.command).join(', ')}`);
      } catch (error) {
        lines.push(`FAILED ${candidate.name}: ${String(error)}`);
      }
    }
    this.discover();
    return { ok: true, lines };
  }

  /**
   * Remove the config file this plugin writes for a project, stopping its
   * processes first, and turn it back into an onboarding candidate.
   *
   * Only `.ai-workspace.json` is ever removed — that is the file this plugin
   * creates. A project configured by a hand-written
   * `.claude-workspace.json` is left alone and reported as the user's to manage,
   * so a misdetection can be undone without touching a config someone wrote.
   *
   * @param ref - project root, name, or unique fragment.
   * @returns a promise for a `{ ok, lines }` summary.
   */
  async offboard(ref) {
    const project = this.findProject(ref);
    if (project === undefined) return { ok: false, lines: [noProjectText(this, ref)] };

    const file = join(project.root, CONFIG_NAMES[0]);
    if (!existsSync(file)) {
      return {
        ok: false,
        lines: [`${project.name} is configured by ${project.source ?? 'no file'}; there is no ${CONFIG_NAMES[0]} for the plugin to remove. Edit or delete that file yourself.`],
      };
    }

    const names = project.processes.map((managed) => managed.name);
    await Promise.all(project.processes.map((managed) => managed.dispose()));
    this.processes.clear();

    try {
      unlinkSync(file);
    } catch (error) {
      this.discover();
      return { ok: false, lines: [`could not remove ${file}: ${String(error)}`] };
    }

    this.discover();
    return {
      ok: true,
      lines: [
        `removed ${CONFIG_NAMES[0]} from ${project.name}`,
        names.length === 0 ? 'no processes to stop' : `stopped: ${names.join(', ')}`,
        project.root,
      ],
    };
  }

  /**
   * Look up one process by project reference and process name.
   * @param projectRef - project root, name, or fragment.
   * @param processName - the process name.
   * @returns the managed process, or undefined.
   */
  findProcess(projectRef, processName) {
    const project = this.findProject(projectRef);
    if (project === undefined) return undefined;
    return project.processes.find((managed) => managed.name === processName);
  }

  /**
   * Start one process, one project's processes, or everything.
   * @param projectRef - project reference; empty means every project.
   * @param processName - process name; empty means every process in the project.
   * @returns a summary of what was attempted.
   */
  start(projectRef, processName) {
    return this.act('start', projectRef, processName);
  }

  /**
   * Stop one process, one project's processes, or everything.
   * @param projectRef - project reference; empty means every project.
   * @param processName - process name; empty means every process in the project.
   * @returns a summary of what was attempted.
   */
  stop(projectRef, processName) {
    return this.act('stop', projectRef, processName);
  }

  /**
   * Restart one process, one project's processes, or everything.
   * @param projectRef - project reference; empty means every project.
   * @param processName - process name; empty means every process in the project.
   * @returns a summary of what was attempted.
   */
  restart(projectRef, processName) {
    return this.act('restart', projectRef, processName);
  }

  /**
   * Apply one lifecycle verb to a selection of processes.
   * @param verb - 'start', 'stop' or 'restart'.
   * @param projectRef - project reference; empty means every project.
   * @param processName - process name; empty means every process in the project.
   * @returns a promise for a `{ verb, projectRef, changed, lines }` summary.
   */
  async act(verb, projectRef, processName) {
    const targets = [];
    if (projectRef === undefined || projectRef.length === 0) {
      for (const project of this.projects) {
        for (const managed of project.processes) targets.push(managed);
      }
    } else {
      const project = this.findProject(projectRef);
      if (project === undefined) {
        return { verb, projectRef, changed: 0, lines: [`no project matches "${projectRef}"`] };
      }
      const selected = processName === undefined || processName.length === 0
        ? project.processes
        : project.processes.filter((managed) => managed.name === processName);
      if (selected.length === 0) {
        return { verb, projectRef, changed: 0, lines: [`no process "${processName ?? ''}" in ${project.name}`] };
      }
      targets.push(...selected);
    }

    const lines = [];
    let changed = 0;
    for (const managed of targets) {
      if (verb === 'start') {
        if (await managed.start()) {
          changed += 1;
          const note = managed.portNote === undefined ? '' : `  (${managed.portNote})`;
          lines.push(`started ${managed.project.name}/${managed.name}${note}`);
        } else {
          lines.push(`${managed.project.name}/${managed.name} already ${managed.status}`);
        }
      } else if (verb === 'stop') {
        await managed.stop();
        changed += 1;
        lines.push(`stopped ${managed.project.name}/${managed.name}`);
      } else {
        await managed.restart();
        changed += 1;
        lines.push(`restarted ${managed.project.name}/${managed.name}`);
      }
    }
    this.flush();
    return { verb, projectRef, changed, lines };
  }

  /**
   * Start every process whose definition allows it. Ports are planned first, so
   * several processes wanting the same default port are spread out instead of
   * racing for it.
   * @returns a promise settling once every start has been attempted.
   */
  async startAuto() {
    for (const managed of this.all()) {
      if (managed.autoStart) await managed.start();
    }
    this.flush();
  }

  /**
   * Stop every running process. Used when the plugin unloads.
   * @returns a promise settling once every tree is gone.
   */
  async stopAll() {
    await Promise.all(this.all().map((managed) => managed.dispose()));
    this.processes.clear();
    this.flush();
  }

  /**
   * The panel-facing projection of everything this supervisor owns.
   * @returns plain JSON-safe state.
   */
  snapshot() {
    return {
      version: 1,
      generatedAt: Date.now(),
      projectsRoot: this.config.projectsRoot ?? DEFAULT_PROJECTS_ROOT,
      statusPath: STATUS_PATH,
      wiring: this.wiring,
      projects: this.projects.map((project) => ({
        name: project.name,
        root: project.root,
        source: project.source,
        error: project.error,
        processes: project.processes.map((managed) => managed.snapshot()),
      })),
      candidates: this.candidates.map((candidate) => ({
        name: candidate.name,
        root: candidate.root,
        manager: candidate.manager,
        confidence: candidate.confidence,
        proposal: candidate.proposal,
        alternatives: candidate.alternatives,
        notes: candidate.notes,
        composeFile: candidate.composeFile,
      })),
    };
  }

  /**
   * Rewrite the status snapshot for the Client half. Written to a temporary
   * sibling and renamed, so a concurrent read sees either the old file or the
   * new one and never a torn document.
   */
  flush() {
    this.dirty = false;
    this.lastFlush = Date.now();
    try {
      ensureDir(dirname(STATUS_PATH));
      const temporary = `${STATUS_PATH}.tmp`;
      writeFileSync(temporary, JSON.stringify(this.snapshot()), 'utf8');
      renameSync(temporary, STATUS_PATH);
    } catch (error) {
      this.logger?.warn(`ai-workspace: cannot write ${STATUS_PATH}: ${String(error)}`);
    }
  }

  /**
   * Maintain the marked AI Workspace section in a project's agent instruction
   * files. Off by default: inside DeepSeek Harness the system-prompt section is
   * the native channel, and this exists for other editors and agents.
   * @param project - the project record to write into.
   */
  writeAgentsSection(project) {
    const running = project.processes.filter((managed) => managed.status === 'running');
    const rows = project.processes
      .map((managed) => `| \`${managed.name}\` | \`${managed.command}\` | \`${join(STATE_DIR, 'logs', `${managed.name}.log`)}\` |`)
      .join('\n');

    const body = `${MARKER_START}
## AI Workspace — Managed Dev Processes

This project's dev processes run in the background under **AI Workspace** and
their output is captured to log files inside this repository.

| Process | Command | Log file |
|---------|---------|----------|
${rows}

### Rules

- **Do NOT run build/dev commands** (\`npm run dev\`, \`pnpm build\`, \`tsc --watch\`, …).
  The processes are already running; duplicating them causes port conflicts.
- After editing code, **wait a couple of seconds for hot-reload**, then read the
  logs instead of asking for a terminal:

  \`\`\`bash
  tail -n 100 ${STATE_DIR}/logs/<process>.log
  grep -nEi 'error|failed|exception' ${STATE_DIR}/logs/<process>.log | tail -50
  \`\`\`

- ${running.length} of ${project.processes.length} process(es) running.
${MARKER_END}
`;

    for (const file of [join(project.root, 'AGENTS.md'), join(project.root, 'CLAUDE.md')]) {
      // Only touch a file that already exists: never create one just for this.
      if (!existsSync(file)) continue;
      try {
        let content = readFileSync(file, 'utf8');
        const start = content.indexOf(MARKER_START);
        const end = content.indexOf(MARKER_END);
        if (start >= 0 && end > start) {
          content = content.slice(0, start) + body.trimEnd() + content.slice(end + MARKER_END.length);
        } else {
          content = `${content.trimEnd()}\n\n${body}`;
        }
        writeFileSync(file, content, 'utf8');
      } catch (error) {
        this.logger?.warn(`ai-workspace: cannot update ${file}: ${String(error)}`);
      }
    }
  }

  /**
   * The text the agent sees: that dev processes are already running, and how to
   * read them. Empty when nothing is running, so the section costs nothing.
   *
   * Deliberately compact. The earlier version listed one table row per process,
   * which was fine for four projects and a liability for forty: it put a
   * forty-row table into every request and churned the KV prefix on each change.
   * Now the section states the rule, names the projects, and hands the detail to
   * the `ai_workspace` tool — which is also the way the agent should read the
   * output in the first place.
   *
   * @returns the prompt section text.
   */
  instructionText() {
    const byProject = [];
    let running = 0;
    for (const project of this.projects) {
      const active = project.processes.filter((managed) => managed.status === 'running');
      if (active.length === 0) continue;
      byProject.push([project, active]);
      running += active.length;
    }
    if (running === 0) return '';

    const shown = byProject.slice(0, PROJECT_SUMMARY_LIMIT);
    const list = shown.map(([project, active]) => `- \`${project.name}\` — ${active.map((managed) => managed.name).join(', ')}`);
    if (byProject.length > shown.length) {
      list.push(`- … and ${byProject.length - shown.length} more project(s)`);
    }

    const warned = [];
    for (const [project, active] of byProject) {
      for (const managed of active) {
        if (managed.errorCount > 0) warned.push(`\`${project.name}/${managed.name}\` (${managed.errorCount})`);
      }
    }
    const errorLine = warned.length === 0
      ? ''
      : `\nRunning with error-like output: ${warned.slice(0, ERROR_HIGHLIGHT_LIMIT).join(', ')}${warned.length > ERROR_HIGHLIGHT_LIMIT ? `, and ${warned.length - ERROR_HIGHLIGHT_LIMIT} more` : ''}.\n`;

    return `## AI Workspace — managed dev processes are already running

${running} development process(es) across ${byProject.length} project(s) run in the background, with their output captured to log files under \`<project>/.ai-workspace/logs/<process>.log\`.

${list.join('\n')}
${errorLine}
- **Do NOT run build, dev, watch, or test commands** (\`pnpm dev\`, \`pnpm build\`, \`tsc --watch\`, \`npm start\`, …). These processes already run them; starting a second copy causes port conflicts and duplicated work.
- After editing code, **wait a couple of seconds for hot reload**, then read what the process printed with the \`ai_workspace\` tool — no shell command and no log file to find:

  - \`ai_workspace\` with \`{ "action": "logs", "project": "<project>", "process": "<process>" }\` returns that process's recent output.
  - \`ai_workspace\` with \`{ "action": "errors" }\` returns the error-like lines across every managed process.
  - \`ai_workspace\` with \`{ "action": "status" }\` returns every process and its state.

  If the tool is not available in this session, read the log file directly instead:

  \`\`\`bash
  tail -n 100 <project>/.ai-workspace/logs/<process>.log
  grep -nEi 'error|failed|exception' <project>/.ai-workspace/logs/<process>.log | tail -50
  \`\`\`

- Restart a process with \`ai_workspace\` \`{ "action": "restart", … }\` or \`/ai-workspace restart <project> <process>\` rather than killing and relaunching it yourself.
- The \`AI Workspace\` panel in the sidebar shows the same status, error counts and log tails.`;
  }
}

/* ------------------------------------------------------------------ *
 * Cordis plugin
 * ------------------------------------------------------------------ */

/**
 * Host entry point.
 *
 * No services are declared as hard dependencies: discovery, supervision and
 * publication use Node built-ins only, so the plugin stays useful in any
 * profile. The optional `systemPrompt` and `commands` services are picked up
 * through `ctx.inject`, which keeps the plugin active in profiles that lack
 * them.
 *
 * @param ctx - the Host plugin context.
 * @param config - the row's `config` from the bundle patch.
 */
export function apply(ctx, config = {}) {
  const settings = {
    projectsRoot: typeof config.projectsRoot === 'string' && config.projectsRoot.trim().length > 0
      ? resolve(config.projectsRoot.trim())
      : DEFAULT_PROJECTS_ROOT,
    projects: Array.isArray(config.projects) ? config.projects : [],
    autoDiscover: config.autoDiscover !== false,
    autoStart: config.autoStart === true,
    managePorts: config.managePorts !== false,
    flushMs: Number.isFinite(config.flushMs) ? config.flushMs : 1000,
    maxTailLines: Number.isFinite(config.maxTailLines) ? config.maxTailLines : 30,
    writeAgentsMd: config.writeAgentsMd === true,
  };

  const logger = ctx.logger;
  const supervisor = new Supervisor(settings, logger);

  ctx.effect(() => {
    supervisor.discover();
    // Port planning probes the machine, so starting is asynchronous; the plugin
    // does not need to hold the effect open for it.
    if (settings.autoStart) void supervisor.startAuto();

    // Rescan slowly so projects added while the profile runs are picked up.
    const rescan = setInterval(() => { supervisor.discover(); }, 60_000);
    if (typeof rescan.unref === 'function') rescan.unref();

    return () => {
      clearInterval(rescan);
      clearInterval(supervisor.timer);
      void supervisor.stopAll();
    };
  }, 'ai-workspace: supervisor');

  // The agent-facing instruction. A dynamic `text` keeps it honest: it is empty
  // while nothing runs, so an idle plugin adds nothing to the prompt.
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.effect(() => promptCtx.systemPrompt.section({
      name: 'ai-workspace.dev-processes',
      order: 1500,
      text: () => supervisor.instructionText(),
    }), 'ai-workspace: prompt section');
  });

  // The panel's control channel: a root-scoped panel has no other way to call
  // into the Host, so every button executes this command.
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.effect(() => commandCtx.commands.register({
      name: 'ai-workspace',
      description: 'Manage AI Workspace dev processes: status, candidates, onboard, offboard, start, stop, restart, init',
      recordInput: false,
      input: { hint: '<status|candidates|onboard|offboard|init|fix|start|stop|restart|start-all|stop-all|rescan> [project] [process]' },
      handler: async ({ agent, rawInput }) => {
        const [verb = 'status', ...rest] = String(rawInput ?? '').trim().split(/\s+/).filter(Boolean);

        if (verb === 'status' || verb === 'list') {
          return { kind: 'success', text: statusText(supervisor) };
        }
        if (verb === 'rescan' || verb === 'discover') {
          supervisor.discover();
          return { kind: 'success', text: `Rescanned. ${statusText(supervisor)}` };
        }
        if (verb === 'start-all') {
          const result = await supervisor.act('start');
          return { kind: 'success', text: result.lines.join('\n') || 'Nothing to start.' };
        }
        if (verb === 'stop-all') {
          const result = await supervisor.act('stop');
          return { kind: 'success', text: result.lines.join('\n') || 'Nothing to stop.' };
        }
        if (verb === 'start' || verb === 'stop' || verb === 'restart') {
          const projectRef = rest[0];
          const processName = rest[1];
          const result = await supervisor.act(verb, projectRef, processName);
          const text = result.lines.join('\n');
          return result.changed > 0
            ? { kind: 'success', text }
            : { kind: 'error', text: text || `Nothing matched "${rest.join(' ')}".` };
        }
        if (verb === 'init' || verb === 'fix') {
          return dispatchConfigAgent(ctx, supervisor, agent, verb, rest);
        }
        if (verb === 'candidates' || verb === 'todo') {
          return { kind: 'success', text: candidatesText(supervisor) };
        }
        if (verb === 'onboard') {
          const target = rest[0];
          // `onboard --all` writes only high-confidence proposals;
          // `onboard --all --low` writes everything the detector proposed.
          if (target === '--all' || target === 'all') {
            const result = supervisor.onboardAll(!rest.includes('--low'));
            return { kind: 'success', text: result.lines.join('\n') };
          }
          const result = supervisor.onboard(target);
          return result.ok
            ? { kind: 'success', text: result.lines.join('\n') }
            : { kind: 'error', text: result.lines.join('\n') };
        }
        // Deliberately command-only, never a model tool action: removing a
        // project's config is the user's call, and an agent that needs to can
        // already delete the file with its own tools.
        if (verb === 'offboard' || verb === 'unonboard') {
          const result = await supervisor.offboard(rest[0]);
          return result.ok
            ? { kind: 'success', text: result.lines.join('\n') }
            : { kind: 'error', text: result.lines.join('\n') };
        }

        return {
          kind: 'error',
          text: `Unknown subcommand "${verb}". Use status, candidates, onboard, offboard, init, fix, start, stop, restart, start-all, stop-all, or rescan.`,
        };
      },
    }), 'ai-workspace: command');
  });

  // A model-facing tool, so an agent reads the captured output directly instead
  // of shelling out to `tail` — which is the entire point of capturing it. The
  // registry takes a plain JSON Schema, so this imports no Harness package and
  // cannot fail on module resolution; a failure is recorded in the snapshot
  // rather than thrown.
  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.effect(() => {
      try {
        const dispose = toolCtx.tools.register({
          name: 'ai_workspace',
          description: [
            'Inspect and control the AI Workspace dev processes for this machine\'s projects.',
            'Each process already runs in the background with its output captured to a log file, so use action "logs" or "errors" to read what a process printed instead of running the dev/build command again or tailing the file yourself.',
            'Action "candidates" lists projects that have no config yet, with the processes detected for each.',
          ].join(' '),
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['action'],
            properties: {
              action: {
                type: 'string',
                enum: ['status', 'logs', 'errors', 'candidates', 'start', 'stop', 'restart', 'rescan'],
                description: 'What to do.',
              },
              project: { type: 'string', description: 'Project folder name, or a unique fragment of it.' },
              process: { type: 'string', description: 'Process name within the project, for "logs" and the lifecycle actions.' },
              lines: { type: 'number', description: 'How many log lines to return (default 50, maximum 200).' },
            },
          },
          output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
          },
          async execute(args) {
            return await runTool(supervisor, args);
          },
        });
        supervisor.wiring.tool = 'ready';
        // The supervisor already flushed once during discovery; publish the
        // wiring result so the panel and tooling can read it without waiting
        // for the next interval.
        supervisor.flush();
        return dispose;
      } catch (error) {
        supervisor.wiring.tool = `unavailable: ${String(error.message ?? error)}`;
        supervisor.flush();
        ctx.logger?.warn(`ai-workspace: model tool unavailable: ${String(error)}`);
        return () => undefined;
      }
    }, 'ai-workspace: ai_workspace tool');
  });

  return () => { void supervisor.stopAll(); };
}

/**
 * Render the supervisor's state as text for a command result.
 * @param supervisor - the supervisor to describe.
 * @returns a multi-line status report.
 */
function statusText(supervisor) {
  if (supervisor.projects.length === 0) {
    return `No project under ${supervisor.config.projectsRoot} has an .ai-workspace.json. Run /ai-workspace init <project> to generate one.`;
  }
  const lines = [];
  for (const project of supervisor.projects) {
    lines.push(`${project.name}  (${project.root})`);
    if (project.error !== undefined) {
      lines.push(`  ! ${project.error}`);
      continue;
    }
    if (project.processes.length === 0) {
      lines.push('  (no processes configured)');
      continue;
    }
    for (const managed of project.processes) {
      const state = managed.snapshot();
      const port = state.port === undefined ? '' : ` :${state.port}`;
      const errors = state.errorCount > 0 ? ` — ${state.errorCount} error-like lines` : '';
      lines.push(`  ${state.status.padEnd(8)} ${state.name}${port}${errors}  ${state.logFile}`);
    }
  }
  return lines.join('\n');
}

/**
 * Render the onboarding backlog as text for a command result.
 * @param supervisor - the supervisor whose candidates to describe.
 * @returns a multi-line report of every un-onboarded project and its proposal.
 */
function candidatesText(supervisor) {
  if (supervisor.candidates.length === 0) return 'Every project under the projects root is already onboarded.';
  const high = supervisor.candidates.filter((candidate) => candidate.proposal.length > 0 && candidate.confidence === 'high');
  const lines = [
    `${supervisor.candidates.length} project(s) without a config, ${high.length} with a high-confidence proposal.`,
    '',
  ];
  for (const candidate of supervisor.candidates) {
    const mark = candidate.confidence === 'high' && candidate.proposal.length > 0 ? '+' : '·';
    const proposed = candidate.proposal.length === 0
      ? '(nothing detected — needs an agent)'
      : candidate.proposal.map((entry) => entry.command).join(' + ');
    lines.push(`${mark} ${candidate.name.padEnd(30)} ${proposed}`);
    for (const note of candidate.notes) lines.push(`    ${note}`);
  }
  lines.push('', 'Onboard one: /ai-workspace onboard <project>   ·   All high-confidence: /ai-workspace onboard --all');
  return lines.join('\n');
}

/**
 * The managed projects, phrased for a caller that named one that does not exist.
 * @param supervisor - the supervisor.
 * @param projectRef - what the caller asked for.
 * @returns a readable refusal.
 */
function noProjectText(supervisor, projectRef) {
  const known = supervisor.projects.map((project) => project.name);
  if (known.length === 0) {
    return 'No project is managed yet. Read the AI Workspace panel, or call this tool with action "candidates" to see what could be onboarded.';
  }
  return `No project matches "${projectRef ?? ''}". Managed: ${known.join(', ')}.`;
}

/**
 * Render the tail of one managed process's captured log.
 *
 * This is the point of the plugin: the agent reads what the process already
 * printed rather than running the dev command again to find out.
 *
 * @param supervisor - the supervisor.
 * @param projectRef - project name or unique fragment.
 * @param processName - process name within that project.
 * @param lines - how many trailing lines to return.
 * @returns the header and log tail, or a readable refusal.
 */
function logsText(supervisor, projectRef, processName, lines) {
  if (projectRef === undefined || projectRef.length === 0) {
    const managed = supervisor.all();
    if (managed.length === 0) return 'No dev process is running or managed yet.';
    return `Name a project and process. Managed: ${managed.map((entry) => `${entry.project.name}/${entry.name}`).join(', ')}`;
  }
  const project = supervisor.findProject(projectRef);
  if (project === undefined) return noProjectText(supervisor, projectRef);

  if (processName === undefined || processName.length === 0) {
    if (project.processes.length === 1) return logsText(supervisor, projectRef, project.processes[0].name, lines);
    return `${project.name} has ${project.processes.length} processes: ${project.processes.map((entry) => entry.name).join(', ')}. Name one.`;
  }

  const managed = project.processes.find((entry) => entry.name === processName);
  if (managed === undefined) {
    return `No process "${processName}" in ${project.name}. It has: ${project.processes.map((entry) => entry.name).join(', ') || '(none)'}.`;
  }
  if (!existsSync(managed.logFile)) {
    return `${project.name}/${managed.name} has not written a log yet (${managed.logFile}). Status: ${managed.status}.`;
  }

  const state = managed.snapshot();
  const header = [
    `${project.name}/${managed.name}  [${state.status}]`,
    `command: ${managed.command}`,
    `cwd: ${managed.cwd}`,
    state.port === undefined ? undefined : `port: ${state.port}`,
    `log: ${managed.logFile}`,
    `${state.errorCount} error-like line(s) so far`,
  ].filter((line) => line !== undefined).join('\n');

  const tail = tailLines(managed.logFile, lines);
  return `${header}\n\n--- last ${tail.length} line(s) ---\n${tail.join('\n')}`;
}

/**
 * Render error-like lines from the managed process logs.
 * @param supervisor - the supervisor.
 * @param projectRef - restrict to one project, or undefined for all.
 * @param lines - how many matching lines to return per process.
 * @returns the matching lines, grouped by process.
 */
function errorsText(supervisor, projectRef, lines) {
  const projects = projectRef === undefined || projectRef.length === 0
    ? supervisor.projects
    : [supervisor.findProject(projectRef)].filter((project) => project !== undefined);
  if (projects.length === 0) return noProjectText(supervisor, projectRef);

  const parts = [];
  for (const project of projects) {
    for (const managed of project.processes) {
      if (!existsSync(managed.logFile)) continue;
      const found = errorLines(managed.logFile, lines);
      if (found.length > 0) {
        parts.push(`--- ${project.name}/${managed.name} (${found.length}) ---`, ...found, '');
      }
    }
  }
  return parts.length === 0
    ? 'No error-like lines in any managed process log.'
    : parts.join('\n');
}

/**
 * Dispatch one `ai_workspace` tool call.
 * @param supervisor - the supervisor the tool belongs to.
 * @param args - the validated tool arguments.
 * @returns the text the model sees.
 */
async function runTool(supervisor, args) {
  const action = typeof args?.action === 'string' ? args.action : '';
  const project = typeof args?.project === 'string' && args.project.trim().length > 0 ? args.project.trim() : undefined;
  const processName = typeof args?.process === 'string' && args.process.trim().length > 0 ? args.process.trim() : undefined;
  const lines = clampLines(args?.lines, 50);

  if (action === 'status' || action === 'candidates') {
    // Cheap freshness: a config the agent just wrote should show up, but two
    // reads in a row must not re-read every manifest.
    supervisor.discoverIfStale();
    return action === 'status' ? statusText(supervisor) : candidatesText(supervisor);
  }
  if (action === 'rescan') {
    supervisor.discover();
    return `Rescanned.\n\n${statusText(supervisor)}`;
  }
  if (action === 'logs') return logsText(supervisor, project, processName, lines);
  if (action === 'errors') return errorsText(supervisor, project, lines);
  if (action === 'start' || action === 'stop' || action === 'restart') {
    if (project === undefined) {
      const known = supervisor.projects.map((entry) => entry.name);
      return `Name a project for "${action}". Managed: ${known.join(', ') || '(none)'}. Use the panel's Start all to act on everything at once.`;
    }
    supervisor.discoverIfStale();
    const result = await supervisor.act(action, project, processName);
    return result.lines.join('\n') || `Nothing matched "${project}${processName === undefined ? '' : `/${processName}`}".`;
  }
  return `Unknown action "${action}". Use status, logs, errors, candidates, start, stop, restart or rescan.`;
}

/**
 * Dispatch an agent turn that writes or repairs a project's
 * `.ai-workspace.json`. The turn is queued on the calling agent, so the user
 * watches the work happen in the conversation rather than in a hidden process.
 *
 * `createUserMessage` comes from a Harness package that the installation
 * resolves for the bundle; the import is done lazily and guarded so that a
 * resolution failure produces a readable command error instead of breaking the
 * plugin at load time.
 *
 * @param ctx - the Host plugin context.
 * @param supervisor - the supervisor, for project lookup and rescan.
 * @param agent - the agent that ran the command.
 * @param verb - 'init' or 'fix'.
 * @param rest - the command arguments after the verb.
 * @returns the command result.
 */
async function dispatchConfigAgent(ctx, supervisor, agent, verb, rest) {
  const projectRef = rest[0];
  const project = supervisor.findAny(projectRef);
  if (project === undefined) {
    const known = [
      ...supervisor.projects.map((entry) => entry.name),
      ...supervisor.candidates.map((entry) => entry.name),
    ].join(', ') || 'none';
    return { kind: 'error', text: `No project matches "${projectRef ?? ''}". Known projects: ${known}.` };
  }
  if (agent === undefined || typeof agent.followup !== 'function') {
    return { kind: 'error', text: 'No agent is available to dispatch this task.' };
  }

  const target = join(project.root, '.ai-workspace.json');
  const repairing = verb === 'fix' || project.error !== undefined;
  const note = rest.slice(1).join(' ');

  // The detector's reading of the project, handed over as a starting point the
  // agent should confirm or correct rather than rediscover from nothing.
  const candidate = supervisor.findCandidate(projectRef);
  const reference = [];
  if (candidate !== undefined) {
    reference.push(`Offline detection read the package manager as ${candidate.manager}.`);
    if (candidate.proposal.length > 0) {
      reference.push(`It proposes: ${candidate.proposal.map((entry) => `\`${entry.command}\``).join(', ')}. Treat that as a hypothesis — confirm it against the sources, or replace it.`);
    } else {
      reference.push('It found no conventional dev script, so derive the processes yourself.');
    }
    if (candidate.alternatives.length > 0) {
      reference.push(`Other long-running-looking scripts: ${candidate.alternatives.join(', ')}. Do NOT start these alongside the main one unless they are genuinely separate servers — two copies of the same app fight over a port.`);
    }
    if (candidate.composeFile !== undefined) {
      reference.push(`${candidate.composeFile} exists${candidate.composeServices.length > 0 ? ` with services: ${candidate.composeServices.join(', ')}` : ''} — include it only if nothing else starts those services.`);
    }
    reference.push('');
  }

  const prompt = [
    repairing
      ? `Repair the AI Workspace configuration for the project at ${project.root}.`
      : `Set up AI Workspace for the project at ${project.root}.`,
    '',
    `Its current config file is ${target}` + (existsSync(target)
      ? (project.error === undefined ? ' (already present — reconcile it with reality and fix anything wrong).' : ` and it is broken: ${project.error}.`)
      : ' (it does not exist yet).'),
    '',
    ...reference,
    'Do this:',
    '1. Inspect the manifests that describe how this project runs — package.json scripts, pnpm-workspace.yaml, docker-compose.yml, Makefile, Procfile, Cargo.toml, go.mod, pyproject.toml, and any README quick-start — and identify the LONG-RUNNING development processes (dev servers, bundlers in watch mode, compilers, database/queue containers).',
    `2. Write ${target} with exactly this shape:`,
    '',
    '```json',
    '{',
    '  "processes": [',
    '    { "name": "frontend", "command": "pnpm dev", "cwd": "./frontend" },',
    '    { "name": "backend",  "command": "pnpm start:dev", "cwd": "./backend" },',
    '    { "name": "database", "command": "docker compose up db" }',
    '  ]',
    '}',
    '```',
    '',
    'Rules:',
    '- "name" is a short slug; it becomes the terminal title and the log filename, so keep it unique and filesystem-safe.',
    '- "command" is the exact shell command to run, and will be executed by a login shell in the project.',
    '- "cwd" is a path relative to the project root; omit it to run in the root. Do not use an absolute path.',
    '- Include only long-running processes. Never include one-shot commands such as build, lint, test, or install.',
    '- Do not invent a process that no manifest supports. If you cannot determine how a part of the project runs, leave it out and say so.',
    '- Set "autoStart": false on any process that is expensive or needs manual setup first.',
    '',
    'Do not start the processes: the AI Workspace panel does that from its Start buttons.',
    'Finish by listing the processes you wrote, one per line, and note anything you could not determine.',
    note.length > 0 ? `\nAdditional instruction from the user: ${note}` : '',
  ].filter((line) => line !== undefined).join('\n');

  // `createUserMessage` comes from a Harness package that the installation
  // resolves for installed bundles. The import is lazy and guarded so that a
  // resolution failure degrades this one subcommand into a pasteable prompt
  // instead of taking the whole plugin down at load time.
  let createUserMessage;
  try {
    ({ createUserMessage } = await import('@deepseek-ai/dsh-llm'));
  } catch (error) {
    ctx.logger?.warn(`ai-workspace: cannot load @deepseek-ai/dsh-llm: ${String(error)}`);
    return {
      kind: 'error',
      text: `Could not hand this task to the agent (${String(error)}). Paste this prompt manually:\n\n${prompt}`,
    };
  }

  agent.followup(createUserMessage({
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'ai-workspace' },
  }));

  // A newly written config is picked up by the next rescan; do one now so the
  // panel reflects a config that already existed but was previously invalid.
  supervisor.discover();

  return {
    kind: 'success',
    text: `Dispatched an agent turn to ${repairing ? 'repair' : 'write'} ${target}. It will appear in this conversation.`,
  };
}

/**
 * Read the current status snapshot. Exported for debugging from a Node REPL;
 * the Client half reads the same file through the file Remote.
 * @returns the parsed snapshot, or undefined when it has not been written yet.
 */
export function readStatus() {
  return readJson(STATUS_PATH);
}

/** Absolute path of the status snapshot, for tooling and documentation. */
export { STATUS_PATH };

/** The offline detector, exported so tooling can preview proposals. */
export { detectProject };
