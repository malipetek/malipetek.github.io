import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SESSION_DIR = /^--[A-Za-z0-9._~-]{1,400}--$/;
const SHA = /^[0-9a-f]{40}$/i; // Fleet persists SHA-1 commit IDs, not refs.
const OWNER_FILE = 'ptech-admin-workspace-owner.json';
const result = (state, reason) => ({ state, reason });
const unavailable = reason => result('unavailable', reason);
const conflict = reason => result('conflict', reason);
const validId = id => Number.isSafeInteger(id) && id > 0;
// The Worker's project id is a D1 text UUID; older fixtures used integers.
const validProjectId = id => validId(id) || (typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(id));
const absolute = value => typeof value === 'string' && isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value);
const validSession = id => typeof id === 'string' && SESSION_ID.test(id) && !id.includes('..');
const identity = info => [info.dev, info.ino];
const privateDirectory = info => info?.isDirectory() && info.uid === process.getuid?.() && !(info.mode & 0o077);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function contains(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
const overlaps = (a, b) => contains(a, b) || contains(b, a);
async function entry(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function git(cwd, ...args) {
  const { stdout } = await exec('git', [
    '--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
    '-c', 'submodule.recurse=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0',
    '-c', 'worktree.useRelativePaths=false', '-C', cwd, ...args,
  ], {
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
      GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '',
    },
    timeout: 60_000, maxBuffer: 512 * 1024,
  });
  return stdout.replace(/\r?\n$/, '');
}

async function projectRepository(projectRoot) {
  if (!absolute(projectRoot)) return null;
  try {
    const root = await realpath(projectRoot);
    const dotGit = join(root, '.git');
    // Fleet slots use a .git pointer. Do not run Git in them even if misconfigured as a project root.
    if (!(await entry(dotGit))?.isDirectory() || await git(root, 'rev-parse', '--show-toplevel') !== root) return null;
    const commonDir = await realpath(await git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
    if (commonDir !== dotGit || await realpath(await git(root, 'rev-parse', '--absolute-git-dir')) !== commonDir) return null;
    return { root, commonDir, commonIdentity: identity(await lstat(commonDir)) };
  } catch { return null; }
}

async function sourceFor(resolveSource, sessionId) {
  if (!validSession(sessionId)) return unavailable('invalid_session');
  let source;
  try { source = await resolveSource(sessionId); }
  catch { return unavailable('source_unavailable'); }
  if (!source) return unavailable('not_linked');
  const { ticketId, projectId, projectRoot, runs } = source;
  if (!validId(ticketId) || !validProjectId(projectId) || !Array.isArray(runs)) return unavailable('incomplete_source');

  // The authenticated ticket detail lists ticket_runs (row IDs increase). Fleet can
  // resume the same session, and different sessions can share the same session_dir.
  // Select the newest exact match before validating it: a bad newer row is not a fallback signal.
  const matches = runs.filter(run => run?.session_id === sessionId);
  if (!matches.length) return unavailable('no_session_run');
  if (matches.some(run => !validId(run.id) || (run.ticket_id != null && run.ticket_id !== ticketId))) {
    return conflict('ambiguous_run');
  }
  const newest = matches.reduce((a, b) => a.id > b.id ? a : b);
  if (runs.filter(run => run?.id === newest.id).length !== 1) return conflict('ambiguous_run');
  const { id: runId, commit_sha: sha, session_dir: sessionDir, status: runStatus } = newest;
  if (typeof sha !== 'string' || !SHA.test(sha) || typeof sessionDir !== 'string' ||
      !SESSION_DIR.test(sessionDir) || sessionDir.includes('..') || !['ok', 'failed'].includes(runStatus)) {
    return unavailable('incomplete_run');
  }
  // Fleet only resumes a session in the same folder. Conflicting explicit folders
  // for the exact identity are not a safe choice, unlike another session sharing one folder.
  if (matches.some(run => run.session_dir && run.session_dir !== sessionDir)) return conflict('ambiguous_run');
  const commitSha = sha.toLowerCase();
  const repository = await projectRepository(projectRoot);
  if (!repository) return unavailable('project_root_unavailable');
  try {
    // Peeling must resolve to the exact ID, not an annotated tag or a 40-hex ref name.
    if (await git(repository.root, 'rev-parse', '--verify', '--end-of-options', `${commitSha}^{commit}`) !== commitSha) {
      return unavailable('commit_not_local');
    }
  } catch { return unavailable('commit_not_local'); }
  return { repository, provenance: { sessionId, ticketId, projectId, runId, commitSha, sessionDir, runStatus } };
}

async function rootFor(configured, repository) {
  if (!absolute(configured)) return unavailable('recovery_root_unavailable');
  const parent = await realpath(dirname(configured));
  const root = join(parent, basename(configured));
  if (overlaps(root, repository.root) || overlaps(root, repository.commonDir)) {
    return conflict('recovery_root_conflict');
  }
  const info = await entry(root);
  if (info && (!privateDirectory(info) || await realpath(root) !== root)) return conflict('recovery_root_conflict');
  return { root, info };
}

function destination(root, sessionId) {
  const slot = join(root, createHash('sha256').update(sessionId).digest('hex'));
  return { slot, path: join(slot, 'checkout') };
}

async function checkoutInfo(target, repository) {
  const slot = await entry(target.slot);
  const checkout = await entry(target.path);
  const dotGit = join(target.path, '.git');
  if (!privateDirectory(slot) || !checkout?.isDirectory() || await realpath(target.path) !== target.path ||
      !(await entry(dotGit))?.isFile()) return null;
  if (await git(target.path, 'rev-parse', '--show-toplevel') !== target.path) return null;
  const common = await realpath(await git(target.path, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
  if (common !== repository.commonDir || !same(identity(await lstat(common)), repository.commonIdentity)) return null;
  const gitDir = await realpath(await git(target.path, 'rev-parse', '--absolute-git-dir'));
  if (dirname(gitDir) !== join(common, 'worktrees')) return null;
  // A stray/copied .git pointer is not the registered worktree for this path.
  if ((await readFile(join(gitDir, 'gitdir'), 'utf8')).replace(/\r?\n$/, '') !== dotGit) return null;
  return { gitDir, checkoutIdentity: identity(checkout), slotIdentity: identity(slot) };
}

/**
 * Verify a checkout this module already created, from its own binding record.
 *
 * Restore proves exact provenance against the portal once, then pins the commit.
 * Later status reads must not depend on the network: the record proves the same
 * binding, and the pinned commit still has to exist here. Nothing is inferred
 * from a path or a title.
 * @returns the recorded provenance, or undefined when the destination is not an owned checkout.
 */
async function ownedCheckout(recoveryRoot, sessionId) {
  if (!absolute(recoveryRoot)) return undefined;
  const parent = await realpath(dirname(recoveryRoot));
  const root = join(parent, basename(recoveryRoot));
  const rootInfo = await entry(root);
  if (!privateDirectory(rootInfo) || await realpath(root) !== root) return undefined;
  const target = destination(root, sessionId);
  if (!privateDirectory(await entry(target.slot))) return undefined;
  const dotGit = join(target.path, '.git');
  if (!(await entry(dotGit))?.isFile()) return undefined;
  const pointer = (await readFile(dotGit, 'utf8')).replace(/\r?\n$/, '');
  if (!pointer.startsWith('gitdir: ')) return undefined;
  const linked = pointer.slice('gitdir: '.length);
  const gitDir = await realpath(isAbsolute(linked) ? linked : join(target.path, linked));
  const marker = { path: join(gitDir, OWNER_FILE) };
  let record;
  try {
    const info = await entry(marker.path);
    if (!info?.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) || info.size > 8192) return undefined;
    const file = await open(marker.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!same(identity(await file.stat()), identity(info))) return undefined;
      record = JSON.parse(await file.readFile('utf8'));
    } finally { await file.close(); }
  } catch { return undefined; }
  if (record === null || typeof record !== 'object' || record.version !== 1 || record.sessionId !== sessionId ||
      record.path !== target.path || !absolute(record.commonDir) || !absolute(record.gitDir) ||
      !validId(record.ticketId) || !validProjectId(record.projectId) || !validId(record.runId) ||
      typeof record.commitSha !== 'string' || !SHA.test(record.commitSha) ||
      typeof record.sessionDir !== 'string' || !SESSION_DIR.test(record.sessionDir) || record.sessionDir.includes('..') ||
      !same(record.gitDir, gitDir)) return undefined;
  const repository = { root: undefined, commonDir: record.commonDir, commonIdentity: record.commonIdentity };
  let info;
  try {
    info = await checkoutInfo(target, repository);
    if (!info || !same(info.gitDir, gitDir) || !same(info.checkoutIdentity, record.checkoutIdentity) ||
        !same(info.slotIdentity, record.slotIdentity)) return undefined;
    // HEAD may legitimately have advanced with the user's own commits; the
    // pinned commit only has to still exist here.
    if (await git(target.path, 'rev-parse', '--verify', '--end-of-options', `${record.commitSha}^{commit}`) !== record.commitSha) {
      return undefined;
    }
  } catch { return undefined; }
  return {
    path: target.path,
    provenance: {
      sessionId, ticketId: record.ticketId, projectId: record.projectId, runId: record.runId,
      commitSha: record.commitSha, sessionDir: record.sessionDir,
      runStatus: record.runStatus === 'failed' ? 'failed' : 'ok',
    },
  };
}

function binding(source, target, info) {
  return {
    version: 1, ...source.provenance, path: target.path,
    commonDir: source.repository.commonDir, commonIdentity: source.repository.commonIdentity, ...info,
  };
}

async function ownerMatches(marker, expected) {
  const info = await entry(marker);
  if (!info?.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) || info.size > 8192) return false;
  const file = await open(marker, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!same(identity(await file.stat()), identity(info))) return false;
    return same(JSON.parse(await file.readFile('utf8')), expected);
  } finally { await file.close(); }
}

async function hasCheckoutFilters(root) {
  const names = await git(root, 'config', '--includes', '--null', '--name-only', '--list');
  return names.split('\0').some(name => /^filter\..*\.(?:clean|process|smudge)$/i.test(name));
}

function available(state, source, path) {
  const { ticketId, projectId, runId, commitSha } = source.provenance;
  return { state, ticketId, projectId, runId, commitSha, ...(path ? { path } : {}) };
}

/** Server-only. The resolver must return fresh, authorized ticket detail and an explicit local project mapping. */
export function createWorkspaceRecovery({ recoveryRoot, resolveSource }) {
  const pending = new Map();
  const source = sessionId => sourceFor(resolveSource, sessionId);

  async function inspect(sessionId) {
    const current = await source(sessionId);
    if (current.state) return { status: current };
    let root;
    try { root = await rootFor(recoveryRoot, current.repository); }
    catch { return { status: unavailable('recovery_root_unavailable') }; }
    if (root.state) return { status: root };
    const target = destination(root.root, sessionId);
    try {
      if (!root.info || !await entry(target.slot)) return { status: available('missing', current), current, root, target };
      const info = await checkoutInfo(target, current.repository);
      if (info && await ownerMatches(join(info.gitDir, OWNER_FILE), binding(current, target, info))) {
        await git(target.path, 'rev-parse', '--verify', 'HEAD^{commit}');
        return { status: available('ready', current, target.path), current, root, target };
      }
    } catch { /* existing but unverified; never take it over */ }
    return { status: conflict('destination_conflict') };
  }

  async function status(sessionId) {
    if (!validSession(sessionId)) return unavailable('invalid_session');
    if (pending.has(sessionId)) return result('pending', 'restore_in_progress');
    // A checkout this module created is a local, pinned fact; the portal is only
    // needed to create it. This keeps restored Chat usable without the network.
    const owned = await ownedCheckout(recoveryRoot, sessionId);
    if (owned) return available('ready', owned, owned.path);
    return (await inspect(sessionId)).status;
  }

  async function restoreOnce(sessionId) {
    const initial = await inspect(sessionId);
    if (!initial.current) return initial.status;
    const next = await inspect(sessionId);
    if (!same(initial.current, next.current)) {
      return next.status.state === 'conflict' ? next.status : conflict('source_changed');
    }
    if (next.status.state !== 'missing') return next.status;

    const { current, root, target } = next;
    try {
      // Worktree creation can invoke configured executable filters; fail closed instead.
      if (await hasCheckoutFilters(current.repository.root)) return unavailable('checkout_filters_configured');
      if (!root.info) {
        await mkdir(root.root, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      }
      const confirmedRoot = await rootFor(recoveryRoot, current.repository);
      if (!confirmedRoot.info || confirmedRoot.root !== root.root ||
          (root.info && !same(identity(root.info), identity(confirmedRoot.info)))) return conflict('recovery_root_conflict');
      // Atomic reservation also stops other module instances/processes from taking over the destination.
      try { await mkdir(target.slot, { mode: 0o700 }); }
      catch (error) { if (error.code === 'EEXIST') return conflict('destination_conflict'); throw error; }
      await git(current.repository.root, 'worktree', 'add', '--detach', '--no-checkout', '--', target.path, current.provenance.commitSha);
      const info = await checkoutInfo(target, current.repository);
      if (!info || await git(target.path, 'rev-parse', '--verify', 'HEAD') !== current.provenance.commitSha) {
        return conflict('destination_conflict');
      }
      // includeIf can enable filters only in the newly registered checkout.
      if (await hasCheckoutFilters(target.path)) return unavailable('checkout_filters_configured');
      await git(target.path, 'read-tree', '-m', '-u', '--no-sparse-checkout', current.provenance.commitSha);
      if (!same(await source(sessionId), current)) return conflict('source_changed');
      if (!same(await checkoutInfo(target, current.repository), info) ||
          await git(target.path, 'rev-parse', '--verify', 'HEAD') !== current.provenance.commitSha) {
        return conflict('destination_conflict');
      }
      // Keep the marker outside tracked files, in the actual, registered worktree Git directory.
      await writeFile(join(info.gitDir, OWNER_FILE), `${JSON.stringify(binding(current, target, info))}\n`, { flag: 'wx', mode: 0o600 });
      return available('ready', current, target.path);
    } catch {
      // Preserve partial or concurrently occupied paths; never remove or reset anything.
      return unavailable('checkout_failed');
    }
  }

  async function restore(sessionId) {
    if (!validSession(sessionId)) return unavailable('invalid_session');
    const previous = pending.get(sessionId) ?? Promise.resolve();
    const operation = previous.then(() => restoreOnce(sessionId));
    pending.set(sessionId, operation);
    try { return await operation; }
    finally { if (pending.get(sessionId) === operation) pending.delete(sessionId); }
  }

  return { status, restore };
}
