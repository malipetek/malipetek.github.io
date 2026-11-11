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

/** The portal page for a ticket, when nothing can review in place. */
export const portalTicketUrl = (id) => `https://malipetek.dev/portal/admin#ticket=${id}`;

/**
 * The branch a review should open: the newest run's pushed ref, else its
 * local branch. Null when no run has left work anywhere.
 */
export function reviewRef(runs) {
  for (const run of [...(runs ?? [])].sort((a, b) => b.id - a.id)) {
    if (run.shared_to === 'origin' && run.shared_ref) return run.shared_ref;
    if (run.branch) return run.branch;
  }
  return null;
}

/** The newest run that recorded a diff, for the fallback view. */
function newestDiff(runs) {
  return [...(runs ?? [])].sort((a, b) => b.id - a.id).find((run) => run.diff || run.diff_stat) ?? null;
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
  if (run) return { kind: 'diff', run };
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
          <GitGraphReview ticket={ticket} gitRef={reviewRef(runs)} gitGraph={plan.gitGraph} onClose={() => setOpen(false)} />
        ) : (
          <Modal title={`Run ${plan.run.id}: changes`} subtitle={plan.run.branch ? `Branch ${plan.run.branch}` : undefined} onClose={() => setOpen(false)} wide>
            <pre className="aw-diff">{plan.run.diff ?? plan.run.diff_stat ?? 'No diff recorded.'}</pre>
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
function GitGraphReview({ ticket, gitRef, gitGraph, onClose }) {
  const { host } = useAdmin();
  const [state, setState] = useState({ status: 'loading', text: 'Finding the repository…', sessionId: null });
  useEffect(() => {
    let alive = true;
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
  }, [ticket.project_slug, gitRef, gitGraph, host]);
  const View = gitGraph.View;
  return (
    <Modal title={`Review #${ticket.id}`} subtitle={state.text} onClose={onClose} full>
      <div className="aw-review">
        {state.status === 'ready' ? (
          <View sessionId={state.sessionId} />
        ) : (
          <p className={cx('aw-empty', state.status === 'failed' && 'aw-error')}>{state.text}</p>
        )}
      </div>
    </Modal>
  );
}
