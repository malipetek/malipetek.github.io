#!/usr/bin/env node
/**
 * A minimal ACP agent, used to test the client without spending a real
 * provider's credits. It implements just enough of the protocol to exercise
 * every path the client cares about: the handshake, a session, streamed
 * message and thought chunks, a tool call, a `session/request_permission`
 * round trip, and a prompt that never settles so a timeout can be observed.
 *
 * A prompt beginning with `TIME_OUT` is deliberately left unanswered.
 */

let buffer = '';
let permissionWaiter = null;

/** The mock's own configuration options, in the shape a real ACP agent sends. */
const configOptions = () => [
  {
    id: 'mode',
    name: 'Session Mode',
    category: 'mode',
    type: 'select',
    currentValue: 'code',
    options: [
      { value: 'code', name: 'Code' },
      { value: 'ask', name: 'Ask' },
    ],
  },
  {
    id: 'thought_level',
    name: 'Thinking',
    category: 'thought_level',
    type: 'select',
    currentValue: 'default',
    options: [
      { value: 'default', name: 'Default' },
      { value: 'high', name: 'High' },
    ],
  },
  {
    id: 'model',
    name: 'Model',
    description: 'AI model to use',
    category: 'model',
    type: 'select',
    currentValue: 'mock-fast',
    options: [
      { value: 'mock-fast', name: 'Mock Fast' },
      { value: 'mock-smart', name: 'Mock Smart', description: 'slower, better' },
      // A misbehaving agent: a repeated value and two unusable entries. Any of
      // these reaching the harness unfiltered rejects the entire provider group
      // with INVALID_CATALOG, so the adapter is expected to drop them.
      ...(process.env.MOCK_NOISY_CATALOGUE === '1' ? [
        { value: 'mock-fast', name: 'Mock Fast (duplicate)' },
        { value: '', name: 'No value' },
        { value: 'mock-nameless', name: '' },
        { value: 'mock-nonstring', name: 42 },
      ] : []),
    ],
  },
];

let selectedModel = 'mock-fast';
/** How many sessions this mock has minted, so each `session/new` gets a new id. */
let sessionCount = 0;

/** Write one JSON-RPC frame. */
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/** Emit one `session/update` notification. */
function update(sessionId, payload) {
  send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: payload } });
}

/** Drive one prompt turn to completion. */
async function runTurn(message) {
  const sessionId = message.params.sessionId;
  const text = (message.params.prompt ?? []).map((part) => part.text ?? '').join('');
  if (text.startsWith('TIME_OUT')) return;

  // The turn ends, and *then* the agent speaks — "I'll let you know when it's
  // done", said and meant. A real agent does this from a background task.
  if (text.startsWith('LATE')) {
    send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } });
    setTimeout(() => {
      update(sessionId, {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'the task finished while you were away' },
      });
    }, 150);
    return;
  }

  // A slow turn that keeps making progress. The idle timer must follow the
  // activity: measuring elapsed time instead would kill this mid-task.
  if (text.startsWith('SLOW')) {
    for (let tick = 0; tick < 8; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: `tick ${tick} ` } });
    }
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'SLOW-DONE' } });
    send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } });
    return;
  }

  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } });
  update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'considering' } });

  const decision = await new Promise((resolve) => {
    permissionWaiter = resolve;
    send({
      jsonrpc: '2.0',
      id: 9001,
      method: 'session/request_permission',
      params: {
        sessionId,
        toolCall: { toolCallId: 't1', title: 'Write file' },
        // `MOCK_ALLOW_ONLY=1` offers no way to refuse — the shape that made a
        // "deny" policy silently allow, because a fallback to `options[0]` had
        // no safe answer to fall back to.
        options: process.env.MOCK_ALLOW_ONLY === '1'
          ? [{ optionId: 'allow-with-updates', name: 'Allow with updates', kind: 'allow_once' }]
          : [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
          ],
      },
    });
  });

  const optionId = decision?.outcome?.optionId ?? 'none';
  update(sessionId, {
    sessionUpdate: 'tool_call',
    toolCallId: 't1',
    title: 'Write file',
    status: optionId === 'allow-once' ? 'completed' : 'failed',
  });
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `world [${optionId}]` } });
  send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } });
}

/** Route one decoded frame. */
function handle(message) {
  if (message.id !== undefined && message.method === undefined) {
    const waiter = permissionWaiter;
    permissionWaiter = null;
    waiter?.(message.result);
    return;
  }
  switch (message.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: 1,
          // `loadSession` is what makes `session/load` legal; the capabilities
          // live under `agentCapabilities`, which is easy to read wrongly.
          agentCapabilities: process.env.MOCK_NO_RESUME === '1'
            ? {}
            : { loadSession: true, sessionCapabilities: { list: {} } },
        },
      });
      return;
    case 'session/load':
    case 'session/resume':
      // Adopt the named session and answer with it, the way a real agent does.
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: { sessionId: message.params.sessionId, configOptions: configOptions() },
      });
      return;
    case 'session/new': {
      // A deliberately unresponsive agent, to prove a picker cannot stall on one.
      if (process.env.MOCK_HANG_SESSION_NEW === '1') return;
      // Real agents mint a fresh id per session; a mock that reuses one would
      // hide the difference between reusing a session and replacing it.
      sessionCount += 1;
      const minted = sessionCount === 1 ? 'mock-session' : `mock-session-${sessionCount}`;
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          sessionId: minted,
          modes: { currentModeId: 'code', availableModes: [{ id: 'code', name: 'Code' }] },
          configOptions: configOptions(),
        },
      });
      return;
    }
    case 'session/set_config_option': {
      if (message.params.configId === 'model') selectedModel = message.params.value;
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          // Any selector, not just the model: a mock that only honoured `model`
          // would hide a client that failed to apply the others.
          configOptions: configOptions().map((option) => (
            option.id === message.params.configId ? { ...option, currentValue: message.params.value } : option
          )),
        },
      });
      return;
    }
    case 'session/close':
      send({ jsonrpc: '2.0', id: message.id, result: {} });
      return;
    case 'session/prompt':
      void runTurn(message);
      return;
    case 'session/cancel':
      return;
    default:
      if (message.id !== undefined) {
        send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `unsupported: ${message.method}` } });
      }
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line.length === 0) continue;
    try {
      handle(JSON.parse(line));
    } catch {
      // Ignore malformed frames; the client never sends any.
    }
  }
});
