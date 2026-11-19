import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextRowIndex } from './src/row-navigation.mjs';

test('j and ArrowDown move to the next row', () => {
  assert.equal(nextRowIndex(0, 3, 'j'), 1);
  assert.equal(nextRowIndex(1, 3, 'ArrowDown'), 2);
});

test('k and ArrowUp move to the previous row', () => {
  assert.equal(nextRowIndex(2, 3, 'k'), 1);
  assert.equal(nextRowIndex(1, 3, 'ArrowUp'), 0);
});

test('Home and End jump to the first and last row', () => {
  assert.equal(nextRowIndex(1, 4, 'Home'), 0);
  assert.equal(nextRowIndex(1, 4, 'End'), 3);
});

test('with no focused row j, ArrowDown and k start at the first row', () => {
  assert.equal(nextRowIndex(-1, 3, 'j'), 0);
  assert.equal(nextRowIndex(-1, 3, 'ArrowDown'), 0);
  assert.equal(nextRowIndex(-1, 3, 'k'), 0);
  assert.equal(nextRowIndex(-1, 3, 'ArrowUp'), 0);
});

test('navigation clamps at both ends and never wraps', () => {
  assert.equal(nextRowIndex(2, 3, 'j'), 2);
  assert.equal(nextRowIndex(2, 3, 'ArrowDown'), 2);
  assert.equal(nextRowIndex(0, 3, 'k'), 0);
  assert.equal(nextRowIndex(0, 3, 'ArrowUp'), 0);
});

test('an empty page has nowhere to go', () => {
  assert.equal(nextRowIndex(-1, 0, 'j'), null);
  assert.equal(nextRowIndex(0, 0, 'ArrowDown'), null);
  assert.equal(nextRowIndex(0, 0, 'Home'), null);
  assert.equal(nextRowIndex(0, 0, 'End'), null);
});

test('keys that do not navigate return null', () => {
  assert.equal(nextRowIndex(0, 3, 'Enter'), null);
  assert.equal(nextRowIndex(0, 3, '/'), null);
  assert.equal(nextRowIndex(0, 3, 'Tab'), null);
});

test('an out-of-range current index is treated as no focused row', () => {
  assert.equal(nextRowIndex(99, 3, 'j'), 0);
  assert.equal(nextRowIndex(3, 3, 'k'), 0);
});
