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
/** Every command line the Client sent to the Host, in order. */
const commandsSeen = [];
const tabsCtx = {
  effect(body) { body(); return () => {}; },
  sidebarRightTabs: { register: (definition) => { tabTypes.push(definition); return () => {}; } },
};
const ctx = {
  // The tab registry arrives through `ctx.inject`, not `ctx.get`, so the stub
  // has to serve both channels.
  inject(_deps, callback) { callback(tabsCtx); },
  get(name) {
    if (name === 'sidebarRight') return { openTab: (kind, options) => { openedTab = { kind, options }; } };
    return undefined;
  },
  effect(body) { body(); return () => {}; },
  sessions: { list: { getSnapshot: () => ({ ids: ['session-react'] }) } },
  slots: {
    inject(_key, callback) { callback(); },
    register(options, component) { slots.push({ key: options.name, id: options.key ?? options.id, options, component }); },
  },
  remote: {
    workspaceFiles: { read: async () => ({ ok: true, value: { text: '', lines: 0, eof: true } }) },
    // Rejects anything `dsh-commands` would not recognize. The real parser matches
    // `/^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/`, so a line without the leading
    // slash is not a command at all. A mock that accepts any string hides exactly
    // the bug this guards against.
    commands: {
      execute: async (_sessionId, line) => {
        commandsSeen.push(line);
        if (!/^\/[a-z][a-z0-9_-]*(?=$|[\t\n\r ])/.test(line)) {
          return { ok: false, error: { code: 'command/not-found', message: `not a command line: ${JSON.stringify(line)}` } };
        }
        return { ok: true, value: { result: { kind: 'success', text: '{"status":"applied","outcomes":[]}' } } };
      },
    },
  },
};
plugin.apply(ctx);

const card = slots.find((entry) => entry.key === 'tool.call.toolview');
const panel = slots.find((entry) => entry.key === 'sidebar.right.pane.tab');
const review = slots.find((entry) => entry.key === 'conversation.input.overlay');
if (card === undefined) throw new Error('the card slot was not registered');
if (panel === undefined) throw new Error('the panel slot was not registered');
if (review === undefined) throw new Error('the composer review popup was not registered');
if (tabTypes.length !== 1) throw new Error('the Actions tab type was not registered');

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
  // `root` is returned so a test can re-render the *same* instance, which is the
  // only way to exercise state that survives a render.
  return {
    container,
    root,
    rerender: async (nextProps) => { await act(async () => { root.render(React.createElement(component, nextProps)); }); },
    unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); },
  };
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
    // The value setter must come from the element's own interface: calling the
    // input one on a textarea throws in jsdom.
    const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

/**
 * Click a React-controlled button.
 * @param element - the button element.
 */
/**
 * Let queued work settle: a state update, the effect it re-runs, and the promise
 * that effect awaits are several turns of the loop, not one.
 */
async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
}

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
 * 1. The row the transcript keeps
 * ---------------------------------------------------------------- */

console.log('\n— the transcript row —');
api.delegate = async () => {};

const rowView = await mount(card.component, { ...baseProps, phase: 'result', block: resultBlock });
const rowText = textOf(rowView.container);
check('the row names what was proposed', rowText.includes('Create the Koofr uploader config'));
check('the row reports the status', rowText.includes('Waiting for you'));
check('the row offers a way in', button(rowView.container, 'Open') !== undefined);
// The form is deliberately not here. A tool call is a step, and the transcript
// folds a completed turn's steps, so a form in this position vanished while it
// was being filled in.
check('the row carries no inputs', rowView.container.querySelectorAll('input').length === 0);
check('the row carries no Apply', button(rowView.container, 'Do it here') === undefined);
await click(button(rowView.container, 'Open'));
check('the row opens the Actions panel', openedTab?.kind === 'action-cards', openedTab?.kind);
await rowView.unmount();

const preparingRow = await mount(card.component, {
  ...baseProps,
  phase: 'preparing',
  block: { phase: 'preparing', callId: 'call-1', name: 'propose_action', turn: 1, step: 1, time: 0, subCalls: [] },
  useToolCallArgumentsPartial: () => '{"title":"Create the Koof',
});
check('the preparing row renders', textOf(preparingRow.container).includes('Preparing an action'));
await preparingRow.unmount();

const delegatedRow = await mount(card.component, {
  ...baseProps,
  phase: 'result',
  block: resultBlock,
  api: { ...api, readItem: async () => ({ id: 'call-1', status: 'delegated', title: 'Create the Koofr uploader config' }) },
});
check('the row reports a handed-back proposal', textOf(delegatedRow.container).includes('Sent back to the agent'), textOf(delegatedRow.container).trim());
await delegatedRow.unmount();

/* ---------------------------------------------------------------- *
 * 2. The panel: the form, and the ways to answer
 * ---------------------------------------------------------------- */

console.log('\n— the Actions panel —');
let delegatedId = null;
let dismissedId = null;
/**
 * A fresh pending proposal, so one section's action cannot leak into the next.
 * @returns a proposal at status `pending`.
 */
const pendingItem = () => ({
  id: 'call-2',
  status: 'pending',
  createdAt: Date.now(),
  title: 'Rotate the uploader token',
  note: 'The old token stops working the moment you apply this.',
  steps: [
    {
      kind: 'edit_file',
      path: 'koofr/config.json',
      search: 'API_KEY=old',
      replace: 'API_KEY={{TOKEN}}',
      fields: [{ name: 'TOKEN', label: 'New token', secret: true, hint: 'Rotate it in Koofr first' }],
    },
  ],
  values: {},
  outcomes: [],
});
/** The store the panel reads, replaced per section. */
let items = [pendingItem()];
/**
 * Land an action the way the Host does: the store changes first, and the next
 * read sees it. A mock that never updates would be testing a store the panel is
 * right to distrust.
 * @param id - the proposal identity.
 * @param status - its next status.
 */
const land = (id, status) => {
  const found = items.find((entry) => entry.id === id);
  if (found !== undefined) found.status = status;
};
const panelApi = {
  ...api,
  // Fresh objects per read, like `parseStore` off the real store. Handing back the
  // same array and the same item objects would freeze every `useMemo` and every
  // effect keyed on them, and the panel would look stale for the wrong reason.
  list: async () => items.map((entry) => ({ ...entry })),
  apply: async (sessionId, id, values, steps) => {
    applied = { sessionId, id, values, steps };
    land(id, 'applied');
    return { status: 'applied', outcomes: [{ ok: true, summary: 'Edited koofr/config.json (+4 characters)' }] };
  },
  delegate: async (sessionId, id, note) => { delegatedId = { sessionId, id, note }; land(id, 'delegated'); },
  dismiss: async (sessionId, id) => { dismissedId = { sessionId, id }; land(id, 'dismissed'); },
};

items = [pendingItem()];
const panelView = await mount(panel.component, { sessionId: 'session-react', api: panelApi });
const panelText = textOf(panelView.container);
check('the panel counts what is waiting', panelText.includes('Waiting (1)'));
check('the panel shows the proposal', panelText.includes('Rotate the uploader token'));
check('the panel shows the note', panelText.includes('The old token stops working'));
check('the panel shows the field', field(panelView.container, 'New token') !== undefined);
check('the panel masks the secret field', field(panelView.container, 'New token')?.type === 'password');
check('the panel shows the hint', panelText.includes('Rotate it in Koofr first'));
check('Do it here is refused while the value is missing', button(panelView.container, 'Do it here')?.disabled === true);
check('the panel offers "You do it"', button(panelView.container, 'You do it') !== undefined);
check('the panel offers Dismiss', button(panelView.container, 'Dismiss') !== undefined);
// The editor's link out to the Sidebar page was rendered inside the Sidebar page,
// where it pointed at the page it was drawn in and did nothing at all.
check('the panel does not offer a link to itself', button(panelView.container, 'Open the Actions panel') === undefined);

await type(field(panelView.container, 'New token'), 'kf_rotated');
check('Do it here opens up once the value is supplied', button(panelView.container, 'Do it here')?.disabled === false);

await click(button(panelView.container, 'Preview'));
check('the preview substitutes the typed value', textOf(panelView.container).includes('kf_rotated'));

applied = null;
await click(button(panelView.container, 'Do it here'));
check('Apply reached the callback face', applied !== null);
check('Apply sent the typed value', applied?.values.TOKEN === 'kf_rotated', applied?.values.TOKEN);
check('Apply used the panel\'s Session', applied?.sessionId === 'session-react');
check('the panel reports the outcome', textOf(panelView.container).includes('Edited koofr/config.json'));
await panelView.unmount();

/* ---- "You do it" ---- */

items = [pendingItem()];
const handBack = await mount(panel.component, { sessionId: 'session-react', api: panelApi });
await click(button(handBack.container, 'You do it'));
check('"You do it" reached the callback face', delegatedId !== null);
check('"You do it" addressed the right proposal', delegatedId?.id === 'call-2');
check('"You do it" used the Session scope', delegatedId?.sessionId === 'session-react');
check('"You do it" says what happened', textOf(handBack.container).includes('Sent back'), textOf(handBack.container).trim().slice(-70));
check('the form settles once handed back', button(handBack.container, 'Do it here') === undefined);
await handBack.unmount();

items = [pendingItem()];
const dismissing = await mount(panel.component, { sessionId: 'session-react', api: panelApi });
await click(button(dismissing.container, 'Dismiss'));
check('Dismiss reached the callback face', dismissedId?.id === 'call-2');
await dismissing.unmount();

/* ---- the filters ---- */

const manyItems = [
  // Built fresh rather than spread from `items`: that array is the previous
  // section's store, already mutated by the actions it exercised.
  pendingItem(),
  { id: 'call-3', status: 'applied', createdAt: Date.now() - 1, title: 'Create the Koofr uploader config', note: '', steps: [], values: {}, outcomes: [] },
  { id: 'call-4', status: 'delegated', createdAt: Date.now() - 2, title: 'Install the uploader', note: '', steps: [], values: {}, outcomes: [] },
  { id: 'call-5', status: 'dismissed', createdAt: Date.now() - 3, title: 'Old idea', note: '', steps: [], values: {}, outcomes: [] },
  { id: 'call-6', status: 'returned', createdAt: Date.now() - 4, title: 'Install the uploader', note: '', steps: [], values: {}, outcomes: [], returnReason: 'needs their token' },
];
/* ---- the agent sent it back ---- */

const returnedItem = {
  id: 'call-6',
  status: 'returned',
  createdAt: Date.now(),
  title: 'Install the uploader',
  note: '',
  steps: [{ kind: 'run_command', command: 'bash install/uploader.sh' }],
  values: {},
  outcomes: [],
  returnReason: 'The token lives in their Koofr account and I cannot read it.',
  returnNeeds: 'the app password',
};
let explained = null;
items = [returnedItem];
const returnedApi = {
  ...panelApi,
  list: async () => items.map((entry) => ({ ...entry })),
  delegate: async (sessionId, id, note) => { explained = { sessionId, id, note }; land(id, 'delegated'); },
};
const returnedView = await mount(panel.component, { sessionId: 'session-react', api: returnedApi });
const returnedText = textOf(returnedView.container);
check('the panel shows the agent\'s reason', returnedText.includes('cannot read it'), returnedText.slice(0, 120));
check('the panel shows what the agent would need', returnedText.includes('the app password'));
check('the agent speaks as a bubble in the thread', returnedText.includes('Agent'));
check('the reply box is a composer, not a labelled field', returnedView.container.querySelector('textarea') !== null);
check('the composer\'s send button is the hand-back', button(returnedView.container, 'You do it') !== undefined);
check('doing it here is a chip, not the send button', button(returnedView.container, 'Do it here') !== undefined);
check('the panel asks how to proceed', returnedView.container.querySelector('textarea')?.placeholder === 'Tell it how to proceed…', returnedView.container.querySelector('textarea')?.placeholder);
check('a returned action still offers Do it here', button(returnedView.container, 'Do it here') !== undefined);
// The gate: the agent asked a question, so handing the job straight back is
// refused until the human answers it.
check('"You do it" is refused until the question is answered', button(returnedView.container, 'You do it')?.disabled === true);
await type(returnedView.container.querySelector('textarea'), 'Use the password in koofr-app-password.txt.');
check('"You do it" opens up once the question is answered', button(returnedView.container, 'You do it')?.disabled === false);
await click(button(returnedView.container, 'You do it'));
check('the answer reaches the agent', explained?.note === 'Use the password in koofr-app-password.txt.', explained?.note);
check('the answer is addressed to the right action', explained?.id === 'call-6');
await returnedView.unmount();

/* ---- a thread that already has both sides ---- */

// A previous answer is part of the conversation, so it comes back as the human's
// own bubble — and the box is prefilled with it, which is why the gate is open.
const answered = {
  ...returnedItem,
  id: 'call-7',
  status: 'returned',
  delegateNote: 'Use the password in koofr-app-password.txt.',
};
items = [answered];
const threadView = await mount(panel.component, { sessionId: 'session-react', api: { ...panelApi, list: async () => items.map((entry) => ({ ...entry })) } });
const threadText = textOf(threadView.container);
check('the thread names the human\'s side', threadText.includes('You'));
check('the previous answer is shown back', threadText.includes('koofr-app-password.txt'));
check('an answered thread reopens the gate', button(threadView.container, 'You do it')?.disabled === false);
await threadView.unmount();

const filtered = await mount(panel.component, { sessionId: 'session-react', api: { ...panelApi, list: async () => manyItems.map((entry) => ({ ...entry })) } });
const filteredText = textOf(filtered.container);
check('the panel counts every status', filteredText.includes('Applied (1)') && filteredText.includes('Handed back (1)') && filteredText.includes('Dismissed (1)'), filteredText.slice(0, 90));
check('a returned action counts as waiting', filteredText.includes('Waiting (2)'), filteredText.slice(0, 40));
check('the waiting view shows the pending and returned items', filteredText.includes('Rotate the uploader token') && filteredText.includes('Install the uploader'));
check('the waiting view hides settled items', !filteredText.includes('Create the Koofr uploader config') && !filteredText.includes('Old idea'));
await filtered.unmount();

const emptyPanel = await mount(panel.component, { sessionId: 'session-react', api: { ...panelApi, list: async () => [] } });
check('the empty panel explains itself', textOf(emptyPanel.container).includes('No proposed actions yet'));
await emptyPanel.unmount();

/* ---------------------------------------------------------------- *
 * 2b. The panel keeps itself current
 * ---------------------------------------------------------------- */

console.log('\n— staying current —');

// The complaint this fixes: acting on a card left the panel's own counts stale
// until Refresh was pressed.
items = [pendingItem()];
const acted = await mount(panel.component, { sessionId: 'session-react', api: panelApi });
check('before acting, one action is waiting', textOf(acted.container).includes('Waiting (1)'), textOf(acted.container).slice(0, 70));
await type(field(acted.container, 'New token'), 'kf_clicked');
await click(button(acted.container, 'Do it here'));
await flush();
const afterActing = textOf(acted.container);
check('acting updates the counts without Refresh', afterActing.includes('Waiting (0)') && afterActing.includes('Applied (1)'), afterActing.slice(0, 70));
await acted.unmount();

// And the case nothing can push: the agent answers a hand-back. The panel only
// knows because it looks again for itself.
const liveStore = [pendingItem()];
const live = await mount(panel.component, { sessionId: 'session-react', api: { ...panelApi, list: async () => liveStore.map((entry) => ({ ...entry })) } });
check('the live panel starts with one waiting action', textOf(live.container).includes('Waiting (1)'));
liveStore[0].status = 'returned';
liveStore[0].returnReason = 'The token lives in their account and I cannot read it.';
// Longer than the panel's own poll period: this is the interval doing the work,
// not a test reaching in.
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 3200)); });
await flush();
const afterPoll = textOf(live.container);
check('an agent-driven change arrives without Refresh', afterPoll.includes('cannot read it'), `${afterPoll.slice(0, 90)}…`);
await live.unmount();

/* ---------------------------------------------------------------- *
 * 3. The review popup over the composer
 * ---------------------------------------------------------------- */

console.log('\n— the composer review popup —');
const waitingItems = [
  {
    id: 'call-2',
    status: 'pending',
    createdAt: Date.now(),
    title: 'Rotate the uploader token',
    note: '',
    steps: [
      {
        kind: 'edit_file',
        path: 'koofr/config.json',
        search: 'API_KEY=old',
        replace: 'API_KEY={{TOKEN}}',
        fields: [{ name: 'TOKEN', label: 'New token', secret: true }],
      },
    ],
    values: {},
    outcomes: [],
  },
];
let waiting = [];
let panelOpened = 0;
let askedSession = null;
let failRead = false;
const reviewApi = {
  ...api,
  pendingItems: async (sessionId) => {
    askedSession = sessionId;
    if (failRead) throw new Error('store unreadable');
    return waiting;
  },
  openPanel: () => { panelOpened += 1; },
};

waiting = [];
const quiet = await mount(review.component, { api: reviewApi, sessionId: 'session-react' });
check('nothing renders while no action is waiting', textOf(quiet.container).trim() === '', JSON.stringify(textOf(quiet.container)));
await quiet.unmount();

waiting = waitingItems;
const one = await mount(review.component, { api: reviewApi, sessionId: 'session-react' });
check('the popup appears for one waiting action', textOf(one.container).includes('1 action is waiting'), textOf(one.container).trim());
check('the popup names the action it is holding', textOf(one.container).includes('Rotate the uploader token'));
check('the popup reads against the composer\'s own Session', askedSession === 'session-react', askedSession);
// Collapsed it is a notice: the form is one press away, not already open.
check('the form is not open until asked for', field(one.container, 'New token') === undefined);
await click(button(one.container, 'Review'));
check('Review opens the form in the popup', field(one.container, 'New token') !== undefined);
check('Review does not send you to the Sidebar panel', panelOpened === 0, `opened ${panelOpened}`);
const outLink = button(one.container, 'Open the Actions panel');
check('the open form still offers the Sidebar page', outLink !== undefined);
await click(outLink);
check('the link out works from the popup', panelOpened === 1, `opened ${panelOpened}`);
await click(button(one.container, 'Hide'));
check('Hide closes the form again', field(one.container, 'New token') === undefined);
await one.unmount();

waiting = [...waitingItems, { ...waitingItems[0], id: 'call-3' }, { ...waitingItems[0], id: 'call-4' }];
const many = await mount(review.component, { api: reviewApi, sessionId: 'session-react' });
check('the popup counts several', textOf(many.container).includes('3 actions are waiting'), textOf(many.container).trim());
await many.unmount();

waiting = waitingItems;
const dismissable = await mount(review.component, { api: reviewApi, sessionId: 'session-react' });
const dismissButton = button(dismissable.container, '×');
check('the popup offers a way to hide it', dismissButton !== undefined);
await click(dismissButton);
check('dismissing hides the notice', textOf(dismissable.container).trim() === '', JSON.stringify(textOf(dismissable.container)));
// A notice you can never get back is one you stop using, so a change in the
// count brings it back.
waiting = [...waitingItems, { ...waitingItems[0], id: 'call-3' }];
// Re-running the poll is what surfaces a new count. A fresh `api` identity makes
// the effect re-run, which is the path the interval takes in the app.
await dismissable.rerender({ api: { ...reviewApi }, sessionId: 'session-react' });
check('a new proposal brings the notice back', textOf(dismissable.container).includes('2 actions are waiting'), textOf(dismissable.container).trim());
await dismissable.unmount();

failRead = true;
const unreadablePopup = await mount(review.component, { api: reviewApi, sessionId: 'session-react' });
check('an unreadable store leaves the composer untouched', textOf(unreadablePopup.container).trim() === '', JSON.stringify(textOf(unreadablePopup.container)));
await unreadablePopup.unmount();
failRead = false;

/* ---------------------------------------------------------------- *
 * 4. The real callback face, line for line
 * ---------------------------------------------------------------- */

console.log('\n— the real callback face —');
commandsSeen.length = 0;
const realApi = card.options.inject().api;
await realApi.apply('session-react', 'call-9', { A: '1' }, [{ kind: 'write_file', path: 'p.txt', content: 'c' }]);
check('apply sends a line the command parser would accept', commandsSeen[0]?.startsWith('/actions apply call-9 ') === true, commandsSeen[0]?.slice(0, 64));
const sent = JSON.parse(commandsSeen[0].slice('/actions apply call-9'.length));
check('the line carries the edited values', sent.values.A === '1');
check('the line carries the steps', Array.isArray(sent.steps) && sent.steps.length === 1);
await realApi.dismiss('session-react', 'call-9');
check('dismiss sends a line the command parser would accept', commandsSeen[1] === '/actions dismiss call-9', commandsSeen[1]);
await realApi.delegate('session-react', 'call-9', 'use the file');
check('"You do it" sends a line the command parser would accept', commandsSeen[2]?.startsWith('/actions delegate call-9 ') === true, commandsSeen[2]);
check('"You do it" carries the answer with it', JSON.parse(commandsSeen[2].slice('/actions delegate call-9'.length)).note === 'use the file');
const pendingSeen = await realApi.pendingItems();
check('the waiting list reads through the store path', Array.isArray(pendingSeen) && pendingSeen.length === 0, JSON.stringify(pendingSeen));

/* ---------------------------------------------------------------- *
 * 5. Degraded input must not blank a slot
 * ---------------------------------------------------------------- */

console.log('\n— degraded input —');
const broken = await mount(card.component, {
  ...baseProps,
  phase: 'result',
  block: { ...resultBlock, call: null, meta: undefined, content: [{ type: 'text', text: 'nothing useful' }] },
});
check('a call-less result still renders a row', textOf(broken.container).includes('Proposed action'));
await broken.unmount();

const unreadableRow = await mount(card.component, {
  ...baseProps,
  phase: 'result',
  block: resultBlock,
  api: { ...api, readItem: async () => { throw new Error('the store is unreadable'); } },
});
check('an unreadable store does not blank the row', textOf(unreadableRow.container).includes('Create the Koofr uploader config'));
await unreadableRow.unmount();

/* ---------------------------------------------------------------- *
 * Tally
 * ---------------------------------------------------------------- */

console.log(failures.length === 0 ? '\nreact render test complete: all checks passed' : `\nreact render test FAILED (${failures.length}): ${failures.join('; ')}`);
process.exit(failures.length === 0 ? 0 : 1);
