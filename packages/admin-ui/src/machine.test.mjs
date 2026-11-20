/*
 * The machine views render in every state they can be in: the header pill,
 * the one-time question and the fleet panel. The store's snapshot is seeded
 * directly (the seam machine.jsx exports for this), because a server render
 * never runs the effects that would poll the Host.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { build } = await import(pathToFileURL(createRequire(require.resolve('astro/package.json')).resolve('esbuild')));
const dir = await mkdtemp(path.join(os.tmpdir(), 'machine-render-'));
const entry = `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminContext } from './store.js';
import { MachineOnboarding, MachinePanel, MachineStatusPill, __machineStore } from './machine.jsx';

const host = { json: async () => ({}), command: async () => ({ ok: true, text: '' }) };
const node = (over = {}) => ({
  id: 'mac',
  online: true,
  draining: false,
  executors: ['dsh-go', 'dsh-claude'],
  running: [],
  slots: 2,
  health: { executors: { 'dsh-go': { ok: true, version: '1.2' }, 'dsh-claude': { ok: false } } },
  ...over,
});
const info = (service) => ({
  local: { service, log: 'node started' },
  localConfig: { nodeId: 'mac', slots: 2, executors: null },
});
const seed = (over) => { __machineStore.snapshot = { loaded: true, info: null, consent: null, consentError: null, error: null, ...over }; };
const frame = (component, n) => renderToStaticMarkup(React.createElement(AdminContext.Provider, {
  value: {
    api: async () => ({}), act: async (fn) => fn(), ask: () => {}, notify: () => {}, reload: async () => {},
    setModal: () => {}, openTicket: () => {}, platform: 'dsh', host,
    data: { nodes: [node(n)], error: null },
  },
}, component));
export function pill(over, n) { seed(over); return frame(React.createElement(MachineStatusPill), n); }
export function panel(over, n) { seed(over); return frame(React.createElement(MachinePanel), n); }
export function onboarding(over, n) { seed(over); return frame(React.createElement(MachineOnboarding), n); }
`;
await build({ stdin: { contents: entry, resolveDir: path.resolve('packages/admin-ui/src'), loader: 'jsx' }, outfile: path.join(dir, 'render.mjs'), bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', external: ['react', 'react-dom/server'], write: true });
// Resolve the app's real React runtime from this repository, not the temp folder.
let source = await (await import('node:fs/promises')).readFile(path.join(dir, 'render.mjs'), 'utf8');
source = source
  .replaceAll('"react"', JSON.stringify(pathToFileURL(require.resolve('react')).href))
  .replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href))
  .replaceAll('"react-dom/server"', JSON.stringify(pathToFileURL(require.resolve('react-dom/server')).href));
await writeFile(path.join(dir, 'render.mjs'), source);
const view = await import(pathToFileURL(path.join(dir, 'render.mjs')));

const RUNNING = [{ id: 44, ticket_id: 12, title: 'Fix the menu', executor: 'dsh-go', started_at: Math.floor(Date.now() / 1000) - 60 }];
const service = (state) => ({ loaded: true, state, pid: state === 'running' ? 123 : null, lastExit: state === 'running' ? null : '78' });
const UP = { info: { local: { service: service('running'), log: 'node started' }, localConfig: { nodeId: 'mac', slots: 2, executors: null } } };
const ACCEPTED = { version: 1, acceptedAt: 1_700_000_000, declinedAt: null, lend: ['dsh-go', 'dsh-claude'] };

test('the pill says not set up, with no pause control, until the admin answers', () => {
  const html = view.pill({ ...UP, consent: {} });
  assert.match(html, /This Mac: not set up/);
  assert.doesNotMatch(html, /title="Pause/);
  assert.doesNotMatch(html, /title="Resume/);
});

test('the pill counts live work and names the subscriptions it lends', () => {
  const html = view.pill({ ...UP, consent: ACCEPTED }, { running: RUNNING });
  assert.match(html, /This Mac: working 1\/2 · Flash, Opus/);
  assert.match(html, /title="Pause: what is running finishes, nothing new starts"/);
});

test('a drained machine with work left says pausing, and idle says paused, both with a one-click resume', () => {
  const pausing = view.pill({ ...UP, consent: ACCEPTED }, { draining: true, running: RUNNING });
  assert.match(pausing, /This Mac: pausing 1\/2/);
  assert.match(pausing, /title="Resume: this Mac takes work again"/);
  const paused = view.pill({ ...UP, consent: ACCEPTED }, { draining: true });
  assert.match(paused, /This Mac: paused/);
  assert.match(paused, /title="Resume: this Mac takes work again"/);
});

test('a service that is not running says off, whatever the node says', () => {
  const html = view.pill({ info: { local: { service: service('not installed'), log: '' }, localConfig: { nodeId: 'mac', slots: 2, executors: null } }, consent: ACCEPTED }, { running: RUNNING });
  assert.match(html, /This Mac: off/);
  assert.doesNotMatch(html, /title="Pause/);
  assert.doesNotMatch(html, /title="Resume/);
});

test('the panel shows the state, the running item, per-subscription health and the consent date', () => {
  const html = view.panel({ ...UP, consent: ACCEPTED }, { running: RUNNING });
  assert.match(html, /This Mac<\/h3>/);
  assert.match(html, /Working — 1 of 2 slots busy, lending Flash, Opus\./);
  assert.match(html, />Pause<\/button>/);
  assert.match(html, />Stop now<\/button>/);
  assert.match(html, /#12/);
  assert.match(html, /Fix the menu/);
  assert.match(html, /dsh-go 1\.2/);
  assert.match(html, /Lent since/);
  assert.match(html, /Withdraw consent/);
  assert.match(html, /<details class="aw-mlog">/);
  assert.doesNotMatch(html, /No lending record yet/);
});

test('a drained, idle machine shows paused in the panel and resumes there', () => {
  const html = view.panel({ ...UP, consent: ACCEPTED }, { draining: true, executors: ['dsh-go'] });
  assert.match(html, /Paused — takes no new work\./);
  assert.match(html, />Resume<\/button>/);
  assert.doesNotMatch(html, /Not set up/);
});

test('a declined machine says so, keeps the history, and offers the way back in', () => {
  const html = view.panel(
    { info: { local: { service: service('not installed'), log: '' }, localConfig: { nodeId: 'mac', slots: 2, executors: null } }, consent: { version: 1, acceptedAt: 1_700_000_000, declinedAt: 1_700_864_000, lend: ['dsh-go'] } },
    { online: false, draining: true, executors: [] },
  );
  assert.match(html, /Off — the launchd service is not installed, last exit 78\./);
  assert.match(html, /Declined/);
  assert.match(html, /previously lent/);
  assert.match(html, /Lend this Mac…/);
  assert.doesNotMatch(html, /Withdraw consent/);
});

test('with no record, the panel asks for the one decision instead of showing toggles', () => {
  const html = view.panel({ ...UP, consent: {} });
  assert.match(html, /Not set up — no lending record yet/);
  assert.match(html, /No lending record yet/);
  assert.match(html, /Decide now…/);
  assert.doesNotMatch(html, /Withdraw consent/);
});

test('the onboarding explains what runs here, per subscription, and offers both answers', () => {
  const html = view.onboarding({ ...UP, consent: {} });
  assert.match(html, /Lend this Mac to the fleet\?/);
  assert.match(html, /Only tickets you approved run here/);
  assert.match(html, /~\/\.cache\/malipetek-runner/);
  assert.match(html, /counts against the Claude plan’s limits/);
  assert.match(html, /checked=""[^>]*\/><span class="aw-mexe__name">Flash/);
  assert.match(html, /checked=""[^>]*\/><span class="aw-mexe__name">Opus/);
  assert.match(html, /pause it any time from the “This Mac” pill/);
  assert.match(html, /<button[^>]*>Not now<\/button>/);
  assert.match(html, /<button[^>]*>Lend this Mac<\/button>/);
});

test('the onboarding never shows itself once the record has an answer', () => {
  const accepted = view.onboarding({ ...UP, consent: ACCEPTED });
  assert.equal(accepted, '');
  const declined = view.onboarding({ ...UP, consent: { version: 1, acceptedAt: null, declinedAt: 1_700_864_000, lend: [] } });
  assert.equal(declined, '');
});
