/**
 * Live integration check: drive a real external agent through this plugin's
 * client. Not part of the default suite, because it needs an authenticated
 * agent and spends a little of that account's usage.
 *
 *   node test/integration-devin.mjs
 *
 * It uses the shipped agent catalog and the same environment rules the plugin
 * applies, so a pass here means the plugin's own path works.
 */

import { resolve } from 'node:path';
import { AcpConnection, buildEnv, renderUpdate } from '../index.js';

const workspace = resolve(import.meta.dirname, '..', '..');
const connection = new AcpConnection({
  id: 'devin',
  label: 'Devin',
  command: 'devin',
  args: ['acp'],
  cwd: workspace,
  // No XDG redirection: Devin's saved login lives in its own XDG data
  // directory, so redirecting it would make Devin look logged out. The child
  // therefore needs write access to its own home, which is also why this check
  // is excluded from the default suite.
  env: buildEnv('minimal', {}),
  timeoutMs: 300_000,
  approval: 'allow',
});

const started = Date.now();
/** @param message - progress line. */
const log = (message) => console.log(`[+${String(Math.round((Date.now() - started) / 1000)).padStart(3)}s] ${message}`);

try {
  log('starting devin acp …');
  await connection.start();
  log(`handshake complete (state=${connection.state})`);

  log('opening session …');
  await connection.ensureSession(workspace);
  log(`session=${connection.sessionId}`);

  log('prompting …');
  const result = await connection.prompt(
    'Reply with exactly the single word READY. Do not read any files, do not use any tools, and do not explain.',
    {
      onUpdate: (update) => {
        const line = renderUpdate(update);
        if (line.length > 0 && line.length < 200) log(`  update: ${line}`);
      },
    },
  );

  log(`stopReason=${result.stopReason}`);
  console.log('\n--- assistant text ---');
  console.log(result.text.trim() || '(empty)');
  console.log('--- end ---');
  console.log(`\nupdates=${result.updates.length} permissions=${result.permissions.length}`);
  console.log(result.text.trim().length > 0 ? 'RESULT: PASS' : 'RESULT: FAIL (no assistant text)');
} catch (error) {
  console.log(`RESULT: FAIL — ${String(error?.message ?? error)}`);
} finally {
  connection.dispose();
  setTimeout(() => process.exit(0), 500);
}
