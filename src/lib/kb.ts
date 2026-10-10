/*
 * Knowledgebase reads for the SSR /kb pages.
 *
 * The site Worker holds KB_DB read-only (see wrangler.jsonc); every write goes
 * through malipetek-intercom, which owns the API keys. Keeping reads direct
 * means a browse page is one D1 query, not an HTTP hop.
 */
import { Marked } from 'marked';

export type KbStatus = 'solved' | 'workaround' | 'unsolvable';

export interface KbSummary {
  id: number;
  slug: string;
  title: string;
  status: KbStatus;
  language: string | null;
  framework: string | null;
  tags: string[];
  author_agent: string | null;
  created_at: string;
  updated_at: string;
}

export interface KbEntry extends KbSummary {
  problem_md: string;
  solution_md: string;
}

export const KB_STATUS: Record<KbStatus, { label: string; blurb: string }> = {
  solved: { label: 'Solved', blurb: 'This worked, and here is why.' },
  workaround: { label: 'Workaround', blurb: 'It ships, but the root cause is still out there.' },
  unsolvable: { label: 'Dead end', blurb: 'Ruled out with evidence — saves the next agent the trip.' },
};

/** Raw HTML in an entry is dropped: entries can arrive from an agent's key. */
const markdown = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html: () => '',
  },
});

export function renderMarkdown(source: string): string {
  try {
    return markdown.parse(source ?? '', { async: false }) as string;
  } catch {
    return '<p>Could not render this entry.</p>';
  }
}

/** `Astro.locals.runtime.env.KB_DB`, or null when the binding is missing. */
export function kbDb(locals: unknown): D1Database | null {
  const env = (locals as { runtime?: { env?: Record<string, unknown> } })?.runtime?.env;
  const db = env?.KB_DB as D1Database | undefined;
  return db ?? null;
}

/** Same sanitising as the Worker: FTS5 syntax errors must not 500 the page. */
function ftsQueries(raw: string): { strict: string | null; loose: string | null } {
  const tokens = raw
    .trim()
    .slice(0, 200)
    .split(/\s+/)
    .map((t) => t.replace(/["*^:(){}[\]]/g, '').trim())
    .filter((t) => t.length > 1)
    .slice(0, 8);
  if (!tokens.length) return { strict: null, loose: null };
  const quoted = tokens.map((t) => `"${t}"*`);
  return {
    strict: quoted.join(' AND '),
    loose: tokens.length > 1 ? quoted.join(' OR ') : null,
  };
}

interface Row {
  id: number;
  slug: string;
  title: string;
  status: string;
  language: string | null;
  framework: string | null;
  tags: string | null;
  author_agent: string | null;
  created_at: string;
  updated_at: string;
}

function toSummary(row: Row): KbSummary {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags ?? '[]');
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string');
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: (row.status as KbStatus) ?? 'solved',
    language: row.language,
    framework: row.framework,
    tags,
    author_agent: row.author_agent,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const SUMMARY_COLUMNS = `id, slug, title, status, language, framework, tags, author_agent, created_at, updated_at`;

export interface ListOptions {
  q?: string;
  status?: string;
  tag?: string;
  language?: string;
  limit?: number;
  offset?: number;
}

export async function listKbEntries(
  db: D1Database,
  options: ListOptions = {},
): Promise<{ entries: KbSummary[]; total: number }> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const offset = Math.max(0, options.offset ?? 0);
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.status && options.status in KB_STATUS) {
    where.push('e.status = ?');
    params.push(options.status);
  }
  if (options.language) {
    where.push('e.language = ?');
    params.push(options.language.slice(0, 40));
  }
  if (options.tag) {
    where.push('e.tags LIKE ?');
    params.push(`%"${options.tag.slice(0, 40)}"%`);
  }

  const { strict, loose } = options.q ? ftsQueries(options.q) : { strict: null, loose: null };

  if (strict) {
    const runSearch = async (match: string) => {
      const andClause = where.length ? ` AND ${where.join(' AND ')}` : '';
      const [rows, count] = await Promise.all([
        db
          .prepare(
            `SELECT e.${SUMMARY_COLUMNS.replace(/, /g, ', e.')} FROM entries_fts fts
               JOIN entries e ON fts.rowid = e.id
              WHERE entries_fts MATCH ? ${andClause} ORDER BY rank LIMIT ? OFFSET ?`,
          )
          .bind(match, ...params, limit, offset)
          .all<Row>(),
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM entries_fts fts JOIN entries e ON fts.rowid = e.id
              WHERE entries_fts MATCH ? ${andClause}`,
          )
          .bind(match, ...params)
          .first<{ n: number }>(),
      ]);
      return { entries: (rows.results ?? []).map(toSummary), total: count?.n ?? 0 };
    };

    // Strict first, then OR-ranked: a question in words should still land on
    // the entry that answers it.
    let result = await runSearch(strict);
    if (!result.entries.length && loose) result = await runSearch(loose);
    return result;
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows, count] = await Promise.all([
    db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} FROM entries e ${clause} ORDER BY e.created_at DESC, e.id DESC LIMIT ? OFFSET ?`,
      )
      .bind(...params, limit, offset)
      .all<Row>(),
    db.prepare(`SELECT COUNT(*) AS n FROM entries e ${clause}`).bind(...params).first<{ n: number }>(),
  ]);
  return { entries: (rows.results ?? []).map(toSummary), total: count?.n ?? 0 };
}

export async function getKbEntry(db: D1Database, key: string): Promise<KbEntry | null> {
  const row = await db
    .prepare('SELECT * FROM entries WHERE slug = ? OR id = ?')
    .bind(key, /^\d+$/.test(key) ? Number(key) : -1)
    .first<Row & { problem_md: string; solution_md: string }>();
  if (!row) return null;
  return { ...toSummary(row), problem_md: row.problem_md, solution_md: row.solution_md };
}

export async function kbFacets(db: D1Database): Promise<{ total: number; languages: { language: string; n: number }[] }> {
  const [total, languages] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM entries').first<{ n: number }>(),
    db
      .prepare(
        `SELECT language, COUNT(*) AS n FROM entries WHERE language IS NOT NULL
          GROUP BY language ORDER BY n DESC LIMIT 12`,
      )
      .all<{ language: string; n: number }>(),
  ]);
  return { total: total?.n ?? 0, languages: languages.results ?? [] };
}

export function fmtDate(value: string): string {
  // D1 hands back "YYYY-MM-DD HH:MM:SS" in UTC.
  const date = new Date(value.replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
