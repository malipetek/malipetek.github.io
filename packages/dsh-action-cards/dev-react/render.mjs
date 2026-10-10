/**
 * Render the Action cards client half under real React, in a real DOM.
 *
 * `dev-client-smoke.mjs` drives the bundle with a miniature hook runtime. That
 * runtime is fast and has no dependencies, but it is not React: it cannot fail a
 * component for breaking the rules of hooks across a re-render, and it does not
 * run React's own event system. This test does both — it mounts with
 * `react-dom/client` into jsdom, types into the masked field, clicks Apply and
 * asserts what the component actually did.
 *
 *   ./dev-react/setup.sh && node dev-react/render.mjs
 *
 * React, React DOM and jsdom are resolved from the directory `setup.sh` fills,
 * not from this package, so the plugin keeps its zero-dependency property.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const REACT_DIR = process.env.DSH_ACTION_CARDS_REACT_DIR ?? '/tmp/dsh-action-cards-react';
const CLIENT = process.env.DSH_ACTION_CARDS_CLIENT ?? new URL('../client.js', import.meta.url).pathname;

const scratchRequire = createRequire(join(REACT_DIR, 'package.json'));
let JSDOM;
try {
  ({ JSDOM } = scratchRequire('jsdom'));
} catch {
  console.error(
    `render.mjs: React, React DOM and jsdom are not installed in ${REACT_DIR}.\n` +
      'Run ./dev-react/setup.sh first (or set DSH_ACTION_CARDS_REACT_DIR).',
  );
  process.exit(2);
}

/* ---------------------------------------------------------------- *
 * A DOM, before React is loaded
 * ---------------------------------------------------------------- */

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.Node = window.Node;
globalThis.Element = window.Element;
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLInputElement = window.HTMLInputElement;
globalThis.HTMLButtonElement = window.HTMLButtonElement;
globalThis.Event = window.Event;
globalThis.MouseEvent = window.MouseEvent;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Recent Node defines `navigator` as a getter-only global, so it has to be
// redefined rather than assigned.
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true });

const React = scratchRequire('react');
const { createRoot } = scratchRequire('react-dom/client');
const { act } = React;

/* ---------------------------------------------------------------- *
 * Load the bundle and mount the plugin
 * ---------------------------------------------------------------- */

let registration = null;
window.__ModuleLoader__ = { load: (value) => { registration = value; } };
// eslint-disable-next-line no-new-func
new Function('window', readFileSync(CLIENT, 'utf8'))(window);

if (registration === null) throw new Error('the bundle did not register');
const plugin = registration.factory((specifier) => {
  if (specifier === 'react') return React;
  throw new Error(`unexpected require(${JSON.stringify(specifier)})`);
});

const slots = [];
const tabTypes = [];
let openedTab = null;
const ctx = {
  get(name) {
    if (name === 'sidebarRightTabs') return { register: (definition) => { tabTypes.push(definition); return () => {}; } };
    if (name === 'sidebarRight') return { openTab: (kind, options) => { openedTab = { kind, options }; } };
    return undefined;
  },
  effect(body) { body(); return () => {}; },
  slots: {
    inject(_key, callback) { callback(); },
    register(options, component) { slots.push({ key: options.name, id: options.key ?? options.id, options, component }); },
  },
  remote: {
    workspaceFiles: { read: async () => ({ ok: true, value: { text: '', lines: 0, eof: true } }) },
    commands: { execute: async () => ({ ok: true, value: { result: { kind: 'success', text: '{"status":"applied","outcomes":[]}' } } }) },
  },
};
plugin.apply(ctx);

const card = slots.find((entry) => entry.key === 'tool.call.toolview');
const panel = slots.find((entry) => entry.key === 'sidebar.right.pane.tab');
if (card === undefined) throw new Error('the card slot was not registered');
if (panel === undefined) throw new Error('the panel slot was not registered');

/* ---------------------------------------------------------------- *
 * Harness
 * ---------------------------------------------------------------- */

const failures = [];

/**
 * Record and report one check.
 * @param label - what is being checked.
 * @param condition - the result.
 * @param detail - optional value to show.
 */
function check(label, condition, detail) {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!condition) failures.push(label);
}

/**
 * Mount a component with real React and real act().
 * @param component - the component to mount.
 * @param props - its props.
 * @returns the container and an unmount.
 */
async function mount(component, props) {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(component, props)); });
  return { container, unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}

/**
 * The text of a mounted tree.
 * @param container - the container element.
 * @returns its text content.
 */
const textOf = (container) => container.textContent ?? '';

/**
 * Find a button by its exact label.
 * @param container - the container element.
 * @param label - the button's text.
 * @returns the button, or undefined.
 */
function button(container, label) {
  return [...container.querySelectorAll('button')].find((element) => element.textContent === label);
}

/**
 * Find the input belonging to a labelled field.
 * @param container - the container element.
 * @param label - the field's label text.
 * @returns the input, or undefined.
 */
function field(container, label) {
  const owner = [...container.querySelectorAll('label')].find((element) => (element.textContent ?? '').includes(label));
  return owner?.querySelector('input') ?? undefined;
}

/**
 * Type into a React-controlled input the way a browser does.
 * @param input - the input element.
 * @param value - the next value.
 */
async function type(input, value) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

/**
 * Click a React-controlled button.
 * @param element - the button element.
 */
async function click(element) {
  await act(async () => { element.click(); });
}

/* ---------------------------------------------------------------- *
 * Props and fixtures
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
    { kind: 'run_command', command: 'node koofr/upload.mjs --dry-run' },
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

let applied = null;
const api = {
  readItem: async () => null,
  list: async () => [],
  apply: async (sessionId, id, values, steps) => {
    applied = { sessionId, id, values, steps };
    return { status: 'applied', outcomes: [{ ok: true, summary: 'Created koofr/config.json (64 bytes)' }] };
  },
  dismiss: async () => {},
  openPanel: () => { ctx.get('sidebarRight').openTab('action-cards', {}); },
};

const baseProps = {
  callId: 'call-1',
  toolName: 'propose_action',
  cwd: '/Users/malipetek/Documents/deepseek-harness/default-workspace',
  home: '/Users/malipetek',
  sessionId: 'session-react',
  useDisclosure: () => ({ expanded: false, toggle: () => {} }),
  openFile: () => {},
  inspect: () => {},
  loadImage: async () => null,
  api,
};

/* ---------------------------------------------------------------- *
 * 1. The interactive card, under real hooks
 * ---------------------------------------------------------------- */

console.log('\n— the card —');
const view = await mount(card.component, { ...baseProps, phase: 'start', block: startBlock });
const first = textOf(view.container);

check('the title renders', first.includes('Create the Koofr uploader config'));
check('the note renders', first.includes('The token is the one from your Koofr'));
check('the file step renders its path', first.includes('koofr/config.json'));
check('the command step renders its command', first.includes('node koofr/upload.mjs --dry-run'));
check('both declared fields render', first.includes('Koofr email') && first.includes('Koofr app token'));
check('the hint renders', first.includes('Settings → App passwords'));
check('the seeded default reaches the input', field(view.container, 'Koofr email')?.value === 'me@example.com', field(view.container, 'Koofr email')?.value);
check('the secret field is masked', field(view.container, 'Koofr app token')?.type === 'password');
check('Apply is refused while a required value is missing', button(view.container, 'Apply')?.disabled === true);
check('the missing value is named', first.includes('Still needed: Koofr app token'));

/* ---- typing unblocks it ---- */

await type(field(view.container, 'Koofr app token'), 'kf_live_token');
check('Apply becomes available once the value is supplied', button(view.container, 'Apply')?.disabled === false);
check('the outstanding warning clears', !textOf(view.container).includes('Still needed'));

/* ---- preview ---- */

await click(button(view.container, 'Preview'));
const previewed = textOf(view.container);
check('the preview substitutes the typed value', previewed.includes('kf_live_token'));
check('the preview substitutes the seeded value', previewed.includes('me@example.com'));
check('the preview leaves no placeholder behind', !previewed.includes('{{KOOFR_TOKEN}}'));

/* ---- apply ---- */

await click(button(view.container, 'Apply'));
check('Apply reached the callback face', applied !== null);
check('Apply sent the edited secret', applied?.values.KOOFR_TOKEN === 'kf_live_token', applied?.values.KOOFR_TOKEN);
check('Apply sent the seeded value', applied?.values.KOOFR_EMAIL === 'me@example.com');
check('Apply addressed the right proposal', applied?.id === 'call-1');
check('Apply carried the steps', Array.isArray(applied?.steps) && applied.steps.length === 2);
check('Apply used the session scope', applied?.sessionId === 'session-react');

const afterApply = textOf(view.container);
check('the card reports the outcome', afterApply.includes('Created koofr/config.json'));
check('the card settles to applied', afterApply.includes('Applied'));
check('the Apply button is gone once settled', button(view.container, 'Apply') === undefined);
await view.unmount();

/* ---------------------------------------------------------------- *
 * 2. Re-render across phases with real hook ordering
 * ---------------------------------------------------------------- */

console.log('\n— phase changes —');
const mixing = mount(card.component, { ...baseProps, phase: 'start', block: startBlock });
const mounted = await mixing;
// The preparing phase calls a hook the started phase does not. They are
// different component types, so React must remount rather than complain.
const preparing = await mount(card.component, {
  ...baseProps,
  phase: 'preparing',
  block: { phase: 'preparing', callId: 'call-1', name: 'propose_action', turn: 1, step: 1, time: 0, subCalls: [] },
  useToolCallArgumentsPartial: () => '{"title":"Create the Koof',
});
check('the preparing phase renders without a hook-order complaint', textOf(preparing.container).includes('Preparing an action'));
check('the preparing phase shows the streamed prefix', textOf(preparing.container).includes('Create the Koof'));
await preparing.unmount();
await mounted.unmount();

/* ---------------------------------------------------------------- *
 * 3. The Host's checks, in the DOM
 * ---------------------------------------------------------------- */

console.log('\n— the Host\'s pre-flight checks —');
const checked = await mount(card.component, {
  ...baseProps,
  phase: 'result',
  block: {
    ...resultBlock,
    call: { name: 'propose_action', argsRaw: JSON.stringify({
      title: 'Patch the environment file',
      steps: [
        { kind: 'write_file', path: 'app.env', content: 'API_URL=https://api.example.com\n' },
        { kind: 'edit_file', path: 'app.env', search: 'DEBUG=true', replace: 'DEBUG=false' },
      ],
    }) },
    meta: { actionId: 'call-1', checks: { 0: { exists: true, size: 12 }, 1: { matches: 3 } } },
  },
});
const checkedText = textOf(checked.container);
check('the overwrite check is shown', checkedText.includes('overwrites an existing file'));
check('the ambiguity check is shown', checkedText.includes('the text to replace occurs 3 times'));
await checked.unmount();

/* ---------------------------------------------------------------- *
 * 4. A settled proposal read back from the store
 * ---------------------------------------------------------------- */

console.log('\n— recovering a proposal from the store —');
const restoredApi = {
  ...api,
  readItem: async () => ({
    id: 'call-1',
    status: 'applied',
    title: 'Create the Koofr uploader config',
    note: '',
    steps: proposal.steps,
    checks: {},
    values: { KOOFR_EMAIL: 'petek@example.com', KOOFR_TOKEN: 'kf_restored' },
    outcomes: [{ ok: true, summary: 'Created koofr/config.json (64 bytes)' }],
  }),
};
const restored = await mount(card.component, {
  ...baseProps,
  api: restoredApi,
  phase: 'result',
  // A result restored across a page boundary can arrive without its call.
  block: { ...resultBlock, call: null, meta: { actionId: 'call-1' } },
});
const restoredText = textOf(restored.container);
check('the card recovers its title from the record', restoredText.includes('Create the Koofr uploader config'));
check('the card recovers its steps from the record', restoredText.includes('koofr/config.json'));
check('the card recovers the stored status', restoredText.includes('Applied'));
check('the card recovers the stored outcome', restoredText.includes('Created koofr/config.json'));
await restored.unmount();

/* ---------------------------------------------------------------- *
 * 5. The Sidebar panel
 * ---------------------------------------------------------------- */

console.log('\n— the Sidebar panel —');
const items = [
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
    id: 'call-1',
    status: 'applied',
    createdAt: Date.now() - 1000,
    title: 'Create the Koofr uploader config',
    note: '',
    steps: proposal.steps,
    values: { KOOFR_EMAIL: 'me@example.com', KOOFR_TOKEN: 'kf_secret' },
    outcomes: [{ ok: true, summary: 'Created koofr/config.json (64 bytes)' }],
  },
];
const panelApi = { ...api, list: async () => items };
const panelView = await mount(panel.component, { sessionId: 'session-react', api: panelApi });
const panelText = textOf(panelView.container);

check('the panel counts the waiting action', panelText.includes('Waiting (1)'));
check('the panel counts the settled action', panelText.includes('Applied (1)'));
check('the panel lists only what is waiting by default', panelText.includes('Rotate the uploader token') && !panelText.includes('Create the Koofr uploader config'));
check('the waiting item offers its field', field(panelView.container, 'New token') !== undefined);

// Applying from the panel must round-trip on the real React path too.
applied = null;
await type(field(panelView.container, 'New token'), 'sk_from_panel');
await click(button(panelView.container, 'Apply'));
check('the panel applies on the real React path', applied?.values.TOKEN === 'sk_from_panel', applied?.values.TOKEN);
await panelView.unmount();

/* ---------------------------------------------------------------- *
 * 6. Degraded input must not blank the slot
 * ---------------------------------------------------------------- */

console.log('\n— degraded input —');
const broken = await mount(card.component, {
  ...baseProps,
  phase: 'result',
  block: { ...resultBlock, call: null, meta: undefined, content: [{ type: 'text', text: 'nothing useful' }] },
});
check('a call-less result still renders a card', textOf(broken.container).includes('Proposed action'));
check('a call-less result still offers Apply', button(broken.container, 'Apply') !== undefined);
await broken.unmount();

const emptyApi = { ...api, readItem: async () => { throw new Error('the store is unreadable'); } };
const unreadable = await mount(card.component, { ...baseProps, api: emptyApi, phase: 'start', block: startBlock });
check('an unreadable store does not blank the card', textOf(unreadable.container).includes('Create the Koofr uploader config'));
await unreadable.unmount();

/* ---------------------------------------------------------------- *
 * Tally
 * ---------------------------------------------------------------- */

console.log(failures.length === 0 ? '\nreact render test complete: all checks passed' : `\nreact render test FAILED (${failures.length}): ${failures.join('; ')}`);
process.exit(failures.length === 0 ? 0 : 1);
