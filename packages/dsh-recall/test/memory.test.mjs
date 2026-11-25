import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ago, extract, makeEntry, refresh, renderSession, scoreEntry, search, snippetOf, stripRuntime, stripSystemReminder, termsOf,
} from '../memory.mjs';

const NOW = Date.parse('2026-11-21T10:00:00.000Z');
const HOUR = 3_600_000;

/** A session log shaped like `session.v4.jsonl`, as one JSONL string. */
function log(records) {
  return records.map((record) => JSON.stringify(record)).join('\n');
}

const ADMIN = log([
  { type: 'session', version: 4, id: 'session-admin', createdAt: NOW - 48 * HOUR, cwd: '/Users/x/Documents/Projects/admin-ui', agentPreset: 'standard' },
  { type: 'user/message', at: NOW - 47 * HOUR, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Refurbish the admin app UI: audit every page and fix what is broken.' }] } },
  { type: 'assistant/message', at: NOW - 46 * HOUR, data: { message: { content: [{ type: 'text', text: 'Audited twelve pages; the deploy target is the ptechsolutions Worker via pnpm deploy.' }] } } },
  { type: 'tool/call', at: NOW - 46 * HOUR, data: { name: 'bash' } },
  { type: 'tool/call', at: NOW - 45 * HOUR, data: { name: 'delegate' } },
  { type: 'command/run', at: NOW - 45 * HOUR, data: { name: 'projects' } },
  { type: 'user/message', at: NOW - 44 * HOUR, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'where does this deploy?' }] } },
  // Injected by the harness, not a person speaking:
  { type: 'user/message', at: NOW - 44 * HOUR, data: { source: { kind: 'runtime' }, content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes everything above.' }] } },
  { type: 'user/message', at: NOW - 44 * HOUR, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Time sampled while preparing turn 2' }] } },
]);

const TEABOT = log([
  { type: 'session', version: 4, id: 'session-teabot', createdAt: NOW - 200 * HOUR, cwd: '/Users/x/Documents/Projects/teabot', agentPreset: 'standard' },
  { type: 'user/message', at: NOW - 200 * HOUR, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'the tank FEA stage is blocked on a STEP file; generate it.' }] } },
]);

test('extract keeps what the person asked and drops injected runtime context', () => {
  const result = extract(ADMIN);
  assert.equal(result.counts.turns, 2, 'runtime snapshots and timer notes are not turns');
  assert.match(result.turns[0].text, /Refurbish the admin app UI/);
  assert.match(result.turns[1].text, /where does this deploy\?/);
  assert.equal(result.counts.tools, 2);
  assert.deepEqual(result.tools.sort(), ['bash', 'delegate']);
  assert.deepEqual(result.commands, ['projects']);
  assert.equal(result.header.cwd, '/Users/x/Documents/Projects/admin-ui');
});

test('an appended snapshot is cut off the end of a real turn', () => {
  const text = stripRuntime('fix the header\n\nCurrent runtime context\nDate: 2026-11-21');
  assert.equal(text, 'fix the header');
});

test('a system reminder inside a human turn is dropped', () => {
  assert.equal(stripSystemReminder('do it<system-reminder>internal</system-reminder>'), 'do it');
});

test('an entry names its project and uses the first ask as its title', () => {
  const entry = makeEntry({ id: 'session-admin', file: '/x', mtimeMs: NOW, size: 1, extracted: extract(ADMIN) });
  assert.equal(entry.project, 'admin-ui');
  assert.equal(entry.cwd, '/Users/x/Documents/Projects/admin-ui');
  assert.match(entry.title, /Refurbish/);
  assert.ok(entry.lastAt > 0);
});

test('search terms drop words that would match everything', () => {
  const terms = termsOf('Where does the admin app deploy?');
  assert.deepEqual(terms.sort(), ['admin', 'app', 'deploy', 'does', 'where'].sort().filter((term) => term !== 'does' && term !== 'where'));
});

test('a search ranks by what was asked, and reports why it matched', () => {
  const entries = [makeEntry({ id: 'a', file: '/a', mtimeMs: NOW, size: 1, extracted: extract(ADMIN) }), makeEntry({ id: 't', file: '/t', mtimeMs: NOW, size: 1, extracted: extract(TEABOT) })];
  const results = search({ entries, query: 'deploy admin', now: NOW });
  assert.equal(results.length, 1);
  assert.equal(results[0].entry.id, 'a');
  assert.match(results[0].snippet, /deploy/i);
  assert.ok(scoreEntry(results[0].entry, termsOf('deploy admin'), NOW) > 0);
});

test('a project filter and a recency filter narrow the same search', () => {
  const entries = [makeEntry({ id: 'a', file: '/a', mtimeMs: NOW, size: 1, extracted: extract(ADMIN) }), makeEntry({ id: 't', file: '/t', mtimeMs: NOW, size: 1, extracted: extract(TEABOT) })];
  assert.equal(search({ entries, query: '', project: 'tea', now: NOW }).length, 1);
  assert.equal(search({ entries, query: '', project: 'admin', now: NOW }).length, 1);
  assert.equal(search({ entries, query: '', days: 7, now: NOW }).length, 1, 'tea bot is older than a week');
  assert.equal(search({ entries, query: 'blocked', now: NOW })[0].entry.project, 'teabot');
});

test('an empty query returns the most recent conversations', () => {
  const entries = [makeEntry({ id: 'a', file: '/a', mtimeMs: NOW, size: 1, extracted: extract(ADMIN) }), makeEntry({ id: 't', file: '/t', mtimeMs: NOW, size: 1, extracted: extract(TEABOT) })];
  const results = search({ entries, query: '', now: NOW });
  assert.deepEqual(results.map((row) => row.entry.id), ['a', 't']);
  assert.match(snippetOf(results[0].entry, []), /^Refurbish the admin app UI/);
});

test('a rendered session carries its project, age and both sides of the conversation', () => {
  const entry = makeEntry({ id: 'session-admin', file: '/x', mtimeMs: NOW, size: 1, extracted: extract(ADMIN) });
  const text = renderSession(entry, { now: NOW });
  assert.match(text, /## Conversation session-admin/);
  assert.match(text, /admin-ui/);
  assert.match(text, /2d ago/);
  assert.match(text, /### 1\. User/);
  assert.match(text, /\*\*Agent\.\*\*/);
  const short = renderSession(entry, { now: NOW, maxChars: 40 });
  assert.match(short, /truncated/);
});

test('refresh re-extracts only what changed and forgets what is gone', async () => {
  const entries = [makeEntry({ id: 'a', file: '/a', mtimeMs: 1, size: 10, extracted: extract(ADMIN) })];
  const calls = [];
  const same = await refresh({
    entries,
    files: [{ id: 'a', file: '/a', mtimeMs: 1, size: 10 }],
    extractOne: async (file) => { calls.push(file.file); return entries[0]; },
  });
  assert.equal(calls.length, 0, 'an unchanged log is not re-read');
  assert.equal(same.added + same.updated + same.removed, 0);

  const changed = await refresh({
    entries,
    files: [{ id: 'a', file: '/a', mtimeMs: 2, size: 20 }, { id: 'b', file: '/b', mtimeMs: 3, size: 30 }],
    extractOne: async (file) => { calls.push(file.file); return makeEntry({ id: file.id, file: file.file, mtimeMs: file.mtimeMs, size: file.size, extracted: extract(TEABOT) }); },
  });
  // The most recently touched logs are read first.
  assert.deepEqual(calls, ['/b', '/a']);
  assert.equal(changed.updated, 1);
  assert.equal(changed.added, 1);

  const gone = await refresh({ entries: changed.entries, files: [{ id: 'b', file: '/b', mtimeMs: 3, size: 30 }], extractOne: async () => { throw new Error('should not run'); } });
  assert.equal(gone.removed, 1);
  assert.deepEqual(gone.entries.map((entry) => entry.id), ['b']);
});

test('a log with nothing asked and nothing said is not indexed', async () => {
  const result = await refresh({
    entries: [],
    files: [{ id: 'e', file: '/e', mtimeMs: 5, size: 5 }],
    extractOne: async (file) => makeEntry({ id: file.id, file: file.file, mtimeMs: file.mtimeMs, size: file.size, extracted: extract(log([{ type: 'session', id: 'e', cwd: '/x' }])) }),
  });
  assert.equal(result.entries.length, 0);
  assert.equal(result.skipped, 1);
});

test('a log that fails to decode keeps its previous entry', async () => {
  const entries = [makeEntry({ id: 'a', file: '/a', mtimeMs: 1, size: 10, extracted: extract(ADMIN) })];
  const result = await refresh({
    entries,
    files: [{ id: 'a', file: '/a', mtimeMs: 9, size: 99 }],
    extractOne: async () => { throw new Error('being written'); },
  });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].mtimeMs, 1);
});

test('a delegated worker session is not a conversation', () => {
  const worker = log([
    { type: 'session', version: 4, id: 'w1', cwd: '/x/Projects/admin-ui', origin: 'subagent', delegationDepth: 1, parentSession: 'session-parent' },
    { type: 'user/message', at: NOW - HOUR, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'You are a read-only UI auditor. Audit the admin app.' }] } },
  ]);
  const entry = makeEntry({ id: 'w1', file: '/w', mtimeMs: NOW, size: 1, extracted: extract(worker) });
  assert.equal(entry.worker, true);
  assert.equal(entry.parent, 'session-parent');
  const human = makeEntry({ id: 'a', file: '/a', mtimeMs: NOW, size: 1, extracted: extract(ADMIN) });
  assert.equal(human.worker, false);
  assert.equal(search({ entries: [entry, human], query: 'audit admin', now: NOW }).length, 1, 'workers are hidden by default');
  assert.equal(search({ entries: [entry, human], query: 'audit admin', includeWorkers: true, now: NOW }).length, 2);
});

test('a conversation matching every word outranks one matching a single word', () => {
  const partial = makeEntry({ id: 'p', file: '/p', mtimeMs: NOW, size: 1, extracted: extract(log([
    { type: 'session', id: 'p', cwd: '/x/Projects/other' },
    { type: 'user/message', at: NOW - HOUR, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'the deploy script needs a rewrite' }] } },
  ])) });
  const full = makeEntry({ id: 'f', file: '/f', mtimeMs: NOW, size: 1, extracted: extract(ADMIN) });
  const results = search({ entries: [partial, full], query: 'admin deploy app', now: NOW });
  assert.equal(results[0].entry.id, 'f');
});

test('ages read like a person wrote them', () => {
  assert.equal(ago(NOW - 30_000, NOW), 'just now');
  assert.equal(ago(NOW - 5 * 60_000, NOW), '5m ago');
  assert.equal(ago(NOW - 5 * HOUR, NOW), '5h ago');
  assert.equal(ago(NOW - 48 * HOUR, NOW), '2d ago');
  assert.equal(ago(0, NOW), 'unknown');
});
