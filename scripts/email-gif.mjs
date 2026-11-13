#!/usr/bin/env node
/*
 * Records the homepage workshop (the conveyor) as a looping GIF for email:
 * public/email/conveyor.gif.
 *
 *   node scripts/email-gif.mjs [url] [--width 560] [--fps 20]
 *
 * The page runs on a clock this script controls (performance.now and
 * requestAnimationFrame are replaced before the page loads), so every frame
 * is an exact moment and the GIF is one belt cycle: six tickets at 0.045
 * belt-lengths a second move one slot in 1 / (0.045 * 6) seconds, and the
 * last frame hands over to the first. Needs Google Chrome and ffmpeg.
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = args.find((a) => /^https?:/.test(a)) ?? 'https://malipetek.dev/';
const width = Number(opt('width', 560));
const fps = Number(opt('fps', 20));
const PERIOD = 1 / (0.045 * 6); // seconds per belt slot (workshop3d.ts, the loop's tick)
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public/email/conveyor.gif');

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'no-preference' });

// A clock that only moves when we say so.
await page.addInitScript(() => {
  let now = 0;
  let queue = [];
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => {
    queue.push(cb);
    return queue.length;
  };
  window.cancelAnimationFrame = () => {};
  window.__step = (ms) => {
    now += ms;
    const run = queue;
    queue = [];
    run.forEach((cb) => cb(now));
  };
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__workshopBox);
// Let the camera settle on the first station.
await page.evaluate(() => {
  for (let i = 0; i < 300; i++) window.__step(1000 / 60);
});

const frames = Math.round(PERIOD * fps);
const dir = mkdtempSync(join(tmpdir(), 'email-gif-'));
for (let f = 0; f < frames; f++) {
  // Step and read the canvas in one task, before the browser clears it.
  const data = await page.evaluate(
    ({ ms, width }) => {
      window.__step(ms);
      const gl = document.querySelector('[data-workshop]');
      const box = window.__workshopBox;
      const scale = gl.width / gl.clientWidth;
      // The machine from the request desk to the cloud, labels included
      // (the box is the belt's stage anchors, so the props sit around it).
      const left = box.x - box.width * 0.2;
      const right = box.x + box.width * 1.14;
      const top = box.y - box.height * 1.3;
      const bottom = box.y + box.height * 3.6;
      const sx = Math.max(0, left * scale);
      const sy = Math.max(0, top * scale);
      const sw = Math.min(gl.width - sx, (right - left) * scale);
      const sh = Math.min(gl.height - sy, (bottom - top) * scale);
      const c = document.createElement('canvas');
      c.width = width * 2;
      c.height = Math.round((sh / sw) * width) * 2;
      const g = c.getContext('2d');
      g.fillStyle = getComputedStyle(document.body).backgroundColor || '#ffffff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(gl, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    },
    { ms: (PERIOD * 1000) / frames, width },
  );
  writeFileSync(join(dir, `f${String(f).padStart(3, '0')}.png`), Buffer.from(data.split(',')[1], 'base64'));
}
await browser.close();

mkdirSync(dirname(out), { recursive: true });
// One palette for the whole loop; Bayer dithering keeps flat fills flat (and the file small).
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-framerate', String(fps), '-i', join(dir, 'f%03d.png'),
  '-filter_complex', `scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=48:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
  '-loop', '0', out,
]);
rmSync(dir, { recursive: true, force: true });
console.log(`${out}: ${frames} frames, ${(statSync(out).size / 1024).toFixed(0)} KB`);
