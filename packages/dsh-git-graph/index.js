/**
 * Git panel — the Host half of `@malipetek/dsh-git-graph`.
 *
 * The Client half draws a Source-Control page in the right Sidebar: the working
 * tree, a commit graph, branches, and the push/pull/fetch controls. Git itself
 * lives here, because the browser cannot run it.
 *
 * Two channels, chosen by what each operation is:
 *
 * - **Reads** (status, history, diffs, the recorder's per-turn summary) are
 *   authenticated GET routes registered inside Connection's `/api` fence. They
 *   are polled while the panel is on screen, and the client has no other
 *   low-cost way to ask: a session command appends `command/run` and
 *   `command/done` to the session log and renders a row in the transcript, which
 *   is correct for an action the user took and absurd for a status poll.
 * - **Mutations** (stage, commit, branch, push, …) are session commands. They
 *   are deliberate user actions, they belong in the transcript, and a command is
 *   the one Client-callable Host entry point a third-party bundle may add.
 *
 * Every git process runs through `ctx.shell`, the sandboxed shell seam, with the
 * session's own workdir and sandbox policy — the same executor the model's bash
 * tool uses. The sandbox governs file effects only, so a push's network traffic
 * is never blocked while a read-only session still cannot let git write refs.
 * `GIT_TERMINAL_PROMPT=0` is set on the network operations so a missing
 * credential fails with a message instead of hanging on a prompt no one sees.
 *
 * @module @malipetek/dsh-git-graph
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** The Loader row's name, and the name this plugin is known by. */
export const name = 'git-graph';

/**
 * Host services this plugin needs before it activates. `connection` and the
 * optional change recorder are taken with `ctx.get`, so a composition without
 * them loses the live routes or the per-turn view rather than the whole plugin.
 */
export const inject = ['commands', 'shell', 'sessions'];

/** This bundle's version, mirrored in package.json and written to the doctor record. */
const VERSION = '1.0.0';

/** The slash command the Client half drives for mutations. */
const COMMAND_NAME = 'git-graph';

/** The authenticated read routes, all GET. */
const ROUTE_STATE = '/api/git-graph.state';
const ROUTE_DIFF = '/api/git-graph.diff';
const ROUTE_COMMIT = '/api/git-graph.commit';
const ROUTE_AGENT = '/api/git-graph.agent';

/** Default process budget for a local git command. */
const DEFAULT_TIMEOUT_MS = 20000;
/** Process budget for an operation that talks to a remote. */
const NETWORK_TIMEOUT_MS = 180000;
/** How many commits one history read returns. */
const HISTORY_LIMIT = 120;

/** DSH's own home; `DSH_HOME` wins when the launcher sets it. */
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
/** Where this plugin keeps its one diagnostic record. */
const STATE_DIR = process.env.DSH_GIT_GRAPH_DIR || join(DSH_HOME, 'git-graph');

/**
 * Register the mutation command and the read routes.
 * @param ctx - the plugin context carrying `commands`, `shell` and `sessions`.
 */
export function apply(ctx) {
  const repos = new Map();
  const latestChangeSeq = new Map();
  /** What the doctor record reports about the read-route registration. */
  const routes = { status: 'not attempted' };

  /**
   * Rewrite the doctor record with the current registration outcome.
   * @param extra - fields to merge into the record.
   */
  const diagnose = (extra) => {
    const record = {
      version: VERSION,
      command: COMMAND_NAME,
      routes: [ROUTE_STATE, ROUTE_DIFF, ROUTE_COMMIT, ROUTE_AGENT],
      ...routes,
      ...extra,
      pid: process.pid,
      loadedAt: new Date().toISOString(),
    };
    void mkdir(STATE_DIR, { recursive: true })
      .then(() => writeFile(join(STATE_DIR, 'host.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8'))
      .catch(() => {});
  };

  // The recorder announces one `workspace/changes` event per top-level turn and
  // carries only the turn; the summary is addressed by that event's seq.
  ctx.effect(() => {
    const listener = (session, event) => {
      if (event?.type !== 'workspace/changes') return;
      if (typeof session?.id !== 'string') return;
      latestChangeSeq.set(session.id, event.seq);
    };
    const dispose = ctx.on('session/event', listener);
    return () => {
      if (typeof dispose === 'function') dispose();
    };
  }, 'git-graph: change announcements');

  ctx.effect(
    () => {
      diagnose({});
      return () => {};
    },
    'git-graph: doctor record',
  );

  ctx.effect(
    () => ctx.commands.register({
      name: COMMAND_NAME,
      description: 'Stage, unstage, discard, commit, branch, fetch, pull and push in this session workspace on behalf of the git panel.',
      input: { hint: '{"op":"commit","message":"…"}' },
      handler: (invocation) => handleCommand(ctx, invocation),
    }),
    'git-graph: /git-graph command',
  );

  // Registered through an optional injection rather than `ctx.get`: a service
  // reached through an injection is guaranteed to be the registered provider,
  // and the plugin stays active in a composition that mounts no connection at
  // all, losing only the live read routes.
  ctx.inject(['connection'], (scoped) => {
    scoped.effect(() => {
      const disposers = [
        scoped.connection.fetch.register({
          path: ROUTE_STATE,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: (request) => respond(() => routeState(ctx, repos, request)),
        }),
        scoped.connection.fetch.register({
          path: ROUTE_DIFF,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: (request) => respond(() => routeDiff(ctx, repos, request)),
        }),
        scoped.connection.fetch.register({
          path: ROUTE_COMMIT,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: (request) => respond(() => routeCommit(ctx, repos, request)),
        }),
        scoped.connection.fetch.register({
          path: ROUTE_AGENT,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: (request) => respond(() => routeAgent(ctx, latestChangeSeq, request)),
        }),
      ];
      routes.status = 'registered';
      diagnose({});
      return () => {
        routes.status = 'withdrawn';
        diagnose({});
        for (const dispose of disposers) {
          if (typeof dispose === 'function') dispose();
        }
      };
    }, 'git-graph: read routes');
  });
}

/* ------------------------------------------------------------------------- *
 * Reads
 * ------------------------------------------------------------------------- */

/**
 * One repository's state: branch, tracking, working tree and recent history.
 * @param ctx - the plugin context.
 * @param repos - the per-session repository-root cache.
 * @param request - the route request.
 * @returns the response.
 */
async function routeState(ctx, repos, request) {
  const resolved = await sessionFor(ctx, request);
  if (resolved.error !== undefined) return resolved.error;

  const repo = await resolveRepo(ctx, repos, resolved.session, request.signal);
  if (repo.root === undefined) {
    return Response.json({ ok: true, repo: null, reason: repo.reason ?? 'not a git repository' });
  }

  const [status, history, branches, remotes] = await Promise.all([
    readStatus(ctx, resolved.session, repo.root, request.signal),
    readHistory(ctx, resolved.session, repo.root, request.signal),
    readBranches(ctx, resolved.session, repo.root, request.signal),
    readRemotes(ctx, resolved.session, repo.root, request.signal),
  ]);

  return Response.json({
    ok: true,
    repo: { root: repo.root, ...status, branches, remotes, commits: history },
  });
}

/**
 * One file's comparison, or a whole-tree comparison when no path is named.
 * @param ctx - the plugin context.
 * @param repos - the per-session repository-root cache.
 * @param request - the route request.
 * @returns the response.
 */
async function routeDiff(ctx, repos, request) {
  const resolved = await sessionFor(ctx, request);
  if (resolved.error !== undefined) return resolved.error;
  const query = new URL(request.url).searchParams;
  const kind = query.get('kind') ?? 'worktree';
  const path = query.get('path');
  const hash = query.get('hash');

  const repo = await resolveRepo(ctx, repos, resolved.session, request.signal);
  if (repo.root === undefined) {
    return Response.json({ ok: false, error: { code: 'NOT_A_REPO', message: repo.reason ?? 'not a git repository' } });
  }

  let args;
  switch (kind) {
    case 'staged':
      args = ['diff', '--cached', '--no-color', '-U3'];
      break;
    case 'untracked':
      if (typeof path !== 'string' || path.length === 0) {
        return Response.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'an untracked diff needs a path' } });
      }
      // An untracked file has no diff against the index; comparing it with the
      // empty file is what every editor shows for it.
      args = ['diff', '--no-index', '--no-color', '-U3', '--', '/dev/null', path];
      break;
    case 'commit':
      if (typeof hash !== 'string' || hash.length === 0) {
        return Response.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'a commit diff needs a hash' } });
      }
      args = ['show', '--no-color', '-U3', '--format=', hash];
      if (typeof path === 'string' && path.length > 0) args.push('--', path);
      break;
    default:
      args = ['diff', '--no-color', '-U3'];
      break;
  }
  if (kind !== 'commit' && kind !== 'untracked' && typeof path === 'string' && path.length > 0) {
    args.push('--', path);
  }

  const result = await git(ctx, resolved.session, args, { cwd: repo.root, signal: request.signal, allowFailure: true });
  return Response.json({
    ok: true,
    kind,
    path: path ?? null,
    diff: result.stdout,
    truncated: result.truncated,
    refused: result.code !== 0 && result.stdout.length === 0,
    message: result.stdout.length === 0 ? result.stderr.trim() : '',
  });
}

/**
 * One commit's metadata, changed files and patch.
 * @param ctx - the plugin context.
 * @param repos - the per-session repository-root cache.
 * @param request - the route request.
 * @returns the response.
 */
async function routeCommit(ctx, repos, request) {
  const resolved = await sessionFor(ctx, request);
  if (resolved.error !== undefined) return resolved.error;
  const hash = new URL(request.url).searchParams.get('hash');
  if (hash === null || hash.length === 0) {
    return Response.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'a commit read needs a hash' } });
  }

  const repo = await resolveRepo(ctx, repos, resolved.session, request.signal);
  if (repo.root === undefined) {
    return Response.json({ ok: false, error: { code: 'NOT_A_REPO', message: repo.reason ?? 'not a git repository' } });
  }

  const meta = await git(ctx, resolved.session, [
    'show', '--no-color', '--no-patch',
    '--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b',
    hash,
  ], { cwd: repo.root, signal: request.signal });

  if (meta.code !== 0) {
    return Response.json({ ok: false, error: { code: 'NO_COMMIT', message: meta.stderr.trim() || `no commit ${hash}` } });
  }
  const [full, short, parents, author, email, date, subject, body] = meta.stdout.split('\x1f');

  const names = await git(ctx, resolved.session, ['show', '--no-color', '--name-status', '--format=', hash], {
    cwd: repo.root,
    signal: request.signal,
    allowFailure: true,
  });
  const files = names.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [status, ...rest] = line.split('\t');
      return { status: status.slice(0, 1), path: rest.join('\t') };
    });

  const patch = await git(ctx, resolved.session, ['show', '--no-color', '-U3', '--format=', hash], {
    cwd: repo.root,
    signal: request.signal,
    allowFailure: true,
  });

  return Response.json({
    ok: true,
    commit: {
      hash: full ?? hash,
      short: short ?? hash.slice(0, 8),
      parents: typeof parents === 'string' && parents.length > 0 ? parents.split(' ') : [],
      author: author ?? '',
      email: email ?? '',
      date: date ?? '',
      subject: subject ?? '',
      body: body ?? '',
    },
    files,
    patch: patch.stdout,
    truncated: patch.truncated,
  });
}

/**
 * The change recorder's summary for the newest turn that announced one.
 * @param ctx - the plugin context.
 * @param latestChangeSeq - the per-session seq of the newest `workspace/changes`.
 * @param request - the route request.
 * @returns the response.
 */
async function routeAgent(ctx, latestChangeSeq, request) {
  const resolved = await sessionFor(ctx, request);
  if (resolved.error !== undefined) return resolved.error;
  const changes = ctx.get('workspaceChanges');
  if (changes === undefined || changes === null) {
    return Response.json({ ok: true, available: false, reason: 'the workspace change recorder is not mounted' });
  }
  const seq = latestChangeSeq.get(resolved.session.id);
  if (seq === undefined) return Response.json({ ok: true, available: true, summary: null });
  const summary = changes.summary(resolved.session.id, seq);
  return Response.json({ ok: true, available: true, seq, summary: summary ?? null });
}

/* ------------------------------------------------------------------------- *
 * Git plumbing
 * ------------------------------------------------------------------------- */

/**
 * Run one git command through the sandboxed shell seam.
 *
 * @param ctx - the plugin context.
 * @param session - the session the command belongs to.
 * @param args - git arguments, before quoting; the first is the subcommand.
 * @param options - `{ cwd?, signal?, timeoutMs?, allowFailure?, noPrompt? }`.
 * @returns `{ code, stdout, stderr, truncated, timedOut, denied, command }`.
 * @throws when the shell capability is missing or the process cannot start.
 */
async function git(ctx, session, args, options = {}) {
  const shell = ctx.get('shell');
  if (shell === undefined || shell === null) {
    throw coded('NO_SHELL', 'the shell capability is unavailable in this composition');
  }
  const cwd = options.cwd ?? requireCwd(session);
  const policy = ctx.get('sandboxPolicy')?.resolve?.({ session }) ?? undefined;
  const config = ['-c', 'color.ui=false', '-c', 'core.quotepath=false'];
  // A prompt would wait for a terminal nobody owns; failing is the useful answer.
  const promptPrefix = options.noPrompt === true && process.platform !== 'win32' ? 'GIT_TERMINAL_PROMPT=0 ' : '';
  const command = `${promptPrefix}git ${[...config, ...args].map(quoteShell).join(' ')}`;

  const handle = await shell.execute(shell.resolve({
    command,
    workdir: cwd,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    sandboxPolicy: policy,
    signal: options.signal,
  }));
  const result = await handle.result();

  const code = typeof result.exitCode === 'number' ? result.exitCode : null;
  const failure = result.timedOut === true || result.aborted === true || (code !== null && code !== 0);
  if (failure && options.allowFailure !== true) {
    if (result.sandbox?.denied === true) {
      throw coded('DENIED', `git was denied by the sandbox (${result.sandbox.mode ?? 'unknown mode'})`);
    }
    if (result.timedOut === true) {
      throw coded('TIMEOUT', `git ${args[0]} timed out after ${Math.round((result.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s`);
    }
    const detail = (result.stderr?.text ?? '').trim() || (result.stdout?.text ?? '').trim();
    throw coded('GIT_FAILED', detail || `git ${args[0]} exited ${code ?? 'without a status'}`);
  }

  return {
    code,
    stdout: result.stdout?.text ?? '',
    stderr: result.stderr?.text ?? '',
    truncated: result.stdout?.truncated === true || result.stderr?.truncated === true,
    timedOut: result.timedOut === true,
    denied: result.sandbox?.denied === true,
    command,
  };
}

/**
 * The repository that contains the session's workspace, cached per session.
 * @param ctx - the plugin context.
 * @param repos - the cache.
 * @param session - the session.
 * @param signal - caller lifetime.
 * @returns `{ root }` or `{ reason }`.
 */
async function resolveRepo(ctx, repos, session, signal) {
  const cached = repos.get(session.id);
  if (cached !== undefined) return { root: cached };
  const probe = await git(ctx, session, ['rev-parse', '--show-toplevel'], {
    signal,
    timeoutMs: 8000,
    allowFailure: true,
  });
  if (probe.code !== 0) {
    return { reason: (probe.stderr.trim() || probe.stdout.trim() || 'not a git repository') };
  }
  const root = probe.stdout.trim();
  if (root.length === 0) return { reason: 'not a git repository' };
  repos.set(session.id, root);
  return { root };
}

/**
 * The working tree's status, including the branch line.
 * @param ctx - the plugin context.
 * @param session - the session.
 * @param root - the repository root.
 * @param signal - caller lifetime.
 * @returns the parsed state.
 */
async function readStatus(ctx, session, root, signal) {
  const result = await git(ctx, session, ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all'], {
    cwd: root,
    signal,
  });
  const parsed = parseStatus(result.stdout);
  parsed.truncated = result.truncated;
  return parsed;
}

/**
 * Recent history across every ref, newest first.
 * @param ctx - the plugin context.
 * @param session - the session.
 * @param root - the repository root.
 * @param signal - caller lifetime.
 * @returns the commit list, newest first.
 */
async function readHistory(ctx, session, root, signal) {
  const format = '%H%x1f%h%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%D%x1e';
  const result = await git(ctx, session, [
    'log',
    `--max-count=${HISTORY_LIMIT}`,
    '--date=iso-strict',
    `--pretty=format:${format}`,
    '--all',
    '--topo-order',
  ], { cwd: root, signal, timeoutMs: 25000, allowFailure: true });

  if (result.code !== 0) return [];
  return result.stdout
    .split('\x1e')
    .map((record) => record.replace(/^\n+/, ''))
    .filter((record) => record.trim().length > 0)
    .map((record) => {
      const [hash, short, parents, author, date, subject, refs] = record.split('\x1f');
      return {
        hash: hash ?? '',
        short: short ?? '',
        parents: typeof parents === 'string' && parents.length > 0 ? parents.split(' ') : [],
        author: author ?? '',
        date: date ?? '',
        subject: subject ?? '',
        refs: typeof refs === 'string' && refs.length > 0 ? refs.split(', ').map((ref) => ref.trim()).filter(Boolean) : [],
      };
    })
    .filter((commit) => commit.hash.length > 0);
}

/**
 * Local branches with their upstream and head marker.
 * @param ctx - the plugin context.
 * @param session - the session.
 * @param root - the repository root.
 * @param signal - caller lifetime.
 * @returns the branch list.
 */
async function readBranches(ctx, session, root, signal) {
  const result = await git(ctx, session, [
    'for-each-ref',
    '--format=%(refname:short)%09%(upstream:short)%09%(objectname:short)%09%(HEAD)',
    'refs/heads',
  ], { cwd: root, signal, allowFailure: true });
  if (result.code !== 0) return [];
  return result.stdout
    .split('\n')
    .map((line) => line.replace(/\n$/, ''))
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, upstream, head, marker] = line.split('\t');
      return { name: name ?? '', upstream: upstream ?? '', commit: head ?? '', current: marker === '*' };
    })
    .filter((branch) => branch.name.length > 0);
}

/**
 * Remote branches, grouped under their remote.
 * @param ctx - the plugin context.
 * @param session - the session.
 * @param root - the repository root.
 * @param signal - caller lifetime.
 * @returns the remote list.
 */
async function readRemotes(ctx, session, root, signal) {
  const names = await git(ctx, session, ['remote'], { cwd: root, signal, allowFailure: true });
  if (names.code !== 0) return [];
  const remotes = names.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  const url = await git(ctx, session, ['remote', '-v'], { cwd: root, signal, allowFailure: true });
  const urls = new Map();
  for (const line of url.stdout.split('\n')) {
    const parts = line.split(/\s+/);
    if (parts.length >= 2 && parts[1] !== '(fetch)') urls.set(parts[0], parts[1]);
  }
  return remotes.map((remote) => ({ name: remote, url: urls.get(remote) ?? '' }));
}

/**
 * Parse `git status --porcelain=v1 -z --branch`.
 *
 * In `-z` form each entry is NUL-terminated and a rename or copy carries its
 * original path as the following NUL-separated token, which is why this walks
 * the tokens instead of splitting lines.
 *
 * @param text - the raw output.
 * @returns `{ branch, detached, upstream, ahead, behind, staged, unstaged, untracked, conflicted }`.
 */
function parseStatus(text) {
  const tokens = text.split('\0');
  const staged = [];
  const unstaged = [];
  const untracked = [];
  const conflicted = [];
  let branch = '';
  let detached = false;
  let upstream = '';
  let ahead = 0;
  let behind = 0;

  const conflictCodes = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

  for (let index = 0; index < tokens.length; index += 1) {
    const entry = tokens[index];
    if (entry.length === 0) continue;

    if (entry.startsWith('## ')) {
      const header = entry.slice(3).trim();
      if (header.includes('no branch') || header.startsWith('HEAD')) {
        detached = true;
        branch = '';
      } else {
        const tracking = /^(.*?)(?:\.\.\.(\S+))?(?:\s+\[(.+)\])?$/.exec(header);
        branch = (tracking?.[1] ?? header).trim();
        upstream = tracking?.[2] ?? '';
        const counts = tracking?.[3] ?? '';
        const aheadMatch = /ahead (\d+)/.exec(counts);
        const behindMatch = /behind (\d+)/.exec(counts);
        ahead = aheadMatch === null ? 0 : Number(aheadMatch[1]);
        behind = behindMatch === null ? 0 : Number(behindMatch[1]);
      }
      continue;
    }

    if (entry.length < 3) continue;
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    let originalPath;
    if (code[0] === 'R' || code[0] === 'C') {
      originalPath = tokens[index + 1];
      index += 1;
    }

    if (code === '??') {
      untracked.push({ path, status: '?' });
      continue;
    }
    if (conflictCodes.has(code)) {
      conflicted.push({ path, status: 'U' });
      continue;
    }
    if (code[0] !== ' ' && code[0] !== '?') {
      staged.push({ path, status: code[0], ...(originalPath === undefined ? {} : { originalPath }) });
    }
    if (code[1] !== ' ' && code[1] !== '?') {
      unstaged.push({ path, status: code[1], ...(originalPath === undefined ? {} : { originalPath }) });
    }
  }

  return { branch, detached, upstream, ahead, behind, staged, unstaged, untracked, conflicted };
}

/* ------------------------------------------------------------------------- *
 * Mutations
 * ------------------------------------------------------------------------- */

/**
 * Dispatch one `/git-graph` mutation.
 * @param ctx - the plugin context.
 * @param invocation - the command invocation.
 * @returns the command result.
 */
async function handleCommand(ctx, { agent, rawInput, signal }) {
  const session = agent?.session;
  if (session === undefined || session === null) return fail('NO_SESSION', 'no session is open to run git in');

  let request;
  try {
    request = JSON.parse(String(rawInput ?? '').trim() || '{}');
  } catch {
    return fail('BAD_REQUEST', 'the payload must be one JSON object');
  }
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    return fail('BAD_REQUEST', 'the payload must be one JSON object');
  }

  try {
    return await mutate(ctx, session, request, signal);
  } catch (error) {
    return explain(error);
  }
}

/**
 * Perform one mutation and describe it.
 * @param ctx - the plugin context.
 * @param session - the session the command belongs to.
 * @param request - the parsed payload.
 * @param signal - the caller's cancellation.
 * @returns the command result.
 */
async function mutate(ctx, session, request, signal) {
  const cwd = requireCwd(session);
  const paths = Array.isArray(request.paths)
    ? request.paths.filter((path) => typeof path === 'string' && path.length > 0)
    : [];
  const options = { cwd, signal };

  switch (request.op) {
    case 'init': {
      const result = await git(ctx, session, ['init'], options);
      return ok(summarize('Initialised a repository', result));
    }
    case 'stage': {
      if (paths.length === 0) return fail('BAD_REQUEST', 'staging needs at least one path');
      const result = await git(ctx, session, ['add', '--', ...paths], options);
      return ok(`Staged ${count(paths, 'file')}`);
    }
    case 'stage-all': {
      await git(ctx, session, ['add', '-A'], options);
      return ok('Staged every change');
    }
    case 'unstage': {
      if (paths.length === 0) return fail('BAD_REQUEST', 'unstaging needs at least one path');
      await git(ctx, session, ['restore', '--staged', '--', ...paths], options);
      return ok(`Unstaged ${count(paths, 'file')}`);
    }
    case 'unstage-all': {
      await git(ctx, session, ['restore', '--staged', '--', '.'], options);
      return ok('Unstaged every change');
    }
    case 'discard': {
      if (paths.length === 0) return fail('BAD_REQUEST', 'discarding needs at least one path');
      await git(ctx, session, ['restore', '--', ...paths], options);
      return ok(`Discarded changes in ${count(paths, 'file')}`);
    }
    case 'commit': {
      const message = requireText(request, 'message').trim();
      if (message.length === 0) return fail('BAD_REQUEST', 'a commit needs a message');
      const args = ['commit', '-m', message];
      if (request.all === true) args.push('-a');
      if (request.amend === true) args.push('--amend');
      if (request.signoff === true) args.push('--signoff');
      const result = await git(ctx, session, args, options);
      const head = await git(ctx, session, ['rev-parse', '--short', 'HEAD'], { ...options, allowFailure: true });
      const hash = head.stdout.trim();
      return ok(`Committed ${hash.length > 0 ? hash : ''} — ${firstLine(result.stdout) || message}`.trim());
    }
    case 'commit-and-push': {
      const message = requireText(request, 'message').trim();
      if (message.length === 0) return fail('BAD_REQUEST', 'a commit needs a message');
      await git(ctx, session, ['commit', '-m', message], options);
      return ok(await push(ctx, session, request, signal));
    }
    case 'branch-create': {
      const branch = requireText(request, 'name').trim();
      const args = request.checkout === false ? ['branch', branch] : ['switch', '-c', branch];
      if (request.startPoint !== undefined && typeof request.startPoint === 'string') args.push(request.startPoint);
      await git(ctx, session, args, options);
      return ok(request.checkout === false ? `Created branch ${branch}` : `Created and switched to ${branch}`);
    }
    case 'branch-switch': {
      const branch = requireText(request, 'name').trim();
      await git(ctx, session, ['switch', branch], options);
      return ok(`Switched to ${branch}`);
    }
    case 'branch-delete': {
      const branch = requireText(request, 'name').trim();
      await git(ctx, session, ['branch', request.force === true ? '-D' : '-d', branch], options);
      return ok(`Deleted branch ${branch}`);
    }
    case 'fetch': {
      const result = await git(ctx, session, ['fetch', '--all', '--prune'], {
        ...options,
        timeoutMs: NETWORK_TIMEOUT_MS,
        noPrompt: true,
        allowFailure: true,
      });
      return ok(networkSummary('Fetched', result));
    }
    case 'pull': {
      const result = await git(ctx, session, ['pull', '--ff-only'], {
        ...options,
        timeoutMs: NETWORK_TIMEOUT_MS,
        noPrompt: true,
        allowFailure: true,
      });
      if (result.code !== 0) return fail('GIT_FAILED', networkMessage(result));
      return ok(networkSummary('Pulled', result));
    }
    case 'push':
      return ok(await push(ctx, session, request, signal));
    default:
      return fail('BAD_REQUEST', `unknown op "${String(request.op)}"`);
  }
}

/**
 * Push the current branch, setting its upstream on the first push.
 * @param ctx - the plugin context.
 * @param session - the session the command belongs to.
 * @param request - the parsed payload; `remote` and `branch` override the defaults.
 * @param signal - the caller's cancellation.
 * @returns the result line.
 */
async function push(ctx, session, request, signal) {
  const cwd = requireCwd(session);
  const status = parseStatus((await git(ctx, session, ['status', '--porcelain=v1', '-z', '--branch'], { cwd, signal })).stdout);
  const branch = typeof request.branch === 'string' && request.branch.length > 0 ? request.branch : status.branch;
  if (branch.length === 0) throw coded('NO_BRANCH', 'there is no branch to push; name one explicitly');

  const remotes = await git(ctx, session, ['remote'], { cwd, signal, allowFailure: true });
  const first = remotes.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)[0];
  const remote = typeof request.remote === 'string' && request.remote.length > 0 ? request.remote : first;
  if (remote === undefined) throw coded('NO_REMOTE', 'this repository has no remote to push to');

  const args = ['push'];
  if (status.upstream.length === 0) args.push('--set-upstream', remote, branch);
  const result = await git(ctx, session, args, {
    cwd,
    signal,
    timeoutMs: NETWORK_TIMEOUT_MS,
    noPrompt: true,
    allowFailure: true,
  });
  if (result.code !== 0) throw coded('GIT_FAILED', networkMessage(result));
  return networkSummary(status.upstream.length === 0 ? `Pushed ${branch} to ${remote}` : `Pushed ${branch}`, result);
}

/**
 * A one-line description of a git outcome.
 * @param label - the leading phrase.
 * @param result - the git result.
 * @returns the line.
 */
function summarize(label, result) {
  return firstLine(result.stdout) || label;
}

/**
 * Describe a network operation, including its own progress lines when there is
 * nothing more interesting to say.
 * @param label - the leading phrase.
 * @param result - the git result.
 * @returns the line.
 */
function networkSummary(label, result) {
  const text = `${result.stdout}\n${result.stderr}`.trim();
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) return label;
  return `${label} — ${lines[lines.length - 1]}`;
}

/**
 * The message to show for a failed network operation.
 * @param result - the git result.
 * @returns the message.
 */
function networkMessage(result) {
  const text = `${result.stderr}\n${result.stdout}`.trim();
  if (result.timedOut === true) return 'the remote did not answer before the timeout';
  return text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0).slice(-3).join(' ') || 'git failed';
}

/**
 * The first non-empty line of some output.
 * @param text - the output.
 * @returns the line, or an empty string.
 */
function firstLine(text) {
  const line = String(text ?? '').split('\n').map((value) => value.trim()).find((value) => value.length > 0);
  return line ?? '';
}

/**
 * `n files` with a singular form.
 * @param paths - the paths.
 * @param noun - the noun.
 * @returns the counted phrase.
 */
function count(paths, noun) {
  return `${paths.length} ${noun}${paths.length === 1 ? '' : 's'}`;
}

/* ------------------------------------------------------------------------- *
 * Route and result helpers
 * ------------------------------------------------------------------------- */

/**
 * Answer one route call, turning a thrown value into a JSON error rather than a
 * 500 with no body: the panel shows the reason.
 * @param run - the handler.
 * @returns the response.
 */
async function respond(run) {
  try {
    const response = await run();
    if (response instanceof Response) return response;
    return Response.json(response, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({
      ok: false,
      error: {
        code: typeof error?.code === 'string' ? error.code : 'FAILED',
        message: typeof error?.message === 'string' && error.message.length > 0 ? error.message : String(error),
      },
    }, { status: 200, headers: { 'cache-control': 'no-store' } });
  }
}

/**
 * Resolve the session a route call names.
 * @param ctx - the plugin context.
 * @param request - the route request.
 * @returns `{ session }` or `{ error }`.
 */
async function sessionFor(ctx, request) {
  const id = new URL(request.url).searchParams.get('sessionId');
  if (id === null || id.length === 0) {
    return { error: new Response('Missing sessionId.', { status: 400, headers: { 'cache-control': 'no-store' } }) };
  }
  const session = ctx.sessions.get(id);
  if (session === undefined) {
    return { error: new Response('That session is not live in this process.', { status: 404, headers: { 'cache-control': 'no-store' } }) };
  }
  return { session };
}

/**
 * @param session - the session a git command runs for.
 * @returns the session's workspace directory.
 * @throws a typed error when the session has none.
 */
function requireCwd(session) {
  const cwd = session?.header?.cwd;
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw coded('NO_WORKSPACE', 'this session has no workspace directory');
  }
  return cwd;
}

/**
 * Quote one argument for a POSIX shell command line.
 * @param value - the raw argument.
 * @returns the argument as one shell word.
 */
function quoteShell(value) {
  const text = String(value);
  if (text.length > 0 && /^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * @param text - what the panel and the transcript show.
 * @returns a successful command result.
 */
function ok(text) {
  return { kind: 'success', text };
}

/**
 * @param code - the stable code.
 * @param text - the human-readable reason.
 * @returns an errored command result.
 */
function fail(code, text) {
  return { kind: 'error', text: `${code}: ${text}` };
}

/**
 * Build a typed error the dispatcher reports as a code.
 * @param code - the stable code.
 * @param text - the human-readable reason.
 * @returns the error to throw.
 */
function coded(code, text) {
  const error = new Error(text);
  error.code = code;
  return error;
}

/**
 * Reduce a thrown value to a failed command result.
 * @param error - the caught value.
 * @returns the result the adapter renders.
 */
function explain(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = typeof error?.message === 'string' && error.message.length > 0 ? error.message : String(error);
  if (code.length > 0 && /^[A-Z][A-Z0-9_]*$/.test(code)) return fail(code, message);
  if (code === 'ENOENT') return fail('NO_GIT', 'git is not available on this machine');
  return fail('FAILED', message);
}

/**
 * Read one required string field from a request.
 * @param request - the parsed payload.
 * @param field - the field name.
 * @returns the field's value.
 * @throws a `BAD_REQUEST` error when it is missing.
 */
function requireText(request, field) {
  const value = request[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw coded('BAD_REQUEST', `"${field}" must be a non-empty string`);
  }
  return value;
}
