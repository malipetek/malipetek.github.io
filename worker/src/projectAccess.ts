import type { Context } from 'hono';
import type { Env, HonoEnv } from './shared.ts';

type Identity = { id: string; role: string };
type AccessEnv = HonoEnv & { Variables: { user: Identity; viaAgent: boolean } };
export const isSuperAdmin = (user: Identity) => user.role === 'admin';

/** Grants are read live: a session never caches membership or promotes a client. */
export async function accessFor(env: Env, user: Identity) {
  const rows = isSuperAdmin(user) ? [] : (await env.DB.prepare(
    `SELECT project_id FROM project_memberships WHERE user_id = ? AND member_type = 'trusted_developer' ORDER BY project_id`,
  ).bind(user.id).all<{project_id: string}>()).results ?? [];
  const developerProjectIds = rows.map(row => row.project_id);
  return { superAdmin: isSuperAdmin(user), canUseWorkbench: isSuperAdmin(user) || developerProjectIds.length > 0, developerProjectIds };
}

export async function canWorkProject(env: Env, user: Identity, projectId: string | null | undefined) {
  if (!projectId) return false;
  if (isSuperAdmin(user)) return true;
  return !!await env.DB.prepare(`SELECT 1 FROM project_memberships WHERE project_id = ? AND user_id = ? AND member_type = 'trusted_developer'`)
    .bind(projectId, user.id).first();
}

export async function ownsProject(env: Env, user: Identity, projectId: string) {
  return !!await env.DB.prepare('SELECT 1 FROM projects WHERE id = ? AND owner_user_id = ?').bind(projectId, user.id).first();
}

/** Only source-controlled identifiers may enter this helper; values are always bound. */
export function projectScope(user: Identity, column = 't.project_id') {
  if (!/^[a-z_]+\.[a-z_]+$/.test(column)) throw new Error('Invalid SQL scope column');
  return isSuperAdmin(user) ? { sql: '1 = 1', bindings: [] as string[] } : {
    sql: `EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.project_id = ${column} AND pm.user_id = ? AND pm.member_type = 'trusted_developer')`,
    bindings: [user.id],
  };
}

export const requireSuperAdmin = async (c: Context<AccessEnv>, next: () => Promise<void>) => {
  if (c.get('viaAgent') || !isSuperAdmin(c.get('user'))) return c.json({error:'forbidden'},403);
  return next();
};
export const requireWorkbench = async (c: Context<AccessEnv>, next: () => Promise<void>) => {
  if (c.get('viaAgent') || !(await accessFor(c.env,c.get('user'))).canUseWorkbench) return c.json({error:'forbidden'},403);
  return next();
};
export const requireProjectWork = async (c: Context<AccessEnv>, next: () => Promise<void>) => {
  if (c.get('viaAgent') || !await canWorkProject(c.env,c.get('user'),c.req.param('id'))) return c.json({error:'not_found'},404);
  return next();
};

/** Explicit allowlist. New/global routes fail closed, even with a project-shaped URL. */
export async function authorizeWorkbenchRoute(env: Env, user: Identity, method: string, path: string) {
  if (isSuperAdmin(user)) return true;
  if (method === 'GET' && ['/admin/projects','/admin/tickets','/admin/search','/admin/runs','/admin/attention'].includes(path)) return (await accessFor(env,user)).canUseWorkbench;
  if (method === 'POST' && path === '/admin/work') return (await accessFor(env,user)).canUseWorkbench; // body resolved in handler
  let match = path.match(/^\/admin\/tickets\/(\d+)(.*)$/);
  if (match) {
    const action = match[2];
    const allowed = method === 'GET' && (action === '' || /^\/files\/[^/]+$/.test(action)) || method === 'PATCH' && action === '' || method === 'POST' && ['/land','/time','/messages','/answered','/claim','/run-result'].includes(action);
    if (!allowed) return false;
    const ticket = await env.DB.prepare('SELECT project_id FROM tickets WHERE id = ?').bind(Number(match[1])).first<{project_id:string|null}>();
    return !!ticket && canWorkProject(env,user,ticket.project_id);
  }
  match = path.match(/^\/admin\/runs\/(\d+)\/(steps|session|cancel)$/);
  if (match && (method === 'GET' && match[2] !== 'cancel' || method === 'POST' && match[2] === 'cancel')) {
    const run = await env.DB.prepare('SELECT t.project_id FROM ticket_runs r JOIN tickets t ON t.id = r.ticket_id WHERE r.id = ?').bind(Number(match[1])).first<{project_id:string|null}>();
    return !!run && canWorkProject(env,user,run.project_id);
  }
  match = path.match(/^\/admin\/sites\/([^/]+)$/);
  if (match && method === 'PATCH') {
    const site = await env.DB.prepare('SELECT project_id FROM sites WHERE id = ?').bind(match[1]).first<{project_id:string}>();
    return !!site && canWorkProject(env,user,site.project_id);
  }
  match = path.match(/^\/admin\/projects\/([^/]+)(.*)$/);
  if (!match) return false;
  const [,projectId,action] = match;
  if (/^\/memberships(?:\/[^/]+)?$/.test(action)) {
    if (method === 'POST') return false; // grants are always super-admin only
    if (method === 'DELETE' && /^\/memberships\/[^/]+$/.test(action)) return ownsProject(env,user,projectId);
    if (method === 'GET' && action === '/memberships') return await ownsProject(env,user,projectId) || canWorkProject(env,user,projectId);
    return false;
  }
  if (method === 'DELETE' && action === '') return ownsProject(env,user,projectId);
  const allowed = method === 'GET' && ['', '/secrets','/site/deploys','/recipients','/integrations'].includes(action)
    || method === 'PATCH' && action === ''
    || method === 'PUT' && (action === '/repo' || action === '/solutions' || /^\/secrets\/[^/]+$/.test(action))
    || method === 'POST' && /^\/integrations\/[^/]+\/verify$/.test(action)
    || method === 'DELETE' && (action === '/site' || /^\/secrets\/[^/]+$/.test(action))
    || method === 'POST' && (['/mentions','/git-token','/repo/create','/repo/github','/site/retry','/site/publish','/site/rollback','/site/host','/site/domain','/site/rebuild','/site'].includes(action) || /^\/secrets\/[^/]+\/reveal$/.test(action));
  return allowed && canWorkProject(env,user,projectId);
}

const encoder = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (value: string) => Uint8Array.from(atob(value), x => x.charCodeAt(0));
async function secretKey(env: Env) {
  if (!env.SESSION_SECRET) throw new Error('Project secret encryption is unavailable');
  const key = await crypto.subtle.importKey('raw',encoder.encode(env.SESSION_SECRET),'HKDF',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encoder.encode('ptech-project-secrets-v1'),info:encoder.encode('project-value-at-rest')},key,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
const secretContext = (projectId: string,name: string) => encoder.encode(JSON.stringify(['project-secret-v1',projectId,name]));
export async function sealProjectSecret(env: Env,projectId: string,name: string,value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:secretContext(projectId,name)},await secretKey(env),encoder.encode(value));
  return `v1.${b64(iv)}.${b64(new Uint8Array(encrypted))}`;
}
export async function openProjectSecret(env: Env,projectId: string,name: string,sealed: string) {
  const [version,iv,box] = sealed.split('.');
  if (version !== 'v1' || !iv || !box) throw new Error('Invalid project secret');
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:secretContext(projectId,name)},await secretKey(env),unb64(box)));
}
