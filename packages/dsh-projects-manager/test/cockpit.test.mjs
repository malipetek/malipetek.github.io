import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNeeds, continuationPrompt, deriveProposals, dismissProposal, mergeProposals, renderNeeds, renderRunning, severityOf,
} from '../cockpit.mjs';

const NOW = Date.parse('2026-11-21T09:00:00.000Z');
const HOUR = 3_600_000;

/** A record shaped like the scan produces, with only the cockpit fields filled. */
function record(overrides = {}) {
  return {
    name: 'Admin',
    path: '/projects/admin',
    description: 'Admin UI',
    intent: {},
    momentum: { state: 'stalling', score: 40, quietDays: 9, cadenceDays: 7, suggestions: ['ship the audit fix'] },
    agentWork: { waiting: [], running: [] },
    proposals: [],
    ...overrides,
  };
}

test('a waiting decision outranks a failure, which outranks a proposal', () => {
  assert.ok(severityOf('answer') < severityOf('review'));
  assert.ok(severityOf('review') < severityOf('proposal'));
});

test('buildNeeds orders answer, review, proposal, and fills a continuation prompt', () => {
  const needs = buildNeeds({
    now: NOW,
    records: [
      record({
        agentWork: {
          waiting: [
            { at: new Date(NOW - 30 * HOUR).toISOString(), status: 'blocked', label: 'deploy the admin app', note: 'where does this deploy?', route: 'acp-claude/opus', cwd: '/projects/admin' },
            { at: new Date(NOW - 2 * HOUR).toISOString(), status: 'failed', label: 'run the e2e suite', note: 'timeout', route: 'opencode-go/glm-5.3', cwd: '/projects/admin' },
          ],
          running: [{ id: 'w1', at: new Date(NOW - HOUR).toISOString(), label: 'audit pages', route: 'opencode-go/deepseek-v4.1-flash', cwd: '/projects/admin' }],
        },
        proposals: [{ id: 'p_1_resume', state: 'open', kind: 'resume', title: 'Resume: ship it', text: 'ship it', createdAt: new Date(NOW - 3 * 86_400_000).toISOString() }],
        cardPath: '/context/admin.md',
      }),
    ],
  });

  assert.deepEqual(needs.items.map((item) => item.kind), ['answer', 'review', 'proposal']);
  assert.equal(needs.counts.answer, 1);
  assert.equal(needs.counts.review, 1);
  assert.equal(needs.counts.proposal, 1);
  assert.equal(needs.counts.total, 3);
  assert.equal(needs.counts.running, 1);
  assert.equal(needs.counts.overdue, 1, 'a blocked answer older than a day is overdue');
  assert.match(needs.items[0].prompt, /where does this deploy\?/);
  assert.match(needs.items[0].prompt, /admin\.md/);
  assert.deepEqual(needs.running.map((item) => item.label), ['audit pages']);
  assert.equal(needs.running[0].stale, false);
});

test('a blocked product pipeline becomes one pipeline need, with its first blocker', () => {
  const needs = buildNeeds({
    now: NOW,
    records: [
      record({
        momentum: { state: 'active', score: 0, quietDays: 0, cadenceDays: 7, suggestions: [] },
        pipeline: {
          phase: 'detail',
          stages: [
            { id: 'system-model', label: 'system-model', tool: 'solidcraft', status: 'blocked', detail: 'missing input: 05_system/teabot.mo' },
            { id: 'pcb', label: 'pcb', tool: 'kicad', status: 'blocked', detail: 'missing input: 10_electronics/a.kicad_pro' },
          ],
          requirementFailures: 0,
        },
      }),
    ],
  });
  assert.equal(needs.items.length, 1, 'six blocked stages must not be six rows');
  assert.equal(needs.items[0].kind, 'pipeline');
  assert.equal(needs.items[0].label, 'Pipeline: 2 stages blocked');
  assert.match(needs.items[0].note, /05_system\/teabot\.mo/);
  assert.match(needs.items[0].prompt, /Unblock/);
  assert.ok(severityOf('answer') < severityOf('review'));
  assert.ok(severityOf('review') < severityOf('pipeline'));
  assert.ok(severityOf('pipeline') < severityOf('proposal'));
});

test('buildNeeds skips ignored projects and flags work that stopped reporting', () => {
  const needs = buildNeeds({
    now: NOW,
    records: [
      record({ intent: { ignored: true }, agentWork: { waiting: [{ at: new Date(NOW).toISOString(), status: 'blocked', label: 'x' }] } }),
      record({ path: '/projects/other', name: 'Other', agentWork: { waiting: [], running: [{ id: 'w2', at: new Date(NOW - 7 * HOUR).toISOString(), label: 'scan', route: 'r' }] } }),
    ],
  });
  assert.equal(needs.items.length, 0);
  assert.equal(needs.running.length, 1);
  assert.equal(needs.running[0].stale, true);
});

test('deriveProposals covers a stalled and a never-started project, and leaves blocked work to needs', () => {
  const proposals = deriveProposals({
    now: NOW,
    records: [
      record({ intent: { nextAction: 'wire the deploy' } }),
      record({ name: 'New', path: '/projects/new', momentum: { state: 'never-started', score: 90, quietDays: 0, cadenceDays: 14, suggestions: [] } }),
      record({
        name: 'Buggy',
        path: '/projects/buggy',
        momentum: { state: 'active', score: 0, quietDays: 0, cadenceDays: 7, suggestions: [] },
        agentWork: { waiting: [{ at: new Date(NOW - 40 * HOUR).toISOString(), status: 'blocked', label: 'decide the schema', note: 'two options' }] },
      }),
    ],
  });
  const kinds = proposals.map((proposal) => `${proposal.project}:${proposal.kind}`);
  // Blocked work is a need, not a proposal: it must not appear twice.
  assert.deepEqual(kinds, ['Admin:resume', 'New:first-slice']);
  assert.match(proposals[0].text, /wire the deploy/);
});

test('deriveProposals leaves snoozed and ignored projects alone', () => {
  const proposals = deriveProposals({
    now: NOW,
    records: [
      record({ intent: { snoozeUntil: NOW + 86_400_000 } }),
      record({ path: '/projects/off', name: 'Off', intent: { ignored: true } }),
    ],
  });
  assert.equal(proposals.length, 0);
});

test('mergeProposals does not duplicate, resolves what stopped, and honours a dismissal', () => {
  const fresh = deriveProposals({ now: NOW, records: [record()] });
  const first = mergeProposals({ existing: [], fresh, now: NOW });
  assert.equal(first.length, 1);
  assert.equal(first[0].state, 'open');

  const second = mergeProposals({ existing: first, fresh, now: NOW });
  assert.equal(second.length, 1, 'one proposal per condition, not one per scan');

  const dismissed = dismissProposal({ proposals: second, id: second[0].id, now: NOW });
  assert.equal(dismissed.found, true);
  const third = mergeProposals({ existing: dismissed.proposals, fresh, now: NOW });
  assert.equal(third.filter((proposal) => proposal.state === 'open').length, 0, 'a dismissal holds for a week');

  const later = NOW + 8 * 86_400_000;
  const fourth = mergeProposals({ existing: third, fresh: deriveProposals({ now: later, records: [record()] }), now: later });
  assert.equal(fourth.filter((proposal) => proposal.state === 'open').length, 1, 'after a week it may come back');

  const gone = mergeProposals({
    existing: first,
    fresh: [],
    now: NOW,
  });
  assert.equal(gone[0].state, 'resolved');
});

test('mergeProposals refreshes the text of a proposal that is still open', () => {
  const fresh = deriveProposals({ now: NOW, records: [record({ intent: { nextAction: 'first' } })] });
  const stored = mergeProposals({ existing: [], fresh, now: NOW });
  const changed = deriveProposals({ now: NOW, records: [record({ intent: { nextAction: 'second' } })] });
  const merged = mergeProposals({ existing: stored, fresh: changed, now: NOW });
  assert.equal(merged.length, 1);
  assert.match(merged[0].text, /second/);
});

test('continuationPrompt names the project card so the agent does not ask where to deploy', () => {
  const prompt = continuationPrompt({ kind: 'answer', project: 'Admin', label: 'deploy', note: 'where?', status: 'blocked' }, '/context/admin.md');
  assert.match(prompt, /Admin/);
  assert.match(prompt, /admin\.md/);
  assert.match(prompt, /only ask me if the choice is genuinely mine/);
});

test('renderNeeds and renderRunning produce markdown for the briefing', () => {
  const needs = buildNeeds({ now: NOW, records: [record({ proposals: [{ id: 'p_1_resume', state: 'open', kind: 'resume', title: 'Resume', text: 'x', createdAt: new Date(NOW).toISOString() }] })] });
  const lines = renderNeeds(needs, 'record');
  assert.equal(lines[0], '## Needs you (1)');
  assert.ok(lines.some((line) => line.includes('PROPOSAL')));
  assert.ok(lines.some((line) => line.includes('Autonomy: record')));
  const running = renderRunning([{ project: 'Admin', label: 'audit', route: 'opencode-go/deepseek-v4.1-flash', ageHours: 1, stale: false }]);
  assert.equal(running[0], '## Running now (1)');
  assert.match(running[2], /deepseek-v4\.1-flash/);
  assert.deepEqual(renderNeeds({ items: [], counts: {}, running: [] }, 'record'), []);
});
