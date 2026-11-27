import assert from 'node:assert/strict';
import test from 'node:test';

import { hostingMessage } from './project-hosting.mjs';

const project = { name: 'Petek Koleji', slug: 'petekkoleji' };
const school = { id: 8, email: 'petekkoleji2023@gmail.com', accounts: [{ id: '3b10da48', name: "Petekkoleji2023@gmail.com's Account" }], onProject: false };

test('an OAuth grant lists its Workers and says whose grant it is', () => {
  const text = hostingMessage(project, {
    connected: true,
    via: 'oauth',
    connectionId: 8,
    accountId: '3b10da48',
    connections: [school],
    pages: null,
    workers: { ok: true, items: [{ name: 'petekkoleji', modifiedOn: '2026-11-20T10:00:00Z' }, { name: 'petekkoleji-mailer', modifiedOn: '2025-01-02T10:00:00Z' }] },
    target: null,
  });
  assert.match(text, /petekkoleji2023@gmail\.com's Cloudflare connection #8/);
  assert.match(text, /not on this project/);
  assert.match(text, /petekkoleji \(changed 2026-11-20\)/);
  assert.match(text, /#8 .*← used/);
  assert.match(text, /Deploy target: not set\./);
  assert.doesNotMatch(text, /Pages projects/);
});

test('a refused section names the permission', () => {
  const text = hostingMessage(project, {
    connected: true,
    via: 'token',
    accountId: 'a',
    pages: { ok: false, error: 'The token is not allowed to read this.', permission: 'Cloudflare Pages: Read (Edit to deploy)' },
    workers: { ok: true, items: [] },
    target: { kind: 'workers', name: 'petekkoleji', productionBranch: 'main', connectionId: 8 },
  });
  assert.match(text, /It needs Cloudflare Pages: Read/);
  assert.match(text, /Worker scripts: none\./);
  assert.match(text, /Worker petekkoleji, production from main, through connection #8\./);
});

test('no fitting grant lists the ones there are; a lapsed one says reconnect', () => {
  assert.match(hostingMessage(project, { connected: false, connections: [school] }), /pass connection[\s\S]*#8 petekkoleji2023/);
  assert.match(hostingMessage(project, { connected: false, lapsed: true, connectionId: 8, connections: [school] }), /has lapsed/);
});
