import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskSubmission, createProjectSubmission, destinationFromHash, workbenchAllowed, projectCreationRequest } from './workbench.js';

test('draft submits explicit false; duplicate requests and invalid keyboard submissions are blocked', async () => {
  let release; const calls = [];
  const submit = createTaskSubmission(async (body) => { calls.push(body); await new Promise(r => release = r); return {id: 7}; });
  assert.equal(await submit({ title: ' ', brief: 'brief', projectId: 'p' }), null);
  const first = submit({title:' task ',brief:' brief ',projectId:'p'});
  assert.equal(await submit({title:'task',brief:'brief',projectId:'p',approve:true}), null);
  assert.deepEqual(calls, [{title:'task',brief:'brief',projectId:'p',approve:false}]);
  release(); assert.deepEqual(await first, {id:7});
});

test('queue is explicit and failed submissions unlock for retry', async () => {
  const calls=[]; const submit=createTaskSubmission(async body=>{calls.push(body);if(calls.length===1)throw Error('offline');return {id:8};});
  const draft={title:'task',brief:'brief',projectId:'p',approve:true};
  await assert.rejects(submit(draft), /offline/);
  assert.deepEqual(await submit(draft), {id:8});
  assert.equal(calls[1].approve,true);
});

test('project setup retry never recreates a successfully created project', async () => {
  let creates=0, setups=0;
  const submit=createProjectSubmission(async()=>{creates++;return {id:'project-1'};}, async()=>{if(++setups===1)throw Error('folder unavailable');});
  await assert.rejects(submit({name:' Project ',slug:'project'}), /folder unavailable/);
  assert.equal(submit.project.id,'project-1');
  assert.deepEqual(await submit({name:'Project',slug:'project'}), {id:'project-1'});
  assert.equal(creates,1); assert.equal(setups,2);
});

test('developers create owned projects via self-service without global administration or queue approval',()=>{
  const input={name:'Owned',slug:'owned',kind:'existing',code:'repo',repo:'https://github.com/o/r',brief:{what:'System',goal:'Improve'}};
  assert.deepEqual(projectCreationRequest(input,{superAdmin:false}),{path:'/portal/projects',body:{name:'Owned',kind:'existing',brief:input.brief,repoMode:'repo',repo:input.repo}});
  assert.equal(projectCreationRequest(input,{superAdmin:true}).path,'/admin/projects');
});

test('self-service project names do not require an administrator slug', async()=>{
  const submit=createProjectSubmission(async input=>({id:'unicode',...input}),undefined,{requireSlug:false});
  assert.equal((await submit({name:'项目',slug:'',code:'create'}))?.id,'unicode');
});

test('hash navigation preserves ticket/client destinations and adds encoded project IDs',()=>{
  assert.equal(destinationFromHash('#project=project%2Fone'),'p:project/one');
  assert.equal(destinationFromHash('#ticket=17'),'t:17');
  assert.equal(destinationFromHash('#client=client-1'),'c:client-1');
  assert.equal(destinationFromHash('#ticket=-1'),null);
});

test('developer destinations exclude global administration, including restored tabs',()=>{
  const access={superAdmin:false,canUseWorkbench:true};
  for(const key of ['p:assigned','t:17','board','list','inbox']) assert.equal(workbenchAllowed(key,access),true);
  for(const key of ['clients','c:client','fleet','settings','marketing','seo','health']) assert.equal(workbenchAllowed(key,access),false);
  assert.equal(workbenchAllowed('fleet',null),false);
  assert.equal(workbenchAllowed('fleet',{superAdmin:true}),true);
});
