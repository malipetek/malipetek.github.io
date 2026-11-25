import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SOURCE_LIMITS, sourceManifest } from './source.mjs';

function project({ git = true, store = 600 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'source-'));
  const put = (rel, body = `// ${rel}\n`) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), body); };
  put('package.json', '{"name":"liftor"}');
  put('astro.config.mjs');
  put('src/pages/index.astro', '<h1>Built to lift.</h1>');
  put('src/styles/global.css', 'h1 { color: black; }');
  put('dist/index.html', '<h1>built</h1>');
  if (git) {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: dir });
  }
  // pnpm's store inside the project, untracked and not ignored: what the Liftor Co. node had.
  for (let i = 0; i < store; i += 1) put(`.pnpm-store/v10/files/${String(i % 100).padStart(2, '0')}/${i}`, `cache ${i}`);
  return dir;
}

test('a package cache in the project never crowds out the real source (git worktree)', (t) => {
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { files, dropped } = sourceManifest(dir, 'dist');
  const paths = files.map((f) => f.path).sort();
  assert.deepEqual(paths, ['astro.config.mjs', 'package.json', 'src/pages/index.astro', 'src/styles/global.css']);
  assert.equal(dropped, 0);
  assert.ok(files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256) && f.size === f.buf.length));
});

test('without git, the walk skips the same cache folders and the build output', (t) => {
  const dir = project({ git: false });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const paths = sourceManifest(dir, 'dist').files.map((f) => f.path).sort();
  assert.deepEqual(paths, ['astro.config.mjs', 'package.json', 'src/pages/index.astro', 'src/styles/global.css']);
});

test('over the cap, deep files are dropped first and the count is reported', (t) => {
  const dir = project({ git: false, store: 0 });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (let i = 0; i < SOURCE_LIMITS.files + 20; i += 1) {
    mkdirSync(join(dir, 'src/content/posts'), { recursive: true });
    writeFileSync(join(dir, `src/content/posts/p${i}.md`), `post ${i}`);
  }
  const { files, dropped } = sourceManifest(dir, 'dist');
  const paths = files.map((f) => f.path);
  assert.equal(files.length, SOURCE_LIMITS.files);
  assert.equal(dropped, 24); // 520 posts + the 4 real files, 500 kept
  for (const keep of ['package.json', 'astro.config.mjs', 'src/pages/index.astro', 'src/styles/global.css']) assert.ok(paths.includes(keep), keep);
});
