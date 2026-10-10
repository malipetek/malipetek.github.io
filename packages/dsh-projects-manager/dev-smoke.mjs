/**
 * Local smoke test for the Projects manager host half.
 *
 * Runs outside DSH with a minimal mock context, so the collectors, scoring,
 * briefing and `/projects` command surface can be exercised against the real
 * projects folder without restarting the app. Not shipped: `package.json`
 * `files` omits this path.
 *
 *   node dev-smoke.mjs [projectsRoot]
 */
import { rm } from 'node:fs/promises';

const STATE_DIR = process.env.DSH_PROJECTS_MANAGER_DIR || '/Users/malipetek/.dsh/projects-manager';
const INDEX = `${STATE_DIR}/index.jsonl`;
const BRIEF = `${STATE_DIR}/manager-brief.md`;
const INTENT = `${STATE_DIR}/intent.json`;

if (process.argv.includes('--reset')) {
  await rm(INTENT, { force: true });
  console.log('reset intent store');
}

const { apply } = await import('./index.js');

const disposers = [];
const commands = new Map();
const tools = new Map();

const ctx = {
  effect(body, label) {
    const disposer = body();
    if (typeof disposer === 'function') disposers.push(disposer);
    else if (disposer !== undefined) disposers.push(disposer);
    return () => {};
  },
  interval() {
    return () => {};
  },
  get() {
    return undefined;
  },
  commands: {
    register(definition) {
      commands.set(definition.name, definition);
      return () => commands.delete(definition.name);
    },
  },
  tools: {
    register(definition) {
      tools.set(definition.name, definition);
      return () => tools.delete(definition.name);
    },
  },
};

apply(ctx);

const agent = { session: { id: 'session-smoke-test' } };
const run = async (rawInput) => {
  const result = await commands.get('projects').handler({ agent, rawInput });
  console.log(`\n$ /projects ${rawInput}\n  [${result.kind}] ${result.text}`);
  return result;
};

const started = Date.now();
await run('scan');
console.log(`\nfirst scan took ${Date.now() - started}ms`);

await run('status');
await run('list stalling');

const { readFile } = await import('node:fs/promises');
const records = (await readFile(INDEX, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
console.log(`\nindex: ${records.length} records`);
const byState = {};
for (const record of records) byState[record.momentum.state] = (byState[record.momentum.state] ?? 0) + 1;
console.log('states:', byState);

const interesting = records.filter((record) => record.dsh.turns > 0 || record.momentum.state === 'never-started');
console.log('\nprojects with real DSH history or opened-but-unused:');
for (const record of interesting.slice(0, 12)) {
  const { momentum, dsh, repo } = record;
  console.log(
    `  ${record.name.padEnd(24)} ${momentum.state.padEnd(14)} quiet=${String(momentum.quietDays).padStart(4)}d`
    + ` pace=${String(momentum.cadenceDays).padStart(3)}d(${momentum.cadenceSource})`
    + ` dsh=${dsh.sessions}s/${dsh.turns}t`
    + ` git=${repo.isGit ? `${repo.commits14}/${repo.commitsPrior14}c dirty=${repo.dirty}` : 'no'}`,
  );
}

const top = records.filter((record) => record.momentum.reasons.length > 0)
  .sort((a, b) => b.momentum.score - a.momentum.score)
  .slice(0, 5);
console.log('\ntop scored:');
for (const record of top) {
  console.log(`  ${record.name} (${record.momentum.score})`);
  for (const reason of record.momentum.reasons) console.log(`      - ${reason}`);
  for (const suggestion of record.momentum.suggestions) console.log(`      > ${suggestion}`);
}

console.log(`\nbrief bytes: ${(await readFile(BRIEF, 'utf8')).length}`);
console.log('brief head:');
console.log((await readFile(BRIEF, 'utf8')).split('\n').slice(0, 22).map((line) => `  | ${line}`).join('\n'));

// Exercise the mutation path, then undo it.
await run('cadence ShipFit 3');
await run('next ShipFit smoke-test next action');
await run('snooze ShipFit 7');
let intent = JSON.parse(await readFile(INTENT, 'utf8'));
console.log('\nintent after edits:', JSON.stringify(intent.items, null, 2));
await run('resume ShipFit');
intent = JSON.parse(await readFile(INTENT, 'utf8'));
console.log('intent after resume:', JSON.stringify(intent.items));

const unknown = await run('frobnicate');
if (unknown.kind !== 'error') throw new Error('expected an error for an unknown subcommand');

/* ---------------------------------------------------------------- *
 * Model-facing tool
 * ---------------------------------------------------------------- */

const tool = tools.get('projects_manager');
if (tool === undefined) throw new Error('projects_manager tool was not registered');
console.log(`\ntool registered: ${tool.name}, parameters.required=${JSON.stringify(tool.parameters.required)}`);
if (typeof tool.output?.render !== 'function') throw new Error('tool has no output.render');
if (tool.output.schema?.type !== 'string') throw new Error('unexpected tool output schema');

const call = async (args) => {
  const value = await tool.execute(args, { agent });
  const rendered = tool.output.render(args, value);
  if (!Array.isArray(rendered) || rendered[0]?.type !== 'text') throw new Error('render() did not produce a text block');
  return value;
};

const brief = JSON.parse(await call({ action: 'brief' }));
console.log(`tool brief: ${brief.needsAttention.length} need attention, counts=${JSON.stringify(brief.counts)}`);
if (!Array.isArray(brief.needsAttention)) throw new Error('brief did not return an attention list');

const stalling = JSON.parse(await call({ action: 'list', state: 'stalling' }));
console.log(`tool list(stalling): ${stalling.length} -> ${stalling.map((row) => row.name).join(', ')}`);

const rescan = await call({ action: 'rescan' });
console.log(`tool rescan: ${rescan}`);

const noop = await call({ action: 'intent', project: 'ShipFit' });
if (!noop.startsWith('Nothing to change')) throw new Error(`unexpected intent no-op: ${noop}`);

// An ambiguous name must be refused with the candidates, never guessed at.
const ambiguous = await call({ action: 'intent', project: 'Ship', cadenceDays: 5 });
if (!ambiguous.includes('ambiguous')) throw new Error(`expected an ambiguity refusal, got: ${ambiguous}`);

const changed = await call({ action: 'intent', project: 'ShipFit-poc', cadenceDays: 5, nextAction: 'from the tool' });
console.log(`tool intent: ${changed}`);
const all = JSON.parse(await call({ action: 'list' }));
const poc = all.find((row) => row.name === 'ShipFit-poc');
if (poc === undefined || poc.nextAction !== 'from the tool' || poc.cadenceDays !== 5) {
  throw new Error(`tool intent did not persist: ${JSON.stringify(poc)}`);
}
console.log(`tool intent persisted: ${JSON.stringify(poc)}`);

await run('resume ShipFit');
await run('cadence ShipFit 3');

for (const dispose of disposers.reverse()) {
  try {
    await dispose();
  } catch (error) {
    console.warn('disposer failed:', error);
  }
}
console.log('\nsmoke test complete');
