/**
 * Does an ACP agent actually connect to the MCP servers handed to it?
 *
 * `session/new` accepts `mcpServers`; the ACP schema says so, but an adapter can
 * accept the field and ignore it. This drives a real agent against a one-tool
 * MCP server and checks whether the tool was both offered and called.
 *
 *   node test/mcp-spike.mjs claude-agent-acp
 *   node test/mcp-spike.mjs devin acp
 *   node test/mcp-spike.mjs opencode acp --model opencode-go/deepseek-v4.1-flash
 *
 * Pass when the agent's reply contains the echoed text — the only way it can is
 * if the server was connected and the tool executed.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import readline from 'node:readline';

const command = process.argv[2] ?? 'claude-agent-acp';
const raw = process.argv.slice(3);
const modelFlag = raw.indexOf('--model');
const args = modelFlag === -1 ? raw : raw.filter((_, i) => i !== modelFlag && i !== modelFlag + 1);
const model = modelFlag === -1 ? undefined : raw[modelFlag + 1];

const workspace = mkdtempSync(join(tmpdir(), 'dsh-mcp-'));
const echoPath = resolve(import.meta.dirname, 'echo-mcp.mjs');
const proc = spawn(command, args, { cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'] });

const pending = new Map();
let nextId = 1;
let text = '';
let toolUpdates = 0;
let mcpCalled = false;

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
    if (update?.sessionUpdate === 'tool_call') {
      toolUpdates += 1;
      const title = String(update.title ?? update.kind ?? '').toLowerCase();
      if (title.includes('echo') || title.includes('mcp') || title.includes('dsh')) mcpCalled = true;
    }
  }
});

// The echo server reports every tools/call on stderr; the agent's stderr is
// forwarded, so a hit here is independent evidence beyond the model's words.
proc.stderr.on('data', (chunk) => {
  const line = String(chunk);
  if (line.includes('tools/call echo')) {
    mcpCalled = true;
    process.stdout.write(`  [mcp] ${line.trim()}\n`);
  }
});

try {
  const init = await call('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    clientInfo: { name: 'mcp-spike', version: '1' },
  });
  console.log('initialize:', init.error ? `ERROR ${init.error.message}` : 'ok');

  const session = await call('session/new', {
    cwd: workspace,
    mcpServers: [{ name: 'dsh-echo', type: 'stdio', command: process.execPath, args: [echoPath], env: [] }],
  });
  if (session.error) throw new Error(`session/new: ${session.error.message}`);
  const sessionId = session.result.sessionId;

  if (model !== undefined) {
    const set = await call('session/set_config_option', { sessionId, configId: 'model', value: model });
    console.log('model:', set.error ? `FAILED ${set.error.message}` : model);
  }

  const reply = await call('session/prompt', {
    sessionId,
    prompt: [{
      type: 'text',
      text: 'Use the dsh-echo MCP tool named "echo" with text "mcp-ok". '
        + 'Then reply with exactly what the tool returned, and nothing else.',
    }],
  });
  if (reply.error) throw new Error(`session/prompt: ${reply.error.message}`);

  console.log(`\nreply: ${JSON.stringify(text.trim().slice(0, 200))}`);
  console.log(`tool_call updates: ${toolUpdates} | echo server invoked: ${mcpCalled}`);
  const echoed = /mcp-ok/i.test(text);
  console.log(
    echoed
      ? '\nRESULT: PASS — the MCP server was connected and its tool returned to the agent'
      : '\nRESULT: FAIL — no evidence the tool was called',
  );
} catch (error) {
  console.log(`\nRESULT: FAIL — ${String(error?.message ?? error)}`);
} finally {
  proc.kill('SIGTERM');
  setTimeout(() => {
    try { rmSync(workspace, { recursive: true, force: true }); } catch { /* best effort */ }
    process.exit(0);
  }, 400);
}
