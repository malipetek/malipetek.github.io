import assert from 'node:assert/strict';
import test from 'node:test';

import { inviteMessage } from './client-invite.mjs';

const week = () => Math.floor(Date.now() / 1000) + 7 * 86400;

test('a new address gets an account and its projects before it signs up', () => {
  const text = inviteMessage({
    user: { email: 'it@petekkoleji.com', verified_at: null },
    projects: [{ name: 'Petek Koleji' }],
    invite: { sent: true, expiresAt: week() },
  });
  assert.match(text, /^it@petekkoleji\.com now has Petek Koleji\./);
  assert.match(text, /New account, waiting for its first sign-in/);
  assert.match(text, /works for 7 days/);
});

test('an existing account only gains the projects', () => {
  const text = inviteMessage({
    user: { email: 'lena@sugarwolf.com', verified_at: 1700000000 },
    projects: [{ name: 'Sugar Wolf Bakery' }, { name: 'Petek Koleji' }],
    invite: { sent: true, expiresAt: week() },
  });
  assert.match(text, /now has Sugar Wolf Bakery, Petek Koleji/);
  assert.match(text, /Existing account/);
});

test('a failed send says the access is still in place', () => {
  const text = inviteMessage({ user: { email: 'a@b.co' }, projects: [{ name: 'X' }], invite: { sent: false } });
  assert.match(text, /could not be sent; the access is in place/);
});
