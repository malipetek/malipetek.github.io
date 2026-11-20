import test from 'node:test';
import assert from 'node:assert/strict';
import { unshippedPreview } from './project-world-model.mjs';

const NOW = 1_800_000_000_000;
const sec = (msAgo) => Math.floor((NOW - msAgo) / 1000);
const site = (extra) => ({ state: 'ready', previewDeploy: 'd4', productionDeploy: 'd1', ...extra });
const deploys = [
  { id: 'd4', created_at: sec(5 * 60_000), ticket_id: 42 },
  { id: 'd3', created_at: sec(40 * 60_000), ticket_id: 42 },
  { id: 'd2', created_at: sec(4 * 3600_000), ticket_id: 40 },
  { id: 'd1', created_at: sec(3 * 86400_000), ticket_id: 39 },
];
const tickets = [{ id: 42, title: 'Holiday hours banner' }, { id: 40, title: 'Menu photos' }];

test('lists each unshipped request once, newest first, and how long the oldest has waited', () => {
  const r = unshippedPreview({ sites: [site()], deploys, tickets, now: NOW });
  assert.equal(r.count, 2);
  assert.equal(r.text, '2 changes on preview · unshipped 4h (since #40)');
  assert.deepEqual(r.items.map((i) => [i.ticketId, i.title, i.age]), [[42, '#42 Holiday hours banner', '5m'], [40, '#40 Menu photos', '4h']]);
});

test('a direct update and a site never published live', () => {
  const r = unshippedPreview({ sites: [site({ previewDeploy: 'x', productionDeploy: null })], deploys: [{ id: 'x', created_at: sec(2 * 86400_000) }], now: NOW });
  assert.equal(r.text, '1 change on preview · unshipped 2d');
  assert.equal(r.items[0].title, 'Direct site update');
});

test('nothing when synced, not ready, or the history cannot place both versions', () => {
  assert.equal(unshippedPreview({ sites: [site({ previewDeploy: 'd1' })], deploys, now: NOW }), null);
  assert.equal(unshippedPreview({ sites: [site({ state: 'building' })], deploys, now: NOW }), null);
  assert.equal(unshippedPreview({ sites: [site()], deploys: null, now: NOW }), null);
  assert.equal(unshippedPreview({ sites: [site({ productionDeploy: 'gone' })], deploys, now: NOW }), null);
  assert.equal(unshippedPreview({ sites: [], deploys, now: NOW }), null);
});

test('direct updates fold into one row with the oldest age', () => {
  const ds = [
    { id: 'p', created_at: sec(60_000) },
    { id: 'q', created_at: sec(2 * 3600_000), ticket_id: 42 },
    { id: 'r', created_at: sec(3 * 3600_000) },
    { id: 'l', created_at: sec(86400_000 * 5) },
  ];
  const r = unshippedPreview({ sites: [site({ previewDeploy: 'p', productionDeploy: 'l' })], deploys: ds, tickets, now: NOW });
  assert.equal(r.count, 3);
  assert.equal(r.text, '3 changes on preview · unshipped 3h');
  assert.deepEqual(r.items.map((i) => [i.title, i.age]), [['2 direct site updates', '3h'], ['#42 Holiday hours banner', '2h']]);
});
