import assert from 'node:assert/strict';
import test from 'node:test';
import { addressOf, judge, rowsIn } from './verify.mjs';

test('address: split, lowercased, syntax-checked', () => {
  assert.deepEqual(addressOf('Office@Acme.com'), { address: 'office@acme.com', local: 'office', domain: 'acme.com' });
  assert.equal(addressOf('not-an-address'), null);
  assert.equal(addressOf('a@b'), null);
  assert.equal(addressOf('a@b.c0m'), null);
});

test('judge: no MX is dropped, disposables are dropped, role inboxes are marked', () => {
  assert.equal(judge(addressOf('office@acme.com'), 0).keep, false);
  assert.equal(judge(addressOf('office@acme.com'), 0).reason, 'no_mx');
  assert.equal(judge(addressOf('x@mailinator.com'), 1).reason, 'disposable');

  const office = judge(addressOf('office@acme.com'), 2);
  assert.equal(office.keep, true);
  assert.deepEqual(office.flags, ['role inbox']);

  const owner = judge(addressOf('jim@acme.com'), 2);
  assert.equal(owner.keep, true);
  assert.deepEqual(owner.flags, []);

  const gmail = judge(addressOf('rosasflorist@gmail.com'), 5);
  assert.deepEqual(gmail.flags, ['free mailbox']);
});

test('rows: the desk CSV round-trips, quotes included', () => {
  const text = '\uFEFFemail,name,notes\r\ninfo@a.com,,"Denver, CO"\r\n"o""brien@b.com",,plain\r\n';
  assert.deepEqual(rowsIn(text), [
    ['email', 'name', 'notes'],
    ['info@a.com', '', 'Denver, CO'],
    ['o"brien@b.com', '', 'plain'],
  ]);
});
