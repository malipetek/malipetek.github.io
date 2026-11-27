import assert from 'node:assert/strict';
import test from 'node:test';

import { inviteMessage, inviteRequestBody } from './client-invite.mjs';

const week = () => Math.floor(Date.now() / 1000) + 7 * 86400;

test('the invite body defaults mail copies on, like the UI\'s Add people', () => {
  assert.deepEqual(
    inviteRequestBody({ email: ' it@petekkoleji.com ' }, ['p1', 'p2']),
    { email: 'it@petekkoleji.com', projectIds: ['p1', 'p2'], copy: true },
  );
});

test('the invite body honors a explicit copy: false', () => {
  assert.equal(inviteRequestBody({ email: 'a@b.co', copy: false }, ['p1']).copy, false);
  assert.equal(inviteRequestBody({ email: 'a@b.co', copy: true }, ['p1']).copy, true);
});

test('the invite body carries the optional name, locale and note only when given', () => {
  assert.deepEqual(
    inviteRequestBody({ email: 'a@b.co', clientName: '  Lena ', locale: ' tr-TR ', note: ' hi ' }, ['p1']),
    { email: 'a@b.co', projectIds: ['p1'], copy: true, name: 'Lena', locale: 'tr-TR', note: 'hi' },
  );
  const bare = inviteRequestBody({ email: 'a@b.co' }, ['p1']);
  assert.ok(!('name' in bare) && !('locale' in bare) && !('note' in bare));
});

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
