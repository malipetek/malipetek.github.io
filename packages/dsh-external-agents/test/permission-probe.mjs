/**
 * Does the ACP permission path actually gate a real edit?
 *
 * Runs the same file-writing request twice against an external agent — once with
 * the client set to deny and once to allow — and reports whether the file
 * appeared and what permission decisions the client made. This is the check
 * behind "an unattended session that silently denies edits would look like the
 * agent is failing for no reason".
 *
 *   node test/permission-probe.mjs claude-agent-acp [--model haiku]
 */

import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AcpConnection, buildEnv } from '../index.js';

const argv = process.argv.slice(2).filter((arg) => arg !== '--model' && !arg.startsWith('--model='));
const modelArg = process.argv.find((arg) => arg.startsWith('--model='));
const model = modelArg ? modelArg.slice('--model='.length) : undefined;
const command = argv[0] ?? 'claude-agent-acp';
const args = argv.slice(1);

const PROMPT = 'Create a file named probe.txt in the current working directory containing exactly the word hello. '
  + 'Use your file tool to do it, then reply DONE.';

/**
 * Run one turn with a given approval policy.
 * @param approval - the client's `session/request_permission` policy.
 * @returns what happened.
 */
async function run(approval) {
  const dir = mkdtempSync(join(tmpdir(), `dsh-perm-${approval}-`));
  const connection = new AcpConnection({
    id: 'probe',
    label: 'Probe',
    command,
    args,
    cwd: dir,
    env: buildEnv('minimal', {}),
    timeoutMs: 180_000,
    catalogueTimeoutMs: 60_000,
    approval,
  });
  try {
    await connection.ensureSession(dir, 'probe');
    if (model !== undefined) await connection.selectOption('probe', 'model', model);
    const result = await connection.prompt(PROMPT, { key: 'probe', cwd: dir });
    const file = join(dir, 'probe.txt');
    return {
      approval,
      stopReason: result.stopReason,
      permissions: result.permissions,
      text: result.text.trim().slice(0, 120),
      created: existsSync(file),
      contents: existsSync(file) ? readFileSync(file, 'utf8').trim().slice(0, 40) : null,
    };
  } finally {
    connection.dispose();
    setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }, 1_500);
  }
}

const dir0 = resolve(import.meta.dirname, '..', '..');
console.log(`agent: ${command} ${args.join(' ')}`);
console.log(`workspace root: ${dir0}\n`);

for (const approval of ['deny', 'allow']) {
  console.log(`=== approval: ${approval} ===`);
  try {
    const outcome = await run(approval);
    console.log(JSON.stringify(outcome, null, 2));
    console.log(outcome.created
      ? `  -> the agent DID write the file (${JSON.stringify(outcome.contents)})`
      : '  -> the file was NOT created');
    console.log(`  -> permission requests observed: ${outcome.permissions.length}`);
  } catch (error) {
    console.log(`  FAILED: ${String(error?.message ?? error)}`);
  }
  console.log('');
}
process.exit(0);
