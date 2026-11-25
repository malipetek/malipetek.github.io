/* One ticket: the thread and the agent's runs in the middle, its properties on the right. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ACCEPT, checkPicked, sizeText } from '../../../src/lib/attachments.js';
import { isEnglish, localeInfo } from '../../../src/lib/locales.js';
import { useAdmin, useMeter, useTicket } from './store.js';
import { AskSuperagentButton } from './superagent-ask.jsx';
import {
  ATTENTION,
  AGENTS,
  MINE_LABEL,
  PRIORITIES,
  REQUEUE_WARNING,
  RUN_AGAIN,
  agentOptions,
  STATUSES,
  STATUS_LABEL,
  ago,
  billOf,
  clientWaiting,
  clock,
  errorText,
  listOf,
  money,
  predict,
  usd,
  when,
} from './format.js';
import { Button, Chips, Dot, ErrorNote, Field, Modal, Resizer, Segmented, Skeleton, StatusPill, Tag, cx } from './ui.jsx';
import { RecordedEvidence, ReviewButton } from './review.jsx';
import { createSubmission } from './submit-state.js';
import { sortedRuns } from './run-evidence.js';
import { createStepRequest } from './request-state.js';
import { MentionRecipients } from './mention-recipients.jsx';
import { createMentionDelivery } from './mention-delivery.js';
import { assistantBadge, assistantBadgeTitle } from './ticket-assistant.mjs';

/** The obvious next moves for each status; anything else is in the Status select. */
const PRIMARY = {
  new: [
    ['approved', 'Approve', 'primary'],
    ['declined', 'Decline', 'ghost'],
  ],
  approved: [['new', 'Hold', 'ghost']],
  review: [
    ['done', 'Mark done', 'primary'],
    ['approved', RUN_AGAIN, 'ghost'],
  ],
  done: [['approved', RUN_AGAIN, 'ghost']],
  declined: [['new', 'Reopen', 'ghost']],
};

/**
 * The ticket page. `details` is the right-hand column: the workbench shows it
 * beside the thread, and a host with a narrow conversation gives it a tab of
 * its own instead — the status moves then move up into the header, because
 * that column is where they lived.
 */
export function TicketView({ id, active, details = true, chrome = true }) {
  const { api, act } = useAdmin();
  const [{ ticket, messages, runs, review, screenshots, land, error, loading, fetchedAt }, reload] = useTicket(api, id);
  const meter = useMeter(api, ticket, active);
  // The waiting banner's Reply button aims the composer: reply mode, then focus.
  const [replyAt, setReplyAt] = useState(0);
  if (loading && !ticket) return <Skeleton variant="ticket" label={`Loading #${id}…`} />;
  if (!ticket) {
    return (
      <div className="aw-view">
        <ErrorNote error={error} onRetry={reload} />
      </div>
    );
  }
  const isClient = ticket.kind !== 'system';
  // Who filed it: a person in the portal, or the client's assistant over MCP.
  const via = assistantBadge(ticket);
  return (
    <div className={cx('aw-ticket', !details && 'aw-ticket--solo')}>
      {details ? (
        <Resizer host=".aw-ticket" cssVar="--aw-details-w" def={300} min={200} max={640} invert storage="aw.details.w" className="aw-resize--details" />
      ) : null}
      <div className="aw-ticket__main">
        {error ? <div className="aw-banner aw-banner--warn" role="alert"><span className="aw-banner__text">Refresh failed. Showing ticket evidence last fetched {fetchedAt ? new Date(fetchedAt).toLocaleString() : 'at an unknown time'}. {errorText(error)}</span> <Button size="sm" onClick={reload}>Retry refresh</Button></div> : null}
        <header className="aw-ticket__head">
          {chrome ? (
          <div className="aw-ticket__crumbs">
            <span className="aw-mono">#{ticket.id}</span>
            <span>{ticket.project_name ?? 'no project'}</span>
            <span>
              {isClient ? (
                <>
                  {ticket.client_name ? `${ticket.client_name} · ` : ''}
                  <a className="aw-mailto" href={`mailto:${ticket.client_email}`}>
                    {ticket.client_email}
                  </a>
                </>
              ) : (
                MINE_LABEL
              )}
              {via ? <>{' '}<Tag title={assistantBadgeTitle(ticket)}>{via}</Tag></> : null}
            </span>
            <span>opened {when(ticket.created_at)}</span>
            {isClient && ticket.client_locale && !isEnglish(ticket.client_locale) ? (
              <span title="Their messages are machine-translated for you; your replies reach them translated.">
                writes in {localeInfo(ticket.client_locale)?.english ?? ticket.client_locale}
              </span>
            ) : null}
          </div>
          ) : null}
          {chrome ? <h2 title={ticket.title_en ? `Original: ${ticket.title}` : undefined}>{ticket.title_en || ticket.title}</h2> : null}
          {clientWaiting(ticket) ? (
            <div className="aw-banner aw-banner--warn">
              <Dot state="warn" /> The client wrote {ago(ticket.client_waiting_since)} ago and is waiting for an answer.
              <span className="aw-toolbar__fill" />
              <Button size="sm" onClick={() => setReplyAt(Date.now())}>
                Reply
              </Button>
              <Button
                size="sm"
                kind="ghost"
                onClick={() => act(() => api('POST', `/admin/tickets/${ticket.id}/answered`), 'Marked: no reply needed.').then(reload, () => undefined)}
              >
                No reply needed
              </Button>
            </div>
          ) : null}
          {details ? null : (
            <div className="aw-ticket__quick">
              <TicketActions ticket={ticket} runs={runs} land={land} reload={reload} />
            </div>
          )}
        </header>

        {ticket.status === 'review' ? (
          <ReviewCard
            review={review}
            ticket={ticket}
            runs={runs}
            latestRunId={sortedRuns(runs)[0]?.id}
            screenshots={screenshots.filter((shot) => review?.runId != null && String(shot.runId) === String(review.runId))}
          />
        ) : null}
        {runs.length ? (
          <details className="aw-evidence-more">
            <summary>Evidence &amp; diff · {runs.length} run{runs.length === 1 ? '' : 's'}</summary>
            <RecordedEvidence runs={runs} screenshots={screenshots} review={review} />
          </details>
        ) : null}
        <Timeline key={`timeline-${ticket.id}`} ticket={ticket} messages={messages} runs={runs} />
        <Composer key={ticket.id} ticket={ticket} onSent={reload} replyAt={replyAt} />
      </div>
      {details ? <TicketDetails ticket={ticket} runs={runs} land={land} meter={meter} reload={reload} /> : null}
    </div>
  );
}

/**
 * What can be done with the ticket now: its status moves, stopping the live
 * run, landing the work, reviewing it. At the top of the sticky details
 * column, so it stays in reach however far the thread scrolls.
 */
function TicketActions({ ticket, runs, land, reload }) {
  const { api, setStatus, act, ask } = useAdmin();
  const live = runs.find((r) => r.status === 'running');
  const move = (s) => {
    // Queueing again is deliberate: the fleet may resume the old session. System
    // work has no client to notify, so it just goes back to the queue.
    if (s === 'approved' && ticket.status !== 'new' && ticket.kind !== 'system') {
      ask({
        title: `${RUN_AGAIN} for #${ticket.id}?`,
        text: REQUEUE_WARNING,
        confirm: RUN_AGAIN,
        run: () => act(() => api('PATCH', `/admin/tickets/${ticket.id}`, { status: 'approved' })).then(reload),
      });
      return;
    }
    return setStatus(ticket, s).then(reload);
  };
  // Land only finished work: a review, decline or abandoned run still has a
  // decision to make, and landing is what publishes.
  const canLand = Boolean(ticket.project_id) && ticket.status === 'done' && runs.length > 0;
  return (
    <div className="aw-ticket__actions">
      <StatusPill status={ticket.status} />
      {(PRIMARY[ticket.status] ?? []).map(([s, label, kind]) => (
        <Button key={s} kind={kind} size="sm" onClick={() => void move(s)}>
          {label}
        </Button>
      ))}
      {live && !live.cancel_requested ? (
        <Button
          kind="danger"
          size="sm"
          onClick={() =>
            ask({
              title: 'Stop this run?',
              text: 'The agent stops now; its partial work stays on the branch.',
              confirm: 'Stop run',
              danger: true,
              run: () =>
                act(() => api('POST', `/admin/runs/${live.id}/cancel`), 'Stopping the run; it goes to review.').then(reload, () => undefined),
            })
          }
        >
          Stop run
        </Button>
      ) : null}
      {live ? (
        <span className="aw-running">
          <span className="aw-live" /> {live.cancel_requested ? 'stopping' : `${live.executor} on ${live.node_id ?? 'Harness'} · ${ago(live.started_at)}`}
        </span>
      ) : null}
      {canLand ? (
        <Button
          size="sm"
          kind="ghost"
          title="Push this ticket's work branch onto the project's main line"
          onClick={() =>
            ask({
              title: 'Land on main?',
              text: `Pushes the work branch for #${ticket.id} onto ${ticket.project_slug ?? 'the project'}'s main line. If the project deploys from main, this publishes it. Git only accepts a fast-forward.`,
              confirm: 'Land on main',
              run: () =>
                act(() => api('POST', `/admin/tickets/${ticket.id}/land`), 'A node picks it up on its next heartbeat.').then(
                  reload,
                  () => undefined,
                ),
            })
          }
        >
          Land on main
        </Button>
      ) : null}
      <AskSuperagentButton
        scope={`t:${ticket.id}`}
        label={`#${ticket.id} ${ticket.title_en || ticket.title}`}
        ask="What is the state of this ticket, and what does it need next?"
        title="Start a conversation that can read this ticket and its runs"
      />
      {land?.requestedAt ? (
        <span className="aw-running">
          <span className="aw-live" /> landing…
        </span>
      ) : null}
      {land?.ref && !land.requestedAt ? (
        <span className="aw-muted aw-land-ref">
          {canLand ? 'last landed on' : 'landed on'} {land.ref}
          {land.sha ? ` (${String(land.sha).slice(0, 8)})` : ''}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The pre-review's one screen: verdict, why, and the build it was based on.
 * The one place the work is reviewed from — its action opens Git Graph when
 * the host has it, else the newest run's recorded diff.
 */
function ReviewCard({ review, ticket, runs, latestRunId, screenshots = [] }) {
  if (!review) return null;
  const tone = review.verdict === 'pass' ? 'ok' : review.verdict === 'attention' ? 'warn' : 'bad';
  const label = review.verdict === 'pass' ? 'pass' : review.verdict === 'attention' ? 'check' : 'fail';
  return (
    <section className={cx('aw-prereview', `aw-prereview--${tone}`)}>
      <header>
        <Dot state={tone} />
        <strong>Pre-review · run #{review.runId ?? 'unknown'}{review.runId != null && String(review.runId) !== String(latestRunId) ? ' · previous run, not the latest run' : ''}</strong>
        <Tag tone={tone}>{label}</Tag>
        <span className="aw-toolbar__fill" />
        <span className="aw-muted">
          {review.model ?? 'model'} · {ago(review.createdAt)}
        </span>
      </header>
      <p className="aw-prereview__headline">{review.headline}</p>
      {review.points?.length ? (
        <ul>
          {review.points.map((point, i) => (
            <li key={i}>{point}</li>
          ))}
        </ul>
      ) : null}
      {screenshots.length ? (
        <div className="aw-shots">
          {screenshots.map((shot) => (
            <figure key={`${shot.runId}-${shot.kind}`}>
              <a href={shot.url} target="_blank" rel="noreferrer">
                <img src={shot.url} alt={`Preview ${shot.kind} the change`} loading="lazy" />
              </a>
              <figcaption>{shot.kind}</figcaption>
            </figure>
          ))}
        </div>
      ) : null}
      <footer>
        {review.buildOk == null ? (
          <Tag tone="dash">build result unknown</Tag>
        ) : review.buildOk ? (
          <Tag tone="ok">build passed</Tag>
        ) : (
          <Tag tone="bad">build failed</Tag>
        )}
        <span className="aw-muted">A cheap agent's read; you still decide.</span>
        <span className="aw-toolbar__fill" />
        <ReviewButton ticket={ticket} runs={runs} />
      </footer>
    </section>
  );
}

/** Messages and runs in one stream, oldest first. */
function Timeline({ ticket, messages, runs }) {
  const items = [
    ...messages.filter((m) => m.author !== 'runner').map((m) => ({ at: m.created_at, kind: 'msg', m })),
    ...runs.map((r) => ({ at: r.started_at, kind: 'run', r })),
  ];
  // A run's report is also a runner message; show it once, on the run.
  const orphanReports = messages.filter((m) => m.author === 'runner' && !runs.some((r) => r.summary && m.body.includes(r.summary.slice(0, 60))));
  for (const m of orphanReports) items.push({ at: m.created_at, kind: 'msg', m });
  // Same second: messages before runs, then in the order they were written.
  const rank = (x) => (x.kind === 'msg' ? 0 : 1);
  const seq = (x) => (x.kind === 'msg' ? x.m.id : x.r.id);
  items.sort((a, b) => a.at - b.at || rank(a) - rank(b) || seq(a) - seq(b));
  const latest = items[items.length - 1];
  return (
    <ol className="aw-timeline">
      {items.map((item) =>
        item.kind === 'run' ? (
          <RunCard key={`r${item.r.id}`} run={item.r} latest={item === latest} />
        ) : item.m.author === 'system' ? (
          <li key={`m${item.m.id}`} className="aw-event">
            <span>{item.m.body}</span>
            <time>{when(item.m.created_at)}</time>
          </li>
        ) : (
          <Message key={`m${item.m.id}`} ticket={ticket} m={item.m} latest={item === latest} />
        ),
      )}
    </ol>
  );
}

/** Long enough that it should start folded: about six lines or more. */
const isLong = (text) => (text ?? '').length > 320 || (text ?? '').split('\n').length > 6;

/**
 * Fold state for a long message or report. Long ones start folded, except the
 * newest item, which is usually the one being read. A click that ends a text
 * selection does not toggle.
 */
function useFold(text, latest) {
  const long = isLong(text);
  const [open, setOpen] = useState(!long || latest);
  const toggle = () => {
    if (!long || window.getSelection?.()?.toString()) return;
    setOpen((o) => !o);
  };
  return { long, open, toggle };
}

function FoldChevron({ fold }) {
  if (!fold.long) return null;
  return (
    <button
      type="button"
      className={cx('aw-fold__chev', fold.open && 'is-open')}
      aria-expanded={fold.open}
      aria-label={fold.open ? 'Fold' : 'Unfold'}
      onClick={(e) => {
        e.stopPropagation();
        fold.toggle();
      }}
    >
      ▸
    </button>
  );
}

function FoldMore({ fold, text }) {
  if (!fold.long) return null;
  const lines = (text ?? '').split('\n').length;
  return (
    <button type="button" className="aw-link aw-fold__more" onClick={fold.toggle}>
      {fold.open ? 'Show less' : `Show all${lines > 6 ? ` (${lines} lines)` : ''}`}
    </button>
  );
}

/** One message. Long ones fold; click the header to toggle. */
function Message({ ticket, m, latest }) {
  const [original, setOriginal] = useState(false);
  const translated = m.original !== undefined;
  const body = translated && original ? m.original : m.body;
  const fold = useFold(body, latest);
  return (
    <li className={cx('aw-msg', `aw-msg--${m.author}`, m.internal === 1 && 'is-private')}>
      <header className={cx(fold.long && 'aw-fold')} onClick={fold.toggle}>
        <FoldChevron fold={fold} />
        <strong>{m.author === 'ali' ? 'You' : m.author === 'client' ? ticket.client_name ?? ticket.client_email ?? 'Client' : m.author}</strong>
        {m.internal === 1 ? <Tag tone="warn">private · agent reads it</Tag> : m.author === 'ali' ? <Tag tone="client">emailed</Tag> : null}
        {translated ? (
          <button
            type="button"
            className="aw-link"
            title="Machine-translated. The agents read the English."
            onClick={(e) => {
              e.stopPropagation();
              setOriginal((o) => !o);
            }}
          >
            {original ? 'show English' : `translated from ${localeInfo(m.translatedFrom)?.english ?? m.translatedFrom ?? 'their language'} · show original`}
          </button>
        ) : null}
        <time>{when(m.created_at)}</time>
      </header>
      {body ? <div className={cx('aw-msg__body', fold.long && !fold.open && 'is-clipped')}>{body}</div> : null}
      {fold.long ? <FoldMore fold={fold} text={body} /> : null}
      {m.files?.length ? <FileChips ticketId={ticket.id} files={m.files} /> : null}
    </li>
  );
}

/** A message's attachments. Downloadable when the host can save files. */
function FileChips({ ticketId, files: list }) {
  const { files, notify } = useAdmin();
  return (
    <ul className="aw-files">
      {list.map((f) => (
        <li key={f.id}>
          {files ? (
            <button
              type="button"
              className="aw-file"
              onClick={() =>
                files
                  .download(`/admin/tickets/${ticketId}/files/${f.id}`, f.name)
                  .then((out) => out?.path && notify(`Saved to ${out.path}`))
                  .catch((e) => notify(errorText(e), 'error'))
              }
            >
              {f.name} <span className="aw-muted">{sizeText(f.size)}</span>
            </button>
          ) : (
            <span className="aw-file" title="Open the web workbench to download">
              {f.name} <span className="aw-muted">{sizeText(f.size)}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

const STEP_POLL_MS = 3000;
const STEP_MARK = { tool: '›', text: '·', error: '!', node: '◦' };

/**
 * What the agent is doing, while it does it: the node streams its tool calls,
 * messages and milestones (src/steps.ts). Shown open and polled while the run
 * is live; afterwards it folds to one line under the report, fetched on open.
 */
function RunSteps({ run, live }) {
  const { api } = useAdmin();
  const [open, setOpen] = useState(live);
  useEffect(() => { if (live) setOpen(true); }, [live]);
  const [{steps,error}, setStepsState] = useState({steps:null,error:null});
  const [retry, setRetry] = useState(0);
  const request = useMemo(() => createStepRequest(api, run.id, setStepsState), [api, run.id]);
  const listRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    let timer = null;
    const pull = async () => {
      const data = await request.pull();
      // A failed live pull must not stop the polling loop.
      if (alive && (live || data?.live)) timer = setTimeout(pull, STEP_POLL_MS);
    };
    void pull();
    return () => { alive = false; clearTimeout(timer); request.invalidate(); };
  }, [open, request, live, retry]);
  // Follow the newest step while live, unless the reader scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (live && el && el.scrollHeight - el.scrollTop - el.clientHeight < 60) el.scrollTop = el.scrollHeight;
  }, [steps, live]);
  if (!open) {
    return (
      <button type="button" className="aw-link aw-steps-toggle aw-steps-toggle--show" onClick={() => setOpen(true)}>
        Show steps
      </button>
    );
  }
  const failure = error ? <p role="alert" className="aw-error">Steps could not refresh. {errorText(error)} <Button size="sm" onClick={() => setRetry(n => n + 1)}>Retry steps</Button></p> : null;
  if (steps === null) return <>{failure}{!error ? <p className="aw-muted">Loading steps…</p> : null}</>;
  if (steps.length === 0) return <>{failure}<p className="aw-muted">{live ? 'Working… steps appear here as the agent takes them.' : 'No steps were recorded for this run.'}</p></>;
  return (
    <>
      {failure}
      <ol className="aw-steps" ref={listRef}>
        {steps.map((step) => (
          <li key={step.seq} className={`aw-step--${step.kind}`}>
            <time>{new Date(step.at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
            <b className="aw-step__mark" aria-hidden="true">{STEP_MARK[step.kind] ?? '·'}</b>
            <span>{step.text}</span>
          </li>
        ))}
      </ol>
      {live ? null : (
        <button type="button" className="aw-link aw-steps-toggle" onClick={() => setOpen(false)}>
          Hide steps
        </button>
      )}
    </>
  );
}

function RunCard({ run, latest }) {
  const live = run.status === 'running';
  const summary = run.summary ?? '';
  const fold = useFold(summary, latest);
  return (
    <li className={cx('aw-run', `aw-run--${live ? 'live' : run.status}`)}>
      <header className={cx(fold.long && 'aw-fold')} onClick={fold.toggle}>
        <FoldChevron fold={fold} />
        {live ? <span className="aw-live" /> : <Dot state={run.status === 'ok' ? 'ok' : 'bad'} />}
        <strong>Run #{run.id} · {run.executor}</strong>
        {run.model ? <span className="aw-muted">{run.model}</span> : null}
        <span className="aw-muted">on {run.node_id ?? 'the Harness'}</span>
        {run.attempt > 1 ? <Tag>attempt {run.attempt}</Tag> : null}
        <span className="aw-toolbar__fill" />
        <span className="aw-muted">
          {usd(run.cost_micro_usd)} · {run.finished_at ? `${Math.max(1, Math.round((run.finished_at - run.started_at) / 60))}m` : `running ${ago(run.started_at)}`}
        </span>
      </header>
      <RunSteps run={run} live={live} />
      {summary ? (
        <div className={cx('aw-run__summary', fold.long && !fold.open && 'is-clipped')}>
          {summary}
        </div>
      ) : live ? (
        <p className="aw-muted">Working… the report appears here when it finishes.</p>
      ) : null}
      <footer>
        {fold.long ? <FoldMore fold={fold} text={summary} /> : null}
        {run.diff_stat ? <code className="aw-muted">{run.diff_stat.split('\n').pop()}</code> : null}
        {run.shared_to === 'origin' ? (
          <Tag tone="ok" title="The next run starts from it on any node">pushed · {run.shared_ref}</Tag>
        ) : run.shared_to === 'bundle' ? (
          <Tag tone="ok" title="Saved in the portal; the next run starts from it on any node">shared as bundle</Tag>
        ) : run.branch ? (
          <Tag tone="dash" title="Not pushed: only that node has it">{run.branch} · only on {run.node_id ?? 'the node'}</Tag>
        ) : null}
        <ConversationButton run={run} />
      </footer>
    </li>
  );
}

/**
 * Open a `dsh` run's Harness session in the conversation view. The Harness
 * only (it publishes `host.conversation`): the Host finds the session on this
 * machine or imports the log the run's node uploaded, and says why when it
 * can do neither.
 */
function ConversationButton({ run }) {
  const { host } = useAdmin();
  const [state, setState] = useState({ busy: false, error: null });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const conversation = host?.conversation;
  if (!run.session_id || !conversation?.available()) return null;
  const open = async () => {
    setState({ busy: true, error: null });
    try {
      await conversation.open({ runId: run.id, sessionId: run.session_id, sessionDir: run.session_dir });
      if (alive.current) setState({ busy: false, error: null });
    } catch (error) {
      if (alive.current) setState({ busy: false, error: errorText(error) });
    }
  };
  return (
    <>
      <button
        type="button"
        className="aw-link"
        disabled={state.busy}
        title="Open this run's Harness session in the conversation view"
        onClick={() => void open()}
      >
        {state.busy ? 'Opening conversation…' : 'Open conversation'}
      </button>
      {state.error ? <span className="aw-warn">{state.error}</span> : null}
    </>
  );
}

/** Reply to the client, or steer the agent with a private note. */
function Composer({ ticket, onSent, replyAt = 0 }) {
  const { api, act, ask, notify, files: host } = useAdmin();
  const isClient = ticket.kind !== 'system';
  const [mode, setMode] = useState(isClient ? 'note' : 'note');
  const [text, setText] = useState('');
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState(null);
  const submission = useRef(createSubmission());
  const [recipientUserIds, setRecipientUserIds] = useState([]);
  const [mentionJobs, setMentionJobs] = useState([]);
  const [mentionVersion, setMentionVersion] = useState(0);
  const picker = useRef(null);
  const body = useRef(null);
  const note = mode === 'note' || !isClient;
  const canRerun = ['review', 'done', 'approved', 'new'].includes(ticket.status);
  // The waiting banner's Reply button aims this composer.
  useEffect(() => {
    if (!replyAt) return;
    setMode('reply');
    body.current?.focus();
  }, [replyAt]);
  // Three rows when empty, growing with the text up to twelve, then scrolling.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    el.style.height = 'auto';
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || 18;
    const frame = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const max = line * 12 + frame;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [text]);

  const checkMention = async (job, saved) => {
    setMentionJobs(previous => previous.map(value => value.key === job.key ? {...value,status:'checking'} : value));
    try {
      const result = await job.deliver(saved);
      setMentionJobs(previous => previous.map(value => value.key === job.key ? {...value,status:'complete',result,error:null} : value));
    } catch (error) {
      setMentionJobs(previous => previous.map(value => value.key === job.key ? {...value,status:'failed',error} : value));
    }
  };
  const send = async (rerun) => {
    if (submission.current.busy || submission.current.pendingQueue) return;
    const body = text.trim();
    if (!body && !picked.length) return;
    const save = async () => {
      if (picked.length) {
        const form = new FormData();
        form.append('body', body);
        form.append('internal', String(note));
        for (const file of picked) form.append('files', file);
        return host.upload(`/admin/tickets/${ticket.id}/messages`, form);
      } else return api('POST', `/admin/tickets/${ticket.id}/messages`, {body, internal:note});
    };
    const go = async () => {
      if (submission.current.busy || submission.current.pendingQueue) return;
      setBusy(true); setSendError(null);
      try {
        await submission.current.run({save,
          queue: rerun && ticket.status !== 'approved' ? () => api('PATCH', `/admin/tickets/${ticket.id}`, {status:'approved'}) : null,
          onSaved: saved => {
            setText(''); setPicked([]); if (picker.current) picker.current.value = ''; void onSent();
            if (recipientUserIds.length) {
              const job = {key:globalThis.crypto.randomUUID(),messageId:saved?.messageId,count:recipientUserIds.length,deliver:createMentionDelivery({api,projectId:ticket.project_id,ticketId:ticket.id,recipientUserIds}),status:'checking'};
              setMentionJobs(previous => [...previous,job]);
              void checkMention(job,saved);
            }
            setRecipientUserIds([]); setMentionVersion(value => value + 1);
          },
        });
        notify(rerun ? 'Note saved; agent queued.' : note ? 'Note saved.' : 'Reply sent.');
        void onSent();
      } catch (error) { setSendError(error); }
      finally { setBusy(false); }
    };
    if (!note) ask({title:'Email the client?',text:`${ticket.client_email} receives this reply.`,confirm:'Send reply',run:go});
    else await go();
  };
  const retryQueue = async () => {
    if (submission.current.busy) return;
    setBusy(true); setSendError(null);
    try { await submission.current.retryQueue(); notify('Agent queued.'); void onSent(); }
    catch (error) { setSendError(error); }
    finally { setBusy(false); }
  };

  return (
    <div className={cx('aw-composer', note && 'is-note')}>
      <div className="aw-composer__head">
        {isClient ? (
          <Segmented
            value={mode}
            disabled={busy}
            options={[
              { value: 'note', label: 'Private note' },
              { value: 'reply', label: 'Reply to client' },
            ]}
            onChange={setMode}
          />
        ) : (
          <strong>Note for the agent</strong>
        )}
        <span className="aw-muted">{note ? 'Only you and the agent see this. It is trusted guidance on the next run.' : 'Emailed to the client.'}</span>
      </div>
      <textarea
        ref={body}
        rows={3}
        value={text}
        disabled={busy}
        placeholder={note ? 'Steer the agent: what to change, what to avoid, how to check…' : 'Write to the client…'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (!e.nativeEvent?.isComposing && (e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send(false); } }}
      />
      <MentionRecipients key={mentionVersion} api={api} projectId={ticket.project_id} onChange={setRecipientUserIds} disabled={busy} internal={note} />
      {mentionJobs.map(job => <div key={job.key} role="status" className="aw-muted">
        {job.status === 'checking'
          ? `Notifying ${job.count}…`
          : job.error
            ? `Notified ${job.count} · status unknown`
            : `Notified ${job.count}${job.result?.ok ? '' : ' · some not confirmed'}`}
        {job.status === 'checking' ? null : job.error || !job.result?.ok ? <Button size="sm" onClick={() => void checkMention(job)}>Check notification status</Button> : null}
        {job.result?.deliveries?.length ? (
          <details className="aw-notified">
            <summary>Details</summary>
            <p>Message #{job.messageId ?? 'unknown'} saved.</p>
            {job.result.deliveries.map(delivery => <p key={delivery.userId}>Recipient #{delivery.userId}: {delivery.status === 'sent' ? 'Email sent' : delivery.status === 'failed' ? 'Email could not be sent' : delivery.status === 'sending' ? 'Delivery status unknown' : delivery.status === 'cancelled' ? 'Notification cancelled' : 'Delivery pending'}.</p>)}
          </details>
        ) : null}
      </div>)}
      {sendError ? <p role="alert" className="aw-error">{submission.current.pendingQueue ? 'Message saved. Queue failed; retry queues only, without another message. ' : 'Message was not saved. '}{errorText(sendError)}</p> : null}
      {submission.current.pendingQueue ? <Button disabled={busy} onClick={retryQueue}>{busy ? 'Queuing…' : 'Retry queue only'}</Button> : null}
      <div className="aw-composer__foot">
        {host?.upload ? (
          <>
            <input
              ref={picker}
              type="file"
              disabled={busy}
              multiple
              accept={ACCEPT}
              hidden
              onChange={(e) => {
                const list = [...(e.target.files ?? [])];
                const problem = checkPicked(list);
                if (problem) {
                  notify(problem, 'error');
                  e.target.value = '';
                  return;
                }
                setPicked(list);
              }}
            />
            <button type="button" className="aw-link" disabled={busy} onClick={() => picker.current?.click()}>
              {picked.length ? `${picked.length} file${picked.length > 1 ? 's' : ''}: ${picked.map((f) => f.name).join(', ')}` : 'Attach files…'}
            </button>
            {picked.length ? (
              <button
                type="button"
                className="aw-link"
                disabled={busy}
                onClick={() => {
                  setPicked([]);
                  if (picker.current) picker.current.value = '';
                }}
              >
                clear
              </button>
            ) : null}
          </>
        ) : null}
        <span className="aw-faint">⌘↵ to send</span>
        <span className="aw-toolbar__fill" />
        {note && canRerun ? (
          <Button disabled={busy || submission.current.pendingQueue || (!text.trim() && !picked.length)} onClick={() => void send(true)}>
            Add note and run again
          </Button>
        ) : null}
        <Button
          busy={busy}
          disabled={submission.current.pendingQueue || (!text.trim() && !picked.length)}
          disabledReason={submission.current.pendingQueue ? 'Retry the queue first: the note is already saved.' : 'Write something first.'}
          onClick={() => void send(false)}
        >
          {note ? 'Add note' : 'Send reply…'}
        </Button>
      </div>
    </div>
  );
}

/** Properties, cost, routing and runs. Each control saves on change. */
/**
 * The project's hosted site, where Ali checks the work: the preview a run
 * deployed, what is live, and the button that makes the preview live.
 */
export function SitePanel({ project }) {
  const sites = project?.sites ?? (project?.site ? [project.site] : []);
  if (!sites.length) return null;
  return (
    <section className="aw-site" aria-label="Sites">
      {sites.map((site) => (
        <AdminSite key={site.id} project={project} site={site} />
      ))}
    </section>
  );
}

function AdminSite({ project, site }) {
  const { api, act, ask, reload } = useAdmin();
  const placeholder = site.previewDeploy === 'placeholder';
  const unpublished = site.previewDeploy && site.previewDeploy !== site.productionDeploy;
  return (
    <div className="aw-site__one">
      <span className="aw-field__label">
        Site · {site.name || project.name} · {site.state} · {site.host === 'cloudflare' ? 'Cloudflare' : 'malipetek.online'}
      </span>
      {site.cloudflare?.error ? <p className="aw-warn">Cloudflare: {site.cloudflare.error}</p> : null}
      {site.state !== 'ready' ? (
        <p className="aw-muted">{site.error ?? 'Being set up: the repo and a first page are on their way.'}</p>
      ) : (
        <>
          <p className="aw-site__links">
            <a href={site.previewUrl} target="_blank" rel="noreferrer">
              Preview ↗
            </a>
            <a href={site.productionUrl} target="_blank" rel="noreferrer">
              Live ↗
            </a>
          </p>
          <p className={placeholder || unpublished ? 'aw-warn' : 'aw-muted'}>
            {placeholder
              ? 'The preview is still the placeholder: no run has deployed a build yet.'
              : unpublished
                ? 'The preview has changes that are not live.'
                : 'Live matches the preview.'}
          </p>
          {site.rebuildRequestedAt ? <p className="aw-muted">Rebuild asked for: a node builds it on its next beat.</p> : null}
          {site.rebuildError ? <p className="aw-warn">Last rebuild failed: {site.rebuildError}</p> : null}
          <Button
            size="sm"
            disabled={Boolean(site.rebuildRequestedAt)}
            disabledReason="A rebuild is already queued; a node takes it on its next beat."
            title="Build the preview branch as it is and deploy it, without an agent run"
            onClick={() =>
              void act(
                () => api('POST', `/admin/projects/${project.id}/site/rebuild`, { siteId: site.id }),
                'A node rebuilds the preview on its next beat.',
              ).then(reload, () => undefined)
            }
          >
            Rebuild preview
          </Button>
          {unpublished && !placeholder ? (
            <Button
              size="sm"
              onClick={() =>
                ask({
                  title: 'Publish the preview?',
                  text: `${site.productionUrl} will show exactly what ${site.previewUrl} shows now. You can roll back from the project's deploys.`,
                  confirm: 'Publish',
                  run: () =>
                    act(
                      () => api('POST', `/admin/projects/${project.id}/site/publish`, { siteId: site.id }),
                      'Published.',
                    ).then(reload, () => undefined),
                })
              }
            >
              Publish to live
            </Button>
          ) : null}
          <Button
            size="sm"
            kind="ghost"
            onClick={() =>
              ask({
                title: `Delete ${site.name || project.name}?`,
                text: 'Its address and deploy history stop working. The project’s code and requests stay.',
                confirm: 'Delete site',
                danger: true,
                run: () =>
                  act(
                    () => api('DELETE', `/admin/projects/${project.id}/site`, { siteId: site.id }),
                    'Site deleted.',
                  ).then(reload, () => undefined),
              })
            }
          >
            Delete site
          </Button>
        </>
      )}
    </div>
  );
}

export function TicketDetails({ ticket, runs, land, meter, reload, page = false }) {
  const { api, data, act, setStatus } = useAdmin();
  const isClient = ticket.kind !== 'system';
  const projectSites = data.projects.find((p) => p.id === ticket.project_id)?.sites ?? [];
  const [fixing, setFixing] = useState(false);
  const patch = (body, done) => act(() => api('PATCH', `/admin/tickets/${ticket.id}`, body), done).then(reload, () => undefined);
  const requires = listOf(ticket.requires);
  const caps = data.catalog?.capabilities ?? [];
  const queued = data.queue.find((q) => q.id === ticket.id);
  const where = predict(data.nodes, { slug: ticket.project_slug, requires, executor: ticket.executor, kind: ticket.kind });
  const price = billOf({ humanSeconds: meter.seconds, aiMicroUsd: ticket.ai_micro_usd ?? 0, firstPreview: Boolean(ticket.first_preview) });
  return (
    <aside className={cx('aw-details', page && 'aw-details--page')} aria-label="Details">
      <TicketActions ticket={ticket} runs={runs} land={land} reload={reload} />
      <div className="aw-details__pair">
        <Field label="Project">
          <select value={ticket.project_id ?? ''} onChange={(e) => void patch({ projectId: e.target.value || null }, 'Project saved.')}>
            <option value="">No project</option>
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Site">
          <select value={ticket.site_id ?? ''} onChange={(e) => void patch({ siteId: e.target.value || null }, 'Site saved.')}>
            <option value="">Main site</option>
            {projectSites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.slug}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Priority">
        <Segmented value={ticket.priority ?? 0} options={PRIORITIES} onChange={(v) => void patch({ priority: v }, 'Priority saved.')} />
      </Field>
      <Field label="Agent" hint={agentOptions(ticket.executor).find((a) => a.value === (ticket.executor ?? null))?.hint}>
        <select
          value={ticket.executor ?? ''}
          onChange={(e) => {
            const v = e.target.value || null;
            void patch({ executor: v }, `Agent: ${AGENTS.find((a) => a.value === v)?.label ?? v ?? 'auto'}.`);
          }}
        >
          {agentOptions(ticket.executor).map((a) => (
            <option key={String(a.value)} value={a.value ?? ''} title={a.hint}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>
      {['approved', 'new'].includes(ticket.status) ? (
        <p className={`aw-predict aw-predict--${queued && !queued.eligible.length ? 'bad' : where.state}`}>
          <Dot state={queued && !queued.eligible.length ? 'bad' : where.state} /> {queued?.reason ?? where.text}
        </p>
      ) : null}

      {/* The rare controls, folded away: the everyday loop is status, agent and priority. */}
      <details className="aw-details__more">
        <summary>More</summary>
        <Field label="Change status">
          <select value={ticket.status} onChange={(e) => void setStatus(ticket, e.target.value).then(reload)}>
            {/* Approving is its own button, with its own confirmation. */}
            {STATUSES.filter((s) => s !== 'approved' || ticket.status === 'approved').map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <SitePanel project={data.projects.find((p) => p.id === ticket.project_id)} />
        {isClient ? (
          <>
            <Field label="Attention">
              <select value={ticket.attention} onChange={(e) => void patch({ attention: e.target.value }, 'Attention saved.')}>
                {ATTENTION.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Budget">
              <BudgetInput cents={ticket.budget_cents} onSave={(budgetCents) => void patch({ budgetCents }, 'Budget saved.')} />
            </Field>
          </>
        ) : null}
        {caps.length ? (
          <Field label="Needs">
            <Chips value={requires} options={caps.map((c) => ({ value: c.id, label: c.label, hint: c.hint }))} onChange={(v) => void patch({ requires: v }, 'Saved.')} />
          </Field>
        ) : null}
        <div className="aw-cost">
          <div>
            <span className="aw-field__label">Your time</span>
            <strong>{clock(meter.seconds)}</strong>
            <small className="aw-muted">{!meter.open ? 'meter closed' : meter.running ? 'meter running' : 'meter paused'}</small>
          </div>
          <div>
            <span className="aw-field__label">AI</span>
            <strong>{usd(ticket.ai_micro_usd ?? 0)}</strong>
          </div>
          <div>
            <span className="aw-field__label">{ticket.first_preview ? 'First preview' : ticket.price_cents != null ? 'Billed' : 'So far'}</span>
            <strong>{ticket.first_preview ? 'on us' : money(ticket.price_cents ?? price.totalCents)}</strong>
            {ticket.first_preview ? <small className="aw-muted">client billed {money(0)}</small> : null}
          </div>
          <button type="button" className="aw-link" onClick={() => setFixing(true)}>
            Correct time…
          </button>
        </div>
      </details>

      {fixing ? (
        <TimeModal
          seconds={meter.seconds}
          onClose={() => setFixing(false)}
          onSave={(humanSeconds) => {
            setFixing(false);
            void patch({ humanSeconds }, 'Time corrected.');
          }}
        />
      ) : null}
    </aside>
  );
}

function BudgetInput({ cents, onSave }) {
  const [value, setValue] = useState(cents == null ? '' : String(cents / 100));
  const save = () => {
    const v = value.trim();
    const next = v === '' ? null : Math.round(Number(v) * 100);
    if (next !== null && !(next >= 0)) return;
    if (next !== cents) onSave(next);
  };
  return (
    <div className="aw-inline">
      <span className="aw-muted">$</span>
      <input inputMode="decimal" value={value} placeholder="no cap" onChange={(e) => setValue(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} />
    </div>
  );
}

function TimeModal({ seconds, onClose, onSave }) {
  const [minutes, setMinutes] = useState(String(Math.round(seconds / 6) / 10));
  const ok = Number.isFinite(Number(minutes)) && Number(minutes) >= 0;
  return (
    <Modal kind="create"
      title="Correct your time"
      subtitle="The meter missed something, or counted a break. This replaces the total."
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!ok} disabledReason="Enter minutes as a number, 0 or more." onClick={() => onSave(Math.round(Number(minutes) * 60))}>
            Set time
          </Button>
        </>
      }
    >
      <Field label="Minutes on this ticket">
        <input inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      </Field>
    </Modal>
  );
}
