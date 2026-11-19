import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { apply } from './index.js';
import { graphBody, graphEligibility } from './src/conversation-git-graph.mjs';

test('native tab renders a fallback without a provider and keys the mounted provider by exact session', () => {
  const View = ({ sessionId }) => `Provider session ${sessionId}`;
  assert.match(renderToStaticMarkup(graphBody('session/A', undefined, 'ready')), /Git Graph is unavailable/);
  assert.match(renderToStaticMarkup(graphBody('session/A', View, 'no-repo')), /No Git repository/);
  const first = graphBody('session/A', View, 'ready');
  const second = graphBody('session/B', View, 'ready');
  assert.equal(first.type, View);
  assert.equal(first.key, 'session/A');
  assert.equal(second.key, 'session/B');
  assert.match(renderToStaticMarkup(first), /Provider session session\/A/);
  assert.match(renderToStaticMarkup(second), /Provider session session\/B/);
});

test('eligibility request uses the exact session, never a cwd, credentials, or a session command', async () => {
  const signal = new AbortController().signal;
  const requests = [];
  const fetcher = async (...args) => { requests.push(args); return Response.json({ status: 'no-repo' }); };
  assert.equal(await graphEligibility('session/A', signal, fetcher), 'no-repo');
  assert.deepEqual(requests, [['api/admin/command', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: '{"operation":"git-graph-eligibility","sessionId":"session/A"}', signal,
  }]]);
  assert.equal(await graphEligibility('session/B', signal, async () => Response.json({ status: 'ready' }, { status: 500 })), 'unavailable');
});

async function fixtures(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'admin-native-graph-test-')));
  assert.equal(root.startsWith(`${await realpath(tmpdir())}/admin-native-graph-test-`), true);
  t.after(() => rm(root, { recursive: true }));
  const repo = join(root, 'repo');
  const worktree = join(root, 'worktree');
  const plain = join(root, 'plain');
  const group = join(root, 'group');
  await Promise.all([mkdir(plain), mkdir(group)]);
  const git = (...args) => execFileSync('git', args, { stdio: 'pipe' });
  git('init', '-q', repo);
  git('-C', repo, '-c', 'user.email=test@example.invalid', '-c', 'user.name=Test', '-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture', '--allow-empty');
  git('-C', repo, 'worktree', 'add', '-q', '--detach', worktree);
  git('init', '-q', join(group, 'child'));
  const subdirectory = join(repo, 'child');
  await mkdir(subdirectory);
  return { root, repo, worktree, plain, group, subdirectory };
}

function getRoute(sessions) {
  const routes = new Map();
  const scoped = {
    connection: { fetch: { register(route) { routes.set(route.path, route); return () => {}; } } },
    sessions,
    effect(fn) { fn(); },
  };
  apply({ sessions, inject(deps, fn) { if (deps.includes('connection')) fn(scoped); }, effect() {} });
  const route = routes.get('/api/admin/command');
  assert.ok(route, 'use the existing authenticated Admin route');
  return async (id, other = {}) => {
    const body = { operation: 'git-graph-eligibility', ...(id === null ? {} : { sessionId: id }), ...other };
    const res = await route.fetch(new Request('https://desktop.invalid/api/admin/command', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
    assert.equal(res.headers.get('cache-control'), 'no-store');
    return [res.status, await res.json()];
  };
}

test('native Git Graph inspects only the requested session and ignores caller repo hints', async t => {
  const { repo, worktree, plain, group, subdirectory } = await fixtures(t);
  const ids = [];
  const live = new Map(Object.entries({ repo, 'work/tree': worktree, plain, group, subdirectory })
    .map(([id, cwd]) => [id, { header: { cwd } }]));
  const get = getRoute({ get(id) {
    ids.push(id);
    return live.get(id);
  } });
  assert.deepEqual(await get('repo'), [200, { status: 'ready' }]);
  assert.deepEqual(await get('work/tree'), [200, { status: 'ready' }]);
  assert.deepEqual(await get('plain', { cwd: repo, repo: worktree }), [200, { status: 'no-repo' }]);
  assert.deepEqual(await get('group'), [200, { status: 'ready' }]);
  // The installed bridge only selects the cwd itself or a repo below it, not an ancestor.
  assert.deepEqual(await get('subdirectory'), [200, { status: 'no-repo' }]);
  assert.deepEqual(await get('deleted'), [404, { status: 'unavailable' }]);
  assert.deepEqual(await get(null), [400, { status: 'unavailable' }]);
  assert.deepEqual(ids, ['repo', 'repo', 'work/tree', 'work/tree', 'plain', 'plain', 'group', 'group', 'subdirectory', 'subdirectory', 'deleted']);
});

test('a session removed during the probe cannot approve a graph page', async t => {
  const { repo } = await fixtures(t);
  const live = new Map([['current', { header: { cwd: repo } }]]);
  const get = getRoute({ get(id) {
    const session = live.get(id);
    live.delete(id);
    return session;
  } });
  assert.deepEqual(await get('current'), [404, { status: 'unavailable' }]);
});

test('a bridge override cannot substitute another checkout', async t => {
  const { repo, worktree } = await fixtures(t);
  const saved = process.env.DSH_GIT_GRAPH_NATIVE_FOLDER;
  t.after(() => {
    if (saved === undefined) delete process.env.DSH_GIT_GRAPH_NATIVE_FOLDER;
    else process.env.DSH_GIT_GRAPH_NATIVE_FOLDER = saved;
  });
  process.env.DSH_GIT_GRAPH_NATIVE_FOLDER = repo;
  const get = getRoute({ get: () => ({ header: { cwd: worktree } }) });
  assert.deepEqual(await get('current'), [200, { status: 'unavailable' }]);
});
