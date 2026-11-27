/*
 * The project's kinds of work and its client connections, in every state the
 * admin can find them: chips with the catalog's hints, the fleet note, the
 * connection dots, the value-entry modal, and the client-facing copy. The
 * store snapshot is seeded directly (the seam project-solutions.jsx exports
 * for this), because a server render never runs the effects that would fetch.
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
const dir = await mkdtemp(path.join(os.tmpdir(), 'psol-render-'));
const entry = `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminContext } from './store.js';
import { INTEGRATION_CATALOG } from './solutions.js';
import { ProjectSolutions, SolutionTags, IntegrationFieldsModal, clientStepsText, __psolStore } from './project-solutions.jsx';
import { ProjectView } from './project.jsx';

const BASE = { api: async () => ({}), act: async (fn) => fn(), notify: () => {}, ask: () => {}, reload: async () => {}, openTicket: () => {}, setModal: () => {} };
const frame = (component, over = {}) => renderToStaticMarkup(
  React.createElement(AdminContext.Provider, { value: { ...BASE, ...over } }, component),
);
const project = (over = {}) => ({ id: 'p1', name: 'Rosa Florist', slug: 'rosa-florist', kind: 'existing', solutions: [], ...over });

export function psol(over = {}, value = {}) {
  return frame(React.createElement(ProjectSolutions, { project: project(over) }), value);
}
export function seeded(integrations, solutions = ['mobile-ios']) {
  __psolStore.byProject.set('p1', { loaded: true, solutions, integrations, error: null });
  return frame(React.createElement(ProjectSolutions, { project: project({ solutions }) }), { data: { nodes: [], access: { superAdmin: true } } });
}
export function tags(solutions) {
  return frame(React.createElement(SolutionTags, { solutions }));
}
export function fieldsModal(id = 'app-store-connect') {
  return frame(React.createElement(IntegrationFieldsModal, {
    project: project(),
    entry: INTEGRATION_CATALOG.find((i) => i.id === id),
    onClose: () => {},
    onSaved: () => {},
  }));
}
export const integration = (id) => INTEGRATION_CATALOG.find((i) => i.id === id);
export function clientSteps(projectOver, id) {
  return clientStepsText(project(projectOver), INTEGRATION_CATALOG.find((i) => i.id === id));
}
export function projectPage(solutions, tab = 'Overview') {
  return frame(React.createElement(ProjectView, { id: 'p1', initialTab: tab }), {
    api: async () => ({ projects: [] }),
    data: { loaded: true, access: { superAdmin: true }, projects: [project({ solutions })], tickets: [], running: [], recent: [], nodes: [], settings: null, catalog: null },
  });
}
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

const HOUR_AGO = Math.floor(Date.now() / 1000) - 3600;
const ASC_MISSING = { id: 'app-store-connect', label: 'App Store Connect', required: true, connected: false, missing: ['ASC_ISSUER_ID', 'ASC_KEY_ID', 'ASC_PRIVATE_KEY'], verifiedAt: null, verifyError: null };

test('chips render the whole catalog, pressed for the project’s kinds, hinting each summary', () => {
  const html = view.psol({ solutions: ['web', 'mobile-ios'] }, { data: { nodes: [] } });
  assert.equal((html.match(/aria-pressed/g) ?? []).length, 10);
  assert.match(html, /aria-pressed="true"[^>]*>Website<\/button>/);
  assert.match(html, /aria-pressed="true"[^>]*>iOS app<\/button>/);
  assert.match(html, /aria-pressed="false"[^>]*>Shopify store, theme, or app<\/button>/);
  assert.match(html, /title="Design, build, or improve a website that works on phones and desktops\."[^>]*aria-pressed="true"/);
});

test('a required connection with missing fields is bad, names them, and offers every action', () => {
  const html = view.seeded([ASC_MISSING]);
  assert.match(html, /class="aw-dot aw-dot--bad"/);
  assert.match(html, /App Store Connect/);
  assert.match(html, /needs ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY/);
  assert.match(html, /<span class="aw-tag">required<\/span>/);
  assert.match(html, />Verify<\/button>/);
  assert.match(html, />Connect values<\/button>/);
  assert.match(html, /aw-btn--primary[^>]*>Connect values<\/button>/);
  assert.match(html, />Copy client steps<\/button>/);
});

test('the fleet note speaks of needs and machines, never of raw capability ids', () => {
  const warn = view.psol({ solutions: ['mobile-ios'] }, { data: { access: { superAdmin: true }, nodes: [{ id: 'g500', online: false, capabilities: ['docker'] }] } });
  assert.match(warn, /class="aw-psol__fleet aw-psol__fleet--warn"[^>]*>Needs a Mac with Xcode · no online machine can build it yet\./);
  const ok = view.psol({ solutions: ['mobile-ios'] }, { data: { access: { superAdmin: true }, nodes: [{ id: 'mac', online: true, capabilities: ['os:macos', 'xcode'] }] } });
  assert.match(ok, /class="aw-psol__fleet"[^>]*>Needs a Mac with Xcode · mac is online\./);
  assert.doesNotMatch(ok, /No online machine/);
  const offline = view.psol({ solutions: ['mobile-ios'] }, { data: { access: { superAdmin: true }, nodes: [{ id: 'old-imac', online: false, capabilities: ['os:macos', 'xcode'] }] } });
  assert.match(offline, /no online machine can build it yet — old-imac is offline\./);
  const web = view.psol({ solutions: ['web'] }, { data: { access: { superAdmin: true }, nodes: [] } });
  assert.doesNotMatch(web, /aw-psol__fleet/);
});

test('a verified connection is ok and says when; a failed check is warn with the reason; optional stays muted', () => {
  const html = view.seeded([
    { id: 'shopify', label: 'Shopify', required: true, connected: true, missing: [], verifiedAt: HOUR_AGO, verifyError: null },
    { id: 'github', label: 'GitHub', required: false, connected: true, missing: [], verifiedAt: null, verifyError: 'the token was rejected' },
  ], ['shopify']);
  assert.match(html, /class="aw-dot aw-dot--ok"/);
  assert.match(html, /verified 1h ago/);
  assert.match(html, /class="aw-dot aw-dot--warn"/);
  assert.match(html, /the token was rejected/);
  const opt = view.seeded([{ id: 'github', label: 'GitHub', required: false, connected: false, missing: [], verifiedAt: null, verifyError: null }], ['web']);
  assert.match(opt, /class="aw-dot aw-dot--muted"/);
  assert.match(opt, /<span class="aw-tag aw-tag--dash">optional<\/span>/);
});

test('a kind covered by the OAuth connections asks for nothing — no Connections block', () => {
  const html = view.seeded([], ['web']);
  assert.match(html, /Kind of work/);
  assert.doesNotMatch(html, />Connections</);
  assert.doesNotMatch(html, /No connections needed/);
  // A stale server row still renders — the block hides only when nothing needs it.
  const stale = view.seeded([{ id: 'github', label: 'GitHub', required: false, connected: true, missing: [], verifiedAt: null, verifyError: null }], ['web']);
  assert.match(stale, />Connections</);
  assert.match(stale, /GitHub/);
});

test('what we deliver and ask collapses behind one line per chosen kind', () => {
  const html = view.psol({ solutions: ['shopify'] }, { data: { nodes: [] } });
  assert.match(html, /<details class="aw-psol__brief">/);
  assert.match(html, /What we deliver \/ ask the client/);
  assert.match(html, /Store or app changes/);
  assert.match(html, /What do you sell, and where do you ship\?/);
  const none = view.psol({}, { data: { nodes: [] } });
  assert.doesNotMatch(none, /aw-psol__brief/);
});

test('solution tags stay short, carry the full label as a hint, and render nothing for none', () => {
  const html = view.tags(['mobile-ios', 'aws']);
  assert.match(html, /title="iOS app"[^>]*>iOS<\/span>/);
  assert.match(html, /title="AWS"[^>]*>AWS<\/span>/);
  assert.equal(view.tags([]), '');
  assert.equal(view.tags(undefined), '');
});

test('the client steps message is plain text: numbered steps, then the portal to paste them in', () => {
  const text = view.clientSteps({ name: 'Rosa Florist' }, 'shopify');
  assert.match(text, /Shopify access for “Rosa Florist”/);
  assert.match(text, /1\. Use the store’s permanent myshopify\.com address/);
  assert.match(text, /2\. Create a custom app for this store\./);
  assert.match(text, /https:\/\/ptechsolutions\.net\/portal/);
  assert.doesNotMatch(text, /<|>/);
});

test('the enter modal shows the steps as a list, the docs link, and a field per value', () => {
  const html = view.fieldsModal('app-store-connect');
  assert.match(html, /<ol class="aw-psol__steps">/);
  assert.match(html, /In App Store Connect, open Users and Access → Integrations → App Store Connect API\./);
  assert.match(html, /<textarea rows="4"/);
  assert.match(html, /\(optional\)/);
  assert.match(html, /href="https:\/\/developer\.apple\.com\/documentation\/appstoreconnectapi\/creating-api-keys-for-app-store-connect-api"/);
  assert.match(html, />Save<\/button>/);
  const secret = view.fieldsModal('shopify');
  assert.match(secret, /type="password"/);
});

test('the project page carries the tags in its header and its Setup tab; old tab keys still resolve', () => {
  const html = view.projectPage(['mobile-ios', 'aws'], 'Setup');
  assert.match(html, /aw-psol__tags/);
  assert.match(html, /title="iOS app"[^>]*>iOS<\/span>/);
  assert.match(html, /title="AWS"[^>]*>AWS<\/span>/);
  assert.doesNotMatch(html, /<h3>Kind of work and client connections<\/h3>/);
  assert.match(html, />Overview<\/button>/);
  assert.match(html, />Work<\/button>/);
  assert.match(html, /aria-selected="true"[^>]*>Setup<\/button>/);
  assert.match(html, /Kind of work/);
  assert.match(html, /aria-pressed="true"[^>]*>iOS app<\/button>/);
  // Stored tab keys from before the collapse land on their new home.
  for (const legacy of ['Solutions', 'Resources', 'People', 'Activity & review']) {
    assert.match(view.projectPage(['mobile-ios'], legacy), /aria-selected="true"[^>]*>(Setup|Work)<\/button>/);
  }
  const quiet = view.projectPage([], 'Setup');
  assert.doesNotMatch(quiet, /aw-psol__tags/);
  assert.match(quiet, /Website · GitHub not connected · rosa-florist/);
  assert.doesNotMatch(quiet, /\bundefined\b/);
});
