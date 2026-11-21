/* Needs you, the board, and the list: three ways to look at the same tickets. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAdmin } from './store.js';
import {
  MINE_LABEL,
  REQUEUE_WARNING,
  RUN_AGAIN,
  STATUSES,
  STATUS_HINT,
  STATUS_LABEL,
  ago,
  chargeOf,
  clientWaiting,
  listOf,
  money,
  needsYou,
  priorityName,
  usd,
} from './format.js';
import { nextRowIndex } from './row-navigation.mjs';
import { Button, Dot, EmptyState, PageHeader, Segmented, StatusPill, Tag, Toolbar, cx, useContextMenu } from './ui.jsx';

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
        // A failed search must not leave the previous hits filtering the list.
        .catch(() => {
          if (live) setHits(new Map());
        });
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

/** The one primary action of the board and the list: a new task, preset to the filtered project. */
function NewTaskButton({ f }) {
  const { setModal } = useAdmin();
  return (
    <Button kind="primary" icon="plus" shortcut="N" onClick={() => setModal({ kind: 'task', projectId: f.boardProject === 'all' ? undefined : f.boardProject })}>
      New task
    </Button>
  );
}

const filtered = (f) => f.boardProject !== 'all' || f.kind !== 'all' || f.q.trim();
const clearFilters = (f) => {
  f.setBoardProject('all');
  f.setKind('all');
  f.setQ('');
};

function FilterBar({ f, extra }) {
  const { data, platform } = useAdmin();
  const search = useRef(null);
  // '/' focuses the filter, the way every list app does; typing is untouched.
  useEffect(() => {
    if (platform !== 'web') return undefined;
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [platform]);
  return (
    <Toolbar label="Filters">
      <input ref={search} className="aw-search" type="search" value={f.q} aria-label="Filter, or search threads" aria-keyshortcuts={platform === 'web' ? '/' : undefined} placeholder="Filter, or search threads…" onChange={(e) => f.setQ(e.target.value)} />
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
          { value: 'system', label: MINE_LABEL },
        ]}
        onChange={f.setKind}
        label="Kind of work"
      />
      {extra}
      <span className="aw-toolbar__fill" />
      {filtered(f) ? <Button kind="ghost" size="sm" onClick={() => clearFilters(f)}>Clear filters</Button> : null}
    </Toolbar>
  );
}

/**
 * A status move, with the rerun warning the ticket page shows: queueing again
 * is deliberate, because the fleet may resume the old session. Approving a
 * new ticket, and any move on system work (no client to notify), stays plain.
 */
function useMove() {
  const { api, setStatus, act, ask } = useAdmin();
  return (t, s) => {
    if (s === 'approved' && t.status !== 'new' && t.kind !== 'system') {
      ask({
        title: `${RUN_AGAIN} for #${t.id}?`,
        text: REQUEUE_WARNING,
        confirm: RUN_AGAIN,
        run: () => act(() => api('PATCH', `/admin/tickets/${t.id}`, { status: 'approved' })),
      });
      return;
    }
    return setStatus(t, s);
  };
}

/** The moves a ticket offers from a row or card; the ticket page has the same ones. */
const ROW_MOVES = {
  new: [['approved', 'Approve'], ['declined', 'Decline']],
  approved: [['new', 'Hold']],
  review: [['done', 'Mark done'], ['approved', RUN_AGAIN]],
  done: [['approved', RUN_AGAIN]],
  declined: [['new', 'Reopen']],
};

/** Right-click (or Shift+F10) on a ticket row or card: open, copy its link, and its status moves. */
export function useTicketMenu(t) {
  const { openTicket, platform } = useAdmin();
  const move = useMove();
  return useContextMenu(() => [
    { label: 'Open', run: () => openTicket(t.id) },
    {
      label: 'Copy link',
      run: () => void navigator.clipboard?.writeText(`${platform === 'web' ? location.origin + location.pathname : 'https://ptechsolutions.net/portal/admin'}#ticket=${t.id}`),
    },
    ...(ROW_MOVES[t.status]?.length ? [{ separator: true }] : []),
    ...(ROW_MOVES[t.status] ?? []).map(([s, label]) => ({ label, run: () => void move(t, s), danger: s === 'declined' })),
  ], `#${t.id} actions`);
}

/**
 * One row's keys, shared by the board, the list and the inbox: j/k and the
 * arrows move the focused row (`nextRowIndex`'s rule), Enter or Space opens
 * it. A control inside a row keeps its own keys, and the Harness keeps its
 * own shortcuts, so the letter keys are web-only.
 */
function useRowNav(count, open) {
  const { platform } = useAdmin();
  const cells = useRef(new Map());
  const cell = (index) => (el) => {
    if (el) cells.current.set(index, el);
    else cells.current.delete(index);
  };
  const onKey = (e, index) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open(index);
      return;
    }
    if (platform !== 'web' || e.metaKey || e.ctrlKey || e.altKey) return;
    const next = nextRowIndex(index, count, e.key);
    if (next == null) return;
    e.preventDefault();
    cells.current.get(next)?.focus();
  };
  return { cell, onKey };
}

/** A row's title as a real link: middle-click and copy-link work; a plain click stays the row's own open. */
const titleLinkClick = (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) e.stopPropagation();
  else e.preventDefault();
};

export function TicketCard({ t, draggable, cell, onKey }) {
  const { data, openTicket } = useAdmin();
  const menu = useTicketMenu(t);
  const run = data.running.find((r) => r.ticket_id === t.id);
  const queued = data.queue.find((q) => q.id === t.id);
  const cost = chargeOf(t).totalCents;
  return (
    <article
      ref={cell ?? undefined}
      onContextMenu={menu.bind.onContextMenu}
      aria-label={`#${t.id} ${t.title}`}
      className={cx('aw-card', run && 'is-running', queued && !queued.eligible.length && 'is-stuck')}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/x-ticket', String(t.id));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => openTicket(t.id)}
      onKeyDown={(e) => {
        menu.bind.onKeyDown(e);
        if (!e.defaultPrevented) (onKey ?? ((ev) => ev.key === 'Enter' && openTicket(t.id)))(e);
      }}
      tabIndex={0}
    >
      <div className="aw-card__top">
        <span className="aw-card__id">#{t.id}</span>
        {t.source === 'assistant' ? (
          <Tag title="The client’s own assistant (ChatGPT, …) made this change on their subscription">their AI</Tag>
        ) : null}
        {(t.priority ?? 0) > 0 ? <Tag>{priorityName(t.priority)}</Tag> : null}
        {clientWaiting(t) ? <Tag tone="warn">awaiting reply</Tag> : null}
        <span className="aw-card__age">{ago(t.updated_at)}</span>
      </div>
      <h4>
        <a className="aw-titlelink" href={`#ticket=${t.id}`} tabIndex={-1} onClick={titleLinkClick}>
          {t.title}
        </a>
      </h4>
      <div className="aw-card__meta">
        <span>{t.project_name ?? 'no project'}</span>
        {t.kind === 'system' ? <span>{MINE_LABEL}</span> : t.client_name || t.client_email ? <span title={t.client_email}>{t.client_name || t.client_email}</span> : null}
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
      {queued && !queued.eligible.length ? <p className="aw-card__warn"><Dot state="bad" /> <span>{queued.reason}</span></p> : null}
      {menu.menu}
    </article>
  );
}

/** One board column's cards, with the column's own keyboard order. */
function ColumnCards({ items }) {
  const { openTicket } = useAdmin();
  const nav = useRowNav(items.length, (i) => openTicket(items[i].id));
  return (
    <>
      {items.map((t, i) => (
        <TicketCard key={t.id} t={t} draggable cell={nav.cell(i)} onKey={(e) => nav.onKey(e, i)} />
      ))}
    </>
  );
}

export function BoardView() {
  const { data } = useAdmin();
  const move = useMove();
  const f = useFilters();
  const [showClosed, setShowClosed] = useState(false);
  const [over, setOver] = useState(null);
  const tickets = f.apply(data.tickets);
  const columns = showClosed ? STATUSES : STATUSES.filter((s) => s !== 'declined');
  const byId = new Map(data.tickets.map((t) => [t.id, t]));
  return (
    <div className="aw-view aw-view--board">
      <PageHeader title="Board" subtitle="Every request by status. Drag a card to another column, or right-click it, to move it." actions={<NewTaskButton f={f} />} />
      <FilterBar f={f} extra={<Segmented label="Columns" value={showClosed} options={[{ value: false, label: 'Open' }, { value: true, label: '+ Declined' }]} onChange={setShowClosed} />} />
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
                // Dropping on Approved is queueing again: the same warning as the ticket page.
                if (t) void move(t, s);
              }}
            >
              <header title={STATUS_HINT[s]}>
                <span className={`aw-sq aw-sq--${s}`} aria-hidden="true" />
                {STATUS_LABEL[s]}
                <span className="aw-count">{tickets.filter((t) => t.status === s).length}</span>
              </header>
              <div className="aw-col__body">
                <ColumnCards items={items} />
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
  { key: 'id', label: '#', get: (t) => t.id, num: true },
  { key: 'title', label: 'Title', get: (t) => t.title.toLowerCase() },
  { key: 'status', label: 'Status', get: (t) => STATUSES.indexOf(t.status) },
  { key: 'project', label: 'Project', get: (t) => t.project_name ?? '' },
  { key: 'who', label: 'For', get: (t) => (t.kind === 'system' ? '' : t.client_email ?? '') },
  { key: 'priority', label: 'Priority', get: (t) => t.priority ?? 0 },
  { key: 'agent', label: 'Agent', get: (t) => t.executor ?? '' },
  { key: 'cost', label: 'Cost', get: (t) => chargeOf(t).totalCents, num: true },
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
  const nav = useRowNav(rows.length, (i) => openTicket(rows[i].id));
  return (
    <div className="aw-view">
      <PageHeader title="All work" subtitle="Every request in one table. Click a column to sort; click a row to open it." actions={<NewTaskButton f={f} />} />
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
        <table className="aw-table aw-table--stack aw-table--rows">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className={c.num ? 'aw-num' : undefined} aria-sort={sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'} onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : 1 }))}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : 1 })); }}>
                    {c.label}
                    {sort.key === c.key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => (
              <ListRow key={t.id} t={t} hit={f.hits.get(t.id)} cell={nav.cell(i)} onKey={(e) => nav.onKey(e, i)} />
            ))}
          </tbody>
        </table>
        {!rows.length ? (
          <EmptyState
            title={data.tickets.length ? 'Nothing matches these filters.' : 'No requests yet.'}
            hint={data.tickets.length ? 'Clear the filters, or choose Everything in the status filter.' : 'Requests from clients and your own tasks appear here.'}
            action={data.tickets.length ? <Button onClick={() => { clearFilters(f); setStatusFilter('all'); }}>Clear filters</Button> : <NewTaskButton f={f} />}
          />
        ) : null}
      </div>
    </div>
  );
}

function ListRow({ t, hit, cell, onKey }) {
  const { openTicket } = useAdmin();
  const menu = useTicketMenu(t);
  return (
    <tr
      ref={cell}
      onClick={() => openTicket(t.id)}
      tabIndex={0}
      onContextMenu={menu.bind.onContextMenu}
      onKeyDown={(e) => {
        menu.bind.onKeyDown(e);
        if (!e.defaultPrevented) onKey(e);
      }}
    >
      <td className="aw-num aw-muted">#{t.id}</td>
      <td className="aw-table__title">
        <a className="aw-titlelink" href={`#ticket=${t.id}`} tabIndex={-1} onClick={titleLinkClick}>
          {t.title}
        </a>
        {hit ? <small className="aw-muted aw-snippet">{hit}</small> : null}
        {menu.menu}
      </td>
      <td data-label="Status">
        <StatusPill status={t.status} />
      </td>
      <td data-label="Project">{t.project_name ?? '—'}</td>
      <td data-label="For">{t.kind === 'system' ? <span className="aw-muted">{MINE_LABEL}</span> : t.client_email}</td>
      <td data-label="Priority">{t.priority ? priorityName(t.priority) : <span className="aw-faint">Normal</span>}</td>
      <td data-label="Agent">{t.source === 'assistant' ? 'their assistant' : t.executor ?? <span className="aw-faint">Auto</span>}</td>
      <td data-label="Cost" className="aw-num">{money(chargeOf(t).totalCents)}</td>
      <td data-label="Updated" className="aw-muted">{ago(t.updated_at)} ago</td>
    </tr>
  );
}

/** A Needs-you row: the ticket, who and where, how long, and its one or two moves. */
function InboxRow({ g, t, q, cell, onKey, move }) {
  const { openTicket } = useAdmin();
  const menu = useTicketMenu(t);
  return (
    <li
      className="aw-row"
      tabIndex={0}
      ref={cell}
      onContextMenu={menu.bind.onContextMenu}
      onKeyDown={(e) => {
        menu.bind.onKeyDown(e);
        if (!e.defaultPrevented) onKey(e);
      }}
      onClick={() => openTicket(t.id)}
    >
      <span className="aw-mono aw-muted">#{t.id}</span>
      <a className="aw-titlelink aw-row__title" href={`#ticket=${t.id}`} tabIndex={-1} onClick={titleLinkClick} title={t.title}>
        {t.title}
      </a>
      <span className="aw-row__meta">
        {t.kind === 'system' ? MINE_LABEL : t.client_name || t.client_email} · {t.project_name ?? 'no project'}
      </span>
      {g.key === 'stuck' && q ? <span className="aw-warn aw-row__meta">{q.reason}</span> : null}
      <span className="aw-muted">{g.key === 'waiting' ? `waiting ${ago(t.client_waiting_since)}` : ago(t.updated_at)}</span>
      <span className="aw-row__actions">
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
              void move(t, s);
            }}
          >
            {label}
          </Button>
        ))}
      </span>
      {menu.menu}
    </li>
  );
}

export function InboxView() {
  const { data, open, openTicket, act, api, reload } = useAdmin();
  const move = useMove();
  const n = needsYou(data);
  const answered = (t) => act(() => api('POST', `/admin/tickets/${t.id}/answered`), `#${t.id}: no reply needed.`).then(reload, () => undefined);
  const failed = data.recent.filter((r) => r.status === 'failed' && Date.now() / 1000 - (r.finished_at ?? 0) < 86400).slice(0, 8);
  const groups = [
    { key: 'waiting', title: 'Answer the client', hint: 'They wrote last and have heard nothing since.', items: n.waiting, actions: () => [], extra: (t) => [['No reply needed', () => answered(t)]] },
    { key: 'review', title: 'Check the agent’s work', hint: 'Finished runs waiting for you.', items: n.review, actions: () => [['done', 'Done'], ['approved', RUN_AGAIN]] },
    { key: 'new', title: 'Approve or decline', hint: 'New requests. Nothing runs until you approve.', items: n.new, actions: () => [['approved', 'Approve'], ['declined', 'Decline']] },
    { key: 'stalled', title: 'Stalled', hint: 'In progress for 45+ minutes without a report.', items: n.stalled, actions: () => [['approved', RUN_AGAIN]] },
    { key: 'stuck', title: 'No node can take these', hint: 'Approved, but nothing eligible.', items: n.stuck, actions: () => [] },
  ];
  // The keyboard order is the reading order: every group's tickets, then the failed runs.
  const ids = [];
  const at = new Map();
  for (const g of groups) for (const t of g.items) at.set(t, ids.push(t.id) - 1);
  for (const r of failed) at.set(r, ids.push(r.ticket_id) - 1);
  const nav = useRowNav(ids.length, (i) => openTicket(ids[i]));
  const empty = groups.every((g) => !g.items.length) && !n.offline.length;
  const total = groups.reduce((a, g) => a + g.items.length, 0);
  return (
    <div className="aw-view aw-inbox">
      <PageHeader
        title="Needs you"
        subtitle={empty ? 'Nothing is waiting on you. Agents are on it.' : `${total} ${total === 1 ? 'item needs' : 'items need'} you.`}
      />
      {data.access?.superAdmin && n.offline.length ? (
        <div className="aw-inbox__offline">
          <Dot state="warn" /> Offline: {n.offline.map((x) => x.id).join(', ')}.{' '}
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
              <span className="aw-group__hint">{g.hint}</span>
            </h3>
            <ul className="aw-rows">
              {g.items.map((t) => {
                const i = at.get(t);
                return <InboxRow key={t.id} g={g} t={t} q={data.queue.find((x) => x.id === t.id)} cell={nav.cell(i)} onKey={(e) => nav.onKey(e, i)} move={move} />;
              })}
            </ul>
          </section>
        ) : null,
      )}
      {empty && !failed.length ? (
        <EmptyState
          icon="check"
          title="Nothing needs you."
          hint="New requests, finished runs and waiting clients land here. The board shows everything in flight."
          action={<Button onClick={() => open('board')}>Open the board</Button>}
        />
      ) : null}
      {failed.length ? (
        <section className="aw-group">
          <h3>Failed runs, last 24h <span className="aw-count">{failed.length}</span></h3>
          <ul className="aw-rows">
            {failed.map((r) => {
              const i = at.get(r);
              return (
                <li key={r.id} className="aw-row" tabIndex={0} ref={nav.cell(i)} onKeyDown={(e) => nav.onKey(e, i)} onClick={() => openTicket(r.ticket_id)}>
                  <Dot state="bad" />
                  <span className="aw-mono aw-muted">#{r.ticket_id}</span>
                  <a className="aw-titlelink aw-row__title" href={`#ticket=${r.ticket_id}`} tabIndex={-1} onClick={titleLinkClick}>
                    {r.title}
                  </a>
                  <span className="aw-row__meta">
                    {r.executor} on {r.node_id ?? 'Harness'} · {usd(r.cost_micro_usd)}
                  </span>
                  <span className="aw-toolbar__fill" />
                  <span className="aw-muted">{ago(r.finished_at)} ago</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
