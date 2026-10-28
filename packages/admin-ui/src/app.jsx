/*
 * The admin workbench: an activity bar, an explorer, tabs, and a status bar,
 * like an editor; boards, lists and ticket pages, like a task tracker.
 *
 * Props:
 *   api(method, path, body) → Promise<json>   throws { code, status } on failure
 *   platform  'web' | 'dsh'
 *   host      optional, the Harness only: { command(line) → { ok, text } } for this machine's node
 *   fullscreen  fill the viewport (the web page)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminContext, useAdmin as useAdminCtx, useAdminData } from './store.js';
import { CLIENT_VISIBLE, EXECUTORS, PRIORITIES, STATUS_LABEL, errorText, needsYou, predict, slugify } from './format.js';
import { Button, Chips, Confirm, Dot, Field, Icon, Modal, Resizer, Segmented, cx } from './ui.jsx';
import { BoardView, InboxView, ListView } from './board.jsx';
import { TicketView } from './ticket.jsx';
import { ClientsView, FleetView, SettingsView } from './fleet.jsx';
import { MarketingView } from './marketing.jsx';
import { STYLES } from './styles.js';

const VIEWS = [
  { key: 'inbox', label: 'Needs you', icon: 'inbox' },
  { key: 'board', label: 'Board', icon: 'board' },
  { key: 'list', label: 'All work', icon: 'list' },
  { key: 'marketing', label: 'Marketing', icon: 'megaphone' },
  { key: 'fleet', label: 'Fleet', icon: 'fleet' },
  { key: 'clients', label: 'Clients & projects', icon: 'clients' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];
const viewOf = (key) => VIEWS.find((v) => v.key === key);
const TABS_KEY = 'aw-tabs-v1';

function loadTabs() {
  try {
    const saved = JSON.parse(localStorage.getItem(TABS_KEY) ?? 'null');
    if (saved && Array.isArray(saved.tabs) && saved.tabs.length) return saved;
  } catch {
    /* fresh */
  }
  return { tabs: ['inbox', 'board'], active: 'inbox' };
}

/**
 * `files` is optional and host-supplied: `{ upload(path, formData), download(path, name) }`.
 * Without it attachments are listed by name, and the composer sends text only.
 */
/**
 * True when the app's top-left corner sits under the macOS window buttons
 * (the Harness can show a page edge to edge), so the corner gets room.
 */
function useUnderWindowButtons(ref, enabled) {
  const [under, setUnder] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return undefined;
    const check = () => {
      const r = el.getBoundingClientRect();
      setUnder(r.left < 90 && r.top < 30);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    window.addEventListener('resize', check);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [ref, enabled]);
  return under;
}

export function AdminApp({ api, platform = 'web', host = null, fullscreen = false, files = null }) {
  const rootRef = useRef(null);
  const underButtons = useUnderWindowButtons(rootRef, platform === 'dsh');
  const [data, reload] = useAdminData(api);
  const [{ tabs, active }, setTabs] = useState(loadTabs);
  const [boardProject, setBoardProject] = useState('all');
  const [modal, setModal] = useState(null);
  const [ask, setAsk] = useState(null);
  const [toast, setToast] = useState(null);
  const [palette, setPalette] = useState(false);
  const [sidebar, setSidebar] = useState(true);

  useEffect(() => {
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, active }));
    } catch {
      /* private mode */
    }
  }, [tabs, active]);

  const open = useCallback((key) => setTabs((s) => ({ tabs: s.tabs.includes(key) ? s.tabs : [...s.tabs, key], active: key })), []);
  const close = useCallback(
    (key) =>
      setTabs((s) => {
        const i = s.tabs.indexOf(key);
        const next = s.tabs.filter((t) => t !== key);
        if (!next.length) return { tabs: ['inbox'], active: 'inbox' };
        return { tabs: next, active: s.active === key ? next[Math.max(0, i - 1)] : s.active };
      }),
    [],
  );
  const openTicket = useCallback((id) => open(`t:${id}`), [open]);

  // Links in Ali's notification mail end in #ticket=<id>: open that ticket.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const fromHash = () => {
      const hash = window.location.hash.slice(1);
      const id = Number(new URLSearchParams(hash).get('ticket'));
      if (Number.isInteger(id) && id > 0) openTicket(id);
      // Notification mail links to #marketing; a view name is a valid target too.
      if (viewOf(hash)) open(hash);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [open, openTicket]);

  const notify = useCallback((text, kind = 'ok') => {
    setToast({ text, kind, at: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), toast.kind === 'error' ? 8000 : 3500);
    return () => clearTimeout(id);
  }, [toast]);

  /** Run a mutation, report it, refresh. */
  const act = useCallback(
    async (fn, done) => {
      try {
        const out = await fn();
        if (done) notify(typeof done === 'function' ? done(out) : done);
        void reload();
        return out;
      } catch (error) {
        notify(errorText(error), 'error');
        throw error;
      }
    },
    [notify, reload],
  );

  const setStatus = useCallback(
    (ticket, status) => {
      if (status === ticket.status) return Promise.resolve();
      const run = () => act(() => api('PATCH', `/admin/tickets/${ticket.id}`, { status }), `#${ticket.id} → ${STATUS_LABEL[status]}`);
      if (ticket.kind !== 'system' && CLIENT_VISIBLE.includes(status)) {
        return new Promise((resolve) =>
          setAsk({
            title: `${STATUS_LABEL[status]}: #${ticket.id}?`,
            text: `${ticket.client_email ?? 'The client'} is emailed about this change.`,
            confirm: STATUS_LABEL[status],
            run: () => run().then(resolve, resolve),
          }),
        );
      }
      return run().catch(() => undefined);
    },
    [act, api],
  );

  // ⌘K / Ctrl+K: the palette. ⌘B: the explorer.
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebar((s) => !s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ctx = useMemo(
    () => ({ api, files, data, reload, platform, host, open, openTicket, setStatus, act, notify, ask: setAsk, setModal, boardProject, setBoardProject }),
    [api, files, data, reload, platform, host, open, openTicket, setStatus, act, notify, boardProject],
  );

  const inbox = needsYou(data);
  const inboxCount = inbox.waiting.length + inbox.review.length + inbox.new.length + inbox.stalled.length + inbox.stuck.length;
  const ticketById = new Map(data.tickets.map((t) => [t.id, t]));
  const tabLabel = (key) => {
    if (key.startsWith('t:')) {
      const t = ticketById.get(Number(key.slice(2)));
      return t ? `#${t.id} ${t.title}` : `#${key.slice(2)}`;
    }
    return viewOf(key)?.label ?? key;
  };

  const signedOut = data.error && ['unauthorized', 'signed_out', 'forbidden'].includes(data.error.code);

  return (
    <AdminContext.Provider value={ctx}>
      <style>{STYLES}</style>
      <div ref={rootRef} className={cx('aw', fullscreen && 'aw--fullscreen', `aw--${platform}`, underButtons && 'aw--inset')}>
        <nav className="aw-activity" aria-label="Views">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" title={v.label} aria-pressed={active === v.key} onClick={() => open(v.key)}>
              <Icon name={v.icon} size={20} />
              {v.key === 'inbox' && inboxCount ? <span className="aw-badge">{inboxCount}</span> : null}
            </button>
          ))}
          <span className="aw-activity__spacer" />
          <button type="button" title="New task (N)" onClick={() => setModal({ kind: 'task' })}>
            <Icon name="plus" size={20} />
          </button>
          <button type="button" title="Search and commands (⌘K)" onClick={() => setPalette(true)}>
            <Icon name="search" size={20} />
          </button>
        </nav>

        {sidebar ? <Explorer /> : null}
        {sidebar ? <Resizer host=".aw" cssVar="--aw-explorer-w" def={260} min={180} max={520} storage="aw.explorer.w" className="aw-resize--explorer" /> : null}

        <main className="aw-main">
          <div className="aw-tabs" role="tablist">
            {tabs.map((key) => (
              <div
                key={key}
                role="tab"
                aria-selected={key === active}
                className={cx('aw-tab', key === active && 'is-active')}
                onClick={() => setTabs((s) => ({ ...s, active: key }))}
                onAuxClick={(e) => e.button === 1 && close(key)}
                title={tabLabel(key)}
              >
                <Icon name={key.startsWith('t:') ? 'ticket' : viewOf(key)?.icon ?? 'list'} size={14} />
                <span className="aw-tab__label">{tabLabel(key)}</span>
                <button
                  type="button"
                  className="aw-tab__close"
                  aria-label="Close tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    close(key);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <span className="aw-tabs__fill" />
            <Button kind="ghost" size="sm" title="Refresh" onClick={() => void reload()}>
              <Icon name="refresh" size={14} />
            </Button>
          </div>

          <div className="aw-content">
            {signedOut ? (
              <SignedOut />
            ) : !data.loaded ? (
              <p className="aw-empty">Loading…</p>
            ) : (
              tabs.map((key) => (
                <section key={key} className="aw-pane" hidden={key !== active}>
                  {key.startsWith('t:') ? <TicketView id={Number(key.slice(2))} active={key === active} /> : <View name={key} />}
                </section>
              ))
            )}
          </div>
        </main>

        <StatusBar />

        {toast ? (
          <div className={cx('aw-toast', toast.kind === 'error' && 'is-error')} role="status">
            {toast.text}
          </div>
        ) : null}
        {palette ? <Palette onClose={() => setPalette(false)} /> : null}
        {modal?.kind === 'task' ? <TaskModal preset={modal} onClose={() => setModal(null)} /> : null}
        {modal?.kind === 'project' ? <ProjectModal onClose={() => setModal(null)} /> : null}
        {modal?.kind === 'custom' ? modal.render(() => setModal(null)) : null}
        {ask ? <Confirm ask={ask} onClose={() => setAsk(null)} /> : null}
      </div>
    </AdminContext.Provider>
  );
}

function View({ name }) {
  switch (name) {
    case 'inbox':
      return <InboxView />;
    case 'board':
      return <BoardView />;
    case 'list':
      return <ListView />;
    case 'marketing':
      return <MarketingView />;
    case 'fleet':
      return <FleetView />;
    case 'clients':
      return <ClientsView />;
    case 'settings':
      return <SettingsView />;
    default:
      return <p className="aw-empty">Unknown view.</p>;
  }
}

function SignedOut() {
  const { platform, data } = useAdminCtx();
  return (
    <div className="aw-empty">
      <p>{errorText(data.error)}</p>
      {platform === 'web' ? (
        <p>
          <a href="/portal">Sign in on the portal</a>, then come back.
        </p>
      ) : (
        <p>Open Settings and paste a portal session token.</p>
      )}
      {platform === 'dsh' ? <SettingsView /> : null}
    </div>
  );
}

/* ————— the explorer: projects as folders, live work, nodes ————— */

function Explorer() {
  const { data, open, openTicket, setBoardProject, boardProject } = useAdminCtx();
  const [openSlug, setOpenSlug] = useState({});
  const byProject = new Map();
  for (const t of data.tickets) {
    const key = t.project_id ?? '';
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(t);
  }
  const live = (t) => !['done', 'declined'].includes(t.status);
  const runningTicket = new Set(data.running.map((r) => r.ticket_id));
  return (
    <aside className="aw-explorer" aria-label="Explorer">
      <h3>Projects</h3>
      <ul className="aw-tree">
        {data.projects.map((p) => {
          const items = (byProject.get(p.id) ?? []).filter(live);
          const expanded = openSlug[p.id] ?? items.length > 0;
          return (
            <li key={p.id}>
              <div className={cx('aw-tree__row', boardProject === p.id && 'is-active')}>
                <button type="button" className="aw-tree__twist" onClick={() => setOpenSlug((s) => ({ ...s, [p.id]: !expanded }))} aria-label={expanded ? 'Collapse' : 'Expand'}>
                  {expanded ? '▾' : '▸'}
                </button>
                <button
                  type="button"
                  className="aw-tree__name"
                  onClick={() => {
                    setBoardProject(p.id);
                    open('board');
                  }}
                  title={`Open ${p.name} on the board`}
                >
                  <Icon name="folder" size={14} /> {p.name}
                </button>
                {items.length ? <span className="aw-count">{items.length}</span> : null}
              </div>
              {expanded ? (
                <ul>
                  {items.map((t) => (
                    <li key={t.id}>
                      <button type="button" className="aw-tree__leaf" onClick={() => openTicket(t.id)} title={t.title}>
                        <span className={`aw-sq aw-sq--${t.status}`} />
                        <span className="aw-tree__id">#{t.id}</span> {t.title}
                        {runningTicket.has(t.id) ? <span className="aw-live" title="An agent is running" /> : null}
                      </button>
                    </li>
                  ))}
                  {!items.length ? <li className="aw-tree__none">No open work</li> : null}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>

      <h3>Running now</h3>
      <ul className="aw-tree">
        {data.running.length ? (
          data.running.map((r) => (
            <li key={r.id}>
              <button type="button" className="aw-tree__leaf" onClick={() => openTicket(r.ticket_id)}>
                <span className="aw-live" /> #{r.ticket_id} {r.executor} · {r.node_id ?? 'Harness'}
              </button>
            </li>
          ))
        ) : (
          <li className="aw-tree__none">Nothing</li>
        )}
      </ul>

      <h3>Nodes</h3>
      <ul className="aw-tree">
        {data.nodes.map((n) => (
          <li key={n.id}>
            <button type="button" className="aw-tree__leaf" onClick={() => open('fleet')}>
              <Dot state={!n.online ? 'bad' : n.draining ? 'warn' : 'ok'} /> {n.id}
              <span className="aw-muted"> {n.running.length}/{n.slots}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function StatusBar() {
  const { data, open } = useAdminCtx();
  const online = data.nodes.filter((n) => n.online).length;
  const waiting = data.queue.length;
  const stuck = data.queue.filter((q) => !q.eligible.length).length;
  return (
    <footer className="aw-status">
      <button type="button" onClick={() => open('fleet')}>
        <Dot state={online === data.nodes.length && online ? 'ok' : online ? 'warn' : 'bad'} /> {online}/{data.nodes.length} nodes online
      </button>
      <button type="button" onClick={() => open('fleet')}>
        {data.running.length} running
      </button>
      <button type="button" onClick={() => open('fleet')}>
        {waiting} queued{stuck ? ` · ${stuck} stuck` : ''}
      </button>
      <span className="aw-status__fill" />
      {data.error ? <span className="aw-status__err">{errorText(data.error)}</span> : null}
      <span>{data.fetchedAt ? `updated ${new Date(data.fetchedAt).toLocaleTimeString()}` : ''}</span>
      <span>⌘K</span>
    </footer>
  );
}

/* ————— the palette: jump to anything, run any command ————— */

function Palette({ onClose }) {
  const { data, open, openTicket, setModal, reload } = useAdminCtx();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef(null);
  useEffect(() => input.current?.focus(), []);
  const items = useMemo(() => {
    const cmds = [
      { label: 'New task…', hint: 'command', run: () => setModal({ kind: 'task' }) },
      { label: 'New project…', hint: 'command', run: () => setModal({ kind: 'project' }) },
      { label: 'Refresh', hint: 'command', run: () => void reload() },
      ...VIEWS.map((v) => ({ label: `Go to ${v.label}`, hint: 'view', run: () => open(v.key) })),
      ...data.tickets.map((t) => ({ label: `#${t.id} ${t.title}`, hint: `${STATUS_LABEL[t.status]} · ${t.project_name ?? 'no project'}`, run: () => openTicket(t.id) })),
    ];
    const needle = q.trim().toLowerCase();
    if (!needle) return cmds.slice(0, 40);
    return cmds.filter((c) => `${c.label} ${c.hint}`.toLowerCase().includes(needle)).slice(0, 40);
  }, [q, data.tickets, open, openTicket, setModal, reload]);
  const pick = (item) => {
    onClose();
    item?.run();
  };
  return (
    <div className="aw-scrim aw-scrim--top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="aw-palette" role="dialog" aria-label="Command palette">
        <input
          ref={input}
          value={q}
          placeholder="Search tickets, views and commands…"
          onChange={(e) => {
            setQ(e.target.value);
            setI(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') (e.preventDefault(), setI((n) => Math.min(items.length - 1, n + 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setI((n) => Math.max(0, n - 1)));
            else if (e.key === 'Enter') pick(items[i]);
          }}
        />
        <ul>
          {items.map((item, n) => (
            <li key={item.label + n} className={n === i ? 'is-active' : ''} onMouseEnter={() => setI(n)} onMouseDown={() => pick(item)}>
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </li>
          ))}
          {!items.length ? <li className="aw-muted">No matches</li> : null}
        </ul>
      </div>
    </div>
  );
}

/* ————— filing work ————— */

function TaskModal({ preset, onClose }) {
  const { api, data, act, openTicket } = useAdminCtx();
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [projectId, setProjectId] = useState(preset.projectId ?? (data.projects.length === 1 ? data.projects[0].id : ''));
  const [priority, setPriority] = useState(data.settings?.defaultPriority ?? 0);
  const [executor, setExecutor] = useState(null);
  const [requires, setRequires] = useState([]);
  const [approve, setApprove] = useState(true);
  const [busy, setBusy] = useState(false);
  const slug = data.projects.find((p) => p.id === projectId)?.slug ?? null;
  const where = predict(data.nodes, { slug, requires, executor, kind: 'system' });
  const caps = data.catalog?.capabilities ?? [];
  const submit = async () => {
    setBusy(true);
    try {
      const out = await act(
        () => api('POST', '/admin/work', { title: title.trim(), brief: brief.trim(), projectId, priority, requires, executor, approve }),
        (o) => `Filed #${o.id}${approve ? ' and queued it' : ''}.`,
      );
      onClose();
      openTicket(out.id);
    } catch {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New task"
      subtitle="Your own work on one of your projects. The brief is trusted guidance for the agent."
      onClose={onClose}
      wide
      actions={
        <>
          <span className={`aw-predict aw-predict--${where.state}`}>
            <Dot state={where.state} /> {where.text}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={busy || !title.trim() || !brief.trim() || !projectId} onClick={submit}>
            {approve ? 'File and queue' : 'File'}
          </Button>
        </>
      }
    >
      <Field label="Title">
        <input value={title} maxLength={140} placeholder="Fix the checkout total rounding" onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Brief" hint="What to change, where, and how to check it.">
        <textarea
          rows={7}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && submit()}
        />
      </Field>
      <div className="aw-grid2">
        <Field label="Project">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Pick a project…</option>
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority">
          <Segmented value={priority} options={PRIORITIES} onChange={setPriority} />
        </Field>
        <Field label="Agent">
          <Segmented value={executor} options={[{ value: null, label: 'Any' }, ...EXECUTORS.map((e) => ({ value: e, label: e }))]} onChange={setExecutor} />
        </Field>
        <Field label="Start">
          <Segmented value={approve} options={[{ value: true, label: 'Queue now' }, { value: false, label: 'Hold in New' }]} onChange={setApprove} />
        </Field>
      </div>
      {caps.length ? (
        <Field label="Needs" hint="Only nodes with all of these take it.">
          <Chips value={requires} options={caps.map((c) => ({ value: c.id, label: c.label, hint: c.hint }))} onChange={setRequires} />
        </Field>
      ) : null}
    </Modal>
  );
}

function ProjectModal({ onClose }) {
  const { api, act } = useAdminCtx();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [edited, setEdited] = useState(false);
  const [kind, setKind] = useState('existing');
  const [code, setCode] = useState('create');
  const [repo, setRepo] = useState('');
  const ready = name.trim() && slug && (code !== 'repo' || repo.trim());
  const submit = () =>
    act(
      () => api('POST', '/admin/projects', { name: name.trim(), slug, kind, code, repo: code === 'repo' ? repo.trim() : undefined }),
      `Created ${name.trim()}.`,
    ).then(onClose, () => undefined);
  return (
    <Modal
      title="New project"
      subtitle="What clients file against. Work starts once a node holds its repo."
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!ready} onClick={submit}>
            Create
          </Button>
        </>
      }
    >
      <Field label="Name">
        <input
          value={name}
          maxLength={80}
          placeholder="Acme storefront"
          onChange={(e) => {
            setName(e.target.value);
            if (!edited) setSlug(slugify(e.target.value));
          }}
        />
      </Field>
      <Field label="Slug" hint="Lowercase and dashes.">
        <input
          className="aw-mono"
          value={slug}
          maxLength={63}
          onChange={(e) => {
            setEdited(true);
            setSlug(e.target.value.toLowerCase());
          }}
        />
      </Field>
      <Field label="What it is">
        <Segmented
          value={kind}
          options={[
            { value: 'existing', label: 'Existing code or system' },
            { value: 'new', label: 'New website' },
          ]}
          onChange={setKind}
        />
      </Field>
      <Field
        label="Code"
        hint={
          code === 'create'
            ? kind === 'new'
              ? 'A node makes a private repo from the site template (main + preview).'
              : 'A node makes a private repo with a README.'
            : code === 'repo'
              ? 'Nodes clone this. A private repo needs a node whose git can reach it.'
              : 'A node with a folder named like the slug shares its origin.'
        }
      >
        <Segmented
          value={code}
          options={[
            { value: 'create', label: 'Create a repo' },
            { value: 'repo', label: 'Use a repo URL' },
            { value: 'folder', label: 'Folder on a node' },
          ]}
          onChange={setCode}
        />
      </Field>
      {code === 'repo' ? (
        <Field label="Repo URL">
          <input className="aw-mono" value={repo} maxLength={300} placeholder="https://github.com/owner/repo" onChange={(e) => setRepo(e.target.value)} />
        </Field>
      ) : null}
    </Modal>
  );
}
