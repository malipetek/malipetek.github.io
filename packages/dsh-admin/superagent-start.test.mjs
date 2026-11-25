import assert from 'node:assert/strict';
import test from 'node:test';

import { startSuperagent } from './superagent-start.mjs';

/** A Sessions service that records what the panel asked of it. */
function fakeSessions({ promptResult = { ok: true }, readyRejects = false, renameRejects = false } = {}) {
  const calls = [];
  const sessions = {
    create: async (opts) => { calls.push(['create', opts]); return 'session-1'; },
    retain: (id, opts) => {
      calls.push(['retain', id, opts]);
      return {
        ready: readyRejects ? Promise.reject(new Error('open failed')) : Promise.resolve({}),
        binding: {
          session: {
            prompt: async (content, mode) => { calls.push(['prompt', content, mode]); return promptResult; },
            rename: async (title) => {
              calls.push(['rename', title]);
              if (renameRejects) throw new Error('rename failed');
              return { ok: true, title };
            },
          },
        },
        release: () => calls.push(['release']),
      };
    },
  };
  return { sessions, calls };
}

test('creates a session, sends the brief, opens it, releases the reference', async () => {
  const { sessions, calls } = fakeSessions();
  const opened = [];
  const remembered = [];
  const id = await startSuperagent({
    sessions,
    brief: 'Which previews are waiting?',
    open: (sessionId) => opened.push(sessionId),
    remember: (sessionId) => remembered.push(sessionId),
  });
  assert.equal(id, 'session-1');
  assert.deepEqual(calls, [
    ['create', {}],
    ['retain', 'session-1', { source: 'workspaceOperation' }],
    ['prompt', [{ type: 'text', text: 'Which previews are waiting?' }], 'queue'],
    ['release'],
  ]);
  assert.deepEqual(opened, ['session-1']);
  assert.deepEqual(remembered, ['session-1']);
});

test('a host without the Sessions service says so', async () => {
  await assert.rejects(startSuperagent({ brief: 'x' }), /cannot start a conversation/);
});

test('a rejected prompt releases the reference and opens nothing', async () => {
  const { sessions, calls } = fakeSessions({ promptResult: { ok: false, error: { message: 'busy' } } });
  const opened = [];
  const remembered = [];
  await assert.rejects(
    startSuperagent({ sessions, brief: 'x', open: (id) => opened.push(id), remember: (id) => remembered.push(id) }),
    /busy/,
  );
  assert.deepEqual(calls.at(-1), ['release']);
  assert.deepEqual(opened, []);
  assert.deepEqual(remembered, []);
});

test('a conversation that will not open still releases its reference', async () => {
  const { sessions, calls } = fakeSessions({ readyRejects: true });
  await assert.rejects(startSuperagent({ sessions, brief: 'x' }), /open failed/);
  assert.deepEqual(calls.at(-1), ['release']);
});

test('a host without a main view still sends the brief', async () => {
  const { sessions } = fakeSessions();
  assert.equal(await startSuperagent({ sessions, brief: 'x' }), 'session-1');
});

test('names the conversation so its first line is not the title', async () => {
  const { sessions, calls } = fakeSessions();
  await startSuperagent({ sessions, brief: 'x', title: 'Superagent · whole system' });
  assert.deepEqual(calls.filter(([kind]) => kind === 'rename'), [['rename', 'Superagent · whole system']]);
});

test('a failed rename still starts the conversation', async () => {
  const { sessions } = fakeSessions({ renameRejects: true });
  assert.equal(await startSuperagent({ sessions, brief: 'x', title: 'Superagent' }), 'session-1');
});
