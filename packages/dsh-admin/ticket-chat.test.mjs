import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedTicketDetail, startTicketThread, stripQuotedReply, ticketActivity, ticketBriefing } from './src/ticket-chat.mjs';

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

test('a reply shows what the client wrote, not the message it quotes', () => {
  // The real shape: Gmail in Turkish wraps the attribution over two lines.
  assert.equal(
    stripQuotedReply('heyo\n\nPTech Solutions <portal@ptechsolutions.net>, 26 Kas 2026 Per, 20:50\ntarihinde şunu yazdı:'),
    'heyo',
  );
  assert.equal(
    stripQuotedReply('ok\n\nmali petek <malipetek2@gmail.com>, 26 Kas 2026 Per, 21:18 tarihinde şunu yazdı:'),
    'ok',
  );
  assert.equal(stripQuotedReply('Thanks!\n\nOn Tue, 25 Nov 2026, Ali <ali@x.dev> wrote:\n> hello'), 'Thanks!');
  assert.equal(stripQuotedReply('please fix the hero\n\n> earlier text\n> more'), 'please fix the hero');
  // A body with no quote is left exactly as written, line breaks included.
  assert.equal(stripQuotedReply('line one\nline two'), 'line one\nline two');
  assert.equal(stripQuotedReply('just a reply'), 'just a reply');
  // Nothing but a quote keeps the quote rather than showing an empty row.
  assert.equal(stripQuotedReply('> only quoted'), '> only quoted');
});

test('every row names its kind, and only the rows a person wrote carry an author', () => {
  const rows = ticketActivity({
    ticket: { id: 9, created_at: 1000, client_email: 'client@example.com' },
    messages: [
      { id: 1, author: 'client', body: 'heyo\n\n<portal@ptechsolutions.net>, 26 Kas 2026 tarihinde şunu yazdı:', created_at: 2000 },
      { id: 2, author: 'ali', body: 'done', created_at: 3000 },
      { id: 3, author: 'ali', internal: true, body: 'note', created_at: 4000 },
      { id: 4, author: 'system', body: 'Status changed', created_at: 5000 },
      { id: 5, author: 'runner', body: 'ran', created_at: 6000 },
    ],
    runs: [{ id: 7, started_at: 7000, finished_at: 8000, status: 'done' }],
  });
  assert.deepEqual(rows.map((row) => row.kind),
    ['status', 'client', 'team', 'note', 'status', 'run', 'run', 'run']);
  assert.deepEqual(rows.map((row) => row.author),
    [undefined, 'client@example.com', 'You', 'You', undefined, undefined, undefined, undefined]);
  assert.equal(rows[1].text, 'heyo', 'the quoted tail is gone from the client row');
});
