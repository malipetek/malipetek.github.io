const byNewest = (a, b) => b.at - a.at || (b.kind === 'run') - (a.kind === 'run') || b.item.id - a.item.id;

/** Task activity excludes conversation messages and runner reports. */
export function taskHistoryEvents(messages = [], runs = []) {
  return [
    ...messages.filter(item => item.author === 'system').map(item => ({ kind: 'event', item, at: item.created_at })),
    ...runs.map(item => ({ kind: 'run', item, at: item.started_at })),
  ].sort(byNewest);
}

/** Never turn absent project scope into a global ticket request. */
export async function loadProjectTicketHistory(api, projectId) {
  if (projectId == null || projectId === '') return [];
  const { tickets } = await api('GET', `/admin/tickets?projectId=${encodeURIComponent(projectId)}`);
  return tickets
    .filter(ticket => String(ticket.project_id) === String(projectId))
    .sort((a, b) => b.updated_at - a.updated_at || b.id - a.id);
}

const STATUS_RE = /^Status changed to “([^”]+)”\.?\s*(.*)$/s;

/**
 * Sort one history entry into a display type: `run`, `status` (with the new
 * status and any trailing detail, such as the billing total), `land`, or
 * `note`. Display only; the entry itself is unchanged.
 */
export function historyEntryType({ kind, item }) {
  if (kind === 'run') return { type: 'run', title: `Run #${item.id}`, detail: item.status ?? '' };
  const body = String(item?.body ?? '');
  const status = STATUS_RE.exec(body);
  if (status) return { type: 'status', title: status[1], detail: status[2].trim() };
  if (/^Landed on /.test(body)) return { type: 'land', title: body.replace(/\.$/, ''), detail: '' };
  return { type: 'note', title: body, detail: '' };
}

/** Group newest-first entries by local calendar day, keeping order. */
export function groupByDay(entries, locale = 'en-GB') {
  const groups = [];
  for (const entry of entries) {
    const date = entry.at ? new Date(entry.at * 1000) : null;
    const label = date ? date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : 'Undated';
    const last = groups.at(-1);
    if (last?.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}
