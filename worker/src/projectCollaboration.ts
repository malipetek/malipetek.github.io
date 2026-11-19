import type { Hono } from 'hono';
import type { Env } from './shared.ts';
import { canWorkProject } from './projectAccess.ts';

export type ProjectActor = { id: string; role: string };
export type MentionMailer = (env: Env, to: string, mail: { subject: string; text: string }) => Promise<boolean>;
export class CollaborationError extends Error {
  status: 400 | 404 | 409;
  constructor(code: string, status: 400 | 404 | 409 = 400) { super(code); this.status = status; }
}
export type ProjectRecipient = { userId: string; name: string | null; email: string; memberType: 'client' | 'trusted_developer' };
async function requireProject(env: Env, actor: ProjectActor, projectId: string) {
  if (!actor || !await canWorkProject(env, actor, projectId) || !await env.DB.prepare('SELECT 1 FROM projects WHERE id = ?').bind(projectId).first()) throw new CollaborationError('not_found',404);
}
/** No global account directory and no inferred developer grants. */
export async function listProjectRecipients(env: Env, actor: ProjectActor, projectId: string): Promise<ProjectRecipient[]> {
  await requireProject(env, actor, projectId);
  return (await env.DB.prepare(`SELECT u.id AS userId, u.name, u.email,
    CASE WHEN EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.project_id = ? AND pm.user_id = u.id AND pm.member_type = 'trusted_developer') THEN 'trusted_developer' ELSE 'client' END AS memberType
    FROM users u WHERE u.verified_at IS NOT NULL AND (
      EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.project_id = ? AND pm.user_id = u.id AND pm.member_type = 'trusted_developer')
      OR EXISTS (SELECT 1 FROM user_projects up WHERE up.project_id = ? AND up.user_id = u.id)) ORDER BY u.email,u.id`)
    .bind(projectId,projectId,projectId).all<ProjectRecipient>()).results ?? [];
}
function parseInput(value: unknown) {
  if (!value || typeof value !== 'object') throw new CollaborationError('bad_mentions');
  const {ticketId,messageId,recipientUserIds,requestId} = value as Record<string,unknown>;
  if (!Number.isSafeInteger(ticketId) || Number(ticketId) <= 0 || !Number.isSafeInteger(messageId) || Number(messageId) <= 0 || typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)
      || !Array.isArray(recipientUserIds) || !recipientUserIds.length || recipientUserIds.length > 25 || recipientUserIds.some(id=>typeof id !== 'string' || !id || id.length>128)) throw new CollaborationError('bad_mentions');
  return {ticketId:Number(ticketId), messageId:Number(messageId), requestId, recipientUserIds:[...new Set(recipientUserIds as string[])].sort()};
}
type SavedMessage = { internal: number; kind: string };
async function savedMessage(env: Env, projectId: string, ticketId: number, messageId: number) {
  const message=await env.DB.prepare(`SELECT m.internal,t.kind FROM ticket_messages m JOIN tickets t ON t.id=m.ticket_id WHERE m.id=? AND m.ticket_id=? AND t.project_id=?`)
    .bind(messageId,ticketId,projectId).first<SavedMessage>();
  if (!message) throw new CollaborationError('not_found',404);
  return message;
}
const canReceive = (recipient: ProjectRecipient, message: SavedMessage) => recipient.memberType === 'trusted_developer' || (!message.internal && message.kind === 'client');

/** Persist mention+outbox atomically. Delivery is once-attempt, not an unprovable exactly-once email promise. */
export async function mentionProjectMessage(env: Env, actor: ProjectActor, projectId: string, value: unknown, sendMail: MentionMailer) {
  const input=parseInput(value);
  const recipients=await listProjectRecipients(env,actor,projectId);
  const message=await savedMessage(env,projectId,input.ticketId,input.messageId);
  const selected=input.recipientUserIds.map(id=>recipients.find(r=>r.userId===id));
  if (selected.some(r=>!r || !canReceive(r,message))) throw new CollaborationError('invalid_recipient');
  const time=Math.floor(Date.now()/1000);
  const payload=JSON.stringify([input.ticketId,input.messageId,input.recipientUserIds]);
  await env.DB.prepare(`INSERT INTO project_mention_requests(project_id,actor_user_id,request_id,payload,created_at) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING`)
    .bind(projectId,actor.id,input.requestId,payload,time).run();
  const request=await env.DB.prepare('SELECT payload FROM project_mention_requests WHERE project_id=? AND actor_user_id=? AND request_id=?').bind(projectId,actor.id,input.requestId).first<{payload:string}>();
  if (request?.payload !== payload) throw new CollaborationError('idempotency_conflict',409);
  const ids=input.recipientUserIds.map(id=>JSON.stringify([input.messageId,id]));
  await env.DB.batch(input.recipientUserIds.flatMap((recipient,index)=>[
    env.DB.prepare(`INSERT INTO project_mentions(id,project_id,ticket_id,message_id,recipient_user_id,actor_user_id,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(message_id,recipient_user_id) DO NOTHING`).bind(ids[index],projectId,input.ticketId,input.messageId,recipient,actor.id,time),
    env.DB.prepare(`INSERT INTO project_mention_outbox(mention_id) VALUES (?) ON CONFLICT DO NOTHING`).bind(ids[index]),
  ]));
  for (let index=0;index<ids.length;index++) {
    // Recheck live grants and message boundaries immediately before delivery.
    await requireProject(env,actor,projectId);
    const current=(await listProjectRecipients(env,actor,projectId)).find(r=>r.userId===input.recipientUserIds[index]);
    const allowed=current && canReceive(current,await savedMessage(env,projectId,input.ticketId,input.messageId));
    if (!allowed) {
      await env.DB.prepare(`UPDATE project_mention_outbox SET status='cancelled',error_code='recipient_unavailable' WHERE mention_id=? AND status='pending'`).bind(ids[index]).run();
      continue;
    }
    const claim=await env.DB.prepare(`UPDATE project_mention_outbox SET status='sending',attempted_at=? WHERE mention_id=? AND status='pending' RETURNING mention_id`).bind(time,ids[index]).first();
    if (!claim) continue;
    let sent=false;
    try {
      const base=env.PORTAL_URL || 'https://ptechsolutions.net';
      const url=new URL(base);
      if (url.protocol!=='https:') throw new Error('invalid_portal_origin');
      // Never copy ticket title, message contents, secrets or sender credentials into mail.
      const path=current.memberType==='trusted_developer' ? '/portal/admin#ticket=' : '/portal#/ticket/';
      sent=await sendMail(env,current.email,{subject:'PTech project mention',text:`You were mentioned in a project conversation. Sign in to view it:\n${url.origin}${path}${input.ticketId}`});
    } catch { /* Persist only a safe code, never provider credentials or payload. */ }
    await env.DB.prepare(`UPDATE project_mention_outbox SET status=?,sent_at=?,error_code=? WHERE mention_id=? AND status='sending'`)
      .bind(sent?'sent':'failed',sent?time:null,sent?null:'delivery_failed',ids[index]).run();
  }
  const deliveries=[];
  for (let index=0;index<ids.length;index++) {
    const row=await env.DB.prepare('SELECT status,error_code FROM project_mention_outbox WHERE mention_id=?').bind(ids[index]).first<{status:string;error_code:string|null}>();
    deliveries.push({userId:input.recipientUserIds[index],status:row?.status ?? 'pending',error:row?.error_code ?? null});
  }
  return {ok:deliveries.every(d=>d.status==='sent'),messageId:input.messageId,deliveries};
}

/** Mount AFTER portal authentication and workbench route middleware. The guards also run here. */
export function registerProjectCollaborationRoutes<T extends { Bindings: Env; Variables: { user: ProjectActor; viaAgent: boolean } }>(app: Hono<T>, dependencies: {sendMail: MentionMailer}) {
  app.get('/admin/projects/:id/recipients',async c=>{
    if(c.get('viaAgent')) return c.json({error:'forbidden'},403);
    try {return c.json({recipients:await listProjectRecipients(c.env,c.get('user'),c.req.param('id'))});}
    catch(e) {if(e instanceof CollaborationError) return c.json({error:e.message},e.status); throw e;}
  });
  app.post('/admin/projects/:id/mentions',async c=>{
    if(c.get('viaAgent')) return c.json({error:'forbidden'},403);
    const text=await c.req.text();
    if(text.length>8192) return c.json({error:'bad_mentions'},400);
    let input:unknown; try {input=JSON.parse(text);} catch {return c.json({error:'bad_mentions'},400);}
    try {return c.json(await mentionProjectMessage(c.env,c.get('user'),c.req.param('id'),input,dependencies.sendMail));}
    catch(e) {if(e instanceof CollaborationError) return c.json({error:e.message},e.status); throw e;}
  });
}
