import test from 'node:test';
import assert from 'node:assert/strict';
import { addedSince, lastRun, requeueBrief } from './requeue.mjs';

const runs = [
  { id: 47, started_at: '2026-11-01T10:00:00Z' },
  { id: 48, started_at: '2026-11-01T15:01:00Z' },
];

test('the last run is the one that started last, whatever the order', () => {
  assert.equal(lastRun([...runs].reverse()).id, 48);
  assert.equal(lastRun([]), null);
});

test('nothing added since the last run says the agent gets the same instructions', () => {
  const messages = [{ author: 'client', created_at: '2026-11-01T10:40:00Z', body: 'what does access mean?' }];
  const brief = requeueBrief({ messages, runs });
  assert.equal(brief.fresh, false);
  assert.match(brief.text, /Nothing was added since run #48/);
  assert.match(brief.text, /private note/);
});

test('what was added since the last run is counted by kind; status lines and run reports are not', () => {
  const messages = [
    { author: 'client', created_at: '2026-11-02T09:00:00Z' },
    { author: 'ali', internal: 1, created_at: '2026-11-02T09:05:00Z' },
    { author: 'ali', internal: 1, created_at: '2026-11-02T09:06:00Z' },
    { author: 'ali', internal: 0, created_at: '2026-11-02T09:07:00Z' },
    { author: 'system', created_at: '2026-11-02T09:08:00Z' },
    { author: 'runner', created_at: '2026-11-02T09:09:00Z' },
  ];
  assert.deepEqual(addedSince(messages, runs[1]), { client: 1, replies: 1, notes: 2 });
  const brief = requeueBrief({ messages, runs });
  assert.equal(brief.fresh, true);
  assert.match(brief.text, /resumes run #48 with what was added since: 1 client message, 1 reply, 2 private notes\./);
});

test('a ticket that never ran just goes to the fleet', () => {
  assert.equal(requeueBrief({ messages: [], runs: [] }).fresh, true);
});
