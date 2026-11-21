import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {build}=await import(pathToFileURL(createRequire(require.resolve('astro/package.json')).resolve('esbuild')));
const browserModule=process.env.WORKBENCH_PLAYWRIGHT;

// These tests bundle only this component harness, not the application or hosted assets.
test('real browser: keyboard/double-submit safety, explicit queue, project setup retry and standalone handlers', {skip: !browserModule && 'Set WORKBENCH_PLAYWRIGHT to a Playwright module path'}, async () => {
  const {chromium}=await import(browserModule);
  const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  try {
    const result=await build({stdin:{contents:`
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {AdminApp,TaskModal,ProjectModal,ProjectPage} from './app.jsx'; import {AdminContext} from './store.js';
      window.calls=[]; window.setupCalls=[]; window.destinations=[]; window.mode='draft';
      const api=async(method,url,body)=>{
        window.calls.push({method,url,body});
        if(method==='POST') {await new Promise(r=>setTimeout(r,100));return url==='/portal/projects'?{project:{id:'owned-project'}}:{id:url.includes('projects')?'created-project':17};}
        if(url==='/portal/me')return {user:{id:'developer'},access:{superAdmin:false,canUseWorkbench:true,developerProjectIds:['p']}};
        if(url==='/admin/projects')return {projects:[{id:'p',name:'Project',slug:'project'}]};
        if(url==='/admin/tickets')return {tickets:[]};
        return {nodes:[],queue:[],running:[],recent:[],clients:[]};
      };
      const data={projects:[{id:'p',name:'Project',slug:'project'}],nodes:[],settings:null,catalog:null,access:{superAdmin:true}};
      const host={projectConfigureLocal:async input=>{window.setupCalls.push(input);if(window.setupCalls.length===1)throw Error('Folder unavailable');}};
      const ctx={api,data,host,act:fn=>fn(),open:key=>window.destinations.push(key),openTicket:id=>window.destinations.push('t:'+id)};
      const root=createRoot(document.getElementById('root'));
      window.show=(mode)=>{if(mode==='developer-project')ctx.data={...data,access:{superAdmin:false,canUseWorkbench:true}};root.render(mode==='workbench'?<AdminApp api={api}/>:mode==='standalone'?<ProjectPage api={api} id="p"/>:<AdminContext.Provider value={ctx}>{mode==='project'||mode==='developer-project'?<ProjectModal key={mode} onClose={()=>{}}/>:<TaskModal key={mode} preset={{projectId:'p'}} onClose={()=>{}}/>}</AdminContext.Provider>);};
      window.show('draft');
    `,resolveDir:path.resolve('packages/admin-ui/src'),loader:'jsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',plugins:[{name:'project-context-probe',setup(b){b.onResolve({filter:/^\.\/project\.jsx$/},()=>({path:'project-probe',namespace:'probe'}));b.onLoad({filter:/.*/,namespace:'probe'},()=>({contents:`import React from 'react';import {useAdmin} from './store.js';export function ProjectView({id}){const c=useAdmin();return <div><h2>Project probe {id}</h2><button onClick={()=>c.setModal({kind:'task',projectId:id})}>Probe task</button><button onClick={()=>c.ask({title:'Probe confirm',text:'Confirm action',confirm:'Execute probe',run:()=>c.act(()=>c.api('POST','/probe',{}))})}>Probe ask</button><button onClick={()=>c.openTicket(17)}>Probe ticket</button></div>}`,resolveDir:path.resolve('packages/admin-ui/src'),loader:'jsx'}));}}]});
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('http://workbench.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
    await page.goto('http://workbench.test/');await page.addScriptTag({content:result.outputFiles[0].text});
    await page.getByRole('heading',{name:'New task'}).waitFor();
    await page.locator('textarea').press('Control+Enter');
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='POST').length),0);
    await page.getByPlaceholder('Fix the checkout total rounding').fill('Task title');await page.locator('textarea').fill('Task brief');
    // Dispatch in the same browser task before React gets an opportunity to commit busy state.
    await page.evaluate(()=>{const t=document.querySelector('textarea');for(let i=0;i<2;i++)t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}));});
    await page.waitForFunction(()=>window.destinations.includes('t:17'));
    let posts=await page.evaluate(()=>window.calls.filter(c=>c.method==='POST'));
    assert.equal(posts.length,1);assert.equal(posts[0].body.approve,false);
    await page.evaluate(()=>window.show('queue'));
    await page.getByPlaceholder('Fix the checkout total rounding').fill('Queued task');await page.locator('textarea').fill('Queued brief');await page.getByRole('radio',{name:'Queue agent',exact:true}).click();
    await page.getByRole('button',{name:'Save and queue agent',exact:true}).click();
    await page.waitForFunction(()=>window.calls.filter(c=>c.method==='POST').length===2);
    posts=await page.evaluate(()=>window.calls.filter(c=>c.method==='POST'));assert.equal(posts[1].body.approve,true);
    await page.getByRole('button',{name:'Save and queue agent',exact:true}).waitFor();
    await page.evaluate(()=>window.show('project'));
    await page.getByPlaceholder('Acme storefront').fill('New Project');await page.getByPlaceholder('/Users/you/Projects/acme').fill('/work/project');await page.getByRole('button',{name:'Create project',exact:true}).click();
    await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/Project created.*retry does not create another project/);
    await page.getByRole('button',{name:'Retry local setup',exact:true}).click();
    await page.waitForFunction(()=>window.destinations.includes('p:created-project'));
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.url==='/admin/projects'&&c.method==='POST').length),1);
    assert.equal(await page.evaluate(()=>window.setupCalls.length),2);
    await page.evaluate(()=>window.show('developer-project'));
    await page.getByPlaceholder('Acme storefront').fill('项目');
    await page.locator('textarea').nth(0).fill('Developer owned system');await page.locator('textarea').nth(1).fill('Improve the checkout');
    await page.getByRole('button',{name:'Create project',exact:true}).click();
    await page.waitForFunction(()=>window.destinations.includes('p:owned-project'));
    const owned=await page.evaluate(()=>window.calls.filter(c=>c.url==='/portal/projects'&&c.method==='POST'));
    assert.equal(owned.length,1);assert.equal(owned[0].body.brief.goal,'Improve the checkout');assert.equal('approve' in owned[0].body,false);
    await page.evaluate(()=>window.show('standalone'));
    await page.getByRole('button',{name:'Probe task'}).click();await page.getByRole('heading',{name:'New task'}).waitFor();await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.getByRole('button',{name:'Probe ask'}).click();await page.getByRole('button',{name:'Execute probe',exact:true}).click();
    await page.waitForFunction(()=>window.calls.some(c=>c.url==='/probe'));
    await page.getByRole('button',{name:'Probe ticket'}).click();await page.getByRole('button',{name:'Probe task'}).waitFor({state:'detached'});
    await page.evaluate(()=>{localStorage.setItem('aw-tabs-v1',JSON.stringify({tabs:['fleet','board'],active:'fleet'}));window.calls=[];window.show('workbench');});
    await page.getByRole('button',{name:'Board',exact:true}).waitFor();
    await page.waitForFunction(()=>Boolean(document.querySelector('.aw-board')));
    assert.equal(await page.getByRole('button',{name:'Fleet',exact:true}).count(),0);
    await page.getByRole('button',{name:'Project',exact:true}).click();
    await page.getByRole('heading',{name:'Project probe p'}).waitFor();
    assert.equal(await page.getByRole('tab',{name:/Project/}).count(),1);
    const global=await page.evaluate(()=>window.calls.filter(c=>['/admin/nodes','/admin/clients','/admin/settings','/admin/queue'].includes(c.url)));
    assert.deepEqual(global,[]);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
