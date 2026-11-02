/*
 * Health: real end-to-end checks, run by the five-minute cron and on demand.
 *
 * Every past week's quiet failure had a check that would have caught it:
 *   - the callback and redirect URLs          → url:*
 *   - an OAuth client refusing the return URL → oauth:*
 *   - a node heartbeating the wrong host      → node:<id>
 *   - the Worker deployed from an old folder  → deploy
 *   - a clone failure shown as "waiting"      → repos
 *   - approved work no node can take          → tickets
 *
 * Each check keeps its row in `health_checks`. A check that goes fail mails Ali
 * once; when it recovers it mails once more. Nothing is mailed while the state
 * stays the same, so a two-day outage is one mail, not 576.
 *
 * This module stays free of imports from portal.ts so the unit suite can load
 * it (the mail itself lives in portal.ts, with the other mail).
 */
import { now, type Env } from './shared.ts';
import { getSettings, nodesView, queueView } from './queue.ts';

export type HealthStatus = 'ok' | 'fail' | 'skip';

export interface HealthResult {
  name: string;
  status: HealthStatus;
  detail: string;
  latencyMs: number | null;
}

export interface HealthCheck extends HealthResult {
  label: string;
  checkedAt: number;
  failingSince: number | null;
  alertedAt: number | null;
  resolvedAt: number | null;
}

export interface HealthRun {
  checks: HealthCheck[];
  /** Newly failing since the previous run: mail these once. */
  fresh: HealthCheck[];
  /** Failed last run, fine now: mail these once. */
  recovered: HealthCheck[];
  failing: number;
  ranAt: number;
}

export interface HealthStateRow {
  name: string;
  status: HealthStatus;
  detail: string;
  latency_ms: number | null;
  checked_at: number;
  failing_since: number | null;
  alerted_at: number | null;
  resolved_at: number | null;
}

const LABELS: Record<string, string> = {
  site: 'Site root answers',
  api: 'Worker API answers',
  deploy: 'Live Worker matches master',
  'oauth:github': 'GitHub app accepts our callback',
  'oauth:cloudflare': 'Cloudflare client accepts our callback',
  'url:github-callback': 'GitHub callback route answers',
  'url:cloudflare-callback': 'Cloudflare callback route answers',
  repos: 'Every project repo is readable',
  tickets: 'No approved work stuck without a node',
  sites: 'No site setup stopped',
  nodes: 'Nodes online',
};

export function healthLabel(name: string): string {
  if (name.startsWith('node:')) return `Node ${name.slice('node:'.length)}`;
  return LABELS[name] ?? name;
}

/** Failures first, then by the order the work matters. */
export function healthRank(name: string): number {
  const order = ['deploy', 'site', 'api', 'oauth:github', 'oauth:cloudflare', 'url:github-callback', 'url:cloudflare-callback'];
  const at = order.indexOf(name);
  if (at >= 0) return at;
  if (name.startsWith('node:')) return 20;
  if (name === 'nodes') return 19;
  if (name === 'repos') return 30;
  if (name === 'tickets') return 31;
  if (name === 'sites') return 32;
  return 40;
}

const baseUrl = (env: Env) => (env.SITE_URL || 'https://malipetek.dev').replace(/\/+$/, '');

/** A Worker's fetch to its own zone is not a public probe: it can answer 404
 * (the target Worker is not invoked for same-zone subrequests). Say so rather
 * than report a healthy site as down. */
const sameZone = (url: string, env: Env) => {
  try {
    return new URL(url).host === new URL(baseUrl(env)).host;
  } catch {
    return false;
  }
};

const oneLine = (text: string, max = 220) => text.replace(/\s+/g, ' ').trim().slice(0, max);

async function fetchChecked(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    redirect: init.redirect ?? 'manual',
    headers: {
      'user-agent': 'malipetek-health/1',
      ...(init.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(12_000),
  });
}

async function bodyText(res: Response, max = 4000): Promise<string> {
  try {
    return (await res.text()).slice(0, max);
  } catch {
    return '';
  }
}

/** A check that returns ok/fail/skip and never throws out of the batch. */
async function check(
  name: string,
  fn: () => Promise<{ status: HealthStatus; detail: string }>,
): Promise<HealthResult> {
  const started = Date.now();
  try {
    const out = await fn();
    return { name, status: out.status, detail: oneLine(out.detail), latencyMs: Date.now() - started };
  } catch (error) {
    return {
      name,
      status: 'fail',
      detail: oneLine(error instanceof Error ? error.message : String(error)),
      latencyMs: Date.now() - started,
    };
  }
}

/** The fleet version in fleet/node.mjs, so a node running old code is visible. */
export function parseFleetVersion(source: string): string | null {
  return source.match(/const VERSION = '([^']+)'/)?.[1] ?? null;
}

/** The sha and subject of the newest commit on master. */
interface LatestCommit {
  sha: string;
  message: string;
}

async function latestCommit(): Promise<LatestCommit | null> {
  // The Atom feed first: it is not the API's 60-requests-an-hour budget, which
  // a shared Cloudflare egress address can exhaust.
  try {
    const feed = await fetchChecked('https://github.com/malipetek/malipetek.github.io/commits/master.atom');
    if (feed.ok) {
      const sha = (await bodyText(feed, 100_000)).match(/Grit::Commit\/([0-9a-f]{40})/)?.[1];
      if (sha) return { sha, message: '' };
    }
  } catch {
    /* fall through to the API */
  }
  const res = await fetchChecked('https://api.github.com/repos/malipetek/malipetek.github.io/commits/master', {
    headers: { accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { sha?: unknown; commit?: { message?: unknown } };
  if (typeof data.sha !== 'string' || !/^[0-9a-f]{40}$/.test(data.sha)) return null;
  return { sha: data.sha, message: typeof data.commit?.message === 'string' ? data.commit.message.split('\n')[0] : '' };
}

async function fleetVersion(): Promise<string | null> {
  try {
    const res = await fetchChecked('https://raw.githubusercontent.com/malipetek/malipetek.github.io/master/fleet/node.mjs');
    if (!res.ok) return null;
    return parseFleetVersion(await bodyText(res, 200_000));
  } catch {
    return null;
  }
}

/* ——————————————————————— the checks ——————————————————————— */

async function siteCheck(env: Env) {
  return check('site', async () => {
    const res = await fetchChecked(`${baseUrl(env)}/`);
    const html = res.ok ? await bodyText(res, 5000) : '';
    if (res.status === 404 && sameZone(`${baseUrl(env)}/`, env)) {
      return { status: 'skip', detail: 'the Worker cannot probe its own zone; verify the site from outside' };
    }
    if (res.status !== 200) return { status: 'fail', detail: `HTTP ${res.status}` };
    if (!/<html/i.test(html)) return { status: 'fail', detail: 'answered, but not the site HTML' };
    return { status: 'ok', detail: `200 · ${baseUrl(env)}` };
  });
}

async function apiCheck(env: Env) {
  return check('api', async () => {
    const res = await fetchChecked(`${baseUrl(env)}/api/health`);
    if (res.status === 404 && sameZone(`${baseUrl(env)}/api/health`, env)) {
      return { status: 'skip', detail: 'the Worker cannot probe its own zone; verify /api/health from outside' };
    }
    if (!res.ok) return { status: 'fail', detail: `HTTP ${res.status}` };
    const body = (await res.json().catch(() => null)) as { ok?: unknown; sha?: unknown } | null;
    if (!body || body.ok !== true) return { status: 'fail', detail: 'answered, but not the Worker health JSON' };
    return { status: 'ok', detail: `200 · build ${String(body.sha ?? 'unknown').slice(0, 8)}` };
  });
}

async function deployCheck(env: Env, liveSha: string | null) {
  return check('deploy', async () => {
    const local = (env.BUILD_SHA || '').trim();
    const latest = await latestCommit();
    if (!latest) return { status: 'skip', detail: 'GitHub did not answer the commits API (rate limit?)' };
    if (!local) return { status: 'fail', detail: 'BUILD_SHA is unset: this Worker was not deployed by CI' };
    if (liveSha && liveSha !== local) {
      return { status: 'fail', detail: `the public /api/health reports ${liveSha.slice(0, 8)}, this Worker is ${local.slice(0, 8)}` };
    }
    if (local !== latest.sha) {
      return {
        status: 'fail',
        detail: `live ${local.slice(0, 8)}, master ${latest.sha.slice(0, 8)}${latest.message ? ` (${latest.message})` : ''}`,
      };
    }
    return { status: 'ok', detail: `master ${local.slice(0, 8)} is live` };
  });
}

const GITHUB_CALLBACK = '/api/auth/github/callback';
const CLOUDFLARE_CALLBACK = '/api/portal/cloudflare/callback';

async function githubOauthCheck(env: Env) {
  return check('oauth:github', async () => {
    if (!env.GITHUB_APP_CLIENT_ID) return { status: 'fail', detail: 'GITHUB_APP_CLIENT_ID is not set' };
    const redirect = `${baseUrl(env)}${GITHUB_CALLBACK}`;
    const res = await fetchChecked(
      `https://github.com/login/oauth/authorize?${new URLSearchParams({
        client_id: env.GITHUB_APP_CLIENT_ID,
        redirect_uri: redirect,
        scope: 'read:user',
        state: 'health',
      })}`,
    );
    const text = await bodyText(res, 6000);
    if (/redirect_uri[^.]{0,80}(match|registered)|redirect_uri_mismatch/i.test(text)) {
      return { status: 'fail', detail: `GitHub refuses ${redirect} — add it to the app's callback URLs` };
    }
    if (/application not found|invalid_client/i.test(text)) {
      return { status: 'fail', detail: 'GitHub does not know GITHUB_APP_CLIENT_ID' };
    }
    if (res.status >= 500) return { status: 'fail', detail: `GitHub answered HTTP ${res.status}` };
    return { status: 'ok', detail: `GitHub accepts ${redirect}` };
  });
}

async function cloudflareOauthCheck(env: Env) {
  return check('oauth:cloudflare', async () => {
    if (!env.CLOUDFLARE_OAUTH_CLIENT_ID) return { status: 'fail', detail: 'CLOUDFLARE_OAUTH_CLIENT_ID is not set' };
    const redirect = `${baseUrl(env)}${CLOUDFLARE_CALLBACK}`;
    const oauthBase = (env.CLOUDFLARE_OAUTH_BASE || 'https://dash.cloudflare.com').replace(/\/+$/, '');
    const res = await fetchChecked(
      `${oauthBase}/oauth2/auth?${new URLSearchParams({
        response_type: 'code',
        client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID,
        redirect_uri: redirect,
        scope: 'user-details.read',
        state: 'health',
      })}`,
    );
    const text = await bodyText(res, 6000);
    if (/invalid_redirect_uri|redirect_uri[^.]{0,80}(match|registered)/i.test(text)) {
      return { status: 'fail', detail: `Cloudflare refuses ${redirect} — add it to the OAuth client` };
    }
    if (/invalid_client|unknown client/i.test(text)) {
      return { status: 'fail', detail: 'Cloudflare does not know CLOUDFLARE_OAUTH_CLIENT_ID' };
    }
    if (res.status >= 500) return { status: 'fail', detail: `Cloudflare answered HTTP ${res.status}` };
    return { status: 'ok', detail: `Cloudflare accepts ${redirect}` };
  });
}

async function callbackRouteCheck(env: Env, name: string, path: string) {
  return check(name, async () => {
    const res = await fetchChecked(`${baseUrl(env)}${path}?error=health`);
    await bodyText(res, 200);
    if (res.status === 404) {
      if (sameZone(`${baseUrl(env)}${path}`, env)) {
        return { status: 'skip', detail: `the Worker cannot probe its own zone; verify ${path} from outside` };
      }
      return { status: 'fail', detail: `HTTP 404 — ${path} is not deployed on malipetek.dev` };
    }
    if (res.status >= 500) return { status: 'fail', detail: `HTTP ${res.status}` };
    return { status: 'ok', detail: `HTTP ${res.status} · ${path}` };
  });
}

async function repoCheck(env: Env) {
  return check('repos', async () => {
    const { results } = await env.DB.prepare(
      'SELECT slug, repo, repo_error FROM projects WHERE repo_error IS NOT NULL ORDER BY slug',
    ).all<{ slug: string; repo: string | null; repo_error: string }>();
    if (!results?.length) return { status: 'ok', detail: 'every project repo clones' };
    const sample = results
      .slice(0, 3)
      .map((p) => `${p.slug}: ${oneLine(p.repo_error, 120)}`)
      .join(' · ');
    return { status: 'fail', detail: `${results.length} repo${results.length === 1 ? '' : 's'} failing — ${sample}` };
  });
}

async function ticketCheck(env: Env) {
  return check('tickets', async () => {
    const { stallMinutes } = await getSettings(env);
    if (stallMinutes === 0) return { status: 'skip', detail: 'stall alerts are off (Settings)' };
    const queue = await queueView(env);
    const stuck = queue.filter((item) => item.eligible.length === 0 && item.waitingSeconds >= stallMinutes * 60);
    if (!stuck.length) return { status: 'ok', detail: `${queue.length} approved item${queue.length === 1 ? '' : 's'} can move` };
    const sample = stuck
      .slice(0, 3)
      .map((item) => `#${item.id} waited ${Math.round(item.waitingSeconds / 60)}m (${oneLine(item.reason, 120)})`)
      .join(' · ');
    return { status: 'fail', detail: `${stuck.length} stuck — ${sample}` };
  });
}

async function siteSetupCheck(env: Env) {
  return check('sites', async () => {
    const { results } = await env.DB.prepare(
      "SELECT slug, error FROM sites WHERE state = 'error' ORDER BY slug",
    ).all<{ slug: string; error: string | null }>();
    if (!results?.length) return { status: 'ok', detail: 'no site setup is stopped' };
    return {
      status: 'fail',
      detail: `${results.length} stopped — ${results
        .slice(0, 3)
        .map((s) => `${s.slug}: ${oneLine(s.error ?? 'no reason given', 100)}`)
        .join(' · ')}`,
    };
  });
}

/**
 * One check per known node, plus the capacity check that matters most: if no
 * node at all is online, approved work cannot run.
 *
 * A node is only mailed about when its `alertOfflineMinutes` says to watch it —
 * the MacBook sleeping is normal, the always-on G500 is not. A node on an old
 * version fails regardless: that is a stale rollout, not a nap.
 */
async function nodeChecks(env: Env): Promise<HealthResult[]> {
  const [nodes, expected] = await Promise.all([nodesView(env), fleetVersion()]);
  if (!nodes.length) {
    return [await check('nodes', async () => ({ status: 'fail', detail: 'no node has ever connected' }))];
  }
  const online = nodes.filter((node) => node.online);
  const capacity = await check('nodes', async () => {
    if (!online.length) {
      const last = nodes.reduce((a, b) => (a.lastSeenAt > b.lastSeenAt ? a : b));
      return { status: 'fail', detail: `no node is online; the queue waits (last: ${last.id}, ${Math.round((now() - last.lastSeenAt) / 60)}m ago)` };
    }
    return { status: 'ok', detail: `${online.length} of ${nodes.length} online` };
  });
  const perNode = await Promise.all(
    nodes.map((node) =>
      check(`node:${node.id}`, async () => {
        // An always-on node is watched closely; a laptop gets half a day,
        // because sleeping overnight is what a laptop does. A per-node
        // `alertOfflineMinutes` overrides both.
        const watched = Number(
          node.overrides.alertOfflineMinutes ?? (node.capabilities.includes('always-on') ? 15 : 12 * 60),
        );
        const offlineSeconds = now() - node.lastSeenAt;
        const running = node.version || 'unknown';
        if (expected && running !== expected) {
          return { status: 'fail', detail: `runs ${running}, master has ${expected}` };
        }
        if (offlineSeconds > Math.max(5, watched) * 60) {
          return {
            status: 'fail',
            detail: `last heartbeat ${Math.round(offlineSeconds / 60)}m ago (threshold ${watched}m) · ${node.hostname || node.id}`,
          };
        }
        return { status: 'ok', detail: `online ${Math.round(offlineSeconds)}s ago · ${running}` };
      }),
    ),
  );
  return [capacity, ...perNode];
}

/* ——————————————————————— run + persist ——————————————————————— */

function toCheck(row: HealthStateRow): HealthCheck {
  return {
    name: row.name,
    label: healthLabel(row.name),
    status: row.status,
    detail: row.detail,
    latencyMs: row.latency_ms,
    checkedAt: row.checked_at,
    failingSince: row.failing_since,
    alertedAt: row.alerted_at,
    resolvedAt: row.resolved_at,
  };
}

export async function healthView(env: Env): Promise<{ checks: HealthCheck[]; failing: number; ranAt: number | null }> {
  const { results } = await env.DB.prepare('SELECT * FROM health_checks').all<HealthStateRow>();
  const checks = (results ?? []).map(toCheck).sort((a, b) => {
    if ((a.status === 'fail') !== (b.status === 'fail')) return a.status === 'fail' ? -1 : 1;
    return healthRank(a.name) - healthRank(b.name) || a.name.localeCompare(b.name);
  });
  return {
    checks,
    failing: checks.filter((check) => check.status === 'fail').length,
    ranAt: checks.length ? Math.max(...checks.map((check) => check.checkedAt)) : null,
  };
}

/** Run every check, save the rows, and say which changed state. */
export async function runHealthChecks(env: Env): Promise<HealthRun> {
  const t = now();
  const previous = await env.DB.prepare('SELECT * FROM health_checks').all<HealthStateRow>();
  const prev = new Map((previous.results ?? []).map((row) => [row.name, row]));

  // The live sha comes from the public API, which is the point: it proves the
  // address clients use reaches this build, not just that this isolate runs.
  let liveSha: string | null = null;
  try {
    const res = await fetchChecked(`${baseUrl(env)}/api/health`);
    if (res.ok) liveSha = String(((await res.json()) as { sha?: unknown }).sha ?? '') || null;
  } catch {
    /* apiCheck reports the failure */
  }

  const results = await Promise.all([
    siteCheck(env),
    apiCheck(env),
    deployCheck(env, liveSha),
    githubOauthCheck(env),
    cloudflareOauthCheck(env),
    callbackRouteCheck(env, 'url:github-callback', GITHUB_CALLBACK),
    callbackRouteCheck(env, 'url:cloudflare-callback', CLOUDFLARE_CALLBACK),
    repoCheck(env),
    ticketCheck(env),
    siteSetupCheck(env),
    ...(await nodeChecks(env)),
  ]);

  const fresh: HealthCheck[] = [];
  const recovered: HealthCheck[] = [];
  const checks: HealthCheck[] = [];
  const statements = [];

  for (const result of results) {
    const before = prev.get(result.name);
    const wasFail = before?.status === 'fail';
    const nowFail = result.status === 'fail';
    const failingSince = nowFail ? (wasFail ? before?.failing_since ?? t : t) : null;
    const alertedAt = nowFail ? (wasFail ? before?.alerted_at ?? null : null) : null;
    const resolvedAt = !nowFail && wasFail ? t : nowFail ? null : before?.resolved_at ?? null;
    const row: HealthCheck = {
      ...result,
      label: healthLabel(result.name),
      checkedAt: t,
      failingSince,
      alertedAt,
      resolvedAt,
    };
    checks.push(row);
    // Still failing but never mailed (the mailer was down) counts as fresh too.
    if (nowFail && (!wasFail || before?.alerted_at === null)) fresh.push(row);
    if (!nowFail && wasFail && result.status === 'ok') recovered.push(row);
    statements.push(
      env.DB.prepare(
        `INSERT INTO health_checks (name, status, detail, latency_ms, checked_at, failing_since, alerted_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET status = excluded.status, detail = excluded.detail,
           latency_ms = excluded.latency_ms, checked_at = excluded.checked_at,
           failing_since = excluded.failing_since, alerted_at = excluded.alerted_at,
           resolved_at = excluded.resolved_at`,
      ).bind(
        row.name,
        row.status,
        row.detail,
        row.latencyMs,
        row.checkedAt,
        row.failingSince,
        row.alertedAt,
        row.resolvedAt,
      ),
    );
  }

  // A node removed from the fleet must not leave a red row behind for ever.
  const nodeNames = checks.filter((c) => c.name.startsWith('node:')).map((c) => c.name);
  statements.push(
    nodeNames.length
      ? env.DB.prepare(
          `DELETE FROM health_checks WHERE name LIKE 'node:%' AND name NOT IN (${nodeNames.map(() => '?').join(',')})`,
        ).bind(...nodeNames)
      : env.DB.prepare("DELETE FROM health_checks WHERE name LIKE 'node:%'"),
  );

  await env.DB.batch(statements);
  return {
    checks: checks.sort((a, b) => healthRank(a.name) - healthRank(b.name) || a.name.localeCompare(b.name)),
    fresh,
    recovered,
    failing: checks.filter((c) => c.status === 'fail').length,
    ranAt: t,
  };
}

/** Record that the alert mail for these newly failing checks went out. */
export async function markHealthAlerted(env: Env, names: string[]): Promise<void> {
  if (!names.length) return;
  await env.DB.prepare(
    `UPDATE health_checks SET alerted_at = ? WHERE name IN (${names.map(() => '?').join(',')})`,
  )
    .bind(now(), ...names)
    .run();
}

/** The one mail a failure transition sends, and the one a recovery sends. */
export function healthMail(run: Pick<HealthRun, 'fresh' | 'recovered' | 'failing'>, adminUrl: string): { subject: string; text: string } | null {
  const lines = (rows: HealthCheck[]) => rows.map((c) => `${c.status === 'fail' ? 'FAIL' : 'OK'}  ${c.label} — ${c.detail}`);
  if (run.fresh.length) {
    const subject =
      run.failing === 1
        ? `Health: ${run.fresh[0].label} is failing`
        : `Health: ${run.failing} checks failing`;
    return {
      subject,
      text: [
        ...lines(run.fresh),
        '',
        run.failing > run.fresh.length
          ? `${run.failing - run.fresh.length} more check(s) were already failing; this mail is only for the new ones.`
          : '',
        `Health page: ${adminUrl}#health`,
        '',
        'Each check is rerun every five minutes; you get one mail when it fails and one when it recovers.',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }
  if (run.recovered.length) {
    const subject = `Health: recovered — ${run.recovered[0].label}`;
    return {
      subject: run.recovered.length === 1 ? subject : `Health: ${run.recovered.length} checks recovered`,
      text: [
        ...lines(run.recovered),
        '',
        run.failing
          ? `${run.failing} check(s) still failing.`
          : 'Everything is green again.',
        `Health page: ${adminUrl}#health`,
      ].join('\n'),
    };
  }
  return null;
}
