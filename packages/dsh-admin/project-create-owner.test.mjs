import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * Rule 2 (docs/product/RULES.md): a project's credentials come only from its
 * owner, so the directory's create_project carries the owner through the same
 * POST /admin/projects the panel sends — and sends no ownerUserId for an
 * internal project.
 */
test('admin_directory create_project sends ownerUserId only when an owner is given', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'project-create-owner-test-'));
  const oldHome = process.env.DSH_HOME;
  const oldFetch = globalThis.fetch;
  process.env.DSH_HOME = root;
  t.after(async () => {
    globalThis.fetch = oldFetch;
    if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome;
    const actual = await realpath(root);
    assert.ok(actual.includes('/project-create-owner-test-'));
    await rm(actual, { recursive: true });
  });
  const { apply } = await import(`./index.js?create-owner-test=${Date.now()}`);
  const tools = new Map();
  apply({
    inject() {},
    tools: { register(tool) { tools.set(tool.name, tool); return () => {}; } },
    effect(fn, name) { if (name === 'admin: admin_directory tool') fn(); },
  });
  const directory = tools.get('admin_directory');
  assert.ok(directory, 'admin_directory registered');
  await mkdir(join(root, 'admin'), { recursive: true });
  await writeFile(join(root, 'admin', 'config.json'), JSON.stringify({ endpoint: 'https://portal.invalid', token: 'test-current-session' }));
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'p1', name: 'Bakery', slug: 'bakery' }), { status: 201 });
    return new Response(JSON.stringify({ tickets: [], clients: [], projects: [] }), { status: 200 });
  };

  const owned = await directory.execute({ action: 'create_project', name: 'Bakery', slug: 'BAKERY', owner: ' it@petekkoleji.com ' });
  assert.match(owned.message, /Created project Bakery \(bakery\), owned by it@petekkoleji\.com\./);
  const post = calls.find((c) => c.init?.method === 'POST');
  assert.equal(post.url, 'https://portal.invalid/admin/projects');
  assert.equal(post.init.headers.authorization, 'Bearer test-current-session');
  assert.deepEqual(JSON.parse(post.init.body), { name: 'Bakery', slug: 'bakery', ownerUserId: 'it@petekkoleji.com' });

  calls.length = 0;
  const internal = await directory.execute({ action: 'create_project', name: 'Internal', slug: 'internal' });
  assert.match(internal.message, /Created project Bakery \(bakery\)\./);
  const second = calls.find((c) => c.init?.method === 'POST');
  assert.deepEqual(JSON.parse(second.init.body), { name: 'Internal', slug: 'internal' });
});
