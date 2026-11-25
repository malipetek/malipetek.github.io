#!/usr/bin/env node
/*
 * The marketing settings navigation, in a real browser.
 *
 *   node packages/admin-ui/preview/marketing-settings.test.mjs
 *
 * esbuild-bundles the real MarketingView over a fixture api (each poll answer
 * is a fresh object, like the Worker's), serves it, and drives it with Chrome
 * through playwright-core. Covers the settings area of the desk:
 *
 *   1. clicking a section in the desk navigation switches the visible section;
 *   2. a settings edit survives a 30-second poll tick (the regression:
 *      the draft used to be reset from every fresh overview, so a click on
 *      Live/Paused or a typed edit switched back on its own);
 *   3. the navigation works from the keyboard (Tab and Enter — it is a group
 *      of buttons, not a list, so arrows are not owed);
 *   4. one primary action is visible in the settings area;
 *   5. the outreach control offers the Live/Paused status words.
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
const repo = path.resolve(here, '../../..');
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

// Bundle the real component tree exactly as the hosts bundle it.
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
  console.log('SKIP  marketing settings navigation: no Chrome or Edge on this machine to drive it');
  server.close();
  process.exit(0);
}
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.clock.install({ time: 0 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('.aw-view', { timeout: 15_000 });
  await page.waitForTimeout(400);

  const visiblePanels = () =>
    page.$$eval('.aw-view .aw-panel', (els) =>
      els.filter((e) => e.offsetParent !== null).map((e) => e.querySelector('h2,h3')?.textContent.trim() ?? '(panel)'));

  const settingsPanel = () => page.evaluate(() => {
    const panel = [...document.querySelectorAll('.aw-panel')].find((p) => p.querySelector('h3')?.textContent.trim() === 'Sending');
    if (!panel) return null;
    const seg = panel.querySelector('.aw-seg');
    const fromName = [...panel.querySelectorAll('.aw-field')].find((f) => f.querySelector('.aw-field__label')?.textContent.trim() === 'From name')?.querySelector('input');
    return {
      pressed: [...seg.querySelectorAll('button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()),
      options: [...seg.querySelectorAll('button')].map((b) => b.textContent.trim()),
      fromName: fromName?.value ?? null,
    };
  });

  /* 1 — the desk navigation switches the visible section. */
  const nav = '.aw-toolbar > .aw-seg button';
  const seen = [];
  for (const label of ['Settings', 'Overview', 'Contacts', 'Email', 'Posts', 'Sequences', 'Sources', 'Settings']) {
    await page.locator(nav, { hasText: label }).first().click({ timeout: 5000 });
    await page.waitForTimeout(120);
    seen.push([label, await visiblePanels()]);
  }
  check('clicking Settings switches the visible section', seen[0][1].includes('Sending') && seen[0][1].includes('Written posts'), JSON.stringify(seen[0]));
  check('clicking Overview switches back', seen[1][1].includes('Last 14 days'), JSON.stringify(seen[1]));
  check(
    'every other section switches away from Settings',
    seen.slice(1, 7).every(([, panels]) => !panels.includes('Sending')),
    JSON.stringify(seen.slice(1, 7)),
  );
  check('back on Settings after the walk', seen[7][1].includes('Sending'), JSON.stringify(seen[7]));

  /* 2 — a settings edit survives a 30-second poll tick. */
  const before = await settingsPanel();
  await page.locator('.aw-panel .aw-seg button', { hasText: 'Paused' }).first().click();
  await page.waitForTimeout(100);
  const fromInput = page.locator('.aw-panel .aw-field', { hasText: 'From name' }).first().locator('input');
  await fromInput.fill('Ali P.');
  const afterEdit = await settingsPanel();
  check('clicking Paused switches the selection', afterEdit.pressed.join() === 'Paused', JSON.stringify(afterEdit));
  check('the From name edit takes', afterEdit.fromName === 'Ali P.', JSON.stringify(afterEdit));

  await page.clock.fastForward(32_000);
  await page.waitForTimeout(400);
  const afterPoll = await settingsPanel();
  check('the selection survives a 30-second poll tick', afterPoll.pressed.join() === 'Paused', `after the poll: ${JSON.stringify(afterPoll)}`);
  check('the typed edit survives a 30-second poll tick', afterPoll.fromName === 'Ali P.', `after the poll: ${JSON.stringify(afterPoll)}`);

  /* 3 — keyboard: Tab reaches the navigation, Enter activates a section. */
  await page.locator(nav).first().focus();
  const focusStart = await page.evaluate(() => document.activeElement?.textContent.trim());
  await page.keyboard.press('Tab');
  const focusNext = await page.evaluate(() => document.activeElement?.textContent.trim());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  const panelsAfterEnter = await visiblePanels();
  check(
    'Tab reaches the navigation and Enter switches the visible section',
    Boolean(focusStart) && focusNext !== focusStart && !panelsAfterEnter.includes('Sending'),
    `focus ${focusStart} → ${focusNext}, panels ${JSON.stringify(panelsAfterEnter)}`,
  );

  /* 4 — grammar: one primary action in the settings area. */
  await page.locator(nav, { hasText: 'Settings' }).first().click();
  await page.waitForTimeout(120);
  const primaries = await page.$$eval('.aw-view .aw-btn--primary', (els) => els.filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()));
  check('one primary action in the settings area', primaries.length === 1, `primary buttons: ${JSON.stringify(primaries)}`);

  /* 5 — status words stay words, not sentences. */
  const words = (await settingsPanel())?.options ?? [];
  check('the outreach control offers the Live/Paused status words', words.join('|') === 'Live|Paused', JSON.stringify(words));

  /* 6 — saving lands: the PUT goes out, the draft resyncs, Save rests.
   * (Returning to the Settings tab remounts it — every desk tab is a
   * conditional render — so the edits are applied again here.) */
  await page.locator('.aw-panel .aw-seg button', { hasText: 'Paused' }).first().click();
  await page.locator('.aw-panel .aw-field', { hasText: 'From name' }).first().locator('input').fill('Ali P.');
  await page.locator('.aw-view .aw-btn--primary', { hasText: 'Save' }).first().click();
  await page.waitForTimeout(500);
  const afterSave = await settingsPanel();
  const calls = await page.evaluate(() => window.__calls ?? []);
  const done = await page.evaluate(() => window.__lastDone ?? null);
  const saveDisabled = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.aw-view .aw-btn--primary')].find((e) => e.offsetParent !== null);
    return btn?.disabled ?? null;
  });
  check('saving sends the settings patch', calls.includes('PUT /admin/marketing/settings'), JSON.stringify(calls));
  check('saving keeps the switched selection (now saved)', afterSave.pressed.join() === 'Paused' && afterSave.fromName === 'Ali P.', JSON.stringify(afterSave));
  check('saving reports and rests', done === 'Marketing settings saved.' && saveDisabled === true, `done=${done}, save disabled=${saveDisabled}`);

  /* 7 — a failed save keeps the draft for a retry. */
  await page.locator('.aw-panel .aw-field', { hasText: 'From name' }).first().locator('input').fill('FAIL NOW');
  await page.locator('.aw-view .aw-btn--primary', { hasText: 'Save' }).first().click();
  await page.waitForTimeout(400);
  const afterFail = await settingsPanel();
  const failSaveEnabled = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.aw-view .aw-btn--primary')].find((e) => e.offsetParent !== null);
    return btn?.disabled ?? null;
  });
  check(
    'a failed save keeps the edit for a retry',
    afterFail.fromName === 'FAIL NOW' && failSaveEnabled === false,
    `after the failed save: ${JSON.stringify(afterFail)}, save disabled=${failSaveEnabled}`,
  );
  await page.clock.fastForward(32_000);
  await page.waitForTimeout(400);
  const afterFailPoll = await settingsPanel();
  check('a failed save still shields the edit from the poll', afterFailPoll.fromName === 'FAIL NOW', JSON.stringify(afterFailPoll));

  check('no page errors', errors.length === 0, errors.join('\n'));
} catch (e) {
  check('the harness itself ran', false, String(e));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
