/**
 * A ticket's own chat folder, for tickets no local run ever opened.
 *
 * A client's own agent (ChatGPT, Claude…) works a ticket over the portal; no
 * Harness session exists here for it. To show such a ticket in the real chat
 * view, the desktop gives it a folder of its own and starts a session there:
 *
 *   ~/.dsh-admin/tickets/<slug>-ticket-<id>
 *
 * The folder starts as a history-only clone: blobless and sparse, so Git
 * Graph can draw the remote's branches and commits (including the client
 * agent's `malipetek/ticket-<id>` work) without downloading the site. While it
 * is in that state the conversation's composer stays locked. Pulling turns it
 * into a full checkout of the ticket's branch and unlocks the composer.
 *
 * @module @malipetek/dsh-admin/ticket-thread
 */
import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const TICKET_THREADS = join(homedir(), '.dsh-admin', 'tickets');

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The ticket's folder, or null for a slug or id that cannot name one. */
export function threadFolder(root, slug, ticketId) {
  const id = Number(ticketId);
  if (!Number.isSafeInteger(id) || id <= 0 || typeof slug !== 'string' || !SLUG.test(slug)) return null;
  return join(root, `${slug}-ticket-${id}`);
}

/** Run git with no prompt; resolves `{ code, stdout, stderr }`, never rejects. */
export function runGit(args, { cwd, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

const exists = async (path) => {
  try { await stat(path); return true; } catch { return false; }
};

/** The branch a ticket's work lives on, then the preview, then whatever the remote calls its default. */
export async function pickBranch(dir, ticketId, git = runGit) {
  const wanted = [`malipetek/ticket-${ticketId}`, 'preview'];
  const heads = await git(['ls-remote', '--heads', 'origin'], { cwd: dir });
  const names = new Set(heads.stdout.split('\n').map((line) => line.split('refs/heads/')[1]).filter(Boolean));
  return wanted.find((name) => names.has(name)) ?? null;
}

/**
 * The folder's state: `none` (no clone yet), `history` (blobless, sparse:
 * the composer stays locked) or `checkout` (a full working tree).
 */
export async function threadState(dir, git = runGit) {
  if (!dir || !(await exists(join(dir, '.git')))) return 'none';
  const sparse = await git(['config', '--get', 'core.sparseCheckout'], { cwd: dir });
  return sparse.stdout.trim() === 'true' ? 'history' : 'checkout';
}

/**
 * Make sure the folder exists. With a repo it becomes a history-only clone on
 * the ticket's branch; without one it is an empty folder, so the ticket still
 * gets a chat, just no history to draw.
 * @returns `{ dir, state, branch, error? }`.
 */
export async function prepareThread({ root = TICKET_THREADS, slug, ticketId, repo, git = runGit }) {
  const dir = threadFolder(root, slug, ticketId);
  if (!dir) return { dir: null, state: 'none', branch: null, error: 'bad_ticket' };
  await mkdir(root, { recursive: true });
  const state = await threadState(dir, git);
  if (state !== 'none') return { dir, state, branch: null };
  if (typeof repo !== 'string' || !/^(https:\/\/|git@|file:\/\/)/.test(repo)) {
    await mkdir(dir, { recursive: true });
    return { dir, state: 'none', branch: null };
  }
  const cloned = await git(['clone', '--filter=blob:none', '--sparse', '--quiet', repo, dir], { cwd: root, timeoutMs: 180_000 });
  if (cloned.code !== 0) {
    await mkdir(dir, { recursive: true });
    return { dir, state: 'none', branch: null, error: (cloned.stderr.trim().split('\n').pop() || 'git clone failed').slice(0, 300) };
  }
  const branch = await pickBranch(dir, ticketId, git);
  if (branch) {
    await git(['fetch', '--quiet', 'origin', `${branch}:refs/remotes/origin/${branch}`], { cwd: dir });
    await git(['checkout', '--quiet', '-B', branch, `origin/${branch}`], { cwd: dir });
  }
  return { dir, state: 'history', branch };
}

/** Turn the history-only clone into a full checkout of its current branch. */
export async function pullThread(dir, git = runGit) {
  const state = await threadState(dir, git);
  if (state === 'none') return { state, error: 'no_clone' };
  await git(['fetch', '--quiet', 'origin'], { cwd: dir, timeoutMs: 180_000 });
  const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: dir });
  if (upstream.code === 0) await git(['merge', '--ff-only', '--quiet', '@{u}'], { cwd: dir });
  if (state === 'history') {
    const full = await git(['sparse-checkout', 'disable'], { cwd: dir, timeoutMs: 300_000 });
    if (full.code !== 0) return { state: 'history', error: (full.stderr.trim().split('\n').pop() || 'checkout failed').slice(0, 300) };
  }
  return { state: 'checkout' };
}
