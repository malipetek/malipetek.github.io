import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fleetTicker } from './src/project-park.mjs';

const NOW = 1_800_000_000;

test('running tickets with live elapsed time, once each, longest first', () => {
  const running = [
    { id: 1, ticket_id: 7, status: 'running', started_at: NOW - 120, title: 'Hero photo' },
    { id: 2, ticket_id: 8, status: 'running', started_at: NOW - 900 },
    { id: 3, ticket_id: 7, status: 'running', started_at: NOW - 60 },
  ];
  const tickets = [{ id: 8, title: 'Menu page', status: 'in_progress' }];
  const r = fleetTicker({ running, tickets, now: NOW * 1000 });
  assert.deepEqual(r.running.map((x) => [x.ticketId, x.title, x.seconds]), [[8, 'Menu page', 900], [7, 'Hero photo', 120]]);
  assert.equal(r.idle, null);
});

test('attention: failed latest runs first, then finished runs waiting in review; retried or closed tickets drop out', () => {
  const recent = [
    { id: 10, ticket_id: 1, status: 'failed', started_at: NOW - 7200, finished_at: NOW - 7000 },
    { id: 11, ticket_id: 1, status: 'ok', started_at: NOW - 600, finished_at: NOW - 300 },
    { id: 12, ticket_id: 2, status: 'failed', started_at: NOW - 5000, finished_at: NOW - 4000 },
    { id: 13, ticket_id: 3, status: 'ok', started_at: NOW - 9000, finished_at: NOW - 8000 },
    { id: 14, ticket_id: 4, status: 'failed', started_at: NOW - 100, finished_at: NOW - 50 },
    { id: 15, ticket_id: 5, status: 'failed', started_at: NOW - 100, finished_at: NOW - 90 },
  ];
  const tickets = [
    { id: 1, status: 'review', title: 'Fixed after retry' },
    { id: 2, status: 'in_progress', title: 'Broke' },
    { id: 3, status: 'review', title: 'Ready to check' },
    { id: 4, status: 'done', title: 'Closed anyway' },
    { id: 5, status: 'in_progress', title: 'Retrying now' },
  ];
  const running = [{ id: 16, ticket_id: 5, status: 'running', started_at: NOW - 10 }];
  const r = fleetTicker({ running, recent, tickets, now: NOW * 1000 });
  assert.deepEqual(r.attention.map((a) => [a.ticketId, a.reason, a.seconds]), [[2, 'failed', 4000], [3, 'review', 8000], [1, 'review', 300]]);
  assert.equal(r.attentionTotal, 3);
});

test('a quiet fleet says when the last run finished; no runs at all says nothing', () => {
  const recent = [{ id: 1, ticket_id: 1, status: 'ok', started_at: NOW - 1000, finished_at: NOW - 720 }];
  const r = fleetTicker({ recent, tickets: [{ id: 1, status: 'done' }], now: NOW * 1000 });
  assert.deepEqual([r.running.length, r.attention.length, r.idle], [0, 0, 'last run finished 12m ago']);
  assert.equal(fleetTicker({ now: NOW * 1000 }).idle, null);
});
