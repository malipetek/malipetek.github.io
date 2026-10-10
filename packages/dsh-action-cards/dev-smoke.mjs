/**
 * Local smoke test for the Action cards host half.
 *
 * Runs outside DSH with a mock context whose `fs` and `shell` shims are backed
 * by the real filesystem, so the proposal path, the substitution, the write, the
 * edit, the command step and the failure paths can all be exercised against a
 * scratch workspace without restarting the app.
 *
 *   node dev-smoke.mjs
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(tmpdir(), `dsh-action-cards-smoke-${process.pid}`);
const WORKSPACE = join(ROOT, 'workspace');
const STATE_DIR = join(ROOT, 'state');

await rm(ROOT, { recursive: true, force: true });
await mkdir(WORKSPACE, { recursive: true });
await mkdir(STATE_DIR, { recursive: true });

// The plugin reads both paths at import time, so they must be set first.
process.env.DSH_ACTION_CARDS_DIR = STATE_DIR;

const { apply } = await import('./index.js');

/* ---------------------------------------------------------------- *
 * A filesystem shim with the sandbox's shape
 * ---------------------------------------------------------------- */

/** Resolve a possibly-relative path against the session workspace. */
function absolute(path, cwd) {
  return isAbsolute(path) ? path : resolvePath(cwd ?? WORKSPACE, path);
}

/** Count non-overlapping occurrences of a needle. */
function countMatches(text, needle) {
  if (needle.length === 0) return 0;
  let matches = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) return matches;
    matches += 1;
    from = at + needle.length;
  }
}

/** A tagged error, so the plugin's code-based mapping has something to read. */
function fsError(code, message) {
  const error = new Error(message ?? code);
  error.code = code;
  return error;
}

const fsShim = {
  async resolve(path, options) {
    const displayPath = absolute(path, options?.cwd);
    return { targetKey: displayPath, displayPath };
  },
  async stat(target) {
    try {
      const info = await stat(target.displayPath);
      return { version: `${info.mtimeMs}:${info.size}`, type: info.isDirectory() ? 'directory' : 'file', size: info.size };
    } catch {
      return undefined;
    }
  },
  async readText(target) {
    return readFile(target.displayPath, 'utf8');
  },
  async writeText(target, content) {
    const existed = existsSync(target.displayPath);
    await mkdir(dirname(target.displayPath), { recursive: true });
    await writeFile(target.displayPath, content, 'utf8');
    return { operation: existed ? 'update' : 'create', version: 'v', before: null, after: content };
  },
  async editText(target, edit, _expected) {
    if (typeof edit.oldString !== 'string' || edit.oldString.length === 0) throw fsError('FS_EDIT_NOT_FOUND', 'empty');
    const before = await readFile(target.displayPath, 'utf8');
    const matches = countMatches(before, edit.oldString);
    if (matches === 0) throw fsError('FS_EDIT_NOT_FOUND', 'not found');
    if (matches > 1 && edit.replaceAll !== true) throw fsError('FS_AMBIGUOUS_EDIT', 'ambiguous');
    const after = edit.replaceAll === true
      ? before.split(edit.oldString).join(edit.newString)
      : before.replace(edit.oldString, edit.newString);
    await writeFile(target.displayPath, after, 'utf8');
    return { version: 'v2', before, after };
  },
};

/** Record of every command the plugin asked the shell to run. */
const commandsRun = [];
let nextExit = { exitCode: 0, stdout: 'uploaded 3 files\n', stderr: '' };

const shellShim = {
  resolve(request) {
    return { ...request, timeoutMs: request.timeoutMs ?? 1000 };
  },
  async execute(spec) {
    commandsRun.push(spec);
    return {
      async result() {
        return {
          exitCode: nextExit.exitCode,
          signal: null,
          timedOut: false,
          aborted: false,
          timeoutMs: spec.timeoutMs,
          stdout: { text: nextExit.stdout, truncated: false },
          stderr: { text: nextExit.stderr, truncated: false },
          sandbox: { mode: spec.sandboxPolicy?.mode ?? 'workspace-write', denied: false },
        };
      },
    };
  },
};

const tools = new Map();
const commands = new Map();
const reported = [];

const agent = {
  session: { id: 'session-smoke', header: { cwd: WORKSPACE } },
  followup(message) {
    reported.push(message);
  },
};

const ctx = {
  effect(body) {
    body();
    return () => {};
  },
  get(name) {
    if (name === 'fs') return fsShim;
    if (name === 'shell') return shellShim;
    if (name === 'shellEnv') return { collect: () => ({ DSH_SMOKE: '1' }) };
    if (name === 'sandboxPolicy') {
      return { resolve: () => ({ mode: 'workspace-write', workspaceRoot: WORKSPACE, sessionId: 'session-smoke' }) };
    }
    return undefined;
  },
  tools: {
    register(definition) {
      tools.set(definition.name, definition);
      return () => tools.delete(definition.name);
    },
  },
  commands: {
    register(definition) {
      commands.set(definition.name, definition);
      return () => commands.delete(definition.name);
    },
  },
};

apply(ctx);

if (!tools.has('propose_action')) throw new Error('the propose_action tool was not registered');
if (!commands.has('actions')) throw new Error('the /actions command was not registered');
console.log('registered:', [...tools.keys()].join(', '), '/', [...commands.keys()].join(', '));

const tool = tools.get('propose_action');
const command = commands.get('actions');

/** Invoke the tool the way the runtime does. */
let callCounter = 0;
const propose = async (args) => {
  callCounter += 1;
  return tool.execute(args, { callId: `call-${callCounter}`, agent, signal: undefined, arguments: args });
};

/** Invoke the command the way the Client does. */
const run = (rawInput) => command.handler({ agent, rawInput, signal: undefined });

/** Read the store the Client half would read. */
const store = async () => JSON.parse(await readFile(join(STATE_DIR, 'actions.json'), 'utf8'));

/** Parse the JSON the apply path hands back to the card. */
const payloadOf = (result) => JSON.parse(result.text);

/* ---------------------------------------------------------------- *
 * 1. Propose a file with a value the human must supply
 * ---------------------------------------------------------------- */

const created = await propose({
  title: 'Create the uploader config',
  note: 'Paste the app token from Koofr settings.',
  steps: [
    {
      kind: 'write_file',
      path: 'config/uploader.json',
      content: '{\n  "email": "{{KOOFR_EMAIL}}",\n  "token": "{{KOOFR_TOKEN}}"\n}\n',
      fields: [
        { name: 'KOOFR_EMAIL', label: 'Koofr email', value: 'me@example.com' },
        { name: 'KOOFR_TOKEN', label: 'Koofr app token', secret: true },
      ],
    },
    { kind: 'run_command', command: 'node upload.mjs --dry-run' },
  ],
});
console.log('\nproposed:', created.message);
if (created.actionId !== 'call-1') throw new Error(`unexpected action id ${created.actionId}`);
if (!created.message.includes('NOT been carried out yet')) throw new Error('the model was not told the action is pending');
if (!created.message.includes('Koofr app token')) throw new Error('the required value was not reported to the model');

const afterPropose = await store();
const record = afterPropose.items['call-1'];
if (record === undefined) throw new Error('the proposal was not recorded');
if (record.status !== 'pending') throw new Error(`the proposal started as ${record.status}`);
if (record.checks['0']?.exists !== false) throw new Error('the create check did not report the file as new');
if (existsSync(join(WORKSPACE, 'config/uploader.json'))) throw new Error('proposing wrote the file; it must wait for the human');

/* ---------------------------------------------------------------- *
 * 2. Apply it with the human's values
 * ---------------------------------------------------------------- */

const applied = await run(
  `apply call-1 ${JSON.stringify({ values: { KOOFR_EMAIL: 'petek@example.com', KOOFR_TOKEN: 'kf_live_token' }, steps: record.steps })}`,
);
if (applied.kind !== 'success') throw new Error(`apply failed: ${applied.text}`);
const appliedPayload = payloadOf(applied);
if (appliedPayload.status !== 'applied') throw new Error(`apply reported ${appliedPayload.status}`);
if (appliedPayload.outcomes.length !== 2) throw new Error('not every step ran');

const written = await readFile(join(WORKSPACE, 'config/uploader.json'), 'utf8');
console.log('\nwritten file:\n' + written);
if (!written.includes('"email": "petek@example.com"')) throw new Error('the email value was not substituted');
if (!written.includes('"token": "kf_live_token"')) throw new Error('the secret value was not substituted');
if (written.includes('{{')) throw new Error('a placeholder survived into the file');

if (commandsRun.length !== 1) throw new Error(`expected one command, saw ${commandsRun.length}`);
if (commandsRun[0].command !== 'node upload.mjs --dry-run') throw new Error('the command was not run verbatim');
if (commandsRun[0].workdir !== WORKSPACE) throw new Error(`the command ran in ${commandsRun[0].workdir}`);
if (commandsRun[0].sandboxPolicy?.mode !== 'workspace-write') throw new Error('the session sandbox policy was not stamped on the command');

const afterApply = await store();
if (afterApply.items['call-1'].status !== 'applied') throw new Error('the store did not record the apply');
if (afterApply.items['call-1'].values.KOOFR_TOKEN !== 'kf_live_token') throw new Error('the store did not record the values');
console.log('\nreport to agent:\n' + afterApply.items['call-1'].report);
if (!afterApply.items['call-1'].report.includes('2/2 step(s) succeeded')) throw new Error('the report miscounted the steps');
// Outside DSH the delivery import cannot resolve, so the plugin logs and carries
// on; what matters is that the failure never escaped into the apply result.
if (reported.length === 0) console.log('note: agent delivery is unavailable outside DSH, as expected; the report is stored on the record');
else if (reported.length !== 1) throw new Error(`the agent was told ${reported.length} times`);

/* ---------------------------------------------------------------- *
 * 3. Edit an existing file, checked before the human commits
 * ---------------------------------------------------------------- */

await writeFile(join(WORKSPACE, 'app.env'), 'API_URL=http://localhost:3000\nAPI_KEY=replace-me\nDEBUG=true\n', 'utf8');

const edit = await propose({
  title: 'Point the app at production',
  steps: [
    {
      kind: 'edit_file',
      path: 'app.env',
      search: 'API_URL=http://localhost:3000',
      replace: 'API_URL=https://api.example.com',
    },
  ],
});
const editRecord = (await store()).items[edit.actionId];
if (editRecord.checks['0']?.matches !== 1) throw new Error(`the edit check reported ${editRecord.checks['0']?.matches} matches`);
if (!edit.message.includes('NOT been carried out yet')) throw new Error('the edit proposal lost its pending notice');

const editApplied = payloadOf(await run(`apply ${edit.actionId} ${JSON.stringify({ values: {}, steps: editRecord.steps })}`));
if (editApplied.status !== 'applied') throw new Error(`the edit failed: ${JSON.stringify(editApplied.outcomes)}`);
const edited = await readFile(join(WORKSPACE, 'app.env'), 'utf8');
console.log('\nedited file:\n' + edited);
if (!edited.includes('API_URL=https://api.example.com')) throw new Error('the edit did not land');
if (!edited.includes('API_KEY=replace-me')) throw new Error('the edit disturbed the rest of the file');

/* ---------------------------------------------------------------- *
 * 4. Values the human supplies
 * ---------------------------------------------------------------- */

// A placeholder in the replacement is fine: the search text is still real, so
// the Host can count its matches before the human commits.
const deferred = await propose({
  title: 'Swap the placeholder key',
  steps: [
    { kind: 'edit_file', path: 'app.env', search: 'API_KEY=replace-me', replace: 'API_KEY={{NEW_KEY}}', fields: [{ name: 'NEW_KEY', label: 'New API key' }] },
  ],
});
const deferredRecord = (await store()).items[deferred.actionId];
if (deferredRecord.checks['0']?.matches !== 1) throw new Error(`a tokenised replacement was not counted: ${JSON.stringify(deferredRecord.checks['0'])}`);
if (!deferred.message.includes('New API key')) throw new Error('the required value was not reported to the model');

const deferredApply = payloadOf(
  await run(`apply ${deferred.actionId} ${JSON.stringify({ values: { NEW_KEY: 'sk_live_123' }, steps: deferredRecord.steps })}`),
);
if (deferredApply.status !== 'applied') throw new Error(`the edit failed: ${JSON.stringify(deferredApply.outcomes)}`);
if (!(await readFile(join(WORKSPACE, 'app.env'), 'utf8')).includes('API_KEY=sk_live_123')) throw new Error('the supplied value did not reach the file');

// A placeholder in the search text or the path cannot be inspected at all, so
// the check defers rather than reporting a misleading zero.
const tokenisedSearch = await propose({
  title: 'Replace whatever key the user names',
  steps: [
    { kind: 'edit_file', path: 'app.env', search: 'API_KEY={{OLD_KEY}}', replace: 'API_KEY=new', fields: [{ name: 'OLD_KEY', label: 'Current key' }] },
  ],
});
const tokenisedRecord = (await store()).items[tokenisedSearch.actionId];
if (tokenisedRecord.checks['0']?.deferred !== true) throw new Error('a tokenised search text was not deferred');
if (tokenisedRecord.checks['0']?.matches !== undefined) throw new Error('a tokenised search text produced a match count');
await run(`dismiss ${tokenisedSearch.actionId}`);

const tokenisedPath = await propose({
  title: 'Create a file named by the user',
  steps: [{ kind: 'write_file', path: 'notes/{{SLUG}}.md', content: '# hi\n', fields: [{ name: 'SLUG', label: 'File name' }] }],
});
const tokenisedPathRecord = (await store()).items[tokenisedPath.actionId];
if (tokenisedPathRecord.checks['0']?.deferred !== true) throw new Error('a tokenised path was not deferred');
const tokenisedPathApply = payloadOf(
  await run(`apply ${tokenisedPath.actionId} ${JSON.stringify({ values: { SLUG: 'release-notes' }, steps: tokenisedPathRecord.steps })}`),
);
if (tokenisedPathApply.status !== 'applied') throw new Error('a tokenised path failed to apply');
if (!existsSync(join(WORKSPACE, 'notes/release-notes.md'))) throw new Error('the substituted path was not used');
console.log('\ntokenised path wrote notes/release-notes.md');

/* ---------------------------------------------------------------- *
 * 5. Overwrite warning
 * ---------------------------------------------------------------- */

const overwrite = await propose({
  title: 'Rewrite the env file',
  steps: [{ kind: 'write_file', path: 'app.env', content: 'API_URL=https://fresh.example.com\n' }],
});
const overwriteRecord = (await store()).items[overwrite.actionId];
if (overwriteRecord.checks['0']?.exists !== true) throw new Error('the overwrite check missed an existing file');
if (!overwrite.message.includes('will overwrite an existing file')) throw new Error('the model was not warned about the overwrite');
await run(`dismiss ${overwrite.actionId}`);

/* ---------------------------------------------------------------- *
 * 6. Failure paths
 * ---------------------------------------------------------------- */

const badEdit = await propose({
  title: 'Edit text that is not there',
  steps: [{ kind: 'edit_file', path: 'app.env', search: 'NOT_PRESENT_ANYWHERE', replace: 'x' }],
});
const badEditRecord = (await store()).items[badEdit.actionId];
if (badEditRecord.checks['0']?.matches !== 0) throw new Error('the missing-text check did not report zero matches');
const badEditApply = payloadOf(await run(`apply ${badEdit.actionId} ${JSON.stringify({ values: {}, steps: badEditRecord.steps })}`));
if (badEditApply.status !== 'failed') throw new Error(`a zero-match edit reported ${badEditApply.status}`);
if (!badEditApply.outcomes[0].summary.includes('was not found')) throw new Error(`unhelpful failure: ${badEditApply.outcomes[0].summary}`);
console.log('\nfailed edit outcome:', badEditApply.outcomes[0].summary);

nextExit = { exitCode: 2, stdout: 'partial\n', stderr: 'boom: cannot reach the server\n' };
const badCommand = await propose({ title: 'Run a failing command', steps: [{ kind: 'run_command', command: 'node upload.mjs' }] });
const badCommandRecord = (await store()).items[badCommand.actionId];
const badCommandApply = payloadOf(await run(`apply ${badCommand.actionId} ${JSON.stringify({ values: {}, steps: badCommandRecord.steps })}`));
if (badCommandApply.status !== 'failed') throw new Error(`a failing command reported ${badCommandApply.status}`);
if (!badCommandApply.report.includes('boom: cannot reach the server')) throw new Error('the command stderr never reached the agent');
console.log('\nfailed command report:\n' + badCommandApply.report);

// A failure must stop the run: the step after a broken write may depend on it.
const ordered = await propose({
  title: 'Write then run',
  steps: [
    { kind: 'write_file', path: 'app.env', content: 'x' },
    { kind: 'edit_file', path: 'app.env', search: 'NO_SUCH_TEXT', replace: 'y' },
    { kind: 'run_command', command: 'echo should-not-run' },
  ],
});
nextExit = { exitCode: 0, stdout: 'ran\n', stderr: '' };
const orderedRecord = (await store()).items[ordered.actionId];
const beforeCount = commandsRun.length;
const orderedApply = payloadOf(await run(`apply ${ordered.actionId} ${JSON.stringify({ values: {}, steps: orderedRecord.steps })}`));
if (orderedApply.status !== 'partial') throw new Error(`a stopped run reported ${orderedApply.status}`);
if (orderedApply.outcomes.length !== 2) throw new Error('the run did not stop at the failed step');
if (commandsRun.length !== beforeCount) throw new Error('a step after the failure still ran');
console.log('\nstopped run:', orderedApply.outcomes.map((outcome) => `${outcome.ok ? 'ok' : 'fail'}`).join(','));

/* ---------------------------------------------------------------- *
 * 7. Guards and the command surface
 * ---------------------------------------------------------------- */

let rejected = null;
try {
  await propose({ title: 'Bad', steps: [{ kind: 'delete_everything', path: 'x' }] });
} catch (error) {
  rejected = error;
}
if (rejected === null || !String(rejected.message).includes('delete_everything')) throw new Error('an unknown step kind was accepted');
console.log('\nrejected an unknown step kind:', rejected.message);

const listed = await run('list');
if (listed.kind !== 'success' || !listed.text.includes('applied')) throw new Error('list did not report statuses');
console.log('\n' + listed.text.split('\n').slice(0, 6).join('\n'));

const dismissed = await run(`dismiss ${edit.actionId}`);
if (dismissed.kind !== 'success') throw new Error('dismiss failed');
if ((await store()).items[edit.actionId].status !== 'dismissed') throw new Error('dismiss did not stick');

const unknown = await run('frobnicate');
if (unknown.kind !== 'error') throw new Error('an unknown subcommand was accepted');

const pruned = await run('prune');
if (pruned.kind !== 'success') throw new Error('prune failed');
const left = Object.values((await store()).items).filter((item) => item.status !== 'pending').length;
if (left !== 0) throw new Error(`prune left ${left} decided records`);

/* ---------------------------------------------------------------- *
 * 8. A proposal with no values at all still applies
 * ---------------------------------------------------------------- */

const plainSteps = (await store()).items[ordered.actionId]?.steps ?? null;
const simple = await propose({ title: 'Just create a note', steps: [{ kind: 'write_file', path: 'notes/todo.md', content: '# Todo\n' }] });
const simpleRecord = (await store()).items[simple.actionId];
const simpleApply = payloadOf(await run(`apply ${simple.actionId} ${JSON.stringify({ values: {}, steps: simpleRecord.steps })}`));
if (simpleApply.status !== 'applied') throw new Error('a value-free proposal failed');
if (!existsSync(join(WORKSPACE, 'notes/todo.md'))) throw new Error('a nested directory was not created');

/* ---------------------------------------------------------------- *
 * 9. The wiring report
 * ---------------------------------------------------------------- */

const doctor = JSON.parse(await readFile(join(STATE_DIR, 'doctor.json'), 'utf8'));
console.log('\ndoctor:', JSON.stringify(doctor));
if (doctor.plugin !== 'action-cards') throw new Error('the doctor does not name the plugin');
if (doctor.tool !== 'ready') throw new Error(`the doctor reports the tool as ${doctor.tool}`);
if (doctor.command !== 'ready') throw new Error(`the doctor reports the command as ${doctor.command}`);
if (doctor.services.fs !== 'ready') throw new Error('the doctor did not see the filesystem');
if (doctor.services.sandboxPolicy !== 'ready') throw new Error('the doctor did not see the sandbox policy');
if (doctor.services.shell !== 'ready') throw new Error('the doctor did not see the shell');
if (doctor.store !== join(STATE_DIR, 'actions.json')) throw new Error(`the doctor reports the wrong store: ${doctor.store}`);

await rm(ROOT, { recursive: true, force: true });
console.log('\nhost smoke test complete');
