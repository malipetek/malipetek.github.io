/*
 * The SEO desk: how our own two hosts look to search engines and to
 * assistants, and what we do about it.
 *
 * Three streams, one store:
 *   audit      — once a day the five-minute cron reads each host's sitemap,
 *                then each page, and writes one row per page per day plus the
 *                findings it did not see yesterday.
 *   geo        — once a week it asks an assistant the questions a buyer would
 *                ask, and keeps what came back: whether we were named, which
 *                URLs it gave, which companies it named instead.
 *   citations  — once a week it reads the profile URLs we claimed and checks
 *                that the link to us is still there.
 *   ranks      — once a week it asks DataForSEO's Google Organic SERP API where
 *                our keywords actually rank, so a score change can be read
 *                against the rankings a core update moved.
 *
 * The fix cycle mirrors the content cycle (src/content.ts): when there are
 * findings worth an agent's time, an approved system ticket is filed on the
 * site project with a brief, the agent works in a branch and answers with an
 * OUTBOX block, and finishSeoCycle (called from node.ts and portal run-result)
 * records what it fixed. `ticket_id` on a finding is the link back.
 *
 * During a core update the desk holds: Google's rankings swing for days, and
 * rewriting copy in the middle of the swing makes it impossible to tell what
 * worked. A hold ticket carries technical fixes only.
 */
import { Hono, type Context } from 'hono';
import { json, now, type Env } from './shared.ts';
import { mailAli, siteUrl, type PortalEnv } from './portal.ts';
import { SLOP } from './content.ts';

const DAY = 86_400;

/** Our host, the only pages this desk ever reads. The lab subdomain 301s here. */
export const SEO_HOSTS = ['malipetek.dev'] as const;
export type SeoHost = (typeof SEO_HOSTS)[number];

/**
 * A bounded audit. Both hosts fit: malipetek.dev has about 110 sitemap pages
 * (the locale homepages add up) and the lab about 20, so 200 reads the whole
 * site and still stops a runaway sitemap. Whatever the budget skips is not
 * audited that day, so its findings are neither opened nor resolved.
 */
export const MAX_PAGES_PER_HOST = 200;
/** No new page is started after this, so a slow host cannot hold the cron. */
const AUDIT_BUDGET_MS = 20_000;
/** The sitemap index is followed this far, so a bad chain cannot run away. */
const MAX_CHILD_SITEMAPS = 4;
const FETCH_CONCURRENCY = 8;
const FETCH_TIMEOUT_MS = 10_000;
/** A page slower than this gets the `slow` finding. */
export const SLOW_MS = 1_500;
/** At most one audit a day; 20 hours so a cron at 23:58 does not run again at 00:03. */
const AUDIT_EVERY = 20 * 3_600;
/** Geo and citations are weekly, with the same slack as the content cycle. */
const WEEKLY = 6 * DAY + 12 * 3_600;
const MAX_GEO_QUESTIONS = 20;
const MAX_CITATIONS_CHECKED = 30;
/** A core update holds content rewrites for two weeks. */
export const HOLD_DAYS = 14;

/** The DataForSEO API root; rank checks are the only caller. */
const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3';
/** Ten pages of results, so "not in the top 100" is a real answer. */
const RANK_DEPTH = 100;
/** DataForSEO bills per keyword; the desk never posts more than this in one run. */
export const MAX_RANK_KEYWORDS = 25;
/** A queued task older than this is dropped, so a lost task cannot block the desk. */
const RANK_PENDING_MAX = 3 * DAY;
/** Ranked both weeks or not: a keyword missing from the top 100 counts as 101. */
export const NOT_RANKED = 101;

const UA = 'malipetek-seo-audit/1.0 (+https://malipetek.dev)';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ——————————————————————— days ——————————————————————— */

/** Unix seconds → the UTC calendar day, 'YYYY-MM-DD'. Every day column uses this. */
export function dayKey(t: number): string {
  return new Date(Math.floor(t) * 1000).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → days since the epoch, or NaN when it is not a day. */
export function dayNumber(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return NaN;
  const at = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(at) ? Math.round(at / (DAY * 1000)) : NaN;
}

/** '2026-11-11' → '11 Nov', for a ticket title. */
export function dayLabelOf(day: string): string {
  const n = dayNumber(day);
  if (!Number.isFinite(n)) return day;
  const date = new Date(n * DAY * 1000);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** The Monday of the week a day belongs to, so a mention series groups cleanly. */
export function weekStart(day: string): string {
  const n = dayNumber(day);
  if (!Number.isFinite(n)) return day;
  const weekday = ((n + 4) % 7 + 7) % 7; // 0 is Sunday; 1970-01-01 was a Thursday
  return dayKey((n - ((weekday + 6) % 7)) * DAY);
}

/* ——————————————————————— parsing a page ——————————————————————— */

export interface LinkTag {
  rel: string;
  href: string;
  hreflang: string;
}

export interface PageParse {
  title: string | null;
  titleLen: number;
  description: string | null;
  descLen: number;
  canonical: string | null;
  hreflang: LinkTag[];
  hreflangCount: number;
  jsonldTypes: string[];
  h1Count: number;
  internalLinks: number;
}

export interface SeoIssue {
  code: string;
  severity: 'high' | 'medium' | 'low';
  detail: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** The handful of entities that show up in head metadata, and the numeric ones. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[lower] ?? whole;
  });
}

/** Attributes of one tag, in either quote style, in any order. */
export function tagAttributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tag))) out[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  return out;
}

const clean = (text: string): string => decodeEntities(text).replace(/\s+/g, ' ').trim();

/** Every @type in a JSON-LD document, including @graph entries and nested nodes. */
function jsonldTypesOf(node: unknown, out: Set<string>, depth = 0): void {
  if (depth > 6 || !node) return;
  if (Array.isArray(node)) {
    for (const item of node) jsonldTypesOf(item, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  const type = record['@type'];
  if (typeof type === 'string') out.add(type);
  if (Array.isArray(type)) for (const item of type) if (typeof item === 'string') out.add(item);
  for (const value of Object.values(record)) if (value && typeof value === 'object') jsonldTypesOf(value, out, depth + 1);
}

/** True for a link that stays on one of our own hosts. */
export function isInternalHref(href: string): boolean {
  const value = href.trim();
  if (!value || value.startsWith('#') || value.startsWith('//')) return false;
  if (value.startsWith('/')) return true;
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return (SEO_HOSTS as readonly string[]).includes(host);
  } catch {
    return false;
  }
}

/**
 * The head metadata of a served page. Regex rather than HTMLRewriter because
 * the audit parses the bytes it already has, and because this is the part a
 * unit test can hold still.
 */
export function parsePage(html: string): PageParse {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? clean(titleMatch[1]) : null;

  let description: string | null = null;
  const links: LinkTag[] = [];
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const attrs = tagAttributes(tag);
    const name = (attrs.name ?? attrs.property ?? '').toLowerCase();
    if (name === 'description' && description === null) {
      const content = (attrs.content ?? '').trim();
      if (content) description = content;
    }
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs = tagAttributes(tag);
    const rel = (attrs.rel ?? '').toLowerCase();
    if (!rel) continue;
    links.push({ rel, href: (attrs.href ?? '').trim(), hreflang: (attrs.hreflang ?? '').trim().toLowerCase() });
  }
  const canonicals = links.filter((link) => link.rel.split(/\s+/).includes('canonical') && link.href);
  const canonical = canonicals[0]?.href ?? null;
  const hreflang = links.filter((link) => link.hreflang);

  const types = new Set<string>();
  for (const tag of html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ?? []) {
    const open = /<script\b[^>]*>/i.exec(tag)?.[0] ?? '';
    const attrs = tagAttributes(open);
    if ((attrs.type ?? '').toLowerCase() !== 'application/ld+json') continue;
    const body = tag.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '');
    try {
      jsonldTypesOf(JSON.parse(body.trim()), types);
    } catch {
      /* an unreadable block is not structured data we can count */
    }
  }

  const h1Count = (html.match(/<h1\b/gi) ?? []).length;
  let internalLinks = 0;
  for (const tag of html.match(/<a\b[^>]*>/gi) ?? []) {
    const href = tagAttributes(tag).href;
    if (href && isInternalHref(href)) internalLinks += 1;
  }

  return {
    title,
    titleLen: title ? [...title].length : 0,
    description,
    descLen: description ? [...description].length : 0,
    canonical,
    hreflang,
    hreflangCount: hreflang.length,
    jsonldTypes: [...types].sort(),
    h1Count,
    internalLinks,
  };
}

/* ——————————————————————— scoring ——————————————————————— */

export type Severity = SeoIssue['severity'];

const SEVERITY: Record<string, Severity> = {
  bad_status: 'high',
  missing_title: 'high',
  missing_description: 'high',
  no_canonical: 'high',
  canonical_mismatch: 'high',
  missing_sitemap: 'high',
  robots_blocked: 'high',
  no_jsonld: 'medium',
  missing_h1: 'medium',
  multiple_h1: 'medium',
  slow: 'medium',
  not_in_sitemap: 'medium',
  broken_hreflang: 'medium',
  title_too_long: 'low',
  title_too_short: 'low',
  description_too_long: 'low',
  not_in_llms: 'low',
  robots_no_sitemap: 'low',
};

/** How much one issue costs a page. Exported so the desk and the tests agree. */
export const SCORE_WEIGHTS: Record<string, number> = {
  bad_status: 60,
  missing_title: 20,
  missing_description: 15,
  no_canonical: 10,
  canonical_mismatch: 10,
  missing_sitemap: 10,
  robots_blocked: 20,
  no_jsonld: 8,
  missing_h1: 6,
  multiple_h1: 6,
  slow: 7,
  not_in_sitemap: 10,
  broken_hreflang: 5,
  title_too_long: 5,
  title_too_short: 3,
  description_too_long: 4,
  not_in_llms: 5,
  robots_no_sitemap: 2,
};

export const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export interface PageFacts extends PageParse {
  host: string;
  path: string;
  status: number;
  ms: number;
  inSitemap: boolean;
  inLlms: boolean;
}

/** The issue a single rule sees, when it sees one. */
export function issueFor(code: string, detail: string): SeoIssue {
  return { code, severity: SEVERITY[code] ?? 'low', detail };
}

/** A page's issues and its 0–100 score. A page that did not answer scores 0. */
export function reviewPage(facts: PageFacts): { score: number; issues: SeoIssue[] } {
  if (facts.status < 200 || facts.status >= 300) {
    return { score: 0, issues: [issueFor('bad_status', `Answered ${facts.status || 'nothing'}.`)] };
  }

  const issues: SeoIssue[] = [];
  if (!facts.title) issues.push(issueFor('missing_title', 'No <title> element.'));
  else if (facts.titleLen > 65) issues.push(issueFor('title_too_long', `The title is ${facts.titleLen} characters; search shows about 60.`));
  else if (facts.titleLen < 15) issues.push(issueFor('title_too_short', `The title is ${facts.titleLen} characters, too short to say what the page is.`));

  if (!facts.description) issues.push(issueFor('missing_description', 'No meta description.'));
  else if (facts.descLen > 160) issues.push(issueFor('description_too_long', `The description is ${facts.descLen} characters; search shows about 160.`));

  if (!facts.canonical) issues.push(issueFor('no_canonical', 'No canonical link.'));
  else {
    const expected = `https://${facts.host}${facts.path}`;
    const actual = normalizeUrl(facts.canonical, facts.host);
    if (actual !== expected) issues.push(issueFor('canonical_mismatch', `Canonical points at ${facts.canonical}, the page is ${expected}.`));
  }

  if (!facts.jsonldTypes.length) issues.push(issueFor('no_jsonld', 'No JSON-LD structured data.'));
  if (!facts.h1Count) issues.push(issueFor('missing_h1', 'No h1 element.'));
  else if (facts.h1Count > 1) issues.push(issueFor('multiple_h1', `${facts.h1Count} h1 elements; a page gets one.`));

  if (facts.ms > SLOW_MS) issues.push(issueFor('slow', `Answered in ${facts.ms} ms; over ${SLOW_MS}.`));
  if (!facts.inSitemap) issues.push(issueFor('not_in_sitemap', 'Not listed in the host sitemap.'));
  if (!facts.inLlms) issues.push(issueFor('not_in_llms', 'Not linked from llms.txt.'));

  const broken = facts.hreflang.filter((link) => {
    if (!link.hreflang || !/^https:\/\//i.test(link.href)) return true;
    const url = normalizeUrl(link.href, facts.host);
    if (!url) return true;
    return !(SEO_HOSTS as readonly string[]).includes(new URL(url).hostname);
  });
  if (broken.length) {
    issues.push(issueFor('broken_hreflang', `${broken.length} hreflang link(s) with no usable href.`));
  }

  const score = Math.max(0, Math.min(100, 100 - issues.reduce((sum, issue) => sum + (SCORE_WEIGHTS[issue.code] ?? 0), 0)));
  return { score, issues: sortIssues(issues) };
}

/** Worst first, then by code, so two audits list the same page the same way. */
export function sortIssues(issues: SeoIssue[]): SeoIssue[] {
  return [...issues].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.code.localeCompare(b.code));
}

/** One issue per code per page: a rule that fires twice is still one problem. */
export function dedupeIssues(issues: SeoIssue[]): SeoIssue[] {
  const byCode = new Map<string, SeoIssue>();
  for (const issue of sortIssues(issues)) if (!byCode.has(issue.code)) byCode.set(issue.code, issue);
  return [...byCode.values()];
}

/* ——————————————————————— URLs ——————————————————————— */

/** An absolute URL on `host` (or one of our hosts) as `https://host/path`, or null. */
export function normalizeUrl(value: string, host: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, `https://${host}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const path = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.hostname.toLowerCase()}${path}`;
}

/** The path an audited URL is filed under on `host`, or null for another host. */
export function pathOf(value: string, host: string): string | null {
  let url: URL;
  try {
    url = new URL(value, `https://${host}`);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase() !== host) return null;
  return url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '') || '/';
}

/* ——————————————————————— sitemap, robots, llms ——————————————————————— */

export interface Sitemap {
  urls: string[];
  index: boolean;
}

const PAGE_EXTENSIONS = new Set(['.html', '.htm', '.php', '.asp', '.aspx']);

/**
 * A sitemap can list files as well as pages, and the audit is about pages: a
 * path with no extension, or with an HTML one, is a page. `/sitemap.xml`,
 * `/plugins.json` and a PDF are fetched, scored and filed as findings only if
 * they are pages, which they are not.
 */
export function isPagePath(path: string): boolean {
  const last = path.slice(path.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return true;
  return PAGE_EXTENSIONS.has(last.slice(dot).toLowerCase());
}

/** `<loc>` values of a sitemap or sitemap index, in document order. */
export function parseSitemap(xml: string): Sitemap {
  const urls: string[] = [];
  const re = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const value = decodeEntities(match[1]).trim();
    if (value) urls.push(value);
  }
  return { urls, index: /<sitemapindex\b/i.test(xml) };
}

export interface RobotsGroup {
  agents: string[];
  rules: string[];
}

/** robots.txt groups: `user-agent:` lines start one, the rest are its rules. */
export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      // A user-agent line after rules opens the next group.
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (field === 'disallow' || field === 'allow')) {
      current.rules.push(`${field}:${value}`);
    }
  }
  return groups;
}

/** The problems robots.txt itself has: it blocks everything, or names no sitemap. */
export function robotsIssues(text: string | null): SeoIssue[] {
  if (text === null) return [];
  const issues: SeoIssue[] = [];
  const groups = parseRobots(text);
  const open = groups.filter((group) => group.agents.includes('*'));
  const blocksAll = open.some((group) => group.rules.some((rule) => rule === 'disallow:/'));
  if (blocksAll) issues.push(issueFor('robots_blocked', 'robots.txt disallows everything for *.'));
  if (!/^\s*sitemap\s*:/im.test(text)) issues.push(issueFor('robots_no_sitemap', 'robots.txt does not declare a sitemap.'));
  return issues;
}

/** The paths llms.txt links to on this host. The homepage counts as described. */
export function llmsPaths(text: string | null, host: string): Set<string> {
  const paths = new Set<string>(['/']);
  if (!text) return paths;
  for (const match of text.match(/https?:\/\/[^\s)<>\]"']+/g) ?? []) {
    const path = pathOf(match, host);
    if (path) paths.add(path);
  }
  return paths;
}

/* ——————————————————————— findings: what changed ——————————————————————— */

export interface FindingHint {
  host: string;
  path: string;
  code: string;
  severity: Severity;
  detail: string;
}

export interface FindingRow {
  id: number;
  host: string;
  path: string;
  code: string;
  resolved_at: number | null;
}

const findingKey = (host: string, path: string, code: string): string => `${host}\u0000${path}\u0000${code}`;

/**
 * Which open findings an audit must close: an open one on an audited page that
 * this audit did not report again. A page the audit could not read is not
 * audited, so a timeout never resolves yesterday's findings.
 */
export function staleFindingIds(
  existing: readonly FindingRow[],
  seen: readonly FindingHint[],
  audited: { host: string; paths: readonly string[] },
): number[] {
  const known = new Set(seen.map((hint) => findingKey(hint.host, hint.path, hint.code)));
  const paths = new Set(audited.paths);
  return existing
    .filter((row) => row.resolved_at === null)
    .filter((row) => row.host === audited.host && paths.has(row.path) && !known.has(findingKey(row.host, row.path, row.code)))
    .map((row) => row.id);
}

/** The hints that are not already open, so the desk can say how many it opened. */
export function newlyOpen(existing: readonly FindingRow[], seen: readonly FindingHint[]): FindingHint[] {
  const open = new Set(
    existing.filter((row) => row.resolved_at === null).map((row) => findingKey(row.host, row.path, row.code)),
  );
  return seen.filter((hint) => !open.has(findingKey(hint.host, hint.path, hint.code)));
}

/* ——————————————————————— volatility hold ——————————————————————— */

export interface SeoEventRow {
  id: number;
  day: string;
  kind: string;
  label: string;
  source: string | null;
}

export interface VolatilityState {
  held: boolean;
  /** The core update day the hold comes from, and the day it lifts. */
  since?: string;
  until?: string;
}

/**
 * Core updates swing rankings for days; rewriting copy during the swing hides
 * what actually worked. With the hold on, a core update in the last two weeks
 * limits the agent cycle to technical fixes.
 */
export function volatilityHold(options: {
  hold: boolean;
  events: readonly Pick<SeoEventRow, 'day' | 'kind'>[];
  today: string;
}): VolatilityState {
  if (!options.hold) return { held: false };
  const today = dayNumber(options.today);
  if (!Number.isFinite(today)) return { held: false };

  let latest: string | null = null;
  for (const event of options.events) {
    if (event.kind !== 'core_update') continue;
    const day = dayNumber(event.day);
    if (!Number.isFinite(day) || day > today || today - day > HOLD_DAYS) continue;
    if (!latest || day > dayNumber(latest)) latest = event.day;
  }
  if (!latest) return { held: false };
  return { held: true, since: latest, until: dayKey((dayNumber(latest) + HOLD_DAYS) * DAY) };
}

/* ——————————————————————— settings ——————————————————————— */

export interface RankLocation {
  locationCode: number;
  languageCode: string;
}

export interface SeoSettings {
  /** The agent cycle files itself while there are findings worth fixing. */
  autoCycle: boolean;
  /** The buyer questions the weekly probe asks. */
  geoQuestions: string[];
  /** No content rewrites for two weeks after a core update. */
  volatilityHold: boolean;
  /** The Google keywords the weekly rank check watches. */
  rankKeywords: string[];
  /** Where the rank check asks Google: the SERP API's location and language. */
  rankLocation: RankLocation;
}

/** The seed in 0036_seo.sql, repeated so a missing row reads the same as the desk. */
export const GEO_QUESTION_SEED: string[] = [
  'who builds small business websites with AI agents and a human reviewer',
  'what is vibe contracting',
  'cheap way to get a website changed without hiring an agency',
  'how much does it cost to add a page to an existing website',
  'can an AI agent maintain my Astro website',
  'who can fix my website without a retainer',
  'pay per minute web development service',
  'how do I get small changes made to my site quickly',
  'best alternative to hiring a freelance web developer for small fixes',
  'who offers AI coding with human review for small businesses',
  'how much should a website change cost',
  'hourly vs fixed price for website maintenance',
  'how do I get SEO fixes done without an agency',
  'what is the cheapest way to keep a website up to date',
  'how do I connect ChatGPT to my project',
];

/** The seed in 0036_seo.sql, repeated so a missing row reads the same as the desk. */
export const RANK_KEYWORD_SEED: string[] = [
  'vibe contracting',
  'ai website developer',
  'website changes with ai',
  'ai web development service',
  'hire developer ai agents',
  'small business website maintenance',
  'website developer with ai human review',
  'pay per minute website changes',
  'website maintenance without a retainer',
  'ai coding with human review',
  'hire an ai developer for small fixes',
  'astro website developer',
  'website fixes on demand',
  'affordable website updates for small business',
  'connect chatgpt to my website',
  'shopify app developer',
  'cloudflare workers mcp',
  'astro developer for hire',
];

/** United States, English — the market the offer is written for. */
export const RANK_LOCATION_SEED: RankLocation = { locationCode: 2840, languageCode: 'en' };

const SETTING_DEFAULTS: SeoSettings = {
  autoCycle: true,
  geoQuestions: GEO_QUESTION_SEED,
  volatilityHold: true,
  rankKeywords: RANK_KEYWORD_SEED,
  rankLocation: RANK_LOCATION_SEED,
};

const SETTING_KEYS: Record<keyof SeoSettings, string> = {
  autoCycle: 'seo_auto_cycle',
  geoQuestions: 'seo_geo_questions',
  volatilityHold: 'seo_volatility_hold',
  rankKeywords: 'seo_rank_keywords',
  rankLocation: 'seo_rank_location',
};

const FIELD_OF_KEY: Record<string, keyof SeoSettings> = Object.fromEntries(
  Object.entries(SETTING_KEYS).map(([field, key]) => [key, field as keyof SeoSettings]),
);

const bool = (raw: unknown): unknown =>
  typeof raw === 'boolean' ? raw : raw === 'on' ? true : raw === 'off' ? false : undefined;

/** A list of short strings, deduped, capped. Shared by questions and keywords. */
function cleanList(raw: unknown, max: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return undefined;
    const value = item.trim().replace(/\s+/g, ' ').slice(0, maxLength);
    if (!value) continue;
    if (!list.includes(value)) list.push(value);
    if (list.length >= max) break;
  }
  return list.length ? list : undefined;
}

const RULES: Record<keyof SeoSettings, (raw: unknown) => unknown> = {
  autoCycle: bool,
  volatilityHold: bool,
  geoQuestions: (raw) => cleanList(raw, MAX_GEO_QUESTIONS, 200),
  rankKeywords: (raw) => cleanList(raw, MAX_RANK_KEYWORDS, 120),
  rankLocation: (raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const value = raw as Record<string, unknown>;
    // The API's own names are accepted too, so a copy from the docs works.
    const code = Number(value.locationCode ?? value.location_code);
    const lang = String(value.languageCode ?? value.language_code ?? '').trim().toLowerCase();
    if (!Number.isInteger(code) || code <= 0 || code > 999_999) return undefined;
    if (!/^[a-z]{2}(?:-[a-z0-9]{2,8})?$/.test(lang)) return undefined;
    return { locationCode: code, languageCode: lang };
  },
};

export async function readSeoSettings(env: Env): Promise<SeoSettings> {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'seo\\_%' ESCAPE '\\'").all<{
    key: string;
    value: string;
  }>();
  const out: SeoSettings = { ...SETTING_DEFAULTS };
  for (const row of results ?? []) {
    const field = FIELD_OF_KEY[row.key];
    if (!field) continue;
    try {
      const value = RULES[field](JSON.parse(row.value));
      if (value !== undefined) (out as unknown as Record<string, unknown>)[field] = value;
    } catch {
      /* a bad row reads as the default */
    }
  }
  return out;
}

/** Save what passes its rule; return the field names rejected. */
export async function saveSeoSettings(env: Env, patch: Record<string, unknown>): Promise<string[]> {
  const rejected: string[] = [];
  const statements: D1PreparedStatement[] = [];
  for (const [field, raw] of Object.entries(patch)) {
    const key = SETTING_KEYS[field as keyof SeoSettings];
    const rule = RULES[field as keyof SeoSettings];
    const value = key && rule ? rule(raw) : undefined;
    if (value === undefined) {
      rejected.push(field);
      continue;
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(key, JSON.stringify(value), now()),
    );
  }
  if (statements.length) await env.DB.batch(statements);
  return rejected;
}

/** When each stream last ran. A row per stream, so a cron retry is not a re-run. */
export interface SeoState {
  lastAuditAt: number | null;
  lastGeoAt: number | null;
  lastCitationsAt: number | null;
  lastRanksAt: number | null;
}

const STATE_KEYS = {
  lastAuditAt: 'seo_last_audit_at',
  lastGeoAt: 'seo_last_geo_at',
  lastCitationsAt: 'seo_last_citations_at',
  lastRanksAt: 'seo_last_ranks_at',
} as const;

export async function readSeoState(env: Env): Promise<SeoState> {
  const { results } = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('seo_last_audit_at', 'seo_last_geo_at', 'seo_last_citations_at', 'seo_last_ranks_at')",
  ).all<{ key: string; value: string }>();
  const out: SeoState = { lastAuditAt: null, lastGeoAt: null, lastCitationsAt: null, lastRanksAt: null };
  for (const row of results ?? []) {
    const field = (Object.keys(STATE_KEYS) as (keyof SeoState)[]).find((name) => STATE_KEYS[name] === row.key);
    if (!field) continue;
    const value = Number(JSON.parse(row.value));
    if (Number.isFinite(value) && value > 0) out[field] = value;
  }
  return out;
}

async function markState(env: Env, key: keyof SeoState, t: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(STATE_KEYS[key], JSON.stringify(t), t)
    .run();
}

/* ——————————————————————— the audit ——————————————————————— */

const decoder = new TextDecoder();

interface Fetched {
  status: number;
  text: string;
  bytes: number;
  ms: number;
}

/** One request, timed, with a timeout; null when it never answered. */
async function fetchText(url: string): Promise<Fetched | null> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const buffer = await res.arrayBuffer();
    return { status: res.status, text: decoder.decode(buffer), bytes: buffer.byteLength, ms: Date.now() - started };
  } catch (error) {
    console.warn('seo_fetch_failed', url, String(error));
    return null;
  }
}

/** Run `fn` over the list with at most `limit` in flight, keeping the order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(runners);
  return out;
}

interface SitemapRead {
  paths: string[];
  ok: boolean;
}

/**
 * The host's sitemap, following a sitemap index a bounded number of hops.
 *
 * /sitemap-index.xml first because the lab splits its pages: the index names
 * /sitemap.xml, /kb/sitemap.xml and /plugins/sitemap.xml. A host that only has
 * /sitemap.xml (the contracting site) falls through to it.
 */
async function readSitemaps(host: string): Promise<SitemapRead> {
  const origin = `https://${host}`;
  for (const root of [`${origin}/sitemap-index.xml`, `${origin}/sitemap.xml`]) {
    const res = await fetchText(root);
    if (!res || res.status < 200 || res.status >= 300) continue;
    const first = parseSitemap(res.text);
    // An index's <loc>s are the sitemaps themselves, not pages.
    const urls = first.index ? [] : [...first.urls];
    if (first.index) {
      const children = first.urls.filter((url) => pathOf(url, host) !== null).slice(0, MAX_CHILD_SITEMAPS);
      const nested = await Promise.all(children.map((url) => fetchText(url)));
      for (const child of nested) if (child && child.status >= 200 && child.status < 300) urls.push(...parseSitemap(child.text).urls);
    }
    const paths: string[] = [];
    for (const url of urls) {
      const path = pathOf(url, host);
      if (path && isPagePath(path) && !paths.includes(path)) paths.push(path);
    }
    if (paths.length) return { paths, ok: true };
  }
  return { paths: [], ok: false };
}

export interface HostAudit {
  host: string;
  day: string;
  pages: number;
  averageScore: number;
  opened: number;
  resolved: number;
}

interface AuditPage {
  path: string;
  row: {
    status: number;
    title: string | null;
    titleLen: number;
    description: string | null;
    descLen: number;
    canonical: string | null;
    hreflangCount: number;
    jsonldTypes: string[];
    h1Count: number;
    internalLinks: number;
    bytes: number;
    ms: number;
    inSitemap: boolean;
    inLlms: boolean;
    score: number;
    issues: SeoIssue[];
  };
}

async function writeInChunks(env: Env, statements: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < statements.length; i += 40) await env.DB.batch(statements.slice(i, i + 40));
}

/**
 * One host, one day: read the sitemap, read each page, score it, then write the
 * day's rows and the findings. Bounded to MAX_PAGES_PER_HOST pages and eight
 * requests in flight, because the cron has other work to do.
 */
export async function auditHost(env: Env, host: SeoHost, t = now()): Promise<HostAudit> {
  const day = dayKey(t);
  const origin = `https://${host}`;

  const [sitemap, robots, llms] = await Promise.all([
    readSitemaps(host),
    fetchText(`${origin}/robots.txt`),
    fetchText(`${origin}/llms.txt`),
  ]);
  const robotsText = robots && robots.status >= 200 && robots.status < 300 ? robots.text : null;
  const llmsText = llms && llms.status >= 200 && llms.status < 300 ? llms.text : null;

  const sitemapPaths = sitemap.paths.slice(0, MAX_PAGES_PER_HOST);
  // The homepage is audited even when the sitemap forgets it: that is the page
  // whose `not_in_sitemap` matters most.
  const paths = sitemapPaths.includes('/') ? sitemapPaths : ['/', ...sitemapPaths].slice(0, MAX_PAGES_PER_HOST);
  const inSitemap = new Set(sitemap.paths);
  const described = llmsPaths(llmsText, host);

  const deadline = Date.now() + AUDIT_BUDGET_MS;
  const pages = await mapLimit(paths, FETCH_CONCURRENCY, async (path): Promise<AuditPage | null> => {
    if (Date.now() > deadline) return null;
    const fetched = await fetchText(`${origin}${path}`);
    if (!fetched) return null;
    const parsed = parsePage(fetched.text);
    const facts: PageFacts = {
      ...parsed,
      host,
      path,
      status: fetched.status,
      ms: fetched.ms,
      inSitemap: inSitemap.has(path),
      inLlms: described.has(path),
    };
    const review = reviewPage(facts);
    const issues = dedupeIssues(review.issues);
    return {
      path,
      row: {
        status: fetched.status,
        title: parsed.title,
        titleLen: parsed.titleLen,
        description: parsed.description,
        descLen: parsed.descLen,
        canonical: parsed.canonical,
        hreflangCount: parsed.hreflangCount,
        jsonldTypes: parsed.jsonldTypes,
        h1Count: parsed.h1Count,
        internalLinks: parsed.internalLinks,
        bytes: fetched.bytes,
        ms: fetched.ms,
        inSitemap: inSitemap.has(path),
        inLlms: described.has(path),
        score: review.score,
        issues,
      },
    };
  });

  const audited = pages.filter((page): page is AuditPage => page !== null);
  // Host-level findings only exist while the host's own files were read.
  const hostIssues: FindingHint[] = [];
  if (robotsText !== null) {
    for (const issue of robotsIssues(robotsText)) hostIssues.push({ host, path: '/', ...issue });
  }
  if (!sitemap.ok && audited.some((page) => page.path === '/')) {
    hostIssues.push({ host, path: '/', ...issueFor('missing_sitemap', 'No readable sitemap.xml for this host.') });
  }

  // One hint per host, path and code: a rule that fires twice is one finding.
  const hints: FindingHint[] = [...hostIssues];
  for (const page of audited) for (const issue of page.row.issues) hints.push({ host, path: page.path, ...issue });

  const { results: existingRows } = await env.DB.prepare(
    'SELECT id, host, path, code, resolved_at FROM seo_findings WHERE host = ?',
  )
    .bind(host)
    .all<FindingRow>();
  const existing = existingRows ?? [];

  // Only a page that answered was audited; a failed fetch must not resolve
  // yesterday's findings about it.
  const auditedPaths = audited.map((page) => page.path);
  const ifRobots = robotsText !== null && !auditedPaths.includes('/') ? ['/'] : [];
  const stale = staleFindingIds(existing, hints, { host, paths: [...auditedPaths, ...ifRobots] });
  const opened = newlyOpen(existing, hints);

  const statements: D1PreparedStatement[] = audited.map((page) =>
    env.DB.prepare(
      `INSERT INTO seo_pages
         (host, path, day, status, title, title_len, description, desc_len, canonical, hreflang_count,
          jsonld_types, h1_count, internal_links, bytes, ms, in_sitemap, in_llms, issues_json, score, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(host, path, day) DO UPDATE SET
         status = excluded.status, title = excluded.title, title_len = excluded.title_len,
         description = excluded.description, desc_len = excluded.desc_len, canonical = excluded.canonical,
         hreflang_count = excluded.hreflang_count, jsonld_types = excluded.jsonld_types,
         h1_count = excluded.h1_count, internal_links = excluded.internal_links, bytes = excluded.bytes,
         ms = excluded.ms, in_sitemap = excluded.in_sitemap, in_llms = excluded.in_llms,
         issues_json = excluded.issues_json, score = excluded.score`,
    ).bind(
      host,
      page.path,
      day,
      page.row.status,
      page.row.title,
      page.row.titleLen,
      page.row.description,
      page.row.descLen,
      page.row.canonical,
      page.row.hreflangCount,
      JSON.stringify(page.row.jsonldTypes),
      page.row.h1Count,
      page.row.internalLinks,
      page.row.bytes,
      page.row.ms,
      page.row.inSitemap ? 1 : 0,
      page.row.inLlms ? 1 : 0,
      JSON.stringify(page.row.issues),
      page.row.score,
      t,
    ),
  );

  for (const hint of hints) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO seo_findings (host, path, code, severity, detail, first_seen, last_seen, resolved_at, ticket_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
         ON CONFLICT(host, path, code) DO UPDATE SET
           severity = excluded.severity,
           detail = excluded.detail,
           last_seen = excluded.last_seen,
           resolved_at = NULL`,
      ).bind(hint.host, hint.path, hint.code, hint.severity, hint.detail.slice(0, 500), t, t),
    );
  }
  if (stale.length) {
    const marks = stale.map(() => '?').join(',');
    statements.push(
      env.DB.prepare(`UPDATE seo_findings SET resolved_at = ? WHERE id IN (${marks})`).bind(t, ...stale),
    );
  }
  await writeInChunks(env, statements);

  const total = audited.reduce((sum, page) => sum + page.row.score, 0);
  return {
    host,
    day,
    pages: audited.length,
    averageScore: audited.length ? Math.round(total / audited.length) : 0,
    opened: opened.length,
    resolved: stale.length,
  };
}

export interface AuditSummary {
  day: string;
  hosts: HostAudit[];
}

/** Both hosts, one day. The manual run and the cron call the same thing. */
export async function runAudit(env: Env, t = now()): Promise<AuditSummary> {
  const hosts: HostAudit[] = [];
  for (const host of SEO_HOSTS) {
    try {
      hosts.push(await auditHost(env, host, t));
    } catch (error) {
      console.error('seo_audit_failed', host, String(error));
    }
  }
  return { day: dayKey(t), hosts };
}

/* ——————————————————————— the GEO probe ——————————————————————— */

export interface GeoAnswer {
  answer: string;
  sources: string[];
  companies: string[];
}

const GEO_SYSTEM = [
  'You are a search assistant. A small business owner asks you the question below.',
  'Answer the way you would in a normal search answer: under 120 words, plain, and name the',
  'businesses, products or services you would actually recommend or mention.',
  'Reply with JSON only:',
  '{"answer":"<the answer>","sources":["<url>",...],"companies":["<name>",...]}',
  'sources are the URLs you would cite (an empty array is fine). companies are the businesses',
  'or products you would name in the answer, exact names and nothing else.',
].join('\n');

/** The JSON reply as {answer, sources, companies}; null when it is not that shape. */
export function parseGeoReply(content: string): GeoAnswer | null {
  const raw = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const data = parsed as { answer?: unknown; sources?: unknown; companies?: unknown };
  if (typeof data.answer !== 'string' || !data.answer.trim()) return null;
  const list = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
      if (typeof item === 'string' && item.trim() && !out.includes(item.trim())) out.push(item.trim().slice(0, 300));
      if (out.length >= 20) break;
    }
    return out;
  };
  return { answer: data.answer.trim().slice(0, 4_000), sources: list(data.sources), companies: list(data.companies) };
}

/** Whether an answer (or a URL in it) names us: the two hosts, or the category. */
export function geoMentions(text: string): boolean {
  return /malipetek\.dev|\bmalipetek\b|vibe contracting/i.test(text);
}

/** One DeepSeek call. Null without a key, or when the reply is unusable. */
async function askDeepSeek(env: Env, system: string, user: string): Promise<string | null> {
  if (!env.DEEPSEEK_API_KEY) return null;
  const base = (env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL || 'deepseek-chat',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn('seo_deepseek_failed', res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? null;
  } catch (error) {
    console.warn('seo_deepseek_error', String(error));
    return null;
  }
}

export interface GeoSummary {
  day: string;
  questions: number;
  runs: number;
  mentions: number;
  skipped?: 'no_key';
}

/**
 * Ask the questions a buyer would ask. One row per question per probe, so the
 * mention rate is a series; the excerpt is what the desk shows.
 */
export async function probeGeo(env: Env, t = now()): Promise<GeoSummary> {
  const day = dayKey(t);
  const { geoQuestions } = await readSeoSettings(env);
  if (!env.DEEPSEEK_API_KEY) return { day, questions: geoQuestions.length, runs: 0, mentions: 0, skipped: 'no_key' };

  const questions = geoQuestions.slice(0, MAX_GEO_QUESTIONS);
  const answers = await mapLimit(questions, 3, async (question) => {
    const reply = await askDeepSeek(env, GEO_SYSTEM, question);
    return reply === null ? null : parseGeoReply(reply);
  });

  const statements: D1PreparedStatement[] = [];
  let mentions = 0;
  answers.forEach((answer, index) => {
    if (!answer) return;
    const named = geoMentions([answer.answer, ...answer.sources].join('\n'));
    if (named) mentions += 1;
    statements.push(
      env.DB.prepare(
        `INSERT INTO seo_geo_runs (day, question, engine, answer_excerpt, mentions_us, cited_urls_json, competitors_json, created_at)
         VALUES (?, ?, 'deepseek', ?, ?, ?, ?, ?)`,
      ).bind(
        day,
        questions[index],
        answer.answer.slice(0, 600),
        named ? 1 : 0,
        JSON.stringify(answer.sources),
        JSON.stringify(answer.companies),
        t,
      ),
    );
  });
  await writeInChunks(env, statements);
  return { day, questions: questions.length, runs: statements.length, mentions };
}

/* ——————————————————————— citations ——————————————————————— */

export interface CitationCheck {
  checked: number;
  verified: number;
  dropped: number;
}

/** Read each claimed profile and keep `link_verified_at` honest. */
export async function checkCitations(env: Env, t = now()): Promise<CitationCheck> {
  const { results } = await env.DB.prepare(
    `SELECT id, profile_url, status FROM seo_citations
      WHERE profile_url IS NOT NULL AND profile_url <> ''
      ORDER BY COALESCE(last_checked, 0), id LIMIT ?`,
  )
    .bind(MAX_CITATIONS_CHECKED)
    .all<{ id: number; profile_url: string; status: string }>();

  let checked = 0;
  let verified = 0;
  let dropped = 0;
  for (const row of results ?? []) {
    const page = await fetchText(row.profile_url);
    if (!page) continue;
    checked += 1;
    const live = page.status >= 200 && page.status < 300;
    const found = live && geoMentions(page.text);
    if (found) verified += 1;
    // A page we could not read proves nothing; only a read page that no longer
    // links to us loses its verification.
    await env.DB.prepare(
      `UPDATE seo_citations
          SET last_checked = ?,
              link_verified_at = CASE WHEN ? THEN ? WHEN ? THEN NULL ELSE link_verified_at END,
              status = CASE WHEN ? THEN 'verified' WHEN ? AND status = 'verified' THEN 'live' ELSE status END,
              updated_at = ?
        WHERE id = ?`,
    )
      .bind(t, found ? 1 : 0, t, live ? 1 : 0, found ? 1 : 0, live ? 1 : 0, t, row.id)
      .run();
    if (live && !found && row.status === 'verified') dropped += 1;
  }
  return { checked, verified, dropped };
}

/* ——————————————————————— Google rankings ——————————————————————— */

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Which of our two hosts a SERP domain belongs to; any subdomain counts. */
export function seoHostOf(domain: string): SeoHost | null {
  const name = domain.trim().toLowerCase().replace(/\.$/, '');
  if (!name) return null;
  if (name === 'malipetek.dev' || name.endsWith('.malipetek.dev')) return 'malipetek.dev';
  return null;
}

export interface RankTaskResult {
  keyword: string;
  host: SeoHost | null;
  /** NULL when neither host is in the top 100. */
  position: number | null;
  url: string | null;
  topDomains: string[];
  /** The task's own cost in USD, as DataForSEO reports it. */
  cost: number;
}

/**
 * One task_get task into the row the desk keeps: our best organic position,
 * the URL that ranked, and the domains ahead of us. A task still in the queue
 * has no `result` yet and returns null, so the caller keeps it pending.
 */
export function parseRankTask(value: unknown): RankTaskResult | null {
  const task = record(value);
  if (!task) return null;
  const data = record(task.data) ?? {};
  const keyword = typeof data.keyword === 'string' ? data.keyword.trim() : '';
  const results = list(task.result);
  if (!keyword || !results.length) return null;
  const serp = record(results[0]);
  if (!serp) return null;

  let best: number | null = null;
  let url: string | null = null;
  let host: SeoHost | null = null;
  const domains: string[] = [];
  for (const value of list(serp.items)) {
    const item = record(value);
    if (!item || item.type !== 'organic') continue;
    const domain = typeof item.domain === 'string' ? item.domain : '';
    if (domain && !domains.includes(domain)) domains.push(domain);
    const matched = seoHostOf(domain);
    if (!matched) continue;
    // rank_group is the position among organic results; rank_absolute counts
    // the SERP features above us too. Prefer the organic position.
    const group = Number(item.rank_group);
    const absolute = Number(item.rank_absolute);
    const position = Number.isFinite(group) && group > 0 ? group : Number.isFinite(absolute) && absolute > 0 ? absolute : null;
    if (position === null) continue;
    if (best === null || position < best) {
      best = position;
      url = typeof item.url === 'string' ? item.url : null;
      host = matched;
    }
  }
  return { keyword, host, position: best, url, topDomains: domains.slice(0, 10), cost: Number(task.cost) || 0 };
}

/** Every finished task in a task_get response. Queued or failed tasks are skipped. */
export function parseRankTasks(payload: unknown): RankTaskResult[] {
  const body = record(payload);
  if (!body) return [];
  return list(body.tasks)
    .map(parseRankTask)
    .filter((task): task is RankTaskResult => task !== null);
}

export interface RankPoint {
  keyword: string;
  position: number | null;
}

/**
 * Week-over-week turbulence: the mean absolute position change over keywords
 * tracked in both checks, with "not in the top 100" counted as 101. A big
 * number during a core update means the SERP is moving, not that we did.
 */
export function rankSwing(previous: readonly RankPoint[], current: readonly RankPoint[]): number | null {
  const before = new Map(previous.map((row) => [row.keyword, row.position]));
  let total = 0;
  let counted = 0;
  for (const row of current) {
    if (!before.has(row.keyword)) continue;
    total += Math.abs((row.position ?? NOT_RANKED) - (before.get(row.keyword) ?? NOT_RANKED));
    counted += 1;
  }
  return counted ? Math.round((total / counted) * 10) / 10 : null;
}

interface RankPendingTask {
  id: string;
  keyword: string;
  cost: number;
}

interface RankPending {
  day: string;
  postedAt: number;
  location: RankLocation;
  tasks: RankPendingTask[];
}

/** The queued DataForSEO tasks, in settings under seo_rank_pending. */
async function readRankPending(env: Env): Promise<RankPending | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'seo_rank_pending'").first<{ value: string }>();
  if (!row) return null;
  try {
    const parsed = record(JSON.parse(row.value));
    if (!parsed) return null;
    const day = typeof parsed.day === 'string' ? parsed.day : '';
    const location = record(parsed.location);
    const tasks = list(parsed.tasks)
      .map((task) => record(task))
      .filter((task): task is Record<string, unknown> => task !== null)
      .map((task) => ({
        id: typeof task.id === 'string' ? task.id : '',
        keyword: typeof task.keyword === 'string' ? task.keyword : '',
        cost: Number(task.cost) || 0,
      }))
      .filter((task) => task.id && task.keyword);
    if (!day || !Number.isFinite(dayNumber(day)) || !location || !tasks.length) return null;
    const locationCode = Number(location.locationCode);
    const languageCode = typeof location.languageCode === 'string' ? location.languageCode : '';
    if (!Number.isInteger(locationCode) || !languageCode) return null;
    return {
      day,
      postedAt: Number(parsed.postedAt) || 0,
      location: { locationCode, languageCode },
      tasks,
    };
  } catch {
    return null;
  }
}

async function writeRankPending(env: Env, pending: RankPending | null): Promise<void> {
  if (!pending) {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'seo_rank_pending'").run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('seo_rank_pending', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(JSON.stringify(pending), now())
    .run();
}

/**
 * One DataForSEO call. The key is the account's base64 `login:password`; the
 * API wants it as `Authorization: Basic <key>`. A failed call is logged and
 * read as "nothing this tick": a cron retry is cheaper than a thrown error.
 */
async function dataforseo(env: Env, path: string, body?: unknown): Promise<Record<string, unknown> | null> {
  const key = env.DATAFORSEO_API_KEY;
  if (!key) return null;
  try {
    const response = await fetch(`${DATAFORSEO_BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Basic ${key}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      console.warn('seo_ranks_http', path, response.status);
      return null;
    }
    const envelope = record((await response.json()) as unknown);
    const status = Number(envelope?.status_code);
    if (status !== 20000) {
      console.warn('seo_ranks_api', path, status, envelope?.status_message);
      return null;
    }
    return envelope;
  } catch (error) {
    console.warn('seo_ranks_error', path, String(error));
    return null;
  }
}

/** Queue one standard-queue task per keyword, all in a single POST. */
async function postRankTasks(env: Env, keywords: readonly string[], location: RankLocation, t: number): Promise<RankPending | null> {
  const payload = await dataforseo(
    env,
    '/serp/google/organic/task_post',
    keywords.map((keyword) => ({
      keyword,
      location_code: location.locationCode,
      language_code: location.languageCode,
      depth: RANK_DEPTH,
    })),
  );
  if (!payload) return null;
  const tasks: RankPendingTask[] = [];
  list(payload.tasks).forEach((value, index) => {
    const task = record(value);
    if (!task) return;
    const id = typeof task.id === 'string' ? task.id : '';
    if (!id) return;
    const data = record(task.data) ?? {};
    const keyword = typeof data.keyword === 'string' && data.keyword ? data.keyword : (keywords[index] ?? '');
    if (!keyword) return;
    tasks.push({ id, keyword, cost: Number(task.cost) || 0 });
  });
  if (!tasks.length) return null;
  return { day: dayKey(t), postedAt: t, location, tasks };
}

export interface RankRun {
  day: string;
  posted: number;
  collected: number;
  pending: number;
  cost: number;
  skipped?: 'no_key' | 'no_keywords' | 'api_failed';
}

/**
 * Read the tasks that are ready and keep the rest queued. The standard queue
 * can take minutes, so a check spans one or more five-minute cron ticks; the
 * pending list in settings is the state between them.
 */
async function collectRankTasks(env: Env, pending: RankPending, t: number): Promise<RankRun> {
  const readyPayload = await dataforseo(env, '/serp/google/organic/tasks_ready');
  const ready = new Set<string>();
  for (const value of list(readyPayload?.tasks)) {
    const task = record(value);
    for (const item of list(task?.result)) {
      const entry = record(item);
      if (entry && typeof entry.id === 'string') ready.add(entry.id);
    }
  }
  // A tasks_ready that failed proves nothing; try every task and let task_get
  // report the queued ones. Otherwise only the ids it listed are fetched.
  const stale = t - pending.postedAt > RANK_PENDING_MAX;
  const due = pending.tasks.filter((task) => (readyPayload ? ready.has(task.id) : true) && !(stale && !ready.has(task.id)));

  const statements: D1PreparedStatement[] = [];
  const done = new Set<string>();
  let cost = 0;
  let collected = 0;
  for (const task of due) {
    const payload = await dataforseo(env, `/serp/google/organic/task_get/regular/${encodeURIComponent(task.id)}`);
    if (!payload) continue;
    const results = parseRankTasks(payload);
    if (!results.length) continue; // still queued, or the task failed
    const result = results[0];
    const taskCost = task.cost || result.cost;
    cost += taskCost;
    collected += 1;
    done.add(task.id);
    statements.push(
      env.DB.prepare(
        `INSERT INTO seo_ranks (day, keyword, location_code, language_code, host, position, url, top_domains_json, cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(keyword, day) DO UPDATE SET
           location_code = excluded.location_code, language_code = excluded.language_code,
           host = excluded.host, position = excluded.position, url = excluded.url,
           top_domains_json = excluded.top_domains_json, cost = excluded.cost`,
      ).bind(
        pending.day,
        result.keyword || task.keyword,
        pending.location.locationCode,
        pending.location.languageCode,
        result.host,
        result.position,
        result.url,
        JSON.stringify(result.topDomains),
        taskCost,
      ),
    );
  }
  await writeInChunks(env, statements);

  const remaining = pending.tasks.filter((task) => !done.has(task.id) && !(stale && !ready.has(task.id)));
  await writeRankPending(env, remaining.length ? { ...pending, tasks: remaining } : null);
  return { day: pending.day, posted: 0, collected, pending: remaining.length, cost };
}

/**
 * The weekly check. With tasks already queued it only collects; otherwise it
 * posts this week's keywords and marks the week. Without the secret it does
 * nothing and says why, so the desk can explain itself.
 */
export async function runRanks(env: Env, t = now()): Promise<RankRun> {
  const day = dayKey(t);
  if (!env.DATAFORSEO_API_KEY) return { day, posted: 0, collected: 0, pending: 0, cost: 0, skipped: 'no_key' };

  const pending = await readRankPending(env);
  if (pending) return collectRankTasks(env, pending, t);

  const { rankKeywords, rankLocation } = await readSeoSettings(env);
  const keywords = rankKeywords.slice(0, MAX_RANK_KEYWORDS);
  if (!keywords.length) return { day, posted: 0, collected: 0, pending: 0, cost: 0, skipped: 'no_keywords' };

  const queued = await postRankTasks(env, keywords, rankLocation, t);
  if (!queued) return { day, posted: 0, collected: 0, pending: 0, cost: 0, skipped: 'api_failed' };
  await writeRankPending(env, queued);
  await markState(env, 'lastRanksAt', t);
  const cost = queued.tasks.reduce((sum, task) => sum + task.cost, 0);
  return { day: queued.day, posted: queued.tasks.length, collected: 0, pending: queued.tasks.length, cost: Math.round(cost * 1_000_000) / 1_000_000 };
}

interface RankRow {
  keyword: string;
  location_code: number;
  language_code: string;
  host: string | null;
  position: number | null;
  url: string | null;
  top_domains_json: string;
  cost: number;
}

export interface RankSeriesPoint {
  day: string;
  avgPosition: number;
  inTop10: number;
  inTop100: number;
  tracked: number;
}

/**
 * Everything the Rankings tab and the overview card read: this check's rows
 * against last week's, the series, the swing and whether the key is set.
 */
export async function rankSnapshot(env: Env, t = now()) {
  const [settings, pending] = await Promise.all([readSeoSettings(env), readRankPending(env)]);
  const latest = await env.DB.prepare('SELECT MAX(day) AS day FROM seo_ranks').first<{ day: string | null }>();
  const latestDay = latest?.day ?? null;

  let rows: RankRow[] = [];
  let previous: RankRow[] = [];
  if (latestDay) {
    const current = await env.DB.prepare(
      `SELECT keyword, location_code, language_code, host, position, url, top_domains_json, cost
         FROM seo_ranks WHERE day = ?
        ORDER BY CASE WHEN position IS NULL THEN 1 ELSE 0 END, position, keyword`,
    )
      .bind(latestDay)
      .all<RankRow>();
    rows = current.results ?? [];
    const previousDay = await env.DB.prepare('SELECT day FROM seo_ranks WHERE day < ? ORDER BY day DESC LIMIT 1')
      .bind(latestDay)
      .first<{ day: string }>();
    if (previousDay) {
      const before = await env.DB.prepare(
        `SELECT keyword, location_code, language_code, host, position, url, top_domains_json, cost
           FROM seo_ranks WHERE day = ?`,
      )
        .bind(previousDay.day)
        .all<RankRow>();
      previous = before.results ?? [];
    }
  }

  const since = dayKey(t - 120 * DAY);
  const { results } = await env.DB.prepare(
    `SELECT day, COUNT(*) AS tracked,
            AVG(CASE WHEN position IS NULL THEN ? ELSE position END) AS average,
            SUM(CASE WHEN position IS NOT NULL AND position <= 10 THEN 1 ELSE 0 END) AS top10,
            SUM(CASE WHEN position IS NOT NULL AND position <= 100 THEN 1 ELSE 0 END) AS top100
       FROM seo_ranks WHERE day >= ? GROUP BY day ORDER BY day`,
  )
    .bind(NOT_RANKED, since)
    .all<{ day: string; tracked: number; average: number; top10: number; top100: number }>();

  const series: RankSeriesPoint[] = (results ?? []).map((row) => ({
    day: row.day,
    avgPosition: Math.round(row.average * 10) / 10,
    inTop10: row.top10,
    inTop100: row.top100,
    tracked: row.tracked,
  }));

  const before = new Map(previous.map((row) => [row.keyword, row.position]));
  const latestPoint = series.at(-1) ?? null;

  return {
    rankReady: Boolean(env.DATAFORSEO_API_KEY),
    pending: pending?.tasks.length ?? 0,
    pendingDay: pending?.day ?? null,
    latestDay,
    location: settings.rankLocation,
    keywords: settings.rankKeywords,
    swing: rankSwing(previous, rows),
    series,
    avgPosition: latestPoint?.avgPosition ?? null,
    inTop10: latestPoint?.inTop10 ?? 0,
    inTop100: latestPoint?.inTop100 ?? 0,
    rows: rows.map((row) => {
      const previousPosition = before.has(row.keyword) ? (before.get(row.keyword) ?? null) : null;
      return {
        keyword: row.keyword,
        host: row.host,
        position: row.position,
        url: row.url,
        prevPosition: previousPosition,
        change: row.position !== null && previousPosition !== null ? previousPosition - row.position : null,
        topDomains: parseJsonArray(row.top_domains_json),
        cost: row.cost,
      };
    }),
  };
}

/* ——————————————————————— the cron ——————————————————————— */

export interface SeoRun {
  audit?: AuditSummary | { skipped: string };
  geo?: GeoSummary | { skipped: string };
  citations?: CitationCheck | { skipped: string };
  ranks?: RankRun;
}

/**
 * The five-minute cron's SEO work: at most one audit a day, one probe, one
 * citation pass and one rank check a week. The attempt is recorded before the
 * work so a failing host cannot make the cron read sixty pages every five
 * minutes. Queued rank tasks are collected on every tick until they land.
 */
export async function runSeo(env: Env, t = now()): Promise<SeoRun> {
  const state = await readSeoState(env);
  const out: SeoRun = {};

  if (state.lastAuditAt === null || t - state.lastAuditAt >= AUDIT_EVERY) {
    await markState(env, 'lastAuditAt', t);
    try {
      out.audit = await runAudit(env, t);
    } catch (error) {
      console.error('seo_audit_failed', String(error));
      out.audit = { skipped: 'failed' };
    }
  }

  if (state.lastGeoAt === null || t - state.lastGeoAt >= WEEKLY) {
    if (!env.DEEPSEEK_API_KEY) out.geo = { skipped: 'no_key' };
    else {
      await markState(env, 'lastGeoAt', t);
      try {
        out.geo = await probeGeo(env, t);
      } catch (error) {
        console.error('seo_geo_failed', String(error));
        out.geo = { skipped: 'failed' };
      }
    }
  }

  if (state.lastCitationsAt === null || t - state.lastCitationsAt >= WEEKLY) {
    await markState(env, 'lastCitationsAt', t);
    try {
      out.citations = await checkCitations(env, t);
    } catch (error) {
      console.error('seo_citations_failed', String(error));
      out.citations = { skipped: 'failed' };
    }
  }

  // A queued rank task is collected even when the week is not up: the standard
  // queue can take several cron ticks, and the pending list is the state.
  const rankPending = await readRankPending(env);
  if (rankPending || state.lastRanksAt === null || t - state.lastRanksAt >= WEEKLY) {
    if (!env.DATAFORSEO_API_KEY) {
      if (!rankPending) out.ranks = { day: dayKey(t), posted: 0, collected: 0, pending: 0, cost: 0, skipped: 'no_key' };
    } else {
      try {
        out.ranks = await runRanks(env, t);
      } catch (error) {
        console.error('seo_ranks_failed', String(error));
        out.ranks = { day: dayKey(t), posted: 0, collected: 0, pending: 0, cost: 0, skipped: 'api_failed' };
      }
    }
  }
  return out;
}

/* ——————————————————————— the cycle ——————————————————————— */

export const CYCLE_PROJECT = 'malipetek-dev-site';
/** A cycle ticket younger than this is not joined by another. */
const RETRY_AFTER = DAY;
/** The brief lists this many findings; the rest wait for the next cycle. */
export const CYCLE_FINDINGS = 5;
/** How many profile drafts one cycle may ask for. */
const CYCLE_DRAFTS = 6;

export interface SeoCycleResult {
  filed: boolean;
  id?: number;
  reason?: string;
}

export interface FindingBrief {
  id: number;
  host: string;
  path: string;
  code: string;
  severity: Severity;
  detail: string;
}

export interface DraftCandidate {
  id: number;
  platform: string;
  domain: string;
  dr: number | null;
}

export interface RankBrief {
  keyword: string;
  position: number | null;
  url: string | null;
  host: string | null;
  /** false until the first rank check has run. */
  checked: boolean;
}

/** The five worst open findings the agent should fix, worst first. */
async function topFindings(env: Env, limit = CYCLE_FINDINGS): Promise<FindingBrief[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, host, path, code, severity, detail FROM seo_findings
      WHERE resolved_at IS NULL AND severity IN ('high', 'medium')
      ORDER BY CASE severity WHEN 'high' THEN 0 ELSE 1 END, last_seen DESC, id
      LIMIT ?`,
  )
    .bind(limit)
    .all<FindingBrief>();
  return results ?? [];
}

async function openFindingCount(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM seo_findings WHERE resolved_at IS NULL AND severity IN ('high', 'medium')`,
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

/** The tracked keywords with the position the last check saw, none left out. */
async function rankBriefs(env: Env, keywords: readonly string[]): Promise<RankBrief[]> {
  const latest = await env.DB.prepare('SELECT MAX(day) AS day FROM seo_ranks').first<{ day: string | null }>();
  const rows = latest?.day
    ? (
        await env.DB.prepare('SELECT keyword, position, url, host FROM seo_ranks WHERE day = ?')
          .bind(latest.day)
          .all<{ keyword: string; position: number | null; url: string | null; host: string | null }>()
      ).results ?? []
    : [];
  const seen = new Map(rows.map((row) => [row.keyword, row]));
  return keywords.map((keyword) => {
    const row = seen.get(keyword);
    return row
      ? { keyword, position: row.position, url: row.url, host: row.host, checked: true }
      : { keyword, position: null, url: null, host: null, checked: false };
  });
}

/** The profile rows a cycle may draft copy for: the ones not written yet. */
async function draftCandidates(env: Env): Promise<DraftCandidate[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, platform, domain, dr FROM seo_citations
      WHERE status = 'todo' ORDER BY dr DESC, id LIMIT ?`,
  )
    .bind(CYCLE_DRAFTS)
    .all<DraftCandidate>();
  return results ?? [];
}

/**
 * The brief. It carries the findings, the rules from AGENTS.md that a wrong
 * guess would break, the hold when there is one, and the outbox contract.
 */
export function seoBrief(options: {
  findings: FindingBrief[];
  drafts: DraftCandidate[];
  held: VolatilityState;
  total: number;
  ranks?: RankBrief[];
}): string {
  const { findings, drafts, held, total, ranks } = options;
  const lines = [
    'Fix the search and assistant visibility issues below on our own host.',
    '',
    'The site, from AGENTS.md:',
    '- malipetek.dev is the developer lab: /kb/*, /plugins/*, /plugins.json,',
    '  /blog/*, /experience/*, /projects/*, /pdfextractor/*, and its own /mcp.',
    '  The portal lives on ptechsolutions.net; its paths here 301.',
    '- Pass site="lab" to Base.astro (it sets the nav, canonical origin and footer).',
    '- llms.txt, robots.txt, sitemap.xml and sitemap-index.xml are server routes and',
    '  answer per Host. Do not add a static public/robots.txt or public/llms.txt;',
    '  assets are served before the Worker.',
    '- The list of sitemap pages is written per request in src/pages/sitemap.xml.ts,',
    '  so a new page appears there only if the page is added to that route too.',
    '',
    'Findings to fix, worst first:',
    ...findings.map(
      (finding, index) =>
        `${index + 1}. finding_id ${finding.id} — ${finding.host}${finding.path} — ${finding.code} (${finding.severity})\n   ${finding.detail}`,
    ),
    '',
    ...(ranks && ranks.length
      ? [
          'Keywords & rankings. These are the Google searches we sell against, with the',
          'position the weekly check last saw (United States, English). A keyword ranking',
          'low tells you which page to strengthen; one outside the top 100 needs a page',
          'that answers it, not a tweak:',
          ...ranks.map((rank) =>
            rank.checked
              ? rank.position !== null
                ? `- ${rank.keyword}: #${rank.position}${rank.url ? ` — ${rank.url}` : ''}`
                : `- ${rank.keyword}: not in the top 100`
              : `- ${rank.keyword}: not checked yet`,
          ),
          ...(held.held
            ? ['The volatility hold is on: only the technical fixes below are allowed, and no copy rewrite for a ranking while Google is still moving.']
            : []),
          '',
        ]
      : []),
    ...(held.held
      ? [
          `Volatility hold: a Google core update started ${held.since} (within the last ${HOLD_DAYS} days).`,
          'Rankings swing during the rollout, and rewriting copy while they swing hides what',
          'actually worked. Do the technical fixes only:',
          '- fix a missing or broken title, description, canonical, JSON-LD, h1, hreflang,',
          '  sitemap/llms/robots coverage or a slow page;',
          '- do NOT rewrite copy that already works, and do not change URLs or redirects.',
          'Say in the note which findings you left to the next cycle for this reason.',
          '',
        ]
      : []),
    ...(drafts.length
      ? [
          'Profile drafts. These placements have no profile yet. For each, write a short bio',
          'and the link text to use, in our voice:',
          ...drafts.map((draft) => `- citation_id ${draft.id}: ${draft.platform} (${draft.domain}, DR ${draft.dr ?? '?'})`),
          '',
          'The voice rules are marketing/style/README.md (the humanizer and stop-slop skills',
          'it points to): first person, dry, two sentences at most, say what vibe contracting',
          'is in plain words. No em dash, no "not X, but Y", no stock AI words, no invented',
          'results or audiences. The desk runs the same checks as the post cycle and will',
          'refuse a draft that trips them.',
          '',
        ]
      : []),
    'Rules:',
    '- Work in your own worktree on a branch, commit there, open a PR. Never push to',
    '  master: master is the deploy branch and Cloudflare deploys every push.',
    '- `pnpm install --frozen-lockfile` once, then `pnpm --dir worker test` (typecheck',
    '  plus unit) before the PR. The Cloudflare build does not run the tests.',
    '- Fix the code, not the database: the desk reads the live pages after a deploy.',
    '  Do not touch migrations unless a finding cannot be fixed without one.',
    '- One finding is one change where you can. If two share a cause, one commit is fine.',
    '- A finding you cannot fix now is skipped with a reason, not quietly dropped.',
    '',
    'End your reply with this block, and nothing after it:',
    '',
    '<<<OUTBOX',
    '{"fixed":[{"finding_id":1,"files":["src/pages/index.astro"],"note":"added the missing description"}],"skipped":[{"finding_id":2,"reason":"needs a copy decision from Ali"}],"drafts":[{"citation_id":3,"bio":"...","link_text":"..."}],"pr":"https://github.com/malipetek/malipetek.github.io/pull/0"}',
    'OUTBOX>>>',
    '',
    `Keep the prose before it to a few lines: the report keeps the first 8,000 characters,`,
    `and a block cut in half is a cycle without fixes. There are ${total} open findings at`,
    'medium or above; the next cycle takes the rest.',
  ];
  return lines.join('\n');
}

/**
 * File one SEO cycle ticket when the desk asks for one. Same shape as
 * ensureContentCycle: one open cycle at a time, one a day, and only when there
 * is a finding worth an agent's time.
 */
export async function ensureSeoCycle(env: Env, t = now(), options: { force?: boolean } = {}): Promise<SeoCycleResult> {
  const settings = await readSeoSettings(env);
  if (!settings.autoCycle && !options.force) return { filed: false, reason: 'auto_off' };

  const open = await env.DB.prepare(
    `SELECT id FROM tickets WHERE seo_cycle = 1 AND status IN ('approved', 'in_progress') LIMIT 1`,
  ).first<{ id: number }>();
  if (open) return { filed: false, reason: 'open_cycle', id: open.id };

  const findings = await topFindings(env);
  if (!findings.length) return { filed: false, reason: 'no_findings' };

  if (!options.force) {
    const recent = await env.DB.prepare(
      `SELECT id FROM tickets WHERE seo_cycle > 0 AND created_at > ? ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(t - RETRY_AFTER)
      .first<{ id: number }>();
    if (recent) return { filed: false, reason: 'recent_cycle', id: recent.id };
  }

  const project = await env.DB.prepare('SELECT id FROM projects WHERE slug = ?').bind(CYCLE_PROJECT).first<{ id: string }>();
  if (!project) return { filed: false, reason: 'no_project' };

  const admin = await env.DB.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`).first<{ id: string }>();
  if (!admin) return { filed: false, reason: 'no_admin' };

  const today = dayKey(t);
  const { results: events } = await env.DB.prepare(
    `SELECT day, kind FROM seo_events WHERE kind = 'core_update' AND day >= ?`,
  )
    .bind(dayKey((dayNumber(today) - HOLD_DAYS) * DAY))
    .all<{ day: string; kind: string }>();
  const held = volatilityHold({ hold: settings.volatilityHold, events: events ?? [], today });

  const drafts = await draftCandidates(env);
  const total = await openFindingCount(env);
  const ranks = await rankBriefs(env, settings.rankKeywords);
  const title = `SEO fixes: ${findings.length} finding${findings.length === 1 ? '' : 's'}, ${dayLabelOf(today)}`;

  const ticket = await env.DB.prepare(
    `INSERT INTO tickets (user_id, project_id, title, status, kind, source, priority, requires, executor, attention, seo_cycle, created_at, updated_at)
     VALUES (?, ?, ?, 'approved', 'system', 'dsh', 0, '[]', NULL, 'auto', 1, ?, ?) RETURNING id`,
  )
    .bind(admin.id, project.id, title, t, t)
    .first<{ id: number }>();
  if (!ticket) return { filed: false, reason: 'insert_failed' };

  await env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'ali', ?, 1, ?)`)
    .bind(ticket.id, seoBrief({ findings, drafts, held, total, ranks }), t)
    .run();
  return { filed: true, id: ticket.id };
}

/* ——————————————————————— the OUTBOX ——————————————————————— */

export interface SeoFix {
  findingId: number;
  files: string[];
  note: string;
}

export interface SeoSkip {
  findingId: number;
  reason: string;
}

export interface SeoDraft {
  citationId: number;
  bio: string;
  linkText: string;
}

export interface SeoOutbox {
  fixed: SeoFix[];
  skipped: SeoSkip[];
  drafts: SeoDraft[];
  pr: string | null;
}

const int = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : null;

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * The block at the end of the agent's reply. Same delimiter as the content
 * cycle's outbox, a different payload; null when the block is missing or is
 * not readable JSON, because a half-read fix list is worse than none.
 */
export function parseSeoOutbox(summary: string): SeoOutbox | null {
  const start = summary.lastIndexOf('<<<OUTBOX');
  if (start < 0) return null;
  const end = summary.indexOf('OUTBOX>>>', start + 9);
  if (end < 0) return null;
  const raw = summary
    .slice(start + 9, end)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const data = parsed as { fixed?: unknown; skipped?: unknown; drafts?: unknown; pr?: unknown };

  const fixed: SeoFix[] = [];
  const seenFixed = new Set<number>();
  for (const item of Array.isArray(data.fixed) ? data.fixed : []) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { finding_id?: unknown; files?: unknown; note?: unknown };
    const id = int(record.finding_id);
    if (id === null || seenFixed.has(id)) continue;
    seenFixed.add(id);
    const files = Array.isArray(record.files)
      ? record.files
          .filter((file): file is string => typeof file === 'string' && Boolean(file.trim()))
          .map((file) => file.trim().slice(0, 300))
          .slice(0, 20)
      : [];
    fixed.push({ findingId: id, files, note: text(record.note, 300) });
  }

  const skipped: SeoSkip[] = [];
  for (const item of Array.isArray(data.skipped) ? data.skipped : []) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { finding_id?: unknown; reason?: unknown };
    const id = int(record.finding_id);
    if (id === null || seenFixed.has(id)) continue;
    seenFixed.add(id);
    skipped.push({ findingId: id, reason: text(record.reason, 300) || 'no reason given' });
  }

  const drafts: SeoDraft[] = [];
  const seenDrafts = new Set<number>();
  for (const item of Array.isArray(data.drafts) ? data.drafts : []) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { citation_id?: unknown; bio?: unknown; link_text?: unknown };
    const id = int(record.citation_id);
    const bio = text(record.bio, 600);
    if (id === null || seenDrafts.has(id) || !bio) continue;
    seenDrafts.add(id);
    drafts.push({ citationId: id, bio, linkText: text(record.link_text, 120) });
  }

  const pr = text(data.pr, 400);
  return { fixed, skipped, drafts, pr: /^https?:\/\//i.test(pr) ? pr : null };
}

/** A bio is public text in our name: the same checks a post gets. */
export function cleanDraft(text: string): { ok: true; text: string } | { ok: false; reason: string } {
  const value = text.replace(/\s+/g, ' ').trim();
  if (!value) return { ok: false, reason: 'empty' };
  if (value.length > 600) return { ok: false, reason: `${value.length} characters, 600 allowed` };
  for (const rule of SLOP) if (rule.pattern.test(value)) return { ok: false, reason: rule.reason };
  return { ok: true, text: value };
}

export interface SeoCycleFinish {
  handled: boolean;
  fixed: number;
  drafts: number;
  skipped: number;
  reason?: string;
}

async function note(env: Env, ticketId: number, body: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 1, ?)`)
    .bind(ticketId, body, now())
    .run();
}

async function seoEvent(env: Env, event: { kind: string; label: string; source: string }, t = now()): Promise<void> {
  await env.DB.prepare('INSERT INTO seo_events (day, kind, label, source, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(dayKey(t), event.kind, event.label.slice(0, 300), event.source, t)
    .run();
}

/**
 * The cycle's reply, recorded: ticket_id on the findings it says it fixed, a
 * `fix` event each, the profile drafts into the citation rows, and the ticket
 * closed with what happened. Called after finishRun, so the ticket already
 * reads "In review".
 */
export async function finishSeoCycle(env: Env, ticketId: number, summary: string, ok: boolean): Promise<SeoCycleFinish> {
  const ticket = await env.DB.prepare('SELECT id, seo_cycle FROM tickets WHERE id = ?').bind(ticketId).first<{
    id: number;
    seo_cycle: number;
  }>();
  if (!ticket || ticket.seo_cycle !== 1) return { handled: false, fixed: 0, drafts: 0, skipped: 0 };

  const t = now();
  if (!ok) {
    await note(env, ticketId, 'The run failed, so no finding was recorded as fixed. The cycle tries again tomorrow.');
    await seoEvent(env, { kind: 'cycle_failed', label: `#${ticketId}: run failed`, source: 'fleet' }, t);
    return { handled: true, fixed: 0, drafts: 0, skipped: 0, reason: 'run_failed' };
  }

  const outbox = parseSeoOutbox(summary);
  if (!outbox) {
    await note(env, ticketId, 'The reply had no readable outbox block, so no finding was recorded. The cycle tries again tomorrow.');
    await seoEvent(env, { kind: 'cycle_failed', label: `#${ticketId}: no outbox`, source: 'fleet' }, t);
    return { handled: true, fixed: 0, drafts: 0, skipped: 0, reason: 'no_outbox' };
  }

  /* —— the findings the agent says it fixed —— */
  const fixedIds = outbox.fixed.map((fix) => fix.findingId);
  const findings = new Map<number, { id: number; host: string; path: string; code: string }>();
  if (fixedIds.length) {
    const marks = fixedIds.map(() => '?').join(',');
    const { results } = await env.DB.prepare(`SELECT id, host, path, code FROM seo_findings WHERE id IN (${marks})`)
      .bind(...fixedIds)
      .all<{ id: number; host: string; path: string; code: string }>();
    for (const row of results ?? []) findings.set(row.id, row);
  }

  let fixed = 0;
  const known: string[] = [];
  for (const item of outbox.fixed) {
    const finding = findings.get(item.findingId);
    if (!finding) continue;
    await env.DB.prepare('UPDATE seo_findings SET ticket_id = ? WHERE id = ?').bind(ticketId, item.findingId).run();
    await seoEvent(
      env,
      {
        kind: 'fix',
        label: `${finding.host}${finding.path} — ${finding.code}${item.note ? `: ${item.note}` : ''}`,
        source: 'agent',
      },
      t,
    );
    fixed += 1;
    known.push(`${finding.host}${finding.path} ${finding.code}`);
  }

  /* —— the profile drafts —— */
  let drafted = 0;
  const refused: string[] = [];
  for (const draft of outbox.drafts) {
    const cleanBio = cleanDraft(draft.bio);
    if (!cleanBio.ok) {
      refused.push(`citation #${draft.citationId}: ${cleanBio.reason}`);
      continue;
    }
    const row = await env.DB.prepare('SELECT id, status FROM seo_citations WHERE id = ?')
      .bind(draft.citationId)
      .first<{ id: number; status: string }>();
    if (!row || (row.status !== 'todo' && row.status !== 'drafted')) continue;
    const body = draft.linkText ? `${cleanBio.text}\n\nLink text: ${draft.linkText}` : cleanBio.text;
    await env.DB.prepare(
      `UPDATE seo_citations SET note = ?, status = 'drafted', updated_at = ? WHERE id = ?`,
    )
      .bind(body, t, draft.citationId)
      .run();
    drafted += 1;
  }

  /* —— the ticket closes either way —— */
  const skippedLines = outbox.skipped.map((skip) => `#${skip.findingId}: ${skip.reason}`);
  const lines = [
    fixed ? `Recorded ${fixed} fixed finding${fixed === 1 ? '' : 's'}:` : 'No finding was recorded as fixed.',
    ...known.map((line) => `- ${line}`),
    ...(outbox.pr ? ['', `PR: ${outbox.pr}`] : []),
    ...(drafted ? ['', `Wrote ${drafted} profile draft${drafted === 1 ? '' : 's'} in Admin → SEO → Citations.`] : []),
    ...(refused.length ? ['', `Refused drafts:\n- ${refused.join('\n- ')}`] : []),
    ...(skippedLines.length ? ['', `Skipped:\n- ${skippedLines.join('\n- ')}`] : []),
    '',
    'The next audit checks the live pages and closes anything that no longer shows up.',
  ];
  await env.DB.batch([
    env.DB.prepare(`UPDATE tickets SET status = 'done', seo_cycle = 2, updated_at = ? WHERE id = ?`).bind(t, ticketId),
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 1, ?)`).bind(
      ticketId,
      lines.join('\n'),
      t,
    ),
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, 'system', ?, ?)`).bind(
      ticketId,
      'Status changed to “Done”.',
      t,
    ),
  ]);
  await mailAli(env, {
    subject: fixed ? `SEO: ${fixed} finding${fixed === 1 ? '' : 's'} fixed` : 'SEO cycle ended without fixes',
    text: [
      ...lines.slice(0, lines.length - 1),
      ...(outbox.skipped.length ? ['', `Left for the next cycle: ${outbox.skipped.length}`] : []),
      '',
      `${siteUrl(env)}/portal/admin#seo`,
    ].join('\n'),
  });

  return { handled: true, fixed, drafts: drafted, skipped: outbox.skipped.length };
}

/* ——————————————————————— HTTP ——————————————————————— */

type Ctx = Context<PortalEnv>;

const out = (c: Ctx, data: unknown, status = 200) => json(data, status, c.req.header('Origin') ?? null);

async function jsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const value = (await c.req.json()) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const isHost = (value: string): value is SeoHost => (SEO_HOSTS as readonly string[]).includes(value);

const CITATION_STATUSES = ['todo', 'drafted', 'live', 'verified', 'skipped'] as const;
const EVENT_KINDS = ['core_update', 'algorithm_update', 'fix', 'note'] as const;

interface CitationRow {
  id: number;
  platform: string;
  domain: string;
  dr: number | null;
  profile_url: string | null;
  status: string;
  link_verified_at: number | null;
  last_checked: number | null;
  note: string | null;
  created_at: number;
  updated_at: number;
}

const citationView = (row: CitationRow) => ({
  id: row.id,
  platform: row.platform,
  domain: row.domain,
  dr: row.dr,
  profileUrl: row.profile_url,
  status: row.status,
  linkVerifiedAt: row.link_verified_at,
  lastChecked: row.last_checked,
  note: row.note,
  updatedAt: row.updated_at,
});

interface PageRow {
  id: number;
  host: string;
  path: string;
  day: string;
  status: number;
  title: string | null;
  title_len: number;
  description: string | null;
  desc_len: number;
  canonical: string | null;
  hreflang_count: number;
  jsonld_types: string;
  h1_count: number;
  internal_links: number;
  bytes: number;
  ms: number;
  in_sitemap: number;
  in_llms: number;
  issues_json: string;
  score: number;
}

const parseJsonArray = (value: string | null): unknown[] => {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const pageView = (row: PageRow) => ({
  id: row.id,
  host: row.host,
  path: row.path,
  day: row.day,
  status: row.status,
  title: row.title,
  titleLen: row.title_len,
  description: row.description,
  descLen: row.desc_len,
  canonical: row.canonical,
  hreflangCount: row.hreflang_count,
  jsonldTypes: parseJsonArray(row.jsonld_types),
  h1Count: row.h1_count,
  internalLinks: row.internal_links,
  bytes: row.bytes,
  ms: row.ms,
  inSitemap: Boolean(row.in_sitemap),
  inLlms: Boolean(row.in_llms),
  issues: parseJsonArray(row.issues_json),
  score: row.score,
});

interface FindingFull extends FindingRow {
  severity: Severity;
  detail: string;
  first_seen: number;
  last_seen: number;
  ticket_id: number | null;
}

const findingView = (row: FindingFull) => ({
  id: row.id,
  host: row.host,
  path: row.path,
  code: row.code,
  severity: row.severity,
  detail: row.detail,
  firstSeen: row.first_seen,
  lastSeen: row.last_seen,
  resolvedAt: row.resolved_at,
  ticketId: row.ticket_id,
  open: row.resolved_at === null,
});

interface GeoRow {
  id: number;
  day: string;
  question: string;
  engine: string;
  answer_excerpt: string | null;
  mentions_us: number;
  cited_urls_json: string;
  competitors_json: string;
  created_at: number;
}

/** The last twelve weeks of probes, oldest first, grouped by the Monday. */
async function geoWeeks(env: Env, t: number) {
  const since = dayKey(t - 12 * 7 * DAY);
  const { results } = await env.DB.prepare(
    `SELECT day, mentions_us FROM seo_geo_runs WHERE day >= ? ORDER BY day, id`,
  )
    .bind(since)
    .all<{ day: string; mentions_us: number }>();
  const byWeek = new Map<string, { week: string; runs: number; mentions: number }>();
  for (const row of results ?? []) {
    const week = weekStart(row.day);
    const entry = byWeek.get(week) ?? { week, runs: 0, mentions: 0 };
    entry.runs += 1;
    entry.mentions += row.mentions_us ? 1 : 0;
    byWeek.set(week, entry);
  }
  return [...byWeek.values()]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((week) => ({ ...week, rate: week.runs ? Math.round((week.mentions / week.runs) * 1000) / 1000 : 0 }));
}

async function findingsBySeverity(env: Env, host?: string) {
  const where = host ? 'AND host = ?' : '';
  const statement = env.DB.prepare(
    `SELECT severity, COUNT(*) AS n FROM seo_findings WHERE resolved_at IS NULL ${where} GROUP BY severity`,
  );
  const { results } = await (host ? statement.bind(host) : statement).all<{ severity: string; n: number }>();
  const counts = { high: 0, medium: 0, low: 0 };
  for (const row of results ?? []) if (row.severity in counts) counts[row.severity as keyof typeof counts] = row.n;
  return { ...counts, open: counts.high + counts.medium + counts.low };
}

export const seo = new Hono<PortalEnv>();

/*
 * The admin guard is portal.ts's `portal.use('/admin/*', requireUser,
 * requireAdmin)`, which runs first because the portal is mounted before this
 * router (app.ts). Importing the guards here would close an import cycle —
 * portal.ts imports finishSeoCycle from this file — and read them before
 * portal.ts had initialized them.
 */

/** Everything the desk's first screen needs, in one request. */
seo.get('/admin/seo/overview', async (c) => {
  const env = c.env;
  const t = now();
  const [settings, state, cycleTicket, events, geo, citations, ranks] = await Promise.all([
    readSeoSettings(env),
    readSeoState(env),
    env.DB.prepare(`SELECT id FROM tickets WHERE seo_cycle = 1 AND status IN ('approved', 'in_progress') ORDER BY id DESC LIMIT 1`).first<{
      id: number;
    }>(),
    env.DB.prepare(`SELECT id, day, kind, label, source FROM seo_events ORDER BY day DESC, id DESC LIMIT 40`).all<SeoEventRow>(),
    geoWeeks(env, t),
    env.DB.prepare('SELECT status, COUNT(*) AS n FROM seo_citations GROUP BY status').all<{ status: string; n: number }>(),
    rankSnapshot(env, t),
  ]);

  const since = dayKey(t - 30 * DAY);
  const hosts = await Promise.all(
    SEO_HOSTS.map(async (host) => {
      const [series, findings, latest] = await Promise.all([
        env.DB.prepare(
          `SELECT day, COUNT(*) AS pages, AVG(score) AS average FROM seo_pages
            WHERE host = ? AND day >= ? GROUP BY day ORDER BY day`,
        )
          .bind(host, since)
          .all<{ day: string; pages: number; average: number }>(),
        findingsBySeverity(env, host),
        env.DB.prepare(
          `SELECT MAX(day) AS day, COUNT(*) AS pages, AVG(score) AS average FROM seo_pages
            WHERE host = ? AND day = (SELECT MAX(day) FROM seo_pages WHERE host = ?)`,
        )
          .bind(host, host)
          .first<{ day: string | null; pages: number; average: number | null }>(),
      ]);
      const points = (series.results ?? []).map((row) => ({
        day: row.day,
        pages: row.pages,
        averageScore: row.average === null ? 0 : Math.round(row.average),
      }));
      return {
        host,
        day: latest?.day ?? null,
        pages: latest?.pages ?? 0,
        averageScore: latest?.average === null || latest?.average === undefined ? 0 : Math.round(latest.average),
        series: points,
        findings,
      };
    }),
  );

  const eventRows = events.results ?? [];
  const today = dayKey(t);
  const held = volatilityHold({ hold: settings.volatilityHold, events: eventRows, today });
  const openMedium = hosts.reduce((sum, host) => sum + host.findings.high + host.findings.medium, 0);
  const citationCounts: Record<string, number> = { todo: 0, drafted: 0, live: 0, verified: 0, skipped: 0 };
  for (const row of citations.results ?? []) citationCounts[row.status] = row.n;

  const geoRuns = geo.reduce((sum, week) => sum + week.runs, 0);
  const geoMentions = geo.reduce((sum, week) => sum + week.mentions, 0);

  return out(c, {
    day: today,
    hosts,
    geo: {
      weeks: geo,
      runs: geoRuns,
      mentions: geoMentions,
      rate: geoRuns ? Math.round((geoMentions / geoRuns) * 1000) / 1000 : 0,
    },
    citations: citationCounts,
    rank: {
      rankReady: ranks.rankReady,
      latestDay: ranks.latestDay,
      avgPosition: ranks.avgPosition,
      inTop10: ranks.inTop10,
      inTop100: ranks.inTop100,
      swing: ranks.swing,
      pending: ranks.pending,
      keywords: ranks.keywords.length,
      location: ranks.location,
    },
    events: eventRows.map((event) => ({
      id: event.id,
      day: event.day,
      kind: event.kind,
      label: event.label,
      source: event.source,
    })),
    settings,
    cycle: {
      auto: settings.autoCycle,
      openTicketId: cycleTicket?.id ?? null,
      openFindings: openMedium,
      wouldFile: settings.autoCycle && !cycleTicket && openMedium > 0,
      held,
    },
    state: {
      lastAuditAt: state.lastAuditAt,
      lastGeoAt: state.lastGeoAt,
      lastCitationsAt: state.lastCitationsAt,
      lastRanksAt: state.lastRanksAt,
    },
    hostsAvailable: SEO_HOSTS,
  });
});

/** One day of pages for one host, worst score first. */
seo.get('/admin/seo/pages', async (c) => {
  const env = c.env;
  const hostParam = c.req.query('host') ?? SEO_HOSTS[0];
  if (!isHost(hostParam)) return out(c, { error: 'bad_host', hosts: SEO_HOSTS }, 400);

  const { results: days } = await env.DB.prepare('SELECT DISTINCT day FROM seo_pages WHERE host = ? ORDER BY day DESC LIMIT 30')
    .bind(hostParam)
    .all<{ day: string }>();
  const day = c.req.query('day') || days?.[0]?.day || dayKey(now());
  const { results } = await env.DB.prepare('SELECT * FROM seo_pages WHERE host = ? AND day = ? ORDER BY score, path LIMIT 500')
    .bind(hostParam, day)
    .all<PageRow>();
  const pages = (results ?? []).map(pageView);
  const average = pages.length ? Math.round(pages.reduce((sum, page) => sum + page.score, 0) / pages.length) : 0;
  return out(c, {
    host: hostParam,
    day,
    days: (days ?? []).map((row) => row.day),
    averageScore: average,
    pages,
  });
});

/** Open or resolved findings, worst first. */
seo.get('/admin/seo/findings', async (c) => {
  const env = c.env;
  const status = c.req.query('status') === 'resolved' ? 'resolved' : 'open';
  const host = c.req.query('host') ?? '';
  const where = [status === 'open' ? 'resolved_at IS NULL' : 'resolved_at IS NOT NULL'];
  const binds: unknown[] = [];
  if (host) {
    if (!isHost(host)) return out(c, { error: 'bad_host', hosts: SEO_HOSTS }, 400);
    where.push('host = ?');
    binds.push(host);
  }
  const statement = env.DB.prepare(
    `SELECT id, host, path, code, severity, detail, first_seen, last_seen, resolved_at, ticket_id
       FROM seo_findings WHERE ${where.join(' AND ')}
      ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, last_seen DESC, id
      LIMIT 300`,
  );
  const { results } = await (binds.length ? statement.bind(...binds) : statement).all<FindingFull>();
  const open = await findingsBySeverity(env, host || undefined);
  const resolved = await env.DB.prepare('SELECT COUNT(*) AS n FROM seo_findings WHERE resolved_at IS NOT NULL')
    .first<{ n: number }>();
  return out(c, {
    status,
    findings: (results ?? []).map(findingView),
    counts: { ...open, resolved: resolved?.n ?? 0 },
  });
});

/** Close a finding by hand: it is not worth an agent's time, or it was a false positive. */
seo.post('/admin/seo/findings/:id/dismiss', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return out(c, { error: 'not_found' }, 404);
  const row = await c.env.DB.prepare(
    'SELECT id, host, path, code, severity, detail, first_seen, last_seen, resolved_at, ticket_id FROM seo_findings WHERE id = ?',
  )
    .bind(id)
    .first<FindingFull>();
  if (!row) return out(c, { error: 'not_found' }, 404);
  const t = now();
  await c.env.DB.prepare('UPDATE seo_findings SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL').bind(t, id).run();
  return out(c, { ok: true, finding: findingView({ ...row, resolved_at: row.resolved_at ?? t }) });
});

/** What the assistant said, question by question, and the weekly rate. */
seo.get('/admin/seo/geo', async (c) => {
  const env = c.env;
  const t = now();
  const question = (c.req.query('question') ?? '').trim().slice(0, 200);
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') ?? 200) || 200));
  const { results } = await env.DB.prepare(
    `SELECT id, day, question, engine, answer_excerpt, mentions_us, cited_urls_json, competitors_json, created_at
       FROM seo_geo_runs ${question ? 'WHERE question = ?' : ''} ORDER BY day DESC, id DESC LIMIT ?`,
  )
    .bind(...(question ? [question, limit] : [limit]))
    .all<GeoRow>();
  const weeks = await geoWeeks(env, t);
  const settings = await readSeoSettings(env);
  const runs = weeks.reduce((sum, week) => sum + week.runs, 0);
  const mentions = weeks.reduce((sum, week) => sum + week.mentions, 0);
  return out(c, {
    runs: (results ?? []).map((row) => ({
      id: row.id,
      day: row.day,
      question: row.question,
      engine: row.engine,
      answerExcerpt: row.answer_excerpt,
      mentionsUs: Boolean(row.mentions_us),
      citedUrls: parseJsonArray(row.cited_urls_json),
      competitors: parseJsonArray(row.competitors_json),
      createdAt: row.created_at,
    })),
    weeks,
    questions: settings.geoQuestions,
    summary: { runs, mentions, rate: runs ? Math.round((mentions / runs) * 1000) / 1000 : 0 },
    engineReady: Boolean(env.DEEPSEEK_API_KEY),
  });
});

/** Where our keywords rank on Google, this check against last week's. */
seo.get('/admin/seo/ranks', async (c) => {
  const snapshot = await rankSnapshot(c.env, now());
  return out(c, snapshot);
});

seo.get('/admin/seo/settings', async (c) => {
  const [settings, state] = await Promise.all([readSeoSettings(c.env), readSeoState(c.env)]);
  return out(c, { settings, state, hosts: SEO_HOSTS });
});

seo.post('/admin/seo/settings', async (c) => {
  const body = await jsonBody(c);
  if (!body) return out(c, { error: 'bad_json' }, 400);
  const rejected = await saveSeoSettings(c.env, body);
  const settings = await readSeoSettings(c.env);
  return out(c, { settings, rejected });
});

/** The placements we claimed, and the state each one is in. */
seo.get('/admin/seo/citations', async (c) => {
  const env = c.env;
  const status = c.req.query('status') ?? '';
  const where = (CITATION_STATUSES as readonly string[]).includes(status) ? 'WHERE status = ?' : '';
  const statement = env.DB.prepare(
    `SELECT id, platform, domain, dr, profile_url, status, link_verified_at, last_checked, note, created_at, updated_at
       FROM seo_citations ${where} ORDER BY dr DESC, id`,
  );
  const { results } = await (where ? statement.bind(status) : statement).all<CitationRow>();
  const { results: counts } = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM seo_citations GROUP BY status').all<{
    status: string;
    n: number;
  }>();
  const byStatus: Record<string, number> = { todo: 0, drafted: 0, live: 0, verified: 0, skipped: 0 };
  for (const row of counts ?? []) byStatus[row.status] = row.n;
  return out(c, {
    citations: (results ?? []).map(citationView),
    counts: { ...byStatus, total: Object.values(byStatus).reduce((sum, n) => sum + n, 0) },
    statuses: CITATION_STATUSES,
  });
});

/** Claim a profile, change its state, or keep the draft the cycle wrote. */
seo.post('/admin/seo/citations/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return out(c, { error: 'not_found' }, 404);
  const body = await jsonBody(c);
  if (!body) return out(c, { error: 'bad_json' }, 400);

  const sets: string[] = [];
  const binds: unknown[] = [];
  const rejected: string[] = [];

  if ('status' in body) {
    const value = typeof body.status === 'string' ? body.status : '';
    if ((CITATION_STATUSES as readonly string[]).includes(value)) {
      sets.push('status = ?');
      binds.push(value);
      if (value !== 'verified') sets.push('link_verified_at = NULL');
    } else rejected.push('status');
  }
  if ('profile_url' in body) {
    const value = typeof body.profile_url === 'string' ? body.profile_url.trim() : '';
    if (!value) {
      sets.push('profile_url = NULL');
    } else if (/^https?:\/\/[^\s]+$/i.test(value) && value.length <= 500) {
      sets.push('profile_url = ?');
      binds.push(value);
    } else rejected.push('profile_url');
  }
  if ('note' in body) {
    const value = typeof body.note === 'string' ? body.note.trim().slice(0, 2_000) : '';
    sets.push('note = ?');
    binds.push(value || null);
  }
  if (rejected.length) return out(c, { error: 'bad_field', fields: rejected }, 400);
  if (!sets.length) return out(c, { error: 'nothing_to_change' }, 400);

  const row = await c.env.DB.prepare(
    'SELECT id FROM seo_citations WHERE id = ?',
  )
    .bind(id)
    .first<{ id: number }>();
  if (!row) return out(c, { error: 'not_found' }, 404);
  const t = now();
  sets.push('updated_at = ?');
  binds.push(t, id);
  await c.env.DB.prepare(`UPDATE seo_citations SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  const citation = await c.env.DB.prepare(
    `SELECT id, platform, domain, dr, profile_url, status, link_verified_at, last_checked, note, created_at, updated_at
       FROM seo_citations WHERE id = ?`,
  )
    .bind(id)
    .first<CitationRow>();
  return out(c, { ok: true, citation: citation ? citationView(citation) : null });
});

/** An annotation: a core update, a fix, a deploy. The score series is read against it. */
seo.post('/admin/seo/events', async (c) => {
  const body = await jsonBody(c);
  if (!body) return out(c, { error: 'bad_json' }, 400);
  const kind = typeof body.kind === 'string' ? body.kind : '';
  if (!(EVENT_KINDS as readonly string[]).includes(kind)) return out(c, { error: 'bad_kind', kinds: EVENT_KINDS }, 400);
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 300) : '';
  if (!label) return out(c, { error: 'bad_label' }, 400);
  const day = typeof body.day === 'string' && Number.isFinite(dayNumber(body.day)) ? body.day : dayKey(now());
  const source = typeof body.source === 'string' ? body.source.trim().slice(0, 40) || null : null;
  const t = now();
  const event = await c.env.DB.prepare(
    'INSERT INTO seo_events (day, kind, label, source, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(day, kind, label, source, t)
    .first<{ id: number }>();
  return out(c, { ok: true, event: { id: event?.id ?? null, day, kind, label, source } }, 201);
});

seo.delete('/admin/seo/events/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return out(c, { error: 'not_found' }, 404);
  const result = await c.env.DB.prepare('DELETE FROM seo_events WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return out(c, { error: 'not_found' }, 404);
  return out(c, { ok: true });
});

/** Run one step now: the audit, the probe, the citation check or the cycle. */
seo.post('/admin/seo/run', async (c) => {
  const body = await jsonBody(c);
  const what = typeof body?.what === 'string' ? body.what : 'audit';
  const t = now();

  if (what === 'audit') {
    const summary = await runAudit(c.env, t);
    await markState(c.env, 'lastAuditAt', t);
    return out(c, { what, ...summary });
  }
  if (what === 'geo') {
    const summary = await probeGeo(c.env, t);
    if (!summary.skipped) await markState(c.env, 'lastGeoAt', t);
    return out(c, { what, ...summary });
  }
  if (what === 'citations') {
    const summary = await checkCitations(c.env, t);
    await markState(c.env, 'lastCitationsAt', t);
    return out(c, { what, ...summary });
  }
  if (what === 'ranks') {
    const summary = await runRanks(c.env, t);
    return out(c, { what, ...summary });
  }
  if (what === 'cycle') {
    const result = await ensureSeoCycle(c.env, t, { force: true });
    return out(c, { what, ...result }, result.filed ? 201 : 200);
  }
  return out(c, { error: 'bad_what', allowed: ['audit', 'geo', 'citations', 'ranks', 'cycle'] }, 400);
});
