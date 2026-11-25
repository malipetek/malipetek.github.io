/**
 * Live probe: build the index over the real session store and exercise the
 * three reads that matter — search, one transcript, catch-up on a project.
 *
 * Writes the real `~/.dsh/recall/index.json`, which is what the app uses, so a
 * run here also warms the cache. Set `DSH_RECALL_KEEP` to index fewer sessions.
 *
 *   node test/probe.mjs [search words] [project]
 */
import { apply } from '../index.js';

const commands = new Map();
const tools = new Map();
const ctx = {
  effect(body) {
    const disposer = body();
    return typeof disposer === 'function' ? disposer : () => {};
  },
  get() {
    return undefined;
  },
  tools: { register(definition) { tools.set(definition.name, definition); return () => tools.delete(definition.name); } },
  commands: { register(definition) { commands.set(definition.name, definition); return () => commands.delete(definition.name); } },
};

apply(ctx);
const tool = tools.get('recall');
if (tool === undefined) throw new Error('the recall tool did not register');
if (commands.get('recall') === undefined) throw new Error('the /recall command did not register');

const call = async (args) => {
  const value = await tool.execute(args, {});
  const rendered = tool.output.render(args, value);
  if (!Array.isArray(rendered) || rendered[0]?.type !== 'text') throw new Error('render() did not produce text');
  return value;
};

const started = Date.now();
const projects = await call({ action: 'projects' });
console.log(`projects view took ${Date.now() - started}ms\n`);
console.log(projects.split('\n').slice(0, 18).join('\n'));

const query = process.argv[2] ?? 'deploy admin';
const found = await call({ action: 'search', query });
console.log(`\n--- search "${query}" ---\n${found.split('\n').slice(0, 16).join('\n')}`);

const id = /`(session-[0-9a-f-]+)`/.exec(found)?.[1];
if (id !== undefined) {
  const transcript = await call({ action: 'session', session: id });
  console.log(`\n--- session ${id} (${transcript.length} chars) ---\n${transcript.split('\n').slice(0, 14).join('\n')}`);
}

const project = process.argv[3] ?? 'ptechsolutions-site';
const catchUp = await call({ action: 'catch_up', project });
console.log(`\n--- catch-up ${project} (${catchUp.length} chars) ---\n${catchUp.split('\n').slice(0, 24).join('\n')}`);

const command = await commands.get('recall').handler({ rawInput: `catch-up ${project}` });
console.log(`\n--- /recall catch-up ${project} ---\n${String(command.text).split('\n').slice(0, 6).join('\n')}`);
console.log(`\nprobe complete in ${Date.now() - started}ms`);
