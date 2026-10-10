/**
 * Local render test for the Projects manager client half.
 *
 * Runs the browser bundle outside DSH against a miniature hook runtime, then
 * walks the produced element tree. It exists because a throwing component blanks
 * its whole slot, and the panel is otherwise only observable by eye in the app.
 * Not shipped: `package.json` `files` omits this path.
 *
 *   node dev-client-smoke.mjs
 */
import { readFile } from 'node:fs/promises';

/* ---------------------------------------------------------------- *
 * Miniature React: enough of the hook contract to drive one render
 * loop to a stable state, including promise-resolving effects.
 * ---------------------------------------------------------------- */

let hooks = [];
let cursor = 0;
let scheduled = [];
let dirty = false;

function createElement(type, props, ...children) {
  const flat = [];
  const push = (value) => {
    if (Array.isArray(value)) value.forEach(push);
    else if (value !== null && value !== undefined && value !== false) flat.push(value);
  };
  children.forEach(push);
  if (typeof type === 'function') return type({ ...(props ?? {}), children: flat });
  return { type, props: props ?? {}, children: flat };
}

function sameDeps(left, right) {
  if (left === undefined || right === undefined) return false;
  if (left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
}

function hookSlot(index) {
  if (hooks[index] === undefined) hooks[index] = {};
  return hooks[index];
}

const React = {
  createElement,
  useState(initial) {
    const index = cursor++;
    const slot = hookSlot(index);
    if (!('value' in slot)) slot.value = typeof initial === 'function' ? initial() : initial;
    return [slot.value, (next) => {
      const resolved = typeof next === 'function' ? next(slot.value) : next;
      if (!Object.is(resolved, slot.value)) {
        slot.value = resolved;
        dirty = true;
      }
    }];
  },
  useMemo(factory, deps) {
    const index = cursor++;
    const slot = hookSlot(index);
    if (!('value' in slot) || !sameDeps(slot.deps, deps)) {
      slot.value = factory();
      slot.deps = deps;
    }
    return slot.value;
  },
  useCallback(factory, deps) {
    const index = cursor++;
    const slot = hookSlot(index);
    if (!('value' in slot) || !sameDeps(slot.deps, deps)) {
      slot.value = factory;
      slot.deps = deps;
    }
    return slot.value;
  },
  useRef(initial) {
    const index = cursor++;
    const slot = hookSlot(index);
    if (!('value' in slot)) slot.value = { current: initial };
    return slot.value;
  },
  useEffect(effect, deps) {
    const index = cursor++;
    const slot = hookSlot(index);
    if (!('value' in slot) || !sameDeps(slot.deps, deps)) {
      slot.deps = deps;
      scheduled.push({ index, effect, previous: slot.cleanup });
    }
  },
};

/* ---------------------------------------------------------------- *
 * Browser globals the bundle expects
 * ---------------------------------------------------------------- */

let registration = null;
const storage = new Map();

globalThis.window = {
  __ModuleLoader__: { load: (value) => { registration = value; } },
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value),
  },
};

/* ---------------------------------------------------------------- *
 * Load the bundle
 * ---------------------------------------------------------------- */

const source = await readFile(new URL('./client.js', import.meta.url), 'utf8');
// The bundle is a plain script that registers itself on window.
// eslint-disable-next-line no-new-func
new Function('window', source)(globalThis.window);

if (registration === null) throw new Error('the bundle did not register');
if (registration.id !== '@malipetek/dsh-projects-manager') throw new Error(`unexpected id ${registration.id}`);

const requireShim = (specifier) => {
  if (specifier === 'react') return React;
  throw new Error(`unexpected require(${JSON.stringify(specifier)})`);
};

const plugin = registration.factory(requireShim);
console.log(`plugin: name=${plugin.name} inject=[${plugin.inject.join(', ')}]`);

/* ---------------------------------------------------------------- *
 * Mount against a mock context
 * ---------------------------------------------------------------- */

const registered = [];
const mockCtx = {
  slots: {
    inject(key, callback) { callback(); },
    register(options, component) { registered.push({ key: options.name, id: options.key ?? options.id, options, component }); },
  },
  sessions: { list: { getSnapshot: () => ({ ids: ['session-smoke'] }) } },
  uiWorkspace: { workspaces: { create: async () => ({ workspaceId: 'w1' }) }, openWorkspace: async () => {} },
  layout: { selectPanel: () => {} },
  remote: {
    workspaceFiles: { read: async () => ({ ok: true, value: { text: '', lines: 0, eof: true } }) },
    commands: { execute: async () => ({ ok: true, value: { result: { kind: 'success', text: 'ok' } } }) },
  },
};

plugin.apply(mockCtx);
console.log('registered slots:', registered.map((entry) => `${entry.key}:${entry.id}`).join(', '));

/* ---------------------------------------------------------------- *
 * Sample index records
 * ---------------------------------------------------------------- */

const day = 86400000;
const records = [
  {
    name: 'BoardRush',
    path: '/Projects/BoardRush',
    hidden: false,
    description: 'boardrush',
    repo: { isGit: true, branch: 'main', ahead: 0, behind: 0, dirty: 60, untracked: 11, lastCommitAt: Date.now() - 13 * day, commits14: 2, commitsPrior14: 30, commits180: 90 },
    dsh: { sessions: 2, turns: 9, minutes: 40, lastWorkedAt: Date.now() - 13 * day, blankSessions: 1 },
    intent: { nextAction: 'land the seating chart', cadenceDays: 3, snoozeUntil: 0, note: '', ignored: false },
    momentum: {
      state: 'stalling',
      score: 0.627,
      quietDays: 13,
      cadenceDays: 3,
      cadenceSource: 'learned',
      lastTouchAt: Date.now() - 13 * day,
      lastTouchSource: 'git',
      reasons: ['13d since real work, against a usual pace of about 3d here', '71 uncommitted or untracked files are piling up'],
      suggestions: ['resume with: land the seating chart', 'commit or stash the drift'],
    },
    directoryMtime: Date.now() - 13 * day,
  },
  {
    name: 'ShipFit-docs',
    path: '/Projects/ShipFit-docs',
    hidden: false,
    description: 'shipfit docs',
    repo: { isGit: true, branch: 'docs/clarity', ahead: 1, behind: 0, dirty: 0, untracked: 0, lastCommitAt: Date.now() - 5 * day, commits14: 12, commitsPrior14: 157, commits180: 200 },
    dsh: { sessions: 0, turns: 0, minutes: 0, lastWorkedAt: 0, blankSessions: 0 },
    intent: { nextAction: '', cadenceDays: 0, snoozeUntil: 0, note: '', ignored: false },
    momentum: {
      state: 'cooling',
      score: 0.46,
      quietDays: 5,
      cadenceDays: 3,
      cadenceSource: 'learned',
      lastTouchAt: Date.now() - 5 * day,
      lastTouchSource: 'git',
      reasons: ['5d since real work, against a usual pace of about 3d here', 'commit pace fell from 157 to 12 per fortnight'],
      suggestions: ['land one small commit to break the stall'],
    },
    directoryMtime: Date.now() - 5 * day,
  },
  {
    name: 'cascadelite',
    path: '/Projects/cascadelite',
    hidden: false,
    description: '',
    repo: { isGit: false, branch: '', ahead: 0, behind: 0, dirty: 0, untracked: 0, lastCommitAt: 0, commits14: 0, commitsPrior14: 0, commits180: 0 },
    dsh: { sessions: 1, turns: 0, minutes: 0, lastWorkedAt: 0, blankSessions: 1 },
    intent: { nextAction: '', cadenceDays: 0, snoozeUntil: 0, note: '', ignored: false },
    momentum: {
      state: 'never-started',
      score: 0,
      quietDays: 0,
      cadenceDays: 14,
      cadenceSource: 'default',
      lastTouchAt: Date.now(),
      lastTouchSource: 'filesystem',
      reasons: ['opened in DSH but never prompted, and nothing has been committed'],
      suggestions: ['start it for real or archive it'],
    },
    directoryMtime: Date.now(),
  },
];

/* ---------------------------------------------------------------- *
 * Render loop
 * ---------------------------------------------------------------- */

/** Collect every string in an element tree. */
function texts(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((child) => texts(child, out));
  else if (node !== null && typeof node === 'object') {
    if (typeof node.type === 'string' && node.type !== 'input') out.push(node.type);
    (node.children ?? []).forEach((child) => texts(child, out));
    if (node.props && typeof node.props === 'object' && typeof node.props.children === 'string') out.push(node.props.children);
  }
  return out;
}

/**
 * Render a component and settle it: run scheduled effects, let their promises
 * resolve, and re-render while state keeps changing.
 * @param component - the function component.
 * @param props - its props.
 * @returns the final element tree.
 */
async function settle(component, props) {
  hooks = [];
  let tree = null;
  for (let pass = 0; pass < 8; pass += 1) {
    cursor = 0;
    dirty = false;
    scheduled = [];
    tree = component(props);
    const pending = scheduled;
    scheduled = [];
    for (const entry of pending) {
      if (typeof entry.previous === 'function') entry.previous();
      const cleanup = entry.effect();
      hookSlot(entry.index).cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    }
    // Let effect-launched promise chains settle before deciding to re-render.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!dirty) break;
  }
  return tree;
}

const page = registered.find((entry) => entry.key === 'main');
const banner = registered.find((entry) => entry.key === 'shell.overlay');
if (page === undefined) throw new Error('the main page was not registered');
if (banner === undefined) throw new Error('the overlay banner was not registered');

const api = {
  readIndex: async () => records,
  runCommand: async () => ({ ok: true, value: { result: { kind: 'success', text: 'ok' } } }),
  adoptWorkspace: async () => ({ workspaceId: 'w1' }),
  revealWorkspace: async () => {},
  showConversation: () => {},
  showPanel: () => {},
};

const pageTree = await settle(page.component, { api });
const pageText = texts(pageTree);
console.log(`\npage rendered ${pageText.length} text nodes`);
for (const needle of ['Project momentum', 'BoardRush', 'stalling', 'ShipFit-docs', 'cooling', 'cascadelite', 'never-started', 'quiet 13d', 'Snooze 14d', 'Edit intent', 'Set up weekday review']) {
  if (!pageText.some((value) => String(value).includes(needle))) throw new Error(`page is missing: ${needle}`);
}
console.log('page contains every expected label');

const bannerTree = await settle(banner.component, { api });
const bannerText = texts(bannerTree).join(' ');
console.log(`\nbanner: ${bannerText}`);
if (!bannerText.includes('BoardRush')) throw new Error('banner did not name the worst project');
if (!bannerText.includes('3 projects losing momentum')) throw new Error('banner did not count the attention set');

const emptyTree = await settle(banner.component, { api: { ...api, readIndex: async () => [] } });
if (texts(emptyTree).length !== 0) throw new Error('banner rendered with no records');

const quietTree = await settle(banner.component, {
  api: { ...api, readIndex: async () => records.map((record) => ({ ...record, momentum: { ...record.momentum, state: 'active' } })) },
});
if (texts(quietTree).length !== 0) throw new Error('banner rendered when nothing needs attention');

console.log('\nclient smoke test complete');
