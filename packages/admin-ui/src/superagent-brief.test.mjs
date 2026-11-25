import assert from 'node:assert/strict';
import test from 'node:test';

import { shorten, superagentBrief, superagentTitle } from './superagent-brief.js';

test('the whole system needs no scope line: the prompt is the ask', () => {
  assert.equal(superagentBrief({ text: 'Which previews are waiting?' }), 'Which previews are waiting?');
});

test('the role and the write rule stay out of the chat (the Host adds them)', () => {
  const brief = superagentBrief({ scope: 't:212', label: '#212 Holiday hours', text: 'x' });
  assert.doesNotMatch(brief, /You are the PTech Admin superagent/);
  assert.doesNotMatch(brief, /approval card/);
});

test('each scope is one short line above the ask', () => {
  assert.equal(superagentBrief({ scope: 'p:2', label: 'Bakery', text: 'x' }), 'Scope: project “Bakery” (p:2)\n\nx');
  assert.equal(superagentBrief({ scope: 'c:7', label: 'lena@x.test', text: 'x' }), 'Scope: client “lena@x.test” (c:7)\n\nx');
  assert.equal(superagentBrief({ scope: 't:212', label: '#212 Holiday hours', text: 'x' }), 'Scope: ticket #212 Holiday hours (t:212)\n\nx');
});

test('the title names the scope and carries the ask', () => {
  assert.equal(superagentTitle({ ask: 'What is stuck?' }), 'Superagent · whole system — What is stuck?');
  assert.equal(superagentTitle({ scope: 'p:2', label: 'Bakery', ask: 'Tidy the menu' }), 'Superagent · Bakery — Tidy the menu');
  assert.equal(superagentTitle({ scope: 't:212', label: '#212', ask: 'what does it need next?' }), 'Superagent · #212 — what does it need next?');
});

test('a long ask is cut at a word, and a short one is untouched', () => {
  assert.equal(shorten('Which previews are waiting to be published?'), 'Which previews are waiting to be published?');
  const long = shorten('Move every review ticket from this week to done, and tell me what changed on each project');
  assert.ok(long.length <= 49, long);
  assert.match(long, /…$/);
  assert.doesNotMatch(long, / ,/);
  assert.equal(shorten('first line\nsecond line'), 'first line');
});
