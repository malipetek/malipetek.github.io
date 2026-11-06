/**
 * Permission tests.
 *
 * These exist because of a real bug: a policy of `deny` once selected
 * `allow-with-updates` — because nothing matched its reject pattern and the code
 * fell back to "the first option offered" — while recording the decision as
 * `denied`. An agent then wrote the file it had been told not to write.
 *
 *   node --test test/permission.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { AcpConnection, buildEnv, xdgEnv } from '../index.js';
import { AcpModelAdapter, pickOption } from '../llm-adapter.js';

const here = dirname(fileURLToPath(import.meta.url));
const mock = join(here, 'mock-agent.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'dsh-external-agents-perm-'));

// Keep this run's diagnostics out of the log a real problem would be debugged from.
process.env.DSH_EXTERNAL_AGENTS_LOG = join(scratch, 'diagnostics.log');

/** A connection running the mock agent. */
function mockConnection(overrides = {}) {
  return new AcpConnection({
    id: 'mock',
    label: 'Mock Agent',
    command: process.execPath,
    args: [mock],
    cwd: scratch,
    env: buildEnv('minimal', { ...xdgEnv(join(scratch, 'xdg')), ...(overrides.extraEnv ?? {}) }),
    timeoutMs: 10_000,
    ...overrides,
  });
}

/** The agent's options as Claude Code actually offers them. */
const ALLOW_ONLY = [{ optionId: 'allow-with-updates', name: 'Allow with updates', kind: 'allow_once' }];
const BOTH = [
  { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
];

test('an unmatched intent returns nothing rather than the first option', () => {
  // The exact shape that produced the bug: an allow option is all there is.
  assert.equal(pickOption(ALLOW_ONLY, 'reject'), undefined, 'there is no way to refuse, so there is no reject option');
  assert.equal(pickOption(ALLOW_ONLY, 'allow').optionId, 'allow-with-updates');

  assert.equal(pickOption(BOTH, 'allow').optionId, 'allow-once');
  assert.equal(pickOption(BOTH, 'reject').optionId, 'reject-once');

  // `kind` is authoritative; a misleading name does not override it.
  const misleading = [
    { optionId: 'a', name: 'Reject this!', kind: 'allow_once' },
    { optionId: 'r', name: 'Allow this!', kind: 'reject_once' },
  ];
  assert.equal(pickOption(misleading, 'allow').optionId, 'a', 'kind wins over a confusing name');
  assert.equal(pickOption(misleading, 'reject').optionId, 'r');

  assert.equal(pickOption([], 'allow'), undefined);
  assert.equal(pickOption(undefined, 'allow'), undefined);
});

test('a deny policy with no reject option cancels instead of allowing', async () => {
  const connection = mockConnection({ approval: 'deny', extraEnv: { MOCK_ALLOW_ONLY: '1' } });
  try {
    const result = await connection.prompt('do the thing');
    assert.equal(result.permissions.length, 1);
    assert.equal(result.permissions[0].decision, 'cancelled', 'the decision is recorded as cancelled');
    assert.equal(result.permissions[0].optionId, undefined, 'and no option was selected');
    assert.match(result.text, /\[none\]/, 'the agent was told nothing was selected');
  } finally {
    connection.dispose();
  }
});

test('an allow policy still works when only allow options are offered', async () => {
  const connection = mockConnection({ approval: 'allow', extraEnv: { MOCK_ALLOW_ONLY: '1' } });
  try {
    const result = await connection.prompt('do the thing');
    assert.equal(result.permissions[0].decision, 'allowed');
    assert.equal(result.permissions[0].optionId, 'allow-with-updates');
  } finally {
    connection.dispose();
  }
});

test('a deny policy picks the reject option when one is offered', async () => {
  const connection = mockConnection({ approval: 'deny' });
  try {
    const result = await connection.prompt('do the thing');
    assert.equal(result.permissions[0].decision, 'denied');
    assert.equal(result.permissions[0].optionId, 'reject-once');
  } finally {
    connection.dispose();
  }
});

test('a per-turn handler overrides the static policy', async () => {
  const connection = mockConnection({ approval: 'allow' });
  try {
    let seen = null;
    const result = await connection.prompt('do the thing', {
      onPermission: (params, context) => {
        seen = { title: context.title, options: context.options.length };
        return { outcome: 'selected', optionId: 'reject-once' };
      },
    });
    assert.deepEqual(seen, { title: 'Write file', options: 2 });
    assert.match(result.text, /\[reject-once\]/, 'the handler decided, not the allow policy');
  } finally {
    connection.dispose();
  }
});

test('a handler that throws fails closed', async () => {
  const connection = mockConnection({ approval: 'allow' });
  try {
    const result = await connection.prompt('do the thing', {
      onPermission: () => { throw new Error('no approval channel'); },
    });
    assert.equal(result.permissions[0].decision, 'cancelled');
    assert.match(result.text, /\[none\]/);
  } finally {
    connection.dispose();
  }
});

test('a handler that declines to answer falls back to the static policy', async () => {
  const connection = mockConnection({ approval: 'allow' });
  try {
    const result = await connection.prompt('do the thing', { onPermission: () => undefined });
    assert.equal(result.permissions[0].decision, 'allowed');
    assert.equal(result.permissions[0].optionId, 'allow-once');
  } finally {
    connection.dispose();
  }
});

/** An adapter with a stand-in approval seam. */
function adapterWith(approvalService, approvalPolicy = 'ask') {
  return new AcpModelAdapter({
    connection: { ensureSession: async () => undefined },
    provider: 'acp-mock',
    label: 'Mock Agent',
    resolveSessionKey: () => 'session',
    resolveCwd: () => scratch,
    approvalService,
    approvalPolicy,
    logger: { warn() {}, debug() {} },
  });
}

const AGENT = { session: { id: 'session-1' } };

test('the approval seam decides, and its answer maps onto ACP options', async () => {
  const asked = [];
  const service = { request: async (req) => { asked.push(req); return 'allowed-once'; } };
  const chosen = await adapterWith(service).decidePermission(AGENT, { options: BOTH }, { title: 'Write file', options: BOTH });
  assert.deepEqual(chosen, { outcome: 'selected', optionId: 'allow-once' });
  assert.equal(asked.length, 1, 'the harness was asked');
  assert.equal(asked[0].agent, AGENT, 'about the agent that initiated the turn');
  assert.equal(asked[0].toolName, 'Write file');

  const rejected = await adapterWith({ request: async () => 'rejected' }).decidePermission(AGENT, { options: BOTH }, { title: 'Write file', options: BOTH });
  assert.deepEqual(rejected, { outcome: 'selected', optionId: 'reject-once' });
});

test('an unanswerable approval is never a yes', async () => {
  for (const outcome of ['unavailable', 'cancelled', 'something-new']) {
    const decided = await adapterWith({ request: async () => outcome }).decidePermission(AGENT, { options: BOTH }, { title: 'Write file', options: BOTH });
    assert.deepEqual(decided, { outcome: 'cancelled' }, `"${outcome}" must not authorise anything`);
  }

  const throwing = await adapterWith({ request: async () => { throw new Error('outside an open turn'); } })
    .decidePermission(AGENT, { options: BOTH }, { title: 'Write file', options: BOTH });
  assert.deepEqual(throwing, { outcome: 'cancelled' }, 'a failed question fails closed');

  const channelless = await adapterWith(undefined).decidePermission(AGENT, { options: BOTH }, { title: 'Write file', options: BOTH });
  assert.deepEqual(channelless, { outcome: 'cancelled' }, 'no approval seam means no');

  const agentless = await adapterWith({ request: async () => 'allowed-once' }).decidePermission(null, { options: BOTH }, { title: 'Write file', options: BOTH });
  assert.deepEqual(agentless, { outcome: 'cancelled' }, 'without an initiating agent there is nobody to ask');
});

test('a delegated decision is still bounded by the options the agent offered', async () => {
  const service = { request: async () => 'allowed-once' };
  const decided = await adapterWith(service).decidePermission(AGENT, { options: ALLOW_ONLY }, { title: 'Write file', options: ALLOW_ONLY });
  assert.deepEqual(decided, { outcome: 'selected', optionId: 'allow-with-updates' });

  const cannotReject = await adapterWith({ request: async () => 'rejected' })
    .decidePermission(AGENT, { options: ALLOW_ONLY }, { title: 'Write file', options: ALLOW_ONLY });
  assert.deepEqual(cannotReject, { outcome: 'cancelled' }, 'approved intent, no matching option: cancel rather than allow');
});

test('full access is the default posture', async () => {
  // Not an oversight: these agents run unattended, and Devin never asks at all,
  // so a stricter client-side default buys inconsistency rather than safety.
  const adapter = new AcpModelAdapter({
    connection: { ensureSession: async () => undefined },
    provider: 'acp-mock',
    label: 'Mock Agent',
    resolveSessionKey: () => 'session',
    resolveCwd: () => scratch,
  });
  assert.equal(adapter.approvalPolicy, 'allow');
  assert.equal(
    await adapter.decidePermission(AGENT, { options: BOTH }, { title: 'Write file', options: BOTH }),
    undefined,
    'the static allow answer applies, without consulting the approval seam',
  );
});

test('a non-ask policy leaves the static answer in place', async () => {
  const service = { request: async () => { throw new Error('should not be consulted'); } };
  for (const policy of ['allow', 'deny', 'cancel']) {
    const decided = await adapterWith(service, policy).decidePermission(AGENT, { options: BOTH }, { title: 'Write file', options: BOTH });
    assert.equal(decided, undefined, `"${policy}" answers statically`);
  }
});
