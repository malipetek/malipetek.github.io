import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { accessFor, canWorkProject, projectScope, authorizeWorkbenchRoute, sealProjectSecret, openProjectSecret } from '../src/projectAccess.ts';
import { approveDevice, exchangeDevice, startDevice } from '../src/device.ts';
import { portal } from '../src/portal.ts';
import { sha256 } from '../src/shared.ts';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) {
    sql.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  const DB = { prepare(query: string) {
    let values: any[] = [];
    const stmt = { bind(...args: any[]) { values = args; return stmt; }, async first() { return sql.prepare(query).get(...values) ?? null; }, async all() { return { results: sql.prepare(query).all(...values) }; }, async run() { const r = sql.prepare(query).run(...values); return { meta: { changes: Number(r.changes) } }; } };
    return stmt;
  }, async batch(statements: any[]) { return Promise.all(statements.map(s => s.run())); } };
  sql.exec(`INSERT INTO users(id,email,role,created_at,verified_at) VALUES ('dev','dev@example.com','client',1,1),('owner','owner@example.com','client',1,1),('other','other@example.com','client',1,1),('admin','admin@example.com','admin',1,1);
  INSERT INTO projects(id,slug,name,created_at) VALUES ('a','a','A',1),('b','b','B',1);
  INSERT INTO user_projects(user_id,project_id) VALUES ('owner','a');
  UPDATE projects SET owner_user_id='owner' WHERE id='a';
  INSERT INTO project_memberships(project_id,user_id,member_type,granted_by,created_at) VALUES ('a','dev','trusted_developer','admin',1);
  INSERT INTO tickets(id,user_id,project_id,title,created_at,updated_at) VALUES (1,'owner','a','Allowed',1,1),(2,'other','b','Hidden',2,2),(3,'dev',NULL,'Private',3,3);
  INSERT INTO ticket_runs(id,ticket_id,executor,status,started_at) VALUES (1,1,'dsh','running',1),(2,2,'dsh','running',1);`);
  return { sql, env: { DB, RATE_LIMIT:{async get(){return null;},async put(){}}, SESSION_SECRET: 'test-project-secret-encryption-key' } as any };
}
const dev = {id:'dev',role:'client'};

test('trusted grants are explicit, role preserving and revoked on the next check', async () => {
  const {sql,env}=fixture();
  assert.deepEqual(await accessFor(env,dev),{superAdmin:false,canUseWorkbench:true,developerProjectIds:['a']});
  assert.equal(await canWorkProject(env,dev,'a'),true);
  assert.equal(await canWorkProject(env,dev,'b'),false);
  assert.equal(await canWorkProject(env,dev,null),false);
  assert.equal((await accessFor(env,{id:'owner',role:'client'})).canUseWorkbench,false);
  sql.exec(`DELETE FROM project_memberships WHERE user_id='dev'`);
  assert.equal((await accessFor(env,dev)).canUseWorkbench,false);
});

test('ticket SQL scope precedes limits and never includes null or unrelated projects', async () => {
  const {sql}=fixture();
  const scope=projectScope(dev,'t.project_id');
  const rows=sql.prepare(`SELECT t.id FROM tickets t WHERE ${scope.sql} ORDER BY t.id DESC LIMIT 1`).all(...scope.bindings);
  assert.deepEqual(rows.map(r=>r.id),[1]);
});

test('route dispatch denies globals, unknown actions and cross-project run and ticket ids', async () => {
  const {env}=fixture();
  assert.equal(await authorizeWorkbenchRoute(env,dev,'GET','/admin/tickets/1'),true);
  assert.equal(await authorizeWorkbenchRoute(env,dev,'GET','/admin/tickets/2'),false);
  assert.equal(await authorizeWorkbenchRoute(env,dev,'GET','/admin/runs/1/session'),true);
  assert.equal(await authorizeWorkbenchRoute(env,dev,'POST','/admin/runs/2/cancel'),false);
  for(const path of ['/admin/settings','/admin/nodes','/admin/clients','/admin/projects/a/unknown']) assert.equal(await authorizeWorkbenchRoute(env,dev,'GET',path),false);
});

test('project secret ciphertext cannot be copied across projects or secret names', async () => {
  const {env}=fixture();
  const encrypted=await sealProjectSecret(env,'a','API_KEY','secret-value');
  assert.equal(encrypted.includes('secret-value'),false);
  assert.equal(await openProjectSecret(env,'a','API_KEY',encrypted),'secret-value');
  await assert.rejects(openProjectSecret(env,'b','API_KEY',encrypted));
  await assert.rejects(openProjectSecret(env,'a','OTHER',encrypted));
  await assert.rejects(sealProjectSecret({...env,SESSION_SECRET:''},'a','API_KEY','secret'));
});

test('trusted device approval and exchange retain client identity and recheck revoked grants', async () => {
  const {sql,env}=fixture();
  const verifier='v'.repeat(43);
  const hash=await sha256(verifier);
  const challenge=Buffer.from(hash,'hex').toString('base64url');
  const device=await startDevice(env,{challenge,label:null,state:null});
  const approved=await approveDevice(env,dev,device.deviceCode);
  assert.ok(approved);
  const user=await exchangeDevice(env,approved.code,verifier);
  assert.equal(user?.role,'client');
  assert.equal(await exchangeDevice(env,approved.code,verifier),null);
  const second=await startDevice(env,{challenge,label:null,state:null});
  const secondApproval=await approveDevice(env,dev,second.deviceCode);
  assert.ok(secondApproval);
  sql.exec(`DELETE FROM project_memberships WHERE user_id='dev'`);
  assert.equal(await exchangeDevice(env,secondApproval.code,verifier),null);
  const third=await startDevice(env,{challenge,label:null,state:null});
  assert.equal(await approveDevice(env,dev,third.deviceCode),null);
});

async function authenticatedFixture(identity = 'dev') {
  const f = fixture();
  f.sql.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').run(await sha256('test-session'),identity,Math.floor(Date.now()/1000)+3600,1);
  const request = (method:string,path:string,body?:unknown) => portal.request(path,{method,headers:{authorization:'Bearer test-session','content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})},f.env,{waitUntil() {},passThroughOnException(){}} as any);
  return {...f,request};
}

test('actual ticket search/list/runs SQL and counters exclude inaccessible records',async()=>{
  const {sql,request}=await authenticatedFixture();
  sql.exec("INSERT INTO ticket_messages(ticket_id,author,body,created_at) VALUES(1,'client','searchneedle allowed',1),(2,'client','searchneedle hidden',1)");
  const list=await request('GET','/admin/tickets');
  assert.equal(list.status,200); assert.deepEqual((await list.json() as any).tickets.map((t:any)=>t.id),[1]);
  const search=await request('GET','/admin/search?q=searchneedle');
  assert.equal(search.status,200); assert.deepEqual((await search.json() as any).hits.map((t:any)=>t.id),[1]);
  const runs=await request('GET','/admin/runs'); assert.equal(runs.status,200);
  const data=await runs.json() as any; assert.deepEqual(data.running.map((r:any)=>r.id),[1]); assert.deepEqual(data.recent.map((r:any)=>r.id),[1]);
  const attention=await request('GET','/admin/attention');assert.equal(attention.status,200);assert.equal((await attention.json() as any).approve,1);
});
test('actual routes reject cross-project moves, global paths and unrelated resource IDs',async()=>{
  const {request}=await authenticatedFixture();
  for (const [method,path,body] of [['GET','/admin/settings',undefined],['GET','/admin/tickets/2',undefined],['POST','/admin/runs/2/cancel',{}],['PATCH','/admin/tickets/1',{projectId:'b'}],['PATCH','/admin/tickets/1',{projectId:null}],['POST','/admin/work',{projectId:'b',title:'Attempt',brief:'No'}],['DELETE','/admin/projects/a',undefined]] as const) {
    const response=await request(method,path,body); assert.ok([403,404].includes(response.status),`${method} ${path}: ${response.status}`);
  }
  // A trusted developer is not allowed to delete a client's project.
  assert.equal((await request('DELETE','/admin/projects/b')).status,403);
});
test('secret and membership HTTP APIs enforce broad member access, owner revoke and admin grants',async()=>{
  const {sql,request}=await authenticatedFixture();
  assert.equal((await request('POST','/admin/projects/a/memberships',{userId:'other'})).status,403);
  assert.equal((await request('PUT','/admin/projects/a/secrets/API_KEY',{value:'test-value'})).status,200);
  const encrypted=sql.prepare("SELECT value_enc FROM project_secrets WHERE project_id='a'").get() as any;assert.ok(!encrypted.value_enc.includes('test-value'));
  const listing=await request('GET','/admin/projects/a/secrets');assert.deepEqual(await listing.json(),{secrets:[{name:'API_KEY',updatedAt:(sql.prepare("SELECT updated_at FROM project_secrets").get() as any).updated_at}]});
  const reveal=await request('POST','/admin/projects/a/secrets/API_KEY/reveal',{});assert.deepEqual(await reveal.json(),{value:'test-value'});
  assert.equal((await request('POST','/admin/projects/b/secrets/API_KEY/reveal',{})).status,403);
  sql.exec("UPDATE sessions SET user_id='admin'");
  assert.equal((await request('POST','/admin/projects/a/memberships',{email:'other@example.com'})).status,200);
  assert.equal((sql.prepare("SELECT role FROM users WHERE id='other'").get() as any).role,'client');
  assert.equal((await request('POST','/admin/projects/a/memberships',{email:'not-created@example.com'})).status,400);
  sql.exec("UPDATE sessions SET user_id='owner'");
  assert.equal((await request('POST','/admin/projects/a/memberships',{userId:'owner'})).status,403);
  assert.equal((await request('DELETE','/admin/projects/a/memberships/dev')).status,200);
  sql.exec("UPDATE sessions SET user_id='dev'");assert.equal((await request('GET','/admin/projects/a/secrets')).status,403);
});

test('brief persistence and project inventory use scoped SQL and parsed response',async()=>{
  const {request}=await authenticatedFixture();
  const brief={what:'Build the thing',goal:'It works',where:'Here'};
  const response=await request('PATCH','/admin/projects/a',{brief});assert.equal(response.status,200);assert.deepEqual((await response.json() as any).project.brief,brief);
  const listing=await request('GET','/admin/projects');assert.equal(listing.status,200);assert.deepEqual((await listing.json() as any).projects.map((p:any)=>p.id),['a']);
  const me=await request('GET','/portal/me');assert.equal(me.status,200);const data=await me.json() as any;assert.equal(data.access.canUseWorkbench,true);assert.deepEqual(data.projects.map((p:any)=>p.id),['a']);
});
test('trusted project creators immediately gain explicit new-project membership, clients do not',async()=>{
  for(const identity of ['dev','other']) {
    const {sql,request}=await authenticatedFixture(identity);
    const response=await request('POST','/portal/projects',{name:`New ${identity}`,kind:'existing',repoMode:'none',brief:{what:'Something',goal:'Works',where:'Local'}});
    assert.equal(response.status,201);const data=await response.json() as any;
    assert.equal((sql.prepare('SELECT owner_user_id FROM projects WHERE id=?').get(data.project.id) as any).owner_user_id,identity);
    const granted=sql.prepare('SELECT 1 FROM project_memberships WHERE project_id=? AND user_id=?').get(data.project.id,identity);
    assert.equal(!!granted,identity==='dev');assert.equal((sql.prepare('SELECT role FROM users WHERE id=?').get(identity) as any).role,'client');
    assert.equal((await request('GET',`/admin/projects/${data.project.id}`)).status,identity==='dev'?200:403);
  }
});
test('clone credentials are restricted to explicit project installation/repository and never use RUNNER_TOKEN',async()=>{
  const {sql,env,request}=await authenticatedFixture();env.RUNNER_TOKEN='never-disclose-this';
  assert.equal((await request('POST','/admin/projects/a/git-token',{})).status,409);
  sql.exec("INSERT INTO github_installations(id,account_login,account_type,repository_selection,created_at,updated_at) VALUES (123,'example','Organization','all',1,1); UPDATE projects SET repo='https://github.com/example/private-project.git',github_installation_id=123 WHERE id='a'");
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  env.GITHUB_APP_ID='123';env.GITHUB_APP_PRIVATE_KEY=`-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8',pair.privateKey)).toString('base64')}\n-----END PRIVATE KEY-----`;
  const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async(input:any,init:any)=>{calls++;assert.equal(String(input),'https://api.github.com/app/installations/123/access_tokens');assert.deepEqual(JSON.parse(init.body).repositories,['private-project']);return new Response(JSON.stringify({token:'scoped-project-token',expires_at:'2030-01-01T00:00:00Z'}),{status:201});};
  try {
    const response=await request('POST','/admin/projects/a/git-token',{});assert.equal(response.status,200);assert.deepEqual(await response.json(),{token:'scoped-project-token',expiresAt:1893456000,repo:'example/private-project'});assert.equal(calls,1);
    sql.exec("UPDATE projects SET repo='https://github.com/someone-else/private-project' WHERE id='a'");assert.equal((await request('POST','/admin/projects/a/git-token',{})).status,409);assert.equal(calls,1);
  }finally{globalThis.fetch=originalFetch;}
});

test('caller-supplied integration and site IDs cannot escape URL project',async()=>{
  const {sql,request}=await authenticatedFixture();
  sql.exec(`INSERT INTO github_installations(id,user_id,account_login,account_type,repository_selection,created_at,updated_at) VALUES (123,'other','example','Organization','all',1,1);
    INSERT INTO cloudflare_connections(id,user_id,accounts,access_enc,created_at,updated_at) VALUES (123,'other','[{"id":"cf-account","name":"Other"}]','unused',1,1);
    INSERT INTO sites(id,project_id,slug,state,preview_deploy,created_at,updated_at) VALUES('hidden-site','b','hidden-site','ready','deploy-hidden',1,1);`);
  for(const [suffix,body] of [['repo/github',{installationId:123}],['site/host',{host:'cloudflare',connectionId:123,accountId:'cf-account'}]] as const){
    const response=await request('POST',`/admin/projects/a/${suffix}`,body);assert.equal(response.status,400,`${suffix}: ${response.status}`);
  }
  for(const [method,suffix,body] of [['POST','site/retry',{siteId:'hidden-site'}],['POST','site/rebuild',{siteId:'hidden-site'}],['POST','site/domain',{siteId:'hidden-site',hostname:'a.example.com'}],['POST','site/publish',{siteId:'hidden-site'}],['POST','site/rollback',{siteId:'hidden-site',deployId:'deploy-hidden'}],['DELETE','site',{siteId:'hidden-site'}]] as const){
    const response=await request(method,`/admin/projects/a/${suffix}`,body);assert.ok([404,409].includes(response.status),`${suffix}: ${response.status}`);assert.equal((await response.json() as any).error,'not_found');
  }
  assert.equal((sql.prepare("SELECT production_deploy FROM sites WHERE id='hidden-site'").get() as any).production_deploy,null);
});
test('ticket projectId filter is exact, scoped, and combined before LIMIT',async()=>{
  const {sql,request}=await authenticatedFixture();
  sql.exec("INSERT INTO project_memberships(project_id,user_id,granted_by,created_at) VALUES('b','dev','admin',1)");
  const response=await request('GET','/admin/tickets?projectId=a&status=new');assert.equal(response.status,200);assert.deepEqual((await response.json() as any).tickets.map((t:any)=>t.id),[1]);
  assert.equal((await request('GET','/admin/tickets?projectId=unknown')).status,403);
});
