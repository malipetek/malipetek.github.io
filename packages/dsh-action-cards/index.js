/**
 * Host half of the Action cards bundle.
 *
 * The Client half renders an editable card; this half is what makes the card
 * mean something. It owns three things:
 *
 * 1. The `propose_action` tool. The model calls it with a title, an optional
 *    note, and one to eight steps. Each step is a `write_file`, an `edit_file`
 *    or a `run_command`, and may declare `fields` — named values the human must
 *    supply, written into the step's text as `{{name}}`. At propose time the
 *    Host also *checks* each step (does the target exist? does the text to
 *    replace occur exactly once?) so the card can warn before the human
 *    commits, rather than failing after.
 * 2. The `/actions` command, which the Client drives through
 *    `remote.commands.execute`. Applying sends the human's edited values and
 *    the steps back here; the Host substitutes, executes through the sandboxed
 *    `ctx.fs` and `ctx.shell`, records the outcome, and reports it to the agent.
 *    No model turn is spent reaching the Host, and the command never enters the
 *    transcript.
 * 3. The action store, one JSON file under {@link STATE_DIR}, which the Client
 *    half reads through the session-scoped file Remote. It is the only shared
 *    state between the two halves — the card carries the proposal itself in the
 *    tool call's arguments, so a missing or stale store degrades the history but
 *    never blocks an apply.
 *
 * Everything that touches disk or a process goes through the sandboxed services
 * (`ctx.fs` with the session's `sandboxPolicy`, `ctx.shell`), never `node:fs`
 * and never `child_process`, so the file sandbox and the confinement runner
 * still apply.
 *
 * @module @malipetek/dsh-action-cards
 */
import { homedir } from 'node:os';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/* -------------------------------------------------------------------------- *
 * Configuration — the store path is mirrored by `client.js`; change both.
 * -------------------------------------------------------------------------- */

/**
 * DSH's own home. `DSH_HOME` wins when the launcher sets it. The literal in
 * `client.js` (`DEFAULT_STORE_PATH`) assumes the default `~/.dsh`; the resolved
 * path also travels to the card in the tool result's metadata, which is the
 * authority whenever the two disagree.
 */
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
/** Where the action store lives. `DSH_ACTION_CARDS_DIR` overrides it for smoke tests. */
const STATE_DIR = process.env.DSH_ACTION_CARDS_DIR || join(DSH_HOME, 'action-cards');
/** The single store file both halves share. */
const STORE_PATH = join(STATE_DIR, 'actions.json');

/**
 * Version of this bundle, mirrored by `CLIENT_VERSION` in `client.js`.
 *
 * Both halves report it to disk — the Host in `doctor.json`, the Client by
 * calling `/actions hello` at mount, which lands in `client.json`. That is how a
 * change is confirmed to be *live* rather than merely saved: the Client bundle is
 * fetched by the browser, so a stale one looks exactly like a working one until
 * you can ask it what version it is. Bump both together.
 */
const PLUGIN_VERSION = '1.2.0';

/** Steps one proposal may carry. Each is executed in order, stopping at the first failure. */
const MAX_STEPS = 8;
/** Characters accepted in one substituted value. */
const MAX_FIELD_CHARS = 20000;
/** Field declarations one proposal may carry. */
const MAX_FIELDS = 24;
/** Whole-store ceiling; oldest decided records are dropped beyond it. */
const MAX_ITEMS = 200;
/** Deadline for one `run_command` step. */
const DEFAULT_COMMAND_TIMEOUT_MS = 120000;
/** Characters of a command's output kept in the outcome record. */
const MAX_OUTPUT_CHARS = 4000;
/** Characters of the report sent back to the agent. */
const MAX_REPORT_CHARS = 1200;
/**
 * Delay before the wiring report is probed a second time.
 *
 * Long enough for the host plane to have mounted the services this plugin reads
 * lazily, short enough that a `doctor.json` read a minute after launch is not
 * stale. See {@link publishDoctor}.
 */
const DOCTOR_REPROBE_MS = 10000;

/**
 * Whether applying an action wakes the agent with the outcome.
 *
 * The human asked for the Host to report back, so this is on: the agent learns
 * what actually happened instead of assuming its proposal was followed. It costs
 * one model turn per apply.
 */
const REPORT_TO_AGENT = true;

/**
 * Matches a `{{ name }}` placeholder. Mirrored by `TOKEN` in `client.js`; this
 * copy is the authoritative one.
 */
const TOKEN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

/* -------------------------------------------------------------------------- *
 * Small utilities
 * -------------------------------------------------------------------------- */

/**
 * Resolve the sandbox policy for one agent.
 *
 * The policy is always resolved *with the session*, because the service's
 * session-less fallback fences against the deployment root rather than the
 * session workspace — which would deny a write the session may legitimately
 * make. The service is read lazily so a composition without it still loads.
 *
 * @param ctx - the Host plugin context.
 * @param agent - the agent the action runs for.
 * @returns `{ mode, workspaceRoot }`.
 */
function policyFor(ctx, agent) {
  const service = ctx.get('sandboxPolicy');
  if (service === undefined || service === null) {
    return { mode: 'workspace-write', workspaceRoot: agent?.session?.header?.cwd ?? process.cwd() };
  }
  return service.resolve(agent === undefined || agent === null ? {} : { session: agent.session });
}

/**
 * Reduce any thrown value to displayable text.
 * @param error - the caught value.
 * @returns a message string.
 */
function messageOf(error) {
  if (error === null || error === undefined) return 'unknown error';
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string' && error.message.length > 0) return error.message;
  return String(error);
}

/**
 * Turn a filesystem failure into something a human can act on.
 *
 * The codes are the `FsError` vocabulary the fs tools already use; they are read
 * off the error rather than imported, so this bundle depends on no package the
 * application does not already provide.
 *
 * @param error - the caught value.
 * @param policy - the resolved sandbox policy, for the denial message.
 * @returns a one-line explanation.
 */
function explain(error, policy) {
  const code = error !== null && typeof error === 'object' ? error.code : undefined;
  const mode = policy !== null && typeof policy === 'object' ? policy.mode : undefined;
  if (code === 'FS_SANDBOX_DENIED') return `[sandbox: file access denied under ${mode ?? 'workspace-write'} mode]`;
  if (code === 'FS_NOT_OBSERVED') return 'the file must be read before it can be modified';
  if (code === 'FS_STALE_VERSION') return 'the file changed underneath the edit; re-propose it';
  if (code === 'FS_EDIT_NOT_FOUND') return 'the text to replace was not found in the file';
  if (code === 'FS_AMBIGUOUS_EDIT') return 'the text to replace occurs more than once; set replaceAll or match more text';
  if (code === 'FS_NOT_FOUND') return 'the file does not exist';
  if (code === 'FS_NOT_REGULAR_FILE') return 'the path is not a regular file';
  if (code === 'FS_NOT_TEXT') return 'the file is not UTF-8 text';
  if (code === 'FS_TOO_LARGE') return 'the file is too large to read';
  if (code === 'SANDBOX_UNAVAILABLE') return 'the confinement runner is unavailable';
  return messageOf(error);
}

/**
 * Replace every `{{ name }}` placeholder with the supplied value.
 * @param text - the template text.
 * @param values - field name to value.
 * @returns the substituted text.
 */
function substitute(text, values) {
  if (typeof text !== 'string' || text.length === 0) return text;
  return text.replace(TOKEN, (whole, name) => {
    const value = values[name];
    return value === undefined || value === null ? whole : String(value);
  });
}

/**
 * Whether a string still carries a placeholder.
 * @param text - the candidate.
 * @returns true when a `{{…}}` token is present.
 */
function hasToken(text) {
  return typeof text === 'string' && /\{\{\s*[A-Za-z0-9_.-]+\s*\}\}/.test(text);
}

/**
 * Clamp a string to a maximum length.
 * @param value - the candidate.
 * @param max - the ceiling.
 * @returns the clamped string.
 */
function clampText(value, max) {
  if (typeof value !== 'string') return '';
  return value.length <= max ? value : `${value.slice(0, max)}\n… (${value.length - max} more characters)`;
}

/* -------------------------------------------------------------------------- *
 * The action store
 * -------------------------------------------------------------------------- */

/** Serialises store mutations so an apply and a dismiss cannot lose each other. */
let storeQueue = Promise.resolve();

/**
 * Read the store, tolerating a missing or torn file.
 * @returns `{ version, items }`.
 */
async function readStore() {
  try {
    const parsed = JSON.parse(await readFile(STORE_PATH, 'utf8'));
    const items = parsed !== null && typeof parsed === 'object' && parsed.items !== null && typeof parsed.items === 'object' ? parsed.items : {};
    return { version: 1, items };
  } catch {
    return { version: 1, items: {} };
  }
}

/**
 * Write the store atomically, so a reader never sees a half-written file.
 * @param store - the complete next store.
 */
async function writeStore(store) {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  const temporary = `${STORE_PATH}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await rename(temporary, STORE_PATH);
}

/**
 * Drop the oldest decided records once the store is over its ceiling.
 * @param store - the store, mutated in place.
 */
function pruneStore(store) {
  const entries = Object.values(store.items);
  if (entries.length <= MAX_ITEMS) return;
  const decided = entries
    .filter((item) => item.status !== 'pending')
    .sort((left, right) => (Number(left.createdAt) || 0) - (Number(right.createdAt) || 0));
  for (const item of decided) {
    if (Object.keys(store.items).length <= MAX_ITEMS) break;
    delete store.items[item.id];
  }
}

/**
 * Run one store mutation under the queue, writing the result back.
 * @param body - receives the store and mutates it; its return value is passed through.
 * @returns the body's return value.
 */
function mutate(body) {
  const next = storeQueue.then(async () => {
    const store = await readStore();
    const result = await body(store);
    pruneStore(store);
    await writeStore(store);
    return result;
  });
  // A failed mutation must not poison the queue for the next one.
  storeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Insert or replace one record.
 * @param item - the complete record.
 * @returns the stored record.
 */
async function putItem(item) {
  return mutate((store) => {
    store.items[item.id] = item;
    return item;
  });
}

/**
 * Merge a patch into one record, if it exists.
 * @param id - the record identity.
 * @param patch - fields to merge.
 * @returns the patched record, or null when the store has no such record.
 */
async function patchItem(id, patch) {
  return mutate((store) => {
    const current = store.items[id];
    if (current === undefined) return null;
    const next = { ...current, ...patch, updatedAt: Date.now() };
    store.items[id] = next;
    return next;
  });
}

/* -------------------------------------------------------------------------- *
 * Proposal normalisation
 * -------------------------------------------------------------------------- */

/** Step kinds the Host knows how to execute. */
const STEP_KINDS = ['write_file', 'edit_file', 'run_command'];

/**
 * Validate and copy the model's raw arguments into a proposal.
 *
 * The model's schema is advisory — it can be ignored — so every field is
 * re-checked here before anything reaches the store or the filesystem.
 *
 * @param args - the tool arguments.
 * @returns the proposal, or an error string.
 */
function normalizeProposal(args) {
  const title = typeof args?.title === 'string' && args.title.trim().length > 0 ? args.title.trim() : 'Proposed action';
  const note = typeof args?.note === 'string' ? args.note.trim() : '';
  const rawSteps = Array.isArray(args?.steps) ? args.steps : null;
  if (rawSteps === null || rawSteps.length === 0) return { error: 'Give at least one step.' };
  if (rawSteps.length > MAX_STEPS) return { error: `At most ${MAX_STEPS} steps are allowed.` };

  const steps = [];
  let fieldCount = 0;
  for (let index = 0; index < rawSteps.length; index += 1) {
    const raw = rawSteps[index];
    if (raw === null || typeof raw !== 'object') return { error: `Step ${index + 1} is not an object.` };
    const kind = typeof raw.kind === 'string' ? raw.kind : '';
    if (!STEP_KINDS.includes(kind)) {
      return { error: `Step ${index + 1} has kind "${kind}"; use one of ${STEP_KINDS.join(', ')}.` };
    }

    const step = { kind };
    if (typeof raw.label === 'string' && raw.label.trim().length > 0) step.label = raw.label.trim();

    if (kind === 'run_command') {
      if (typeof raw.command !== 'string' || raw.command.trim().length === 0) {
        return { error: `Step ${index + 1} needs a "command".` };
      }
      step.command = raw.command;
      if (typeof raw.cwd === 'string' && raw.cwd.trim().length > 0) step.cwd = raw.cwd;
    } else {
      if (typeof raw.path !== 'string' || raw.path.trim().length === 0) {
        return { error: `Step ${index + 1} needs a "path".` };
      }
      step.path = raw.path;
      if (kind === 'write_file') {
        if (typeof raw.content !== 'string') return { error: `Step ${index + 1} needs "content".` };
        step.content = raw.content;
      } else {
        if (typeof raw.search !== 'string' || raw.search.length === 0) {
          return { error: `Step ${index + 1} needs "search": the exact text to replace.` };
        }
        if (typeof raw.replace !== 'string') return { error: `Step ${index + 1} needs "replace".` };
        step.search = raw.search;
        step.replace = raw.replace;
        if (raw.replaceAll === true) step.replaceAll = true;
      }
    }

    if (Array.isArray(raw.fields)) {
      const fields = [];
      for (const rawField of raw.fields) {
        if (rawField === null || typeof rawField !== 'object') continue;
        const name = typeof rawField.name === 'string' ? rawField.name.trim() : '';
        if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
          return { error: `Step ${index + 1} has an invalid field name "${name}"; use letters, digits, dot, dash or underscore.` };
        }
        fieldCount += 1;
        if (fieldCount > MAX_FIELDS) return { error: `At most ${MAX_FIELDS} fields are allowed.` };
        fields.push({
          name,
          label: typeof rawField.label === 'string' && rawField.label.length > 0 ? rawField.label : name,
          ...(typeof rawField.hint === 'string' && rawField.hint.length > 0 ? { hint: rawField.hint } : {}),
          ...(typeof rawField.value === 'string' ? { value: rawField.value } : {}),
          ...(rawField.secret === true ? { secret: true } : {}),
        });
      }
      if (fields.length > 0) step.fields = fields;
    }

    steps.push(step);
  }

  return { proposal: { title, note, steps } };
}

/**
 * Sanitise the values the Client sends back.
 * @param raw - the parsed `values` field.
 * @returns a plain string map.
 */
function normalizeValues(raw) {
  const values = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return values;
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value !== 'string') continue;
    values[name] = value.slice(0, MAX_FIELD_CHARS);
  }
  return values;
}

/* -------------------------------------------------------------------------- *
 * Checking a proposal before the human commits
 * -------------------------------------------------------------------------- */

/**
 * Resolve a step's path against the session workspace.
 * @param fs - the fs service.
 * @param policy - the resolved sandbox policy.
 * @param path - the author's path.
 * @param signal - the call's signal.
 * @returns the resolved target.
 */
function resolveTarget(fs, policy, path, signal) {
  return fs.resolve(path, { cwd: policy.workspaceRoot, signal });
}

/**
 * Inspect one step so the card can warn before the human applies it.
 *
 * A `write_file` reports whether it will overwrite; an `edit_file` reports how
 * many times its search text occurs, which is the difference between a clean
 * edit and `FS_AMBIGUOUS_EDIT` (or `FS_EDIT_NOT_FOUND`).
 *
 * @param ctx - the Host plugin context.
 * @param policy - the resolved sandbox policy.
 * @param step - the normalised step.
 * @param signal - the call's signal.
 * @returns a check record, or null when nothing can be said.
 */
async function checkStep(ctx, policy, step, signal) {
  const fs = ctx.get('fs');
  if (fs === undefined || fs === null) return null;
  try {
    // A path or a search text that still holds a placeholder cannot be inspected:
    // the human has not supplied the value yet, so there is nothing to look up.
    if (hasToken(step.path)) return { deferred: true };
    if (step.kind === 'write_file') {
      const target = await resolveTarget(fs, policy, step.path, signal);
      const info = await fs.stat(target, signal);
      return { path: target.displayPath, exists: info !== undefined, size: info?.size ?? 0 };
    }
    if (step.kind === 'edit_file') {
      const target = await resolveTarget(fs, policy, step.path, signal);
      if (hasToken(step.search)) return { path: target.displayPath, deferred: true };
      const info = await fs.stat(target, signal);
      if (info === undefined) return { path: target.displayPath, missing: true };
      const text = await fs.readText(target, signal);
      let matches = 0;
      let from = 0;
      for (;;) {
        const at = text.indexOf(step.search, from);
        if (at === -1) break;
        matches += 1;
        from = at + step.search.length;
        if (matches > 50) break;
      }
      return { path: target.displayPath, matches };
    }
  } catch (error) {
    return { error: explain(error, policy) };
  }
  return null;
}

/**
 * Check every step, keyed by its index. Failures are recorded, never thrown:
 * a proposal the Host cannot inspect is still a proposal the human may want.
 * @param ctx - the Host plugin context.
 * @param policy - the resolved sandbox policy.
 * @param steps - the normalised steps.
 * @param signal - the call's signal.
 * @returns an index-keyed check map.
 */
async function checkSteps(ctx, policy, steps, signal) {
  const checks = {};
  for (let index = 0; index < steps.length; index += 1) {
    const check = await checkStep(ctx, policy, steps[index], signal);
    if (check !== null) checks[String(index)] = check;
  }
  return checks;
}

/* -------------------------------------------------------------------------- *
 * Execution
 * -------------------------------------------------------------------------- */

/**
 * Write one file through the sandboxed filesystem.
 *
 * The human has already seen the path and the content on the card, so the write
 * is unconditional: the observation policy's read-before-write guard exists to
 * stop an *agent* clobbering a file it never read, and the card is the human's
 * replacement for that guard. The proposal's own check told them it would
 * overwrite.
 *
 * @param ctx - the Host plugin context.
 * @param policy - the resolved sandbox policy.
 * @param step - the substituted step.
 * @param signal - the apply's signal.
 * @returns an outcome summary.
 */
async function runWrite(ctx, policy, step, signal) {
  const fs = ctx.get('fs');
  if (fs === undefined || fs === null) throw new Error('the filesystem service is unavailable');
  const target = await resolveTarget(fs, policy, step.path, signal);
  const outcome = await fs.writeText(target, step.content, undefined, signal, policy);
  const bytes = Buffer.byteLength(outcome.after ?? step.content, 'utf8');
  return {
    summary: `${outcome.operation === 'create' ? 'Created' : 'Updated'} ${target.displayPath} (${bytes} bytes)`,
    detail: { path: target.displayPath, operation: outcome.operation, bytes },
  };
}

/**
 * Apply one find-and-replace edit through the sandboxed filesystem.
 * @param ctx - the Host plugin context.
 * @param policy - the resolved sandbox policy.
 * @param step - the substituted step.
 * @param signal - the apply's signal.
 * @returns an outcome summary.
 */
async function runEdit(ctx, policy, step, signal) {
  const fs = ctx.get('fs');
  if (fs === undefined || fs === null) throw new Error('the filesystem service is unavailable');
  const target = await resolveTarget(fs, policy, step.path, signal);
  const info = await fs.stat(target, signal);
  if (info === undefined) throw new Error(`the file does not exist: ${target.displayPath}`);
  const outcome = await fs.editText(
    target,
    { oldString: step.search, newString: step.replace, replaceAll: step.replaceAll === true },
    { version: info.version },
    signal,
    policy,
  );
  const delta = (outcome.after?.length ?? 0) - (outcome.before?.length ?? 0);
  return {
    summary: `Edited ${target.displayPath} (${delta >= 0 ? '+' : ''}${delta} characters)`,
    detail: { path: target.displayPath, delta },
  };
}

/**
 * Run one command through the sandboxed shell.
 * @param ctx - the Host plugin context.
 * @param policy - the resolved sandbox policy.
 * @param agent - the agent the apply ran against, for the shell environment.
 * @param step - the substituted step.
 * @param signal - the apply's signal.
 * @returns an outcome summary.
 */
async function runCommandStep(ctx, policy, agent, step, signal) {
  const shell = ctx.get('shell');
  if (shell === undefined || shell === null) throw new Error('command execution is unavailable in this composition');
  const shellEnv = ctx.get('shellEnv');
  const request = {
    command: step.command,
    workdir: typeof step.cwd === 'string' && step.cwd.length > 0 ? step.cwd : policy.workspaceRoot,
    timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
    sandboxPolicy: policy,
    signal,
  };
  if (shellEnv !== undefined && shellEnv !== null && agent !== undefined) {
    try {
      request.dshEnv = shellEnv.collect({ agent });
    } catch {
      // The DSH_* overlay is a convenience; the command still runs without it.
    }
  }
  const handle = await shell.execute(shell.resolve(request));
  const result = await handle.result();
  const code = result.exitCode;
  const failed = result.timedOut === true || result.aborted === true || (typeof code === 'number' && code !== 0);
  const summary = result.timedOut === true
    ? `Timed out after ${Math.round((result.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS) / 1000)}s: ${step.command}`
    : `Ran ${step.command} — exit ${code ?? 'none'}${result.aborted === true ? ' (aborted)' : ''}`;
  if (failed) {
    const error = new Error(summary);
    error.commandOutput = { stdout: result.stdout?.text ?? '', stderr: result.stderr?.text ?? '' };
    // The summary already names the step and its exit, so the caller must not
    // prefix it a second time.
    error.stepSummary = summary;
    throw error;
  }
  return {
    summary,
    detail: {
      exitCode: code,
      stdout: clampText(result.stdout?.text ?? '', MAX_OUTPUT_CHARS),
      stderr: clampText(result.stderr?.text ?? '', MAX_OUTPUT_CHARS),
      stdoutTruncated: result.stdout?.truncated === true,
    },
  };
}

/**
 * Execute a proposal's steps in order.
 *
 * Execution stops at the first failure: a later step usually depends on the file
 * an earlier one was to write, so running it anyway would produce a confusing
 * second failure rather than a clear first one.
 *
 * @param ctx - the Host plugin context.
 * @param agent - the agent the apply ran against.
 * @param signal - the apply's signal.
 * @param proposal - `{ steps }`, already normalised and substituted.
 * @returns the outcome list.
 */
async function executeSteps(ctx, agent, signal, proposal) {
  const policy = policyFor(ctx, agent);
  const outcomes = [];
  for (let index = 0; index < proposal.steps.length; index += 1) {
    const step = proposal.steps[index];
    try {
      let result;
      if (step.kind === 'write_file') result = await runWrite(ctx, policy, step, signal);
      else if (step.kind === 'edit_file') result = await runEdit(ctx, policy, step, signal);
      else result = await runCommandStep(ctx, policy, agent, step, signal);
      outcomes.push({ index, kind: step.kind, ok: true, summary: result.summary, ...(step.label === undefined ? {} : { label: step.label }), ...result.detail });
    } catch (error) {
      const detail = error !== null && typeof error === 'object' && error.commandOutput !== undefined ? error.commandOutput : {};
      const reason = explain(error, policy);
      // A failed command already builds a complete sentence; a filesystem failure
      // needs the step named for it.
      const summary = error !== null && typeof error === 'object' && typeof error.stepSummary === 'string'
        ? error.stepSummary
        : `${step.label ?? stepTitle(step)} — ${reason}`;
      outcomes.push({
        index,
        kind: step.kind,
        ok: false,
        summary,
        error: reason,
        ...(typeof detail.stdout === 'string' && detail.stdout.length > 0 ? { stdout: clampText(detail.stdout, MAX_OUTPUT_CHARS) } : {}),
        ...(typeof detail.stderr === 'string' && detail.stderr.length > 0 ? { stderr: clampText(detail.stderr, MAX_OUTPUT_CHARS) } : {}),
      });
      break;
    }
  }
  return outcomes;
}

/**
 * A short human name for a step, used in outcome lines.
 * @param step - the step.
 * @returns the label.
 */
function stepTitle(step) {
  if (step?.label !== undefined) return step.label;
  if (step?.kind === 'write_file') return `Create ${step.path}`;
  if (step?.kind === 'edit_file') return `Edit ${step.path}`;
  if (step?.kind === 'run_command') return `Run ${step.command}`;
  return 'Step';
}

/**
 * Compose the report the agent receives after an apply.
 * @param item - the stored record, after execution.
 * @returns a compact report.
 */
function buildReport(item) {
  const lines = [];
  const applied = item.outcomes.filter((outcome) => outcome.ok === true).length;
  lines.push(`The user applied the action you proposed: "${item.title}" (${applied}/${item.outcomes.length} step(s) succeeded).`);
  for (const outcome of item.outcomes) {
    lines.push(`${outcome.ok === true ? 'OK' : 'FAILED'}  ${outcome.summary}`);
    const stdout = typeof outcome.stdout === 'string' && outcome.stdout.trim().length > 0 ? outcome.stdout.trim() : '';
    if (stdout.length > 0) lines.push(`  output: ${stdout.split('\n').slice(0, 12).join('\n  ')}`);
    const stderr = typeof outcome.stderr === 'string' && outcome.stderr.trim().length > 0 ? outcome.stderr.trim() : '';
    if (stderr.length > 0) lines.push(`  stderr: ${stderr.split('\n').slice(0, 12).join('\n  ')}`);
  }
  if (item.status === 'failed') lines.push('Nothing after the failed step ran. Propose a corrected action if the goal still matters.');
  else if (item.status === 'partial') lines.push('Some steps did not run. Propose the remainder if the goal still matters.');
  return clampText(lines.join('\n'), MAX_REPORT_CHARS);
}

/**
 * Read the JSON payload that follows an id in a command line.
 *
 * Anchored on the verb so an id that happens to be a substring of it cannot
 * misplace the cut, and tolerant of no payload at all.
 *
 * @param text - the raw command line, verb included.
 * @param id - the id token the payload follows.
 * @returns `{ payload }`, or `{ error }` when the tail is not JSON.
 */
function payloadFrom(text, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\S+\\s+${escaped}(?:\\s+([\\s\\S]*))?$`).exec(String(text).trim());
  const tail = (match?.[1] ?? '').trim();
  if (tail.length === 0) return { payload: {} };
  try {
    const payload = JSON.parse(tail);
    return { payload: payload !== null && typeof payload === 'object' ? payload : {} };
  } catch (error) {
    return { error: `The action payload is not valid JSON: ${messageOf(error)}` };
  }
}

/**
 * Compose the message for a proposal the human handed back.
 *
 * Some proposals are work the agent could have done itself, and handing it to the
 * human is a way of handing over the responsibility. The "You do it" button says
 * so. The message deliberately does **not** carry the field values: those are
 * masked on the panel precisely so a token does not travel through the
 * conversation, and forwarding them here would spend that for nothing. The steps
 * are named without their contents, because the tool call is already in context
 * and will be re-read if the log is compacted.
 *
 * @param item - the stored record.
 * @returns a compact report.
 */
function buildDelegation(item, note) {
  const lines = [];
  lines.push(`The user declined to apply the action you proposed and asked you to do it yourself: "${item.title}".`);
  lines.push(`Action id: ${item.id}`);
  lines.push('Nothing was written, and no command was run.');
  if (typeof note === 'string' && note.trim().length > 0) {
    lines.push(`They also said how to do it: ${note.trim()}`);
  }
  if (Array.isArray(item.steps) && item.steps.length > 0) {
    lines.push('The steps you proposed were:');
    item.steps.forEach((step, index) => {
      const what = step.kind === 'run_command'
        ? `run_command  ${step.command ?? ''}`
        : `${step.kind}  ${step.path ?? ''}`;
      lines.push(`${index + 1}. ${what}`);
    });
  }
  lines.push('Carry it out with your own tools now. The exact contents and arguments are in your tool call above.');
  lines.push('If you genuinely cannot — the work needs something only they have, or access you do not — say so with the `return_action` tool instead of replying in prose, and explain why their request is justified. They will have to tell you how to proceed before handing it back again.');
  if (Array.isArray(item.steps) && item.steps.some((step) => Array.isArray(step.fields) && step.fields.length > 0)) {
    lines.push('No field values were passed on: the ones the user typed are masked, and are not in this conversation.');
  }
  return clampText(lines.join('\n'), MAX_REPORT_CHARS);
}

/**
 * Freeze a message graph, the way the message factories do before publication.
 * @param value - the value to freeze, recursively.
 * @returns the same value.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

/**
 * Build the user message that carries an apply outcome back to the agent.
 *
 * The first-party pattern is `createUserMessage(...)` from
 * `@deepseek-ai/dsh-llm` followed by `agent.followup(...)` — that is what
 * `@deepseek-ai/dsh-schedule` does to deliver a reminder. A profile-installed
 * plugin cannot take that route: the Harness packages live inside the
 * application's asar, while a plugin's realpath is the workspace directory, so a
 * bare `import('@deepseek-ai/dsh-llm')` fails with `ERR_MODULE_NOT_FOUND`. (The
 * two other local plugins call that import and silently lose their delivery.)
 *
 * `createUserMessage` is `{ ...input, role: "user", id }` and nothing more, so
 * the message is reproduced here field for field, and the import is still tried
 * first in case a future composition makes it resolvable. The inbox projection
 * validates only that a message id is unique among pending messages — its
 * entries are `z.custom()` — so a hand-built message is admitted on the same
 * terms as a factory-built one.
 *
 * @param text - the report body.
 * @param actionId - the proposal identity, recorded on the message source.
 * @returns the message to hand to `agent.followup`.
 */
async function buildReportMessage(text, actionId) {
  const content = [{ type: 'text', text }];
  const source = { kind: 'action-cards', actionId };
  try {
    const { createUserMessage } = await import('@deepseek-ai/dsh-llm');
    return createUserMessage({ content, source });
  } catch {
    const { randomUUID } = await import('node:crypto');
    return deepFreeze({ id: randomUUID(), role: 'user', content, source });
  }
}

/* -------------------------------------------------------------------------- *
 * Plugin
 * -------------------------------------------------------------------------- */

/** Services this Host plugin needs; everything else is read lazily with `ctx.get`. */
export const name = 'action-cards';
export const inject = ['tools', 'commands'];

/**
 * Register the `propose_action` tool, the `/actions` command and the store.
 * @param ctx - the Host plugin context.
 */
export function apply(ctx) {
  const COMMAND_NAME = 'actions';
  const TOOL_NAME = 'propose_action';
  /** Path of the wiring report; see {@link publishDoctor}. */
  const DOCTOR_PATH = join(STATE_DIR, 'doctor.json');

  /**
   * Wiring report: which capabilities this plugin actually reached in the running
   * Host.
   *
   * Everything here is read lazily through `ctx.get`, so a missing service
   * degrades rather than failing the load — which also means a missing service is
   * otherwise invisible. This file makes it visible from disk, in the same spirit
   * as `dsh-projects-manager`'s doctor, so a plugin that loaded but cannot write a
   * file or run a command can be told apart from one that never loaded.
   */
  const doctor = {
    plugin: name,
    version: PLUGIN_VERSION,
    updatedAt: 0,
    probe: 'boot',
    tool: 'pending',
    toolError: null,
    returnTool: 'pending',
    returnToolError: null,
    command: 'pending',
    services: {},
    store: STORE_PATH,
  };

  /**
   * Probe and persist the wiring report.
   *
   * The Host plane mounts its services around this plugin, so a probe taken
   * during `apply` can report `fs`, `sandboxPolicy` and `shell` as unavailable
   * even though they are present by the time anything runs — `checkStep` already
   * resolves paths through `fs` at propose time. The report therefore records
   * which probe it was, and is taken twice.
   *
   * @param probe - `boot` for the mount-time probe, `settled` for the later one.
   */
  function publishDoctor(probe) {
    doctor.updatedAt = Date.now();
    doctor.probe = probe;
    for (const service of ['fs', 'sandboxPolicy', 'shell', 'shellEnv', 'sessions']) {
      const resolved = ctx.get(service);
      doctor.services[service] = resolved === undefined || resolved === null ? 'unavailable' : 'ready';
    }
    void (async () => {
      try {
        await mkdir(dirname(DOCTOR_PATH), { recursive: true });
        await writeFile(DOCTOR_PATH, `${JSON.stringify(doctor, null, 2)}\n`, 'utf8');
      } catch {
        // Diagnostics only: never let the wiring report break the plugin.
      }
    })();
  }

  /* ---------------------------------------------------------------------- *
   * The `/actions` command — the Client's only way in
   * ---------------------------------------------------------------------- */

  /**
   * Hand a message back to the agent.
   *
   * Best effort by design: the message is a courtesy to the agent, and a delivery
   * failure must not turn a successful apply into an error the human sees. The
   * flush is a durability nicety — the inbox splice is already a Session event, so
   * a failed flush costs at most a replay.
   *
   * @param agent - the agent for the Session the command ran against.
   * @param text - the report body.
   * @param actionId - the proposal identity, recorded on the message source.
   */
  async function deliverToAgent(agent, text, actionId) {
    if (!REPORT_TO_AGENT || agent === undefined || agent === null) return;
    try {
      agent.followup(await buildReportMessage(text, actionId));
      try {
        const sessions = ctx.get('sessions');
        if (sessions !== undefined && sessions !== null && typeof sessions.flush === 'function') {
          await sessions.flush(agent.session);
        }
      } catch {
        // Not every composition persists eagerly.
      }
    } catch (error) {
      console.warn('[action-cards] could not report the outcome to the agent:', error);
    }
  }

  /**
   * Apply one proposal.
   *
   * The steps travel with the request, so an apply still works when the store is
   * missing (a fresh install, a pruned record, a wiped state directory). The
   * store is updated afterwards, and the agent is told what happened.
   *
   * @param agent - the agent for the Session the Client targeted.
   * @param signal - the command's cancellation signal.
   * @param id - the proposal identity.
   * @param payload - `{ values?, steps? }` from the card.
   * @returns the command result.
   */
  async function applyAction(agent, signal, id, payload) {
    const values = normalizeValues(payload?.values);

    const stored = await readStore();
    const existing = stored.items[id];
    // A card that could not read its own arguments sends an empty list rather
    // than nothing; the stored record is the authority then.
    const rawSteps = Array.isArray(payload?.steps) && payload.steps.length > 0 ? payload.steps : existing?.steps;
    if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
      return { kind: 'error', text: `No action "${id}" to apply.` };
    }

    const normalized = normalizeProposal({ title: existing?.title ?? 'Proposed action', note: existing?.note ?? '', steps: rawSteps });
    if (normalized.error !== undefined) return { kind: 'error', text: normalized.error };
    const { title, note, steps } = normalized.proposal;

    // Substitution happens here, once, against the values the human submitted.
    const substituted = steps.map((step) => ({
      ...step,
      ...(step.path === undefined ? {} : { path: substitute(step.path, values) }),
      ...(step.content === undefined ? {} : { content: substitute(step.content, values) }),
      ...(step.search === undefined ? {} : { search: substitute(step.search, values) }),
      ...(step.replace === undefined ? {} : { replace: substitute(step.replace, values) }),
      ...(step.command === undefined ? {} : { command: substitute(step.command, values) }),
      ...(step.cwd === undefined ? {} : { cwd: substitute(step.cwd, values) }),
    }));

    const outcomes = await executeSteps(ctx, agent, signal, { steps: substituted });
    const failed = outcomes.filter((outcome) => outcome.ok === false).length;
    const status = failed === 0 ? 'applied' : outcomes.length > failed ? 'partial' : 'failed';

    const record = {
      id,
      sessionId: existing?.sessionId ?? agent?.session?.id ?? '',
      callId: existing?.callId ?? id,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      decidedAt: Date.now(),
      title,
      note,
      steps,
      checks: existing?.checks ?? {},
      values,
      outcomes,
      status,
    };
    const item = { ...record, report: buildReport(record) };
    await putItem(item);
    await deliverToAgent(agent, item.report, id);

    return { kind: 'success', text: JSON.stringify({ status, outcomes, report: item.report }) };
  }

  /**
   * Handle one `/actions …` invocation.
   * @param invocation - the receiving agent and the raw text after the command name.
   * @returns a success or error result for the Client.
   */
  async function handleCommand({ agent, rawInput, signal }) {
    const text = String(rawInput ?? '').trim();
    const [verb = 'list', ...rest] = text.length === 0 ? [] : text.split(/\s+/);
    const action = verb.toLowerCase();

    if (action === 'list' || action === 'status') {
      const store = await readStore();
      const items = Object.values(store.items).sort((left, right) => (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0));
      const pending = items.filter((item) => item.status === 'pending').length;
      if (items.length === 0) return { kind: 'success', text: 'No actions have been proposed yet.' };
      const lines = items.slice(0, 20).map((item) => `${item.status === 'pending' ? '•' : '·'} [${item.status}] ${item.title}`);
      return { kind: 'success', text: `${items.length} action(s), ${pending} waiting:\n${lines.join('\n')}` };
    }

    if (action === 'apply') {
      // Split the id off positionally rather than by searching for it: an id that
      // happens to be a substring of the verb would otherwise misplace the cut.
      const parsed = /^apply\s+(\S+)\s*([\s\S]*)$/i.exec(text);
      if (parsed === null) return { kind: 'error', text: 'Usage: /actions apply <id> {json}' };
      const [, id, tail] = parsed;
      let payload = {};
      const body = tail.trim();
      if (body.length > 0) {
        try {
          payload = JSON.parse(body);
        } catch (error) {
          return { kind: 'error', text: `The action payload is not valid JSON: ${messageOf(error)}` };
        }
      }
      return applyAction(agent, signal, id, payload);
    }

    if (action === 'hello') {
      // The Client half announces itself once at mount. That single line is what
      // makes a stale bundle distinguishable from a broken one: `client.json`
      // exists only if the *new* Client code loaded and could reach the Host.
      const clientVersion = rest[0] ?? 'unknown';
      const record = { at: Date.now(), client: clientVersion, host: PLUGIN_VERSION, sessionId: agent?.session?.id ?? '' };
      try {
        await mkdir(STATE_DIR, { recursive: true });
        await writeFile(join(STATE_DIR, 'client.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
      } catch {
        // Diagnostics only.
      }
      return { kind: 'success', text: `host ${PLUGIN_VERSION} speaking; client ${clientVersion}` };
    }

    if (action === 'delegate') {
      // "You do it": the human is declining the work and handing it back. The
      // steps were self-contained agent work, so nothing is executed here — the
      // proposal is retired and the agent is told to carry it out itself.
      //
      // Once the agent has sent the request back with a reason (status
      // `returned`), handing it over again needs a note saying *how*. Without
      // that the exchange is just two parties restating their positions, and the
      // agent has already given the human something to answer.
      const id = rest[0];
      if (typeof id !== 'string' || id.length === 0) return { kind: 'error', text: 'Usage: /actions delegate <id> {json}' };
      const existing = (await readStore()).items[id];
      if (existing === undefined) return { kind: 'error', text: `No action "${id}" to hand back.` };

      const body = payloadFrom(text, id);
      if (body.error !== undefined) return { kind: 'error', text: body.error };
      const note = typeof body.payload?.note === 'string' ? body.payload.note.trim() : '';
      if (existing.status === 'returned' && note.length === 0) {
        return {
          kind: 'error',
          text: `The agent sent this one back saying: "${existing.returnReason ?? 'no reason given'}". Explain how it should proceed before handing it over again.`,
        };
      }

      const patched = await patchItem(id, {
        status: 'delegated',
        decidedAt: Date.now(),
        delegations: (Array.isArray(existing.delegations) ? existing.delegations.length : 0) + 1,
        ...(note.length > 0 ? { delegateNote: note } : {}),
      });
      if (patched === null) return { kind: 'error', text: `No action "${id}" to hand back.` };
      // Named `message`, not `text`: `text` is the command line, and shadowing it
      // in this block puts every earlier read of it in a temporal dead zone.
      const message = buildDelegation(patched, note);
      await patchItem(id, { report: message });
      await deliverToAgent(agent, message, id);
      return { kind: 'success', text: JSON.stringify({ status: 'delegated', outcomes: [], report: message }) };
    }

    if (action === 'dismiss') {
      const id = rest[0];
      if (typeof id !== 'string' || id.length === 0) return { kind: 'error', text: 'Usage: /actions dismiss <id>' };
      const patched = await patchItem(id, { status: 'dismissed', decidedAt: Date.now() });
      if (patched === null) return { kind: 'success', text: 'Nothing to dismiss; the action was never recorded.' };
      return { kind: 'success', text: `Dismissed "${patched.title}".` };
    }

    if (action === 'prune') {
      const removed = await mutate((store) => {
        let count = 0;
        for (const [id, item] of Object.entries(store.items)) {
          if (item.status !== 'pending') {
            delete store.items[id];
            count += 1;
          }
        }
        return count;
      });
      return { kind: 'success', text: `Removed ${removed} decided action(s).` };
    }

    return {
      kind: 'error',
      text: [
        'Unknown subcommand. Available:',
        '  /actions list            every proposal and its status',
        '  /actions hello <version> record that the Client half loaded',
        '  /actions apply <id> {json}  apply one proposal with the user\'s values',
        '  /actions delegate <id>   hand the work back to the agent',
        '  /actions dismiss <id>    mark one proposal dismissed',
        '  /actions prune           drop every decided proposal',
      ].join('\n'),
    };
  }

  ctx.effect(
    () => {
      const dispose = ctx.commands.register({
        name: COMMAND_NAME,
        description: 'Apply, dismiss or list the actions the agent has proposed to you.',
        input: { hint: '[list|apply|dismiss|prune]' },
        handler: handleCommand,
      });
      doctor.command = 'ready';
      return dispose;
    },
    'action-cards: /actions command',
  );

  /* ---------------------------------------------------------------------- *
   * The `propose_action` tool
   * ---------------------------------------------------------------------- */

  ctx.effect(() => {
    let dispose = null;
    try {
      dispose = ctx.tools.register({
        name: TOOL_NAME,
        description: [
          'Propose a concrete action for the user to carry out, instead of describing it in prose.',
          'Use this when the user must do something in their own environment — create a file, change one value inside an existing file, or run a command — and especially when a value (an API key, a path, an email) has to come from them.',
          'The user sees an editable form in the Actions panel: they fill in the values you declared, review the exact content, and press Apply. The Host then performs the action and tells you what happened, so you do not need to do it yourself and must not assume it already happened.',
          'They can also answer "You do it", which hands the job back to you to carry out with your own tools.',
          'Declare every value the user must supply in the step\'s `fields`, and reference it in the content, search, replace, command, cwd or path as {{name}}.',
          'Prefer this over pasting a snippet and asking the user to create the file by hand.',
          'Do not use it to hand the user work you could do yourself: they can answer "You do it" and send the job back.',
        ].join(' '),
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'steps'],
          properties: {
            title: { type: 'string', description: 'One line telling the user what this action does.' },
            note: { type: 'string', description: 'Optional extra context, or a warning about the action.' },
            steps: {
              type: 'array',
              // Bounds live in the description, not in `minItems`/`maxItems`: the
              // tool schema subset the Harness enforces is
              // type/oneOf/properties/required/additionalProperties/items/enum/const
              // plus annotations, and an unsupported keyword is neither validated
              // nor rendered into the PTC type. `normalizeProposal` is what actually
              // holds the line, and it says so with a clearer message.
              description: `One to ${MAX_STEPS} steps, executed in order. Execution stops at the first failure.`,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['kind'],
                properties: {
                  kind: {
                    type: 'string',
                    enum: STEP_KINDS,
                    description: 'write_file creates or replaces a text file; edit_file replaces one exact piece of text in an existing file; run_command runs a shell command in the session workspace.',
                  },
                  label: { type: 'string', description: 'Optional short label for this step, shown to the user.' },
                  path: { type: 'string', description: 'For write_file and edit_file: the file path, absolute or relative to the session workspace.' },
                  content: { type: 'string', description: 'For write_file: the complete new file contents.' },
                  search: { type: 'string', description: 'For edit_file: the exact text to find. It must occur exactly once unless replaceAll is true.' },
                  replace: { type: 'string', description: 'For edit_file: the text to put in its place. An empty string deletes it.' },
                  replaceAll: { type: 'boolean', description: 'For edit_file: replace every occurrence rather than requiring a unique match.' },
                  command: { type: 'string', description: 'For run_command: the shell command to run.' },
                  cwd: { type: 'string', description: 'For run_command: the working directory. Defaults to the session workspace.' },
                  fields: {
                    type: 'array',
                    description: `Up to ${MAX_FIELDS} values the user must supply. Each becomes an input on the card, and {{name}} anywhere in this step is replaced with what they type.`,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['name', 'label'],
                      properties: {
                        name: { type: 'string', description: 'Placeholder token, used as {{name}}. Letters, digits, dot, dash and underscore only.' },
                        label: { type: 'string', description: 'What to ask the user for.' },
                        hint: { type: 'string', description: 'Optional hint shown beside the input.' },
                        value: { type: 'string', description: 'Optional suggested default.' },
                        secret: { type: 'boolean', description: 'True to mask the input, for tokens and passwords.' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['actionId', 'storePath', 'message'],
            properties: {
              actionId: { type: 'string' },
              storePath: { type: 'string' },
              message: { type: 'string' },
              checks: { type: 'object' },
            },
          },
          render: (_args, value) => [{ type: 'text', text: value.message }],
          // The card needs the Host's pre-flight checks even when the result
          // arrives without its call and the arguments are gone.
          presentationMeta: (_args, value) => ({ actionId: value.actionId, storePath: value.storePath, checks: value.checks }),
        },
        async execute(args, exec) {
          const normalized = normalizeProposal(args);
          if (normalized.error !== undefined) {
            const error = new Error(normalized.error);
            error.code = 'INVALID_ARGS';
            throw error;
          }
          const { title, note, steps } = normalized.proposal;

          const actionId = String(exec.callId ?? `action-${Date.now()}`);
          const agent = exec.agent;
          const policy = policyFor(ctx, agent);
          const checks = await checkSteps(ctx, policy, steps, exec.signal);

          const needs = [];
          for (const step of steps) {
            for (const field of step.fields ?? []) {
              if (!needs.some((entry) => entry.name === field.name)) needs.push({ name: field.name, label: field.label, secret: field.secret === true });
            }
          }

          await putItem({
            id: actionId,
            sessionId: agent?.session?.id ?? '',
            callId: String(exec.callId ?? ''),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            decidedAt: 0,
            status: 'pending',
            title,
            note,
            steps,
            checks,
            values: {},
            outcomes: [],
            report: '',
          });

          const warnings = [];
          for (const [index, check] of Object.entries(checks)) {
            if (check?.exists === true) warnings.push(`step ${Number(index) + 1} will overwrite an existing file`);
            if (check?.missing === true) warnings.push(`step ${Number(index) + 1} targets a file that does not exist`);
            if (typeof check?.matches === 'number' && check.matches !== 1) warnings.push(`step ${Number(index) + 1} matches ${check.matches} time(s) in the file`);
            if (typeof check?.error === 'string') warnings.push(`step ${Number(index) + 1}: ${check.error}`);
          }

          const message = [
            `Proposed "${title}" to the user: ${steps.length} step(s), shown as an editable card.`,
            needs.length > 0 ? `They must fill in: ${needs.map((field) => field.label).join(', ')}.` : 'No values are required from them.',
            warnings.length > 0 ? `Worth knowing: ${warnings.join('; ')}.` : '',
            'The action has NOT been carried out yet. You will receive the outcome once the user applies it, so do not assume it succeeded.',
          ]
            .filter((line) => line.length > 0)
            .join(' ');

          return { actionId, storePath: STORE_PATH, message, checks };
        },
      });
      doctor.tool = 'ready';
      doctor.toolError = null;
    } catch (error) {
      doctor.tool = 'unavailable';
      doctor.toolError = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
      console.warn('[action-cards] could not register the propose_action tool:', error);
    }
    return () => {
      if (typeof dispose === 'function') dispose();
    };
  }, 'action-cards: propose_action tool');

  /* ---------------------------------------------------------------------- *
   * The `return_action` tool — the agent's answer to "You do it"
   * ---------------------------------------------------------------------- */

  ctx.effect(() => {
    let dispose = null;
    try {
      dispose = ctx.tools.register({
        name: 'return_action',
        description: [
          'Send a proposed action back to the user, with the reason you cannot carry it out yourself.',
          'Use this only after the user handed you an action with "You do it" and you genuinely cannot do it — the work needs a secret only they hold, an account you cannot reach, or a decision that is theirs to make.',
          'Explaining is the point: the user cannot hand the same action back to you again until they have said how to proceed, so a vague reason only blocks them.',
          'Do not use it merely because the work is tedious, or because the user could do it — that is what the original proposal was for.',
        ].join(' '),
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['reason'],
          properties: {
            reason: {
              type: 'string',
              description: 'Why you cannot carry this out, and what specifically only the user can supply or decide.',
            },
            actionId: {
              type: 'string',
              description: 'The action to send back. Omit it to answer the most recent action the user handed you in this session.',
            },
            needs: {
              type: 'string',
              description: 'Optional: what the user would have to give you later for you to take it on yourself.',
            },
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['actionId', 'message'],
            properties: {
              actionId: { type: 'string' },
              message: { type: 'string' },
            },
          },
          render: (_args, value) => [{ type: 'text', text: value.message }],
        },
        async execute(args, exec) {
          const reason = typeof args?.reason === 'string' ? args.reason.trim() : '';
          if (reason.length === 0) {
            const error = new Error('Give a reason: the user cannot answer without one.');
            error.code = 'INVALID_ARGS';
            throw error;
          }
          const sessionId = exec.agent?.session?.id ?? '';
          const store = await readStore();
          const items = Object.values(store.items);

          // Prefer the named action; otherwise the most recent one this session
          // handed over. Ordering by when the human decided is what makes "most
          // recent" mean the delegation they are answering.
          const target = typeof args?.actionId === 'string' && args.actionId.length > 0
            ? items.find((item) => item.id === args.actionId)
            : items
                .filter((item) => item.sessionId === sessionId && item.status === 'delegated')
                .sort((left, right) => (Number(right.decidedAt) || 0) - (Number(left.decidedAt) || 0))[0];

          if (target === undefined) {
            const handovers = items.filter((item) => item.sessionId === sessionId && item.status === 'delegated');
            if (handovers.length === 0 && (typeof args?.actionId !== 'string' || args.actionId.length === 0)) {
              return { actionId: '', message: 'No action has been handed to you in this session, so there is nothing to send back.' };
            }
            return { actionId: String(args?.actionId ?? ''), message: `No action "${args?.actionId}" to send back.` };
          }
          if (target.status !== 'delegated') {
            return { actionId: target.id, message: `"${target.title}" is not in your hands (status: ${target.status}), so there is nothing to send back.` };
          }

          const needs = typeof args?.needs === 'string' ? args.needs.trim() : '';
          await patchItem(target.id, {
            status: 'returned',
            returnReason: reason,
            ...(needs.length > 0 ? { returnNeeds: needs } : {}),
            returnedAt: Date.now(),
          });

          return {
            actionId: target.id,
            message: [
              `Sent "${target.title}" back to the user with your reason.`,
              needs.length > 0 ? 'They now have to say how to proceed before handing it to you again.' : 'They now have to say how to proceed before handing it to you again.',
            ].join(' '),
          };
        },
      });
      doctor.returnTool = 'ready';
    } catch (error) {
      doctor.returnTool = 'unavailable';
      doctor.returnToolError = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
      console.warn('[action-cards] could not register the return_action tool:', error);
    }
    return () => {
      if (typeof dispose === 'function') dispose();
    };
  }, 'action-cards: return_action tool');

  console.log(`[action-cards] ready — propose_action, return_action and /actions, store ${STORE_PATH}`);
  publishDoctor('boot');
  // One delayed re-probe, unref'd so a diagnostic timer never holds the process open.
  const doctorProbe = setTimeout(() => publishDoctor('settled'), DOCTOR_REPROBE_MS);
  if (typeof doctorProbe.unref === 'function') doctorProbe.unref();
}
