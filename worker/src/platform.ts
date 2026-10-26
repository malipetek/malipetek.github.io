/*
 * GPTflare control plane, surfaced through our MCP server.
 *
 * The control plane already had a Custom-GPT "Actions" surface: 21 OpenAPI
 * operations at api.gptflare.site, authorized by a shared platform key, with a
 * per-conversation sign-in (`start-auth` -> magic link -> `authRequestId`)
 * threaded through every call. ChatGPT now wants apps built on MCP connectors,
 * so this module re-exposes those same real operations as MCP tools instead of
 * leaving them reachable only from a hand-built GPT.
 *
 * Two things differ from the old path, both deliberate:
 *
 *   1. The platform key is a Worker secret here. It never travels to the
 *      model, the connector config, or a browser-automation script.
 *   2. Every tool requires OUR admin auth. The platform's own mock MCP
 *      servers were unauthenticated; this one is not.
 */
import type { Env } from './shared.ts';

export const PLATFORM_DEFAULT_URL = 'https://api.gptflare.site';

export interface PlatformTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const str = (description: string) => ({ type: 'string', description });
const AUTH_REQUEST = {
  type: 'string',
  description:
    'The authRequestId from platform_start_auth. Sign-in is per conversation: reuse the same id for every later call, or the platform returns AUTH_REQUEST_EXPIRED.',
};
const SITE_ID = { type: 'string', description: 'The site id from platform_list_sites.' };

export const PLATFORM_TOOLS: PlatformTool[] = [
  {
    name: 'platform_status',
    title: 'GPTflare control plane status',
    description:
      'Check that the GPTflare control plane is reachable from this site and that the platform key is configured. Start here when a platform tool fails.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'platform_start_auth',
    title: 'Sign in to GPTflare',
    description:
      'Send the owner a single-use magic-link sign-in email and return an authRequestId. Ask the human to open the link, then poll platform_auth_status. Every other platform tool needs that authRequestId.',
    inputSchema: {
      type: 'object',
      properties: { email: str('Email address of the GPTflare account owner.') },
      required: ['email'],
      additionalProperties: false,
    },
  },
  {
    name: 'platform_auth_status',
    title: 'Check GPTflare sign-in',
    description: 'Poll whether the magic link has been opened. Reports canCreateSite once the sign-in is verified.',
    inputSchema: {
      type: 'object',
      properties: { auth_request_id: AUTH_REQUEST },
      required: ['auth_request_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'platform_get_context',
    title: 'Read saved GPTflare account context',
    description:
      'Durable notes the control plane remembers about this account, plus its most recent sites. Read it before asking the human to repeat themselves.',
    inputSchema: {
      type: 'object',
      properties: { auth_request_id: AUTH_REQUEST },
      required: ['auth_request_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'platform_list_sites',
    title: 'List GPTflare sites',
    description: 'Every site owned by the signed-in account, with status, urls and worker names.',
    inputSchema: {
      type: 'object',
      properties: { auth_request_id: AUTH_REQUEST },
      required: ['auth_request_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'platform_site_state',
    title: 'Read a site repo state',
    description: 'Git state for one site: branch, latest revision and whether a preview is ahead of production.',
    inputSchema: {
      type: 'object',
      properties: { auth_request_id: AUTH_REQUEST, site_id: SITE_ID },
      required: ['auth_request_id', 'site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'platform_site_status',
    title: 'Read a site deploy status',
    description: 'Provisioning and deploy status for one site, including preview and production urls.',
    inputSchema: {
      type: 'object',
      properties: { auth_request_id: AUTH_REQUEST, site_id: SITE_ID },
      required: ['auth_request_id', 'site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'platform_preview_status',
    title: 'Read a site preview status',
    description: 'Whether the latest preview build succeeded, is still running, or failed.',
    inputSchema: {
      type: 'object',
      properties: { auth_request_id: AUTH_REQUEST, site_id: SITE_ID },
      required: ['auth_request_id', 'site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'platform_operation_status',
    title: 'Read a control-plane operation',
    description:
      'Poll a long-running operation (create-site, provision-site, edit-preview). Returns the same envelope the GPT Actions used: phase, user-safe message, canTellUserDone, retryAfterSeconds and safe links.',
    inputSchema: {
      type: 'object',
      properties: {
        auth_request_id: AUTH_REQUEST,
        operation_id: str('Operation id returned by the call that started it.'),
      },
      required: ['auth_request_id', 'operation_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'platform_list_files',
    title: 'List a site repo files',
    description: 'List files in a site repo, optionally filtered by path prefix. Use before editing so paths are real.',
    inputSchema: {
      type: 'object',
      properties: {
        auth_request_id: AUTH_REQUEST,
        site_id: SITE_ID,
        prefix: str('Optional path prefix, e.g. "src/pages".'),
        branch: str('Optional branch; defaults to the site preview branch.'),
      },
      required: ['auth_request_id', 'site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'platform_read_file',
    title: 'Read a site file',
    description: 'Read one file from a site repo as text. Protected paths (wrangler.toml, package.json, .github) are refused by the platform.',
    inputSchema: {
      type: 'object',
      properties: {
        auth_request_id: AUTH_REQUEST,
        site_id: SITE_ID,
        path: str('Repo-relative path, e.g. "src/pages/index.astro".'),
        branch: str('Optional branch; defaults to the site preview branch.'),
      },
      required: ['auth_request_id', 'site_id', 'path'],
      additionalProperties: false,
    },
  },
  {
    name: 'platform_edit_preview',
    title: 'Edit a site preview',
    description:
      'Write files to the site preview branch. Preview-first: nothing reaches production until platform_approve_preview is called. At most 40 files, 512 KB each, 2 MB total.',
    inputSchema: {
      type: 'object',
      properties: {
        auth_request_id: AUTH_REQUEST,
        site_id: SITE_ID,
        files: {
          type: 'array',
          description: 'Files to write.',
          items: {
            type: 'object',
            properties: { path: str('Repo-relative path.'), content: str('Full new file content.') },
            required: ['path', 'content'],
            additionalProperties: false,
          },
        },
        commit_message: str('Optional commit message.'),
      },
      required: ['auth_request_id', 'site_id', 'files'],
      additionalProperties: false,
    },
  },
  {
    name: 'platform_approve_preview',
    title: 'Approve a preview into production',
    description:
      'Promote the reviewed preview to production. This is the human-approval gate: call it only when the owner has explicitly approved what they saw.',
    inputSchema: {
      type: 'object',
      properties: {
        auth_request_id: AUTH_REQUEST,
        site_id: SITE_ID,
        commit_message: str('Optional merge commit message.'),
      },
      required: ['auth_request_id', 'site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'platform_reset_preview',
    title: 'Reset a preview from production',
    description: 'Throw away preview changes by resetting the preview branch to production. Requires confirm_reset true.',
    inputSchema: {
      type: 'object',
      properties: {
        auth_request_id: AUTH_REQUEST,
        site_id: SITE_ID,
        confirm_reset: { type: 'boolean', description: 'Must be true; the platform refuses otherwise.' },
      },
      required: ['auth_request_id', 'site_id', 'confirm_reset'],
      additionalProperties: false,
    },
  },
  {
    name: 'platform_create_site',
    title: 'Create a GPTflare site',
    description:
      'Create a new draft site from a conversation brief. Returns an operation to poll with platform_operation_status. Requires a completed sign-in.',
    inputSchema: {
      type: 'object',
      properties: {
        auth_request_id: AUTH_REQUEST,
        site_name: str('Human-readable site name.'),
        site_type: str('Template key, e.g. "business". The platform rejects unsupported keys with a clear error.'),
        audience: str('Who the site is for.'),
        tone: str('Voice and tone.'),
        goals: str('What the site must achieve.'),
        differentiator: str('What makes it different.'),
      },
      required: ['auth_request_id', 'site_name', 'site_type', 'audience', 'tone', 'goals', 'differentiator'],
      additionalProperties: false,
    },
  },
  {
    name: 'platform_provision_site',
    title: 'Provision a site',
    description:
      'Turn an approved draft into a real repo plus Workers Builds project. Slow and side-effecting: poll platform_operation_status afterwards.',
    inputSchema: {
      type: 'object',
      properties: { auth_request_id: AUTH_REQUEST, site_id: SITE_ID },
      required: ['auth_request_id', 'site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'platform_github_access',
    title: 'Check repository access',
    description: 'Whether the GitHub App can reach the site repo, and what to ask the human for when it cannot.',
    inputSchema: {
      type: 'object',
      properties: { auth_request_id: AUTH_REQUEST, site_id: SITE_ID },
      required: ['auth_request_id', 'site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'platform_request_repository_access',
    title: 'Request repository access',
    description: 'Emit the GitHub App install/authorize link the human must open to grant repo access.',
    inputSchema: {
      type: 'object',
      properties: { auth_request_id: AUTH_REQUEST, site_id: SITE_ID },
      required: ['auth_request_id', 'site_id'],
      additionalProperties: false,
    },
  },
];

/* ——————————————————————— transport ——————————————————————— */

export class PlatformError extends Error {}

export interface CallOptions {
  method?: 'GET' | 'POST';
  query?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
}

export async function platformFetch(env: Env, path: string, options: CallOptions = {}): Promise<unknown> {
  const key = env.PLATFORM_GPT_API_KEY;
  if (!key) {
    throw new PlatformError(
      'The GPTflare platform key is not configured on this Worker. Set the PLATFORM_GPT_API_KEY secret.',
    );
  }

  const base = (env.PLATFORM_API_URL || PLATFORM_DEFAULT_URL).replace(/\/$/, '');
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  }

  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${key}`,
      accept: 'application/json',
      'user-agent': 'malipetek.dev-mcp/1.0',
    },
  };
  if (options.body) {
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), init);
  } catch (error) {
    throw new PlatformError(`Could not reach the control plane: ${(error as Error)?.message ?? 'network error'}`);
  }

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text.slice(0, 500) };
  }

  if (!response.ok) {
    const message = (payload as { error?: string })?.error ?? text.slice(0, 300) ?? '';
    // Pass the platform's own wording through: it is written for a model to act on
    // ("Call startBuilderAuth again", "AUTH_REQUEST_EXPIRED", ...).
    throw new PlatformError(`${response.status} ${message || response.statusText}`);
  }

  return payload;
}

/* ——————————————————————— dispatch ——————————————————————— */

type Author = { kind: 'key'; id: number; agent: string } | { kind: 'admin' };

/** Every platform tool is admin-only; a KB agent key must not provision sites. */
export async function callPlatformTool(
  env: Env,
  name: string,
  args: Record<string, unknown>,
  author: Author | null,
): Promise<unknown> {
  if (!author) {
    throw new PlatformError(
      'GPTflare tools need the owner’s portal session in the Authorization header (Bearer <portal-session>).',
    );
  }
  if (author.kind !== 'admin') {
    throw new PlatformError('GPTflare tools are restricted to the site owner.');
  }

  const authRequestId = typeof args.auth_request_id === 'string' ? args.auth_request_id : '';
  const siteId = typeof args.site_id === 'string' ? args.site_id : '';
  const branch = typeof args.branch === 'string' ? args.branch : undefined;
  const needAuth = (): string => {
    if (!authRequestId) throw new PlatformError('auth_request_id is required. Call platform_start_auth first.');
    return authRequestId;
  };

  switch (name) {
    case 'platform_status': {
      const health = await platformFetch(env, '/api/health');
      let ping: unknown = null;
      try {
        ping = await platformFetch(env, '/api/gpt/bootstrap/ping', { method: 'POST', body: {} });
      } catch (error) {
        ping = { error: (error as Error).message };
      }
      return {
        health,
        platform_key_configured: true,
        ping,
        note: 'Site-level actions also need a sign-in: platform_start_auth, then poll platform_auth_status.',
      };
    }
    case 'platform_start_auth':
      return platformFetch(env, '/api/gpt/bootstrap/start-auth', {
        method: 'POST',
        body: { email: args.email },
      });
    case 'platform_auth_status':
      return platformFetch(env, '/api/gpt/bootstrap/auth-status', { query: { authRequestId: needAuth() } });
    case 'platform_get_context':
      return platformFetch(env, '/api/gpt/bootstrap/user-context', { query: { authRequestId: needAuth() } });
    case 'platform_list_sites':
      return platformFetch(env, '/api/gpt/bootstrap/sites', { query: { authRequestId: needAuth() } });
    case 'platform_site_state':
      return platformFetch(env, '/api/gpt/bootstrap/site-state', {
        query: { authRequestId: needAuth(), siteId },
      });
    case 'platform_site_status':
      return platformFetch(env, '/api/gpt/bootstrap/site-status', {
        query: { authRequestId: needAuth(), siteId },
      });
    case 'platform_preview_status':
      return platformFetch(env, '/api/gpt/bootstrap/preview-status', {
        query: { authRequestId: needAuth(), siteId },
      });
    case 'platform_operation_status':
      return platformFetch(env, '/api/gpt/bootstrap/operation-status', {
        query: { authRequestId: needAuth(), operationId: String(args.operation_id ?? '') },
      });
    case 'platform_list_files':
      return platformFetch(env, '/api/gpt/bootstrap/files', {
        query: {
          authRequestId: needAuth(),
          siteId,
          prefix: typeof args.prefix === 'string' ? args.prefix : undefined,
          branch,
        },
      });
    case 'platform_read_file':
      return platformFetch(env, '/api/gpt/bootstrap/file', {
        query: { authRequestId: needAuth(), siteId, path: String(args.path ?? ''), branch },
      });
    case 'platform_edit_preview': {
      const files = Array.isArray(args.files) ? args.files : [];
      if (!files.length) throw new PlatformError('files must contain at least one {path, content} entry.');
      return platformFetch(env, '/api/gpt/bootstrap/edit-preview', {
        method: 'POST',
        body: {
          authRequestId: needAuth(),
          siteId,
          files,
          commitMessage: typeof args.commit_message === 'string' ? args.commit_message : undefined,
        },
      });
    }
    case 'platform_approve_preview':
      return platformFetch(env, '/api/gpt/bootstrap/approve-preview', {
        method: 'POST',
        body: {
          authRequestId: needAuth(),
          siteId,
          commitMessage: typeof args.commit_message === 'string' ? args.commit_message : undefined,
        },
      });
    case 'platform_reset_preview':
      return platformFetch(env, '/api/gpt/bootstrap/reset-preview', {
        method: 'POST',
        body: { authRequestId: needAuth(), siteId, confirmReset: args.confirm_reset === true },
      });
    case 'platform_create_site':
      return platformFetch(env, '/api/gpt/bootstrap/create-site', {
        method: 'POST',
        body: {
          authRequestId: needAuth(),
          siteName: args.site_name,
          siteType: args.site_type,
          audience: args.audience,
          tone: args.tone,
          goals: args.goals,
          differentiator: args.differentiator,
        },
      });
    case 'platform_provision_site':
      return platformFetch(env, '/api/gpt/bootstrap/provision-site', {
        method: 'POST',
        body: { authRequestId: needAuth(), siteId },
      });
    case 'platform_github_access':
      return platformFetch(env, '/api/gpt/bootstrap/github-access', {
        query: { authRequestId: needAuth(), siteId },
      });
    case 'platform_request_repository_access':
      return platformFetch(env, '/api/gpt/bootstrap/github-access', {
        method: 'POST',
        body: { authRequestId: needAuth(), siteId },
      });
    default:
      throw new PlatformError(`Unknown platform tool: ${name}`);
  }
}
