import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSISTANT_BADGE_MAX, assistantBadge, assistantBadgeTitle, assistantName } from './ticket-assistant.mjs';

test('a person-filed ticket has no assistant, so no badge and no title', () => {
  for (const ticket of [null, undefined, {}, { assistant_app: null }, { assistant_app: '' }, { assistant_app: '   ' }, { assistant_app: 7 }, { assistant_app: {} }]) {
    assert.equal(assistantName(ticket), null);
    assert.equal(assistantBadge(ticket), null);
    assert.equal(assistantBadgeTitle(ticket), null);
  }
});

test('a named assistant trims and reads "via <name>"', () => {
  assert.equal(assistantName({ assistant_app: '  Claude  ' }), 'Claude');
  assert.equal(assistantBadge({ assistant_app: 'Claude' }), 'via Claude');
  assert.equal(assistantBadge({ assistant_app: 'ChatGPT' }), 'via ChatGPT');
  assert.equal(assistantBadge({ assistant_app: '  MCP key: home-prod \n' }), 'via MCP key: home-prod');
});

test('a long assistant name is cut to the badge maximum with an ellipsis', () => {
  const long = 'Claude with a very long MCP key label';
  const badge = assistantBadge({ assistant_app: long });
  assert.equal(Array.from(badge).length, ASSISTANT_BADGE_MAX);
  assert.ok(badge.startsWith('via '));
  assert.ok(badge.endsWith('…'));
  assert.equal(badge, badge.trim());
  // The full name still reaches the hover text, so nothing is lost.
  assert.equal(assistantBadgeTitle({ assistant_app: long }), `Filed by the client's assistant (${long}) through PTech's MCP server`);
});

test('a name that just fits keeps every character and adds no ellipsis', () => {
  const name = 'A'.repeat(ASSISTANT_BADGE_MAX - 4);
  assert.equal(assistantBadge({ assistant_app: name }), `via ${name}`);
  assert.equal(Array.from(assistantBadge({ assistant_app: `${name}A` })).length, ASSISTANT_BADGE_MAX);
  assert.ok(assistantBadge({ assistant_app: `${name}A` }).endsWith('…'));
});

test('the title is the fixed sentence and the badge never mutates the ticket', () => {
  const ticket = { id: 24, assistant_app: 'Claude', source: 'assistant' };
  assert.equal(assistantBadge(ticket), 'via Claude');
  assert.equal(assistantBadgeTitle(ticket), "Filed by the client's assistant (Claude) through PTech's MCP server");
  assert.deepEqual(ticket, { id: 24, assistant_app: 'Claude', source: 'assistant' });
});
