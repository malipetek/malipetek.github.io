import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { decide } from '../hooks/stop-hook.mjs';

const hook = fileURLToPath(new URL('../hooks/stop-hook.mjs', import.meta.url));

/** Write a transcript: a human message, then assistant entries. */
function transcript(...assistant) {
  const dir = mkdtempSync(join(tmpdir(), 'hook-'));
  const file = join(dir, 't.jsonl');
  const lines = [{ type: 'user', message: { content: 'refurbish the admin UI' } }, ...assistant];
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'));
  return file;
}
const say = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const use = (name) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input: {} }] } });

test('a menu of next steps without a status is sent back to work', () => {
  const reason = decide({ transcript_path: transcript(say('Audit done.\n\nNext steps:\n1. fix nav\n2. fix forms\n\nWould you like me to continue?')) });
  assert.match(reason, /continue now/);
});

test('a reported status ends the turn', () => {
  assert.equal(decide({ transcript_path: transcript(say('Fixed 14 issues, build passes.\nSTATUS: done')) }), null);
  assert.equal(decide({ transcript_path: transcript(say('I can also add tests later.\nSTATUS: blocked — which brand colour?')) }), null);
});

test('a status followed by an offer to continue is still a menu', () => {
  const reason = decide({ transcript_path: transcript(say('Wrote notes.txt.\nSTATUS: done\n\nNext steps: 1. add a third line. Would you like me to continue?')) });
  assert.match(reason, /continue now/);
});

test('an ordinary answer ends the turn', () => {
  assert.equal(decide({ transcript_path: transcript(say('The function returns the cached value when the key exists.')) }), null);
});

test('asking where to deploy without reading the project context is sent back', () => {
  const reason = decide({ transcript_path: transcript(say("All fixes are in. I don't know where to deploy it — where should I deploy this?")) });
  assert.match(reason, /project_context/);
});

test('asking where to deploy after reading the context is allowed', () => {
  const file = transcript(use('mcp__dsh__project_context'), say('The card has no deploy target and the repo has none either. Where should I deploy this?\nSTATUS: blocked — deploy target'));
  assert.equal(decide({ transcript_path: file }), null);
});

test('the hook never loops: a stop already continued by a hook ends', () => {
  assert.equal(decide({ stop_hook_active: true, transcript_path: transcript(say('Would you like me to continue?')) }), null);
});

test('as a process it prints a block decision, and nothing otherwise', () => {
  const block = execFileSync(process.execPath, [hook], { input: JSON.stringify({ last_assistant_message: 'Shall I go ahead with the remaining steps?' }) }).toString();
  assert.equal(JSON.parse(block).decision, 'block');
  const pass = execFileSync(process.execPath, [hook], { input: JSON.stringify({ last_assistant_message: 'Done.\nSTATUS: done' }) }).toString();
  assert.equal(pass, '');
  const broken = execFileSync(process.execPath, [hook], { input: 'not json' }).toString();
  assert.equal(broken, '');
});
