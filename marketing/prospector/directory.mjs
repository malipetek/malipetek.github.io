#!/usr/bin/env node
/*
 * Crawls a trade directory and writes contacts in the same CSV the extractor
 * writes, or — when the profiles hide their address — the member sites' URLs
 * for extract.mjs to read.
 *
 * This is the only tool here that follows links, so it is deliberately small:
 * one site per run, a page budget, a depth limit, and the same polite client
 * as the extractor (robots.txt, crawl-delay, one page every 1.5 s).
 *
 *   node marketing/prospector/directory.mjs --site=https://example-directory.com
 *   node marketing/prospector/directory.mjs --site=example.com --include='/members/' --max-pages=80
 *   node marketing/prospector/directory.mjs --urls=member-pages.txt --links-out=member-sites.txt
 *
 * Default stays on the directory's own host: listing → pagination → profile.
 * `--any-host` lets it step onto member sites too; usually pair it with
 * `--max-depth=1` so it does not wander through someone's whole shop.
 *
 * Point it at a directory whose robots.txt allows this, and review the CSV
 * before importing: a directory profile is a business's public contact, but
 * the `gap` observation is still yours to write.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvOf, decodeEntities, emailsIn, fetchPage, titleOf, urlsFrom } from './extract.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const opt = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const optAll = (name) =>
  process.argv.slice(2)
    .filter((a) => a.startsWith(`--${name}=`))
    .map((a) => a.slice(name.length + 3));

const DAY = new Date().toISOString().slice(0, 10);
const DEFAULT_MAX_PAGES = 60;
const HARD_MAX_PAGES = 200;
const DEFAULT_MAX_DEPTH = 2;

const log = (...parts) => console.log(...parts);

/* ——————————————————————— what to follow ——————————————————————— */

// Pages that never hold a business's contact: accounts, carts, feeds, files,
// and the policy pages every directory footer points at.
const SKIP_PATH =
  /\.(?:pdf|jpe?g|png|gif|webp|svg|ico|css|js|mjs|json|xml|rss|atom|zip|gz|tgz|mp4|webm|mp3|woff2?|ttf|eot)$|\/(?:login|log-in|signin|sign-in|signup|sign-up|register|logout|log-out|cart|basket|checkout|account|my-account|wp-admin|wp-login\.php|feed|rss|privacy(?:-policy)?|cookies?|cookie-policy|terms(?:-and-conditions|-conditions)?|legal|accessibility|equality-diversity|sitemap)(?:[/?#-]|$)|[?&](?:replytocom|returnurl|s)=/i;

// Hosts that are never the business's own site (socials, maps, review sites,
// marketplaces, the regulator), including the bare `www.instagram` kind of
// broken link a profile sometimes carries.
const NOT_BUSINESS_BRANDS =
  'facebook|instagram|instgram|twitter|linkedin|youtube|tiktok|pinterest|threads|whatsapp|telegram|google|bing|yelp|tripadvisor|trustpilot|crunchbase|indeed|glassdoor|apple|etsy|ebay|amazon|notonthehighstreet|folksy|trouva';
const NOT_BUSINESS_HOST = new RegExp(
  `(?:^|\\.)(?:${NOT_BUSINESS_BRANDS})(?:\\.[a-z.]+)?$` +
    '|(?:^|\\.)(?:x\\.com|youtu\\.be|wa\\.me|t\\.me|goo\\.gl|houzz\\.co\\.uk|houzz\\.com|ico\\.org\\.uk|gov\\.uk|force\\.com|bbb\\.org|w3\\.org|schema\\.org|googleusercontent\\.com)$',
  'i',
);

const bare = (hostname) => hostname.replace(/^www\./, '');

/** Is this address on the given host or one of its subdomains? */
export const addressOnHost = (address, host) => {
  const domain = address.split('@')[1] ?? '';
  return domain === host || domain.endsWith(`.${host}`);
};

/** Every http(s) link on the page, absolute, without the fragment. */
export function linksIn(html, baseUrl) {
  const found = new Set();
  for (const hit of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const raw = decodeEntities(hit[1] ?? hit[2] ?? hit[3] ?? '').trim();
    if (!raw || /^(?:mailto:|tel:|sms:|javascript:|data:|#)/i.test(raw)) continue;
    let url;
    try {
      url = new URL(raw, baseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    url.hash = '';
    found.add(url.href);
  }
  return [...found];
}

/** True for socials, maps, review sites and marketplaces: never a business's own site. */
export const notBusinessHost = (hostname) => NOT_BUSINESS_HOST.test(bare(String(hostname ?? '').toLowerCase()));

export function isBusinessLink(link, pageUrl) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (!url.hostname.includes('.')) return false;
  if (bare(url.hostname) === bare(new URL(pageUrl).hostname)) return false;
  return !notBusinessHost(url.hostname);
}

/** The business's own site for a profile page; the page origin when it has none. */
export function businessSite(links, pageUrl) {
  const hit = links.find((link) => isBusinessLink(link, pageUrl));
  return hit ? new URL(hit).origin : new URL(pageUrl).origin;
}

/** Should this URL be fetched at all, under the current run's rules? */
export function wanted(url, { origins = new Set(), include = null, exclude = null, anyHost = false } = {}) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
  if (!target.hostname.includes('.')) return false;
  if (SKIP_PATH.test(`${target.pathname}${target.search}`)) return false;
  if (NOT_BUSINESS_HOST.test(bare(target.hostname))) return false;
  if (!anyHost && !origins.has(target.origin)) return false;
  if (include && !include.test(url)) return false;
  if (exclude && exclude.test(url)) return false;
  return true;
}

/* ——————————————————————— the crawl ——————————————————————— */

/**
 * Breadth-first, one queue. `read` is injectable so the graph logic can be
 * tested without a network. Returns the rows already shaped for the CSV.
 */
export async function crawl(
  seeds,
  { read = fetchPage, maxPages = DEFAULT_MAX_PAGES, maxDepth = DEFAULT_MAX_DEPTH, include = null, exclude = null, anyHost = false, onPage = () => {} } = {},
) {
  const origins = new Set(seeds.map((seed) => new URL(seed).origin));
  const directoryHosts = new Set(seeds.map((seed) => bare(new URL(seed).hostname)));
  const queue = seeds.map((url) => ({ url, depth: 0 }));
  const queued = new Set(seeds);
  const rows = [];
  const addresses = new Set();
  const sites = new Set();
  const skips = new Map();
  let visited = 0;

  while (queue.length && visited < maxPages) {
    const { url, depth } = queue.shift();
    visited += 1;

    let page;
    try {
      page = await read(url);
    } catch (error) {
      page = { skipped: `fetch_failed: ${error?.message ?? error}` };
    }
    if (page.skipped) {
      skips.set(page.skipped, (skips.get(page.skipped) ?? 0) + 1);
      onPage({ url, depth, skipped: page.skipped });
      continue;
    }

    const pageUrl = page.url || url;
    origins.add(new URL(pageUrl).origin);
    // A directory that answers on www and redirects to the bare domain is
    // still the directory: its own inboxes must not become contacts.
    const pageHost = bare(new URL(pageUrl).hostname);
    if (directoryHosts.has(bare(new URL(url).hostname))) directoryHosts.add(pageHost);
    const links = linksIn(page.html, pageUrl);
    const title = page.title || titleOf(page.html);

    for (const link of links) if (isBusinessLink(link, pageUrl)) sites.add(new URL(link).origin);

    // On the directory's own pages the address we want is the member's, so the
    // directory's own inboxes are dropped rather than preferred.
    const onDirectory = directoryHosts.has(pageHost);
    const found = emailsIn(page.html, pageUrl, { preferOwn: !onDirectory }).filter(
      ({ email }) => !onDirectory || !addressOnHost(email, pageHost),
    );
    const site = businessSite(links, pageUrl);
    for (const { email, how } of found) {
      if (addresses.has(email)) continue;
      addresses.add(email);
      rows.push([
        email,
        '',
        title || bare(new URL(pageUrl).hostname),
        site,
        pageUrl,
        '',
        'legitimate_interest',
        `Public page read ${DAY}; found via ${how}. Observation still has to be written.`,
      ]);
    }

    onPage({ url: pageUrl, depth, title, emails: found.length, links: links.length });

    if (depth >= maxDepth) continue;
    for (const link of links) {
      if (queued.has(link)) continue;
      if (!wanted(link, { origins, include, exclude, anyHost })) continue;
      queued.add(link);
      queue.push({ url: link, depth: depth + 1 });
    }
  }

  return { visited, rows, sites, skips, capped: queue.length > 0 };
}

/* ——————————————————————— entry ——————————————————————— */

function regexFlag(name) {
  const raw = opt(name, '');
  if (!raw) return null;
  try {
    return new RegExp(raw, 'i');
  } catch (error) {
    console.error(`--${name} is not a valid regular expression: ${error.message}`);
    process.exitCode = 1;
    return undefined;
  }
}

async function main() {
  const extra = opt('urls', '') ? readFileSync(opt('urls'), 'utf8') : '';
  const seeds = [...new Set(urlsFrom([...optAll('site'), extra].join('\n')))];
  if (!seeds.length) {
    console.error('Give it a directory: --site=https://example-directory.com (repeatable), or --urls=a-file-of-start-pages.');
    process.exitCode = 1;
    return;
  }

  const include = regexFlag('include');
  const exclude = regexFlag('exclude');
  if (include === undefined || exclude === undefined) return;

  const requestedPages = Math.floor(Number(opt('max-pages', DEFAULT_MAX_PAGES)));
  const maxPages = Number.isFinite(requestedPages) && requestedPages > 0 ? Math.min(requestedPages, HARD_MAX_PAGES) : DEFAULT_MAX_PAGES;
  if (requestedPages > HARD_MAX_PAGES) log(`Page budget capped at ${HARD_MAX_PAGES}.`);

  const requestedDepth = Math.floor(Number(opt('max-depth', DEFAULT_MAX_DEPTH)));
  const maxDepth = Number.isFinite(requestedDepth) && requestedDepth >= 0 ? Math.min(requestedDepth, 5) : DEFAULT_MAX_DEPTH;

  const anyHost = process.argv.includes('--any-host');
  const out = opt('out', join(here, `directory-${DAY}.csv`));
  const linksOut = opt('links-out', '');

  log(`Reading up to ${maxPages} page${maxPages === 1 ? '' : 's'} from ${seeds.length} start${seeds.length === 1 ? '' : 's'}, depth ${maxDepth}${anyHost ? ', across hosts' : ', one host'}.`);

  const result = await crawl(seeds, {
    maxPages,
    maxDepth,
    include,
    exclude,
    anyHost,
    onPage: (page) => {
      if (page.skipped) log(`– ${page.url} — ${page.skipped}`);
      else log(`· ${page.url} — ${page.emails} address${page.emails === 1 ? '' : 'es'}, ${page.links} link${page.links === 1 ? '' : 's'}`);
    },
  });

  if (result.rows.length) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, csvOf(result.rows));
    log(`\n${result.rows.length} contact${result.rows.length === 1 ? '' : 's'} → ${out}`);
  } else {
    log('\nNo addresses on the pages it read.');
  }

  const sites = [...result.sites].sort();
  if (linksOut && sites.length) {
    mkdirSync(dirname(resolve(linksOut)), { recursive: true });
    writeFileSync(linksOut, `# Business sites found ${DAY} by directory.mjs\n${sites.join('\n')}\n`);
    log(`${sites.length} member site${sites.length === 1 ? '' : 's'} → ${linksOut}`);
    log(`Next: node marketing/prospector/extract.mjs --urls=${linksOut}`);
  } else if (sites.length) {
    log(`${sites.length} member site${sites.length === 1 ? '' : 's'} seen; pass --links-out=member-sites.txt to keep them for the extractor.`);
  }

  log(`Read ${result.visited} page${result.visited === 1 ? '' : 's'}${result.capped ? `, budget of ${maxPages} reached — the queue was not empty` : ''}.`);
  if (result.skips.size) log(`Skipped: ${[...result.skips].map(([why, n]) => `${n} ${why}`).join(', ')}`);
  log('Review before importing: every row needs one specific observation in `gap`, then Admin → Marketing → Contacts.');

  if (!result.rows.length && !sites.length) process.exitCode = 1;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
