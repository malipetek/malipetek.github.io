#!/usr/bin/env node
// Read-only: never submits a message. Build first, then start the local Worker:
// pnpm exec wrangler dev --local --port 4338
// CONTRACTING_QA_URL=http://127.0.0.1:4338 node scripts/check-contracting.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const origin = process.env.CONTRACTING_QA_URL || 'http://127.0.0.1:4338';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const output = '.impeccable/contracting-qa';
await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.addInitScript(() => {
    addEventListener('pagereveal', (event) => {
      if (!event.viewTransition) return;
      window.__contractingTransition = 'pending';
      event.viewTransition.ready.then(
        () => { window.__contractingTransition = 'ready'; },
        (error) => { window.__contractingTransition = String(error); },
      );
    });
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // No third-party requests or live API calls during this local visual pass.
  await context.route('**/*', (route) => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/contact', '/agents', '/de-DE/contact', '/de-DE/agents', '/privacy-policy', '/terms-of-service', '/404']) {
      await page.goto(origin + path);
      await page.locator('main h1').waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('main').count(), 1, `${path}: one main landmark`);
      const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return el.checkVisibility() && box.width && box.right > innerWidth + 1
          && style.position !== 'absolute' && !el.closest('pre');
      }).map((el) => `${el.tagName}.${el.className}`).slice(0, 8));
      assert.deepEqual(overflow, [], `${width}px ${path}: no content overflow`);
      await page.screenshot({ path: `${output}/${width}-${path.slice(1).replaceAll('/', '-')}.png` });
    }
  }
  await page.goto(origin + '/contact');
  await page.locator('#cf-name').fill('QA only');
  await page.locator('button[type=submit]').click();
  assert.equal(await page.locator('#cf-email').evaluate((el) => el.validity.valueMissing), true);
  assert.equal(await page.locator('#cf-name').inputValue(), 'QA only');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cf-org');
  await page.locator('.site-nav a[href="/agents"]').click();
  await page.waitForURL(origin + '/agents');
  await page.locator('main h1').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-nav-dir'), 'lateral');
  await page.waitForFunction(() => window.__contractingTransition === 'ready');
  // Cancelled links must not leave a title name behind or change navigation state.
  await page.evaluate(() => {
    const anchor = document.createElement('a');
    anchor.className = 'post-link';
    anchor.href = '/cancelled';
    anchor.textContent = 'QA';
    anchor.addEventListener('click', (event) => event.preventDefault());
    document.querySelector('main').append(anchor);
    anchor.click();
    anchor.remove();
  });
  assert.equal(await page.locator('[style*="shared-title"]').count(), 0);
  await page.locator('.wordmark').click();
  await page.waitForURL(origin + '/');
  await page.locator('main h1').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-nav-dir'), 'back');
  await page.locator('.site-nav a[href="/#how"]').click();
  await page.waitForURL(origin + '/#how');
  assert.equal(await page.locator('html').getAttribute('data-nav-dir'), 'back', 'hash keeps same document');
  await page.waitForFunction(() => Math.abs(document.querySelector('#how').getBoundingClientRect().top - 16) < 2);
  await page.screenshot({ path: `${output}/390-home-how.png` });
  await page.locator('.site-nav a[href="/contact"]').click();
  await page.waitForURL(origin + '/contact');
  await page.locator('main h1').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-nav-dir'), 'forward');
  await page.goBack();
  await page.locator('main h1').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-nav-dir'), 'back');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(origin + '/agents');
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  assert.equal(await page.locator('html').evaluate((el) => getComputedStyle(el).scrollBehavior), 'auto');
  assert.equal(await page.locator('html').getAttribute('data-nav-dir'), null, 'reduced motion has no transition bookkeeping');
  await page.locator('[data-theme-toggle]').click();
  assert.equal(await page.locator('[data-theme-toggle]').getAttribute('aria-pressed'), await page.locator('html').getAttribute('data-theme') === 'dark' ? 'true' : 'false');
  await page.screenshot({ path: `${output}/390-agents-alternate-theme.png` });
  assert.deepEqual(errors, [], 'no browser JavaScript errors');
  console.log('PASS: 14 desktop/mobile surface checks; form validation, keyboard, native direction/history/hash, cancelled links, reduced motion and theme.');
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
}
