/*
 * Where a finished run's commit goes.
 *
 * Two pushes matter, and they answer different questions:
 *
 *   - the run's own work branch, malipetek/<task|ticket>-<id>, is what the next
 *     run on any node starts from. It is rewritten each run (force-with-lease),
 *     because a follow-up replaces it rather than adding to it.
 *   - the repo's default branch is what a person (or a deploy) actually reads.
 *     It is only ever fast-forwarded, never forced.
 *
 * A client's work defaults to the first and not the second: on a hosted project
 * the default branch is what deploys, so a client's change waits on its review
 * branch until Ali lands it. Ali's own tasks default to both, because the point
 * of filing a task is that the change is finished when the run is.
 *
 * Kept apart from node.mjs so this policy can be tested without starting a node.
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './executors.mjs';

const NETWORK_MS = 120_000;
const BUNDLE_LIMIT = 50 * 1024 * 1024;
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes',
};
const netGit = (cwd, args) => run('git', args, { cwd, env: GIT_ENV, signal: AbortSignal.timeout(NETWORK_MS) });
const lastLine = (text) => text.trim().split('\n').pop() ?? '';

export const PUSH_TOKENS = ['none', 'branch'];
/** A branch name a push may target. Bounded to what git accepts. */
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

/**
 * Where a good run's commit should land.
 *
 * `push` on the project wins, then the node's own default, then the kind rule.
 * It is either a token — 'none', 'branch' — or a branch name: 'main' for the
 * main line, 'preview' for a preview the client can look at, any other branch
 * the project builds from. A value that is not a branch name falls through to
 * the kind rule rather than failing a run.
 *
 * @param project - the node's project entry, or undefined.
 * @param nodePush - the node-wide default, if one is configured.
 * @param kind - 'client' or 'system'.
 * @returns 'none' | 'branch' | a branch name.
 */
export function pushTarget(project, nodePush, kind) {
  const chosen = project?.push ?? nodePush;
  if (PUSH_TOKENS.includes(chosen)) return chosen;
  if (typeof chosen === 'string' && BRANCH_RE.test(chosen)) return chosen;
  return kind === 'client' ? 'branch' : 'main';
}

/**
 * The branch a repo's main line lives on: configured, else whatever origin's
 * HEAD points at, else `main`.
 *
 * @param config - `{ defaultBranch? }`.
 * @param repo - a clone of the repo.
 * @returns the branch name.
 */
export async function mainBranch(config, repo) {
  const configured = config?.defaultBranch;
  if (typeof configured === 'string' && configured.length > 0) return configured;
  // Ask the remote. A clone's origin/HEAD is a local guess that goes stale — a
  // checkout of a feature branch repoints it — and pushing "main" to a feature
  // branch is exactly how work misses the main line without anyone noticing.
  const remote = await netGit(repo, ['ls-remote', '--symref', 'origin', 'HEAD']);
  if (remote.code === 0) {
    const match = remote.stdout.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m);
    if (match) return match[1];
  }
  const head = await run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: repo });
  const name = head.code === 0 ? head.stdout.trim().replace(/^origin\//, '') : '';
  return name || 'main';
}

const branchRef = (name) => `refs/heads/${name}`;

/**
 * Put a run's work branch on the repo's main line, as the admin asked.
 *
 * Fetch the branch as the remote has it, then push that ref onto the default
 * branch. Git refuses a non-fast-forward, so a diverged branch fails here
 * instead of rewriting anything.
 *
 * @returns `{ ok: true, ref, sha }` or `{ ok: false, error }`.
 */
export async function landWork(config, repo, { shared }) {
  const target = await mainBranch(config, repo);
  const fetched = await netGit(repo, ['fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/${shared}:refs/remotes/origin/${shared}`]);
  if (fetched.code !== 0) return { ok: false, error: `fetch ${shared}: ${lastLine(fetched.stderr)}` };

  const pushed = await netGit(repo, ['push', '--quiet', '--no-verify', 'origin', `refs/remotes/origin/${shared}:${branchRef(target)}`]);
  if (pushed.code !== 0) return { ok: false, error: `push ${shared} -> ${target}: ${lastLine(pushed.stderr)}` };

  const sha = await run('git', ['rev-parse', `refs/remotes/origin/${shared}`], { cwd: repo });
  return { ok: true, ref: target, sha: sha.stdout.trim() };
}

/**
 * Push a run's commit to its work branch, and to the default branch when the
 * policy asks for it.
 *
 * A failed push is not a failed run — the work is still committed and the node
 * can hand back a bundle — so this returns where the work went, or why it did
 * not, and never throws.
 *
 * @param config - node config (`endpoint`, `token`, `worktreeRoot`, `defaultBranch`).
 * @param repo - the source checkout (for the bundle fallback).
 * @param dir - the run's worktree, where HEAD is the run's commit.
 * @param args.shared - the run's work branch name.
 * @param args.remote - the work branch's tip as last fetched, or null when
 *   origin is unreachable (the force-with-lease anchor).
 * @param args.start - the commit the run started from (bundle fallback).
 * @param args.runId - the portal run id, for the bundle fallback.
 * @param args.pushTo - 'none' | 'branch' | 'main'.
 * @returns { to: 'origin' | 'bundle' | null, ref?: string, why: string }.
 */
/** Whether origin's `target` branch already contains HEAD (fetched fresh). */
async function containedIn(dir, target) {
  const tracking = `refs/remotes/origin/${target}`;
  const fetched = await netGit(dir, ['fetch', '--quiet', '--no-tags', 'origin', `+${branchRef(target)}:${tracking}`]);
  if (fetched.code !== 0) return false;
  return (await run('git', ['merge-base', '--is-ancestor', 'HEAD', tracking], { cwd: dir })).code === 0;
}

export async function shareWork(config, repo, dir, { branch, shared, remote, start, runId, pushTo, changed = true, hostedPreview = false }) {
  const notes = [];
  let pushedBranch = false;

  if (remote === null) notes.push('origin is not reachable');

  // The run's own branch is what a follow-up picks up, so it is only worth a
  // push when the run added commits.
  if (remote !== null && changed && pushTo !== 'none') {
    const pushed = await netGit(dir, [
      'push', '--quiet', '--no-verify',
      `--force-with-lease=${branchRef(shared)}:${remote}`,
      'origin', `HEAD:${branchRef(shared)}`,
    ]);
    if (pushed.code === 0) pushedBranch = true;
    else notes.push(`push to origin ${shared} failed: ${lastLine(pushed.stderr)}`);
  }

  // The named branch is what a person (or a deploy, or a client's preview)
  // reads. Plain push, so git refuses a non-fast-forward: it can never rewrite
  // a branch. Not gated on `changed`: a run with nothing new still lands work a
  // previous run committed but never pushed.
  const target = pushTo === 'none' || pushTo === 'branch' ? null : pushTo === 'main' ? await mainBranch(config, repo) : pushTo;
  let landed = null;
  if (target !== null && remote !== null) {
    // A hosted site's preview belongs to the portal, which writes it from the
    // run's changed files. Two writers on one branch would race.
    if (hostedPreview && target === 'preview') {
      notes.push("the hosted site's preview is applied by the portal");
    } else if (await containedIn(dir, target)) {
      // Already there — this commit, or one the branch has since moved past.
      // Pushing it would ask git to move the branch backwards, which it refuses.
      landed = target;
    } else {
      const res = await netGit(dir, ['push', '--quiet', '--no-verify', 'origin', `HEAD:${branchRef(target)}`]);
      if (res.code === 0) landed = target;
      else notes.push(`push to ${target} failed (not a fast-forward?): ${lastLine(res.stderr)}`);
    }
  }

  // A partial success still says what went wrong: a run that did not land on
  // the branch it was meant for is exactly the thing a person needs to know.
  const why = notes.join('; ');
  if (landed !== null) return { to: 'origin', ref: landed, why };
  if (pushedBranch) return { to: 'origin', ref: shared, why };

  // 'none' means nothing leaves this machine: no branch push, and no bundle
  // either — the bundle is a share by another name. Nor is there anything to
  // bundle when the run added no commits.
  if (pushTo === 'none' || !changed) return { to: null, why };
  if (!runId) return { to: null, why };

  // Nothing reached a remote: hand the commit back through the portal so a run
  // on another node can still continue from it.
  const file = join(config.worktreeRoot, `.bundle-out-${runId}`);
  try {
    mkdirSync(config.worktreeRoot, { recursive: true });
    const made = await run('git', ['bundle', 'create', file, branch, `^${start}`], { cwd: repo });
    if (made.code !== 0) return { to: null, why: `${why}; bundle failed: ${lastLine(made.stderr)}` };
    const data = readFileSync(file);
    if (data.length > BUNDLE_LIMIT) {
      return { to: null, why: `${why}; the bundle is ${Math.round(data.length / 1048576)} MB, over the 50 MB limit` };
    }
    const res = await fetch(`${config.endpoint}/node/runs/${runId}/bundle?nodeId=${encodeURIComponent(config.nodeId)}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/octet-stream' },
      body: data,
      signal: AbortSignal.timeout(NETWORK_MS),
    }).catch((error) => ({ ok: false, status: error.message }));
    return res.ok ? { to: 'bundle', why: '' } : { to: null, why: `${why}; bundle upload failed (${res.status})` };
  } finally {
    rmSync(file, { force: true });
  }
}
