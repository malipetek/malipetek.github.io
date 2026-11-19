import assert from 'node:assert/strict';
import test from 'node:test';
import { createConversationMeter, formatRecordedTime } from './src/conversation-meter.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));

// Mirrors the Web Locks ifAvailable contract across two simulated windows.
function lockManager() {
  const held = new Set();
  return {
    async request(name, options, use) {
      assert.deepEqual(options, { ifAvailable: true });
      if (held.has(name)) return use(null);
      held.add(name);
      try { return await use({ name }); } finally { held.delete(name); }
    },
  };
}

function fixture(locks = lockManager(), save = async (_id, seconds) => ({ humanSeconds: 40 + seconds })) {
  let time = 0;
  let foreground = true;
  const requests = [];
  const meter = createConversationMeter({
    locks,
    now: () => time,
    foreground: () => foreground,
    async api(method, path, body) {
      requests.push([method, path, body]);
      return save(Number(path.split('/')[3]), body.seconds);
    },
  });
  return {
    meter,
    requests,
    visit(key = 'a', id = 12, status = 'in_progress') {
      const leave = meter.retain(key, id);
      meter.observe(key, { id, status, human_seconds: 40 }, meter.revision());
      return leave;
    },
    get: (key = 'a') => meter.snapshot(key),
    seconds(n, input = true) {
      for (let s = 0; s < n; s++) {
        time += 1_000;
        if (input) meter.input();
        meter.tick();
      }
    },
    jump(ms) { time += ms; meter.tick(); },
    foreground(value) { foreground = value; meter.suspend(); },
  };
}
const batch = (id, seconds) => ['POST', `/admin/tickets/${id}/time`, { seconds }];

// Assert acknowledged totals, not the time in flight or sitting in a local buffer.
test('starts paused and records only after explicit Resume and server acknowledgment', async () => {
  const f = fixture();
  f.visit();
  f.seconds(25);
  assert.deepEqual(f.requests, []);
  assert.equal(f.get().seconds, 40);
  f.meter.resume('a');
  await turn();
  f.seconds(19);
  assert.deepEqual(f.requests, []);
  assert.equal(f.get().seconds, 40);
  f.seconds(1);
  assert.deepEqual(f.requests, [batch(12, 20)]);
  await turn();
  assert.equal(f.get().seconds, 60);
});

test('Pause saves the completed interval once and does not accrue again', async () => {
  const f = fixture();
  f.visit();
  f.meter.resume('a');
  await turn();
  f.seconds(7);
  f.meter.pause('a');
  f.seconds(50);
  await turn();
  assert.deepEqual(f.requests, [batch(12, 7)]);
  assert.equal(f.get().phase, 'paused');
});

test('leaving saves only on the departing ticket; a duplicate mount is not another owner', async () => {
  const f = fixture();
  const leave = f.visit();
  const leaveDuplicate = f.visit();
  f.meter.resume('a');
  await turn();
  f.seconds(4);
  leaveDuplicate();
  f.seconds(3);
  leave();
  f.visit('b', 99);
  f.seconds(30);
  await turn();
  assert.deepEqual(f.requests, [batch(12, 7)]);
  f.meter.resume('b');
  await turn();
  f.seconds(3);
  f.meter.pause('b');
  await turn();
  assert.deepEqual(f.requests, [batch(12, 7), batch(99, 3)]);
});

test('hidden, unfocused, idle, or throttled clock time is never backfilled', async () => {
  const f = fixture();
  f.visit();
  f.meter.resume('a');
  await turn();
  f.seconds(3);
  f.foreground(false);
  f.seconds(120, false);
  f.foreground(true);
  f.seconds(4, false);
  f.jump(30_000);
  f.seconds(2);
  f.meter.pause('a');
  await turn();
  // The first input after idle only starts a new interval; it cannot bill the prior second.
  assert.deepEqual(f.requests, [batch(12, 4)]);
});

test('the idle cutoff stops counting even while a focused, visible window continues ticking', async () => {
  let total = 40;
  const f = fixture(lockManager(), async (_id, seconds) => ({ humanSeconds: total += seconds }));
  f.visit();
  f.meter.resume('a');
  await turn();
  for (let i = 0; i < 7; i++) { f.seconds(20, false); await turn(); }
  assert.equal(f.get().phase, 'waiting');
  f.meter.pause('a');
  await turn();
  assert.deepEqual(f.requests, [batch(12, 20), batch(12, 20), batch(12, 19)]);
});

test('other windows cannot acquire even on another ticket until the final save settles', async () => {
  const locks = lockManager();
  let release;
  const one = fixture(locks, () => new Promise(resolve => { release = resolve; }));
  const two = fixture(locks);
  one.visit();
  two.visit('b', 99);
  one.meter.resume('a');
  await turn();
  one.seconds(20);
  one.seconds(5);
  one.meter.pause('a');
  two.meter.resume('b');
  await turn();
  assert.deepEqual(one.requests, [batch(12, 20)]);
  assert.equal(two.get('b').phase, 'paused');
  assert.equal(two.get('b').notice, 'occupied');
  assert.deepEqual(two.requests, []);
  release({ humanSeconds: 60 });
  await turn();
  assert.deepEqual(one.requests, [batch(12, 20), batch(12, 5)]);
  release({ humanSeconds: 65 });
  await turn();
  two.meter.resume('b');
  await turn();
  assert.equal(two.get('b').phase, 'running');
});

test('ambiguous writes stop, never retry, and never add unsaved seconds to the readout', async () => {
  let reject;
  const f = fixture(lockManager(), () => new Promise((_, failure) => { reject = failure; }));
  f.visit();
  f.meter.resume('a');
  await turn();
  f.seconds(25);
  reject(new Error('response lost'));
  await turn();
  f.seconds(40);
  assert.deepEqual(f.requests, [batch(12, 20)]);
  assert.equal(f.get().seconds, 40);
  assert.equal(f.get().phase, 'paused');
  assert.equal(f.get().notice, 'unconfirmed');
  f.meter.resume('a');
  await turn();
  f.seconds(25);
  assert.deepEqual(f.requests, [batch(12, 20)]);
  assert.equal(f.get().phase, 'paused');
  f.meter.observe('a', { id: 12, status: 'in_progress', human_seconds: 60 }, f.meter.revision());
  f.meter.resume('a');
  await turn();
  assert.equal(f.get().phase, 'running');
  assert.equal(f.get().seconds, 60);
});

test('done and declined tickets never write, including when closed before pause or unmount', async () => {
  for (const status of ['done', 'declined']) {
    const f = fixture();
    const leave = f.visit();
    f.meter.resume('a');
    await turn();
    f.seconds(5);
    f.meter.observe('a', { id: 12, status, human_seconds: 77 }, f.meter.revision());
    f.meter.resume('a');
    f.seconds(25);
    assert.equal(f.get().seconds, 77);
    assert.equal(f.get().phase, 'closed');
    leave();
    await turn();
    assert.deepEqual(f.requests, []);
  }
});

test('a stale read cannot rewind a committed meter result', async () => {
  const f = fixture();
  f.visit();
  const revision = f.meter.revision();
  f.meter.resume('a');
  await turn();
  f.seconds(20);
  await turn();
  f.meter.observe('a', { id: 12, status: 'in_progress', human_seconds: 40 }, revision);
  assert.equal(f.get().seconds, 60);
  f.meter.observe('a', { id: 12, status: 'in_progress', human_seconds: 55 }, f.meter.revision());
  assert.equal(f.get().seconds, 55);
});

test('zero, elapsed hours, and multi-day totals use recorded HH:MM:SS', () => {
  assert.equal(formatRecordedTime(0), '00:00:00');
  assert.equal(formatRecordedTime(3661), '01:01:01');
  assert.equal(formatRecordedTime(360_000), '100:00:00');
});

test('unavailable Web Locks fail closed instead of enabling another writer', async () => {
  const f = fixture(null);
  f.visit();
  f.meter.resume('a');
  await turn();
  f.seconds(30);
  assert.deepEqual(f.requests, []);
  assert.equal(f.get().phase, 'paused');
  assert.equal(f.get().notice, 'unavailable');
});
