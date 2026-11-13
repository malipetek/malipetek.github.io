/*
 * The interface catalogs, translated by the Worker itself: the same job as
 * `scripts/i18n-sync.mjs`, run where DEEPSEEK_API_KEY lives, so nobody has to
 * hold the key and run a script.
 *
 * It reads src/i18n/messages/*.json and src/i18n/meta/*.json from master
 * through the GitHub App (the installation on the repo's owner), translates
 * the keys that are missing or whose English changed, and commits the
 * catalogs, their meta and the regenerated src/i18n/mail.js to master in one
 * commit. That push deploys the site and the Worker like any other.
 *
 * When: the five-minute cron checks master's en-US.json every 15 minutes and
 * runs when it changed since the last run; Admin → Settings → Translate now
 * asks for a run on the next tick. One run at a time (a lock in settings).
 */
import { LOCALES, SOURCE_LOCALE } from '../../src/lib/locales.js';
import {
  acceptTranslations,
  catalogWork,
  jsonFile,
  mailBundleSource,
  orderedCatalog,
  translatePrompt,
} from '../../src/lib/i18nSync.js';
import { GH_API, ghHeaders, installationToken } from './ghapp.ts';
import { now, type Env } from './shared.ts';

const REPO = 'malipetek/malipetek.github.io';
const BRANCH = 'master';
const MESSAGES = 'src/i18n/messages';
const META = 'src/i18n/meta';
const BATCH = 40;
const PARALLEL = 6;
const CHECK_EVERY = 15 * 60;
const LOCK_TTL = 14 * 60;

const KEY = {
  requested: 'i18n_sync_requested_at',
  running: 'i18n_sync_running_at',
  checked: 'i18n_sync_checked_at',
  englishSha: 'i18n_sync_en_sha',
  last: 'i18n_sync_last',
} as const;

export interface SyncResult {
  at: number;
  trigger: 'manual' | 'english_changed';
  ok: boolean;
  error?: string;
  commit?: string;
  keys: number;
  locales: number;
  removed: number;
  rejected: Record<string, string[]>;
  failed: Record<string, string>;
}

type Settings = Partial<Record<(typeof KEY)[keyof typeof KEY], string>>;

async function readSettings(env: Env): Promise<Settings> {
  const rows = await env.DB.prepare(
    `SELECT key, value FROM settings WHERE key IN (${Object.values(KEY).map(() => '?').join(',')})`,
  )
    .bind(...Object.values(KEY))
    .all<{ key: string; value: string }>();
  return Object.fromEntries((rows.results ?? []).map((r) => [r.key, r.value]));
}

async function put(env: Env, key: string, value: string | null) {
  if (value === null) {
    await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, value, now())
    .run();
}

/** What the admin sees: the last run, and whether one is asked for or under way. */
export async function i18nStatus(env: Env) {
  const s = await readSettings(env);
  const running = Number(s[KEY.running] ?? 0);
  return {
    ready: Boolean(env.DEEPSEEK_API_KEY && env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY),
    repo: REPO,
    requestedAt: s[KEY.requested] ? Number(s[KEY.requested]) : null,
    runningSince: running && now() - running < LOCK_TTL ? running : null,
    checkedAt: s[KEY.checked] ? Number(s[KEY.checked]) : null,
    last: s[KEY.last] ? (JSON.parse(s[KEY.last] as string) as SyncResult) : null,
  };
}

/** Admin → Translate now: the next cron tick runs, whatever English did. */
export async function requestI18nSync(env: Env) {
  await put(env, KEY.requested, String(now()));
}

/* —— GitHub —— */

class GitHub {
  private token: string;
  constructor(token: string) {
    this.token = token;
  }

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${GH_API}/repos/${REPO}${path}`, {
      method,
      headers: { ...ghHeaders(this.token), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
    if (!res.ok || !data) throw new Error(`GitHub ${method} ${path}: ${data?.message ?? res.status}`);
    return data;
  }

  /** A blob's text by its sha. */
  async text(sha: string): Promise<string> {
    const blob = await this.call<{ content: string; encoding: string }>('GET', `/git/blobs/${sha}`);
    const bytes = Uint8Array.from(atob(blob.content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  /** The files of a folder at a commit: name → blob sha. */
  async folder(path: string, ref: string): Promise<Map<string, string>> {
    const list = await this.call<{ name: string; sha: string; type: string }[]>(
      'GET',
      `/contents/${path}?ref=${encodeURIComponent(ref)}`,
    );
    return new Map(list.filter((f) => f.type === 'file').map((f) => [f.name, f.sha]));
  }
}

async function repoToken(env: Env): Promise<string> {
  const owner = REPO.split('/')[0];
  const row = await env.DB.prepare('SELECT id FROM github_installations WHERE lower(account_login) = lower(?) LIMIT 1')
    .bind(owner)
    .first<{ id: number }>();
  if (!row) throw new Error(`The GitHub App is not installed on @${owner}.`);
  const { token } = await installationToken(env, row.id, [REPO.split("/")[1] as string]);
  return token;
}

/* —— DeepSeek —— */

async function deepseek(env: Env, system: string, payload: Record<string, string>, attempt = 0): Promise<Record<string, unknown>> {
  const base = (env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/+$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(payload) },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const body = data.choices?.[0]?.message?.content ?? '';
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    if (attempt > 0) throw new Error('DeepSeek sent malformed JSON');
    return deepseek(env, system, payload, attempt + 1);
  }
}

/** Run `fn` over `items`, `limit` at a time. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

/* —— the run —— */

async function runSync(env: Env, trigger: SyncResult['trigger']): Promise<SyncResult> {
  const result: SyncResult = { at: now(), trigger, ok: false, keys: 0, locales: 0, removed: 0, rejected: {}, failed: {} };
  const gh = new GitHub(await repoToken(env));
  const head = await gh.call<{ object: { sha: string } }>('GET', `/git/ref/heads/${BRANCH}`);
  const parent = head.object.sha;
  const [messages, metas] = await Promise.all([gh.folder(MESSAGES, parent), gh.folder(META, parent)]);
  const englishSha = messages.get(`${SOURCE_LOCALE}.json`);
  if (!englishSha) throw new Error(`${MESSAGES}/${SOURCE_LOCALE}.json is missing on ${BRANCH}`);
  const english = JSON.parse(await gh.text(englishSha)) as Record<string, string>;

  // Every catalog, because mail.js is built from all of them.
  const catalogs: Record<string, Record<string, string>> = {};
  const changed = new Map<string, string>(); // path → new text
  await pool(LOCALES, PARALLEL, async (locale) => {
    const sha = messages.get(`${locale.code}.json`);
    catalogs[locale.code] = sha ? (JSON.parse(await gh.text(sha)) as Record<string, string>) : {};
  });

  const targets = LOCALES.filter((l) => l.code !== SOURCE_LOCALE);
  await pool(targets, PARALLEL, async (locale) => {
    try {
      const catalog = { ...catalogs[locale.code] };
      const metaSha = metas.get(`${locale.code}.json`);
      const meta = metaSha ? (JSON.parse(await gh.text(metaSha)) as Record<string, { en: string; reviewed?: boolean }>) : {};
      const { stale, removed } = catalogWork(english, catalog, meta);
      if (!stale.length && !removed.length) return;
      let written = 0;
      for (let i = 0; i < stale.length; i += BATCH) {
        const keys = stale.slice(i, i + BATCH);
        const out = await deepseek(env, translatePrompt(locale), Object.fromEntries(keys.map((k) => [k, english[k]])));
        const got = acceptTranslations(english, catalog, meta, keys, out);
        written += got.written.length;
        if (got.rejected.length) result.rejected[locale.code] = [...(result.rejected[locale.code] ?? []), ...got.rejected];
      }
      const ordered = orderedCatalog(english, catalog, meta, removed);
      if (!written && !removed.length) return;
      catalogs[locale.code] = ordered;
      changed.set(`${MESSAGES}/${locale.code}.json`, jsonFile(ordered));
      changed.set(`${META}/${locale.code}.json`, jsonFile(meta));
      result.keys += written;
      result.removed += removed.length;
      result.locales += 1;
    } catch (error) {
      result.failed[locale.code] = error instanceof Error ? error.message : String(error);
    }
  });

  // mail.js follows the catalogs in LOCALES order, exactly as the script writes it.
  const ordered = Object.fromEntries(LOCALES.filter((l) => catalogs[l.code]).map((l) => [l.code, catalogs[l.code]]));
  const bundle = mailBundleSource(ordered);
  const bundleSha = (await gh.folder('src/i18n', parent)).get('mail.js');
  if (!bundleSha || (await gh.text(bundleSha)) !== bundle) changed.set('src/i18n/mail.js', bundle);

  if (changed.size) {
    const commit = await gh.call<{ tree: { sha: string } }>('GET', `/git/commits/${parent}`);
    const tree = await gh.call<{ sha: string }>('POST', '/git/trees', {
      base_tree: commit.tree.sha,
      tree: [...changed].map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })),
    });
    const message =
      `i18n: translate ${result.keys} string${result.keys === 1 ? '' : 's'} into ${result.locales} language${result.locales === 1 ? '' : 's'}\n\n` +
      `Run by the Worker (${trigger === 'manual' ? 'Admin → Translate now' : 'English changed on master'}).` +
      (Object.keys(result.rejected).length ? `\nKept English where the placeholders did not survive: ${Object.entries(result.rejected).map(([c, k]: [string, string[]]) => `${c} ${k.join(', ')}`).join('; ')}` : '');
    const made = await gh.call<{ sha: string }>('POST', '/git/commits', { message, tree: tree.sha, parents: [parent] });
    // Not forced: if master moved meanwhile, this run fails and the next tick starts over from the new head.
    await gh.call('PATCH', `/git/refs/heads/${BRANCH}`, { sha: made.sha, force: false });
    result.commit = made.sha;
  }
  result.ok = !Object.keys(result.failed).length;
  if (result.ok) await put(env, KEY.englishSha, englishSha);
  return result;
}

/**
 * The cron's part. Runs when Ali asked, or when master's English changed since
 * the last good run (looked at every 15 minutes). Never two at once.
 */
export async function runI18nSync(env: Env, opts: { force?: boolean } = {}) {
  if (!env.DEEPSEEK_API_KEY || !env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) return { skipped: 'not_configured' };
  const s = await readSettings(env);
  const t = now();
  const running = Number(s[KEY.running] ?? 0);
  if (running && t - running < LOCK_TTL) return { skipped: 'running' };

  let trigger: SyncResult['trigger'] | null = s[KEY.requested] || opts.force ? 'manual' : null;
  if (!trigger) {
    if (t - Number(s[KEY.checked] ?? 0) < CHECK_EVERY) return { skipped: 'not_due' };
    await put(env, KEY.checked, String(t));
    try {
      const gh = new GitHub(await repoToken(env));
      const head = await gh.call<{ object: { sha: string } }>('GET', `/git/ref/heads/${BRANCH}`);
      const sha = (await gh.folder(MESSAGES, head.object.sha)).get(`${SOURCE_LOCALE}.json`);
      if (!sha || sha === s[KEY.englishSha]) return { skipped: 'unchanged' };
    } catch (error) {
      console.error('i18n_check_failed', error);
      return { skipped: 'check_failed' };
    }
    trigger = 'english_changed';
  }

  await put(env, KEY.running, String(t));
  let result: SyncResult;
  try {
    result = await runSync(env, trigger);
  } catch (error) {
    result = {
      at: t,
      trigger,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      keys: 0,
      locales: 0,
      removed: 0,
      rejected: {},
      failed: {},
    };
  }
  await put(env, KEY.last, JSON.stringify(result));
  // A manual request is spent once a run finishes; a failed run is retried by the next English check or button.
  await put(env, KEY.requested, null);
  await put(env, KEY.running, null);
  console.log('i18n_sync', JSON.stringify({ ok: result.ok, keys: result.keys, locales: result.locales, commit: result.commit, error: result.error }));
  return result;
}
