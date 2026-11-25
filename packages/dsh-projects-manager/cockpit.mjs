/**
 * The cockpit: one ranked answer to "what needs me, across every project?".
 *
 * Momentum alone answers "which project is going quiet". That is only half of
 * what a person juggling several agents needs. The other half is the work agents
 * already did and cannot finish alone: a blocked question, a failed run, a task
 * that stopped without a report. Both arrive as data — never as prose to
 * interpret — so the panel, the briefing, the scheduled review and the model
 * tool all read the same list.
 *
 * Three layers, all pure functions over plain objects so they can be tested
 * without a Harness:
 *
 *   - **needs**       one ranked list: answer > review > proposal.
 *   - **proposals**   what the manager would start next, recorded rather than
 *                     acted on until the human turns autonomy up.
 *   - **running**     delegated work in flight, so "where is everything running
 *                     right now" has an answer.
 *
 * @module @malipetek/dsh-projects-manager/cockpit
 */

/** How long a dismissed proposal stays quiet. */
export const DISMISS_DAYS = 7;
/** Proposals kept on disk; older ones are dropped, they are not history. */
export const MAX_PROPOSALS = 200;
/** A blocked answer older than this is "overdue" in the panel. */
export const OVERDUE_HOURS = 24;
/** Delegated work with no end record after this long is presumed lost. */
export const STALE_RUNNING_HOURS = 6;

/** Autonomy levels, weakest first. */
export const AUTONOMY = ['off', 'record', 'act'];

/**
 * Ranking: a human decision outranks a failure, which outranks a blocked
 * pipeline stage, which outranks a suggestion.
 * @param kind - the need kind.
 * @returns a sort weight, lower first.
 */
const SEVERITY = { answer: 0, review: 1, pipeline: 2, proposal: 3 };

export function severityOf(kind) {
  return SEVERITY[kind] ?? 2;
}

/**
 * A ready-to-send instruction that finishes an item without the operator having
 * to explain the project again. This is the part that stops "I don't know where
 * to deploy" from costing a whole round trip.
 *
 * @param item - the need.
 * @param cardPath - the project card's path, when known.
 * @returns prompt text.
 */
export function continuationPrompt(item, cardPath) {
  const where = cardPath === undefined
    ? 'the shared project context (`project_context`)'
    : `the project card at ${cardPath} (read it first, or call \`project_context\`)`;
  if (item.kind === 'answer') {
    return [
      `Continue the delegated task "${item.label}" in ${item.project}.`,
      `It stopped on: ${item.note || '(no note)'}`,
      `Read ${where} before asking anything. Decide what you can decide; only ask me if the choice is genuinely mine.`,
      'Then finish the task and verify it.',
    ].join('\n');
  }
  if (item.kind === 'pipeline') {
    return [
      `Unblock the <${item.label.replace(/^Pipeline: /, '')}> work in ${item.project}.`,
      item.note ? `It is blocked on: ${item.note}` : '',
      `Read ${where}, produce or fetch what the stage needs, run the stage's own tool, and confirm its declared output exists.`,
    ].filter((line) => line.length > 0).join('\n');
  }
  if (item.kind === 'review') {
    return [
      `A delegated task in ${item.project} ended ${item.status}: "${item.label}".`,
      item.note ? `It reported: ${item.note}` : '',
      `Read ${where}, check what actually changed, and finish or fix it.`,
    ].filter((line) => line.length > 0).join('\n');
  }
  return [
    `Resume work on ${item.project}.`,
    item.note ? `Where it stands: ${item.note}` : '',
    `Read ${where}, pick the single next step that moves it forward, do it, and verify it.`,
    'Postpone nothing: if it cannot be finished now, say exactly what blocks it and why.',
  ].filter((line) => line.length > 0).join('\n');
}

/**
 * Turn scanned records (each carrying `agentWork` and open `proposals`) into one
 * ranked "needs you" list.
 *
 * @param options.records - project records from the scan.
 * @param options.now - epoch ms, injectable for tests.
 * @returns `{ items, counts, running }`.
 */
export function buildNeeds({ records = [], now = Date.now() } = {}) {
  const items = [];
  const running = [];

  for (const record of records) {
    if (record?.intent?.ignored === true) continue;
    const cardPath = record.cardPath ?? undefined;

    for (const work of record?.agentWork?.running ?? []) {
      const startedAt = Date.parse(work.at ?? '') || 0;
      const ageHours = startedAt > 0 ? Math.max(0, (now - startedAt) / 3_600_000) : 0;
      running.push({
        kind: 'running',
        project: record.name,
        path: record.path,
        label: String(work.label ?? '').slice(0, 120),
        route: String(work.route ?? ''),
        startedAt,
        ageHours: Math.round(ageHours * 10) / 10,
        stale: ageHours > STALE_RUNNING_HOURS,
      });
    }

    for (const work of record?.agentWork?.waiting ?? []) {
      const at = Date.parse(work.at ?? '') || 0;
      const ageHours = at > 0 ? Math.max(0, (now - at) / 3_600_000) : 0;
      const kind = work.status === 'blocked' ? 'answer' : 'review';
      items.push({
        id: `${record.path}\u0000${kind}\u0000${work.label ?? ''}\u0000${work.at ?? ''}`,
        kind,
        project: record.name,
        path: record.path,
        label: String(work.label ?? '').slice(0, 120),
        note: String(work.note ?? '').slice(0, 400),
        status: String(work.status ?? ''),
        route: String(work.route ?? ''),
        at,
        ageHours: Math.round(ageHours * 10) / 10,
        overdue: kind === 'answer' && ageHours > OVERDUE_HOURS,
        severity: severityOf(kind),
        prompt: '',
        cardPath,
      });
    }

    // A product pipeline's blocked or failing stages are work waiting on a
    // person just as much as a blocked agent is: nothing else will move them.
    const stageProblems = record?.pipeline?.stages ?? [];
    const requirementFailures = record?.pipeline?.requirementFailures ?? 0;
    if (stageProblems.length > 0 || requirementFailures > 0) {
      const first = stageProblems[0];
      const parts = [];
      if (stageProblems.length > 0) parts.push(`${stageProblems.length} stage${stageProblems.length === 1 ? '' : 's'} blocked`);
      if (requirementFailures > 0) parts.push(`${requirementFailures} requirement${requirementFailures === 1 ? '' : 's'} failing`);
      items.push({
        id: `${record.path}\u0000pipeline`,
        kind: 'pipeline',
        project: record.name,
        path: record.path,
        label: `Pipeline: ${parts.join(', ')}`,
        note: first === undefined ? 'A requirements file reports a failure.' : `${first.label} — ${first.detail}`,
        status: 'blocked',
        route: '',
        at: 0,
        ageHours: 0,
        overdue: false,
        severity: severityOf('pipeline'),
        prompt: '',
        cardPath,
      });
    }

    for (const proposal of record?.proposals ?? []) {
      if (proposal.state !== 'open') continue;
      const at = Date.parse(proposal.createdAt ?? '') || 0;
      items.push({
        id: proposal.id,
        kind: 'proposal',
        proposalKind: proposal.kind,
        project: record.name,
        path: record.path,
        label: String(proposal.title ?? '').slice(0, 120),
        note: String(proposal.text ?? '').slice(0, 400),
        status: 'proposed',
        route: '',
        at,
        ageHours: at > 0 ? Math.round(Math.max(0, (now - at) / 3_600_000) * 10) / 10 : 0,
        overdue: false,
        severity: severityOf('proposal'),
        prompt: '',
        cardPath,
      });
    }
  }

  for (const item of items) item.prompt = continuationPrompt(item, item.cardPath);

  items.sort((left, right) => left.severity - right.severity
    || left.at - right.at
    || left.project.localeCompare(right.project));

  const counts = { answer: 0, review: 0, pipeline: 0, proposal: 0, overdue: 0 };
  for (const item of items) {
    counts[item.kind] += 1;
    if (item.overdue) counts.overdue += 1;
  }
  counts.total = items.length;
  counts.running = running.length;

  return { items, counts, running };
}

/**
 * What the manager would start next, derived from the scan.
 *
 * One proposal per (project, kind): a stalled project yields a resume, a project
 * that never started yields a first slice, and a blocked task yields an answer
 * that has been waiting too long. Dedupe happens in {@link mergeProposals}; this
 * function only says what the state implies right now.
 *
 * @param options.records - project records.
 * @param options.now - epoch ms.
 * @returns the proposals this scan implies.
 */
export function deriveProposals({ records = [], now = Date.now() } = {}) {
  const out = [];
  for (const record of records) {
    if (record?.intent?.ignored === true) continue;
    const momentum = record?.momentum ?? {};
    const snoozed = typeof record?.intent?.snoozeUntil === 'number' && record.intent.snoozeUntil > now;
    if (snoozed) continue;

    // Blocked work is already an `answer` need in its own right; proposing it
    // again would show the operator the same decision twice.
    if (momentum.state === 'never-started') {
      out.push({
        key: `${record.path}\u0000first-slice`,
        kind: 'first-slice',
        project: record.name,
        path: record.path,
        title: 'Start: a first working slice',
        text: record?.description
          ? `Pick the smallest slice that makes "${String(record.description).slice(0, 120)}" real end to end, and build it.`
          : 'Pick the smallest slice that makes this project real end to end, and build it.',
        createdAt: new Date(now).toISOString(),
      });
    } else if (momentum.state === 'stalling' || momentum.state === 'cooling') {
      const nextAction = record?.intent?.nextAction;
      const suggestion = Array.isArray(momentum.suggestions) ? momentum.suggestions[0] : undefined;
      out.push({
        key: `${record.path}\u0000resume`,
        kind: 'resume',
        project: record.name,
        path: record.path,
        title: nextAction ? `Resume: ${String(nextAction).slice(0, 90)}` : 'Resume: pick up where it stopped',
        text: nextAction
          ? String(nextAction).slice(0, 400)
          : String(suggestion ?? `No work for ${momentum.quietDays ?? '?'}d against a ${momentum.cadenceDays ?? '?'}d pace.`).slice(0, 400),
        createdAt: new Date(now).toISOString(),
      });
    }
  }
  return out;
}

/**
 * Merge this scan's proposals into the stored ones.
 *
 * An open proposal is never duplicated. A proposal dismissed in the last
 * {@link DISMISS_DAYS} days is not re-raised. An open proposal whose condition
 * disappeared (the project moved, the task was answered) is closed as
 * `resolved`, so the list only ever shows what is still true.
 *
 * @param options.existing - stored proposals.
 * @param options.fresh - proposals from this scan.
 * @param options.now - epoch ms.
 * @returns the merged list, newest first.
 */
export function mergeProposals({ existing = [], fresh = [], now = Date.now() } = {}) {
  const freshKeys = new Set(fresh.map((proposal) => proposal.key));
  const dismissed = new Set(
    existing
      .filter((proposal) => proposal.state === 'dismissed' && (now - (Date.parse(proposal.dismissedAt ?? proposal.createdAt ?? '') || 0)) < DISMISS_DAYS * 86_400_000)
      .map((proposal) => proposal.key),
  );
  const openByKey = new Map();
  for (const proposal of existing) {
    if (proposal.state !== 'open') continue;
    if (!freshKeys.has(proposal.key)) {
      openByKey.set(proposal.key, { ...proposal, state: 'resolved', resolvedAt: new Date(now).toISOString() });
    } else {
      const match = fresh.find((candidate) => candidate.key === proposal.key);
      openByKey.set(proposal.key, { ...proposal, title: match.title, text: match.text, updatedAt: new Date(now).toISOString() });
    }
  }
  for (const proposal of fresh) {
    if (dismissed.has(proposal.key) || openByKey.has(proposal.key)) continue;
    openByKey.set(proposal.key, {
      id: `p_${Math.abs(hash(proposal.key))}_${proposal.kind}`,
      key: proposal.key,
      state: 'open',
      createdAt: proposal.createdAt,
      updatedAt: proposal.createdAt,
      kind: proposal.kind,
      project: proposal.project,
      path: proposal.path,
      title: proposal.title,
      text: proposal.text,
    });
  }
  const merged = [...openByKey.values()].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  // Resolved and dismissed entries are kept only briefly: enough to dedupe the
  // next scan, not a growing archive.
  const recentlyClosed = existing
    .filter((proposal) => proposal.state !== 'open')
    .filter((proposal) => (now - (Date.parse(proposal.resolvedAt ?? proposal.dismissedAt ?? proposal.createdAt ?? '') || 0)) < 30 * 86_400_000)
    .filter((proposal) => !merged.some((open) => open.key === proposal.key));
  return [...merged, ...recentlyClosed].slice(0, MAX_PROPOSALS);
}

/** Stable 32-bit hash, so a proposal id survives a restart. */
function hash(text) {
  let value = 0;
  for (let index = 0; index < text.length; index += 1) {
    value = (value * 31 + text.charCodeAt(index)) | 0;
  }
  return value;
}

/**
 * Close a proposal at the operator's request.
 * @param options.proposals - stored proposals.
 * @param options.id - proposal id.
 * @param options.now - epoch ms.
 * @returns `{ proposals, found }`.
 */
export function dismissProposal({ proposals = [], id, now = Date.now() } = {}) {
  let found = false;
  const next = proposals.map((proposal) => {
    if (proposal.id !== id || proposal.state !== 'open') return proposal;
    found = true;
    return { ...proposal, state: 'dismissed', dismissedAt: new Date(now).toISOString() };
  });
  return { proposals: next, found };
}

/**
 * The "needs you" section of the briefing, in the same order as the panel.
 * @param needs - output of {@link buildNeeds}.
 * @param autonomy - current autonomy level.
 * @returns markdown lines, empty when nothing needs a person.
 */
export function renderNeeds(needs, autonomy = 'record') {
  const lines = [];
  if (needs.items.length === 0) return lines;
  lines.push(`## Needs you (${needs.items.length})`);
  lines.push('');
  for (const item of needs.items.slice(0, 12)) {
    const age = item.ageHours < 1 ? 'new' : item.ageHours >= 24 ? `${Math.round(item.ageHours / 24)}d` : `${Math.round(item.ageHours)}h`;
    const tag = item.kind === 'answer' ? 'ANSWER' : item.kind === 'review' ? 'REVIEW' : item.kind === 'pipeline' ? 'PIPELINE' : 'PROPOSAL';
    lines.push(`- [${tag}] **${item.project}** — ${item.label}${item.note ? ` — ${item.note}` : ''} (${age}${item.overdue ? ', overdue' : ''})`);
  }
  lines.push('');
  lines.push(`Autonomy: ${autonomy}. ${autonomy === 'act'
    ? 'Start on the proposals now, in this turn: delegate anything longer than a few steps.'
    : autonomy === 'record'
      ? 'Report these to me; do not start work until I say so.'
      : 'Proposals are off; ignore them.'}`);
  lines.push('');
  return lines;
}

/**
 * One line per in-flight delegation, for the panel's "running now" strip.
 * @param running - output of {@link buildNeeds}.
 * @returns markdown lines.
 */
export function renderRunning(running) {
  if (running.length === 0) return [];
  return [
    `## Running now (${running.length})`,
    '',
    ...running.map((item) => `- **${item.project}** — ${item.label} on ${item.route || 'unknown route'} (${item.ageHours}h${item.stale ? ', no longer reporting' : ''})`),
    '',
  ];
}
