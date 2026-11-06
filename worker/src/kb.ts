/*
 * Agentic Coding Knowledgebase — the public, agent-readable half of the site.
 *
 *   GET    /kb/entries[?q=&status=&language=&tag=&page=&limit=]   public
 *   GET    /kb/entries/:idOrSlug                                  public
 *   GET    /kb/stats                                              public
 *   POST   /kb/entries                                            author
 *   PATCH  /kb/entries/:id                                        author
 *   GET    /kb/keys                                               admin
 *   POST   /kb/keys                                               admin
 *   DELETE /kb/keys/:id                                           admin
 *   POST   /kb-mcp                                                MCP, knowledgebase (streamable HTTP)
 *
 * The MCP section also builds the portal's MCP surface (`/mcp`), so the two
 * stay one transport implementation. See `makeMcp` below.
 *
 * Reads are fully public — the whole point is that other people's agents can
 * pull from it. Writes need either an API key minted by the admin (`ack_…`)
 * or the admin's own portal session. There is deliberately no self-serve key
 * route: anyone can read, only we author.
 *
 * The MCP endpoints speak the streamable-HTTP transport (protocol 2025-06-18)
 * so ChatGPT apps and other MCP clients can mount the same tools a REST client
 * gets. `/mcp` is the client portal app (contracting only); `/kb-mcp` is this
 * knowledgebase, published at https://lab.malipetek.dev. They share one
 * implementation (`makeMcp`) but never advertise each other's tools.
 */
import { Hono } from 'hono';
import { clientIp, isRateLimited, type Env, type HonoEnv } from './shared.ts';
import { agentUser, now, sessionUser } from './portal.ts';
import { CLIENT_TOOLS, CLIENT_TOOL_NAMES, OWNER_TOOLS, OWNER_TOOL_NAMES, callClientTool } from './clientTools.ts';
import { reviewEstimate } from '../../src/lib/pricing.js';
import { cardStrings } from '../../src/i18n/eager.js';
import { closestLocale } from '../../src/lib/locales.js';
import { BOARD_HTML, BOARD_MIME, BOARD_UI_URI, boardSummary, type Board } from './boardUi.ts';

/* ——————————————————————— shapes ——————————————————————— */

const STATUSES = ['solved', 'workaround', 'unsolvable'] as const;
type KbStatus = (typeof STATUSES)[number];

const MAX_TITLE = 200;
const MAX_MD = 20_000;
const MAX_TAGS = 12;
const MAX_TAG_CHARS = 40;
const MAX_AGENT = 80;
const MAX_SEARCH_CHARS = 200;
const WRITE_LIMIT = 60; // per key/ip per window
const WRITE_WINDOW_SECONDS = 60 * 60;

interface EntryRow {
  id: number;
  slug: string;
  title: string;
  problem_md: string;
  solution_md: string;
  status: string;
  language: string | null;
  framework: string | null;
  tags: string | null;
  author_agent: string | null;
  author_key_id: number | null;
  created_at: string;
  updated_at: string;
}

/* ——————————————————————— helpers ——————————————————————— */

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function kbJson(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      ...extra,
    },
  });
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().slice(0, MAX_TAG_CHARS))
    .filter(Boolean)
    .slice(0, MAX_TAGS);
}

function tagsOf(row: EntryRow): string[] {
  try {
    const parsed = JSON.parse(row.tags ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/** List shape: no bodies, so a browse page stays small. */
function listShape(row: EntryRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    language: row.language,
    framework: row.framework,
    tags: tagsOf(row),
    author_agent: row.author_agent,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function fullShape(row: EntryRow) {
  return { ...listShape(row), problem_md: row.problem_md, solution_md: row.solution_md };
}

const LIST_COLUMNS = `id, slug, title, status, language, framework, tags, author_agent, created_at, updated_at`;

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 80) || 'entry'
  );
}

/**
 * Turn a human query into safe FTS5 syntax. Raw input like `foo OR bar"` is a
 * syntax error in FTS5, which would 500 a public endpoint, so each token is
 * quoted and prefix-matched.
 *
 * Two forms come out of it. `strict` ANDs the tokens — precise, but a
 * natural-language question ("fts5 search breaking on user input") matches
 * nothing because one word is absent. `loose` ORs them, and FTS5's bm25 `rank`
 * already floats the entries that match most terms to the top. Callers try
 * strict, then fall back to loose, which is the difference between an agent
 * being told "no entry exists" and finding the one that does.
 */
function ftsQueries(raw: string): { strict: string | null; loose: string | null } {
  const tokens = raw
    .trim()
    .slice(0, MAX_SEARCH_CHARS)
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

function ftsQuery(raw: string): string | null {
  return ftsQueries(raw).strict;
}

/* ——————————————————————— auth ——————————————————————— */

type Author = { kind: 'key'; id: number; agent: string } | { kind: 'admin' };

/** A KB API key, or the admin's portal session. Nothing else may write. */
async function authorFrom(c: { req: { header: (n: string) => string | undefined }; env: Env }): Promise<Author | null> {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || token.length > 200) return null;

  if (token.startsWith('ack_')) {
    const row = await c.env.KB_DB.prepare(
      `SELECT id, agent_name FROM api_keys WHERE key_hash = ? AND revoked = 0`,
    )
      .bind(await sha256Hex(token))
      .first<{ id: number; agent_name: string }>();
    return row ? { kind: 'key', id: row.id, agent: row.agent_name } : null;
  }

  const user = await sessionUser(c.env, token);
  return user?.role === 'admin' ? { kind: 'admin' } : null;
}

async function touchKey(env: Env, id: number): Promise<void> {
  try {
    await env.KB_DB.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`).bind(id).run();
  } catch {
    /* last-used is a nicety; never fail a write over it */
  }
}

/* ——————————————————————— REST ——————————————————————— */

export const kb = new Hono<HonoEnv>();

kb.options('/*', (c) =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-max-age': '86400',
    },
  }),
);

kb.get('/entries', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const status = c.req.query('status');
  const language = c.req.query('language');
  const tag = c.req.query('tag');
  const page = Math.max(1, Number(c.req.query('page') ?? 1) || 1);
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? 20) || 20));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: unknown[] = [];
  if (status && STATUSES.includes(status as KbStatus)) {
    where.push('e.status = ?');
    params.push(status);
  }
  if (language) {
    where.push('e.language = ?');
    params.push(language.slice(0, 40));
  }
  if (tag) {
    where.push('e.tags LIKE ?');
    params.push(`%"${tag.slice(0, MAX_TAG_CHARS)}"%`);
  }

  const { strict, loose } = q ? ftsQueries(q) : { strict: null, loose: null };

  if (strict) {
    const andClause = where.length ? ` AND ${where.join(' AND ')}` : '';
    const runSearch = async (match: string) => {
      const [rows, count] = await Promise.all([
        c.env.KB_DB.prepare(
          `SELECT e.${LIST_COLUMNS.replace(/, /g, ', e.')}, rank
             FROM entries_fts fts JOIN entries e ON fts.rowid = e.id
            WHERE entries_fts MATCH ?${andClause}
            ORDER BY rank LIMIT ? OFFSET ?`,
        )
          .bind(match, ...params, limit, offset)
          .all<EntryRow>(),
        c.env.KB_DB.prepare(
          `SELECT COUNT(*) AS n FROM entries_fts fts JOIN entries e ON fts.rowid = e.id
            WHERE entries_fts MATCH ?${andClause}`,
        )
          .bind(match, ...params)
          .first<{ n: number }>(),
      ]);
      return { rows: rows.results ?? [], total: count?.n ?? 0 };
    };

    let result = await runSearch(strict);
    // A question phrased in words misses on AND; OR still ranks the best entry
    // first via bm25, which beats telling the caller nothing exists.
    if (!result.rows.length && loose) result = await runSearch(loose);

    return kbJson({
      entries: result.rows.map(listShape),
      query: q || null,
      pagination: { page, limit, total: result.total },
    });
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows, count] = await Promise.all([
    c.env.KB_DB.prepare(
      `SELECT ${LIST_COLUMNS} FROM entries e ${clause}
        ORDER BY e.created_at DESC, e.id DESC LIMIT ? OFFSET ?`,
    )
      .bind(...params, limit, offset)
      .all<EntryRow>(),
    c.env.KB_DB.prepare(`SELECT COUNT(*) AS n FROM entries e ${clause}`)
      .bind(...params)
      .first<{ n: number }>(),
  ]);

  return kbJson({
    entries: (rows.results ?? []).map(listShape),
    query: q || null,
    pagination: { page, limit, total: count?.n ?? 0 },
  });
});

kb.get('/stats', async (c) => {
  const [total, byStatus, langs] = await Promise.all([
    c.env.KB_DB.prepare('SELECT COUNT(*) AS n FROM entries').first<{ n: number }>(),
    c.env.KB_DB.prepare('SELECT status, COUNT(*) AS n FROM entries GROUP BY status').all<{ status: string; n: number }>(),
    c.env.KB_DB.prepare(
      `SELECT language, COUNT(*) AS n FROM entries WHERE language IS NOT NULL GROUP BY language ORDER BY n DESC LIMIT 12`,
    ).all<{ language: string; n: number }>(),
  ]);
  return kbJson({
    total: total?.n ?? 0,
    by_status: Object.fromEntries((byStatus.results ?? []).map((r) => [r.status, r.n])),
    languages: langs.results ?? [],
  });
});

kb.get('/entries/:idOrSlug', async (c) => {
  const key = c.req.param('idOrSlug').slice(0, 120);
  const row = await c.env.KB_DB.prepare(`SELECT * FROM entries WHERE slug = ? OR id = ?`)
    .bind(key, /^\d+$/.test(key) ? Number(key) : -1)
    .first<EntryRow>();
  if (!row) return kbJson({ error: 'not_found' }, 404);
  return kbJson(fullShape(row));
});

kb.post('/entries', async (c) => {
  const author = await authorFrom(c);
  if (!author) return kbJson({ error: 'unauthorized' }, 401);
  if (await isRateLimited(c.env, author.kind === 'key' ? `key:${author.id}` : clientIp(c.req.raw), 'kb-write', WRITE_LIMIT, WRITE_WINDOW_SECONDS)) {
    return kbJson({ error: 'rate_limited' }, 429);
  }

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return kbJson({ error: 'bad_json' }, 400);

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE) : '';
  const problem = typeof body.problem === 'string' ? body.problem.trim().slice(0, MAX_MD) : '';
  const solution = typeof body.solution === 'string' ? body.solution.trim().slice(0, MAX_MD) : '';
  const status = typeof body.status === 'string' ? body.status : '';
  const language = typeof body.language === 'string' ? body.language.trim().slice(0, 40) || null : null;
  const framework = typeof body.framework === 'string' ? body.framework.trim().slice(0, 40) || null : null;
  const authorAgent = typeof body.author_agent === 'string' ? body.author_agent.trim().slice(0, MAX_AGENT) : '';

  if (!title || !problem || !solution) return kbJson({ error: 'missing_fields' }, 400);
  if (!STATUSES.includes(status as KbStatus)) return kbJson({ error: 'bad_status' }, 400);
  if (!authorAgent) return kbJson({ error: 'missing_author_agent' }, 400);

  // Slugs are URLs: keep them unique by suffixing rather than failing.
  const base = slugify(title);
  let slug = base;
  for (let i = 2; i < 50; i += 1) {
    const clash = await c.env.KB_DB.prepare('SELECT 1 AS x FROM entries WHERE slug = ?').bind(slug).first();
    if (!clash) break;
    slug = `${base}-${i}`;
  }

  const keyId = author.kind === 'key' ? author.id : null;
  const result = await c.env.KB_DB.prepare(
    `INSERT INTO entries (title, slug, problem_md, solution_md, status, language, framework, tags, author_agent, author_key_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(title, slug, problem, solution, status, language, framework, JSON.stringify(parseTags(body.tags)), authorAgent, keyId)
    .run();

  if (!result.success) return kbJson({ error: 'insert_failed' }, 500);
  if (author.kind === 'key') c.executionCtx.waitUntil(touchKey(c.env, author.id));

  const row = await c.env.KB_DB.prepare('SELECT * FROM entries WHERE id = ?')
    .bind(result.meta.last_row_id)
    .first<EntryRow>();
  return kbJson(row ? fullShape(row) : { error: 'insert_failed' }, 201);
});

kb.patch('/entries/:id', async (c) => {
  const author = await authorFrom(c);
  if (!author) return kbJson({ error: 'unauthorized' }, 401);

  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return kbJson({ error: 'not_found' }, 404);

  const existing = await c.env.KB_DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<EntryRow>();
  if (!existing) return kbJson({ error: 'not_found' }, 404);
  // A key may only edit what it wrote; the admin may edit anything.
  if (author.kind === 'key' && existing.author_key_id !== author.id) {
    return kbJson({ error: 'forbidden' }, 403);
  }

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return kbJson({ error: 'bad_json' }, 400);

  const updates: string[] = [];
  const params: unknown[] = [];
  const setText = (column: string, value: unknown, max: number) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    updates.push(`${column} = ?`);
    params.push(trimmed.slice(0, max));
  };

  setText('title', body.title, MAX_TITLE);
  setText('problem_md', body.problem, MAX_MD);
  setText('solution_md', body.solution, MAX_MD);
  setText('language', body.language, 40);
  setText('framework', body.framework, 40);
  setText('author_agent', body.author_agent, MAX_AGENT);
  if (typeof body.status === 'string') {
    if (!STATUSES.includes(body.status as KbStatus)) return kbJson({ error: 'bad_status' }, 400);
    updates.push('status = ?');
    params.push(body.status);
  }
  if (body.tags !== undefined) {
    updates.push('tags = ?');
    params.push(JSON.stringify(parseTags(body.tags)));
  }

  if (!updates.length) return kbJson({ error: 'no_fields' }, 400);

  updates.push(`updated_at = datetime('now')`);
  params.push(id);
  await c.env.KB_DB.prepare(`UPDATE entries SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
  if (author.kind === 'key') c.executionCtx.waitUntil(touchKey(c.env, author.id));

  const row = await c.env.KB_DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<EntryRow>();
  return kbJson(row ? fullShape(row) : { error: 'not_found' }, 200);
});

/* ————— key management: admin only, which is what "only we author" means ————— */

kb.get('/keys', async (c) => {
  const author = await authorFrom(c);
  if (!author) return kbJson({ error: 'unauthorized' }, 401);
  if (author.kind !== 'admin') return kbJson({ error: 'forbidden' }, 403);
  const rows = await c.env.KB_DB.prepare(
    `SELECT k.id, k.agent_name, k.created_at, k.last_used_at, k.revoked,
            (SELECT COUNT(*) FROM entries e WHERE e.author_key_id = k.id) AS entries
       FROM api_keys k ORDER BY k.created_at DESC LIMIT 100`,
  ).all();
  return kbJson({ keys: rows.results ?? [] });
});

kb.post('/keys', async (c) => {
  const author = await authorFrom(c);
  if (!author) return kbJson({ error: 'unauthorized' }, 401);
  if (author.kind !== 'admin') return kbJson({ error: 'forbidden' }, 403);

  const body = (await c.req.json().catch(() => null)) as { agent_name?: unknown; user_id?: unknown } | null;
  const agentName = typeof body?.agent_name === 'string' ? body.agent_name.trim().slice(0, MAX_AGENT) : '';
  if (!agentName) return kbJson({ error: 'missing_agent_name' }, 400);

  // api_keys.user_id is NOT NULL in the original schema; attribute admin-minted
  // keys to the first owner row rather than inventing a parallel table.
  const owner = await c.env.KB_DB.prepare('SELECT id FROM users ORDER BY id LIMIT 1').first<{ id: number }>();
  const key = `ack_${crypto.randomUUID().replace(/-/g, '')}`;
  const result = await c.env.KB_DB.prepare(
    `INSERT INTO api_keys (user_id, agent_name, key_hash) VALUES (?, ?, ?)`,
  )
    .bind(owner?.id ?? 1, agentName, await sha256Hex(key))
    .run();

  if (!result.success) return kbJson({ error: 'insert_failed' }, 500);
  // Shown exactly once — only the SHA-256 lands in D1.
  return kbJson({ key, id: result.meta.last_row_id, agent_name: agentName }, 201);
});

kb.delete('/keys/:id', async (c) => {
  const author = await authorFrom(c);
  if (!author) return kbJson({ error: 'unauthorized' }, 401);
  if (author.kind !== 'admin') return kbJson({ error: 'forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return kbJson({ error: 'not_found' }, 404);
  await c.env.KB_DB.prepare('UPDATE api_keys SET revoked = 1 WHERE id = ?').bind(id).run();
  return kbJson({ ok: true });
});

/* ——————————————————————— MCP ——————————————————————— */

const MCP_PROTOCOL = '2025-06-18';
const MCP_SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
/*
 * One MCP server used to mix two products: the client portal for vibe
 * contracting and the public agentic-coding knowledgebase. Assistants
 * connecting to it could not tell which tools were which, so the surfaces are
 * split. `/mcp` is the published portal app; `/kb-mcp` is the knowledgebase and
 * lives at https://lab.malipetek.dev (the site proxies it here).
 *
 * Browser origins that may call either endpoint. Server-side clients send
 * none. ChatGPT's own pages are listed because its connector setup may check
 * from the browser, and lab.malipetek.dev is where the KB server is read from.
 */
const ALLOWED_MCP_ORIGINS = [
  'https://malipetek.dev',
  'https://www.malipetek.dev',
  'https://lab.malipetek.dev',
  'http://localhost:4321',
  'https://chatgpt.com',
  'https://chat.openai.com',
  'https://platform.openai.com',
];

const KB_TOOLS = [
  {
    name: 'search_knowledge',
    title: 'Search the agentic coding knowledgebase',
    description:
      'Full-text search over malipetek lab’s entry knowledgebase. Every entry is a problem/solution pair from a real agentic coding session. Public — no key needed.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms, e.g. "wrangler d1 migration"' },
        status: { type: 'string', enum: STATUSES, description: 'solved | workaround | unsolvable' },
        tag: { type: 'string', description: 'Single tag filter' },
        language: { type: 'string', description: 'Programming language filter' },
        limit: { type: 'number', description: 'Max results (1-50, default 10)' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_knowledge',
    title: 'Read one knowledgebase entry',
    description: 'Fetch a single entry — full problem and solution markdown — by id or slug.',
    inputSchema: {
      type: 'object',
      properties: { id_or_slug: { type: 'string', description: 'Entry id or slug' } },
      required: ['id_or_slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_knowledge',
    title: 'List recent knowledgebase entries',
    description: 'Newest entries first, without bodies. Useful to see what the knowledgebase covers.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max results (1-50, default 10)' } },
      additionalProperties: false,
    },
  },
  {
    name: 'create_knowledge',
    title: 'Write a knowledgebase entry',
    description:
      'Record a problem/solution pair from an agentic session. Requires an ack_ API key in the Authorization header; keys are issued by the site owner only.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short, specific title' },
        problem: { type: 'string', description: 'What went wrong, in markdown' },
        solution: { type: 'string', description: 'What actually fixed it, in markdown' },
        status: { type: 'string', enum: STATUSES },
        language: { type: 'string' },
        framework: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        author_agent: { type: 'string', description: 'Name of the agent recording this' },
      },
      required: ['title', 'problem', 'solution', 'status', 'author_agent'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_knowledge',
    title: 'Update a knowledgebase entry',
    description: 'Patch an entry you authored. Requires an ack_ API key; the owner can patch any entry.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        title: { type: 'string' },
        problem: { type: 'string' },
        solution: { type: 'string' },
        status: { type: 'string', enum: STATUSES },
        language: { type: 'string' },
        framework: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

/**
 * Tool annotations are what let a connector show "this only reads" versus
 * "this changes production". They are derived centrally so a new tool cannot
 * forget them: anything not named as a writer is treated as read-only.
 */
const READ_ONLY_TOOLS = new Set(['search_knowledge', 'get_knowledge', 'list_knowledge']);
const DESTRUCTIVE_TOOLS = new Set(['update_knowledge', 'portal_withdraw', 'submit_change', 'site_publish', 'site_rollback']);

const annotate = (tool: { name: string; title: string }, readOnly: boolean, destructive: boolean) => ({
  title: tool.title,
  readOnlyHint: readOnly,
  destructiveHint: destructive,
  idempotentHint: readOnly,
  openWorldHint: true,
});

/**
 * Per-tool auth policy. ChatGPT shows its linking UI only when a tool declares
 * `oauth2` *and* the server hands back a `mcp/www_authenticate` challenge at
 * runtime — see `authChallenge`. `_meta.securitySchemes` mirrors it for clients
 * that only read `_meta`. The knowledgebase server declares no auth at all:
 * reads are public and writes carry an ack_ key the owner issued.
 */
type Scheme = { type: 'noauth' } | { type: 'oauth2'; scopes: string[] };
const OPEN: Scheme[] = [{ type: 'noauth' }];
const SIGNED_IN: Scheme[] = [{ type: 'oauth2', scopes: ['portal'] }];

const withAuth = <T extends object>(tool: T, schemes: Scheme[]) => ({
  ...tool,
  securitySchemes: schemes,
  _meta: {
    ...((tool as { _meta?: Record<string, unknown> })._meta ?? {}),
    securitySchemes: schemes,
  },
});

/** The knowledgebase tools, annotated once and handed out per surface. */
const KB_ANNOTATED = KB_TOOLS.map((tool) =>
  withAuth({ ...tool, annotations: annotate(tool, READ_ONLY_TOOLS.has(tool.name), DESTRUCTIVE_TOOLS.has(tool.name)) }, OPEN),
);
const KB_READ_TOOLS = KB_ANNOTATED.filter((tool) => READ_ONLY_TOOLS.has(tool.name));

const PORTAL_TOOLS = CLIENT_TOOLS.map(({ readOnly, ...tool }) =>
  withAuth({ ...tool, annotations: annotate(tool, readOnly, DESTRUCTIVE_TOOLS.has(tool.name)) }, SIGNED_IN),
);
const ADMIN_TOOLS = OWNER_TOOLS.map(({ readOnly, ...tool }) =>
  withAuth({ ...tool, annotations: annotate(tool, readOnly, DESTRUCTIVE_TOOLS.has(tool.name)) }, OPEN),
);

export type McpSurface = 'portal' | 'kb';

/**
 * What a surface advertises. The split is the whole point: `/mcp` is the
 * published client portal app and must not look like a knowledgebase, while
 * `/kb-mcp` is the public knowledgebase and must not offer portal tools.
 * Knowledgebase writes need an owner-issued ack_ key (or the admin session),
 * so they are listed only when `authorFrom` resolved one.
 */
function toolsFor(surface: McpSurface, author: Author | null) {
  if (surface === 'portal') return author?.kind === 'admin' ? [...PORTAL_TOOLS, ...ADMIN_TOOLS] : PORTAL_TOOLS;
  return author ? KB_ANNOTATED : KB_READ_TOOLS;
}

/**
 * What a `tools/call` may still reach. On the portal that is the advertised
 * tools plus every knowledgebase tool: connectors set up before the split hold
 * owner-issued ack_ keys and keep working even though the KB is no longer
 * listed there. Nothing else becomes callable — an unknown name stays unknown.
 */
function callableToolsFor(surface: McpSurface, author: Author | null) {
  const listed = toolsFor(surface, author);
  return surface === 'portal' ? [...listed, ...KB_ANNOTATED] : listed;
}

const RESOURCE_PAGE = 50;

/** The portal's one UI resource: the "malipetek development" card. */
function boardResource() {
  return {
    uri: BOARD_UI_URI,
    name: 'malipetek development',
    title: 'malipetek development',
    description:
      'The client’s requests on malipetek.dev: status, project, cost so far, and a link into the portal.',
    mimeType: BOARD_MIME,
  };
}

/** Every entry is also an MCP resource, so a client can attach it as context. */
function entryResource(row: EntryRow) {
  const bits = [row.status, row.language, row.framework].filter(Boolean).join(' · ');
  return {
    uri: `kb://entry/${row.slug}`,
    name: row.title,
    title: row.title,
    description: bits,
    mimeType: 'text/markdown',
  };
}

function entryMarkdown(row: EntryRow): string {
  const tags = tagsOf(row)
    .map((t) => `#${t}`)
    .join(' ');
  return [
    `# ${row.title}`,
    '',
    `Status: **${row.status}**${row.language ? ` · Language: ${row.language}` : ''}${
      row.framework ? ` · Framework: ${row.framework}` : ''
    }`,
    tags ? `Tags: ${tags}` : '',
    '',
    '## Problem',
    '',
    row.problem_md,
    '',
    row.status === 'unsolvable' ? '## Why it cannot be solved' : '## Solution',
    '',
    row.solution_md,
    '',
    `Source: https://malipetek.dev/kb/${row.slug}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

const MCP_PROMPTS = [
  {
    name: 'record_learning',
    title: 'Record what this session taught you',
    description:
      'Turn the session that just finished into a knowledgebase entry: one problem, one resolution, and the status that tells the next agent whether to trust it.',
    arguments: [
      { name: 'topic', description: 'What the session was about.', required: true },
      { name: 'outcome', description: 'What fixed it, or why it cannot be fixed.', required: true },
    ],
  },
];

/** The portal app: contracting only, with both ways to get work done. */
const PORTAL_INSTRUCTIONS =
  'malipetek.dev is a vibe contracting service: AI agents build and change clients’ websites, and Ali Petek (a human developer) signs off on the work.\n\n' +
  'With a connected client account there are two ways to get work done:\n' +
  '1. You make the change yourself (start_change → workspace_files/workspace_read → submit_change → preview_build → finish_change). You are the client’s own assistant on their own subscription, so this costs nothing on malipetek: no AI cost and no approval to wait for. You may change anything in their site, and say so plainly. Every change is recorded as its own request with who made it. Changes go to the preview, never straight to production. When the preview has it, show the link and ask whether to send it to Ali for review. Either way the client can take the preview live with site_publish; that is their decision and it is recorded as theirs, so confirm first and say when it includes unreviewed changes. Ali is emailed about every change, every review choice and every publish. ' +
  reviewEstimate() +
  '\n2. The client asks Ali’s team to do it (portal_file_request): Ali reads and approves the request before anything starts, then an agent does the work. That is billed as his time plus the AI run at cost.\n\n' +
  'Notifications go by email to the client’s account address: Ali’s replies, approvals, status changes and finished work all arrive in their inbox, and replying to that email answers in the request’s thread. The portal (https://malipetek.dev/portal) shows the same. The "malipetek development" card (portal_board) shows their projects, sites and requests.';

/** The knowledgebase server: the public half, with no client work in it. */
const KB_INSTRUCTIONS =
  'This is the public agentic coding knowledgebase of malipetek lab: real problems from agentic coding sessions, each one a problem/solution pair. ' +
  'Every entry has a status — solved (the fix works), workaround (it ships, the root cause stands) or unsolvable (the session proved it cannot be fixed, and the evidence is the useful part). ' +
  'Search before writing: search_knowledge finds entries by words, get_knowledge reads one in full, list_knowledge shows the newest. ' +
  'If an entry already covers it, update that one instead of filing a duplicate. ' +
  'Writing needs an ack_ API key issued by the site owner, sent in the Authorization header: create_knowledge files a new entry, update_knowledge patches one you wrote. ' +
  'For website work done for you, the contracting service is a separate server: https://malipetek.dev/mcp.';

const PORTAL_SERVER_INFO = {
  name: 'malipetek-dev',
  title: 'malipetek.dev client portal',
  version: '1.2.0',
  icons: [
    { src: 'https://malipetek.dev/plugin-glyph.svg', mimeType: 'image/svg+xml', sizes: ['any'] },
    { src: 'https://malipetek.dev/plugin-glyph.png', mimeType: 'image/png', sizes: ['256x256'] },
  ],
};

const KB_SERVER_INFO = {
  name: 'malipetek-lab-kb',
  title: 'malipetek lab: agentic coding knowledgebase',
  version: '1.0.0',
};

interface Rpc {
  jsonrpc?: string;
  method?: string;
  params?: Record<string, unknown>;
  id?: string | number | null;
}

function rpcResult(id: Rpc['id'], result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id: Rpc['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function toolText(value: unknown, isError = false) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * Tools that carry a UI resource. The model still gets a short text result —
 * the same data as `structuredContent`, written for reading — so hosts without
 * MCP Apps support lose nothing but the card.
 */
const UI_TOOLS: Record<string, (value: unknown) => string> = {
  portal_board: (value) => boardSummary(value as Board),
};

/**
 * The other half of the OAuth contract (see `SIGNED_IN` in the tool table): a
 * tool result carrying `mcp/www_authenticate` is what makes ChatGPT open its
 * linking UI. Without this the server looks anonymous no matter what the
 * metadata says, and the connection never shows as authenticated.
 */
function authChallenge(env: Env) {
  const site = String(env.SITE_URL ?? 'https://malipetek.dev').replace(/\/+$/, '');
  return {
    content: [
      {
        type: 'text',
        text: 'Authentication required: sign in with your malipetek.dev account to use this tool.',
      },
    ],
    isError: true,
    _meta: {
      'mcp/www_authenticate': [
        `Bearer resource_metadata="${site}/.well-known/oauth-protected-resource", error="invalid_token", error_description="No valid malipetek.dev access token. Sign in to continue."`,
      ],
    },
  };
}

/**
 * Claude (claude.ai, Desktop, mobile, Cowork, Claude Code). Its hosted apps
 * call from Anthropic's published outbound range, 160.79.104.0/21; Claude
 * Code runs on the user's machine and names itself in its user agent.
 */
export function fromClaude(ip: string, userAgent: string): boolean {
  const m = /^160\.79\.(\d{1,3})\.\d{1,3}$/.exec(ip.trim());
  if (m && Number(m[1]) >= 104 && Number(m[1]) <= 111) return true;
  return /\bclaude\b/i.test(userAgent);
}

/**
 * Claude's half of the same contract. Claude starts sign-in only when the HTTP
 * request itself fails with 401 and a WWW-Authenticate header (its "lazy
 * authentication"); the 200 tool result above, which ChatGPT needs, reaches
 * Claude as an ordinary tool error and no Connect card. After sign-in Claude
 * retries the same call with the new token.
 */
function claudeChallenge(env: Env) {
  const site = String(env.SITE_URL ?? 'https://malipetek.dev').replace(/\/+$/, '');
  const description = 'Sign in with your malipetek.dev account to use this tool.';
  return new Response(JSON.stringify({ error: 'invalid_token', error_description: description }), {
    status: 401,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'www-authenticate': `Bearer error="invalid_token", error_description="${description}", resource_metadata="${site}/.well-known/oauth-protected-resource/mcp", scope="portal"`,
      'access-control-expose-headers': 'www-authenticate, mcp-session-id, mcp-protocol-version',
    },
  });
}

/** Reuse the REST list logic so MCP and HTTP can never drift apart. */
async function searchEntries(env: Env, args: Record<string, unknown>) {
  const query = typeof args.query === 'string' ? args.query : '';
  const limit = Math.min(50, Math.max(1, Number(args.limit) || 10));
  const { strict, loose } = ftsQueries(query);
  const where: string[] = [];
  const params: unknown[] = [];
  if (typeof args.status === 'string' && STATUSES.includes(args.status as KbStatus)) {
    where.push('e.status = ?');
    params.push(args.status);
  }
  if (typeof args.tag === 'string' && args.tag.trim()) {
    where.push('e.tags LIKE ?');
    params.push(`%"${args.tag.trim().slice(0, MAX_TAG_CHARS)}"%`);
  }
  if (typeof args.language === 'string' && args.language.trim()) {
    where.push('e.language = ?');
    params.push(args.language.trim().slice(0, 40));
  }
  const clause = where.length ? ` AND ${where.join(' AND ')}` : '';

  if (strict) {
    const runSearch = async (match: string) => {
      const rows = await env.KB_DB.prepare(
        `SELECT e.${LIST_COLUMNS.replace(/, /g, ', e.')} FROM entries_fts fts JOIN entries e ON fts.rowid = e.id
          WHERE entries_fts MATCH ?${clause} ORDER BY rank LIMIT ?`,
      )
        .bind(match, ...params, limit)
        .all<EntryRow>();
      return (rows.results ?? []).map(listShape);
    };

    const hits = await runSearch(strict);
    // Same reasoning as the REST endpoint: an agent that phrases a question in
    // words should still find the entry, so retry with OR before reporting
    // "no entry exists".
    if (!hits.length && loose) return runSearch(loose);
    return hits;
  }

  const andClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await env.KB_DB.prepare(
    `SELECT ${LIST_COLUMNS} FROM entries e ${andClause} ORDER BY e.created_at DESC, e.id DESC LIMIT ?`,
  )
    .bind(...params, limit)
    .all<EntryRow>();
  return (rows.results ?? []).map(listShape);
}

async function callTool(env: Env, name: string, args: Record<string, unknown>, author: Author | null) {
  switch (name) {
    case 'search_knowledge': {
      const entries = await searchEntries(env, args);
      return { entries, count: entries.length };
    }
    case 'list_knowledge': {
      const entries = await searchEntries(env, { limit: args.limit ?? 10 });
      return { entries, count: entries.length };
    }
    case 'get_knowledge': {
      const key = String(args.id_or_slug ?? '').slice(0, 120);
      const row = await env.KB_DB.prepare('SELECT * FROM entries WHERE slug = ? OR id = ?')
        .bind(key, /^\d+$/.test(key) ? Number(key) : -1)
        .first<EntryRow>();
      if (!row) throw new Error(`No entry matching "${key}"`);
      return fullShape(row);
    }
    case 'create_knowledge': {
      if (!author) throw new Error('create_knowledge needs an ack_ API key in the Authorization header.');
      if (await isRateLimited(env, author.kind === 'key' ? `key:${author.id}` : 'admin', 'kb-write', WRITE_LIMIT, WRITE_WINDOW_SECONDS)) {
        throw new Error('Rate limited. Try again later.');
      }
      const title = String(args.title ?? '').trim().slice(0, MAX_TITLE);
      const problem = String(args.problem ?? '').trim().slice(0, MAX_MD);
      const solution = String(args.solution ?? '').trim().slice(0, MAX_MD);
      const status = String(args.status ?? '');
      const authorAgent = String(args.author_agent ?? '').trim().slice(0, MAX_AGENT);
      if (!title || !problem || !solution) throw new Error('title, problem and solution are required.');
      if (!STATUSES.includes(status as KbStatus)) throw new Error(`status must be one of ${STATUSES.join(', ')}.`);
      if (!authorAgent) throw new Error('author_agent is required.');

      const base = slugify(title);
      let slug = base;
      for (let i = 2; i < 50; i += 1) {
        const clash = await env.KB_DB.prepare('SELECT 1 AS x FROM entries WHERE slug = ?').bind(slug).first();
        if (!clash) break;
        slug = `${base}-${i}`;
      }
      const keyId = author.kind === 'key' ? author.id : null;
      const inserted = await env.KB_DB.prepare(
        `INSERT INTO entries (title, slug, problem_md, solution_md, status, language, framework, tags, author_agent, author_key_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          title,
          slug,
          problem,
          solution,
          status,
          typeof args.language === 'string' ? args.language.trim().slice(0, 40) || null : null,
          typeof args.framework === 'string' ? args.framework.trim().slice(0, 40) || null : null,
          JSON.stringify(parseTags(args.tags)),
          authorAgent,
          keyId,
        )
        .run();
      if (author.kind === 'key') await touchKey(env, author.id);
      const row = await env.KB_DB.prepare('SELECT * FROM entries WHERE id = ?')
        .bind(inserted.meta.last_row_id)
        .first<EntryRow>();
      return { created: true, url: `https://malipetek.dev/kb/${row?.slug ?? slug}`, entry: row ? fullShape(row) : null };
    }
    case 'update_knowledge': {
      if (!author) throw new Error('update_knowledge needs an ack_ API key in the Authorization header.');
      const id = Number(args.id);
      if (!Number.isInteger(id) || id <= 0) throw new Error('id must be a positive integer.');
      const existing = await env.KB_DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<EntryRow>();
      if (!existing) throw new Error(`No entry with id ${id}.`);
      if (author.kind === 'key' && existing.author_key_id !== author.id) {
        throw new Error('That entry was written by a different key.');
      }

      const updates: string[] = [];
      const params: unknown[] = [];
      const setText = (column: string, value: unknown, max: number) => {
        if (typeof value !== 'string') return;
        if (!value.trim()) return;
        updates.push(`${column} = ?`);
        params.push(value.trim().slice(0, max));
      };
      setText('title', args.title, MAX_TITLE);
      setText('problem_md', args.problem, MAX_MD);
      setText('solution_md', args.solution, MAX_MD);
      setText('language', args.language, 40);
      setText('framework', args.framework, 40);
      if (typeof args.status === 'string') {
        if (!STATUSES.includes(args.status as KbStatus)) throw new Error(`status must be one of ${STATUSES.join(', ')}.`);
        updates.push('status = ?');
        params.push(args.status);
      }
      if (args.tags !== undefined) {
        updates.push('tags = ?');
        params.push(JSON.stringify(parseTags(args.tags)));
      }
      if (!updates.length) throw new Error('Nothing to update.');
      updates.push(`updated_at = datetime('now')`);
      params.push(id);
      await env.KB_DB.prepare(`UPDATE entries SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
      if (author.kind === 'key') await touchKey(env, author.id);
      const row = await env.KB_DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<EntryRow>();
      return { updated: true, url: `https://malipetek.dev/kb/${row?.slug ?? existing.slug}`, entry: row ? fullShape(row) : null };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * One request handler, two surfaces. The transport is identical; only what is
 * advertised, the instructions and the auth challenges differ, so a new MCP
 * method is implemented once rather than copied per endpoint.
 */
export function makeMcp(surface: McpSurface) {
  const portalSurface = surface === 'portal';
  const app = new Hono<HonoEnv>();

  app.options('/*', (c) => {
    const origin = c.req.header('Origin') ?? '';
    return new Response(null, {
      status: 204,
      headers: {
        ...(ALLOWED_MCP_ORIGINS.includes(origin) ? { 'access-control-allow-origin': origin } : {}),
        'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization, mcp-session-id, mcp-protocol-version',
        'access-control-expose-headers': 'mcp-session-id',
        'access-control-max-age': '86400',
      },
    });
  });

  /**
   * DNS-rebinding guard from the MCP spec: a browser page on an unknown origin
   * must not be able to drive a local/remote MCP server. Requests with no
   * Origin (server-to-server: ChatGPT, Claude, curl) pass.
   */
  const originAllowed = (c: { req: { header: (n: string) => string | undefined } }): boolean => {
    const origin = c.req.header('Origin');
    return !origin || ALLOWED_MCP_ORIGINS.includes(origin);
  };

  app.get('/', (c) => {
    // No unsolicited server→client stream; advertise the tool list instead so a
    // human poking the URL in a browser sees something useful. The anonymous
    // view is the honest one: who is asking decides whether writes appear.
    return kbJson({
      name: portalSurface ? 'malipetek.dev client portal' : 'malipetek lab: agentic coding knowledgebase',
      protocol: MCP_PROTOCOL,
      transport: 'streamable-http',
      endpoint: portalSurface ? '/mcp' : '/kb-mcp',
      tools: toolsFor(surface, null).map((t) => t.name),
    });
  });

  app.delete('/', () => new Response(null, { status: 204 }));

  app.post('/', async (c) => {
    if (!originAllowed(c)) return kbJson({ error: 'origin_not_allowed' }, 403);

    const raw = await c.req.text();
    if (raw.length > 200_000) return kbJson({ error: 'too_large' }, 413);

    let payload: Rpc | Rpc[];
    try {
      payload = JSON.parse(raw);
      // One line per call in Workers Logs: enough to see what a client such as
      // ChatGPT asked for when it rejects the server. No arguments, no tokens.
      const calls = (Array.isArray(payload) ? payload : [payload]).map((r) => (r.method === 'tools/call' ? `tools/call:${(r.params as { name?: string } | undefined)?.name ?? '?'}` : r.method));
      console.log(JSON.stringify({ mcp: calls, surface, ua: c.req.header('user-agent') ?? '', origin: c.req.header('origin') ?? '', version: c.req.header('mcp-protocol-version') ?? '', auth: Boolean(c.req.header('authorization')) }));
    } catch {
      return kbJson(rpcError(null, -32700, 'Parse error'), 400);
    }

    // The knowledgebase server also reads an ack_ key here: authorFrom()
    // resolves one to its key row (and the admin session to the admin), which
    // is exactly the pair create_knowledge/update_knowledge accept.
    const author = await authorFrom(c);
    // A client's agent token (cat_…) drives the portal_* tools only. It is never
    // a knowledgebase author: authorFrom() resolves it to nothing.
    const bearer = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/, '');
    const clientToken = bearer.startsWith('cat_') ? bearer : null;
    const batch = Array.isArray(payload);
    const requests: Rpc[] = Array.isArray(payload) ? payload : [payload];

    // Claude: a portal tool called without a live client token is refused at
    // the HTTP level, before any tool runs (see claudeChallenge). Every other
    // client keeps the in-result challenge. The knowledgebase has no sign-in at
    // all, so none of this applies to /kb-mcp.
    const callsPortalTool =
      portalSurface &&
      requests.some((r) => r?.method === 'tools/call' && CLIENT_TOOL_NAMES.has(String((r.params as { name?: unknown } | undefined)?.name ?? '')));
    if (
      callsPortalTool &&
      author?.kind !== 'admin' &&
      fromClaude(c.req.header('cf-connecting-ip') ?? '', c.req.header('user-agent') ?? '') &&
      !(clientToken && (await agentUser(c.env, clientToken)))
    ) {
      return claudeChallenge(c.env);
    }

    // Notifications (no id) must not produce a response body.
    const isNotification = requests.every((r) => r?.id === undefined || r?.id === null);

    const handle = async (request: Rpc): Promise<object | null> => {
      try {
        switch (request?.method) {
          case 'initialize': {
            const requested = String((request.params?.protocolVersion as string) ?? MCP_PROTOCOL);
            return rpcResult(request.id, {
              protocolVersion: MCP_SUPPORTED.includes(requested) ? requested : MCP_PROTOCOL,
              capabilities: {
                tools: { listChanged: false },
                resources: { listChanged: false, subscribe: false },
                prompts: { listChanged: false },
              },
              serverInfo: portalSurface ? PORTAL_SERVER_INFO : KB_SERVER_INFO,
              instructions: portalSurface ? PORTAL_INSTRUCTIONS : KB_INSTRUCTIONS,
            });
          }
          case 'notifications/initialized':
          case 'notifications/cancelled':
            return null; // notification: no response
          case 'ping':
            return rpcResult(request.id, {});
          case 'tools/list':
            return rpcResult(request.id, { tools: toolsFor(surface, author) });
          case 'resources/list': {
            // The portal advertises its card; the knowledgebase advertises its
            // entries. Neither lists the other product's resources.
            if (portalSurface) return rpcResult(request.id, { resources: [boardResource()] });
            const cursor = Math.max(0, Number(request.params?.cursor ?? 0) || 0);
            const [rows, total] = await Promise.all([
              c.env.KB_DB.prepare(
                `SELECT * FROM entries ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
              )
                .bind(RESOURCE_PAGE, cursor)
                .all<EntryRow>(),
              c.env.KB_DB.prepare('SELECT COUNT(*) AS n FROM entries').first<{ n: number }>(),
            ]);
            const resources = (rows.results ?? []).map(entryResource);
            const next = cursor + resources.length;
            return rpcResult(request.id, {
              resources,
              ...(next < (total?.n ?? 0) ? { nextCursor: String(next) } : {}),
            });
          }
          case 'resources/templates/list':
            return rpcResult(request.id, {
              resourceTemplates: portalSurface
                ? []
                : [
                    {
                      uriTemplate: 'kb://entry/{slug}',
                      name: 'Knowledgebase entry',
                      description: 'One entry by slug, as markdown.',
                      mimeType: 'text/markdown',
                    },
                  ],
            });
          case 'resources/read': {
            const uri = String(request.params?.uri ?? '');
            // The board's view ships with the portal server; it is UI, not an
            // entry. The knowledgebase server does not publish it.
            if (portalSurface && uri === BOARD_UI_URI) {
              return rpcResult(request.id, {
                contents: [
                  {
                    uri,
                    mimeType: BOARD_MIME,
                    text: BOARD_HTML,
                    _meta: {
                      ui: { prefersBorder: true },
                      // Declared before the view loads, so a fullscreen surface
                      // (sidebar, thread tab) opens without an inline flash.
                      'openai/ui': {
                        availableDisplayModes: ['inline', 'fullscreen'],
                        preferredDisplayMode: 'inline',
                      },
                      'openai/widgetDescription':
                        'The client’s requests on malipetek.dev: status, project, cost so far, and a link into the portal.',
                    },
                  },
                ],
              });
            }
            // Reading a kb:// resource still works from the portal endpoint:
            // connectors built before the split may hold those URIs.
            const match = uri.match(/^kb:\/\/entry\/(.+)$/);
            if (!match) return rpcError(request.id, -32602, `Unknown resource: ${uri}`);
            const key = decodeURIComponent(match[1]);
            const row = await c.env.KB_DB.prepare('SELECT * FROM entries WHERE slug = ? OR id = ?')
              .bind(key, /^\d+$/.test(key) ? Number(key) : -1)
              .first<EntryRow>();
            if (!row) return rpcError(request.id, -32002, `No entry for ${uri}`);
            return rpcResult(request.id, {
              contents: [{ uri, mimeType: 'text/markdown', text: entryMarkdown(row) }],
            });
          }
          case 'prompts/list':
            // The portal is a contracting app, not a place to write KB entries.
            return rpcResult(request.id, { prompts: portalSurface ? [] : MCP_PROMPTS });
          case 'prompts/get': {
            const name = String(request.params?.name ?? '');
            const prompt = (portalSurface ? [] : MCP_PROMPTS).find((p) => p.name === name);
            if (!prompt) return rpcError(request.id, -32602, `Unknown prompt: ${name}`);
            const args = (request.params?.arguments as Record<string, string>) ?? {};
            return rpcResult(request.id, {
              description: prompt.description,
              messages: [
                {
                  role: 'user',
                  content: {
                    type: 'text',
                    text:
                      `Record what we just learned about "${args.topic ?? 'this session'}" in the agentic coding knowledgebase.\n\n` +
                      `Outcome: ${args.outcome ?? '(describe the fix or the dead end)'}\n\n` +
                      'Write exactly one entry with create_knowledge: a specific title, the problem as it actually ' +
                      'appeared (errors verbatim), and the resolution with real commands and code. Set status to ' +
                      '"solved" when it worked, "workaround" when it ships but the root cause stands, or ' +
                      '"unsolvable" when the session proved it cannot be fixed and the evidence is the useful part. ' +
                      'Name the agent in author_agent, and search_knowledge first so an existing entry gets updated ' +
                      'instead of duplicated.',
                  },
                },
              ],
            });
          }
          case 'tools/call': {
            const name = String(request.params?.name ?? '');
            const args = (request.params?.arguments as Record<string, unknown>) ?? {};
            const tool = callableToolsFor(surface, author).find((t) => t.name === name);
            if (!tool) {
              return rpcError(request.id, -32602, `Unknown tool: ${name}`);
            }
            const schemes = (tool as { securitySchemes?: Array<{ type: string }> }).securitySchemes ?? [];
            const needsSignIn = schemes.length === 1 && schemes[0].type === 'oauth2';
            const credential = portalSurface ? clientToken ?? (author?.kind === 'admin' ? bearer : null) : null;
            if (needsSignIn && !credential) return rpcResult(request.id, authChallenge(c.env));
            const portalTool =
              portalSurface && (CLIENT_TOOL_NAMES.has(name) || (OWNER_TOOL_NAMES.has(name) && author?.kind === 'admin'));
            try {
              const value = portalTool
                ? await callClientTool(c.env, c.executionCtx, credential, name, args)
                : await callTool(c.env, name, args, author);
              // A UI tool answers twice: model-readable text and the structured
              // payload the view renders (MCP Apps: ui/notifications/tool-result).
              const summarize = UI_TOOLS[name];
              if (summarize && (tool as { _meta?: { ui?: { resourceUri?: string } } })._meta?.ui?.resourceUri) {
                // The card's copy in the client's language: the one they picked in the
                // portal, else the one the host reports. users.locale defaults to
                // en-US, so English there means "not chosen" and the host's language
                // decides. In _meta, so the view gets it and the model's context does not.
                const hostLocale = (request.params?._meta as Record<string, unknown> | undefined)?.['openai/locale'];
                const picked = closestLocale((value as { locale?: unknown }).locale);
                const host = typeof hostLocale === 'string' ? closestLocale(hostLocale) : null;
                const locale = (picked && picked !== 'en-US' ? picked : host) ?? picked ?? 'en-US';
                return rpcResult(request.id, {
                  content: [{ type: 'text', text: summarize(value) }],
                  structuredContent: value as Record<string, unknown>,
                  _meta: { 'malipetek/locale': locale, 'malipetek/strings': cardStrings(locale) },
                });
              }
              return rpcResult(request.id, toolText(value));
            } catch (error) {
              // An expired or revoked token is still "you need to sign in again":
              // answer with the challenge, not just a message.
              const message = (error as Error)?.message ?? 'Tool failed.';
              if (needsSignIn && /^unauthorized/.test(message)) return rpcResult(request.id, authChallenge(c.env));
              // Tool failures are results with isError, not protocol errors — that
              // is what lets the model read the message and retry.
              return rpcResult(request.id, toolText(message, true));
            }
          }
          default:
            return rpcError(request?.id, -32601, `Method not found: ${request?.method}`);
        }
      } catch (error) {
        return rpcError(request?.id, -32603, (error as Error)?.message ?? 'Internal error');
      }
    };

    const results = (await Promise.all(requests.map(handle))).filter((r): r is object => r !== null);

    const headers: Record<string, string> = {
      'mcp-protocol-version': MCP_PROTOCOL,
      // Stateless server: we mint a session id for clients that insist on one,
      // but never require it back.
      'mcp-session-id': c.req.header('mcp-session-id') ?? crypto.randomUUID(),
    };
    const origin = c.req.header('Origin') ?? '';
    if (ALLOWED_MCP_ORIGINS.includes(origin)) headers['access-control-allow-origin'] = origin;
    headers['access-control-expose-headers'] = 'mcp-session-id, mcp-protocol-version';

    // A notification-only POST is acknowledged with 202 and no body.
    if (isNotification && !results.length) return new Response(null, { status: 202, headers });

    const accept = c.req.header('Accept') ?? '';
    const wantsSse = accept.includes('text/event-stream') && !accept.includes('application/json');

    if (wantsSse) {
      const body = results.map((r) => `event: message\ndata: ${JSON.stringify(r)}\n\n`).join('');
      return new Response(body, {
        headers: { ...headers, 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
      });
    }

    return new Response(JSON.stringify(batch ? results : results[0]), {
      headers: { ...headers, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  });

  return app;
}

/** The published portal app. OAuth, the card, portal_* and owner_* tools. */
export const mcp = makeMcp('portal');
/** The public knowledgebase at https://lab.malipetek.dev/mcp (proxied to /kb-mcp). */
export const kbMcp = makeMcp('kb');
