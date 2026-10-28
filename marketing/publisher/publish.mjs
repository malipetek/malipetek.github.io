#!/usr/bin/env node
/*
 * The marketplace half of marketing: posts what the admin desk queued, from
 * Ali's own X and LinkedIn browser session.
 *
 * There is no affordable posting API (X wants a monthly fee for write access),
 * so this drives a real Chrome profile instead. That is also why it is not
 * automatic by default: each post waits for a keypress unless --auto is given,
 * and a post the browser refuses is reported failed, never retried silently.
 *
 *   node marketing/publisher/publish.mjs --login       sign in once, then close
 *   node marketing/publisher/publish.mjs               post what is due, ask first
 *   node marketing/publisher/publish.mjs --auto        post without asking
 *   node marketing/publisher/publish.mjs --dry-run     show what is due
 *
 * One pass per run; the launchd job runs it every 15 minutes. Chrome only
 * starts when there is something to post, so an idle run is a single request.
 *
 * Env: MARKETING_TOKEN (required), MARKETING_API (defaults to production),
 *      CHROME_PATH (the browser to drive; auto-detected on macOS).
 *
 * Uses the profile in ./.profile, which is gitignored. It is a normal Chrome
 * profile: signing in is a person's action, and automating a service against
 * its terms can get the account restricted. Keep the volume low.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const here = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2).filter((a) => a.startsWith('--') && !a.includes('=')));
const opt = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const API = (process.env.MARKETING_API || 'https://malipetek-intercom.malipetek.workers.dev').replace(/\/+$/, '');
const TOKEN = process.env.MARKETING_TOKEN || '';
const PROFILE = opt('profile', join(here, '.profile'));
const HEADLESS = args.has('--headless');
const AUTO = args.has('--auto');
const DRY = args.has('--dry-run');
const MAX_PER_RUN = 3;
// Across both channels. Organic posts read as spam long before the audience
// complains, and a steady account is worth more than a burst.
const MAX_PER_DAY = 4;
const X_LIMIT = 280;
const LINKEDIN_LIMIT = 3000;

const log = (...parts) => console.log(new Date().toISOString(), ...parts);

/* ——————————————————————— the desk ——————————————————————— */

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new Error(`cannot reach ${API}: ${error?.cause?.message ?? error.message}`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${res.status} ${data?.error ?? 'request failed'}`);
  return data;
}

/* ——————————————————————— browser ——————————————————————— */

/*
 * Chrome started by Playwright is flagged as automated, and Google refuses to
 * sign in to a flagged browser. So start the installed Chrome ourselves — its
 * own profile, its own debugging port — and attach over the DevTools protocol.
 * The page sees an ordinary Chrome; the script just drives it.
 */
const CHROME_PATHS = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchChrome({ headless, profile }) {
  const bin = CHROME_PATHS.find((p) => existsSync(p));
  if (!bin) throw new Error('chrome_not_found: set CHROME_PATH');
  mkdirSync(profile, { recursive: true });
  // Left behind by the last run; a stale port would attach to nothing.
  const portFile = join(profile, 'DevToolsActivePort');
  try {
    unlinkSync(portFile);
  } catch {
    /* none yet */
  }
  const child = spawn(
    bin,
    [
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      // Chrome reports navigator.webdriver whenever a debugging port is open,
      // and Google then refuses to sign in. This stops the self-report; it
      // changes nothing about what the browser can do.
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      ...(headless ? ['--headless=new'] : []),
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    // Chrome hands the page to an already-running instance and exits; that
    // instance has no debugging port, so there is nothing to attach to.
    if (child.exitCode !== null) throw new Error('chrome_already_open: quit the publisher’s Chrome window and retry');
    if (existsSync(portFile)) {
      const port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
      if (Number.isInteger(port) && port > 0) return { child, port };
    }
    await sleep(200);
  }
  child.kill();
  throw new Error('chrome_did_not_start');
}

/** Open the profile's Chrome and attach. Callers must `close()`. */
export async function openBrowser({ headless = HEADLESS, profile = PROFILE } = {}) {
  const { child, port } = await launchChrome({ headless, profile });
  let browser = null;
  for (let i = 0; i < 40 && !browser; i += 1) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
    if (!browser) await sleep(250);
  }
  if (!browser) {
    child.kill();
    throw new Error('chrome_did_not_connect');
  }
  // Over CDP the first context is the real profile, cookies and all.
  const context = browser.contexts()[0] ?? (await browser.newContext());
  return {
    context,
    async close() {
      // Ask Chrome to shut down properly so it flushes the session cookies;
      // the connection usually drops before the reply arrives.
      await browser
        .newBrowserCDPSession()
        .then((session) => session.send('Browser.close'))
        .catch(() => {});
      const exited = await new Promise((done) => {
        if (child.exitCode !== null) return done(true);
        const timer = setTimeout(() => done(false), 4000);
        child.once('exit', () => {
          clearTimeout(timer);
          done(true);
        });
      });
      if (!exited) child.kill();
      await browser.close().catch(() => {});
    },
  };
}

const loggedOut = (url) =>
  /\/login|\/i\/flow\/login|\/i\/jf\/onboarding|\/authwall|\/checkpoint|accounts\.google\.com|[?&]mode=login/.test(url);

async function login() {
  const { context, close } = await openBrowser();
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  await Promise.all([
    pages[0].goto('https://x.com/home', { waitUntil: 'domcontentloaded' }).catch(() => {}),
    pages[1].goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' }).catch(() => {}),
  ]);
  log('Sign in to X and LinkedIn in the windows that opened.');
  log('Google sign-in works here: this is your installed Chrome, not Playwright’s.');
  log('The session lives in', PROFILE, '— it is gitignored and never leaves this machine.');
  await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Press Enter when both are signed in… ', () => {
      rl.close();
      resolve();
    });
  });
  for (const page of pages) {
    log(page.url(), loggedOut(page.url()) ? '— still signed out' : '— signed in');
  }
  await close();
}

async function postX(context, text) {
  if ([...text].length > X_LIMIT) throw new Error(`too_long: ${[...text].length}/${X_LIMIT}`);
  const page = await context.newPage();
  try {
    await page.goto(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    if (loggedOut(page.url())) throw new Error('not_signed_in');

    const button = page.locator('button[data-testid="tweetButtonInline"], button[data-testid="tweetButton"]').first();
    await button.waitFor({ state: 'visible', timeout: 20_000 });
    for (let i = 0; i < 20 && (await button.isDisabled()); i += 1) await page.waitForTimeout(500);
    if (await button.isDisabled()) throw new Error('composer_empty');
    await button.click();
    // The intent flow returns to the timeline; the new post's URL is not
    // reliably addressable, so the result carries no link.
    await page.waitForTimeout(4000);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

async function postLinkedIn(context, text) {
  if ([...text].length > LINKEDIN_LIMIT) throw new Error(`too_long: ${[...text].length}/${LINKEDIN_LIMIT}`);
  const page = await context.newPage();
  try {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    if (loggedOut(page.url())) throw new Error('not_signed_in');

    const start = page
      .locator('button.share-box-feed-entry__trigger, button[aria-label="Start a post"], button:has-text("Start a post")')
      .first();
    await start.waitFor({ state: 'visible', timeout: 20_000 });
    await start.click();

    const dialog = page.locator('div[role="dialog"]').first();
    await dialog.waitFor({ state: 'visible', timeout: 15_000 });
    const editor = dialog.locator('div[contenteditable="true"][role="textbox"]').first();
    await editor.click();
    await page.keyboard.insertText(text);
    await page.waitForTimeout(800);

    const post = dialog.locator('button.share-actions__primary-action, button:has-text("Post")').last();
    await post.waitFor({ state: 'visible', timeout: 10_000 });
    await post.click();
    await dialog.waitFor({ state: 'hidden', timeout: 25_000 });
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

const POSTERS = { x: postX, linkedin: postLinkedIn };

/* ——————————————————————— asking ——————————————————————— */

async function confirm(post) {
  if (AUTO) return true;
  console.log(`\n—— ${post.channel} ——\n${post.text}\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question('Post it? [Y/n] ', resolve));
  rl.close();
  return !/^n/i.test(answer.trim());
}

/* ——————————————————————— the day's budget ——————————————————————— */

const LEDGER = join(here, '.publish.day.json');
const today = () => new Date().toLocaleDateString('en-CA');

function readLedger() {
  try {
    const saved = JSON.parse(readFileSync(LEDGER, 'utf8'));
    if (saved?.day === today()) return Number(saved.posted) || 0;
  } catch {
    /* no ledger yet, or unreadable: today starts at zero */
  }
  return 0;
}

function wroteToday(posted) {
  writeFileSync(LEDGER, JSON.stringify({ day: today(), posted }));
}

/* ——————————————————————— one run ——————————————————————— */

async function runOnce(channels) {
  let browser = null;
  let posted = 0;
  let todayCount = readLedger();
  try {
    if (todayCount >= MAX_PER_DAY) {
      log(`daily budget used (${todayCount}/${MAX_PER_DAY}); leaving the rest for tomorrow`);
      return { posted: 0, signedOut: false };
    }
    for (const channel of channels) {
      if (posted >= MAX_PER_RUN || todayCount >= MAX_PER_DAY) break;
      const { posts } = await api('GET', `/marketing/publisher/posts?channel=${channel}${DRY ? '&dry=1' : ''}`);
      for (const post of posts ?? []) {
        if (posted >= MAX_PER_RUN || todayCount >= MAX_PER_DAY) break;
        log(`${channel} #${post.id}: ${post.text.length} chars`);
        if (DRY) {
          console.log(post.text, '\n');
          continue;
        }
        if (!(await confirm(post))) {
          await api('POST', `/marketing/publisher/posts/${post.id}/result`, { ok: false, error: 'skipped_by_operator' });
          log(`#${post.id} skipped`);
          continue;
        }
        try {
          // Chrome starts on the first real post, not on an idle poll.
          browser = browser ?? (await openBrowser());
          const url = await POSTERS[channel](browser.context, post.text);
          await api('POST', `/marketing/publisher/posts/${post.id}/result`, { ok: true, url });
          posted += 1;
          todayCount += 1;
          wroteToday(todayCount);
          log(`#${post.id} posted`);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          await api('POST', `/marketing/publisher/posts/${post.id}/result`, { ok: false, error: reason });
          log(`#${post.id} failed: ${reason}`);
          if (reason === 'not_signed_in') return { posted, signedOut: true };
        }
      }
    }
    return { posted, signedOut: false };
  } finally {
    await browser?.close();
  }
}

/* ——————————————————————— entry ——————————————————————— */

function takeLock() {
  const path = join(here, '.publish.lock');
  const fresh = () => {
    const fd = openSync(path, 'wx');
    writeSync(fd, String(process.pid));
    closeSync(fd);
  };
  try {
    fresh();
  } catch {
    // A crashed run leaves the file behind; half an hour is long past any run.
    if (existsSync(path) && Date.now() - statSync(path).mtimeMs > 30 * 60_000) {
      unlinkSync(path);
      fresh();
    } else {
      log('Another publisher run holds the lock; exiting.');
      return null;
    }
  }
  return () => {
    try {
      unlinkSync(path);
    } catch {
      /* already gone */
    }
  };
}

async function main() {
  if (args.has('--login')) return login();

  if (!TOKEN) {
    console.error('MARKETING_TOKEN is not set. Put it in marketing/publisher/.env (see .env.example).');
    process.exitCode = 1;
    return;
  }

  const release = takeLock();
  if (!release) return;
  try {
    const requested = opt('channel', '');
    const channels = requested ? [requested] : ['x', 'linkedin'];
    if (channels.some((c) => !POSTERS[c])) {
      console.error('--channel must be x or linkedin.');
      process.exitCode = 1;
      return;
    }

    // Dry runs need no browser: nothing is typed anywhere, and runOnce opens
    // Chrome only when it has a post in hand.
    const { posted, signedOut } = await runOnce(channels);
    log(`${posted} posted${DRY ? ' (dry run)' : ''}`);
    if (signedOut) {
      console.error('A channel is signed out. Run `node marketing/publisher/publish.mjs --login`, then retry from the desk.');
      process.exitCode = 2;
    }
  } finally {
    release();
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
