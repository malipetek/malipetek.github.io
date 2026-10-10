/**
 * Local render test for the Action cards client half.
 *
 * Runs the browser bundle outside DSH against a miniature hook runtime, then
 * walks the produced element tree. It exists because a throwing component blanks
 * its whole slot, and the card is otherwise only observable by eye in the app.
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

globalThis.window = { __ModuleLoader__: { load: (value) => { registration = value; } } };

/* ---------------------------------------------------------------- *
 * Load the bundle
 * ---------------------------------------------------------------- */

const source = await readFile(new URL('./client.js', import.meta.url), 'utf8');
// The bundle is a plain script that registers itself on window.
// eslint-disable-next-line no-new-func
new Function('window', source)(globalThis.window);

if (registration === null) throw new Error('the bundle did not register');
if (registration.id !== '@malipetek/dsh-action-cards') throw new Error(`unexpected id ${registration.id}`);

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
const effects = [];
const tabTypes = [];
let openedTab = null;

const mockCtx = {
  get(name) {
    if (name === 'sidebarRightTabs') {
      return { register: (definition) => { tabTypes.push(definition); return () => {}; } };
    }
    if (name === 'sidebarRight') {
      return { openTab: (kind, options) => { openedTab = { kind, options }; } };
    }
    return undefined;
  },
  effect(body) {
    const disposer = body();
    effects.push(disposer);
    return () => {};
  },
  slots: {
    inject(key, callback) { callback(); },
    register(options, component) { registered.push({ key: options.name, id: options.key ?? options.id, options, component }); },
  },
  remote: {
    workspaceFiles: { read: async () => ({ ok: true, value: { text: '', lines: 0, eof: true } }) },
    commands: { execute: async () => ({ ok: true, value: { result: { kind: 'success', text: '{"status":"applied","outcomes":[]}' } } }) },
  },
};

plugin.apply(mockCtx);
console.log('registered slots:', registered.map((entry) => `${entry.key}:${entry.id}`).join(', '));
console.log('registered tab types:', tabTypes.map((entry) => `${entry.kind}(${entry.title()})`).join(', '));

// The registry calls an entry's title and description, and sorts on its order,
// so handing it plain strings would render an empty capsule.
const guideEntry = tabTypes[0].guide?.[0];
if (guideEntry === undefined) throw new Error('the Actions tab type contributes no guide entry');
if (typeof guideEntry.title !== 'function') throw new Error('the guide entry title is not a function');
if (typeof guideEntry.description !== 'function') throw new Error('the guide entry description is not a function');
if (typeof guideEntry.order !== 'number') throw new Error('the guide entry carries no order');
if (typeof tabTypes[0].title !== 'function') throw new Error('the tab type title is not a function');
console.log(`guide entry: ${guideEntry.id} → ${guideEntry.title()} (order ${guideEntry.order})`);

const card = registered.find((entry) => entry.key === 'tool.call.toolview');
const panel = registered.find((entry) => entry.key === 'sidebar.right.pane.tab');
if (card === undefined) throw new Error('the tool card was not registered');
if (panel === undefined) throw new Error('the Actions panel was not registered');
if (tabTypes.length !== 1) throw new Error('the Actions tab type was not registered');

/* ---------------------------------------------------------------- *
 * Render loop
 * ---------------------------------------------------------------- */

/**
 * Collect every string an element tree carries, including input values.
 * @param node - an element, or an array of them.
 * @param out - accumulator.
 * @returns the strings.
 */
function texts(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (typeof node === 'number') out.push(String(node));
  else if (Array.isArray(node)) node.forEach((child) => texts(child, out));
  else if (node !== null && typeof node === 'object') {
    if (typeof node.type === 'string' && node.type !== 'input') out.push(node.type);
    const props = node.props ?? {};
    if (typeof props.value === 'string') out.push(props.value);
    if (typeof props.title === 'string') out.push(props.title);
    (node.children ?? []).forEach((child) => texts(child, out));
    if (props.children !== undefined) texts(props.children, out);
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!dirty) break;
  }
  return tree;
}

/**
 * Find the element whose props carry a button label.
 * @param node - an element tree.
 * @param label - the button's text.
 * @returns the matching element, or undefined.
 */
function findButton(node, label) {
  if (node === null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, label);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (node.type === 'button' && texts(node.children).join('') === label) return node;
  for (const child of node.children ?? []) {
    const found = findButton(child, label);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Find the input inside the field whose label carries this text.
 * @param node - an element tree.
 * @param label - the field's declared label.
 * @returns the matching input element, or undefined.
 */
function findInput(node, label) {
  if (node === null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findInput(child, label);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (node.type === 'label' && texts(node.children).includes(label)) {
    const input = findFirst(node, 'input');
    if (input !== undefined) return input;
  }
  for (const child of node.children ?? []) {
    const found = findInput(child, label);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Find the first element of a given intrinsic type.
 * @param node - an element tree.
 * @param type - the intrinsic type, such as `input`.
 * @returns the matching element, or undefined.
 */
function findFirst(node, type) {
  if (node === null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findFirst(child, type);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (node.type === type) return node;
  for (const child of node.children ?? []) {
    const found = findFirst(child, type);
    if (found !== undefined) return found;
  }
  return undefined;
}

/* ---------------------------------------------------------------- *
 * Sample proposal
 * ---------------------------------------------------------------- */

const proposal = {
  title: 'Create the Koofr uploader config',
  note: 'The token is the one from your Koofr account settings.',
  steps: [
    {
      kind: 'write_file',
      path: 'koofr/config.json',
      content: '{\n  "email": "{{KOOFR_EMAIL}}",\n  "token": "{{KOOFR_TOKEN}}"\n}\n',
      fields: [
        { name: 'KOOFR_EMAIL', label: 'Koofr email', value: 'me@example.com' },
        { name: 'KOOFR_TOKEN', label: 'Koofr app token', secret: true, hint: 'Settings → App passwords' },
      ],
    },
    { kind: 'run_command', command: 'node koofr/upload.mjs --dry-run', cwd: '.' },
  ],
};

const startBlock = { phase: 'start', callId: 'call-1', name: 'propose_action', argsRaw: JSON.stringify(proposal), turn: 1, step: 1, time: 0, subCalls: [] };
const resultBlock = {
  kind: 'tool-result',
  seq: 1,
  time: 0,
  callId: 'call-1',
  call: { name: 'propose_action', argsRaw: JSON.stringify(proposal) },
  callTime: 0,
  content: [{ type: 'text', text: 'Proposed 2 actions to the user.' }],
  isError: false,
  meta: { actionId: 'call-1', storePath: '/Users/malipetek/.dsh/action-cards/actions.json' },
  subCalls: [],
};

let appliedPayload = null;
const api = {
  readItem: async () => null,
  list: async () => [],
  apply: async (sessionId, id, values, steps) => {
    appliedPayload = { sessionId, id, values, steps };
    return { status: 'applied', outcomes: [{ ok: true, summary: 'Created koofr/config.json' }] };
  },
  dismiss: async () => {},
  openPanel: () => mockCtx.get('sidebarRight').openTab('action-cards', { params: { actionId: null } }),
};

const baseProps = {
  callId: 'call-1',
  toolName: 'propose_action',
  cwd: '/Users/malipetek/Documents/deepseek-harness/default-workspace',
  home: '/Users/malipetek',
  sessionId: 'session-smoke',
  useDisclosure: () => ({ expanded: false, toggle: () => {} }),
  openFile: () => {},
  inspect: () => {},
  loadImage: async () => null,
  api,
};

/* ---------------------------------------------------------------- *
 * Phase 1 — preparing
 * ---------------------------------------------------------------- */

const preparingTree = await settle(card.component, {
  ...baseProps,
  phase: 'preparing',
  block: { phase: 'preparing', callId: 'call-1', name: 'propose_action', turn: 1, step: 1, time: 0, subCalls: [] },
  useToolCallArgumentsPartial: () => '{"title":"Create the Koof',
});
const preparingText = texts(preparingTree).join(' ');
console.log(`\npreparing card: ${preparingText}`);
if (!preparingText.includes('Preparing an action')) throw new Error('the preparing card did not render');
if (!preparingText.includes('Create the Koof')) throw new Error('the preparing card dropped the streamed arguments');

/* ---------------------------------------------------------------- *
 * Phase 2 — started, fully interactive
 * ---------------------------------------------------------------- */

const startTree = await settle(card.component, { ...baseProps, phase: 'start', block: startBlock });
const startText = texts(startTree).join(' ');
console.log(`\nstarted card: ${startText}`);
for (const needle of [
  'Create the Koofr uploader config',
  'Create file',
  'koofr/config.json',
  'Run command',
  'node koofr/upload.mjs --dry-run',
  'Values to fill in',
  'Koofr email',
  'me@example.com',
  'Koofr app token',
  'Settings → App passwords',
  'Apply',
  'Dismiss',
  'Waiting for you',
]) {
  if (!startText.includes(needle)) throw new Error(`the started card is missing: ${needle}`);
}

const applyButton = findButton(startTree, 'Apply');
if (applyButton === undefined) throw new Error('the Apply button was not found');
if (applyButton.props.disabled !== true) throw new Error('Apply was enabled despite a missing required value');

const secretInput = findInput(startTree, 'Koofr app token');
if (secretInput === undefined) throw new Error('the secret input was not found');
if (secretInput.props.type !== 'password') throw new Error('the secret field did not render as a password input');

const emailInput = findInput(startTree, 'Koofr email');
if (emailInput === undefined) throw new Error('the plain input was not found');
if (emailInput.props.type !== 'text') throw new Error('the plain field did not render as a text input');
if (emailInput.props.value !== 'me@example.com') throw new Error('the proposed default was not seeded into the field');

// When every declared placeholder already has a value, Apply must be live.
const completeProposal = {
  title: 'Set the uploader token',
  steps: [
    {
      kind: 'write_file',
      path: 'koofr/config.json',
      content: '{"token": "{{KOOFR_TOKEN}}"}',
      fields: [{ name: 'KOOFR_TOKEN', label: 'Koofr app token', value: 'kf_seeded' }],
    },
  ],
};
const completeTree = await settle(card.component, {
  ...baseProps,
  phase: 'start',
  block: { ...startBlock, argsRaw: JSON.stringify(completeProposal) },
});
const completeApply = findButton(completeTree, 'Apply');
if (completeApply === undefined) throw new Error('the Apply button vanished from the complete proposal');
if (completeApply.props.disabled === true) throw new Error('Apply stayed disabled although every value was supplied');
console.log('\ncomplete proposal leaves Apply enabled');

/* ---------------------------------------------------------------- *
 * Phase 3 — settled result
 * ---------------------------------------------------------------- */

const resultTree = await settle(card.component, { ...baseProps, phase: 'result', block: resultBlock });
const resultText = texts(resultTree).join(' ');
console.log(`\nsettled card: ${resultText}`);
if (!resultText.includes('Create the Koofr uploader config')) throw new Error('the settled card lost its title');
if (!resultText.includes('Apply')) throw new Error('the settled card lost its Apply button');

/* ---------------------------------------------------------------- *
 * Phase 3b — the Host's pre-flight checks reach the card
 * ---------------------------------------------------------------- */

const checkedProposal = {
  title: 'Patch the environment file',
  steps: [
    { kind: 'write_file', path: 'app.env', content: 'API_URL=https://api.example.com\n' },
    { kind: 'edit_file', path: 'app.env', search: 'DEBUG=true', replace: 'DEBUG=false' },
  ],
};
const checkedTree = await settle(card.component, {
  ...baseProps,
  phase: 'result',
  block: {
    ...resultBlock,
    call: { name: 'propose_action', argsRaw: JSON.stringify(checkedProposal) },
    meta: {
      actionId: 'call-1',
      storePath: '/Users/malipetek/.dsh/action-cards/actions.json',
      checks: { 0: { exists: true, size: 12 }, 1: { matches: 3 } },
    },
  },
});
const checkedText = texts(checkedTree).join(' ');
console.log(`\nchecked card: ${checkedText}`);
if (!checkedText.includes('overwrites an existing file')) throw new Error('the overwrite check never reached the card');
if (!checkedText.includes('the text to replace occurs 3 times')) throw new Error('the ambiguity check never reached the card');

const missingTree = await settle(card.component, {
  ...baseProps,
  phase: 'result',
  block: {
    ...resultBlock,
    call: { name: 'propose_action', argsRaw: JSON.stringify(checkedProposal) },
    meta: { actionId: 'call-1', checks: { 1: { matches: 0 } } },
  },
});
const missingText = texts(missingTree).join(' ');
if (!missingText.includes('the text to replace is not in the file')) throw new Error('a zero-match check was not surfaced');

/* ---------------------------------------------------------------- *
 * Phase 4 — the Sidebar page
 * ---------------------------------------------------------------- */

const appliedItem = {
  id: 'call-1',
  status: 'applied',
  createdAt: Date.now() - 1000,
  title: 'Create the Koofr uploader config',
  note: '',
  steps: proposal.steps,
  values: { KOOFR_EMAIL: 'me@example.com', KOOFR_TOKEN: 'kf_secret_token' },
  outcomes: [{ ok: true, summary: 'Created koofr/config.json (64 bytes)' }],
};
const pendingItem = {
  id: 'call-2',
  status: 'pending',
  createdAt: Date.now(),
  title: 'Rotate the uploader token',
  note: '',
  steps: [{ kind: 'edit_file', path: 'koofr/config.json', search: 'old', replace: '{{TOKEN}}', fields: [{ name: 'TOKEN', label: 'New token', secret: true }] }],
  values: {},
  outcomes: [],
};
api.list = async () => [pendingItem, appliedItem];

const panelTree = await settle(panel.component, { sessionId: 'session-smoke', api });
const panelText = texts(panelTree).join(' ');
console.log(`\npanel: ${panelText}`);
for (const needle of ['Actions', 'Refresh', 'Waiting (1)', 'Applied (1)', 'Dismissed (0)', 'All (2)', 'Rotate the uploader token', 'Waiting for you', 'New token']) {
  if (!panelText.includes(needle)) throw new Error(`the panel is missing: ${needle}`);
}
// The default view is what is still waiting on the human, so a settled action
// must not clutter it.
if (panelText.includes('Create the Koofr uploader config')) throw new Error('the panel showed a settled action under the waiting filter');
if (panelText.includes('Created koofr/config.json')) throw new Error('the panel showed a settled outcome under the waiting filter');

api.list = async () => [];
const emptyPanel = await settle(panel.component, { sessionId: 'session-smoke', api });
const emptyText = texts(emptyPanel).join(' ');
console.log(`\nempty panel: ${emptyText}`);
if (!emptyText.includes('No proposed actions yet')) throw new Error('the empty panel did not explain itself');

/* ---------------------------------------------------------------- *
 * Phase 5 — apply round trip and the Sidebar reveal
 * ---------------------------------------------------------------- */

api.apply = async (sessionId, id, values, steps) => {
  appliedPayload = { sessionId, id, values, steps };
  return { status: 'applied', outcomes: [{ ok: true, summary: 'Created koofr/config.json' }] };
};
const applyTree = await settle(card.component, { ...baseProps, phase: 'result', block: resultBlock });
const applyButtonNow = findButton(applyTree, 'Apply');
if (applyButtonNow === undefined) throw new Error('the Apply button vanished');
await applyButtonNow.props.onClick();
if (appliedPayload === null) throw new Error('Apply did not reach the callback face');
if (appliedPayload.id !== 'call-1') throw new Error(`Apply sent the wrong id: ${appliedPayload.id}`);
if (appliedPayload.values.KOOFR_EMAIL !== 'me@example.com') throw new Error('Apply dropped the seeded email value');
console.log(`\napply sent: ${JSON.stringify(appliedPayload.values)}`);

const revealTree = await settle(card.component, { ...baseProps, phase: 'result', block: resultBlock });
const revealButton = findButton(revealTree, 'Open the Actions panel');
if (revealButton === undefined) throw new Error('the reveal button was not found');
revealButton.props.onClick();
if (openedTab === null || openedTab.kind !== 'action-cards') throw new Error('the reveal button did not open the Actions tab');
console.log(`reveal opened tab kind: ${openedTab.kind}`);

/* ---------------------------------------------------------------- *
 * Phase 6 — degraded Host: a malformed proposal must still render
 * ---------------------------------------------------------------- */

const brokenTree = await settle(card.component, {
  ...baseProps,
  phase: 'result',
  block: { ...resultBlock, call: null, meta: undefined, content: [{ type: 'text', text: 'no metadata' }] },
});
const brokenText = texts(brokenTree).join(' ');
console.log(`\nwindowless result card: ${brokenText}`);
if (!brokenText.includes('Proposed action')) throw new Error('a call-less result did not fall back to a generic title');

// With no arguments and no metadata the store is the only source for what was
// proposed, and the card has to become usable again from it.
api.readItem = async () => ({
  id: 'call-1',
  status: 'pending',
  title: 'Create the Koofr uploader config',
  note: '',
  steps: proposal.steps,
  checks: {},
  outcomes: [],
});
const recoveredTree = await settle(card.component, {
  ...baseProps,
  phase: 'result',
  block: { ...resultBlock, call: null, meta: { actionId: 'call-1' } },
});
const recoveredText = texts(recoveredTree).join(' ');
console.log(`\nrecovered card: ${recoveredText}`);
if (!recoveredText.includes('KOOFR_TOKEN') && !recoveredText.includes('Koofr app token')) {
  throw new Error('the card did not recover its steps from the store');
}
if (!recoveredText.includes('koofr/config.json')) throw new Error('the recovered card lost its step detail');

console.log('\nclient smoke test complete');
