import assert from 'node:assert/strict';
import test from 'node:test';
import { loadProjectTicketHistory, taskHistoryEvents } from './src/conversation-history.mjs';

test('task history orders events and runs newest first without exposing thread messages', () => {
  const messages = [
    { id: 7, author: 'system', created_at: 12 },
    { id: 8, author: 'client', created_at: 16 },
    { id: 9, author: 'runner', created_at: 20 },
    { id: 6, author: 'system', created_at: 12 },
  ];
  const runs = [{ id: 3, started_at: 11 }, { id: 4, started_at: 12 }];
  assert.deepEqual(taskHistoryEvents(messages, runs).map(({ kind, item }) => [kind, item.id]),
    [['run', 4], ['event', 7], ['event', 6], ['run', 3]]);
});

test('project history never falls back to global scope, rejects other projects and sorts by recency', async () => {
  const calls = [];
  const api = async (...args) => {
    calls.push(args);
    return { tickets: [
      { id: 7, project_id: 8, updated_at: 50 },
      { id: 2, project_id: 3, updated_at: 10 },
      { id: 4, project_id: 3, updated_at: 30 },
      { id: 3, project_id: '3', updated_at: 40 },
    ] };
  };
  assert.deepEqual(await loadProjectTicketHistory(api, null), []);
  assert.deepEqual((await loadProjectTicketHistory(api, 3)).map(ticket => ticket.id), [3, 4, 2]);
  assert.deepEqual(calls, [['GET', '/admin/tickets?projectId=3']]);
});

test('history entries are typed for display without changing them', async () => {
  const { historyEntryType, groupByDay } = await import('./src/conversation-history.mjs');
  assert.deepEqual(historyEntryType({ kind: 'run', item: { id: 73, status: 'ok' } }), { type: 'run', title: 'Run #73', detail: 'ok' });
  assert.deepEqual(historyEntryType({ kind: 'event', item: { body: 'Status changed to “Done”. Total: $10.42 — 5m.' } }), { type: 'status', title: 'Done', detail: 'Total: $10.42 — 5m.' });
  assert.deepEqual(historyEntryType({ kind: 'event', item: { body: 'Landed on main (2a75b21c).' } }), { type: 'land', title: 'Landed on main (2a75b21c)', detail: '' });
  assert.equal(historyEntryType({ kind: 'event', item: { body: 'Project created.' } }).type, 'note');
  const day = Date.UTC(2026, 10, 18, 12) / 1000;
  const groups = groupByDay([{ at: day }, { at: day - 60 }, { at: day - 3 * 86400 }, { at: 0 }]);
  assert.deepEqual(groups.map(g => g.entries.length), [2, 1, 1]);
  assert.equal(groups.at(-1).label, 'Undated');
});
