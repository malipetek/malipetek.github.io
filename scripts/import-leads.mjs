#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanEmail, cleanSourceKind, cleanVerifiedAt, isRoleAccount, parseCsv } from '../worker/src/marketing.ts';

const fields = ['email', 'name', 'business', 'site', 'source_url', 'gap', 'trigger', 'trigger_url', 'verified_at', 'quality_hold'];
const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const sqlCell = (value) => value == null || value === '' ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;

export function prepareLeads(csv, sourceKind) {
  const [header = [], ...records] = parseCsv(csv.replace(/^\uFEFF/, ''));
  const keys = header.map((key) => key.trim().toLowerCase());
  if (!keys.includes('email')) throw new Error('CSV needs an email column');
  const counts = { rows: records.length, accepted: 0, invalid: 0, duplicates: 0, roleHeld: 0, noGap: 0, noTrigger: 0, unverified: 0 };
  const seen = new Set();
  const rows = [];
  for (const record of records) {
    const row = Object.fromEntries(keys.map((key, i) => [key, (record[i] ?? '').replaceAll('\0', '').trim()]));
    const email = cleanEmail(row.email);
    if (!email) { counts.invalid++; continue; }
    if (seen.has(email)) { counts.duplicates++; continue; }
    seen.add(email);
    const mapped = {
      email,
      name: (row.name || [row.first_name, row.last_name].filter(Boolean).join(' ')).slice(0, 80),
      business: (row.company || row.business || '').slice(0, 120),
      site: (row.site_url || row.site || '').slice(0, 200),
      source_url: (row.email_source_url || row.source_url || '').slice(0, 500),
      gap: (row.observation || row.gap || '').slice(0, 300),
      trigger: (row.trigger || '').slice(0, 300),
      trigger_url: (row.trigger_url || '').slice(0, 500),
      verified_at: cleanVerifiedAt(row.verified_on || row.verified_at),
      quality_hold: isRoleAccount(email) ? 'role_account' : null,
    };
    if (mapped.quality_hold) counts.roleHeld++;
    if (!mapped.gap) counts.noGap++;
    if (!mapped.trigger) counts.noTrigger++;
    if (!mapped.verified_at) counts.unverified++;
    rows.push(mapped);
  }
  counts.accepted = rows.length;
  const payload = {
    sequence: 'none',
    sourceKind,
    csv: [fields.join(','), ...rows.map((row) => fields.map((field) => csvCell(row[field])).join(','))].join('\n'),
  };
  const sql = ['-- Offline preview. Contacts only: no messages, settings or network.', ...rows.map((row) =>
    `INSERT INTO marketing_contacts (${fields.join(', ')}, source, source_kind, consent_basis, status, created_at, updated_at) VALUES (${fields.map((field) => sqlCell(row[field])).join(', ')}, 'csv', ${sqlCell(sourceKind)}, 'legitimate_interest', '${row.quality_hold ? 'paused' : 'new'}', unixepoch(), unixepoch()) ON CONFLICT(email) DO NOTHING;`,
  )].join('\n');
  return { counts, payload, sql };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, flag, ...rest] = process.argv.slice(2);
  if (!input || input.startsWith('-') || rest.length || (flag && !['--sql', '--api', '--dry-run'].includes(flag))) {
    console.error('Usage: node --experimental-strip-types scripts/import-leads.mjs leads.csv [--dry-run|--sql|--api]');
    process.exitCode = 1;
  } else {
    try {
      const result = prepareLeads(readFileSync(input, 'utf8'), cleanSourceKind(basename(input)));
      if (flag === '--sql') console.log(result.sql);
      else if (flag === '--api') console.log(JSON.stringify(result.payload, null, 2));
      else console.log(JSON.stringify({ dryRun: true, ...result.counts }, null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
