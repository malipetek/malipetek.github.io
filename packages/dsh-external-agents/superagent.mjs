/**
 * Superagent mechanics for the delegation bridge.
 *
 * The lesson taken from deepseek-ai/dsh-superagent-prototype: behaviour the
 * operator keeps repeating in chat ("work in parallel", "use the cheap model",
 * "move to Devin when quota runs out", "don't stop") belongs in the host, not in
 * prompt text that a vendor's own system prompt outranks. This module holds the
 * host side of that:
 *
 *   - routing by **tier** with an ordered fallback chain per tier, and a shared
 *     **quota ledger**: a route that answered 429/quota is cooled down and the
 *     next candidate is used, without the model having to remember a rule;
 *   - **project context**: one store under `~/.dsh/context/projects/*.md`,
 *     matched by working directory and handed to every worker, so "where does
 *     this deploy?" is answered once and never again;
 *   - a **report contract**: every worker ends with `STATUS: done|blocked|failed`,
 *     parsed into a structured result instead of guessed from prose;
 *   - a **work ledger**: one JSON line per delegation, the raw material for a
 *     "needs you" view.
 *
 * Everything here is plain files and pure functions so it can be tested without
 * a harness.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

/** Default store location. */
export const DEFAULT_CONTEXT_DIR = join(homedir(), '.dsh', 'context');

/** Tiers a caller may ask for. Order in each list is preference order. */
export const DEFAULT_ROUTES = {
  fast: ['opencode-go/deepseek-v4.1-flash', 'acp-devin/swe-2-flash-medium'],
  code: ['opencode-go/glm-5.3', 'openai-codex/gpt-6.2-sol', 'acp-devin/swe-2-high'],
  plan: ['acp-antigravity/gemini-4-argon', 'opencode-go/gemini-4-argon-contributor', 'acp-devin/gemini-4-argon-medium'],
  review: ['acp-claude/opus', 'acp-devin/claude-opus-5-5-medium'],
};

/** What a tier is for, shown to the model in the tool schema. */
export const TIER_HELP = {
  fast: 'default: search, read, small edits, checks, bulk work',
  code: 'non-trivial implementation or debugging',
  plan: 'feature planning and design',
  review: 'a high-stakes review or decision (expensive; never bulk work)',
};

/** How long a route stays cooled after a quota or rate-limit answer. */
export const DEFAULT_COOLDOWN_MS = 15 * 60_000;

const QUOTA = /\b429\b|rate[ -_]?limit|quota|too many requests|usage limit|insufficient_quota|credit balance|resource[_ ]exhausted|overloaded|\b529\b/i;
const TRANSIENT = /\b(408|500|502|503|504)\b|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|timed? ?out|network error|fetch failed/i;

/** Classify a failure text. @returns 'quota' | 'transient' | 'other'. */
export function classifyFailure(text) {
  const value = String(text ?? '');
  if (QUOTA.test(value)) return 'quota';
  if (TRANSIENT.test(value)) return 'transient';
  return 'other';
}

/** Parse "retry after 30s" / "retry-after: 120" into ms, when the failure says. */
export function retryAfterMs(text) {
  const match = /retry[- ]after[:\s]*(\d+)\s*(ms|s|sec|seconds|m|min|minutes)?/i.exec(String(text ?? ''));
  if (match === null) return undefined;
  const value = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  if (unit === 'ms') return value;
  if (unit.startsWith('m') && unit !== 'ms') return value * 60_000;
  return value * 1000;
}

/** Split "provider/model" (the model may itself contain slashes). */
export function splitRoute(route) {
  const index = String(route).indexOf('/');
  return index < 0 ? { provider: String(route), model: undefined } : { provider: route.slice(0, index), model: route.slice(index + 1) };
}

/**
 * The quota ledger: route → cooled-until timestamp, shared by every bridge in
 * the process and persisted so a restart does not forget a spent route.
 */
export class QuotaLedger {
  constructor(options = {}) {
    this.file = options.file;
    this.now = options.now ?? (() => Date.now());
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    /** @type {Map<string, {until:number, reason:string}>} */
    this.cooled = new Map();
    if (this.file !== undefined && existsSync(this.file)) {
      try {
        const saved = JSON.parse(readFileSync(this.file, 'utf8'));
        for (const [route, entry] of Object.entries(saved ?? {})) {
          if (Number.isFinite(entry?.until) && entry.until > this.now()) this.cooled.set(route, entry);
        }
      } catch {
        // A corrupt ledger only loses cooldowns; routing still works.
      }
    }
  }

  isCooled(route) {
    const entry = this.cooled.get(route);
    if (entry === undefined) return false;
    if (entry.until <= this.now()) {
      this.cooled.delete(route);
      return false;
    }
    return true;
  }

  cool(route, reason, ms) {
    const until = this.now() + (Number.isFinite(ms) && ms > 0 ? ms : this.cooldownMs);
    this.cooled.set(route, { until, reason: String(reason ?? '').slice(0, 200) });
    this.#save();
    return until;
  }

  /** Routes cooled right now, for the tool to report. */
  snapshot() {
    const out = {};
    for (const [route, entry] of this.cooled) {
      if (entry.until > this.now()) out[route] = { minutesLeft: Math.ceil((entry.until - this.now()) / 60_000), reason: entry.reason };
    }
    return out;
  }

  #save() {
    if (this.file === undefined) return;
    try {
      mkdirSync(join(this.file, '..'), { recursive: true });
      writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.cooled), null, 2));
    } catch {
      // Best effort.
    }
  }
}

/**
 * The ordered list of routes to try for one task.
 *
 * An explicit provider (and model) wins and is tried alone first; the tier's
 * chain follows as fallback for quota failures only. Cooled routes are moved to
 * the end rather than dropped, so a task still runs when everything is cooled.
 */
export function candidateRoutes({ tier, provider, model, routes = DEFAULT_ROUTES, defaultTier = 'fast', ledger }) {
  const chain = [...(routes[tier] ?? routes[defaultTier] ?? [])];
  const explicit = typeof provider === 'string' && provider.length > 0
    ? [`${provider}${typeof model === 'string' && model.length > 0 ? `/${model}` : ''}`]
    : [];
  const ordered = [...explicit, ...chain.filter((route) => !explicit.includes(route))];
  if (ledger === undefined) return ordered;
  return [...ordered.filter((route) => !ledger.isCooled(route)), ...ordered.filter((route) => ledger.isCooled(route))];
}

// ---------------------------------------------------------------------------
// Project context
// ---------------------------------------------------------------------------

/** Parse the tiny front matter we write: `key: value` lines between `---`. */
export function parseFrontMatter(text) {
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

/** Every project card in the store. */
export function listProjects(contextDir = DEFAULT_CONTEXT_DIR) {
  const dir = join(contextDir, 'projects');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const file = join(dir, name);
    try {
      const text = readFileSync(file, 'utf8');
      const { meta, body } = parseFrontMatter(text);
      out.push({ slug: name.slice(0, -3), file, meta, body, text });
    } catch {
      // Skip unreadable cards.
    }
  }
  return out;
}

/**
 * The names a person actually uses for a project: the card's `aliases` front
 * matter, comma-separated. "ptechsolutions admin" has to reach the project whose
 * slug is "ptechsolutions-site", or every session starts by guessing.
 * @param card - a project card.
 * @returns lower-cased aliases.
 */
export function aliasesOf(card) {
  return String(card?.meta?.aliases ?? '')
    .split(',')
    .map((alias) => alias.trim().toLowerCase())
    .filter((alias) => alias.length > 0);
}

/**
 * The project a directory belongs to: the card whose `path` is the longest
 * prefix of `cwd`, or whose slug/name/alias equals `query`.
 */
export function findProject({ cwd, query } = {}, contextDir = DEFAULT_CONTEXT_DIR) {
  const projects = listProjects(contextDir);
  if (typeof query === 'string' && query.trim().length > 0) {
    const wanted = query.trim().toLowerCase();
    const byName = projects.find((p) => p.slug.toLowerCase() === wanted
      || String(p.meta.name ?? '').toLowerCase() === wanted
      || aliasesOf(p).includes(wanted));
    if (byName !== undefined) return byName;
    const asPath = resolve(query);
    const byPath = findProject({ cwd: asPath }, contextDir);
    if (byPath !== undefined) return byPath;
    // An alias that contains the words, or that the words contain ("the ptech
    // admin app" → "ptech admin"), still resolves before giving up.
    return projects.find((p) => p.slug.toLowerCase().includes(wanted)
      || String(p.meta.name ?? '').toLowerCase().includes(wanted)
      || aliasesOf(p).some((alias) => alias.includes(wanted) || wanted.includes(alias)));
  }
  if (typeof cwd !== 'string' || cwd.length === 0) return undefined;
  const target = resolve(cwd);
  let best;
  for (const project of projects) {
    const path = project.meta.path === undefined ? undefined : resolve(project.meta.path);
    if (path === undefined) continue;
    if (target === path || target.startsWith(path + sep)) {
      if (best === undefined || path.length > resolve(best.meta.path).length) best = project;
    }
  }
  return best;
}

/** Append one fact under the card's `## Facts` section (created when missing). */
export function rememberFact({ project, fact, source }, contextDir = DEFAULT_CONTEXT_DIR) {
  const card = findProject({ query: project }, contextDir);
  if (card === undefined) throw new Error(`no project card matches "${project}"; known: ${listProjects(contextDir).map((p) => p.slug).join(', ') || '(none)'}`);
  const line = `- ${String(fact).trim().replace(/\n+/g, ' ')}${source ? ` _(${source}, ${new Date().toISOString().slice(0, 10)})_` : ''}`;
  let text = card.text;
  if (/^## Facts\s*$/m.test(text)) {
    text = text.replace(/^## Facts\s*\n/m, (header) => `${header}${line}\n`);
  } else {
    text = `${text.trimEnd()}\n\n## Facts\n${line}\n`;
  }
  writeFileSync(card.file, text);
  return { slug: card.slug, line };
}

/** The block prepended to a worker's task for its project. */
export function contextBlock(card, maxChars = 6000) {
  if (card === undefined) return '';
  const text = card.text.length > maxChars ? `${card.text.slice(0, maxChars)}\n…(truncated; read ${card.file})` : card.text;
  return `## Project context (shared store: ${card.file})\nThese are settled facts about this project. Use them; do not ask the user for them again.\n\n${text.trim()}\n`;
}

// ---------------------------------------------------------------------------
// Report contract
// ---------------------------------------------------------------------------

export const REPORT_CONTRACT = [
  '## How to finish',
  'Work until the task is done and verified, or until you are truly blocked. Do not stop to list next steps you could take yourself.',
  'Do not delegate further: you are the worker.',
  'End your final message with exactly one line:',
  '`STATUS: done` — finished and verified (say how you verified it);',
  '`STATUS: blocked — <the one thing a person must decide or provide>`;',
  '`STATUS: failed — <why>`.',
  'If you learned a durable fact about the project (deploy target, credentials location, build command, gotcha), add a line `FACT: <fact>` before the status.',
].join('\n');

/** Pull STATUS and FACT lines out of a worker's answer. */
export function parseReport(text) {
  const value = String(text ?? '');
  const matches = [...value.matchAll(/^\s*\**`?STATUS:?\s*(done|blocked|failed|ready|question)\b`?\**\s*(?:[—:-]+\s*(.*))?$/gim)];
  const last = matches.at(-1);
  const facts = [...value.matchAll(/^\s*FACT:\s*(.+)$/gim)].map((m) => m[1].trim());
  if (last === undefined) return { status: 'unreported', note: '', facts };
  let status = last[1].toLowerCase();
  if (status === 'ready') status = 'done';
  if (status === 'question') status = 'blocked';
  return { status, note: (last[2] ?? '').trim(), facts };
}

// ---------------------------------------------------------------------------
// Work ledger
// ---------------------------------------------------------------------------

/** Append one record to today's ledger file. */
export function recordWork(entry, contextDir = DEFAULT_CONTEXT_DIR) {
  try {
    const dir = join(contextDir, 'work');
    mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    appendFileSync(join(dir, `${day}.jsonl`), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch {
    // The ledger is a record, never a reason to fail the work.
  }
}

/** Ledger entries of the last `days` days, newest first. */
export function readWork({ days = 7 } = {}, contextDir = DEFAULT_CONTEXT_DIR) {
  const dir = join(contextDir, 'work');
  if (!existsSync(dir)) return [];
  const cutoff = Date.now() - days * 86_400_000;
  const out = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort().reverse()) {
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      if (line.trim().length === 0) continue;
      try {
        const entry = JSON.parse(line);
        if (Date.parse(entry.at) >= cutoff) out.push(entry);
      } catch {
        // skip
      }
    }
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** A short human label for a directory. */
export function dirLabel(cwd) {
  return typeof cwd === 'string' && cwd.length > 0 ? basename(cwd) : '';
}
