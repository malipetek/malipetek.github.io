#!/usr/bin/env node
/*
 * End-to-end checks for the portal Worker, against the real dev server.
 *
 *   pnpm test:e2e            every group
 *   pnpm test:e2e sites      only groups whose name contains "sites"
 *   pnpm test:e2e sites,node several groups in one run (comma-separated)
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
const only = (process.argv[2] ?? '').split(',').filter(Boolean);
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

async function call(path, { method = 'GET', body, auth } = {}, tries = 3) {
  try {
    const res = await fetch(W + path, {
      method,
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch (error) {
    // `wrangler d1 execute` writing the same SQLite file can bounce workerd for
    // a moment; the request itself never reached the Worker.
    if (tries > 1 && /fetch failed/i.test(String(error))) {
      await sleep(400);
      return call(path, { method, body, auth }, tries - 1);
    }
    throw error;
  }
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
function account(email, { verified = true } = {}) {
  const id = randomUUID();
  const token = randomBytes(24).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  const t = Math.floor(Date.now() / 1000);
  // A real account signs in with a magic link, which is what verifies it.
  sql(
    `INSERT INTO users (id, email, role, created_at, verified_at) VALUES ('${id}', '${email}', 'client', ${t}, ${verified ? t : 'NULL'});
     INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES ('${hash}', '${id}', ${t + 86400}, ${t});`,
  );
  return { session: token, user: { id, email, role: 'client' } };
}

let STATE = '';

/*
 * A stand-in for Cloudflare's OAuth and accounts API: the token endpoint
 * (client secret by Basic auth), revoke, and /accounts for a good token.
 */
const CF = { port: 0, revoked: [], deepseek: [], uploads: [], deploys: [] };
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
          return json(200, {
            access_token: 'cf-access-secret',
            refresh_token: 'cf-refresh-secret',
            expires_in: 3600,
            scope: 'account-settings.read memberships.read user-details.read workers-scripts.edit workers-scripts.admin workers-routes.write zone.read dns.write offline_access',
          });
        }
        if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'cf-refresh-secret') {
          return json(200, { access_token: 'cf-access-secret', refresh_token: 'cf-refresh-secret', expires_in: 3600, scope: 'workers-scripts.edit zone.read' });
        }
        return json(400, { error: 'invalid_grant' });
      }
      if (req.method === 'POST' && req.url === '/oauth2/revoke') {
        CF.revoked.push(form.get('token'));
        return json(200, {});
      }
      /*
       * DeepSeek, for the translation bridge: "TR:" text is Turkish, the rest
       * English; a translation is the text tagged with its target locale.
       */
      if (req.method === 'POST' && req.url === '/deepseek/chat/completions') {
        if (req.headers.authorization !== 'Bearer e2e-deepseek') return json(401, {});
        const ask = JSON.parse(body);
        // The intake agent: a fixed three-tool script, so the loop, the tool
        // scope and the thread are exercised without a real model.
        if (Array.isArray(ask.tools)) {
          const toolMsgs = (ask.messages ?? []).filter((m) => m.role === 'tool');
          const results = toolMsgs.map((m) => JSON.parse(m.content));
          const project = results.map((r) => r?.project).filter(Boolean).at(-1);
          const hasSite = results.some((r) => r?.site);
          const filed = results.some((r) => r?.ticket);
          const call = (name, args) =>
            json(200, {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [{ id: `call-${toolMsgs.length + 1}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
                  },
                },
              ],
            });
          if (!project) return call('create_project', { name: `E2E Intake ${Date.now() % 100000}`, what: 'A bakery', goal: 'Orders online', kind: 'new' });
          if (!hasSite) return call('add_site', { projectId: project.id, name: 'Main', slug: `e2e-intake-${Date.now() % 100000}` });
          if (!filed) return call('file_request', { projectId: project.id, title: 'Order online', body: 'Add an order form.' });
          return json(200, { choices: [{ message: { role: 'assistant', content: 'Set up the project and filed a request for Ali to approve.' } }] });
        }
        const target = /into .+? \(([\w-]+)\)\./.exec(ask.messages[0].content)?.[1];
        const text = ask.messages[1].content;
        CF.deepseek.push({ target, text });
        const source = text.startsWith('TR:') ? 'tr' : 'en';
        const out = source === target?.split('-')[0] ? text : `[${target}] ${text}`;
        return json(200, { choices: [{ message: { content: JSON.stringify({ source, text: out }) } }] });
      }
      if (req.method === 'GET' && req.url === '/client/v4/user/tokens/verify') {
        if (req.headers.authorization !== 'Bearer cf-api-token-0123456789') {
          return json(403, { success: false, errors: [{ message: 'Invalid API Token' }] });
        }
        return json(200, { success: true, result: { status: 'active' } });
      }
      if (req.url.startsWith('/client/v4/accounts')) {
        const upload = req.url.endsWith('/workers/assets/upload?base64=true');
        const expected = upload ? 'Bearer upload-jwt' : 'Bearer cf-access-secret';
        const tokenOk = req.headers.authorization === 'Bearer cf-api-token-0123456789';
        if (!tokenOk && req.headers.authorization !== expected) return json(403, { success: false });
        const api = '/client/v4/accounts/acc-1';
        if (req.method === 'GET' && req.url === '/client/v4/accounts?per_page=50') {
          return json(200, { success: true, result: [{ id: 'acc-1', name: 'Rosa Florist LLC' }] });
        }
        if (req.method === 'GET' && req.url === `${api}/workers/subdomain`) {
          return json(200, { success: true, result: { subdomain: 'e2e-sub' } });
        }
        const session = new RegExp(`^${api}/workers/scripts/([^/]+)/assets-upload-session$`).exec(req.url);
        if (req.method === 'POST' && session) {
          const manifest = JSON.parse(body).manifest ?? {};
          const hashes = Object.values(manifest).map((f) => f.hash);
          CF.uploads.push({ script: session[1], hashes });
          return json(200, { success: true, result: { jwt: 'upload-jwt', buckets: hashes.length ? [hashes] : [] } });
        }
        if (req.method === 'POST' && req.url === `${api}/workers/assets/upload?base64=true`) {
          return json(201, { success: true, result: { jwt: 'completion-jwt' } });
        }
        const script = new RegExp(`^${api}/workers/scripts/([^/]+)$`).exec(req.url);
        if (req.method === 'PUT' && script) {
          CF.deploys.push(script[1]);
          return json(200, { success: true, result: {} });
        }
        const sub = new RegExp(`^${api}/workers/scripts/([^/]+)/subdomain$`).exec(req.url);
        if (req.method === 'POST' && sub) return json(200, { success: true, result: {} });
        return json(404, {});
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
/** Rows from the local database, for checks on what a route recorded. */
function rows(query) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'malipetek-portal', '--local', '--persist-to', STATE, '--json', '--command', query], { cwd: WORKER, stdio: 'pipe' });
  return JSON.parse(String(out))[0]?.results ?? [];
}

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
    // The code in the same email signs in where it is typed (an assistant's OAuth window).
    const codeMail = `code-${Date.now()}@example.com`;
    const asked = await call('/auth/request', { method: 'POST', body: { email: codeMail, turnstileToken: DUMMY_TURNSTILE } });
    check('a sign-in email carries a six-digit code', /^\d{6}$/.test(asked.data?.devCode ?? ''), JSON.stringify(asked.data));
    const wrongCode = asked.data.devCode === '000000' ? '000001' : '000000';
    check('a wrong code is refused', (await call('/auth/code', { method: 'POST', body: { email: codeMail, code: wrongCode } })).data?.error === 'bad_code');
    const byCode = await call('/auth/code', { method: 'POST', body: { email: codeMail, code: asked.data.devCode } });
    check('the right code signs in and makes the account', byCode.status === 200 && byCode.data.user?.role === 'client' && typeof byCode.data.session === 'string', JSON.stringify(byCode.data));
    check('the code works once', (await call('/auth/code', { method: 'POST', body: { email: codeMail, code: asked.data.devCode } })).status === 401);
    const linkOfCode = new URL(asked.data.devLink).hash.match(/token=([^&]+)/)[1];
    check('…and its link dies with it', (await call('/auth/verify', { method: 'POST', body: { token: linkOfCode } })).status === 401);
    const guessed = `guess-${Date.now()}@example.com`;
    const g = await call('/auth/request', { method: 'POST', body: { email: guessed, turnstileToken: DUMMY_TURNSTILE } });
    const notIt = g.data.devCode === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i += 1) await call('/auth/code', { method: 'POST', body: { email: guessed, code: notIt } });
    check('five wrong codes kill the right one', (await call('/auth/code', { method: 'POST', body: { email: guessed, code: g.data.devCode } })).data?.error === 'code_expired');
    const guessedLink = new URL(g.data.devLink).hash.match(/token=([^&]+)/)[1];
    check('…while the link still signs in', (await call('/auth/verify', { method: 'POST', body: { token: guessedLink } })).status === 200);

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
    const address = `acme-${Date.now() % 100000}`;
    const made = await call(`/portal/projects/${created.data.project.id}/site`, {
      method: 'POST',
      auth: a.session,
      body: { name: 'Main', siteSlug: address },
    });
    check('a project gets a site as a sub-entity', made.status === 201 && made.data.site?.slug === address && made.data.site?.isPrimary === true, JSON.stringify(made.data));
    const meAfter = (await call('/portal/me', { auth: a.session })).data;
    const after = meAfter.projects.find((x) => x.id === created.data.project.id);
    check('the project lists its sites', after.sites?.length === 1 && after.sites[0].slug === address, JSON.stringify(after.sites));
    check(
      'the board has a lane per project with its sites',
      Array.isArray(meAfter.lanes) && meAfter.lanes.some((lane) => lane.id === created.data.project.id && lane.sites.length === 1),
      JSON.stringify(meAfter.lanes),
    );
    const adminView = (await call('/admin/projects', { auth: admin })).data.projects.find((x) => x.id === created.data.project.id);
    check('admin sees the same setup', adminView?.setup?.ready === after.setup.ready && adminView.brief.manual === 'Orders by phone');
    const extra = await call(`/portal/projects/${created.data.project.id}/site`, {
      method: 'POST',
      auth: a.session,
      body: { name: 'Docs', siteSlug: `${address}-docs` },
    });
    const removed = await call(`/portal/projects/${created.data.project.id}/site`, {
      method: 'DELETE',
      auth: a.session,
      body: { siteId: extra.data.site.id },
    });
    const left = (await call(`/portal/projects/${created.data.project.id}/sites`, { auth: a.session })).data.sites;
    check('a site can be removed without touching the other', removed.status === 200 && left.length === 1 && left[0].slug === address, JSON.stringify(left));
    const moved = await call(`/portal/tickets/${created.data.ticketId}`, {
      method: 'PATCH',
      auth: a.session,
      body: { projectId: again.data.project.id },
    });
    check('a client moves a request to another own project', moved.status === 200 && moved.data.status === 'new', JSON.stringify(moved.data));
    const foreign = account(`move-foreign-${Date.now()}@example.com`);
    const foreignProject = (await newProject(foreign.session, { kind: 'existing', name: 'Not Mine', brief: OLD_BRIEF, repoKind: 'none' })).data.project;
    check(
      'a move to a foreign project is refused',
      (await call(`/portal/tickets/${created.data.ticketId}`, { method: 'PATCH', auth: a.session, body: { projectId: foreignProject.id } })).status === 400,
    );
    const siteMoved = await call(`/portal/sites/${made.data.site.id}`, {
      method: 'PATCH',
      auth: a.session,
      body: { projectId: again.data.project.id },
    });
    check('a site moves to another own project', siteMoved.status === 200, JSON.stringify(siteMoved.data));
    check(
      'the site is no longer under the old project',
      (await call(`/portal/me`, { auth: a.session })).data.projects.find((p) => p.id === created.data.project.id)?.sites?.length === 0,
    );

  },

  async intake({ admin }) {
    const a = account(`intake-${Date.now()}@example.com`);
    const created = await call('/portal/tickets', {
      method: 'POST',
      auth: a.session,
      body: { title: 'I need a bakery site', body: 'I need a bakery site with online orders.', intake: true },
    });
    check('a request with no project becomes an intake ticket', created.status === 201 && created.data.intake === true, JSON.stringify(created.data));
    let thread = null;
    for (let i = 0; i < 30; i += 1) {
      await sleep(200);
      thread = (await call(`/portal/tickets/${created.data.id}`, { auth: a.session })).data;
      if (thread?.messages?.some((m) => m.author === 'runner')) break;
    }
    check(
      'the setup assistant answers in the thread',
      Boolean(thread?.messages?.some((m) => m.author === 'runner')),
      JSON.stringify(thread?.messages).slice(0, 500),
    );
    const me = (await call('/portal/me', { auth: a.session })).data;
    const project = me.projects.find((p) => /E2E Intake/.test(p.name));
    check('it created a project', Boolean(project), JSON.stringify(me.projects));
    check('it added a site', project?.sites?.length === 1, JSON.stringify(project?.sites));
    const tickets = (await call('/portal/tickets', { auth: a.session })).data.tickets;
    const filed = tickets.find((t) => t.id !== created.data.id && /Order online/.test(t.title));
    check('it filed a real request', Boolean(filed), JSON.stringify(tickets));
    // A new project's first request is the account's one free first preview: it
    // starts by itself, capped in AI cost and never published.
    check(
      'the first request of a new project starts as a first preview',
      filed?.status === 'approved' && filed?.first_preview === 1 && filed?.budget_cents === 200,
      JSON.stringify(filed),
    );
    const threadNow = (await call(`/portal/tickets/${filed?.id}`, { auth: a.session })).data;
    check(
      'the thread says the first preview started, with its limit',
      (threadNow?.messages ?? []).some((m) => /^First preview started: this one is free, with up to \$2\.00 of AI/.test(m.body)),
      JSON.stringify(threadNow?.messages ?? []).slice(0, 600),
    );
    const afterPreview = (await call('/portal/me', { auth: a.session })).data;
    check(
      'the first preview is not on the client’s bill',
      afterPreview.usage.billedCents === 0 && afterPreview.usage.openCents === 0 && afterPreview.usage.aiCents === 0,
      JSON.stringify(afterPreview.usage),
    );
    check(
      'the intake ticket moved to review',
      (await call(`/portal/tickets/${created.data.id}`, { auth: a.session })).data.ticket.status === 'review',
    );
    const queue = (await call('/admin/queue', { auth: admin })).data.queue;
    check('an intake ticket is never in the node queue', !queue.some((q) => q.id === created.data.id));

    // One per account, not per project: the second new project waits for Ali.
    const second = await call('/portal/tickets', {
      method: 'POST',
      auth: a.session,
      body: { title: 'Another site', body: 'A second site for the same business.', intake: true },
    });
    let secondThread = null;
    for (let i = 0; i < 30; i += 1) {
      await sleep(200);
      secondThread = (await call(`/portal/tickets/${second.data.id}`, { auth: a.session })).data;
      if (secondThread?.messages?.some((m) => m.author === 'runner')) break;
    }
    const secondTickets = (await call('/portal/tickets', { auth: a.session })).data.tickets;
    const secondFiled = secondTickets.find((t) => t.id !== second.data.id && /Order online/.test(t.title) && t.first_preview === 0);
    check(
      'a second project does not get a first preview',
      secondFiled?.status === 'new' && !secondTickets.some((t) => t.first_preview === 1 && t.id !== filed?.id),
      JSON.stringify(secondTickets),
    );

    // The limit is a setting: 0 turns the whole thing off.
    await call('/admin/settings', { method: 'PATCH', auth: admin, body: { first_preview_limit_usd: 0 } });
    const off = account(`intake-off-${Date.now()}@example.com`);
    const offTicket = await call('/portal/tickets', {
      method: 'POST',
      auth: off.session,
      body: { title: 'Site with the limit off', body: 'A site, with the first preview switched off.', intake: true },
    });
    for (let i = 0; i < 30; i += 1) {
      await sleep(200);
      const t = (await call(`/portal/tickets/${offTicket.data.id}`, { auth: off.session })).data;
      if (t?.messages?.some((m) => m.author === 'runner')) break;
    }
    const offTickets = (await call('/portal/tickets', { auth: off.session })).data.tickets;
    check(
      'a limit of 0 disables the first preview',
      offTickets.some((t) => t.status === 'new' && t.first_preview === 0) && !offTickets.some((t) => t.first_preview === 1),
      JSON.stringify(offTickets),
    );
    // A sign-in that was never verified gets none either.
    await call('/admin/settings', { method: 'PATCH', auth: admin, body: { first_preview_limit_usd: 2 } });
    const unverified = account(`intake-unverified-${Date.now()}@example.com`, { verified: false });
    const unvTicket = await call('/portal/tickets', {
      method: 'POST',
      auth: unverified.session,
      body: { title: 'Unverified site', body: 'A site from an account that never signed in by email.', intake: true },
    });
    for (let i = 0; i < 30; i += 1) {
      await sleep(200);
      const t = (await call(`/portal/tickets/${unvTicket.data.id}`, { auth: unverified.session })).data;
      if (t?.messages?.some((m) => m.author === 'runner')) break;
    }
    const unvTickets = (await call('/portal/tickets', { auth: unverified.session })).data.tickets;
    check(
      'an unverified sign-in gets no first preview',
      !unvTickets.some((t) => t.first_preview === 1) && unvTickets.some((t) => t.status === 'new'),
      JSON.stringify(unvTickets),
    );

    const other = account(`intake-other-${Date.now()}@example.com`);
    check('another client cannot read it', (await call(`/portal/tickets/${created.data.id}`, { auth: other.session })).status === 404);
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
    check('the first email is the plain pitch, every placeholder filled', /billed by the second/.test(firstEmail?.body ?? '') && !firstEmail.body.includes('{{'));
    // A big import is one request: contacts are written in batches, then the
    // desk can queue everyone in another. A missing observation is a choice,
    // not a dead end.
    const bigCsv = [
      'email,name,business,site,gap',
      ...Array.from({ length: 500 }, (_, i) => `bulk${i}@example.test,Bulk ${i},Bulk Co ${i},bulk${i}.example.test,`),
    ].join('\n');
    const bigImport = await call('/admin/marketing/contacts/import', {
      method: 'POST',
      auth: admin,
      body: { csv: bigCsv, sequence: 'none', campaign: 'bulk' },
    });
    check(
      '500 contacts import in one request',
      bigImport.status === 200 && bigImport.data.added === 500 && bigImport.data.paused === 0,
      JSON.stringify(bigImport.data).slice(0, 400),
    );
    const nobody = contacts.find((c) => c.email === 'nobody@example.test');
    check(
      'a cold sequence still refuses a contact without an observation',
      (await call(`/admin/marketing/contacts/${nobody.id}/queue`, { method: 'POST', auth: admin, body: { sequence: 'cold_a' } })).data.error === 'gap_required',
    );
    const bulk = await call('/admin/marketing/contacts/queue', {
      method: 'POST',
      auth: admin,
      body: { sequence: 'cold_a', campaign: 'bulk', genericGap: true },
    });
    check(
      'one bulk action queues the imported contacts with a general opener',
      bulk.status === 200 && bulk.data.queued >= 500 && bulk.data.emails >= 1500,
      JSON.stringify(bulk.data),
    );
    // Without a real observation, no email may claim someone looked at the site.
    const firstOf = () =>
      sql(`SELECT body FROM marketing_messages m JOIN marketing_contacts c ON c.id = m.contact_id
            WHERE c.email = 'bulk7@example.test' AND m.step = 0 AND m.status = 'scheduled'`).toString();
    const plainFirst = firstOf();
    check('a contact without an observation gets the plain opener, not "I looked at…"', /help you use AI and deploy what you build/.test(plainFirst) && !/I looked at/.test(plainFirst), plainFirst.slice(0, 300));
    sql(`UPDATE marketing_messages SET body = 'stale wording' WHERE status = 'scheduled' AND to_email = 'bulk7@example.test';`);
    const rerendered = await call('/admin/marketing/messages/rerender', { method: 'POST', auth: admin });
    check('re-render brings scheduled emails back to the current templates', rerendered.status === 200 && rerendered.data.updated >= 1500 && !/stale wording/.test(firstOf()), JSON.stringify(rerendered.data));
    const subjectOf = () =>
      sql(`SELECT subject FROM marketing_messages m JOIN marketing_contacts c ON c.id = m.contact_id
            WHERE c.email = 'bulk7@example.test' AND m.step = 0 AND m.status = 'scheduled'`).toString();
    check('an unknown sequence move is refused', (await call('/admin/marketing/messages/rerender', { method: 'POST', auth: admin, body: { from: 'cold_a', to: 'nope' } })).status === 400);
    const movedSeq = await call('/admin/marketing/messages/rerender', { method: 'POST', auth: admin, body: { from: 'cold_a', to: 'cold_b' } });
    check(
      'queued Cold A mail can move to Cold B, keeping its slots',
      movedSeq.status === 200 && movedSeq.data.moved >= 1500 && /Vibe contracting for bulk7\.example\.test/.test(subjectOf()) && /billed by the second/.test(firstOf()),
      JSON.stringify(movedSeq.data),
    );

    const bad = await call('/admin/marketing/settings', { method: 'PUT', auth: admin, body: { dailyCap: 0, live: 'yes' } });
    check('a bad setting is refused and the old value stands', bad.data.rejected.length === 2 && bad.data.settings.dailyCap === 20);

    const voiced = await call('/admin/marketing/settings', {
      method: 'PUT',
      auth: admin,
      body: { voiceNotes: '  Short sentences, no exclamation marks.  ' },
    });
    check(
      'voice notes are saved for the content cycle',
      voiced.data.rejected.length === 0 && voiced.data.settings.voiceNotes === 'Short sentences, no exclamation marks.',
      JSON.stringify(voiced.data),
    );

    const post = await call('/admin/marketing/messages', {
      method: 'POST',
      auth: admin,
      body: { channel: 'x', body: 'The last mile is the whole job.' },
    });
    check('a social post starts as a draft', post.status === 201 && post.data.message.status === 'draft');
    check('the publisher refuses an unauthenticated poll', (await call('/marketing/publisher/posts?channel=x')).status === 401);

    const rewritten = await call(`/admin/marketing/messages/${post.data.message.id}`, {
      method: 'PATCH',
      auth: admin,
      body: { body: 'The last mile is the whole job, rewritten.' },
    });
    check('a queued post can be rewritten on the desk', rewritten.status === 200 && rewritten.data.message.body === 'The last mile is the whole job, rewritten.', JSON.stringify(rewritten.data));
    const tooLong = await call(`/admin/marketing/messages/${post.data.message.id}`, { method: 'PATCH', auth: admin, body: { body: 'x'.repeat(281) } });
    check('a post too long for its channel is refused', tooLong.status === 400 && tooLong.data.error === 'too_long' && tooLong.data.max === 280);

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
    const late = await call(`/admin/marketing/messages/${post.data.message.id}`, { method: 'PATCH', auth: admin, body: { body: 'after' } });
    check('a sent post is the record and cannot be rewritten', late.status === 409);

    // Preview: exactly what leaves, footer and list headers included.
    const preview = await call(`/admin/marketing/messages/${firstEmail.id}`, { auth: admin });
    check(
      'an email preview shows the footer and the unsubscribe headers',
      preview.status === 200 && /Reply "no"/.test(preview.data.preview.text) && /mailto:hello@malipetek\.dev/.test(preview.data.preview.headers['List-Unsubscribe'] ?? ''),
      JSON.stringify(preview.data.preview ?? preview.data).slice(0, 400),
    );
    const handEdit = await call(`/admin/marketing/messages/${firstEmail.id}`, {
      method: 'PATCH',
      auth: admin,
      body: { subject: 'Your summer menu', body: 'Hi Sara,\n\nWritten by hand.\n\nAli' },
    });
    check('a queued email can be rewritten by hand', handEdit.status === 200 && handEdit.data.message.editedAt > 0, JSON.stringify(handEdit.data));
    await call('/admin/marketing/messages/rerender', { method: 'POST', auth: admin });
    const kept = (await call(`/admin/marketing/messages/${firstEmail.id}`, { auth: admin })).data.message;
    check('re-render leaves a hand-edited email alone', kept.subject === 'Your summer menu' && /Written by hand/.test(kept.body));
    const seqPreview = await call('/admin/marketing/sequences/preview?sequence=nosite', { auth: admin });
    check('a sequence previews every step for a real contact', seqPreview.status === 200 && seqPreview.data.steps.length === 3 && !seqPreview.data.steps.some((st) => st.body.includes('{{')));
    const sources = await call('/admin/marketing/sources', { auth: admin });
    check('sources report per-list counts', sources.status === 200 && sources.data.sources.reduce((n, row) => n + row.contacts, 0) >= 502, JSON.stringify(sources.data).slice(0, 300));
    check('a forged unsubscribe link is refused', (await call(`/marketing/u/${nobody.id}/000000000000000000000000`, { method: 'POST' })).status === 404);

    const draft = await call('/admin/marketing/messages', { method: 'POST', auth: admin, body: { channel: 'linkedin', body: 'A post to approve.' } });
    const approved = await call(`/admin/marketing/messages/${draft.data.message.id}/approve`, { method: 'POST', auth: admin });
    check('approving a drafted post schedules it', approved.status === 200 && approved.data.message.status === 'scheduled', JSON.stringify(approved.data));
    check('approving twice is refused', (await call(`/admin/marketing/messages/${draft.data.message.id}/approve`, { method: 'POST', auth: admin })).status === 409);
    await call(`/admin/marketing/messages/${draft.data.message.id}/cancel`, { method: 'POST', auth: admin });

    // Review mode: first emails in send order, and the gate on sending.
    const review = await call('/admin/marketing/review?limit=5', { auth: admin });
    check('the review queue lists unread first emails in send order', review.status === 200 && review.data.messages.length === 5 && review.data.messages.every((m) => m.step === 0 && !m.editedAt), JSON.stringify(review.data).slice(0, 300));
    const firstUp = review.data.messages[0];
    const marked = await call(`/admin/marketing/messages/${firstUp.id}/review`, { method: 'POST', auth: admin });
    check('reading an email marks it reviewed', marked.status === 200 && marked.data.message.reviewedAt > 0);
    const reviewAgain = await call('/admin/marketing/review?limit=5', { auth: admin });
    check('a reviewed email leaves the queue', !reviewAgain.data.messages.some((m) => m.id === firstUp.id));

    const page = await call('/admin/marketing/contacts', { auth: admin });
    check('contacts come in pages with a total', page.data.contacts.length === 200 && page.data.total >= 502, JSON.stringify({ n: page.data.contacts.length, total: page.data.total }));
    const page2 = await call('/admin/marketing/contacts?offset=200', { auth: admin });
    check('the next page holds other contacts', page2.data.contacts.length > 0 && !page2.data.contacts.some((c) => page.data.contacts.some((p) => p.id === c.id)));
    const detail = await call(`/admin/marketing/contacts/${firstUp.contactId}`, { auth: admin });
    check('a contact opens with its messages and events', detail.status === 200 && detail.data.messages.length === 3);
    const pick = page2.data.contacts.filter((c) => c.status === 'queued').slice(0, 3).map((c) => c.id);
    const bulkOut = await call('/admin/marketing/contacts/bulk', { method: 'POST', auth: admin, body: { action: 'opt_out', ids: pick } });
    const left = Number(sql(`SELECT 'left=' || COUNT(*) AS n FROM marketing_messages WHERE status = 'scheduled' AND contact_id IN (${pick.join(',')});`).toString().match(/left=(\d+)/)?.[1]);
    check('a bulk opt-out closes the contacts and cancels their mail', bulkOut.data.changed === 3 && left === 0, JSON.stringify(bulkOut.data) + ' left ' + left);
    const stats = await call('/admin/marketing/stats?days=7', { auth: admin });
    check('daily stats cover the asked days', stats.status === 200 && stats.data.days.length === 7);
    check('the replies view answers', (await call('/admin/marketing/replies', { auth: admin })).status === 200);

    const client = account(`desk-${Date.now()}@example.com`);
    check('a client cannot open the marketing desk', (await call('/admin/marketing', { auth: client.session })).status === 403);
  },

  async content({ admin }) {
    // The dev-site project the cycle ticket is filed against.
    sql(
      `INSERT INTO projects (id, slug, name, created_at) VALUES ('e2e-dev-site', 'malipetek-dev-site', 'malipetek.dev', ${Math.floor(Date.now() / 1000)})`,
    );

    await call('/admin/marketing/settings', { method: 'PUT', auth: admin, body: { voiceNotes: 'Keep it dry.' } });
    const filed = await call('/admin/marketing/cycle', { method: 'POST', auth: admin });
    check('a cycle is filed as an approved system ticket', filed.status === 201 && filed.data.filed === true && filed.data.id > 0, JSON.stringify(filed.data));
    const again = await call('/admin/marketing/cycle', { method: 'POST', auth: admin });
    check('a second call joins the open cycle instead of filing one', again.data.filed === false && again.data.reason === 'open_cycle' && again.data.id === filed.data.id, JSON.stringify(again.data));

    const ticket = (await call(`/admin/tickets/${filed.data.id}`, { auth: admin })).data;
    check(
      'the cycle ticket is approved, autonomous and on the dev-site project',
      ticket.ticket.status === 'approved' && ticket.ticket.kind === 'system' && ticket.ticket.source === 'dsh' && ticket.ticket.attention === 'auto' && ticket.ticket.project_slug === 'malipetek-dev-site',
      JSON.stringify(ticket.ticket),
    );
    const brief = ticket.messages.find((m) => m.author === 'ali')?.body ?? '';
    check('the brief asks for the outbox and the launch kit', /marketing\/launch\/proof\.md/.test(brief) && brief.includes('<<<OUTBOX'), brief.slice(0, 200));
    check('the brief carries the desk’s voice notes', brief.includes('Keep it dry.'), brief.slice(0, 400));
    check(
      'the brief frames each post as a first introduction, not a price sheet',
      brief.includes('never heard of this') && brief.includes('Pricing is not the subject'),
      brief.slice(0, 600),
    );
    check(
      'the brief makes the style guide and the vibe contracting name mandatory',
      brief.includes('marketing/style/README.md') && brief.includes('vibe contracting') && /stop-slop/.test(brief),
      brief.slice(0, 900),
    );

    await call(`/admin/tickets/${filed.data.id}/claim`, { method: 'POST', auth: admin, body: { executor: 'claude' } });
    const summary = [
      'Three posts written for the week.',
      '',
      '<<<OUTBOX',
      JSON.stringify({
        posts: [
          { channel: 'x', text: 'A one-minute fix billed by the second is $1.67.' },
          { channel: 'x', text: 'The bill is measured, not estimated.' },
          { channel: 'linkedin', text: 'First five pilot jobs ran between $2.18 and $8.25. Pilot jobs, not clients.' },
        ],
      }),
      'OUTBOX>>>',
      '— dsh on macbook',
    ].join('\n');
    const reported = await call(`/admin/tickets/${filed.data.id}/run-result`, { method: 'POST', auth: admin, body: { ok: true, summary } });
    check('the run reports back', reported.status === 200, JSON.stringify(reported.data));

    // Ask per post channel: the list is capped at 200, and other groups queue
    // thousands of emails that would push the posts off it.
    // Approval is on by default: the cycle's posts hold their slots as drafts.
    const scheduledPosts = async (status = 'draft') =>
      (
        await Promise.all(['x', 'linkedin'].map((ch) => call(`/admin/marketing/messages?channel=${ch}&status=${status}`, { auth: admin })))
      ).flatMap((r) => r.data.messages.filter((m) => m.campaign === 'auto'));
    const posts = await scheduledPosts();
    const now = Math.floor(Date.now() / 1000);
    check('three posts wait for approval in future slots', posts.length === 3 && posts.every((m) => m.scheduledAt > now), JSON.stringify(posts.map((m) => [m.channel, m.scheduledAt])));
    check('nothing from the cycle is scheduled before it is approved', (await scheduledPosts('scheduled')).length === 0);
    check('two go to X and one to LinkedIn', posts.filter((m) => m.channel === 'x').length === 2 && posts.filter((m) => m.channel === 'linkedin').length === 1);
    const done = (await call(`/admin/tickets/${filed.data.id}`, { auth: admin })).data.ticket;
    check('the cycle ticket closes itself as done', done.status === 'done');

    // A cycle whose reply has no outbox queues nothing and stays for Ali.
    const forced = await call('/admin/marketing/cycle?force=1', { method: 'POST', auth: admin });
    check('a forced call files a new cycle', forced.data.filed === true && forced.data.id !== filed.data.id);
    await call(`/admin/tickets/${forced.data.id}/claim`, { method: 'POST', auth: admin, body: { executor: 'claude' } });
    await call(`/admin/tickets/${forced.data.id}/run-result`, { method: 'POST', auth: admin, body: { ok: true, summary: 'I cannot write these right now.' } });
    const after = await scheduledPosts();
    const held = (await call(`/admin/tickets/${forced.data.id}`, { auth: admin })).data;
    check('a reply without an outbox queues nothing and leaves the ticket in review', after.length === 3 && held.ticket.status === 'review');
    check('the ticket says why nothing was queued', (held.messages.find((m) => m.author === 'system' && /no readable outbox/.test(m.body)) ?? null) !== null);
  },

  async previewFeedback() {
    const a = account(`preview-${Date.now()}@example.com`);
    const project = (await newProject(a.session, { kind: 'new', name: 'Feedback Cafe', brief: NEW_BRIEF })).data.project;
    const slug = `feedback-${Date.now() % 100000}`;
    const started = (await call(`/portal/projects/${project.id}/site`, { method: 'POST', auth: a.session, body: { name: 'Main', siteSlug: slug } })).data.site;
    await call(`/node/sites/${slug}/repo`, { method: 'POST', auth: RUNNER_TOKEN, body: { repo: `https://github.com/malipetek/${slug}` } });
    const site = (await call(`/portal/projects/${project.id}/sites`, { auth: a.session })).data.sites.find((s) => s.id === started.id);
    check(
      'a ready site hands out a feedback link but shows a clean preview address',
      site.state === 'ready' && /[?&]mf=/.test(site.feedbackUrl ?? '') && !/[?&]mf=/.test(site.previewUrl ?? ''),
      JSON.stringify(site),
    );
    const token = new URL(site.feedbackUrl).searchParams.get('mf');

    // The widget's own copy follows the client's locale, not English.
    await call('/portal/me', { method: 'PATCH', auth: a.session, body: { locale: 'tr' } });
    const configOrigin = site.previewUrl;
    const configRes = await fetch(`${W}/portal/preview-feedback/config?token=${token}`, {
      headers: { origin: configOrigin },
    });
    const config = await configRes.json();
    check(
      'the widget asks for its copy and gets the client’s language',
      configRes.status === 200 && config.locale === 'tr' && config.strings?.send === 'Talep gönder',
      JSON.stringify(config),
    );
    check(
      'the config may be read from the preview origin',
      configRes.headers.get('access-control-allow-origin') === configOrigin,
      `${configRes.status} ${configRes.headers.get('access-control-allow-origin')}`,
    );
    check(
      'an unknown site gets no copy',
      (await fetch(`${W}/portal/preview-feedback/config?token=${'f'.repeat(36)}`)).status === 404,
    );

    const form = new FormData();
    form.append('token', token);
    form.append('body', 'The hero image is cut off on mobile');
    form.append('page', `${site.previewUrl}/?from=portal&mf=${token}`);
    form.append('viewport', '390x844');
    form.append('files', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'screenshot.png');
    const previewOrigin = `${site.previewUrl}`;
    const res = await fetch(`${W}/portal/preview-feedback`, { method: 'POST', body: form, headers: { origin: previewOrigin } });
    const data = await res.json();
    check('the preview files a request', res.status === 201 && Number.isInteger(data.ticketId), JSON.stringify(data));
    check(
      'the preview origin may read the answer',
      res.headers.get('access-control-allow-origin') === previewOrigin,
      `${res.status} ${res.headers.get('access-control-allow-origin')}`,
    );

    const ticket = (await call(`/portal/tickets/${data.ticketId}`, { auth: a.session })).data;
    check(
      'it lands on the site’s project and site, waiting for approval',
      ticket.ticket.project_id === project.id && ticket.ticket.site_id === site.id && ticket.ticket.status === 'new',
      JSON.stringify(ticket.ticket),
    );
    check(
      'the thread has the note and the screenshot',
      ticket.messages.some((m) => /cut off/.test(m.body)) && ticket.messages.some((m) => m.files?.length === 1),
      JSON.stringify(ticket.messages),
    );
    check(
      'it records where the note was made, without the token',
      ticket.messages.some((m) => m.author === 'system' && /\/\?from=portal/.test(m.body) && !/mf=/.test(m.body)),
      JSON.stringify(ticket.messages),
    );

    const foreign = { origin: 'https://elsewhere.example' };
    const bad = new FormData();
    bad.append('token', 'f'.repeat(36));
    bad.append('body', 'anything');
    check('an unknown token is refused', (await fetch(`${W}/portal/preview-feedback`, { method: 'POST', body: bad, headers: foreign })).status === 404);

    const malformed = new FormData();
    malformed.append('token', 'not-a-token');
    malformed.append('body', 'anything');
    check('a malformed token is refused', (await fetch(`${W}/portal/preview-feedback`, { method: 'POST', body: malformed, headers: foreign })).status === 401);

    const empty = new FormData();
    empty.append('token', token);
    check('an empty note is refused', (await fetch(`${W}/portal/preview-feedback`, { method: 'POST', body: empty, headers: foreign })).status === 400);
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
    await call('/admin/settings', { method: 'PATCH', auth: admin, body: { clientPublish: false } });
    check('Ali can switch client publishing off', (await call(`/portal/projects/${project.id}/site/publish`, { method: 'POST', auth: a.session, body: {} })).status === 403);
    await call('/admin/settings', { method: 'PATCH', auth: admin, body: { clientPublish: true } });
    check('a bad sites domain is refused', (await call('/admin/settings', { method: 'PATCH', auth: admin, body: { sitesDomain: 'not a domain' } })).status !== 200);
    const pub = await call(`/admin/projects/${project.id}/site/publish`, { method: 'POST', auth: admin, body: {} });
    check('Ali publishes', pub.status === 200 && pub.data.productionUrl === 'https://rosa-florist.malipetek.online');
    check('…and his publish is on record as his', rows(`SELECT role, via FROM site_publishes WHERE project_id = '${project.id}' ORDER BY id DESC LIMIT 1`)[0]?.role === 'admin');
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
    const existingSite = await call(`/portal/projects/${existing.id}/site`, { method: 'POST', auth: a.session, body: {} });
    check('an existing project can be given a site too', existingSite.status === 201 && existingSite.data.site?.slug === 'old-shop', JSON.stringify(existingSite.data));
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

  async cloudflare({ admin }) {
    const a = account(`cf-${Date.now()}@example.com`);
    const other = account(`cf-other-${Date.now()}@example.com`);
    const first = await call('/portal/cloudflare', { auth: a.session });
    const link = new URL(first.data.connectUrl ?? 'http://x/');
    check('a client starts with no connection and a connect link', first.status === 200 && first.data.connections.length === 0 && link.pathname === '/oauth2/auth', JSON.stringify(first.data));
    check('the link asks for exactly our scopes', link.searchParams.get('scope') === 'account-settings.read memberships.read user-details.read workers-scripts.edit workers-scripts.admin workers-routes.write zone.read dns.write offline_access', link.searchParams.get('scope') ?? '');
    check('…returns to the Worker callback on the zone mount', link.searchParams.get('redirect_uri') === 'http://localhost:4321/api/portal/cloudflare/callback', link.searchParams.get('redirect_uri'));
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
    // A site in the client's own account: the placeholder is mirrored at once,
    // and the address they chose is the one that is taken. Expire the grant
    // first: the mirror must refresh it, not ask the client to reconnect.
    sql(`UPDATE cloudflare_connections SET expires_at = strftime('%s','now') - 60 WHERE id = ${listed[0].id}`);
    const slug = `rosa-${Date.now() % 100000}`;
    const created = await newProject(a.session, {
      kind: 'new',
      name: `Rosa ${slug}`,
      brief: NEW_BRIEF,
      repoMode: 'create',
      repoSource: 'ours',
    });
    const added = await call(`/portal/projects/${created.data.project.id}/site`, {
      method: 'POST',
      auth: a.session,
      body: { name: 'Main', siteSlug: slug, host: 'cloudflare', connectionId: listed[0].id },
    });
    const site = added.data.site;
    check(
      'a new site can be hosted in the client account',
      site?.host === 'cloudflare' && /\.e2e-sub\.workers\.dev$/.test(site?.previewUrl ?? ''),
      JSON.stringify(site),
    );
    const renewed = sql(`SELECT expires_at FROM cloudflare_connections WHERE id = ${listed[0].id}`)
      .toString()
      .match(/(\d{9,})/)?.[1];
    check('an expired grant is refreshed before the deploy', Number(renewed) > Math.floor(Date.now() / 1000), renewed);
    check(
      'the preview and production scripts were uploaded',
      CF.deploys.includes(`malipetek-${slug}-preview`) && CF.deploys.includes(`malipetek-${slug}`),
      JSON.stringify(CF.deploys),
    );
    check('the chosen address is taken', (await call(`/portal/site-address?slug=${slug}`, { auth: a.session })).data.available === false);
    check('another address is free', (await call(`/portal/site-address?slug=${slug}-free`, { auth: a.session })).data.available === true);
    await call(`/node/sites/${slug}/repo`, { method: 'POST', auth: RUNNER_TOKEN, body: { repo: `https://github.com/malipetek/${slug}` } });
    const hosted = (await call(`/portal/projects/${created.data.project.id}/site`, { auth: a.session })).data.site;
    check('the site is ready after the repo report', hosted?.state === 'ready' && hosted?.host === 'cloudflare', JSON.stringify(hosted));
    const moved = await call(`/portal/projects/${created.data.project.id}/site/host`, {
      method: 'POST',
      auth: a.session,
      body: { host: 'ours', siteId: site.id },
    });
    check(
      'the client can move it back to malipetek.online',
      moved.data.site?.host === 'ours' && /\.malipetek\.online$/.test(moved.data.site?.previewUrl ?? ''),
      JSON.stringify(moved.data.site),
    );
    check(
      'the admin sees the same host',
      (await call('/admin/projects', { auth: admin })).data.projects.find((p) => p.id === created.data.project.id)?.sites?.[0]?.host === 'ours',
    );

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

    // A private repo the nodes cannot clone: the queue says why, and connecting
    // GitHub links the project to that connection by itself.
    const { project, ticketId } = (await newProject(a.session, { kind: 'existing', name: `Private Site ${Date.now() % 100000}`, brief: OLD_BRIEF, repoKind: 'repo', repo: 'https://github.com/ClientAcct/private-site' })).data;
    await approve(admin, ticketId);
    const warned = async () => ((await call('/portal/github', { auth: a.session })).data.unconnected ?? []).some((p) => p.slug === project.slug);
    check('naming a repo alone raises no "connect GitHub" warning: a node may read it fine', !(await warned()));
    const failed = await call(`/node/projects/${project.slug}/clone-failed`, { method: 'POST', auth: RUNNER_TOKEN, body: { nodeId: 'macbook', error: 'private repo this machine has no access to' } });
    check('a node reports a failed clone', failed.status === 200);
    check('…and only then the portal asks the client to connect GitHub', await warned());
    await node(`e2e-gh-none-${Date.now() % 100000}`, []); // a live node that does not hold the folder
    const reason = (await call('/admin/queue', { auth: admin })).data.queue?.find((i) => i.id === ticketId)?.reason ?? '';
    check('the queue says the repo cannot be cloned, and what to do', /No node can clone https:\/\/github\.com\/ClientAcct\/private-site: macbook: private repo/.test(reason) && /connect GitHub/.test(reason), reason);
    const card = (await call('/admin/projects', { auth: admin })).data.projects.find((p) => p.id === project.id);
    check('the admin card says so too', card?.repoStatus?.state === 'failed' && /cannot clone/.test(card.repoStatus.detail), JSON.stringify(card?.repoStatus));
    sql(`UPDATE github_installations SET user_id = '${a.user.id}' WHERE id = 42424242;`);
    await call('/portal/github', { auth: a.session });
    const linked = (await call('/node/projects', { auth: RUNNER_TOKEN })).data.projects.find((p) => p.id === project.id);
    check('connecting GitHub links the project whose repo is under that account', linked?.githubApp === true, JSON.stringify(linked));
    check('…and clears the old clone failure', (await call('/admin/projects', { auth: admin })).data.projects.find((p) => p.id === project.id)?.repoStatus?.state === 'ready');
    const { project: other } = (await newProject(a.session, { kind: 'existing', name: `Elsewhere ${Date.now() % 100000}`, brief: OLD_BRIEF, repoKind: 'repo', repo: 'https://github.com/someoneelse/site' })).data;
    await call('/portal/github', { auth: a.session });
    check('a repo under another account is not linked', !(await call('/node/projects', { auth: RUNNER_TOKEN })).data.projects.find((p) => p.id === other.id)?.githubApp);
    await call(`/node/projects/${other.slug}/clone-failed`, { method: 'POST', auth: RUNNER_TOKEN, body: { nodeId: 'macbook', error: 'no access' } });
    await node(`e2e-gh-${Date.now() % 100000}`, [other.slug]);
    check('a node that holds the folder clears the failure', (await call('/admin/projects', { auth: admin })).data.projects.find((p) => p.id === other.id)?.repoStatus?.state === 'ready');
  },

  async health({ admin }) {
    const page = await call('/admin/health', { auth: admin });
    check('the health page answers with its checks', page.status === 200 && Array.isArray(page.data.checks), JSON.stringify(page.data).slice(0, 200));
    check('health is admin only', (await call('/admin/health')).status === 401);
    const shot = await call('/shot/1/before?t=nope');
    check('a screenshot URL needs a signed token', shot.status === 404);
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
    check('the node claims it after approval, on an executor it runs', c.ticket?.id === ticketId && c.executor === 'claude' && c.site === null);
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

    // The client's own assistant changes the site itself: its own request, no fleet run, review optional.
    const key = (await call('/portal/agent-tokens', { method: 'POST', auth: a.session, body: { label: 'ChatGPT' } })).data.token;
    const start = (body) => call('/portal/changes', { method: 'POST', auth: key, body: { projectId: project.id, title: 'Make the title red', summary: 'The client wants the product title in red.', ...body } });
    check('only an assistant starts a change, not a browser session', (await call('/portal/changes', { method: 'POST', auth: a.session, body: { projectId: project.id, title: 'x', summary: 'y' } })).status === 403);
    check('a change on someone else’s project is refused', (await start({ projectId: 'nope' })).status === 400);
    const own = await start({});
    const cid = own.data?.id;
    check('the assistant’s change is a request of its own, named for who made it', own.status === 201 && own.data.by === 'ChatGPT', JSON.stringify(own.data));
    const ownRow = (await call(`/portal/tickets/${cid}`, { auth: a.session })).data;
    check('…in progress, worked by the client’s agent, with no AI cost', ownRow.ticket.status === 'in_progress' && ownRow.ticket.worked_by === 'client_agent' && ownRow.ticket.source === 'assistant' && /no AI cost/.test(JSON.stringify(ownRow.messages)), JSON.stringify(ownRow.ticket));
    check('no fleet node ever claims it', (await claim(nodeId))?.ticket?.id !== cid);
    await call(`/portal/tickets/${cid}/change`, { method: 'POST', auth: key, body: { files: [{ path: 'src/pages/index.astro', content: '<h1 style="color:red">Bread</h1>' }] } });
    check('the change records who made it and which files', /ChatGPT sent a change \(1 file\): src\/pages\/index\.astro/.test(JSON.stringify((await call(`/portal/tickets/${cid}`, { auth: a.session })).data.messages)));
    await call(`/portal/tickets/${cid}/build`, { method: 'POST', auth: key, body: {} });
    check('the client cannot decide while the preview builds', (await call(`/portal/changes/${cid}/finish`, { method: 'POST', auth: key, body: { review: false } })).data?.error === 'still_building');
    await call(`/node/builds/${cid}/result`, { method: 'POST', auth: RUNNER_TOKEN, body: { nodeId, ok: true, previewUrl: 'https://preview-cafe--preview.malipetek.online' } });
    check('a built preview waits for the client, not for Ali', (await call(`/portal/tickets/${cid}`, { auth: a.session })).data.ticket.status === 'in_progress');
    const kept = await call(`/portal/changes/${cid}/finish`, { method: 'POST', auth: key, body: { review: false } });
    check('kept without review: closed, nothing to bill', kept.data?.status === 'done' && (await call(`/portal/tickets/${cid}`, { auth: a.session })).data.ticket.status === 'done', JSON.stringify(kept.data));
    check('…and decided once', (await call(`/portal/changes/${cid}/finish`, { method: 'POST', auth: key, body: { review: true } })).status === 409);
    const second = (await start({ title: 'Bigger button' })).data.id;
    const sent = await call(`/portal/changes/${second}/finish`, { method: 'POST', auth: key, body: { review: true } });
    const secondRow = (await call(`/portal/tickets/${second}`, { auth: a.session })).data.ticket;
    check('sent for review: in Ali’s review queue, every line read', sent.data?.status === 'review' && secondRow.status === 'review' && secondRow.attention === 'checked', JSON.stringify(secondRow));
    const listed = (await call('/admin/tickets', { auth: admin })).data.tickets?.find((t) => t.id === second);
    check('Ali’s board can tell the assistant made it', listed?.source === 'assistant', JSON.stringify(listed ?? {}).slice(0, 200));
    check('finish is only for an assistant’s own change', (await call(`/portal/changes/${ticketId}/finish`, { method: 'POST', auth: key, body: { review: false } })).status === 404);

    // The client publishes, and the record says who did it and what went live unreviewed.
    const pub = await call(`/portal/projects/${project.id}/site/publish`, { method: 'POST', auth: key, body: {} });
    check('the client publishes through their assistant, told what was unreviewed', pub.status === 200 && pub.data.unreviewed?.map((u) => u.id).join() === String(cid), JSON.stringify(pub.data));
    const logged = rows(`SELECT action, actor, role, via, unreviewed FROM site_publishes WHERE project_id = '${project.id}' ORDER BY id`);
    check('the publish is on record: who, through which app, which changes were unreviewed', logged.at(-1)?.action === 'publish' && logged.at(-1).actor === a.user.email && logged.at(-1).role === 'client' && logged.at(-1).via === 'ChatGPT' && logged.at(-1).unreviewed === `[${cid}]`, JSON.stringify(logged));
    check('the unreviewed change’s thread says it went live without review, and whose call it was', /Published to production by .* via ChatGPT, without a review/.test(JSON.stringify((await call(`/portal/tickets/${cid}`, { auth: a.session })).data.messages)));
    check('a change is listed as unreviewed once: the next publish has none', (await call(`/portal/projects/${project.id}/site/publish`, { method: 'POST', auth: key, body: {} })).data.unreviewed?.length === 0);
    const deployId = rows(`SELECT production_deploy FROM sites WHERE project_id = '${project.id}'`)[0]?.production_deploy;
    await call(`/portal/projects/${project.id}/site/rollback`, { method: 'POST', auth: a.session, body: { deployId } });
    check('a rollback from the portal is on record too', rows(`SELECT via FROM site_publishes WHERE project_id = '${project.id}' AND action = 'rollback'`)[0]?.via === 'portal');
    check('the change knows when its preview was built and when it went live', rows(`SELECT preview_built_at IS NOT NULL AS built, published_at IS NOT NULL AS live, assistant_app FROM tickets WHERE id = ${cid}`)[0]?.assistant_app === 'ChatGPT');
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

  async i18n({ admin }) {
    const until = async (read, ok) => {
      let last;
      for (let i = 0; i < 40; i += 1) {
        last = await read();
        if (ok(last)) return last;
        await sleep(150);
      }
      return last;
    };
    const asked = () => CF.deepseek.length;

    // An English client: nothing goes to a translator.
    const en = account(`i18n-en-${Date.now()}@example.com`);
    const before = asked();
    const enTicket = (await call('/portal/tickets', { method: 'POST', auth: en.session, body: { title: 'Fix the footer', body: 'Please fix it.' } })).data.id;
    await call(`/admin/tickets/${enTicket}/messages`, { method: 'POST', auth: admin, body: { body: 'On it.' } });
    await sleep(500);
    check('an English client’s thread is never sent to a translator', asked() === before, JSON.stringify(CF.deepseek.slice(before)));

    const a = account(`i18n-tr-${Date.now()}@example.com`);
    check('a bad locale is refused', (await call('/portal/me', { method: 'PATCH', auth: a.session, body: { locale: 'xx' } })).status === 400);
    const set = await call('/portal/me', { method: 'PATCH', auth: a.session, body: { locale: 'tr-TR' } });
    check('the client picks Turkish (tr-TR is stored as tr)', set.status === 200 && set.data.locale === 'tr', JSON.stringify(set.data));
    check('…and /portal/me says so', (await call('/portal/me', { auth: a.session })).data.user.locale === 'tr');

    const id = (await call('/portal/tickets', { method: 'POST', auth: a.session, body: { title: 'TR: Altbilgi', body: 'TR: Merhaba, `npm run build` bozuk.' } })).data.id;
    const seen = await until(
      () => call(`/admin/tickets/${id}`, { auth: admin }),
      (r) => r.data?.messages?.[0]?.original !== undefined && r.data.ticket.title_en,
    );
    const first = seen.data.messages[0];
    check('Ali reads the client’s message in English', first.body === '[en-US] TR: Merhaba, `npm run build` bozuk.', JSON.stringify(first));
    check('…with the original kept', first.original === 'TR: Merhaba, `npm run build` bozuk.' && first.translatedFrom === 'tr');
    check('…and the title in English', seen.data.ticket.title_en === '[en-US] TR: Altbilgi', seen.data.ticket.title_en);
    check('code never reaches the translator', CF.deepseek.every((c) => !c.text.includes('npm run build')), JSON.stringify(CF.deepseek.slice(-3)));
    const own = (await call(`/portal/tickets/${id}`, { auth: a.session })).data.messages[0];
    check('the client sees their own message as written', own.body === 'TR: Merhaba, `npm run build` bozuk.' && own.original === undefined);

    await call(`/admin/tickets/${id}/messages`, { method: 'POST', auth: admin, body: { body: 'Fixed, see src/pages/index.astro.' } });
    await call(`/admin/tickets/${id}/messages`, { method: 'POST', auth: admin, body: { body: 'private note', internal: true } });
    const thread = await until(
      () => call(`/portal/tickets/${id}`, { auth: a.session }),
      (r) => r.data?.messages?.some((m) => m.author === 'ali' && m.original !== undefined),
    );
    const answer = thread.data.messages.find((m) => m.author === 'ali');
    check('the client reads Ali’s reply in Turkish', answer?.body === '[tr] Fixed, see src/pages/index.astro.', JSON.stringify(answer));
    check('…and can open the original', answer?.original === 'Fixed, see src/pages/index.astro.');
    check('a private note is never translated toward the client', !CF.deepseek.some((c) => c.text.includes('private note')));

    await approve(admin, id);
    const claimed = await call(`/admin/tickets/${id}/claim`, { method: 'POST', auth: admin, body: {} });
    const brief = claimed.data?.messages?.find((m) => m.author === 'client');
    check('the agent’s brief is in English', brief?.body === '[en-US] TR: Merhaba, `npm run build` bozuk.', JSON.stringify(claimed.data?.messages));
    check('…and so is its title', claimed.data?.ticket?.title === '[en-US] TR: Altbilgi', JSON.stringify(claimed.data?.ticket));

    // Opting out: nothing more goes to a translator.
    await call('/portal/me', { method: 'PATCH', auth: a.session, body: { translation: 'off' } });
    const n = asked();
    await call(`/portal/tickets/${id}/messages`, { method: 'POST', auth: a.session, body: { body: 'TR: Teşekkürler' } });
    await sleep(500);
    check('with translation off, nothing is sent', asked() === n);
    check('bad translation settings are refused', (await call('/portal/me', { method: 'PATCH', auth: a.session, body: { translation: 'google' } })).status === 400);
    const byAli = await call(`/admin/clients/${a.user.id}`, { method: 'PATCH', auth: admin, body: { locale: 'de-DE', translation: 'deepseek' } });
    check('Ali can set a client’s language', byAli.status === 200 && byAli.data.locale === 'de-DE', JSON.stringify(byAli.data));
  },

  async usage({ admin }) {
    const a = account(`usage-${Date.now()}@example.com`);
    const { project } = (await newProject(a.session, { kind: 'existing', name: 'Usage Shop', brief: OLD_BRIEF, repoKind: 'none' })).data;
    const mk = async (title) => (await call('/portal/tickets', { method: 'POST', auth: a.session, body: { title, body: 'x', projectId: project.id } })).data.id;
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
    check('declined work owes nothing', u.tickets === 3 && u.aiCents === 44, JSON.stringify(u));
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
    const rpcOn = async (base, method, params, auth) => {
      const res = await fetch(`${W}${base}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
      });
      return res.json();
    };
    const rpc = (method, params, auth) => rpcOn('/mcp', method, params, auth);
    const tool = async (name, args, auth = token) => {
      const r = await rpc('tools/call', { name, arguments: args }, auth);
      const text = r.result?.content?.[0]?.text ?? '';
      let value = text;
      try { value = JSON.parse(text); } catch {}
      return { error: r.result?.isError === true, value, text };
    };
    const names = (await rpc('tools/list', {}, null)).result.tools.map((t) => t.name);
    check('the portal lists its own tools and no knowledgebase tools', names.includes('portal_file_request') && !names.some((n) => n.endsWith('_knowledge')), names.join());
    check('an assistant can start and finish its own changes', names.includes('start_change') && names.includes('finish_change'));
    const anonTools = (await rpc('tools/list', {}, null)).result.tools;
    const boardTool = anonTools.find((t) => t.name === 'portal_board');
    check(
      'the board opens from the sidebar and the thread panel',
      boardTool?._meta?.['openai/ui']?.entrypoints?.map((e) => e.type).join() === 'global,thread',
      JSON.stringify(boardTool?._meta),
    );
    check(
      'every portal tool asks for OAuth',
      anonTools.every((t) => JSON.stringify(t.securitySchemes) === JSON.stringify([{ type: 'oauth2', scopes: ['portal'] }])),
      JSON.stringify(anonTools.filter((t) => t.securitySchemes?.[0]?.type !== 'oauth2').map((t) => t.name)),
    );
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } }, token);
    check('initialize says changes cost nothing, review is optional and notices come by email', /costs nothing on malipetek/.test(init.result?.instructions ?? '') && /billed as Ali's time/.test(init.result?.instructions ?? '') && /by email/.test(init.result?.instructions ?? ''));
    check('the portal introduces itself as the client portal, version 1.2.0', init.result?.serverInfo?.title === 'malipetek.dev client portal' && init.result?.serverInfo?.version === '1.2.0', JSON.stringify(init.result?.serverInfo));
    check('…and never mentions the knowledgebase', !/knowledgebase/i.test(init.result?.instructions ?? ''));
    const portalResources = (await rpc('resources/list', {}, null)).result?.resources ?? [];
    check('the portal publishes the board as its one resource', portalResources.length === 1 && /^ui:\/\//.test(portalResources[0]?.uri ?? ''), JSON.stringify(portalResources));
    check('the portal advertises no kb:// template and no prompt', (await rpc('resources/templates/list', {}, null)).result?.resourceTemplates?.length === 0 && (await rpc('prompts/list', {}, null)).result?.prompts?.length === 0);

    /* The knowledgebase has its own server now (lab.malipetek.dev/mcp → /kb-mcp). */
    const kbNames = (await rpcOn('/kb-mcp', 'tools/list', {}, null)).result.tools.map((t) => t.name);
    check(
      'the knowledgebase server lists the KB read tools and no portal tools',
      ['search_knowledge', 'get_knowledge', 'list_knowledge'].every((n) => kbNames.includes(n)) && !kbNames.some((n) => n.startsWith('portal_') || n.startsWith('owner_') || n === 'submit_change'),
      kbNames.join(),
    );
    check('…and keeps its write tools for an ack_ key, not an anonymous caller', !kbNames.includes('create_knowledge') && !kbNames.includes('update_knowledge'));
    const kbInit = await rpcOn('/kb-mcp', 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } }, null);
    const kbInstructions = String(kbInit.result?.instructions ?? '').trim();
    check(
      'the KB server introduces itself as malipetek lab and points website work at the portal',
      kbInit.result?.serverInfo?.name === 'malipetek-lab-kb' && /For website work done for you, the contracting service is a separate server: https:\/\/malipetek\.dev\/mcp\.$/.test(kbInstructions),
      JSON.stringify(kbInit.result?.serverInfo),
    );
    check('the KB instructions mention no portal tool', !/portal_|start_change|submit_change|site_publish/.test(kbInstructions));
    const kbRead = (await rpcOn('/kb-mcp', 'tools/call', { name: 'list_knowledge', arguments: { limit: 1 } }, null)).result;
    check('the KB server answers a public read', kbRead?.isError !== true && kbRead?.content?.[0]?.type === 'text', JSON.stringify(kbRead).slice(0, 160));
    check(
      'the KB server advertises its entry template and prompt',
      (await rpcOn('/kb-mcp', 'resources/templates/list', {}, null)).result?.resourceTemplates?.[0]?.uriTemplate === 'kb://entry/{slug}' &&
        (await rpcOn('/kb-mcp', 'prompts/list', {}, null)).result?.prompts?.[0]?.name === 'record_learning',
    );
    const minted = await call('/kb/keys', { method: 'POST', auth: admin, body: { agent_name: 'e2e-kb' } });
    const ack = minted.data?.key;
    const authorNames = (await rpcOn('/kb-mcp', 'tools/list', {}, ack)).result.tools.map((t) => t.name);
    check('an ack_ key unlocks the KB write tools', authorNames.includes('create_knowledge') && authorNames.includes('update_knowledge'), authorNames.join());
    const wrote = await rpcOn('/kb-mcp', 'tools/call', { name: 'create_knowledge', arguments: { title: 'E2E split check', problem: 'p', solution: 's', status: 'solved', author_agent: 'e2e' } }, ack);
    check('…and writes through the KB server', wrote.result?.isError !== true, JSON.stringify(wrote).slice(0, 160));
    const legacyKb = await tool('search_knowledge', { query: 'wrangler' }, null);
    check('a knowledgebase tool is still callable on /mcp for a connector set up before the split', !legacyKb.error && Array.isArray(legacyKb.value?.entries), legacyKb.text.slice(0, 160));

    const filed = await tool('portal_file_request', { title: 'Add opening hours', body: 'Mon–Fri 9–5 on the contact page.', project_id: project.id, attention: 'auto', budget_usd: 20 });
    const rid = filed.value?.request_id;
    check('an assistant files a request', !filed.error && Number.isInteger(rid), filed.text);
    const read = await tool('portal_request', { request_id: rid });
    check(
      '…which starts at once on Autopilot under the cap, with its budget and attention',
      !read.error && read.value.ticket.status === 'approved' && read.value.ticket.budget_cents === 2000 && read.value.ticket.attention === 'auto',
      read.text.slice(0, 200),
    );
    check('it lists the account’s requests', (await tool('portal_requests', {})).value.tickets?.some((t) => t.id === rid));
    check('it lists projects with their setup', (await tool('portal_projects', {})).value.projects?.some((p) => p.id === project.id && p.setup));
    const profile = await tool('portal_profile', {});
    check('the profile tool names the account stably', !profile.error && /^mpt_[\w-]{8,}$/.test(profile.value?.id ?? ''), profile.text);
    const view = await rpc('resources/read', { uri: boardTool?._meta?.ui?.resourceUri ?? '' }, token);
    const contents = view.result?.contents?.[0];
    check(
      'the view is served as an MCP App with its display modes',
      contents?.mimeType === 'text/html;profile=mcp-app' &&
        /^<!DOCTYPE html>/.test(contents?.text ?? '') &&
        contents?._meta?.['openai/ui']?.availableDisplayModes?.includes('fullscreen'),
    );
    const board = await rpc('tools/call', { name: 'portal_board', arguments: {} }, token);
    // Claude starts sign-in only on an HTTP 401; ChatGPT keeps the in-result challenge.
    const asClaude = (auth) =>
      fetch(`${W}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'claude-code/2.1.0', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name: 'portal_board', arguments: {} } }),
      });
    const refused = await asClaude(null);
    check('Claude without a token gets a 401 pointing at the sign-in metadata', refused.status === 401 && /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/.test(refused.headers.get('www-authenticate') ?? '') && /scope="portal"/.test(refused.headers.get('www-authenticate') ?? ''), refused.headers.get('www-authenticate'));
    check('…and with a revoked or made-up token too', (await asClaude('cat_not_a_real_token')).status === 401);
    const claudeBoard = await asClaude(token);
    check('Claude with a live token gets the board', claudeBoard.status === 200 && (await claudeBoard.json()).result?.structuredContent?.requests !== undefined);
    const chatgptStyle = await rpc('tools/call', { name: 'portal_board', arguments: {} }, null);
    check('other clients still get the challenge inside a 200 result', chatgptStyle.result?.isError === true && Boolean(chatgptStyle.result?._meta?.['mcp/www_authenticate']));
    const publicForClaude = await fetch(`${W}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'Claude-User' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name: 'search_knowledge', arguments: { query: 'wrangler' } } }) });
    check('Claude calls the public tools without signing in', publicForClaude.status === 200);
    check('the board answers with structured card data and a text fallback', board.result?.structuredContent?.requests?.some((r) => r.id === rid) && /#\d+ Add opening hours/.test(board.result?.content?.[0]?.text ?? ''), JSON.stringify(board.result?.structuredContent ?? {}).slice(0, 200));
    const card = board.result?.structuredContent ?? {};
    check(
      'the overview gets project ids for the 3D belts and the spending totals',
      card.requests?.find((r) => r.id === rid)?.project_id === project.id &&
        ['billed_cents', 'open_cents', 'ai_cents'].every((k) => Number.isInteger(card.spending?.[k])),
      JSON.stringify({ spending: card.spending, req: card.requests?.find((r) => r.id === rid) }).slice(0, 300),
    );
    check(
      'the card gets its copy in _meta, in English by default and in the host’s language while the client keeps the default',
      board.result?._meta?.['malipetek/strings']?.['tab.overview'] === 'Overview' &&
        board.result._meta['malipetek/strings']['status.review'] === 'In review' &&
        (await rpc('tools/call', { name: 'portal_board', arguments: {}, _meta: { 'openai/locale': 'tr-TR' } }, token)).result?._meta?.['malipetek/locale'] === 'tr',
      JSON.stringify(board.result?._meta?.['malipetek/locale']),
    );
    const focused = (await rpc('tools/call', { name: 'portal_board', arguments: { request_id: rid } }, token)).result;
    check('the board opens on one request’s conversation when asked', focused?.structuredContent?.focus === rid && card.focus === null && /The card is open on #/.test(focused?.content?.[0]?.text ?? ''), JSON.stringify(focused?.structuredContent?.focus));
    check('…and ignores a request that is not theirs', (await rpc('tools/call', { name: 'portal_board', arguments: { request_id: 999999 } }, token)).result?.structuredContent?.focus === null);
    check(
      'the board carries projects with setup, sites, and requests with real times',
      boardTool?.title === 'malipetek development' &&
        card.projects?.some((p) => p.id === project.id && p.open >= 1 && typeof p.setup?.total === 'number') &&
        Array.isArray(card.sites) &&
        !Number.isNaN(Date.parse(card.requests?.find((r) => r.id === rid)?.updated_at ?? '')),
      JSON.stringify({ title: boardTool?.title, projects: card.projects, sites: card.sites?.length }).slice(0, 300),
    );
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
    check('an agent key cannot write the knowledgebase', kb.result?.isError === true && /ack_ API key/.test(kb.result?.content?.[0]?.text ?? ''), JSON.stringify(kb).slice(0, 200));
    const anon = await rpc('tools/call', { name: 'portal_requests', arguments: {} }, null);
    const challenge = anon.result?._meta?.['mcp/www_authenticate']?.[0] ?? '';
    check(
      'no key → an OAuth challenge ChatGPT can act on',
      anon.result?.isError === true && /resource_metadata="https?:\/\/[^"]+"/.test(challenge) && /error_description=/.test(challenge),
      challenge || JSON.stringify(anon.result),
    );

    await call(`/portal/agent-tokens/${listed[0].id}`, { method: 'DELETE', auth: a.session });
    const after = await tool('portal_requests', {});
    check('a revoked key stops working at once', after.error && /Authentication required/.test(after.text), after.text);
    check('another client cannot revoke your key', (await call(`/portal/agent-tokens/${listed[0].id}`, { method: 'DELETE', auth: other.session })).status === 404);
  },

  async oauth({ admin }) {
    const SITE = 'http://localhost:4321'; // SITE_URL in the injected vars
    const a = account(`oauth-${Date.now()}@example.com`);
    const agent = (await call('/portal/agent-tokens', { method: 'POST', auth: a.session, body: { label: 'Pasted key' } })).data.token;
    const pr = (await call('/.well-known/oauth-protected-resource/mcp')).data;
    check('discovery: the resource names its authorization server', pr?.resource === `${SITE}/mcp` && pr.authorization_servers?.[0] === SITE);
    const meta = (await call('/.well-known/oauth-authorization-server')).data;
    check('discovery: PKCE S256, public clients, dynamic registration', meta?.authorization_endpoint === `${SITE}/portal/authorize` && meta.code_challenge_methods_supported?.join() === 'S256' && meta.registration_endpoint === `${SITE}/api/oauth/register` && meta.token_endpoint === `${SITE}/api/oauth/token`);

    check('discovery: a CORS preflight on the token endpoint is a 204', (await fetch(`${W}/oauth/token`, { method: 'OPTIONS' })).status === 204);

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
      // A project's runs share one folder (fleet/node.mjs runFolder).
      check('the settings file is back where it was', existsSync(join(dir, 'wt', project.slug, '.claude', 'settings.local.json')));
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

  async translations({ admin }) {
    const status = await call('/admin/i18n', { auth: admin });
    check('the translation status answers', status.status === 200 && typeof status.data.ready === 'boolean' && 'last' in status.data, JSON.stringify(status.data));
    const asked = await call('/admin/i18n/sync', { method: 'POST', auth: admin, body: {} });
    check(
      'Translate now queues a run, or says what is missing',
      status.data.ready ? asked.status === 200 && asked.data.requestedAt > 0 : asked.status === 409 && asked.data.error === 'not_configured',
      JSON.stringify(asked.data),
    );
    check('translation is by hand unless switched on', status.data.auto === false, JSON.stringify(status.data));
    const on = await call('/admin/i18n', { method: 'PUT', auth: admin, body: { auto: true } });
    const off = await call('/admin/i18n', { method: 'PUT', auth: admin, body: { auto: false } });
    check('the auto switch turns on and off', on.data.auto === true && off.data.auto === false, JSON.stringify([on.data, off.data]));
    check('a bad switch value is refused', (await call('/admin/i18n', { method: 'PUT', auth: admin, body: { auto: 'yes' } })).status === 400);
    const someone = account(`i18n-${Date.now()}@example.com`);
    check('only Ali can ask', (await call('/admin/i18n/sync', { method: 'POST', auth: someone.session, body: {} })).status === 403);
  },

  async projectPeople({ admin }) {
    const stamp = Date.now();
    const owner = account(`people-owner-${stamp}@example.com`);
    const shop = (await newProject(owner.session, { kind: 'existing', name: `People Shop ${stamp}`, brief: OLD_BRIEF, repoKind: 'none' })).data;
    const id = shop.project.id;
    const row = async (email) =>
      (await call('/admin/projects', { auth: admin })).data.projects.find((p) => p.id === id)?.clients.find((c) => c.email === email);

    // Hand edits: name and kind, never the slug.
    const edited = await call(`/admin/projects/${id}`, { method: 'PATCH', auth: admin, body: { name: `Renamed ${stamp}`, kind: 'new', slug: 'nope' } });
    check(
      'Ali can rename a project and change its kind',
      edited.status === 200 && edited.data.project?.name === `Renamed ${stamp}` && edited.data.project.kind === 'new' && edited.data.project.slug === shop.project.slug,
      JSON.stringify(edited.data),
    );
    check('a bad kind is refused', (await call(`/admin/projects/${id}`, { method: 'PATCH', auth: admin, body: { kind: 'castle' } })).status === 400);
    check('an empty edit is refused', (await call(`/admin/projects/${id}`, { method: 'PATCH', auth: admin, body: {} })).status === 400);
    check('a client cannot edit projects', (await call(`/admin/projects/${id}`, { method: 'PATCH', auth: owner.session, body: { name: 'x' } })).status === 403);

    // Several addresses on one project, one of them with copies.
    const a = `people-a-${stamp}@example.com`;
    const b = `people-b-${stamp}@example.com`;
    const addA = await call('/admin/clients', { method: 'POST', auth: admin, body: { email: a, projectIds: [id], copy: true } });
    const addB = await call('/admin/clients', { method: 'POST', auth: admin, body: { email: b, projectIds: [id] } });
    check('two more addresses join the project', addA.status === 201 && addB.status === 201, JSON.stringify([addA.data, addB.data]));
    const ra = await row(a);
    const rb = await row(b);
    check('copies are on only where asked', ra?.copy === true && rb?.copy === false, JSON.stringify([ra, rb]));

    const userB = addB.data.user.id;
    const on = await call(`/admin/clients/${userB}/projects/${id}`, { method: 'PUT', auth: admin, body: { copy: true } });
    check('the copies switch turns on', on.status === 200 && on.data.copy === true && (await row(b))?.copy === true, JSON.stringify(on.data));
    const keep = await call(`/admin/clients/${userB}/projects/${id}`, { method: 'PUT', auth: admin });
    check('relinking without it keeps the setting', keep.data.copy === true);
    const off = await call(`/admin/clients/${userB}/projects/${id}`, { method: 'PUT', auth: admin, body: { copy: false } });
    check('…and turns off', off.data.copy === false && (await row(b))?.copy === false);
    check('a non-boolean copy is refused', (await call(`/admin/clients/${userB}/projects/${id}`, { method: 'PUT', auth: admin, body: { copy: 'yes' } })).status === 400);

    // Re-inviting without copy never turns copies off.
    await call('/admin/clients', { method: 'POST', auth: admin, body: { email: a, projectIds: [id] } });
    check('a second invite leaves copies on', (await row(a))?.copy === true);

    // Who a request's emails are copied to: the same query as copyRecipients in portal.ts.
    const ticket = (await call('/portal/tickets', { method: 'POST', auth: owner.session, body: { title: 'Copied request', body: 'x', projectId: id } })).data.id;
    await call(`/admin/clients/${userB}/projects/${id}`, { method: 'PUT', auth: admin, body: { copy: true } });
    sql(`UPDATE user_projects SET copy_mail = 1 WHERE project_id = '${id}' AND user_id = '${owner.user.id}'`);
    const copied = String(
      sql(`SELECT u.email FROM tickets t JOIN projects p ON p.id = t.project_id
             JOIN user_projects up ON up.project_id = t.project_id AND up.copy_mail = 1
             JOIN users u ON u.id = up.user_id
            WHERE t.id = ${ticket} AND t.kind = 'client' AND u.role = 'client' AND u.id <> t.user_id`),
    );
    check('copies go to the others with copies on, never the author', copied.includes(a) && copied.includes(b) && !copied.includes(owner.user.email), copied);

    await call(`/admin/clients/${userB}/projects/${id}`, { method: 'DELETE', auth: admin });
    check('removing an address takes it off the project', (await row(b)) === undefined);
  },

  async invites({ admin }) {
    const stamp = Date.now();
    const owner = account(`invite-owner-${stamp}@example.com`);
    const shop = (await newProject(owner.session, { kind: 'existing', name: `Invite Shop ${stamp}`, brief: OLD_BRIEF, repoKind: 'none' })).data;
    const other = (await newProject(owner.session, { kind: 'existing', name: `Invite Other ${stamp}`, brief: OLD_BRIEF, repoKind: 'none' })).data;
    const onShop = (await call('/portal/tickets', { method: 'POST', auth: owner.session, body: { title: 'Shop request', body: 'x', projectId: shop.project.id } })).data.id;
    const onOther = (await call('/portal/tickets', { method: 'POST', auth: owner.session, body: { title: 'Other request', body: 'x', projectId: other.project.id } })).data.id;
    const loose = (await call('/portal/tickets', { method: 'POST', auth: owner.session, body: { title: 'Loose request', body: 'x' } })).data.id;
    // A bill on the shared request, so its privacy can be checked.
    sql(`UPDATE tickets SET human_seconds = 3600, ai_micro_usd = 500000, price_cents = 1234, budget_cents = 9999 WHERE id = ${onShop}`);

    const tokenOf = (link) => new URL(link).hash.match(/token=([^&]+)/)[1];
    const now = Math.floor(Date.now() / 1000);

    // A new address: the account is made with the invite, then the link signs them in.
    const email = `invite-new-${stamp}@example.com`;
    const made = await call('/admin/clients', {
      method: 'POST',
      auth: admin,
      body: { email, name: 'Invited Person', locale: 'de-DE', projectIds: [shop.project.id], note: 'Start with the checkout page.' },
    });
    check(
      'an invite makes a client account and links the project',
      made.status === 201 &&
        made.data.user?.role === 'client' &&
        made.data.user.locale === 'de-DE' &&
        made.data.projects.map((p) => p.id).join() === shop.project.id &&
        typeof made.data.invite?.sent === 'boolean',
      JSON.stringify(made.data),
    );
    check(
      '…with a link that lasts a week',
      /#token=/.test(made.data.invite?.devLink ?? '') && Math.abs(made.data.invite.expiresAt - (now + 7 * 86400)) < 120,
      JSON.stringify(made.data.invite),
    );
    const pendingRow = (await call('/admin/clients', { auth: admin })).data.clients.find((c) => c.email === email);
    check(
      'the directory shows it pending until they sign in',
      pendingRow?.pending === true && pendingRow.invitedAt > 0 && pendingRow.verified_at === null && pendingRow.inviteExpiresAt === made.data.invite.expiresAt,
      JSON.stringify(pendingRow),
    );
    const card = (await call('/admin/projects', { auth: admin })).data.projects.find((p) => p.id === shop.project.id);
    check(
      'the project card lists the client who holds it',
      card?.clients?.some((c) => c.email === email && c.pending === true),
      JSON.stringify(card?.clients),
    );

    const invitedToken = tokenOf(made.data.invite.devLink);
    const verified = await call('/auth/verify', { method: 'POST', body: { token: invitedToken } });
    check(
      'the invite link lands them signed in as a client',
      verified.status === 200 && verified.data.user?.email === email && verified.data.user.role === 'client' && typeof verified.data.session === 'string',
      JSON.stringify(verified.data),
    );
    check('the invite link works once', (await call('/auth/verify', { method: 'POST', body: { token: invitedToken } })).status === 401);
    const after = (await call('/admin/clients', { auth: admin })).data.clients.find((c) => c.email === email);
    check('signing in clears pending and spends the link', after?.pending === false && after.verified_at !== null && after.inviteExpiresAt === null, JSON.stringify(after));

    // The point of the invite: the project's whole history, nothing else.
    const me = (await call('/portal/me', { auth: verified.data.session })).data;
    check(
      'they land on their project and not on the other one',
      me.projects.some((p) => p.id === shop.project.id) && !me.projects.some((p) => p.id === other.project.id),
      JSON.stringify(me.projects.map((p) => p.id)),
    );
    const listed = (await call('/portal/tickets', { auth: verified.data.session })).data.tickets;
    check(
      'they see every request on their project, and no others',
      listed.some((t) => t.id === onShop) && !listed.some((t) => t.id === onOther) && !listed.some((t) => t.id === loose),
      JSON.stringify(listed.map((t) => t.id)),
    );
    check('another client’s request is marked as theirs', listed.find((t) => t.id === onShop)?.mine === false, JSON.stringify(listed.find((t) => t.id === onShop)));
    const detail = await call(`/portal/tickets/${onShop}`, { auth: verified.data.session });
    check(
      'the thread opens for the project member',
      detail.status === 200 && detail.data.ticket?.id === onShop && detail.data.messages?.length >= 1,
      JSON.stringify(detail.data).slice(0, 300),
    );
    check(
      '…without its price, time, AI cost or budget',
      detail.data.ticket.price_cents === null && detail.data.ticket.human_seconds === 0 && detail.data.ticket.ai_micro_usd === 0 && detail.data.ticket.budget_cents === null,
      JSON.stringify(detail.data.ticket),
    );
    check('a request on a project they are not on stays invisible', (await call(`/portal/tickets/${onOther}`, { auth: verified.data.session })).status === 404);
    check('a request with no project stays private', (await call(`/portal/tickets/${loose}`, { auth: verified.data.session })).status === 404);
    check(
      'they cannot reply on someone else’s request',
      (await call(`/portal/tickets/${onShop}/messages`, { method: 'POST', auth: verified.data.session, body: { body: 'hi' } })).status === 403,
    );
    check(
      'the author still sees their own request with its bill',
      (await call(`/portal/tickets/${onShop}`, { auth: owner.session })).data.ticket.price_cents === 1234,
    );

    // An address that already has an account keeps everything but gains the projects.
    const existing = account(`invite-existing-${stamp}@example.com`);
    const again = await call('/admin/clients', {
      method: 'POST',
      auth: admin,
      body: { email: existing.user.email, name: 'A New Name', locale: 'tr', projectIds: [other.project.id, shop.project.id] },
    });
    check(
      'inviting an existing address attaches the projects',
      again.status === 200 && again.data.user?.id === existing.user.id && again.data.projects.length === 2,
      JSON.stringify(again.data),
    );
    const kept = (await call('/admin/clients', { auth: admin })).data.clients.find((c) => c.id === existing.user.id);
    check(
      '…and never changes its role, name or language',
      kept?.role === 'client' && kept.name === null && kept.locale === 'en-US' && kept.pending === false,
      JSON.stringify(kept),
    );
    const inbox = (await call('/portal/tickets', { auth: existing.session })).data.tickets.map((t) => t.id);
    check('…and its history now covers both projects', inbox.includes(onShop) && inbox.includes(onOther) && !inbox.includes(loose));

    const adminInvite = await call('/admin/clients', { method: 'POST', auth: admin, body: { email: 'malipetek@gmail.com', projectIds: [shop.project.id] } });
    check('the admin address cannot be invited', adminInvite.status === 400 && adminInvite.data.error === 'admin_email', JSON.stringify(adminInvite.data));

    // Expiry is the token's own; an old invite is refused like an old sign-in link.
    const expiredToken = `expired-${stamp}`;
    sql(
      `INSERT INTO login_tokens (token_hash, email, expires_at, purpose) VALUES ('${createHash('sha256').update(expiredToken).digest('hex')}', 'late-${stamp}@example.com', ${now - 60}, 'invite');`,
    );
    check('an expired invite is refused', (await call('/auth/verify', { method: 'POST', body: { token: expiredToken } })).status === 401);

    // Resend: a new link, and the old one stops working.
    const resendEmail = `invite-resend-${stamp}@example.com`;
    const first = await call('/admin/clients', { method: 'POST', auth: admin, body: { email: resendEmail, projectIds: [shop.project.id] } });
    const resent = await call(`/admin/clients/${first.data.user.id}/invite`, { method: 'POST', auth: admin });
    check(
      'a resend mints a fresh link',
      resent.status === 200 && /#token=/.test(resent.data.invite?.devLink ?? '') && resent.data.invite.devLink !== first.data.invite.devLink,
      JSON.stringify(resent.data),
    );
    check('the resent link works', (await call('/auth/verify', { method: 'POST', body: { token: tokenOf(resent.data.invite.devLink) } })).status === 200);
    check('the old link is dead', (await call('/auth/verify', { method: 'POST', body: { token: tokenOf(first.data.invite.devLink) } })).status === 401);

    // Revoke: every unused link stops working.
    const revokeEmail = `invite-revoke-${stamp}@example.com`;
    const toRevoke = await call('/admin/clients', { method: 'POST', auth: admin, body: { email: revokeEmail, projectIds: [shop.project.id] } });
    const revoked = await call(`/admin/clients/${toRevoke.data.user.id}/invite`, { method: 'DELETE', auth: admin });
    check('revoking takes away the unused link', revoked.status === 200 && revoked.data.revoked >= 1, JSON.stringify(revoked.data));
    check('the revoked link no longer signs in', (await call('/auth/verify', { method: 'POST', body: { token: tokenOf(toRevoke.data.invite.devLink) } })).status === 401);

    // A magic link proves the address, not the right to change an account's role.
    const keeper = account(`invite-keeper-${stamp}@example.com`);
    sql(`UPDATE users SET role = 'admin' WHERE id = '${keeper.user.id}'`);
    const keeperToken = `keeper-${stamp}`;
    sql(
      `INSERT INTO login_tokens (token_hash, email, expires_at, purpose) VALUES ('${createHash('sha256').update(keeperToken).digest('hex')}', '${keeper.user.email}', ${now + 600}, 'signin');`,
    );
    const keeperIn = await call('/auth/verify', { method: 'POST', body: { token: keeperToken } });
    check('verifying a link never changes an existing role', keeperIn.status === 200 && keeperIn.data.user?.role === 'admin', JSON.stringify(keeperIn.data));

    const denied = await call('/admin/clients', { method: 'POST', auth: owner.session, body: { email: `nope-${stamp}@example.com`, projectIds: [shop.project.id] } });
    check('only Ali can invite', denied.status === 403, String(denied.status));
  },

  async seo({ admin }) {
    const ranks = await call('/admin/seo/ranks', { auth: admin });
    check(
      'the rankings endpoint answers without a DataForSEO key',
      ranks.status === 200 && ranks.data.rankReady === false && Array.isArray(ranks.data.rows) && ranks.data.location?.locationCode === 2840,
      JSON.stringify(ranks.data).slice(0, 300),
    );
    const overview = await call('/admin/seo/overview', { auth: admin });
    check(
      'the overview carries a rank summary',
      overview.data.rank?.rankReady === false && overview.data.rank.keywords > 0 && overview.data.rank.swing === null,
      JSON.stringify(overview.data.rank),
    );
    const saved = await call('/admin/seo/settings', {
      method: 'POST',
      auth: admin,
      body: { rankKeywords: ['vibe contracting', 'shopify app developer'], rankLocation: { locationCode: 2840, languageCode: 'en' } },
    });
    check(
      'rank keywords and location save',
      saved.data.settings?.rankKeywords?.length === 2 && saved.data.settings.rankLocation?.locationCode === 2840 && !saved.data.rejected?.length,
      JSON.stringify(saved.data).slice(0, 300),
    );
    const capped = await call('/admin/seo/settings', {
      method: 'POST',
      auth: admin,
      body: { rankKeywords: Array.from({ length: 30 }, (_, i) => `keyword ${i}`), rankLocation: { locationCode: 0, languageCode: '' } },
    });
    check(
      'the keyword cap and a bad location are enforced',
      capped.data.settings?.rankKeywords?.length === 25 && capped.data.rejected?.includes('rankLocation'),
      JSON.stringify(capped.data).slice(0, 300),
    );
    const ran = await call('/admin/seo/run', { method: 'POST', auth: admin, body: { what: 'ranks' } });
    check('a rank check without the key is skipped, not failed', ran.data.what === 'ranks' && ran.data.skipped === 'no_key');

    // Two weekly checks: one keyword improved into the top 10, one appeared.
    const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const before = day(-7);
    const latest = day(0);
    sql(`INSERT INTO seo_ranks (day, keyword, location_code, language_code, host, position, url, top_domains_json, cost) VALUES
      ('${before}', 'vibe contracting', 2840, 'en', 'malipetek.dev', 12, 'https://malipetek.dev/', '["upwork.com","fiverr.com"]', 0.006),
      ('${before}', 'shopify app developer', 2840, 'en', NULL, NULL, NULL, '["shopify.dev"]', 0.006),
      ('${latest}', 'vibe contracting', 2840, 'en', 'malipetek.dev', 7, 'https://malipetek.dev/', '["upwork.com","fiverr.com"]', 0.006),
      ('${latest}', 'shopify app developer', 2840, 'en', 'lab.malipetek.dev', 40, 'https://lab.malipetek.dev/shopify', '["shopify.dev"]', 0.006);`);
    const checked = await call('/admin/seo/ranks', { auth: admin });
    const vibe = checked.data.rows?.find((row) => row.keyword === 'vibe contracting');
    const shopify = checked.data.rows?.find((row) => row.keyword === 'shopify app developer');
    check(
      'a check reads its positions against last week',
      checked.data.latestDay === latest && vibe?.position === 7 && vibe?.prevPosition === 12 && vibe?.change === 5 && shopify?.change === null,
      JSON.stringify(checked.data.rows),
    );
    check(
      'the series averages positions and counts the top 100',
      checked.data.series?.length === 2 && checked.data.series.at(-1).avgPosition === 23.5 && checked.data.series.at(-1).inTop100 === 2,
      JSON.stringify(checked.data.series),
    );
    check('the swing treats a keyword outside the top 100 as 101', checked.data.swing === 33, JSON.stringify(checked.data.swing));
    const withRanks = await call('/admin/seo/overview', { auth: admin });
    check(
      'the overview shows the newest average and swing',
      withRanks.data.rank.avgPosition === 23.5 && withRanks.data.rank.inTop10 === 1 && withRanks.data.rank.swing === 33,
      JSON.stringify(withRanks.data.rank),
    );

    const client = account(`seo-client-${Date.now()}@example.com`);
    const denied = await call('/admin/seo/ranks', { auth: client.session });
    check('a client cannot read the rankings', denied.status === 401 || denied.status === 403, String(denied.status));
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
  // The knowledgebase D1 predates this repo and has no migrations folder here,
  // so the suite creates the tables its REST and MCP paths read.
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'KB_DB', '--local', '--persist-to', STATE, '--file', join(WORKER, 'test', 'kb-schema.sql')], { cwd: WORKER, stdio: 'pipe' });

  await startFakeCloudflare();
  const vars = {
    DEV_RETURN_LINK: '1',
    RUNNER_TOKEN,
    // CI has no .dev.vars; the suite must bring every secret it needs.
    SESSION_SECRET: 'e2e-session-secret',
    SITE_URL: 'http://localhost:4321',
    PORTAL_URL: 'http://localhost:4321',
    GITHUB_WEBHOOK_SECRET: 'test-webhook-secret',
    CLOUDFLARE_OAUTH_CLIENT_ID: CF_CLIENT.id,
    CLOUDFLARE_OAUTH_CLIENT_SECRET: CF_CLIENT.secret,
    CLOUDFLARE_OAUTH_BASE: `http://127.0.0.1:${CF.port}`,
    CLOUDFLARE_API_BASE: `http://127.0.0.1:${CF.port}/client/v4`,
    MARKETING_TOKEN: 'e2e-marketing-token',
    DEEPSEEK_API_KEY: 'e2e-deepseek',
    DEEPSEEK_API_BASE: `http://127.0.0.1:${CF.port}/deepseek`,
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
      if (only.length && !only.some((part) => name.includes(part))) continue;
      group = name;
      console.log(`${name}`);
      try {
        await run({ admin });
      } catch (error) {
        check(`${name} threw`, false, error.stack ?? String(error));
        if (devLog) console.log(devLog.slice(-2500));
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
