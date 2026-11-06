/**
 * Client tests for @malipetek/dsh-external-agents.
 *
 * Everything here runs against `test/mock-agent.mjs`, so the suite needs no
 * network, no credential, and no real agent installed:
 *
 *   node --test test/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  AcpConnection,
  AgentRegistry,
  SessionStore,
  buildEnv,
  renderUpdate,
  resolveAgents,
  textOf,
  xdgEnv,
} from '../index.js';

const here = dirname(fileURLToPath(import.meta.url));
const mock = join(here, 'mock-agent.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'dsh-external-agents-'));

// Keep this run's diagnostics out of the log a real problem would be debugged from.
process.env.DSH_EXTERNAL_AGENTS_LOG = join(scratch, 'diagnostics.log');

/** Build a connection that runs the mock agent. */
function mockConnection(overrides = {}) {
  return new AcpConnection({
    id: 'mock',
    label: 'Mock',
    command: process.execPath,
    args: [mock],
    cwd: scratch,
    env: buildEnv('minimal', xdgEnv(join(scratch, 'xdg'))),
    timeoutMs: 10_000,
    ...overrides,
  });
}

test('a minimal environment cannot carry DSH provider configuration', () => {
  process.env.ANTHROPIC_BASE_URL = 'https://example.invalid';
  process.env.ANTHROPIC_AUTH_TOKEN = 'secret';
  try {
    const minimal = buildEnv('minimal', {});
    assert.equal(minimal.ANTHROPIC_BASE_URL, undefined);
    assert.equal(minimal.ANTHROPIC_AUTH_TOKEN, undefined);
    assert.equal(minimal.PATH, process.env.PATH, 'PATH still crosses over');

    const inherit = buildEnv('inherit', {});
    assert.equal(inherit.ANTHROPIC_BASE_URL, undefined, 'inherited but routing is still withheld');
    assert.equal(buildEnv('inherit', {}, true).ANTHROPIC_BASE_URL, 'https://example.invalid', 'only an explicit opt-in forwards it');

    const withExtra = buildEnv('minimal', { ANTHROPIC_BASE_URL: 'https://agent-owned.invalid' });
    assert.equal(withExtra.ANTHROPIC_BASE_URL, 'https://agent-owned.invalid', 'the agent may set its own');
  } finally {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  }
});

test('one prompt completes the handshake, streams updates, and answers a permission request', async () => {
  const connection = mockConnection();
  try {
    const result = await connection.prompt('do the thing');
    assert.equal(result.stopReason, 'end_turn');
    assert.equal(result.text, 'Hello world [allow-once]');
    assert.equal(result.permissions.length, 1);
    assert.equal(result.permissions[0].decision, 'allowed');
    assert.equal(result.permissions[0].title, 'Write file');

    const kinds = result.updates.map((entry) => entry.sessionUpdate);
    assert.ok(kinds.includes('agent_message_chunk'));
    assert.ok(kinds.includes('agent_thought_chunk'));
    assert.ok(kinds.includes('tool_call'));
    assert.equal(connection.state, 'ready');
    assert.equal(connection.sessionId, 'mock-session');
  } finally {
    connection.dispose();
  }
});

test('approval "deny" selects the reject option', async () => {
  const connection = mockConnection({ approval: 'deny' });
  try {
    const result = await connection.prompt('do the thing');
    assert.equal(result.text, 'Hello world [reject-once]');
    assert.equal(result.permissions[0].decision, 'denied');
  } finally {
    connection.dispose();
  }
});

test('a silent prompt times out, and says it went quiet', async () => {
  const connection = mockConnection({ idleTimeoutMs: 500 });
  try {
    await assert.rejects(
      () => connection.prompt('TIME_OUT please'),
      /timed out after 500ms of silence/,
    );
  } finally {
    connection.dispose();
  }
});

test('a slow but progressing turn is not killed by the idle timer', async () => {
  // Eight updates over 1.2s with a 600ms idle budget: a total-time timeout would
  // kill this at 600ms, which is exactly how ordinary agentic work was dying.
  const connection = mockConnection({ idleTimeoutMs: 600 });
  try {
    const result = await connection.prompt('SLOW please');
    assert.match(result.text, /SLOW-DONE/, 'the turn survived because it kept sending updates');
    assert.equal(result.stopReason, 'end_turn');
  } finally {
    connection.dispose();
  }
});

test('a missing command reports which command was missing', async () => {
  const connection = mockConnection({ command: 'definitely-not-installed-xyz' });
  try {
    await assert.rejects(() => connection.start(), /command not found: definitely-not-installed-xyz/);
    assert.equal(connection.state, 'failed');
  } finally {
    connection.dispose();
  }
});

test('dispose terminates the child and rejects later work', async () => {
  const connection = mockConnection();
  await connection.start();
  const child = connection.child;
  connection.dispose();
  assert.equal(connection.state, 'disposed');
  await assert.rejects(() => connection.prompt('anything'), /not running|disposed/);
  assert.ok(child === null || child.killed || child.exitCode !== null || child.signalCode !== null);
});

test('a conversation is remembered and adopted by the next process', async () => {
  // Exactly what a plugin reload or an app restart does: the map in memory dies,
  // the store on disk does not, and the session must come back rather than the
  // agent quietly starting over.
  const storeFile = join(scratch, 'resume-store', 'mock.json');
  const first = mockConnection({ sessionStore: new SessionStore(storeFile) });
  let remembered;
  try {
    const session = await first.ensureSession(scratch, 'conversation');
    remembered = session.sessionId;
    assert.equal(first.sessionStore.get('conversation').sessionId, remembered, 'the id was written down');
  } finally {
    first.dispose();
  }

  const second = mockConnection({ sessionStore: new SessionStore(storeFile) });
  try {
    assert.equal(second.sessions.size, 0, 'a fresh connection starts with nothing in memory');
    const adopted = await second.ensureSession(scratch, 'conversation');
    assert.equal(adopted.sessionId, remembered, 'the remembered session was adopted, not replaced');
    assert.equal(second.detail, `resumed ${remembered}`);
  } finally {
    second.dispose();
  }
});

test('an agent with no lifecycle capability is given a new session instead', async () => {
  const storeFile = join(scratch, 'no-resume-store', 'mock.json');
  const store = new SessionStore(storeFile);
  store.set('conversation', { sessionId: 'from-a-previous-process', cwd: scratch });

  const connection = mockConnection({
    sessionStore: store,
    env: buildEnv('minimal', { ...xdgEnv(join(scratch, 'xdg')), MOCK_NO_RESUME: '1' }),
  });
  try {
    const session = await connection.ensureSession(scratch, 'conversation');
    assert.notEqual(session.sessionId, 'from-a-previous-process', 'it made a new one');
    assert.equal(store.get('conversation').sessionId, session.sessionId, 'and the stale entry was replaced');
  } finally {
    connection.dispose();
  }
});

test('a deliberately closed session is not offered for resume later', async () => {
  const storeFile = join(scratch, 'closed-store', 'mock.json');
  const store = new SessionStore(storeFile);
  const connection = mockConnection({ sessionStore: store });
  try {
    await connection.ensureSession(scratch, 'transient');
    assert.ok(store.get('transient') !== undefined);
    await connection.closeSession('transient');
    assert.equal(store.get('transient'), undefined, 'closing is a decision, not a crash');
  } finally {
    connection.dispose();
  }
});

test('the session store round-trips through disk and tolerates rubbish', () => {
  const file = join(scratch, 'store-round-trip', 'a.json');
  const store = new SessionStore(file);
  store.set('k', { sessionId: 's-1', cwd: '/tmp' });
  assert.deepEqual(new SessionStore(file).get('k'), { sessionId: 's-1', cwd: '/tmp' });
  store.forget('k');
  assert.equal(new SessionStore(file).get('k'), undefined);
  writeFileSync(file, 'not json at all');
  assert.equal(new SessionStore(file).get('k'), undefined, 'an unreadable store starts empty rather than throwing');
});

test('an update that arrives after the turn ended is kept, not dropped', async () => {
  // "I'll let you know when it's done", said and meant: the agent speaks after
  // its turn resolved. ACP cannot reopen a finished harness turn, but dropping
  // the message is what makes the agent look like it never followed up.
  const connection = mockConnection();
  try {
    const result = await connection.prompt('LATE please');
    assert.equal(result.stopReason, 'end_turn');
    assert.equal(connection.lateUpdates().length, 0, 'nothing yet when the turn resolves');

    await new Promise((resolve) => setTimeout(resolve, 400));
    const late = connection.lateUpdates();
    assert.equal(late.length, 1, 'the late update was retained');
    assert.match(late[0].text, /the task finished while you were away/);
    assert.equal(typeof late[0].at, 'number', 'and it is timestamped, so pending can order it');

    // A new turn supersedes it, so `pending` means "since the last turn".
    await connection.prompt('plain please');
    assert.equal(connection.lateUpdates().length, 0);
  } finally {
    connection.dispose();
  }
});

test('an unknown workspace reuses the one already learned', async () => {
  // The distinction that matters: `undefined` means "I could not tell", which is
  // not the same as "the workspace moved". Treating them alike meant a turn that
  // failed to resolve a workspace looked like a directory change, so the agent's
  // session was closed and the conversation silently restarted.
  const storeFile = join(scratch, 'sticky-store', 'mock.json');
  const connection = mockConnection({ sessionStore: new SessionStore(storeFile), cwd: '/tmp' });
  try {
    const first = await connection.ensureSession(scratch, 'k');
    assert.equal(first.cwd, scratch);
    const second = await connection.ensureSession(undefined, 'k');
    assert.equal(second.sessionId, first.sessionId, 'the same ACP session, so the context is intact');
    assert.equal(second.cwd, scratch, 'and still in the workspace it learned');
  } finally {
    connection.dispose();
  }
});

test('a workspace that genuinely moved does start a new session', async () => {
  const connection = mockConnection({ cwd: '/tmp' });
  try {
    const first = await connection.ensureSession('/tmp/one', 'k');
    const second = await connection.ensureSession('/tmp/two', 'k');
    assert.notEqual(second.sessionId, first.sessionId, 'ACP cannot change directory, so this is unavoidable');
    assert.equal(second.cwd, '/tmp/two');
  } finally {
    connection.dispose();
  }
});

test('the registry resolves fragments and refuses ambiguity', () => {
  const settings = {
    agents: [
      { id: 'claude', label: 'Claude Code', command: 'x', args: [], env: {} },
      { id: 'devin', label: 'Devin', command: 'y', args: [], env: {} },
    ],
    envMode: 'minimal',
    allowAnthropicRouting: false,
    xdgRoot: join(scratch, 'xgz'),
    maxTranscript: 50,
  };
  const registry = new AgentRegistry(settings, undefined);
  try {
    assert.equal(registry.resolve('claude').id, 'claude');
    assert.equal(registry.resolve('Claude Code').id, 'claude');
    assert.equal(registry.resolve('dev').id, 'devin');
    assert.throws(() => registry.resolve('nope'), /no external agent matches/);
    assert.throws(() => registry.resolve('e'), /matches claude, devin/, 'a shared fragment is ambiguous');
    assert.equal(registry.list().length, 2);
    assert.deepEqual(registry.close('devin'), ['devin']);
  } finally {
    registry.disposeAll();
  }
});

test('a configured agent list bypasses discovery', () => {
  const agents = resolveAgents({ agents: [{ id: 'only', command: 'x' }] });
  assert.equal(agents.length, 1);
  assert.equal(agents[0].label, 'only');
  assert.deepEqual(resolveAgents({ discover: false }), []);
});

test('update rendering covers the shapes an agent actually sends', () => {
  assert.equal(renderUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } }), 'hi');
  assert.equal(renderUpdate({ sessionUpdate: 'tool_call', title: 'Read file', status: 'pending' }), '→ Read file (pending)');
  assert.equal(renderUpdate({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'x' } }), '');
  assert.equal(textOf([{ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'a' } }, { sessionUpdate: 'plan' }]), 'a');
});
