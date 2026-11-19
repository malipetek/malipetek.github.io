import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ISO_TILE, STALL_SECONDS, countsSummary, iso, parkPlots, plotAriaLabel } from './src/project-park.mjs';

const NOW_SEC = 1_760_000_000;
const NOW_MS = NOW_SEC * 1000;

test('empty or missing input returns an empty plot list', () => {
  assert.deepEqual(parkPlots(), []);
  assert.deepEqual(parkPlots({}), []);
  assert.deepEqual(parkPlots({ projects: [], tickets: [], runs: [], now: NOW_MS }), []);
  assert.deepEqual(parkPlots({ projects: null, tickets: null, runs: null }), []);
});

test('computes each plot state: calm, active, attention, and bad', () => {
  const projects = [
    { id: 'p-calm', name: 'Calm Site', clients: [{ name: 'Alice' }], sites: [{ id: 's1', state: 'ready' }] },
    { id: 'p-active', name: 'Active Site', clients: [{ email: 'bob@example.com' }], sites: [{ id: 's2', state: 'ready' }] },
    { id: 'p-attn', name: 'Attention Site', clients: [{ name: 'Carol' }] },
    { id: 'p-stalled', name: 'Stalled Site' },
    { id: 'p-failing', name: 'Failing Site', sites: [{ id: 's3', state: 'failed' }] },
  ];
  const tickets = [
    { id: 1, project_id: 'p-calm', status: 'done', updated_at: NOW_SEC - 10_000, client_waiting_since: NOW_SEC - 5000 },
    { id: 2, project_id: 'p-active', status: 'in_progress', updated_at: NOW_SEC - 300 },
    { id: 3, project_id: 'p-attn', status: 'new', updated_at: NOW_SEC - 600 },
    { id: 4, project_id: 'p-stalled', status: 'in_progress', updated_at: NOW_SEC - (STALL_SECONDS + 120), client_email: 'dave@example.com' },
  ];
  const runs = [{ id: 10, ticket_id: 2, executor: 'codex', started_at: NOW_SEC - 300 }];

  const plots = parkPlots({ projects, tickets, runs, now: NOW_MS });
  const byId = new Map(plots.map((p) => [p.id, p]));

  assert.equal(byId.get('p-calm').state, 'calm');
  assert.deepEqual(byId.get('p-calm').counts, { needsYou: 0, running: 0, stalled: 0, failing: 0 });
  assert.equal(byId.get('p-calm').client, 'Alice');

  assert.equal(byId.get('p-active').state, 'active');
  assert.deepEqual(byId.get('p-active').counts, { needsYou: 0, running: 1, stalled: 0, failing: 0 });
  assert.equal(byId.get('p-active').client, 'bob@example.com');

  assert.equal(byId.get('p-attn').state, 'attention');
  assert.deepEqual(byId.get('p-attn').counts, { needsYou: 1, running: 0, stalled: 0, failing: 0 });

  assert.equal(byId.get('p-stalled').state, 'bad');
  assert.deepEqual(byId.get('p-stalled').counts, { needsYou: 0, running: 0, stalled: 1, failing: 0 });
  assert.equal(byId.get('p-stalled').client, 'dave@example.com');

  assert.equal(byId.get('p-failing').state, 'bad');
  assert.deepEqual(byId.get('p-failing').counts, { needsYou: 0, running: 0, stalled: 0, failing: 1 });
});

test('sorts plots by urgency with most urgent front-left', () => {
  const projects = [
    { id: 'calm-z', name: 'Zebra' },
    { id: 'calm-a', name: 'Alpha' },
    { id: 'running-1', name: 'Runner' },
    { id: 'attn-1', name: 'One Waiting' },
    { id: 'attn-3', name: 'Three Waiting' },
    { id: 'stalled-1', name: 'Stuck Run' },
    { id: 'fail-1', name: 'Broken Deploy', site: { id: 's1', state: 'failed' } },
  ];
  const tickets = [
    { id: 1, project_id: 'running-1', status: 'in_progress', updated_at: NOW_SEC - 120 },
    { id: 2, project_id: 'attn-1', status: 'review', updated_at: NOW_SEC - 120 },
    { id: 3, project_id: 'attn-3', status: 'new', updated_at: NOW_SEC - 120 },
    { id: 4, project_id: 'attn-3', status: 'review', updated_at: NOW_SEC - 120 },
    { id: 5, project_id: 'attn-3', status: 'approved', client_waiting_since: NOW_SEC - 600, updated_at: NOW_SEC - 120 },
    { id: 6, project_id: 'stalled-1', status: 'in_progress', updated_at: NOW_SEC - (STALL_SECONDS + 60) },
  ];
  const runs = { running: [{ id: 20, ticket_id: 1, started_at: NOW_SEC - 120 }] };

  const plots = parkPlots({ projects, tickets, runs, now: NOW_SEC });
  assert.deepEqual(
    plots.map((p) => p.id),
    ['fail-1', 'stalled-1', 'attn-3', 'attn-1', 'running-1', 'calm-a', 'calm-z'],
  );

  // Front-left check: index 0 has minimum projected X and maximum projected Y.
  const screen = plots.map((p) => iso(p.x, p.y));
  const minX = Math.min(...screen.map((pt) => pt.x));
  const maxY = Math.max(...screen.map((pt) => pt.y));
  assert.equal(screen[0].x, minX);
  assert.equal(screen[0].y, maxY);

  // Constant compact vertical span (2-row ribbon never drifts vertically).
  const minY = Math.min(...screen.map((pt) => pt.y));
  assert.equal(maxY - minY, ISO_TILE.height / 2);
});

test('needsYou deduplicates overlapping ticket signals and excludes closed tickets', () => {
  const projects = [{ id: 'p1', name: 'Shop' }];
  const tickets = [
    // Both review and client_waiting_since -> counts once in needsYou
    { id: 1, project_id: 'p1', status: 'review', client_waiting_since: NOW_SEC - 100, updated_at: NOW_SEC - 100 },
    // Approved with client_waiting_since -> counts in needsYou
    { id: 2, project_id: 'p1', status: 'approved', client_waiting_since: NOW_SEC - 200, updated_at: NOW_SEC - 200 },
    // Declined with client_waiting_since -> closed, does not count
    { id: 3, project_id: 'p1', status: 'declined', client_waiting_since: NOW_SEC - 200, updated_at: NOW_SEC - 200 },
    // In progress without active run and not stalled (<= 45m) -> calm
    { id: 4, project_id: 'p1', status: 'in_progress', updated_at: NOW_SEC - STALL_SECONDS },
  ];
  const runs = [
    // Terminal run should not count as running
    { id: 1, ticket_id: 4, status: 'failed', finished_at: NOW_SEC - 10 },
    // Active run for a non-in_progress ticket should not count as running
    { id: 2, ticket_id: 1, started_at: NOW_SEC - 10 },
  ];

  const [plot] = parkPlots({ projects, tickets, runs, now: NOW_MS });
  assert.equal(plot.state, 'attention');
  assert.deepEqual(plot.counts, { needsYou: 2, running: 0, stalled: 0, failing: 0 });
});

test('failing counts both site.state failed and non-empty site.rebuildError', () => {
  const projects = [
    {
      id: 'p1',
      name: 'Multi',
      sites: [
        { id: 'a', state: 'ready', rebuildError: null },
        { id: 'b', state: 'failed', rebuildError: 'boom' },
        { id: 'c', state: 'ready', rebuildError: 'build exit 1' },
      ],
    },
  ];
  const [plot] = parkPlots({ projects, now: NOW_MS });
  assert.equal(plot.state, 'bad');
  assert.equal(plot.counts.failing, 2);
});

test('unknown fields and malformed entries are ignored cleanly', () => {
  const projects = [
    null,
    'not-a-project',
    { name: 'Missing Id' },
    {
      id: 'p1',
      name: 'Clean Plot',
      unknownFlag: true,
      secretToken: 'should-not-leak',
      sites: [null, { id: 's1', state: 'ready', mysteriousField: 42 }],
      clients: [null, { name: 'Jane', extra: 'ignored' }],
    },
    // Duplicate id ignored
    { id: 'p1', name: 'Duplicate Plot' },
  ];
  const tickets = [
    null,
    { id: 1, project_id: 'p1', status: 'new', weirdProp: { nested: 1 } },
    { id: 2, project_id: 'other', status: 'new' },
    { id: 3, status: 'new' },
  ];
  const runs = [null, { ticket_id: 1, bogus: 99 }];

  const plots = parkPlots({ projects, tickets, runs, now: NOW_MS });
  assert.equal(plots.length, 1);
  assert.deepEqual(Object.keys(plots[0]).sort(), ['client', 'counts', 'id', 'name', 'state', 'x', 'y']);
  assert.equal(plots[0].name, 'Clean Plot');
  assert.equal(plots[0].client, 'Jane');
  assert.deepEqual(plots[0].counts, { needsYou: 1, running: 0, stalled: 0, failing: 0 });
});

test('iso() projects 3D coordinates cleanly and avoids NaN', () => {
  assert.deepEqual(iso(0, 0, 0), { x: 0, y: 0 });
  assert.deepEqual(iso(1, 0, 0), { x: ISO_TILE.width / 2, y: ISO_TILE.height / 2 });
  assert.deepEqual(iso(0, 1, 0), { x: -ISO_TILE.width / 2, y: ISO_TILE.height / 2 });
  assert.deepEqual(iso(1, 1, 20), { x: 0, y: ISO_TILE.height - 20 });
  assert.deepEqual(iso(1, 0, 5, { tileW: 100, tileH: 50, originX: 10, originY: 20 }), { x: 60, y: 40 });
  assert.deepEqual(iso(NaN, undefined, Infinity), { x: 0, y: 0 });
});

test('countsSummary and plotAriaLabel format words cleanly', () => {
  assert.equal(countsSummary({ needsYou: 0, running: 0, stalled: 0, failing: 0 }), 'Calm, nothing waiting');
  assert.equal(
    countsSummary({ needsYou: 1, running: 2, stalled: 1, failing: 1 }),
    '1 failing site, 1 stalled, 1 needs you, 2 running',
  );
  assert.equal(
    plotAriaLabel({
      id: 'p1',
      name: 'Acme',
      client: 'Alice',
      state: 'attention',
      counts: { needsYou: 2, running: 0, stalled: 0, failing: 0 },
    }),
    'Acme (Alice) — attention: 2 need you',
  );
});
