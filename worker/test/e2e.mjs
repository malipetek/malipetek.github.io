#!/usr/bin/env node
/*
 * End-to-end checks for the portal Worker, against the real dev server.
 *
 *   pnpm test:e2e            every group
 *   pnpm test:e2e sites      only groups whose name contains "sites"
 *
 * Each run gets a throwaway state folder (its own D1, KV and rate limits, with
 * every migration applied) and its own port, so
 * it never touches your dev database and can run beside `pnpm dev`. The `node`
 * group runs the real fleet/node.mjs once, with a fake `claude`, against a
 * local git repo. Nothing leaves this machine.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO = dirname(WORKER);
const only = process.argv[2] ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ——————————————————————— harness ——————————————————————— */

const results = [];
let group = '';
function check(name, ok, detail = '') {
  results.push({ group, name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? `\n       ${detail}` : ''}`);
}

/** The value .dev.vars gives a key; .dev.vars wins over the vars we inject. */
function devVar(name) {
  const file = join(WORKER, '.dev.vars');
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
  return line === undefined ? undefined : line.slice(name.length + 1).trim();
}

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

let W = '';
let RUNNER_TOKEN = '';
const DUMMY_TURNSTILE = 'XXXX.DUMMY.TOKEN.XXXX'; // passes Cloudflare's always-pass test secret

async function call(path, { method = 'GET', body, auth } = {}) {
  const res = await fetch(W + path, {
    method,
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function signIn(email) {
  const r = await call('/auth/request', { method: 'POST', body: { email, turnstileToken: DUMMY_TURNSTILE } });
  if (!r.data?.devLink) throw new Error(`sign-in for ${email} returned no dev link: ${JSON.stringify(r)}`);
  const token = new URL(r.data.devLink).hash.match(/token=([^&]+)/)[1];
  const v = await call('/auth/verify', { method: 'POST', body: { token } });
  return { session: v.data.session, user: v.data.user };
}

/**
 * A client account with a live session, written straight into the test D1.
 * Real sign-ins are rate-limited per IP (as they should be), so the suite
 * spends them only where the sign-in itself is under test.
 */
function account(email) {
  const id = randomUUID();
  const token = randomBytes(24).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  const t = Math.floor(Date.now() / 1000);
  sql(
    `INSERT INTO users (id, email, role, created_at) VALUES ('${id}', '${email}', 'client', ${t});
     INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES ('${hash}', '${id}', ${t + 86400}, ${t});`,
  );
  return { session: token, user: { id, email, role: 'client' } };
}

let STATE = '';

/*
 * A stand-in for Cloudflare's OAuth and accounts API: the token endpoint
 * (client secret by Basic auth), revoke, and /accounts for a good token.
 */
const CF = { port: 0, revoked: [] };
const CF_CLIENT = { id: 'e2e-cf-client', secret: 'e2e-cf-secret' };
function startFakeCloudflare() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const json = (status, data) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      const form = new URLSearchParams(body);
      const basic = `Basic ${Buffer.from(`${CF_CLIENT.id}:${CF_CLIENT.secret}`).toString('base64')}`;
      if (req.method === 'POST' && req.url === '/oauth2/token') {
        if (req.headers.authorization !== basic) return json(401, { error: 'invalid_client' });
        if (form.get('grant_type') === 'authorization_code' && form.get('code') === 'good-code' && /\/portal\/cloudflare\/callback$/.test(form.get('redirect_uri') ?? '')) {
          return json(200, { access_token: 'cf-access-secret', refresh_token: 'cf-refresh-secret', expires_in: 3600, scope: 'workers-scripts.edit zone.read' });
        }
        return json(400, { error: 'invalid_grant' });
      }
      if (req.method === 'POST' && req.url === '/oauth2/revoke') {
        CF.revoked.push(form.get('token'));
        return json(200, {});
      }
      if (req.method === 'GET' && req.url.startsWith('/client/v4/accounts')) {
        if (req.headers.authorization !== 'Bearer cf-access-secret') return json(403, { success: false });
        return json(200, { success: true, result: [{ id: 'acc-1', name: 'Rosa Florist LLC' }] });
      }
      json(404, {});
    });
  });
  server.unref(); // never what keeps the suite alive
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((CF.port = server.address().port))));
}
/**
 * Run SQL against the test D1 from outside the dev server. That is a second
 * process on the same SQLite file, so a write can meet a lock the server holds;
 * retry a few times before calling it a failure.
 */
function sql(query) {
  let last;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return execFileSync('npx', ['wrangler', 'd1', 'execute', 'malipetek-portal', '--local', '--persist-to', STATE, '--command', query], {
        cwd: WORKER,
        stdio: 'pipe',
      });
    } catch (error) {
      last = error;
      execFileSync('sleep', [String(0.5 * (attempt + 1))]);
    }
  }
  throw new Error(`sql failed after retries: ${String(last?.stderr ?? last).slice(-500)}`);
}

const node = (id, slugs, { running = [], slots = 1, executors = ['claude'] } = {}) =>
  call('/node/heartbeat', {
    method: 'POST',
    auth: RUNNER_TOKEN,
    body: { node: { id, hostname: id, os: 'macos', capabilities: ['os:macos'], executors, slugs, slots, version: 'e2e' }, running },
  });
const claim = async (nodeId) => (await call('/node/claim', { method: 'POST', auth: RUNNER_TOKEN, body: { nodeId } })).data;
const approve = (admin, id) => call(`/admin/tickets/${id}`, { method: 'PATCH', auth: admin, body: { status: 'approved' } });
const newProject = (session, body) => call('/portal/projects', { method: 'POST', auth: session, body });
const NEW_BRIEF = { what: 'A small bakery', manual: 'Orders by phone', goal: 'Customers order online' };
const OLD_BRIEF = { what: 'A shop', where: 'GitHub', goal: 'Faster checkout' };

/* ——————————————————————— groups ——————————————————————— */

const groups = {
  async onboarding({ admin }) {
    const a = await signIn(`onb-${Date.now()}@example.com`);
    check('a real magic-link sign-in creates the account', a.user?.role === 'client' && typeof a.session === 'string');
    const created = await newProject(a.session, { kind: 'new', name: 'Acme Bakery', brief: NEW_BRIEF });
    check('client creates a project from the interview', created.status === 201 && created.data.project.slug === 'acme-bakery');
    const again = await newProject(a.session, { kind: 'new', name: 'Acme Bakery', brief: NEW_BRIEF });
    check('a second project with the same name gets its own slug', again.data?.project?.slug === 'acme-bakery-2', JSON.stringify(again.data));
    check('the first request is filed with it', Number.isInteger(created.data.ticketId));
    const thread = await call(`/portal/tickets/${created.data.ticketId}`, { auth: a.session });
    check('the brief is in the thread', /Orders by phone/.test(JSON.stringify(thread.data)));
    check('a missing brief is refused', (await newProject(a.session, { kind: 'new', name: 'X', brief: { what: 'x' } })).data?.error === 'bad_brief');
    check('a non-repo URL is refused', (await newProject(a.session, { kind: 'existing', name: 'Y', brief: OLD_BRIEF, repoKind: 'repo', repo: 'file:///etc' })).data?.error === 'bad_repo');
    check('signed out is refused', (await newProject(undefined, { kind: 'new', name: 'Z', brief: NEW_BRIEF })).status === 401);
    const me = (await call('/portal/me', { auth: a.session })).data;
    const p = me.projects.find((x) => x.id === created.data.project.id);
    check('setup: brief and request ready, preview missing and blocking', p.setup.checks.find((c) => c.key === 'brief').state === 'ready' && p.setup.checks.find((c) => c.key === 'preview').state === 'missing' && !p.setup.autonomous);
    const adminView = (await call('/admin/projects', { auth: admin })).data.projects.find((x) => x.id === created.data.project.id);
    check('admin sees the same setup', adminView?.setup?.ready === p.setup.ready && adminView.brief.manual === 'Orders by phone');
  },

  async marketing({ admin }) {
    const desk = await call('/admin/marketing', { auth: admin });
    check('the desk starts paused, with the outreach sender', desk.status === 200 && desk.data.settings.live === false && desk.data.sender === 'hello@malipetek.dev');
    check('a paused desk sends nothing', (await call('/admin/marketing/run', { method: 'POST', auth: admin })).data.reason === 'paused');

    const csv = 'email,name,business,site,gap\nsara@bakery-nine.test,Sara,Bakery Nine,bakerynine.test,menu still says summer\nnobody@example.test,,,,';
    const imported = await call('/admin/marketing/contacts/import', {
      method: 'POST',
      auth: admin,
      body: { csv, sequence: 'cold_a', campaign: 'e2e' },
    });
    check('import queues the contact that has an observation', imported.data.added === 2 && imported.data.paused === 1, JSON.stringify(imported.data));

    const again = await call('/admin/marketing/contacts/import', {
      method: 'POST',
      auth: admin,
      body: { csv, sequence: 'cold_a', campaign: 'e2e' },
    });
    check('a re-import skips both instead of duplicating them', again.data.added === 0 && again.data.skipped.every((s) => s.reason === 'already_in_list'));

    const contacts = (await call('/admin/marketing/contacts', { auth: admin })).data.contacts;
    check('the queued contact is marked queued', contacts.find((c) => c.email === 'sara@bakery-nine.test')?.status === 'queued');
    check('the contact without a gap is held, not sent', contacts.find((c) => c.email === 'nobody@example.test')?.status === 'paused');

    const emails = (await call('/admin/marketing/messages?channel=email', { auth: admin })).data.messages;
    check('three steps are scheduled for the queued contact', emails.filter((m) => m.status === 'scheduled').length === 3);
    const firstEmail = emails.find((m) => m.step === 0);
    check('the first email carries the observation, not a placeholder', /menu still says summer/.test(firstEmail?.body ?? '') && !firstEmail.body.includes('{{'));

    const bad = await call('/admin/marketing/settings', { method: 'PUT', auth: admin, body: { dailyCap: 0, live: 'yes' } });
    check('a bad setting is refused and the old value stands', bad.data.rejected.length === 2 && bad.data.settings.dailyCap === 20);

    const post = await call('/admin/marketing/messages', {
      method: 'POST',
      auth: admin,
      body: { channel: 'x', body: 'The last mile is the whole job.' },
    });
    check('a social post starts as a draft', post.status === 201 && post.data.message.status === 'draft');
    check('the publisher refuses an unauthenticated poll', (await call('/marketing/publisher/posts?channel=x')).status === 401);

    await call(`/admin/marketing/messages/${post.data.message.id}/schedule`, { method: 'POST', auth: admin });
    const claimed = await call('/marketing/publisher/posts?channel=x', { auth: 'e2e-marketing-token' });
    check('the publisher claims the due post', claimed.data.posts.length === 1 && /last mile/.test(claimed.data.posts[0].text));
    check('a second poll cannot post it twice', (await call('/marketing/publisher/posts?channel=x', { auth: 'e2e-marketing-token' })).data.posts.length === 0);
    await call(`/marketing/publisher/posts/${post.data.message.id}/result`, {
      method: 'POST',
      auth: 'e2e-marketing-token',
      body: { ok: true, url: 'https://x.com/i/status/1' },
    });
    const sentPost = (await call('/admin/marketing/messages?channel=x', { auth: admin })).data.messages.find((m) => m.id === post.data.message.id);
    check('the published post records its URL', sentPost?.status === 'sent' && sentPost.url === 'https://x.com/i/status/1');

    const client = account(`desk-${Date.now()}@example.com`);
    check('a client cannot open the marketing desk', (await call('/admin/marketing', { auth: client.session })).status === 403);
  },

  async sites({ admin }) {
    const a = account(`site-${Date.now()}@example.com`);
    const other = account(`intruder-${Date.now()}@example.com`);
    const { project } = (await newProject(a.session, { kind: 'new', name: 'Rosa Florist', brief: NEW_BRIEF })).data;
    check('another client cannot start this site', (await call(`/portal/projects/${project.id}/site`, { method: 'POST', auth: other.session, body: {} })).status === 404);
    const start = await call(`/portal/projects/${project.id}/site`, { method: 'POST', auth: a.session, body: {} });
    check('start → allocating, with the preview address', start.status === 201 && start.data.site.state === 'allocating' && start.data.site.previewUrl === 'https://rosa-florist--preview.malipetek.online', JSON.stringify(start.data));
    const np0 = (await call('/node/projects', { auth: RUNNER_TOKEN })).data.projects.find((x) => x.id === project.id);
    check('nodes are asked to make the repo', np0?.needsRepo?.site === 'rosa-florist' && np0.needsRepo.template === 'site');
    // A fleet node creates the repo and reports it; then the site is ready.
    const reported = await call('/node/sites/rosa-florist/repo', { method: 'POST', auth: RUNNER_TOKEN, body: { repo: 'https://github.com/malipetek/rosa-florist' } });
    check('a node reports the repo it made', reported.status === 200 && reported.data.state === 'ready', JSON.stringify(reported.data));
    const site = (await call(`/portal/projects/${project.id}/site`, { auth: a.session })).data.site;
    check('ready, with preview and production addresses', site.state === 'ready' && site.productionUrl === 'https://rosa-florist.malipetek.online');
    const np = (await call('/node/projects', { auth: RUNNER_TOKEN })).data.projects.find((x) => x.id === project.id);
    check('nodes get the repo and the preview base', np?.repo === 'https://github.com/malipetek/rosa-florist' && np.baseRef === 'origin/preview' && np.site === 'rosa-florist');
    const p = (await call('/portal/me', { auth: a.session })).data.projects.find((x) => x.id === project.id);
    const checks = Object.fromEntries(p.setup.checks.map((c) => [c.key, c]));
    check('setup: preview, code and repo ready; domain optional', checks.preview.state === 'ready' && checks.code.state === 'ready' && checks.domain.blocking === false);

    // Deploys: manifest first, the blobs it lacks, then finish → the preview moves.
    const sha = (s) => createHash('sha256').update(s).digest('hex');
    const one = [{ path: 'index.html', sha256: sha('<h1>one</h1>'), size: 11, type: 'text/html' }];
    const made = await call('/node/sites/rosa-florist/deploys', { method: 'POST', auth: RUNNER_TOKEN, body: { files: one } });
    check('a deploy opens and names what it lacks', made.status === 201 && made.data.needed?.length === 1 && /^d[0-9a-f]{40}$/.test(made.data.deployId ?? ''), JSON.stringify(made.data));
    check('the same files are the same deploy', (await call('/node/sites/rosa-florist/deploys', { method: 'POST', auth: RUNNER_TOKEN, body: { files: one } })).data.deployId === made.data.deployId);
    const put = (id, sh, bytes) => fetch(`${W}/node/sites/rosa-florist/deploys/${id}/files/${sh}`, { method: 'PUT', headers: { authorization: `Bearer ${RUNNER_TOKEN}`, 'content-length': String(bytes.length) }, body: bytes });
    check('a blob not in the manifest is refused', (await put(made.data.deployId, sha('nope'), new TextEncoder().encode('nope'))).status === 400);
    check('bytes must match their sha', (await put(made.data.deployId, one[0].sha256, new TextEncoder().encode('wrong'))).status === 400);
    check('the manifest blob uploads', (await put(made.data.deployId, one[0].sha256, new TextEncoder().encode('<h1>one</h1>'))).status === 200);
    const fin = await call(`/node/sites/rosa-florist/deploys/${made.data.deployId}/finish`, { method: 'POST', auth: RUNNER_TOKEN, body: {} });
    check('finish points the preview at it', fin.status === 200 && fin.data.deployId === made.data.deployId, JSON.stringify(fin.data));
    check('…but production still shows the placeholder', (await call(`/portal/projects/${project.id}/site`, { auth: a.session })).data.site.previewDeploy === made.data.deployId);

    // Publish and rollback only move the production pointer.
    check('client publish is off by default', (await call(`/portal/projects/${project.id}/site/publish`, { method: 'POST', auth: a.session, body: {} })).status === 403);
    check('a bad sites domain is refused', (await call('/admin/settings', { method: 'PATCH', auth: admin, body: { sitesDomain: 'not a domain' } })).status !== 200);
    const pub = await call(`/admin/projects/${project.id}/site/publish`, { method: 'POST', auth: admin, body: {} });
    check('Ali publishes', pub.status === 200 && pub.data.productionUrl === 'https://rosa-florist.malipetek.online');
    const deploys = (await call(`/admin/projects/${project.id}/site/deploys`, { auth: admin })).data.deploys;
    check('the deploy is in the history', deploys?.some((d) => d.id === made.data.deployId));
    const back = await call(`/admin/projects/${project.id}/site/rollback`, { method: 'POST', auth: admin, body: { deployId: 'placeholder' } });
    check('rollback to an unknown deploy is refused', back.status === 400);
    const rb = await call(`/admin/projects/${project.id}/site/rollback`, { method: 'POST', auth: admin, body: { deployId: made.data.deployId } });
    check('rollback repoints production', rb.status === 200);

    // Rebuild: Ali asks, exactly one node holding the project gets it, the result shows.
    check('a client cannot ask for a rebuild', (await call(`/admin/projects/${project.id}/site/rebuild`, { method: 'POST', auth: a.session })).status === 403);
    check('Ali asks for a rebuild', (await call(`/admin/projects/${project.id}/site/rebuild`, { method: 'POST', auth: admin })).status === 200);
    check('the site says a rebuild is pending', Boolean((await call(`/portal/projects/${project.id}/site`, { auth: a.session })).data.site.rebuildRequestedAt));
    const rbNode = `e2e-rb-${Date.now() % 100000}`;
    const handed = (await node(rbNode, [project.slug])).data.rebuilds;
    check('a node holding it is handed the rebuild', handed?.length === 1 && handed[0].site === 'rosa-florist' && handed[0].slug === project.slug, JSON.stringify(handed));
    check('…once', (await node(`${rbNode}-2`, [project.slug])).data.rebuilds?.length === 0);
    await call('/node/sites/rosa-florist/rebuilt', { method: 'POST', auth: RUNNER_TOKEN, body: { ok: false, error: 'pnpm missing' } });
    check('a failed rebuild is shown', (await call(`/portal/projects/${project.id}/site`, { auth: a.session })).data.site.rebuildError === 'pnpm missing');
    await call('/node/sites/rosa-florist/rebuilt', { method: 'POST', auth: RUNNER_TOKEN, body: { ok: true } });
    check('a good one clears it', (await call(`/portal/projects/${project.id}/site`, { auth: a.session })).data.site.rebuildError === null);

    const existing = (await newProject(a.session, { kind: 'existing', name: 'Old Shop', brief: OLD_BRIEF, repoKind: 'none' })).data.project;
    check('an existing stack is not hosted', (await call(`/portal/projects/${existing.id}/site`, { method: 'POST', auth: a.session, body: {} })).data?.error === 'not_hosted');
  },

  async repos({ admin }) {
    const stamp = Date.now() % 1000000;
    const np = async (slug) => (await call('/node/projects', { auth: RUNNER_TOKEN })).data.projects.find((x) => x.slug === slug);
    const adminProject = async (id) => (await call('/admin/projects', { auth: admin })).data.projects.find((x) => x.id === id);
    const claimRepo = (slug, nodeId) => call(`/node/projects/${slug}/repo-claim`, { method: 'POST', auth: RUNNER_TOKEN, body: { nodeId } });

    // An admin-made project gets a repo by default.
    const slug = `repo-e2e-${stamp}`;
    const made = await call('/admin/projects', { method: 'POST', auth: admin, body: { name: 'Repo E2E', slug } });
    check('admin creates a project (default: create a repo)', made.status === 201, JSON.stringify(made.data));
    const p0 = await np(slug);
    check('nodes are asked to make a plain repo', p0?.needsRepo?.name === slug && p0.needsRepo.template === 'blank' && !p0.needsRepo.site, JSON.stringify(p0));
    check('the admin card says it is queued', (await adminProject(made.data.id)).repoStatus?.state === 'queued');
    check('a node claims the job', (await claimRepo(slug, 'node-a')).data.ok === true);
    check('a second node is refused while the lease holds', (await claimRepo(slug, 'node-b')).data.ok === false);
    check('the holder may claim again', (await claimRepo(slug, 'node-a')).data.ok === true);
    check('the admin card names the node creating it', (await adminProject(made.data.id)).repoStatus?.state === 'creating');
    await call(`/node/projects/${slug}/repo-failed`, { method: 'POST', auth: RUNNER_TOKEN, body: { nodeId: 'node-a', error: 'name taken' } });
    check('a reported failure stops the offer', !(await np(slug)).needsRepo);
    const failed = await adminProject(made.data.id);
    check('…and the admin card says why', failed.repoStatus?.state === 'failed' && /name taken/.test(failed.repoStatus.detail));
    check('retry from the admin view offers it again', (await call(`/admin/projects/${made.data.id}/repo/create`, { method: 'POST', auth: admin })).status === 200 && (await np(slug)).needsRepo?.name === slug);
    await call(`/node/projects/${slug}/repo`, { method: 'POST', auth: RUNNER_TOKEN, body: { repo: `https://github.com/malipetek/${slug}` } });
    const done = await np(slug);
    check('a reported repo ends it', done.repo === `https://github.com/malipetek/${slug}` && !done.needsRepo);
    check('create on a project with a repo is refused', (await call(`/admin/projects/${made.data.id}/repo/create`, { method: 'POST', auth: admin })).status === 409);

    // "Folder on a node" waits for a node to share its folder's origin.
    const folder = await call('/admin/projects', { method: 'POST', auth: admin, body: { name: 'Folder E2E', slug: `folder-e2e-${stamp}`, code: 'folder' } });
    check('a folder project is not offered for creation', !(await np(`folder-e2e-${stamp}`)).needsRepo);
    check('its card says nothing is being made', (await adminProject(folder.data.id)).repoStatus?.state === 'missing');
    check('a bad repo URL is refused', (await call(`/admin/projects/${folder.data.id}/repo`, { method: 'PUT', auth: admin, body: { repo: 'file:///etc' } })).status === 400);
    const named = await call(`/admin/projects/${folder.data.id}/repo`, { method: 'PUT', auth: admin, body: { repo: 'https://github.com/acme/folder-e2e' } });
    check('Ali names a repo', named.status === 200 && (await np(`folder-e2e-${stamp}`)).repo === 'https://github.com/acme/folder-e2e');
    check('a repo URL at creation is used', (await call('/admin/projects', { method: 'POST', auth: admin, body: { name: 'Url E2E', slug: `url-e2e-${stamp}`, code: 'repo', repo: 'https://github.com/acme/url-e2e' } })).status === 201 && (await np(`url-e2e-${stamp}`)).repo === 'https://github.com/acme/url-e2e');

    // A client's onboarding: a "new" project's repo comes from the site template.
    const a = account(`repos-${stamp}@example.com`);
    const fresh = (await newProject(a.session, { kind: 'new', name: `Fresh Cafe ${stamp}`, brief: NEW_BRIEF })).data.project;
    const pf = await np(fresh.slug);
    check('a client\'s new project gets a site-template repo', pf?.needsRepo?.template === 'site' && pf.needsRepo.about === NEW_BRIEF.what, JSON.stringify(pf));
    const zip = (await newProject(a.session, { kind: 'existing', name: `Zip Shop ${stamp}`, brief: OLD_BRIEF, repoKind: 'zip' })).data.project;
    check('a project waiting on a zip is not', !(await np(zip.slug)).needsRepo);

    // Ali can host any project.
    const host = await call(`/admin/projects/${folder.data.id}/site`, { method: 'POST', auth: admin });
    check('admin starts hosting on a project', host.status === 201 && ['allocating', 'ready'].includes(host.data.site?.state), JSON.stringify(host.data));
    check('a client cannot use the admin hosting route', (await call(`/admin/projects/${folder.data.id}/site`, { method: 'POST', auth: a.session })).status === 403);

    // Deleting: refused while a request is open; closed requests survive, unlinked.
    const del = (await newProject(a.session, { kind: 'new', name: `Dup Bakery ${stamp}`, brief: NEW_BRIEF })).data;
    await call(`/admin/projects/${del.project.id}/site`, { method: 'POST', auth: admin });
    check('a client cannot delete a project', (await call(`/admin/projects/${del.project.id}`, { method: 'DELETE', auth: a.session })).status === 403);
    const refused = await call(`/admin/projects/${del.project.id}`, { method: 'DELETE', auth: admin });
    check('delete is refused while a request is open', refused.status === 409 && refused.data.error === 'open_tickets' && refused.data.count === 1, JSON.stringify(refused.data));
    await call(`/admin/tickets/${del.ticketId}`, { method: 'PATCH', auth: admin, body: { status: 'declined' } });
    check('…and allowed once it is closed', (await call(`/admin/projects/${del.project.id}`, { method: 'DELETE', auth: admin })).status === 200);
    check('the project is gone', !(await adminProject(del.project.id)) && !(await np(del.project.slug)));
    check('its site is gone', (await call(`/admin/projects/${del.project.id}/site/deploys`, { auth: admin })).status !== 200 || (await call(`/admin/projects/${del.project.id}/site/deploys`, { auth: admin })).data.deploys?.length === 0);
    const kept = await call(`/portal/tickets/${del.ticketId}`, { auth: a.session });
    check('the closed request and its thread stay with the client', kept.status === 200 && kept.data.ticket.project_id === null && kept.data.messages?.length > 0, JSON.stringify(kept.data?.ticket));
    check('the client no longer has the project', !(await call('/portal/me', { auth: a.session })).data.projects.some((x) => x.id === del.project.id));

    // The heartbeat carries a fingerprint so nodes re-read the list at once.
    const beat = await node(`e2e-r-${stamp}`, []);
    check('the heartbeat carries the project fingerprint', /^\d+:\d+:\d+:\d+$/.test(beat.data?.projects ?? ''), JSON.stringify(beat.data));
  },

  async cloudflare() {
    const a = account(`cf-${Date.now()}@example.com`);
    const other = account(`cf-other-${Date.now()}@example.com`);
    const first = await call('/portal/cloudflare', { auth: a.session });
    const link = new URL(first.data.connectUrl ?? 'http://x/');
    check('a client starts with no connection and a connect link', first.status === 200 && first.data.connections.length === 0 && link.pathname === '/oauth2/auth', JSON.stringify(first.data));
    check('the link asks for exactly our scopes', link.searchParams.get('scope') === 'account-settings.read memberships.read user-details.read workers-scripts.edit workers-routes.write zone.read dns.write');
    check('…returns to the Worker callback', /\/portal\/cloudflare\/callback$/.test(link.searchParams.get('redirect_uri') ?? ''));
    const state = link.searchParams.get('state') ?? '';
    check('…with a long signed state', state.length > 40);
    const back = async (query) => (await fetch(`${W}/portal/cloudflare/callback?${query}`, { redirect: 'manual' })).headers.get('location') ?? '';
    check('a forged state is refused', /cloudflare=signin/.test(await back('code=good-code&state=bogus.state')));
    check('declining on Cloudflare says so', /cloudflare=declined/.test(await back(`error=access_denied&state=${encodeURIComponent(state)}`)));
    check('a bad code fails cleanly', /cloudflare=failed/.test(await back(`code=bad-code&state=${encodeURIComponent(state)}`)));
    const ok = await back(`code=good-code&state=${encodeURIComponent(state)}`);
    check('a good code connects and lands on Connections', /cloudflare=connected#\/connections$/.test(ok), ok);
    const listed = (await call('/portal/cloudflare', { auth: a.session })).data.connections;
    check('the grant lists the account Cloudflare shared', listed.length === 1 && listed[0].accounts[0]?.name === 'Rosa Florist LLC' && listed[0].lapsed === false, JSON.stringify(listed));
    check('tokens are not stored in the clear', !/cf-access-secret|cf-refresh-secret/.test(sql('SELECT access_enc, refresh_enc FROM cloudflare_connections').toString()));
    check('another client does not see it', (await call('/portal/cloudflare', { auth: other.session })).data.connections.length === 0);
    check('…nor can disconnect it', (await call(`/portal/cloudflare/${listed[0].id}`, { method: 'DELETE', auth: other.session })).status === 404);
    const key = (await call('/portal/agent-tokens', { method: 'POST', auth: a.session, body: { label: 'cf test' } })).data.token;
    check('an assistant key cannot manage Cloudflare', (await call('/portal/cloudflare', { auth: key })).status === 401);
    check('the client disconnects', (await call(`/portal/cloudflare/${listed[0].id}`, { method: 'DELETE', auth: a.session })).status === 200);
    check('…which revokes at Cloudflare', CF.revoked.includes('cf-refresh-secret'));
    check('…and it is gone', (await call('/portal/cloudflare', { auth: a.session })).data.connections.length === 0);
  },

  async github({ admin }) {
    const a = account(`gh-${Date.now()}@example.com`);
    check('the connection starts empty, with a signed install link', (await call('/portal/github', { auth: a.session })).data.installations?.length === 0 && /github\.com\/apps\/malipetek-dev\/installations\/new\?state=/.test((await call('/portal/github', { auth: a.session })).data.installUrl ?? ''));
    const cors = await fetch(`${W}/portal/github`, { headers: { authorization: `Bearer ${a.session}`, origin: 'http://localhost:4321' } });
    check('a browser can read the connection (CORS header on the real response)', cors.status === 200 && cors.headers.get('access-control-allow-origin') === 'http://localhost:4321', String(cors.headers.get('access-control-allow-origin')));
    check('the webhook needs a signature', (await call('/hooks/github', { method: 'POST', body: {} })).status === 401);
    const body = JSON.stringify({ action: 'created', installation: { id: 42424242, account: { login: 'clientacct', type: 'User' }, repository_selection: 'selected' } });
    const sig = 'sha256=' + createHmac('sha256', 'test-webhook-secret').update(body).digest('hex');
    const hook = await fetch(`${W}/hooks/github`, { method: 'POST', headers: { 'x-github-event': 'installation', 'x-hub-signature-256': sig, 'content-type': 'application/json' }, body });
    check('a signed installation.created registers (unclaimed)', hook.status === 200);
    check('a wrong signature is refused', (await fetch(`${W}/hooks/github`, { method: 'POST', headers: { 'x-github-event': 'installation', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64), 'content-type': 'application/json' }, body })).status === 401);
    check('git-token needs a github-connected project', (await call('/node/git-token', { method: 'POST', auth: RUNNER_TOKEN, body: { slug: 'nope' } })).status === 404);
    check('…and the runner token', (await call('/node/git-token', { method: 'POST', auth: 'wrong', body: { slug: 'nope' } })).status === 401);
    check('the callback refuses a bad state', (await fetch(`${W}/auth/github/callback?code=x&installation_id=1&state=bogus`, { redirect: 'manual' })).headers.get('location')?.includes('github=signin'));
    const { installUrl } = (await call('/portal/github', { auth: a.session })).data;
    const state = new URL(installUrl).searchParams.get('state');
    const good = await fetch(`${W}/auth/github/callback?installation_id=1&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    check('a signed state is accepted (fails later on the missing code, not on sign-in)', good.headers.get('location')?.includes('github=bad'), good.headers.get('location'));
  },

  async queue({ admin }) {
    const a = account(`queue-${Date.now()}@example.com`);
    const { project, ticketId } = (await newProject(a.session, { kind: 'existing', name: 'Queue Shop', brief: OLD_BRIEF, repoKind: 'none' })).data;
    const nodeId = `e2e-q-${Date.now() % 100000}`;
    await node(nodeId, [project.slug]);
    check('nothing is claimable before approval', (await claim(nodeId)).ticket === null);
    check('a client cannot approve', (await call(`/admin/tickets/${ticketId}`, { method: 'PATCH', auth: a.session, body: { status: 'approved' } })).status === 403);
    await approve(admin, ticketId);
    const c = await claim(nodeId);
    check('the node claims it after approval, sandboxed', c.ticket?.id === ticketId && c.executor === 'claude' && c.site === null);
    check('a second node cannot report on it', (await call(`/node/runs/${c.runId}/result`, { method: 'POST', auth: RUNNER_TOKEN, body: { nodeId: 'someone-else', ok: true, summary: 'x' } })).status === 409);
    const rep = await call(`/node/runs/${c.runId}/result`, { method: 'POST', auth: RUNNER_TOKEN, body: { nodeId, ok: true, summary: 'Did it.', costUsd: 0.25 } });
    check('the claiming node reports; the ticket goes to review', rep.status === 200 && (await call(`/portal/tickets/${ticketId}`, { auth: a.session })).data.ticket.status === 'review');
    check('a second report on the same run is refused', (await call(`/node/runs/${c.runId}/result`, { method: 'POST', auth: RUNNER_TOKEN, body: { nodeId, ok: true, summary: 'again', costUsd: 0.25 } })).status === 409);
    const t = (await call(`/admin/tickets/${ticketId}`, { auth: admin })).data.ticket;
    check('the run was billed once', t.ai_micro_usd === 250000, String(t.ai_micro_usd));
    check('wrong runner token is refused', (await call('/node/claim', { method: 'POST', auth: 'nope', body: { nodeId } })).status === 401);

    // A node with a folder fills a blank repo so other nodes can clone; it never overwrites one.
    const share = (repo) => call(`/node/projects/${project.slug}/repo`, { method: 'POST', auth: RUNNER_TOKEN, body: { repo } });
    const repoOf = async () => (await call('/node/projects', { auth: RUNNER_TOKEN })).data.projects.find((x) => x.id === project.id)?.repo;
    check('a repo with credentials in it is refused', (await share('https://user:secret@github.com/acme/queue-shop.git')).status === 400 && (await repoOf()) === undefined);
    check('a node fills a blank repo', (await share('git@github.com:acme/queue-shop.git')).data?.updated === true && (await repoOf()) === 'git@github.com:acme/queue-shop.git');
    check('…but never overwrites one', (await share('https://github.com/evil/other.git')).data?.updated === false && (await repoOf()) === 'git@github.com:acme/queue-shop.git');

    // A node restart hands the run back: straight to the queue, and no attempt spent.
    await approve(admin, ticketId);
    const r1 = await claim(nodeId);
    const release = (runId, who) => call(`/node/runs/${runId}/release`, { method: 'POST', auth: RUNNER_TOKEN, body: { nodeId: who } });
    check('another node cannot hand back a run', (await release(r1.runId, 'someone-else')).status === 409);
    check('the holding node hands it back', (await release(r1.runId, nodeId)).status === 200);
    check('…and the item is back in the queue at once', (await call(`/admin/tickets/${ticketId}`, { auth: admin })).data.ticket.status === 'approved');
    const r2 = await claim(nodeId);
    check('…without spending an attempt', r2.ticket?.id === ticketId && r2.attempt === r1.attempt, `${r1.attempt} → ${r2.attempt}`);

    // Ali requeues while the run still works: the run is stopped, and when it
    // reports late it is recorded and billed but cannot pull the ticket away
    // from the run that took it next.
    const report = (runId, who, extra) =>
      call(`/node/runs/${runId}/result`, { method: 'POST', auth: RUNNER_TOKEN, body: { nodeId: who, ok: true, summary: 'late', ...extra } });
    const ticketNow = async () => (await call(`/admin/tickets/${ticketId}`, { auth: admin })).data;
    await approve(admin, ticketId);
    const hb = (await node(nodeId, [project.slug], { running: [r2.runId] })).data;
    check('changing the status stops the live run', hb.cancel?.includes(r2.runId), JSON.stringify(hb));
    check('…and says so in a private note', /Stopped run \d+ on e2e-q-/.test(JSON.stringify((await ticketNow()).messages)));
    const other = `${nodeId}-b`;
    await node(other, [project.slug]);
    const r3 = await claim(other);
    check('another node takes the requeued item', r3.ticket?.id === ticketId);
    const aiBefore = (await ticketNow()).ticket.ai_micro_usd;
    const lateRep = await report(r2.runId, nodeId, { costUsd: 0.1 });
    let now = await ticketNow();
    check('the stopped run’s late report is accepted', lateRep.status === 200, JSON.stringify(lateRep.data));
    check('…its cost counts', now.ticket.ai_micro_usd === aiBefore + 100000, `${aiBefore} → ${now.ticket.ai_micro_usd}`);
    check('…but the ticket stays with the newer run', now.ticket.status === 'in_progress');
    check('…and the run is closed', now.runs.find((r) => r.id === r2.runId)?.status === 'ok');
    await report(r3.runId, other, { summary: 'real' });
    check('the newer run still moves it to review', (await ticketNow()).ticket.status === 'review');

    // Marked done while a run worked: the bill is closed, so the late cost is noted, not added.
    await approve(admin, ticketId);
    const r4 = await claim(other);
    await call(`/admin/tickets/${ticketId}`, { method: 'PATCH', auth: admin, body: { status: 'done' } });
    const frozen = (await ticketNow()).ticket;
    await report(r4.runId, other, { costUsd: 0.3 });
    now = await ticketNow();
    check('a late report on a done ticket leaves it done', now.ticket.status === 'done');
    check('…and does not touch the closed bill', now.ticket.ai_micro_usd === frozen.ai_micro_usd && now.ticket.price_cents === frozen.price_cents);
    check('…and says why', /the bill is closed/.test(JSON.stringify(now.messages)));

    // The client writes on a done ticket: Ali owes an answer until he gives one.
    const waiting = async () => (await call('/admin/tickets', { auth: admin })).data.tickets.find((x) => x.id === ticketId).client_waiting_since;
    check('nobody is waiting after filing and a status change', (await waiting()) === null);
    await call(`/portal/tickets/${ticketId}/messages`, { method: 'POST', auth: a.session, body: { body: 'One more thing?' } });
    const since = await waiting();
    check('a client message marks the ticket as waiting on Ali', Number.isInteger(since));
    await call(`/portal/tickets/${ticketId}/messages`, { method: 'POST', auth: a.session, body: { body: 'Hello?' } });
    check('…from the first unanswered message', (await waiting()) === since);
    await call(`/admin/tickets/${ticketId}/messages`, { method: 'POST', auth: admin, body: { body: 'note to self', internal: true } });
    check('a private note does not answer it', (await waiting()) === since);
    await call(`/admin/tickets/${ticketId}/messages`, { method: 'POST', auth: admin, body: { body: 'On it.' } });
    check('a reply does', (await waiting()) === null);
    await call(`/portal/tickets/${ticketId}/messages`, { method: 'POST', auth: a.session, body: { body: 'Thanks!' } });
    check('"no reply needed" clears it', (await call(`/admin/tickets/${ticketId}/answered`, { method: 'POST', auth: admin })).status === 200 && (await waiting()) === null);
    check('a client cannot clear it', (await call(`/admin/tickets/${ticketId}/answered`, { method: 'POST', auth: a.session })).status === 403);
  },

  async files({ admin }) {
    const a = account(`files-${Date.now()}@example.com`);
    const { project } = (await newProject(a.session, { kind: 'existing', name: 'Files Shop', brief: OLD_BRIEF, repoKind: 'none' })).data;
    const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
    const send = async (path, auth, fields, files = []) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
      for (const [name, bytes] of files) form.append('files', new Blob([bytes]), name);
      const res = await fetch(W + path, { method: 'POST', headers: { authorization: `Bearer ${auth}` }, body: form });
      return { status: res.status, data: await res.json().catch(() => null) };
    };
    const get = (path, auth) => fetch(W + path, { headers: { authorization: `Bearer ${auth}` } });

    const filed = await send('/portal/tickets', a.session, { title: 'Broken header', body: 'See the screenshot.', projectId: project.id, budgetCents: '500' }, [['shot.png', PNG]]);
    check('a client files a request with a screenshot', filed.status === 201 && filed.data.files?.[0]?.name === 'shot.png', JSON.stringify(filed.data));
    const id = filed.data.id;
    const thread = (await call(`/portal/tickets/${id}`, { auth: a.session })).data;
    const file = thread.messages[0].files?.[0];
    check('…the form’s budget is read as a number', thread.ticket.budget_cents === 500);
    check('…and the file is on the first message', file?.id && file.size === PNG.length && file.type === 'image/png');
    const dl = await get(`/portal/tickets/${id}/files/${file.id}`, a.session);
    const bytes = new Uint8Array(await dl.arrayBuffer());
    check('the client downloads it, byte for byte', dl.status === 200 && bytes.length === PNG.length && bytes.every((b, i) => b === PNG[i]));
    check('…as an attachment that cannot be sniffed into something else', /^attachment/.test(dl.headers.get('content-disposition') ?? '') && dl.headers.get('x-content-type-options') === 'nosniff');
    const other = account(`files-other-${Date.now()}@example.com`);
    check('another client cannot download it', (await get(`/portal/tickets/${id}/files/${file.id}`, other.session)).status === 404);

    check('an SVG is refused', (await send(`/portal/tickets/${id}/messages`, a.session, { body: 'x' }, [['logo.svg', '<svg onload="alert(1)"/>']])).data?.error === 'file_type');
    check('a file over 10 MB is refused', (await send(`/portal/tickets/${id}/messages`, a.session, { body: 'x' }, [['big.pdf', new Uint8Array(10 * 1024 * 1024 + 1)]])).status === 413);
    check('six files at once are refused', (await send(`/portal/tickets/${id}/messages`, a.session, { body: 'x' }, Array.from({ length: 6 }, (_, i) => [`f${i}.txt`, 'hi']))).data?.error === 'too_many_files');
    const onlyFile = await send(`/portal/tickets/${id}/messages`, a.session, {}, [['notes.txt', 'the footer too']]);
    check('a file alone is a message', onlyFile.status === 201);
    check('JSON replies still work', (await call(`/portal/tickets/${id}/messages`, { method: 'POST', auth: a.session, body: { body: 'plain' } })).status === 201);

    const unread = async () => (await call('/portal/tickets', { auth: a.session })).data.tickets.find((x) => x.id === id).unread;
    await call(`/portal/tickets/${id}`, { auth: a.session });
    check('an opened request is not marked new', (await unread()) === 0);
    await sleep(1100);
    await call(`/admin/tickets/${id}/messages`, { method: 'POST', auth: admin, body: { body: 'private', internal: true } });
    check('a private note does not mark it new', (await unread()) === 0);
    await call(`/admin/tickets/${id}/messages`, { method: 'POST', auth: admin, body: { body: 'Looking now.' } });
    check('Ali’s reply marks it new in the client’s list', (await unread()) === 1);
    await call(`/portal/tickets/${id}`, { auth: a.session });
    await sleep(300);
    check('…until the client opens it', (await unread()) === 0);

    const note = await send(`/admin/tickets/${id}/messages`, admin, { body: 'for the agent', internal: 'true' }, [['spec.md', '# Do this']]);
    const noteFile = note.data.files?.[0];
    check('Ali attaches a file to a private note', note.status === 201 && noteFile?.name === 'spec.md');
    check('…which the client never sees in the thread', !JSON.stringify((await call(`/portal/tickets/${id}`, { auth: a.session })).data).includes('spec.md'));
    check('…nor can download', (await get(`/portal/tickets/${id}/files/${noteFile.id}`, a.session)).status === 404);
    check('…but Ali can', (await get(`/admin/tickets/${id}/files/${noteFile.id}`, admin)).status === 200);

    const chatty = account(`files-chatty-${Date.now()}@example.com`);
    const cid = (await call('/portal/tickets', { method: 'POST', auth: chatty.session, body: { title: 'Many', body: 'x' } })).data.id;
    let last = null;
    for (let i = 0; i < 61; i += 1) last = await call(`/portal/tickets/${cid}/messages`, { method: 'POST', auth: chatty.session, body: { body: `m${i}` } });
    check('the 61st message in an hour is refused', last.status === 429);

    const search = async (q, auth = admin) => (await call(`/admin/search?q=${encodeURIComponent(q)}`, { auth })).data;
    check('Ali finds a ticket by its thread', (await search('see the SCREENSHOT')).hits?.some((h) => h.id === id && /See the screenshot/.test(h.snippet)));
    check('…private notes included', (await search('for the agent')).hits?.some((h) => h.id === id));
    check('a % is a character, not a wildcard', (await search('%%%')).hits?.length === 0);
    check('a client cannot search', (await call('/admin/search?q=screenshot', { auth: a.session })).status === 403);

    const nodeId = `e2e-f-${Date.now() % 100000}`;
    await node(nodeId, [project.slug]);
    await approve(admin, id);
    const c = await claim(nodeId);
    const briefFiles = c.messages.flatMap((m) => m.files ?? []).map((f) => f.name);
    check('the claim lists every file, private ones included', ['shot.png', 'notes.txt', 'spec.md'].every((n) => briefFiles.includes(n)), briefFiles.join());
    const nodeGet = (who) => fetch(`${W}/node/tickets/${id}/files/${file.id}?nodeId=${who}`, { headers: { authorization: `Bearer ${RUNNER_TOKEN}` } });
    check('the node holding the run downloads them', (await nodeGet(nodeId)).status === 200);
    check('another node cannot', (await nodeGet('someone-else')).status === 403);
    await call(`/node/runs/${c.runId}/result`, { method: 'POST', auth: RUNNER_TOKEN, body: { nodeId, ok: true, summary: 'x' } });
    check('…and nor can the same node once the run is over', (await nodeGet(nodeId)).status === 403);
  },

  async preview({ admin }) {
    const a = account(`prev-${Date.now()}@example.com`);
    const { project, ticketId } = (await newProject(a.session, { kind: 'new', name: 'Preview Cafe', brief: NEW_BRIEF })).data;
    await call(`/portal/projects/${project.id}/site`, { method: 'POST', auth: a.session, body: {} });
    await call('/node/sites/preview-cafe/repo', { method: 'POST', auth: RUNNER_TOKEN, body: { repo: 'https://github.com/malipetek/preview-cafe' } });
    const nodeId = `e2e-p-${Date.now() % 100000}`;
    await node(nodeId, [project.slug]);
    await approve(admin, ticketId);
    const c = await claim(nodeId);
    check('a claim on a hosted site names the site', c.site === 'preview-cafe', JSON.stringify(c).slice(0, 200));
    // The node builds and deploys; finish must come from the node holding the run.
    const sha = (s) => createHash('sha256').update(s).digest('hex');
    const file = { path: 'index.html', sha256: sha('<h1>Order</h1>'), size: 14, type: 'text/html' };
    const made = await call('/node/sites/preview-cafe/deploys', { method: 'POST', auth: RUNNER_TOKEN, body: { files: [file] } });
    await fetch(`${W}/node/sites/preview-cafe/deploys/${made.data.deployId}/files/${file.sha256}`, { method: 'PUT', headers: { authorization: `Bearer ${RUNNER_TOKEN}`, 'content-length': String(file.size) }, body: new TextEncoder().encode('<h1>Order</h1>') });
    check('finish from a node not holding the run is refused', (await call(`/node/sites/preview-cafe/deploys/${made.data.deployId}/finish`, { method: 'POST', auth: RUNNER_TOKEN, body: { ticketId, nodeId: 'someone-else' } })).status === 403);
    const fin = await call(`/node/sites/preview-cafe/deploys/${made.data.deployId}/finish`, { method: 'POST', auth: RUNNER_TOKEN, body: { ticketId, nodeId } });
    check('finish from the holding node deploys the preview', fin.status === 200 && fin.data.previewUrl === 'https://preview-cafe--preview.malipetek.online', JSON.stringify(fin.data));
    check('the client is told where to look', /The preview has this change: https:\/\/preview-cafe--preview\.malipetek\.online/.test(JSON.stringify((await call(`/portal/tickets/${ticketId}`, { auth: a.session })).data)));
    check('a missing blob stops the finish', (await call(`/node/sites/preview-cafe/deploys/${(await call('/node/sites/preview-cafe/deploys', { method: 'POST', auth: RUNNER_TOKEN, body: { files: [{ path: 'x.html', sha256: sha('x'), size: 1 }] } })).data.deployId}/finish`, { method: 'POST', auth: RUNNER_TOKEN, body: {} })).status === 409);
    await call(`/node/runs/${c.runId}/result`, { method: 'POST', auth: RUNNER_TOKEN, body: { nodeId, ok: true, summary: 'Done.' } });

    // The client's own agent: send a change, ask for a build, a node reports it.
    check('the client’s agent reads the context', (await call(`/portal/tickets/${ticketId}/context`, { auth: a.session })).data.ticket.id === ticketId);
    check('a traversal path in a change is refused', (await call(`/portal/tickets/${ticketId}/change`, { method: 'POST', auth: a.session, body: { files: [{ path: '../x', content: 'y' }] } })).status === 400);
    check('a build with no change is refused', (await call(`/portal/tickets/${ticketId}/build`, { method: 'POST', auth: a.session, body: {} })).status === 409);
    const change = await call(`/portal/tickets/${ticketId}/change`, { method: 'POST', auth: a.session, body: { files: [{ path: 'src/pages/index.astro', content: '<h1>New</h1>' }] } });
    check('the agent’s change is stored', change.status === 200 && change.data.files === 1, JSON.stringify(change.data));
    const ticketRow = (await call(`/portal/tickets/${ticketId}`, { auth: a.session })).data;
    check('the request now says a client agent did it', ticketRow.ticket.worked_by === 'client_agent');
    const queued = await call(`/portal/tickets/${ticketId}/build`, { method: 'POST', auth: a.session, body: {} });
    check('a build of the pending change queues', queued.status === 200 && queued.data.state === 'queued');
    const build = await call(`/node/builds/${ticketId}`, { auth: RUNNER_TOKEN });
    check('a node reads the pending build', build.status === 200 && build.data.files?.[0]?.path === 'src/pages/index.astro' && build.data.site === 'preview-cafe', JSON.stringify(build.data));
    check('…and the heartbeat hands it to the node', (await node(nodeId, ['preview-cafe'])).data.builds?.some((b) => b.ticketId === ticketId));
    const failed = await call(`/node/builds/${ticketId}/result`, { method: 'POST', auth: RUNNER_TOKEN, body: { nodeId, ok: false, error: 'build broke' } });
    check('a failed build is recorded and clears the flag', failed.status === 200 && (await call(`/node/builds/${ticketId}`, { auth: RUNNER_TOKEN })).status === 404);
  },

  async budget({ admin }) {
    const a = account(`budget-${Date.now()}@example.com`);
    const { project, ticketId } = (await newProject(a.session, { kind: 'existing', name: 'Budget Shop', brief: OLD_BRIEF, repoKind: 'none', budgetCents: 100 })).data;
    const nodeId = `e2e-b-${Date.now() % 100000}`;
    await node(nodeId, [project.slug]);
    sql(`UPDATE tickets SET ai_micro_usd = 990000 WHERE id = ${ticketId}`);
    await approve(admin, ticketId);
    const c = await claim(nodeId);
    check('a run is capped at what is left of the budget', c.ticket?.id === ticketId && c.maxBudgetUsd === 0.01, String(c.maxBudgetUsd));
    await call(`/node/runs/${c.runId}/result`, { method: 'POST', auth: RUNNER_TOKEN, body: { nodeId, ok: true, summary: 'x', costUsd: 0.2 } });
    await approve(admin, ticketId);
    const q = (await call('/admin/queue', { auth: admin })).data;
    const item = (Array.isArray(q) ? q : q.queue ?? q.items ?? []).find((i) => i.id === ticketId);
    check('a spent budget holds the item, and says why', item?.eligible.length === 0 && /Budget spent \(\$1\.19 of \$1\.00\)/.test(item.reason), item?.reason);
    check('…and no node can claim it', (await claim(nodeId)).ticket === null);
    const raise = await call(`/portal/tickets/${ticketId}/budget`, { method: 'PATCH', auth: a.session, body: { budgetCents: 500 } });
    check('the client raises their budget', raise.status === 200);
    const c2 = await claim(nodeId);
    check('…and the work can go on, capped at the rest', c2.ticket?.id === ticketId && Math.abs(c2.maxBudgetUsd - 3.81) < 1e-9, String(c2.maxBudgetUsd));
    check('the change is in the thread', /The client set the budget to \$5\.00\./.test(JSON.stringify((await call(`/portal/tickets/${ticketId}`, { auth: a.session })).data)));
    const other = account(`budget-other-${Date.now()}@example.com`);
    check('another client cannot change it', (await call(`/portal/tickets/${ticketId}/budget`, { method: 'PATCH', auth: other.session, body: { budgetCents: 99900 } })).status === 404);
    check('a bad budget is refused', (await call(`/portal/tickets/${ticketId}/budget`, { method: 'PATCH', auth: a.session, body: { budgetCents: -5 } })).status === 400);
  },

  async usage({ admin }) {
    const a = account(`usage-${Date.now()}@example.com`);
    const mk = async (title) => (await call('/portal/tickets', { method: 'POST', auth: a.session, body: { title, body: 'x' } })).data.id;
    const [done, open, declined] = [await mk('Done'), await mk('Open'), await mk('Declined')];
    sql(`UPDATE tickets SET human_seconds = 2160, ai_micro_usd = 420000 WHERE id = ${done}`);
    await call(`/admin/tickets/${done}`, { method: 'PATCH', auth: admin, body: { status: 'done' } });
    sql(`UPDATE tickets SET human_seconds = 180, ai_micro_usd = 15000 WHERE id = ${open}`);
    sql(`UPDATE tickets SET human_seconds = 600, ai_micro_usd = 99000 WHERE id = ${declined}`);
    await call(`/admin/tickets/${declined}`, { method: 'PATCH', auth: admin, body: { status: 'declined' } });
    sql(`UPDATE tickets SET human_seconds = 9999 WHERE id = ${done}`); // after Done: must not change the bill
    const u = (await call('/portal/me', { auth: a.session })).data.usage;
    check('billed = the frozen price of Done work', u.billedCents === 6042, JSON.stringify(u));
    check('open = the live meter on the rest', u.openCents === 502);
    check('declined work owes nothing', u.tickets === 2 && u.aiCents === 44);
    const row = (await call('/admin/clients', { auth: admin })).data.clients.find((x) => x.id === a.user.id);
    check('Ali sees the same per client', row?.usage.billedCents === 6042 && row.usage.openCents === 502);
    check('a client cannot read everyone’s', (await call('/admin/clients', { auth: a.session })).status === 403);
  },

  async agents({ admin }) {
    const a = account(`agent-${Date.now()}@example.com`);
    const other = account(`agent-other-${Date.now()}@example.com`);
    const { project } = (await newProject(a.session, { kind: 'existing', name: 'Agent Shop', brief: OLD_BRIEF, repoKind: 'none' })).data;
    const theirs = (await call('/portal/tickets', { method: 'POST', auth: other.session, body: { title: 'Private', body: 'x' } })).data.id;

    const made = await call('/portal/agent-tokens', { method: 'POST', auth: a.session, body: { label: 'Claude on my laptop' } });
    const token = made.data?.token;
    check('a client makes an agent key, shown once', made.status === 201 && /^cat_/.test(token ?? '') && /\/mcp$/.test(made.data.mcpUrl));
    const listed = (await call('/portal/agent-tokens', { auth: a.session })).data.tokens;
    check('the list never shows the key itself', listed.length === 1 && !JSON.stringify(listed).includes(token));
    check('an agent key cannot make more keys', (await call('/portal/agent-tokens', { method: 'POST', auth: token, body: { label: 'x' } })).status === 403);
    check('an agent key never reaches /admin', (await call('/admin/tickets', { auth: token })).status === 403);
    check('Ali cannot make one (it is a client credential)', (await call('/portal/agent-tokens', { method: 'POST', auth: admin, body: { label: 'x' } })).data?.error === 'clients_only');

    let rpcId = 0;
    const rpc = async (method, params, auth) => {
      const res = await fetch(`${W}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
      });
      return res.json();
    };
    const tool = async (name, args, auth = token) => {
      const r = await rpc('tools/call', { name, arguments: args }, auth);
      const text = r.result?.content?.[0]?.text ?? '';
      let value = text;
      try { value = JSON.parse(text); } catch {}
      return { error: r.result?.isError === true, value, text };
    };
    const names = (await rpc('tools/list', {}, null)).result.tools.map((t) => t.name);
    check('anyone sees the knowledgebase and the client tools', names.includes('portal_file_request') && names.includes('search_knowledge'));
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } }, token);
    check('initialize explains the client tools', /portal_\* tools/.test(init.result?.instructions ?? ''));

    const filed = await tool('portal_file_request', { title: 'Add opening hours', body: 'Mon–Fri 9–5 on the contact page.', project_id: project.id, attention: 'auto', budget_usd: 20 });
    const rid = filed.value?.request_id;
    check('an assistant files a request', !filed.error && Number.isInteger(rid), filed.text);
    const read = await tool('portal_request', { request_id: rid });
    check('…which waits for Ali, with its budget and attention', !read.error && read.value.ticket.status === 'new' && read.value.ticket.budget_cents === 2000 && read.value.ticket.attention === 'auto', read.text.slice(0, 200));
    check('it lists the account’s requests', (await tool('portal_requests', {})).value.tickets?.some((t) => t.id === rid));
    check('it lists projects with their setup', (await tool('portal_projects', {})).value.projects?.some((p) => p.id === project.id && p.setup));
    check('it replies on a request', !(await tool('portal_reply', { request_id: rid, text: 'Saturdays too.' })).error && /Saturdays too/.test(JSON.stringify((await call(`/portal/tickets/${rid}`, { auth: a.session })).data)));
    check('it raises the budget', !(await tool('portal_set_budget', { request_id: rid, budget_usd: 50 })).error && (await tool('portal_request', { request_id: rid })).value.ticket.budget_cents === 5000);
    const second = (await tool('portal_file_request', { title: 'Never mind this', body: 'Changed my mind.', project_id: project.id })).value.request_id;
    const withdrawn = await tool('portal_withdraw', { request_id: second });
    check('it withdraws a request Ali has not approved', !withdrawn.error && (await tool('portal_request', { request_id: second })).value.ticket.status === 'declined', withdrawn.text);
    const again = await tool('portal_withdraw', { request_id: second });
    check('…once', again.error && /not_withdrawable/.test(again.text));
    await call(`/admin/tickets/${rid}`, { method: 'PATCH', auth: admin, body: { status: 'approved' } });
    const late = await tool('portal_withdraw', { request_id: rid });
    check('an approved request cannot be withdrawn, and it says what to do', late.error && /Ask him with portal_reply/.test(late.text), late.text);
    check('another client cannot withdraw it', (await call(`/portal/tickets/${rid}/withdraw`, { method: 'POST', auth: account(`w-${Date.now()}@example.com`).session })).status === 404);
    const peek = await tool('portal_request', { request_id: theirs });
    check('another client’s request is invisible to it', peek.error && /not_found/.test(peek.text));
    const bad = await tool('portal_file_request', { title: 'x', body: 'y', attention: 'yolo' });
    check('a bad argument comes back as an explained error', bad.error && /bad_ticket: .*auto, checked or hands_on/.test(bad.text), bad.text);
    const kb = await rpc('tools/call', { name: 'create_knowledge', arguments: { title: 't', problem: 'p', solution: 's', status: 'solved', author_agent: 'x' } });
    check('an agent key cannot write the knowledgebase', kb.error);
    check('no key → a pointer to the portal', /Connect an assistant/.test((await tool('portal_requests', {}, null)).text));

    await call(`/portal/agent-tokens/${listed[0].id}`, { method: 'DELETE', auth: a.session });
    const after = await tool('portal_requests', {});
    check('a revoked key stops working at once', after.error && /unauthorized/.test(after.text));
    check('another client cannot revoke your key', (await call(`/portal/agent-tokens/${listed[0].id}`, { method: 'DELETE', auth: other.session })).status === 404);
  },

  async oauth({ admin }) {
    const SITE = 'http://localhost:4321'; // SITE_URL in the injected vars
    const a = account(`oauth-${Date.now()}@example.com`);
    const agent = (await call('/portal/agent-tokens', { method: 'POST', auth: a.session, body: { label: 'Pasted key' } })).data.token;
    const pr = (await call('/.well-known/oauth-protected-resource/mcp')).data;
    check('discovery: the resource names its authorization server', pr?.resource === `${SITE}/mcp` && pr.authorization_servers?.[0] === SITE);
    const meta = (await call('/.well-known/oauth-authorization-server')).data;
    check('discovery: PKCE S256, public clients, dynamic registration', meta?.authorization_endpoint === `${SITE}/portal/authorize` && meta.code_challenge_methods_supported?.join() === 'S256' && meta.registration_endpoint === `${W}/oauth/register` && meta.token_endpoint === `${W}/oauth/token`);

    for (const bad of [['http://evil.example/cb'], ['javascript:alert(1)'], [], ['https://a.example/cb#frag']]) {
      check(`registration refuses ${JSON.stringify(bad)}`, (await call('/oauth/register', { method: 'POST', body: { client_name: 'X', redirect_uris: bad } })).status === 400);
    }
    const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
    const reg = await call('/oauth/register', { method: 'POST', body: { client_name: 'ChatGPT', redirect_uris: [REDIRECT, 'http://localhost:6274/cb'] } });
    const clientId = reg.data?.client_id;
    check('registration returns a public client', reg.status === 201 && /^mcp_/.test(clientId ?? '') && reg.data.token_endpoint_auth_method === 'none');
    check('the consent page learns who is asking', (await call(`/oauth/client?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}`)).data?.redirectHost === 'chatgpt.com');
    check('…but not for a redirect it never registered', (await call(`/oauth/client?client_id=${clientId}&redirect_uri=${encodeURIComponent('https://evil.example/cb')}`)).data?.error === 'bad_redirect');

    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const ask = { client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz' };
    const approve = (auth, body = ask) => call('/oauth/approve', { method: 'POST', auth, body });
    check('consent needs a signed-in person', (await approve(undefined)).status === 401);
    check('an agent key cannot consent for another agent', (await approve(agent)).status === 401);
    check('Ali’s session cannot (it is a client grant)', (await approve(admin)).data?.error === 'clients_only');
    check('no PKCE, no code', (await approve(a.session, { ...ask, code_challenge_method: 'plain' })).data?.error === 'pkce_required');
    check('an unregistered redirect, no code', (await approve(a.session, { ...ask, redirect_uri: 'https://evil.example/cb' })).data?.error === 'bad_redirect');
    const codeFor = async () => {
      const r = await approve(a.session);
      const url = new URL(r.data.redirect);
      return { url, code: url.searchParams.get('code') };
    };
    const first = await codeFor();
    check('consent sends the code back with state and issuer', first.url.origin + first.url.pathname === REDIRECT && first.url.searchParams.get('state') === 'xyz' && first.url.searchParams.get('iss') === SITE);

    const token = (form) =>
      fetch(`${W}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() }).then(async (r) => ({ status: r.status, data: await r.json() }));
    const grant = (code, extra = {}) => token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT, ...extra });
    check('a wrong verifier is refused', (await grant(first.code, { code_verifier: 'x'.repeat(43) })).data.error === 'invalid_grant');
    check('…and the code is dead after that attempt', (await grant(first.code)).data.error === 'invalid_grant');
    const second = await codeFor();
    check('a code for another redirect URI is refused', (await grant(second.code, { redirect_uri: 'http://localhost:6274/cb' })).data.error === 'invalid_grant');
    const third = await codeFor();
    const ok = await grant(third.code);
    const access = ok.data.access_token;
    check('the right verifier gets a bearer token', ok.status === 200 && /^cat_/.test(access ?? '') && ok.data.token_type === 'Bearer');
    check('a code works once', (await grant(third.code)).data.error === 'invalid_grant');
    const expired = await codeFor();
    sql(`UPDATE oauth_codes SET expires_at = 0 WHERE used_at IS NULL`);
    check('an expired code is refused', (await grant(expired.code)).data.error === 'invalid_grant');

    const mcpCall = async (auth) =>
      (await fetch(`${W}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${auth}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'portal_requests', arguments: {} } }) }).then((r) => r.json())).result;
    check('the OAuth token drives the portal tools', (await mcpCall(access)).isError !== true);
    const tokens = (await call('/portal/agent-tokens', { auth: a.session })).data.tokens;
    check('it shows in the portal as the app, revocable', tokens.some((t) => t.label === 'ChatGPT'));
    const again = await grant((await codeFor()).code);
    check('reconnecting the same app replaces its old token', again.status === 200 && (await mcpCall(access)).isError === true && (await mcpCall(again.data.access_token)).isError !== true);
    check('…without touching the pasted key', (await mcpCall(agent)).isError !== true);
    // Fill the account to five (the pasted key, ChatGPT, three more), then a different app asks.
    for (let i = 0; i < 3; i += 1) await call('/portal/agent-tokens', { method: 'POST', auth: a.session, body: { label: `k${i}` } });
    check('ChatGPT can still reconnect at five: it replaces its own', (await approve(a.session)).data?.redirect !== undefined);
    const other = (await call('/oauth/register', { method: 'POST', body: { client_name: 'Other app', redirect_uris: [REDIRECT] } })).data.client_id;
    const full = await approve(a.session, { ...ask, client_id: other });
    check('a sixth app → consent says so up front', full.data?.error === 'too_many_tokens', JSON.stringify(full.data));
    check('unsupported grant types are refused', (await token({ grant_type: 'client_credentials' })).data.error === 'unsupported_grant_type');
  },

  async steps({ admin }) {
    // What the agent is doing, while it does it: the node sends steps, the admin views poll them.
    const a = account(`steps-${Date.now()}@example.com`);
    const { project, ticketId } = (await newProject(a.session, { kind: 'existing', name: 'Steps Shop', brief: OLD_BRIEF, repoKind: 'none' })).data;
    const nodeId = `e2e-st-${Date.now() % 100000}`;
    const send = (runId, who, steps) => call(`/node/runs/${runId}/steps`, { method: 'POST', auth: RUNNER_TOKEN, body: { nodeId: who, steps } });
    const read = (runId, after = 0, auth = admin) => call(`/admin/runs/${runId}/steps?after=${after}`, { auth });
    await node(nodeId, [project.slug]);
    await approve(admin, ticketId);
    const c = await claim(nodeId);
    const t = Math.floor(Date.now() / 1000);
    check('steps: another node cannot send steps', (await send(c.runId, 'someone-else', [{ kind: 'tool', text: 'x' }])).status === 409);
    const first = await send(c.runId, nodeId, [
      { at: t, kind: 'node', text: 'Worktree from origin/master' },
      { at: t, kind: 'tool', text: 'bash ls' },
      { at: t, kind: 'bogus', text: 'dropped' },
      { at: t, kind: 'text', text: '   ' },
      { at: t + 999999, kind: 'text', text: 'Looking at the files.' },
    ]);
    check('steps: the holding node sends a batch; malformed steps are dropped', first.status === 200 && first.data.stored === 3, JSON.stringify(first.data));
    const all = (await read(c.runId)).data;
    check('steps: admin reads them in order, live', all.live === true && all.steps.map((s) => s.seq).join() === '1,2,3' && all.steps[1].text === 'bash ls', JSON.stringify(all).slice(0, 300));
    check('steps: a future timestamp is clamped to now', all.steps[2].at <= Math.floor(Date.now() / 1000) + 5);
    await send(c.runId, nodeId, [{ kind: 'error', text: 'x'.repeat(5000) }]);
    const later = (await read(c.runId, 3)).data;
    check('steps: after= returns only newer steps, trimmed', later.steps.length === 1 && later.steps[0].seq === 4 && later.steps[0].text.length === 600, JSON.stringify(later).slice(0, 200));
    check('steps: a client cannot read them', (await read(c.runId, 0, a.session)).status === 403);
    const many = Array.from({ length: 100 }, (_, i) => ({ kind: 'tool', text: `step ${i}` }));
    for (let i = 0; i < 4; i += 1) await send(c.runId, nodeId, many);
    const full = (await read(c.runId)).data.steps;
    check('steps: capped at 400, with one note saying so', full.length === 400 && full[399].kind === 'node' && /full/.test(full[399].text), `${full.length} ${JSON.stringify(full.at(-1))}`);
    await call(`/node/runs/${c.runId}/result`, { method: 'POST', auth: RUNNER_TOKEN, body: { nodeId, ok: true, summary: 'Done.' } });
    check('steps: no steps once the run is over', (await send(c.runId, nodeId, [{ kind: 'tool', text: 'late' }])).status === 409);
    check('steps: …and the run reads as finished', (await read(c.runId)).data.live === false);
    check('steps: an unknown run is a 404', (await read(999999)).status === 404);
    const attention = await call('/admin/attention', { auth: admin });
    check('attention: counts for the sidebar badge', attention.status === 200 && ['approve', 'review', 'waiting', 'running'].every((k) => Number.isInteger(attention.data[k])), JSON.stringify(attention.data));
    check('attention: a client cannot read it', (await call('/admin/attention', { auth: a.session })).status === 403);
  },

  async sessionlog({ admin }) {
    // A run made through the Harness leaves its session log in the portal, for the admin views on any machine.
    const a = account(`slog-${Date.now()}@example.com`);
    const { project, ticketId } = (await newProject(a.session, { kind: 'existing', name: 'Session Shop', brief: OLD_BRIEF, repoKind: 'none' })).data;
    const nodeId = `e2e-s-${Date.now() % 100000}`;
    const SESSION_ID = 'session-db44e5d2-8897-4d5e-9a9f-b96070283d22';
    const SESSION_DIR = '--Users-malipetek-.cache-malipetek-runner-worktrees-session-shop-ticket-1-run1--';
    const LOG = Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 1, 2, 3, 4, 5, 6, 7, 8]); // zstd magic + bytes
    const put = (runId, who, bytes = LOG) =>
      fetch(`${W}/node/runs/${runId}/session?nodeId=${who}`, { method: 'PUT', headers: { authorization: `Bearer ${RUNNER_TOKEN}`, 'content-type': 'application/zstd' }, body: bytes });
    const download = (runId, auth = admin) => fetch(`${W}/admin/runs/${runId}/session`, { headers: { authorization: `Bearer ${auth}` } });
    const report = (runId, extra) =>
      call(`/node/runs/${runId}/result`, { method: 'POST', auth: RUNNER_TOKEN, body: { nodeId, ok: true, summary: 'Did it.', ...extra } });
    const runRow = async (runId) => (await call(`/admin/tickets/${ticketId}`, { auth: admin })).data.runs.find((r) => r.id === runId);

    await node(nodeId, [project.slug]);
    await approve(admin, ticketId);
    const c = await claim(nodeId);
    check('session: the node claims the run', c.ticket?.id === ticketId && Number.isInteger(c.runId), JSON.stringify(c).slice(0, 200));
    check('session: a node that does not hold the run cannot upload', (await put(c.runId, 'someone-else')).status === 409);
    check('session: an upload with no body is refused', (await put(c.runId, nodeId, new Uint8Array(0))).status === 411);
    check('session: the holding node uploads the log', (await put(c.runId, nodeId)).status === 200);
    check('session: nothing to download before the run reports it', (await download(c.runId)).status === 404);
    const rep = await report(c.runId, { sessionId: SESSION_ID, sessionDir: SESSION_DIR, sessionLog: true });
    check('session: the result with sessionLog is accepted', rep.status === 200, JSON.stringify(rep.data));
    const row = await runRow(c.runId);
    check('session: the admin run row carries the session', row?.session_id === SESSION_ID && row.session_dir === SESSION_DIR && row.session_log === 1, JSON.stringify(row).slice(0, 300));
    const dl = await download(c.runId);
    const bytes = new Uint8Array(await dl.arrayBuffer());
    check('session: admin downloads the log, byte for byte', dl.status === 200 && bytes.length === LOG.length && bytes.every((b, i) => b === LOG[i]), String(dl.status));
    check('session: …as zstd, with its length', dl.headers.get('content-type') === 'application/zstd' && dl.headers.get('content-length') === String(LOG.length));
    check('session: …and says which session it is', dl.headers.get('x-session-id') === SESSION_ID && dl.headers.get('x-session-dir') === SESSION_DIR);
    check('session: a client cannot download it', (await download(c.runId, a.session)).status === 403);
    check('session: the client never sees the session in the thread', !JSON.stringify((await call(`/portal/tickets/${ticketId}`, { auth: a.session })).data).includes(SESSION_ID));
    check('session: the fleet view carries it too', (await call('/admin/runs', { auth: admin })).data.recent?.find((r) => r.id === c.runId)?.session_log === 1);
    check('session: no upload once the run is over', (await put(c.runId, nodeId)).status === 409);

    // A log the node says it left but never uploaded is not recorded.
    await approve(admin, ticketId);
    const c2 = await claim(nodeId);
    await report(c2.runId, { sessionId: SESSION_ID, sessionDir: '--../../etc--', sessionLog: true });
    const row2 = await runRow(c2.runId);
    check('session: sessionLog without an upload is stored as 0', row2?.session_log === 0 && row2.session_id === SESSION_ID, JSON.stringify(row2).slice(0, 300));
    check('session: …a traversal folder is dropped, not stored', row2?.session_dir === null);
    check('session: …and there is nothing to download', (await download(c2.runId)).status === 404);
    check('session: an unknown run is a 404', (await download(999999)).status === 404);

    // The Harness agent tool's admin claim/report still works without session fields, and cannot claim a stored log.
    await approve(admin, ticketId);
    const hc = await call(`/admin/tickets/${ticketId}/claim`, { method: 'POST', auth: admin, body: { executor: 'dsh-claude' } });
    const hr = await call(`/admin/tickets/${ticketId}/run-result`, { method: 'POST', auth: admin, body: { ok: true, summary: 'From the Harness.', executor: 'dsh-claude', sessionId: SESSION_ID, sessionLog: true } });
    const row3 = await runRow(hc.data?.runId);
    check('session: the admin report works and keeps the id, not a log claim', hr.status === 200 && row3?.executor === 'dsh-claude' && row3.session_id === SESSION_ID && row3.session_log === 0, JSON.stringify(row3).slice(0, 300));
    await approve(admin, ticketId);
    const hc2 = await call(`/admin/tickets/${ticketId}/claim`, { method: 'POST', auth: admin, body: { executor: 'dsh' } });
    const hr2 = await call(`/admin/tickets/${ticketId}/run-result`, { method: 'POST', auth: admin, body: { ok: true, summary: 'No session.' } });
    const row4 = await runRow(hc2.data?.runId);
    check('session: …and without any session fields', hr2.status === 200 && row4?.session_id === null && row4.session_log === 0, JSON.stringify(row4).slice(0, 300));

    // Client work stays on claude even when a Harness executor is asked for.
    await call(`/admin/tickets/${ticketId}`, { method: 'PATCH', auth: admin, body: { executor: 'dsh-claude' } });
    check('session: a client ticket can be pinned to a Harness executor', (await call(`/admin/tickets/${ticketId}`, { auth: admin })).data.ticket.executor === 'dsh-claude');
    const catalog = (await call('/admin/settings', { auth: admin })).data?.catalog?.executors ?? [];
    check('session: the catalog offers the Harness executors', ['dsh-claude', 'dsh-opencode'].every((id) => catalog.some((e) => e.id === id)), JSON.stringify(catalog));
  },

  async node({ admin }) {
    // The real node program, once, against a local repo that carries hook settings.
    const dir = mkdtempSync(join(tmpdir(), 'malipetek-e2e-node-'));
    try {
      const repo = join(dir, 'repo');
      mkdirSync(join(repo, '.claude'), { recursive: true });
      writeFileSync(join(repo, '.claude', 'settings.local.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: `touch ${join(dir, 'PWNED')}` }] }] } }));
      writeFileSync(join(repo, 'README.md'), 'hi\n');
      const git = (...args) => execFileSync('git', ['-c', 'user.email=e2e@x', '-c', 'user.name=e2e', ...args], { cwd: repo, stdio: 'pipe' });
      git('init', '-q', '-b', 'main');
      git('add', '-A');
      git('add', '-f', '.claude/settings.local.json'); // a global gitignore may hide it
      git('commit', '-qm', 'init');
      // A bare repo plays the remote every node shares.
      const origin = join(dir, 'origin.git');
      execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
      git('remote', 'add', 'origin', origin);
      git('push', '-q', 'origin', 'main');
      const fake = join(dir, 'fake-claude.sh');
      writeFileSync(
        fake,
        [
          '#!/bin/sh',
          'case "$1" in --version) echo 0.0.0-e2e; exit 0;; esac',
          `cat > ${join(dir, 'prompt.txt')}`,
          `ls .malipetek-files > ${join(dir, 'saw-files')} 2>&1`,
          `if [ -e .claude/settings.local.json ]; then echo visible > ${join(dir, 'saw-settings')}; else echo hidden > ${join(dir, 'saw-settings')}; fi`,
          'mkdir -p src/pages && printf "<h1>Order</h1>\\n" > src/pages/order.astro',
          // stream-json, as the node asks for: a tool call, then the result.
          'echo \'{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"src/pages/order.astro"}}]}}\'',
          'echo \'{"type":"result","result":"Added the order page","total_cost_usd":0.01,"num_turns":1}\'',
        ].join('\n'),
      );
      chmodSync(fake, 0o755);

      const a = account(`node-${Date.now()}@example.com`);
      const { project, ticketId } = (await newProject(a.session, { kind: 'existing', name: 'Hooked Repo', brief: OLD_BRIEF, repoKind: 'none' })).data;
      const form = new FormData();
      form.append('body', 'Use this logo.');
      form.append('files', new Blob(['not really a png']), 'logo.png');
      await fetch(`${W}/portal/tickets/${ticketId}/messages`, { method: 'POST', headers: { authorization: `Bearer ${a.session}` }, body: form });
      await approve(admin, ticketId);
      const nodeId = `e2e-n-${Date.now() % 100000}`;
      const config = join(dir, 'config.json');
      writeFileSync(
        config,
        JSON.stringify({
          endpoint: W,
          token: RUNNER_TOKEN,
          node: { id: nodeId, slots: 1, executors: ['claude'] },
          autoClone: false,
          createRepos: false, // never make real GitHub repos from a test
          cloneRoot: join(dir, 'clones'), // nor read or write this machine's real clones
          worktreeRoot: join(dir, 'wt'),
          projects: { [project.slug]: repo },
          claude: { bin: fake },
        }),
        { mode: 0o600 },
      );
      const out = execFileSync('node', [join(REPO, 'fleet', 'node.mjs'), '--once'], { env: { ...process.env, MALIPETEK_NODE_CONFIG: config }, stdio: 'pipe', timeout: 120_000 }).toString();
      check('the node claims and reports', /reported \(ok\)/.test(out), out.slice(-400));
      check('the agent never saw the repo’s hook settings', readFileSync(join(dir, 'saw-settings'), 'utf8').trim() === 'hidden');
      check('the hook never ran', !existsSync(join(dir, 'PWNED')));
      const local = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', `refs/heads/ticket-${ticketId}-run*`], { cwd: repo }).toString().trim();
      const branch = execFileSync('git', ['show', '--stat', '--format=', local], { cwd: repo }).toString();
      check('the commit holds the agent’s change only', /src\/pages\/order\.astro/.test(branch) && !/settings\.local\.json/.test(branch), branch);
      check('the settings file is back where it was', existsSync(join(dir, 'wt', `${project.slug}-${local}`, '.claude', 'settings.local.json')));
      const status = (await call(`/portal/tickets/${ticketId}`, { auth: a.session })).data.ticket.status;
      check('the ticket is in review', status === 'review', status);
      check('the agent found the attachment in its checkout', /1-logo\.png/.test(readFileSync(join(dir, 'saw-files'), 'utf8')));
      check('…and the prompt points at it', /Attached, readable in this checkout: \.malipetek-files\/1-logo\.png/.test(readFileSync(join(dir, 'prompt.txt'), 'utf8')));
      check('…but it is not committed', !/malipetek-files/.test(branch));

      // Sharing: the work goes to origin's ticket branch, and the next run on
      // another machine starts from it.
      const shared = `malipetek/ticket-${ticketId}`;
      const onOrigin = (ref) => execFileSync('git', ['ls-tree', '-r', '--name-only', ref], { cwd: origin }).toString();
      check('the work is pushed to the ticket branch on origin', /src\/pages\/order\.astro/.test(onOrigin(shared)));
      check('…and only there: main is untouched', !/order\.astro/.test(onOrigin('main')));
      const runsOf = async () => (await call(`/admin/tickets/${ticketId}`, { auth: admin })).data.runs;
      const first = (await runsOf()).at(-1);
      check('the run records where it went', first.shared_to === 'origin' && first.shared_ref === shared && /^[0-9a-f]{40}$/.test(first.commit_sha ?? ''), JSON.stringify(first).slice(0, 300));
      const steps = (await call(`/admin/runs/${first.id}/steps`, { auth: admin })).data.steps ?? [];
      const said = steps.map((s) => `${s.kind}:${s.text}`).join(' | ');
      check('live steps: the node’s milestones, the agent’s tool call, in order', /node:.*worktree ticket-.* \| node:Running claude \| tool:Write src\/pages\/order\.astro \| node:Pushed /.test(said), said);
      check('live steps: the cost came through stream-json', first.cost_micro_usd === 10000, String(first.cost_micro_usd));

      const nextRun = async (name, { originUrl, script }) => {
        const clone = join(dir, name);
        execFileSync('git', ['clone', '-q', origin, clone], { stdio: 'pipe' });
        if (originUrl) execFileSync('git', ['remote', 'set-url', 'origin', originUrl], { cwd: clone });
        const bin = join(dir, `fake-${name}.sh`);
        writeFileSync(bin, ['#!/bin/sh', 'case "$1" in --version) echo 0.0.0-e2e; exit 0;; esac', `cat > ${join(dir, `prompt-${name}.txt`)}`, ...script, 'echo \'{"result":"Did the follow-up","total_cost_usd":0.01,"num_turns":1}\''].join('\n'));
        chmodSync(bin, 0o755);
        const cfg = join(dir, `config-${name}.json`);
        writeFileSync(cfg, JSON.stringify({ endpoint: W, token: RUNNER_TOKEN, node: { id: `${nodeId}-${name}`, slots: 1, executors: ['claude'] }, autoClone: false, cloneRoot: join(dir, 'clones'), worktreeRoot: join(dir, `wt-${name}`), projects: { [project.slug]: clone }, claude: { bin } }), { mode: 0o600 });
        await call(`/admin/tickets/${ticketId}/messages`, { method: 'POST', auth: admin, body: { body: `Follow-up for ${name}.`, internal: true } });
        await approve(admin, ticketId);
        const log = execFileSync('node', [join(REPO, 'fleet', 'node.mjs'), '--once'], { env: { ...process.env, MALIPETEK_NODE_CONFIG: cfg }, stdio: 'pipe', timeout: 120_000 }).toString();
        return { log, clone, prompt: readFileSync(join(dir, `prompt-${name}.txt`), 'utf8'), run: (await runsOf()).at(-1) };
      };
      // A clone taken before the push would not have it either; this one is fresh but has no local ticket branch.
      const b = await nextRun('b', { script: [`if [ -f src/pages/order.astro ]; then echo yes > ${join(dir, 'b-saw')}; else echo no > ${join(dir, 'b-saw')}; fi`, 'printf "footer\\n" > footer.html'] });
      check('a second node starts from the first node’s work', readFileSync(join(dir, 'b-saw'), 'utf8').trim() === 'yes', b.log.slice(-300));
      check('…and is told so in its prompt', /continues from .*run \d+/.test(b.prompt) || /continues from origin/.test(b.prompt), b.prompt.slice(-600));
      const tip = onOrigin(shared);
      check('its push adds to the ticket branch', /order\.astro/.test(tip) && /footer\.html/.test(tip));

      // A node that cannot push leaves a bundle in the portal; the next node picks it up from there.
      const c = await nextRun('c', { originUrl: join(dir, 'gone.git'), script: [`ls > ${join(dir, 'c-saw')}`, 'printf "c\\n" > from-c.txt'] });
      check('a node with an unreachable origin saves a bundle instead', c.run.shared_to === 'bundle', JSON.stringify(c.run).slice(0, 300));
      check('…after starting from the shared work', /footer\.html/.test(readFileSync(join(dir, 'c-saw'), 'utf8')) || /elsewhere|NOT in this checkout/.test(c.prompt));
      const d = await nextRun('d', { originUrl: join(dir, 'gone-too.git'), script: [`if [ -f from-c.txt ]; then echo yes > ${join(dir, 'd-saw')}; else echo no > ${join(dir, 'd-saw')}; fi`, 'printf "d\\n" > from-d.txt'] });
      check('the next node starts from that bundle', readFileSync(join(dir, 'd-saw'), 'utf8').trim() === 'yes', d.log.slice(-400));
      check('…and says so', /bundle/.test(d.prompt), d.prompt.slice(-400));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

/* ——————————————————————— run ——————————————————————— */

async function main() {
  STATE = mkdtempSync(join(tmpdir(), 'malipetek-e2e-state-'));
  const port = await freePort();
  W = `http://localhost:${port}`;
  RUNNER_TOKEN = devVar('RUNNER_TOKEN') || 'e2e-runner-token';
  if ((devVar('DEV_RETURN_LINK') ?? '1') !== '1') throw new Error('.dev.vars sets DEV_RETURN_LINK to something other than 1; the suite signs in through the returned link.');
  const turnstile = devVar('TURNSTILE_SECRET_KEY');
  if (turnstile && !turnstile.startsWith('1x0000')) throw new Error('.dev.vars has a real TURNSTILE_SECRET_KEY; leave it empty (or a test key) to run the suite.');

  console.log(`state ${STATE}\nworker ${W}\n`);
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'malipetek-portal', '--local', '--persist-to', STATE], { cwd: WORKER, stdio: 'pipe' });

  await startFakeCloudflare();
  const vars = {
    DEV_RETURN_LINK: '1',
    RUNNER_TOKEN,
    SITE_URL: 'http://localhost:4321',
    GITHUB_WEBHOOK_SECRET: 'test-webhook-secret',
    CLOUDFLARE_OAUTH_CLIENT_ID: CF_CLIENT.id,
    CLOUDFLARE_OAUTH_CLIENT_SECRET: CF_CLIENT.secret,
    CLOUDFLARE_OAUTH_BASE: `http://127.0.0.1:${CF.port}`,
    CLOUDFLARE_API_BASE: `http://127.0.0.1:${CF.port}/client/v4`,
    MARKETING_TOKEN: 'e2e-marketing-token',
  };
  const dev = spawn('npx', ['vite', 'dev', '--port', String(port), '--strictPort'], {
    cwd: WORKER,
    env: { ...process.env, MALIPETEK_E2E_STATE: STATE, MALIPETEK_E2E_VARS: JSON.stringify(vars) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let devLog = '';
  dev.stdout.on('data', (d) => (devLog += d));
  dev.stderr.on('data', (d) => (devLog += d));
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    const kill = (signal) => {
      try {
        process.kill(-dev.pid, signal); // the whole group: npx, vite, workerd
      } catch {}
    };
    kill('SIGTERM');
    for (let i = 0; i < 30 && dev.exitCode === null && dev.signalCode === null; i += 1) await sleep(100);
    kill('SIGKILL'); // whatever ignored the polite ask
    rmSync(STATE, { recursive: true, force: true });
  };
  process.on('SIGINT', () => {
    void stop().then(() => process.exit(130));
  });

  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i += 1) {
      up = await fetch(`${W}/health`).then((r) => r.ok).catch(() => false);
      if (!up) await sleep(1000);
    }
    if (!up) throw new Error(`the dev server did not start:\n${devLog.slice(-2000)}`);
    const admin = (await signIn('malipetek@gmail.com')).session;

    for (const [name, run] of Object.entries(groups)) {
      if (only && !name.includes(only)) continue;
      group = name;
      console.log(`${name}`);
      try {
        await run({ admin });
      } catch (error) {
        check(`${name} threw`, false, error.stack ?? String(error));
      }
    }
  } finally {
    await stop();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    for (const f of failed) console.log(`  FAILED ${f.group}: ${f.name}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
