import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
// jsdom is not a dependency of this repo: point JSDOM_FROM at a checkout that has it
// (e.g. the desktop shell), or the interaction tests are skipped.
let JSDOM = null;
try {
  ({ JSDOM } = createRequire(process.env.JSDOM_FROM ? path.join(process.env.JSDOM_FROM, 'x.js') : import.meta.url)('jsdom'));
} catch {
  JSDOM = null;
}
const { build, stop } = await import(pathToFileURL(createRequire(require.resolve('astro/package.json')).resolve('esbuild')));

if (!JSDOM) test('project picker interaction (needs jsdom; set JSDOM_FROM)', { skip: true }, () => {});
const dom = JSDOM && new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
if (dom) for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Node', 'KeyboardEvent', 'MouseEvent', 'Event']) {
  Object.defineProperty(globalThis, key, { value: dom.window[key] ?? dom.window, configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
test.after(() => {
  dom?.window.close();
  // React's scheduler keeps a MessageChannel port open; an unref'd timer ends
  // the process only if that is all that is left.
  setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
});

const run = dom ? test : (name, fn) => test(name, { skip: 'needs jsdom' }, fn);
const dir = await mkdtemp(path.join(os.tmpdir(), 'picker-'));
const out = path.join(dir, 'picker.mjs');
await build({
  stdin: {
    contents: `export { ProjectPicker } from './project-picker.jsx'; export { createElement } from 'react'; export { createRoot } from 'react-dom/client'; export { act } from 'react';`,
    resolveDir: path.dirname(new URL(import.meta.url).pathname),
    loader: 'js',
  },
  bundle: true, format: 'esm', platform: 'node', outfile: out, jsx: 'automatic', loader: { '.jsx': 'jsx' }, logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"development"' },
});
await stop?.();
const { ProjectPicker, createElement, createRoot, act } = await import(pathToFileURL(out));

const projects = [
  { id: 'p1', name: 'Personal website', slug: 'personal-website', clients: [{ id: 'c1', email: 'akif@example.com' }] },
  { id: 'p2', name: 'Liftor Co.', slug: 'liftor-co', clients: [{ id: 'c2', email: 'ali@example.com' }] },
  { id: 'p3', name: 'PTech Solutions site', slug: 'ptechsolutions', clients: [] },
];

async function mount(props) {
  const host = document.getElementById('root');
  const root = createRoot(host);
  await act(async () => root.render(createElement(ProjectPicker, props)));
  return { host, root };
}
const key = (el, k) => act(async () => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));
const type = (el, text) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});

run('the button names the project and its client; the list groups by client, the ticket\'s client first', async () => {
  const { host, root } = await mount({ projects, value: 'p1', clientEmail: 'akif@example.com', onChange() {} });
  const button = host.querySelector('.aw-picker__button');
  assert.match(button.textContent, /Personal website/);
  assert.match(button.textContent, /akif@example\.com/);
  await act(async () => button.click());
  const headings = [...document.querySelectorAll('.aw-picker__heading')].map((h) => h.textContent);
  assert.deepEqual(headings, ['akif@example.comthis ticket’s client', 'ali@example.com', 'No client']);
  assert.equal(document.querySelector('li[role=option]').textContent, 'No project');
  await act(async () => root.unmount());
});

run('typing narrows the list, arrows move and Return picks', async () => {
  const picked = [];
  const { host, root } = await mount({ projects, value: 'p1', clientEmail: 'akif@example.com', onChange: (id) => picked.push(id) });
  await act(async () => host.querySelector('.aw-picker__button').click());
  const input = document.querySelector('.aw-picker__panel input');
  await type(input, 'site');
  assert.deepEqual([...document.querySelectorAll('li[role=option]')].map((o) => o.firstChild.textContent), ['Personal website', 'PTech Solutions site']);
  await key(input, 'ArrowDown');
  await key(input, 'Enter');
  assert.deepEqual(picked, ['p3']);
  assert.equal(document.querySelector('.aw-picker__panel'), null, 'closed after picking');
  await act(async () => root.unmount());
});

run('Escape closes without changing anything; picking the current project changes nothing', async () => {
  const picked = [];
  const { host, root } = await mount({ projects, value: 'p2', onChange: (id) => picked.push(id) });
  await act(async () => host.querySelector('.aw-picker__button').click());
  await key(document.querySelector('.aw-picker__panel input'), 'Escape');
  assert.equal(document.querySelector('.aw-picker__panel'), null);
  await act(async () => host.querySelector('.aw-picker__button').click());
  await key(document.querySelector('.aw-picker__panel input'), 'Enter');
  assert.deepEqual(picked, [], 'the active row starts on the current project');
  await act(async () => root.unmount());
});

run('no match says so', async () => {
  const { host, root } = await mount({ projects, value: null, onChange() {} });
  await act(async () => host.querySelector('.aw-picker__button').click());
  await type(document.querySelector('.aw-picker__panel input'), 'zzz');
  assert.match(document.querySelector('.aw-picker__empty').textContent, /No project or client matches/);
  await act(async () => root.unmount());
});
