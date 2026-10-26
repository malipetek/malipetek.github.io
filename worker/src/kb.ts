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
 *   POST   /mcp                                                   MCP (streamable HTTP)
 *
 * Reads are fully public — the whole point is that other people's agents can
 * pull from it. Writes need either an API key minted by the admin (`ack_…`)
 * or the admin's own portal session. There is deliberately no self-serve key
 * route: anyone can read, only we author.
 *
 * The MCP endpoint speaks the streamable-HTTP transport (protocol 2025-06-18)
 * so ChatGPT apps and other MCP clients can mount the same tools a REST client
 * gets.
 */
import { Hono } from 'hono';
import { clientIp, isRateLimited, type Env, type HonoEnv } from './shared.ts';
import { now, sessionUser } from './portal.ts';
import { PLATFORM_TOOLS, callPlatformTool } from './platform.ts';
import { CLIENT_TOOLS, CLIENT_TOOL_NAMES, callClientTool } from './clientTools.ts';

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
const ALLOWED_MCP_ORIGINS = ['https://malipetek.dev', 'https://www.malipetek.dev', 'http://localhost:4321'];

const KB_TOOLS = [
  {
    name: 'search_knowledge',
    title: 'Search the agentic coding knowledgebase',
    description:
      'Full-text search over malipetek.dev entry knowledgebase. Every entry is a problem/solution pair from a real agentic coding session. Public — no key needed.',
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

/** Knowledgebase tools plus the GPTflare control-plane bridge. */
/**
 * Tool annotations are what let a connector show "this only reads" versus
 * "this changes production". They are derived centrally so a new tool cannot
 * forget them: anything not named as a writer is treated as read-only.
 */
const READ_ONLY_TOOLS = new Set([
  'search_knowledge',
  'get_knowledge',
  'list_knowledge',
  'platform_status',
  'platform_auth_status',
  'platform_get_context',
  'platform_list_sites',
  'platform_site_state',
  'platform_site_status',
  'platform_preview_status',
  'platform_operation_status',
  'platform_list_files',
  'platform_read_file',
  'platform_github_access',
]);
const DESTRUCTIVE_TOOLS = new Set(['platform_reset_preview', 'platform_approve_preview']);

const annotate = (tool: { name: string; title: string }, readOnly: boolean, destructive: boolean) => ({
  title: tool.title,
  readOnlyHint: readOnly,
  destructiveHint: destructive,
  idempotentHint: readOnly,
  openWorldHint: true,
});

const KB_AND_PLATFORM = [...KB_TOOLS, ...PLATFORM_TOOLS].map((tool) => ({
  ...tool,
  annotations: annotate(tool, READ_ONLY_TOOLS.has(tool.name), DESTRUCTIVE_TOOLS.has(tool.name)),
}));
const PORTAL_TOOLS = CLIENT_TOOLS.map(({ readOnly, ...tool }) => ({ ...tool, annotations: annotate(tool, readOnly, false) }));
const MCP_TOOLS = [...KB_AND_PLATFORM, ...PORTAL_TOOLS];

/**
 * What a caller is shown: the knowledgebase and the client tools to everyone
 * (a client connecting an assistant sees what it can do), the GPTflare
 * platform tools only to Ali's session — they are useless to anyone else.
 */
const toolsFor = (author: Author | null) =>
  MCP_TOOLS.filter((t) => !t.name.startsWith('platform_') || author?.kind === 'admin');

const RESOURCE_PAGE = 50;

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

interface Rpc {  jsonrpc?: string;
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

export const mcp = new Hono<HonoEnv>();

mcp.options('/*', (c) => {
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
 * must not be able to drive a local/remote MCP server. Requests with no Origin
 * (server-to-server: ChatGPT, Claude, curl) pass.
 */
function originAllowed(c: { req: { header: (n: string) => string | undefined } }): boolean {
  const origin = c.req.header('Origin');
  return !origin || ALLOWED_MCP_ORIGINS.includes(origin);
}

mcp.get('/', (c) => {
  // No unsolicited server→client stream; advertise the tool list instead so a
  // human poking the URL in a browser sees something useful.
  return kbJson({
    name: 'malipetek.dev MCP server',
    protocol: MCP_PROTOCOL,
    transport: 'streamable-http',
    endpoint: '/mcp',
    tools: toolsFor(null).map((t) => t.name),
  });
});

mcp.delete('/', (c) => new Response(null, { status: 204 }));

mcp.post('/', async (c) => {
  if (!originAllowed(c)) return kbJson({ error: 'origin_not_allowed' }, 403);

  const raw = await c.req.text();
  if (raw.length > 200_000) return kbJson({ error: 'too_large' }, 413);

  let payload: Rpc | Rpc[];
  try {
    payload = JSON.parse(raw);
  } catch {
    return kbJson(rpcError(null, -32700, 'Parse error'), 400);
  }

  const author = await authorFrom(c);
  // A client's agent token (cat_…) drives the portal_* tools only. It is never
  // a knowledgebase author: authorFrom() resolves it to nothing.
  const bearer = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/, '');
  const clientToken = bearer.startsWith('cat_') ? bearer : null;
  const batch = Array.isArray(payload);
  const requests: Rpc[] = Array.isArray(payload) ? payload : [payload];

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
            serverInfo: { name: 'malipetek-dev', title: 'malipetek.dev', version: '1.1.0' },
            instructions:
              'Public knowledgebase of agentic coding sessions — search_knowledge, get_knowledge and list_knowledge are open, and every entry is also readable as a kb://entry/<slug> resource. create_knowledge and update_knowledge need an ack_ API key issued by the site owner. The portal_* tools let a malipetek.dev client work on their own projects and requests — they need the agent token the client makes in the portal (Connect an assistant), sent as Bearer cat_…. Requests are read by Ali before any work starts.',
          });
        }
        case 'notifications/initialized':
        case 'notifications/cancelled':
          return null; // notification: no response
        case 'ping':
          return rpcResult(request.id, {});
        case 'tools/list':
          return rpcResult(request.id, { tools: toolsFor(author) });
        case 'resources/list': {
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
            resourceTemplates: [
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
          return rpcResult(request.id, { prompts: MCP_PROMPTS });
        case 'prompts/get': {
          const name = String(request.params?.name ?? '');
          if (name !== 'record_learning') return rpcError(request.id, -32602, `Unknown prompt: ${name}`);
          const args = (request.params?.arguments as Record<string, string>) ?? {};
          return rpcResult(request.id, {
            description: MCP_PROMPTS[0].description,
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
          if (!MCP_TOOLS.some((t) => t.name === name)) {
            return rpcError(request.id, -32602, `Unknown tool: ${name}`);
          }
          try {
            const value = CLIENT_TOOL_NAMES.has(name)
              ? await callClientTool(c.env, c.executionCtx, clientToken, name, args)
              : name.startsWith('platform_')
                ? await callPlatformTool(c.env, name, args, author)
                : await callTool(c.env, name, args, author);
            return rpcResult(request.id, toolText(value));
          } catch (error) {
            // Tool failures are results with isError, not protocol errors — that
            // is what lets the model read the message and retry.
            return rpcResult(request.id, toolText((error as Error)?.message ?? 'Tool failed.', true));
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
