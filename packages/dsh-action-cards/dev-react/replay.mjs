/**
 * Replay one real tool call through the client half, under real React.
 *
 * Written for the case the other suites cannot reproduce: a card that renders and
 * then vanishes when the agent's turn ends. The Host side can be perfect — the
 * `tool/call` and `tool/result` events are in the session log with the right
 * metadata — while the card blanks because the component throws on the *result*
 * phase and the renderer drops the slot entry.
 *
 * So this reads the call out of a real session log and renders both phases with
 * exactly the payload the app produced: the model's own argument string, and the
 * Host's own result metadata.
 *
 *   node dev-react/replay.mjs <session.jsonl[.zstd]> [tool-name] [call-id]
 *
 * A `.zstd` log is decompressed with node's own zlib; a plain `.jsonl` is read
 * as-is. Defaults to the most recent `propose_action` call in the log.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const REACT_DIR = process.env.DSH_ACTION_CARDS_REACT_DIR ?? '/tmp/dsh-action-cards-react';
const CLIENT = process.env.DSH_ACTION_CARDS_CLIENT ?? new URL('../client.js', import.meta.url).pathname;

const scratchRequire = createRequire(join(REACT_DIR, 'package.json'));
let JSDOM;
try {
  ({ JSDOM } = scratchRequire('jsdom'));
} catch {
  console.error(`replay.mjs: React, React DOM and jsdom are not installed in ${REACT_DIR}.\nRun ./dev-react/setup.sh first.`);
  process.exit(2);
}

/* ---------------------------------------------------------------- *
 * The session log
 * ---------------------------------------------------------------- */

/**
 * Find the newest session log when none is named.
 * @returns an absolute path.
 */
function newestLog() {
  const root = join(process.env.HOME ?? '', '.dsh/sessions');
  const candidates = [];
  for (const dir of readdirSync(root)) {
    const full = join(root, dir);
    let entries;
    try {
      entries = readdirSync(full);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!/^session\..*\.jsonl(\.zstd)?$/.test(entry)) continue;
      const path = join(full, entry);
      candidates.push({ path, mtime: statSync(path).mtimeMs });
    }
  }
  candidates.sort((left, right) => right.mtime - left.mtime);
  if (candidates.length === 0) throw new Error('no session log found under ~/.dsh/sessions');
  return candidates[0].path;
}

const logPath = process.argv[2] ?? newestLog();
const wantedTool = process.argv[3] ?? 'propose_action';
const wantedCall = process.argv[4];

const raw = readFileSync(logPath);
const text = logPath.endsWith('.zstd') ? zstdDecompressSync(raw).toString('utf8') : raw.toString('utf8');
const events = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));

const calls = events.filter((event) => event.type === 'tool/call' && event.data?.name === wantedTool);
const call = wantedCall === undefined ? calls.at(-1) : calls.find((entry) => entry.data.callId === wantedCall);
if (call === undefined) throw new Error(`no ${wantedTool} call in ${logPath}`);

const callId = call.data.callId;
const result = events.find((event) => event.type === 'tool/result' && event.data?.message?.toolCallId === callId);
const sessionId = events.find((event) => event.type === 'session')?.data?.id
  ?? events.find((event) => event.type === 'session')?.id
  ?? 'session-replay';

console.log(`log:     ${logPath}`);
console.log(`call:    ${wantedTool} ${callId}`);
console.log(`result:  ${result === undefined ? 'NOT RECORDED' : `seq ${result.seq}`}`);
console.log(`args:    ${call.data.arguments.length} bytes`);

/* ---------------------------------------------------------------- *
 * The DOM, before React
 * ---------------------------------------------------------------- */

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.Node = window.Node;
globalThis.Element = window.Element;
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLInputElement = window.HTMLInputElement;
globalThis.Event = window.Event;
globalThis.MouseEvent = window.MouseEvent;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true });

const React = scratchRequire('react');
const { createRoot } = scratchRequire('react-dom/client');
const { act } = React;

/* ---------------------------------------------------------------- *
 * The bundle
 * ---------------------------------------------------------------- */

let registration = null;
window.__ModuleLoader__ = { load: (value) => { registration = value; } };
// eslint-disable-next-line no-new-func
new Function('window', readFileSync(CLIENT, 'utf8'))(window);

const plugin = registration.factory((specifier) => {
  if (specifier === 'react') return React;
  throw new Error(`unexpected require(${JSON.stringify(specifier)})`);
});

const slots = [];
let storeRecord = null;
const ctx = {
  get: () => undefined,
  effect(body) { body(); return () => {}; },
  slots: {
    inject(_key, callback) { callback(); },
    register(options, component) { slots.push({ key: options.name, options, component }); },
  },
  remote: {
    workspaceFiles: {
      // Stands in for the real read. `--read-fails` models a store the Client
      // cannot reach; `--read-succeeds` models the record the Host wrote.
      read: async () => (process.argv.includes('--read-fails')
        ? { ok: false, error: { code: 'fs/not-found', message: 'simulated' } }
        : { ok: true, value: { text: storeRecord === null ? '' : JSON.stringify(storeRecord), lines: 1, eof: true } }),
    },
    commands: { execute: async () => ({ ok: true, value: { result: { kind: 'success', text: '{"status":"applied","outcomes":[]}' } } }) },
  },
};
plugin.apply(ctx);

const card = slots.find((entry) => entry.key === 'tool.call.toolview');
if (card === undefined) throw new Error('the card slot was not registered');

/* ---------------------------------------------------------------- *
 * Rebuild the two blocks the way the chat projection does
 * ---------------------------------------------------------------- */

const startBlock = {
  phase: 'start',
  callId,
  name: wantedTool,
  argsRaw: call.data.arguments,
  turn: call.data.turn,
  step: call.data.step,
  time: call.time,
  subCalls: [],
};

const resultBlock = result === undefined
  ? null
  : {
      kind: 'tool-result',
      seq: result.seq,
      time: result.time,
      callId,
      call: { name: wantedTool, argsRaw: call.data.arguments },
      callTime: call.time,
      content: result.data.message.content,
      isError: result.data.message.isError === true,
      ...(result.data.message.error === undefined ? {} : { error: result.data.message.error }),
      meta: result.data.meta,
      subCalls: [],
    };

const props = {
  callId,
  toolName: wantedTool,
  cwd: process.cwd(),
  home: process.env.HOME,
  sessionId,
  useDisclosure: () => ({ expanded: false, toggle: () => {} }),
  openFile: () => {},
  inspect: () => {},
  loadImage: async () => null,
  api: {
    readItem: async (_sessionId, _path, _id) => storeRecord?.items?.[callId] ?? null,
    list: async () => [],
    apply: async () => ({ status: 'applied', outcomes: [] }),
    dismiss: async () => {},
    openPanel: () => {},
  },
};

/* ---------------------------------------------------------------- *
 * Render both phases, and let a throw be the finding
 * ---------------------------------------------------------------- */

const failures = [];

/**
 * Render one phase and report what happened.
 * @param label - the phase label.
 * @param phaseProps - the props for this phase.
 * @returns the rendered text.
 */
async function renderPhase(label, phaseProps) {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(React.createElement(card.component, phaseProps)); });
    const text = container.textContent ?? '';
    console.log(`\n${label}: rendered ${text.length} characters`);
    console.log(`  ${text.slice(0, 200).replace(/\s+/g, ' ')}${text.length > 200 ? '…' : ''}`);
    if (text.trim().length === 0) failures.push(`${label} rendered nothing`);
    return text;
  } catch (error) {
    console.log(`\n${label}: THREW`);
    console.log(`  ${error?.name}: ${error?.message}`);
    console.log(String(error?.stack ?? '').split('\n').slice(0, 12).map((line) => `  ${line}`).join('\n'));
    failures.push(`${label} threw: ${error?.name}: ${error?.message}`);
    return '';
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
}

// The store record, as the Host wrote it, so `readItem` has something real.
const storePath = result?.data?.meta?.storePath;
if (storePath !== undefined) {
  try {
    storeRecord = JSON.parse(readFileSync(storePath, 'utf8'));
  } catch {
    storeRecord = null;
  }
}
console.log(`store:   ${storePath ?? '(none in meta)'}${storeRecord === null ? ' (unreadable)' : ''}`);

await renderPhase('preparing', {
  ...props,
  phase: 'preparing',
  block: { phase: 'preparing', callId, name: wantedTool, turn: call.data.turn, step: call.data.step, time: call.time, subCalls: [] },
  useToolCallArgumentsPartial: () => call.data.arguments.slice(0, 120),
});

await renderPhase('start', { ...props, phase: 'start', block: startBlock });

if (resultBlock !== null) {
  await renderPhase('result', { ...props, phase: 'result', block: resultBlock });

  // The result phase with no arguments is the page-boundary case, and the one
  // where the record has to carry everything.
  await renderPhase('result (no call, store only)', {
    ...props,
    phase: 'result',
    block: { ...resultBlock, call: null },
  });
}

console.log(failures.length === 0 ? '\nreplay: both phases rendered' : `\nreplay FAILED:\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
