/**
 * File editor — the Host half of `@malipetek/dsh-file-editor`.
 *
 * The Client half draws an editable workspace tree in the right Sidebar. It
 * reads with the shipped `workspaceFiles` Remote — listing, stat, bytes and
 * watches already exist there and cost this plugin nothing — and every
 * MUTATION arrives here as a session command, because a Remote namespace is
 * application-selected at build time and a third-party bundle cannot add one.
 * A command is the sanctioned Client-callable Host entry point, and a command
 * spends no model tokens: discovery, execution and its UI output never enter a
 * model request.
 *
 * Writes go through `ctx.fs`, so the session's sandbox mode and the caller's
 * version guard apply exactly as they do for the model's own `write` tool. That
 * matters for more than safety: the guard is what stops the editor from
 * silently clobbering a file an agent edited a second earlier.
 *
 * `ctx.fs` has no create-directory, rename or delete (documented as a seam
 * limitation), so those three are performed here with `node:fs` and reproduce
 * the same mode fence before touching the disk. The fence is deliberately a
 * copy of the backend's rule and not a new policy: `read-only` refuses every
 * mutation, `workspace-write` permits targets under the session workspace or a
 * platform temporary root, and `danger-full-access` does not confine.
 *
 * Reads and writes are unrelated to the model's transcript; nothing here
 * appends a session event of its own.
 *
 * @module @malipetek/dsh-file-editor
 */
import { lstat, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path';
import { homedir, tmpdir } from 'node:os';

/** The Loader row's name, and the name this plugin is known by. */
export const name = 'file-editor';

/** This bundle's version, mirrored in package.json and written to the doctor record. */
const VERSION = '1.0.0';

/**
 * DSH's own home. `DSH_HOME` wins when the launcher sets it, and the literal is
 * the same default the rest of the Harness uses.
 */
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');

/** Where this plugin keeps its one diagnostic record. */
const STATE_DIR = process.env.DSH_FILE_EDITOR_DIR || join(DSH_HOME, 'file-editor');

/**
 * The Host services this plugin needs before it activates: the command registry
 * the browser drives it through, and the filesystem seam every write goes
 * through. The sandbox policy is deliberately NOT required — a composition may
 * mount none, and this plugin stays useful without one — so it is taken through
 * `ctx.inject` below.
 */
export const inject = ['commands', 'fs'];

/** The slash command the Client half drives. */
const COMMAND_NAME = 'editor';

/**
 * Largest file this plugin will accept in one command line.
 *
 * A command's input travels as one string and is the only channel from the
 * browser, so this is the practical ceiling on a single save. Source files are
 * far below it; a larger file is a deliberate refusal rather than a silent
 * truncation.
 */
const MAX_CONTENT_BYTES = 4 * 1024 * 1024;

/**
 * Register the `/editor` command.
 * @param ctx - the plugin context carrying `commands` and `fs`.
 */
export function apply(ctx) {
  const policyOf = createPolicyReader(ctx);

  // Record what the Host actually loaded. A profile that installs this bundle but
  // never activates it looks exactly like a working install until something is
  // used, so the record is the one cheap answer to "which version is running".
  ctx.effect(
    () => {
      const record = {
        version: VERSION,
        command: COMMAND_NAME,
        pid: process.pid,
        loadedAt: new Date().toISOString(),
      };
      void mkdir(STATE_DIR, { recursive: true })
        .then(() => writeFile(join(STATE_DIR, 'host.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8'))
        .catch(() => {});
      return () => {};
    },
    'file-editor: doctor record',
  );

  ctx.effect(
    () => ctx.commands.register({
      name: COMMAND_NAME,
      description: 'Create, rename, delete and save files in this session workspace on behalf of the file editor panel.',
      input: { hint: '{"op":"write", …}' },
      // The payload carries file content. `command/run` is still appended, but
      // without it: the session log is replayed on every resume, so duplicating
      // whole files into it would grow without bound. The file on disk is the
      // authoritative artifact, and the outcome line below still records what
      // happened.
      recordInput: false,
      handler: (invocation) => handle(ctx, policyOf, invocation),
    }),
    'file-editor: /editor command',
  );
}

/**
 * Read the per-call sandbox policy, when the composition mounts one.
 *
 * `ctx.sandboxPolicy` throws on an uninjected context, so the service is taken
 * through an optional injection instead: `ctx.inject` activates this callback
 * only while a policy service exists, and the reader falls back to "no policy"
 * when it does not.
 *
 * @param ctx - the plugin context.
 * @returns `(session) => policy | undefined`.
 */
function createPolicyReader(ctx) {
  let read = () => undefined;
  ctx.inject(['sandboxPolicy'], (scoped) => {
    scoped.effect(
      () => {
        const service = scoped.sandboxPolicy;
        read = (session) => service?.resolve?.({ session }) ?? undefined;
        return () => {
          read = () => undefined;
        };
      },
      'file-editor: sandbox policy',
    );
  });
  return (session) => read(session);
}

/**
 * Dispatch one `/editor` request.
 * @param ctx - the plugin context.
 * @param policyOf - the per-session sandbox policy reader.
 * @param invocation - the command invocation: the receiving agent, the raw
 *   input, and the caller's cancellation.
 * @returns the command result the adapter renders.
 */
async function handle(ctx, policyOf, { agent, rawInput, signal }) {
  const session = agent?.session;
  if (session === undefined || session === null) return fail('NO_SESSION', 'no session is open to edit files in');

  let request;
  try {
    request = JSON.parse(String(rawInput ?? '').trim() || '{}');
  } catch {
    return fail('BAD_REQUEST', 'the payload must be one JSON object');
  }
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    return fail('BAD_REQUEST', 'the payload must be one JSON object');
  }

  try {
    switch (request.op) {
      case 'write': return await applyWrite(ctx, policyOf, session, request, signal);
      case 'mkdir': return await applyMkdir(policyOf, session, request);
      case 'rename': return await applyRename(policyOf, session, request);
      case 'delete': return await applyDelete(policyOf, session, request);
      default:
        return fail('BAD_REQUEST', `unknown op "${String(request.op)}"; expected write, mkdir, rename or delete`);
    }
  } catch (error) {
    return explain(error);
  }
}

/**
 * Create or overwrite one file through the filesystem seam.
 *
 * The guard is what makes the editor safe next to a running agent: a save
 * carries the version the editor loaded, so a file that changed underneath is
 * refused instead of overwritten, and the panel reports the conflict. A create
 * carries no version and is refused when the file already exists, so "new file"
 * can never destroy content either.
 *
 * @param ctx - the plugin context.
 * @param policyOf - the per-session sandbox policy reader.
 * @param session - the session that owns the workspace.
 * @param request - `{ path, content, version?, force? }`.
 * @param signal - the caller's cancellation.
 * @returns the command result.
 */
async function applyWrite(ctx, policyOf, session, request, signal) {
  const policy = policyOf(session);
  const cwd = requireRoot(session, policy);
  const content = typeof request.content === 'string' ? request.content : '';
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_CONTENT_BYTES) {
    return fail('TOO_LARGE', `${formatBytes(bytes)} exceeds the ${formatBytes(MAX_CONTENT_BYTES)} limit for one save`);
  }

  const target = await ctx.fs.resolve(requireText(request, 'path'), { cwd, signal });
  let expected;
  if (request.force !== true) {
    expected = typeof request.version === 'string' && request.version.length > 0
      ? { kind: 'replaceIfVersion', version: request.version }
      : { kind: 'createIfAbsent' };
  }

  const outcome = await ctx.fs.writeText(target, content, expected, signal, policy);
  const verb = outcome.operation === 'create' ? 'Created' : 'Wrote';
  return ok(`${verb} ${shortPath(cwd, target.displayPath)} (${formatBytes(bytes)})`);
}

/**
 * Create one directory, creating missing parents.
 * @param policyOf - the per-session sandbox policy reader.
 * @param session - the session that owns the workspace.
 * @param request - `{ path }`.
 * @returns the command result.
 */
async function applyMkdir(policyOf, session, request) {
  const cwd = requireRoot(session, policyOf(session));
  const destination = absoluteIn(cwd, requireText(request, 'path'));
  await assertWritable(policyOf, session, [destination]);
  await mkdir(destination, { recursive: true });
  return ok(`Created folder ${shortPath(cwd, destination)}`);
}

/**
 * Rename or move one entry. The destination must not exist, so a rename can
 * never silently replace a file the way `rename(2)` would.
 * @param policyOf - the per-session sandbox policy reader.
 * @param session - the session that owns the workspace.
 * @param request - `{ from, to }`.
 * @returns the command result.
 */
async function applyRename(policyOf, session, request) {
  const cwd = requireRoot(session, policyOf(session));
  const from = absoluteIn(cwd, requireText(request, 'from'));
  const to = absoluteIn(cwd, requireText(request, 'to'));

  if (from === to) return fail('BAD_REQUEST', 'the source and destination are the same path');
  if (isAtOrAbove(cwd, from)) return fail('DENIED', 'refusing to move the workspace root');

  await assertWritable(policyOf, session, [from, to]);

  if (await lstat(from).then(() => true, () => false) === false) {
    return fail('NOT_FOUND', `${shortPath(cwd, from)} does not exist`);
  }
  if (await lstat(dirname(to)).then((info) => info.isDirectory(), () => false) === false) {
    return fail('NOT_FOUND', `${shortPath(cwd, dirname(to))} is not an existing folder`);
  }
  if (await lstat(to).then(() => true, () => false)) {
    return fail('EXISTS', `${shortPath(cwd, to)} already exists`);
  }

  await rename(from, to);
  return ok(`Renamed ${shortPath(cwd, from)} to ${shortPath(cwd, to)}`);
}

/**
 * Delete one file or folder.
 *
 * A folder needs `recursive: true` from the caller, which the panel only sends
 * after the user confirms the deletion; the workspace root and anything
 * containing it are refused outright.
 *
 * @param policyOf - the per-session sandbox policy reader.
 * @param session - the session that owns the workspace.
 * @param request - `{ path, recursive? }`.
 * @returns the command result.
 */
async function applyDelete(policyOf, session, request) {
  const cwd = requireRoot(session, policyOf(session));
  const target = absoluteIn(cwd, requireText(request, 'path'));

  if (isAtOrAbove(cwd, target)) {
    return fail('DENIED', 'refusing to delete a folder that contains the workspace');
  }
  await assertWritable(policyOf, session, [target]);

  const info = await lstat(target).then((value) => value, () => null);
  if (info === null) return fail('NOT_FOUND', `${shortPath(cwd, target)} does not exist`);
  if (info.isDirectory() && request.recursive !== true) {
    return fail('NOT_EMPTY', `${shortPath(cwd, target)} is a folder; deleting it needs confirmation`);
  }

  await rm(target, { recursive: info.isDirectory(), force: false });
  return ok(`Deleted ${shortPath(cwd, target)}`);
}

/* ------------------------------------------------------------------------- *
 * The fence
 * ------------------------------------------------------------------------- */

/**
 * Reproduce the sandbox backend's mutation rule for the three operations the
 * filesystem seam does not offer.
 *
 * This is a copy of the rule, not a second policy: when no policy service is
 * mounted nothing confines mutations anywhere, `read-only` refuses, and
 * `workspace-write` requires every target to live under the session workspace or
 * a platform temporary root. Containment is checked against the real path of the
 * deepest existing ancestor, so a symlink cannot be used to step outside after
 * the check.
 *
 * @param policyOf - the per-session sandbox policy reader.
 * @param session - the session whose mode and workspace root decide.
 * @param paths - every absolute path the operation will touch.
 * @throws a typed error the dispatcher turns into a `DENIED` result.
 */
async function assertWritable(policyOf, session, paths) {
  const policy = policyOf(session);
  if (policy === undefined) return;
  if (policy.mode === 'danger-full-access') return;
  if (policy.mode === 'read-only') {
    throw coded('DENIED', 'file access denied under read-only mode');
  }

  const roots = [policy.workspaceRoot, tmpdir()]
    .filter((root) => typeof root === 'string' && root.length > 0)
    .map((root) => resolvePath(root));

  for (const path of paths) {
    const real = await canonicalPath(path);
    if (!roots.some((root) => isUnder(real, root))) {
      throw coded('DENIED', `file access denied under workspace-write mode: "${path}" is outside the workspace`);
    }
  }
}

/**
 * @param session - the session that owns the workspace.
 * @param policy - the resolved policy, when there is one.
 * @returns the session's workspace root.
 * @throws a typed error when the session has no workspace.
 */
function requireRoot(session, policy) {
  const root = policy?.workspaceRoot ?? session?.header?.cwd;
  if (typeof root !== 'string' || root.length === 0) {
    throw coded('NO_WORKSPACE', 'this session has no workspace directory');
  }
  return root;
}

/**
 * Resolve one caller-supplied path against the workspace root.
 * @param cwd - the workspace root.
 * @param path - an absolute path, or one relative to the root.
 * @returns the absolute path.
 */
function absoluteIn(cwd, path) {
  return isAbsolute(path) ? resolvePath(path) : resolvePath(cwd, path);
}

/**
 * Whether `child` is `root` itself or lives beneath it.
 * @param child - the candidate descendant.
 * @param root - the candidate ancestor.
 * @returns true when the child is contained.
 */
function isUnder(child, root) {
  if (child === root) return true;
  const rest = relative(root, child);
  return rest.length > 0 && !rest.startsWith('..') && !isAbsolute(rest);
}

/**
 * Whether `target` contains `root` (or is it), which makes it unsafe to delete.
 * @param root - the workspace root.
 * @param target - the path about to be deleted or moved.
 * @returns true when the target is the root or one of its ancestors.
 */
function isAtOrAbove(root, target) {
  return isUnder(root, target);
}

/**
 * Resolve a path to its real location, tolerating a missing tail.
 *
 * `realpath` alone fails for a file that does not exist yet, which is exactly
 * the interesting case for a create. This walks up to the deepest existing
 * ancestor, resolves that, and re-appends the missing segments — the same shape
 * the filesystem backend uses for its own containment check.
 *
 * @param target - the absolute path to canonicalize.
 * @returns the canonical absolute path.
 */
async function canonicalPath(target) {
  const absolute = resolvePath(target);
  const missing = [];
  let cursor = absolute;
  for (;;) {
    try {
      const real = await realpath(cursor);
      return missing.length === 0 ? real : join(real, ...missing.reverse());
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) return absolute;
      missing.push(basename(cursor));
      cursor = parent;
    }
  }
}

/* ------------------------------------------------------------------------- *
 * Result and message helpers
 * ------------------------------------------------------------------------- */

/**
 * @param text - what the panel and the transcript show.
 * @returns a successful command result.
 */
function ok(text) {
  return { kind: 'success', text };
}

/**
 * A failed command result whose text starts with a stable code, so the panel can
 * branch on it without parsing prose.
 * @param code - the stable code.
 * @param text - the human-readable reason.
 * @returns an errored command result.
 */
function fail(code, text) {
  return { kind: 'error', text: `${code}: ${text}` };
}

/**
 * Build a typed error the dispatcher reports as a code.
 * @param code - the stable code.
 * @param text - the human-readable reason.
 * @returns the error to throw.
 */
function coded(code, text) {
  const error = new Error(text);
  error.code = code;
  return error;
}

/**
 * Reduce a thrown value to a failed command result.
 * @param error - the caught value.
 * @returns the result the adapter renders.
 */
function explain(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = typeof error?.message === 'string' && error.message.length > 0
    ? error.message
    : String(error);

  switch (code) {
    // Raised by the filesystem seam, through the sandbox backend.
    case 'FS_STALE_VERSION':
      return fail('STALE', 'the file changed on disk since it was opened; reload it or overwrite deliberately');
    case 'FS_NOT_OBSERVED':
      return fail('EXISTS', 'that file already exists; open it instead of creating it');
    case 'FS_NOT_REGULAR_FILE':
      return fail('NOT_FILE', 'that path is not a regular file');
    case 'FS_SANDBOX_DENIED':
      return fail('DENIED', message);
    case 'FS_TOO_LARGE':
      return fail('TOO_LARGE', message);
    default:
      break;
  }

  // Raised by this plugin's own fence and dispatcher.
  if (code === 'DENIED' || code === 'NO_WORKSPACE' || code === 'BAD_REQUEST') return fail(code, message);

  // Raised by node:fs for the three operations with no seam.
  if (code === 'ENOENT') return fail('NOT_FOUND', 'that path no longer exists');
  if (code === 'EACCES' || code === 'EPERM') return fail('DENIED', message);
  if (code === 'ENOTEMPTY' || code === 'EEXIST') return fail('EXISTS', 'the destination already exists');
  if (code === 'ENOTDIR') return fail('NOT_FOUND', 'a parent path is not a folder');

  return fail('FAILED', message);
}

/**
 * Read one required string field from a request.
 * @param request - the parsed payload.
 * @param field - the field name.
 * @returns the field's value.
 * @throws a `BAD_REQUEST` error when it is missing.
 */
function requireText(request, field) {
  const value = request[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw coded('BAD_REQUEST', `"${field}" must be a non-empty string`);
  }
  return value;
}

/**
 * Display one path relative to the workspace root when it is inside it.
 * @param root - the workspace root.
 * @param path - the absolute path.
 * @returns the path to show.
 */
function shortPath(root, path) {
  const rest = relative(root, path);
  return rest.length > 0 && !rest.startsWith('..') && !isAbsolute(rest) ? rest : path;
}

/**
 * Format a byte count for a one-line message.
 * @param bytes - the count.
 * @returns the formatted size.
 */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
