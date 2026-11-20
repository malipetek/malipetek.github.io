import assert from 'node:assert/strict';
import { test } from 'node:test';
import { longAge, ticketWait, plotTickets, plotWaitLabel } from './src/project-park.mjs';

const NOW = 1_800_000_000;
const ms = NOW * 1000;

test('long ages keep two units', () => {
  assert.equal(longAge(45), '45s');
  assert.equal(longAge(45 * 60), '45m');
  assert.equal(longAge(3 * 3600 + 10 * 60), '3h 10m');
  assert.equal(longAge(3 * 3600), '3h');
  assert.equal(longAge(2 * 86400 + 4 * 3600 + 59), '2d 4h');
});

test('a review waits from the end of its latest finished run, else from its last update', () => {
  const recent = [
    { id: 1, ticket_id: 7, status: 'failed', started_at: NOW - 13000, finished_at: NOW - 12500 },
    { id: 2, ticket_id: 7, status: 'ok', started_at: NOW - 12000, finished_at: NOW - 11400 },
    { id: 3, ticket_id: 7, status: 'ok', started_at: NOW - 7000, finished_at: NOW - (3 * 3600 + 10 * 60) },
  ];
  assert.equal(ticketWait({ id: 7, status: 'review', updated_at: NOW - 60 }, recent, ms).text, 'waiting 3h 10m on you');
  assert.equal(ticketWait({ id: 8, status: 'review', updated_at: NOW - 600 }, recent, ms).text, 'waiting 10m on you');
});

test('new tickets wait for approval from filing; client replies from client_waiting_since', () => {
  assert.equal(ticketWait({ id: 1, status: 'new', created_at: NOW - 45 * 60, updated_at: NOW - 10 }, [], ms).text, 'waiting 45m for approval');
  assert.equal(ticketWait({ id: 2, status: 'in_progress', client_waiting_since: NOW - 7200 }, [], ms).text, 'waiting 2h on your reply');
});

test('no wait without a person to wait on or a timestamp', () => {
  assert.equal(ticketWait({ id: 1, status: 'in_progress', updated_at: NOW - 60 }, [], ms), null);
  assert.equal(ticketWait({ id: 1, status: 'done', updated_at: NOW - 60 }, [], ms), null);
  assert.equal(ticketWait({ id: 1, status: 'new' }, [], ms), null);
  assert.equal(ticketWait({ id: 1, status: 'review', updated_at: NOW + 60 }, [], ms), null);
  assert.equal(ticketWait(null), null);
});

test('rows carry their wait, and the plot names its longest one', () => {
  const plot = { id: 'p' };
  const tickets = [
    { id: 1, project_id: 'p', status: 'new', created_at: NOW - 600, updated_at: NOW - 600 },
    { id: 2, project_id: 'p', status: 'review', updated_at: NOW - 60 },
    { id: 3, project_id: 'p', status: 'in_progress', updated_at: NOW - 60 },
  ];
  const recent = [{ id: 9, ticket_id: 2, status: 'ok', started_at: NOW - 20000, finished_at: NOW - 3 * 3600 }];
  const rows = plotTickets(plot, tickets, [], ms, recent);
  const waits = Object.fromEntries(rows.map((r) => [r.id, r.wait?.text ?? null]));
  assert.deepEqual(waits, { 1: 'waiting 10m for approval', 2: 'waiting 3h on you', 3: null });
  assert.equal(plotWaitLabel(plot, tickets, [], ms, recent), 'Needs you · 3h');
  assert.equal(plotWaitLabel(plot, [tickets[2]], [], ms, recent), null);
});
