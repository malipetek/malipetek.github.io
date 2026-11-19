import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, stat, realpath, readdir, open, mkdir, mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const MAX_BYTES = 512 * 1024;

export function repositoryUrl(repo) {
  if (typeof repo !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repo) || repo.includes('..')) throw new Error('Project needs a valid GitHub owner/repository.');
  return `https://github.com/${repo.replace(/\.git$/, '')}.git`;
}
export function sanitizeRemote(value) {
  if (/^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) return value;
  try { const url = new URL(value); if (!['https:', 'ssh:'].includes(url.protocol)) return '[nonstandard remote]'; url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.toString(); } catch { return '[nonstandard remote]'; }
}
function absolute(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('Choose an absolute local directory.');
  const path = value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
  if (!isAbsolute(path)) throw new Error('Choose an absolute local directory.');
  return resolve(path);
}
function gitEnv(extra = {}) {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...extra };
}
async function git(cwd, args, options = {}) {
  return (await exec('git', ['--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', cwd, ...args], { env: gitEnv(), timeout: 15000, maxBuffer: MAX_BYTES, ...options })).stdout.trim();
}
async function isGit(path) {
  if (!path) return false;
  try { return (await git(path, ['rev-parse', '--show-toplevel'])) === await realpath(path); } catch { return false; }
}
function inside(root, path) { const rel = relative(root, path); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); }
function protectedPath(path) {
  return path.split(/[\\/]/).some(part => /^(?:\.git|\.ssh|\.aws|\.gnupg|\.npmrc|\.netrc|\.env(?:\..*)?|id_rsa|id_ed25519)$/i.test(part) || /\.(?:pem|key|p12|pfx)$/i.test(part));
}

/** Local authority stays behind project authorization. No file mutation API is exposed. */
export function createLocalProjects({ authorize, getLocal, setLocal, gitToken, cloneGit = (args, options) => exec('git', args, options) }) {
  const operations = new Map();
  const active = new Set();
  async function context(projectId) {
    const project = await authorize(String(projectId));
    if (!project || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(project.slug)) throw new Error('Project has no valid local slug.');
    return { project, local: await getLocal(project.slug) ?? {} };
  }
  async function info({ projectId }) {
    const { project, local } = await context(projectId);
    const path = local.path ? absolute(local.path) : null;
    let exists = false;
    try { exists = (await stat(path)).isDirectory(); } catch { /* missing mapping */ }
    const repository = exists && await isGit(path);
    return { projectId: project.id, slug: project.slug, path, exists, found: exists, configured: local.configured ?? Boolean(local.path), isGit: repository, verify: local.verify ?? '', baseRef: local.baseRef ?? '' };
  }
  async function configure({ projectId, path, verify, baseRef }) {
    const { project } = await context(projectId);
    const changes = {};
    if (path !== undefined) {
      const selected = absolute(path);
      if (!(await stat(selected)).isDirectory()) throw new Error('Selected checkout is not a directory.');
      changes.path = await realpath(selected);
    }
    for (const [key, value] of Object.entries({ verify, baseRef })) if (value !== undefined) {
      if (typeof value !== 'string' || value.length > 4096 || value.includes('\0')) throw new Error(`Invalid ${key}.`);
      changes[key] = value;
    }
    await setLocal(project.slug, changes);
    return info({ projectId });
  }
  async function files({ projectId, action, path = '', range = {} }) {
    const local = await info({ projectId });
    if (!local.exists) throw new Error('Configure an existing local checkout first.');
    const root = await realpath(local.path);
    if (typeof path !== 'string' || isAbsolute(path) || path.includes('\0') || path.split(/[\\/]/).some(p => p === '..' || p === '.git')) throw new Error('Path must stay inside the project checkout.');
    const target = resolve(root, path);
    const canonical = await realpath(target);
    if (!inside(root, canonical)) throw new Error('Symlink leaves the project checkout.');
    if (protectedPath(path) || protectedPath(relative(root, canonical))) throw new Error('Credential files and Git internals are not available in project previews.');
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) throw new Error('Read the original project file, not a symlink.');
    const rel = relative(root, target);
    if (action === 'list') {
      if (!metadata.isDirectory()) throw new Error('Select a directory.');
      const entries = await readdir(target, { withFileTypes: true });
      return { path: rel, entries: entries.filter(x => !protectedPath(x.name) && !x.isSymbolicLink() && (x.isDirectory() || x.isFile())).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 1000).map(x => ({ name: x.name, path: join(rel, x.name), type: x.isDirectory() ? 'directory' : 'file' })), truncated: entries.length > 1000 };
    }
    if (!metadata.isFile() && !metadata.isDirectory()) throw new Error('Not a regular project file.');
    if (action === 'stat') return { path: rel, type: metadata.isDirectory() ? 'directory' : 'file', size: metadata.size };
    if (action !== 'read' || !metadata.isFile()) throw new Error('Select a regular text file.');
    const startLine = range.startLine ?? 1;
    const endLine = range.endLine ?? startLine + 199;
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine - startLine >= 1000) throw new Error('Read between 1 and 1000 lines.');
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.size > MAX_BYTES) throw new Error('Preview supports text files up to 512 KiB. Open larger files in your editor.');
      // Recheck containment, protected paths and the open file's identity.
      const after = await realpath(target);
      if (!inside(root, after) || protectedPath(relative(root, after))) throw new Error('Path left the readable project checkout.');
      const afterMetadata = await stat(after);
      if (current.dev !== afterMetadata.dev || current.ino !== afterMetadata.ino) throw new Error('Project file changed while opening. Retry the preview.');
      const bytes = Buffer.alloc(MAX_BYTES + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead > MAX_BYTES || bytes.subarray(0, bytesRead).includes(0)) throw new Error('Select a text file up to 512 KiB.');
      const lines = bytes.subarray(0, bytesRead).toString('utf8').split(/\r?\n/);
      return { path: rel, text: lines.slice(startLine - 1, endLine).join('\n'), startLine, endLine: Math.min(endLine, lines.length), truncated: endLine < lines.length };
    } finally { await handle.close(); }
  }
  async function gitInfo({ projectId }) {
    const local = await info({ projectId });
    if (!local.isGit) return { isGit: false, root: local.path, branch: null, head: null, dirty: null, remotes: [], reviewAvailable: false };
    const probe = args => git(local.path, args).catch(() => null);
    // Status can invoke clean/process filters configured by the checkout itself.
    // Inspect names only (never credential/config values) and fail closed instead
    // of executing filters or reporting a potentially incorrect unfiltered state.
    const configNames = await probe(['config', '--includes', '--null', '--name-only', '--list']);
    const statusUnavailableReason = configNames === null ? 'Cannot safely inspect repository configuration.'
      : configNames.split('\0').some(name => /^filter\..*\.(?:clean|process|smudge)$/i.test(name)) ? 'Automatic status is disabled because this checkout configures executable Git filters. Review it in your trusted Git application.' : null;
    const [branch, head, status, remoteNames] = await Promise.all([probe(['symbolic-ref', '--quiet', '--short', 'HEAD']), probe(['rev-parse', '--verify', 'HEAD']), statusUnavailableReason ? null : probe(['status', '--porcelain', '--untracked-files=normal', '--ignore-submodules=all']), probe(['remote'])]);
    const remotes = [];
    for (const name of (remoteNames ?? '').split('\n').filter(Boolean).slice(0, 20)) {
      const url = await probe(['remote', 'get-url', '--', name]);
      remotes.push({ name, url: url ? sanitizeRemote(url) : '[unavailable]' });
    }
    return { isGit: true, root: local.path, branch, head, dirty: status === null ? null : status.length > 0, statusUnavailableReason, submoduleWorktreesIncluded: false, remotes, reviewAvailable: true };
  }
  async function clone({ projectId, parentPath, directoryName }) {
    const { project } = await context(projectId);
    const name = directoryName ?? project.slug;
    if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(name) || name.includes('..')) throw new Error('Choose a single directory name starting with a letter or digit.');
    const parent = await realpath(absolute(parentPath));
    if (!(await stat(parent)).isDirectory()) throw new Error('Clone parent is not a directory.');
    const destination = join(parent, name);
    // Atomically reserve an empty destination; never reuse or remove an existing path.
    try { await mkdir(destination, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') throw new Error('Destination already exists. Choose another directory or map the existing checkout.'); throw error; }
    if (active.has(String(projectId))) { await rmdir(destination); throw new Error('A clone is already running for this project.'); }
    active.add(String(projectId));
    const operationId = randomUUID();
    if (operations.size >= 100) { const old = [...operations].find(([, x]) => x.status !== 'running'); if (old) operations.delete(old[0]); }
    const operation = { operationId, projectId: project.id, status: 'running', phase: 'credentials' };
    operations.set(operationId, operation);
    void (async () => {
      let authDir;
      try {
        const credentials = await gitToken(project.id);
        const url = repositoryUrl(credentials.repo);
        if (!credentials.token || typeof credentials.token !== 'string') throw new Error('No project credential.');
        authDir = await mkdtemp(join(tmpdir(), 'ptech-git-auth-'));
        const askpass = join(authDir, 'askpass');
        await writeFile(askpass, '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "x-access-token";; *Password*) printf "%s\\n" "$PTECH_GIT_TOKEN";; *) exit 1;; esac\n', { mode: 0o700 });
        operation.phase = 'cloning';
        // The secret exists only in this child environment; no argv, output, config or stored remote contains it.
        await cloneGit(['-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null', 'clone', '--', url, destination], { env: gitEnv({ GIT_ASKPASS: askpass, GIT_ASKPASS_REQUIRE: 'force', PTECH_GIT_TOKEN: credentials.token }), timeout: 10 * 60_000, maxBuffer: MAX_BYTES });
        operation.phase = 'mapping';
        await setLocal(project.slug, { path: destination });
        operation.status = 'succeeded'; operation.phase = 'complete'; operation.receipt = { projectId: project.id, path: destination };
      } catch {
        operation.status = 'failed'; operation.phase = 'failed'; operation.error = `Clone or mapping failed. Check project GitHub access and network. Destination is ${destination}; inspect it before retrying with a different directory.`;
      } finally {
        active.delete(String(projectId));
        if (authDir) { await unlink(join(authDir, 'askpass')).catch(() => {}); await rmdir(authDir).catch(() => {}); }
      }
    })();
    return { operationId };
  }
  async function operation({ operationId }) {
    const result = operations.get(operationId);
    if (!result) throw new Error('Local operation is no longer available.');
    await authorize(String(result.projectId));
    return { ...result };
  }
  return { info, configure, files, gitInfo, clone, operation };
}
