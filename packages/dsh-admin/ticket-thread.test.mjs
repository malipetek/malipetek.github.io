import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareThread, pullThread, threadFolder, threadState } from './ticket-thread.mjs';

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

/** A remote with main, preview and a ticket branch carrying the client agent's commit. */
function remote(t) {
  const base = mkdtempSync(join(tmpdir(), 'thread-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const work = join(base, 'work');
  mkdirSync(join(work, 'src/pages'), { recursive: true });
  writeFileSync(join(work, 'package.json'), '{"name":"liftor"}');
  writeFileSync(join(work, 'src/pages/index.astro'), '<h1>Built to lift.</h1>');
  sh(base, 'init', '-q', '-b', 'main', work);
  sh(work, 'add', '.');
  sh(work, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'site');
  sh(work, 'branch', 'preview');
  sh(work, 'checkout', '-q', '-b', 'malipetek/ticket-7');
  writeFileSync(join(work, 'src/pages/index.astro'), '<h1 class="orange">Built to lift.</h1>');
  sh(work, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'ChatGPT: orange headline');
  sh(work, 'checkout', '-q', 'main');
  const bare = join(base, 'remote.git');
  sh(base, 'clone', '-q', '--bare', work, bare);
  // Serve partial clones like GitHub does, so a history-only folder really lacks file contents.
  sh(bare, 'config', 'uploadpack.allowFilter', 'true');
  sh(bare, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  return { base, repo: `file://${bare}`, root: join(base, 'threads') };
}

test('a ticket folder is named for its project and ticket, and refuses odd input', () => {
  assert.equal(threadFolder('/r', 'liftor-co', 910047), '/r/liftor-co-ticket-910047');
  assert.equal(threadFolder('/r', '../etc', 1), null);
  assert.equal(threadFolder('/r', 'ok', -3), null);
});

test('prepare makes a history-only clone on the ticket branch: graph yes, site files no', async (t) => {
  const { repo, root } = remote(t);
  const out = await prepareThread({ root, slug: 'liftor-co', ticketId: 7, repo });
  assert.equal(out.state, 'history');
  assert.equal(out.branch, 'malipetek/ticket-7');
  assert.equal(sh(out.dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'malipetek/ticket-7');
  assert.match(sh(out.dir, 'log', '--oneline', '-1'), /ChatGPT: orange headline/);
  assert.ok(existsSync(join(out.dir, 'package.json')), 'top-level files are there');
  assert.ok(!existsSync(join(out.dir, 'src/pages/index.astro')), 'the site itself is not checked out yet');
  assert.equal(await threadState(out.dir), 'history');
});

test('pull checks the whole branch out and unlocks the folder', async (t) => {
  const { repo, root } = remote(t);
  const { dir } = await prepareThread({ root, slug: 'liftor-co', ticketId: 7, repo });
  const pulled = await pullThread(dir);
  assert.equal(pulled.state, 'checkout');
  assert.match(execFileSync('cat', [join(dir, 'src/pages/index.astro')]).toString(), /orange/);
  assert.equal(await threadState(dir), 'checkout');
});

test('a ticket without its own branch starts on preview', async (t) => {
  const { repo, root } = remote(t);
  const out = await prepareThread({ root, slug: 'liftor-co', ticketId: 8, repo });
  assert.equal(out.branch, 'preview');
});

test('preparing twice keeps the same folder and state', async (t) => {
  const { repo, root } = remote(t);
  const first = await prepareThread({ root, slug: 'liftor-co', ticketId: 7, repo });
  const second = await prepareThread({ root, slug: 'liftor-co', ticketId: 7, repo });
  assert.equal(second.dir, first.dir);
  assert.equal(second.state, 'history');
});

test('no repo: an empty folder, still a chat, nothing to lock', async (t) => {
  const { root } = remote(t);
  const out = await prepareThread({ root, slug: 'notes', ticketId: 9, repo: null });
  assert.equal(out.state, 'none');
  assert.ok(existsSync(out.dir));
});

test('once one ticket of a project is pulled, its other tickets open pulled too', async (t) => {
  const { repo, root } = remote(t);
  const first = await prepareThread({ root, slug: 'liftor-co', ticketId: 7, repo });
  const waiting = await prepareThread({ root, slug: 'liftor-co', ticketId: 8, repo });
  assert.equal(waiting.state, 'history', 'nothing is pulled yet');
  await pullThread(first.dir);

  // A ticket opened after the pull starts as a full checkout of its own branch.
  const fresh = await prepareThread({ root, slug: 'liftor-co', ticketId: 9, repo });
  assert.equal(fresh.state, 'checkout');
  assert.equal(fresh.branch, 'preview');
  assert.ok(existsSync(join(fresh.dir, 'src/pages/index.astro')));
  assert.ok(!existsSync(join(fresh.dir, '.git/objects/info/alternates')), 'no lasting link to the sibling folder');

  // One opened before the pull catches up when it is opened again.
  const again = await prepareThread({ root, slug: 'liftor-co', ticketId: 8, repo });
  assert.equal(again.state, 'checkout');
  assert.ok(existsSync(join(waiting.dir, 'src/pages/index.astro')));

  // Another project is not affected.
  const other = await prepareThread({ root, slug: 'other-co', ticketId: 7, repo });
  assert.equal(other.state, 'history');
});

test('a project token reaches git only through the environment, and the askpass file is gone afterwards', async () => {
  const calls = [];
  const fake = async (args, options) => { calls.push({ args, options }); return { code: 0, stdout: '', stderr: '' }; };
  const { withRepoToken } = await import('./ticket-thread.mjs');
  let askpass;
  await withRepoToken('ghs_secret', async (git) => {
    await git(['ls-remote', 'origin'], { cwd: '/tmp' });
    askpass = calls[0].options.env.GIT_ASKPASS;
    assert.ok(existsSync(askpass), 'askpass exists while git runs');
  }, fake);
  assert.deepEqual(calls[0].args, ['-c', 'credential.helper=', 'ls-remote', 'origin']);
  assert.equal(calls[0].options.env.PTECH_GIT_TOKEN, 'ghs_secret');
  assert.ok(!calls[0].args.join(' ').includes('ghs_secret'), 'never in argv');
  assert.ok(!existsSync(askpass), 'askpass removed');
  calls.length = 0;
  await withRepoToken(null, (git) => git(['status'], {}), fake);
  assert.deepEqual(calls[0].args, ['status'], 'no token: plain git');
});
