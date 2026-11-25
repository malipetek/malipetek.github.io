import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { groupFleetRuns } from './index.js';

/** A registry that records what the pass asked of it, and signals the first create. */
function fakeRegistry(headers) {
  const calls = [];
  let done;
  const created = new Promise((resolve) => { done = resolve; });
  const registry = {
    listStoredHeaders: async () => headers,
    create: async (folder, title) => {
      calls.push(['create', folder, title]);
      done();
      return {
        sessionIds: [],
        attachSession: async (id) => calls.push(['attach', id]),
      };
    },
  };
  return { registry, calls, created };
}

test('the superagent folder becomes a workspace and keeps its conversations', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'superagent-ws-'));
  const { registry, calls, created } = fakeRegistry([
    { id: 'inside', cwd: folder },
    { id: 'outside', cwd: '/somewhere/else' },
  ]);
  const stop = groupFleetRuns(registry, { superagentFolder: folder, runsFile: path.join(folder, 'no-runs.json') });
  await created;
  stop();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls[0], ['create', folder, 'Superagent']);
  assert.deepEqual(calls.filter(([kind]) => kind === 'attach'), [['attach', 'inside']]);
});

test('a registry that cannot create is left alone', async () => {
  const stop = groupFleetRuns({}, { superagentFolder: '/tmp/never', runsFile: '/tmp/never-runs.json' });
  assert.equal(typeof stop, 'function');
  stop();
});
