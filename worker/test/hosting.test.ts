import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deployTargetEnv, listPages, listWorkers, parseDeployTarget, pickConnection, readDeployTarget } from '../src/hosting.ts';

const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

test('hosting: Pages projects come back with their production branch and domains', async () => {
  const seen: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen.push(`${url} ${(init?.headers as Record<string, string>).authorization}`);
    return new Response(JSON.stringify({ success: true, result: [{ name: 'petekkoleji', subdomain: 'petekkoleji.pages.dev', production_branch: 'main', domains: ['petekkoleji.com'] }] }), { status: 200 });
  }) as typeof fetch;
  const pages = await listPages('acc1', 'tok', fetchImpl);
  assert.deepEqual(pages, { ok: true, items: [{ name: 'petekkoleji', subdomain: 'petekkoleji.pages.dev', productionBranch: 'main', domains: ['petekkoleji.com'] }] });
  assert.equal(seen[0], 'https://api.cloudflare.com/client/v4/accounts/acc1/pages/projects Bearer tok');
});

test('hosting: a refused call names the permission the token lacks, and never echoes the token', async () => {
  const pages = await listPages('acc1', 'secret-token', answer(403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] }));
  assert.equal(pages.ok, false);
  assert.match(JSON.stringify(pages), /Cloudflare Pages: Read/);
  assert.doesNotMatch(JSON.stringify(pages), /secret-token/);
});

test('hosting: Worker scripts come back newest first', async () => {
  const workers = await listWorkers('acc1', 'tok', answer(200, { success: true, result: [
    { id: 'old', modified_on: '2025-01-02T00:00:00Z' },
    { id: 'new', modified_on: '2026-11-20T00:00:00Z' },
  ] }));
  assert.deepEqual(workers.ok && workers.items.map((w) => w.name), ['new', 'old']);
});

test('hosting: a deploy target is a Pages project or a Worker, with a production branch', () => {
  assert.deepEqual(parseDeployTarget({ kind: 'pages', name: 'petekkoleji' }), { provider: 'cloudflare', kind: 'pages', name: 'petekkoleji', productionBranch: 'main' });
  assert.equal(parseDeployTarget(null), null);
  assert.deepEqual(parseDeployTarget({ kind: 'r2', name: 'x' }), { error: 'bad_kind' });
  assert.deepEqual(parseDeployTarget({ kind: 'pages', name: 'Bad Name' }), { error: 'bad_name' });
  assert.deepEqual(parseDeployTarget(undefined), { error: 'bad_target' });
  assert.equal(readDeployTarget('not json'), null);
  assert.deepEqual(deployTargetEnv(readDeployTarget('{"kind":"workers","name":"site","productionBranch":"prod"}')), {
    PTECH_DEPLOY_PROVIDER: 'cloudflare', PTECH_DEPLOY_KIND: 'workers', PTECH_DEPLOY_NAME: 'site', PTECH_DEPLOY_PRODUCTION_BRANCH: 'prod',
  });
  assert.deepEqual(deployTargetEnv(null), {});
});

test('hosting: a target can name the client OAuth grant and the account in it', () => {
  const account = '3b10da484bffbc2d9ef9f1d244cfa2f9';
  assert.deepEqual(parseDeployTarget({ kind: 'workers', name: 'petekkoleji', connectionId: 8, accountId: account }), {
    provider: 'cloudflare', kind: 'workers', name: 'petekkoleji', productionBranch: 'main', connectionId: 8, accountId: account,
  });
  assert.deepEqual(parseDeployTarget({ kind: 'workers', name: 'x', connectionId: 8, accountId: 'nope' }), { error: 'bad_account' });
  assert.deepEqual(parseDeployTarget({ kind: 'workers', name: 'x', connectionId: -1, accountId: account }), { error: 'bad_connection' });
});

test('hosting: the grant is the asked one, then the target, then a project client, then one named after the project', () => {
  const school = { id: 8, email: 'petekkoleji2023@gmail.com', accounts: [{ id: 'a', name: "Petekkoleji2023@gmail.com's Account" }], onProject: false };
  const other = { id: 1, email: 'altermalipetek@gmail.com', accounts: [{ id: 'b', name: 'x' }], onProject: false };
  const client = { ...other, id: 3, onProject: true };
  assert.equal(pickConnection([other, school], { slug: 'petekkoleji' })?.id, 8);
  assert.equal(pickConnection([other, school, client], { slug: 'petekkoleji' })?.id, 3);
  assert.equal(pickConnection([other, school], { slug: 'petekkoleji', requested: 1 })?.id, 1);
  assert.equal(pickConnection([other, school], { slug: 'petekkoleji', target: { provider: 'cloudflare', kind: 'workers', name: 'x', productionBranch: 'main', connectionId: 1, accountId: 'b' } })?.id, 1);
  assert.equal(pickConnection([other], { slug: 'demo-bakery' }), null);
});
