import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { listProjectRecipients, mentionProjectMessage, registerProjectCollaborationRoutes } from '../src/projectCollaboration.ts';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const DB = { prepare(query: string) {
    let values: any[] = [];
    const stmt = { bind(...args: any[]) { values = args; return stmt; }, async first() { return sql.prepare(query).get(...values) ?? null; }, async all() { return { results: sql.prepare(query).all(...values) }; }, run() { const r = sql.prepare(query).run(...values); return { meta: { changes: Number(r.changes) } }; } };
    return stmt;
  }, async batch(statements: any[]) { sql.exec('BEGIN'); try { const result = []; for (const s of statements) result.push(s.run()); sql.exec('COMMIT'); return result; } catch (e) { sql.exec('ROLLBACK'); throw e; } } };
  sql.exec(`INSERT INTO users(id,email,role,created_at,verified_at) VALUES ('dev','dev@example.com','client',1,1),('coworker','coworker@example.com','client',1,1),('client','client@example.com','client',1,1),('other','other@example.com','client',1,1),('unverified','pending@example.com','client',1,NULL),('admin','admin@example.com','admin',1,1);
  INSERT INTO projects(id,slug,name,created_at,owner_user_id) VALUES ('a','a','A',1,'client'),('b','b','B',1,'other');
  INSERT INTO user_projects(user_id,project_id) VALUES ('client','a'),('other','b'),('unverified','a');
  INSERT INTO project_memberships(project_id,user_id,member_type,granted_by,created_at) VALUES ('a','dev','trusted_developer','admin',1),('a','coworker','trusted_developer','admin',1);
  INSERT INTO tickets(id,user_id,project_id,title,kind,created_at,updated_at) VALUES (1,'client','a','Allowed','client',1,1),(2,'other','b','Hidden','client',1,1),(3,'client','a','System','system',1,1);
  INSERT INTO ticket_messages(id,ticket_id,author,body,internal,created_at) VALUES (11,1,'ali','secret body NEVER email',1,1),(12,1,'ali','public body',0,1),(13,2,'ali','other project',0,1),(14,3,'ali','system body',0,1);`);
  return { sql, env: { DB, PORTAL_URL:'https://ptechsolutions.net' } as any };
}
const dev = {id:'dev',role:'client'};
const input = (extra = {}) => ({ticketId:1,messageId:11,recipientUserIds:['coworker'],requestId:'note-11-mention-request',...extra});

test('recipient identities are verified and project-scoped; clients do not become trusted developers', async () => {
  const {env,sql}=fixture();
  const recipients=await listProjectRecipients(env,dev,'a');
  assert.deepEqual(recipients.map(r=>[r.userId,r.memberType]).sort(),[['client','client'],['coworker','trusted_developer'],['dev','trusted_developer']]);
  await assert.rejects(listProjectRecipients(env,dev,'b'), /not_found/);
  await assert.rejects(listProjectRecipients(env,{id:'client',role:'client'},'a'), /not_found/);
  sql.exec(`DELETE FROM project_memberships WHERE user_id='dev'`);
  await assert.rejects(listProjectRecipients(env,dev,'a'), /not_found/);
});

test('persisted mentions and outbox deliver once across retries and alternate request IDs without body disclosure', async () => {
  const {env,sql}=fixture(); const mail:any[]=[];
  const send=async (_env:any,to:string,message:any) => { mail.push({to,...message}); return true; };
  const first=await mentionProjectMessage(env,dev,'a',input(),send);
  assert.equal(first.ok,true); assert.equal(first.deliveries[0].status,'sent');
  await mentionProjectMessage(env,dev,'a',input(),send);
  await mentionProjectMessage(env,dev,'a',input({requestId:'different-id-same-message'}),send);
  assert.equal(mail.length,1);
  assert.equal(mail[0].to,'coworker@example.com');
  assert.match(mail[0].text,/https:\/\/ptechsolutions.net\/portal\/admin#ticket=1/);
  assert.equal(JSON.stringify(mail).includes('secret body'),false);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM project_mentions').get()?.n,1);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM project_mention_outbox').get()?.n,1);
  await assert.rejects(mentionProjectMessage(env,dev,'a',input({messageId:12}),send),/idempotency_conflict/);
});

test('message/project substitution, arbitrary email/name, internal client and system-client delivery are rejected before persistence', async () => {
  const {env,sql}=fixture(); const send=async()=>true;
  for (const bad of [input({messageId:13}),input({recipientUserIds:['other']}),input({recipientUserIds:['coworker@example.com']}),input({recipientUserIds:['client']}),input({ticketId:3,messageId:14,recipientUserIds:['client']})]) {
    await assert.rejects(mentionProjectMessage(env,dev,'a',bad,send));
  }
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM project_mentions').get()?.n,0);
  const publicResult=await mentionProjectMessage(env,dev,'a',input({messageId:12,recipientUserIds:['client']}),send);
  assert.equal(publicResult.deliveries[0].status,'sent');
});

test('false and thrown mail delivery never report success or resend on retry, and provider errors are not exposed', async () => {
  for (const throws of [false,true]) {
    const {env}=fixture(); let calls=0;
    const send=async()=> {calls++; if(throws) throw new Error('secret provider credential'); return false;};
    const result=await mentionProjectMessage(env,dev,'a',input(),send);
    assert.equal(result.ok,false); assert.equal(result.deliveries[0].status,'failed');
    assert.equal(result.deliveries[0].error,'delivery_failed');
    assert.equal(JSON.stringify(result).includes('credential'),false);
    assert.deepEqual(await mentionProjectMessage(env,dev,'a',input(),send),result);
    assert.equal(calls,1);
  }
});

test('concurrent identical requests claim one delivery only', async () => {
  const {env}=fixture(); let calls=0;
  const send=async()=>{calls++; return true;};
  await Promise.all([mentionProjectMessage(env,dev,'a',input(),send),mentionProjectMessage(env,dev,'a',input(),send)]);
  assert.equal(calls,1);
});

test('revoked recipient is cancelled before delivery and mention/outbox inserts are atomic', async () => {
  const {env,sql}=fixture(); let calls=0;
  sql.exec(`CREATE TRIGGER revoke_recipient AFTER INSERT ON project_mentions BEGIN DELETE FROM project_memberships WHERE user_id=NEW.recipient_user_id; END;`);
  const result=await mentionProjectMessage(env,dev,'a',input(),async()=>{calls++;return true;});
  assert.equal(result.ok,false); assert.equal(result.deliveries[0].status,'cancelled'); assert.equal(calls,0);
  const second=fixture();
  second.sql.exec(`CREATE TRIGGER fail_outbox BEFORE INSERT ON project_mention_outbox BEGIN SELECT RAISE(ABORT,'test outbox failure'); END;`);
  await assert.rejects(mentionProjectMessage(second.env,dev,'a',input(),async()=>true),/test outbox failure/);
  assert.equal(second.sql.prepare('SELECT COUNT(*) n FROM project_mentions').get()?.n,0);
});

test('claimed unknown deliveries are not re-sent and client notifications link to client route', async () => {
  const {env,sql}=fixture(); let calls=0; let mail='';
  const send=async (_env:any,_to:string,message:any)=>{calls++;mail=message.text;return true;};
  await mentionProjectMessage(env,dev,'a',input({messageId:12,recipientUserIds:['client']}),send);
  assert.match(mail,/\/portal#\/ticket\/1/);
  sql.exec(`UPDATE project_mention_outbox SET status='sending',sent_at=NULL`);
  const result=await mentionProjectMessage(env,dev,'a',input({messageId:12,recipientUserIds:['client']}),send);
  assert.equal(result.ok,false); assert.equal(result.deliveries[0].status,'sending'); assert.equal(calls,1);
});

test('mounted routes use authenticated user, return explicit delivery state and reject malformed input', async () => {
  const {env}=fixture(); const app = new Hono<any>();
  app.use('*',async(c,next)=>{c.set('user',dev);c.set('viaAgent',false);await next();});
  registerProjectCollaborationRoutes(app,{sendMail:async()=>false});
  assert.equal((await app.request('/admin/projects/a/recipients',{},env)).status,200);
  assert.equal((await app.request('/admin/projects/b/recipients',{},env)).status,404);
  const result=await app.request('/admin/projects/a/mentions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input())},env);
  assert.equal(result.status,200); assert.equal((await result.json()).ok,false);
  assert.equal((await app.request('/admin/projects/a/mentions',{method:'POST',body:'{'},env)).status,400);
});
