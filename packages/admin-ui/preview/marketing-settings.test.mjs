#!/usr/bin/env node
/*
 * The Marketing settings form, in a real browser.
 *
 *   node packages/admin-ui/preview/marketing-settings.test.mjs
 *
 * esbuild-bundles the real MarketingSettings over a fixture api (every read
 * builds a fresh settings object, like the Worker's), serves it, and drives it
 * with Chrome through playwright-core. Covers:
 *
 *   1. the three groups switch the visible panels;
 *   2. an edit survives re-rendering and switching group — the regression was
 *      a fresh settings object wiping the draft in progress;
 *   3. Save sends only the changed field, then rests;
 *   4. a field the Worker rejects keeps its edit and says so;
 *   5. the page throws nothing.
 *
 * Skips (exit 0, one loud line) when no Chrome or Edge is installed.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/* ——————————————————————— harness ——————————————————————— */

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? `\n       ${detail}` : ''}`);
}

const freePort = () =>
  new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function launch() {
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      /* try the next */
    }
  }
  return null;
}

/* ——————————————————————— run ——————————————————————— */

const { build } = await import(createRequire(require.resolve('astro/package.json')).resolve('esbuild'));
const tmp = await mkdtemp(path.join(os.tmpdir(), 'marketing-settings-'));
await build({
  entryPoints: [path.join(here, 'marketing-settings.entry.jsx')],
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  outfile: path.join(tmp, 'bundle.js'),
  logLevel: 'silent',
});

const port = await freePort();
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="./bundle.js"></script></body></html>');
    } else if (req.url === '/bundle.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(await readFile(path.join(tmp, 'bundle.js')));
    } else {
      res.writeHead(404);
      res.end('nope');
    }
  } catch {
    res.writeHead(500);
    res.end();
  }
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));

const browser = await launch();
if (!browser) {
  console.log('SKIP  marketing settings: no Chrome or Edge on this machine to drive it');
  server.close();
  process.exit(0);
}
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('.aw-view', { timeout: 15_000 });
  await page.waitForTimeout(300);

  const group = (name) => page.locator('.aw-settings-form__head .aw-seg button', { hasText: name }).first();
  const panels = () => page.$$eval('.aw-view .aw-panel', (els) => els.filter((e) => e.offsetParent !== null).map((e) => e.querySelector('h2,h3')?.textContent.trim() ?? '(panel)'));
  const fromName = () => page.locator('.aw-panel .aw-field', { hasText: 'From name' }).first().locator('input');
  const saveButton = () => page.locator('.ui-savebar .ui-btn--primary').first();
  const saveBar = () => page.locator('.ui-savebar');
  const calls = () => page.evaluate(() => window.__calls ?? []);

  /* 1 — the form opens on Sending, with the saved value. */
  const sending = await panels();
  check('the form opens on the Sending group', sending.includes('Sender') && sending.includes('Schedule and volume'), JSON.stringify(sending));
  check('the From name carries the saved value', (await fromName().inputValue()) === 'Ali Petek', await fromName().inputValue());

  /* 2 — switching group swaps the panels. */
  await group('Safety').click();
  await page.waitForTimeout(120);
  const safety = await panels();
  await group('Content').click();
  await page.waitForTimeout(120);
  const content = await panels();
  check('the Safety group shows its own panels', safety.includes('Safety') && safety.includes('Experiment'), JSON.stringify(safety));
  check('the Content group shows its own panels', content.includes('Posts') && content.includes('Email look'), JSON.stringify(content));
  await group('Sending').click();
  await page.waitForTimeout(120);
  check('back on Sending', (await panels()).includes('Sender'), JSON.stringify(await panels()));

  /* 3 — an edit takes, marks the bar dirty, and survives switching group. */
  await fromName().fill('Ali P.');
  await page.waitForTimeout(150);
  check('the edit takes', (await fromName().inputValue()) === 'Ali P.', await fromName().inputValue());
  check('the edit marks the form dirty', (await saveButton().isDisabled()) === false, 'Save is disabled after an edit');
  await group('Safety').click();
  await page.waitForTimeout(120);
  await group('Sending').click();
  await page.waitForTimeout(120);
  check('the edit survives leaving and returning to the group', (await fromName().inputValue()) === 'Ali P.', await fromName().inputValue());

  /* 4 — Save sends only the changed field, then the bar rests. */
  await saveButton().click();
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() => window.__lastPut ?? null);
  check('Save sends only the changed field', JSON.stringify(saved) === JSON.stringify({ fromName: 'Ali P.' }), JSON.stringify(saved));
  check('the save bar rests after saving', (await saveBar().count()) === 0, 'the save bar is still showing');
  check('the saved value stays in the field', (await fromName().inputValue()) === 'Ali P.', await fromName().inputValue());

  /* 5 — a rejected field keeps its edit and says why. */
  await fromName().fill('REJECT ME');
  await page.waitForTimeout(120);
  await saveButton().click();
  await page.waitForTimeout(400);
  const message = await saveBar().locator('.ui-savebar__msg').textContent();
  check('a rejected field keeps the edit', (await fromName().inputValue()) === 'REJECT ME', await fromName().inputValue());
  check('a rejected field is named in the bar', /fromName/.test(message ?? ''), message ?? '(no message)');

  check('no page errors', errors.length === 0, errors.join('\n'));
} catch (e) {
  check('the harness itself ran', false, String(e));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
