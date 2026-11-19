import {createMentionDelivery} from './mention-delivery.js';
import {canUseWorkbench} from '../../../src/lib/workbench-access.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTicketRequest, createStepRequest, workbenchRequests } from './request-state.js';
import { selectedRun, recordedPatch, verification, mergeSteps, reviewTarget } from './run-evidence.js';
import { createSubmission } from './submit-state.js';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };

test('ticket navigation ignores A after B and clears old evidence immediately', async () => {
 const a=deferred(), b=deferred(); let state; const request=createTicketRequest((_m,path)=>path.endsWith('/A')?a.promise:b.promise, s=>state=s);
 const pa=request.load('A'); const pb=request.load('B'); assert.equal(state.ticket,null);
 b.resolve({ticket:{id:'B'}}); await pb; a.resolve({ticket:{id:'A'}}); await pa; assert.equal(state.ticket.id,'B');
});
test('same-ticket late refresh cannot overwrite the newest request', async()=>{
 const calls=[deferred(),deferred()]; let i=0,state; const r=createTicketRequest(()=>calls[i++].promise,s=>state=s);
 const old=r.load(1), fresh=r.load(1); calls[1].resolve({ticket:{id:1,title:'new'}}); await fresh; calls[0].resolve({ticket:{id:1,title:'old'}}); await old; assert.equal(state.ticket.title,'new');
});
test('failed refresh keeps cached evidence and last successful refresh then recovers',async()=>{
 let fail=false,state; const r=createTicketRequest(async()=>{if(fail)throw Error('offline'); return {ticket:{id:1},runs:[{id:7}]};},s=>state=s);
 await r.load(1); const at=state.fetchedAt; fail=true; await r.load(1); assert.equal(state.ticket.id,1); assert.equal(state.stale,true); assert.equal(state.fetchedAt,at); assert.equal(state.error.message,'offline'); fail=false; await r.load(1); assert.equal(state.stale,false); assert.equal(state.error,null);
});
test('selected historical id survives unsorted polling and newest defaults by id',()=>{
 assert.equal(selectedRun([{id:9},{id:2},{id:7}],2).id,2); assert.equal(selectedRun([{id:2},{id:9},{id:7}],null).id,9); assert.equal(selectedRun([{id:9}],2),null);
});
test('empty patches fall back to statistics and missing verification is unknown',()=>{
 assert.equal(recordedPatch({diff:' \n',diff_stat:'3 files changed'}),'3 files changed'); assert.equal(verification(null),'unknown'); assert.equal(verification(undefined),'unknown'); assert.equal(verification(false),'failed'); assert.equal(verification(true),'passed');
});
test('step recovery merges out-of-order duplicate sequences only once',()=>{
 assert.deepEqual(mergeSteps([{seq:2,text:'two'}],[{seq:3,text:'three'},{seq:2,text:'two'},{seq:1,text:'one'}]).map(s=>s.seq),[1,2,3]);
});
test('review target prefers recorded commit and labels mutable or older fallback',()=>{
 assert.deepEqual(reviewTarget([{id:2,branch:'work',commit_sha:'abc'}]),{runId:2,ref:'abc',mutable:false,older:false});
 assert.deepEqual(reviewTarget([{id:2},{id:1,branch:'work'}]),{runId:1,ref:'work',mutable:true,older:true});
});
test('submission synchronously locks keyboard/click duplicates',async()=>{
 const saved=deferred(); let writes=0; const submit=createSubmission(); const first=submit.run({save:()=>{writes++; return saved.promise;}}); const second=submit.run({save:()=>{writes++;}}); await second; assert.equal(writes,1); saved.resolve(); await first;
});
test('note saved then queue failed retries only queue without duplicate note',async()=>{
 let notes=0,queues=0,cleared=0; const submit=createSubmission(); const options={save:async()=>{notes++;},onSaved:()=>cleared++,queue:async()=>{queues++; if(queues===1)throw Error('queue offline');}};
 await assert.rejects(submit.run(options),/queue offline/); assert.equal(submit.pendingQueue,true); assert.equal(cleared,1); await submit.retryQueue(); assert.equal(notes,1); assert.equal(queues,2); assert.equal(submit.pendingQueue,false);
});

test('developer bootstrap waits for authority and never calls global endpoints',async()=>{
 const identity=deferred(), paths=[];
 const load=workbenchRequests(async(_method,path)=>{paths.push(path); if(path==='/portal/me')return identity.promise; return {};});
 assert.deepEqual(paths,['/portal/me']); identity.resolve({user:{id:1},access:{superAdmin:false,canUseWorkbench:true,developerProjectIds:['one']}});
 const result=await load; assert.deepEqual(paths,['/portal/me','/admin/tickets','/admin/projects','/admin/runs']); assert.equal(result.identity.user.id,1);
});
test('failed authority lookup issues no project or global requests',async()=>{
 const paths=[]; await assert.rejects(workbenchRequests(async(_method,path)=>{paths.push(path);throw Error('unauthorized');}),/unauthorized/); assert.deepEqual(paths,['/portal/me']);
});
test('missing authority is denied rather than assuming an administrator',async()=>{
 const paths=[]; await assert.rejects(workbenchRequests(async(_method,path)=>{paths.push(path);return {user:{id:1}};}),/access/); assert.deepEqual(paths,['/portal/me']);
});

test('step polling failure keeps cached steps and resumes at successful cursor',async()=>{
 const paths=[]; let attempt=0,state;
 const request=createStepRequest(async(_method,path)=>{paths.push(path); attempt++; if(attempt===2)throw Error('offline'); return {steps:attempt===1?[{seq:2,text:'two'}]:[{seq:3,text:'three'}],live:true};},7,next=>state=next);
 await request.pull(); await request.pull(); assert.equal(state?.error?.message,'offline'); assert.deepEqual(state.steps.map(step=>step.seq),[2]);
 await request.pull(); assert.equal(state.error,null); assert.deepEqual(state.steps.map(step=>step.seq),[2,3]); assert.deepEqual(paths,['/admin/runs/7/steps?after=0','/admin/runs/7/steps?after=2','/admin/runs/7/steps?after=2']);
});

test('super-admin bootstrap retains successful endpoints when another fails',async()=>{
 const paths=[]; const value=await workbenchRequests(async(_method,path)=>{paths.push(path); if(path==='/portal/me')return {access:{superAdmin:true,canUseWorkbench:true}};if(path==='/admin/nodes')throw Error('node offline');return {tickets:[]};});
 assert.equal(value.results['/admin/nodes'].status,'rejected');assert.equal(value.results['/admin/tickets'].status,'fulfilled');assert.deepEqual(paths,['/portal/me','/admin/tickets','/admin/projects','/admin/runs','/admin/clients','/admin/nodes','/admin/queue','/admin/settings']);
});
test('invalidated ticket response cannot publish after unmount',async()=>{
 const response=deferred(), states=[]; const request=createTicketRequest(()=>response.promise,state=>states.push(state));const pending=request.load(1);request.invalidate();const count=states.length;response.resolve({ticket:{id:1}});await pending;assert.equal(states.length,count);
});
test('invalidated step response cannot publish after unmount',async()=>{
 const response=deferred(),states=[];const request=createStepRequest(()=>response.promise,1,state=>states.push(state));const pending=request.pull();request.invalidate();response.resolve({steps:[{seq:1}]});await pending;assert.equal(states.length,0);
});
test('failed note save permits deliberate retry and never queues before save',async()=>{
 let saves=0,queues=0;const request=createSubmission();const save=async()=>{saves++;if(saves===1)throw Error('offline');};const queue=async()=>queues++;
 await assert.rejects(request.run({save,queue}),/offline/);assert.equal(queues,0);assert.equal(request.busy,false);await request.run({save,queue});assert.equal(saves,2);assert.equal(queues,1);
});

test('submission preserves saved message identity for independent mention delivery',async()=>{
 const request=createSubmission();let saved;await request.run({save:async()=>({messageId:42}),onSaved:value=>{saved=value;}});assert.deepEqual(saved,{messageId:42});
});

test('legacy admin admitted by outer workbench can load shared provider',async()=>{
 const identity={user:{id:1,role:'admin'}},paths=[];assert.equal(canUseWorkbench(identity),true);
 const result=await workbenchRequests(async(_method,path)=>{paths.push(path);return path==='/portal/me'?identity:{};});assert.equal(result.access.superAdmin,true);assert.ok(paths.includes('/admin/settings'));
});
test('legacy client without fresh project access is denied by outer admission and loader',async()=>{
 const identity={user:{id:2,role:'client'}};assert.equal(canUseWorkbench(identity),false);const paths=[];await assert.rejects(workbenchRequests(async(_method,path)=>{paths.push(path);return identity;}),/access/);assert.deepEqual(paths,['/portal/me']);
});

test('notification network failure cannot block queue and status retry never re-saves note',async()=>{
 let saves=0,queues=0,deliveries=0;const payloads=[];let notification;
 const deliver=createMentionDelivery({api:async(_method,_path,payload)=>{payloads.push(payload);if(++deliveries===1)throw Error('offline');return {ok:true,deliveries:[{status:'sent'}]};},projectId:'p1',ticketId:1,recipientUserIds:[2],requestId:'stable'});
 const request=createSubmission();await request.run({save:async()=>{saves++;return {messageId:17};},onSaved:saved=>{notification=deliver(saved).catch(error=>error);},queue:async()=>{queues++;}});
 assert.equal(queues,1);assert.match((await notification).message,/offline/);await deliver();assert.equal(saves,1);assert.equal(queues,1);assert.deepEqual(payloads[0],payloads[1]);
});
test('provider-reported notification failure is not reported as successful queue or resubmitted',async()=>{
 let saves=0,queues=0,notification;const deliver=createMentionDelivery({api:async()=>({ok:false,deliveries:[{status:'failed'}]}),projectId:'p1',ticketId:1,recipientUserIds:[2],requestId:'stable'});
 const request=createSubmission();await request.run({save:async()=>{saves++;return {messageId:18};},onSaved:saved=>{notification=deliver(saved);},queue:async()=>{queues++;throw Error('queue offline');}}).catch(()=>{});
 assert.equal((await notification).ok,false);assert.equal(saves,1);assert.equal(request.pendingQueue,true);assert.equal(queues,1);
});
