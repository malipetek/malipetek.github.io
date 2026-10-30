#!/usr/bin/env node
/*
 * Business websites from OpenStreetMap, one category at a time.
 *
 * Tranco gives popularity, which is mostly big companies and noise. OSM gives
 * businesses: every plumber, dentist and bakery that a mapper added, with the
 * website tag the owner (or a mapper) filled in. Feed the domain list to
 * `bulk.mjs collect`, which reads each site once and keeps the address the
 * business publishes.
 *
 *   node marketing/prospector/osm.mjs --area=US --categories=plumber,electrician
 *   node marketing/prospector/bulk.mjs collect --domains=osm-US-domains-2026-10-29.txt --tlds=any
 *
 * Overpass is a shared, donation-funded service: one query at a time, a
 * three-second pause between them, and a cap on what each returns.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { notBusinessHost } from './directory.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const opt = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const UA = 'MalipetekProspector/1.0 (+https://malipetek.dev/bot)';
// The main instance queues hard when it is busy; the mirrors are the same data.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const DAY = new Date().toISOString().slice(0, 10);
const PAUSE_MS = 3_000;

const log = (...parts) => console.log(...parts);

/** The tag each category is queried by. Keep to owner-run, local businesses. */
export const CATEGORIES = {
  plumber: ['craft', 'plumber'],
  electrician: ['craft', 'electrician'],
  hvac: ['craft', 'hvac'],
  roofer: ['craft', 'roofer'],
  painter: ['craft', 'painter'],
  carpenter: ['craft', 'carpenter'],
  gardener: ['craft', 'gardener'],
  locksmith: ['craft', 'locksmith'],
  stonemason: ['craft', 'stonemason'],
  car_repair: ['shop', 'car_repair'],
  tyres: ['shop', 'tyres'],
  florist: ['shop', 'florist'],
  bakery: ['shop', 'bakery'],
  butcher: ['shop', 'butcher'],
  hairdresser: ['shop', 'hairdresser'],
  beauty: ['shop', 'beauty'],
  furniture: ['shop', 'furniture'],
  hardware: ['shop', 'hardware'],
  doityourself: ['shop', 'doityourself'],
  dentist: ['amenity', 'dentist'],
  veterinary: ['amenity', 'veterinary'],
  optician: ['shop', 'optician'],
  cafe: ['amenity', 'cafe'],
  restaurant: ['amenity', 'restaurant'],
  driving_school: ['amenity', 'driving_school'],
  laundry: ['shop', 'laundry'],
  accountant: ['office', 'accountant'],
  lawyer: ['office', 'lawyer'],
  insurance: ['office', 'insurance'],
  estate_agent: ['office', 'estate_agent'],
  fitness_centre: ['leisure', 'fitness_centre'],
};

/** Websites on a site builder collapse to one host, so the domain list cannot use them. */
const SITE_BUILDER =
  /(?:^|\.)(?:wixsite\.com|business\.site|godaddysites\.com|squarespace\.com|weebly\.com|webnode\.(?:com|page)|jimdosite\.com|wordpress\.com|blogspot\.com|myshopify\.com|square\.site)$/i;

/** `nwr` scoped to an area or a bounding box, only elements that carry a site. */
export function queryFor([key, value], { area = 'US', bbox = '', limit = 2_000 } = {}) {
  const head = bbox
    ? '[out:json][timeout:180];'
    : `[out:json][timeout:180];area["ISO3166-1"="${area}"]->.a;`;
  const scope = bbox ? `(${bbox})` : '(area.a)';
  const tag = `["${key}"="${value}"]`;
  return (
    `${head}nwr${scope}${tag}["website"]->.site;` +
    `nwr${scope}${tag}["contact:website"]->.csite;` +
    `nwr${scope}${tag}["email"]->.mail;` +
    `nwr${scope}${tag}["contact:email"]->.cmail;` +
    `(.site;.csite;.mail;.cmail;) out tags ${limit};`
  );
}

const siteOf = (tags) => (tags.website || tags['contact:website'] || '').trim();
const emailOf = (tags) => (tags.email || tags['contact:email'] || '').trim().toLowerCase();

/** One business per website host; what cannot be fetched later is dropped here. */
export function sitesFrom(elements, category) {
  const out = [];
  for (const element of elements ?? []) {
    const tags = element?.tags ?? {};
    const raw = siteOf(tags);
    if (!raw) continue;
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      continue;
    }
    const host = url.hostname.replace(/^www\./, '');
    if (!host.includes('.') || notBusinessHost(host) || SITE_BUILDER.test(host)) continue;
    out.push({
      name: (tags.name || '').trim(),
      category,
      site: url.href,
      host,
      email: emailOf(tags),
      city: (tags['addr:city'] || '').trim(),
    });
  }
  return out;
}

async function overpass(query) {
  let lastError;
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(240_000),
        });
        if (res.status === 429 || res.status >= 500) throw new Error(`overpass ${res.status}`);
        if (!res.ok) throw new Error(`overpass ${res.status}: ${(await res.text()).slice(0, 160)}`);
        const data = await res.json();
        if (data.remark && /error|timed out|out of memory/i.test(data.remark)) throw new Error(`overpass: ${data.remark}`);
        return data.elements ?? [];
      } catch (error) {
        lastError = error;
        await new Promise((r) => setTimeout(r, 5_000 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

async function main() {
  const area = opt('area', 'US');
  const bbox = opt('bbox', '');
  const limit = Number(opt('limit', 2000));
  const names = opt('categories', '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const chosen = names.length ? names : Object.keys(CATEGORIES);
  const unknown = chosen.filter((name) => !CATEGORIES[name]);
  if (unknown.length) {
    console.error(`Unknown categor${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')}\nKnown: ${Object.keys(CATEGORIES).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const scopeName = bbox ? bbox.replace(/[^0-9.-]+/g, '_') : area;
  const domainsOut = opt('out', join(here, `osm-${scopeName}-domains-${DAY}.txt`));
  const recordsOut = domainsOut.replace(/-domains-/, '-').replace(/\.txt$/, '.jsonl');

  const seen = new Set();
  const lines = [];
  const records = [];
  let requestsFailed = 0;

  log(`OpenStreetMap → ${chosen.length} categories in ${bbox || area}, ${limit} per category\n`);

  for (const [index, name] of chosen.entries()) {
    if (index) await new Promise((r) => setTimeout(r, PAUSE_MS));
    let elements;
    try {
      elements = await overpass(queryFor(CATEGORIES[name], { area, bbox, limit }));
    } catch (error) {
      requestsFailed += 1;
      log(`${name.padEnd(16)} failed: ${error?.message ?? error}`);
      continue;
    }
    const sites = sitesFrom(elements, name);
    let added = 0;
    for (const site of sites) {
      if (seen.has(site.host)) continue;
      seen.add(site.host);
      lines.push(site.host);
      records.push(site);
      added += 1;
    }
    log(`${name.padEnd(16)} ${String(elements.length).padStart(5)} elements, ${String(sites.length).padStart(5)} sites, ${String(added).padStart(4)} new`);
  }

  if (!lines.length) {
    log('\nNo websites. Nothing written.');
    process.exitCode = 1;
    return;
  }

  mkdirSync(dirname(domainsOut), { recursive: true });
  writeFileSync(domainsOut, `# Source: OpenStreetMap contributors (ODbL), ${DAY}\n${lines.join('\n')}\n`);
  writeFileSync(recordsOut, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);

  log(`\n${lines.length} business domains → ${domainsOut}`);
  log(`${records.length} records (name, category, city) → ${recordsOut}`);
  if (requestsFailed) log(`${requestsFailed} categor${requestsFailed === 1 ? 'y' : 'ies'} failed; rerun them with --categories=…`);
  log(`Next: node marketing/prospector/bulk.mjs collect --domains=${domainsOut} --tlds=any --concurrency=6`);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
