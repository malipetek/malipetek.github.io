import test from 'node:test';
import assert from 'node:assert/strict';
import { pickedDirectory } from './picked-directory.mjs';

test('the remote picker\'s envelope is unwrapped to the path', () => {
  assert.equal(pickedDirectory({ ok: true, value: '/Users/me/Projects/acme' }), '/Users/me/Projects/acme');
});

test('cancelling gives null, from the envelope or a bare null', () => {
  assert.equal(pickedDirectory({ ok: true, value: null }), null);
  assert.equal(pickedDirectory(null), null);
  assert.equal(pickedDirectory(''), null);
});

test('a bare path from an older host still works', () => {
  assert.equal(pickedDirectory('/tmp/site'), '/tmp/site');
});

test('a failed pick throws with the host\'s reason', () => {
  assert.throws(() => pickedDirectory({ ok: false, error: { message: 'no display' } }), /Could not choose a folder: no display/);
});

test('anything else is not a path', () => {
  assert.equal(pickedDirectory({ path: 3 }), null);
});
