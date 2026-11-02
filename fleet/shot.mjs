/*
 * A preview screenshot, best effort.
 *
 * Hosted sites get a before/after picture with every run, so the review can
 * show what the client will see instead of describing it. Chrome is on the
 * MacBook (the publisher already drives one); a node without it, or a preview
 * that does not answer, simply has no picture — the run is never blocked.
 */
const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 20_000;

export async function capture(url, { width = 1200, height = 800 } = {}) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return null;
  let browser;
  try {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--hide-scrollbars'] });
    const page = await browser.newPage({ viewport: { width, height } });
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    if (!res || res.status() >= 400) return null;
    // Let fonts, the board and any fade-in settle before the picture.
    await page.waitForTimeout(900);
    const png = await page.screenshot({ type: 'png' });
    if (!png?.length || png.length > MAX_BYTES) return null;
    return { png: png.toString('base64'), url };
  } catch {
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}
