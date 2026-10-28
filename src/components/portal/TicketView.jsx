/*
 * One request: where it is (four steps with when each happened, and what the
 * client can do now), the conversation, and on the side what it costs, where
 * its result can be seen, and the actions it allows.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, downloadFile, errorText, STATUS_LABEL } from '../../lib/portal';
import { STEPS } from '../../lib/offer.js';
import { checkPicked, sizeText } from '../../lib/attachments.js';
import { ATTENTION, clock, money, priceOf } from '../../lib/pricing.js';
import { usePortal, href, isOpen } from './store.js';
import { Files } from './Composer.jsx';
import { Button, Gauge, Icon, Modal, STEP_ICONS, StatusPill, ago, cx, fmtDate, stepOf, totalOf } from './ui.jsx';

const NOW = {
  new: ['Waiting for Ali to read it', 'Nothing starts until he approves it. Add details or files while you wait, or withdraw it at no cost.'],
  approved: ['Approved, and queued for an agent', 'It starts as soon as a machine is free. Details you add now reach the agent before it starts.'],
  in_progress: ['An agent is building it', 'It works on a sealed copy of your project; nothing live is touched. Replies you send now are read before it ships.'],
  review: ['Ali is checking the result', 'He writes here when it is ready, or asks you something.'],
  done: ['Done and shipped', 'Something to add? Reply below and it opens again.'],
  declined: ['Ali declined this request', 'The reason is in the conversation. Reply if something was misunderstood.'],
};

/** When the ticket entered each step, from the thread's status lines. */
function stepTimes(ticket, messages) {
  const times = [ticket.created_at, null, null, null];
  const byLabel = new Map(Object.entries(STATUS_LABEL).map(([status, label]) => [label, status]));
  for (const m of messages) {
    if (m.author !== 'system') continue;
    const status = byLabel.get(/Status changed to “([^”]+)”/.exec(m.body)?.[1]);
    if (!status || status === 'new' || status === 'declined') continue;
    // The latest pass through a step is the one that counts (a re-run goes back).
    times[Math.min(3, stepOf(status))] = m.created_at;
  }
  return times;
}

export function TicketView({ id }) {
  const { data, reload, notify, ask } = usePortal();
  const [state, setState] = useState({ ticket: null, messages: [], error: null });
  const [deploys, setDeploys] = useState(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const project = data.projects.find((p) => p.id === state.ticket?.project_id);
  const site = project?.site?.state === 'ready' ? project.site : null;

  const load = useCallback(async () => {
    try {
      const out = await api(`/portal/tickets/${id}`);
      setState({ ...out, error: null });
    } catch (error) {
      setState((s) => ({ ...s, error }));
    }
  }, [id]);

  useEffect(() => {
    setState({ ticket: null, messages: [], error: null });
    void load();
  }, [load]);

  // Status changes and Ali's replies arrive without a reload: every 10s while
  // the request is moving, every 30s otherwise.
  const status = state.ticket?.status;
  useEffect(() => {
    if (!status) return undefined;
    const every = ['approved', 'in_progress', 'review'].includes(status) ? 10_000 : 30_000;
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), every);
    return () => clearInterval(t);
  }, [status, load]);

  // Which deploy carries this request's work, so the side can say if it is live.
  const siteProject = site ? project.id : null;
  useEffect(() => {
    if (!siteProject) return void setDeploys(null);
    api(`/portal/projects/${siteProject}/site/deploys`)
      .then(({ deploys }) => setDeploys(deploys))
      .catch(() => setDeploys(null));
  }, [siteProject, status]);

  if (state.error && !state.ticket) {
    return (
      <div className="cp-view">
        <p className="cp-empty">{errorText(state.error)}</p>
        <p className="cp-center">
          <a href={href('requests')}>← All requests</a>
        </p>
      </div>
    );
  }
  if (!state.ticket) return <p className="cp-empty">Loading…</p>;

  const { ticket, messages } = state;
  const open = isOpen(ticket);
  const at = stepOf(ticket.status);
  const times = stepTimes(ticket, messages);
  const [now, next] = NOW[ticket.status];
  const mine = deploys?.find((d) => d.ticket_id === ticket.id);
  const where = !mine ? null : mine.id === site?.productionDeploy ? 'live' : mine.id === site?.previewDeploy ? 'preview' : 'older';

  return (
    <div className="cp-view cp-ticket">
      <header className="cp-ticket__head">
        <nav className="cp-crumbs">
          <a href={href('requests')}>Requests</a>
          {project ? <a href={href(`project/${project.id}`)}>{project.name}</a> : null}
          <span>#{ticket.id}</span>
        </nav>
        <h1>{ticket.title}</h1>
        <div className="cp-ticket__meta">
          <StatusPill status={ticket.status} />
          <span>{ATTENTION.find((a) => a.key === ticket.attention)?.name}</span>
          <span>filed {fmtDate(ticket.created_at)}</span>
          {ticket.worked_by === 'client_agent' ? <span>built by your assistant</span> : null}
        </div>
      </header>

      <section className={cx('cp-progress', ticket.status === 'declined' && 'is-declined')} aria-label="Where your request is">
        <ol className="cp-steps">
          {STEPS.map((step, i) => {
            const s = ticket.status === 'declined' ? (i === 0 ? 'done' : 'ahead') : i < at ? 'done' : i === at ? 'now' : 'ahead';
            return (
              <li key={step.key} className={`cp-step is-${s}`} aria-current={s === 'now' ? 'step' : undefined}>
                <span className="cp-step__icon">
                  <Icon name={STEP_ICONS[i]} size={20} />
                </span>
                <span className="cp-step__name">{step.title}</span>
                <span className="cp-step__time">{times[i] && s !== 'ahead' ? fmtDate(times[i]) : s === 'now' ? 'now' : ''}</span>
              </li>
            );
          })}
        </ol>
        <div className="cp-progress__now" role="status">
          <div>
            <strong>{now}</strong>
            <p>{next}</p>
          </div>
          {site && ticket.status === 'review' ? (
            <Button kind="primary" href={site.previewUrl} target="_blank" rel="noopener">
              Open the preview <Icon name="ext" size={14} />
            </Button>
          ) : site && ticket.status === 'done' && where === 'live' ? (
            <Button href={site.productionUrl} target="_blank" rel="noopener">
              See it live <Icon name="ext" size={14} />
            </Button>
          ) : null}
        </div>
      </section>

      <div className="cp-ticket__cols">
        <div className="cp-ticket__main">
          <h2 className="cp-h2">Conversation</h2>
          <Thread ticketId={ticket.id} messages={messages} />
          <Reply ticketId={ticket.id} onSent={load} reopen={ticket.status === 'done' || ticket.status === 'declined'} />
        </div>

        <aside className="cp-ticket__side">
          <section className="cp-card">
            <h3 className="cp-label">{ticket.price_cents !== null ? 'Total' : 'Cost so far'}</h3>
            <Cost ticket={ticket} />
            <Gauge ticket={ticket} />
            {open ? (
              <Button size="sm" onClick={() => setBudgetOpen(true)}>
                {ticket.budget_cents === null ? 'Set a budget' : 'Change the budget'}
              </Button>
            ) : null}
          </section>

          {site ? (
            <section className="cp-card">
              <h3 className="cp-label">The site</h3>
              <p className="cp-side__line">
                {where === 'live'
                  ? 'This request is live.'
                  : where === 'preview'
                    ? 'This request is on the preview, not live yet.'
                    : where === 'older'
                      ? 'This request was built; newer changes came after it.'
                      : ticket.status === 'done'
                        ? 'Changes land on the preview first.'
                        : 'When it is built, it lands on the preview first.'}
              </p>
              <div className="cp-links">
                <a href={site.previewUrl} target="_blank" rel="noopener">
                  <Icon name="ext" size={13} /> Preview
                </a>
                <a href={site.productionUrl} target="_blank" rel="noopener">
                  <Icon name="globe" size={13} /> Live site
                </a>
              </div>
              {where === 'preview' && data.canPublish ? (
                <Button
                  size="sm"
                  kind="primary"
                  onClick={() =>
                    ask({
                      title: `Publish ${project.name}?`,
                      text: `What you see at ${site.previewUrl} becomes the live site at ${site.productionUrl}.`,
                      confirm: 'Publish',
                      run: async () => {
                        await api(`/portal/projects/${project.id}/site/publish`, { method: 'POST', body: {} });
                        notify('Published. The live site has the new version.');
                        await reload();
                      },
                    })
                  }
                >
                  Publish to live
                </Button>
              ) : null}
            </section>
          ) : null}

          <section className="cp-card">
            <h3 className="cp-label">Details</h3>
            <dl className="cp-dl">
              <dt>Project</dt>
              <dd>{project ? <a href={href(`project/${project.id}`)}>{project.name}</a> : 'None yet'}</dd>
              <dt>Attention</dt>
              <dd>{ATTENTION.find((a) => a.key === ticket.attention)?.name}</dd>
              <dt>Filed</dt>
              <dd>{fmtDate(ticket.created_at)}</dd>
              <dt>Last change</dt>
              <dd>{ago(ticket.updated_at)}</dd>
            </dl>
          </section>

          {ticket.status === 'new' ? (
            <Button
              kind="ghost"
              className="cp-side__withdraw"
              onClick={() =>
                ask({
                  title: 'Withdraw this request?',
                  text: 'Ali has not started on it, so it costs nothing. It closes, and he is told.',
                  confirm: 'Withdraw',
                  cancel: 'Keep it',
                  danger: true,
                  run: async () => {
                    await api(`/portal/tickets/${ticket.id}/withdraw`, { method: 'POST' });
                    await Promise.all([load(), reload()]);
                  },
                })
              }
            >
              Withdraw request
            </Button>
          ) : null}
        </aside>
      </div>

      {budgetOpen ? (
        <BudgetDialog
          ticket={ticket}
          onClose={() => setBudgetOpen(false)}
          onSaved={async () => {
            setBudgetOpen(false);
            notify('Budget saved.');
            await Promise.all([load(), reload()]);
          }}
        />
      ) : null}
    </div>
  );
}

function Cost({ ticket }) {
  const p = priceOf({ humanSeconds: ticket.human_seconds, aiMicroUsd: ticket.ai_micro_usd });
  return (
    <div className="cp-cost">
      <p className="cp-cost__total">{money(totalOf(ticket))}</p>
      <p className="cp-cost__parts">
        <span>
          {clock(ticket.human_seconds)} of Ali's time <b>{money(p.timeCents)}</b>
        </span>
        <span>
          AI at cost <b>{money(p.aiCents)}</b>
        </span>
      </p>
    </div>
  );
}

const WHO = { client: 'You', ali: 'Ali', runner: 'Work log' };

/** The conversation; status changes read as small events between messages. */
function Thread({ ticketId, messages }) {
  const end = useRef(null);
  const count = useRef(messages.length);
  useEffect(() => {
    if (messages.length > count.current) end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    count.current = messages.length;
  }, [messages.length]);
  return (
    <ol className="cp-thread">
      {messages.map((m) =>
        m.author === 'system' ? (
          <li key={m.id} className="cp-event">
            <span className="cp-event__dot" />
            <span>{m.body.replace(/^Status changed to “([^”]+)”\.?/, 'Moved to $1')}</span>
            <time>{fmtDate(m.created_at)}</time>
          </li>
        ) : (
          <li key={m.id} className={`cp-msg cp-msg--${m.author}`}>
            <span className="cp-msg__avatar" aria-hidden="true">
              {m.author === 'ali' ? 'A' : m.author === 'runner' ? '⚙' : 'Y'}
            </span>
            <div className="cp-msg__box">
              <p className="cp-msg__who">
                <strong>{WHO[m.author] ?? m.author}</strong>
                <time>{fmtDate(m.created_at)}</time>
              </p>
              {m.body ? <p className="cp-msg__body">{m.body}</p> : null}
              {m.files?.length ? (
                <ul className="cp-files">
                  {m.files.map((f) => (
                    <li key={f.id}>
                      <button type="button" onClick={(e) => download(e.currentTarget, `/portal/tickets/${ticketId}/files/${f.id}`, f.name)}>
                        <Icon name="clip" size={13} /> {f.name} <span>{sizeText(f.size)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        ),
      )}
      <li ref={end} aria-hidden="true" />
    </ol>
  );
}

function download(button, path, name) {
  button.disabled = true;
  downloadFile(path, name)
    .catch((e) => (button.title = errorText(e)))
    .finally(() => (button.disabled = false));
}

function Reply({ ticketId, onSent, reopen }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [note, setNote] = useState({ text: '', error: false });
  const [sending, setSending] = useState(false);

  const send = async () => {
    const problem = files.length ? checkPicked(files) : text.trim() ? null : 'Write something, or attach a file.';
    if (problem) return setNote({ text: problem, error: true });
    setSending(true);
    setNote({ text: files.length ? 'Uploading…' : 'Sending…', error: false });
    try {
      if (files.length) {
        const form = new FormData();
        form.append('body', text.trim());
        for (const f of files) form.append('files', f);
        await api(`/portal/tickets/${ticketId}/messages`, { form });
      } else {
        await api(`/portal/tickets/${ticketId}/messages`, { body: { body: text.trim() } });
      }
      setText('');
      setFiles([]);
      setNote({ text: '', error: false });
      await onSent();
    } catch (e) {
      setNote({ text: errorText(e), error: true });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="cp-reply">
      <textarea
        rows={4}
        maxLength={8000}
        value={text}
        placeholder={reopen ? 'Something to add? Writing here opens it again.' : 'Write to Ali…'}
        aria-label="Reply"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && send()}
      />
      <div className="cp-reply__bar">
        <Files files={files} setFiles={setFiles} compact />
        <span className={cx('cp-reply__note', note.error && 'is-error')} role="status">
          {note.text}
        </span>
        <Button kind="primary" disabled={sending} onClick={send}>
          Send <kbd>⌘↵</kbd>
        </Button>
      </div>
    </div>
  );
}

function BudgetDialog({ ticket, onClose, onSaved }) {
  const [value, setValue] = useState(ticket.budget_cents === null ? '' : String(ticket.budget_cents / 100));
  const [error, setError] = useState('');
  const save = async () => {
    const raw = value.trim();
    const dollars = raw === '' ? null : Number(raw);
    if (dollars !== null && !(Number.isInteger(dollars) && dollars >= 1 && dollars <= 10000)) return setError('A whole number of dollars, from 1 to 10,000.');
    try {
      await api(`/portal/tickets/${ticket.id}/budget`, { method: 'PATCH', body: { budgetCents: dollars === null ? null : dollars * 100 } });
      await onSaved();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Modal
      title="Budget for this request"
      subtitle="Work pauses when the cost reaches it, until you or Ali raise it."
      onClose={onClose}
      actions={
        <>
          <p className="cp-modal__err" role="alert">
            {error}
          </p>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" onClick={save}>
            Save budget
          </Button>
        </>
      }
    >
      <label className="cp-field">
        <span className="cp-label">Budget in USD</span>
        <input type="number" min="1" max="10000" step="1" inputMode="numeric" placeholder="No limit" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <span className="cp-hint">Leave it empty for no limit. So far: {money(totalOf(ticket))}.</span>
      </label>
    </Modal>
  );
}
