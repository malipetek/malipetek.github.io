/**
 * Host half of the Admin panel bundle.
 *
 * Manages the malipetek.dev portal from inside the Harness. The Host holds the
 * portal session token and talks to the Worker with Node's `fetch`, so the
 * token never enters the browser page and no CORS allow-list has to grow to
 * include the Harness origin.
 *
 * Reads: `refresh()` pulls tickets, clients and projects and writes one snapshot
 * file that the Client half reads through the session-scoped file Remote.
 *
 * Writes: every mutation lives once, below. The panel reaches them through the
 * `/admin …` command (via `remote.commands.execute`, so a button press spends no
 * model turn and never enters the conversation) and the agent reaches the same
 * functions through the two tools registered here.
 *
 * @module @malipetek/dsh-admin
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Where the plugin keeps its state. Absolute literals, not derived from
 * `DSH_HOME`: the Client half hardcodes the snapshot path and cannot read the
 * Host environment. Change both files together.
 */
const SNAPSHOT_PATH = '/Users/malipetek/.dsh/admin/state.json';
const CONFIG_PATH = '/Users/malipetek/.dsh/admin/config.json';
/**
 * The ticket the panel currently has open, thread included. A separate file
 * because a thread is only worth fetching when someone looks at it.
 */
const OPEN_PATH = '/Users/malipetek/.dsh/admin/open-ticket.json';
/**
 * Written when the Client half loads. A panel that never appears and a panel
 * that is drawing an empty list look the same from here, so the Client says
 * so on activation and `/admin hello` records it.
 */
const CLIENT_PATH = '/Users/malipetek/.dsh/admin/client.json';
/**
 * The local runner's config. It is where the projects root and any explicit
 * slug → folder mapping live, so the panel resolves a project folder exactly
 * the way the runner does instead of guessing a second convention.
 */
const RUNNER_CONFIG = '/Users/malipetek/.config/malipetek-runner/config.json';

/**
 * Bumped when the Host half changes in a way worth telling apart. It rides in
 * the snapshot, so "which plugin generation wrote this?" is answerable — a
 * changed package needs a Harness restart to load a fresh module generation,
 * and this is how that shows up.
 */
const VERSION = '1.1.0';

/** The Worker that serves the portal. Overridable with `/admin endpoint <url>`. */
const DEFAULT_ENDPOINT = 'https://malipetek-intercom.malipetek.workers.dev';

/** Mirrors `STATUSES` in the Worker; a status outside this list is rejected there. */
const STATUSES = ['new', 'approved', 'in_progress', 'review', 'done', 'declined'];

/** Shown in the panel and in tool results. */
const STATUS_LABEL = {
  new: 'Waiting for Ali',
  approved: 'Approved',
  in_progress: 'In progress',
  review: 'In review',
  done: 'Done',
  declined: 'Declined',
};

/** One refresh cycle; the panel also refreshes on demand. */
const REFRESH_INTERVAL_MS = 60_000;
/** A hung request must not wedge the refresh loop. */
const REQUEST_TIMEOUT_MS = 15_000;

/* ——————————————————————— state ——————————————————————— */

/**
 * Read and parse a JSON file.
 * @param path - absolute path.
 * @param fallback - value returned when the file is missing or malformed.
 * @returns the parsed value or the fallback.
 */
async function readJson(path, fallback) {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed === null || typeof parsed !== 'object' ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/**
 * Write a file, creating its directory, without a world-readable mode.
 * @param path - absolute path.
 * @param text - file contents.
 * @param mode - permission bits when the file is created.
 */
async function writeText(path, text, mode = 0o644) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, { encoding: 'utf8', mode });
}

/** Expand a leading `~` so a config value can be written the way a human writes it. */
function expandHome(value) {
  return value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
}

/**
 * Where a project slug lives on this machine, or null when nothing says.
 * An explicit `projects[slug]` wins; otherwise it is `<projectsRoot>/<slug>`.
 */
async function projectPathFor(slug) {
  if (typeof slug !== 'string' || slug.length === 0) return null;
  const runner = await readJson(RUNNER_CONFIG, {});
  const explicit = runner?.projects?.[slug];
  if (typeof explicit === 'string' && explicit.length > 0) return expandHome(explicit);
  const root = typeof runner?.projectsRoot === 'string' && runner.projectsRoot.length > 0 ? expandHome(runner.projectsRoot) : null;
  return root === null ? null : join(root, slug);
}

/**
 * The stored connection settings.
 * @returns `{ endpoint, token }`; `token` is empty when signed out.
 */
async function loadConfig() {
  const stored = await readJson(CONFIG_PATH, {});
  return {
    endpoint: typeof stored.endpoint === 'string' && stored.endpoint.length > 0 ? stored.endpoint : DEFAULT_ENDPOINT,
    token: typeof stored.token === 'string' ? stored.token : '',
  };
}

/**
 * Persist the connection settings. The token is a credential, so the file is
 * owner-only.
 * @param config - `{ endpoint, token }`.
 */
async function saveConfig(config) {
  await writeText(
    CONFIG_PATH,
    JSON.stringify({ endpoint: config.endpoint, token: config.token }, null, 2) + '\n',
    0o600,
  );
}

/**
 * Write the snapshot the Client half renders.
 * @param snapshot - the complete snapshot value.
 */
async function writeSnapshot(snapshot) {
  await writeText(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n');
}

/**
 * Record a failure so the panel can show it instead of stale data.
 * @param endpoint - the Worker the panel is pointed at.
 * @param message - the reason, already human-readable.
 */
async function writeFailure(endpoint, message) {
  await writeSnapshot({
    version: VERSION,
    fetchedAt: Date.now(),
    endpoint,
    signedIn: false,
    error: message,
    statuses: STATUSES,
    statusLabels: STATUS_LABEL,
    tickets: [],
    clients: [],
    projects: [],
  });
}

/* ——————————————————————— the portal API ——————————————————————— */

/**
 * One authenticated call to the portal Worker.
 * @param config - `{ endpoint, token }`.
 * @param path - path beginning with `/admin`.
 * @param init - optional `{ method, body }`; the body is JSON-encoded.
 * @returns the parsed response body.
 * @throws an Error whose `code` is the Worker's error string when the call fails.
 */
async function request(config, path, init = {}) {
  if (config.token.length === 0) {
    const error = new Error('Not signed in to the portal. Paste a session token first.');
    error.code = 'signed_out';
    throw error;
  }

  const url = `${config.endpoint.replace(/\/+$/, '')}${path}`;
  let response;
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const error = new Error(`Could not reach ${url}: ${cause?.message ?? String(cause)}`);
    error.code = 'network';
    throw error;
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const code = typeof payload?.error === 'string' ? payload.error : `http_${response.status}`;
    const error = new Error(explain(code, response.status));
    error.code = code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

/**
 * Turn the Worker's error codes into something worth reading.
 * @param code - the Worker's `error` value.
 * @param status - the HTTP status.
 * @returns a sentence for the panel and for tool results.
 */
function explain(code, status) {
  const known = {
    signed_out: 'Not signed in to the portal. Paste a session token first.',
    unauthorized: 'The portal rejected the session token — it may have expired. Sign in again and paste a fresh one.',
    forbidden: 'That session is not an admin session.',
    not_found: 'That ticket or client no longer exists.',
    bad_status: 'That is not a status the portal accepts.',
    bad_message: 'The message needs some text.',
    bad_project: 'Unknown project.',
    slug_taken: 'A project with that slug already exists.',
    bad_attention: 'That attention value is not accepted.',
    bad_time: 'That time value is not accepted.',
    meter_closed: 'The time meter is closed on a done or declined ticket.',
    not_claimable: 'That ticket is not approved any more — somebody else claimed it, or it moved on.',
    not_in_progress: 'Only a ticket that is in progress can take a run report. It was already moved on.',
  };
  if (known[code] !== undefined) return known[code];
  return `The portal rejected the request (${code}, HTTP ${status}).`;
}

/**
 * Fetch everything the panel shows and write the snapshot.
 * @param config - `{ endpoint, token }`.
 * @returns the snapshot written.
 */
async function refresh(config) {
  const [tickets, clients, projects] = await Promise.all([
    request(config, '/admin/tickets'),
    request(config, '/admin/clients'),
    request(config, '/admin/projects'),
  ]);
  const snapshot = {
    version: VERSION,
    fetchedAt: Date.now(),
    endpoint: config.endpoint,
    signedIn: true,
    statuses: STATUSES,
    statusLabels: STATUS_LABEL,
    tickets: Array.isArray(tickets?.tickets) ? tickets.tickets : [],
    clients: Array.isArray(clients?.clients) ? clients.clients : [],
    projects: Array.isArray(projects?.projects) ? projects.projects : [],
  };
  await writeSnapshot(snapshot);
  return snapshot;
}

/* ——————————————————————— mutations, shared by both callers ——————————————————————— */

const setStatus = (config, ticketId, status) =>
  request(config, `/admin/tickets/${encodeURIComponent(ticketId)}`, { method: 'PATCH', body: { status } });

const postMessage = (config, ticketId, body, internal) =>
  request(config, `/admin/tickets/${encodeURIComponent(ticketId)}/messages`, {
    method: 'POST',
    body: { body, internal },
  });

const createProject = (config, name, slug) =>
  request(config, '/admin/projects', { method: 'POST', body: { name, slug } });

/** Take a ticket for a named executor: flips it to in_progress and opens a run. */
const claimTicket = (config, ticketId, executor, model) =>
  request(config, `/admin/tickets/${encodeURIComponent(ticketId)}/claim`, {
    method: 'POST',
    body: { executor, model },
  });

/** Close the run that owns a ticket and move it to review. */
const reportRun = (config, ticketId, payload) =>
  request(config, `/admin/tickets/${encodeURIComponent(ticketId)}/run-result`, {
    method: 'POST',
    body: payload,
  });

const linkProject = (config, userId, projectId) =>
  request(config, `/admin/clients/${encodeURIComponent(userId)}/projects/${encodeURIComponent(projectId)}`, {
    method: 'PUT',
  });

const unlinkProject = (config, userId, projectId) =>
  request(config, `/admin/clients/${encodeURIComponent(userId)}/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });

/**
 * Read one ticket with its thread.
 * @param config - `{ endpoint, token }`.
 * @param ticketId - the ticket id.
 * @returns `{ ticket, messages }`.
 */
const getTicket = (config, ticketId) => request(config, `/admin/tickets/${encodeURIComponent(ticketId)}`);

/**
 * A one-line summary of a ticket, for tool results and command output.
 * @param ticket - a ticket row.
 * @returns the summary line.
 */
function describeTicket(ticket) {
  const label = STATUS_LABEL[ticket.status] ?? ticket.status;
  const project = ticket.project_name ? ` · ${ticket.project_name}` : '';
  const who = ticket.client_email ? ` · ${ticket.client_email}` : '';
  return `#${ticket.id} ${ticket.title} [${label}]${project}${who}`;
}

/* ——————————————————————— the plugin ——————————————————————— */

/** This plugin registers both a command and tools. */
export const inject = ['tools', 'commands'];

/**
 * The `/admin` command. The panel calls it through `remote.commands.execute`,
 * so it is the interactive path that costs no model turn.
 * @param ctx - the Host plugin context.
 * @returns the command handler.
 */
function makeCommandHandler(ctx) {
  return async function handleAdmin({ rawInput }) {
    const input = typeof rawInput === 'string' ? rawInput.trim() : '';
    const [sub = 'status', ...rest] = input.length > 0 ? input.split(/\s+/) : [];
    const config = await loadConfig();

    try {
      switch (sub) {
        case 'help':
        case 'status': {
          const state = config.token.length > 0 ? 'signed in' : 'signed out';
          const lines = [
            `Admin panel: ${state} · ${config.endpoint}`,
            '',
            '  /admin refresh                 fetch tickets, clients and projects now',
            '  /admin open <id>               load one ticket and its thread for the panel',
            '  /admin hello <version>         record that the Client half loaded',
            '  /admin login <token>           store the portal session token',
            '  /admin endpoint <url>          point at another portal Worker',
            '  /admin logout                  forget the token',
            '  /admin status <id> <status>    set a ticket status',
            '  /admin reply <id> <text>       reply to the client (emails them)',
            '  /admin note <id> <text>        internal note (client never sees it)',
            '  /admin project <name> <slug>   create a project',
            '  /admin link <clientId> <projectId>',
            '  /admin unlink <clientId> <projectId>',
          ];
          return { kind: 'success', text: lines.join('\n') };
        }

        case 'refresh': {
          const snapshot = await refresh(config);
          return {
            kind: 'success',
            text: `Refreshed: ${snapshot.tickets.length} ticket(s), ${snapshot.clients.length} client(s), ${snapshot.projects.length} project(s).`,
          };
        }

        case 'hello': {
          const [version] = rest;
          await writeText(
            CLIENT_PATH,
            JSON.stringify({ version: version ?? 'unknown', at: Date.now() }, null, 2) + '\n',
          );
          return { kind: 'success', text: `Client half reported ${version ?? 'unknown'}.` };
        }

        case 'open': {
          const [id] = rest;
          if (id === undefined) return { kind: 'error', text: 'Usage: /admin open <id>' };
          const detail = await getTicket(config, id);
          await writeText(
            OPEN_PATH,
            JSON.stringify(
              {
                fetchedAt: Date.now(),
                ticket: detail?.ticket ?? null,
                messages: detail?.messages ?? [],
                runs: detail?.runs ?? [],
              },
              null,
              2,
            ) + '\n',
          );
          return {
            kind: 'success',
            text: `Loaded #${id} (${(detail?.messages ?? []).length} message(s)).`,
          };
        }

        case 'login': {
          const token = rest.join(' ').trim();
          if (token.length === 0) return { kind: 'error', text: 'Give the token: /admin login <token>' };
          await saveConfig({ endpoint: config.endpoint, token });
          const snapshot = await refresh({ endpoint: config.endpoint, token });
          ctx.logger?.info?.('admin: session token stored');
          return {
            kind: 'success',
            text: `Signed in. ${snapshot.tickets.length} ticket(s), ${snapshot.clients.length} client(s).`,
          };
        }

        case 'endpoint': {
          const endpoint = rest.join(' ').trim();
          if (!/^https?:\/\//.test(endpoint)) return { kind: 'error', text: 'Give an http(s) URL.' };
          await saveConfig({ endpoint, token: config.token });
          return { kind: 'success', text: `Now pointed at ${endpoint}.` };
        }

        case 'logout': {
          await saveConfig({ endpoint: config.endpoint, token: '' });
          await writeFailure(config.endpoint, 'Signed out.');
          return { kind: 'success', text: 'Forgot the token.' };
        }

        case 'status': {
          const [id, status] = rest;
          if (id === undefined || status === undefined) {
            return { kind: 'error', text: 'Usage: /admin status <id> <status>' };
          }
          if (!STATUSES.includes(status)) {
            return { kind: 'error', text: `Status must be one of: ${STATUSES.join(', ')}` };
          }
          await setStatus(config, id, status);
          await refresh(config);
          return { kind: 'success', text: `#${id} is now ${STATUS_LABEL[status] ?? status}.` };
        }

        case 'reply':
        case 'note': {
          const [id, ...words] = rest;
          const text = words.join(' ').trim();
          if (id === undefined || text.length === 0) {
            return { kind: 'error', text: `Usage: /admin ${sub} <id> <text>` };
          }
          const internal = sub === 'note';
          await postMessage(config, id, text, internal);
          await refresh(config);
          return {
            kind: 'success',
            text: internal ? `Internal note added to #${id}.` : `Replied to #${id}; the client was emailed.`,
          };
        }

        case 'project': {
          // The slug is one word and the name is everything before it, so
          // `/admin project My New Site my-new-site` reads naturally.
          const slug = rest[rest.length - 1];
          const name = rest.slice(0, -1).join(' ');
          if (name.length === 0 || slug === undefined) {
            return { kind: 'error', text: 'Usage: /admin project <name…> <slug>' };
          }
          const created = await createProject(config, name, slug.toLowerCase());
          await refresh(config);
          return { kind: 'success', text: `Created project ${created.name} (${created.slug}).` };
        }

        case 'link':
        case 'unlink': {
          const [clientId, projectId] = rest;
          if (clientId === undefined || projectId === undefined) {
            return { kind: 'error', text: `Usage: /admin ${sub} <clientId> <projectId>` };
          }
          if (sub === 'link') await linkProject(config, clientId, projectId);
          else await unlinkProject(config, clientId, projectId);
          await refresh(config);
          return { kind: 'success', text: sub === 'link' ? 'Project linked.' : 'Project unlinked.' };
        }

        default:
          return { kind: 'error', text: `Unknown subcommand "${sub}". Try /admin help.` };
      }
    } catch (error) {
      const message = error?.message ?? String(error);
      if (error?.code === 'unauthorized' || error?.code === 'forbidden') {
        await writeFailure(config.endpoint, message);
      }
      return { kind: 'error', text: message };
    }
  };
}

/**
 * Register the plugin: one command, two tools, and a refresh loop.
 * @param ctx - the Host plugin context.
 */
export function apply(ctx) {
  ctx.effect(
    () => {
      const dispose = ctx.commands.register({
        name: 'admin',
        description: 'Manage the malipetek.dev portal: tickets, clients and projects.',
        input: { hint: '[refresh|login|status|reply|note|project|link|unlink]' },
        handler: makeCommandHandler(ctx),
      });
      return dispose;
    },
    'admin: /admin command',
  );

  ctx.effect(() => {
    let dispose = null;
    try {
      dispose = ctx.tools.register({
        name: 'admin_tickets',
        description: [
          'Work the malipetek.dev client portal: list tickets, read one with its thread, reply to the client, or change its status.',
          'Approve, decline and every status change are visible to the client, and a public reply emails them — say what you did.',
          'Use action "note" for a private note the client never sees.',
        ].join(' '),
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'get', 'reply', 'note', 'set_status'],
              description: 'list tickets, get one with its thread, reply to the client, write a private note, or set a status.',
            },
            ticketId: { type: 'number', description: 'Ticket id, for get, reply, note and set_status.' },
            status: {
              type: 'string',
              enum: STATUSES,
              description: `New status, for set_status. One of: ${STATUSES.join(', ')}.`,
            },
            text: { type: 'string', description: 'Message body for reply and note.' },
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['message'],
            properties: { message: { type: 'string' } },
          },
          render: (_args, value) => [{ type: 'text', text: value.message }],
        },
        async execute(args) {
          const config = await loadConfig();
          switch (args.action) {
            case 'list': {
              const snapshot = await refresh(config);
              if (snapshot.tickets.length === 0) return { message: 'No tickets.' };
              return { message: snapshot.tickets.map(describeTicket).join('\n') };
            }
            case 'get': {
              if (typeof args.ticketId !== 'number') throw new Error('ticketId is required.');
              const { ticket, messages } = await getTicket(config, args.ticketId);
              const thread = (messages ?? [])
                .map((m) => `[${m.author}${m.internal === 1 ? ' · private' : ''}] ${m.body}`)
                .join('\n');
              return { message: `${describeTicket(ticket)}\n\n${thread}` };
            }
            case 'reply':
            case 'note': {
              if (typeof args.ticketId !== 'number') throw new Error('ticketId is required.');
              if (typeof args.text !== 'string' || args.text.trim().length === 0) throw new Error('text is required.');
              const internal = args.action === 'note';
              await postMessage(config, args.ticketId, args.text, internal);
              await refresh(config);
              return {
                message: internal
                  ? `Private note added to #${args.ticketId} (the client cannot see it).`
                  : `Replied to #${args.ticketId}; the client was emailed.`,
              };
            }
            case 'set_status': {
              if (typeof args.ticketId !== 'number') throw new Error('ticketId is required.');
              if (typeof args.status !== 'string' || !STATUSES.includes(args.status)) {
                throw new Error(`status must be one of: ${STATUSES.join(', ')}`);
              }
              await setStatus(config, args.ticketId, args.status);
              await refresh(config);
              return { message: `#${args.ticketId} is now ${STATUS_LABEL[args.status] ?? args.status}.` };
            }
            default:
              throw new Error(`Unknown action "${args.action}".`);
          }
        },
      });
    } catch (error) {
      ctx.logger?.warn?.(`admin: could not register admin_tickets: ${error?.message ?? String(error)}`);
    }
    return dispose;
  }, 'admin: admin_tickets tool');

  ctx.effect(() => {
    let dispose = null;
    try {
      dispose = ctx.tools.register({
        name: 'admin_directory',
        description: [
          'The malipetek.dev portal directory: clients, projects, and which projects a client may file against.',
          'A project slug is what the local runner maps to a folder on disk, so a ticket is only workable once its project exists and the runner knows the slug.',
        ].join(' '),
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['clients', 'projects', 'create_project', 'link', 'unlink'],
              description: 'List clients, list projects, create a project, or link/unlink a project to a client.',
            },
            name: { type: 'string', description: 'Project display name, for create_project.' },
            slug: { type: 'string', description: 'Project slug (lowercase, dashes), for create_project.' },
            clientId: { type: 'string', description: 'Client user id, for link and unlink.' },
            projectId: { type: 'string', description: 'Project id, for link and unlink.' },
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['message'],
            properties: { message: { type: 'string' } },
          },
          render: (_args, value) => [{ type: 'text', text: value.message }],
        },
        async execute(args) {
          const config = await loadConfig();
          switch (args.action) {
            case 'clients': {
              const snapshot = await refresh(config);
              if (snapshot.clients.length === 0) return { message: 'No clients yet.' };
              const byId = new Map(snapshot.projects.map((p) => [p.id, p.slug]));
              const lines = snapshot.clients.map((client) => {
                const projects = (client.projectIds ?? []).map((id) => byId.get(id) ?? id).join(', ') || 'none';
                return `${client.email} [${client.role}] · ${client.ticket_count} ticket(s) · projects: ${projects} · id ${client.id}`;
              });
              return { message: lines.join('\n') };
            }
            case 'projects': {
              const snapshot = await refresh(config);
              if (snapshot.projects.length === 0) return { message: 'No projects yet.' };
              return {
                message: snapshot.projects.map((p) => `${p.slug} — ${p.name} · id ${p.id}`).join('\n'),
              };
            }
            case 'create_project': {
              if (typeof args.name !== 'string' || typeof args.slug !== 'string') {
                throw new Error('name and slug are required.');
              }
              const created = await createProject(config, args.name, args.slug.toLowerCase());
              await refresh(config);
              return { message: `Created project ${created.name} (${created.slug}).` };
            }
            case 'link':
            case 'unlink': {
              if (typeof args.clientId !== 'string' || typeof args.projectId !== 'string') {
                throw new Error('clientId and projectId are required.');
              }
              if (args.action === 'link') await linkProject(config, args.clientId, args.projectId);
              else await unlinkProject(config, args.clientId, args.projectId);
              await refresh(config);
              return { message: args.action === 'link' ? 'Project linked.' : 'Project unlinked.' };
            }
            default:
              throw new Error(`Unknown action "${args.action}".`);
          }
        },
      });
    } catch (error) {
      ctx.logger?.warn?.(`admin: could not register admin_directory: ${error?.message ?? String(error)}`);
    }
    return dispose;
  }, 'admin: admin_directory tool');

  ctx.effect(() => {
    let dispose = null;
    try {
      dispose = ctx.tools.register({
        name: 'admin_work',
        description: [
          'Take a client ticket and do the work, then report what happened.',
          'Action "claim" moves an APPROVED ticket to in progress and hands back the brief: what the client asked plus Ali\'s guidance, the project slug, and where that project lives on this machine.',
          'Do the work in a fresh git worktree on a `ticket-<id>` branch — never in the main checkout — or hand it to an external agent through the external_agents tool, then report it either way.',
          'Action "report" records the outcome: the summary, the branch, the changed files and the diff, and what the run cost. That record is what the portal meters and what Ali reviews, so state plainly what changed and what is still unverified; do not claim success you did not confirm.',
          'One run may report once. If the work cannot start, set the ticket back to approved with admin_tickets set_status rather than leaving it in progress.',
        ].join(' '),
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['claim', 'report'], description: 'claim a ticket to work on, or report the finished run.' },
            ticketId: { type: 'number', description: 'The ticket id, for both actions.' },
            executor: {
              type: 'string',
              description: 'Who did the work: "dsh" for this harness, or the external agent — "claude-code", "opencode", "devin".',
            },
            model: { type: 'string', description: 'The model that did the work, when it can be named.' },
            ok: { type: 'boolean', description: 'True when the work completed, false when it failed. For report.' },
            summary: { type: 'string', description: 'What happened, for report. This is what Ali reads first.' },
            branch: { type: 'string', description: 'The local branch the work is on, for report. Nothing is pushed.' },
            diffStat: { type: 'string', description: 'Output of `git diff --stat`, for report.' },
            diff: { type: 'string', description: 'The diff itself, for report. Truncated if enormous.' },
            costUsd: { type: 'number', description: 'What the run cost in US dollars, for report. Omit when unknown.' },
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['message'],
            properties: { message: { type: 'string' } },
          },
          render: (_args, value) => [{ type: 'text', text: value.message }],
        },
        async execute(args) {
          const config = await loadConfig();

          if (args.action === 'claim') {
            if (typeof args.ticketId !== 'number') throw new Error('ticketId is required.');
            const claim = await claimTicket(config, args.ticketId, args.executor ?? 'dsh', args.model);
            await refresh(config);
            const ticket = claim?.ticket ?? {};
            const path = await projectPathFor(ticket.slug);
            const brief = (claim?.messages ?? [])
              .map((message) => `[${message.author}${message.internal === 1 ? ' · private' : ''}] ${message.body}`)
              .join('\n');
            const budget =
              typeof ticket.budget_cents === 'number' && ticket.budget_cents > 0
                ? ` · budget $${(ticket.budget_cents / 100).toFixed(2)}`
                : '';
            return {
              message: [
                `Claimed #${ticket.id} "${ticket.title}" as ${claim?.executor ?? 'dsh'}${claim?.model ? ` (${claim.model})` : ''}. Run ${claim?.runId ?? '?'}.`,
                `Project ${ticket.slug ?? '— none —'}${path === null ? ' (no local folder resolved; check the runner config)' : ` → ${path}`}`,
                `Attention: ${ticket.attention ?? 'checked'}${budget}`,
                `Suggested branch ticket-${ticket.id}${path === null ? '' : `, worktree ~/.cache/malipetek-runner/worktrees/${ticket.slug}-ticket-${ticket.id}`}`,
                '',
                'Brief:',
                brief.length > 0 ? brief : '(no client messages)',
                '',
                'Report it with admin_work action "report" when it is done — the ticket moves to review and the portal meters the run.',
              ].join('\n'),
            };
          }

          if (args.action === 'report') {
            if (typeof args.ticketId !== 'number') throw new Error('ticketId is required.');
            if (typeof args.ok !== 'boolean') throw new Error('ok is required (true when the work completed).');
            if (typeof args.summary !== 'string' || args.summary.trim().length === 0) {
              throw new Error('summary is required — say what actually happened.');
            }
            const payload = {
              ok: args.ok,
              summary: args.summary,
              branch: args.branch,
              diffStat: args.diffStat,
              diff: args.diff,
              costUsd: args.costUsd,
              executor: args.executor ?? 'dsh',
              model: args.model,
            };
            const result = await reportRun(config, args.ticketId, payload);
            await refresh(config);
            const cost = typeof result?.costMicroUsd === 'number' ? ` Recorded $${(result.costMicroUsd / 1_000_000).toFixed(4)} against the ticket.` : '';
            return {
              message: `Reported #${args.ticketId} as ${args.ok ? 'finished' : 'failed'} (${payload.executor}). The ticket is now in review and Ali has been emailed.${cost}`,
            };
          }

          throw new Error(`Unknown action "${args.action}". Use "claim" or "report".`);
        },
      });
    } catch (error) {
      ctx.logger?.warn?.(`admin: could not register admin_work: ${error?.message ?? String(error)}`);
    }
    return dispose;
  }, 'admin: admin_work tool');

  // Keep the snapshot warm so the panel has something to render on first open,
  // and so a failure surfaces in the panel rather than waiting for a click.
  ctx.effect(() => {
    const tick = async () => {
      const config = await loadConfig();
      if (config.token.length === 0) {
        await writeFailure(config.endpoint, 'Not signed in. Paste a portal session token to load the portal.');
        return;
      }
      try {
        await refresh(config);
      } catch (error) {
        await writeFailure(config.endpoint, error?.message ?? String(error));
      }
    };
    void tick();
    const interval = setInterval(() => { void tick(); }, REFRESH_INTERVAL_MS);
    if (typeof interval.unref === 'function') interval.unref();
    return () => clearInterval(interval);
  }, 'admin: refresh loop');
}
