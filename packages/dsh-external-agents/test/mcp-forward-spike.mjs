/**
 * The full pipe, end to end: Claude Code → MCP shim → HTTP endpoint → reply.
 *
 * It drives the **shipping** endpoint (`delegate.mjs`) with a fake
 * `ctx.subagents`, so the only thing not exercised is DSH's own activation
 * machinery — the tool schema, the per-session token, the parent binding, the
 * shim and Claude's decision to call the tool are all real.
 *
 *   node test/mcp-forward-spike.mjs claude-agent-acp
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import readline from 'node:readline';

import { createDelegateEndpoint } from '../delegate.mjs';

const command = process.argv[2] ?? 'claude-agent-acp';
const args = process.argv.slice(3);
const shim = resolve(import.meta.dirname, 'mcp-forward.mjs');

// A fake `ctx.subagents`: it records the spec the endpoint builds and answers with
// a text result, which is the shape the real activation resolves to.
let delegated = null;
const subagents = {
  async startActivation(spec) {
    delegated = {
      provider: spec.provider,
      delivery: spec.delivery,
      task: spec.request?.prompt?.[0]?.text ?? null,
      agentOptions: spec.request?.agentOptions ?? null,
      parentId: spec.request?.parent?.id ?? null,
    };
    return {
      childId: 'child-1',
      result: Promise.resolve({ text: `worker dsh-1 answered: 42 (task: ${delegated.task})` }),
      dispose: () => {},
    };
  },
};

const endpoint = createDelegateEndpoint({
  subagents,
  provider: 'spawn',
  agentOptions: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
  log: (line) => console.log(`  [endpoint] ${line}`),
});
const endpointUrl = await endpoint.listen();
const token = endpoint.tokenFor('session-1');
endpoint.bind('session-1', { id: 'agent-1' });
console.log(`endpoint: ${endpointUrl}`);

const workspace = mkdtempSync(join(tmpdir(), 'dsh-mcpf-'));
const proc = spawn(command, args, { cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'] });
const pending = new Map();
let nextId = 1;
let text = '';

const send = (message) => proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const call = (method, params) =>
  new Promise((res) => {
    const id = nextId++;
    pending.set(id, res);
    send({ id, method, params });
  });

readline.createInterface({ input: proc.stdout }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id !== undefined && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
    return;
  }
  if (message.id !== undefined && message.method === 'session/request_permission') {
    const options = message.params?.options ?? [];
    const pick = options.find((o) => o.kind === 'allow_once') ?? options[0];
    send({ id: message.id, result: { outcome: { outcome: 'selected', optionId: pick?.optionId } } });
    return;
  }
  if (message.id !== undefined && message.method) {
    send({ id: message.id, result: null });
    return;
  }
  if (message.method === 'session/update') {
    const update = message.params?.update;
    if (update?.sessionUpdate === 'agent_message_chunk') text += update.content?.text ?? '';
  }
});

try {
  const init = await call('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    clientInfo: { name: 'mcp-forward-spike', version: '1' },
  });
  console.log('initialize:', init.error ? `ERROR ${init.error.message}` : 'ok');

  const session = await call('session/new', {
    cwd: workspace,
    mcpServers: [{
      name: 'dsh',
      type: 'stdio',
      command: process.execPath,
      args: [shim, '--url', endpointUrl, '--token', token],
      env: [],
    }],
  });
  if (session.error) throw new Error(`session/new: ${session.error.message}`);

  const reply = await call('session/prompt', {
    sessionId: session.result.sessionId,
    prompt: [{
      type: 'text',
      text: 'Use the dsh delegate tool to run the task "compute 6*7". '
        + 'Then reply with exactly what the worker returned, and nothing else.',
    }],
  });
  if (reply.error) throw new Error(`session/prompt: ${reply.error.message}`);

  console.log(`\ndelegated: ${JSON.stringify(delegated)}`);
  console.log(`reply: ${JSON.stringify(text.trim().slice(0, 200))}`);
  const pass = delegated !== null && /42/.test(text);
  console.log(pass
    ? '\nRESULT: PASS — Claude reached the endpoint through the shim and reported the worker\'s answer'
    : '\nRESULT: FAIL — the delegate tool was not exercised');
} catch (error) {
  console.log(`\nRESULT: FAIL — ${String(error?.message ?? error)}`);
} finally {
  proc.kill('SIGTERM');
  endpoint.close();
  setTimeout(() => {
    try { rmSync(workspace, { recursive: true, force: true }); } catch { /* best effort */ }
    process.exit(0);
  }, 400);
}
