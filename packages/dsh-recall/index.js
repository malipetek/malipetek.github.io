/**
 * Host half of the Recall bundle.
 *
 * One thread, every project, and the memory of every conversation that came
 * before it. DSH already writes each session to disk; this plugin makes that
 * store addressable from wherever you are, so "what did we decide about the
 * admin app?" is a question one agent can answer without you reopening the
 * project, the window, or the other agent.
 *
 * Three surfaces, one index:
 *
 *   - `recall` tool — search conversations, read one back, list the portfolio,
 *     or catch up on a project (card + decisions + open work in one answer).
 *   - `/recall …` — the same without spending a model turn.
 *   - `~/.dsh/recall/index.json` — the index itself, rebuilt incrementally from
 *     session logs whose mtime moved.
 *
 * Nothing here writes to a session, a project, or another plugin's store.
 *
 * @module @malipetek/dsh-recall
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import {
  INDEX_VERSION, ago, clip, decodeSession, extract, makeEntry, projectOf, refresh, renderSession, search, termsOf,
} from './memory.mjs';

const run = promisify(execFile);

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const SESSIONS_DIR = join(DSH_HOME, 'sessions');
const CONTEXT_DIR = join(DSH_HOME, 'context');
const STATE_DIR = join(DSH_HOME, 'recall');
const INDEX_PATH = join(STATE_DIR, 'index.json');
const NEEDS_PATH = join(DSH_HOME, 'projects-manager', 'needs.json');
const INTENT_PATH = join(DSH_HOME, 'projects-manager', 'intent.json');
const WORK_DIR = join(CONTEXT_DIR, 'work');
const PROJECTS_ROOT = process.env.DSH_PROJECTS_ROOT || join(homedir(), 'Documents', 'Documents', 'Projects');

/** How many of the most recently touched sessions to index. */
const KEEP = Number(process.env.DSH_RECALL_KEEP ?? 900) || 900;
/** How long an index is trusted before a refresh looks for changed logs. */
const INDEX_TTL_MS = 5 * 60_000;
/** Parallel zstd decodes; each one is a short-lived child process. */
const DECODE_CONCURRENCY = 4;
/** Hard cap on a transcript handed to the model. */
const TRANSCRIPT_BUDGET = 18_000;

/* -------------------------------------------------------------------------- *
 * Small file helpers
 * -------------------------------------------------------------------------- */

/**
 * Read JSON, falling back when the file is missing or torn.
 * @param path - absolute path.
 * @param fallback - value to return on any failure.
 * @returns the parsed value or the fallback.
 */
async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Write atomically enough for a cache: temp file, then rename. */
async function writeJson(path, value) {
  await mkdir(STATE_DIR, { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, 'utf8');
  await writeFile(path, await readFile(temporary, 'utf8'), 'utf8');
}

/* -------------------------------------------------------------------------- *
 * Session store
 * -------------------------------------------------------------------------- */

/**
 * Every session log on disk, newest first, with the metadata the index needs to
 * decide whether it must be re-read.
 * @returns `[{ id, file, mtimeMs, size }]`.
 */
async function listSessionFiles() {
  let workspaces = [];
  try {
    workspaces = await readdir(SESSIONS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue;
    let sessions = [];
    try {
      sessions = await readdir(join(SESSIONS_DIR, workspace.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const session of sessions) {
      // Directory names are not all `session-<id>`: older and forked logs use a
      // bare UUID. The log file is the only reliable marker.
      if (!session.isDirectory()) continue;
      const file = join(SESSIONS_DIR, workspace.name, session.name, 'session.v4.jsonl.zstd');
      try {
        const info = await stat(file);
        files.push({ id: session.name, file, mtimeMs: info.mtimeMs, size: info.size });
      } catch {
        // A session directory without a log yet.
      }
    }
  }
  return files.sort((left, right) => right.mtimeMs - left.mtimeMs);
}

/** Extract one session file into an index entry. */
async function extractOne(file) {
  const text = await decodeSession(file.file);
  const extracted = extract(text);
  // The header carries the real session id; the directory name is only a hint.
  const id = typeof extracted.header?.id === 'string' && extracted.header.id.length > 0 ? extracted.header.id : file.id;
  return makeEntry({ id, file: file.file, mtimeMs: file.mtimeMs, size: file.size, extracted });
}

/** Run `worker` over `items` with a fixed number of lanes. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
  return results;
}

/* -------------------------------------------------------------------------- *
 * Shared context (cards, needs, work) — read-only
 * -------------------------------------------------------------------------- */

/** Parse the `key: value` front matter the context store writes. */
function parseFrontMatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (match === null) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const index = line.indexOf(':');
    if (index < 1) continue;
    meta[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return { meta, body: text.slice(match[0].length) };
}

/**
 * The project card for a name or path, matched the same way the delegation
 * bridge does: exact slug or name, then path prefix, then substring.
 * @param query - project name or directory.
 * @returns `{ slug, file, meta, text }` or undefined.
 */
async function findCard(query) {
  const dir = join(CONTEXT_DIR, 'projects');
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return undefined;
  }
  const wanted = String(query ?? '').trim().toLowerCase();
  const asPath = resolve(String(query ?? ''));
  const cards = [];
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const file = join(dir, name);
    try {
      const text = await readFile(file, 'utf8');
      const { meta } = parseFrontMatter(text);
      cards.push({ slug: name.slice(0, -3), file, meta, text });
    } catch {
      // Unreadable card: skip.
    }
  }
  if (wanted.length === 0) return undefined;
  /** The names a person uses that the slug does not carry. */
  const aliases = (card) => String(card.meta.aliases ?? '').split(',').map((alias) => alias.trim().toLowerCase()).filter(Boolean);
  const exact = cards.find((card) => card.slug.toLowerCase() === wanted
    || String(card.meta.name ?? '').toLowerCase() === wanted
    || aliases(card).includes(wanted));
  if (exact !== undefined) return exact;
  const byPath = cards.find((card) => {
    const path = typeof card.meta.path === 'string' ? resolve(card.meta.path) : undefined;
    return path !== undefined && (asPath === path || asPath.startsWith(path + sep) || path.startsWith(asPath + sep));
  });
  if (byPath !== undefined) return byPath;
  return cards.find((card) => card.slug.toLowerCase().includes(wanted)
    || String(card.meta.name ?? '').toLowerCase().includes(wanted)
    || aliases(card).some((alias) => alias.includes(wanted) || wanted.includes(alias)));
}

/**
 * The cockpit's view of one project's open work, if the projects manager has run.
 * @param path - project directory.
 * @returns open needs for that project.
 */
async function needsFor(path) {
  const stored = await readJson(NEEDS_PATH, { items: [] });
  const items = Array.isArray(stored?.items) ? stored.items : [];
  return items.filter((item) => item?.path === path);
}

/**
 * Delegated work recorded for a directory, newest first.
 * @param path - project directory.
 * @param days - how far back to look.
 * @returns ledger entries.
 */
async function workFor(path, days = 21) {
  let names = [];
  try {
    names = (await readdir(WORK_DIR)).filter((name) => name.endsWith('.jsonl')).sort().slice(-(days + 1));
  } catch {
    return [];
  }
  const cutoff = Date.now() - days * 86_400_000;
  const out = [];
  for (const name of names) {
    let text = '';
    try { text = await readFile(join(WORK_DIR, name), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const cwd = String(entry.cwd ?? '');
      if (!(cwd === path || cwd.startsWith(`${path}/`))) continue;
      if ((Date.parse(entry.at ?? '') || 0) < cutoff) continue;
      out.push(entry);
    }
  }
  return out.sort((left, right) => String(right.at).localeCompare(String(left.at)));
}

/* -------------------------------------------------------------------------- *
 * Index
 * -------------------------------------------------------------------------- */

/**
 * Services this plugin consumes. Without the declaration a Host hot reload can
 * re-apply Recall while `commands` or `tools` is momentarily unmounted, which
 * cordis reports as "cannot get property … without inject" and fails the row.
 */
export const inject = ['tools', 'commands'];

export function apply(ctx) {
  /** Indexed sessions, newest first. */
  let entries = [];
  /** When the on-disk index was last reconciled. */
  let reconciledAt = 0;
  /** In-flight build, so concurrent tool calls share one pass. */
  let building = null;

  /** Load the saved index once, discarding a stale shape. */
  async function loadIndex() {
    const stored = await readJson(INDEX_PATH, null);
    if (stored === null || stored.version !== INDEX_VERSION || !Array.isArray(stored.entries)) return false;
    entries = stored.entries;
    reconciledAt = Number(stored.reconciledAt ?? 0) || 0;
    return true;
  }

  /** Persist the index. */
  async function saveIndex() {
    await writeJson(INDEX_PATH, { version: INDEX_VERSION, reconciledAt, entries });
  }

  /**
   * Bring the index up to date: list the store, re-extract only the logs whose
   * mtime or size moved, drop the rest. Shares one pass across callers.
   * @param options.force - re-read even when the index is fresh.
   */
  async function ensureIndex({ force = false } = {}) {
    if (building !== null) return building;
    building = (async () => {
      if (entries.length === 0) await loadIndex();
      if (!force && entries.length > 0 && Date.now() - reconciledAt < INDEX_TTL_MS) return;
      const files = await listSessionFiles();
      const result = await refresh({
        entries,
        files,
        keep: KEEP,
        extractOne: (file) => extractOne(file),
      });
      entries = result.entries.sort((left, right) => right.lastAt - left.lastAt);
      reconciledAt = Date.now();
      await saveIndex();
      if (result.added + result.updated + result.removed > 0) {
        console.log(`[recall] index: ${entries.length} sessions (+${result.added} new, ${result.updated} changed, ${result.removed} gone)`);
      }
    })().finally(() => {
      building = null;
    });
    return building;
  }

  /** Resolve a session id (or unique prefix) to its file on disk. */
  async function findSession(id) {
    const wanted = String(id ?? '').trim();
    if (wanted.length === 0) return undefined;
    const files = await listSessionFiles();
    const hit = files.find((file) => file.id === wanted || file.id === `session-${wanted}` || file.id === wanted.replace(/^session-/, ''))
      ?? files.find((file) => file.id.includes(wanted));
    return hit;
  }

  /* ---------------------------------------------------------------------- *
   * Views
   * ---------------------------------------------------------------------- */

  /**
   * Search conversations.
   * @param args - tool arguments.
   * @returns markdown.
   */
  async function viewSearch(args) {
    await ensureIndex();
    const results = search({
      entries,
      query: String(args.query ?? ''),
      project: typeof args.project === 'string' ? args.project : undefined,
      days: Number.isFinite(args.days) ? args.days : undefined,
      limit: Math.max(1, Math.min(20, Number.isFinite(args.limit) ? args.limit : 8)),
      includeWorkers: args.includeWorkers === true,
    });
    const terms = termsOf(args.query ?? '');
    if (results.length === 0) {
      return entries.length === 0
        ? 'No conversations are indexed yet: the session store is empty or unreadable.'
        : `No conversation matches${terms.length > 0 ? ` "${terms.join(' ')}"` : ''}${args.project ? ` in ${args.project}` : ''}. Try fewer or broader words, or action "projects" to see what is indexed.`;
    }
    const lines = [`# Conversations matching ${terms.length > 0 ? `"${terms.join(' ')}"` : 'recent activity'}${args.project ? ` in ${args.project}` : ''}`, ''];
    for (const { entry, snippet } of results) {
      lines.push(`- **${entry.project || '(no project)'}** · ${ago(entry.lastAt)} · \`${entry.id}\` · ${entry.counts.turns} turn(s)`);
      lines.push(`  ${snippet}`);
    }
    lines.push('');
    lines.push('Read one with action "session" and its id, or action "catch_up" for a project.');
    return lines.join('\n');
  }

  /**
   * Read one conversation back.
   * @param args - tool arguments.
   * @returns markdown.
   */
  async function viewSession(args) {
    await ensureIndex();
    const id = String(args.session ?? '').trim();
    const indexed = entries.find((entry) => entry.id === id || entry.id === `session-${id}`) ?? entries.find((entry) => id.length >= 6 && entry.id.includes(id));
    if (indexed !== undefined) return renderSession(indexed, { maxChars: TRANSCRIPT_BUDGET });
    // Not in the retained window: decode it from disk on demand.
    const file = await findSession(id);
    if (file === undefined) return `No conversation matches "${id}". Use action "search" to find its id.`;
    const entry = await extractOne(file);
    return renderSession(entry, { maxChars: TRANSCRIPT_BUDGET });
  }

  /**
   * The portfolio: every project that has conversations, most recently active
   * first, with how long ago and how much.
   * @param args - tool arguments.
   * @returns markdown.
   */
  async function viewProjects(args) {
    await ensureIndex();
    const cutoff = Number.isFinite(args.days) && args.days > 0 ? Date.now() - args.days * 86_400_000 : 0;
    const byProject = new Map();
    let hidden = 0;
    for (const entry of entries) {
      if (cutoff > 0 && entry.lastAt < cutoff) continue;
      // Scratch runs in /tmp are noise in a portfolio: count them, do not list them.
      if ((entry.temp === true || entry.worker === true) && args.includeTemp !== true) { hidden += 1; continue; }
      const key = entry.project || '(no project)';
      const current = byProject.get(key) ?? { name: key, sessions: 0, turns: 0, lastAt: 0, cwd: entry.cwd };
      current.sessions += 1;
      current.turns += entry.counts.turns;
      current.lastAt = Math.max(current.lastAt, entry.lastAt);
      byProject.set(key, current);
    }
    const rows = [...byProject.values()].sort((left, right) => right.lastAt - left.lastAt);
    if (rows.length === 0) return 'No conversations are indexed yet.';
    const lines = [`# ${rows.length} projects with conversation history`, ''];
    for (const row of rows.slice(0, 40)) {
      lines.push(`- **${row.name}** — ${row.sessions} conversation(s), ${row.turns} turn(s), last ${ago(row.lastAt)}`);
    }
    if (hidden > 0) lines.push(`(${hidden} scratch session(s) in temporary directories hidden)`);
    lines.push('');
    lines.push('Catch up on one with action "catch_up".');
    return lines.join('\n');
  }

  /**
   * Everything needed to resume a project inside this thread: its settled facts,
   * what was recently asked and concluded, what is still open, and where it was
   * left. This is the "switch projects without switching windows" path.
   *
   * @param args - tool arguments.
   * @returns markdown.
   */
  async function viewCatchUp(args) {
    const query = String(args.project ?? '').trim();
    if (query.length === 0) return 'Give a project name: action "catch_up", project "admin-ui".';
    await ensureIndex();
    const card = await findCard(query);
    const projectPath = card?.meta?.path !== undefined ? resolve(String(card.meta.path)) : undefined;
    const name = card?.slug ?? projectOf(projectPath ?? query);

    const conversations = search({
      entries,
      query: '',
      project: projectPath ?? query,
      limit: Math.max(1, Math.min(6, Number.isFinite(args.limit) ? args.limit : 4)),
    });
    const lines = [`# Catch-up: ${name}`, ''];
    if (projectPath !== undefined) lines.push(`Path: ${projectPath}`);
    lines.push('');

    if (card !== undefined) {
      const facts = clip(card.text.split('\n').filter((line) => line.trim().length > 0).join('\n'), 2400);
      lines.push('## Settled facts (project card)', '', facts, '');
    } else {
      lines.push(`No project card matches "${query}". Record what you settle with \`remember\`.`);
      lines.push('');
    }

    // A card can point at the product brief — what we are making and what good
    // looks like. It is the one thing a newcomer cannot infer from source.
    if (card?.meta?.brief !== undefined) {
      const briefPath = card.meta.brief.startsWith('/') ? card.meta.brief : resolve(card.meta.path ?? '', card.meta.brief);
      try {
        const brief = await readFile(briefPath, 'utf8');
        lines.push('## Product brief', '', clip(brief, 6000), '', `(full text: ${briefPath})`, '');
      } catch {
        lines.push(`Product brief is missing at ${briefPath}. Write it before changing this project's UI.`, '');
      }
    }

    if (projectPath !== undefined) {
      const open = await needsFor(projectPath);
      if (open.length > 0) {
        lines.push(`## Open work (${open.length})`, '');
        for (const item of open.slice(0, 8)) {
          lines.push(`- [${String(item.kind).toUpperCase()}] ${item.label}${item.note ? ` — ${item.note}` : ''}${item.status === 'blocked' ? ' (blocked)' : ''}`);
        }
        lines.push('');
      }
      const intent = await readJson(INTENT_PATH, { items: {} });
      const stated = intent?.items?.[projectPath];
      if (stated?.nextAction !== undefined) lines.push(`Stated next action: ${stated.nextAction}`, '');
      const work = await workFor(projectPath);
      if (work.length > 0) {
        lines.push('## Recent delegated work', '');
        for (const entry of work.slice(0, 6)) {
          if (entry.phase === 'start') continue;
          lines.push(`- ${String(entry.at).slice(0, 16).replace('T', ' ')} — ${entry.status}: ${entry.label} (${entry.route})${entry.note ? ` — ${clip(entry.note, 160)}` : ''}`);
        }
        lines.push('');
      }
    }

    if (conversations.length > 0) {
      lines.push('## Recent conversations', '');
      for (const { entry, snippet } of conversations) {
        lines.push(`- **${ago(entry.lastAt)}** · \`${entry.id}\` · ${entry.counts.turns} turn(s) — ${snippet}`);
      }
      lines.push('');
      lines.push('Read any of them in full with action "session" and its id.');
    } else {
      lines.push('No conversation history for this project yet.');
    }
    return lines.join('\n');
  }

  /**
   * Run one `recall` request.
   * @param args - tool arguments.
   * @returns markdown.
   */
  async function dispatch(args) {
    const action = String(args.action ?? 'search');
    if (action === 'search' || action === 'find') return viewSearch(args);
    if (action === 'session' || action === 'read') return viewSession(args);
    if (action === 'projects' || action === 'portfolio') return viewProjects(args);
    if (action === 'catch_up' || action === 'catchup') return viewCatchUp(args);
    return 'Unknown action. Use search, session, projects or catch_up.';
  }

  /* ---------------------------------------------------------------------- *
   * Tool
   * ---------------------------------------------------------------------- */

  ctx.effect(() => {
    let dispose = null;
    try {
      dispose = ctx.tools.register({
        name: 'recall',
        description: [
          'Search and read this machine\'s past conversations, across every project, without leaving this thread.',
          'Use it before asking the user to repeat context, and when they mention a project you have not discussed yet:',
          '`catch_up` returns that project\'s settled facts, open work, recent delegated runs and the last conversations.',
          '`search` finds conversations by words; `session` reads one back in full; `projects` lists what has history.',
        ].join(' '),
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['search', 'session', 'catch_up', 'projects'], description: 'What to do.' },
            query: { type: 'string', description: 'Words to find (search). Empty means most recent.' },
            project: { type: 'string', description: 'Project name or path: for search, a filter; for catch_up, the subject.' },
            session: { type: 'string', description: 'Session id or unique prefix (session).' },
            days: { type: 'number', description: 'Only conversations touched in the last N days.' },
            includeTemp: { type: 'boolean', description: 'For projects: also list scratch sessions run in temporary directories.' },
            includeWorkers: { type: 'boolean', description: 'For search: also match delegated worker sessions (hidden by default).' },
            limit: { type: 'number', description: 'How many results (default 8; catch_up 4).' },
          },
        },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        async execute(args) {
          return dispatch(args);
        },
      });
    } catch (error) {
      console.warn('[recall] tool unavailable:', error);
    }
    return () => {
      if (typeof dispose === 'function') dispose();
    };
  }, 'recall: recall tool');

  /* ---------------------------------------------------------------------- *
   * Command
   * ---------------------------------------------------------------------- */

  const COMMAND_NAME = 'recall';
  const COMMAND_DESCRIPTION = 'Search past conversations across every project, or catch up on one project without leaving this thread.';

  /**
   * `/recall …` — no model turn, output straight into the composer.
   * @param invocation - the agent and the raw text after the command name.
   * @returns a success or error result.
   */
  async function handleCommand({ rawInput }) {
    const text = String(rawInput ?? '').trim();
    const [first = '', ...rest] = text.length === 0 ? [] : text.split(/\s+/);
    const verb = first.toLowerCase();
    try {
      if (verb === 'projects' || verb === 'portfolio') return { kind: 'success', text: await viewProjects({}) };
      if (verb === 'session' || verb === 'read') {
        if (rest[0] === undefined) return { kind: 'error', text: 'Give a session id: /recall session <id>.' };
        return { kind: 'success', text: await viewSession({ session: rest[0] }) };
      }
      if (verb === 'catch-up' || verb === 'catchup' || verb === 'catch') {
        if (rest[0] === undefined) return { kind: 'error', text: 'Give a project: /recall catch-up admin-ui.' };
        return { kind: 'success', text: await viewCatchUp({ project: rest.join(' ') }) };
      }
      if (verb === 'search') return { kind: 'success', text: await viewSearch({ query: rest.join(' ') }) };
      // A bare phrase is a search: the common case should not need a verb.
      return { kind: 'success', text: await viewSearch({ query: text }) };
    } catch (error) {
      return { kind: 'error', text: `Recall failed: ${error?.message ?? String(error)}` };
    }
  }

  ctx.effect(() => ctx.commands.register({
    name: COMMAND_NAME,
    description: COMMAND_DESCRIPTION,
    input: { hint: '[search] <words> | catch-up <project> | session <id> | projects' },
    handler: handleCommand,
  }), 'recall: /recall command');

  // Warm the index in the background so the first search is not a cold read.
  // It starts a few seconds late: a cold build decodes hundreds of logs and must
  // not compete with the window coming up. Failures are silent; the tool retries
  // on demand.
  const warm = setTimeout(() => {
    void (async () => {
      try {
        await ensureIndex();
      } catch (error) {
        console.warn('[recall] first index build failed:', error?.message ?? error);
      }
    })();
  }, 4000);
  warm.unref?.();
  ctx.effect(() => () => clearTimeout(warm), 'recall: stop the warm-up timer');
}

export { projectOf, termsOf };
