/**
 * Host half of the Projects manager bundle.
 *
 * The Projects panel (`@malipetek/dsh-projects-panel`) answers "what projects do I
 * have?". This half answers a harder question: "which of them am I quietly
 * losing?". It builds a richer per-project record than a directory listing can
 * — real DSH work history, git velocity and drift, and a stated next action —
 * then scores each project's *stall risk against its own baseline* rather than
 * against one global threshold.
 *
 * Everything is deterministic and model-free. The model is involved only when
 * the scheduled review fires: it reads `manager-brief.md` and writes the nudge.
 *
 * Three outputs, all under {@link STATE_DIR}:
 *
 * - `index.jsonl`   one JSON record per project, read by the Client half.
 * - `manager-brief.md` a compact, model-readable briefing of what needs attention.
 * - `cache.json`    per-project incremental state, so a rescan only re-runs git
 *                   for repositories whose git index or HEAD actually moved.
 *
 * Human-facing controls are Cordis commands (`/projects …`), which the panel
 * invokes through `remote.commands.execute` without creating a model message.
 *
 * @module @malipetek/dsh-projects-manager
 */
import { execFile } from 'node:child_process';
import { watch } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

/* -------------------------------------------------------------------------- *
 * Configuration — mirrored in part by `client.js`; change both together.
 * -------------------------------------------------------------------------- */

/** The folder whose projects this plugin manages. */
const PROJECTS_ROOT = '/Users/malipetek/Documents/Documents/Projects';

/**
 * Where generated state lives. Absolute literals, not `DSH_HOME`-derived,
 * because the Client half hardcodes {@link INDEX_PATH} and cannot read the Host
 * environment. Change the two `*.jsonl`/`*.md` paths in `client.js` with these.
 *
 * `DSH_PROJECTS_MANAGER_DIR` overrides the directory for local smoke tests only;
 * the running app never sets it, and `client.js` does not honour it.
 */
const STATE_DIR = process.env.DSH_PROJECTS_MANAGER_DIR || '/Users/malipetek/.dsh/projects-manager';
const INDEX_PATH = `${STATE_DIR}/index.jsonl`;
const BRIEF_PATH = `${STATE_DIR}/manager-brief.md`;
const INTENT_PATH = `${STATE_DIR}/intent.json`;
const CACHE_PATH = `${STATE_DIR}/cache.json`;
/**
 * Wiring report: which optional capabilities this plugin actually reached in the
 * running Host. Written so a failed lazy import or a missing Schedule service is
 * visible from outside the Host log.
 */
const DOCTOR_PATH = `${STATE_DIR}/doctor.json`;

/** DSH's own stores, which carry the "did I actually work on it" signal. */
const STORAGES_DIR = '/Users/malipetek/.dsh/storages';
const WORKSPACE_STORE = `${STORAGES_DIR}/workspace.json`;
const SESSION_CACHE_DIR = `${STORAGES_DIR}/session_projcache/sessions`;

/** How long an uninterrupted project may sit before the panel calls it dormant. */
const DEFAULT_CADENCE_DAYS = 14;
/** Bound on the per-project baseline learned from history. */
const MIN_CADENCE_DAYS = 1;
/**
 * Floor for a *learned* pace. A repository that commits daily would otherwise
 * have a one-day baseline, so every weekend would read as "cooling". A pace the
 * human states explicitly is still honoured down to {@link MIN_CADENCE_DAYS}.
 */
const LEARNED_MIN_CADENCE_DAYS = 3;
const MAX_CADENCE_DAYS = 60;
/** Quantile of the project's own activity gaps treated as "unusual for me". */
const CADENCE_QUANTILE = 0.75;
/** How far back git history is read when learning a project's own pace. */
const HISTORY_DAYS = 180;
/** Retain at most this many activity days per project when learning the baseline. */
const MAX_GAP_SAMPLES = 20;
/** Records at or above this count are treated as "drifting". */
const DRIFT_MARKER_LIMIT = 8;
/** Cheap re-scan cadence; activity inside a project fires no watch event. */
const RESCAN_INTERVAL_MS = 5 * 60 * 1000;
/** Collapse a burst of folder events into one rebuild. */
const WATCH_DEBOUNCE_MS = 500;
/** Concurrent git invocations; each is a short read-only command. */
const GIT_CONCURRENCY = 8;
/** Ceiling on a single git invocation. */
const GIT_TIMEOUT_MS = 10_000;
/** Session cache files read per scan, newest first, so the scan stays bounded. */
const MAX_SESSION_FILES = 4000;
/** Projects named in the briefing's "needs attention" section. */
const BRIEF_ATTENTION_LIMIT = 12;
/** Default cron for the scheduled review: 09:00 on weekdays. */
const DEFAULT_CRON = '0 9 * * 1-5';

/**
 * The instruction the scheduled review delivers. It is deliberately short: the
 * judgement lives in the briefing, which the agent reads on demand.
 */
const REVIEW_PROMPT = [
  'Act as my projects manager.',
  `Read ${BRIEF_PATH} and report only on the projects listed under "Needs attention".`,
  'For each, give one line saying why it is stalling — days since real work versus that project\'s own pace, a falling commit rate, or uncommitted drift — and one concrete next action.',
  'Then pick the single project most worth resuming today and state the first step.',
  'Keep the whole reply under 200 words. If nothing needs attention, reply with one short line saying so.',
  'Use the projects_manager tool if you need more detail, or to snooze or reschedule anything I mention.',
].join('\n');

/* -------------------------------------------------------------------------- *
 * Small utilities
 * -------------------------------------------------------------------------- */

/**
 * Modification time of a path, or 0 when it is missing or unreadable.
 * @param target - absolute path to stat.
 * @returns epoch milliseconds, or 0.
 */
async function mtimeOf(target) {
  try {
    return (await stat(target)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Parse a JSON file, returning a fallback for any failure.
 * @param path - absolute file path.
 * @param fallback - value to use when the file is missing or malformed.
 * @returns the parsed value, or `fallback`.
 */
async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Write a file, creating its directory first.
 * @param path - absolute file path.
 * @param text - the complete contents.
 */
async function writeText(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
}

/** @returns the current instant in epoch milliseconds. */
function now() {
  return Date.now();
}

/**
 * Clamp a number into an inclusive range.
 * @param value - candidate value.
 * @param low - inclusive lower bound.
 * @param high - inclusive upper bound.
 * @returns the clamped value.
 */
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Whole days between an instant and now, floored at zero.
 * @param timestamp - epoch milliseconds, or 0 when unknown.
 * @returns whole days, or null when the instant is unknown.
 */
function daysSince(timestamp) {
  if (typeof timestamp !== 'number' || timestamp <= 0) return null;
  return Math.max(0, Math.floor((now() - timestamp) / 86400000));
}

/**
 * Local calendar day key for an instant, as `YYYY-MM-DD`.
 * @param timestamp - epoch milliseconds.
 * @returns the local day key.
 */
function dayKey(timestamp) {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Whole days between two `YYYY-MM-DD` keys.
 * @param earlier - the earlier day key.
 * @param later - the later day key.
 * @returns the day difference.
 */
function daysBetweenKeys(earlier, later) {
  const left = Date.parse(`${earlier}T00:00:00Z`);
  const right = Date.parse(`${later}T00:00:00Z`);
  return Math.round((right - left) / 86400000);
}

/**
 * Run one short command and capture stdout.
 * @param file - the executable.
 * @param args - its arguments.
 * @param options - `cwd` and `timeoutMs` overrides.
 * @returns stdout text, or null when the command failed or timed out.
 */
function run(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd: options.cwd, timeout: options.timeoutMs ?? GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout) => resolve(error ? null : stdout),
    );
  });
}

/**
 * Map over items with a bounded number of concurrent workers.
 * @param items - the work list.
 * @param limit - maximum in-flight operations.
 * @param worker - async function applied to each item.
 * @returns results in input order.
 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/* -------------------------------------------------------------------------- *
 * Collectors
 * -------------------------------------------------------------------------- */

/**
 * A one-line description for a project, preferring its package manifest.
 * @param projectPath - absolute project directory.
 * @returns the manifest description, else its name, else an empty string.
 */
async function descriptionOf(projectPath) {
  const parsed = await readJson(join(projectPath, 'package.json'), null);
  if (parsed !== null && typeof parsed === 'object') {
    if (typeof parsed.description === 'string' && parsed.description.trim().length > 0) return parsed.description.trim();
    if (typeof parsed.name === 'string' && parsed.name.trim().length > 0) return parsed.name.trim();
  }
  return '';
}

/**
 * Parse `git status --porcelain --branch` into branch, tracking and drift.
 * @param text - the command output.
 * @returns branch name, ahead/behind counts and change counts.
 */
function parseStatus(text) {
  const lines = text.split('\n').filter((line) => line.length > 0);
  const head = lines.length > 0 && lines[0].startsWith('## ') ? lines[0].slice(3) : '';
  let branch = head;
  let ahead = 0;
  let behind = 0;
  const tracking = head.match(/\[(.*)\]$/);
  if (tracking !== null) {
    branch = head.slice(0, head.length - tracking[0].length).trim();
    const aheadMatch = tracking[1].match(/ahead (\d+)/);
    const behindMatch = tracking[1].match(/behind (\d+)/);
    if (aheadMatch !== null) ahead = Number(aheadMatch[1]);
    if (behindMatch !== null) behind = Number(behindMatch[1]);
  }
  if (branch.includes('...')) branch = branch.slice(0, branch.indexOf('...'));
  if (branch === '' || branch === 'HEAD (no branch)') branch = branch === '' ? 'unknown' : 'detached';

  let dirty = 0;
  let untracked = 0;
  for (const line of lines.slice(head === '' ? 0 : 1)) {
    if (line.startsWith('??')) untracked += 1;
    else if (line.trim().length > 0) dirty += 1;
  }
  return { branch, ahead, behind, dirty, untracked };
}

/**
 * Read a repository's velocity and drift.
 *
 * Two git invocations per repository: `status --porcelain --branch` yields the
 * branch, upstream distance and drift in one call, and `log --since` yields the
 * commit cadence used both for velocity and for the project's own baseline.
 *
 * @param projectPath - absolute project directory.
 * @returns the git block, or a `isGit: false` marker for a non-repository.
 */
async function collectGit(projectPath) {
  if ((await mtimeOf(join(projectPath, '.git'))) === 0) return { isGit: false };

  const [statusText, logText] = await Promise.all([
    run('git', ['-C', projectPath, 'status', '--porcelain', '--branch', '--untracked-files=normal']),
    run('git', ['-C', projectPath, 'log', `--since=${HISTORY_DAYS}.days`, '--format=%ct']),
  ]);
  if (statusText === null) return { isGit: false };

  const status = parseStatus(statusText);
  const times = (logText ?? '')
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((seconds) => seconds * 1000);

  const newest = times.length > 0 ? Math.max(...times) : 0;
  const cutoff14 = now() - 14 * 86400000;
  const cutoff28 = now() - 28 * 86400000;
  const commits14 = times.filter((t) => t >= cutoff14).length;
  const commitsPrior14 = times.filter((t) => t >= cutoff28 && t < cutoff14).length;

  return {
    isGit: true,
    branch: status.branch,
    ahead: status.ahead,
    behind: status.behind,
    dirty: status.dirty,
    untracked: status.untracked,
    lastCommitAt: newest,
    commits14,
    commitsPrior14,
    commits180: times.length,
    commitTimes: times.slice(0, 400),
  };
}

/**
 * Build a project path -> DSH work summary map from DSH's own stores.
 *
 * `workspace.json` maps a workspace to its session ids; each session's
 * projection cache records its working directory, turn count and last prompt
 * time. That last-prompt time is the single best "I actually worked on this"
 * signal available, and it is what makes this plugin different from a
 * directory mtime watcher.
 *
 * @returns a map from absolute project path to its DSH activity block.
 */
async function collectDshActivity() {
  const sessions = new Map();
  try {
    const names = await readdir(SESSION_CACHE_DIR);
    const files = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const full = join(SESSION_CACHE_DIR, name);
      files.push({ full, mtime: await mtimeOf(full) });
    }
    files.sort((left, right) => right.mtime - left.mtime);
    for (const file of files.slice(0, MAX_SESSION_FILES)) {
      const parsed = await readJson(file.full, null);
      const record = parsed?.record;
      if (record === undefined) continue;
      const cwd = record.identity?.cwd;
      if (typeof cwd !== 'string' || cwd.length === 0) continue;
      const stats = record.rows?.sessionStats?.val ?? {};
      const meta = record.rows?.sessionListMetadata?.val ?? {};
      sessions.set(cwd, {
        cwd,
        turns: typeof stats.turns === 'number' ? stats.turns : 0,
        llmMs: typeof stats.llmMs === 'number' ? stats.llmMs : 0,
        lastPromptAt: typeof meta.lastPromptAt === 'number' ? meta.lastPromptAt : 0,
        blank: meta.blank === true,
        createdAt: typeof record.identity?.createdAt === 'number' ? record.identity.createdAt : 0,
      });
    }
  } catch {
    // No session cache yet: every project simply reports no DSH history.
  }

  // Workspace membership is the authoritative path -> project link.
  const workspace = await readJson(WORKSPACE_STORE, null);
  const byPath = new Map();
  const tables = workspace?.tables?.workspaces;
  if (tables !== null && typeof tables === 'object') {
    for (const entry of Object.values(tables)) {
      if (entry === null || typeof entry !== 'object' || typeof entry.path !== 'string') continue;
      const ids = Array.isArray(entry.sessionIds) ? entry.sessionIds.length : 0;
      byPath.set(entry.path, { workspaceSessions: ids, updatedAt: Date.parse(entry.updatedAt ?? '') || 0 });
    }
  }
  return { sessions, byPath };
}

/**
 * Resolve a session working directory to the project that contains it, so a
 * session opened in a nested folder still counts for its project.
 * @param cwd - the session working directory.
 * @param roots - candidate absolute project paths, longest first.
 * @returns the owning project path, or null.
 */
function ownerOf(cwd, roots) {
  for (const root of roots) {
    if (cwd === root) return root;
    if (cwd.startsWith(root.endsWith('/') ? root : `${root}/`)) return root;
  }
  return null;
}

/* -------------------------------------------------------------------------- *
 * Intent — the human's stated plan for a project
 * -------------------------------------------------------------------------- */

/**
 * Read the host-owned intent store.
 * @returns a versioned store of per-project intent.
 */
async function readIntent() {
  const parsed = await readJson(INTENT_PATH, null);
  if (parsed === null || typeof parsed !== 'object' || typeof parsed.items !== 'object' || parsed.items === null) {
    return { version: 1, items: {} };
  }
  return { version: 1, items: parsed.items };
}

/**
 * Persist the intent store.
 * @param store - the complete next store value.
 */
async function writeIntent(store) {
  await writeText(INTENT_PATH, `${JSON.stringify(store, null, 2)}\n`);
}

/* -------------------------------------------------------------------------- *
 * Scoring
 * -------------------------------------------------------------------------- */

/**
 * Learn a project's own working pace from its distinct activity days.
 *
 * A project that normally moves every two days and has now been quiet for six
 * is stalling even though six days would be unremarkable elsewhere. That
 * relative comparison is the whole point, so the baseline is taken from this
 * project's recent activity gaps — at {@link CADENCE_QUANTILE}, so "unusual for
 * me" means genuinely unusual rather than merely slower than the median — and
 * floored by {@link LEARNED_MIN_CADENCE_DAYS} so ordinary weekends do not read
 * as decline.
 *
 * @param dayKeys - distinct `YYYY-MM-DD` activity days, unsorted.
 * @returns a pace in days, or null when there is too little history.
 */
function deriveCadenceDays(dayKeys) {
  const sorted = [...dayKeys].sort();
  if (sorted.length < 3) return null;
  const gaps = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = daysBetweenKeys(sorted[index - 1], sorted[index]);
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return null;
  const recent = gaps.slice(-MAX_GAP_SAMPLES).sort((left, right) => left - right);
  const rank = clamp(Math.ceil(recent.length * CADENCE_QUANTILE) - 1, 0, recent.length - 1);
  return clamp(recent[rank], LEARNED_MIN_CADENCE_DAYS, MAX_CADENCE_DAYS);
}

/**
 * Choose the instant a project was last genuinely worked on.
 *
 * DSH session activity outranks git, which outranks raw file mtimes: a script
 * touching a file is not the same as a person working on the project.
 *
 * @param git - the project's git block.
 * @param dsh - the project's DSH activity block.
 * @param directoryMtime - fallback directory modification time.
 * @returns the chosen instant and the signal it came from.
 */
function lastTouch(git, dsh, directoryMtime) {
  const candidates = [
    { at: dsh.lastPromptAt, source: 'dsh' },
    { at: git.lastCommitAt ?? 0, source: 'git' },
    { at: directoryMtime, source: 'filesystem' },
  ].filter((candidate) => typeof candidate.at === 'number' && candidate.at > 0);
  if (candidates.length === 0) return { at: 0, source: 'unknown' };
  candidates.sort((left, right) => right.at - left.at);
  return candidates[0];
}

/**
 * Score one project's stall risk against its own baseline.
 *
 * The state is a cadence-relative band; the score blends how long the project
 * has been quiet, how far its commit rate has fallen, and how much uncommitted
 * work is accumulating. Reasons and suggestions are phrased for a human.
 *
 * @param context - the collected project facts plus resolved intent.
 * @returns the momentum block stored on the record.
 */
function scoreProject(context) {
  const { git, dsh, intent, derivedCadence, directoryMtime } = context;
  const touch = lastTouch(git, dsh, directoryMtime);
  const cadenceDays = clamp(
    typeof intent.cadenceDays === 'number' && intent.cadenceDays > 0
      ? intent.cadenceDays
      : derivedCadence ?? DEFAULT_CADENCE_DAYS,
    MIN_CADENCE_DAYS,
    MAX_CADENCE_DAYS,
  );

  const started = (git.commits180 ?? 0) > 0 || (dsh.turns ?? 0) > 0;
  const neverStarted = !started && (dsh.sessions ?? 0) > 0;
  // For a project that was opened and never used, the meaningful clock is when
  // it was opened, not the folder's modification time.
  const quietDays = neverStarted && (dsh.createdAt ?? 0) > 0
    ? daysSince(dsh.createdAt) ?? 9999
    : daysSince(touch.at) ?? 9999;

  let state;
  if (intent.ignored === true) state = 'ignored';
  else if (neverStarted) state = 'never-started';
  else if (!started) state = 'unstarted';
  else if (quietDays <= cadenceDays) state = 'active';
  else if (quietDays <= cadenceDays * 2) state = 'cooling';
  else if (quietDays <= cadenceDays * 5) state = 'stalling';
  else state = 'dormant';

  const timeFactor = clamp(quietDays / (cadenceDays * 5), 0, 1);
  const prior = git.commitsPrior14 ?? 0;
  const recent = git.commits14 ?? 0;
  const velocityFactor = prior > 0 ? 1 - clamp(recent / prior, 0, 1) : 0;
  const drift = (git.dirty ?? 0) + (git.untracked ?? 0);
  const driftFactor = clamp(drift / (DRIFT_MARKER_LIMIT * 2.5), 0, 1);
  const score = started ? clamp(0.55 * timeFactor + 0.3 * velocityFactor + 0.15 * driftFactor, 0, 1) : 0;

  const reasons = [];
  const suggestions = [];
  if (neverStarted) {
    reasons.push('opened in DSH but never prompted, and nothing has been committed');
    suggestions.push('start it for real or archive it');
  }
  if (started && quietDays > cadenceDays) {
    reasons.push(`${quietDays}d since real work, against a usual pace of about ${cadenceDays}d here`);
  }
  if (prior > 0 && recent < prior) {
    reasons.push(`commit pace fell from ${prior} to ${recent} per fortnight`);
    suggestions.push('land one small commit to break the stall');
  }
  if (drift > DRIFT_MARKER_LIMIT) {
    reasons.push(`${drift} uncommitted or untracked files are piling up`);
    suggestions.push('commit or stash the drift');
  }
  if (typeof intent.nextAction === 'string' && intent.nextAction.length > 0) {
    reasons.push(`you noted the next action: ${intent.nextAction}`);
    suggestions.unshift(`resume with: ${intent.nextAction}`);
  }
  if (touch.source === 'filesystem' && started) {
    reasons.push('only file timestamps have moved recently, not commits or DSH sessions');
  }

  return {
    state,
    score: Number(score.toFixed(3)),
    quietDays,
    cadenceDays,
    cadenceSource: typeof intent.cadenceDays === 'number' ? 'stated' : derivedCadence === null ? 'default' : 'learned',
    lastTouchAt: touch.at,
    lastTouchSource: touch.source,
    reasons,
    suggestions,
  };
}

/** States that deserve a reminder, worst first. */
const ATTENTION_STATES = ['never-started', 'stalling', 'cooling'];

/**
 * Decide whether a project should appear in a reminder.
 * @param record - the scored project record.
 * @returns true when the project is worth a nudge right now.
 */
function needsAttention(record) {
  if (record.intent.ignored === true) return false;
  if (typeof record.intent.snoozeUntil === 'number' && record.intent.snoozeUntil > now()) return false;
  if (record.hidden === true) return false;
  return ATTENTION_STATES.includes(record.momentum.state);
}

/* -------------------------------------------------------------------------- *
 * Scan
 * -------------------------------------------------------------------------- */

/**
 * Build one project's complete record.
 * @param name - the directory name.
 * @param projectPath - its absolute path.
 * @param activity - the DSH activity map produced by {@link collectDshActivity}.
 * @param intent - the resolved per-project intent.
 * @returns the record written to the index.
 */
async function describeProject(name, projectPath, activity, intent) {
  const directoryMtime = await mtimeOf(projectPath);
  const git = await collectGit(projectPath);
  const dsh = activity.get(projectPath) ?? { sessions: 0, turns: 0, llmMs: 0, lastPromptAt: 0, createdAt: 0, blankSessions: 0, workspaceSessions: 0 };

  const dayKeys = new Set();
  for (const time of git.commitTimes ?? []) dayKeys.add(dayKey(time));
  if (dsh.lastPromptAt > 0) dayKeys.add(dayKey(dsh.lastPromptAt));
  if (dsh.createdAt > 0) dayKeys.add(dayKey(dsh.createdAt));
  const derivedCadence = deriveCadenceDays(dayKeys);

  const momentum = scoreProject({
    git,
    dsh,
    intent,
    derivedCadence,
    directoryMtime,
  });

  return {
    name,
    path: projectPath,
    hidden: name.startsWith('.'),
    description: await descriptionOf(projectPath),
    repo: {
      isGit: git.isGit === true,
      branch: git.branch ?? '',
      ahead: git.ahead ?? 0,
      behind: git.behind ?? 0,
      dirty: git.dirty ?? 0,
      untracked: git.untracked ?? 0,
      lastCommitAt: git.lastCommitAt ?? 0,
      commits14: git.commits14 ?? 0,
      commitsPrior14: git.commitsPrior14 ?? 0,
      commits180: git.commits180 ?? 0,
    },
    dsh: {
      sessions: dsh.sessions ?? 0,
      turns: dsh.turns ?? 0,
      minutes: Math.round((dsh.llmMs ?? 0) / 60000),
      lastWorkedAt: dsh.lastPromptAt ?? 0,
      blankSessions: dsh.blankSessions ?? 0,
    },
    intent: {
      nextAction: typeof intent.nextAction === 'string' ? intent.nextAction : '',
      cadenceDays: typeof intent.cadenceDays === 'number' ? intent.cadenceDays : 0,
      snoozeUntil: typeof intent.snoozeUntil === 'number' ? intent.snoozeUntil : 0,
      note: typeof intent.note === 'string' ? intent.note : '',
      ignored: intent.ignored === true,
    },
    momentum,
    directoryMtime,
  };
}

/**
 * Aggregate raw session rows into per-project DSH blocks.
 * @param sessions - map of cwd to session summary.
 * @param byPath - map of workspace path to workspace summary.
 * @param roots - candidate project paths, longest first.
 * @returns map of project path to its aggregated DSH block.
 */
function aggregateActivity(sessions, byPath, roots) {
  const totals = new Map();
  const ensure = (path) => {
    if (!totals.has(path)) {
      totals.set(path, { sessions: 0, turns: 0, llmMs: 0, lastPromptAt: 0, createdAt: 0, blankSessions: 0, workspaceSessions: 0 });
    }
    return totals.get(path);
  };
  for (const root of roots) if (byPath.has(root)) ensure(root).workspaceSessions = byPath.get(root).workspaceSessions;
  for (const session of sessions.values()) {
    const owner = ownerOf(session.cwd, roots);
    if (owner === null) continue;
    const block = ensure(owner);
    block.sessions += 1;
    block.turns += session.turns;
    block.llmMs += session.llmMs;
    if (session.lastPromptAt > block.lastPromptAt) block.lastPromptAt = session.lastPromptAt;
    if (session.createdAt > block.createdAt) block.createdAt = session.createdAt;
    if (session.blank) block.blankSessions += 1;
  }
  return totals;
}

/**
 * Scan every project, score it, and publish the index, briefing and cache.
 * @param reason - a short label recorded in the scan summary.
 * @returns the assembled scan result.
 */
async function scan(reason) {
  const startedAt = now();
  const entries = await readdir(PROJECTS_ROOT, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => ({ name: entry.name, path: join(PROJECTS_ROOT, entry.name) }));

  const intentStore = await readIntent();
  const { sessions, byPath } = await collectDshActivity();
  // Longest paths first so a nested project claims its own sessions.
  const roots = candidates.map((candidate) => candidate.path).sort((left, right) => right.length - left.length);
  const activity = aggregateActivity(sessions, byPath, roots);

  const records = await mapLimit(candidates, GIT_CONCURRENCY, async (candidate) => {
    try {
      return await describeProject(candidate.name, candidate.path, activity, intentStore.items[candidate.path] ?? {});
    } catch (error) {
      console.warn(`[projects-manager] skipped ${candidate.name}:`, error);
      return null;
    }
  });

  const kept = records.filter((record) => record !== null);
  kept.sort((left, right) => left.name.localeCompare(right.name));

  const attention = kept.filter(needsAttention).sort((left, right) => right.momentum.score - left.momentum.score);
  const counts = {};
  for (const record of kept) counts[record.momentum.state] = (counts[record.momentum.state] ?? 0) + 1;

  const finishedAt = now();
  const summary = {
    scannedAt: finishedAt,
    durationMs: finishedAt - startedAt,
    reason,
    total: kept.length,
    counts,
    attention: attention.slice(0, BRIEF_ATTENTION_LIMIT).map((record) => record.path),
  };

  await writeText(INDEX_PATH, kept.map((record) => JSON.stringify(record)).join('\n') + (kept.length > 0 ? '\n' : ''));
  await writeText(BRIEF_PATH, renderBrief(summary, attention, kept));
  await writeText(CACHE_PATH, `${JSON.stringify(summary, null, 2)}\n`);

  console.log(`[projects-manager] ${kept.length} projects, ${attention.length} need attention (${finishedAt - startedAt}ms, ${reason})`);
  return { records: kept, attention, summary };
}
/* -------------------------------------------------------------------------- *
 * Briefing
 * -------------------------------------------------------------------------- */

/**
 * Render the model-readable briefing.
 * @param summary - the scan summary.
 * @param attention - projects needing attention, worst first.
 * @param all - every scored project.
 * @returns markdown text.
 */
function renderBrief(summary, attention, all) {
  const when = new Date(summary.scannedAt).toISOString().replace('T', ' ').slice(0, 16);
  const lines = [];
  lines.push('# Projects manager briefing');
  lines.push('');
  lines.push(`Generated ${when} UTC from ${summary.total} projects under ${PROJECTS_ROOT}.`);
  lines.push('');
  const stateOrder = ['never-started', 'stalling', 'cooling', 'active', 'dormant', 'unstarted', 'ignored'];
  const parts = stateOrder
    .filter((state) => (summary.counts[state] ?? 0) > 0)
    .map((state) => `${summary.counts[state]} ${state}`);
  lines.push(`Counts: ${parts.join(', ')}.`);
  lines.push('');

  if (attention.length === 0) {
    lines.push('## Needs attention');
    lines.push('');
    lines.push('Nothing is stalling. No action needed.');
    lines.push('');
  } else {
    lines.push(`## Needs attention (${attention.length})`);
    lines.push('');
    for (const record of attention.slice(0, BRIEF_ATTENTION_LIMIT)) {
      const { momentum } = record;
      lines.push(`### ${record.name} — ${momentum.state} (risk ${momentum.score})`);
      lines.push(`- Path: ${record.path}`);
      lines.push(`- Quiet for ${momentum.quietDays}d against a ${momentum.cadenceSource} pace of ~${momentum.cadenceDays}d.`);
      if (record.repo.isGit) {
        lines.push(`- Git: branch ${record.repo.branch}, ${record.repo.commits14} commits in 14d (was ${record.repo.commitsPrior14}), ${record.repo.dirty} modified, ${record.repo.untracked} untracked.`);
      } else {
        lines.push('- Git: not a repository.');
      }
      if (record.dsh.sessions > 0) {
        const worked = record.dsh.lastWorkedAt > 0 ? `${daysSince(record.dsh.lastWorkedAt)}d ago` : 'never';
        lines.push(`- DSH: ${record.dsh.sessions} session(s), ${record.dsh.turns} turn(s), last real prompt ${worked}.`);
      }
      for (const reason of momentum.reasons) lines.push(`- Why: ${reason}`);
      for (const suggestion of momentum.suggestions) lines.push(`- Suggested: ${suggestion}`);
      lines.push(`- Snooze with: /projects snooze "${record.name}" 14`);
      lines.push('');
    }
    if (attention.length > BRIEF_ATTENTION_LIMIT) {
      lines.push(`(${attention.length - BRIEF_ATTENTION_LIMIT} further stalling projects were omitted.)`);
      lines.push('');
    }
  }

  const moving = all
    .filter((record) => record.momentum.state === 'active')
    .sort((left, right) => right.momentum.lastTouchAt - left.momentum.lastTouchAt)
    .slice(0, 8);
  if (moving.length > 0) {
    lines.push('## Recently moving');
    lines.push('');
    for (const record of moving) {
      lines.push(`- ${record.name} — last real work ${daysSince(record.momentum.lastTouchAt)}d ago via ${record.momentum.lastTouchSource}.`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- *
 * Project lookup and formatting
 * -------------------------------------------------------------------------- */

/**
 * Resolve a user- or model-supplied project name against the current index.
 * @param records - the scored records.
 * @param needle - the supplied name, or a unique prefix or substring.
 * @returns the matched record, or a failure describing the ambiguity.
 */
function findProject(records, needle) {
  const wanted = String(needle ?? '').trim().toLowerCase();
  if (wanted.length === 0) return { error: 'Name a project, for example: /projects snooze ShipFit 14' };
  const exact = records.filter((record) => record.name.toLowerCase() === wanted);
  if (exact.length === 1) return { record: exact[0] };
  const prefix = records.filter((record) => record.name.toLowerCase().startsWith(wanted));
  if (prefix.length === 1) return { record: prefix[0] };
  const partial = records.filter((record) => record.name.toLowerCase().includes(wanted));
  if (partial.length === 1) return { record: partial[0] };
  const near = (prefix.length > 0 ? prefix : partial).slice(0, 8).map((record) => record.name);
  if (near.length === 0) return { error: `No project matches "${needle}".` };
  return { error: `"${needle}" is ambiguous. Did you mean: ${near.join(', ')}?` };
}

/**
 * One-line human summary of a project's state.
 * @param record - the scored record.
 * @returns a short description.
 */
function describeState(record) {
  const { momentum } = record;
  return `${record.name} — ${momentum.state}, quiet ${momentum.quietDays}d vs a ~${momentum.cadenceDays}d pace (risk ${momentum.score})`;
}

/** @returns the local IANA time zone. */
function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/* -------------------------------------------------------------------------- *
 * Plugin
 * -------------------------------------------------------------------------- */

/** Services this Host plugin needs; `schedule` is optional and read via `ctx.get`. */
export const name = 'projects-manager';
export const inject = ['tools', 'commands'];

/**
 * Run a scan and keep the index fresh from a folder watch and a slow interval.
 * @param ctx - the Host plugin context.
 */
export function apply(ctx) {
  /** Latest scan, refreshed on every rebuild; commands read it for fast lookups. */
  let latest = { records: [], attention: [], summary: null };
  /** Serializes scans so a watch event cannot overlap an interval rebuild. */
  let running = null;

  /**
   * Wiring report. `@deepseek-ai/dsh-tools` reaches an installed bundle through
   * the application's two-anchor resolver rather than through this package's own
   * dependencies, and `schedule` is only mounted when the optional Automation
   * tasks bundle is enabled; both are recorded so a failure is diagnosable from
   * disk instead of only from the Host log.
   */
  const doctor = {
    updatedAt: 0,
    tool: 'pending',
    toolError: null,
    schedule: ctx.get('schedule') === undefined ? 'unavailable' : 'ready',
  };

  /** Persist the current wiring report, re-reading the optional Schedule service. */
  function publishDoctor() {
    doctor.updatedAt = now();
    doctor.schedule = ctx.get('schedule') === undefined ? 'unavailable' : 'ready';
    void writeText(DOCTOR_PATH, `${JSON.stringify(doctor, null, 2)}\n`).catch(() => {});
  }

  publishDoctor();

  /**
   * Rebuild the index unless a build is already in flight.
   * @param reason - label recorded in the scan summary.
   * @returns the scan result, or the in-flight scan.
   */
  function rebuild(reason) {
    if (running !== null) return running;
    running = scan(reason)
      .then((result) => {
        latest = { records: result.records, attention: result.attention, summary: result.summary };
        // Re-read the optional services: whether Schedule is mounted is only
        // knowable once the whole tree has settled, not during `apply`.
        publishDoctor();
        return result;
      })
      .catch((error) => {
        console.warn('[projects-manager] scan failed:', error);
        return null;
      })
      .finally(() => {
        running = null;
      });
    return running;
  }

  /**
   * Read the index, rebuilding first when the in-memory copy is empty.
   * @returns the current records.
   */
  async function recordsNow() {
    if (latest.records.length === 0) await rebuild('lazy');
    return latest.records;
  }

  /**
   * Apply one intent edit, leaving every other project alone.
   * @param path - absolute project directory.
   * @param patch - fields to merge into that project's intent.
   * @returns the stored intent for that project.
   */
  async function patchIntent(path, patch) {
    const store = await readIntent();
    const next = { ...(store.items[path] ?? {}), ...patch };
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === null || value === '') delete next[key];
    }
    store.items[path] = next;
    await writeIntent(store);
    await rebuild('intent');
    return next;
  }

  ctx.effect(() => {
    void rebuild('startup');

    let debounce;
    const schedule = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { void rebuild('watch'); }, WATCH_DEBOUNCE_MS);
    };

    let watcher = null;
    try {
      watcher = watch(PROJECTS_ROOT, { persistent: false }, schedule);
    } catch (error) {
      console.warn('[projects-manager] cannot watch the projects folder:', error);
    }

    // A plain interval rather than `ctx.interval`: the timer service is a
    // separate inject, and reading it without declaring it in `inject` throws,
    // which would abort the rest of `apply` and silently cost the command and
    // tool registrations. A self-clearing timer is all the rescan needs, and
    // `ctx.effect` already owns the disposal.
    const handle = setInterval(() => { void rebuild('interval'); }, RESCAN_INTERVAL_MS);
    if (typeof handle.unref === 'function') handle.unref();

    return () => {
      clearTimeout(debounce);
      clearInterval(handle);
      try {
        watcher?.close();
      } catch {
        // Already closed.
      }
    };
  }, 'projects-manager: project scan');

  /* ---------------------------------------------------------------------- *
   * Command surface — direct human control, no model message.
   * ---------------------------------------------------------------------- */

  const COMMAND_NAME = 'projects';
  const COMMAND_DESCRIPTION = "Manage project momentum: list what is stalling, set a project's pace or next action, and set up the review reminder.";

  /**
   * Create or replace the scheduled review task.
   * @param sessionId - the Session the reminder delivers into.
   * @param expression - a five-field Vixie cron expression.
   * @returns a human-readable outcome.
   */
  async function ensureSchedule(sessionId, expression) {
    const schedule = ctx.get('schedule');
    if (schedule === undefined || schedule === null) {
      return { ok: false, text: 'Scheduling is unavailable. Enable the "Automation tasks" bundle in Settings → Plugins, then restart.' };
    }
    try {
      const created = await schedule.create(sessionId, {
        title: 'Projects review',
        prompt: REVIEW_PROMPT,
        cron: { expression, time_zone: localTimeZone() },
      });
      const next = created?.scheduledAt !== undefined ? new Date(created.scheduledAt).toLocaleString() : 'soon';
      return { ok: true, text: `Projects review scheduled (\`${expression}\`, ${localTimeZone()}). Next run ${next}.` };
    } catch (error) {
      return { ok: false, text: `Could not schedule the review: ${error?.message ?? String(error)}` };
    }
  }

  /**
   * Wake the current agent with the review prompt so it writes the nudge now.
   *
   * This is a direct follow-up rather than a throwaway one-shot schedule, so a
   * manual review leaves no residue in the Automation tasks catalog. The source
   * is named because `followup()` would otherwise present it as a user message.
   *
   * @param agent - the agent the command ran against.
   * @returns a human-readable outcome.
   */
  async function remindNow(agent) {
    await rebuild('remind');
    try {
      const { createUserMessage } = await import('@deepseek-ai/dsh-llm');
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: REVIEW_PROMPT }],
        source: { kind: 'projects-manager' },
      }));
      return { ok: true, text: `Review started. ${latest.attention.length} project(s) need attention.` };
    } catch (error) {
      return { ok: false, text: `Could not start the review (${error?.message ?? String(error)}). The briefing is on disk at ${BRIEF_PATH}.` };
    }
  }

  /**
   * Handle one `/projects …` invocation.
   * @param invocation - the agent and the raw text after the command name.
   * @returns a success or error result for the UI.
   */
  async function handleCommand({ agent, rawInput }) {
    const text = String(rawInput ?? '').trim();
    const [sub = 'status', ...rest] = text.length === 0 ? [] : text.split(/\s+/);
    const verb = sub.toLowerCase();
    const records = await recordsNow();

    if (verb === 'status' || verb === 'brief') {
      await rebuild('status');
      const attention = latest.attention;
      if (attention.length === 0) return { kind: 'success', text: `No project needs attention. ${latest.records.length} projects tracked.` };
      const lines = attention.slice(0, 8).map(describeState);
      return { kind: 'success', text: `${attention.length} need attention:\n${lines.join('\n')}\n\nBriefing: ${BRIEF_PATH}` };
    }

    if (verb === 'scan' || verb === 'refresh') {
      const result = await rebuild('command');
      if (result === null) return { kind: 'error', text: 'The scan failed; see the Host log.' };
      return { kind: 'success', text: `Scanned ${result.records.length} projects in ${result.summary.durationMs}ms. ${result.attention.length} need attention.` };
    }

    if (verb === 'list') {
      const wanted = (rest[0] ?? '').toLowerCase();
      const rows = wanted.length === 0 ? records : records.filter((record) => record.momentum.state === wanted);
      if (rows.length === 0) return { kind: 'success', text: `No projects in state "${wanted}".` };
      const shown = rows.slice(0, 40).map(describeState);
      return { kind: 'success', text: `${rows.length} project(s):\n${shown.join('\n')}` };
    }

    if (verb === 'snooze') {
      const name = rest[0];
      const days = Number(rest[1] ?? 14);
      if (!Number.isFinite(days) || days <= 0) return { kind: 'error', text: 'Give a snooze length in days, for example: /projects snooze ShipFit 14' };
      const found = findProject(records, name);
      if (found.error !== undefined) return { kind: 'error', text: found.error };
      await patchIntent(found.record.path, { snoozeUntil: now() + days * 86400000 });
      return { kind: 'success', text: `${found.record.name} snoozed for ${days} days.` };
    }

    if (verb === 'cadence' || verb === 'pace') {
      const name = rest[0];
      const days = Number(rest[1]);
      if (!Number.isFinite(days) || days <= 0) return { kind: 'error', text: 'Give a pace in days, for example: /projects cadence ShipFit 3' };
      const found = findProject(records, name);
      if (found.error !== undefined) return { kind: 'error', text: found.error };
      await patchIntent(found.record.path, { cadenceDays: days });
      return { kind: 'success', text: `${found.record.name} now expects movement every ${days} days.` };
    }

    if (verb === 'next') {
      const name = rest[0];
      const action = rest.slice(1).join(' ').trim();
      if (action.length === 0) return { kind: 'error', text: 'Give the next action, for example: /projects next ShipFit wire up the billing webhook' };
      const found = findProject(records, name);
      if (found.error !== undefined) return { kind: 'error', text: found.error };
      await patchIntent(found.record.path, { nextAction: action });
      return { kind: 'success', text: `${found.record.name} next action: ${action}` };
    }

    if (verb === 'resume') {
      const found = findProject(records, rest[0]);
      if (found.error !== undefined) return { kind: 'error', text: found.error };
      await patchIntent(found.record.path, { snoozeUntil: 0, ignored: false });
      return { kind: 'success', text: `${found.record.name} is back in the loop.` };
    }

    if (verb === 'ignore') {
      const found = findProject(records, rest[0]);
      if (found.error !== undefined) return { kind: 'error', text: found.error };
      await patchIntent(found.record.path, { ignored: true });
      return { kind: 'success', text: `${found.record.name} will not be reported again. Use /projects resume ${found.record.name} to undo.` };
    }

    if (verb === 'cron') {
      const expression = rest.join(' ').trim() || DEFAULT_CRON;
      const outcome = await ensureSchedule(agent.session.id, expression);
      return { kind: outcome.ok ? 'success' : 'error', text: outcome.text };
    }

    if (verb === 'remind') {
      const outcome = await remindNow(agent);
      return { kind: outcome.ok ? 'success' : 'error', text: outcome.text };
    }

    return {
      kind: 'error',
      text: [
        'Unknown subcommand. Available:',
        '  /projects                     summary of what needs attention',
        '  /projects scan                rescan the folder now',
        '  /projects list [state]        list projects, optionally by state',
        '  /projects snooze <name> [d]   hide for d days (default 14)',
        '  /projects cadence <name> <d>  set the expected pace in days',
        '  /projects next <name> <text>  record the next action',
        '  /projects resume <name>       clear snooze and ignore',
        '  /projects ignore <name>       stop reporting a project',
        `  /projects cron [expression]   set the review reminder (default "${DEFAULT_CRON}")`,
        '  /projects remind              deliver the briefing to this session now',
      ].join('\n'),
    };
  }

  ctx.effect(() => ctx.commands.register({
    name: COMMAND_NAME,
    description: COMMAND_DESCRIPTION,
    input: { hint: '[status|scan|list|snooze|cadence|next|resume|ignore|cron|remind]' },
    handler: handleCommand,
  }), 'projects-manager: /projects command');

  /* ---------------------------------------------------------------------- *
   * Model-facing tool — one schema, used by the scheduled review.
   * ---------------------------------------------------------------------- */

  /** Project states accepted by the tool's `state` filter. */
  const TOOL_STATES = ['active', 'cooling', 'stalling', 'dormant', 'never-started', 'unstarted', 'ignored'];

  ctx.effect(() => {
    // The registry accepts a definition directly: `parameters` is already the
    // wire JSON Schema and `output` wants only a schema plus a renderer. Building
    // it here instead of importing `@deepseek-ai/dsh-tools` keeps this tool free
    // of any package this bundle does not ship, so registration cannot fail on
    // module resolution.
    let disposeTool = null;
    try {
      disposeTool = ctx.tools.register({
        name: 'projects_manager',
        description: [
          'Read and maintain the projects manager: per-project momentum, the current stall briefing, stated intent, and the review reminder.',
          'Use action "brief" to see which projects are stalling and why.',
        ].join(' '),
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['brief', 'list', 'intent', 'schedule', 'rescan'], description: 'What to do.' },
            project: { type: 'string', description: 'Project name for "intent". A prefix is enough when unambiguous.' },
            state: { type: 'string', enum: TOOL_STATES, description: 'Filter for "list".' },
            nextAction: { type: 'string', description: 'For "intent": the recorded next action.' },
            cadenceDays: { type: 'number', description: 'For "intent": how many days may pass before this project counts as stalling.' },
            snoozeDays: { type: 'number', description: 'For "intent": hide the project for this many days.' },
            ignored: { type: 'boolean', description: 'For "intent": stop reporting this project entirely.' },
            cron: { type: 'string', description: `For "schedule": a five-field cron expression. Defaults to "${DEFAULT_CRON}".` },
          },
        },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        async execute(args, exec) {
            const records = await recordsNow();
            if (args.action === 'brief') {
              await rebuild('tool');
              const payload = {
                scannedAt: latest.summary?.scannedAt ?? 0,
                counts: latest.summary?.counts ?? {},
                needsAttention: latest.attention.slice(0, BRIEF_ATTENTION_LIMIT).map((record) => ({
                  name: record.name,
                  path: record.path,
                  state: record.momentum.state,
                  risk: record.momentum.score,
                  quietDays: record.momentum.quietDays,
                  cadenceDays: record.momentum.cadenceDays,
                  lastTouchSource: record.momentum.lastTouchSource,
                  reasons: record.momentum.reasons,
                  suggestions: record.momentum.suggestions,
                  nextAction: record.intent.nextAction,
                })),
              };
              return JSON.stringify(payload, null, 2);
            }

            if (args.action === 'list') {
              const rows = args.state === undefined ? records : records.filter((record) => record.momentum.state === args.state);
              return JSON.stringify(rows.map((record) => ({
                name: record.name,
                path: record.path,
                state: record.momentum.state,
                risk: record.momentum.score,
                quietDays: record.momentum.quietDays,
                cadenceDays: record.momentum.cadenceDays,
                nextAction: record.intent.nextAction,
              })), null, 2);
            }

            if (args.action === 'rescan') {
              const result = await rebuild('tool');
              return result === null ? 'The scan failed; see the Host log.' : `Scanned ${result.records.length} projects; ${result.attention.length} need attention.`;
            }

            if (args.action === 'intent') {
              const found = findProject(records, args.project);
              if (found.error !== undefined) return found.error;
              const patch = {};
              if (args.nextAction !== undefined) patch.nextAction = args.nextAction;
              if (args.cadenceDays !== undefined) patch.cadenceDays = args.cadenceDays;
              if (args.snoozeDays !== undefined) patch.snoozeUntil = now() + args.snoozeDays * 86400000;
              if (args.ignored !== undefined) patch.ignored = args.ignored;
              if (Object.keys(patch).length === 0) return 'Nothing to change: pass nextAction, cadenceDays, snoozeDays or ignored.';
              const stored = await patchIntent(found.record.path, patch);
              return `Updated ${found.record.name}: ${JSON.stringify(stored)}`;
            }

            if (args.action === 'schedule') {
              const outcome = await ensureSchedule(exec.agent.session.id, args.cron ?? DEFAULT_CRON);
              return outcome.text;
            }

            return 'Unknown action.';
          },
      });
      doctor.tool = 'ready';
      doctor.toolError = null;
      publishDoctor();
    } catch (error) {
      doctor.tool = 'unavailable';
      doctor.toolError = error?.message ?? String(error);
      publishDoctor();
      console.warn('[projects-manager] model tool unavailable:', error);
    }
    return () => {
      if (typeof disposeTool === 'function') disposeTool();
    };
  }, 'projects-manager: projects_manager tool');
}
