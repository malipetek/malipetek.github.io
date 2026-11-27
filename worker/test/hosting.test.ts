import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deployTargetEnv, detectProviderBuild, listDomains, listPages, listWorkers, normalizeRepo, parseDeployTarget, pickConnection, readDeployTarget } from '../src/hosting.ts';

const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

test('hosting: Pages projects come back with their production branch and domains', async () => {
  const seen: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen.push(`${url} ${(init?.headers as Record<string, string>).authorization}`);
    return new Response(JSON.stringify({ success: true, result: [{ name: 'petekkoleji', subdomain: 'petekkoleji.pages.dev', production_branch: 'main', domains: ['petekkoleji.com'] }] }), { status: 200 });
  }) as typeof fetch;
  const pages = await listPages('acc1', 'tok', fetchImpl);
  assert.deepEqual(pages, { ok: true, items: [{ name: 'petekkoleji', subdomain: 'petekkoleji.pages.dev', productionBranch: 'main', domains: ['petekkoleji.com'], source: { type: null, repo: null, productionBranch: null, previews: false } }] });
  assert.equal(seen[0], 'https://api.cloudflare.com/client/v4/accounts/acc1/pages/projects Bearer tok');
});

test('hosting: a Pages project says when the provider builds it from Git', async () => {
  const pages = await listPages('acc1', 'tok', answer(200, { success: true, result: [
    // Git-connected (the Pages Git integration): source.config carries the repo.
    { name: 'petekkoleji', production_branch: 'main', domains: [],
      source: { type: 'github', config: { owner: 'PetekKoleji', repo_name: 'petekkoleji.com', production_branch: 'main', preview_deployment_setting: 'all' } } },
    // Direct upload: no source at all.
    { name: 'uploads', production_branch: 'main', domains: [] },
    // Connected to GitLab, previews off.
    { name: 'noprev', production_branch: 'trunk', domains: [],
      source: { type: 'gitlab', config: { owner: 'grp', repo_name: 'site', production_branch: 'trunk', preview_deployment_setting: 'none' } } },
    // Previews only for named branches.
    { name: 'gated', production_branch: 'main', domains: [],
      source: { type: 'github', config: { owner: 'o', repo_name: 'r', production_branch: 'main', preview_deployment_setting: 'preview_branches', preview_branch_includes: ['dev'] } } },
    { name: 'gated-empty', production_branch: 'main', domains: [],
      source: { type: 'github', config: { owner: 'o', repo_name: 'r2', production_branch: 'main', preview_deployment_setting: 'preview_branches', preview_branch_includes: [] } } },
    // A source shape the parser does not know reads as not git-connected.
    { name: 'odd', production_branch: 'main', domains: [], source: { type: 'bitbucket' } },
  ] }));
  assert.ok(pages.ok);
  assert.deepEqual(pages.items.map((p) => [p.name, p.source]), [
    ['petekkoleji', { type: 'github', repo: 'PetekKoleji/petekkoleji.com', productionBranch: 'main', previews: true }],
    ['uploads', { type: null, repo: null, productionBranch: null, previews: false }],
    ['noprev', { type: 'gitlab', repo: 'grp/site', productionBranch: 'trunk', previews: false }],
    ['gated', { type: 'github', repo: 'o/r', productionBranch: 'main', previews: true }],
    ['gated-empty', { type: 'github', repo: 'o/r2', productionBranch: 'main', previews: false }],
    ['odd', { type: null, repo: null, productionBranch: null, previews: false }],
  ]);
});

test('hosting: a stored repo URL normalizes to owner/name, GitHub only', () => {
  assert.equal(normalizeRepo('https://github.com/PetekKoleji/petekkoleji.com'), 'petekkoleji/petekkoleji.com');
  assert.equal(normalizeRepo('https://github.com/petekkoleji/petekkoleji.com.git'), 'petekkoleji/petekkoleji.com');
  assert.equal(normalizeRepo('https://github.com/petekkoleji/petekkoleji.com/'), 'petekkoleji/petekkoleji.com');
  assert.equal(normalizeRepo('git@github.com:PetekKoleji/petekkoleji.com.git'), 'petekkoleji/petekkoleji.com');
  assert.equal(normalizeRepo('https://gitlab.com/a/b'), null);
  assert.equal(normalizeRepo('https://github.com/malipetek.github.io'), null);
  assert.equal(normalizeRepo('not a url'), null);
  assert.equal(normalizeRepo(null), null);
});

test('hosting: detected is the one Pages project the provider builds from the project repo', () => {
  const connected = (name: string, repo: string) => ({
    name, subdomain: `${name}.pages.dev`, productionBranch: 'main', domains: [],
    source: { type: 'github' as const, repo, productionBranch: 'main', previews: true },
  });
  const upload = { name: 'uploads', subdomain: 'uploads.pages.dev', productionBranch: 'main', domains: [], source: { type: null, repo: null, productionBranch: null, previews: false } };
  assert.deepEqual(
    detectProviderBuild([connected('petekkoleji', 'petekkoleji/petekkoleji.com'), upload], 'petekkoleji/petekkoleji.com'),
    { provider: 'cloudflare', kind: 'pages', name: 'petekkoleji', productionBranch: 'main', builds: 'provider', repo: 'petekkoleji/petekkoleji.com' },
  );
  // The compare is case-insensitive, as GitHub names are.
  assert.equal(detectProviderBuild([connected('p', 'PETEKKOLEJI/Petekkoleji.com')], 'petekkoleji/petekkoleji.com')?.name, 'p');
  // No repo, no match, or two matches: nothing unambiguous to say.
  assert.equal(detectProviderBuild([connected('p', 'a/b')], null), null);
  assert.equal(detectProviderBuild([connected('p', 'a/b'), upload], 'c/d'), null);
  assert.equal(detectProviderBuild([connected('p', 'a/b'), connected('q', 'a/b')], 'a/b'), null);
  assert.equal(detectProviderBuild([], 'a/b'), null);
});

test('hosting: a live Pages site built from another repo is named with repoDiffers', () => {
  const pages = (name: string, repo: string | null, domains: string[] = []) => ({
    name, subdomain: `${name}.pages.dev`, productionBranch: 'main', domains: [`${name}.pages.dev`, ...domains],
    source: { type: repo ? 'github' as const : null, repo, productionBranch: repo ? 'main' : null, previews: Boolean(repo) },
  });
  // The project records an empty onboarding stub; the school's site is built from its own repo.
  const live = pages('petekkoleji', 'petekkoleji/petekkoleji.com', ['petekkoleji.com']);
  assert.deepEqual(detectProviderBuild([live], 'malipetek/petekkoleji'), {
    provider: 'cloudflare', kind: 'pages', name: 'petekkoleji', productionBranch: 'main', builds: 'provider',
    repo: 'petekkoleji/petekkoleji.com', repoDiffers: true,
  });
  // No recorded repo at all: the same answer.
  assert.equal(detectProviderBuild([live], null)?.repoDiffers, true);
  // Served through DNS only, or already the deploy target: still the live site.
  const bare = pages('site', 'o/site');
  assert.equal(detectProviderBuild([bare], 'x/y', { served: ['site'] })?.name, 'site');
  assert.equal(detectProviderBuild([bare], 'x/y', { target: { provider: 'cloudflare', kind: 'pages', name: 'site', productionBranch: 'main' } })?.name, 'site');
  // A git-built project that serves nothing, or two live ones, or a direct upload: nothing to say.
  assert.equal(detectProviderBuild([bare], 'x/y'), null);
  assert.equal(detectProviderBuild([live, pages('other', 'o/other', ['other.com'])], 'x/y'), null);
  assert.equal(detectProviderBuild([pages('upload', null, ['petekkoleji.com'])], 'x/y'), null);
  // An exact repo match still wins over a live site built elsewhere.
  assert.equal(detectProviderBuild([live, pages('mine', 'x/y')], 'x/y')?.name, 'mine');
});

test('hosting: a refused call names the permission the token lacks, and never echoes the token', async () => {
  const pages = await listPages('acc1', 'secret-token', answer(403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] }));
  assert.equal(pages.ok, false);
  assert.match(JSON.stringify(pages), /Cloudflare Pages: Read/);
  assert.doesNotMatch(JSON.stringify(pages), /secret-token/);
});

test('hosting: Worker scripts come back newest first', async () => {
  const workers = await listWorkers('acc1', 'tok', answer(200, { success: true, result: [
    { id: 'old', modified_on: '2025-01-02T00:00:00Z' },
    { id: 'new', modified_on: '2026-11-20T00:00:00Z' },
  ] }));
  assert.deepEqual(workers.ok && workers.items.map((w) => w.name), ['new', 'old']);
});

test('hosting: a deploy target is a Pages project or a Worker, with a production branch', () => {
  assert.deepEqual(parseDeployTarget({ kind: 'pages', name: 'petekkoleji' }), { provider: 'cloudflare', kind: 'pages', name: 'petekkoleji', productionBranch: 'main', builds: 'fleet' });
  assert.equal(parseDeployTarget(null), null);
  assert.deepEqual(parseDeployTarget({ kind: 'r2', name: 'x' }), { error: 'bad_kind' });
  assert.deepEqual(parseDeployTarget({ kind: 'pages', name: 'Bad Name' }), { error: 'bad_name' });
  assert.deepEqual(parseDeployTarget(undefined), { error: 'bad_target' });
  assert.equal(readDeployTarget('not json'), null);
  assert.deepEqual(deployTargetEnv(readDeployTarget('{"kind":"workers","name":"site","productionBranch":"prod"}')), {
    PTECH_DEPLOY_PROVIDER: 'cloudflare', PTECH_DEPLOY_KIND: 'workers', PTECH_DEPLOY_NAME: 'site', PTECH_DEPLOY_PRODUCTION_BRANCH: 'prod', PTECH_DEPLOY_BUILDS: 'fleet',
  });
  assert.deepEqual(deployTargetEnv(null), {});
});

test('hosting: a deploy target may record who builds — provider or fleet — defaulting to the fleet', () => {
  assert.equal((parseDeployTarget({ kind: 'pages', name: 'x', builds: 'provider' }) as any)?.builds, 'provider');
  assert.equal((parseDeployTarget({ kind: 'pages', name: 'x', builds: 'fleet' }) as any)?.builds, 'fleet');
  assert.deepEqual(parseDeployTarget({ kind: 'pages', name: 'x', builds: 'nobody' }), { error: 'bad_builds' });
  assert.deepEqual(parseDeployTarget({ kind: 'pages', name: 'x', builds: 1 }), { error: 'bad_builds' });
  // Rows stored before `builds` existed read as fleet.
  assert.equal(readDeployTarget('{"kind":"pages","name":"x"}')?.builds, 'fleet');
  assert.equal(deployTargetEnv(readDeployTarget('{"kind":"pages","name":"x","builds":"provider"}')).PTECH_DEPLOY_BUILDS, 'provider');
});

test('hosting: a target can name the client OAuth grant and the account in it', () => {
  const account = '3b10da484bffbc2d9ef9f1d244cfa2f9';
  assert.deepEqual(parseDeployTarget({ kind: 'workers', name: 'petekkoleji', connectionId: 8, accountId: account }), {
    provider: 'cloudflare', kind: 'workers', name: 'petekkoleji', productionBranch: 'main', builds: 'fleet', connectionId: 8, accountId: account,
  });
  assert.deepEqual(parseDeployTarget({ kind: 'workers', name: 'x', connectionId: 8, accountId: 'nope' }), { error: 'bad_account' });
  assert.deepEqual(parseDeployTarget({ kind: 'workers', name: 'x', connectionId: -1, accountId: account }), { error: 'bad_connection' });
});

test('hosting: the grant is the asked one, then the target, then the owner’s newest — and only the owner’s', () => {
  const school = { id: 8, email: 'petekkoleji2023@gmail.com', accounts: [{ id: 'a', name: "Petekkoleji2023@gmail.com's Account" }] };
  const other = { id: 1, email: 'altermalipetek@gmail.com', accounts: [{ id: 'b', name: 'x' }] };
  // The caller passes only the owner's live grants, so that is all this can
  // pick: a school-shaped email no longer reaches past the newest grant.
  assert.equal(pickConnection([other, school], { requested: 8 })?.id, 8);
  assert.equal(pickConnection([other, school], { target: { provider: 'cloudflare', kind: 'workers', name: 'x', productionBranch: 'main', connectionId: 1, accountId: 'b' } })?.id, 1);
  assert.equal(pickConnection([other, school], {})?.id, 1);
  // An id that is not one of the owner's grants (another user's, a revoked
  // one) is never picked: the owner's newest stands in.
  assert.equal(pickConnection([school], { requested: 1 })?.id, 8);
  assert.equal(pickConnection([], { requested: 1 }), null);
});

test('hosting: the domains say what serves them, a pages.dev CNAME naming the Pages project', async () => {
  const fetchImpl = (async (url: string) => {
    const body = (result: unknown) => new Response(JSON.stringify({ success: true, result }), { status: 200 });
    if (url.includes('/zones?account.id=')) return body([{ id: 'z1', name: 'petekkoleji.com' }]);
    if (url.endsWith('/workers/domains')) return body([]);
    if (url.includes('/workers/routes')) return body([{ pattern: 'petekkoleji.com/api/mail*', script: 'petekkoleji-mailer' }]);
    if (url.includes('/dns_records')) return body([
      { type: 'CNAME', name: 'petekkoleji.com', content: 'petekkoleji-site.pages.dev', proxied: true },
      { type: 'CNAME', name: 'cms.petekkoleji.com', content: 'directus.example.net', proxied: true },
      { type: 'MX', name: 'petekkoleji.com', content: 'mx.example.net' },
    ]);
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  const domains = await listDomains('acc', 'tok', fetchImpl);
  assert.ok(domains.ok);
  assert.deepEqual(domains.ok && domains.items.map((d) => `${d.host} ${d.kind} ${d.name}`), [
    'petekkoleji.com/api/mail* workers petekkoleji-mailer',
    'petekkoleji.com pages petekkoleji-site',
    'cms.petekkoleji.com dns directus.example.net',
  ]);
});
