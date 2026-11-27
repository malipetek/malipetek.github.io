import assert from 'node:assert/strict';
import test from 'node:test';

import { hostingMessage } from './project-hosting.mjs';

const project = { name: 'Petek Koleji', slug: 'petekkoleji' };
const owner = 'petekkoleji2023@gmail.com';
const school = { id: 8, email: owner, accounts: [{ id: '3b10da48', name: "Petekkoleji2023@gmail.com's Account" }] };

test('an OAuth grant lists its Workers and says it is the owner’s grant', () => {
  const text = hostingMessage(project, {
    connected: true,
    via: 'oauth',
    connectionId: 8,
    accountId: '3b10da48',
    connections: [school],
    owner,
    pages: null,
    workers: { ok: true, items: [{ name: 'petekkoleji', modifiedOn: '2026-11-20T10:00:00Z' }, { name: 'petekkoleji-mailer', modifiedOn: '2025-01-02T10:00:00Z' }] },
    domains: { ok: true, items: [{ host: 'petekkoleji.com', kind: 'pages', name: 'petekkoleji-site', via: 'CNAME petekkoleji-site.pages.dev' }] },
    target: null,
  });
  assert.match(text, /petekkoleji\.com: Pages project petekkoleji-site \(CNAME/);
  assert.match(text, new RegExp(`read through the owner's Cloudflare connection #8 \\(${owner}\\), account 3b10da48`));
  assert.doesNotMatch(text, /not on this project/);
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

test('no grant says the owner connects; a lapsed one says reconnect; no owner says so first', () => {
  const none = hostingMessage(project, { connected: false, connections: [], owner: owner.toUpperCase() });
  assert.match(none, /the project owner \(PETEKKOLEJI2023@GMAIL\.COM\) has not connected Cloudflare/);
  assert.match(none, /The project owner has no Cloudflare connection\./);
  assert.match(none, /Connections page/);
  assert.doesNotMatch(none, /pass connection/);
  assert.match(
    hostingMessage(project, { connected: false, lapsed: true, connectionId: 8, connections: [school], owner }),
    /the owner's Cloudflare connection #8 has lapsed; they reconnect it on the portal's Connections page/,
  );
  const noOwner = hostingMessage(project, { connected: false, needsOwner: true, connections: [], owner: null, target: null });
  assert.match(noOwner, /set the project owner first/i);
  assert.match(noOwner, /no other user's grant may be used/);
  assert.doesNotMatch(noOwner, /#8/);
  assert.match(noOwner, /Deploy target: not set\./);
});
