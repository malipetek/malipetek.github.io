import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { sealProjectSecret } from '../src/projectAccess.ts';
import { node } from '../src/node.ts';

const TOKEN = 'runner-token';

async function fixture() {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) {
    sql.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  const DB = { prepare(query: string) {
    let values: any[] = [];
    const stmt = { bind(...args: any[]) { values = args; return stmt; }, async first() { return sql.prepare(query).get(...values) ?? null; }, async all() { return { results: sql.prepare(query).all(...values) }; }, async run() { const r = sql.prepare(query).run(...values); return { meta: { changes: Number(r.changes) } }; } };
    return stmt;
  }, async batch(statements: any[]) { return Promise.all(statements.map(s => s.run())); } };
  const env = { DB, RUNNER_TOKEN: TOKEN, SESSION_SECRET: 'test-project-secret-encryption-key', RATE_LIMIT: { async get() { return null; }, async put() {} } } as any;
  sql.exec(`INSERT INTO users(id,email,role,created_at,verified_at) VALUES ('owner','owner@example.com','client',1,1);
  INSERT INTO projects(id,slug,name,created_at,solutions) VALUES ('a','a','A',1,'["shopify"]');
  INSERT INTO tickets(id,user_id,project_id,title,created_at,updated_at) VALUES (1,'owner','a','Store',1,1),(2,'owner',NULL,'No project',1,1);
  INSERT INTO ticket_runs(id,ticket_id,executor,status,started_at,node_id) VALUES (1,1,'dsh','running',1,'mac'),(2,1,'dsh','ok',1,'mac'),(3,2,'dsh','running',1,'mac');`);
  const put = async (name: string, value: string) => sql.prepare('INSERT INTO project_secrets(project_id,name,value_enc,updated_at) VALUES (?,?,?,1)')
    .run('a', name, await sealProjectSecret(env, 'a', name, value));
  await put('SHOPIFY_STORE_DOMAIN', 'acme.myshopify.com');
  await put('SHOPIFY_ADMIN_TOKEN', 'shpat_secret');
  // A stored secret of an integration the project's solutions do not use.
  await put('AWS_SECRET_ACCESS_KEY', 'aws-secret');
  return { sql, env };
}

const get = (env: any, path: string, token = TOKEN) =>
  node.request(path, { headers: { authorization: `Bearer ${token}` } }, env);

test('a running run of the calling node gets only its project solution credentials', async () => {
  const { sql, env } = await fixture();
  const res = await get(env, '/node/runs/1/credentials?nodeId=mac');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json() as any;
  assert.deepEqual(body.env, { SHOPIFY_STORE_DOMAIN: 'acme.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'shpat_secret' });
  assert.equal(body.env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.deepEqual(body.integrations.map((i: any) => i.id), ['shopify']);
  const audit = sql.prepare('SELECT project_id, run_id, node_id, integrations FROM credential_access').all() as any[];
  assert.equal(audit.length, 1);
  assert.deepEqual({ ...audit[0] }, { project_id: 'a', run_id: 1, node_id: 'mac', integrations: '["shopify"]' });
});

test('another node, a finished run, a run without a project or a bad token get nothing', async () => {
  const { sql, env } = await fixture();
  assert.equal((await get(env, '/node/runs/1/credentials?nodeId=other')).status, 403);
  assert.equal((await get(env, '/node/runs/2/credentials?nodeId=mac')).status, 403);
  assert.equal((await get(env, '/node/runs/3/credentials?nodeId=mac')).status, 404);
  assert.equal((await get(env, '/node/runs/99/credentials?nodeId=mac')).status, 404);
  assert.equal((await get(env, '/node/runs/1/credentials?nodeId=mac', 'wrong')).status, 401);
  assert.equal((sql.prepare('SELECT count(*) AS n FROM credential_access').get() as any).n, 0);
});
