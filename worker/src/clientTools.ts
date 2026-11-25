/*
 * The client's side of the MCP server: an AI assistant working for one client,
 * with the agent token that client minted in the portal (`cat_…`).
 *
 * Every tool is a call to the portal's own client routes, made in-process with
 * the same token. So an assistant gets exactly what the client gets in the
 * browser — ownership checks, validation, rate limits, the emails to Ali — and
 * there is no second copy of any of it to drift. An agent token cannot reach
 * /admin/* or manage tokens (portal.ts), so neither can these tools.
 */
import { ATTENTION_KEYS, reviewEstimate } from '../../src/lib/pricing.js';
import { BOARD_UI_URI } from './boardUi.ts';
import { portal } from './portal.ts';
import type { Env } from './shared.ts';

/** What Hono hands its routes as the execution context. */
type Ctx = Parameters<typeof portal.request>[3];

export interface ClientTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  /** MCP: the exact shape of `structuredContent`, when the tool returns one. */
  outputSchema?: Record<string, unknown>;
  /** MCP: what this tool needs — `noauth` or `oauth2` with scopes (ChatGPT reads these per tool). */
  securitySchemes?: Array<{ type: 'noauth' } | { type: 'oauth2'; scopes: string[] }>;
  /** Sidebar icon for an entrypoint tool (MCP Icon). */
  icons?: Array<{ src: string; mimeType?: string; sizes?: string[] }>;
  /** MCP Apps / OpenAI extensions: `ui.resourceUri`, `openai/ui` entrypoints, `openai/profile`, … */
  _meta?: Record<string, unknown>;
}

const ATTENTION = {
  type: 'string',
  enum: ATTENTION_KEYS,
  description: 'How much developer time: auto (Autopilot, cheapest), checked (the default: a developer reads every change), hands_on (Hands-on, by the clock).',
};
const REQUEST_ID = { type: 'integer', description: 'The request number, from portal_requests.' };

export const CLIENT_TOOLS: ClientTool[] = [
  {
    name: 'portal_projects',
    title: 'My projects',
    description:
      'List the projects on this account: what each is, how ready its setup is (the checks still open, and who clears them), and its hosted site’s preview and editor links when it has one.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
  },
  {
    name: 'portal_requests',
    title: 'My requests',
    description: 'List the requests on this account, newest activity first, with status and cost so far.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
  },
  {
    name: 'portal_board',
    title: 'PTech portal',
    description:
      'Draw this account as an interactive card in the conversation, in three tabs: projects (setup progress and the next step), sites (live or preview, with links) and requests (status, cost so far). Any request opens as a chat with your developer inside the card, where the person can read the thread and reply. Pass request_id to open that request’s conversation straight away, e.g. when they ask to see or answer request 12. Use it when the person wants to see their work rather than read a list. Mention only what matters afterwards — the card shows the details.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'integer', description: 'Optional: open this request’s conversation in the card.' },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        account: {
          type: 'object',
          properties: { name: { type: ['string', 'null'] } },
          required: ['name'],
          additionalProperties: false,
        },
        projects: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: ['string', 'null'] },
              name: { type: ['string', 'null'] },
              requests: { type: 'integer' },
              open: { type: 'integer' },
              sites: { type: 'integer' },
              setup: {
                type: 'object',
                properties: {
                  ready: { type: 'integer' },
                  total: { type: 'integer' },
                  next: { type: ['string', 'null'] },
                },
                required: ['ready', 'total', 'next'],
                additionalProperties: false,
              },
            },
            required: ['id', 'name', 'requests', 'open', 'sites', 'setup'],
            additionalProperties: false,
          },
        },
        sites: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: ['string', 'null'] },
              name: { type: ['string', 'null'] },
              project: { type: ['string', 'null'] },
              project_id: { type: ['string', 'null'] },
              state: { type: ['string', 'null'] },
              live: { type: 'boolean' },
              has_preview: { type: 'boolean' },
              preview_url: { type: ['string', 'null'] },
              production_url: { type: ['string', 'null'] },
              updated_at: { type: ['string', 'null'] },
            },
            required: ['id', 'name', 'project', 'project_id', 'state', 'live', 'has_preview', 'preview_url', 'production_url', 'updated_at'],
            additionalProperties: false,
          },
        },
        requests: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              title: { type: ['string', 'null'] },
              status: { type: ['string', 'null'] },
              project: { type: ['string', 'null'] },
              project_id: { type: ['string', 'null'] },
              site: { type: ['string', 'null'] },
              updated_at: { type: ['string', 'null'] },
              unread: { type: 'boolean' },
              price_cents: { type: ['integer', 'null'] },
              budget_cents: { type: ['integer', 'null'] },
            },
            required: ['id', 'title', 'status', 'project', 'project_id', 'site', 'updated_at', 'unread', 'price_cents', 'budget_cents'],
            additionalProperties: false,
          },
        },
        updated_at: { type: 'string' },
        focus: { type: ['integer', 'null'], description: 'The request whose conversation the card opens on, if any.' },
        locale: { type: ['string', 'null'], description: 'The language the client picked in the portal, if any.' },
        spending: {
          type: 'object',
          description: 'Cents: billed for finished work, running on open work, and the AI share of all of it (at cost).',
          properties: {
            billed_cents: { type: 'integer' },
            open_cents: { type: 'integer' },
            ai_cents: { type: 'integer' },
          },
          required: ['billed_cents', 'open_cents', 'ai_cents'],
          additionalProperties: false,
        },
      },
      required: ['account', 'projects', 'sites', 'requests', 'updated_at', 'focus', 'spending', 'locale'],
      additionalProperties: false,
    },
    readOnly: true,
    // The sidebar entry's icon (ChatGPT reads it from the entrypoint tool). Hosts
    // draw it as a one-colour glyph: its transparency is a mask they tint, so the
    // PTech symbol is on transparent. The listing logo stays the plugin package's.
    icons: [
      { src: 'https://ptechsolutions.net/ptech-glyph.svg', mimeType: 'image/svg+xml', sizes: ['any'] },
      { src: 'https://ptechsolutions.net/ptech-glyph.png', mimeType: 'image/png', sizes: ['512x512'] },
    ],
    _meta: {
      ui: { resourceUri: BOARD_UI_URI },
      // Opens from the sidebar (global) and as a tab beside a conversation (thread).
      'openai/ui': { entrypoints: [{ type: 'global' }, { type: 'thread' }] },
      'openai/toolInvocation/invoking': 'Opening PTech portal…',
      'openai/toolInvocation/invoked': 'Projects, sites and requests ready',
    },
  },
  {
    name: 'portal_profile',
    title: 'My PTech profile',
    description:
      'The account this connection belongs to: a stable opaque id plus the name and email to show. Use it to tell several connected accounts apart.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, pattern: '\\S' },
        name: { type: 'string' },
        email: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    readOnly: true,
    _meta: { 'openai/profile': true },
  },
  {
    name: 'portal_request',
    title: 'Read a request',
    description: 'One request: its status, its cost and budget, and the whole conversation with your developer.',
    inputSchema: { type: 'object', properties: { request_id: REQUEST_ID }, required: ['request_id'], additionalProperties: false },
    readOnly: true,
  },
  {
    name: 'portal_file_request',
    title: 'File a request',
    description:
      'Ask for a change or a new piece of work. Write it the way you would to a person: what you want and why. Nothing starts until a developer has read it. Pass project_id from portal_projects when it is about one of them.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A short title, up to 140 characters.' },
        body: { type: 'string', description: 'What is needed, in full.' },
        project_id: { type: 'string', description: 'Optional: the project it is about.' },
        attention: ATTENTION,
        budget_usd: { type: 'integer', description: 'Optional ceiling in whole dollars (1–10000). Work pauses when the cost reaches it.' },
      },
      required: ['title', 'body'],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: 'portal_reply',
    title: 'Reply on a request',
    description: 'Add a message to a request’s conversation. A developer is emailed.',
    inputSchema: {
      type: 'object',
      properties: { request_id: REQUEST_ID, text: { type: 'string', description: 'The message.' } },
      required: ['request_id', 'text'],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: 'portal_set_budget',
    title: 'Set a request’s budget',
    description: 'Raise, lower or remove the budget on an open request. Work pauses when the cost reaches it; raising it lets the work go on.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: REQUEST_ID,
        budget_usd: { type: ['integer', 'null'], description: 'Whole dollars, 1–10000; null removes the budget.' },
      },
      required: ['request_id', 'budget_usd'],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: 'portal_withdraw',
    title: 'Withdraw a request',
    description:
      'Take back a request that has not been approved yet; it is closed and costs nothing. Once it is approved, ask with portal_reply instead.',
    inputSchema: { type: 'object', properties: { request_id: REQUEST_ID }, required: ['request_id'], additionalProperties: false },
    readOnly: false,
  },
  {
    name: 'portal_move_request',
    title: 'Move a request',
    description:
      'Move one of this account’s requests to another of its projects, and optionally to one of that project’s sites. An approved request goes back to a developer for approval.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: REQUEST_ID,
        project_id: { type: 'string', description: 'The target project id, from portal_projects.' },
        site_id: { type: 'string', description: 'Optional site id under the target project.' },
      },
      required: ['request_id', 'project_id'],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: 'portal_move_site',
    title: 'Move a site',
    description: 'Move one of this account’s sites to another of its projects. Its address and deploys stay.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'The site id, from portal_projects.' },
        project_id: { type: 'string', description: 'The target project id.' },
      },
      required: ['site_id', 'project_id'],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: 'start_change',
    title: 'Start a change',
    description:
      'Open a change request for one of the client’s hosted sites and get a preview workspace for it. It records who is making the change. It does not publish to production or start a paid review. Read the site with project_context and workspace_files, send the changed files with submit_change, then rebuild the preview with preview_build. Publishing is a separate action: site_publish only after the client confirms that exact site and action. A developer review is optional and paid (finish_change).',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project, from portal_projects. It must have a hosted site.' },
        title: { type: 'string', description: 'What the change is, up to 140 characters, e.g. "Make the product title red".' },
        summary: { type: 'string', description: 'What the client asked for and what you are going to change, in a few sentences.' },
      },
      required: ['project_id', 'title', 'summary'],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: 'finish_change',
    title: 'Finish a change',
    description:
      `Close a change you made with start_change, after its preview is built, once the client is happy with it. Two ways to go live, their choice. review true sends it to a developer for review first: they read it before it goes live and email the client when they are done. ${reviewEstimate()} review false keeps it as it is, closed, with nothing to bill; they can publish it themselves later with site_publish. Confirm before you call it.`,
    inputSchema: {
      type: 'object',
      properties: {
        request_id: REQUEST_ID,
        review: { type: 'boolean', description: 'True: send it to a developer for review (paid). False: keep it without review (free).' },
      },
      required: ['request_id', 'review'],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: 'project_context',
    title: 'Request context',
    description:
      'Everything about one request you are working on (from start_change, or one a developer approved): the project brief, the whole conversation, the site’s state and how it builds. Read this first, and start from the preview the project already has.',
    inputSchema: { type: 'object', properties: { request_id: REQUEST_ID }, required: ['request_id'], additionalProperties: false },
    readOnly: true,
  },
  {
    name: 'workspace_files',
    title: 'List source files',
    description: 'Every source file in the site’s current preview, as a path list. Read what you need with workspace_read.',
    inputSchema: { type: 'object', properties: { request_id: REQUEST_ID }, required: ['request_id'], additionalProperties: false },
    readOnly: true,
  },
  {
    name: 'workspace_read',
    title: 'Read a source file',
    description: 'One file’s full text from the site’s current preview, by path from workspace_files. The text is in `source`.',
    inputSchema: {
      type: 'object',
      properties: { request_id: REQUEST_ID, path: { type: 'string', description: 'A path exactly as workspace_files listed it.' } },
      required: ['request_id', 'path'],
      additionalProperties: false,
    },
    readOnly: true,
  },
  {
    name: 'submit_change',
    title: 'Send a change',
    description:
      'Send the files you changed, whole contents, at most 40 files and 2 MB, for a request from start_change (or one a developer approved). They land on the request’s own branch and the preview, never production, and are recorded with your name and the file list.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: REQUEST_ID,
        files: {
          type: 'array',
          description: 'Changed files, whole contents.',
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, content: { type: 'string' } },
            required: ['path', 'content'],
            additionalProperties: false,
          },
          maxItems: 40,
        },
      },
      required: ['request_id', 'files'],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: 'preview_build',
    title: 'Build the preview',
    description:
      'Apply the change you sent with submit_change and rebuild the preview site. A machine picks it up, usually within a minute or two; portal_request then shows the preview link in the thread.',
    inputSchema: { type: 'object', properties: { request_id: REQUEST_ID }, required: ['request_id'], additionalProperties: false },
    readOnly: false,
  },
  {
    name: 'site_status',
    title: 'Site status',
    description: 'The project’s hosted site: its state, the preview and live addresses, and which deploy each points at.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string', description: 'From portal_projects.' } }, required: ['project_id'], additionalProperties: false },
    readOnly: true,
  },
  {
    name: 'site_deploys',
    title: 'Deploy history',
    description: 'The site’s deploys, newest first — what publish and rollback point at.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' } }, required: ['project_id'], additionalProperties: false },
    readOnly: true,
  },
  {
    name: 'site_publish',
    title: 'Publish the site',
    description:
      'Take the preview live, when the client is happy with it. The client may publish their own site, and the responsibility is theirs: every publish is recorded with who did it and through which app, a developer is emailed, and any change you made that they kept without review goes live unreviewed. Say that plainly and confirm with the client before calling it. The result lists those unreviewed changes. The other way to go live is a developer’s review first (finish_change with review true).',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' } }, required: ['project_id'], additionalProperties: false },
    readOnly: false,
  },
  {
    name: 'site_rollback',
    title: 'Roll the site back',
    description: 'Point production at an older deploy from site_deploys: the way back when a publish went wrong. Recorded and emailed to a developer like a publish. Confirm with the client first.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' }, deploy_id: { type: 'string', description: 'A deploy id from site_deploys.' } },
      required: ['project_id', 'deploy_id'],
      additionalProperties: false,
    },
    readOnly: false,
  },
];

/**
 * Ali's own tools: the same calls his admin views make, for his own MCP
 * session (a portal session token as the bearer — the OAuth consent flow
 * keeps refusing his address on purpose). Never listed for a client.
 */
export const OWNER_TOOLS: ClientTool[] = [
  {
    name: 'owner_requests',
    title: 'Requests waiting on you',
    description: 'New requests and anything marked waiting on Ali, oldest first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
  },
  {
    name: 'owner_request',
    title: 'Read any request',
    description: 'One request in full — conversation, runs, cost — by id.',
    inputSchema: { type: 'object', properties: { request_id: REQUEST_ID }, required: ['request_id'], additionalProperties: false },
    readOnly: true,
  },
  {
    name: 'owner_approve_request',
    title: 'Approve a request',
    description: 'Approve a request so work can start. It leaves the queue and a node picks it up.',
    inputSchema: { type: 'object', properties: { request_id: REQUEST_ID }, required: ['request_id'], additionalProperties: false },
    readOnly: false,
  },
  {
    name: 'owner_decline_request',
    title: 'Decline a request',
    description: 'Decline a request, with the reason the client reads.',
    inputSchema: {
      type: 'object',
      properties: { request_id: REQUEST_ID, reason: { type: 'string', description: 'Why — shown to the client.' } },
      required: ['request_id'],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: 'owner_projects',
    title: 'The portfolio',
    description: 'Every project: its kind, its site and whether that site is live, and the people on it.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
  },
  {
    name: 'owner_project_work',
    title: 'A project’s work',
    description: 'Every request on one project with its status, newest first. Read it before filing or publishing anything on that project.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string', description: 'Project id from owner_projects.' } },
      required: ['project_id'],
      additionalProperties: false,
    },
    readOnly: true,
  },
  {
    name: 'owner_clients',
    title: 'Clients and their projects',
    description: 'Every client account, the projects attached to it, and whether it has been invited or has signed in.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
  },
  {
    name: 'owner_queue',
    title: 'The queue and fleet',
    description: 'The work queue, the nodes, and what each is doing right now.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
  },
  {
    name: 'owner_runs',
    title: 'Recent runs',
    description: 'The latest machine runs across the fleet: outcome, cost, where the work went.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
  },
  {
    name: 'owner_publish',
    title: 'Publish a site',
    description: 'Take a project’s preview live.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' } }, required: ['project_id'], additionalProperties: false },
    readOnly: false,
  },
  {
    name: 'owner_rollback',
    title: 'Roll a site back',
    description: 'Point a project’s production at an older deploy.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' }, deploy_id: { type: 'string' } },
      required: ['project_id', 'deploy_id'],
      additionalProperties: false,
    },
    readOnly: false,
  },
];

export const CLIENT_TOOL_NAMES = new Set(CLIENT_TOOLS.map((t) => t.name));
export const OWNER_TOOL_NAMES = new Set(OWNER_TOOLS.map((t) => t.name));

/** The portal's answer, or a thrown Error carrying its error code — which the model reads. */
async function portalCall(env: Env, ctx: Ctx, token: string, method: string, path: string, body?: unknown) {
  const res = await portal.request(
    path,
    {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
    ctx,
  );
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const code = String(data?.error ?? res.status);
    const hint: Record<string, string> = {
      unauthorized: 'The agent token is missing, wrong or revoked. Make a new one in the portal: Connect an assistant.',
      not_found: 'No such request or project on this account.',
      not_hosted: 'This project has no hosted preview yet. A developer must set up the site first.',
      file_not_found: 'That path is not in the current preview. Use workspace_files to list the exact paths.',
      rate_limited: 'Too many requests for now; try again later.',
      bad_ticket: 'The title (up to 140 characters) and the body are both required; attention must be auto, checked or hands_on; a budget is 1–10000 whole dollars.',
      bad_budget: 'A budget is a whole number of dollars from 1 to 10000, or null for none.',
      closed: 'That request is closed.',
      not_withdrawable: 'Only a request that has not been approved yet can be withdrawn. Ask with portal_reply.',
      bad_project: 'That project is not on this account. Use an id from portal_projects.',
    };
    throw new Error(`${code}${hint[code] ? `: ${hint[code]}` : ''}`);
  }
  return data;
}

const dollars = (usd: unknown) => (typeof usd === 'number' ? Math.round(usd * 100) : usd === null ? null : undefined);

export async function callClientTool(env: Env, ctx: Ctx, token: string | null, name: string, args: Record<string, unknown>) {
  if (!token) {
    throw new Error(
      'This tool works for a ptechsolutions.net client. Make an agent token in the portal (Connect an assistant) and send it as "Authorization: Bearer cat_…".',
    );
  }
  const id = Number(args.request_id);
  switch (name) {
    case 'portal_projects': {
      const me = await portalCall(env, ctx, token, 'GET', '/portal/me');
      return { projects: me?.projects ?? [], spending: me?.usage ?? null };
    }
    case 'portal_profile': {
      // `_meta["openai/profile"]`: a stable opaque id, so ChatGPT can label and
      // de-duplicate connected accounts. Never the email — that can change.
      const me = await portalCall(env, ctx, token, 'GET', '/portal/me');
      const user = (me?.user ?? {}) as Record<string, unknown>;
      if (user.id === undefined || user.id === null) throw new Error('unauthorized: no account behind this token.');
      return {
        id: `mpt_${String(user.id)}`,
        ...(typeof user.name === 'string' && user.name ? { name: user.name } : {}),
        ...(typeof user.email === 'string' && user.email ? { email: user.email } : {}),
      };
    }
    case 'portal_requests':
      return portalCall(env, ctx, token, 'GET', '/portal/tickets');
    case 'portal_board': {
      // One shape for the card: what the view draws, and what a text-only host reads.
      const [me, list] = await Promise.all([
        portalCall(env, ctx, token, 'GET', '/portal/me'),
        portalCall(env, ctx, token, 'GET', '/portal/tickets'),
      ]);
      const projects = Array.isArray(me?.projects) ? (me.projects as Array<Record<string, unknown>>) : [];
      const tickets = Array.isArray(list?.tickets) ? (list.tickets as Array<Record<string, unknown>>) : [];
      const cents = (value: unknown) => (typeof value === 'number' ? value : null);
      const text = (value: unknown) => (typeof value === 'string' && value ? value : null);
      const closed = (status: unknown) => status === 'done' || status === 'declined';
      // The database keeps Unix seconds; the card wants a time it can say "2 hours ago" about.
      const when = (value: unknown) => (typeof value === 'number' ? new Date(value * 1000).toISOString() : text(value));
      const sites = projects.flatMap((project) =>
        (Array.isArray(project.sites) ? (project.sites as Array<Record<string, unknown>>) : []).map((site) => {
          const domain = text(site.customDomain);
          return {
            id: text(site.id),
            name: text(site.name) ?? text(project.name),
            project: text(project.name),
            project_id: text(project.id),
            state: text(site.state),
            // A production pointer means something is live; a preview pointer, something to look at.
            live: site.state === 'ready' && Boolean(site.productionDeploy),
            has_preview: site.state === 'ready' && Boolean(site.previewDeploy),
            preview_url: text(site.previewUrl),
            production_url: domain ? `https://${domain}` : text(site.productionUrl),
            updated_at: when(site.updatedAt),
          };
        }),
      );
      const siteNames = new Map(sites.map((site) => [site.id, site.name]));
      const usage = ((me?.usage ?? {}) as Record<string, unknown>);
      const whole = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0);
      return {
        account: { name: text((me?.user as Record<string, unknown> | undefined)?.name) },
        projects: projects.map((project) => {
          const mine = tickets.filter((ticket) => ticket.project_id === project.id);
          const setup = (project.setup ?? {}) as Record<string, unknown>;
          return {
            id: text(project.id),
            name: text(project.name),
            requests: mine.length,
            open: mine.filter((ticket) => !closed(ticket.status)).length,
            sites: Array.isArray(project.sites) ? project.sites.length : 0,
            setup: {
              ready: typeof setup.ready === 'number' ? setup.ready : 0,
              total: typeof setup.total === 'number' ? setup.total : 0,
              next: text(setup.next),
            },
          };
        }),
        sites,
        requests: tickets.map((ticket) => ({
          id: ticket.id,
          title: text(ticket.title),
          status: text(ticket.status),
          project: text(ticket.project_name),
          project_id: text(ticket.project_id),
          site: siteNames.get(text(ticket.site_id)) ?? null,
          updated_at: when(ticket.updated_at),
          unread: !!ticket.unread,
          price_cents: cents(ticket.price_cents),
          budget_cents: cents(ticket.budget_cents),
        })),
        updated_at: new Date().toISOString(),
        focus: Number.isInteger(args.request_id) && tickets.some((ticket) => ticket.id === args.request_id) ? (args.request_id as number) : null,
        locale: text((me?.user as Record<string, unknown> | undefined)?.locale),
        spending: {
          billed_cents: whole(usage.billedCents),
          open_cents: whole(usage.openCents),
          ai_cents: whole(usage.aiCents),
        },
      };
    }
    case 'portal_request':
      return portalCall(env, ctx, token, 'GET', `/portal/tickets/${Number.isInteger(id) ? id : 0}`);
    case 'portal_file_request': {
      const out = await portalCall(env, ctx, token, 'POST', '/portal/tickets', {
        title: args.title,
        body: args.body,
        projectId: args.project_id,
        attention: args.attention,
        budgetCents: dollars(args.budget_usd),
      });
      return {
        request_id: out?.id,
        status: out?.autoApproved ? 'Approved (Autopilot)' : 'Waiting for a developer',
        note: out?.autoApproved
          ? 'Autopilot with a budget: it starts without waiting for a developer, inside the client-set cap. Follow it with portal_request.'
          : 'Nothing starts until a developer has read it. Follow it with portal_request.',
      };
    }
    case 'portal_reply':
      await portalCall(env, ctx, token, 'POST', `/portal/tickets/${Number.isInteger(id) ? id : 0}/messages`, { body: args.text });
      return { ok: true };
    case 'portal_set_budget':
      return portalCall(env, ctx, token, 'PATCH', `/portal/tickets/${Number.isInteger(id) ? id : 0}/budget`, { budgetCents: dollars(args.budget_usd) });
    case 'portal_withdraw':
      await portalCall(env, ctx, token, 'POST', `/portal/tickets/${Number.isInteger(id) ? id : 0}/withdraw`);
      return { ok: true, status: 'Declined (withdrawn)' };
    case 'portal_move_request': {
      const id = Number(args.request_id);
      return portalCall(env, ctx, token, 'PATCH', `/portal/tickets/${Number.isInteger(id) ? id : 0}`, {
        projectId: args.project_id,
        siteId: args.site_id ?? null,
      });
    }
    case 'portal_move_site':
      return portalCall(env, ctx, token, 'PATCH', `/portal/sites/${encodeURIComponent(String(args.site_id ?? ''))}`, {
        projectId: args.project_id,
      });
    case 'start_change': {
      const out = await portalCall(env, ctx, token, 'POST', '/portal/changes', {
        projectId: args.project_id,
        title: args.title,
        summary: args.summary,
      });
      return {
        request_id: out?.id,
        status: 'In progress',
        cost: 'This call starts no review. A developer review, if the client chooses one, is billed separately.',
        next: 'The request has a workspace: project_context and workspace_files describe it, workspace_read returns a file, submit_change sends whole files, preview_build rebuilds the preview, site_publish publishes, finish_change records the review choice.',
        review: reviewEstimate(),
      };
    }
    case 'finish_change': {
      const out = await portalCall(env, ctx, token, 'POST', `/portal/changes/${Number.isInteger(id) ? id : 0}/finish`, { review: args.review });
      if (out?.status === 'review') {
        return {
          status: 'In review',
          note: 'A developer has been emailed. They review it, and the client gets an email when it is approved or answered; replying to that email answers in the thread.',
        };
      }
      return {
        status: 'Done, kept without review',
        note: out?.canPublish
          ? 'The change is on the preview, and a developer has been emailed that it was kept without review. The client can take it live with site_publish when they are ready; that publish is on record as theirs.'
          : 'The change is on the preview, and a developer has been emailed. Client publishing is switched off right now, so taking it live is a developer’s step: the client can ask with portal_reply.',
      };
    }
    case 'project_context':
      return portalCall(env, ctx, token, 'GET', `/portal/tickets/${Number.isInteger(id) ? id : 0}/context`);
    case 'workspace_files':
      return portalCall(env, ctx, token, 'GET', `/portal/tickets/${Number.isInteger(id) ? id : 0}/workspace`);
    case 'workspace_read': {
      const path = typeof args.path === 'string' ? args.path.trim() : '';
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error('bad_request: pass the request id from start_change or portal_requests.');
      }
      if (!path) throw new Error('bad_path: pass the file path exactly as workspace_files listed it.');
      const out = await portalCall(env, ctx, token, 'GET', `/portal/tickets/${id}/workspace/file?path=${encodeURIComponent(path)}`);
      if (!out || typeof out.content !== 'string') {
        throw new Error('bad_workspace: the portal returned no file text. Try workspace_files again.');
      }
      // Not `content`: that is the MCP result envelope's own field name, and
      // ChatGPT drops a text result whose JSON carries a top-level `content`
      // key (it showed the call's arguments instead of the file).
      return { path, bytes: new TextEncoder().encode(out.content).length, source: out.content };
    }
    case 'submit_change':
      return portalCall(env, ctx, token, 'POST', `/portal/tickets/${Number.isInteger(id) ? id : 0}/change`, { files: args.files });
    case 'preview_build': {
      await portalCall(env, ctx, token, 'POST', `/portal/tickets/${Number.isInteger(id) ? id : 0}/build`);
      return { ok: true, state: 'queued', note: 'A machine builds it and posts the preview link to the request’s thread.' };
    }
    case 'site_status':
      return portalCall(env, ctx, token, 'GET', `/portal/projects/${String(args.project_id ?? '')}/site`);
    case 'site_deploys':
      return portalCall(env, ctx, token, 'GET', `/portal/projects/${String(args.project_id ?? '')}/site/deploys`);
    case 'site_publish':
      return portalCall(env, ctx, token, 'POST', `/portal/projects/${String(args.project_id ?? '')}/site/publish`, {});
    case 'site_rollback':
      return portalCall(env, ctx, token, 'POST', `/portal/projects/${String(args.project_id ?? '')}/site/rollback`, { deployId: args.deploy_id });
    case 'owner_requests':
      return portalCall(env, ctx, token, 'GET', '/admin/tickets?status=new');
    case 'owner_request':
      return portalCall(env, ctx, token, 'GET', `/admin/tickets/${Number.isInteger(id) ? id : 0}`);
    case 'owner_approve_request':
      return portalCall(env, ctx, token, 'PATCH', `/admin/tickets/${Number.isInteger(id) ? id : 0}`, { status: 'approved' });
    case 'owner_decline_request':
      return portalCall(env, ctx, token, 'PATCH', `/admin/tickets/${Number.isInteger(id) ? id : 0}`, {
        status: 'declined',
        ...(typeof args.reason === 'string' && args.reason.trim() ? { reason: args.reason.trim() } : {}),
      });
    case 'owner_projects':
      return portalCall(env, ctx, token, 'GET', '/admin/projects');
    case 'owner_project_work': {
      const project = typeof args.project_id === 'string' ? args.project_id.trim() : '';
      if (!project) throw new Error('bad_request: pass the project id from owner_projects.');
      return portalCall(env, ctx, token, 'GET', `/admin/tickets?projectId=${encodeURIComponent(project)}`);
    }
    case 'owner_clients':
      return portalCall(env, ctx, token, 'GET', '/admin/clients');
    case 'owner_queue':
      return portalCall(env, ctx, token, 'GET', '/admin/queue');
    case 'owner_runs':
      return portalCall(env, ctx, token, 'GET', '/admin/runs');
    case 'owner_publish':
      return portalCall(env, ctx, token, 'POST', `/admin/projects/${String(args.project_id ?? '')}/site/publish`, {});
    case 'owner_rollback':
      return portalCall(env, ctx, token, 'POST', `/admin/projects/${String(args.project_id ?? '')}/site/rollback`, { deployId: args.deploy_id });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
