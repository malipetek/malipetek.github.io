#!/usr/bin/env node
/**
 * Re-import the Codex (ChatGPT) login from the Codex CLI into the harness.
 *
 * Why this exists: the provider stores an OAuth grant, and OpenAI **rotates**
 * refresh tokens. When the harness refreshes first, the CLI's copy is the one
 * that becomes stale — and when the CLI refreshes first, the harness's copy does,
 * which is what this repairs:
 *
 *   OAuth refresh failed for openai-codex: (401) "Your refresh token has already
 *   been used to generate a new access token"
 *
 * Run it after signing in with the Codex CLI, or when that error appears. It
 * reads `~/.codex/auth.json`, backs up the credential store, and replaces only
 * the `llm-pi-ai/openai-codex` record.
 *
 *   node tools/import-codex-grant.mjs [--dry-run] [--credentials <path>] [--auth <path>]
 */

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const dryRun = args.includes('--dry-run');
const authPath = flag('--auth', join(homedir(), '.codex', 'auth.json'));
const credentialsPath = flag('--credentials', join(homedir(), '.dsh', '.credentials.yaml'));

/** Decode a JWT payload without verifying it — we only need `exp`. @param jwt - token. */
function claims(jwt) {
  const payload = jwt.split('.')[1];
  if (payload === undefined) throw new Error('access token is not a JWT');
  return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

const auth = JSON.parse(readFileSync(authPath, 'utf8'));
const tokens = auth.tokens ?? {};
if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') {
  throw new Error(`${authPath} has no access/refresh token — sign in with the Codex CLI first`);
}

const expires = claims(tokens.access_token).exp * 1000;
const now = Date.now();
if (expires <= now) {
  throw new Error(`the Codex CLI's own access token expired at ${new Date(expires).toISOString()} — sign in again first`);
}

const store = parse(readFileSync(credentialsPath, 'utf8')) ?? {};
store.records = store.records ?? {};
store.records['llm-pi-ai/openai-codex'] = {
  kind: 'grant',
  payload: {
    type: 'oauth',
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expires,
    ...(tokens.account_id === undefined ? {} : { accountId: tokens.account_id }),
  },
};

const days = Math.round((expires - now) / 86_400_000);
console.log(`access token valid until ${new Date(expires).toISOString()} (${days} day(s))`);
if (dryRun) {
  console.log('--dry-run: credential store not written');
  process.exit(0);
}

const backup = `${credentialsPath}.bak-codex-${new Date().toISOString().replace(/[:.]/g, '')}`;
copyFileSync(credentialsPath, backup);
writeFileSync(credentialsPath, stringify(store), { mode: 0o600 });
console.log(`wrote llm-pi-ai/openai-codex`);
console.log(`backup: ${backup}`);
console.log('Restart the app, or retry the model — the credential store reloads on its own.');
