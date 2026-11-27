/*
 * Rule 2 (docs/product/RULES.md): every creation path sets an owner so the
 * project can use the owner's connections. These tests pin POST
 * /admin/projects' ownerUserId (attached and owned in one call, like PATCH's
 * lookup takes an id or an email) and the intake agent's create_project.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { portal } from '../src/portal.ts';
import { tool } from '../src/intake.ts';
import { sha256 } from '../src/shared.ts';

async function fixture() {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort()) {
    sql.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  const DB = {
    prepare(query: string) {
      let values: any[] = [];
      const stmt = {
        bind(...args: any[]) { values = args; return stmt; },
        async first() { return sql.prepare(query).get(...values) ?? null; },
        async all() { return { results: sql.prepare(query).all(...values) }; },
        async run() { const r = sql.prepare(query).run(...values); return { meta: { changes: Number(r.changes) } }; },
      };
      return stmt;
    },
    async batch(statements: any[]) { return Promise.all(statements.map((s) => s.run())); },
  };
  const env = { DB, RATE_LIMIT: { async get() { return null; }, async put() {} }, SESSION_SECRET: 'test-project-secret-encryption-key' } as any;
  sql.exec(`INSERT INTO users(id,email,role,created_at,verified_at) VALUES ('owner','owner@example.com','client',1,1),('other','other@example.com','client',1,1),('admin','admin@example.com','admin',1,1)`);
  return { sql, env };
}

/** An admin session, the way deploy-owner.test.ts makes one. */
async function adminRequest(f: Awaited<ReturnType<typeof fixture>>) {
  const token = `project-owner-${Math.random()}`;
  f.sql.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)')
    .run(await sha256(token), 'admin', Math.floor(Date.now() / 1000) + 3600, 1);
  return (method: string, path: string, body?: unknown) =>
    portal.request(path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, f.env, { waitUntil() {}, passThroughOnException() {} } as any);
}

test('POST /admin/projects attaches the owner and sets owner_user_id in one call', async () => {
  const f = await fixture();
  const request = await adminRequest(f);
  const res = await request('POST', '/admin/projects', { name: 'Bakery', slug: 'bakery', ownerUserId: 'owner@example.com' });
  assert.equal(res.status, 201, JSON.stringify(await res.json()));
  const project = f.sql.prepare('SELECT owner_user_id FROM projects WHERE slug = ?').get('bakery') as any;
  assert.equal(project.owner_user_id, 'owner');
  const attached = f.sql.prepare('SELECT 1 FROM user_projects WHERE user_id = ? AND project_id = (SELECT id FROM projects WHERE slug = ?)').get('owner', 'bakery');
  assert.ok(attached, 'the owner is attached through user_projects');
});

test('POST /admin/projects takes the owner by account id as well as email', async () => {
  const f = await fixture();
  const request = await adminRequest(f);
  const res = await request('POST', '/admin/projects', { name: 'Farm', slug: 'farm', ownerUserId: 'other' });
  assert.equal(res.status, 201);
  assert.equal((f.sql.prepare('SELECT owner_user_id FROM projects WHERE slug = ?').get('farm') as any).owner_user_id, 'other');
});

test('POST /admin/projects rejects an owner that is not an account', async () => {
  const f = await fixture();
  const request = await adminRequest(f);
  const res = await request('POST', '/admin/projects', { name: 'Ghost', slug: 'ghost', ownerUserId: 'nobody@example.com' });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as any).error, 'owner_not_found');
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM projects').get()!.n, 0);
  const bad = await request('POST', '/admin/projects', { name: 'Ghost', slug: 'ghost', ownerUserId: 42 });
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as any).error, 'bad_owner');
});

test('POST /admin/projects still allows no owner — an internal project', async () => {
  const f = await fixture();
  const request = await adminRequest(f);
  const res = await request('POST', '/admin/projects', { name: 'Internal', slug: 'internal' });
  assert.equal(res.status, 201);
  const project = f.sql.prepare('SELECT owner_user_id FROM projects WHERE slug = ?').get('internal') as any;
  assert.equal(project.owner_user_id, null);
});

test('the intake agent owns the projects it creates for the client', async () => {
  const f = await fixture();
  const out = await tool(
    { env: f.env, userId: 'owner', userEmail: 'owner@example.com', ticketId: 1, used: 0, filed: false },
    'create_project',
    { name: 'Bakery', kind: 'new', what: 'A bakery site', goal: 'Sell bread online' },
  );
  const project = (out.result as any)?.project;
  assert.ok(project?.id, JSON.stringify(out.result));
  const row = f.sql.prepare('SELECT owner_user_id, created_by FROM projects WHERE id = ?').get(project.id) as any;
  assert.equal(row.owner_user_id, 'owner');
  assert.equal(row.created_by, 'owner');
  const attached = f.sql.prepare('SELECT 1 FROM user_projects WHERE user_id = ? AND project_id = ?').get('owner', project.id);
  assert.ok(attached, 'the client stays attached through user_projects');
});
