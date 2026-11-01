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
import { usePortal, useT, href, isOpen } from './store.js';
import { attentionText, stepText } from './copy.js';
import { Files } from './Composer.jsx';
import { Button, Gauge, Icon, Modal, STEP_ICONS, StatusPill, ago, cx, fmtDate, stepOf, totalOf } from './ui.jsx';

/** Status → [headline key, explanation key], looked up with t inside the component. */
const NOW = {
  new: ['ticket.now.new.title', 'ticket.now.new.next'],
  approved: ['ticket.now.approved.title', 'ticket.now.approved.next'],
  in_progress: ['ticket.now.in_progress.title', 'ticket.now.in_progress.next'],
  review: ['ticket.now.review.title', 'ticket.now.review.next'],
  done: ['ticket.now.done.title', 'ticket.now.done.next'],
  declined: ['ticket.now.declined.title', 'ticket.now.declined.next'],
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
  const t = useT();
  const { data, reload, notify, ask } = usePortal();
  const [state, setState] = useState({ ticket: null, messages: [], error: null });
  const [deploys, setDeploys] = useState(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
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
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), every);
    return () => clearInterval(timer);
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
        <p className="cp-empty">{errorText(state.error, t)}</p>
        <p className="cp-center">
          <a href={href('requests')}>{t('ticket.backToAll')}</a>
        </p>
      </div>
    );
  }
  if (!state.ticket) return <p className="cp-empty">{t('common.loading')}</p>;

  const { ticket, messages } = state;
  const open = isOpen(ticket);
  const at = stepOf(ticket.status);
  const times = stepTimes(ticket, messages);
  const [nowKey, nextKey] = NOW[ticket.status];
  const mine = deploys?.find((d) => d.ticket_id === ticket.id);
  const where = !mine ? null : mine.id === site?.productionDeploy ? 'live' : mine.id === site?.previewDeploy ? 'preview' : 'older';

  return (
    <div className="cp-view cp-ticket">
      <header className="cp-ticket__head">
        <nav className="cp-crumbs">
          <a href={href('requests')}>{t('ticket.crumbs.requests')}</a>
          {project ? <a href={href(`project/${project.id}`)}>{project.name}</a> : null}
          <span>#{ticket.id}</span>
        </nav>
        <h1>{ticket.title}</h1>
        <div className="cp-ticket__meta">
          <StatusPill status={ticket.status} />
          <span>{attentionName(t, ticket.attention)}</span>
          <span>{t('ticket.filed', { date: fmtDate(ticket.created_at) })}</span>
          {ticket.kind === 'intake' ? <span>{t('ticket.setupAssistant')}</span> : null}
          {ticket.worked_by === 'client_agent' && ticket.kind !== 'intake' ? <span>{t('ticket.builtByAssistant')}</span> : null}
        </div>
      </header>

      <section className={cx('cp-progress', ticket.status === 'declined' && 'is-declined')} aria-label={t('ticket.progress.label')}>
        <ol className="cp-steps">
          {STEPS.map((step, i) => {
            const s = ticket.status === 'declined' ? (i === 0 ? 'done' : 'ahead') : i < at ? 'done' : i === at ? 'now' : 'ahead';
            return (
              <li key={step.key} className={`cp-step is-${s}`} aria-current={s === 'now' ? 'step' : undefined}>
                <span className="cp-step__icon">
                  <Icon name={STEP_ICONS[i]} size={20} />
                </span>
                <span className="cp-step__name">{stepText(t, step, 'title')}</span>
                <span className="cp-step__time">{times[i] && s !== 'ahead' ? fmtDate(times[i]) : s === 'now' ? t('ticket.step.now') : ''}</span>
              </li>
            );
          })}
        </ol>
        <div className="cp-progress__now" role="status">
          <div>
            <strong>{t(nowKey)}</strong>
            <p>{t(nextKey)}</p>
          </div>
          {site && ticket.status === 'review' ? (
            <Button kind="primary" href={site.feedbackUrl || site.previewUrl} target="_blank" rel="noopener">
              {t('ticket.preview.open')} <Icon name="ext" size={14} />
            </Button>
          ) : site && ticket.status === 'done' && where === 'live' ? (
            <Button href={site.productionUrl} target="_blank" rel="noopener">
              {t('ticket.live.see')} <Icon name="ext" size={14} />
            </Button>
          ) : null}
        </div>
      </section>

      <div className="cp-ticket__cols">
        <div className="cp-ticket__main">
          <h2 className="cp-h2">{t('ticket.conversation')}</h2>
          <Thread ticketId={ticket.id} messages={messages} intake={ticket.kind === 'intake'} />
          <Reply ticketId={ticket.id} onSent={load} reopen={ticket.status === 'done' || ticket.status === 'declined'} />
        </div>

        <aside className="cp-ticket__side">
          <section className="cp-card">
            <h3 className="cp-label">{ticket.price_cents !== null ? t('ticket.cost.total') : t('ticket.cost.soFar')}</h3>
            <Cost ticket={ticket} />
            <Gauge ticket={ticket} />
            {open ? (
              <Button size="sm" onClick={() => setBudgetOpen(true)}>
                {ticket.budget_cents === null ? t('ticket.budget.set') : t('ticket.budget.change')}
              </Button>
            ) : null}
          </section>

          {site ? (
            <section className="cp-card">
              <h3 className="cp-label">{t('ticket.site.title')}</h3>
              <p className="cp-side__line">
                {where === 'live'
                  ? t('ticket.site.live')
                  : where === 'preview'
                    ? t('ticket.site.onPreview')
                    : where === 'older'
                      ? t('ticket.site.older')
                      : ticket.status === 'done'
                        ? t('ticket.site.doneNotLive')
                        : t('ticket.site.pending')}
              </p>
              <div className="cp-links">
                <a href={site.feedbackUrl || site.previewUrl} target="_blank" rel="noopener">
                  <Icon name="ext" size={13} /> {t('ticket.site.previewLink')}
                </a>
                <a href={site.productionUrl} target="_blank" rel="noopener">
                  <Icon name="globe" size={13} /> {t('ticket.site.liveLink')}
                </a>
              </div>
              {where === 'preview' && data.canPublish ? (
                <Button
                  size="sm"
                  kind="primary"
                  onClick={() =>
                    ask({
                      title: t('ticket.publish.title', { name: project.name }),
                      text: t('ticket.publish.text', { preview: site.previewUrl, live: site.productionUrl }),
                      confirm: t('ticket.publish.confirm'),
                      run: async () => {
                        await api(`/portal/projects/${project.id}/site/publish`, { method: 'POST', body: {} });
                        notify(t('ticket.publish.done'));
                        await reload();
                      },
                    })
                  }
                >
                  {t('ticket.publish.button')}
                </Button>
              ) : null}
            </section>
          ) : null}

          <section className="cp-card">
            <h3 className="cp-label">{t('ticket.details.title')}</h3>
            <dl className="cp-dl">
              <dt>{t('ticket.details.project')}</dt>
              <dd>
                {project ? <a href={href(`project/${project.id}`)}>{project.name}</a> : t('ticket.details.none')}{' '}
                {data.projects.length ? (
                  <button type="button" className="cp-linkbtn" onClick={() => setMoveOpen(true)}>
                    {t('ticket.details.move')}
                  </button>
                ) : null}
              </dd>
              <dt>{t('ticket.details.site')}</dt>
              <dd>{project?.sites?.find((s) => s.id === ticket.site_id)?.name || t('ticket.details.mainSite')}</dd>
              <dt>{t('ticket.details.attention')}</dt>
              <dd>{attentionName(t, ticket.attention)}</dd>
              <dt>{t('ticket.details.filed')}</dt>
              <dd>{fmtDate(ticket.created_at)}</dd>
              <dt>{t('ticket.details.lastChange')}</dt>
              <dd>{ago(ticket.updated_at)}</dd>
            </dl>
          </section>

          {ticket.status === 'new' ? (
            <Button
              kind="ghost"
              className="cp-side__withdraw"
              onClick={() =>
                ask({
                  title: t('ticket.withdraw.title'),
                  text: t('ticket.withdraw.text'),
                  confirm: t('ticket.withdraw.confirm'),
                  cancel: t('ticket.withdraw.cancel'),
                  danger: true,
                  run: async () => {
                    await api(`/portal/tickets/${ticket.id}/withdraw`, { method: 'POST' });
                    await Promise.all([load(), reload()]);
                  },
                })
              }
            >
              {t('ticket.withdraw.button')}
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
            notify(t('ticket.budget.saved'));
            await Promise.all([load(), reload()]);
          }}
        />
      ) : null}
      {moveOpen ? (
        <MoveDialog
          ticket={ticket}
          projects={data.projects}
          onClose={() => setMoveOpen(false)}
          onSaved={async () => {
            setMoveOpen(false);
            notify(t('ticket.move.done'));
            await Promise.all([load(), reload()]);
          }}
        />
      ) : null}
    </div>
  );
}

function Cost({ ticket }) {
  const t = useT();
  const p = priceOf({ humanSeconds: ticket.human_seconds, aiMicroUsd: ticket.ai_micro_usd });
  return (
    <div className="cp-cost">
      <p className="cp-cost__total">{money(totalOf(ticket))}</p>
      <p className="cp-cost__parts">
        <span>
          {t('ticket.cost.time', { time: clock(ticket.human_seconds) })} <b>{money(p.timeCents)}</b>
        </span>
        <span>
          {t('ticket.cost.ai')} <b>{money(p.aiCents)}</b>
        </span>
      </p>
    </div>
  );
}

/** An attention level's name in the reader's language, from its key. */
function attentionName(t, key) {
  const level = ATTENTION.find((a) => a.key === key);
  return level ? attentionText(t, level, 'name') : undefined;
}

const WHO = { client: 'thread.you', ali: 'thread.ali', runner: 'thread.log' };

const STATUS_BY_LABEL = new Map(Object.entries(STATUS_LABEL).map(([key, label]) => [label, key]));

/**
 * A system line in the reader's language. The Worker writes these from fixed
 * English templates (and stepTimes reads them), so they are matched here
 * rather than machine-translated; anything unknown shows as written.
 */
export function systemLine(body, t) {
  const status = /^Status changed to “([^”]+)”\.?(?: Total: (.+?)\.?)?$/.exec(body);
  if (status) {
    const key = STATUS_BY_LABEL.get(status[1]);
    const moved = t('thread.movedTo', { status: key ? t(`status.${key}`) : status[1] });
    return status[2] ? `${moved} · ${t('thread.total', { bill: status[2] })}` : moved;
  }
  const preview = /^The preview has this change(?:: (\S+?))?\. Nothing is live until it is published\.$/.exec(body);
  if (preview) return preview[1] ? t('thread.preview', { url: preview[1] }) : t('thread.previewNoUrl');
  if (body === 'The client withdrew this request.') return t('thread.withdrew');
  const change = /^Your agent sent a change for this request \((\d+) file\(s\)\)\.$/.exec(body);
  if (change) return t('thread.agentChange', { n: Number(change[1]) });
  return body;
}

/** A message body; a machine-translated one can be switched to what was written. */
function MessageBody({ m }) {
  const t = useT();
  const [original, setOriginal] = useState(false);
  if (!m.body) return null;
  if (m.original === undefined) return <p className="cp-msg__body">{m.body}</p>;
  return (
    <>
      <p className="cp-msg__body" lang={original ? m.translatedFrom ?? undefined : t.locale}>
        {original ? m.original : m.body}
      </p>
      <p className="cp-msg__tr">
        <span>{t('thread.translated')}</span>
        <button type="button" onClick={() => setOriginal((o) => !o)}>
          {original ? t('thread.showTranslation') : t('thread.showOriginal')}
        </button>
      </p>
    </>
  );
}

/** The conversation; status changes read as small events between messages. */
function Thread({ ticketId, messages, intake = false }) {
  const t = useT();
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
            <span>{systemLine(m.body, t)}</span>
            <time>{fmtDate(m.created_at)}</time>
          </li>
        ) : (
          <li key={m.id} className={`cp-msg cp-msg--${m.author}`}>
            <span className="cp-msg__avatar" aria-hidden="true">
              {m.author === 'ali' ? 'A' : m.author === 'runner' ? '⚙' : 'Y'}
            </span>
            <div className="cp-msg__box">
              <p className="cp-msg__who">
                <strong>
                  {m.author === 'runner' && intake ? t('thread.assistant') : WHO[m.author] ? t(WHO[m.author]) : m.author}
                </strong>
                <time>{fmtDate(m.created_at)}</time>
              </p>
              <MessageBody m={m} />
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
  const t = useT();
  const { data } = usePortal();
  const translating = data.user?.locale && data.user.locale !== 'en-US' && data.user.translation !== 'off';
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [note, setNote] = useState({ text: '', error: false });
  const [sending, setSending] = useState(false);

  const send = async () => {
    const problem = files.length ? checkPicked(files) : text.trim() ? null : t('reply.empty');
    if (problem) return setNote({ text: problem, error: true });
    setSending(true);
    setNote({ text: files.length ? t('reply.uploading') : t('common.sending'), error: false });
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
      setNote({ text: errorText(e, t), error: true });
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
        placeholder={reopen ? t('reply.placeholderReopen') : t('reply.placeholder')}
        aria-label={t('reply.label')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && send()}
      />
      <div className="cp-reply__bar">
        <Files files={files} setFiles={setFiles} compact />
        <span className={cx('cp-reply__note', note.error && 'is-error')} role="status">
          {note.text || (translating ? t('reply.anyLanguage') : '')}
        </span>
        <Button kind="primary" disabled={sending} onClick={send}>
          {t('reply.send')} <kbd>⌘↵</kbd>
        </Button>
      </div>
    </div>
  );
}

function BudgetDialog({ ticket, onClose, onSaved }) {
  const t = useT();
  const [value, setValue] = useState(ticket.budget_cents === null ? '' : String(ticket.budget_cents / 100));
  const [error, setError] = useState('');
  const save = async () => {
    const raw = value.trim();
    const dollars = raw === '' ? null : Number(raw);
    if (dollars !== null && !(Number.isInteger(dollars) && dollars >= 1 && dollars <= 10000)) return setError(t('ticket.budget.invalid'));
    try {
      await api(`/portal/tickets/${ticket.id}/budget`, { method: 'PATCH', body: { budgetCents: dollars === null ? null : dollars * 100 } });
      await onSaved();
    } catch (e) {
      setError(errorText(e, t));
    }
  };
  return (
    <Modal
      title={t('ticket.budget.title')}
      subtitle={t('ticket.budget.subtitle')}
      onClose={onClose}
      actions={
        <>
          <p className="cp-modal__err" role="alert">
            {error}
          </p>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button kind="primary" onClick={save}>
            {t('ticket.budget.save')}
          </Button>
        </>
      }
    >
      <label className="cp-field">
        <span className="cp-label">{t('ticket.budget.label')}</span>
        <input type="number" min="1" max="10000" step="1" inputMode="numeric" placeholder={t('ticket.budget.placeholder')} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <span className="cp-hint">{t('ticket.budget.hint', { amount: money(totalOf(ticket)) })}</span>
      </label>
    </Modal>
  );
}


/** Move a request to another project (and optionally one of its sites). */
function MoveDialog({ ticket, projects, onClose, onSaved }) {
  const t = useT();
  const [projectId, setProjectId] = useState(ticket.project_id || projects[0]?.id || '');
  const [siteId, setSiteId] = useState(ticket.site_id || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const project = projects.find((p) => p.id === projectId);
  const sites = project?.sites ?? [];
  const running = ticket.status === 'in_progress';
  const save = async () => {
    if (!projectId || running) return;
    setBusy(true);
    setError('');
    try {
      await api(`/portal/tickets/${ticket.id}`, {
        method: 'PATCH',
        body: { projectId, siteId: siteId || null },
      });
      await onSaved();
    } catch (e) {
      setError(errorText(e, t));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('ticket.move.title')}
      subtitle={t('ticket.move.subtitle')}
      onClose={onClose}
      actions={
        <>
          <p className="cp-modal__err" role="alert">
            {error}
          </p>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button kind="primary" disabled={busy || running || !projectId} onClick={() => void save()}>
            {t('ticket.move.confirm')}
          </Button>
        </>
      }
    >
      {running ? (
        <p className="cp-warn">{t('ticket.move.running')}</p>
      ) : projects.length ? (
        <div className="cp-site-form">
          <label className="cp-label" htmlFor="move-project">
            {t('ticket.move.project')}
          </label>
          <select
            id="move-project"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setSiteId('');
            }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label className="cp-label" htmlFor="move-site">
            {t('ticket.move.site')}
          </label>
          <select id="move-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">{t('ticket.move.noSite')}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.slug}
              </option>
            ))}
          </select>
          <p className="cp-hint">{t('ticket.move.approval')}</p>
        </div>
      ) : (
        <p className="cp-hint">
          {t('ticket.move.noProjects')} <a href="/portal/start">{t('ticket.move.addProject')}</a>
        </p>
      )}
    </Modal>
  );
}
