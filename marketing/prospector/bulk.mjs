#!/usr/bin/env node
/*
 * A big domain list in, a prospect CSV out.
 *
 * `collect` reads each homepage once — robots.txt first, one page, and the
 * contact page when the homepage hides its address — and writes what it saw to
 * a JSONL file. `qualify` sends those records to Jev, keeps the ones that are
 * US small businesses, and writes the CSV the Marketing desk imports.
 *
 * Two stages because the second one costs tokens: only pages that already
 * publish an address reach Jev. A stopped collect run picks up where it left
 * off when it is started again with the same --out.
 *
 *   node marketing/prospector/bulk.mjs collect --domains=tranco.csv --rank-from=300000 --limit=1500
 *   TYPESAFE_API_KEY=… node marketing/prospector/bulk.mjs qualify --in=signals-2026-10-29.jsonl
 *
 * The domain list is any of: Tranco (`rank,domain`), the Rapid7 FDNS JSONL
 * (`jq -r 'select(.type=="mx") | .name' fdns.json`), or one domain per line.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvOf, decodeEntities, emailsIn, fetchPage, textOf } from './extract.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const opt = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => process.argv.slice(2).includes(`--${name}`);

const DAY = new Date().toISOString().slice(0, 10);
const CONTACT_DELAY_MS = 1_500;
const log = (...parts) => console.log(...parts);

/* ——————————————————————— the domain list ——————————————————————— */

const cleanDomain = (value) => {
  const domain = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  if (domain.length > 253) return '';
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)) return '';
  return /\.[a-z]{2,}$/.test(domain) ? domain : '';
};

/**
 * Tranco (`1,google.com`), FDNS JSONL (`{"name":"…","type":"mx"}`) and plain
 * lists all collapse to `{ rank, domain }`, deduped on the domain.
 */
export function domainsIn(text) {
  const seen = new Set();
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let rank = null;
    let value = line;
    if (line.startsWith('{')) {
      let hit;
      try {
        hit = JSON.parse(line);
      } catch {
        continue;
      }
      value = hit?.name ?? hit?.domain ?? '';
    } else if (/^\d+\s*,/.test(line)) {
      const comma = line.indexOf(',');
      rank = Number(line.slice(0, comma));
      value = line.slice(comma + 1);
    }
    const domain = cleanDomain(value);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    rows.push({ rank, domain });
  }
  return rows;
}

/** Rank window and TLD filter, applied in list order, then the limit. */
export function pick(rows, { rankFrom = 0, rankTo = Infinity, limit = Infinity, tlds = null } = {}) {
  const out = [];
  for (const row of rows) {
    if (row.rank !== null && (row.rank < rankFrom || row.rank > rankTo)) continue;
    if (tlds && !tlds.has(row.domain.slice(row.domain.lastIndexOf('.') + 1))) continue;
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/* ——————————————————————— one homepage ——————————————————————— */

const PARKED =
  /\b(domain(?: name)? (?:is|may be) for sale|buy this domain|this domain has expired|domain parking|parked free|hugedomains|afternic|sedo)\b/i;
const GENERIC_TITLE = /^(home|homepage|welcome|index|untitled|official site|official website)$/i;

export function businessName(html) {
  const site = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i)?.[1];
  if (site?.trim()) return decodeEntities(site).trim();
  const raw = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = raw
    .split(/\s*[|–—·]\s*|\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.find((part) => !GENERIC_TITLE.test(part)) ?? raw;
}

export function descriptionOf(html) {
  const meta =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i)?.[1] ??
    '';
  return decodeEntities(meta).replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** h1/h2 text is the cheapest statement of what a business actually does. */
export function headingsIn(html) {
  const found = [];
  for (const hit of html.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/gi)) {
    const text = decodeEntities(hit[1].replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (text && !found.includes(text)) found.push(text);
    if (found.length >= 6) break;
  }
  return found.join(' · ').slice(0, 240);
}

/** The first same-host link that looks like a contact page. */
export function contactUrlIn(html, pageUrl) {
  const base = new URL(pageUrl);
  for (const hit of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const raw = hit[1];
    if (/^(?:mailto|tel|javascript):/i.test(raw) || raw.startsWith('#')) continue;
    let url;
    try {
      url = new URL(raw, base);
    } catch {
      continue;
    }
    if (url.origin !== base.origin) continue;
    if (!/contact|get-in-touch|getintouch/i.test(url.pathname)) continue;
    if (/\.(?:pdf|jpg|png|zip)$/i.test(url.pathname)) continue;
    return url.href.split('#')[0];
  }
  return null;
}

/**
 * One record: what the page says about itself, and the one address it
 * publishes. No address, no record — the rest of the pipeline has no use for it.
 */
export async function collectOne(domain, { read = fetchPage } = {}) {
  const url = `https://${domain}/`;
  const page = await read(url, { delayMs: 0 });
  if (page.skipped) return { domain, url, skipped: page.skipped };

  const text = textOf(page.html);
  const record = {
    domain,
    url: page.url || url,
    business: businessName(page.html),
    description: descriptionOf(page.html),
    headings: headingsIn(page.html),
    text: text.slice(0, 1200),
    parked: PARKED.test(`${page.title ?? ''} ${text.slice(0, 600)}`),
    emails: [],
    email_page: page.url || url,
    skipped: null,
  };

  let emails = emailsIn(page.html, record.url);
  if (!emails.length && !record.parked) {
    const contact = contactUrlIn(page.html, record.url);
    if (contact) {
      const second = await read(contact, { delayMs: CONTACT_DELAY_MS });
      if (!second.skipped) {
        emails = emailsIn(second.html, second.url || contact);
        record.email_page = second.url || contact;
      }
    }
  }

  if (record.parked) return { ...record, skipped: 'parked' };
  if (!emails.length) return { ...record, skipped: 'no_email' };
  record.emails = emails.map(({ email, how }) => ({ email, how }));
  return record;
}

/* ——————————————————————— Jev ——————————————————————— */

const QUESTIONS = {
  small_business: {
    type: 'noul',
    instructions:
      'Does `state` describe a small, owner-run business serving its own customers, rather than a large company, a marketplace, a directory, a news or blog site, a parked domain, or a personal homepage?',
    criteria: {
      true: 'A single shop, tradesperson, clinic, salon, restaurant, studio or small firm: it describes its own services, staff, prices or service area',
      false: 'A national or international brand, a marketplace or directory that lists other businesses, a news site, blog, forum or wiki, a SaaS platform, a parked or for-sale domain, or a page with no business behind it',
    },
  },
  us_based: {
    type: 'noul',
    instructions: 'Does the business described in `state` appear to operate in the United States?',
    criteria: {
      true: 'A US address, state, city or ZIP code, a US phone number such as +1 (303) 555-0100, prices in dollars, or a service area inside the US',
      false: 'An address or phone outside the US, another currency, non-US place names, or nothing at all that places the business in the US',
    },
  },
  sector: {
    type: 'choice',
    instructions: 'Which of these best describes what the business in `state` sells?',
    criteria: {
      home_services:
        'Trades and home services: plumbing, electrical, HVAC, roofing, cleaning, landscaping, painting, moving, pest control, handyman',
      professional_services:
        'Professional services for other businesses or households: accounting, law, insurance, bookkeeping, consulting, real estate',
      health_wellness:
        'Health and personal care: dentist, doctor, clinic, veterinary, physical therapy, salon, barber, spa, gym, yoga studio',
      hospitality_food: 'Restaurants, cafés, bakeries, caterers, bars, hotels, B&Bs, food trucks',
      retail: 'A shop or online store selling physical goods: hardware, furniture, flowers, clothing, auto parts',
      creative: 'Design, web, marketing, photography, video, print, events, or another studio service',
      other_business: 'A real business that fits none of the above',
      not_a_business: 'Not a business: a directory, marketplace, blog, news site, personal page, parked domain, or platform',
    },
  },
};

/** What the API accepts: no control characters, no lone surrogates. */
const printable = (value) =>
  String(value ?? '')
    .toWellFormed()
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export async function askJev(
  record,
  { apiKey, model = 'jev-latest', fetchImpl = fetch, retries = 3, backoffMs = 2_000 } = {},
) {
  const body = {
    model,
    state: {
      domain: printable(record.domain),
      title: printable(record.business),
      description: printable(record.description),
      headings: printable(record.headings),
      text: printable(record.text),
    },
    questions: QUESTIONS,
  };

  for (let attempt = 0; ; attempt += 1) {
    const res = await fetchImpl('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if ((res.status === 429 || res.status === 529) && attempt < retries) {
      await new Promise((r) => setTimeout(r, backoffMs * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`typesafe ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return {
      smallBusiness: data.answers?.small_business?.noul ?? 0,
      usBased: data.answers?.us_based?.noul ?? 0,
      sector: data.answers?.sector?.choice ?? 'other_business',
      sectorConfidence: data.answers?.sector?.confidence ?? 0,
      usage: data.usage ?? null,
    };
  }
}

export const keep = (verdict, { minSmall, minUs }) =>
  verdict.smallBusiness >= minSmall && verdict.usBased >= minUs && verdict.sector !== 'not_a_business';

/** One CSV row, in the order the desk imports. */
export function rowFor(record, verdict, rank = null) {
  const notes = [
    `Homepage read ${DAY}${rank ? ` (list rank ${rank})` : ''}.`,
    `Jev: small ${verdict.smallBusiness.toFixed(2)}, US ${verdict.usBased.toFixed(2)}, ${verdict.sector}.`,
    'Address published for contact on the site; observation still to write.',
  ].join(' ');
  return [
    record.emails[0].email,
    '',
    record.business || record.domain,
    new URL(record.url).origin,
    record.email_page,
    '',
    'legitimate_interest',
    notes,
  ];
}

/* ——————————————————————— running it ——————————————————————— */

async function pool(items, size, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (index < items.length) {
      const at = index;
      index += 1;
      await worker(items[at], at);
    }
  });
  await Promise.all(runners);
}

const progress = (at, total, domain, note) => log(`${String(at + 1).padStart(String(total).length)}/${total}  ${domain.padEnd(34)} ${note}`);

async function collect() {
  const domainsFile = opt('domains', '');
  if (!domainsFile) {
    console.error('No domain list. Pass --domains=tranco.csv (or a plain one-per-line file).');
    process.exitCode = 1;
    return;
  }

  const rows = domainsIn(readFileSync(domainsFile, 'utf8'));
  const rankFrom = Number(opt('rank-from', 0));
  const rankTo = opt('rank-to', '') === '' ? Infinity : Number(opt('rank-to', ''));
  const limit = Number(opt('limit', 500));
  const tldOpt = opt('tlds', 'com,net,org,us,co');
  const tlds = tldOpt === 'any' ? null : new Set(tldOpt.split(',').map((t) => t.toLowerCase().trim()));

  if (!rows.some((row) => row.rank !== null) && (rankFrom || rankTo !== Infinity)) {
    log('This list carries no ranks, so --rank-from/--rank-to do not apply.');
  }

  const picked = pick(rows, { rankFrom, rankTo, limit, tlds });
  if (!picked.length) {
    console.error('Nothing left after the rank, TLD and limit filters.');
    process.exitCode = 1;
    return;
  }

  const out = opt('out', join(here, `signals-${DAY}.jsonl`));
  mkdirSync(dirname(resolve(out)), { recursive: true });

  const done = new Set();
  if (existsSync(out)) {
    for (const line of readFileSync(out, 'utf8').split('\n')) {
      try {
        if (line.trim()) done.add(JSON.parse(line).domain);
      } catch {
        // A half-written last line from a stopped run.
      }
    }
    if (done.size) log(`Resuming: ${done.size} domains already in ${out}`);
  }

  const todo = picked.filter((row) => !done.has(row.domain));
  const concurrency = Math.max(1, Math.min(16, Number(opt('concurrency', 6))));
  const skips = new Map();
  let found = 0;
  let at = 0;

  log(`Reading ${todo.length} homepages, ${concurrency} at a time → ${out}\n`);

  await pool(todo, concurrency, async (row) => {
    const record = await collectOne(row.domain).catch((error) => ({ skipped: `fetch_failed: ${error?.message ?? error}` }));
    at += 1;
    if (record.skipped) {
      skips.set(record.skipped, (skips.get(record.skipped) ?? 0) + 1);
      progress(at - 1, todo.length, row.domain, record.skipped);
      return;
    }
    record.rank = row.rank;
    appendFileSync(out, `${JSON.stringify(record)}\n`);
    found += 1;
    progress(at - 1, todo.length, row.domain, `${record.emails.length} address${record.emails.length === 1 ? '' : 'es'}`);
  });

  log(`\n${found} of ${todo.length} homepages publish an address.`);
  if (skips.size) log(`Skipped: ${[...skips].map(([why, n]) => `${n} ${why}`).join(', ')}`);
  if (found) log(`Next: TYPESAFE_API_KEY=… node marketing/prospector/bulk.mjs qualify --in=${out}`);
}

async function qualify() {
  const inFile = opt('in', '');
  const apiKey = process.env.TYPESAFE_API_KEY ?? '';
  if (!inFile) {
    console.error('No signals file. Pass --in=signals-<date>.jsonl from the collect stage.');
    process.exitCode = 1;
    return;
  }
  if (!apiKey) {
    console.error('Set TYPESAFE_API_KEY (from console.typesafe.ai); the collect stage needs no key.');
    process.exitCode = 1;
    return;
  }

  const records = readFileSync(inFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

  const model = opt('model', 'jev-latest');
  const minSmall = Number(opt('min-small', 0.7));
  const minUs = Number(opt('min-us', 0.6));
  const concurrency = Math.max(1, Math.min(8, Number(opt('concurrency', 4))));
  const out = opt('out', join(dirname(resolve(inFile)), basename(inFile).replace(/^signals-/, 'prospects-').replace(/\.jsonl$/, '.csv')));

  const rows = [];
  const sectors = new Map();
  let tokens = 0;
  let at = 0;

  log(`Asking Jev about ${records.length} pages, ${concurrency} at a time (${model})\n`);

  await pool(records, concurrency, async (record) => {
    let verdict;
    try {
      verdict = await askJev(record, { apiKey, model });
    } catch (error) {
      at += 1;
      progress(at - 1, records.length, record.domain, `jev failed: ${error?.message ?? error}`);
      return;
    }
    at += 1;
    tokens += (verdict.usage?.input_tokens ?? 0) + (verdict.usage?.output_tokens ?? 0);
    sectors.set(verdict.sector, (sectors.get(verdict.sector) ?? 0) + 1);
    if (!keep(verdict, { minSmall, minUs })) {
      progress(at - 1, records.length, record.domain, `dropped (small ${verdict.smallBusiness.toFixed(2)} us ${verdict.usBased.toFixed(2)} ${verdict.sector})`);
      return;
    }
    rows.push(rowFor(record, verdict, record.rank ?? null));
    progress(at - 1, records.length, record.domain, `kept (small ${verdict.smallBusiness.toFixed(2)} us ${verdict.usBased.toFixed(2)} ${verdict.sector})`);
  });

  if (!rows.length) {
    log('\nNothing passed. Lower --min-small/--min-us only after reading why the pages failed.');
    process.exitCode = 1;
    return;
  }

  writeFileSync(out, csvOf(rows));
  log(`\n${rows.length} of ${records.length} kept → ${out}`);
  log(`Sectors: ${[...sectors].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name} ${n}`).join(', ')}`);
  log(`Jev tokens: ${tokens} (about $${((tokens / 1e6) * 0.042).toFixed(4)} at $42/Btok)`);
  log('Next: write one specific observation in `gap` for each row, then import the CSV in Admin → Marketing → Contacts.');
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const stage = process.argv[2];
  const run = stage === 'collect' ? collect : stage === 'qualify' ? qualify : null;
  if (!run) {
    console.error('Usage: bulk.mjs collect --domains=… | qualify --in=…');
    process.exitCode = 1;
  } else {
    void run().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
}
