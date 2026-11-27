import assert from 'node:assert/strict';
import test from 'node:test';

import { hostingMessage } from './project-hosting.mjs';

const project = { name: 'Petek Koleji', slug: 'petekkoleji' };

test('a connected account lists its Pages projects and Workers', () => {
  const text = hostingMessage(project, {
    connected: true,
    accountId: '3b10da48',
    pages: { ok: true, items: [{ name: 'petekkoleji', productionBranch: 'main', domains: ['petekkoleji.com'] }] },
    workers: { ok: true, items: [{ name: 'petekkoleji-mailer', modifiedOn: '2025-01-02T10:00:00Z' }] },
    target: null,
  });
  assert.match(text, /petekkoleji \(production branch main\) · petekkoleji\.com/);
  assert.match(text, /petekkoleji-mailer \(changed 2025-01-02\)/);
  assert.match(text, /Deploy target: not set\./);
});

test('a refused section names the permission to add', () => {
  const text = hostingMessage(project, {
    connected: true,
    accountId: 'a',
    pages: { ok: false, error: 'The token is not allowed to read this.', permission: 'Cloudflare Pages: Read (Edit to deploy)' },
    workers: { ok: true, items: [] },
    target: { kind: 'pages', name: 'petekkoleji', productionBranch: 'main' },
  });
  assert.match(text, /The token needs Cloudflare Pages: Read/);
  assert.match(text, /Worker scripts: none\./);
  assert.match(text, /Deploy target: Cloudflare Pages project petekkoleji, production from main\./);
});

test('no stored credential says so instead of listing nothing', () => {
  assert.match(hostingMessage(project, { connected: false, target: null }), /has no Cloudflare connected/);
});
