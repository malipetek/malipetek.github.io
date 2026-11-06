/**
 * Live check of the LLM half against a real agent: the model catalogue the
 * picker will show, and one streamed turn.
 *
 *   node test/integration-llm-devin.mjs
 *
 * Needs an authenticated agent and spends a little of that account's usage; it
 * also needs write access to the agent's own home, which is why it is not part
 * of the default suite.
 */

import { resolve } from 'node:path';
import { AcpConnection, buildEnv } from '../index.js';
import { AcpModelAdapter } from '../llm-adapter.js';

const workspace = resolve(import.meta.dirname, '..', '..');
const connection = new AcpConnection({
  id: 'devin',
  label: 'Devin',
  command: 'devin',
  args: ['acp'],
  cwd: workspace,
  env: buildEnv('minimal', {}),
  timeoutMs: 300_000,
  approval: 'allow',
});
const adapter = new AcpModelAdapter({
  connection,
  provider: 'acp-devin',
  label: 'Devin',
  resolveSessionKey: () => 'integration',
  resolveCwd: () => workspace,
});

const started = Date.now();
/** @param message - a progress line. */
const log = (message) => console.log(`[+${String(Math.round((Date.now() - started) / 1000)).padStart(3)}s] ${message}`);

try {
  log('provider info: ' + JSON.stringify(adapter.providerInfo('acp-devin')));

  log('reading the model catalogue over ACP …');
  const models = await adapter.listModels('acp-devin');
  console.log(`\n--- ${models.length} models the picker would show ---`);
  for (const model of models.slice(0, 8)) console.log(`  ${model.id.padEnd(34)} ${model.name}`);
  if (models.length > 8) console.log(`  … and ${models.length - 8} more`);
  console.log('--- end ---\n');

  // The harness's own catalogue rule, copied from LlmRuntime.listModels():
  // one bad row rejects the whole provider with INVALID_CATALOG.
  const seen = new Set();
  for (const model of models) {
    if (typeof model.provider !== 'string' || model.provider !== 'acp-devin') throw new Error(`bad provider on ${model.id}`);
    if (typeof model.id !== 'string' || model.id.length === 0) throw new Error('empty id');
    if (typeof model.name !== 'string' || model.name.length === 0) throw new Error(`empty name on ${model.id}`);
    if (model.description !== undefined && typeof model.description !== 'string') throw new Error(`bad description on ${model.id}`);
    if (seen.has(model.id)) throw new Error(`duplicate id ${model.id}`);
    seen.add(model.id);
  }
  log(`catalogue passes the harness validator (${models.length} unique, named models)`);

  const chosen = models.find((model) => model.id === 'adaptive') ?? models[0];
  log(`streaming a turn with model="${chosen.id}" …`);

  const chunks = [];
  for await (const chunk of adapter.stream({
    provider: 'acp-devin',
    model: chosen.id,
    messages: [
      { role: 'system', content: [{ type: 'text', text: 'You are a coding agent.' }] },
      { role: 'user', content: [{ type: 'text', text: 'Reply with exactly the single word READY. Do not use any tools and do not read files.' }] },
    ],
  })) {
    chunks.push(chunk);
    if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
      process.stdout.write(chunk.type === 'text-delta' ? chunk.text : `·${chunk.text}`);
    }
  }

  const text = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('');
  const finish = chunks.at(-1);
  console.log(`\n\nchunks=${chunks.length}`);
  console.log(`kinds=${[...new Set(chunks.map((chunk) => chunk.type))].join(',')}`);
  console.log(`finish=${JSON.stringify(finish)}`);
  console.log(`text=${JSON.stringify(text.trim())}`);
  console.log(`model wrote back as current: ${connection.option('integration', 'model')?.currentValue}`);
  console.log(finish?.type === 'finish' && finish.reason?.kind === 'stop' && text.trim().length > 0
    ? '\nRESULT: PASS'
    : '\nRESULT: FAIL');
} catch (error) {
  console.log(`RESULT: FAIL — ${String(error?.message ?? error)}`);
} finally {
  connection.dispose();
  setTimeout(() => process.exit(0), 500);
}
