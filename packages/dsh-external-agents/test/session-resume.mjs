/**
 * Does a conversation survive the process that opened it?
 *
 * Turn one plants a fact in a fresh agent process and then kills that process —
 * which is what a plugin reload or an app restart does. Turn two starts a brand
 * new process, hands it the same session store, and asks for the fact back.
 *
 *   node test/session-resume.mjs devin acp
 *
 * Without a working resume this fails, and the agent reads as though it had
 * forgotten the entire conversation.
 */

import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AcpConnection, SessionStore, buildEnv } from '../index.js';

const command = process.argv[2] ?? 'devin';
const args = process.argv.slice(3);
const workspace = resolve(import.meta.dirname, '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'dsh-resume-'));
const storeFile = join(dir, 'sessions.json');
const KEY = 'resume-probe';
const PLANT = 'Remember this number for later: 7. Reply with just OK.';
const RECALL = 'What number did I ask you to remember? Reply with just the number.';

/** A connection using the shared store file. */
function connect() {
  return new AcpConnection({
    id: command,
    label: command,
    command,
    args,
    cwd: workspace,
    env: buildEnv('minimal', {}),
    timeoutMs: 300_000,
    catalogueTimeoutMs: 60_000,
    approval: 'allow',
    sessionStore: new SessionStore(storeFile),
    // Surface the reason a resume was refused instead of swallowing it.
    logger: { debug: (m) => console.log(`  [debug] ${m}`), warn: (m) => console.log(`  [warn] ${m}`) },
  });
}

try {
  console.log('--- process 1: plant ---');
  const first = connect();
  const session = await first.ensureSession(workspace, KEY);
  console.log(`  created ACP session: ${session.sessionId}  (pid ${first.child?.pid})`);
  const planted = await first.prompt(PLANT, { key: KEY });
  console.log(`  reply: ${JSON.stringify(planted.text.trim().slice(0, 80))}`);
  const created = session.sessionId;
  first.dispose();
  console.log('  process 1 killed (this is what a reload does)');
  console.log(`  store now: ${existsSync(storeFile) ? readFileSync(storeFile, 'utf8').replace(/\s+/g, ' ') : '(none)'}`);

  await new Promise((r) => setTimeout(r, 1_000));

  console.log('\n--- process 2: recall, with the same store ---');
  const second = connect();
  const resumed = await second.ensureSession(workspace, KEY);
  console.log(`  session in use: ${resumed.sessionId}  (pid ${second.child?.pid})`);
  console.log(`  resumed rather than recreated: ${resumed.sessionId === created ? 'yes' : 'NO — a new session was created'}`);
  const recalled = await second.prompt(RECALL, { key: KEY });
  console.log(`  reply: ${JSON.stringify(recalled.text.trim().slice(0, 80))}`);
  second.dispose();

  const kept = /7/.test(recalled.text);
  console.log(kept ? '\nRESULT: PASS — the conversation survived the restart' : '\nRESULT: FAIL — the conversation was lost');
} catch (error) {
  console.log(`\nRESULT: FAIL — ${String(error?.message ?? error)}`);
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  setTimeout(() => process.exit(0), 500);
}
