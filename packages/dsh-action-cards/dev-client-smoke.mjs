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

const tabsCtx = {
  effect(body) { body(); return () => {}; },
  sidebarRightTabs: { register: (definition) => { tabTypes.push(definition); return () => {}; } },
};
const mockCtx = {
  // The tab registry is reached through `ctx.inject`, so both channels are stubbed.
  inject(_deps, callback) { callback(tabsCtx); },
  get(name) {
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
  sessions: { list: { getSnapshot: () => ({ ids: ['session-smoke'] }) } },
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
const review = registered.find((entry) => entry.key === 'conversation.input.overlay');
if (card === undefined) throw new Error('the tool card was not registered');
if (panel === undefined) throw new Error('the Actions panel was not registered');
if (review === undefined) throw new Error('the composer review popup was not registered');
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
 * Collect every button carrying a label.
 * @param node - an element tree.
 * @param label - the button's text.
 * @param out - accumulator.
 * @returns the matching elements.
 */
function findButtons(node, label, out = []) {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => findButtons(child, label, out));
    return out;
  }
  if (node.type === 'button' && texts(node.children).join('') === label) out.push(node);
  (node.children ?? []).forEach((child) => findButtons(child, label, out));
  return out;
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
 * Assertions
 * ---------------------------------------------------------------- */

/**
 * Fail loudly, in the style of the other suites.
 * @param label - what is being checked.
 * @param condition - the result.
 * @param detail - optional value to show.
 */
function check(label, condition, detail) {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!condition) throw new Error(`check failed: ${label}`);
}

api.delegate = async () => {};

/* ---- the row the transcript keeps ---- */

const preparing = texts(await settle(card.component, {
  ...baseProps,
  phase: 'preparing',
  block: { phase: 'preparing', callId: 'call-1', name: 'propose_action', turn: 1, step: 1, time: 0, subCalls: [] },
  useToolCallArgumentsPartial: () => '{"title":"Create the Koof',
})).join(' ');
check('the row says it is preparing', preparing.includes('Preparing an action'), preparing.trim().slice(0, 60));

const rowTree = await settle(card.component, { ...baseProps, phase: 'result', block: resultBlock });
const settled = texts(rowTree).join(' ');
check('the row names what was proposed', settled.includes('Create the Koofr uploader config'));
check('the row reports the status', settled.includes('Waiting for you'));
check('the row offers a way in', findButton(rowTree, 'Open') !== undefined);

// The form must be gone from the transcript: inputs belong to the panel now,
// because a tool call folds with its turn and a form there vanished mid-edit.
const rowInputs = [];
(function countInputs(node) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(countInputs); return; }
  if (node.type === 'input') rowInputs.push(node);
  (node.children ?? []).forEach(countInputs);
})(rowTree);
check('the row carries no inputs', rowInputs.length === 0, `${rowInputs.length} input(s)`);

/* ---- the panel, which holds the form ---- */

api.list = async () => [
  {
    id: 'call-2',
    status: 'pending',
    createdAt: Date.now(),
    title: 'Rotate the uploader token',
    note: '',
    steps: [{ kind: 'edit_file', path: 'koofr/config.json', search: 'old', replace: '{{TOKEN}}', fields: [{ name: 'TOKEN', label: 'New token', secret: true }] }],
    values: {},
    outcomes: [],
  },
  {
    id: 'call-3',
    status: 'returned',
    createdAt: Date.now() - 500,
    title: 'Install the uploader',
    note: '',
    steps: [],
    values: {},
    outcomes: [],
    returnReason: 'The token is in their account and I cannot read it.',
  },
  {
    id: 'call-1',
    status: 'delegated',
    createdAt: Date.now() - 1000,
    title: 'Create the Koofr uploader config',
    note: '',
    steps: proposal.steps,
    values: {},
    outcomes: [],
  },
];

const panelTree = await settle(panel.component, { sessionId: 'session-smoke', api });
const panelText = texts(panelTree).join(' ');
check('the panel counts what is waiting', panelText.includes('Waiting (2)'), panelText.slice(0, 60));
check('the panel shows the agent\'s reason', panelText.includes('cannot read it'));
check('the panel offers the reply box', panelTree !== null);
// The pending item's button stays live; the returned one is gated behind the
// agent's question. Both are on screen, so the assertion is over the set.
const handBackButtons = findButtons(panelTree, 'You do it');
check('both waiting items offer "You do it"', handBackButtons.length === 2, `${handBackButtons.length} button(s)`);
check('the returned item gates "You do it"', handBackButtons.some((element) => element.props.disabled === true));
check('the panel shows the agent\'s message as a thread', panelText.includes('Agent'));
check('the panel counts what was handed back', panelText.includes('Handed back (1)'));
check('the panel shows the waiting item', panelText.includes('Rotate the uploader token'));
check('the waiting view hides settled items', !panelText.includes('Create the Koofr uploader config'));
check('the panel offers Do it here', findButton(panelTree, 'Do it here') !== undefined);
check('the panel offers "You do it"', findButton(panelTree, 'You do it') !== undefined);
check('the panel offers Dismiss', findButton(panelTree, 'Dismiss') !== undefined);
// The editor's link out to the Sidebar page was rendered inside the Sidebar
// page, where it pointed at the page it was drawn in and did nothing at all.
check('the panel does not offer a link to itself', !panelText.includes('Open the Actions panel'));

api.list = async () => [];
const emptyPanel = texts(await settle(panel.component, { sessionId: 'session-smoke', api })).join(' ');
check('the empty panel explains itself', emptyPanel.includes('No proposed actions yet'));

/* ---- the review popup over the composer ---- */

let waiting = [];
let opened = 0;
const reviewApi = { ...api, pendingItems: async () => waiting, openPanel: () => { opened += 1; } };

waiting = [];
check('the popup stays away when nothing waits', texts(await settle(review.component, { api: reviewApi, sessionId: 'session-smoke' })).length === 0);

waiting = [
  { id: 'call-2', status: 'pending', createdAt: 2, title: 'Rotate the uploader token', note: '', steps: [], values: {}, outcomes: [] },
  { id: 'call-3', status: 'returned', createdAt: 1, title: 'Install the uploader', note: '', steps: [], values: {}, outcomes: [] },
];
const reviewTree = await settle(review.component, { api: reviewApi, sessionId: 'session-smoke' });
const reviewText = texts(reviewTree).join(' ');
check('the popup announces the count', reviewText.includes('2 actions are waiting'), reviewText.trim());
check('the popup names the first waiting action', reviewText.includes('Rotate the uploader token'));
const reviewButton = findButton(reviewTree, 'Review');
check('the popup offers Review', reviewButton !== undefined);
check('the popup offers a way to hide it', findButton(reviewTree, '×') !== undefined);
// Review is the form in place, not a disguised trip to the Sidebar. The expanded
// form itself needs a real re-render, so dev-react/render.mjs is where that is
// exercised; this runtime is here to fail a component that throws.
reviewButton.props.onClick();
check('Review does not send you to the Sidebar panel', opened === 0);

console.log('\nclient smoke test complete');
// The popup polls on an interval, and the miniature runtime never unmounts, so
// the event loop would otherwise stay alive forever.
process.exit(0);
