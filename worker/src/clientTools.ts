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
import { ATTENTION_KEYS } from '../../src/lib/pricing.js';
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
}

const ATTENTION = {
  type: 'string',
  enum: ATTENTION_KEYS,
  description: 'How much of Ali’s time: auto (Autopilot, cheapest), checked (the default: he reads every change), hands_on (Hands-on, by the clock).',
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
    name: 'portal_request',
    title: 'Read a request',
    description: 'One request: its status, its cost and budget, and the whole conversation with Ali.',
    inputSchema: { type: 'object', properties: { request_id: REQUEST_ID }, required: ['request_id'], additionalProperties: false },
    readOnly: true,
  },
  {
    name: 'portal_file_request',
    title: 'File a request',
    description:
      'Ask for a change or a new piece of work. Write it the way you would to a person: what you want and why. Nothing starts until Ali has read it. Pass project_id from portal_projects when it is about one of them.',
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
    description: 'Add a message to a request’s conversation. Ali is emailed.',
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
      'Take back a request Ali has not approved yet; it is closed and costs nothing. Once he has approved it, ask him with portal_reply instead.',
    inputSchema: { type: 'object', properties: { request_id: REQUEST_ID }, required: ['request_id'], additionalProperties: false },
    readOnly: false,
  },
  {
    name: 'project_context',
    title: 'Request context',
    description:
      'Everything about one approved request that your own agent needs to work on it: the project brief, the whole conversation, the site’s state and how it builds. Read this first.',
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
    description: 'One file’s full text from the site’s current preview, by path from workspace_files.',
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
      'Send the files you changed for an approved request: whole contents, at most 40 files and 2 MB. They land on the request’s own branch — never production. Then call preview_build so the preview shows them.',
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
      'Apply the change you sent with submit_change and rebuild the preview site. A machine picks it up; the request’s thread gets the preview link. Send the change first.',
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
      'Take the preview live. Only works when Ali has turned on client publishing; until then ask him. Confirm with the client first.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' } }, required: ['project_id'], additionalProperties: false },
    readOnly: false,
  },
  {
    name: 'site_rollback',
    title: 'Roll the site back',
    description: 'Point production at an older deploy from site_deploys. Same publishing permission as site_publish.',
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
      rate_limited: 'Too many requests for now; try again later.',
      bad_ticket: 'The title (up to 140 characters) and the body are both required; attention must be auto, checked or hands_on; a budget is 1–10000 whole dollars.',
      bad_budget: 'A budget is a whole number of dollars from 1 to 10000, or null for none.',
      closed: 'That request is closed.',
      not_withdrawable: 'Only a request Ali has not approved yet can be withdrawn. Ask him with portal_reply.',
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
      'This tool works for a malipetek.dev client. Make an agent token in the portal (Connect an assistant) and send it as "Authorization: Bearer cat_…".',
    );
  }
  const id = Number(args.request_id);
  switch (name) {
    case 'portal_projects': {
      const me = await portalCall(env, ctx, token, 'GET', '/portal/me');
      return { projects: me?.projects ?? [], spending: me?.usage ?? null };
    }
    case 'portal_requests':
      return portalCall(env, ctx, token, 'GET', '/portal/tickets');
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
      return { request_id: out?.id, status: 'Waiting for Ali', note: 'Nothing starts until Ali has read it. Follow it with portal_request.' };
    }
    case 'portal_reply':
      await portalCall(env, ctx, token, 'POST', `/portal/tickets/${Number.isInteger(id) ? id : 0}/messages`, { body: args.text });
      return { ok: true };
    case 'portal_set_budget':
      return portalCall(env, ctx, token, 'PATCH', `/portal/tickets/${Number.isInteger(id) ? id : 0}/budget`, { budgetCents: dollars(args.budget_usd) });
    case 'portal_withdraw':
      await portalCall(env, ctx, token, 'POST', `/portal/tickets/${Number.isInteger(id) ? id : 0}/withdraw`);
      return { ok: true, status: 'Declined (withdrawn)' };
    case 'project_context':
      return portalCall(env, ctx, token, 'GET', `/portal/tickets/${Number.isInteger(id) ? id : 0}/context`);
    case 'workspace_files':
      return portalCall(env, ctx, token, 'GET', `/portal/tickets/${Number.isInteger(id) ? id : 0}/workspace`);
    case 'workspace_read':
      return portalCall(env, ctx, token, 'GET', `/portal/tickets/${Number.isInteger(id) ? id : 0}/workspace/file?path=${encodeURIComponent(String(args.path ?? ''))}`);
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
