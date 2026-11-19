import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { setImmediate } from 'node:timers/promises';
import { createLocalProjects, sanitizeRemote, repositoryUrl } from './local-project.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'project-local-test-'));
  t.after(async () => { assert.ok(root.startsWith(join(tmpdir(), 'project-local-test-'))); await rm(root, { recursive: true, force: true }); });
  const repo = join(root, 'checkout'); await mkdir(repo);
  execFileSync('git', ['init', '-q', repo]);
  await writeFile(join(repo, 'hello.txt'), 'one\ntwo\nthree\n');
  let config = { path: repo, verify: 'npm test', baseRef: 'main' };
  const calls = [];
  const service = createLocalProjects({
    authorize: async (id) => { calls.push(id); if (id !== '7') throw new Error('Project access denied.'); return { id: 7, slug: 'sample', repo: 'PTechGroup/sample' }; },
    getLocal: async () => config,
    setLocal: async (_, next) => { config = { ...config, ...next }; },
    gitToken: async () => ({ token: 'never-expose-this', repo: 'PTechGroup/sample' }),
  });
  return { root, repo, service, calls };
}

test('authorized mapped checkout has real git state and bounded line reads', async (t) => {
  const { service } = await fixture(t);
  assert.equal((await service.info({ projectId: '7' })).isGit, true);
  assert.equal((await service.gitInfo({ projectId: '7' })).dirty, true);
  assert.deepEqual(await service.files({ projectId: '7', action: 'read', path: 'hello.txt', range: { startLine: 2, endLine: 2 } }), { path: 'hello.txt', text: 'two', startLine: 2, endLine: 2, truncated: true });
  assert.deepEqual((await service.files({ projectId: '7', action: 'list', path: '' })).entries.map(x => x.name), ['hello.txt']);
});

test('Git info never executes a repository-local clean filter', async (t) => {
  const { service, repo, root } = await fixture(t);
  const run = args => execFileSync('git', ['-C', repo, ...args]);
  await writeFile(join(repo, '.gitattributes'), '*.txt filter=preview-test\n');
  run(['add', '.gitattributes', 'hello.txt']);
  const marker = join(root, 'filter-executed');
  run(['config', 'filter.preview-test.clean', `touch '${marker}'; cat`]);
  await writeFile(join(repo, 'hello.txt'), 'ONE\ntwo\nthree\n');
  const result = await service.gitInfo({ projectId: '7' });
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  assert.equal(result.dirty, null);
  assert.match(result.statusUnavailableReason, /executable Git filters/);
  assert.equal(result.submoduleWorktreesIncluded, false);
  run(['config', '--unset', 'filter.preview-test.clean']);
  run(['config', 'filter.preview-test.process', `touch '${marker}'`]);
  assert.equal((await service.gitInfo({ projectId: '7' })).dirty, null);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});

test('denies authorization, traversal, git internals, symlink escapes and nonregular files', async (t) => {
  const { service, root, repo } = await fixture(t);
  await writeFile(join(root, 'secret'), 'secret');
  await symlink(join(root, 'secret'), join(repo, 'escape'));
  await symlink(join(repo, '.git'), join(repo, 'git-alias'));
  await writeFile(join(repo, '.env'), 'TOKEN=secret');
  await writeFile(join(repo, '.env.production'), 'TOKEN=secret');
  await writeFile(join(repo, 'private.pem'), 'secret');
  for (const path of ['../secret', '/etc/passwd', '.git/config', 'escape', 'git-alias/config', '.env', '.env.production', 'private.pem']) {
    await assert.rejects(service.files({ projectId: '7', action: 'read', path }));
  }
  await assert.rejects(service.files({ projectId: '8', action: 'list', path: '' }), /denied/);
  await assert.rejects(service.files({ projectId: '7', action: 'read', path: '' }));
});

test('file previews enforce text, byte and line bounds', async (t) => {
  const { repo, service } = await fixture(t);
  await writeFile(join(repo, 'binary'), Buffer.from([1, 0, 2]));
  await writeFile(join(repo, 'large'), Buffer.alloc(512 * 1024 + 1, 65));
  await writeFile(join(repo, 'many'), Array.from({ length: 1200 }, (_, i) => String(i)).join('\n'));
  for (const path of ['binary', 'large']) await assert.rejects(service.files({ projectId: '7', action: 'read', path }));
  await assert.rejects(service.files({ projectId: '7', action: 'read', path: 'many', range: { startLine: 1, endLine: 1001 } }));
  const preview = await service.files({ projectId: '7', action: 'read', path: 'many' });
  assert.equal(preview.endLine, 200); assert.equal(preview.truncated, true);
  assert.equal(preview.text.split('\n').length, 200);
});

test('configuration validates selected directory and preserves verify/base ref', async (t) => {
  const { service, repo, root } = await fixture(t);
  await assert.rejects(service.configure({ projectId: '7', path: join(root, 'missing') }));
  const next = await service.configure({ projectId: '7', path: repo });
  assert.equal(next.verify, 'npm test'); assert.equal(next.baseRef, 'main');
});

test('new project folders can be adopted without pretending to be a Git checkout', async (t) => {
  const { service, root } = await fixture(t);
  const folder = join(root, 'new-project'); await mkdir(folder);
  const local = await service.configure({ projectId: '7', path: folder });
  assert.equal(local.exists, true); assert.equal(local.isGit, false);
  assert.equal(local.path, await realpath(folder));
  assert.deepEqual(await service.gitInfo({ projectId: '7' }), { isGit: false, root: await realpath(folder), branch: null, head: null, dirty: null, remotes: [], reviewAvailable: false });
  assert.deepEqual((await service.files({ projectId: '7', action: 'list' })).entries, []);
});

test('clone refuses existing paths and path-shaped names before requesting credentials', async (t) => {
  const { service, root } = await fixture(t);
  await assert.rejects(service.clone({ projectId: '7', parentPath: root, directoryName: 'checkout' }), /exist/i);
  for (const directoryName of ['../other', '/tmp/x', '-option', '.', 'a/b']) {
    await assert.rejects(service.clone({ projectId: '7', parentPath: root, directoryName }));
  }
  await assert.rejects(service.operation({ operationId: 'unknown' }), /operation/i);
});

test('clone uses ephemeral credentials and maps only after a real successful git clone', async (t) => {
  const { root, repo } = await fixture(t);
  const run = promisify(execFile);
  let mapped;
  let authPath;
  const service = createLocalProjects({
    authorize: async () => ({ id: 7, slug: 'cloned' }), getLocal: async () => ({}),
    setLocal: async (_, value) => { mapped = value; },
    gitToken: async () => ({ token: 'never-expose-this', repo: 'PTechGroup/sample' }),
    cloneGit: async (args, options) => {
      assert.ok(!args.join(' ').includes('never-expose-this'));
      assert.equal(options.env.PTECH_GIT_TOKEN, 'never-expose-this');
      authPath = options.env.GIT_ASKPASS;
      assert.ok(!(await readFile(authPath, 'utf8')).includes('never-expose-this'));
      const localArgs = [...args]; localArgs[localArgs.length - 2] = repo;
      await run('git', localArgs, options);
    },
  });
  const { operationId } = await service.clone({ projectId: '7', parentPath: root });
  let result;
  for (let i = 0; i < 10000; i++) { result = await service.operation({ operationId }); if (result.status !== 'running') break; await setImmediate(); }
  assert.equal(result.status, 'succeeded');
  assert.equal(mapped.path, join(await realpath(root), 'cloned'));
  assert.equal(result.receipt.path, mapped.path);
  // Final cleanup follows receipt publication; yield until it completes.
  for (let i = 0; i < 100; i++) { try { await readFile(authPath); await setImmediate(); } catch { break; } }
  await assert.rejects(readFile(authPath));
  assert.ok(!JSON.stringify(result).includes('never-expose-this'));
});

test('clone failures return sanitized recovery receipts without changing mappings', async (t) => {
  const { root } = await fixture(t);
  const service = createLocalProjects({ authorize: async () => ({ id: 7, slug: 'failure' }), getLocal: async () => ({}), setLocal: async () => assert.fail('must not map failed clone'), gitToken: async () => { throw new Error('secret-token-sensitive'); } });
  const { operationId } = await service.clone({ projectId: '7', parentPath: root });
  let result;
  for (let i = 0; i < 100; i++) { result = await service.operation({ operationId }); if (result.status !== 'running') break; await setImmediate(); }
  assert.equal(result.status, 'failed'); assert.match(result.error, /inspect/i); assert.ok(!JSON.stringify(result).includes('secret-token-sensitive'));
});

test('repository metadata cannot introduce credentials or git options', () => {
  assert.equal(repositoryUrl('PTechGroup/sample'), 'https://github.com/PTechGroup/sample.git');
  for (const repo of ['https://token@github.com/a/b', '../repo', '-option', 'a/b/c']) assert.throws(() => repositoryUrl(repo));
  assert.equal(sanitizeRemote('https://user:secret@github.com/a/b.git?token=secret'), 'https://github.com/a/b.git');
  assert.equal(sanitizeRemote('git@github.com:a/b.git'), 'git@github.com:a/b.git');
  assert.equal(sanitizeRemote('ext::sh -c secret'), '[nonstandard remote]');
});
