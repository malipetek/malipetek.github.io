import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { sealProjectSecret } from '../src/projectAccess.ts';
import { node } from '../src/node.ts';
import { seal } from '../src/cfaccess.ts';

const TOKEN = 'runner-token';
const ACCOUNT = '3b10da484bffbc2d9ef9f1d244cfa2f9';

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
  sql.exec(`INSERT INTO users(id,email,role,created_at,verified_at) VALUES ('owner','owner@example.com','client',1,1),('stranger','stranger@example.com','client',1,1);
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

/** A project owner's Cloudflare grant (kind='token': open-and-use). */
async function grant(sql: DatabaseSync, env: any, userId: string, token: string) {
  await sql.prepare('INSERT INTO cloudflare_connections(user_id,accounts,kind,access_enc,created_at,updated_at) VALUES (?,?,?,?,1,1)')
    .run(userId, JSON.stringify([{ id: ACCOUNT, name: `${userId}'s Account` }]), 'token', await seal(env, token));
  return (sql.prepare('SELECT id FROM cloudflare_connections WHERE user_id=?').get(userId) as any).id;
}

const deployTarget = (connectionId: number) =>
  JSON.stringify({ provider: 'cloudflare', kind: 'workers', name: 'petekkoleji', productionBranch: 'main', connectionId, accountId: ACCOUNT });

test('a run deploys with the project owner’s grant, never another user’s', async () => {
  const { sql, env } = await fixture();
  const ownerId = await grant(sql, env, 'owner', 'cf-owner-token');
  await grant(sql, env, 'stranger', 'cf-stranger-token');
  sql.exec(`UPDATE projects SET owner_user_id='owner', deploy_target='${deployTarget(ownerId)}' WHERE id='a'`);
  const res = await get(env, '/node/runs/1/credentials?nodeId=mac');
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  // The named grant is the owner's: its token, the target's account, the
  // deploy target beside them, and no reason for its absence.
  assert.equal(body.env.CLOUDFLARE_API_TOKEN, 'cf-owner-token');
  assert.equal(body.env.CLOUDFLARE_ACCOUNT_ID, ACCOUNT);
  assert.deepEqual(body.integrations.map((i: any) => i.id), ['shopify', 'cloudflare']);
  assert.equal(body.env.PTECH_DEPLOY_NAME, 'petekkoleji');
  assert.equal(body.cloudflare, undefined);
  const audit = sql.prepare('SELECT integrations FROM credential_access').all() as any[];
  assert.deepEqual(JSON.parse(audit[0].integrations), ['shopify', 'cloudflare']);
});

test('a target naming another user’s grant deploys with nothing, and the fetch says why', async () => {
  const { sql, env } = await fixture();
  const strangerId = await grant(sql, env, 'stranger', 'cf-stranger-token');
  // The owner exists but has no grant of their own.
  sql.exec(`UPDATE projects SET owner_user_id='owner', deploy_target='${deployTarget(strangerId)}' WHERE id='a'`);
  const res = await get(env, '/node/runs/1/credentials?nodeId=mac');
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.env.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(body.env.PTECH_DEPLOY_NAME, undefined);
  assert.deepEqual(body.integrations.map((i: any) => i.id), ['shopify']);
  assert.match(body.cloudflare, /owner's Cloudflare connection is missing or lapsed/);
  // A project with no owner cannot use client credentials at all (rule 2).
  sql.exec(`UPDATE projects SET owner_user_id=NULL, deploy_target='${deployTarget(strangerId)}' WHERE id='a'`);
  const noOwner = await (await get(env, '/node/runs/1/credentials?nodeId=mac')).json();
  assert.equal(noOwner.env.CLOUDFLARE_API_TOKEN, undefined);
  assert.match(noOwner.cloudflare, /the project has no owner/);
});

test('a provider-built target hands the run the target but no deploy token', async () => {
  const { sql, env } = await fixture();
  const ownerId = await grant(sql, env, 'owner', 'cf-owner-token');
  // The Pages project is built by Cloudflare from the connected repo: a run
  // deploys by pushing its branch, so it needs no Cloudflare credential at
  // all — only the target's env for the prompt.
  sql.exec(`UPDATE projects SET owner_user_id='owner', deploy_target='${JSON.stringify({ provider: 'cloudflare', kind: 'pages', name: 'petekkoleji', productionBranch: 'main', connectionId: ownerId, accountId: ACCOUNT, builds: 'provider' })}' WHERE id='a'`);
  const res = await get(env, '/node/runs/1/credentials?nodeId=mac');
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.env.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(body.env.CLOUDFLARE_ACCOUNT_ID, undefined);
  assert.equal(body.env.PTECH_DEPLOY_PROVIDER, 'cloudflare');
  assert.equal(body.env.PTECH_DEPLOY_KIND, 'pages');
  assert.equal(body.env.PTECH_DEPLOY_NAME, 'petekkoleji');
  assert.equal(body.env.PTECH_DEPLOY_PRODUCTION_BRANCH, 'main');
  assert.equal(body.env.PTECH_DEPLOY_BUILDS, 'provider');
  assert.deepEqual(body.integrations.map((i: any) => i.id), ['shopify']);
  assert.equal(body.cloudflare, undefined);
  // The audit names only the credentials actually handed out — Cloudflare is
  // not one of them here.
  const audit = sql.prepare('SELECT integrations FROM credential_access').all() as any[];
  assert.deepEqual(JSON.parse(audit[0].integrations), ['shopify']);
});
