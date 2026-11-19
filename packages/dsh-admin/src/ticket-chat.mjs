export function linkedTicketDetail(detail, ticketId, sessionId) {
  return typeof sessionId === 'string' && sessionId !== '' && detail?.ticket?.id === ticketId
    && Array.isArray(detail.runs) && detail.runs.some(run => run?.session_id === sessionId) ? detail : null;
}

export function createTicketDetailReader({ ticketId, sessionId, api, update }) {
  let revision = 0, disposed = false;
  return {
    async load() {
      if (disposed || !Number.isSafeInteger(ticketId) || ticketId <= 0) return;
      const current = ++revision;
      let result;
      try {
        const detail = linkedTicketDetail(await api('GET', `/admin/tickets/${ticketId}`), ticketId, sessionId);
        result = { detail, error: detail ? '' : 'This session is not linked to the ticket.' };
      } catch {
        result = { detail: null, error: 'Could not load the linked ticket.' };
      }
      if (!disposed && current === revision) update(result);
    },
    dispose() { disposed = true; },
  };
}

export function ticketActivity(detail) {
  if (!detail) return [];
  const rows = new Map();
  const { ticket } = detail;
  const add = (source, seconds, label, text) => {
    const time = seconds * 1000;
    const id = `ticket:${ticket.id}:${source}`;
    if (typeof seconds === 'number' && seconds > 0 && time <= 8.64e15 && !rows.has(id)) rows.set(id, { id, time, label, text });
  };
  add('opened', ticket.created_at, 'Ticket status', `Ticket #${ticket.id} opened`);
  for (const message of detail.messages ?? []) {
    if (!Number.isSafeInteger(message?.id) || typeof message.body !== 'string') continue;
    const label = message.author === 'system' ? 'Ticket status'
      : message.internal ? 'Private note' : message.author === 'client' ? 'Client message'
        : message.author === 'runner' ? 'Fleet run' : 'Team reply';
    add(`message:${message.id}`, message.created_at, label, message.body);
  }
  for (const run of detail.runs) {
    if (!Number.isSafeInteger(run?.id)) continue;
    add(`run:${run.id}:start`, run.started_at, 'Fleet run', `Run #${run.id} started`);
    add(`run:${run.id}:finish`, run.finished_at, 'Fleet run', `Run #${run.id} finished${typeof run.status === 'string' ? ` · ${run.status}` : ''}`);
  }
  return [...rows.values()].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

export async function sendTicketMessage({ api, ticket, mode, text, confirm }) {
  if (!Number.isSafeInteger(ticket?.id) || ticket.id <= 0 || !text.trim() || !['note', 'reply'].includes(mode)) return false;
  const internal = mode === 'note';
  if (!internal && (!ticket.client_email || ticket.kind === 'system' || !confirm(`Email this reply to ${ticket.client_email}?`))) return false;
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
