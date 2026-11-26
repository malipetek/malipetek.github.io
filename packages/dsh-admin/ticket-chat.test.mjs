import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedTicketDetail, startTicketThread, ticketBriefing } from './src/ticket-chat.mjs';

const detail = { ticket: { id: 7 }, runs: [{ session_id: 'run-session' }] };

test('a run session is linked to its ticket; a ticket folder session is linked without a run', () => {
  assert.equal(linkedTicketDetail(detail, 7, 'run-session'), detail);
  assert.equal(linkedTicketDetail(detail, 7, 'other'), null);
  assert.equal(linkedTicketDetail(detail, 7, 'thread-session', true), detail);
  assert.equal(linkedTicketDetail(detail, 8, 'thread-session', true), null, 'never another ticket');
});

function fakeSessions() {
  const calls = [];
  const session = {
    command: async (c) => calls.push(['command', c]),
    prompt: async (parts, mode) => { calls.push(['prompt', parts[0].text, mode]); return { ok: true }; },
    rename: async (t) => calls.push(['rename', t]),
  };
  return {
    calls,
    create: async (opts) => { calls.push(['create', opts.cwd]); return 's-new'; },
    retain: () => ({ ready: Promise.resolve(), binding: { session }, release: () => calls.push(['release']) }),
  };
}

test('a ticket chat starts with a read-only briefing turn, under a preset that asks before writing', async () => {
  const sessions = fakeSessions();
  const id = await startTicketThread({ sessions, cwd: '/t/liftor-co-ticket-7', title: 'Ticket #7 — Orange', ticketId: 7 });
  assert.equal(id, 's-new');
  const kinds = sessions.calls.map((c) => c[0]);
  assert.deepEqual(kinds, ['create', 'command', 'prompt', 'rename', 'release']);
  assert.equal(sessions.calls[1][1], '/permission workspace-write');
  assert.match(sessions.calls[2][1], /ticket #7/);
  assert.match(sessions.calls[2][1], /Read only/);
});

test('a blank session already in the folder is reused, not duplicated', async () => {
  const sessions = fakeSessions();
  const id = await startTicketThread({ sessions, cwd: '/t/x-ticket-7', ticketId: 7, sessionId: 's-old' });
  assert.equal(id, 's-old');
  assert.ok(!sessions.calls.some((c) => c[0] === 'create'));
});

test('the briefing names the ticket branch it can read', () => {
  assert.match(ticketBriefing(910047), /malipetek\/ticket-910047/);
});
