/*
 * The intake assistant: a request with no project is worked here, in the
 * Worker, not on a fleet node. It can only touch the ticket owner's portal
 * records — create a project, choose a repo, add a site, move a request, file
 * real work. It cannot approve, publish or delete a project.
 *
 * It is a plain DeepSeek tool-calling loop rather than a Durable Object: the
 * work is a handful of API calls, the model answers in seconds, and the loop
 * is bounded per wake. Every tool call is logged in `ticket_actions` and
 * summarised in the thread.
 */
import { now, type Env } from './shared.ts';
import { portalLinks } from './links.ts';
import { briefText, cleanBrief, cleanRepo, parseBrief, uniqueSlug } from './setup.ts';
import { ensureRepo, repoParts, useClientRepo } from './ghapp.ts';
import { deleteSite, getSiteById, getSites, setSiteHost, startSite, type SiteHost } from './sites.ts';
import { grantedAccounts } from './cfaccess.ts';
import { moveSite, moveTicket } from './move.ts';
import { DEFAULT_ATTENTION } from '../../src/lib/pricing.js';

const MAX_ROUNDS = 6;
const MAX_TOOLS = 20;
const WAKE_ACTIONS_PER_DAY = 60;
const MAX_TEXT = 8000;

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

const cleanText = (value: unknown, max = MAX_TEXT): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const ownProject = (env: Env, userId: string, projectId: string) =>
  env.DB.prepare(
    `SELECT p.* FROM projects p JOIN user_projects up ON up.project_id = p.id
      WHERE p.id = ? AND up.user_id = ?`,
  )
    .bind(projectId, userId)
    .first<Record<string, unknown> & { id: string; slug: string; name: string; repo: string | null }>();

async function say(env: Env, ticketId: number, body: string, author: 'runner' | 'system' = 'runner') {
  const text = body.trim().slice(0, MAX_TEXT);
  if (!text) return;
  await env.DB.prepare(
    `INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, ?, ?, 0, ?)`,
  )
    .bind(ticketId, author, text, now())
    .run();
  await env.DB.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').bind(now(), ticketId).run();
}

/** The client's own portal state, as the model reads it. */
async function stateFor(env: Env, userId: string) {
  const [{ results: projects }, { results: sites }, { results: installations }, { results: cloudflare }, { results: tickets }] =
    await Promise.all([
      env.DB.prepare(
        `SELECT p.id, p.slug, p.name, p.kind, p.repo, p.repo_kind, p.repo_wanted, p.repo_error, p.github_installation_id
           FROM projects p JOIN user_projects up ON up.project_id = p.id
          WHERE up.user_id = ? ORDER BY p.name`,
      )
        .bind(userId)
        .all<Record<string, unknown>>(),
      env.DB.prepare(
        `SELECT s.id, s.project_id, s.name, s.slug, s.state, s.host, s.is_primary
           FROM sites s JOIN user_projects up ON up.project_id = s.project_id
          WHERE up.user_id = ? ORDER BY s.is_primary DESC, s.created_at`,
      )
        .bind(userId)
        .all<Record<string, unknown>>(),
      env.DB.prepare('SELECT id, account_login, repository_selection FROM github_installations WHERE user_id = ? ORDER BY account_login')
        .bind(userId)
        .all<Record<string, unknown>>(),
      env.DB.prepare(
        `SELECT id, accounts, expires_at, refresh_enc IS NOT NULL AS renewable
           FROM cloudflare_connections WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`,
      )
        .bind(userId)
        .all<{ id: number; accounts: string; expires_at: number | null; renewable: number }>(),
      env.DB.prepare(
        `SELECT id, title, status, project_id, site_id, kind FROM tickets
          WHERE user_id = ? ORDER BY updated_at DESC LIMIT 12`,
      )
        .bind(userId)
        .all<Record<string, unknown>>(),
    ]);

  const links = portalLinks(env);
  return {
    projects: (projects ?? []).map((p) => {
      const repo = typeof p.repo === 'string' ? p.repo : null;
      return {
        ...p,
        repoState: p.repo_error ? 'clone failed' : repo ? (p.github_installation_id ? 'in the client GitHub' : 'set') : 'none',
        sites: (sites ?? []).filter((s) => s.project_id === p.id),
      };
    }),
    installations: installations ?? [],
    cloudflare: (cloudflare ?? []).map((c) => ({
      id: c.id,
      accounts: (() => {
        try {
          return JSON.parse(c.accounts || '[]');
        } catch {
          return [];
        }
      })(),
      lapsed: !c.renewable && c.expires_at !== null && c.expires_at < now(),
    })),
    tickets: tickets ?? [],
    links: {
      ...links,
      githubConnect: links.connections,
      cloudflareConnect: links.connections,
    },
  };
}

/* ——————————————————————— tools ——————————————————————— */

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'intake_state',
      description: 'Read the client’s projects, sites, repos, connections, and open requests.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_project',
      description: 'Create a project for this client. It is the codebase and the work; sites are added separately.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'A short human name, e.g. “Rosa Florist”.' },
          what: { type: 'string', description: 'What it is, in one or two sentences.' },
          goal: { type: 'string', description: 'What done looks like, or the first thing wanted.' },
          kind: { type: 'string', enum: ['new', 'existing'] },
          manual: { type: 'string', description: 'For a new project: what is done by hand today.' },
          where: { type: 'string', description: 'For an existing project: where the code lives today.' },
        },
        required: ['name', 'what', 'goal'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_project_repo',
      description: 'Choose where the project’s code lives: a new repo in the client’s GitHub, an existing repo, or our account.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          mode: { type: 'string', enum: ['github', 'existing', 'ours'] },
          repo: { type: 'string', description: 'For mode existing, e.g. https://github.com/owner/name.' },
        },
        required: ['projectId', 'mode'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_site',
      description: 'Add an address under the project. The first site is the project’s main site.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          name: { type: 'string' },
          slug: { type: 'string', description: 'Address on malipetek.online, e.g. rosa-florist.' },
          host: { type: 'string', enum: ['ours', 'cloudflare'] },
        },
        required: ['projectId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_site_host',
      description: 'Move a site between our hosting and the client’s Cloudflare account.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          siteId: { type: 'string' },
          host: { type: 'string', enum: ['ours', 'cloudflare'] },
        },
        required: ['projectId', 'siteId', 'host'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_request',
      description: 'Move a request to another of the client’s projects (and optionally one of its sites).',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'number' },
          projectId: { type: 'string' },
          siteId: { type: 'string' },
        },
        required: ['ticketId', 'projectId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_site',
      description: 'Move a site to another of the client’s projects.',
      parameters: {
        type: 'object',
        properties: { siteId: { type: 'string' }, projectId: { type: 'string' } },
        required: ['siteId', 'projectId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_site',
      description: 'Delete a site and its address. The project, its repo and its requests stay.',
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string' }, siteId: { type: 'string' } },
        required: ['projectId', 'siteId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_request',
      description: 'File real work as a normal request. It waits for Ali’s approval.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          siteId: { type: 'string' },
        },
        required: ['projectId', 'title', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish_intake',
      description: 'Set this setup ticket to review when the account is ready and the first request is filed.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'link',
      description: 'Get the portal link to give the client (connections, requests, a project, a ticket).',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'string', enum: ['connections', 'requests', 'billing', 'project', 'ticket'] },
          id: { type: 'string' },
        },
        required: ['page'],
      },
    },
  },
];

interface ToolContext {
  env: Env;
  userId: string;
  userEmail: string;
  ticketId: number;
  used: number;
  filed: boolean;
}

async function tool(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<{ result: unknown; note?: string }> {
  const { env, userId } = ctx;
  const links = portalLinks(env);

  switch (name) {
    case 'intake_state':
      return { result: await stateFor(env, userId) };

    case 'create_project': {
      const kind = args.kind === 'existing' ? 'existing' : 'new';
      const projectName = cleanText(args.name, 80);
      const brief = cleanBrief(
        { what: args.what, goal: args.goal, ...(kind === 'existing' ? { where: args.where } : { manual: args.manual }) },
        kind,
      );
      if (!projectName || !brief) return { result: { error: 'bad_project' } };
      const id = crypto.randomUUID();
      const slug = await uniqueSlug(env, projectName);
      const t = now();
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO projects (id, slug, name, kind, brief, repo_kind, repo_wanted, created_by, onboarded_at, created_at)
           VALUES (?, ?, ?, ?, ?, 'none', 1, ?, ?, ?)`,
        ).bind(id, slug, projectName, kind, JSON.stringify(brief), userId, t, t),
        env.DB.prepare('INSERT INTO user_projects (user_id, project_id) VALUES (?, ?)').bind(userId, id),
      ]);
      return {
        result: { ok: true, project: { id, slug, name: projectName, kind }, link: links.project(id) },
        note: `Created project *${projectName}*.`,
      };
    }

    case 'set_project_repo': {
      const project = await ownProject(env, userId, String(args.projectId ?? ''));
      if (!project) return { result: { error: 'not_found' } };
      const mode = args.mode;
      if (mode === 'github') {
        const installation = await env.DB.prepare(
          'SELECT id, account_login FROM github_installations WHERE user_id = ? ORDER BY account_login LIMIT 1',
        )
          .bind(userId)
          .first<{ id: number; account_login: string }>();
        if (!installation) {
          return {
            result: { error: 'no_github', link: links.connections },
            note: 'Asked the client to connect GitHub.',
          };
        }
        try {
          const out = await useClientRepo(env, project, installation);
          return {
            result: { ok: true, repo: out.repo, outcome: out.outcome },
            note: out.outcome === 'created' ? `Created ${out.repo} in @${installation.account_login}.` : `Linked ${out.repo}.`,
          };
        } catch (error) {
          const message = (error as Error)?.message ?? 'Could not create the repo.';
          // Do not leave the client with a repo that cannot exist. Fall back to
          // our account (a node creates it), and say what GitHub refused.
          await env.DB.prepare(
            `UPDATE projects SET repo = NULL, repo_kind = 'none', repo_wanted = 1,
               github_installation_id = NULL, repo_error = ? WHERE id = ?`,
          )
            .bind(`github: ${message}`.slice(0, 300), project.id)
            .run();
          return {
            result: { error: 'github', message, fellBack: 'ours' },
            note: `Could not create the repo in @${installation.account_login}: ${message}. A machine will create one in our account instead.`,
          };
        }
      }
      if (mode === 'existing') {
        const repo = cleanRepo(args.repo);
        if (!repo) return { result: { error: 'bad_repo' } };
        const parts = repoParts(repo);
        const installation = parts
          ? await env.DB.prepare(
              'SELECT id, account_login FROM github_installations WHERE user_id = ? AND lower(account_login) = lower(?)',
            )
              .bind(userId, parts.owner)
              .first<{ id: number; account_login: string }>()
          : null;
        await env.DB.prepare(
          `UPDATE projects SET repo = ?, repo_kind = 'repo', repo_wanted = 0, repo_error = NULL,
             github_installation_id = ? WHERE id = ?`,
        )
          .bind(repo, installation?.id ?? null, project.id)
          .run();
        if (installation) {
          try {
            await ensureRepo(env, project.id);
          } catch (error) {
            await env.DB.prepare('UPDATE projects SET repo_error = ? WHERE id = ?')
              .bind(`github: ${(error as Error)?.message ?? 'could not reach the repo'}`.slice(0, 300), project.id)
              .run();
          }
        }
        return { result: { ok: true, repo }, note: `Using ${repo}.` };
      }
      await env.DB.prepare(
        `UPDATE projects SET repo = NULL, repo_kind = 'none', repo_wanted = 1, repo_error = NULL,
           github_installation_id = NULL WHERE id = ?`,
      )
        .bind(project.id)
        .run();
      return { result: { ok: true, repo: null }, note: 'A machine will create the repository in our account.' };
    }

    case 'add_site': {
      const project = await ownProject(env, userId, String(args.projectId ?? ''));
      if (!project) return { result: { error: 'not_found' } };
      let host: SiteHost = 'ours';
      let connectionId: number | null = null;
      let accountId: string | null = null;
      if (args.host === 'cloudflare') {
        const connection = await env.DB.prepare(
          'SELECT id, accounts FROM cloudflare_connections WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1',
        )
          .bind(userId)
          .first<{ id: number; accounts: string }>();
        const accounts = connection ? grantedAccounts(connection) : [];
        if (!connection || !accounts[0]) {
          return { result: { error: 'no_cloudflare', link: links.connections } };
        }
        host = 'cloudflare';
        connectionId = connection.id;
        accountId = accounts[0].id;
      }
      try {
        const site = await startSite(env, { id: userId }, project, {
          name: cleanText(args.name, 80) || null,
          siteSlug: cleanText(args.slug, 63) || null,
          host,
          connectionId,
          accountId,
        });
        return {
          result: { ok: true, site: { id: site.id, slug: site.slug, name: site.name } },
          note: `Added site *${site.slug}*.`,
        };
      } catch (error) {
        return { result: { error: (error as Error)?.message ?? 'could not add the site' } };
      }
    }

    case 'set_site_host': {
      const site = await env.DB.prepare(
        `SELECT s.id, s.project_id FROM sites s JOIN user_projects up ON up.project_id = s.project_id
          WHERE s.id = ? AND up.user_id = ?`,
      )
        .bind(String(args.siteId ?? ''), userId)
        .first<{ id: string; project_id: string }>();
      if (!site) return { result: { error: 'not_found' } };
      let connection: { id: number; accountId: string } | null = null;
      if (args.host === 'cloudflare') {
        const row = await env.DB.prepare(
          'SELECT id, accounts FROM cloudflare_connections WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1',
        )
          .bind(userId)
          .first<{ id: number; accounts: string }>();
        const account = row ? grantedAccounts(row)[0] : null;
        if (!row || !account) return { result: { error: 'no_cloudflare' } };
        connection = { id: row.id, accountId: account.id };
      }
      const moved = await setSiteHost(env, site.project_id, args.host === 'cloudflare' ? 'cloudflare' : 'ours', connection, site.id);
      return { result: { ok: Boolean(moved) }, note: `Hosting set to ${args.host === 'cloudflare' ? 'the client Cloudflare account' : 'malipetek.online'}.` };
    }

    case 'move_request': {
      const out = await moveTicket(
        env,
        userId,
        Number(args.ticketId),
        String(args.projectId ?? ''),
        cleanText(args.siteId) || null,
      );
      return { result: out, ...(('ok' in out) ? { note: 'Moved the request.' } : {}) };
    }

    case 'move_site': {
      const out = await moveSite(env, userId, String(args.siteId ?? ''), String(args.projectId ?? ''));
      return { result: out, ...(('ok' in out) ? { note: 'Moved the site.' } : {}) };
    }

    case 'remove_site': {
      const project = await ownProject(env, userId, String(args.projectId ?? ''));
      if (!project) return { result: { error: 'not_found' } };
      const out = await deleteSite(env, project.id, String(args.siteId ?? ''));
      return { result: out, ...(('ok' in out) ? { note: 'Removed the site.' } : {}) };
    }

    case 'file_request': {
      const project = await ownProject(env, userId, String(args.projectId ?? ''));
      if (!project) return { result: { error: 'not_found' } };
      const title = cleanText(args.title, 140);
      const body = cleanText(args.body, MAX_TEXT);
      if (!title || !body) return { result: { error: 'bad_request' } };
      let siteId: string | null = null;
      if (cleanText(args.siteId)) {
        const site = await env.DB.prepare('SELECT 1 FROM sites WHERE id = ? AND project_id = ?')
          .bind(String(args.siteId), project.id)
          .first();
        if (!site) return { result: { error: 'bad_site' } };
        siteId = String(args.siteId);
      }
      const t = now();
      const ticket = await env.DB.prepare(
        `INSERT INTO tickets (user_id, project_id, site_id, title, status, attention, budget_cents, kind, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'new', ?, NULL, 'client', ?, ?) RETURNING id`,
      )
        .bind(userId, project.id, siteId, title, DEFAULT_ATTENTION, t, t)
        .first<{ id: number }>();
      if (!ticket) return { result: { error: 'insert_failed' } };
      await env.DB.prepare(
        `INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'client', ?, 0, ?)`,
      )
        .bind(ticket.id, body, t)
        .run();
      const link = links.ticket(ticket.id);
      try {
        await env.EMAIL?.send({
          from: env.PORTAL_FROM_EMAIL || 'portal@malipetek.dev',
          to: 'malipetek@gmail.com',
          subject: `[#${ticket.id}] New request from ${ctx.userEmail}: ${title}`,
          text: `${body}\n\nOpen: ${link}`,
        });
      } catch {
        /* the ticket is in the portal either way */
      }
      return { result: { ok: true, ticket: { id: ticket.id, title }, link }, note: `Filed request #${ticket.id}: *${title}*.` };
    }

    case 'finish_intake': {
      await env.DB.prepare(`UPDATE tickets SET status = 'review', updated_at = ? WHERE id = ? AND kind = 'intake'`)
        .bind(now(), ctx.ticketId)
        .run();
      await say(env, ctx.ticketId, 'The setup assistant finished. Ali will check the account.', 'system');
      return { result: { ok: true } };
    }

    case 'link': {
      const page = String(args.page ?? 'requests');
      if (page === 'project' && args.id) return { result: { url: links.project(String(args.id)) } };
      if (page === 'ticket' && args.id) return { result: { url: links.ticket(String(args.id)) } };
      const map: Record<string, string> = { connections: links.connections, requests: links.requests, billing: links.billing };
      return { result: { url: map[page] ?? links.requests } };
    }

    default:
      return { result: { error: `unknown tool ${name}` } };
  }
}

/* ——————————————————————— the turn ——————————————————————— */

async function chat(env: Env, messages: ChatMessage[]): Promise<{ message?: ChatMessage; error?: string }> {
  const base = (env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL || 'deepseek-chat',
        temperature: 0.2,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      console.warn('intake_deepseek_failed', res.status, (await res.text()).slice(0, 300));
      return { error: `DeepSeek answered ${res.status}` };
    }
    const data = (await res.json()) as { choices?: { message?: ChatMessage }[] };
    return { message: data.choices?.[0]?.message };
  } catch (error) {
    console.warn('intake_deepseek_failed', String(error));
    return { error: String(error) };
  }
}

function systemPrompt(ticket: { user_email: string; user_locale: string | null }, state: unknown): string {
  return `You are the setup assistant for malipetek.dev, working a client's intake ticket.

The client is ${ticket.user_email}${ticket.user_locale ? ` (${ticket.user_locale})` : ''}. They wrote what they need without choosing a project.

You can only change this client's own portal records. You cannot approve work, publish or roll back a site, delete a project, run code, or touch another client. Real work is filed as a request and waits for Ali's approval.

What to do, in order:
1. Read the state below. If the client already has the right project/site, use it.
2. If they need a project, create one with a short human name (the business or the thing, never a ticket title). Write the brief from what they said; do not ask for information you can infer.
3. Where the code lives: if GitHub is connected, create the repo in their account with set_project_repo mode github. If they named an existing repo, use mode existing. Otherwise use mode ours. Never create a client's repo under malipetek/.
4. Add a site with add_site when the project needs an address. The address comes from the project name, not the request title. If Cloudflare is connected and not lapsed, offer it; otherwise host with us. An expired connection gets the reconnect link and our hosting meanwhile.
5. File the real work with file_request on the right project (and site if it matters). This is what Ali sees.
6. finish_intake when setup is done and the first request is filed.

Rules:
- Ask at most one question, only when you truly cannot infer the answer. Prefer acting.
- Keep replies short: two to four sentences, plain language. Never mention tools, prompts, models or JSON.
- Give absolute portal links from the state. If a connection is missing, give the signed connect link.
- A repo warning is real only when the state says clone failed. A repo in malipetek or a public repo is readable; do not tell the client to connect GitHub because of its owner.
- If the client replies later, continue from the thread; do not recreate what exists.

Current state:
${JSON.stringify(state, null, 2)}`;
}

/**
 * Run one intake turn. Safe to call more than once: a second wake with no new
 * client message does nothing.
 */
export async function runIntake(env: Env, ticketId: number): Promise<void> {
  const ticket = await env.DB.prepare(
    `SELECT t.id, t.user_id, t.kind, t.status, u.email AS user_email, u.locale AS user_locale
       FROM tickets t JOIN users u ON u.id = t.user_id
      WHERE t.id = ? AND t.kind = 'intake'`,
  )
    .bind(ticketId)
    .first<{ id: number; user_id: string; kind: string; status: string; user_email: string; user_locale: string | null }>();
  if (!ticket || ticket.status === 'done' || ticket.status === 'declined') return;

  // One turn at a time. A client message and a page refresh can both ask for a
  // wake; without this, two loops create the project twice.
  const claimed = await env.DB.prepare(
    `UPDATE tickets SET intake_lock_at = ?
      WHERE id = ? AND kind = 'intake' AND (intake_lock_at IS NULL OR intake_lock_at < ?)
      RETURNING id`,
  )
    .bind(now(), ticketId, now() - 120)
    .first<{ id: number }>();
  if (!claimed) return;

  try {
    await intakeTurn(env, ticket);
  } finally {
    await env.DB.prepare('UPDATE tickets SET intake_lock_at = NULL WHERE id = ?').bind(ticketId).run();
  }
}

async function intakeTurn(
  env: Env,
  ticket: { id: number; user_id: string; kind: string; status: string; user_email: string; user_locale: string | null },
): Promise<void> {
  const ticketId = ticket.id;
  if (!env.DEEPSEEK_API_KEY) {
    await say(env, ticketId, 'The setup assistant is not configured on this server yet. Ali will pick this up.', 'system');
    return;
  }

  const actions = await env.DB.prepare(
    'SELECT count(*) AS n FROM ticket_actions WHERE ticket_id = ? AND created_at > ?',
  )
    .bind(ticketId, now() - 86400)
    .first<{ n: number }>();
  if ((actions?.n ?? 0) >= WAKE_ACTIONS_PER_DAY) {
    await say(env, ticketId, 'The setup assistant has done a lot today. Reply and Ali will take it from here.', 'system');
    return;
  }

  const { results: rows } = await env.DB.prepare(
    `SELECT author, body FROM ticket_messages WHERE ticket_id = ? AND internal = 0 ORDER BY id DESC LIMIT 24`,
  )
    .bind(ticketId)
    .all<{ author: string; body: string }>();
  const thread = (rows ?? []).reverse();
  const last = thread[thread.length - 1];
  // Nothing new since the agent last spoke.
  if (!last || last.author === 'runner') return;

  const state = await stateFor(env, ticket.user_id);
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(ticket, state) },
    ...thread.map((m) => ({
      role: (m.author === 'client' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.body,
    })),
  ];

  const ctx: ToolContext = {
    env,
    userId: ticket.user_id,
    userEmail: ticket.user_email,
    ticketId,
    used: 0,
    filed: false,
  };

  let final = '';
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const answer = await chat(env, messages);
    if (!answer.message) {
      await say(env, ticketId, 'The setup assistant could not answer just now. Reply here and it will try again, or Ali will pick it up.', 'system');
      return;
    }
    const message = answer.message;
    const calls = message.tool_calls ?? [];
    if (calls.length) {
      messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
      for (const call of calls) {
        if (ctx.used >= MAX_TOOLS) break;
        ctx.used += 1;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          args = {};
        }
        const { result, note } = await tool(ctx, call.function.name, args);
        if (call.function.name === 'file_request' && (result as { ok?: boolean }).ok) ctx.filed = true;
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO ticket_actions (ticket_id, action, args_json, result_json, created_at) VALUES (?, ?, ?, ?, ?)`,
          ).bind(ticketId, call.function.name, JSON.stringify(args).slice(0, 2000), JSON.stringify(result).slice(0, 4000), now()),
          ...(note
            ? [env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 0, ?)`).bind(ticketId, note, now())]
            : []),
        ]);
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
      }
      if (ctx.used >= MAX_TOOLS) break;
      continue;
    }
    final = message.content ?? '';
    break;
  }

  if (final.trim()) await say(env, ticketId, final.trim());
  else await say(env, ticketId, 'I have set that up. Reply here if anything is wrong, or Ali will take a look.', 'system');
  if (ctx.filed) {
    await env.DB.prepare(`UPDATE tickets SET status = 'review', updated_at = ? WHERE id = ? AND kind = 'intake' AND status = 'in_progress'`)
      .bind(now(), ticketId)
      .run();
  }
}
