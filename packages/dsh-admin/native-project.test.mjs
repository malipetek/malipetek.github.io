import test from 'node:test';
import assert from 'node:assert/strict';
import { openLocalProject } from './native-project.mjs';

test('native session adopts the exact checkout before creating and selecting session', async () => {
  const calls = [];
  const result = await openLocalProject({ projectId: '7' }, {
    info: async args => { calls.push(['authorize', args]); return { exists: true, path: '/checkout' }; },
    sessions: { create: async args => { calls.push(['session', args]); return 's1'; } },
    workspace: { openSession: async id => { calls.push(['open', id]); } },
    remote: { workspace: { create: async args => { calls.push(['adopt', args]); return { ok: true, value: { workspace: { workspaceId: 'w1' } } }; } } },
  });
  assert.deepEqual(calls, [['authorize', { projectId: '7' }], ['adopt', { path: '/checkout' }], ['session', { workspaceId: 'w1' }], ['open', 's1']]);
  assert.equal(result.sessionId, 's1');
});
test('no native service or failed adoption produces no pretend success', async () => {
  const info = async () => ({ exists: true, path: '/checkout' });
  await assert.rejects(openLocalProject({ projectId: '7' }, { info, remote: {} }), /unavailable/);
  await assert.rejects(openLocalProject({ projectId: '7' }, { info, sessions: { create: () => assert.fail() }, workspace: { openSession() {} }, remote: { workspace: { create: async () => ({ ok: false, error: { message: 'adoption refused' } }) } } }), /adoption refused/);
});
test('reveal and app use the native desktop path contract after project authorization', async () => {
  const calls = [];
  const deps = { info: async () => ({ exists: true, path: '/checkout' }), remote: { session: { openWorkspacePath: async args => { calls.push(args); return { ok: true, value: { opened: true } }; } } } };
  await openLocalProject({ projectId: '7', mode: 'reveal' }, deps);
  await openLocalProject({ projectId: '7', mode: 'app', appId: 'com.editor' }, deps);
  assert.deepEqual(calls, [{ path: '/checkout', action: 'reveal' }, { path: '/checkout', application: 'com.editor' }]);
  await assert.rejects(openLocalProject({ projectId: '7', mode: 'bad' }, deps));
});
