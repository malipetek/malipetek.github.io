/**
 * The delegation endpoint, without an agent or a harness.
 *
 * Covers the parts that are ours: authorization per session, the tool contract,
 * the exact `startActivation` spec, and how a result becomes text. DSH's own
 * activation machinery is faked here because it is DSH's to test.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDelegateEndpoint, resultText } from '../delegate.mjs';

/**
 * Start an endpoint on a loopback port.
 * @param options - `{ subagents, agentOptions, bind }`.
 * @returns the endpoint, its url, and a call helper.
 */
async function start(options = {}) {
  const calls = [];
  const subagents = options.subagents ?? {
    async startActivation(spec) {
      calls.push(spec);
      return { childId: 'child-1', result: Promise.resolve({ text: 'worker says 42' }), dispose: () => {} };
    },
  };
  const endpoint = createDelegateEndpoint({
    subagents,
    provider: options.provider ?? 'spawn',
    agentOptions: options.agentOptions,
    log: () => {},
  });
  const url = await endpoint.listen();
  const token = endpoint.tokenFor('session-1');
  if (options.bind !== false) endpoint.bind('session-1', { id: 'agent-1' });
  /** POST one JSON-RPC message. @param body - message. @param auth - bearer. */
  const call = async (body, auth = token) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth === null ? {} : { authorization: `Bearer ${auth}` }) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { endpoint, url, token, calls, call };
}

test('a call without the session token is refused', async () => {
  const { endpoint, call } = await start();
  try {
    assert.equal((await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)).status, 401);
    assert.equal((await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'wrong')).status, 401);
    // A token from another session exists but is not this one's.
    assert.equal((await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'nope')).status, 401);
  } finally {
    endpoint.close();
  }
});

test('the endpoint offers exactly one tool, and delegates with the configured worker route', async () => {
  const { endpoint, calls, call } = await start({
    agentOptions: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
  });
  try {
    const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    assert.equal(init.body.result.protocolVersion, '2025-06-18');

    const list = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.deepEqual(list.body.result.tools.map((tool) => tool.name), ['delegate']);

    const called = await call({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'delegate', arguments: { task: 'compute 6*7', label: 'math' } },
    });
    assert.equal(called.body.result.content[0].text, 'worker says 42');

    assert.equal(calls.length, 1);
    const spec = calls[0];
    assert.equal(spec.provider, 'spawn');
    assert.equal(spec.delivery, 'caller', 'the tool needs the result, not a parent notice');
    assert.equal(spec.label, 'math');
    assert.deepEqual(spec.request.prompt, [{ type: 'text', text: 'compute 6*7' }]);
    assert.equal(spec.request.parent.id, 'agent-1', 'the exact live parent agent is passed through');
    assert.deepEqual(spec.request.agentOptions, { provider: 'opencode-go', model: 'deepseek-v4.1-flash' });
  } finally {
    endpoint.close();
  }
});

test('a delegation without a live session says so instead of failing obscurely', async () => {
  const { endpoint, calls, call } = await start({ bind: false });
  try {
    const called = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'delegate', arguments: { task: 'anything' } },
    });
    assert.equal(called.body.result.isError, true);
    assert.match(called.body.result.content[0].text, /no live harness session/i);
    assert.equal(calls.length, 0, 'nothing is spawned');
  } finally {
    endpoint.close();
  }
});

test('a failing activation is reported to the agent, not thrown at the transport', async () => {
  const { endpoint, call } = await start({
    subagents: {
      async startActivation() {
        const error = new Error('subagent creation requires the exact live parent agent');
        error.name = 'SubagentError';
        throw error;
      },
    },
  });
  try {
    const called = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'delegate', arguments: { task: 'anything' } },
    });
    assert.equal(called.body.result.isError, true);
    assert.match(called.body.result.content[0].text, /delegation failed: SubagentError/);
  } finally {
    endpoint.close();
  }
});

test('a result becomes text whatever shape it arrives in', () => {
  assert.equal(resultText('plain'), 'plain');
  assert.equal(resultText({ text: 'from text' }), 'from text');
  assert.equal(resultText({ content: [{ type: 'text', text: 'a' }, { type: 'image', data: 'x' }, { type: 'text', text: 'b' }] }), 'a\nb');
  assert.equal(resultText({ message: { content: [{ type: 'text', text: 'nested' }] } }), 'nested');
  // Last resort never throws on an unexpected object.
  assert.match(resultText({ weird: true }), /weird/);
  assert.equal(resultText(null), '');
});

test('the subagent service is resolved per call, not at construction', async () => {
  // It must be: at plugin-load time the service may not be mounted yet, and a
  // load-time capture silently disabled the bridge for every turn.
  let service;
  const endpoint = createDelegateEndpoint({
    getSubagents: () => service,
    log: () => {},
  });
  const url = await endpoint.listen();
  const token = endpoint.tokenFor('session-1');
  endpoint.bind('session-1', { id: 'agent-1' });
  const call = async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'delegate', arguments: { task: 'x' } } }),
    });
    return (await response.json()).result;
  };
  try {
    const missing = await call();
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /no subagent service mounted/);

    // Mounted after construction: the same endpoint now works.
    service = {
      async startActivation() {
        return { childId: 'c', result: Promise.resolve({ text: 'late service works' }) };
      },
    };
    assert.equal((await call()).content[0].text, 'late service works');
  } finally {
    endpoint.close();
  }
});

test('a delegation that outlives its deadline says so instead of hanging', async () => {
  // It must not cancel: the work is real and may still finish. It must not block
  // either — a caller held for an hour cannot tell that from a crash.
  const endpoint = createDelegateEndpoint({
    getSubagents: () => ({
      async startActivation() {
        return { childId: 'child-slow', result: new Promise(() => {}), dispose: () => {} };
      },
    }),
    timeoutMs: 30,
    progressEveryMs: 0,
    log: () => {},
  });
  const url = await endpoint.listen();
  const token = endpoint.tokenFor('s');
  endpoint.bind('s', { id: 'agent-1' });
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'delegate', arguments: { task: 'long job' } } }),
    });
    const body = await response.text();
    assert.match(body, /still running/);
    assert.match(body, /child-slow/, 'names the child so it can be found later');
    assert.match(body, /NOT cancelled/);
  } finally {
    endpoint.close();
  }
});

test('a running delegation emits progress notifications while it works', async () => {
  const endpoint = createDelegateEndpoint({
    getSubagents: () => ({
      async startActivation() {
        return {
          childId: 'child-1',
          result: new Promise((resolve) => setTimeout(() => resolve({ text: 'finished' }), 60)),
          dispose: () => {},
        };
      },
    }),
    timeoutMs: 5_000,
    progressEveryMs: 10,
    log: () => {},
  });
  const url = await endpoint.listen();
  const token = endpoint.tokenFor('s');
  endpoint.bind('s', { id: 'agent-1' });
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'delegate', arguments: { task: 'slow job' }, _meta: { progressToken: 'tok-1' } },
      }),
    });
    const body = await response.text();
    const lines = body.trim().split('\n').map((line) => JSON.parse(line));
    const progress = lines.filter((line) => line.method === 'notifications/progress');
    assert.ok(progress.length > 0, 'at least one progress notification');
    assert.equal(progress[0].params.progressToken, 'tok-1', 'carries the caller token');
    assert.match(progress[0].params.message, /still running/);
    const last = lines[lines.length - 1];
    assert.equal(last.id, 1, 'and the call still ends with its own answer');
    assert.equal(last.result.content[0].text, 'finished');
  } finally {
    endpoint.close();
  }
});

test('two delegations run at once, not one after the other', async () => {
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { createInterface } = await import('node:readline');
  const { fileURLToPath } = await import('node:url');
  const shim = fileURLToPath(new URL('../mcp-forward.mjs', import.meta.url));

  let active = 0;
  let peak = 0;
  const server = createServer((request, response) => {
    active += 1;
    peak = Math.max(peak, active);
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const message = JSON.parse(body);
      setTimeout(() => {
        active -= 1;
        response.writeHead(200, { 'content-type': 'application/x-ndjson' });
        response.end(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'ok' }] } })}\n`);
      }, 60);
    });
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const child = spawn(process.execPath, [shim, '--url', url, '--token', 't'], { stdio: ['pipe', 'pipe', 'inherit'] });

  try {
    const call = (id, task) => child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'delegate', arguments: { task } },
    })}\n`);
    call(1, 'first');
    call(2, 'second');

    const replies = [];
    await new Promise((done) => {
      createInterface({ input: child.stdout }).on('line', (line) => {
        replies.push(JSON.parse(line));
        if (replies.length === 2) done();
      });
    });
    assert.equal(replies.length, 2, 'both calls answered');
    assert.equal(peak, 2, 'and both were in flight at the same time');
  } finally {
    child.kill('SIGTERM');
    server.close();
  }
});

test('a caller can pin the worker route, directory and depth per delegation', async () => {
  // The configured route is a default, not a cage: without this every worker was
  // whatever the profile chose, so "use a Codex worker" was impossible.
  const calls = [];
  const { endpoint, call } = await start({
    agentOptions: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
    subagents: {
      async startActivation(spec) {
        calls.push(spec);
        return { childId: 'c', result: Promise.resolve({ text: 'ok' }), dispose: () => {} };
      },
    },
  });
  try {
    await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'delegate',
        arguments: { task: 'review this', provider: 'openai-codex', model: 'gpt-6.1-sol', cwd: '/tmp/project', depth: 2 },
      },
    });
    const spec = calls[0];
    assert.deepEqual(spec.request.agentOptions, { provider: 'openai-codex', model: 'gpt-6.1-sol' });
    assert.equal(spec.request.cwd, '/tmp/project');
    assert.equal(spec.request.maxDepth, 2);

    // Omitted fields still fall back to the configured route.
    await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'delegate', arguments: { task: 'again' } } });
    assert.deepEqual(calls[1].request.agentOptions, { provider: 'opencode-go', model: 'deepseek-v4.1-flash' });
  } finally {
    endpoint.close();
  }
});
