/**
 * Live check that reported usage reaches the harness.
 *
 * Runs one short turn through the adapter and prints the `usage` chunk it emits —
 * the object the harness renders as tokens and cache-hit rate. If `cachedReadTokens`
 * is absent here, the agent did not report it; if it is present, a 0% display would
 * be the harness's loss, not the provider's.
 *
 *   node test/usage-live.mjs opencode acp --model opencode-go/deepseek-v4.1-flash
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpConnection, buildEnv } from '../index.js';
import { AcpModelAdapter } from '../llm-adapter.js';

const command = process.argv[2] ?? 'opencode';
const raw = process.argv.slice(3);
const modelFlag = raw.indexOf('--model');
const args = modelFlag === -1 ? raw : raw.filter((_, index) => index !== modelFlag && index !== modelFlag + 1);
const model = modelFlag === -1 ? 'opencode-go/deepseek-v4.1-flash' : raw[modelFlag + 1];

const workspace = mkdtempSync(join(tmpdir(), 'dsh-usage-'));
const connection = new AcpConnection({
  id: command, label: command, command, args, cwd: workspace,
  env: buildEnv('minimal', {}), timeoutMs: 120_000, catalogueTimeoutMs: 60_000, approval: 'allow',
});
const adapter = new AcpModelAdapter({
  connection,
  provider: `acp-${command}`,
  label: command,
  approvalPolicy: 'allow',
  resolveSessionKey: () => 'usage-live',
  resolveCwd: () => workspace,
  note: (line) => console.log(`  [note] ${line}`),
  logger: { warn: (line) => console.log(`  [warn] ${line}`), debug: () => {} },
});

try {
  // Two turns, because a provider cache can only be read on a repeat prefix: the
  // first turn has nothing to reuse.
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: ok' }] }];
  const turns = [];
  for (let turn = 1; turn <= 2; turn += 1) {
    const chunks = [];
    for await (const chunk of adapter.stream({ provider: `acp-${command}`, model, messages })) {
      chunks.push(chunk);
    }
    const usage = chunks.find((chunk) => chunk.type === 'usage');
    const text = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('');
    turns.push({ turn, text: text.trim().slice(0, 60), usage: usage?.usage ?? null });
    console.log(`\nturn ${turn} reply: ${JSON.stringify(turns.at(-1).text)}`);
    console.log(`turn ${turn} usage: ${JSON.stringify(turns.at(-1).usage)}`);
    // Grow the conversation the way the harness would before the next turn.
    messages.push({ role: 'assistant', content: [{ type: 'text', text: turns.at(-1).text || 'ok' }] });
    messages.push({ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: ok again' }] });
  }
  const second = turns[1].usage;
  console.log(
    second?.cacheReadTokens === undefined
      ? '\nRESULT: this agent reported no cache read on a repeated prefix'
      : `\nRESULT: PASS — cachedReadTokens=${second.cacheReadTokens} of inputTokens=${second.inputTokens}`,
  );
} catch (error) {
  console.log(`\nRESULT: FAIL — ${String(error?.message ?? error)}`);
} finally {
  connection.dispose();
  setTimeout(() => {
    try { rmSync(workspace, { recursive: true, force: true }); } catch { /* best effort */ }
    process.exit(0);
  }, 400);
}
