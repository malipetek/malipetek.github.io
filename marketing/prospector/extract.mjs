#!/usr/bin/env node
/*
 * Collects the one public contact address from pages Ali already picked out.
 *
 * It does not search, crawl for links, or guess addresses. You hand it a list
 * of URLs; it reads each page once, honours robots.txt, keeps the address the
 * business publishes for contact, and writes a CSV the Marketing desk imports.
 *
 *   node marketing/prospector/extract.mjs --urls=prospects.txt
 *   node marketing/prospector/extract.mjs --urls=prospects.txt --out=july.csv
 *   cat prospects.txt | node marketing/prospector/extract.mjs
 *
 * The `gap` column is left empty on purpose: every cold email needs one
 * specific observation about that business, and only a person can write it.
 * The desk pauses contacts without one, so nothing goes out half-written.
 *
 * `fetchPage` below is the polite fetch layer; directory.mjs crawls with the
 * same rules instead of growing a second client.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const opt = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const UA = 'MalipetekProspector/1.0 (+https://malipetek.dev/bot)';
const TIMEOUT_MS = 15_000;
const MAX_PAGES = 200;
const HOST_DELAY_MS = 1_500;
const DAY = new Date().toISOString().slice(0, 10);

const log = (...parts) => console.log(...parts);

/* ——————————————————————— robots.txt ——————————————————————— */

/**
 * The rules that apply to us: a group naming this crawler wins over `*`.
 * Only Allow/Disallow/Crawl-delay are read; the rest cannot apply here.
 */
export function parseRobots(text) {
  const groups = [];
  let agents = [];
  let rules = [];
  let delay = 0;
  const flush = () => {
    if (agents.length) groups.push({ agents, rules, delay });
    agents = [];
    rules = [];
    delay = 0;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const index = line.indexOf(':');
    if (index < 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (key === 'user-agent') {
      if (rules.length || delay) flush();
      agents.push(value.toLowerCase());
    } else if (key === 'allow' || key === 'disallow') {
      if (value) rules.push({ allow: key === 'allow', pattern: value });
    } else if (key === 'crawl-delay') {
      delay = Math.max(0, Number(value) || 0);
    }
  }
  flush();
  return groups;
}

function compileRule(pattern) {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}${anchored ? '$' : ''}`);
}

export function robotsFor(groups, agent) {
  const named = groups.find((g) => g.agents.some((a) => a !== '*' && agent.toLowerCase().startsWith(a)));
  const group = named ?? groups.find((g) => g.agents.includes('*'));
  if (!group) return { rules: [], delay: 0 };
  return { rules: group.rules.map((r) => ({ ...r, re: compileRule(r.pattern) })), delay: group.delay };
}

export function allowed(robots, path) {
  let best = null;
  for (const rule of robots.rules) {
    if (!rule.re.test(path)) continue;
    if (!best || rule.pattern.length > best.pattern.length) best = rule;
    else if (rule.pattern.length === best.pattern.length && rule.allow) best = rule;
  }
  return best ? best.allow : true;
}

const robotCache = new Map();

async function robotsForUrl(url) {
  const origin = new URL(url).origin;
  if (!robotCache.has(origin)) {
    let value = { rules: [], delay: 0 };
    try {
      const res = await fetch(`${origin}/robots.txt`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) value = robotsFor(parseRobots(await res.text()), 'MalipetekProspector');
      else if (res.status !== 404) value = { rules: [], delay: 0, refuse: true };
    } catch {
      // No reachable robots.txt: the page itself will say whether it is there.
    }
    robotCache.set(origin, value);
  }
  return robotCache.get(origin);
}

/* ——————————————————————— reading one page ——————————————————————— */

const BAD_EMAIL = /^(no-?reply|do-?not-?reply|donotreply|postmaster|abuse|webmaster|privacy|legal|dmca|unsubscribe|bounce|mailer-daemon)@/i;
const NOT_A_CONTACT = /(sentry|wixpress|example\.(com|org)|domain\.com|yourdomain|email\.com|@2x|@3x|\.(png|jpe?g|gif|webp|svg|ico|css|js)$)/i;

const NAMED_ENTITIES = { amp: '&', apos: "'", commat: '@', gt: '>', lt: '<', nbsp: ' ', quot: '"' };

const fromCodePoint = (n) => {
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
};

export const decodeEntities = (text) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => fromCodePoint(Number(dec)))
    .replace(/&([a-z][a-z0-9]+);/gi, (whole, name) => NAMED_ENTITIES[name.toLowerCase()] ?? whole);

export function textOf(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  );
}

export function titleOf(html) {
  const site = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i)?.[1];
  if (site) return decodeEntities(site).trim();
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  return decodeEntities(raw).replace(/\s+/g, ' ').split(/\s+[|–—-]\s+/)[0].trim();
}

export function emailsIn(html, pageUrl, { preferOwn = true } = {}) {
  const found = new Map();
  const add = (value, how) => {
    const email = decodeEntities(String(value))
      .replace(/^mailto:/i, '')
      .split(/[?#]/)[0]
      .replace(/%40/gi, '@')
      .trim()
      .replace(/^[<("']+|[>)"'.,;:]+$/g, '')
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return;
    if (NOT_A_CONTACT.test(email) || BAD_EMAIL.test(email)) return;
    if (email.length > 100) return;
    if (!found.has(email)) found.set(email, how);
  };

  for (const hit of html.matchAll(/href=["']mailto:([^"'?]+)/gi)) add(hit[1], 'mailto');
  for (const hit of textOf(html).matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) add(hit[0], 'text');

  const all = [...found].map(([email, how]) => ({ email, how }));
  if (!preferOwn) return all;

  // Prefer the business's own domain over a form vendor or the developer.
  const host = new URL(pageUrl).hostname.replace(/^www\./, '');
  const own = all.filter(({ email }) => email.split('@')[1].endsWith(host) || host.endsWith(email.split('@')[1]));
  return own.length ? own : all;
}

/**
 * One polite GET: robots first, its crawl-delay (or our own) before the
 * request, and only HTML bodies. Returns `{ html, url, title }` after
 * redirects, or `{ skipped }` with a short machine-readable reason.
 */
export async function fetchPage(url) {
  const robots = await robotsForUrl(url);
  if (robots.refuse) return { skipped: 'robots_unavailable' };
  const { pathname, search } = new URL(url);
  if (!allowed(robots, `${pathname}${search}`)) return { skipped: 'robots_disallowed' };

  await new Promise((r) => setTimeout(r, robots.delay ? robots.delay * 1000 : HOST_DELAY_MS));
  let res;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { skipped: `fetch_failed: ${error?.message ?? error}` };
  }
  if (!res.ok) return { skipped: `http_${res.status}` };
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('html')) return { skipped: 'not_html' };
  const html = await res.text();
  return { html, url: res.url || url, title: titleOf(html), skipped: null };
}

async function readPage(url) {
  const page = await fetchPage(url);
  if (page.skipped) return { url, skipped: page.skipped };

  const emails = emailsIn(page.html, page.url);
  if (!emails.length) return { url, skipped: 'no_email', title: page.title };
  return { url, title: page.title, site: new URL(page.url).origin, emails, skipped: null };
}

/* ——————————————————————— CSV ——————————————————————— */

const cell = (value) => {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const HEADER = ['email', 'name', 'business', 'site', 'source_url', 'gap', 'consent_basis', 'notes'];

export const csvOf = (rows) => `\uFEFF${[HEADER, ...rows].map((row) => row.map(cell).join(',')).join('\n')}\n`;

/* ——————————————————————— entry ——————————————————————— */

const input = opt('urls', '');
const out = opt('out', join(here, `prospects-${DAY}.csv`));

export function urlsFrom(text) {
  const urls = text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map((line) => (/^https?:\/\//i.test(line) ? line : `https://${line}`));
  return [...new Set(urls)];
}

async function main() {
  const raw = input ? readFileSync(input, 'utf8') : readFileSync(0, 'utf8');
  const urls = [...new Set(urlsFrom(raw))];
  if (!urls.length) {
    console.error('No URLs. Put one per line in a file and pass --urls=that-file.');
    process.exitCode = 1;
    return;
  }
  if (urls.length > MAX_PAGES) {
    console.error(`${urls.length} URLs is more than one run's ${MAX_PAGES}. Split the list: this is a list of chosen pages, not a crawl.`);
    process.exitCode = 1;
    return;
  }

  const rows = [];
  const seen = new Set();
  const skips = new Map();
  const note = `Public page read ${DAY}; the observation still has to be written.`;

  for (const url of urls) {
    let page;
    try {
      page = await readPage(url);
    } catch (error) {
      page = { url, skipped: `fetch_failed: ${error?.message ?? error}` };
    }
    if (page.skipped) {
      skips.set(page.skipped, (skips.get(page.skipped) ?? 0) + 1);
      log(`– ${url} — ${page.skipped}`);
      continue;
    }
    for (const { email, how } of page.emails) {
      if (seen.has(email)) continue;
      seen.add(email);
      rows.push([email, '', page.title, page.site, url, '', 'legitimate_interest', `${note} Found via ${how}.`]);
    }
    log(`· ${url} — ${page.emails.length} address${page.emails.length === 1 ? '' : 'es'}`);
  }

  if (!rows.length) {
    log('\nNo addresses found. Nothing written.');
    process.exitCode = 1;
    return;
  }

  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, csvOf(rows));

  log(`\n${rows.length} contact${rows.length === 1 ? '' : 's'} from ${urls.length} page${urls.length === 1 ? '' : 's'} → ${out}`);
  if (skips.size) log(`Skipped: ${[...skips].map(([why, n]) => `${n} ${why}`).join(', ')}`);
  log('Next: open each row, write one specific observation in `gap`, then import the CSV in Admin → Marketing → Contacts.');
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
