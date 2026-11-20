import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {build}=await import(pathToFileURL(createRequire(require.resolve('astro/package.json')).resolve('esbuild')));
const dir=await mkdtemp(path.join(os.tmpdir(),'workbench-render-'));
const entry=`
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AdminContext} from './store.js';
import {TaskModal,ProjectPage} from './app.jsx';
import {ProjectView} from './project.jsx';
import {ProjectWorld} from './project-world.jsx';
import {RecordedEvidence} from './review.jsx';
export {ProjectPage};
export function renderTask(){return renderToStaticMarkup(React.createElement(AdminContext.Provider,{value:{api:async()=>({}),data:{projects:[{id:'p',name:'Project'}],nodes:[],settings:null,catalog:null},act:fn=>fn(),openTicket:()=>{}}},React.createElement(TaskModal,{preset:{},onClose:()=>{}})));}
const sampleNow=Date.now();
const sampleProject={
  id:'p-world',
  name:'Bakery',
  slug:'bakery',
  kind:'existing',
  repo:'https://github.com/acme/bakery',
  sites:[{
    id:'s1',
    name:'Bakery Live',
    state:'ready',
    host:'cloudflare',
    customDomain:'https://bakery.example.com',
    productionUrl:'https://bakery.pages.dev',
    previewUrl:'https://preview.bakery.pages.dev',
    previewDeploy:'d2',
    productionDeploy:'d1',
  }],
  setup:{checks:[{key:'domain',label:'Your domain',state:'pending',detail:'Add CNAME record',owner:'you'}]},
};
const sampleTickets=[
  {id:10,project_id:'p-world',status:'new',title:'Update hours',updated_at:Math.floor((sampleNow-300_000)/1000)},
  {id:11,project_id:'p-world',status:'review',title:'Menu layout',updated_at:Math.floor((sampleNow-600_000)/1000)},
  {id:12,project_id:'p-world',status:'in_progress',title:'Hero photo',updated_at:Math.floor((sampleNow-3600_000)/1000)},
  {id:13,project_id:null,status:'new',title:'Unassigned ticket',updated_at:Math.floor((sampleNow-300_000)/1000)},
];
export function renderProjectOverview(){
  return renderToStaticMarkup(React.createElement(AdminContext.Provider,{value:{
    api:async()=>({projects:[sampleProject]}),
    data:{loaded:true,projects:[sampleProject],tickets:sampleTickets,running:[],recent:[],nodes:[],settings:null,catalog:null},
    host:null,
    setModal:()=>{},
    reload:async()=>{},
    openTicket:()=>{},
  }},React.createElement(ProjectView,{id:'p-world'})));
}
export function renderProjectWorldStandalone(initialStation='hosting'){
  return renderToStaticMarkup(React.createElement(ProjectWorld,{project:sampleProject,sites:sampleProject.sites,tickets:sampleTickets.filter(t=>t.project_id==='p-world'),now:sampleNow,initialStation}));
}
export function renderProjectWorldWithDeploys(){
  const deploys=[{id:'d2',created_at:Math.floor((sampleNow-4*3600_000)/1000),ticket_id:11},{id:'d1',created_at:Math.floor((sampleNow-3*86400_000)/1000)}];
  return renderToStaticMarkup(React.createElement(ProjectWorld,{project:sampleProject,sites:sampleProject.sites,tickets:sampleTickets.filter(t=>t.project_id==='p-world'),deploys,now:sampleNow}));
}
const evidenceRuns=[{id:73,status:'ok',executor:'dsh-go',verify_ok:null,summary:'**What I did** - Fetched \\\`https://example.test\\\` and fixed [the bug](https://example.test/b).\\n\\n- added the guard\\n- kept the path <script>alert(1)</script>'},{id:72,status:'failed',executor:'dsh-go'}];
export function renderEvidence(open){return renderToStaticMarkup(React.createElement(RecordedEvidence,{runs:evidenceRuns,review:{runId:73,verdict:'attention',headline:'Tighten the retry loop'},initialOpen:open}));}
`;
await build({stdin:{contents:entry,resolveDir:path.resolve('packages/admin-ui/src'),loader:'jsx'},outfile:path.join(dir,'render.mjs'),bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom/server'],write:true});
// Resolve the app's real React runtime from this repository, not the temp folder.
let source=await (await import('node:fs/promises')).readFile(path.join(dir,'render.mjs'),'utf8');
source=source.replaceAll('"react"',JSON.stringify(pathToFileURL(require.resolve('react')).href)).replaceAll('"react/jsx-runtime"',JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href)).replaceAll('"react-dom/server"',JSON.stringify(pathToFileURL(require.resolve('react-dom/server')).href));
await writeFile(path.join(dir,'render.mjs'),source);
const rendered=await import(pathToFileURL(path.join(dir,'render.mjs')));
test('real task modal renders draft as default with empty submission disabled',()=>{
  const html=rendered.renderTask();
  assert.match(html,/>Save draft<\/button>/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>Save draft<\/button>/);
  assert.match(html,/aria-pressed="true"[^>]*>Save draft<\/button>/);
  assert.match(html,/aria-pressed="false"[^>]*>Queue agent<\/button>/);
});
test('standalone project destination is exported as a component',()=>assert.equal(typeof rendered.ProjectPage,'function'));
test('recorded evidence is one compact summary row until its toggle opens',()=>{
  const html=rendered.renderEvidence(false);
  assert.match(html,/Recorded evidence/);
  assert.match(html,/Run #73 · ok · no commit recorded · verification unknown/);
  assert.match(html,/<button[^>]*aria-expanded="false"[^>]*>Show details<\/button>/);
  assert.doesNotMatch(html,/Evidence run/);
  assert.doesNotMatch(html,/No immutable commit recorded/);
  assert.doesNotMatch(html,/What I did/);
});
test('expanded evidence keeps the controls, every field and formatted markdown',()=>{
  const html=rendered.renderEvidence(true);
  assert.match(html,/<button[^>]*aria-expanded="true"[^>]*>Hide details<\/button>/);
  assert.match(html,/Evidence run/);
  assert.match(html,/Comparison run/);
  assert.match(html,/No comparison/);
  assert.match(html,/No immutable commit recorded/);
  assert.match(html,/Tighten the retry loop/);
  assert.match(html,/One column per run’s saved evidence/);
  assert.doesNotMatch(html,/not a direct code diff/);
  // The report is formatted, never raw markdown and never injected HTML.
  assert.doesNotMatch(html,/\*\*What I did\*\*/);
  assert.match(html,/<strong>What I did<\/strong>/);
  assert.match(html,/<code>https:\/\/example\.test<\/code>/);
  assert.match(html,/<li>added the guard<\/li>/);
  assert.match(html,/title="https:\/\/example\.test\/b"[^>]*>the bug</);
  assert.doesNotMatch(html,/<a [^>]*href="https:\/\/example\.test\/b"/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>/);
});
test('ProjectView Overview leads with what needs attention; the map waits behind Show map',()=>{
  const overviewHtml=rendered.renderProjectOverview();
  assert.match(overviewHtml,/aria-label="Needs attention"/);
  // Review waits on a decision, so it comes before the newer plain request.
  assert.match(overviewHtml,/class="aw-mono">#11<\/span><strong>Menu layout<\/strong>/);
  assert.match(overviewHtml,/class="aw-mono">#10<\/span><strong>Update hours<\/strong>/);
  assert.match(overviewHtml,/aria-label="Project health"/);
  assert.match(overviewHtml,/Live at bakery\.example\.com · 1 stalled build · 0\/1 checks ok/);
  assert.match(overviewHtml,/>Show map<\/button>/);
  // Collapsed by default: the heavy map never blocks the first screen.
  assert.doesNotMatch(overviewHtml,/class="aw-world"/);
  assert.doesNotMatch(overviewHtml,/\bNaN\b/);
  assert.doesNotMatch(overviewHtml,/\bundefined\b/);
});

test('ProjectWorld renders its stations, checks and operator counts without NaN or undefined',()=>{
  const worldHtml=rendered.renderProjectWorldStandalone('hosting');
  assert.match(worldHtml,/class="aw-world"/);
  assert.match(worldHtml,/class="aw-world__svg"/);
  assert.match(worldHtml,/class="aw-world__sr-only"/);
  assert.match(worldHtml,/Cloudflare \(your account\)/);
  assert.match(worldHtml,/Operator: Needs you: 2, Stalled: 1\./);
  assert.match(worldHtml,/class="aw-world__station aw-world__station--hosting/);
  assert.match(worldHtml,/class="aw-world__station aw-world__station--preview/);
  assert.match(worldHtml,/class="aw-world__station aw-world__station--agent/);
  assert.match(worldHtml,/class="aw-world__station aw-world__station--request/);
  assert.doesNotMatch(worldHtml,/\bNaN\b/);
  assert.doesNotMatch(worldHtml,/\bundefined\b/);
  for (const station of ['agent','request']) {
    const opHtml=rendered.renderProjectWorldStandalone(station);
    assert.match(opHtml,/class="aw-world__ops"/);
    assert.match(opHtml,/Needs you: <strong>2<\/strong>/);
    assert.match(opHtml,/Stalled \(&gt;45m\): <strong>1<\/strong>/);
    assert.doesNotMatch(opHtml,/\bNaN\b/);
    assert.doesNotMatch(opHtml,/\bundefined\b/);
  }
});

test('ProjectWorld follows the most recent open request, as the client sees it',()=>{
  const html=rendered.renderProjectWorldStandalone('hosting');
  // Pills for the project's requests plus "All stations"; the newest open one (#10, new) is followed.
  assert.match(html,/class="aw-world__journeys"/);
  assert.match(html,/All stations/);
  assert.match(html,/aria-pressed="true"[^>]*title="#10 Update hours"/);
  // The sample tickets carry no created_at, so the sentence has no "2h ago" part.
  assert.match(html,/class="aw-world__journey-sentence">Asked[^<]*→ waiting for approval</);
  // A new request is at the inbox: request current, the rest of the path ahead.
  assert.match(html,/aw-world__station--request[^"]*is-journey-current/);
  assert.match(html,/aw-world__station--hosting[^"]*is-journey-ahead/);
  assert.doesNotMatch(html,/\bNaN\b/);
  assert.doesNotMatch(html,/\bundefined\b/);
});

test('the map names changes on the preview that are not live yet, and stays quiet without history',()=>{
  const html=rendered.renderProjectWorldWithDeploys();
  assert.match(html,/class="aw-world__drift"/);
  assert.match(html,/1 change on preview · unshipped 4h \(since #11\)/);
  assert.doesNotMatch(html,/\bNaN\b|\bundefined\b/);
  assert.doesNotMatch(rendered.renderProjectWorldStandalone('hosting'),/aw-world__drift/);
});
