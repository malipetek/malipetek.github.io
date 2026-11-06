/**
 * What usage does an ACP agent actually report?
 *
 * Sends one small prompt and prints the raw `session/prompt` response, so the
 * numbers the harness could show are read rather than guessed. ACP marks this
 * `usage` field **unstable**, so the point of the probe is to find out which
 * agents fill it in — and whether `cachedReadTokens` ever appears.
 *
 *   node test/usage-probe.mjs opencode acp
 *   node test/usage-probe.mjs devin acp
 *   node test/usage-probe.mjs claude-agent-acp
 */

import { spawn } from 'node:child_process';
import readline from 'node:readline';

const command = process.argv[2];
const raw = process.argv.slice(3);
// `--model <id>` picks the model before prompting; the agent's default may be one
// this account cannot use.
const modelFlag = raw.indexOf('--model');
const args = modelFlag === -1 ? raw : raw.filter((_, index) => index !== modelFlag && index !== modelFlag + 1);
const model = modelFlag === -1 ? undefined : raw[modelFlag + 1];
if (command === undefined) {
  console.error('usage: node test/usage-probe.mjs <command> [args…]');
  process.exit(2);
}

const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
const pending = new Map();
let nextId = 1;
const call = (method, params) =>
  new Promise((resolve) => {
    const id = nextId += 1;
    pending.set(id, resolve);
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
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
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { outcome: { outcome: 'selected', optionId: pick?.optionId } } })}\n`);
    return;
  }
  if (message.method === 'session/update') {
    const update = message.params?.update;
    if (update?.sessionUpdate === 'usage_update') {
      console.log('  usage_update:', JSON.stringify(update));
    }
  }
});

try {
  const init = await call('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    clientInfo: { name: 'usage-probe', version: '1' },
  });
  console.log('initialize:', JSON.stringify(init.result?.agentCapabilities ?? init.error ?? null).slice(0, 300));

  const session = await call('session/new', { cwd: process.cwd(), mcpServers: [] });
  if (session.error) throw new Error(`session/new: ${session.error.message}`);
  const sessionId = session.result.sessionId;

  if (model !== undefined) {
    const set = await call('session/set_config_option', { sessionId, configId: 'model', value: model });
    console.log('model set:', set.error ? `FAILED ${set.error.message}` : 'ok');
  }

  const reply = await call('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: 'Reply with exactly: ok' }],
  });
  console.log('\nsession/prompt response:');
  console.log(JSON.stringify(reply, null, 2).slice(0, 1600));
} catch (error) {
  console.log(`probe failed: ${String(error?.message ?? error)}`);
} finally {
  proc.kill('SIGTERM');
  setTimeout(() => process.exit(0), 300);
}
