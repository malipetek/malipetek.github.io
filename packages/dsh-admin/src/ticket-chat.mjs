/**
 * The ticket's detail when this session belongs to it: a run recorded the
 * session, or (`thread`) the session runs in the ticket's own chat folder.
 */
export function linkedTicketDetail(detail, ticketId, sessionId, thread = false) {
  if (typeof sessionId !== 'string' || sessionId === '' || detail?.ticket?.id !== ticketId) return null;
  if (thread) return detail;
  return Array.isArray(detail.runs) && detail.runs.some(run => run?.session_id === sessionId) ? detail : null;
}

/** One Host admin operation over the Connection route; `{ state: 'none', error }` when it cannot answer. */
export async function adminOperation(body, signal, fetcher = globalThis.fetch) {
  try {
    const response = await fetcher('/api/admin/command', {
      method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error',
      body: JSON.stringify(body), signal,
    });
    if (response.ok) return await response.json();
    return { state: 'none', error: `http_${response.status}` };
  } catch (error) {
    return { state: 'none', error: error?.message ?? 'unavailable' };
  }
}

/**
 * Start the chat for a ticket no local run opened, in its own folder. No
 * prompt goes out: the conversation opens on the ticket's activity, and the
 * composer is locked until the repo is pulled.
 * @returns {Promise<string>} the session id.
 */
/** The first turn of a ticket's chat: a read-only briefing, so the conversation opens on the ticket, not a blank start. */
export function ticketBriefing(ticketId) {
  return [
    `Brief me on ticket #${ticketId} in a few short lines: what the client asked, what their own agent changed (its work is on branch malipetek/ticket-${ticketId} in this folder's git history), and what is on the preview now.`,
    'Read only: change no file, run nothing that writes, and do not move the ticket. Use the admin tools and git log to read.',
  ].join('\n');
}

export async function startTicketThread({ sessions, cwd, title, ticketId, preset = 'workspace-write', sessionId: reuse = null }) {
  if (typeof sessions?.create !== 'function') throw new Error('This host cannot start a conversation.');
  // A blank session already in the folder (an earlier open that never got its
  // first turn) is reused rather than left behind.
  const sessionId = reuse ?? await sessions.create({ cwd });
  const reference = sessions.retain(sessionId, { source: 'workspaceOperation' });
  try {
    await reference.ready;
    const session = reference.binding.session;
    if (preset && typeof session.command === 'function') await session.command(`/permission ${preset}`).catch(() => undefined);
    // The briefing is the turn that makes this a conversation (a session with
    // no turn opens on the New Session start screen and hides from the tree).
    if (ticketId != null && typeof session.prompt === 'function') {
      const result = await session.prompt([{ type: 'text', text: ticketBriefing(ticketId) }], 'queue');
      if (result?.ok === false) throw new Error(result.error?.message ?? 'The conversation rejected the briefing.');
    }
    if (title && typeof session.rename === 'function') await session.rename(title).catch(() => undefined);
  } finally {
    reference.release?.();
  }
  return sessionId;
}

export function createTicketDetailReader({ ticketId, sessionId, api, update, thread = false }) {
  let revision = 0, disposed = false;
  return {
    async load() {
      if (disposed || !Number.isSafeInteger(ticketId) || ticketId <= 0) return;
      const current = ++revision;
      let result;
      try {
        const detail = linkedTicketDetail(await api('GET', `/admin/tickets/${ticketId}`), ticketId, sessionId, thread);
        result = { detail, error: detail ? '' : 'This session is not linked to the ticket.' };
      } catch {
        result = { detail: null, error: 'Could not load the linked ticket.' };
      }
      if (!disposed && current === revision) update(result);
    },
    dispose() { disposed = true; },
  };
}

// A mail client appends the message it answers, so a one-word reply arrives as
// "heyo" plus a paragraph of quoted history. The chat shows the reply, not the
// quote, so cut the quoted tail here; the ticket keeps the body as sent.
const QUOTE_STARTS = [
  /^On .+ wrote:?\s*$/i,
  /^.{0,300}<[^<>\s]+@[^<>\s]+>.*\bwrote:?\s*$/i,
  /^.{0,300}<[^<>\s]+@[^<>\s]+>.*(yaz\u0131ld\u0131|yazd\u0131|yazdi):?\s*$/i,
  /^\s*-{2,}\s*Original Message\s*-{2,}/i,
  /^\s*From:\s\S+@\S+\s*$/i,
  /^_{5,}\s*$/,
];
/** A mail header line, or the "wrote:" / "şunu yazdı:" line that finishes one. */
const isAttributionLine = (line) => QUOTE_STARTS.some((pattern) => pattern.test(line));
const EMAIL_HEADER = /<[^<>\s]+@[^<>\s]+>/;
const WRITES = /(wrote|yaz\u0131ld\u0131|yazd\u0131|yazdi):?\s*$/i;

export function stripQuotedReply(body) {
  if (typeof body !== 'string') return body;
  const lines = body.split(/\r?\n/);
  let cut = -1;
  for (const [index, line] of lines.entries()) {
    if (isAttributionLine(line)) { cut = index; break; }
    // Gmail wraps the attribution over two lines: "name <mail>, 26 Kas 20:50"
    // then "tarihinde şunu yazdı:". Neither line matches on its own.
    if (EMAIL_HEADER.test(line) && WRITES.test(lines[index + 1] ?? '')) { cut = index; break; }
  }
  let end = cut === -1 ? lines.length : cut;
  while (end > 0 && lines[end - 1].trim() === '') end -= 1;
  // A trailing run of "> " lines is quoted text even with no attribution line.
  let quoted = end;
  while (quoted > 0 && /^\s*>/.test(lines[quoted - 1])) quoted -= 1;
  if (quoted < end) end = quoted;
  const kept = lines.slice(0, end).join('\n').replace(/\s+$/, '');
  return kept === '' ? body.trim() : kept;
}

export function ticketActivity(detail) {
  if (!detail) return [];
  const rows = new Map();
  const { ticket } = detail;
  // `kind` picks the row's accent in the chat view; `author` fills its avatar.
  const add = (source, seconds, label, text, kind, author) => {
    const time = seconds * 1000;
    const id = `ticket:${ticket.id}:${source}`;
    if (typeof seconds === 'number' && seconds > 0 && time <= 8.64e15 && !rows.has(id)) {
      rows.set(id, { id, time, label, text, kind, ...(author ? { author } : {}) });
    }
  };
  add('opened', ticket.created_at, 'Ticket status', `Ticket #${ticket.id} opened`, 'status');
  for (const message of detail.messages ?? []) {
    if (!Number.isSafeInteger(message?.id) || typeof message.body !== 'string') continue;
    const label = message.author === 'system' ? 'Ticket status'
      : message.internal ? 'Private note' : message.author === 'client' ? 'Client message'
        : message.author === 'runner' ? 'Fleet run' : 'Team reply';
    const kind = message.author === 'system' ? 'status'
      : message.internal ? 'note' : message.author === 'client' ? 'client'
        : message.author === 'runner' ? 'run' : 'team';
    // The client has an identity on the ticket; ours is always us.
    const author = kind === 'client' ? (ticket.client_email || 'Client')
      : kind === 'team' || kind === 'note' ? 'You' : undefined;
    add(`message:${message.id}`, message.created_at, label, stripQuotedReply(message.body), kind, author);
  }
  for (const run of detail.runs) {
    if (!Number.isSafeInteger(run?.id)) continue;
    add(`run:${run.id}:start`, run.started_at, 'Fleet run', `Run #${run.id} started`, 'run');
    add(`run:${run.id}:finish`, run.finished_at, 'Fleet run', `Run #${run.id} finished${typeof run.status === 'string' ? ` · ${run.status}` : ''}`, 'run');
  }
  return [...rows.values()].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

export async function sendTicketMessage({ api, ticket, mode, text, confirm }) {
  if (!Number.isSafeInteger(ticket?.id) || ticket.id <= 0 || !text.trim() || !['note', 'reply'].includes(mode)) return false;
  const internal = mode === 'note';
  // `confirm` may answer a Promise (the in-app dialog); a plain boolean still works.
  if (!internal && (!ticket.client_email || ticket.kind === 'system' || !(await confirm(`Email this reply to ${ticket.client_email}?`)))) return false;
  await api('POST', `/admin/tickets/${ticket.id}/messages`, { body: text.trim(), internal });
  return true;
}

const workspaceStates = new Set(['ready', 'missing', 'conflict', 'unavailable', 'pending', 'unmanaged']);
export async function requestTicketWorkspace(sessionId, action, signal, fetcher = globalThis.fetch) {
  if (typeof sessionId !== 'string' || !sessionId || !['status', 'restore'].includes(action)) return { state: 'unavailable' };
  try {
    const response = await fetcher('/api/admin/command', {
      method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error',
      body: JSON.stringify({ operation: `ticket-workspace-${action}`, sessionId }), signal,
    });
    if (response.ok) {
      const result = await response.json();
      if (workspaceStates.has(result?.state)) return {
        state: result.state, ...(typeof result.reason === 'string' ? { reason: result.reason } : {}),
      };
    }
  } catch { /* Do not retry through a Session or substitute another workspace. */ }
  return { state: 'unavailable' };
}

/**
 * Move a conversation left on the old ticket tab to Chat, once per install.
 * Earlier releases opened ticket sessions in the Task view; Chat owns the
 * ticket now. The marker keeps a later deliberate Task selection.
 * @param storage - `localStorage`-like store.
 * @param marker - the one-time flag key.
 * @returns the number of sessions moved.
 */
export function migrateTicketView(storage, marker = 'dsh.admin.ticket-view-migrated') {
  if (!storage) return 0;
  try {
    if (storage.getItem(marker) !== null) return 0;
    let moved = 0;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key !== 'string' || !key.startsWith('dsh.conversation.')) continue;
      let state;
      try { state = JSON.parse(storage.getItem(key) ?? 'null'); } catch { continue; }
      if (state === null || typeof state !== 'object' || state.view !== 'admin-task') continue;
      storage.setItem(key, JSON.stringify({ ...state, view: 'chat' }));
      moved += 1;
    }
    storage.setItem(marker, '1');
    return moved;
  } catch { return 0; }
}
