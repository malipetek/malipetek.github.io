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

test('the portal stores Unix seconds: an old client message is not new input', () => {
  // Production rows carry integer seconds, not ISO strings.
  const intRuns = [{ id: 7, started_at: 1791631000 }, { id: 8, started_at: 1791632000 }];
  assert.equal(lastRun(intRuns).id, 8);
  const old = [{ author: 'client', created_at: 1791631500, body: 'before run 8' }];
  assert.equal(requeueBrief({ messages: old, runs: intRuns }).fresh, false);
  const added = [...old, { author: 'ali', internal: 1, created_at: 1791632100, body: 'fix the header' }];
  assert.deepEqual(addedSince(added, intRuns[1]), { client: 0, replies: 0, notes: 1 });
  assert.equal(requeueBrief({ messages: added, runs: intRuns }).fresh, true);
});
