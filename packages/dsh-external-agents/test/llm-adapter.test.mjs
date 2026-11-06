/**
 * Tests for the LLM-side half: the translation from an ACP agent's session
 * updates into the harness's stream-chunk protocol, and the provider that puts
 * an external agent into the composer's provider-grouped model picker.
 *
 * Everything runs against `test/mock-agent.mjs`, which advertises real
 * `configOptions` the way Devin does:
 *
 *   node --test test/llm-adapter.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { AcpConnection, buildEnv, selectValues, xdgEnv } from '../index.js';
import { AcpModelAdapter, chunkForUpdate, conversationSinceReply, describeMessages, finishReasonFor, matchesAny, matchesGlob, estimateUsage, newestUserText, priorConversation, promptImages, stripRuntimeContext, usageFromResult } from '../llm-adapter.js';

const here = dirname(fileURLToPath(import.meta.url));
const mock = join(here, 'mock-agent.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'dsh-external-agents-llm-'));

// Keep this run's diagnostics out of the log a real problem would be debugged from.
process.env.DSH_EXTERNAL_AGENTS_LOG = join(scratch, 'diagnostics.log');

/** A connection running the mock agent, as the plugin would build it. */
function mockConnection(overrides = {}) {
  return new AcpConnection({
    id: 'mock',
    label: 'Mock Agent',
    command: process.execPath,
    args: [mock],
    cwd: scratch,
    env: buildEnv('minimal', xdgEnv(join(scratch, 'xdg'))),
    timeoutMs: 10_000,
    ...overrides,
  });
}

/** An adapter bound to a mock connection, as `apply()` would build it. */
function mockAdapter(connection) {
  return new AcpModelAdapter({
    connection,
    provider: 'acp-mock',
    label: 'Mock Agent',
    resolveSessionKey: () => 'test-session',
    resolveCwd: () => scratch,
    // These tests are about the chunk protocol, so permissions are answered
    // statically. Permission behaviour — including the `ask` default refusing
    // when no approval seam exists — is covered in test/permission.test.mjs.
    approvalPolicy: 'allow',
  });
}

test('the newest user turn is what gets forwarded to the external agent', () => {
  assert.equal(newestUserText([
    { role: 'system', content: [{ type: 'text', text: 'system prompt' }] },
    { role: 'user', content: [{ type: 'text', text: 'first' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'a reply' }] },
    { role: 'user', content: [{ type: 'text', text: '  second  ' }] },
  ]), 'second', 'the latest human turn wins, trimmed');

  assert.equal(newestUserText([
    { role: 'system', content: [{ type: 'text', text: 'only system' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'only assistant' }] },
  ]), null, 'no user turn means nothing to send');

  assert.equal(newestUserText(undefined), null);
});

test('runtime context is never mistaken for the human turn', () => {
  // The live failure: the harness appends its runtime snapshot as a user message
  // AFTER the human's, so "the last user message" was a timestamp — and the agent
  // answered "no new instruction came through" to an ordinary question.
  const runtime = 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n'
    + 'Time sampled while preparing turn 11, step 1: 2026-10-13T08:30:58Z';
  const question = { role: 'user', content: [{ type: 'text', text: 'no i only have ios 26 in simulator' }] };

  const separate = [
    { role: 'system', content: [{ type: 'text', text: 'you are a coding agent' }] },
    { role: 'user', content: [{ type: 'text', text: 'earlier question' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'earlier answer' }] },
    question,
    { role: 'user', content: [{ type: 'text', text: runtime }] },
  ];
  assert.equal(newestUserText(separate), 'no i only have ios 26 in simulator');

  // Context appended to the human's own text, in one message.
  assert.equal(
    newestUserText([{ role: 'user', content: [{ type: 'text', text: `no i only have ios 26 in simulator\n\n${runtime}` }] }]),
    'no i only have ios 26 in simulator',
  );

  // Nothing but context: there is no instruction, so nothing is forwarded.
  assert.equal(newestUserText([{ role: 'user', content: [{ type: 'text', text: runtime }] }]), null);
  assert.equal(stripRuntimeContext(runtime), '');
  assert.equal(stripRuntimeContext('plain instruction'), 'plain instruction');
  assert.equal(stripRuntimeContext(''), '');

  // And the diagnostics line can tell the two apart, which is what makes it diagnosable.
  const described = describeMessages(separate.slice(-3));
  assert.match(described, /user="no i only have ios 26 in simulator"/);
  assert.match(described, /context="Current runtime context/);
});

test('a forked conversation is caught up once, not every turn', async () => {
  // A fork inherits a prefix of its parent's transcript, so the UI shows history
  // while a brand-new agent session has seen none of it. The first turn carries
  // it; later turns must not, or the context would be duplicated every time.
  const sent = [];
  let primed = false;
  const connection = {
    ensureSession: async () => ({ primed, sessionId: 's' }),
    selectOption: async () => undefined,
    markPrimed: () => { primed = true; },
    prompt: async (text) => {
      sent.push(text);
      return { stopReason: 'end_turn', text: 'ok', updates: [], permissions: [] };
    },
  };
  const adapter = new AcpModelAdapter({
    connection, provider: 'acp-mock', label: 'Mock', approvalPolicy: 'allow',
    resolveSessionKey: () => 'forked', resolveCwd: () => scratch,
  });
  const fork = [
    { role: 'system', content: [{ type: 'text', text: 'system prompt' }] },
    { role: 'user', content: [{ type: 'text', text: 'the parent question' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'the parent answer' }] },
    { role: 'user', content: [{ type: 'text', text: 'the forked question' }] },
  ];
  /** Drive one turn. @param messages - the harness messages. */
  async function turn(messages) {
    // eslint-disable-next-line no-unused-vars
    for await (const chunk of adapter.stream({ provider: 'acp-mock', messages })) { /* drain */ }
  }

  await turn(fork);
  assert.match(sent[0], /the parent question/, 'the inherited history is sent');
  assert.match(sent[0], /the parent answer/);
  assert.match(sent[0], /the forked question/, 'and the real turn still follows it');
  assert.ok(!sent[0].includes('system prompt'), 'the harness system prompt is not replayed');

  await turn([
    ...fork,
    { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    { role: 'user', content: [{ type: 'text', text: 'a later question' }] },
  ]);
  assert.equal(sent[1], 'a later question', 'the second turn is incremental again');
});

test('priorConversation renders history, and nothing when there is none', () => {
  const base = [
    { role: 'system', content: [{ type: 'text', text: 'system prompt' }] },
    { role: 'user', content: [{ type: 'text', text: 'first' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'reply' }] },
    { role: 'user', content: [{ type: 'text', text: 'second' }] },
  ];
  assert.equal(priorConversation(base), 'User: first\nAssistant: reply');

  // A fresh conversation has nothing to catch up on.
  assert.equal(priorConversation([base[0], base[1]]), '');
  assert.equal(priorConversation([]), '');
  assert.equal(priorConversation(undefined), '');

  // Runtime context is not history.
  assert.equal(priorConversation([
    base[0],
    { role: 'user', content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes earlier ones.' }] },
    base[3],
  ]), '');

  // Long history keeps BOTH ends: the beginning holds what was asked for and
  // decided, the end holds where things stand. A tail-only cut handed a successor
  // the last two turns of a 342-turn conversation.
  const long = [
    base[0],
    { role: 'user', content: [{ type: 'text', text: 'A'.repeat(500) }] },
    { role: 'assistant', content: [{ type: 'text', text: 'B'.repeat(500) }] },
    { role: 'user', content: [{ type: 'text', text: 'C'.repeat(500) }] },
    base[3],
  ];
  const bounded = priorConversation(long, 200);
  assert.ok(bounded.length < 260, 'the budget is honoured');
  assert.match(bounded, /A+/, 'the beginning survives');
  assert.match(bounded, /C+/, 'and so does the end');
  assert.match(bounded, /earlier history omitted/);
});

test('turns another agent answered are caught up when the conversation returns', () => {
  // Alternating providers: each agent's ACP session only knows the turns it
  // answered, so returning to one leaves a hole where the other worked.
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'start' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'mine' }] },
    { role: 'user', content: [{ type: 'text', text: 'claude question' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'claude answer' }] },
    { role: 'user', content: [{ type: 'text', text: 'new request' }] },
  ];
  assert.equal(
    conversationSinceReply(messages, 'mine'),
    'User: claude question\nAssistant: claude answer',
    'only the turns that happened while this agent was swapped out',
  );

  // Our own reply is the message immediately before the new turn: nothing missed.
  assert.equal(conversationSinceReply([messages[0], messages[1], messages[4]], 'mine'), '');

  // The anchor is gone (compaction, restart): say so, so the caller sends everything.
  assert.equal(conversationSinceReply(messages, 'a reply that is not there'), undefined);
  assert.equal(conversationSinceReply(messages, ''), undefined);
  assert.equal(conversationSinceReply([messages[4]], 'mine'), '');
});

test('a returning provider is told what it missed, not the whole history again', async () => {
  const sent = [];
  const connection = {
    ensureSession: async () => ({ primed: true, sessionId: 's' }),
    selectOption: async () => undefined,
    markPrimed: () => undefined,
    prompt: async (text) => {
      sent.push(text);
      return { stopReason: 'end_turn', text: 'my reply', updates: [], permissions: [] };
    },
  };
  const adapter = new AcpModelAdapter({
    connection, provider: 'acp-devin', label: 'Devin', approvalPolicy: 'allow',
    resolveSessionKey: () => 'alternating', resolveCwd: () => scratch,
  });
  /** Drive one turn. @param messages - the harness messages. */
  async function turn(messages) {
    // eslint-disable-next-line no-unused-vars
    for await (const chunk of adapter.stream({ provider: 'acp-devin', messages })) { /* drain */ }
  }

  await turn([{ role: 'user', content: [{ type: 'text', text: 'first' }] }]);
  assert.equal(sent[0], 'first', 'no history yet, so nothing is prepended');

  // While this provider was swapped out, another agent answered.
  await turn([
    { role: 'user', content: [{ type: 'text', text: 'first' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'my reply' }] },
    { role: 'user', content: [{ type: 'text', text: 'claude question' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'claude answer' }] },
    { role: 'user', content: [{ type: 'text', text: 'second' }] },
  ]);
  assert.match(sent[1], /another agent handled the turns below/);
  assert.match(sent[1], /claude question/);
  assert.match(sent[1], /claude answer/);
  assert.ok(!sent[1].includes('first\n'), 'the turns this agent already answered are not replayed');

  // Straight back to this agent: incremental again.
  await turn([
    { role: 'user', content: [{ type: 'text', text: 'first' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'my reply' }] },
    { role: 'user', content: [{ type: 'text', text: 'claude question' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'claude answer' }] },
    { role: 'user', content: [{ type: 'text', text: 'second' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'my reply' }] },
    { role: 'user', content: [{ type: 'text', text: 'third' }] },
  ]);
  assert.equal(sent[2], 'third');
});

test('usage is estimated rather than reported as zero', () => {
  // ACP carries no token accounting. Reporting zeros told the harness nothing had
  // accumulated, so compaction had nothing to act on and the transcript grew
  // unbounded — worse than an estimate that is merely rough.
  const messages = [
    { role: 'system', content: [{ type: 'text', text: 'x'.repeat(400) }] },
    { role: 'user', content: [{ type: 'text', text: 'y'.repeat(400) }] },
  ];
  const usage = estimateUsage(messages, 400);
  assert.equal(usage.inputTokens, 200, '800 characters of request, four per token');
  assert.equal(usage.outputTokens, 100);
  assert.equal(usage.totalTokens, 300);
  assert.equal(estimateUsage([], 0).totalTokens, 0);
  assert.equal(estimateUsage(undefined, undefined).totalTokens, 0);
});

test('reported usage replaces the estimate, cache reads included', async () => {
  // opencode answers with the provider's own accounting, which is the only source
  // of a cache-hit rate. Ignoring it made every turn read as "0% cache hit".
  assert.deepEqual(
    usageFromResult({ usage: { inputTokens: 17766, outputTokens: 2, totalTokens: 18024, cachedReadTokens: 256 } }),
    { inputTokens: 17766, outputTokens: 2, totalTokens: 18024, cacheReadTokens: 256 },
  );
  // Written cache is carried when the agent reports it.
  assert.equal(
    usageFromResult({ usage: { inputTokens: 1, outputTokens: 1, cachedWriteTokens: 9 } }).cacheWriteTokens,
    9,
  );
  // Nothing usable: fall back to the estimate rather than reporting zeros.
  assert.equal(usageFromResult({}), null);
  assert.equal(usageFromResult({ usage: { inputTokens: 'x' } }), null);
  assert.equal(usageFromResult(undefined), null);

  const chunks = [];
  const connection = {
    ensureSession: async () => ({ primed: true, sessionId: 's' }),
    selectOption: async () => undefined,
    markPrimed: () => undefined,
    prompt: async () => ({
      stopReason: 'end_turn',
      text: 'ok',
      updates: [],
      permissions: [],
      usage: { inputTokens: 500, outputTokens: 40, totalTokens: 540, cachedReadTokens: 400 },
    }),
  };
  const adapter = new AcpModelAdapter({
    connection, provider: 'acp-opencode', label: 'opencode', approvalPolicy: 'allow',
    resolveSessionKey: () => 'usage', resolveCwd: () => scratch,
  });
  for await (const chunk of adapter.stream({
    provider: 'acp-opencode',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
  })) {
    chunks.push(chunk);
  }
  const usage = chunks.find((chunk) => chunk.type === 'usage');
  assert.deepEqual(usage.usage, { inputTokens: 500, outputTokens: 40, totalTokens: 540, cacheReadTokens: 400 });
});

test('standing instructions are sent once, at the start of a session', async () => {
  // The workflow rule that stops an agent ending its turn with "I'll let you know
  // when it's done" — and then having nowhere to say it. Sent once, because the
  // agent's session is its own history and repeating it would cost tokens for
  // nothing.
  const sent = [];
  // The session is one durable record, as the real connection returns it; a fresh
  // object per call would forget that the instructions were already sent.
  const session = { primed: false, sessionId: 's' };
  const connection = {
    ensureSession: async () => session,
    selectOption: async () => undefined,
    markPrimed: () => { session.primed = true; },
    prompt: async (text) => {
      sent.push(text);
      return { stopReason: 'end_turn', text: 'ok', updates: [], permissions: [] };
    },
  };
  const adapter = new AcpModelAdapter({
    connection, provider: 'acp-mock', label: 'Mock', approvalPolicy: 'allow',
    resolveSessionKey: () => 'k', resolveCwd: () => scratch,
    instructions: 'Do not end your turn promising to report later.',
  });
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'do it' }] }];
  // eslint-disable-next-line no-unused-vars
  for await (const chunk of adapter.stream({ provider: 'acp-mock', messages })) { /* drain */ }
  assert.match(sent[0], /Do not end your turn promising/, 'the rule reached the agent');
  assert.match(sent[0], /do it/, 'without displacing the request');

  // eslint-disable-next-line no-unused-vars
  for await (const chunk of adapter.stream({ provider: 'acp-mock', messages: [
    ...messages,
    { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    { role: 'user', content: [{ type: 'text', text: 'again' }] },
  ] })) { /* drain */ }
  assert.equal(sent[1], 'again', 'and is not repeated every turn');

  // An edited instruction reaches a conversation that already started, which is
  // what makes changing the delegation rule take effect without a new chat.
  adapter.instructions = 'Use the delegate tool for subagent work.';
  // eslint-disable-next-line no-unused-vars
  for await (const chunk of adapter.stream({ provider: 'acp-mock', messages: [
    ...messages,
    { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    { role: 'user', content: [{ type: 'text', text: 'third' }] },
  ] })) { /* drain */ }
  assert.match(sent[2], /delegate tool/, 'a changed instruction is sent again');
  assert.match(sent[2], /third/);
});

test('block indexes follow first-seen order, so a thinking agent still renders', async () => {
  // Claude thinks before it answers, so reasoning is block 0 and the answer is
  // block 1. The old fixed text=0 / reasoning=1 pair produced the reverse and a
  // message assembled from out-of-order blocks can render as nothing.
  const chunks = [];
  const connection = {
    ensureSession: async () => ({ primed: true }),
    selectOption: async () => undefined,
    markPrimed: () => {},
    prompt: async (text, opts) => {
      opts.onUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } });
      opts.onUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer' } });
      return { stopReason: 'end_turn', text: 'answer', updates: [], permissions: [] };
    },
  };
  const adapter = new AcpModelAdapter({
    connection, provider: 'acp-mock', label: 'Mock', approvalPolicy: 'allow',
    resolveSessionKey: () => 'k', resolveCwd: () => scratch,
  });
  // eslint-disable-next-line no-unused-vars
  for await (const chunk of adapter.stream({ provider: 'acp-mock', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })) chunks.push(chunk);

  assert.equal(chunks.find((chunk) => chunk.type === 'reasoning-delta').index, 0, 'the first block seen is 0');
  assert.equal(chunks.find((chunk) => chunk.type === 'text-delta').index, 1, 'the answer follows it');
  assert.equal(chunks.at(-1).reason.kind, 'stop');
});

test('a turn with no visible text is an error, not a silent Completed', async () => {
  // This route has no tools of its own, so a turn that emitted no text did
  // nothing visible. Calling that `stop` is what produced "it replied but I never
  // saw it"; an error at least says so.
  const chunks = [];
  const connection = {
    ensureSession: async () => ({ primed: true }),
    selectOption: async () => undefined,
    markPrimed: () => {},
    prompt: async () => ({ stopReason: 'end_turn', text: '', updates: [], permissions: [] }),
  };
  const adapter = new AcpModelAdapter({
    connection, provider: 'acp-mock', label: 'Mock', approvalPolicy: 'allow',
    resolveSessionKey: () => 'k', resolveCwd: () => scratch,
  });
  // eslint-disable-next-line no-unused-vars
  for await (const chunk of adapter.stream({ provider: 'acp-mock', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })) chunks.push(chunk);

  const finish = chunks.at(-1);
  assert.equal(finish.type, 'finish');
  assert.equal(finish.reason.kind, 'error');
  assert.equal(finish.reason.failure.code, 'EMPTY_TURN');
  assert.match(finish.reason.failure.message, /without sending any visible text/);
});

test('only text and reasoning are projected, never tool calls', () => {
  assert.deepEqual(
    chunkForUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } }),
    { type: 'text-delta', index: 0, text: 'hi' },
  );
  // The caller allocates the index, per block kind, in first-seen order.
  assert.deepEqual(
    chunkForUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } }, 3),
    { type: 'reasoning-delta', index: 3, text: 'hmm' },
  );
  // Tool activity is shown, but as *reasoning* — never as a `tool-call` chunk,
  // which would make this harness run a tool the other agent already ran.
  const tool = chunkForUpdate({ sessionUpdate: 'tool_call', title: 'Write file', status: 'pending' });
  assert.equal(tool.type, 'reasoning-delta', 'visible in the thinking channel');
  assert.match(tool.text, /Write file/);
  assert.notEqual(tool.type, 'tool-call-delta', 'a tool-call chunk would be executed here');
  // Interim tool states would flood the log; only a settled one earns a line.
  assert.equal(chunkForUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'in_progress' }), null);
  assert.match(
    chunkForUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'failed' }).text,
    /failed/,
  );
  assert.equal(chunkForUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '' } }), null);
  assert.equal(chunkForUpdate(null), null);
});

test('images on a turn become ACP image blocks, and the route advertises image input', async () => {
  const attachment = { attachmentId: 'sha256:abc', mediaType: 'image/png' };
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: 'what does this screenshot show?' },
      { type: 'image', attachment },
    ],
  }];

  // A durable reference goes in; base64 plus a mime type comes out.
  assert.deepEqual(
    promptImages(messages, (ref) => ({ data: 'aGVsbG8=', mimeType: ref.mediaType })),
    [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
  );
  // A reference that cannot be resolved is dropped, never sent empty.
  assert.deepEqual(promptImages(messages, () => undefined), []);
  assert.deepEqual(promptImages(messages, () => { throw new Error('gone'); }), []);
  assert.deepEqual(promptImages(messages, undefined), []);
  // The cap keeps a pasted folder from flooding the agent.
  const many = [{ role: 'user', content: Array.from({ length: 12 }, () => ({ type: 'image', attachment })) }];
  assert.equal(promptImages(many, (ref) => ({ data: 'aGVsbG8=', mimeType: ref.mediaType })).length, 8);

  let captured;
  const connection = {
    ensureSession: async () => ({ primed: true, sessionId: 's' }),
    selectOption: async () => undefined,
    markPrimed: () => undefined,
    // `resolveModel` asks the connection for the agent's own display name.
    modelName: () => null,
    prompt: async (text, options) => {
      captured = options.blocks;
      return { stopReason: 'end_turn', text: 'a cat', updates: [], permissions: [] };
    },
  };
  const adapter = new AcpModelAdapter({
    connection, provider: 'acp-devin', label: 'Devin', approvalPolicy: 'allow',
    resolveSessionKey: () => 'img', resolveCwd: () => scratch,
    resolveImage: (ref) => ({ data: 'aGVsbG8=', mimeType: ref.mediaType }),
  });
  // eslint-disable-next-line no-unused-vars
  for await (const chunk of adapter.stream({ provider: 'acp-devin', messages })) { /* drain */ }

  assert.equal(captured[0].type, 'text', 'the text still leads');
  assert.deepEqual(captured[1], { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' });
  assert.deepEqual((await adapter.resolveModel('acp-devin', 'swe-2-high')).inputModalities, ['image']);

  // Without a resolver the route must not claim image input, or the harness would
  // route images here and they would arrive unusable.
  const textOnly = new AcpModelAdapter({
    connection, provider: 'acp-devin', label: 'Devin', approvalPolicy: 'allow',
    resolveSessionKey: () => 'img', resolveCwd: () => scratch,
  });
  assert.equal((await textOnly.resolveModel('acp-devin', 'swe-2-high')).inputModalities, undefined);
});

test('a retried turn is not caught up twice', async () => {
  // The harness retries a failed model request with the same request id and the
  // same messages. Priming on that retry re-sends history the attempt already
  // delivered, and the agent reads it as the user repeating themselves — the
  // exact complaint that produced this test.
  const sent = [];
  let primed = false;
  const connection = {
    ensureSession: async () => ({ primed, sessionId: 's' }),
    selectOption: async () => undefined,
    markPrimed: () => { primed = true; },
    prompt: async (text) => {
      sent.push(text);
      // The reply must be the text the harness would store as the newest
      // assistant turn, or the next turn cannot anchor on it.
      return { stopReason: 'end_turn', text: 'earlier answer', updates: [], permissions: [] };
    },
  };
  const adapter = new AcpModelAdapter({
    connection, provider: 'acp-opencode', label: 'opencode', approvalPolicy: 'allow',
    resolveSessionKey: () => 'retry', resolveCwd: () => scratch,
  });
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'start' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'earlier answer' }] },
    { role: 'user', content: [{ type: 'text', text: 'go' }] },
  ];
  /** One attempt. @param id - the harness request id. */
  async function attempt(id) {
    // eslint-disable-next-line no-unused-vars
    for await (const chunk of adapter.stream({ provider: 'acp-opencode', requestId: id, messages })) { /* drain */ }
  }

  await attempt('req-1');
  assert.match(sent[0], /User: start/, 'the first attempt carries the history');

  await attempt('req-1');
  assert.equal(sent[1], 'go', 'the retry of the same turn does not repeat it');

  // A later turn with a new id is incremental again: our own reply is the newest
  // assistant message, so there is nothing to catch up on.
  await attempt('req-2');
  assert.equal(sent[2], 'go');
});

test('ACP stop reasons map onto the harness finish reasons', () => {
  assert.deepEqual(finishReasonFor('end_turn'), { kind: 'stop' });
  assert.deepEqual(finishReasonFor('max_tokens'), { kind: 'max-tokens' });
  assert.equal(finishReasonFor('cancelled').kind, 'aborted');
  assert.equal(finishReasonFor('refusal').kind, 'error');
  assert.equal(finishReasonFor(undefined, true).kind, 'aborted', 'an abort outranks the stop reason');
});

test('select values flatten across flat and grouped ACP shapes', () => {
  assert.deepEqual(
    selectValues({ type: 'select', options: [{ value: 'a', name: 'A' }] }),
    [{ value: 'a', name: 'A', description: undefined }],
  );
  assert.deepEqual(
    selectValues({ type: 'select', options: [{ group: 'g', name: 'G', options: [{ value: 'b', name: 'B' }] }] }),
    [{ value: 'b', name: 'B', description: undefined }],
  );
  assert.deepEqual(selectValues({ type: 'boolean', currentValue: true }), []);
  assert.deepEqual(selectValues(undefined), []);
});

/**
 * The harness's own catalogue rule, copied from
 * `LlmRuntime.listModels()` in `@deepseek-ai/dsh-llm`: one bad row rejects the
 * whole provider with INVALID_CATALOG, which is exactly what an incomplete
 * entry caused in the picker.
 *
 * @param provider - the route being validated.
 * @param models - what the adapter returned.
 * @returns nothing; throws on the first violation.
 */
function assertCatalogueValid(provider, models) {
  const seen = new Set();
  for (const model of models) {
    assert.equal(typeof model.provider, 'string', 'every entry declares its provider');
    assert.equal(model.provider, provider, 'and it equals the route being listed');
    assert.ok(typeof model.id === 'string' && model.id.length > 0, 'id is a non-empty string');
    assert.ok(typeof model.name === 'string' && model.name.length > 0, 'name is a non-empty string');
    assert.ok(model.description === undefined || typeof model.description === 'string', 'description is a string when present');
    assert.ok(!seen.has(model.id), `id "${model.id}" is unique`);
    seen.add(model.id);
  }
}

test('the catalogue the adapter returns satisfies the harness validator', async () => {
  const connection = mockConnection();
  const adapter = mockAdapter(connection);
  try {
    const models = await adapter.listModels('acp-mock');
    assertCatalogueValid('acp-mock', models);
  } finally {
    connection.dispose();
  }
});

test('a badly behaved agent cannot take its group down', async () => {
  const connection = mockConnection({
    env: buildEnv('minimal', { ...xdgEnv(join(scratch, 'xdg')), MOCK_NOISY_CATALOGUE: '1' }),
  });
  const adapter = mockAdapter(connection);
  try {
    const models = await adapter.listModels('acp-mock');
    // The repeated value and the unnameable entries are dropped, not forwarded.
    assert.deepEqual(models.map((model) => model.id), ['mock-fast', 'mock-smart']);
    assertCatalogueValid('acp-mock', models);
  } finally {
    connection.dispose();
  }
});

test('the agent\u2019s own models come from ACP, so the picker shows what it really offers', async () => {
  const connection = mockConnection();
  const adapter = mockAdapter(connection);
  try {
    const models = await adapter.listModels('acp-mock');
    assert.deepEqual(models.map((model) => model.id), ['mock-fast', 'mock-smart']);
    assert.equal(models[1].name, 'Mock Smart');
    assert.equal(models[1].description, 'slower, better');
  } finally {
    connection.dispose();
  }
});

test('a curated list is authoritative and does not start the agent', async () => {
  // The command does not exist: if anything tried to spawn it, this would throw.
  const connection = mockConnection({ command: 'definitely-not-installed-xyz' });
  const adapter = new AcpModelAdapter({
    connection,
    provider: 'acp-mock',
    label: 'Mock Agent',
    resolveSessionKey: () => 'test-session',
    resolveCwd: () => scratch,
    models: [
      'adaptive',
      { id: 'claude-opus-5-5-medium', name: 'Claude Opus 5.5' },
      { id: 'gpt-6-astra-medium' },
      { id: 'adaptive', name: 'duplicate, dropped' },
      { id: '', name: 'empty id, dropped' },
      { id: 'nameless', name: '' },
    ],
  });
  try {
    const models = await adapter.listModels('acp-mock');
    assert.deepEqual(
      models.map((model) => model.id),
      ['adaptive', 'claude-opus-5-5-medium', 'gpt-6-astra-medium', 'nameless'],
      'repeats and empty ids are dropped; a missing name falls back to the id',
    );
    assert.equal(models[0].name, 'adaptive', 'a bare id is its own name');
    assert.equal(models[1].name, 'Claude Opus 5.5');
    assert.equal(models[2].name, 'gpt-6-astra-medium', 'a missing name falls back to the id');
    assert.equal(models[3].name, 'nameless', 'as does an empty one');
    assertCatalogueValid('acp-mock', models);
    assert.equal(connection.child, null, 'no process was started');
  } finally {
    connection.dispose();
  }
});

test('include and exclude globs trim what the agent advertises', async () => {
  const connection = mockConnection();
  const build = (options) => new AcpModelAdapter({
    connection,
    provider: 'acp-mock',
    label: 'Mock Agent',
    resolveSessionKey: () => 'test-session',
    resolveCwd: () => scratch,
    ...options,
  });
  try {
    assert.deepEqual((await build({ modelExclude: ['mock-smart'] }).listModels('acp-mock')).map((m) => m.id), ['mock-fast']);
    assert.deepEqual((await build({ modelInclude: ['mock-s*'] }).listModels('acp-mock')).map((m) => m.id), ['mock-smart']);
    assert.deepEqual((await build({ modelInclude: ['mock-*'], modelExclude: ['*-fast'] }).listModels('acp-mock')).map((m) => m.id), ['mock-smart']);
    assert.deepEqual((await build({}).listModels('acp-mock')).map((m) => m.id), ['mock-fast', 'mock-smart'], 'no globs means no filtering');
  } finally {
    connection.dispose();
  }
});

test('globs are anchored, case-insensitive and literal elsewhere', () => {
  assert.equal(matchesGlob('swe-*', 'swe-2-high'), true);
  assert.equal(matchesGlob('SWE-*', 'swe-2-high'), true, 'case-insensitive');
  assert.equal(matchesGlob('swe-?', 'swe-2'), true);
  assert.equal(matchesGlob('swe-*', 'not-swe-2'), false, 'anchored at the start');
  assert.equal(matchesGlob('*fast*', 'the-fast-one'), true);
  assert.equal(matchesGlob('fusion-*', 'fusion-claude-opus-5-5-high-x'), true);
  assert.equal(matchesGlob('a.b', 'axb'), false, 'a dot is literal');
  assert.equal(matchesGlob('', 'anything'), false);
  assert.equal(matchesAny(['fusion-*', 'MODEL_*'], 'MODEL_PRIVATE_11'), true);
  assert.equal(matchesAny(['fusion-*', 'MODEL_*'], 'claude-opus-5-5-medium'), false);
  assert.equal(matchesAny([], 'anything'), false);
});

test('an unadvertised model is never sent to the agent', async () => {
  const connection = mockConnection();
  try {
    await connection.ensureSession(scratch, 'guard');
    assert.equal(connection.option('guard', 'model').currentValue, 'mock-fast');
    const result = await connection.selectOption('guard', 'model', 'not-a-real-model');
    assert.equal(result, undefined, 'nothing is returned for a value the agent does not offer');
    assert.equal(connection.option('guard', 'model').currentValue, 'mock-fast', 'and the agent keeps its own choice');
    const accepted = await connection.selectOption('guard', 'model', 'mock-smart');
    assert.equal(accepted.currentValue, 'mock-smart');
  } finally {
    connection.dispose();
  }
});

test('prepareCall binds the model and hands back a stream entry point', async () => {
  const connection = mockConnection();
  const adapter = mockAdapter(connection);
  try {
    const prepared = await adapter.prepareCall('acp-mock', 'mock-fast');
    assert.equal(prepared.model.provider, 'acp-mock');
    assert.equal(prepared.model.id, 'mock-fast');
    assert.equal(typeof prepared.stream, 'function');
    assert.equal(adapter.providerInfo('acp-mock').name, 'Mock Agent', 'the picker groups under the agent name');
    assert.equal(adapter.imageRequestPricing(), undefined);
  } finally {
    connection.dispose();
  }
});

test('one turn streams the agent\u2019s text as chunks and ends with exactly one finish', async () => {
  const connection = mockConnection();
  const adapter = mockAdapter(connection);
  try {
    const chunks = [];
    for await (const chunk of adapter.stream({
      provider: 'acp-mock',
      model: 'mock-smart',
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'you are a coding agent' }] },
        { role: 'user', content: [{ type: 'text', text: 'do the thing' }] },
      ],
    })) {
      chunks.push(chunk);
    }

    const text = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('');
    assert.equal(text, 'Hello world [allow-once]');
    assert.ok(chunks.some((chunk) => chunk.type === 'reasoning-delta'), 'thoughts reach the harness as reasoning');
    assert.ok(!chunks.some((chunk) => chunk.type === 'tool-call-delta'), 'the agent\u2019s tools are never offered to this harness');

    const finishes = chunks.filter((chunk) => chunk.type === 'finish');
    assert.equal(finishes.length, 1, 'a stream ends with exactly one terminal finish chunk');
    assert.deepEqual(finishes[0].reason, { kind: 'stop' });
    assert.equal(chunks.at(-1).type, 'finish', 'and it is last');
    assert.ok(chunks.some((chunk) => chunk.type === 'usage'));

    // The picker's choice is written back to the agent over ACP.
    assert.equal(connection.option('test-session', 'model').currentValue, 'mock-smart');
  } finally {
    connection.dispose();
  }
});

test('an unresponsive agent cannot stall the picker', async () => {
  const connection = mockConnection({
    env: buildEnv('minimal', { ...xdgEnv(join(scratch, 'xdg')), MOCK_HANG_SESSION_NEW: '1' }),
    catalogueTimeoutMs: 400,
  });
  const adapter = mockAdapter(connection);
  try {
    const started = Date.now();
    const models = await adapter.listModels('acp-mock');
    const elapsed = Date.now() - started;
    assert.deepEqual(models, [], 'an agent that never answers contributes an empty group');
    assert.ok(elapsed < 5_000, `the catalogue read is bounded, took ${elapsed}ms`);
  } finally {
    connection.dispose();
  }
});

test('a request with no user turn finishes immediately without prompting', async () => {
  const connection = mockConnection();
  const adapter = mockAdapter(connection);
  try {
    const chunks = [];
    for await (const chunk of adapter.stream({ provider: 'acp-mock', model: 'mock-fast', messages: [] })) {
      chunks.push(chunk);
    }
    assert.deepEqual(chunks, [{ type: 'finish', reason: { kind: 'stop' } }]);
    assert.equal(connection.child, null, 'no agent process is started for an empty request');
  } finally {
    connection.dispose();
  }
});

test('a failing agent becomes a terminal error chunk, not a thrown harness error', async () => {
  const connection = mockConnection();
  const adapter = mockAdapter(connection);
  try {
    const chunks = [];
    for await (const chunk of adapter.stream({
      provider: 'acp-mock',
      model: 'mock-fast',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'TIME_OUT please' }] }],
      signal: AbortSignal.timeout(400),
    })) {
      chunks.push(chunk);
    }
    const finish = chunks.at(-1);
    assert.equal(finish.type, 'finish');
    assert.equal(finish.reason.kind, 'aborted', 'a cancelled turn reports as aborted');
  } finally {
    connection.dispose();
  }
});
