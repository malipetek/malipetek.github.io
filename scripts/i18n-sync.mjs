#!/usr/bin/env node
/*
 * Fill the interface catalogs (src/i18n/messages/<locale>.json) from English.
 *
 *   DEEPSEEK_API_KEY=… node scripts/i18n-sync.mjs           every locale
 *   DEEPSEEK_API_KEY=… node scripts/i18n-sync.mjs tr de-DE  only these
 *   node scripts/i18n-sync.mjs --check                      report, change nothing
 *   node scripts/i18n-sync.mjs --bundle                     only rewrite src/i18n/mail.js
 *
 * The Worker cannot load JSON by glob, so every run also writes
 * src/i18n/mail.js: the mail.*, status.*, preview.* and card.* strings of every
 * locale, as one plain module. (The preview.* strings are the feedback
 * widget's copy, which the Worker serves to preview pages.)
 *
 * Only keys that are missing, or whose English changed since they were
 * translated, go to DeepSeek. src/i18n/meta/<locale>.json remembers the English
 * each key was translated from, and whether a person has reviewed it
 * ("reviewed": true is never overwritten unless its English changed).
 *
 * Every translation must keep the same {variables} and plural structure, or it
 * is rejected and the key stays English. For the beta locales each new string
 * is translated back to English and listed in the report when the meaning
 * drifted, so a native speaker knows where to look first.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES, SOURCE_LOCALE } from '../src/lib/locales.js';
import { acceptTranslations, catalogWork, mailBundleSource, orderedCatalog, shape, translatePrompt } from '../src/lib/i18nSync.js';

export { shape };

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MESSAGES = join(ROOT, 'src/i18n/messages');
const META = join(ROOT, 'src/i18n/meta');
const BATCH = 40;

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const bundleOnly = args.includes('--bundle');
const only = args.filter((a) => !a.startsWith('--'));
const key = process.env.DEEPSEEK_API_KEY;
const base = (process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/+$/, '');
const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);
const writeJson = (file, data) => writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

async function deepseek(system, payload, attempt = 0) {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(payload) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const body = data.choices[0].message.content;
  try {
    return JSON.parse(body);
  } catch {
    // Occasionally the reply is cut off mid-object. One retry, then let the caller skip this batch.
    if (attempt > 0) throw new Error(`DeepSeek sent malformed JSON: ${body.slice(0, 200)}`);
    return deepseek(system, payload, attempt + 1);
  }
}

const prompt = translatePrompt;

const backPrompt =
  'Translate the values of this JSON object into English, literally. Return a JSON object with the same keys. Keep {variables}.';

const judgePrompt = [
  'For each key, compare "source" with "back" (a back-translation of a translation of the source).',
  'Return a JSON object mapping each key to true when the meaning is the same, false when meaning was lost or changed.',
].join('\n');

async function syncLocale(locale, english) {
  const file = join(MESSAGES, `${locale.code}.json`);
  const metaFile = join(META, `${locale.code}.json`);
  const catalog = readJson(file, {});
  const meta = readJson(metaFile, {});

  const { stale, removed } = catalogWork(english, catalog, meta);
  if (checkOnly || !stale.length) return { code: locale.code, stale: stale.length, removed: removed.length, written: 0, rejected: [], drift: [] };

  const rejected = [];
  const drift = [];
  let written = 0;
  for (let i = 0; i < stale.length; i += BATCH) {
    const keys = stale.slice(i, i + BATCH);
    const out = await deepseek(prompt(locale), Object.fromEntries(keys.map((k) => [k, english[k]])));
    const got = acceptTranslations(english, catalog, meta, keys, out);
    rejected.push(...got.rejected);
    written += got.written.length;
    const fresh = Object.fromEntries(got.written.map((k) => [k, catalog[k]]));
    if (locale.beta && Object.keys(fresh).length) {
      const back = await deepseek(backPrompt, fresh);
      const verdict = await deepseek(
        judgePrompt,
        Object.fromEntries(Object.keys(fresh).map((k) => [k, { source: english[k], back: back[k] ?? '' }])),
      );
      for (const k of Object.keys(fresh)) if (verdict[k] === false) drift.push(k);
    }
  }
  const ordered = orderedCatalog(english, catalog, meta, removed);
  writeJson(file, ordered);
  writeJson(metaFile, meta);
  return { code: locale.code, stale: stale.length, removed: removed.length, written, rejected, drift };
}

/** src/i18n/mail.js: what the Worker needs from every catalog. */
export function writeMailBundle() {
  const catalogs = {};
  for (const locale of LOCALES) {
    const catalog = readJson(join(MESSAGES, `${locale.code}.json`), null);
    if (catalog) catalogs[locale.code] = catalog;
  }
  writeFileSync(join(ROOT, 'src/i18n/mail.js'), mailBundleSource(catalogs));
  return Object.keys(catalogs).length;
}

async function main() {
  const english = readJson(join(MESSAGES, `${SOURCE_LOCALE}.json`), null);
  if (!english) throw new Error('src/i18n/messages/en-US.json is missing');
  if (bundleOnly) {
    console.log(`src/i18n/mail.js: ${writeMailBundle()} locale(s)`);
    return;
  }
  if (!checkOnly && !key) throw new Error('Set DEEPSEEK_API_KEY (or pass --check).');
  mkdirSync(META, { recursive: true });
  const targets = LOCALES.filter((l) => l.code !== SOURCE_LOCALE && (!only.length || only.includes(l.code)));
  const unknown = only.filter((c) => !LOCALES.some((l) => l.code === c));
  if (unknown.length) throw new Error(`Unknown locale(s): ${unknown.join(', ')}`);

  let failed = 0;
  for (const locale of targets) {
    try {
      const r = await syncLocale(locale, english);
      const parts = [`${r.stale} to do`];
      if (!checkOnly) parts.push(`${r.written} written`);
      if (r.removed) parts.push(`${r.removed} removed`);
      if (r.rejected.length) parts.push(`rejected (kept English): ${r.rejected.join(', ')}`);
      if (r.drift.length) parts.push(`check by hand, meaning drifted: ${r.drift.join(', ')}`);
      console.log(`${locale.code.padEnd(8)} ${parts.join(' · ')}`);
    } catch (error) {
      failed++;
      console.error(`${locale.code.padEnd(8)} failed: ${error.message}`);
    }
  }
  if (!checkOnly) console.log(`src/i18n/mail.js: ${writeMailBundle()} locale(s)`);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
