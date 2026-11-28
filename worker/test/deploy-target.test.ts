/*
 * Adopted hosting (projects.deploy_target) in the client-facing portal:
 * setupFor treats it as live hosting, GET /portal/me exposes it client-safe,
 * and an intake ticket hands off to the request it filed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { portal } from '../src/portal.ts';
import { setupFor } from '../src/setup.ts';
import { sha256 } from '../src/shared.ts';

const TARGET = { provider: 'cloudflare', kind: 'pages', name: 'petekkoleji', productionBranch: 'main', builds: 'provider' };

test('setupFor: adopted hosting marks the hosting check ready without a site row', () => {
  const input = {
    kind: 'existing' as const,
    brief: { what: 'A school site', goal: 'Keep it current' },
    repoKind: 'repo' as const,
    repo: 'https://github.com/petekkoleji/petekkoleji.com',
    slug: 'petekkoleji',
    onlineSlugs: [] as string[],
    ticketCount: 0,
    clientCreated: true,
    site: null,
  };
  const withTarget = setupFor({ ...input, deployTarget: TARGET });
  const preview = withTarget.checks.find((c) => c.key === 'preview')!;
  assert.equal(preview.state, 'ready');
  assert.equal(preview.label, 'Live hosting');
  assert.equal(preview.detail, 'Cloudflare Pages (petekkoleji)');

  // A workers target names Workers instead.
  const workers = setupFor({ ...input, deployTarget: { ...TARGET, kind: 'workers' as const, name: 'petekkoleji-api' } });
  assert.equal(workers.checks.find((c) => c.key === 'preview')!.detail, 'Cloudflare Workers (petekkoleji-api)');

  // Null or absent deployTarget: the exact behavior from before is preserved.
  const without = setupFor({ ...input, deployTarget: null });
  assert.equal(without.checks.find((c) => c.key === 'preview')!.state, 'unknown');
  const unset = setupFor(input);
  assert.deepEqual(unset.checks, without.checks);

  // A new project with adopted hosting is not asked to set up a site either.
  const fresh = setupFor({ ...input, kind: 'new' as const, repoKind: 'none' as const, repo: null, deployTarget: TARGET });
  assert.equal(fresh.checks.find((c) => c.key === 'preview')!.state, 'ready');
});

async function fixture() {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort()) {
    sql.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  const DB = {
    prepare(query: string) {
      let values: any[] = [];
      const stmt = {
        bind(...args: any[]) {
          values = args;
          return stmt;
        },
        async first() {
          return sql.prepare(query).get(...values) ?? null;
        },
        async all() {
          return { results: sql.prepare(query).all(...values) };
        },
        async run() {
          const r = sql.prepare(query).run(...values);
          return { meta: { changes: Number(r.changes) } };
        },
      };
      return stmt;
    },
    async batch(statements: any[]) {
      return Promise.all(statements.map((s) => s.run()));
    },
  };
  const env = { DB, RATE_LIMIT: { async get() { return null; }, async put() {} }, SESSION_SECRET: 'test-project-secret-encryption-key' } as any;
  sql.exec(`INSERT INTO users(id,email,role,created_at,verified_at) VALUES ('client','client@example.com','client',1,1);
  INSERT INTO projects(id,slug,name,kind,brief,created_by,created_at) VALUES
    ('a','petekkoleji','Petek Koleji','existing','{"what":"A school site","goal":"Keep it current"}','client',1),
    ('b','plain','Plain Project','existing','{"what":"A thing","goal":"Done"}','client',1);
  UPDATE projects SET owner_user_id='client', deploy_target='${JSON.stringify(TARGET)}' WHERE id='a';
  INSERT INTO user_projects(user_id,project_id) VALUES ('client','a'),('client','b');`);
  const token = `deploy-target-${Math.random()}`;
  sql.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').run(
    await sha256(token),
    'client',
    Math.floor(Date.now() / 1000) + 3600,
    1,
  );
  const request = (method: string, path: string, body?: unknown) =>
    portal.request(
      path,
      { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) },
      env,
      { waitUntil() {}, passThroughOnException() {} } as any,
    );
  return { sql, request };
}

test('GET /portal/me exposes a client-safe deployTarget, null without one', async () => {
  const { request } = await fixture();
  const res = await request('GET', '/portal/me');
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  const adopted = body.projects.find((p: any) => p.id === 'a');
  assert.deepEqual(adopted.deployTarget, TARGET);
  // Client-safe: the stored connection and account ids never leave the route.
  assert.ok(!('connectionId' in adopted.deployTarget) && !('accountId' in adopted.deployTarget));
  // And the setup panel reads the hosting check as ready.
  const preview = adopted.setup.checks.find((c: any) => c.key === 'preview');
  assert.equal(preview.state, 'ready');
  assert.equal(preview.label, 'Live hosting');
  const plain = body.projects.find((p: any) => p.id === 'b');
  assert.equal(plain.deployTarget, null);
});

test('GET /portal/tickets/:id hands an intake ticket off to the request it filed', async () => {
  const { sql, request } = await fixture();
  sql.exec(`INSERT INTO tickets(user_id,project_id,title,status,kind,created_at,updated_at) VALUES
    ('client',NULL,'Set up my school site','in_progress','intake',1,1),
    ('client','a','Build the admissions page','new','client',1,1);`);
  const intakeId = (sql.prepare("SELECT id FROM tickets WHERE kind='intake'").get() as any).id as number;
  const childId = (sql.prepare("SELECT id FROM tickets WHERE kind='client'").get() as any).id as number;
  sql.prepare('INSERT INTO ticket_actions(ticket_id,action,args_json,result_json,created_at) VALUES (?,?,?,?,?)').run(
    intakeId,
    'file_request',
    '{"projectId":"a","title":"Build the admissions page"}',
    JSON.stringify({ ok: true, ticket: { id: childId, title: 'Build the admissions page' }, link: 'https://ptechsolutions.net/portal/ticket#id=2' }),
    1,
  );

  const res = await request('GET', `/portal/tickets/${intakeId}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.ticket.kind, 'intake');
  assert.deepEqual(body.spawnedTicket, {
    id: childId,
    title: 'Build the admissions page',
    status: 'new',
    first_preview: 0,
    project_id: 'a',
  });

  // A non-intake ticket never carries the handoff.
  const other = await request('GET', `/portal/tickets/${childId}`);
  assert.equal(other.status, 200);
  assert.equal(((await other.json()) as any).spawnedTicket, null);

  // An intake ticket that filed nothing yet: null, not an error.
  sql.exec(`INSERT INTO tickets(user_id,project_id,title,status,kind,created_at,updated_at) VALUES ('client',NULL,'Another setup','in_progress','intake',1,1);`);
  const emptyId = (sql.prepare("SELECT id FROM tickets WHERE title='Another setup'").get() as any).id as number;
  const empty = await request('GET', `/portal/tickets/${emptyId}`);
  assert.equal(((await empty.json()) as any).spawnedTicket, null);

  // A spawned id pointing at another user's ticket is never leaked.
  sql.exec(`INSERT INTO users(id,email,role,created_at,verified_at) VALUES ('other','other@example.com','client',1,1);
  INSERT INTO tickets(user_id,project_id,title,status,kind,created_at,updated_at) VALUES ('other',NULL,'Not yours','new','client',1,1);`);
  const foreignId = (sql.prepare("SELECT id FROM tickets WHERE user_id='other'").get() as any).id as number;
  sql.prepare('INSERT INTO ticket_actions(ticket_id,action,args_json,result_json,created_at) VALUES (?,?,?,?,?)').run(
    emptyId,
    'file_request',
    '{}',
    JSON.stringify({ ok: true, ticket: { id: foreignId, title: 'Not yours' } }),
    2,
  );
  const leaked = await request('GET', `/portal/tickets/${emptyId}`);
  assert.equal(((await leaked.json()) as any).spawnedTicket, null);
});
