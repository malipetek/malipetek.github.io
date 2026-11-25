import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPERAGENT_GUIDANCE, isSuperagentSession, superagentSection } from './superagent-prompt.mjs';

const folder = '/Users/x/.dsh-admin/superagent';
const agent = (cwd) => ({ session: { header: { cwd } } });

test('a superagent session gets the role, the write rule and the scope rule', () => {
  const text = superagentSection(folder).text({ agent: agent(folder) });
  assert.equal(text, SUPERAGENT_GUIDANCE);
  assert.match(text, /PTech Admin superagent/);
  assert.match(text, /approval card/);
  assert.match(text, /"Scope:" line/);
});

test('every other session gets nothing', () => {
  const section = superagentSection(folder);
  assert.equal(section.text({ agent: agent('/Users/x/Projects/demo') }), '');
  assert.equal(section.text({ agent: agent(undefined) }), '');
  assert.equal(section.text({}), '');
  assert.equal(section.text(undefined), '');
});

test('the folder matches with or without a trailing slash', () => {
  assert.ok(isSuperagentSession({ header: { cwd: `${folder}/` } }, folder));
  assert.ok(!isSuperagentSession({ header: { cwd: `${folder}-old` } }, folder));
});

test('the section text is literal: no prompt variables are interpolated', () => {
  const section = superagentSection(folder);
  assert.equal(section.interpolate, false);
  assert.ok(Number.isFinite(section.order));
});
