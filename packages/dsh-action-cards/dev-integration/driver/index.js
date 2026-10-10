/**
 * Integration driver for @malipetek/dsh-action-cards.
 *
 * The offline smoke test drives the plugin against shims shaped like the real
 * services. This drives it against the services themselves: mounted inside a
 * real DSH profile, `ctx.fs` is the sandboxed filesystem, `ctx.shell` is the
 * confined shell, and `ctx.sandboxPolicy` resolves a real session policy.
 *
 * It captures the plugin's own tool and command definitions by applying the
 * plugin against a context whose `tools` and `commands` registries are recording
 * stubs, then drives exactly the calls the Client half makes: propose, then
 * apply with the human's values.
 *
 * `setup.sh` in the parent directory wires a throwaway profile around this file.
 *
 * @module dsh-action-cards/dev-integration/driver
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const PLUGIN = process.env.DSH_ACTION_CARDS_PLUGIN ?? new URL('../../index.js', import.meta.url).pathname;
const REPORT = process.env.DSH_ACTION_CARDS_REPORT ?? '/tmp/dsh-action-cards-verify/report.json';
const WORKSPACE = process.env.DSH_ACTION_CARDS_WORKSPACE ?? '/tmp/dsh-action-cards-verify/workspace';

export const name = 'action-cards-driver';
export const inject = ['tools', 'commands', 'fs', 'sandboxPolicy', 'shell'];

/**
 * Run the scenarios and write the report.
 * @param ctx - the real Host plugin context.
 * @param captured - the plugin's own registrations.
 * @returns the report object.
 */
async function run(ctx, captured) {
  const steps = [];
  const note = (name, ok, detail) => {
    steps.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
    console.log(`[driver] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  };

  const reported = [];
  // A stand-in for a real Session, complete enough for the real
  // `sandboxPolicy.resolve` (which folds the session log to find a mode
  // override) and for the real filesystem and shell to fence against it. The
  // empty log makes the policy fall back to the deployment default, which is
  // exactly the mode a fresh session has.
  const session = {
    id: 'verify-session',
    header: { cwd: WORKSPACE },
    seq: 0,
    inheritedEventCount: 0,
    snapshotEvents: () => [],
    eventAt: () => undefined,
  };
  const agent = {
    session,
    followup: (message) => reported.push(message),
  };
  const policy = ctx.sandboxPolicy.resolve({ session: agent.session });
  note('sandboxPolicy.resolve returns a session policy', typeof policy.workspaceRoot === 'string', { mode: policy.mode, workspaceRoot: policy.workspaceRoot });

  await rm(WORKSPACE, { recursive: true, force: true });
  await mkdir(WORKSPACE, { recursive: true });

  let counter = 0;
  const propose = (args) => {
    counter += 1;
    return captured.tool.execute(args, { callId: `verify-${counter}`, agent, signal: undefined, arguments: args });
  };
  const apply = (id, payload) => captured.command.handler({ agent, rawInput: `apply ${id} ${JSON.stringify(payload)}`, signal: undefined });

  /* 1. write_file through the real sandboxed fs --------------------------- */
  const created = await propose({
    title: 'Create the uploader config',
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
    ],
  });
  note('the tool returned an action id', typeof created.actionId === 'string', created.actionId);
  note('the target did not exist before the apply', created.checks?.['0']?.exists === false, created.checks?.['0']);

  const writeResult = await apply(created.actionId, {
    values: { KOOFR_EMAIL: 'petek@example.com', KOOFR_TOKEN: 'REAL_TOKEN_123' },
    steps: (await JSON.parse(await readFile(join(process.env.DSH_ACTION_CARDS_DIR, 'actions.json'), 'utf8'))).items[created.actionId].steps,
  });
  const writePayload = JSON.parse(writeResult.text);
  note('apply reported success', writePayload.status === 'applied', writePayload.outcomes);
  const written = await readFile(join(WORKSPACE, 'config/uploader.json'), 'utf8');
  note('the real fs wrote the file with the values substituted', written.includes('petek@example.com') && written.includes('REAL_TOKEN_123'), written.replace(/\n/g, ' '));
  note('the real fs created the nested directory', written.length > 0);
  note('the outcome names the operation the real fs reported', /Created|Updated/.test(writePayload.outcomes[0].summary), writePayload.outcomes[0].summary);

  /* 2. edit_file through the real sandboxed fs ---------------------------- */
  await writeFile(join(WORKSPACE, 'app.env'), 'API_URL=http://localhost:3000\nAPI_KEY=replace-me\n', 'utf8');
  const edited = await propose({
    title: 'Point the app at production',
    steps: [{ kind: 'edit_file', path: 'app.env', search: 'API_URL=http://localhost:3000', replace: 'API_URL=https://api.example.com' }],
  });
  note('the edit check counted one match on the real fs', edited.checks?.['0']?.matches === 1, edited.checks?.['0']);
  const store2 = JSON.parse(await readFile(join(process.env.DSH_ACTION_CARDS_DIR, 'actions.json'), 'utf8'));
  const editPayload = JSON.parse((await apply(edited.actionId, { values: {}, steps: store2.items[edited.actionId].steps })).text);
  const editedText = await readFile(join(WORKSPACE, 'app.env'), 'utf8');
  note('apply reported the edit', editPayload.status === 'applied', editPayload.outcomes);
  note('the real fs edit landed', editedText.includes('API_URL=https://api.example.com'), editedText.replace(/\n/g, ' '));
  note('the edit left the rest of the file alone', editedText.includes('API_KEY=replace-me'));

  /* 3. run_command through the real sandboxed shell ----------------------- */
  const ran = await propose({
    title: 'Write a file from a command',
    steps: [{ kind: 'run_command', command: 'echo hello-from-sandbox > from-command.txt && cat from-command.txt' }],
  });
  const store3 = JSON.parse(await readFile(join(process.env.DSH_ACTION_CARDS_DIR, 'actions.json'), 'utf8'));
  const commandPayload = JSON.parse((await apply(ran.actionId, { values: {}, steps: store3.items[ran.actionId].steps })).text);
  note('the real shell ran the command cleanly', commandPayload.status === 'applied', commandPayload.outcomes);
  note('the command reported its exit code', commandPayload.outcomes[0]?.exitCode === 0, commandPayload.outcomes[0]);
  note('the command stdout came back', String(commandPayload.outcomes[0]?.stdout ?? '').includes('hello-from-sandbox'), commandPayload.outcomes[0]?.stdout);
  const fromCommand = await readFile(join(WORKSPACE, 'from-command.txt'), 'utf8').catch(() => null);
  note('the command really ran in the session workspace', fromCommand !== null && fromCommand.includes('hello-from-sandbox'), fromCommand);

  /* 4. a failing command is reported, not swallowed ----------------------- */
  const failed = await propose({ title: 'Run a failing command', steps: [{ kind: 'run_command', command: 'exit 7' }] });
  const store4 = JSON.parse(await readFile(join(process.env.DSH_ACTION_CARDS_DIR, 'actions.json'), 'utf8'));
  const failedPayload = JSON.parse((await apply(failed.actionId, { values: {}, steps: store4.items[failed.actionId].steps })).text);
  note('a non-zero exit is reported as a failure', failedPayload.status === 'failed', failedPayload.outcomes[0]?.summary);
  note('the report to the agent carries the failure', String(failedPayload.report).includes('FAILED'), failedPayload.report?.split('\n')[1]);

  /* 5. the sandbox still fences what it should ---------------------------- */
  const outside = await propose({ title: 'Escape the workspace', steps: [{ kind: 'write_file', path: '/etc/dsh-action-cards-escape.txt', content: 'nope\n' }] });
  const store5 = JSON.parse(await readFile(join(process.env.DSH_ACTION_CARDS_DIR, 'actions.json'), 'utf8'));
  const outsidePayload = JSON.parse((await apply(outside.actionId, { values: {}, steps: store5.items[outside.actionId].steps })).text);
  const escaped = await readFile('/etc/dsh-action-cards-escape.txt', 'utf8').catch(() => null);
  note('a write outside the workspace did not land', escaped === null);
  await rm('/etc/dsh-action-cards-escape.txt', { force: true }).catch(() => {});
  note('the outcome explains the refusal rather than failing silently', typeof outsidePayload.outcomes[0]?.summary === 'string' && outsidePayload.outcomes[0].summary.length > 0, outsidePayload.outcomes[0]?.summary);

  note('the agent was told about at least one outcome', reported.length > 0, `deliveries: ${reported.length}`);
  const delivered = reported[reported.length - 1];
  note('the delivered message is a well-formed user message',
    delivered !== undefined
      && typeof delivered.id === 'string' && delivered.id.length > 0
      && delivered.role === 'user'
      && Array.isArray(delivered.content)
      && delivered.content[0]?.type === 'text'
      && typeof delivered.content[0]?.text === 'string'
      && delivered.content[0].text.length > 0,
    delivered === undefined ? 'nothing delivered' : { id: delivered.id, role: delivered.role, parts: delivered.content?.length, source: delivered.source });
  note('the message is frozen, as the factories freeze theirs', delivered !== undefined && Object.isFrozen(delivered), delivered === undefined ? 'nothing delivered' : Object.isFrozen(delivered));
  note('the message names this plugin on its source', delivered?.source?.kind === 'action-cards', delivered?.source);
  note('the message id is unique across deliveries', new Set(reported.map((message) => message.id)).size === reported.length);

  /* 6. the real registry accepts and projects the definition ------------- */

  // The shim captured the definition instead of registering it. Handing it to
  // the real registry runs the real `assertSupportedJsonSchema` on the output
  // schema, and `schemas()` runs the real projection the model's tool list is
  // built from. A keyword outside the enforced subset, or a parameters object
  // that is not lossless JSON, would break the agent's turn rather than this
  // plugin — so it is worth proving here.
  let disposeTool = null;
  try {
    disposeTool = ctx.tools.register(captured.tool);
    note('the real tool registry accepted the definition', true);
  } catch (error) {
    note('the real tool registry accepted the definition', false, `${error?.name}: ${error?.message}`);
  }
  if (disposeTool !== null) {
    try {
      const schemas = ctx.tools.schemas();
      const projected = schemas.find((schema) => schema.name === captured.tool.name);
      note('the definition projects onto the model-facing tool list', projected !== undefined, `${schemas.length} tool(s) projected`);
      note('the projected schema keeps its parameters intact',
        projected?.parameters?.properties?.steps !== undefined && Array.isArray(projected.parameters.required),
        Object.keys(projected?.parameters?.properties ?? {}).join(', '));
      note('the projected schema explains the step bound in prose',
        String(projected?.parameters?.properties?.steps?.description ?? '').includes('8'),
        projected?.parameters?.properties?.steps?.description);
      note('the projected schema carries the tool description',
        typeof projected?.description === 'string' && /propose/i.test(projected.description),
        `${String(projected?.description ?? '').slice(0, 64)}…`);
    } catch (error) {
      note('the definition projects onto the model-facing tool list', false, `${error?.name}: ${error?.message}`);
    }
    disposeTool();
  }

  return { steps, policy, reported: reported.length, failed: steps.filter((step) => !step.ok).length };
}

export function apply(ctx) {
  const captured = {};
  // Recording stubs for the two registries; everything else forwards to the real
  // context, bound, so `ctx.get`, `ctx.effect` and the service lookups behave.
  const shim = new Proxy({}, {
    get: (_target, key) => {
      if (key === 'tools') return { register: (definition) => { captured.tool = definition; return () => {}; } };
      if (key === 'commands') return { register: (definition) => { captured.command = definition; return () => {}; } };
      const value = ctx[key];
      return typeof value === 'function' ? value.bind(ctx) : value;
    },
    has: () => true,
  });

  void (async () => {
    let report;
    try {
      const plugin = await import(PLUGIN);
      plugin.apply(shim);
      if (captured.tool === undefined) throw new Error('the plugin registered no tool');
      if (captured.command === undefined) throw new Error('the plugin registered no command');
      console.log(`[driver] captured tool "${captured.tool.name}" and command "${captured.command.name}"`);
      report = await run(ctx, captured);
    } catch (error) {
      report = { steps: [{ name: 'driver crashed', ok: false, detail: `${error?.name}: ${error?.message}\n${error?.stack}` }], failed: 1 };
      console.log('[driver] crashed:', error);
    }
    await mkdir(dirname(REPORT), { recursive: true });
    await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`[driver] report written; ${report.failed ?? '?'} failure(s)`);
    process.exit(0);
  })();
}
