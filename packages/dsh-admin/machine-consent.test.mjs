/*
 * The consent record: shape, missing file, atomic write. The path is
 * injected, so every test works in its own temp dir and never touches the
 * real `~/.dsh-admin/machine-consent.json`.
 */
import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { CONSENT_VERSION, normalizeConsent, readConsent, writeConsent } from './machine-consent.mjs';

const dir = () => mkdtemp(join(tmpdir(), 'machine-consent-'));

test('a missing file is no record at all', async () => {
  const root = await dir();
  try {
    deepStrictEqual(await readConsent(join(root, 'machine-consent.json')), {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a record round-trips with its defaults filled in', async () => {
  const root = await dir();
  const path = join(root, 'machine-consent.json');
  try {
    const written = await writeConsent(path, { version: CONSENT_VERSION, acceptedAt: 1732120000, lend: ['dsh-go', 'dsh-claude', 'dsh-go'] });
    deepStrictEqual(written, { version: 1, acceptedAt: 1732120000, declinedAt: null, lend: ['dsh-go', 'dsh-claude'] });
    deepStrictEqual(await readConsent(path), written);
    strictEqual((await readFile(path, 'utf8')).trim().endsWith('}'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('declining keeps the acceptance as history and clears on a fresh yes', async () => {
  const root = await dir();
  const path = join(root, 'machine-consent.json');
  try {
    await writeConsent(path, { version: 1, acceptedAt: 100, lend: ['dsh'] });
    await writeConsent(path, { version: 1, acceptedAt: 100, declinedAt: 200, lend: ['dsh'] });
    const declined = await readConsent(path);
    strictEqual(declined.declinedAt, 200);
    strictEqual(declined.acceptedAt, 100);
    await writeConsent(path, { version: 1, acceptedAt: 300, declinedAt: null, lend: [] });
    const again = await readConsent(path);
    strictEqual(again.acceptedAt, 300);
    strictEqual(again.declinedAt, null);
    deepStrictEqual(again.lend, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('anything that is not the documented shape is refused, and a refused write creates nothing', async () => {
  const root = await dir();
  const path = join(root, 'machine-consent.json');
  try {
    for (const bad of [
      null,
      [],
      'yes',
      {},
      { version: '1' },
      { version: 0 },
      { version: 1.5 },
      { version: 1, acceptedAt: 'yesterday' },
      { version: 1, declinedAt: -5 },
      { version: 1, lend: 'dsh-go' },
      { version: 1, lend: ['dsh-go', 7] },
      { version: 1, lend: ['not an id'] },
      { version: 1, extra: true },
    ]) {
      await rejects(async () => normalizeConsent(bad), /Consent|version/);
    }
    // The module checks shape, not the fleet's executor catalog: an id it does
    // not know is still a well-formed id, so only a malformed one is refused.
    await rejects(() => writeConsent(path, { version: 1, lend: ['not an id'] }), /Consent/);
    deepStrictEqual(await readConsent(path), {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a file that is there but corrupt is an error, not a quiet no', async () => {
  const root = await dir();
  const path = join(root, 'machine-consent.json');
  try {
    await writeFile(path, '{not json', 'utf8');
    await rejects(() => readConsent(path), /not valid JSON/);
    await writeFile(path, '{"version":2,"acceptedAt":"yes"}', 'utf8');
    await rejects(() => readConsent(path), /acceptedAt/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the /admin command answers machine-consent get and set', async () => {
  // A throwaway DSH_HOME so CONSENT_PATH lands in the temp dir, never in the
  // real one; the cache-busted import re-reads the env at module load.
  const root = await dir();
  const oldHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  let handler = null;
  try {
    const { apply } = await import(`./index.js?machine-consent-cmd=${Date.now()}`);
    apply({
      inject() {},
      effect(fn, name) {
        if (name === 'admin: /admin command') fn();
      },
      commands: { register: (command) => ((handler = command.handler), () => {}) },
    });
    const empty = await handler({ rawInput: 'machine-consent get' });
    strictEqual(empty.kind, 'success');
    strictEqual(empty.text, '{}');
    const usage = await handler({ rawInput: 'machine-consent' });
    strictEqual(usage.kind, 'error');
    strictEqual(usage.text, 'Usage: /admin machine-consent get | set <json>');
    const bad = await handler({ rawInput: 'machine-consent set {"version":1,"lend":"nope"}' });
    strictEqual(bad.kind, 'error');
    const set = await handler({ rawInput: `machine-consent set ${JSON.stringify({ version: 1, acceptedAt: 1732120000, lend: ['dsh-go', 'dsh-claude'] })}` });
    strictEqual(set.kind, 'success');
    deepStrictEqual(JSON.parse(set.text), { version: 1, acceptedAt: 1732120000, declinedAt: null, lend: ['dsh-go', 'dsh-claude'] });
    const back = await handler({ rawInput: 'machine-consent get' });
    deepStrictEqual(JSON.parse(back.text), { version: 1, acceptedAt: 1732120000, declinedAt: null, lend: ['dsh-go', 'dsh-claude'] });
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = oldHome;
    await rm(root, { recursive: true, force: true });
  }
});
