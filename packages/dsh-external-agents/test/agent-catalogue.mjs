/**
 * Inspect any ACP agent's catalogue and provider metadata, using this plugin's
 * own client and adapter.
 *
 *   node test/agent-catalogue.mjs claude-agent-acp
 *   node test/agent-catalogue.mjs devin acp
 *
 * Useful when adding an agent to the config: it answers "does this command speak
 * ACP, and what would its picker group look like?" without touching the harness.
 */

import { resolve } from 'node:path';
import { AcpConnection, buildEnv } from '../index.js';
import { AcpModelAdapter } from '../llm-adapter.js';

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.log('usage: node test/agent-catalogue.mjs <command> [args...]');
  process.exit(1);
}
const workspace = resolve(import.meta.dirname, '..', '..');
const id = argv[0];
const connection = new AcpConnection({
  id,
  label: id,
  command: argv[0],
  args: argv.slice(1),
  cwd: workspace,
  env: buildEnv('minimal', {}),
  timeoutMs: 120_000,
  catalogueTimeoutMs: 60_000,
  approval: 'allow',
});
const adapter = new AcpModelAdapter({
  connection,
  provider: `acp-${id}`,
  label: id,
  resolveSessionKey: () => 'inspect',
  resolveCwd: () => workspace,
});

const started = Date.now();
/** @param message - a progress line. */
const log = (message) => console.log(`[+${String(Math.round((Date.now() - started) / 1000)).padStart(3)}s] ${message}`);

try {
  log(`asking ${id} for its catalogue …`);
  const models = await adapter.listModels(`acp-${id}`);
  console.log(`\nmodels: ${models.length}`);
  for (const model of models.slice(0, 25)) console.log(`  ${model.id.padEnd(38)} ${model.name}`);
  if (models.length > 25) console.log(`  … and ${models.length - 25} more`);

  const others = ['mode', 'thought_level']
    .map((category) => [category, connection.option('catalogue', category)])
    .filter(([, option]) => option !== undefined);
  console.log('\nother selectors offered:');
  for (const [category, option] of others) {
    console.log(`  ${category}: ${(option.options ?? []).map((o) => o.name ?? o.value).join(', ')}`);
  }

  // Set ASK to prove the agent can authenticate and answer through the minimal
  // environment — the check that matters for the compliance boundary.
  if (typeof process.env.ASK === 'string' && process.env.ASK.length > 0) {
    const chosen = process.env.MODEL ?? models[0]?.id;
    log(`streaming a turn with model="${chosen}" …`);
    const chunks = [];
    for await (const chunk of adapter.stream({
      provider: `acp-${id}`,
      model: chosen,
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'You are a coding agent.' }] },
        { role: 'user', content: [{ type: 'text', text: process.env.ASK }] },
      ],
    })) {
      chunks.push(chunk);
      if (chunk.type === 'text-delta') process.stdout.write(chunk.text);
      if (chunk.type === 'reasoning-delta') process.stdout.write(`·${chunk.text}`);
    }
    const finish = chunks.at(-1);
    console.log(`\nfinish=${JSON.stringify(finish)}`);
    if (finish?.type !== 'finish' || finish.reason?.kind !== 'stop') {
      console.log('\nRESULT: FAIL — the agent did not complete a turn');
      connection.dispose();
      setTimeout(() => process.exit(1), 300);
    }
  }

  console.log(models.length > 0 ? '\nRESULT: PASS' : '\nRESULT: PASS (agent speaks ACP but advertises no models)');
} catch (error) {
  console.log(`\nRESULT: FAIL — ${String(error?.message ?? error)}`);
} finally {
  connection.dispose();
  setTimeout(() => process.exit(0), 500);
}
