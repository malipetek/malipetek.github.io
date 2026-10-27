/* One ticket: the thread and the agent's runs in the middle, its properties on the right. */
import { useEffect, useRef, useState } from 'react';
import { ACCEPT, checkPicked, sizeText } from '../../../src/lib/attachments.js';
import { useAdmin, useMeter, useTicket } from './store.js';
import {
  ATTENTION,
  EXECUTORS,
  PRIORITIES,
  STATUSES,
  STATUS_LABEL,
  ago,
  clock,
  errorText,
  listOf,
  money,
  predict,
  priceOf,
  usd,
  when,
} from './format.js';
import { Button, Chips, Dot, Field, Modal, Segmented, StatusPill, Tag, cx } from './ui.jsx';

/** The obvious next moves for each status; anything else is in the Status select. */
const PRIMARY = {
  new: [
    ['approved', 'Approve', 'primary'],
    ['declined', 'Decline', 'ghost'],
  ],
  approved: [['new', 'Hold', 'ghost']],
  review: [
    ['done', 'Mark done', 'primary'],
    ['approved', 'Run again', 'default'],
  ],
  done: [['approved', 'Reopen and run', 'ghost']],
  declined: [['new', 'Reopen', 'ghost']],
};

export function TicketView({ id, active }) {
  const { api, setStatus, act, ask } = useAdmin();
  const [{ ticket, messages, runs, land, error, loading }, reload] = useTicket(api, id);
  const meter = useMeter(api, ticket, active);
  if (loading && !ticket) return <p className="aw-empty">Loading #{id}…</p>;
  if (!ticket) return <p className="aw-empty">{errorText(error)}</p>;
  const isClient = ticket.kind !== 'system';
  const live = runs.find((r) => r.status === 'running');
  const move = (s) => setStatus(ticket, s).then(reload);
  // Landable once a run has left work on the branch, and never mid-run.
  const canLand = Boolean(ticket.project_id) && ticket.status !== 'in_progress' && runs.length > 0;
  return (
    <div className="aw-ticket">
      <div className="aw-ticket__main">
        <header className="aw-ticket__head">
          <div className="aw-ticket__crumbs">
            <span className="aw-mono">#{ticket.id}</span>
            <span>{ticket.project_name ?? 'no project'}</span>
            <span>{isClient ? `${ticket.client_name ? `${ticket.client_name} · ` : ''}${ticket.client_email}` : 'your task'}</span>
            <span>opened {when(ticket.created_at)}</span>
          </div>
          <h2>{ticket.title}</h2>
          {ticket.client_waiting_since && ticket.status !== 'new' ? (
            <div className="aw-banner aw-banner--warn">
              The client wrote {ago(ticket.client_waiting_since)} ago and is waiting for an answer.
              <span className="aw-toolbar__fill" />
              <Button
                size="sm"
                kind="ghost"
                onClick={() => act(() => api('POST', `/admin/tickets/${ticket.id}/answered`), 'Marked: no reply needed.').then(reload, () => undefined)}
              >
                No reply needed
              </Button>
            </div>
          ) : null}
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
                  act(() => api('POST', `/admin/runs/${live.id}/cancel`), 'Stopping the run; it goes to review.').then(reload, () => undefined)
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
            <ReviewButton ticket={ticket} runs={runs} />
            {land?.requestedAt ? (
              <span className="aw-running">
                <span className="aw-live" /> landing…
              </span>
            ) : null}
            {land?.ref && !land.requestedAt ? (
              <span className="aw-muted" style={{ fontSize: 12 }}>
                landed on {land.ref}
                {land.sha ? ` (${String(land.sha).slice(0, 8)})` : ''}
              </span>
            ) : null}
          </div>
        </header>

        <Timeline ticket={ticket} messages={messages} runs={runs} />
        <Composer ticket={ticket} onSent={reload} />
      </div>
      <Details ticket={ticket} runs={runs} meter={meter} reload={reload} />
    </div>
  );
}

/**
 * The branch a review should open: the newest run's pushed ref, else its
 * local branch. Null when no run has left work anywhere.
 */
function reviewRef(runs) {
  for (const run of [...runs].sort((a, b) => b.id - a.id)) {
    if (run.shared_to === 'origin' && run.shared_ref) return run.shared_ref;
    if (run.branch) return run.branch;
  }
  return null;
}

/**
 * Review the ticket's work in Git Graph — the real extension, with every git
 * action on its right-click menus — opened on the project's repository at the
 * ticket's branch. The Harness only, and only when the Git Graph plugin is
 * installed (it publishes `host.gitGraph`).
 */
function ReviewButton({ ticket, runs }) {
  const { host } = useAdmin();
  const [open, setOpen] = useState(false);
  const gitGraph = host?.gitGraph;
  if (!gitGraph?.available() || !ticket.project_slug) return null;
  const ref = reviewRef(runs);
  return (
    <>
      <Button size="sm" kind="ghost" title="Open the project's repository in Git Graph at this ticket's branch" onClick={() => setOpen(true)}>
        Review in Git Graph
      </Button>
      {open ? <ReviewModal ticket={ticket} gitRef={ref} gitGraph={gitGraph} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ReviewModal({ ticket, gitRef, gitGraph, onClose }) {
  const { host } = useAdmin();
  const [state, setState] = useState({ status: 'loading', text: 'Finding the repository…', sessionId: null });
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const where = await host.json(`review ${ticket.project_slug}`);
        if (!where?.found) throw new Error(`No repository for ${ticket.project_slug} on this machine (looked in ${(where?.looked ?? []).join(', ')}).`);
        const sessionId = gitGraph.sessionId();
        if (!sessionId) throw new Error('Git Graph needs an open session. Open one, then try again.');
        if (alive) setState({ status: 'loading', text: `Fetching and opening ${gitRef ?? 'the repository'}…`, sessionId: null });
        const focused = await gitGraph.focus({ sessionId, repo: where.repo, ref: gitRef });
        if (!alive) return;
        const missing = gitRef && !focused.commit ? ` ${gitRef} is not in this clone yet.` : '';
        setState({ status: 'ready', text: `${focused.repo}${focused.commit ? ` · ${gitRef} at ${focused.commit.slice(0, 8)}` : ''}.${missing}`, sessionId });
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
        {state.status === 'ready' ? <View sessionId={state.sessionId} /> : <p className={cx('aw-empty', state.status === 'failed' && 'aw-error')}>{state.text}</p>}
      </div>
    </Modal>
  );
}

/** Messages and runs in one stream, oldest first. */
function Timeline({ ticket, messages, runs }) {
  const [diff, setDiff] = useState(null);
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
          <RunCard key={`r${item.r.id}`} run={item.r} latest={item === latest} onDiff={() => setDiff(item.r)} />
        ) : item.m.author === 'system' ? (
          <li key={`m${item.m.id}`} className="aw-event">
            <span>{item.m.body}</span>
            <time>{when(item.m.created_at)}</time>
          </li>
        ) : (
          <Message key={`m${item.m.id}`} ticket={ticket} m={item.m} latest={item === latest} />
        ),
      )}
      {diff ? (
        <Modal title={`Run ${diff.id}: changes`} subtitle={diff.branch ? `Branch ${diff.branch}` : undefined} onClose={() => setDiff(null)} wide>
          <pre className="aw-diff">{diff.diff ?? diff.diff_stat ?? 'No diff recorded.'}</pre>
        </Modal>
      ) : null}
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
  const fold = useFold(m.body, latest);
  return (
    <li className={cx('aw-msg', `aw-msg--${m.author}`, m.internal === 1 && 'is-private')}>
      <header className={cx(fold.long && 'aw-fold')} onClick={fold.toggle}>
        <FoldChevron fold={fold} />
        <strong>{m.author === 'ali' ? 'You' : m.author === 'client' ? ticket.client_name ?? ticket.client_email ?? 'Client' : m.author}</strong>
        {m.internal === 1 ? <Tag tone="warn">private · agent reads it</Tag> : m.author === 'ali' ? <Tag tone="client">emailed</Tag> : null}
        <time>{when(m.created_at)}</time>
      </header>
      {m.body ? <div className={cx('aw-msg__body', fold.long && !fold.open && 'is-clipped')}>{m.body}</div> : null}
      {fold.long ? <FoldMore fold={fold} text={m.body} /> : null}
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
  const [steps, setSteps] = useState(null);
  const listRef = useRef(null);
  const lastSeq = useRef(0);
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    let timer = null;
    const pull = async () => {
      try {
        const data = await api('GET', `/admin/runs/${run.id}/steps?after=${lastSeq.current}`);
        if (!alive) return;
        const fresh = data?.steps ?? [];
        if (fresh.length) lastSeq.current = fresh[fresh.length - 1].seq;
        setSteps((prev) => [...(prev ?? []), ...fresh]);
        if (data?.live) timer = setTimeout(pull, STEP_POLL_MS);
      } catch {
        if (alive) setSteps((prev) => prev ?? []);
      }
    };
    void pull();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [open, run.id, api]);
  // Follow the newest step while live, unless the reader scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (live && el && el.scrollHeight - el.scrollTop - el.clientHeight < 60) el.scrollTop = el.scrollHeight;
  }, [steps, live]);
  if (!open) {
    return (
      <button type="button" className="aw-link" style={{ fontSize: 12, margin: '2px 0 4px' }} onClick={() => setOpen(true)}>
        Show steps
      </button>
    );
  }
  if (steps === null) return <p className="aw-muted" style={{ fontSize: 12 }}>Loading steps…</p>;
  if (steps.length === 0) {
    return live ? <p className="aw-muted" style={{ fontSize: 12 }}>Working… steps appear here as the agent takes them.</p> : <p className="aw-muted" style={{ fontSize: 12 }}>No steps were recorded for this run.</p>;
  }
  return (
    <>
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
        <button type="button" className="aw-link" style={{ fontSize: 12 }} onClick={() => setOpen(false)}>
          Hide steps
        </button>
      )}
    </>
  );
}

function RunCard({ run, latest, onDiff }) {
  const live = run.status === 'running';
  const summary = run.summary ?? '';
  const fold = useFold(summary, latest);
  return (
    <li className={cx('aw-run', `aw-run--${live ? 'live' : run.status}`)}>
      <header className={cx(fold.long && 'aw-fold')} onClick={fold.toggle}>
        <FoldChevron fold={fold} />
        {live ? <span className="aw-live" /> : <Dot state={run.status === 'ok' ? 'ok' : 'bad'} />}
        <strong>{run.executor}</strong>
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
        {run.diff || run.diff_stat ? (
          <button type="button" className="aw-link" onClick={onDiff}>
            View changes
          </button>
        ) : null}
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
function Composer({ ticket, onSent }) {
  const { api, act, ask, notify, files: host } = useAdmin();
  const isClient = ticket.kind !== 'system';
  const [mode, setMode] = useState(isClient ? 'note' : 'note');
  const [text, setText] = useState('');
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const picker = useRef(null);
  const note = mode === 'note' || !isClient;
  const canRerun = ['review', 'done', 'approved', 'new'].includes(ticket.status);

  const send = async (rerun) => {
    const body = text.trim();
    if (!body && !picked.length) return;
    const go = async () => {
      setBusy(true);
      try {
        await act(async () => {
          if (picked.length) {
            const form = new FormData();
            form.append('body', body);
            form.append('internal', String(note));
            for (const f of picked) form.append('files', f);
            await host.upload(`/admin/tickets/${ticket.id}/messages`, form);
          } else {
            await api('POST', `/admin/tickets/${ticket.id}/messages`, { body, internal: note });
          }
          if (rerun && ticket.status !== 'approved') await api('PATCH', `/admin/tickets/${ticket.id}`, { status: 'approved' });
        }, note ? (rerun ? 'Note added; the agent runs again with it.' : 'Note added. The agent reads it on the next run.') : 'Reply sent; the client was emailed.');
        setText('');
        setPicked([]);
        if (picker.current) picker.current.value = '';
        onSent();
      } finally {
        setBusy(false);
      }
    };
    if (!note) ask({ title: 'Email the client?', text: `${ticket.client_email} receives this reply.`, confirm: 'Send reply', run: go });
    else await go().catch(() => undefined);
  };

  return (
    <div className={cx('aw-composer', note && 'is-note')}>
      <div className="aw-composer__head">
        {isClient ? (
          <Segmented
            value={mode}
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
        rows={4}
        value={text}
        placeholder={note ? 'Steer the agent: what to change, what to avoid, how to check…' : 'Write to the client…'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && void send(false)}
      />
      <div className="aw-composer__foot">
        {host?.upload ? (
          <>
            <input
              ref={picker}
              type="file"
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
            <button type="button" className="aw-link" onClick={() => picker.current?.click()}>
              {picked.length ? `${picked.length} file${picked.length > 1 ? 's' : ''}: ${picked.map((f) => f.name).join(', ')}` : 'Attach files…'}
            </button>
            {picked.length ? (
              <button
                type="button"
                className="aw-link"
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
        <span className="aw-muted">⌘↵ to send</span>
        <span className="aw-toolbar__fill" />
        {note && canRerun ? (
          <Button disabled={busy || (!text.trim() && !picked.length)} onClick={() => void send(true)}>
            Add note and run again
          </Button>
        ) : null}
        <Button kind="primary" disabled={busy || (!text.trim() && !picked.length)} onClick={() => void send(false)}>
          {note ? 'Add note' : 'Send reply…'}
        </Button>
      </div>
    </div>
  );
}

/** Properties, cost, routing and runs. Each control saves on change. */
function Details({ ticket, runs, meter, reload }) {
  const { api, data, act, setStatus } = useAdmin();
  const isClient = ticket.kind !== 'system';
  const [fixing, setFixing] = useState(false);
  const patch = (body, done) => act(() => api('PATCH', `/admin/tickets/${ticket.id}`, body), done).then(reload, () => undefined);
  const requires = listOf(ticket.requires);
  const caps = data.catalog?.capabilities ?? [];
  const queued = data.queue.find((q) => q.id === ticket.id);
  const where = predict(data.nodes, { slug: ticket.project_slug, requires, executor: ticket.executor, kind: ticket.kind });
  const price = priceOf({ humanSeconds: meter.seconds, aiMicroUsd: ticket.ai_micro_usd ?? 0 });
  return (
    <aside className="aw-details" aria-label="Details">
      <Field label="Status">
        <select value={ticket.status} onChange={(e) => void setStatus(ticket, e.target.value).then(reload)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </Field>
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
      <Field label="Priority">
        <Segmented value={ticket.priority ?? 0} options={PRIORITIES} onChange={(v) => void patch({ priority: v }, 'Priority saved.')} />
      </Field>
      <Field label="Agent" hint={isClient ? 'Client work always runs sandboxed in Claude Code.' : undefined}>
        <Segmented
          value={isClient ? 'claude' : ticket.executor ?? null}
          disabled={isClient}
          options={[...(isClient ? [] : [{ value: null, label: 'Any' }]), ...EXECUTORS.map((e) => ({ value: e, label: e }))]}
          onChange={(v) => void patch({ executor: v }, `Agent: ${v ?? 'any'}.`)}
        />
      </Field>
      {caps.length ? (
        <Field label="Needs">
          <Chips value={requires} options={caps.map((c) => ({ value: c.id, label: c.label, hint: c.hint }))} onChange={(v) => void patch({ requires: v }, 'Saved.')} />
        </Field>
      ) : null}
      {['approved', 'new'].includes(ticket.status) ? (
        <p className={`aw-predict aw-predict--${queued && !queued.eligible.length ? 'bad' : where.state}`}>
          <Dot state={queued && !queued.eligible.length ? 'bad' : where.state} /> {queued?.reason ?? where.text}
        </p>
      ) : null}

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
          <span className="aw-field__label">{ticket.price_cents != null ? 'Billed' : 'So far'}</span>
          <strong>{money(ticket.price_cents ?? price.totalCents)}</strong>
        </div>
        <button type="button" className="aw-link" onClick={() => setFixing(true)}>
          Correct time…
        </button>
      </div>

      <h4 className="aw-details__h">Runs</h4>
      <ul className="aw-runlist">
        {runs.length ? (
          [...runs].reverse().map((r) => (
            <li key={r.id}>
              {r.status === 'running' ? <span className="aw-live" /> : <Dot state={r.status === 'ok' ? 'ok' : 'bad'} />}
              <span>{r.executor}</span>
              <span className="aw-muted">{r.node_id ?? 'Harness'}</span>
              <span className="aw-toolbar__fill" />
              <span className="aw-muted">{usd(r.cost_micro_usd)}</span>
            </li>
          ))
        ) : (
          <li className="aw-muted">No runs yet</li>
        )}
      </ul>

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
    <Modal
      title="Correct your time"
      subtitle="The meter missed something, or counted a break. This replaces the total."
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!ok} onClick={() => onSave(Math.round(Number(minutes) * 60))}>
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
