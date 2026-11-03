#!/usr/bin/env node
/*
 * The gate between a prospect CSV and the Marketing desk.
 *
 * A scraped address is only a claim. This checks the domain can receive mail at
 * all (MX records), drops disposables and obvious typos, and marks role inboxes
 * and free mailboxes — both legal to write to, both worth knowing about.
 *
 *   node marketing/prospector/verify.mjs --in=prospects-colorado.csv
 * # → prospects-colorado.verified.csv
 *
 * Domain-level only: it cannot tell whether `office@acme.com` exists, just that
 * acme.com accepts mail. Mailbox-level verification (SMTP) is a paid service;
 * use it if the bounce rate after the first hundred sends says you need it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMx } from 'node:dns/promises';
import { csvOf, HEADER } from './extract.mjs';

const opt = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const log = (...parts) => console.log(...parts);

const DISPOSABLE =
  /(?:^|\.)(?:mailinator\.com|guerrillamail\.com|sharklasers\.com|10minutemail\.com|tempmail\.com|trashmail\.com|yopmail\.com|getnada\.com|dispostable\.com|maildrop\.cc)$/i;
const FREE = /(?:^|\.)(?:gmail\.com|googlemail\.com|yahoo\.[a-z.]+|hotmail\.com|outlook\.com|live\.com|msn\.com|aol\.com|icloud\.com|me\.com|mac\.com|proton\.me|protonmail\.com|gmx\.[a-z.]+|mail\.com|yandex\.[a-z.]+)$/i;
const ROLE = /^(?:info|sales|contact|hello|hi|support|office|enquiries|enquiry|admin|team|help|orders|service|billing|accounts)@/i;

export function addressOf(email) {
  const address = String(email ?? '').trim().toLowerCase();
  const at = address.lastIndexOf('@');
  if (at < 1) return null;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  if (!/^[^\s@]+$/.test(local) || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)) return null;
  if (!/\.[a-z]{2,}$/.test(domain)) return null;
  return { address, local, domain };
}

/** What to do with one address, given how many MX records its domain has. */
export function judge({ address, local, domain }, mx) {
  if (DISPOSABLE.test(domain)) return { keep: false, reason: 'disposable', flags: [] };
  if (!mx) return { keep: false, reason: 'no_mx', flags: [] };
  const flags = [];
  if (ROLE.test(address)) flags.push('role inbox');
  if (FREE.test(domain)) flags.push('free mailbox');
  return { keep: true, reason: null, flags };
}

/** Minimal CSV reader for the desks's own output: quotes, doubled quotes, no CR noise. */
export function rowsIn(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const body = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function pool(items, size, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (index < items.length) {
      const at = index;
      index += 1;
      await worker(items[at]);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const input = opt('in', '');
  if (!input) {
    console.error('No file. Pass --in=prospects-<place>.csv.');
    process.exitCode = 1;
    return;
  }

  const rows = rowsIn(readFileSync(input, 'utf8'));
  const header = rows.shift() ?? [];
  if (header.join(',') !== HEADER.join(',')) {
    console.error(`Expected the desk's columns: ${HEADER.join(',')}`);
    process.exitCode = 1;
    return;
  }

  const out = opt('out', input.replace(/\.csv$/, '') + '.verified.csv');
  const mx = new Map();

  await pool(rows, 10, async (row) => {
    const parsed = addressOf(row[0]);
    if (!parsed) {
      row.__why = 'bad_syntax';
      return;
    }
    if (!mx.has(parsed.domain)) {
      let count = 0;
      try {
        count = (await resolveMx(parsed.domain)).length;
      } catch {
        count = 0;
      }
      mx.set(parsed.domain, count);
    }
    const verdict = judge(parsed, mx.get(parsed.domain));
    row.__why = verdict.reason;
    if (verdict.keep && verdict.flags.length) row[7] = `${row[7]} ${verdict.flags.join(', ')}.`;
    row.__keep = verdict.keep;
  });

  const kept = rows.filter((row) => row.__keep);
  const drops = new Map();
  for (const row of rows) {
    if (!row.__keep) drops.set(row.__why ?? 'bad_syntax', (drops.get(row.__why ?? 'bad_syntax') ?? 0) + 1);
  }

  if (!kept.length) {
    log(`Nothing survived: ${[...drops].map(([why, n]) => `${n} ${why}`).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, csvOf(kept.map((row) => row.slice(0, HEADER.length))));

  log(`${kept.length} of ${rows.length} addresses can receive mail → ${out}`);
  if (drops.size) log(`Dropped: ${[...drops].map(([why, n]) => `${n} ${why}`).join(', ')}`);
  log('Next: read the rows, write one specific observation in `gap` for each, then import in Admin → Marketing → Contacts.');
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
