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
