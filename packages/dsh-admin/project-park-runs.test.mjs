import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTrail } from './src/project-park.mjs';

const NOW = 1_800_000_000; // seconds

test('no runs for the ticket gives nothing', () => {
  assert.equal(runTrail(5, [], [], NOW * 1000), null);
  assert.equal(runTrail(null, [{ ticket_id: 5 }], [], NOW * 1000), null);
});

test('runs from both lists count once, oldest first, with real durations', () => {
  const recent = [
    { id: 3, ticket_id: 7, status: 'running', started_at: NOW - 300 },
    { id: 2, ticket_id: 7, status: 'failed', started_at: NOW - 3000, finished_at: NOW - 2880 },
    { id: 1, ticket_id: 7, status: 'ok', started_at: NOW - 9000, finished_at: NOW - 8400 },
    { id: 9, ticket_id: 8, status: 'ok', started_at: NOW - 100, finished_at: NOW - 50 },
  ];
  const running = [{ id: 3, ticket_id: 7, status: 'running', started_at: NOW - 300 }];
  const trail = runTrail(7, running, recent, NOW * 1000);
  assert.deepEqual(trail.runs.map((r) => [r.id, r.kind, r.seconds]), [[1, 'ok', 600], [2, 'failed', 120], [3, 'running', 300]]);
  assert.equal(trail.total, 3);
  assert.equal(trail.failed, 1);
  assert.equal(trail.summary, '3 runs · 1 failed · running now · 17m agent');
});

test('unknown statuses and missing times never invent durations', () => {
  const trail = runTrail(4, [], [{ id: 1, ticket_id: 4, status: 'cancelled' }, { id: 2, ticket_id: 4, status: 'ok', started_at: NOW - 60 }], NOW * 1000);
  assert.deepEqual(trail.runs.map((r) => [r.kind, r.seconds]), [['other', 0], ['ok', 0]]);
  assert.equal(trail.summary, '2 runs');
});

test('only the latest runs are kept for the band, the summary counts all', () => {
  const recent = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, ticket_id: 1, status: 'ok', started_at: NOW - 1000 + i * 10, finished_at: NOW - 995 + i * 10 }));
  const trail = runTrail(1, [], recent, NOW * 1000, 6);
  assert.equal(trail.runs.length, 6);
  assert.equal(trail.runs[0].id, 4);
  assert.match(trail.summary, /^9 runs · 45s agent$/);
});
