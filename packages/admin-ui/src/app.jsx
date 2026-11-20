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
import { AdminContext, useAdmin as useAdminCtx, useAdminData, useMeter, useTicket } from './store.js';
import { AGENTS, CLIENT_VISIBLE, PRIORITIES, STATUS_LABEL, errorText, needsYou, predict, slugify } from './format.js';
import { Button, Chips, Confirm, Dot, Field, Icon, Modal, Resizer, Segmented, cx } from './ui.jsx';
import { BoardView, InboxView, ListView } from './board.jsx';
import { TicketDetails, TicketView } from './ticket.jsx';
import { ClientView, ClientsView, FleetView, SettingsView } from './fleet.jsx';
import { MachineOnboarding, MachineStatusPill } from './machine.jsx';
import { MarketingView } from './marketing.jsx';
import { SeoView } from './seo.jsx';
import { HealthView } from './health.jsx';
import { STYLES } from './styles.js';
import { ProjectView } from './project.jsx';
import { createTaskSubmission, createProjectSubmission, destinationFromHash, workbenchAllowed, projectCreationRequest } from './workbench.js';

const VIEWS = [
  { key: 'inbox', label: 'Needs you', icon: 'inbox' },
  { key: 'board', label: 'Board', icon: 'board' },
  { key: 'list', label: 'All work', icon: 'list' },
  { key: 'marketing', label: 'Marketing', icon: 'megaphone' },
  { key: 'seo', label: 'SEO', icon: 'seo' },
  { key: 'health', label: 'Health', icon: 'pulse' },
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

  const open = useCallback((key) => {
    if (key.startsWith('p:') && host?.openProject) return host.openProject(key.slice(2));
    setTabs((s) => ({ tabs: s.tabs.includes(key) ? s.tabs : [...s.tabs, key], active: key }));
  }, [host]);
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
      const destination = destinationFromHash(hash);
      if (destination) open(destination);
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

  useEffect(() => {
    if (data.loaded && !workbenchAllowed(active, data.access)) open('board');
  }, [data.loaded, data.access, active, open]);

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
    if (key.startsWith('p:')) return data.projects.find((p) => p.id === key.slice(2))?.name ?? 'Project';
    if (key.startsWith('c:')) {
      const c = data.clients.find((x) => x.id === key.slice(2));
      return c ? c.name || c.email : 'Client';
    }
    return viewOf(key)?.label ?? key;
  };

  const signedOut = data.error && ['unauthorized', 'signed_out', 'forbidden'].includes(data.error.code);

  return (
    <AdminContext.Provider value={ctx}>
      <style>{STYLES}</style>
      <div ref={rootRef} className={cx('aw', fullscreen && 'aw--fullscreen', `aw--${platform}`, underButtons && 'aw--inset')}>
        <nav className="aw-activity" aria-label="Views">
          {VIEWS.filter((v) => workbenchAllowed(v.key, data.access)).map((v) => (
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
            {tabs.filter((key) => workbenchAllowed(key, data.access)).map((key) => (
              <div
                key={key}
                role="tab"
                aria-selected={key === active}
                className={cx('aw-tab', key === active && 'is-active')}
                onClick={() => setTabs((s) => ({ ...s, active: key }))}
                onAuxClick={(e) => e.button === 1 && close(key)}
                title={tabLabel(key)}
              >
                <Icon name={key.startsWith('p:') ? 'folder' : key.startsWith('t:') ? 'ticket' : key.startsWith('c:') ? 'clients' : viewOf(key)?.icon ?? 'list'} size={14} />
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
            <MachineStatusPill />
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
              tabs.filter((key) => workbenchAllowed(key, data.access)).map((key) => (
                <section key={key} className="aw-pane" hidden={key !== active}>
                  {key.startsWith('t:') ? (
                    <TicketView id={Number(key.slice(2))} active={key === active} />
                  ) : key.startsWith('p:') ? (
                    <ProjectView id={key.slice(2)} />
                  ) : key.startsWith('c:') ? (
                    <ClientView id={key.slice(2)} />
                  ) : (
                    <View name={key} />
                  )}
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
        <MachineOnboarding />
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
    case 'seo':
      return <SeoView />;
    case 'health':
      return <HealthView />;
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
        <p>Open Settings and choose <strong>Sign in with portal</strong>.</p>
      )}
      {platform === 'dsh' ? <SettingsView /> : null}
    </div>
  );
}

/* ————— the explorer: projects as folders, live work, nodes ————— */

function Explorer() {
  const { data, open, openTicket, setModal, setBoardProject, boardProject } = useAdminCtx();
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
      <h3>Projects {data.access?.canUseWorkbench ? <Button kind="ghost" size="sm" title="New project" onClick={() => setModal({ kind: 'project' })}><Icon name="plus" size={12} /></Button> : null}</h3>
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
                    open(`p:${p.id}`);
                  }}
                  title={`Open ${p.name}`}
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

      {data.access?.superAdmin ? <>
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
      </> : null}
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
      {data.access?.superAdmin ? <>
      <button type="button" onClick={() => open('fleet')}>
        <Dot state={online === data.nodes.length && online ? 'ok' : online ? 'warn' : 'bad'} /> {online}/{data.nodes.length} nodes online
      </button>
      <button type="button" onClick={() => open('fleet')}>
        {data.running.length} running
      </button>
      <button type="button" onClick={() => open('fleet')}>
        {waiting} queued{stuck ? ` · ${stuck} stuck` : ''}
      </button>
      </> : <span>{data.projects.length} projects</span>}
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
      ...(data.access?.canUseWorkbench ? [{ label: 'New project…', hint: 'command', run: () => setModal({ kind: 'project' }) }] : []),
      { label: 'Refresh', hint: 'command', run: () => void reload() },
      ...VIEWS.filter((v) => workbenchAllowed(v.key, data.access)).map((v) => ({ label: `Go to ${v.label}`, hint: 'view', run: () => open(v.key) })),
      ...data.projects.map((p) => ({ label: p.name, hint: 'project', run: () => open(`p:${p.id}`) })),
      ...data.tickets.map((t) => ({ label: `#${t.id} ${t.title}`, hint: `${STATUS_LABEL[t.status]} · ${t.project_name ?? 'no project'}`, run: () => openTicket(t.id) })),
    ];
    const needle = q.trim().toLowerCase();
    if (!needle) return cmds.slice(0, 40);
    return cmds.filter((c) => `${c.label} ${c.hint}`.toLowerCase().includes(needle)).slice(0, 40);
  }, [q, data, open, openTicket, setModal, reload]);
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

export function TaskModal({ preset = {}, onClose }) {
  const { api, data, act, openTicket } = useAdminCtx();
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [projectId, setProjectId] = useState(preset.projectId ?? (data.projects.length === 1 ? data.projects[0].id : ''));
  const [priority, setPriority] = useState(data.settings?.defaultPriority ?? 0);
  const [executor, setExecutor] = useState(null);
  const [requires, setRequires] = useState([]);
  const [approve, setApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const slug = data.projects.find((p) => p.id === projectId)?.slug ?? null;
  const where = predict(data.nodes, { slug, requires, executor, kind: 'system' });
  const caps = data.catalog?.capabilities ?? [];
  const submitRef = useRef(null);
  if (!submitRef.current) submitRef.current = createTaskSubmission((body) =>
    act(() => api('POST', '/admin/work', body), (o) => `Saved #${o.id}${body.approve ? ' and queued it' : ' as a draft'}.`));
  const busyRef = useRef(false);
  const submit = async () => {
    if (busyRef.current || !title.trim() || !brief.trim() || !projectId) return;
    busyRef.current = true;
    const pending = submitRef.current({ title, brief, projectId, priority, requires, executor, approve });
    setBusy(true);
    try {
      const out = await pending;
      if (out) { onClose(); openTicket(out.id); }
    } catch { /* act displays the error; keep the form for retry. */ }
    finally { busyRef.current = false; setBusy(false); }
  };
  return (
    <Modal
      title="New task"
      subtitle="Your own work on one of your projects. The brief is trusted guidance for the agent."
      onClose={() => !busyRef.current && onClose()}
      wide
      actions={
        <>
          {data.access?.superAdmin ? <span className={`aw-predict aw-predict--${where.state}`}>
            <Dot state={where.state} /> {where.text}
          </span> : <span className="aw-muted">{approve ? 'The agent will be queued.' : 'Draft only · no agent starts.'}</span>}
          <Button disabled={busy} onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={busy || !title.trim() || !brief.trim() || !projectId} onClick={submit}>
            {busy ? 'Saving…' : approve ? 'Save and queue agent' : 'Save draft'}
          </Button>
        </>
      }
    >
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <Field label="Title">
        <input disabled={busy} value={title} maxLength={140} placeholder="Fix the checkout total rounding" onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Brief" hint="What to change, where, and how to check it.">
        <textarea
          disabled={busy}
          rows={7}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void submit(); } }}
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
          <Segmented value={executor} options={AGENTS} onChange={setExecutor} />
        </Field>
        <Field label="Start">
          <Segmented value={approve} disabled={busy} options={[{ value: false, label: 'Save draft' }, { value: true, label: 'Queue agent' }]} onChange={setApprove} />
        </Field>
      </div>
      {caps.length ? (
        <Field label="Needs" hint="Only nodes with all of these take it.">
          <Chips value={requires} options={caps.map((c) => ({ value: c.id, label: c.label, hint: c.hint }))} onChange={setRequires} />
        </Field>
      ) : null}
      </fieldset>
    </Modal>
  );
}

export function ProjectModal({ onClose }) {
  const { api, act, host, open, data, notify } = useAdminCtx();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [edited, setEdited] = useState(false);
  const [kind, setKind] = useState('existing');
  const [code, setCode] = useState('create');
  const [repo, setRepo] = useState('');
  const [what, setWhat] = useState('');
  const [goal, setGoal] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [localPath, setLocalPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [setupError, setSetupError] = useState(null);
  const submission = useRef(null);
  const busyRef = useRef(false);
  if (!submission.current) submission.current = createProjectSubmission(
    (input) => act(async () => {
      const request = projectCreationRequest(input, data.access);
      const result = await api('POST', request.path, request.body);
      setReceipt(result);
      if (result.repoError) notify?.(`Project created; repository setup needs attention: ${result.repoError}`, 'error');
      return result.project ?? result;
    }),
    (project, input) => input.localPath ? host.projectConfigureLocal({ projectId: project.id, path: input.localPath }) : Promise.resolve(),
    { requireSlug: Boolean(data.access?.superAdmin) },
  );
  const created = submission.current.project;
  const ready = name.trim() && (!data.access?.superAdmin || /^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) && (code !== 'repo' || repo.trim()) && (data.access?.superAdmin || (what.trim() && goal.trim()));
  const go = (project) => { onClose(); open(`p:${project.id}`); };
  const submit = async () => {
    if (busyRef.current || !ready) return;
    busyRef.current = true; setBusy(true); setSetupError(null);
    try {
      const project = await submission.current({ name, slug, kind, code, repo: code === 'repo' ? repo.trim() : undefined, brief: { what: what.trim(), goal: goal.trim() }, localPath: localPath.trim() });
      if (project) go(project);
    } catch (error) { setSetupError(errorText(error)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return (
    <Modal
      title="New project"
      subtitle="Create the project, then choose where to develop it."
      onClose={() => !busyRef.current && onClose()}
      actions={
        <>
          <Button disabled={busy} onClick={() => created ? go(created) : onClose()}>{created ? 'Open project' : 'Cancel'}</Button>
          <Button kind="primary" disabled={busy || !ready} onClick={submit}>
            {busy ? 'Saving…' : created ? 'Retry local setup' : 'Create project'}
          </Button>
        </>
      }
    >
      {receipt?.repoError ? <p role="status" className="aw-callout">Project created; repository setup needs attention: {String(receipt.repoError)}</p> : null}
      {setupError ? <p role="alert" className="aw-callout">{created ? 'Project created. Local setup failed; retry does not create another project. ' : ''}{setupError}</p> : null}
      <fieldset disabled={busy || Boolean(created)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
      {data.access?.superAdmin ? <Field label="Slug" hint="Lowercase and dashes.">
        <input
          className="aw-mono"
          value={slug}
          maxLength={63}
          onChange={(e) => {
            setEdited(true);
            setSlug(e.target.value.toLowerCase());
          }}
        />
      </Field> : null}
      {!data.access?.superAdmin ? <>
        <Field label="What are you building?"><textarea value={what} maxLength={4000} onChange={(e) => setWhat(e.target.value)} /></Field>
        <Field label="What should happen first?"><textarea value={goal} maxLength={4000} onChange={(e) => setGoal(e.target.value)} /></Field>
      </> : null}
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
              : data.access?.superAdmin ? 'A node with a folder named like the slug shares its origin.' : 'Create the project without linking a repository yet.'
        }
      >
        <Segmented
          value={code}
          options={[
            { value: 'create', label: 'Create a repo' },
            { value: 'repo', label: 'Use a repo URL' },
            { value: 'folder', label: data.access?.superAdmin ? 'Folder on a node' : 'Not linked yet' },
          ]}
          onChange={setCode}
        />
      </Field>
      {code === 'repo' ? (
        <Field label="Repo URL">
          <input className="aw-mono" value={repo} maxLength={300} placeholder="https://github.com/owner/repo" onChange={(e) => setRepo(e.target.value)} />
        </Field>
      ) : null}
      </fieldset>
      {host?.projectConfigureLocal ? <Field label="Local checkout folder (optional)" hint="Map an existing checkout on this computer. This does not clone a repository.">
        <input disabled={busy} value={localPath} placeholder="/Users/you/Projects/acme" onChange={(e) => setLocalPath(e.target.value)} />
      </Field> : null}
    </Modal>
  );
}


/** The project cockpit outside the workbench, with real navigation and dialogs. */
export function ProjectPage({ api, id, host = null, files = null }) {
  const [data, reload] = useAdminData(api);
  const [navigation, setNavigation] = useState({ id, destination: `p:${id}` });
  const destination = navigation.id === id ? navigation.destination : `p:${id}`;
  const [modal, setModal] = useState(null);
  const [question, setQuestion] = useState(null);
  const [notice, setNotice] = useState(null);
  const [boardProject, setBoardProject] = useState(id);
  const open = useCallback((key) => {
    if (key.startsWith('p:') && host?.openProject) return host.openProject(key.slice(2));
    if (key.startsWith('t:') && host?.openTicket) return host.openTicket(Number(key.slice(2)));
    setNavigation({ id, destination: key });
  }, [host, id]);
  const openTicket = useCallback((target) => open(`t:${target}`), [open]);
  const notify = useCallback((text, kind = 'ok') => { setNotice({ text, kind }); host?.notify?.(text); }, [host]);
  const act = useCallback(async (run, done) => {
    try {
      const result = await run();
      if (done) notify(typeof done === 'function' ? done(result) : done);
      void reload();
      return result;
    } catch (error) { notify(errorText(error), 'error'); throw error; }
  }, [notify, reload]);
  const setStatus = useCallback((ticket, status) => {
    const run = () => act(() => api('PATCH', `/admin/tickets/${ticket.id}`, { status }));
    if (ticket.kind !== 'system' && CLIENT_VISIBLE.includes(status)) {
      setQuestion({ title: `${STATUS_LABEL[status]}: #${ticket.id}?`, text: 'The client is emailed about this change.', confirm: STATUS_LABEL[status], run });
      return Promise.resolve();
    }
    return run();
  }, [act, api]);
  const value = { api, files, host, platform: host ? 'dsh' : 'web', data, reload, open, openTicket, notify, act, setStatus, ask: setQuestion, setModal, boardProject, setBoardProject };
  return <div className={cx('aw', host && 'aw--dsh')} style={{ display: 'block', height: '100%', overflowY: 'auto' }}>
    <style>{STYLES}</style>
    <AdminContext.Provider value={value}>
      {destination.startsWith('p:') ? <ProjectView key={destination} id={destination.slice(2)} /> : destination.startsWith('t:') ? <TicketView key={destination} id={Number(destination.slice(2))} active /> : workbenchAllowed(destination, data.access) ? <View name={destination} /> : <p className="aw-empty">This destination requires administrator access.</p>}
      {notice ? <div role="status" className={cx('aw-toast', notice.kind === 'error' && 'is-error')} onClick={() => setNotice(null)}>{notice.text}</div> : null}
      {modal?.kind === 'task' ? <TaskModal preset={modal} onClose={() => setModal(null)} /> : null}
      {modal?.kind === 'project' && data.access?.canUseWorkbench ? <ProjectModal onClose={() => setModal(null)} /> : null}
      {modal?.kind === 'custom' ? modal.render(() => setModal(null)) : null}
      {question ? <Confirm ask={question} onClose={() => setQuestion(null)} /> : null}
    </AdminContext.Provider>
  </div>;
}


/**
 * The AdminContext a standalone ticket host has to supply, gathered once so the
 * details pane and the whole page cannot answer differently. `files` is how the
 * host saves attachments (a download); `host.upload` is how it sends them, and
 * a host without one simply gets no attach control.
 */
function ticketContext({ api, data, reload, host, files }) {
  return {
    api,
    files: files ?? null,
    data,
    reload,
    platform: 'dsh',
    host,
    open: () => {},
    openTicket: (target) => host?.openTicket?.(target),
    setStatus: async (target, status) => {
      await api('PATCH', `/admin/tickets/${target.id}`, { status });
      reload();
    },
    act: async (run, done) => {
      try {
        await run();
        if (done) host?.notify?.(done);
      } finally {
        reload();
      }
    },
    notify: (text) => host?.notify?.(text),
    ask: (question) => {
      if (typeof window !== 'undefined' && window.confirm(`${question.title}\n\n${question.text ?? ''}`)) {
        void question.run?.();
      }
    },
    setModal: () => {},
    boardProject: 'all',
    setBoardProject: () => {},
  };
}

/**
 * The ticket's details panel on its own, for a host that shows one ticket
 * outside the workbench — a side pane. It renders the same `TicketDetails`
 * component the admin ticket view does, with the same data and the same styles,
 * so the two cannot drift.
 */
export function TicketSidePanel({ api, host = null, ticketId, page = false }) {
  const [data, reloadData] = useAdminData(api);
  const [{ ticket, runs, land, loading }, reloadTicket] = useTicket(api, ticketId);
  const meter = useMeter(api, ticket, Boolean(ticket));
  const reload = useCallback(() => {
    void reloadData();
    void reloadTicket();
  }, [reloadData, reloadTicket]);

  // The host as given: the pane offers what its host can do (Git Graph, the
  // Admin copy of the ticket) and nothing it cannot.
  const value = useMemo(() => ticketContext({ api, data, reload, host, files: null }), [api, data, reload, host]);

  // The theme lives on `.aw` (every `--aw-*` variable is defined there). Without
  // it the panel renders with no accent, no panel background and the wrong ink —
  // which is exactly how it looked in the conversation's side pane. Block
  // layout, because `.aw` is also the app shell's grid. As a page, the host
  // scrolls and this only sets the frame.
  const scope = page
    ? { display: 'block', padding: '18px 24px 28px', maxWidth: 820, margin: '0 auto' }
    : { display: 'block', height: '100%', overflowY: 'auto' };
  if (loading && !ticket) {
    return (
      <div className="aw" style={scope}>
        <style>{STYLES}</style>
        <p className="aw-muted" style={{ padding: 12, fontSize: 12 }}>Loading ticket…</p>
      </div>
    );
  }
  if (!ticket) {
    return (
      <div className="aw" style={scope}>
        <style>{STYLES}</style>
        <p className="aw-muted" style={{ padding: 12, fontSize: 12 }}>That ticket is not available.</p>
      </div>
    );
  }
  return (
    <div className="aw aw--dsh" style={scope}>
      <style>{STYLES}</style>
      <AdminContext.Provider value={value}>
        <TicketDetails ticket={ticket} runs={runs} land={land} meter={meter} reload={reload} page={page} />
      </AdminContext.Provider>
    </div>
  );
}

/**
 * The whole ticket — its thread, the composer, the review card, the runs and
 * the details column — on its own, for a host that shows a ticket outside the
 * workbench: the Harness conversation's Ticket view. Same `TicketView`, data
 * hooks, provider and styles as the workbench page, so the two cannot drift.
 */
export function TicketPage({ api, host = null, files = null, ticketId, part = 'thread', autoMeter = true }) {
  // A host with a narrow conversation shows the details as a tab of their own
  // (`part: 'details'`) rather than as a column that squeezes the thread.
  if (part === 'details') return <TicketSidePanel api={api} host={host} ticketId={ticketId} page />;
  return <TicketThread api={api} host={host} files={files} ticketId={ticketId} autoMeter={autoMeter} />;
}

/**
 * One client's page on its own, for a host that gives each client a place of
 * its own (the Harness sidebar). A ticket opens through `host.openTicket`.
 */
export function ClientPage({ api, host = null, files = null, clientId }) {
  const [data, reloadData] = useAdminData(api);
  const reload = useCallback(() => {
    void reloadData();
  }, [reloadData]);
  const value = useMemo(() => ticketContext({ api, data, reload, host, files }), [api, data, reload, host, files]);
  return (
    <div className="aw aw--dsh" style={{ display: 'block', height: '100%', overflowY: 'auto' }}>
      <style>{STYLES}</style>
      <AdminContext.Provider value={value}>
        {data.error ? <p className="aw-empty">{errorText(data.error)}</p> : <ClientView id={clientId} />}
      </AdminContext.Provider>
    </div>
  );
}

function TicketThread({ api, host, files, ticketId, autoMeter }) {
  const [data, reloadData] = useAdminData(api);
  const reload = useCallback(() => {
    void reloadData();
  }, [reloadData]);
  const value = useMemo(() => ticketContext({ api, data, reload, host, files }), [api, data, reload, host, files]);
  // `.aw` scopes the panel's variables; block layout, because `.aw` is also the
  // app shell's grid. The page scrolls inside the tab, not the conversation.
  const scope = { display: 'block', height: '100%', overflowY: 'auto' };
  return (
    <div className="aw aw--dsh" style={scope}>
      <style>{STYLES}</style>
      <AdminContext.Provider value={value}>
        <TicketView id={ticketId} active={autoMeter} details={false} />
      </AdminContext.Provider>
    </div>
  );
}
