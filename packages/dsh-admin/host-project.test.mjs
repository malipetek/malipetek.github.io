import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('actual Host registers scoped project tools and routes using the current session', async t => {
  const root = await mkdtemp(join(tmpdir(), 'project-host-test-'));
  const oldHome = process.env.DSH_HOME;
  const oldFetch = globalThis.fetch;
  process.env.DSH_HOME = root;
  t.after(async () => {
    globalThis.fetch = oldFetch;
    if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome;
    const actual = await realpath(root);
    assert.ok(actual.includes('/project-host-test-')); await rm(actual, { recursive: true });
  });
  const { apply } = await import(`./index.js?host-test=${Date.now()}`);
  const tools = new Map();
  apply({ inject() {}, tools: { register(tool) { tools.set(tool.name, tool); return () => {}; } }, effect(fn, name) { if (['admin: local project tool', 'admin: project operations tool'].includes(name)) fn(); } });
  assert.deepEqual([...tools.keys()], ['admin_project_local', 'admin_project_operations']);
  await assert.rejects(tools.get('admin_project_operations').execute({ operation: 'secrets.read', projectId: '7' }), /super_admin_decision_required/);
  // Config is confined to the temporary DSH_HOME; never use a live session.
  await mkdir(join(root, 'admin'), { recursive: true });
  await writeFile(join(root, 'admin', 'config.json'), JSON.stringify({ endpoint: 'https://portal.invalid', token: 'test-current-session' }));
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: '7', name: 'Project' }), { status: 200 }); };
  const result = await tools.get('admin_project_operations').execute({ operation: 'project.read', projectId: '7' });
  assert.equal(result.message, JSON.stringify({ id: '7', name: 'Project' }));
  assert.equal(calls[0].url, 'https://portal.invalid/admin/projects/7');
  assert.equal(calls[0].init.headers.authorization, 'Bearer test-current-session');
  assert.equal(calls[0].init.method, 'GET');
});
