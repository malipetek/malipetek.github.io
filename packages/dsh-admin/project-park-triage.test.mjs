import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PARK_FILTERS,
  filterCounts,
  plotHeadline,
  plotMatches,
  plotTickets,
  shortAge,
} from './src/project-park.mjs';

const NOW = 1_800_000_000; // seconds
const plot = (id, counts) => ({ id, name: id, counts: { needsYou: 0, failing: 0, stalled: 0, running: 0, ...counts } });

test('filters keep the plots that have that signal; all keeps everything', () => {
  assert.deepEqual(PARK_FILTERS.map((f) => f.key), ['all', 'needsYou', 'failing', 'stalled', 'running']);
  const a = plot('a', { needsYou: 2 });
  const b = plot('b', { stalled: 1, failing: 1 });
  const c = plot('c', {});
  assert.equal(plotMatches(a, 'all'), true);
  assert.equal(plotMatches(c, undefined), true);
  assert.equal(plotMatches(a, 'needsYou'), true);
  assert.equal(plotMatches(b, 'needsYou'), false);
  assert.equal(plotMatches(b, 'failing'), true);
  assert.deepEqual(filterCounts([a, b, c]), { all: 3, needsYou: 1, failing: 1, stalled: 1, running: 0 });
  assert.deepEqual(filterCounts([]), { all: 0, needsYou: 0, failing: 0, stalled: 0, running: 0 });
});

test('shortAge is compact and never negative or NaN', () => {
  assert.equal(shortAge(5), '5s');
  assert.equal(shortAge(125), '2m');
  assert.equal(shortAge(3 * 3600 + 5), '3h');
  assert.equal(shortAge(3 * 86400), '3d');
  assert.equal(shortAge(-10), '0s');
  assert.equal(shortAge('x'), '0s');
});

test('plotTickets lists open tickets of the project, most urgent first', () => {
  const tickets = [
    { id: 1, project_id: 'p', title: 'Old stalled', status: 'in_progress', updated_at: NOW - 3 * 86400 },
    { id: 2, project_id: 'p', title: 'Needs review', status: 'review', updated_at: NOW - 3600, assistant_app: 'Claude' },
    { id: 3, project_id: 'p', title: 'Running now', status: 'in_progress', updated_at: NOW - 60 },
    { id: 4, project_id: 'p', title: 'Shipped', status: 'done', updated_at: NOW },
    { id: 5, project_id: 'other', title: 'Elsewhere', status: 'review', updated_at: NOW },
  ];
  const runs = [{ ticket_id: 3, status: 'running', started_at: NOW - 600 }];
  const rows = plotTickets({ id: 'p' }, tickets, runs, NOW * 1000);
  assert.deepEqual(rows.map((r) => [r.id, r.kind]), [[1, 'stalled'], [2, 'needsYou'], [3, 'running']]);
  assert.equal(rows[0].age, '3d');
  assert.equal(rows[1].via, 'Claude');
  assert.equal(rows[2].age, '10m', 'running age counts from the run start');
  assert.equal(rows[2].via, null);
  assert.deepEqual(plotTickets(null, tickets), []);
});

test('plotHeadline names the most urgent ticket; tolerates missing assistant_app', () => {
  const tickets = [
    { id: 910036, project_id: 'p', title: 'Update Christmas orders deadline to 20 December', status: 'in_progress', updated_at: NOW - 3 * 86400 },
  ];
  assert.equal(plotHeadline({ id: 'p' }, tickets, [], NOW * 1000), '#910036 Update Christmas orders dea… · 3d');
  const withApp = [{ ...tickets[0], assistant_app: 'ChatGPT' }];
  assert.match(plotHeadline({ id: 'p' }, withApp, [], NOW * 1000), / · via ChatGPT · 3d$/);
  assert.equal(plotHeadline({ id: 'p' }, [], [], NOW * 1000), null);
});
