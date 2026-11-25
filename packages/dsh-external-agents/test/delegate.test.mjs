/**
 * The delegation endpoint, without an agent or a harness.
 *
 * Covers the parts that are ours: authorization per session, the tool contract,
 * the exact `startActivation` spec, and how a result becomes text. DSH's own
 * activation machinery is faked here because it is DSH's to test.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDelegateEndpoint, resultText } from '../delegate.mjs';
import { QuotaLedger, REPORT_CONTRACT, aliasesOf, findProject } from '../superagent.mjs';

/** The task text a worker received, without the injected context and contract. */
const taskOf = (spec) => spec.prompt[0].text.replace(`\n\n${REPORT_CONTRACT}`, '');

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
  const contextDir = options.contextDir ?? mkdtempSync(join(tmpdir(), 'dsh-ctx-'));
  const endpoint = createDelegateEndpoint({
    subagents,
    provider: options.provider ?? 'spawn',
    agentOptions: options.agentOptions,
    contextDir,
    ledger: new QuotaLedger(),
    sleep: async () => {},
    ...(options.extra ?? {}),
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
  return { endpoint, url, token, calls, call, contextDir };
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

test('the endpoint offers delegate plus the context tools, and delegates with the configured worker route', async () => {
  const { endpoint, calls, call } = await start({
    agentOptions: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
  });
  try {
    const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    assert.equal(init.body.result.protocolVersion, '2025-06-18');

    const list = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.deepEqual(list.body.result.tools.map((tool) => tool.name), ['delegate', 'project_context', 'remember']);

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
    assert.equal(taskOf(spec.request), 'compute 6*7');
    assert.match(spec.request.prompt[0].text, /STATUS: done/, 'the worker is told how to finish');
    assert.equal(spec.request.maxDepth, 1, 'workers cannot delegate again by default');
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
    assert.match(called.body.result.content[0].text, /SubagentError: subagent creation requires/);
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

test('a caller can pin the worker route and directory, but not deepen nesting', async () => {
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
    assert.equal(spec.request.maxDepth, 1, 'a caller-asked depth does not lift the cap');

    // Omitted fields still fall back to the configured route.
    await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'delegate', arguments: { task: 'again' } } });
    assert.deepEqual(calls[1].request.agentOptions, { provider: 'opencode-go', model: 'deepseek-v4.1-flash' });
  } finally {
    endpoint.close();
  }
});

test('the spec carries the 0.2.2 top level, where DSH reads the parent', async () => {
  // DSH 0.2.2 flattened `SubagentActivationSpec.request` into the spec itself:
  // `startActivation` reads `spec.parent.id`, `spec.prompt` and `spec.maxDepth`
  // from the top level. A nested-only spec made every delegation fail with
  // "Cannot read properties of undefined (reading 'id')", so the mock below is
  // the 0.2.2 read: a regression fails here instead of in a user's session.
  const calls = [];
  const { endpoint, call } = await start({
    subagents: {
      async startActivation(spec) {
        if (spec.parent === undefined) throw new TypeError("Cannot read properties of undefined (reading 'id')");
        calls.push(spec);
        return {
          childId: 'child-9',
          result: Promise.resolve({ output: [{ type: 'text', text: 'ok' }], stopReason: 'completed' }),
          dispose: () => {},
        };
      },
    },
  });
  try {
    const reply = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'delegate', arguments: { task: 'do it', cwd: '/tmp/x', depth: 3 } },
    });
    assert.equal(reply.body.result.isError, undefined);
    assert.equal(reply.body.result.content[0].text, 'ok');

    const spec = calls[0];
    assert.equal(spec.parent.id, 'agent-1');
    assert.equal(taskOf(spec), 'do it');
    assert.equal(spec.delivery, 'caller');
    assert.equal(spec.cwd, '/tmp/x');
    assert.equal(spec.maxDepth, 1);
    // 0.2.1 read the nested `request`, so one build sends both shapes.
    assert.equal(spec.request.parent.id, 'agent-1');
  } finally {
    endpoint.close();
  }
});

// ---------------------------------------------------------------------------
// Superagent behaviour: the host does what the operator used to repeat in chat.
// ---------------------------------------------------------------------------

/** Call `delegate` with arguments. */
const delegate = (call, args, id = 1) => call({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'delegate', arguments: args } });

test('tasks[] fan out in parallel in one call, each with its own result and status', async () => {
  let inFlight = 0;
  let peak = 0;
  const { endpoint, calls, call } = await start({
    subagents: {
      async startActivation(spec) {
        calls.push(spec);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        const name = taskOf(spec).split(' ')[0];
        const result = new Promise((done) => setTimeout(() => {
          inFlight -= 1;
          done({ text: name === 'b' ? `b needs a key\nSTATUS: blocked — need the API key` : `${name} finished\nSTATUS: done` });
        }, 40));
        return { childId: `c-${name}`, result, dispose: () => {} };
      },
    },
  });
  try {
    const reply = await delegate(call, { tasks: [{ task: 'a audit', label: 'A' }, { task: 'b fix', label: 'B', tier: 'code' }, { task: 'c test', label: 'C' }] });
    const text = reply.body.result.content[0].text;
    assert.equal(peak, 3, 'all three ran at once');
    assert.match(text, /3 worker\(s\) in parallel/);
    assert.match(text, /2 done, 1 blocked/);
    assert.match(text, /### 2\. B — BLOCKED \(opencode-go\/glm-5\.3/, 'tier code routes to the code chain');
    assert.equal(reply.body.result.isError, undefined);
  } finally {
    endpoint.close();
  }
});

test('a route out of quota is cooled and the next route in the tier takes the task', async () => {
  const ledger = new QuotaLedger();
  const routesSeen = [];
  const { endpoint, call } = await start({
    extra: { ledger },
    subagents: {
      async startActivation(spec) {
        const route = `${spec.agentOptions.provider}/${spec.agentOptions.model}`;
        routesSeen.push(route);
        if (spec.agentOptions.provider === 'opencode-go') throw new Error('429 Too Many Requests: usage limit reached, retry after 120s');
        return { childId: 'x', result: Promise.resolve({ text: 'done on devin\nSTATUS: done' }), dispose: () => {} };
      },
    },
  });
  try {
    const first = await delegate(call, { task: 'grind' });
    assert.deepEqual(routesSeen, ['opencode-go/deepseek-v4.1-flash', 'acp-devin/swe-2-flash-medium']);
    assert.match(first.body.result.content[0].text, /done on devin/);
    assert.match(first.body.result.content[0].text, /skipped opencode-go\/deepseek-v4\.1-flash \(quota\)/);
    assert.equal(ledger.isCooled('opencode-go/deepseek-v4.1-flash'), true);

    routesSeen.length = 0;
    await delegate(call, { task: 'grind again' }, 2);
    assert.equal(routesSeen[0], 'acp-devin/swe-2-flash-medium', 'a cooled route is not tried first next time');
  } finally {
    endpoint.close();
  }
});

test('a transient failure is retried once on the same route', async () => {
  let attempts = 0;
  const { endpoint, call } = await start({
    subagents: {
      async startActivation() {
        attempts += 1;
        if (attempts === 1) throw new Error('fetch failed: ECONNRESET');
        return { childId: 'x', result: Promise.resolve({ text: 'ok\nSTATUS: done' }), dispose: () => {} };
      },
    },
  });
  try {
    const reply = await delegate(call, { task: 'flaky' });
    assert.equal(attempts, 2);
    assert.match(reply.body.result.content[0].text, /^ok/);
  } finally {
    endpoint.close();
  }
});

test('the project card for the working directory reaches every worker, and FACT lines are remembered', async () => {
  const contextDir = mkdtempSync(join(tmpdir(), 'dsh-ctx-'));
  mkdirSync(join(contextDir, 'projects'));
  writeFileSync(join(contextDir, 'projects', 'admin-ui.md'), '---\nname: admin-ui\npath: /work/admin-ui\ndeploy: wrangler pages deploy\n---\n# admin-ui\n\n## Facts\n');
  const prompts = [];
  const { endpoint, call } = await start({
    contextDir,
    subagents: {
      async startActivation(spec) {
        prompts.push(spec.prompt[0].text);
        return { childId: 'x', result: Promise.resolve({ text: 'shipped\nFACT: staging URL is admin-staging.example.dev\nSTATUS: done' }), dispose: () => {} };
      },
    },
  });
  try {
    await delegate(call, { task: 'deploy it', cwd: '/work/admin-ui/src' });
    assert.match(prompts[0], /## Project context/);
    assert.match(prompts[0], /deploy: wrangler pages deploy/);
    const card = readFileSync(join(contextDir, 'projects', 'admin-ui.md'), 'utf8');
    assert.match(card, /- staging URL is admin-staging\.example\.dev/);
    const ledgerFile = readdirSync(join(contextDir, 'work'))[0];
    const entries = readFileSync(join(contextDir, 'work', ledgerFile), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    // Work is recorded twice: a start the cockpit can show as "running now", and
    // an end that proves it finished. Same id, so a start with no end is lost work.
    assert.equal(entries.length, 2);
    assert.equal(entries[0].phase, 'start');
    assert.equal(entries[0].status, 'running');
    assert.equal(entries[0].project, 'admin-ui');
    assert.equal(entries[1].phase, 'end');
    assert.equal(entries[1].status, 'done');
    assert.equal(entries[1].project, 'admin-ui');
    assert.equal(typeof entries[0].id, 'string');
    assert.equal(entries[0].id, entries[1].id);
  } finally {
    endpoint.close();
  }
});

test('project_context and remember read and write the shared store', async () => {
  const contextDir = mkdtempSync(join(tmpdir(), 'dsh-ctx-'));
  mkdirSync(join(contextDir, 'projects'));
  writeFileSync(join(contextDir, 'projects', 'shop.md'), '---\nname: shop\npath: /work/shop\n---\n# shop\n');
  const { endpoint, call } = await start({ contextDir });
  try {
    const tool = (name, args, id) => call({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
    const listed = await tool('project_context', { list: true }, 1);
    assert.match(listed.body.result.content[0].text, /shop: \/work\/shop/);
    const saved = await tool('remember', { project: 'shop', fact: 'deploys on push to main via Cloudflare Pages' }, 2);
    assert.match(saved.body.result.content[0].text, /Recorded in shop/);
    const read = await tool('project_context', { project: 'shop' }, 3);
    assert.match(read.body.result.content[0].text, /## Facts\n- deploys on push to main via Cloudflare Pages/);
    const unknown = await tool('remember', { project: 'nope', fact: 'x' }, 4);
    assert.equal(unknown.body.result.isError, true);
  } finally {
    endpoint.close();
  }
});

test('a project resolves by the name the person actually uses', () => {
  const contextDir = mkdtempSync(join(tmpdir(), 'dsh-ctx-'));
  mkdirSync(join(contextDir, 'projects'));
  const site = join(contextDir, 'projects', 'ptechsolutions-site.md');
  writeFileSync(site, '---\nname: ptechsolutions-site\npath: /work/site\naliases: ptech admin, admin app, workbench\n---\n# site\n');
  writeFileSync(join(contextDir, 'projects', 'teabot.md'), '---\nname: teabot\npath: /work/teabot\n---\n# teabot\n');
  const card = findProject({ query: 'ptech admin' }, contextDir);
  assert.equal(card?.slug, 'ptechsolutions-site');
  assert.deepEqual(aliasesOf(card), ['ptech admin', 'admin app', 'workbench']);
  // Word order around an alias does not defeat it.
  assert.equal(findProject({ query: 'the workbench app' }, contextDir)?.slug, 'ptechsolutions-site');
  assert.equal(findProject({ query: 'teabot' }, contextDir)?.slug, 'teabot');
});
