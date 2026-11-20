/*
 * This machine's record of consent to being a fleet worker.
 *
 * One JSON file under the Harness home — `~/.dsh-admin/machine-consent.json`
 * for PTech Admin — so the admin who owns this computer is the one who said
 * yes, and the panel can show when and what they agreed to lend. Nothing runs
 * because the node is installed; the record is the answer to "may it?".
 *
 *   { "version": 1,
 *     "acceptedAt": 1732120000,     // unix seconds, or null
 *     "declinedAt": null,           // set by "Not now" and "Withdraw consent"
 *     "lend": ["dsh-go", "dsh-claude"] }   // executor ids this Mac lends
 *
 * The path is a parameter, so the unit test can point it at a temp dir.
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** The consent record's format. Bump it when the shape changes again. */
export const CONSENT_VERSION = 1;

/** The record's keys. A key outside this set is a mistake, not a default. */
const KEYS = new Set(['version', 'acceptedAt', 'declinedAt', 'lend']);
const EXECUTOR_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const isStamp = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Validate and normalize a consent record. Anything unexpected is refused, so
 * a corrupt file is an error rather than a silent "no consent".
 * @param value - the parsed JSON.
 * @returns the normalized record.
 */
export function normalizeConsent(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Consent must be a JSON object.');
  }
  for (const key of Object.keys(value)) {
    if (!KEYS.has(key)) throw new Error(`Consent "${key}" is not part of the record.`);
  }
  if (!Number.isInteger(value.version) || value.version < 1 || value.version > 1000) {
    throw new Error('Consent "version" must be a number (1 for this format).');
  }
  for (const key of ['acceptedAt', 'declinedAt']) {
    const stamp = value[key];
    if (stamp !== undefined && stamp !== null && !isStamp(stamp)) {
      throw new Error(`Consent "${key}" must be a timestamp (seconds) or null.`);
    }
  }
  const lend = value.lend;
  if (lend !== undefined && !Array.isArray(lend)) throw new Error('Consent "lend" must be a list of executor ids.');
  if (Array.isArray(lend)) {
    for (const e of lend) {
      if (typeof e !== 'string' || !EXECUTOR_ID.test(e)) {
        throw new Error('Consent "lend" must be a list of executor ids (letters, digits, dashes).');
      }
    }
  }
  // Duplicates are dropped; the order the admin chose is kept.
  const clean = lend === undefined ? undefined : [...new Set(lend)];
  return {
    version: value.version,
    acceptedAt: value.acceptedAt ?? null,
    declinedAt: value.declinedAt ?? null,
    ...(clean !== undefined ? { lend: clean } : {}),
  };
}

/**
 * Read the consent record. A missing file is no record at all (`{}`); a file
 * that is there but not a valid record is an error, never a quiet default.
 * @param path - the file to read.
 * @returns the record, or `{}` when there is none yet.
 */
export async function readConsent(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${path} is not valid JSON. Delete it to start over.`);
  }
  return normalizeConsent(value);
}

/**
 * Validate and write the consent record, atomically: the file is either the
 * old record or the new one, never a half-written one.
 * @param path - the file to write.
 * @param value - the record to write.
 * @returns the normalized record as written.
 */
export async function writeConsent(path, value) {
  const record = normalizeConsent(value);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = join(dirname(path), `.${basenameOf(path)}.${process.pid}.tmp`);
  await writeFile(temp, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  try {
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  return record;
}

const basenameOf = (path) => path.split(/[\\/]/).pop();
