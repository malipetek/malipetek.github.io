/*
 * One seam for reviewing a ticket's work.
 *
 * The Harness has a native git review surface only through the Git Graph
 * plugin, and that plugin publishes it as a global (`globalThis.__dshGitGraphNative`)
 * rather than through a service a plugin could inject. The dsh-admin Client
 * half adapts that global into the small `host.gitGraph` face consumed here,
 * so this is the only file in the workbench that knows about it.
 *
 * When the face is absent — the web workbench, or a Harness without Git Graph
 * — the newest run's recorded diff is the fallback, and a link to the portal is
 * the last resort. A fork-side changes-review service addressed by repo and ref
 * would replace the global without changing this call site.
 */
import { useEffect, useState } from 'react';
import { useAdmin } from './store.js';
import { Button, Modal, cx } from './ui.jsx';
import { markdownBlocks } from './markdown.js';
import { sortedRuns, selectedRun, recordedPatch, reviewTarget, verification } from './run-evidence.js';

/** The portal page for a ticket, when nothing can review in place. */
export const portalTicketUrl = (id) => `https://ptechsolutions.net/portal/admin#ticket=${id}`;

/**
 * The branch a review should open: the newest run's pushed ref, else its
 * local branch. Null when no run has left work anywhere.
 */
export function reviewRef(runs) {
  return reviewTarget(runs)?.ref ?? null;
}

/** The newest run that recorded a diff, for the fallback view. */
function newestDiff(runs) {
  return [...(runs ?? [])].sort((a, b) => b.id - a.id).find((run) => recordedPatch(run)) ?? null;
}

/**
 * Decide how a ticket is reviewed, in one place.
 * @returns `{kind:'git-graph',gitGraph}` | `{kind:'diff',run}` | `{kind:'portal',url}` | null.
 */
export function reviewPlan(host, ticket, runs) {
  if (!ticket) return null;
  const gitGraph = host?.gitGraph;
  if (ticket.project_slug && typeof gitGraph?.available === 'function' && gitGraph.available()) {
    return { kind: 'git-graph', gitGraph };
  }
  const run = newestDiff(runs);
  if (run) return { kind: 'diff', run, older: run.id !== sortedRuns(runs)[0]?.id };
  if (ticket.id) return { kind: 'portal', url: portalTicketUrl(ticket.id) };
  return null;
}

/**
 * The review control on a ticket: Git Graph at the ticket's branch in the
 * Harness, the recorded comparison on the web (or a Harness without Git
 * Graph), and the portal when neither has anything to show.
 */
export function ReviewButton({ ticket, runs }) {
  const { host } = useAdmin();
  const plan = reviewPlan(host, ticket, runs);
  const [open, setOpen] = useState(false);
  if (!plan) return null;
  if (plan.kind === 'portal') {
    return (
      <Button
        size="sm"
        kind="ghost"
        title="Open this ticket in the web workbench to review its work"
        onClick={() => window.open(plan.url, '_blank', 'noopener,noreferrer')}
      >
        Review on the web
      </Button>
    );
  }
  const target = reviewTarget(runs);
  const label = plan.kind === 'git-graph' ? 'Review in Git Graph' : 'Review changes';
  return (
    <>
      <Button
        size="sm"
        kind="ghost"
        title={plan.kind === 'git-graph'
          ? "Open the project's repository in Git Graph at this ticket's branch"
          : "The newest run's recorded comparison"}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      {open ? (
        plan.kind === 'git-graph' ? (
          <GitGraphReview key={`${ticket.id}:${target?.runId}:${target?.ref}`} ticket={ticket} target={target} gitGraph={plan.gitGraph} onClose={() => setOpen(false)} />
        ) : (
          <Modal kind="confirm" title={`Run ${plan.run.id}: changes`} subtitle={`${plan.older ? 'Older evidence fallback · ' : ''}Recorded evidence, not the current repository state`} onClose={() => setOpen(false)} wide>
            <pre className="aw-diff">{recordedPatch(plan.run) ?? 'No patch or statistics recorded.'}</pre>
          </Modal>
        )
      ) : null}
    </>
  );
}

/**
 * The Git Graph view. `focus` makes the plugin bind to the panel's session and
 * fetch the project's clone at the ticket's branch; the view is rendered from
 * the plugin's own component. Both live on the global this workbench was
 * handed, so an older or absent plugin simply never reaches here.
 */
function GitGraphReview({ ticket, target, gitGraph, onClose }) {
  const gitRef = target?.ref;
  const attribution = target ? `Run #${target.runId}${target.older ? ' · older run fallback' : ''} · ${target.mutable ? 'mutable branch; may have changed since this run' : 'recorded commit'}` : 'Current repository · no recorded ref';
  const { host } = useAdmin();
  const [state, setState] = useState({ status: 'loading', text: 'Finding the repository…', sessionId: null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({status:'loading',text:'Finding the repository…',sessionId:null});
    void (async () => {
      try {
        const where = await host.json(`review ${ticket.project_slug}`);
        if (!where?.found) {
          throw new Error(`No repository for ${ticket.project_slug} on this machine (looked in ${(where?.looked ?? []).join(', ')}).`);
        }
        const sessionId = gitGraph.sessionId();
        if (!sessionId) throw new Error('Git Graph needs an open session. Open one, then try again.');
        if (alive) setState({ status: 'loading', text: `Fetching and opening ${gitRef ?? 'the repository'}…`, sessionId: null });
        const focused = await gitGraph.focus({ sessionId, repo: where.repo, ref: gitRef });
        if (!alive) return;
        const missing = gitRef && !focused.commit ? ` ${gitRef} is not in this clone yet.` : '';
        setState({
          status: 'ready',
          text: `${focused.repo}${focused.commit ? ` · ${gitRef} at ${focused.commit.slice(0, 8)}` : ''}.${missing}`,
          sessionId,
        });
      } catch (error) {
        if (alive) setState({ status: 'failed', text: error?.message ?? String(error), sessionId: null });
      }
    })();
    return () => {
      alive = false;
    };
  }, [ticket.project_slug, gitRef, gitGraph, host, retry]);
  const View = gitGraph.View;
  return (
    <Modal kind="confirm" title={`Review #${ticket.id}`} subtitle={`${attribution} · ${state.text}`} onClose={onClose} full>
      <div className="aw-review">
        {state.status === 'ready' ? (
          <View sessionId={state.sessionId} />
        ) : (
          <div className={cx('aw-empty', state.status === 'failed' && 'aw-error')} role={state.status === 'failed' ? 'alert' : 'status'}>{state.text}{state.status === 'failed' ? <Button onClick={() => setRetry(n => n + 1)}>Retry repository review</Button> : null}</div>
        )}
      </div>
    </Modal>
  );
}

/** Read-only evidence selection: never changes the execution/landing baseline. */
export function RecordedEvidence({ runs = [], screenshots = [], review, initialOpen = false }) {
  const [runId, setRunId] = useState(null);
  const [compareId, setCompareId] = useState('');
  const [open, setOpen] = useState(initialOpen);
  useEffect(() => { if (runId == null && runs.length) setRunId(sortedRuns(runs)[0].id); }, [runs, runId]);
  if (!runs.length) return null;
  const selected = selectedRun(runs, runId);
  const comparison = compareId ? selectedRun(runs, compareId) : null;
  const options = sortedRuns(runs);
  const checks = selected ? verification(selected.verify_ok) : null;
  const line = selected
    ? [`Run #${selected.id}`, selected.status, selected.commit_sha ? `commit ${String(selected.commit_sha).slice(0, 8)}` : 'no commit recorded', `verification ${checks}`, comparison ? `comparing #${comparison.id}` : compareId ? `comparing #${compareId}` : null].filter(Boolean).join(' · ')
    : `Run #${runId} · unavailable`;
  const panelId = `aw-evidence-panel-${runId ?? 'none'}`;
  return <section className="aw-prereview aw-evidence" aria-label="Recorded run evidence">
    <header className="aw-evidence__head">
      <strong>Recorded evidence</strong>
      <span className="aw-muted aw-evidence__line">· {line}</span>
      <span className="aw-toolbar__fill" />
      <button
        type="button"
        className="aw-link aw-evidence__toggle"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide details' : 'Show details'}
      </button>
    </header>
    {open ? (
      <div className="aw-evidence__body" id={panelId}>
        <p className="aw-muted aw-evidence__hint">One column per run’s saved evidence, not a code diff between runs. Selection does not change what runs or lands next.</p>
        <div className="aw-inline">
          <label>Run <select aria-label="Evidence run" value={runId ?? ''} onChange={e => setRunId(e.target.value)}>
            {runId != null && !selected ? <option value={runId}>Run #{runId} · unavailable</option> : null}
            {options.map(run => <option key={run.id} value={run.id}>Run #{run.id} · {run.status}</option>)}
          </select></label>
          <label>Compare with <select aria-label="Comparison run" value={compareId} onChange={e => setCompareId(e.target.value)}>
            <option value="">No comparison</option>
            {compareId && !comparison ? <option value={compareId}>Run #{compareId} · unavailable</option> : null}
            {options.map(run => <option key={run.id} value={run.id}>Run #{run.id} · {run.status}</option>)}
          </select></label>
        </div>
        <div className="aw-evidence__cols">
          <EvidenceColumn run={selected} runId={runId} screenshots={screenshots} review={review} />
          {compareId ? <EvidenceColumn run={comparison} runId={compareId} screenshots={screenshots} review={review} /> : null}
        </div>
      </div>
    ) : null}
  </section>;
}
function EvidenceColumn({run, runId, screenshots, review}) {
  if (!run) return <p role="status">Run #{runId} evidence is unavailable.</p>;
  const checks = verification(run.verify_ok);
  const shots = screenshots.filter(shot => String(shot.runId) === String(run.id));
  return <div className="aw-evidence__col">
    <h3>Run #{run.id}</h3>
    <p className="aw-muted">{run.status} · {run.executor} · {run.branch ? `Recorded branch: ${run.branch} (mutable)` : 'No branch recorded'}</p>
    {run.commit_sha ? <p>Recorded commit: <code>{run.commit_sha}</code></p> : <p className="aw-muted">No immutable commit recorded.</p>}
    <p>Verification: {checks}{checks === 'unknown' ? ' · no result recorded' : ''}</p>
    {run.verify_command ? <p>Recorded check: <code>{run.verify_command}</code></p> : null}
    {run.verify_output ? <pre className="aw-diff">{run.verify_output}</pre> : null}
    {review && String(review.runId) === String(run.id) ? <p>Pre-review for run #{run.id}: {review.verdict} · {review.headline}</p> : <p className="aw-muted">No pre-review recorded for run #{run.id}.</p>}
    {run.summary ? <div className="aw-md"><MarkdownReport text={run.summary} /></div> : <p className="aw-muted">No summary recorded.</p>}
    <pre className="aw-diff">{recordedPatch(run) || 'No patch or statistics recorded.'}</pre>
    {shots.length ? shots.map(shot => <figure key={`${shot.runId}-${shot.kind}`}><a href={shot.url} target="_blank" rel="noreferrer"><img style={{maxWidth:'100%'}} src={shot.url} alt={`Run #${run.id} · ${shot.kind}`} loading="lazy" /></a><figcaption>Run #{run.id} · {shot.kind}</figcaption></figure>) : <p className="aw-muted">No screenshots recorded for run #{run.id}.</p>}
  </div>;
}

/**
 * An agent's report is Markdown written as plain text. Render the structure it
 * actually uses — paragraphs, bullets, headings, fenced code, bold and inline
 * code — as React elements, so no report text is ever parsed as HTML. Links
 * stay text (the URL is a tooltip): this desktop surface does not open them.
 */
function MarkdownReport({ text }) {
  return markdownBlocks(text).map((block, index) => {
    if (block.type === 'code') return <pre key={index} className="aw-diff aw-md__code">{block.text}</pre>;
    if (block.type === 'list') {
      const items = block.items.map((item, at) => <li key={at}><Inline spans={item.spans} /></li>);
      return block.ordered
        ? <ol key={index} className="aw-md__list">{items}</ol>
        : <ul key={index} className="aw-md__list">{items}</ul>;
    }
    if (block.type === 'heading') return <p key={index} className="aw-md__heading"><strong><Inline spans={block.spans} /></strong></p>;
    return <p key={index}><Inline spans={block.spans} /></p>;
  });
}

function Inline({ spans }) {
  return spans.map((span, index) => {
    if (span.type === 'strong') return <strong key={index}><Inline spans={span.spans} /></strong>;
    if (span.type === 'em') return <em key={index}><Inline spans={span.spans} /></em>;
    if (span.type === 'code') return <code key={index}>{span.text}</code>;
    if (span.type === 'link') return <span key={index} title={span.href}><Inline spans={span.spans} /></span>;
    return span.text;
  });
}
