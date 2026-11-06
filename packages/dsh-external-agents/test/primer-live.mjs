/**
 * Live proof of the catch-up path, against a real agent.
 *
 * Part 1 — a **fresh** ACP session inherits a conversation it never saw. The
 * planted fact exists only in the harness history, so an answer that uses it can
 * only have come from the primer.
 *
 * Part 2 — another agent then answers a turn, and the conversation comes back.
 * The fact is changed by that other agent, so the right answer can only come from
 * the delta primer (the agent's own session predates the change).
 *
 *   node test/primer-live.mjs devin acp
 *
 * Needs an authenticated agent and a scratch workspace; spends a little of that
 * account's usage.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AcpConnection, buildEnv } from '../index.js';
import { AcpModelAdapter } from '../llm-adapter.js';

const command = process.argv[2] ?? 'devin';
const args = process.argv.slice(3);
const workspace = mkdtempSync(join(tmpdir(), 'dsh-primer-'));
const connection = new AcpConnection({
  id: command,
  label: command,
  command,
  args,
  cwd: workspace,
  env: buildEnv('minimal', {}),
  timeoutMs: 240_000,
  catalogueTimeoutMs: 60_000,
  approval: 'allow',
});
const adapter = new AcpModelAdapter({
  connection,
  provider: `acp-${command}`,
  label: command,
  approvalPolicy: 'allow',
  resolveSessionKey: () => 'primer-live',
  resolveCwd: () => workspace,
  primeMaxChars: 48_000,
  note: (line) => console.log(`  [note] ${line}`),
  logger: { warn: (line) => console.log(`  [warn] ${line}`), debug: () => {} },
});

/** One harness turn. @param messages - the harness messages. */
async function turn(messages) {
  let text = '';
  for await (const chunk of adapter.stream({ provider: `acp-${command}`, messages })) {
    if (chunk.type === 'text-delta') text += chunk.text;
  }
  return text.trim();
}

/** A message the harness would hold. @param role - user or assistant. @param body - text. */
const msg = (role, body) => ({ role, content: [{ type: 'text', text: body }] });

try {
  console.log('Part 1 — fresh session, history only in the harness:');
  const first = await turn([
    msg('user', 'House rule for this project: the release codename is HALCYON-7. Note it, do not act on it yet.'),
    msg('assistant', 'Understood — codename HALCYON-7 noted.'),
    msg('user', 'What is the release codename for this project? Reply with just the codename.'),
  ]);
  console.log(`  reply: ${JSON.stringify(first.slice(0, 160))}`);
  const part1 = /HALCYON-7/i.test(first);

  console.log('\nPart 2 — another agent changes it while this one is swapped out:');
  const second = await turn([
    msg('user', 'House rule for this project: the release codename is HALCYON-7. Note it, do not act on it yet.'),
    msg('assistant', 'Understood — codename HALCYON-7 noted.'),
    msg('user', 'What is the release codename for this project? Reply with just the codename.'),
    msg('assistant', first.slice(0, 400)),
    msg('user', 'Another agent here. The codename is now HALCYON-9; HALCYON-7 is retired.'),
    msg('assistant', 'Acknowledged — the codename is now HALCYON-9, HALCYON-7 retired.'),
    msg('user', 'What is the release codename now? Reply with just the codename.'),
  ]);
  console.log(`  reply: ${JSON.stringify(second.slice(0, 160))}`);
  const part2 = /HALCYON-9/i.test(second) && !/HALCYON-7/i.test(second);

  console.log(`\npart 1 (fresh primer): ${part1 ? 'PASS' : 'FAIL'}`);
  console.log(`part 2 (delta primer): ${part2 ? 'PASS' : 'FAIL'}`);
  console.log(part1 && part2 ? '\nRESULT: PASS' : '\nRESULT: FAIL');
} catch (error) {
  console.log(`\nRESULT: FAIL — ${String(error?.message ?? error)}`);
} finally {
  connection.dispose();
  setTimeout(() => {
    try { rmSync(workspace, { recursive: true, force: true }); } catch { /* best effort */ }
    process.exit(0);
  }, 500);
}
