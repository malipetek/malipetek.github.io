/**
 * Conversation memory for one thread.
 *
 * DeepSeek Harness already keeps every conversation it has ever run, per working
 * directory, as zstd-compressed JSONL. That record is the answer to "what did we
 * decide in the other conversation?" — but only if something can read it without
 * opening that session, in that project, in that window.
 *
 * This module turns the store into a small searchable index:
 *
 *   - **extract** one session into what matters (what the person asked, what the
 *     agent concluded, which tools ran), dropping transport noise;
 *   - **index** those summaries incrementally, so a search over hundreds of
 *     conversations does not re-read hundreds of megabytes;
 *   - **search** by words, project or recency;
 *   - **render** one conversation back into a compact transcript.
 *
 * Everything here is a pure function over text except {@link decodeSession},
 * which shells out to `zstd` because Node's zstd decoder stops after the first
 * frame and DSH writes several.
 *
 * @module @malipetek/dsh-recall/memory
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Bump when the entry shape changes; a stale index is rebuilt, not reused. */
export const INDEX_VERSION = 4;

/** Words too common to discriminate between conversations. */
const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'had', 'was', 'were', 'are', 'you', 'your',
  'can', 'could', 'would', 'should', 'will', 'what', 'when', 'where', 'which', 'who', 'how', 'why', 'not', 'but',
  'all', 'any', 'one', 'two', 'our', 'out', 'use', 'using', 'used', 'get', 'got', 'let', 'lets', 'now', 'just',
  'into', 'than', 'then', 'them', 'they', 'there', 'here', 'his', 'her', 'its', 'it', 'is', 'be', 'been', 'being',
  'do', 'does', 'did', 'done', 'make', 'made', 'want', 'need', 'please', 'also', 'about', 'like', 'some', 'more',
  'still', 'very', 'much', 'only', 'over', 'under', 'after', 'before', 'again', 'okay', 'ok', 'yes', 'sure',
]);

/** Harness runtime snapshots arrive as user messages; they are not conversation. */
const RUNTIME_MARKERS = [
  /current runtime context/i,
  /this snapshot supersedes/i,
  /time sampled while preparing turn/i,
  /elapsed since the preceding/i,
];

/** Drop a trailing runtime snapshot from a human turn. */
export function stripRuntime(text) {
  let end = text.length;
  for (const pattern of RUNTIME_MARKERS) {
    const match = pattern.exec(text);
    if (match === null) continue;
    if (match.index === 0) return '';
    end = Math.min(end, match.index);
  }
  return text.slice(0, end).trim();
}

/** Drop `<system-reminder>` blocks the harness rides along inside a human turn. */
export function stripSystemReminder(text) {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

/** Collapse whitespace and cut to a budget. */
export function clip(text, limit) {
  const clean = String(text ?? '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit)}…`;
}

/** Text of a harness content value (a string, or blocks). */
export function blockText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

/**
 * Read one session log through the zstd CLI.
 *
 * Node's own zstd decoder returns only the first frame, which for a DSH session
 * is the one-record header, so `zstd -dc` is not an optimisation here — it is
 * the only correct decoder available without a native dependency.
 *
 * @param file - absolute path to `session.v4.jsonl.zstd`.
 * @returns the decompressed JSONL text.
 */
export async function decodeSession(file) {
  const { stdout } = await run('zstd', ['-dc', '--quiet', file], { maxBuffer: 1024 * 1024 * 1024, encoding: 'buffer' });
  return stdout.toString('utf8');
}

/**
 * Extract the parts of a session a successor needs.
 *
 * Kept shapes: what the person asked (their own turns only, never the harness's
 * injected runtime notes), what the agent said, which tools ran. Everything else
 * — provider streams, usage, patches — is noise at this altitude.
 *
 * @param rawText - decompressed JSONL.
 * @param options.turnLimit - human turns kept (first 8 and the last ones).
 * @param options.saidLimit - assistant messages kept.
 * @returns `{ header, turns, said, tools, commands, counts }`.
 */
export function extract(rawText, { turnLimit = 40, saidLimit = 30 } = {}) {
  const lines = String(rawText ?? '').split('\n');
  const header = {};
  const turns = [];
  const said = [];
  const tools = new Set();
  const commands = [];
  let records = 0;
  let lastAt = 0;

  for (const line of lines) {
    if (line.length === 0) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    records += 1;
    if (record.type === 'session') {
      Object.assign(header, record, { type: undefined });
      continue;
    }
    if (typeof record.at === 'number' && record.at > lastAt) lastAt = record.at;
    if (typeof record.at === 'string') {
      const parsed = Date.parse(record.at);
      if (Number.isFinite(parsed) && parsed > lastAt) lastAt = parsed;
    }

    if (record.type === 'user/message') {
      const kind = record.data?.source?.kind ?? 'user';
      if (kind !== 'user' && kind !== 'model-selection') continue;
      const text = stripRuntime(blockText(record.data?.content ?? record.content));
      const spoken = stripSystemReminder(text);
      if (spoken.length < 2) continue;
      turns.push({ at: typeof record.at === 'number' ? record.at : 0, text: clip(spoken, 700), kind });
      continue;
    }

    if (record.type === 'assistant/message') {
      const content = record.data?.message?.content ?? record.data?.content;
      const text = blockText(content).trim();
      if (text.length === 0) continue;
      said.push({ at: typeof record.at === 'number' ? record.at : 0, text: clip(text, 420) });
      continue;
    }

    if (record.type === 'tool/call') {
      const name = record.data?.name ?? record.data?.tool;
      if (typeof name === 'string') tools.add(name);
      continue;
    }

    if (record.type === 'command/run') {
      const name = record.data?.name ?? record.data?.command;
      if (typeof name === 'string' && name.length > 0) commands.push(name);
    }
  }

  // Keep the opening turns (what was asked for) and the closing ones (where it
  // ended), which is what a successor needs; the middle is usually iteration.
  const keptTurns = turns.length <= turnLimit ? turns : [...turns.slice(0, 8), ...turns.slice(-(turnLimit - 8))];
  const keptSaid = said.length <= saidLimit ? said : [...said.slice(0, 6), ...said.slice(-(saidLimit - 6))];

  return {
    header,
    turns: keptTurns,
    said: keptSaid,
    tools: [...tools],
    commands,
    counts: { records, turns: turns.length, said: said.length, tools: tools.size },
    lastAt,
  };
}

/** Directories whose sessions are scratch runs, not project work. */
function tempRoots() {
  return [process.env.TMPDIR, '/tmp', '/private/tmp', '/var/folders'].filter((root) => typeof root === 'string' && root.length > 0);
}

/** Is this working directory a temporary one? */
export function isTempCwd(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return false;
  const clean = cwd.replace(/\/+$/, '');
  return tempRoots().some((root) => clean === root.replace(/\/+$/, '') || clean.startsWith(`${root.replace(/\/+$/, '')}/`));
}

/** The project a working directory belongs to: its basename, or '' for home. */
export function projectOf(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return '';
  const home = process.env.HOME ?? '';
  const clean = cwd.replace(/\/+$/, '');
  if (clean === home) return 'home';
  return clean.split('/').pop() ?? '';
}

/**
 * One index entry: enough to search and to show a snippet, small enough that a
 * thousand of them fit in memory.
 *
 * @param options.id - session id.
 * @param options.file - session log path.
 * @param options.mtimeMs - log modification time.
 * @param options.size - log size.
 * @param options.extracted - output of {@link extract}.
 * @returns the entry.
 */
export function makeEntry({ id, file, mtimeMs, size, extracted }) {
  const header = extracted.header ?? {};
  const cwd = typeof header.cwd === 'string' ? header.cwd : '';
  return {
    id,
    file,
    mtimeMs,
    size,
    cwd,
    project: projectOf(cwd),
    temp: isTempCwd(cwd),
    // A delegated worker's session is a transcript of one job, not a
    // conversation; the work ledger is where those belong.
    worker: header.origin === 'subagent' || (Number(header.delegationDepth ?? 0) || 0) > 0,
    parent: typeof header.parentSession === 'string' ? header.parentSession : '',
    createdAt: Number(header.createdAt ?? 0) || mtimeMs,
    lastAt: extracted.lastAt || mtimeMs,
    preset: typeof header.agentPreset === 'string' ? header.agentPreset : '',
    depth: Number(header.delegationDepth ?? 0) || 0,
    title: extracted.turns[0]?.text.slice(0, 160) ?? '',
    turns: extracted.turns.map((turn) => turn.text),
    said: extracted.said.map((message) => message.text),
    tools: extracted.tools.slice(0, 40),
    commands: [...new Set(extracted.commands)].slice(0, 20),
    counts: extracted.counts,
  };
}

/** Split text into search terms, dropping stop words and one-character tokens. */
export function termsOf(query) {
  const seen = new Set();
  for (const raw of String(query ?? '').toLowerCase().split(/[^a-z0-9_.\-/]+/)) {
    const term = raw.replace(/^[.\-/]+|[.\-/]+$/g, '');
    if (term.length < 2 || STOP.has(term)) continue;
    seen.add(term);
  }
  return [...seen];
}

/** Does `haystack` contain `term` (word-prefix match keeps it cheap and useful)? */
function has(haystack, term) {
  if (haystack.includes(term)) return true;
  return false;
}

/**
 * Score one session against search terms.
 *
 * What the person asked weighs most: if they said it, that conversation is the
 * one about it. The agent's answers and the tools weigh less, the project name
 * and path in between, and recency breaks ties rather than deciding them.
 *
 * @param entry - an index entry.
 * @param terms - terms from {@link termsOf}.
 * @param now - epoch ms.
 * @returns a score; 0 means no term matched.
 */
export function scoreEntry(entry, terms, now = Date.now()) {
  if (terms.length === 0) {
    const ageDays = Math.max(0, (now - entry.lastAt) / 86_400_000);
    return Math.max(1, 30 - ageDays) / 30;
  }
  const turns = (entry.turns ?? []).join('\n').toLowerCase();
  const said = (entry.said ?? []).join('\n').toLowerCase();
  const meta = `${entry.project ?? ''}\n${entry.cwd ?? ''}\n${entry.title ?? ''}\n${(entry.tools ?? []).join(' ')}`.toLowerCase();
  let score = 0;
  let matched = 0;
  for (const term of terms) {
    let hit = false;
    if (has(turns, term)) { score += 6; hit = true; }
    if (has(meta, term)) { score += 3; hit = true; }
    if (has(said, term)) { score += 2; hit = true; }
    if (has(String(entry.project ?? '').toLowerCase(), term)) score += 4;
    if (hit) matched += 1;
  }
  if (score === 0) return 0;
  // A conversation that matches every word of the question beats one that shares
  // a single common word with it.
  const coverage = matched / terms.length;
  // Recency is a nudge, never a substitute for a match.
  const ageDays = Math.max(0, (now - entry.lastAt) / 86_400_000);
  return score * (0.4 + 0.6 * coverage) * (1 + Math.max(0, 30 - ageDays) / 90);
}

/** The line that best shows why a session matched. */
export function snippetOf(entry, terms, limit = 220) {
  const lines = [...(entry.turns ?? []), ...(entry.said ?? [])];
  for (const term of terms) {
    const hit = lines.find((line) => line.toLowerCase().includes(term));
    if (hit !== undefined) return clip(hit.replace(/\s+/g, ' '), limit);
  }
  return clip((entry.turns?.[0] ?? entry.title ?? '').replace(/\s+/g, ' '), limit);
}

/**
 * Search the index.
 * @param options.entries - indexed sessions.
 * @param options.query - words to look for; empty means "most recent".
 * @param options.project - restrict to one project (name prefix or path).
 * @param options.days - restrict to sessions touched in the last N days.
 * @param options.limit - at most this many results.
 * @param options.now - epoch ms.
 * @returns results, best first, each with its snippet.
 */
export function search({ entries = [], query = '', project, days, limit = 8, includeWorkers = false, now = Date.now() }) {
  const terms = termsOf(query);
  const wanted = typeof project === 'string' && project.trim().length > 0 ? project.trim().toLowerCase() : undefined;
  const cutoff = Number.isFinite(days) && days > 0 ? now - days * 86_400_000 : 0;
  const results = [];
  for (const entry of entries) {
    if (cutoff > 0 && entry.lastAt < cutoff) continue;
    if (entry.worker === true && includeWorkers !== true) continue;
    if (wanted !== undefined) {
      const projectName = String(entry.project ?? '').toLowerCase();
      const cwd = String(entry.cwd ?? '').toLowerCase();
      if (!projectName.startsWith(wanted) && !cwd.includes(wanted)) continue;
    }
    const score = scoreEntry(entry, terms, now);
    if (score <= 0) continue;
    results.push({ entry, score, snippet: snippetOf(entry, terms) });
  }
  results.sort((left, right) => right.score - left.score || right.entry.lastAt - left.entry.lastAt);
  return results.slice(0, limit);
}

/** Human phrase for how long ago an instant was. */
export function ago(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'unknown';
  const minutes = Math.round((now - timestamp) / 60_000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
}

/**
 * Render one indexed session as a compact transcript.
 * @param entry - the index entry.
 * @param options.maxChars - output budget.
 * @param options.now - epoch ms.
 * @returns markdown.
 */
export function renderSession(entry, { maxChars = 16_000, now = Date.now() } = {}) {
  const lines = [];
  lines.push(`## Conversation ${entry.id}`);
  lines.push('');
  lines.push(`- Project: ${entry.project || '(none)'} — ${entry.cwd || 'unknown directory'}`);
  lines.push(`- Last activity: ${ago(entry.lastAt, now)} (${new Date(entry.lastAt).toISOString().slice(0, 16).replace('T', ' ')})`);
  lines.push(`- ${entry.counts?.turns ?? entry.turns.length} human turn(s), ${entry.counts?.said ?? entry.said.length} agent message(s)${entry.tools.length > 0 ? `, tools: ${entry.tools.slice(0, 12).join(', ')}` : ''}`);
  lines.push('');
  const body = [];
  const turnCount = entry.turns.length;
  const saidCount = entry.said.length;
  // Interleave by position: turns first, then what the agent concluded, since
  // the index keeps them as two streams rather than a merged timeline.
  for (let index = 0; index < Math.max(turnCount, saidCount); index += 1) {
    if (index < turnCount) body.push(`### ${index + 1}. User\n\n${entry.turns[index]}\n`);
    if (index < saidCount) body.push(`**Agent.**\n\n${entry.said[index]}\n`);
  }
  let text = body.join('\n');
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…(truncated; ${text.length - maxChars} chars left out)`;
  lines.push(text);
  return lines.join('\n');
}

/**
 * Apply one directory scan to the index: keep entries whose file is unchanged,
 * re-extract the others, drop what disappeared.
 *
 * @param options.entries - current entries.
 * @param options.files - `[{ id, file, mtimeMs, size }]` found on disk now.
 * @param options.extractOne - async `(file) => entry` for a changed file.
 * @param options.keep - how many of the most recently touched sessions to index.
 * @returns `{ entries, added, updated, removed }`.
 */
export async function refresh({ entries = [], files = [], extractOne, keep = 400 }) {
  const byFile = new Map(entries.map((entry) => [entry.file, entry]));
  const wanted = [...files].sort((left, right) => right.mtimeMs - left.mtimeMs).slice(0, keep);
  const next = [];
  let added = 0;
  let updated = 0;
  let removed = 0;
  let skipped = 0;
  const kept = new Set();

  for (const file of wanted) {
    kept.add(file.file);
    const previous = byFile.get(file.file);
    if (previous !== undefined && previous.mtimeMs === file.mtimeMs && previous.size === file.size) {
      next.push(previous);
      continue;
    }
    try {
      const entry = await extractOne(file);
      // A log with nothing said and nothing asked is not a conversation worth
      // recalling — aborted runs, empty files and tool-only sessions all land
      // here. Indexing them would bury the real ones.
      if ((entry.counts?.turns ?? 0) === 0 && (entry.counts?.said ?? 0) === 0) {
        skipped += 1;
        continue;
      }
      next.push(entry);
      if (previous === undefined) added += 1;
      else updated += 1;
    } catch {
      // A session being written right now can fail to decode; keep the old copy.
      if (previous !== undefined) next.push(previous);
    }
  }

  for (const file of byFile.keys()) if (!kept.has(file)) removed += 1;
  return { entries: next, added, updated, removed, skipped };
}
