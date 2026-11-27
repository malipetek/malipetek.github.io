/*
 * Where a project's work goes live on the client's own Cloudflare account.
 *
 * The client connects Cloudflare on their project (an account id and a scoped
 * API token, sealed in project_secrets). This module uses that credential on
 * the admin's behalf to answer one question — what is deployed in that account
 * — and parses the deploy target the admin picks from the answer. The token
 * never leaves the Worker; a call the token is not allowed to make comes back
 * as a named missing permission, not as an empty list.
 */

/**
 * `connectionId` and `accountId` name the project owner's Cloudflare OAuth
 * grant (cloudflare_connections) and the account in it the target lives in;
 * without them the target deploys with a token stored on the project.
 */
export type DeployTarget = {
  provider: 'cloudflare';
  kind: 'pages' | 'workers';
  name: string;
  productionBranch: string;
  connectionId?: number;
  accountId?: string;
};

/** The project owner's Cloudflare grant, as the admin sees it. */
export type ConnectionSummary = { id: number; email: string; accounts: { id: string; name: string }[] };

/**
 * Which of the owner's grants a project's hosting is read with: the one asked
 * for, else the one the target already uses, else the owner's newest. The
 * caller passes only the owner's live grants (rule 2: credentials come from
 * the project owner, never another user), so that is all this can pick. Null
 * when the owner has none.
 */
export function pickConnection(
  connections: ConnectionSummary[],
  { requested, target }: { requested?: number | null; target?: DeployTarget | null },
): ConnectionSummary | null {
  const byId = (id: number | null | undefined) => (id ? connections.find((c) => c.id === id) ?? null : null);
  return byId(requested) ?? byId(target?.connectionId) ?? connections[0] ?? null;
}

export type Listing<T> = { ok: true; items: T[] } | { ok: false; error: string; permission?: string };

export type PagesProject = { name: string; subdomain: string | null; productionBranch: string | null; domains: string[] };
export type WorkerScript = { name: string; modifiedOn: string | null };

type Fetch = typeof fetch;
const API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 10_000;

/** The permission a refused call needs, in the words the token form uses. */
const NEEDS = { pages: 'Cloudflare Pages: Read (Edit to deploy)', workers: 'Workers Scripts: Read (Edit to deploy)' } as const;

async function call(fetchImpl: Fetch, token: string, path: string): Promise<{ status: number; body: any }> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${API}${path}`, { headers: { authorization: `Bearer ${token}` }, signal });
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

/** A failed call, said without echoing anything the caller sent. */
function failure(status: number, body: any, permission: string): { ok: false; error: string; permission?: string } {
  if (status === 0) return { ok: false, error: 'Cloudflare did not answer in time.' };
  const code = Number(body?.errors?.[0]?.code);
  // 10000 is Cloudflare's "Authentication error": the token lacks the permission.
  if (status === 401 || status === 403 || code === 10000) return { ok: false, error: 'The token is not allowed to read this.', permission };
  return { ok: false, error: `Cloudflare answered ${status}.` };
}

/** The account's Pages projects, with each one's production branch and domains. */
export async function listPages(accountId: string, token: string, fetchImpl: Fetch = fetch): Promise<Listing<PagesProject>> {
  const { status, body } = await call(fetchImpl, token, `/accounts/${encodeURIComponent(accountId)}/pages/projects`);
  if (status !== 200 || body?.success !== true) return failure(status, body, NEEDS.pages);
  const items = (Array.isArray(body.result) ? body.result : []).map((p: any) => ({
    name: String(p?.name ?? ''),
    subdomain: typeof p?.subdomain === 'string' ? p.subdomain : null,
    productionBranch: typeof p?.production_branch === 'string' ? p.production_branch : null,
    domains: Array.isArray(p?.domains) ? p.domains.filter((d: unknown) => typeof d === 'string') : [],
  })).filter((p: PagesProject) => p.name);
  return { ok: true, items };
}

/** The account's Worker scripts, newest change first. */
export async function listWorkers(accountId: string, token: string, fetchImpl: Fetch = fetch): Promise<Listing<WorkerScript>> {
  const { status, body } = await call(fetchImpl, token, `/accounts/${encodeURIComponent(accountId)}/workers/scripts`);
  if (status !== 200 || body?.success !== true) return failure(status, body, NEEDS.workers);
  const items = (Array.isArray(body.result) ? body.result : [])
    .map((s: any) => ({ name: String(s?.id ?? ''), modifiedOn: typeof s?.modified_on === 'string' ? s.modified_on : null }))
    .filter((s: WorkerScript) => s.name)
    .sort((a: WorkerScript, b: WorkerScript) => String(b.modifiedOn ?? '').localeCompare(String(a.modifiedOn ?? '')));
  return { ok: true, items };
}

/**
 * What answers each of the account's domains: a Worker route or custom
 * domain names its script, a CNAME to `<name>.pages.dev` names a Pages
 * project, anything else is named by its DNS target. This is how a Pages site
 * is found with a grant that may not list Pages.
 */
export type ServedBy = { host: string; kind: 'workers' | 'pages' | 'dns'; name: string; via: string };

export async function listDomains(accountId: string, token: string, fetchImpl: Fetch = fetch): Promise<Listing<ServedBy>> {
  const zones = await call(fetchImpl, token, `/zones?account.id=${encodeURIComponent(accountId)}&per_page=50`);
  if (zones.status !== 200 || zones.body?.success !== true) return failure(zones.status, zones.body, 'Zone: Read');
  const items: ServedBy[] = [];
  const seen = new Set<string>();
  const add = (entry: ServedBy) => {
    const key = `${entry.host} ${entry.kind} ${entry.name}`;
    if (!seen.has(key)) { seen.add(key); items.push(entry); }
  };
  const custom = await call(fetchImpl, token, `/accounts/${encodeURIComponent(accountId)}/workers/domains`);
  if (custom.status === 200 && Array.isArray(custom.body?.result)) {
    for (const d of custom.body.result) if (d?.hostname && d?.service) add({ host: String(d.hostname), kind: 'workers', name: String(d.service), via: 'Worker custom domain' });
  }
  for (const zone of (Array.isArray(zones.body.result) ? zones.body.result : []).slice(0, 20)) {
    const zoneId = encodeURIComponent(String(zone?.id ?? ''));
    if (!zoneId) continue;
    const [routes, dns] = await Promise.all([
      call(fetchImpl, token, `/zones/${zoneId}/workers/routes`),
      call(fetchImpl, token, `/zones/${zoneId}/dns_records?per_page=100`),
    ]);
    if (routes.status === 200 && Array.isArray(routes.body?.result)) {
      for (const r of routes.body.result) if (r?.pattern && r?.script) add({ host: String(r.pattern), kind: 'workers', name: String(r.script), via: 'Worker route' });
    }
    if (dns.status === 200 && Array.isArray(dns.body?.result)) {
      for (const r of dns.body.result) {
        if (!r?.name || !['CNAME', 'A', 'AAAA'].includes(r?.type)) continue;
        const content = String(r.content ?? '');
        const pages = /^([a-z0-9-]+)\.pages\.dev\.?$/i.exec(content);
        if (pages) add({ host: String(r.name), kind: 'pages', name: pages[1].toLowerCase(), via: `CNAME ${content}` });
        else if (r.type === 'CNAME' || String(r.name) === String(zone?.name)) add({ host: String(r.name), kind: 'dns', name: content, via: `${r.type} ${content}${r.proxied ? ' (proxied)' : ''}` });
      }
    }
  }
  return { ok: true, items };
}

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,100}$/;

/**
 * A deploy target from a request body, or an error key. `null` clears it.
 * @returns the target, `null`, or `{ error }`.
 */
export function parseDeployTarget(raw: unknown): DeployTarget | null | { error: string } {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') return { error: 'bad_target' };
  const body = raw as Record<string, unknown>;
  const kind = body.kind;
  if (kind !== 'pages' && kind !== 'workers') return { error: 'bad_kind' };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!NAME.test(name)) return { error: 'bad_name' };
  const branch = body.productionBranch === undefined || body.productionBranch === '' ? 'main' : body.productionBranch;
  if (typeof branch !== 'string' || !BRANCH.test(branch)) return { error: 'bad_branch' };
  const target: DeployTarget = { provider: 'cloudflare', kind, name, productionBranch: branch };
  if (body.connectionId !== undefined && body.connectionId !== null) {
    const connectionId = Number(body.connectionId);
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!Number.isInteger(connectionId) || connectionId <= 0) return { error: 'bad_connection' };
    if (!/^[0-9a-f]{32}$/.test(accountId)) return { error: 'bad_account' };
    Object.assign(target, { connectionId, accountId });
  }
  return target;
}

/** The stored column, read back; anything unreadable is no target. */
export function readDeployTarget(stored: string | null | undefined): DeployTarget | null {
  if (!stored) return null;
  try {
    const parsed = parseDeployTarget(JSON.parse(stored));
    return parsed && !('error' in parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * What a fleet run is told about the target, as environment variables beside
 * the Cloudflare credential: the agent deploys previews to its ticket branch
 * and production to the production branch.
 */
export function deployTargetEnv(target: DeployTarget | null): Record<string, string> {
  if (!target) return {};
  return {
    PTECH_DEPLOY_PROVIDER: target.provider,
    PTECH_DEPLOY_KIND: target.kind,
    PTECH_DEPLOY_NAME: target.name,
    PTECH_DEPLOY_PRODUCTION_BRANCH: target.productionBranch,
  };
}
