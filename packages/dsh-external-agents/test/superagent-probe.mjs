/**
 * Live check of the superagent wiring against a real Claude Code (ACP adapter):
 *   1. the shared rules arrive as the system prompt (session/new `systemPrompt`);
 *   2. `disallowedTools` removes Claude's built-in subagent tools;
 *   3. the Stop hook sends a "next steps / shall I continue?" ending back to work.
 *
 *   node test/superagent-probe.mjs [--model=haiku]
 */
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AcpConnection, buildEnv } from '../index.js';

const model = (process.argv.find((a) => a.startsWith('--model=')) ?? '--model=haiku').slice(8);
const dir = mkdtempSync(join(tmpdir(), 'dsh-superagent-probe-'));
const hookLog = join(dir, 'hook.jsonl');
const hook = fileURLToPath(new URL('../hooks/stop-hook.mjs', import.meta.url));
const rules = readFileSync(join(homedir(), '.dsh', 'model-routing.md'), 'utf8');

const connection = new AcpConnection({
  id: 'probe', label: 'Probe', command: 'claude-agent-acp', args: [], cwd: dir,
  env: buildEnv('minimal', {}), timeoutMs: 240_000, catalogueTimeoutMs: 60_000, approval: 'allow',
  systemPrompt: rules,
  sessionMeta: {
    claudeCode: {
      options: {
        disallowedTools: ['Agent', 'Task'],
        settings: { hooks: { Stop: [{ hooks: [{ type: 'command', command: `tee -a ${hookLog} | ${process.execPath} ${hook}`, timeout: 10 }] }] } },
      },
    },
  },
});

try {
  const session = await connection.ensureSession(dir, 'probe');
  console.log('system prompt applied at session/new:', session.instructionsSent === rules.trim());
  await connection.selectOption('probe', 'model', model).catch((e) => console.log('model select:', e.message));

  const one = await connection.prompt(
    'Answer without using any tool. Line 1: rule 2 of your "Working rules", in under 15 words. '
    + 'Line 2: the exact names of every tool you have that launches a subagent or sub-agent (such as Agent or Task), or NONE. Then STATUS: done',
    { key: 'probe', cwd: dir },
  );
  console.log('\n--- turn 1 ---\n' + one.text.trim());

  const two = await connection.prompt(
    'Write a two-line text file notes.txt here. Then stop and offer me the next steps '
    + '(adding a third and a fourth line) instead of doing them, asking whether you should continue.',
    { key: 'probe', cwd: dir },
  );
  console.log('\n--- turn 2 ---\n' + two.text.trim().slice(-600));
  const events = existsSync(hookLog) ? readFileSync(hookLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  console.log('\nStop hook invocations:', events.map((e) => ({ active: e.stop_hook_active })));
  const notes = join(dir, 'notes.txt');
  console.log('notes.txt lines:', existsSync(notes) ? readFileSync(notes, 'utf8').trim().split('\n').length : 'missing');
} finally {
  connection.dispose();
}
process.exit(0);
