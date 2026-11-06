/**
 * Does an external agent retain the conversation between turns?
 *
 * Turn one plants a fact; turn two asks for it back. Two modes:
 *
 *   node test/context-retention.mjs raw       # one ACP session, two prompts
 *   node test/context-retention.mjs adapter   # the harness path, two streams
 *
 * `raw` isolates the agent: if it forgets here, the loss is the agent's or the
 * ACP session's. `adapter` adds the plugin's own session bookkeeping, so a
 * failure there and not in `raw` points at the harness side.
 *
 * It prints the child pid and ACP session id around each turn, because a
 * context loss is usually a session that was quietly replaced.
 */

import { resolve } from 'node:path';
import { AcpConnection, buildEnv } from '../index.js';
import { AcpModelAdapter } from '../llm-adapter.js';

const mode = process.argv[2] ?? 'raw';
const command = process.argv[3] ?? 'devin';
const args = process.argv.slice(4);
const workspace = resolve(import.meta.dirname, '..', '..');

const connection = new AcpConnection({
  id: command,
  label: command,
  command,
  args,
  cwd: workspace,
  env: buildEnv('minimal', {}),
  timeoutMs: 300_000,
  catalogueTimeoutMs: 60_000,
  approval: 'allow',
});

const KEY = 'retention-probe';
const PLANT = 'Remember this number for later: 7. Reply with just OK.';
const RECALL = 'What number did I ask you to remember? Reply with just the number.';

/** Describe what the connection currently holds. */
function state(label) {
  console.log(`  [${label}] pid=${connection.child?.pid ?? 'none'} state=${connection.state} sessions=${connection.sessions.size} acpSession=${connection.option ? (connection.sessions.get(KEY)?.sessionId ?? 'none') : 'none'}`);
}

try {
  if (mode === 'fork') {
    // Nothing has ever told this agent about the number except the harness
    // transcript it is primed with — which is precisely a fork's situation: the
    // UI shows the parent's conversation, the agent has never seen it.
    const forkAdapter = new AcpModelAdapter({
      connection,
      provider: `acp-${command}`,
      label: command,
      resolveSessionKey: () => 'fork-probe',
      resolveCwd: () => workspace,
      approvalPolicy: 'allow',
      note: (line) => console.log(`  [note] ${line}`),
    });
    const messages = [
      { role: 'system', content: [{ type: 'text', text: 'you are a coding agent' }] },
      { role: 'user', content: [{ type: 'text', text: 'Remember this number for later: 7. Reply with just OK.' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'OK' }] },
      { role: 'user', content: [{ type: 'text', text: 'What number did I ask you to remember? Reply with just the number.' }] },
    ];
    const chunks = [];
    for await (const chunk of forkAdapter.stream({ provider: `acp-${command}`, model: process.env.MODEL, messages })) {
      chunks.push(chunk);
    }
    const reply = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('');
    console.log('reply:', JSON.stringify(reply.trim().slice(0, 100)));
    console.log(/7/.test(reply)
      ? '\nRESULT: PASS — a forked conversation was caught up from the transcript'
      : '\nRESULT: FAIL — the agent had no history to work from');
  } else if (mode === 'churn') {
    // Models the live failure: some turns can name the workspace, others cannot.
    // Before the sticky fix the second call looked like a directory change, so
    // the session was closed and the conversation restarted — every turn.
    await connection.ensureSession(workspace, KEY);
    console.log('turn 1 (plant, workspace known):');
    const first = await connection.prompt(PLANT, { key: KEY });
    console.log('  reply:', JSON.stringify(first.text.trim().slice(0, 80)));
    const created = connection.sessions.get(KEY).sessionId;

    console.log('\nbetween turns: the workspace cannot be resolved this time');
    const again = await connection.ensureSession(undefined, KEY);
    console.log(`  session ${again.sessionId}  (${again.sessionId === created ? 'reused' : 'REPLACED'})`);

    console.log('\nturn 2 (recall):');
    const second = await connection.prompt(RECALL, { key: KEY });
    console.log('  reply:', JSON.stringify(second.text.trim().slice(0, 80)));
    state('after turn 2');

    const kept = /7/.test(second.text) && again.sessionId === created;
    console.log(kept ? '\nRESULT: PASS — an unknown workspace did not cost the conversation' : '\nRESULT: FAIL — the conversation was lost to workspace churn');
  } else if (mode === 'raw') {
    await connection.ensureSession(workspace, KEY);
    state('after ensureSession');

    console.log('\nturn 1 (plant):');
    const first = await connection.prompt(PLANT, { key: KEY });
    console.log('  reply:', JSON.stringify(first.text.trim().slice(0, 120)));
    state('after turn 1');

    console.log('\nturn 2 (recall):');
    const second = await connection.prompt(RECALL, { key: KEY });
    console.log('  reply:', JSON.stringify(second.text.trim().slice(0, 120)));
    state('after turn 2');

    const retained = /7/.test(second.text);
    console.log(retained ? '\nRESULT: retained (raw)' : '\nRESULT: LOST (raw) — the agent itself did not carry the fact');
  } else {
    const adapter = new AcpModelAdapter({
      connection,
      provider: `acp-${command}`,
      label: command,
      resolveSessionKey: () => 'fixed-session-key',
      resolveCwd: () => workspace,
      approvalPolicy: 'allow',
    });

    /** Drive one harness-shaped turn. @param text - the user turn. */
    async function turn(text) {
      const chunks = [];
      for await (const chunk of adapter.stream({
        provider: `acp-${command}`,
        messages: [{ role: 'user', content: [{ type: 'text', text }] }],
      })) chunks.push(chunk);
      return chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('');
    }

    console.log('turn 1 (plant):');
    console.log('  reply:', JSON.stringify((await turn(PLANT)).trim().slice(0, 120)));
    state('after turn 1');

    console.log('\nturn 2 (recall):');
    const recalled = await turn(RECALL);
    console.log('  reply:', JSON.stringify(recalled.trim().slice(0, 120)));
    state('after turn 2');

    console.log(/7/.test(recalled) ? '\nRESULT: retained (adapter)' : '\nRESULT: LOST (adapter) — the harness path did not carry the fact');
  }
} catch (error) {
  console.log(`\nRESULT: FAIL — ${String(error?.message ?? error)}`);
} finally {
  connection.dispose();
  setTimeout(() => process.exit(0), 500);
}
