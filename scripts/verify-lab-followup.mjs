// Run after `pnpm build`, with this worktree's Astro dev server on LAB_TEST_URL.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.setContent('<canvas data-signal-strip style="width:800px;height:80px"></canvas><div style="height:3000px"></div>');
  await page.evaluate(() => {
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    window.pending = new Set();
    window.paints = 0;
    window.requestAnimationFrame = (callback) => {
      const id = request((time) => { window.pending.delete(id); callback(time); });
      window.pending.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => { window.pending.delete(id); cancel(id); };
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      window.paints++;
      return clear.apply(this, args);
    };
  });
  const source = stripTypeScriptTypes(await readFile('src/scripts/signal-strip.ts', 'utf8'));
  await page.evaluate(async (code) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const module = await import(url);
    URL.revokeObjectURL(url);
    window.initStrip = module.initSignalStrips;
    window.disposeStrip = window.initStrip();
  }, source);
  const pending = () => page.evaluate(() => window.pending.size);
  await page.waitForFunction(() => window.paints > 2);
  assert.equal(await pending(), 1, 'exactly one active animation loop');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  assert.equal(await pending(), 0, 'live reduced motion cancels RAF');
  const still = await page.locator('canvas').evaluate((canvas) => canvas.toDataURL());
  await page.mouse.move(900, 50);
  await page.waitForTimeout(100);
  assert.equal(await page.locator('canvas').evaluate((canvas) => canvas.toDataURL()), still, 'reduced motion is a still frame');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => window.pending.size === 1);
  await page.evaluate(() => scrollTo(0, 1500));
  await page.waitForFunction(() => window.pending.size === 0);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForFunction(() => window.pending.size === 1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await pending(), 0, 'hidden document cancels RAF');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
  });
  assert.equal(await pending(), 0, 'pagehide pauses cached page');
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await page.waitForFunction(() => window.pending.size === 1);
  await page.evaluate(() => { window.disposeStrip = window.initStrip(); });
  await page.waitForFunction(() => window.pending.size === 1);
  await page.evaluate(() => document.dispatchEvent(new Event('astro:before-swap')));
  assert.equal(await pending(), 0, 'navigation disposes animation');
  const paints = await page.evaluate(() => window.paints);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('resize'));
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.paints), paints, 'disposed listeners and observers stay inactive');
  console.log('PASS signal strip: live reduced motion, static frame, offscreen, visibility, bfcache, re-init, disposal');
  await page.close();

  const origin = process.env.LAB_TEST_URL || 'http://127.0.0.1:4347';
  const routes = ['/experience/truth', '/experience/agent-experience', '/pdfextractor/privacy-policy', '/pdfextractor/terms-of-service', '/privacy-policy', '/terms-of-service'];
  const errors = [];
  for (const width of [1280, 390]) {
    const view = await browser.newPage({ viewport: { width, height: 900 } });
    view.on('pageerror', (error) => errors.push(error.message));
    for (const route of routes) {
      const response = await view.goto(`${origin}${route}`);
      assert.equal(response.status(), 200, route);
      await view.evaluate(() => document.fonts.ready);
      const lab = route.startsWith('/experience/') || route.startsWith('/pdfextractor/');
      assert.equal(await view.locator('article.lab-reading').count(), lab ? 1 : 0, `${route}: lab guard`);
      assert.equal(await view.locator('h1').count(), 1);
      assert(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route}: no overflow at ${width}`);
      if (lab) {
        assert(await view.locator('h1').evaluate((h) => parseFloat(getComputedStyle(h).fontSize) <= 36));
        await view.screenshot({ path: `/tmp/lab-followup-${route.split('/').pop()}-${width}.png` });
      }
      console.log(`PASS ${width}px ${route}: lab guard, heading, overflow`);
    }
    await view.close();
  }
  assert.deepEqual(errors, [], 'no browser runtime errors');
} finally {
  await browser.close();
}
