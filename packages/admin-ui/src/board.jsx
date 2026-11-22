/*
 * Needs you, the board, and the list: three ways to look at the same tickets.
 * The board and the list are v2 workspaces: selecting a card or row opens the
 * Work Inspector beside them (never over them); Enter opens the ticket.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAdmin, useTicket } from './store.js';
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
  when,
} from './format.js';
import { nextRowIndex } from './row-navigation.mjs';
import { Button, DataTable, Dot, EmptyState, Inspector, MetaChip, PageHeader, Segmented, StateIndicator, FilterBar, UiStyles, cx, layerOpen, useContextMenu } from './ui/index.js';

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

/**
 * The board's and the list's primary action: a new task, preset to the
 * filtered project. While the Inspector is open its action is the one
 * primary on screen, so this steps down to a plain button.
 */
function NewTaskButton({ f, quiet = false }) {
  const { setModal } = useAdmin();
  return (
    <Button kind={quiet ? 'default' : 'primary'} icon="plus" shortcut="N" onClick={() => setModal({ kind: 'task', projectId: f.boardProject === 'all' ? undefined : f.boardProject })}>
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

function BoardFilters({ f, extra }) {
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
    <FilterBar label="Filters">
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
    </FilterBar>
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

/** A ticket's menu items: open, copy its link, and its status moves. */
function ticketMenuItems(t, { openTicket, platform, move }) {
  return [
    { label: 'Open', run: () => openTicket(t.id) },
    {
      label: 'Copy link',
      run: () => void navigator.clipboard?.writeText(`${platform === 'web' ? location.origin + location.pathname : 'https://ptechsolutions.net/portal/admin'}#ticket=${t.id}`),
    },
    ...(ROW_MOVES[t.status]?.length ? [{ separator: true }] : []),
    ...(ROW_MOVES[t.status] ?? []).map(([s, label]) => ({ label, run: () => void move(t, s), danger: s === 'declined' })),
  ];
}

/** Right-click (or Shift+F10) on a ticket row or card: open, copy its link, and its status moves. */
export function useTicketMenu(t) {
  const { openTicket, platform } = useAdmin();
  const move = useMove();
  return useContextMenu(() => ticketMenuItems(t, { openTicket, platform, move }), `#${t.id} actions`);
}

/** In progress this long without a report is stalled (the same rule as Needs you). */
const STALL_AFTER_S = 45 * 60;

/** The one state a ticket shows: a live run first, then stalled, then its status. */
export function ticketState(t, running = []) {
  if (running.some((r) => r.ticket_id === t.id)) return 'running';
  if (t.status === 'in_progress' && Date.now() / 1000 - (t.updated_at ?? 0) > STALL_AFTER_S) return 'stalled';
  return t.status;
}

/** Who a ticket is for: the client, or the operator's own work. */
const ownerOf = (t) => (t.kind === 'system' ? MINE_LABEL : t.client_name || t.client_email || '—');

/** The move the Inspector makes primary for a status; anything else is secondary. */
const LEAD_MOVE = { new: 'approved', review: 'done' };

/** Escape closes the Inspector from anywhere in the workspace, unless something nearer used it. */
const closeOnEscape = (selected, close) => (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || selected == null) return;
  // An open menu or dialog owns Escape (the shared layer stack), so the Inspector stays.
  if (layerOpen() || e.target?.closest?.('input, textarea, select, [contenteditable], [role="dialog"]')) return;
  e.preventDefault();
  close();
};

/** Wait for the selection to rest before fetching its thread, so j/k does not fire a request per row. */
function useSettled(value, ms = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** The thread's newest message, and the pre-review when there is one. */
function ThreadPreview({ id }) {
  const { api } = useAdmin();
  const [{ ticket, messages, review, loading }] = useTicket(api, id);
  if (loading && !ticket) return <p className="ui-note" role="status">Loading the thread…</p>;
  if (!ticket) return <p className="ui-note" role="alert">Could not load the thread. Open the ticket to retry.</p>;
  const latest = [...(messages ?? [])].reverse().find((m) => m.author !== 'system' && (m.body ?? '').trim());
  const who = (m) => (m.author === 'ali' ? 'You' : m.author === 'client' ? ticket.client_name ?? ticket.client_email ?? 'Client' : m.author === 'runner' ? 'Agent report' : m.author);
  return (
    <>
      {review ? (
        <div className="ui-section">
          <h3 className="ui-section__title">Pre-review · run #{review.runId ?? 'unknown'}</h3>
          <StateIndicator state={review.verdict === 'pass' ? 'passed' : review.verdict === 'attention' ? 'check' : 'failed'} />
          <p className="ui-quote">{review.headline}</p>
        </div>
      ) : null}
      <div className="ui-section">
        <h3 className="ui-section__title">Latest message</h3>
        {latest ? (
          <>
            <div className="ui-meta">
              <strong>{who(latest)}</strong>
              {latest.internal === 1 ? <MetaChip>private note</MetaChip> : null}
              <time>{when(latest.created_at)}</time>
            </div>
            <p className="ui-quote">{latest.body}</p>
          </>
        ) : (
          <p className="ui-note">No messages yet.</p>
        )}
      </div>
    </>
  );
}

/**
 * The Work Inspector: what the selected ticket is, who it is for, what it
 * cost, its latest message, and the moves it offers. The lead move (Approve,
 * Mark done) is the screen's one primary; with no lead move, Open is.
 */
function WorkInspector({ t, hit, onClose }) {
  const { data, openTicket } = useAdmin();
  const move = useMove();
  const settledId = useSettled(t.id);
  const run = data.running.find((r) => r.ticket_id === t.id);
  const queued = data.queue.find((q) => q.id === t.id);
  const moves = ROW_MOVES[t.status] ?? [];
  const lead = moves.find(([s]) => s === LEAD_MOVE[t.status]);
  const rest = moves.filter((m) => m !== lead);
  const cost = chargeOf(t).totalCents;
  return (
    <Inspector title={`#${t.id} ${t.title}`} label={`Ticket #${t.id}`} storageKey="ptech.work.inspector.w" onClose={onClose}>
      <StateIndicator state={ticketState(t, data.running)} />
      <div className="ui-actions">
        {lead ? (
          <Button kind="primary" onClick={() => void move(t, lead[0])}>
            {lead[1]}
          </Button>
        ) : null}
        {rest.map(([s, label]) => (
          <Button key={s} kind={s === 'declined' ? 'ghost' : 'default'} onClick={() => void move(t, s)}>
            {label}
          </Button>
        ))}
        <Button kind={lead ? 'default' : 'primary'} onClick={() => openTicket(t.id)} title="Open ticket  Enter">
          Open ticket
        </Button>
      </div>
      <dl className="ui-props">
        <dt>Project</dt>
        <dd>{t.project_name ?? 'No project'}</dd>
        <dt>For</dt>
        <dd title={t.kind === 'system' ? undefined : t.client_email}>{ownerOf(t)}</dd>
        <dt>Priority</dt>
        <dd>{t.priority ? priorityName(t.priority) : 'Normal'}</dd>
        <dt>Agent</dt>
        <dd>{run ? `${run.executor} on ${run.node_id ?? 'Harness'}` : t.source === 'assistant' ? 'Their assistant' : t.executor ?? 'Auto'}</dd>
        <dt>Cost</dt>
        <dd>{money(cost)}</dd>
        <dt>Updated</dt>
        <dd>{ago(t.updated_at)} ago</dd>
      </dl>
      {queued && !queued.eligible.length ? (
        <div className="ui-section">
          <StateIndicator state="stuck" tone="bad" label={queued.reason || 'No node can take this'} />
        </div>
      ) : null}
      {hit ? (
        <div className="ui-section">
          <h3 className="ui-section__title">Matched in the thread</h3>
          <p className="ui-quote">{hit}</p>
        </div>
      ) : null}
      {settledId === t.id ? <ThreadPreview key={t.id} id={t.id} /> : <p className="ui-note" role="status">Loading the thread…</p>}
    </Inspector>
  );
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

/**
 * A board card. `onSelect` makes a click select it (the board's Inspector);
 * without it a click opens the ticket, as before. Enter always opens.
 */
export function TicketCard({ t, draggable, cell, onKey, selected = false, onSelect }) {
  const { data, openTicket } = useAdmin();
  const menu = useTicketMenu(t);
  const run = data.running.find((r) => r.ticket_id === t.id);
  const queued = data.queue.find((q) => q.id === t.id);
  const cost = chargeOf(t).totalCents;
  const state = ticketState(t, data.running);
  return (
    <article
      ref={cell ?? undefined}
      onContextMenu={(e) => {
        onSelect?.(t);
        menu.bind.onContextMenu(e);
      }}
      aria-label={`#${t.id} ${t.title}`}
      aria-current={selected ? 'true' : undefined}
      data-selected={selected ? '' : undefined}
      className={cx('aw-card', 'ui-selectable', run && 'is-running', queued && !queued.eligible.length && 'is-stuck')}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/x-ticket', String(t.id));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => (onSelect ? onSelect(t) : openTicket(t.id))}
      onDoubleClick={onSelect ? () => openTicket(t.id) : undefined}
      onFocus={onSelect ? (e) => e.target === e.currentTarget && onSelect(t) : undefined}
      onKeyDown={(e) => {
        menu.bind.onKeyDown(e);
        if (!e.defaultPrevented) (onKey ?? ((ev) => ev.key === 'Enter' && openTicket(t.id)))(e);
      }}
      tabIndex={0}
    >
      <div className="aw-card__top">
        <span className="aw-card__id">#{t.id}</span>
        {t.source === 'assistant' ? (
          <MetaChip title="The client’s own assistant (ChatGPT, …) made this change on their subscription">their AI</MetaChip>
        ) : null}
        {(t.priority ?? 0) > 0 ? <MetaChip>{priorityName(t.priority)}</MetaChip> : null}
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
          <StateIndicator state="running" label={`${run.executor} on ${run.node_id ?? 'Harness'}`} />
        ) : state === 'stalled' ? (
          <StateIndicator state="stalled" />
        ) : clientWaiting(t) ? (
          <StateIndicator state="waiting" tone="warn" label="Awaiting reply" />
        ) : null}
        {!run && t.executor ? <MetaChip>{t.executor}</MetaChip> : null}
        {listOf(t.requires).map((r) => (
          <MetaChip key={r}>{r}</MetaChip>
        ))}
        <span className="aw-toolbar__fill" />
        {cost ? <span className="aw-muted">{money(cost)}</span> : null}
      </div>
      {queued && !queued.eligible.length ? (
        <p className="aw-card__warn">
          <StateIndicator state="stuck" tone="bad" label={queued.reason || 'No node can take this'} />
        </p>
      ) : null}
      {menu.menu}
    </article>
  );
}

/** One board column's cards, with the column's own keyboard order. */
function ColumnCards({ items, selected, onSelect }) {
  const { openTicket } = useAdmin();
  const nav = useRowNav(items.length, (i) => openTicket(items[i].id));
  return (
    <>
      {items.map((t, i) => (
        <TicketCard key={t.id} t={t} draggable cell={nav.cell(i)} onKey={(e) => nav.onKey(e, i)} selected={selected === t.id} onSelect={onSelect} />
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
  const [selectedId, setSelectedId] = useState(null);
  const tickets = f.apply(data.tickets);
  const columns = showClosed ? STATUSES : STATUSES.filter((s) => s !== 'declined');
  const byId = new Map(data.tickets.map((t) => [t.id, t]));
  const visible = tickets.filter((t) => columns.includes(t.status));
  const selected = selectedId == null ? null : visible.find((t) => t.id === selectedId) ?? null;
  const close = () => setSelectedId(null);
  return (
    <div className="ui-workspace" onKeyDown={closeOnEscape(selected?.id, close)}>
      <UiStyles />
      <PageHeader title="Board" subtitle="Every request by status. Click a card to inspect it; drag it to another column, or right-click it, to move it." actions={<NewTaskButton f={f} quiet={Boolean(selected)} />} />
      <BoardFilters f={f} extra={<Segmented label="Columns" value={showClosed} options={[{ value: false, label: 'Open' }, { value: true, label: '+ Declined' }]} onChange={setShowClosed} />} />
      <div className="ui-split">
        <div className="ui-split__main">
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
                    <StateIndicator state={s} label={STATUS_LABEL[s]} />
                    <span className="aw-count">{tickets.filter((t) => t.status === s).length}</span>
                  </header>
                  <div className="aw-col__body">
                    <ColumnCards items={items} selected={selected?.id} onSelect={(t) => setSelectedId(t.id)} />
                    {more ? <p className="aw-muted aw-center">+{more} older</p> : null}
                    {!items.length ? <p className="aw-col__empty">{STATUS_HINT[s]}</p> : null}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
        {selected ? <WorkInspector t={selected} hit={f.hits.get(selected.id)} onClose={close} /> : null}
      </div>
    </div>
  );
}

const SORTS = {
  id: (t) => t.id,
  title: (t) => t.title.toLowerCase(),
  state: (t) => STATUSES.indexOf(t.status),
  project: (t) => t.project_name ?? '',
  who: (t) => (t.kind === 'system' ? '' : t.client_email ?? ''),
  age: (t) => t.updated_at,
  cost: (t) => chargeOf(t).totalCents,
};

export function ListView() {
  const { data, openTicket, platform } = useAdmin();
  const f = useFilters();
  const [status, setStatusFilter] = useState('open');
  const [sort, setSort] = useState({ key: 'age', dir: -1 });
  const [selectedId, setSelectedId] = useState(null);
  const rows = useMemo(() => {
    const get = SORTS[sort.key];
    return f
      .apply(data.tickets)
      .filter((t) => status === 'all' || (status === 'open' ? !['done', 'declined'].includes(t.status) : t.status === status))
      .sort((a, b) => (get(a) > get(b) ? 1 : get(a) < get(b) ? -1 : 0) * sort.dir);
  }, [data.tickets, f, status, sort]);
  const selected = selectedId == null ? null : rows.find((t) => t.id === selectedId) ?? null;
  const close = () => setSelectedId(null);
  const move = useMove();
  const columns = [
    { key: 'id', header: '#', mono: true, fit: true, sortable: true, render: (t) => `#${t.id}` },
    {
      key: 'title',
      header: 'Title',
      sortable: true,
      render: (t) => (
        <>
          <a className="aw-titlelink" href={`#ticket=${t.id}`} tabIndex={-1} onClick={titleLinkClick}>
            {t.title}
          </a>
          {t.priority ? <> <MetaChip>{priorityName(t.priority)}</MetaChip></> : null}
          {f.hits.get(t.id) ? <small className="aw-muted aw-snippet"> {f.hits.get(t.id)}</small> : null}
        </>
      ),
    },
    { key: 'state', header: 'State', fit: true, sortable: true, render: (t) => <StateIndicator state={ticketState(t, data.running)} /> },
    { key: 'project', header: 'Project', sortable: true, render: (t) => t.project_name ?? '—' },
    { key: 'who', header: 'For', sortable: true, render: (t) => <span title={t.kind === 'system' ? undefined : t.client_email}>{ownerOf(t)}</span> },
    { key: 'age', header: 'Age', fit: true, sortable: true, render: (t) => <span title={`Updated ${when(t.updated_at)}`}>{ago(t.updated_at)}</span> },
    { key: 'cost', header: 'Cost', numeric: true, sortable: true, render: (t) => money(chargeOf(t).totalCents) },
  ];
  return (
    <div className="ui-workspace" onKeyDown={closeOnEscape(selected?.id, close)}>
      <UiStyles />
      <PageHeader title="All work" subtitle="Every request in one table. Click a column to sort; select a row to inspect it, Enter to open it." actions={<NewTaskButton f={f} quiet={Boolean(selected)} />} />
      <BoardFilters
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
      <div className="ui-split">
        <div className="ui-split__main">
          <DataTable
            label="Work"
            columns={columns}
            rows={rows}
            rowKey={(t) => t.id}
            selected={selected?.id ?? null}
            onSelect={(t) => setSelectedId(t.id)}
            onOpen={(t) => openTicket(t.id)}
            menu={(t) => ticketMenuItems(t, { openTicket, platform, move })}
            sort={sort}
            onSort={(key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === 'age' || key === 'cost' ? -1 : 1 }))}
            empty={{
              title: data.tickets.length ? 'Nothing matches these filters.' : 'No requests yet.',
              hint: data.tickets.length ? 'Clear the filters, or choose Everything in the status filter.' : 'Requests from clients and your own tasks appear here.',
              action: data.tickets.length ? <Button onClick={() => { clearFilters(f); setStatusFilter('all'); }}>Clear filters</Button> : <NewTaskButton f={f} quiet />,
            }}
          />
        </div>
        {selected ? <WorkInspector t={selected} hit={f.hits.get(selected.id)} onClose={close} /> : null}
      </div>
    </div>
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
