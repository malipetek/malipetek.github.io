/* Needs you, the board, and the list: three ways to look at the same tickets. */
import { useEffect, useMemo, useState } from 'react';
import { useAdmin } from './store.js';
import { STATUSES, STATUS_HINT, STATUS_LABEL, ago, listOf, money, needsYou, priceOf, priorityName, usd } from './format.js';
import { Button, Dot, Icon, Segmented, StatusPill, Tag, cx } from './ui.jsx';

/** Filter bar shared by the board and the list. */
function useFilters() {
  const { api, boardProject, setBoardProject } = useAdmin();
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  // Thread text lives on the server; ask it once typing pauses.
  const [hits, setHits] = useState(new Map());
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 3) return void setHits(new Map());
    let live = true;
    const timer = setTimeout(() => {
      api('GET', `/admin/search?q=${encodeURIComponent(needle)}`)
        .then((r) => live && setHits(new Map((r.hits ?? []).map((h) => [h.id, h.snippet]))))
        .catch(() => undefined);
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, q]);
  const apply = (tickets) => {
    const needle = q.trim().toLowerCase();
    return tickets.filter(
      (t) =>
        (boardProject === 'all' || t.project_id === boardProject) &&
        (kind === 'all' || (kind === 'system' ? t.kind === 'system' : t.kind !== 'system')) &&
        (!needle || hits.has(t.id) || `#${t.id} ${t.title} ${t.client_email ?? ''} ${t.project_name ?? ''}`.toLowerCase().includes(needle)),
    );
  };
  return { boardProject, setBoardProject, kind, setKind, q, setQ, apply, hits };
}

function FilterBar({ f, extra }) {
  const { data, setModal } = useAdmin();
  return (
    <div className="aw-toolbar">
      <select value={f.boardProject} onChange={(e) => f.setBoardProject(e.target.value)} aria-label="Project">
        <option value="all">All projects</option>
        {data.projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <Segmented
        value={f.kind}
        options={[
          { value: 'all', label: 'All' },
          { value: 'client', label: 'Client' },
          { value: 'system', label: 'Mine' },
        ]}
        onChange={f.setKind}
      />
      <input className="aw-search" value={f.q} placeholder="Filter, or search threads…" onChange={(e) => f.setQ(e.target.value)} />
      <span className="aw-toolbar__fill" />
      {extra}
      <Button kind="primary" size="sm" onClick={() => setModal({ kind: 'task', projectId: f.boardProject === 'all' ? undefined : f.boardProject })}>
        <Icon name="plus" size={14} /> New task
      </Button>
    </div>
  );
}

export function TicketCard({ t, draggable }) {
  const { data, openTicket } = useAdmin();
  const run = data.running.find((r) => r.ticket_id === t.id);
  const queued = data.queue.find((q) => q.id === t.id);
  const cost = priceOf({ humanSeconds: t.human_seconds ?? 0, aiMicroUsd: t.ai_micro_usd ?? 0 }).totalCents;
  return (
    <article
      className={cx('aw-card', run && 'is-running', queued && !queued.eligible.length && 'is-stuck')}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/x-ticket', String(t.id));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => openTicket(t.id)}
      onKeyDown={(e) => e.key === 'Enter' && openTicket(t.id)}
      tabIndex={0}
    >
      <div className="aw-card__top">
        <span className="aw-card__id">#{t.id}</span>
        {t.kind === 'system' ? <Tag tone="dash">mine</Tag> : <Tag tone="client">client</Tag>}
        {(t.priority ?? 0) > 0 ? <Tag tone="hot">{priorityName(t.priority)}</Tag> : null}
        {t.client_waiting_since && t.status !== 'new' ? <Tag tone="warn">awaiting reply</Tag> : null}
        <span className="aw-card__age">{ago(t.updated_at)}</span>
      </div>
      <h4>{t.title}</h4>
      <div className="aw-card__meta">
        <span>{t.project_name ?? 'no project'}</span>
        {t.kind !== 'system' && t.client_email ? <span>{t.client_email}</span> : null}
      </div>
      <div className="aw-card__foot">
        {run ? (
          <span className="aw-running">
            <span className="aw-live" /> {run.executor} on {run.node_id ?? 'Harness'}
          </span>
        ) : t.executor ? (
          <Tag>{t.executor}</Tag>
        ) : null}
        {listOf(t.requires).map((r) => (
          <Tag key={r} tone="dash">
            {r}
          </Tag>
        ))}
        <span className="aw-toolbar__fill" />
        {cost ? <span className="aw-muted">{money(cost)}</span> : null}
      </div>
      {queued && !queued.eligible.length ? <p className="aw-card__warn">{queued.reason}</p> : null}
    </article>
  );
}

export function BoardView() {
  const { data, setStatus } = useAdmin();
  const f = useFilters();
  const [showClosed, setShowClosed] = useState(false);
  const [over, setOver] = useState(null);
  const tickets = f.apply(data.tickets);
  const columns = showClosed ? STATUSES : STATUSES.filter((s) => s !== 'declined');
  const byId = new Map(data.tickets.map((t) => [t.id, t]));
  return (
    <div className="aw-view aw-view--board">
      <FilterBar f={f} extra={<Segmented value={showClosed} options={[{ value: false, label: 'Open' }, { value: true, label: '+ Declined' }]} onChange={setShowClosed} />} />
      <div className="aw-board">
        {columns.map((s) => {
          let items = tickets.filter((t) => t.status === s);
          const more = s === 'done' && items.length > 25 ? items.length - 25 : 0;
          if (more) items = items.slice(0, 25);
          return (
            <section
              key={s}
              className={cx('aw-col', over === s && 'is-over')}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(s);
              }}
              onDragLeave={() => setOver((o) => (o === s ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const t = byId.get(Number(e.dataTransfer.getData('text/x-ticket')));
                if (t) void setStatus(t, s);
              }}
            >
              <header title={STATUS_HINT[s]}>
                <span className={`aw-sq aw-sq--${s}`} />
                {STATUS_LABEL[s]}
                <span className="aw-count">{tickets.filter((t) => t.status === s).length}</span>
              </header>
              <div className="aw-col__body">
                {items.map((t) => (
                  <TicketCard key={t.id} t={t} draggable />
                ))}
                {more ? <p className="aw-muted aw-center">+{more} older</p> : null}
                {!items.length ? <p className="aw-col__empty">{STATUS_HINT[s]}</p> : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const COLUMNS = [
  { key: 'id', label: '#', get: (t) => t.id },
  { key: 'title', label: 'Title', get: (t) => t.title.toLowerCase() },
  { key: 'status', label: 'Status', get: (t) => STATUSES.indexOf(t.status) },
  { key: 'project', label: 'Project', get: (t) => t.project_name ?? '' },
  { key: 'who', label: 'For', get: (t) => (t.kind === 'system' ? '' : t.client_email ?? '') },
  { key: 'priority', label: 'Priority', get: (t) => t.priority ?? 0 },
  { key: 'agent', label: 'Agent', get: (t) => t.executor ?? '' },
  { key: 'cost', label: 'Cost', get: (t) => priceOf({ humanSeconds: t.human_seconds ?? 0, aiMicroUsd: t.ai_micro_usd ?? 0 }).totalCents },
  { key: 'updated', label: 'Updated', get: (t) => t.updated_at },
];

export function ListView() {
  const { data, openTicket } = useAdmin();
  const f = useFilters();
  const [status, setStatusFilter] = useState('open');
  const [sort, setSort] = useState({ key: 'updated', dir: -1 });
  const rows = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key);
    return f
      .apply(data.tickets)
      .filter((t) => status === 'all' || (status === 'open' ? !['done', 'declined'].includes(t.status) : t.status === status))
      .sort((a, b) => (col.get(a) > col.get(b) ? 1 : col.get(a) < col.get(b) ? -1 : 0) * sort.dir);
  }, [data.tickets, f, status, sort]);
  return (
    <div className="aw-view">
      <FilterBar
        f={f}
        extra={
          <select value={status} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="open">Open</option>
            <option value="all">Everything</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        }
      />
      <div className="aw-tablewrap">
        <table className="aw-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : 1 }))} aria-sort={sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
                  {c.label}
                  {sort.key === c.key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} onClick={() => openTicket(t.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openTicket(t.id)}>
                <td className="aw-mono">#{t.id}</td>
                <td className="aw-table__title">
                  {t.title}
                  {f.hits.get(t.id) ? <small className="aw-muted aw-snippet">{f.hits.get(t.id)}</small> : null}
                </td>
                <td>
                  <StatusPill status={t.status} />
                </td>
                <td>{t.project_name ?? '—'}</td>
                <td>{t.kind === 'system' ? <Tag tone="dash">mine</Tag> : t.client_email}</td>
                <td>{priorityName(t.priority ?? 0)}</td>
                <td>{t.executor ?? (t.kind === 'system' ? 'any' : 'claude')}</td>
                <td>{money(priceOf({ humanSeconds: t.human_seconds ?? 0, aiMicroUsd: t.ai_micro_usd ?? 0 }).totalCents)}</td>
                <td className="aw-muted">{ago(t.updated_at)} ago</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? <p className="aw-empty">Nothing matches.</p> : null}
      </div>
    </div>
  );
}

export function InboxView() {
  const { data, open, openTicket, setStatus, api, act, reload } = useAdmin();
  const n = needsYou(data);
  const answered = (t) => act(() => api('POST', `/admin/tickets/${t.id}/answered`), `#${t.id}: no reply needed.`).then(reload, () => undefined);
  const failed = data.recent.filter((r) => r.status === 'failed' && Date.now() / 1000 - (r.finished_at ?? 0) < 86400).slice(0, 8);
  const groups = [
    { key: 'waiting', title: 'Answer the client', hint: 'They wrote last and have heard nothing since.', items: n.waiting, actions: () => [], extra: (t) => [['No reply needed', () => answered(t)]] },
    { key: 'review', title: 'Check the agent’s work', hint: 'Finished runs waiting for you.', items: n.review, actions: (t) => [['done', 'Done'], ['approved', 'Run again']] },
    { key: 'new', title: 'Approve or decline', hint: 'New requests. Nothing runs until you approve.', items: n.new, actions: (t) => [['approved', 'Approve'], ['declined', 'Decline']] },
    { key: 'stalled', title: 'Stalled', hint: 'In progress for 45+ minutes without a report.', items: n.stalled, actions: () => [['approved', 'Requeue']] },
    { key: 'stuck', title: 'No node can take these', hint: 'Approved, but nothing eligible.', items: n.stuck, actions: () => [] },
  ];
  const empty = groups.every((g) => !g.items.length) && !n.offline.length;
  return (
    <div className="aw-view aw-inbox">
      <header className="aw-hero">
        <h2>Needs you</h2>
        <p className="aw-muted">
          {empty ? 'Nothing is waiting on you. Agents are on it.' : `${groups.reduce((a, g) => a + g.items.length, 0)} item(s) waiting on you.`}
        </p>
      </header>
      {n.offline.length ? (
        <div className="aw-banner aw-banner--bad">
          <Dot state="bad" /> Offline: {n.offline.map((x) => x.id).join(', ')}.{' '}
          <button type="button" className="aw-link" onClick={() => open('fleet')}>
            Fleet →
          </button>
        </div>
      ) : null}
      {groups.map((g) =>
        g.items.length ? (
          <section key={g.key} className="aw-group">
            <h3>
              {g.title} <span className="aw-count">{g.items.length}</span>
            </h3>
            <p className="aw-muted">{g.hint}</p>
            <ul className="aw-rows">
              {g.items.map((t) => {
                const q = data.queue.find((x) => x.id === t.id);
                return (
                  <li key={t.id} className="aw-row" onClick={() => openTicket(t.id)}>
                    <span className="aw-mono aw-muted">#{t.id}</span>
                    <span className="aw-row__title">{t.title}</span>
                    {t.kind === 'system' ? <Tag tone="dash">mine</Tag> : <Tag tone="client">{t.client_email}</Tag>}
                    <span className="aw-muted">{t.project_name ?? 'no project'}</span>
                    {g.key === 'stuck' && q ? <span className="aw-warn">{q.reason}</span> : null}
                    <span className="aw-toolbar__fill" />
                    <span className="aw-muted">{g.key === 'waiting' ? `waiting ${ago(t.client_waiting_since)}` : ago(t.updated_at)}</span>
                    {(g.extra?.(t) ?? []).map(([label, run]) => (
                      <Button
                        key={label}
                        size="sm"
                        kind="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          void run();
                        }}
                      >
                        {label}
                      </Button>
                    ))}
                    {g.actions(t).map(([s, label]) => (
                      <Button
                        key={s}
                        size="sm"
                        kind={s === 'declined' ? 'ghost' : 'default'}
                        onClick={(e) => {
                          e.stopPropagation();
                          void setStatus(t, s);
                        }}
                      >
                        {label}
                      </Button>
                    ))}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null,
      )}
      {failed.length ? (
        <section className="aw-group">
          <h3>Failed runs, last 24h</h3>
          <ul className="aw-rows">
            {failed.map((r) => (
              <li key={r.id} className="aw-row" onClick={() => openTicket(r.ticket_id)}>
                <Dot state="bad" />
                <span className="aw-mono aw-muted">#{r.ticket_id}</span>
                <span className="aw-row__title">{r.title}</span>
                <span className="aw-muted">
                  {r.executor} on {r.node_id ?? 'Harness'} · {usd(r.cost_micro_usd)}
                </span>
                <span className="aw-toolbar__fill" />
                <span className="aw-muted">{ago(r.finished_at)} ago</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
