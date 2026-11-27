/*
 * Rule 2 (docs/product/RULES.md): credentials a project uses come only from
 * the project owner's connections. These tests pin the hosting read, the
 * deploy-target write and the run-credential hand-off to the owner's grants.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { portal } from '../src/portal.ts';
import { connectionForAccount, seal } from '../src/cfaccess.ts';
import { sha256 } from '../src/shared.ts';

const ACCOUNT = '3b10da484bffbc2d9ef9f1d244cfa2f9';
const OTHER_ACCOUNT = '11111111111111111111111111111111';

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
  const env = { DB, RATE_LIMIT: { async get() { return null; }, async put() {} }, SESSION_SECRET: 'test-project-secret-encryption-key' } as any;
  sql.exec(`INSERT INTO users(id,email,role,created_at,verified_at) VALUES ('owner','owner@example.com','client',1,1),('stranger','stranger@example.com','client',1,1),('admin','admin@example.com','admin',1,1);
  INSERT INTO projects(id,slug,name,created_at) VALUES ('a','petekkoleji','Petek Koleji',1),('b','noowner','No Owner',1);
  UPDATE projects SET owner_user_id='owner' WHERE id='a';`);
  // The owner's two live grants (newest first covers the same account), a
  // stranger's grant that also covers it, and the owner's revoked one.
  const grant = async (userId: string, accounts: string, created: number) =>
    sql.prepare('INSERT INTO cloudflare_connections(user_id,accounts,kind,access_enc,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(
      userId, accounts, 'token', await seal(env, `${userId}-token-${created}`), created, created,
    );
  await grant('owner', JSON.stringify([{ id: ACCOUNT, name: "Petekkoleji2023@gmail.com's Account" }]), 100);
  await grant('stranger', JSON.stringify([{ id: ACCOUNT, name: "Stranger's Account" }]), 200);
  await grant('owner', JSON.stringify([{ id: OTHER_ACCOUNT, name: 'Other Account' }]), 300);
  await grant('owner', JSON.stringify([{ id: ACCOUNT, name: 'Revoked' }]), 250);
  sql.exec("UPDATE cloudflare_connections SET revoked_at = 1 WHERE created_at = 250 AND user_id = 'owner'");
  const ids = sql.prepare('SELECT id, user_id, created_at FROM cloudflare_connections ORDER BY id').all() as any[];
  return { sql, env, ids };
}

/** An admin session, the way project-access.test.ts makes one. */
async function adminRequest(f: Awaited<ReturnType<typeof fixture>>) {
  const token = `deploy-owner-${Math.random()}`;
  f.sql.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)')
    .run(await sha256(token), 'admin', Math.floor(Date.now() / 1000) + 3600, 1);
  return (method: string, path: string, body?: unknown) =>
    portal.request(path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, f.env, { waitUntil() {}, passThroughOnException() {} } as any);
}

/** Cloudflare's API answers empty listings for any well-formed call. */
function stubCloudflare() {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ success: true, result: [] }), { status: 200 })) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

test('connectionForAccount resolves only the owner’s grants', async () => {
  const { env, ids } = await fixture();
  const byUser = (user: string, created: number) => ids.find((g: any) => g.user_id === user && g.created_at === created)!.id as number;
  const ownerOld = byUser('owner', 100), stranger = byUser('stranger', 200), ownerRevoked = byUser('owner', 250), ownerOther = byUser('owner', 300);
  // The named grant, when it is the owner's and live.
  assert.equal(await connectionForAccount(env, 'owner', ownerOld, ACCOUNT), ownerOld);
  assert.equal(await connectionForAccount(env, 'owner', ownerOther, OTHER_ACCOUNT), ownerOther);
  // A named grant that is not the owner's falls back to the owner's newest
  // live grant covering the account — never the stranger's, never a revoked one.
  assert.equal(await connectionForAccount(env, 'owner', stranger, ACCOUNT), ownerOld);
  assert.equal(await connectionForAccount(env, 'owner', ownerRevoked, ACCOUNT), ownerOld);
  // No owner, or no live grant of the owner's covering the account: no
  // credential — even when the named grant is another user's that would fit.
  assert.equal(await connectionForAccount(env, null, ownerOld, ACCOUNT), null);
  // An owner with no grant of their own never inherits another user's.
  assert.equal(await connectionForAccount(env, 'admin', ownerOld, ACCOUNT), null);
  assert.equal(await connectionForAccount(env, 'owner', ownerOld, '99999999999999999999999999999999'), null);
});

test('the hosting read lists and uses only the owner’s live grants', async () => {
  const f = await fixture();
  const request = await adminRequest(f);
  const restore = stubCloudflare();
  try {
    const res = await request('GET', '/admin/projects/a/cloudflare');
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.connected, true);
    assert.equal(body.via, 'oauth');
    assert.equal(body.owner, 'owner@example.com');
    // The owner's live grants only: the stranger's and the revoked one are not listed.
    assert.deepEqual(body.connections.map((c: any) => c.email), ['owner@example.com', 'owner@example.com']);
    assert.ok(body.connections.every((c: any) => c.accounts.some((a: any) => a.id === ACCOUNT || a.id === OTHER_ACCOUNT)));
    assert.ok(!('onProject' in body.connections[0]));
    // No target and no request: the owner's newest live grant is the resolved one.
    assert.equal(body.connectionId, Math.max(...body.connections.map((c: any) => c.id)));
    // The slug heuristic is gone: nothing matches grants by email or account name.
    // ?connection= may name one of the owner's grants…
    const asked = await request('GET', '/admin/projects/a/cloudflare?connection=' + Math.min(...body.connections.map((c: any) => c.id)));
    assert.equal(asked.status, 200);
    assert.equal(((await asked.json()) as any).connectionId, Math.min(...body.connections.map((c: any) => c.id)));
    // …never another user's.
    const strangerId = (f.sql.prepare("SELECT id FROM cloudflare_connections WHERE user_id='stranger'").get() as any).id;
    const foreign = await request('GET', `/admin/projects/a/cloudflare?connection=${strangerId}`);
    assert.equal(foreign.status, 400);
    assert.equal(((await foreign.json()) as any).error, 'connection_not_owned');
  } finally {
    restore();
  }
});

test('a project with no owner is told to set one, and no one’s grants are listed', async () => {
  const f = await fixture();
  const request = await adminRequest(f);
  const res = await request('GET', '/admin/projects/b/cloudflare');
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.deepEqual(body, { connected: false, needsOwner: true, connections: [], owner: null, projectRepo: null, detected: null, target: null });
});

test('the hosting read names the project repo and the one Pages project the provider builds from it', async () => {
  const f = await fixture();
  const request = await adminRequest(f);
  f.sql.exec("UPDATE projects SET repo='https://github.com/PetekKoleji/petekkoleji.com' WHERE id='a'");
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const body = (result: unknown) => new Response(JSON.stringify({ success: true, result }), { status: 200 });
    if (String(url).includes('/pages/projects')) return body([
      { name: 'petekkoleji', production_branch: 'main', domains: ['petekkoleji.com'],
        source: { type: 'github', config: { owner: 'petekkoleji', repo_name: 'petekkoleji.com', production_branch: 'main', preview_deployment_setting: 'all' } } },
      { name: 'uploads', production_branch: 'main', domains: [] },
    ]);
    return body([]);
  }) as typeof fetch;
  try {
    const res = await request('GET', '/admin/projects/a/cloudflare');
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.projectRepo, 'petekkoleji/petekkoleji.com');
    assert.deepEqual(body.detected, { provider: 'cloudflare', kind: 'pages', name: 'petekkoleji', productionBranch: 'main', builds: 'provider', repo: 'petekkoleji/petekkoleji.com' });
    assert.deepEqual(body.pages.items[1].source, { type: null, repo: null, productionBranch: null, previews: false });
    // The project records an empty onboarding stub instead: the live site is
    // still named, with the repo Cloudflare really builds from.
    f.sql.exec("UPDATE projects SET repo='https://github.com/malipetek/petekkoleji' WHERE id='a'");
    const stub = await (await request('GET', '/admin/projects/a/cloudflare')).json() as any;
    assert.equal(stub.projectRepo, 'malipetek/petekkoleji');
    assert.deepEqual(stub.detected, { provider: 'cloudflare', kind: 'pages', name: 'petekkoleji', productionBranch: 'main', builds: 'provider', repo: 'petekkoleji/petekkoleji.com', repoDiffers: true });
  } finally {
    globalThis.fetch = real;
  }
});

test('the deploy-target write validates who builds the deploys', async () => {
  const f = await fixture();
  const request = await adminRequest(f);
  const bad = await request('PUT', '/admin/projects/a/deploy-target', { target: { kind: 'pages', name: 'petekkoleji', builds: 'nobody' } });
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as any).error, 'bad_builds');
  const provider = await request('PUT', '/admin/projects/a/deploy-target', { target: { kind: 'pages', name: 'petekkoleji', builds: 'provider' } });
  assert.equal(provider.status, 200);
  assert.equal(((await provider.json()) as any).target.builds, 'provider');
  const stored = f.sql.prepare("SELECT deploy_target FROM projects WHERE id='a'").get() as any;
  assert.equal(JSON.parse(stored.deploy_target).builds, 'provider');
});

test('the deploy-target write accepts the owner’s grant and refuses anyone else’s', async () => {
  const f = await fixture();
  const request = await adminRequest(f);
  const strangerId = (f.sql.prepare("SELECT id FROM cloudflare_connections WHERE user_id='stranger'").get() as any).id;
  const ownerId = (f.sql.prepare('SELECT id FROM cloudflare_connections WHERE user_id=? AND revoked_at IS NULL AND accounts LIKE ? ORDER BY created_at DESC LIMIT 1').get('owner', `%${ACCOUNT}%`) as any).id;
  const target = (connectionId: number) => ({ kind: 'workers', name: 'petekkoleji', connectionId, accountId: ACCOUNT });

  const foreign = await request('PUT', '/admin/projects/a/deploy-target', { target: target(strangerId) });
  assert.equal(foreign.status, 400);
  assert.equal(((await foreign.json()) as any).error, 'connection_not_owned');

  const owned = await request('PUT', '/admin/projects/a/deploy-target', { target: target(ownerId) });
  assert.equal(owned.status, 200);
  assert.equal(((await owned.json()) as any).target.connectionId, ownerId);

  const noOwner = await request('PUT', '/admin/projects/b/deploy-target', { target: target(ownerId) });
  assert.equal(noOwner.status, 400);
  assert.equal(((await noOwner.json()) as any).error, 'owner_required');
  // Clearing a target never needs an owner.
  assert.equal((await request('PUT', '/admin/projects/a/deploy-target', { target: null })).status, 200);
  const stored = f.sql.prepare("SELECT deploy_target FROM projects WHERE id='a'").get() as any;
  assert.equal(stored.deploy_target, null);
});
