/*
 * The admin workbench: an activity bar, an explorer, tabs, and a status bar,
 * like an editor; boards, lists and ticket pages, like a task tracker.
 * Geometry, keys and states: docs/admin-ui-refresh/01-ui-contract.md.
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
import { Button, Chips, Confirm, Dot, Field, Icon, Modal, Resizer, Segmented, Skeleton, Toast, cx, layerOpen, useContextMenu } from './ui.jsx';
import { BoardView, InboxView, ListView } from './board.jsx';
import { TicketDetails, TicketView } from './ticket.jsx';
import { InjectedStyles } from './ui/injected-styles.js';
import { ClientView, ClientsView, FleetView, SettingsView } from './fleet.jsx';
import { isSettingsKey, settingsSection } from './settings-link.js';
import { MachineOnboarding, MachineStatusPill } from './machine.jsx';
import { MarketingView } from './marketing.jsx';
import { SeoView } from './seo.jsx';
import { HealthView } from './health.jsx';
import { STYLES } from './styles.js';
import { ProjectView } from './project.jsx';
import { createTaskSubmission, createProjectSubmission, destinationFromHash, workbenchAllowed, projectCreationRequest } from './workbench.js';

/** The destinations, in shortcut order. Settings sits at the foot of the bar. */
const VIEWS = [
  { key: 'inbox', label: 'Needs you', icon: 'inbox' },
  { key: 'board', label: 'Board', icon: 'board' },
  { key: 'list', label: 'All work', icon: 'list' },
  { key: 'marketing', label: 'Marketing', icon: 'megaphone' },
  { key: 'seo', label: 'SEO', icon: 'seo' },
  { key: 'fleet', label: 'Fleet', icon: 'fleet' },
  { key: 'clients', label: 'Clients', icon: 'clients' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];
const viewOf = (key) => VIEWS.find((v) => v.key === key);
// Health is folded into Fleet: an old tab or hash still lands somewhere.
// Every Settings address (settings#seo, settings/marketing) is the one Settings
// tab; SettingsView reads the section from the link or the page hash.
const aliasView = (key) => (key === 'health' ? 'fleet' : isSettingsKey(key) ? 'settings' : key);
const TABS_KEY = 'aw-tabs-v1';
const NARROW_WIDTH = '(max-width: 900px)';
const domId = (prefix, key) => `${prefix}-${String(key).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const MOD = isMac ? '⌘' : 'Ctrl+';
/** The browser keeps ⌘1…8 and ⌘W for itself; the Harness hands them to us. */
const viewKey = (platform, n) => (platform === 'dsh' ? `${MOD}${n}` : `${isMac ? '⌃⌥' : 'Ctrl+Alt+'}${n}`);
const closeKey = (platform) => (platform === 'dsh' ? `${MOD}W` : `${isMac ? '⌃⌥' : 'Ctrl+Alt+'}W`);

function loadTabs() {
  try {
    const saved = JSON.parse(localStorage.getItem(TABS_KEY) ?? 'null');
    if (saved && Array.isArray(saved.tabs) && saved.tabs.length) {
      const tabs = saved.tabs.map(aliasView);
      const active = aliasView(saved.active ?? tabs[0]);
      return { tabs, active: tabs.includes(active) ? active : tabs[0] };
    }
  } catch {
    /* fresh */
  }
  return { tabs: ['inbox', 'board'], active: 'inbox' };
}

const typingIn = (el) => el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || el?.isContentEditable;

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

/**
 * The actions every admin surface shares: report a result as a toast, confirm a
 * client-visible status change, and reload after either. One implementation, so
 * the shell, a standalone project page and a ticket pane cannot drift.
 */
function useWorkbenchActions({ api, reload, setAsk, onNotify }) {
  const [toast, setToast] = useState(null);
  const notify = useCallback((text, kind = 'ok') => {
    setToast({ text, kind, at: Date.now() });
    onNotify?.(text, kind);
  }, [onNotify]);
  const dismissToast = useCallback(() => setToast(null), []);
  useEffect(() => {
    // An error stays until dismissed; a result goes away on its own.
    if (!toast || toast.kind === 'error') return undefined;
    const id = setTimeout(() => setToast(null), 3000);
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
            text: `${ticket.client_email ?? ticket.clientEmail ?? 'The client'} is emailed about this change.`,
            confirm: STATUS_LABEL[status],
            run: () => run().then(resolve, resolve),
          }),
        );
      }
      return run().catch(() => undefined);
    },
    [act, api, setAsk],
  );

  return { notify, act, setStatus, toast, dismissToast };
}

export function AdminApp({ api, platform = 'web', host = null, fullscreen = false, files = null }) {
  const rootRef = useRef(null);
  const underButtons = useUnderWindowButtons(rootRef, platform === 'dsh');
  const [data, reload] = useAdminData(api);
  const [{ tabs, active }, setTabs] = useState(loadTabs);
  const [boardProject, setBoardProject] = useState('all');
  const [modal, setModal] = useState(null);
  const [ask, setAsk] = useState(null);
  const [palette, setPalette] = useState(false);
  const [keys, setKeys] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(NARROW_WIDTH).matches));
  const tabRefs = useRef({});
  const { notify, act, setStatus, toast, dismissToast } = useWorkbenchActions({ api, reload, setAsk });
  const signedOut = data.error && ['unauthorized', 'signed_out', 'forbidden'].includes(data.error.code);

  useEffect(() => {
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, active }));
    } catch {
      /* private mode */
    }
  }, [tabs, active]);

  // The explorer is a column on a wide window and an overlay drawer on a narrow one.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia(NARROW_WIDTH);
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  const open = useCallback((key) => {
    const target = aliasView(key);
    if (!target) return undefined;
    setDrawer(false);
    if (target.startsWith('p:') && host?.openProject) return host.openProject(target.slice(2));
    setTabs((s) => ({ tabs: s.tabs.includes(target) ? s.tabs : [...s.tabs, target], active: target }));
    return undefined;
  }, [host]);
  const closeMany = useCallback(
    (drop) =>
      setTabs((s) => {
        const gone = new Set(drop(s.tabs));
        const next = s.tabs.filter((t) => !gone.has(t));
        if (!next.length) return { tabs: ['inbox'], active: 'inbox' };
        if (!gone.has(s.active)) return { tabs: next, active: s.active };
        const i = s.tabs.indexOf(s.active);
        const left = s.tabs.slice(0, i).reverse().find((t) => !gone.has(t));
        return { tabs: next, active: left ?? next[0] };
      }),
    [],
  );
  const close = useCallback((key) => closeMany(() => [key]), [closeMany]);
  const openTicket = useCallback((id) => open(`t:${id}`), [open]);

  // Links in Ali's notification mail end in #ticket=<id>: open that ticket.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const fromHash = () => {
      const hash = window.location.hash.slice(1);
      const destination = destinationFromHash(hash);
      if (destination) open(destination);
      // Notification mail links to #marketing; a view name is a valid target too.
      const view = aliasView(hash);
      if (viewOf(view)) open(view);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [open, openTicket]);

  const toggleExplorer = useCallback(() => {
    if (narrow) setDrawer((d) => !d);
    else setSidebar((s) => !s);
  }, [narrow]);

  const allowedViews = VIEWS.filter((v) => workbenchAllowed(v.key, data.access));
  const visibleTabs = tabs.filter((key) => workbenchAllowed(key, data.access));

  // The keyboard map (contract §6). Every shortcut stands down while a text
  // field has focus (except the modifier ones) or a layer is open.
  const shell = useRef({});
  shell.current = { palette, modal, ask, keys, ready: data.loaded && !signedOut, active, visibleTabs, allowedViews, drawer };
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const state = shell.current;
      const typing = typingIn(e.target);
      const viaWeb = e.ctrlKey && e.altKey;
      if (mod && !e.altKey && key === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (layerOpen() || state.palette) return;
      if (mod && !e.altKey && key === 'b') {
        e.preventDefault();
        toggleExplorer();
        return;
      }
      // ⌘1…8 in the Harness; Ctrl+Alt+1…8 anywhere (the browser keeps ⌘digits).
      const digit = /^Digit([1-8])$/.exec(e.code)?.[1];
      if (digit && state.ready && ((platform === 'dsh' && mod && !e.altKey) || viaWeb)) {
        const view = VIEWS[Number(digit) - 1];
        if (view && workbenchAllowed(view.key, data.access)) {
          e.preventDefault();
          open(view.key);
        }
        return;
      }
      if (e.code === 'KeyW' && ((platform === 'dsh' && mod && !e.altKey) || viaWeb)) {
        e.preventDefault();
        if (state.active) close(state.active);
        return;
      }
      if (e.ctrlKey && e.key === 'Tab' && state.visibleTabs.length > 1) {
        e.preventDefault();
        const i = state.visibleTabs.indexOf(state.active);
        const next = state.visibleTabs[(i + (e.shiftKey ? -1 : 1) + state.visibleTabs.length) % state.visibleTabs.length];
        setTabs((s) => ({ ...s, active: next }));
        return;
      }
      if (e.key === 'Escape') {
        if (state.drawer) setDrawer(false);
        return;
      }
      if (typing || mod || e.altKey || !state.ready || state.modal || state.ask) return;
      if (key === 'n') {
        e.preventDefault();
        setModal({ kind: 'task' });
      } else if (e.key === '?') {
        e.preventDefault();
        setKeys(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleExplorer, open, close, platform, data.access]);

  useEffect(() => {
    if (data.loaded && !workbenchAllowed(active, data.access)) open('board');
  }, [data.loaded, data.access, active, open]);

  // The active tab is always in view, however many are open.
  useEffect(() => {
    tabRefs.current[active]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  const ctx = useMemo(
    () => ({ api, files, data, reload, platform, host, open, openTicket, setStatus, act, notify, ask: setAsk, setModal, boardProject, setBoardProject, activeTab: active, closeTab: close }),
    [api, files, data, reload, platform, host, open, openTicket, setStatus, act, notify, boardProject, active, close],
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

  // A tablist behaves like a tablist: arrows move and activate, Home/End jump.
  const shiftTab = (e, key) => {
    const i = visibleTabs.indexOf(key);
    if (i < 0) return;
    let next = null;
    if (e.key === 'ArrowRight') next = visibleTabs[(i + 1) % visibleTabs.length];
    else if (e.key === 'ArrowLeft') next = visibleTabs[(i - 1 + visibleTabs.length) % visibleTabs.length];
    else if (e.key === 'Home') next = visibleTabs[0];
    else if (e.key === 'End') next = visibleTabs[visibleTabs.length - 1];
    else if (e.key === 'Delete') {
      e.preventDefault();
      close(key);
      return;
    }
    if (next == null) return;
    e.preventDefault();
    setTabs((s) => ({ ...s, active: next }));
    tabRefs.current[next]?.focus();
  };

  const showExplorer = (!narrow && sidebar) || (narrow && drawer);
  const main = allowedViews.filter((v) => v.key !== 'settings');
  const settingsView = allowedViews.find((v) => v.key === 'settings');
  const activityButton = (v) => (
    <button
      key={v.key}
      type="button"
      aria-label={v.label}
      aria-current={active === v.key ? 'page' : undefined}
      aria-keyshortcuts={platform === 'dsh' ? `Meta+${VIEWS.indexOf(v) + 1}` : `Control+Alt+${VIEWS.indexOf(v) + 1}`}
      data-tip={`${v.label}  ${viewKey(platform, VIEWS.indexOf(v) + 1)}`}
      data-tip-side="right"
      onClick={() => open(v.key)}
    >
      <Icon name={v.icon} size={20} />
      {v.key === 'inbox' && inboxCount ? <span className="aw-badge" aria-label={`${inboxCount} need you`}>{inboxCount}</span> : null}
    </button>
  );

  return (
    <AdminContext.Provider value={ctx}>
      <InjectedStyles id="aw-app-styles" css={STYLES} />
      <div ref={rootRef} className={cx('aw', fullscreen && 'aw--fullscreen', `aw--${platform}`, underButtons && 'aw--inset', !showExplorer && 'aw--noexplorer')}>
        <nav className="aw-activity" aria-label="Views">
          {main.map(activityButton)}
          <span className="aw-activity__spacer" />
          <button type="button" aria-label="New task" aria-keyshortcuts="N" data-tip="New task  N" data-tip-side="right" onClick={() => setModal({ kind: 'task' })}>
            <Icon name="plus" size={20} />
          </button>
          <button type="button" aria-label="Search and commands" aria-keyshortcuts="Meta+K Control+K" data-tip={`Search and commands  ${MOD}K`} data-tip-side="right" onClick={() => setPalette(true)}>
            <Icon name="search" size={20} />
          </button>
          {settingsView ? activityButton(settingsView) : null}
        </nav>

        {narrow && drawer ? <div className="aw-drawer-scrim" onClick={() => setDrawer(false)} /> : null}
        {showExplorer ? <Explorer drawer={narrow} /> : null}
        {!narrow && sidebar ? <Resizer host=".aw" cssVar="--aw-explorer-w" def={260} min={180} max={520} storage="aw.explorer.w" className="aw-resize--explorer" /> : null}

        <main className="aw-main">
          <div className="aw-tabs">
            <Button
              kind="ghost"
              size="sm"
              className="aw-tabs__toggle"
              aria-label={showExplorer ? 'Hide explorer' : 'Show explorer'}
              aria-expanded={showExplorer}
              aria-keyshortcuts="Meta+B Control+B"
              title={`${showExplorer ? 'Hide' : 'Show'} explorer (${MOD}B)`}
              onClick={toggleExplorer}
            >
              <Icon name="sidebar" size={16} />
            </Button>
            <div className="aw-tablist" role="tablist" aria-label="Open views">
              {visibleTabs.map((key) => (
                <Tab
                  key={key}
                  tabKey={key}
                  active={key === active}
                  label={tabLabel(key)}
                  icon={key.startsWith('p:') ? 'folder' : key.startsWith('t:') ? 'ticket' : key.startsWith('c:') ? 'clients' : viewOf(key)?.icon ?? 'list'}
                  closeShortcut={closeKey(platform)}
                  refFn={(node) => {
                    if (node) tabRefs.current[key] = node;
                    else delete tabRefs.current[key];
                  }}
                  onSelect={() => setTabs((s) => ({ ...s, active: key }))}
                  onClose={() => close(key)}
                  onCloseOthers={() => closeMany((all) => all.filter((t) => t !== key))}
                  onCloseRight={() => closeMany((all) => all.slice(all.indexOf(key) + 1))}
                  isLast={visibleTabs[visibleTabs.length - 1] === key}
                  only={visibleTabs.length === 1}
                  onKeyDown={(e) => shiftTab(e, key)}
                />
              ))}
            </div>
          </div>

          <div className="aw-content">
            {!signedOut && data.error && data.loaded ? (
              <div className="aw-topbanner" role="alert">
                <span>{errorText(data.error)}{data.fetchedAt ? ` Showing data from ${new Date(data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ''}</span>
                <Button size="sm" onClick={() => void reload()}>
                  Retry
                </Button>
              </div>
            ) : null}
            {signedOut ? (
              <SignedOut />
            ) : !data.loaded ? (
              <div className="aw-loading--fill">
                <Skeleton variant="pane" label="Loading the workbench…" />
              </div>
            ) : (
              visibleTabs.map((key) => (
                <section key={key} id={domId('aw-pane', key)} role="tabpanel" aria-labelledby={domId('aw-tab', key)} className="aw-pane" hidden={key !== active}>
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

        <StatusBar onPalette={() => setPalette(true)} onKeys={() => setKeys(true)} />

        <Toast toast={toast} onDismiss={dismissToast} />
        {palette ? <Palette onClose={() => setPalette(false)} onKeys={() => setKeys(true)} toggleExplorer={toggleExplorer} /> : null}
        {keys ? <ShortcutSheet onClose={() => setKeys(false)} /> : null}
        <MachineOnboarding />
        {modal?.kind === 'task' ? <TaskModal preset={modal} onClose={() => setModal(null)} /> : null}
        {modal?.kind === 'project' ? <ProjectModal onClose={() => setModal(null)} /> : null}
        {modal?.kind === 'custom' ? modal.render(() => setModal(null)) : null}
        {ask ? <Confirm ask={ask} onClose={() => setAsk(null)} /> : null}
      </div>
    </AdminContext.Provider>
  );
}

/** One tab: click selects, middle-click closes, right-click (or Shift+F10) opens its menu. */
function Tab({ tabKey, active, label, icon, refFn, onSelect, onClose, onCloseOthers, onCloseRight, isLast, only, onKeyDown, closeShortcut }) {
  const ctxMenu = useContextMenu(() => [
    { label: 'Close', shortcut: closeShortcut, run: onClose },
    { label: 'Close others', run: onCloseOthers, disabled: only, disabledReason: 'This is the only tab.' },
    { label: 'Close tabs to the right', run: onCloseRight, disabled: isLast, disabledReason: 'No tabs to the right.' },
  ], 'Tab actions');
  return (
    <div
      ref={refFn}
      role="tab"
      id={domId('aw-tab', tabKey)}
      aria-selected={active}
      aria-controls={domId('aw-pane', tabKey)}
      tabIndex={active ? 0 : -1}
      className={cx('aw-tab', active && 'is-active')}
      onClick={onSelect}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => e.button === 1 && onClose()}
      onContextMenu={ctxMenu.bind.onContextMenu}
      onKeyDown={(e) => {
        ctxMenu.bind.onKeyDown(e);
        if (!e.defaultPrevented) onKeyDown(e);
      }}
      title={label}
    >
      <Icon name={icon} size={14} />
      <span className="aw-tab__label">{label}</span>
      <button
        type="button"
        className="aw-tab__close"
        aria-label={`Close ${label}`}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <Icon name="close" size={12} />
      </button>
      {ctxMenu.menu}
    </div>
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
      if (isSettingsKey(name)) return <SettingsView section={settingsSection(name) ?? undefined} />;
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
      {platform === 'dsh' ? <SettingsView section="account" /> : null}
    </div>
  );
}

/* ————— the explorer: projects as folders, their open work ————— */

const NEEDS_YOU = new Set(['new', 'review']);

function Explorer({ drawer = false }) {
  const { data, open, openTicket, setModal, setBoardProject, boardProject, activeTab } = useAdminCtx();
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
    <aside className={cx('aw-explorer', drawer && 'aw-explorer--drawer')} aria-label="Explorer">
      <h3>
        Projects
        {data.access?.canUseWorkbench ? <Button kind="ghost" size="sm" iconOnly icon="plus" aria-label="New project" onClick={() => setModal({ kind: 'project' })} /> : null}
      </h3>
      <ul className="aw-tree" role="tree" aria-label="Projects and open work">
        {data.projects.map((p) => {
          const items = (byProject.get(p.id) ?? []).filter(live);
          const expanded = openSlug[p.id] ?? items.length > 0;
          return (
            <ExplorerProject
              key={p.id}
              project={p}
              items={items}
              expanded={expanded}
              selected={activeTab === `p:${p.id}` || boardProject === p.id}
              activeTab={activeTab}
              running={runningTicket}
              onToggle={() => setOpenSlug((s) => ({ ...s, [p.id]: !expanded }))}
              onOpen={() => {
                setBoardProject(p.id);
                open(`p:${p.id}`);
              }}
              onBoard={() => {
                setBoardProject(p.id);
                open('board');
              }}
              onTask={() => setModal({ kind: 'task', projectId: p.id })}
              openTicket={openTicket}
            />
          );
        })}
        {!data.projects.length ? <li className="aw-tree__none" role="none">No projects yet</li> : null}
      </ul>
    </aside>
  );
}

function ExplorerProject({ project: p, items, expanded, selected, activeTab, running, onToggle, onOpen, onBoard, onTask, openTicket }) {
  const menu = useContextMenu([
    { label: 'Open project', run: onOpen },
    { label: 'Show on the board', run: onBoard },
    { label: 'New task in this project…', shortcut: 'N', run: onTask },
    { separator: true },
    { label: expanded ? 'Collapse' : 'Expand', run: onToggle },
  ], `${p.name} actions`);
  return (
    <li role="treeitem" aria-expanded={expanded} aria-selected={selected}>
      <div className={cx('aw-tree__row', selected && 'is-active')} {...menu.bind}>
        <button type="button" className="aw-tree__twist" onClick={onToggle} aria-expanded={expanded} aria-label={expanded ? `Collapse ${p.name}` : `Expand ${p.name}`}>
          <Icon name="chevron" size={12} />
        </button>
        <button type="button" className="aw-tree__name" onClick={onOpen} title={`Open ${p.name}`}>
          <Icon name="folder" size={14} /> <span>{p.name}</span>
        </button>
        {items.length ? <span className="aw-count" aria-label={`${items.length} open`}>{items.length}</span> : null}
      </div>
      {expanded ? (
        <ul role="group">
          {items.map((t) => (
            <ExplorerTicket key={t.id} t={t} active={activeTab === `t:${t.id}`} running={running.has(t.id)} openTicket={openTicket} />
          ))}
          {!items.length ? <li className="aw-tree__none" role="none">No open work</li> : null}
        </ul>
      ) : null}
      {menu.menu}
    </li>
  );
}

function ExplorerTicket({ t, active, running, openTicket }) {
  const { platform } = useAdminCtx();
  const menu = useContextMenu([
    { label: 'Open', run: () => openTicket(t.id) },
    {
      label: 'Copy link',
      run: () => void navigator.clipboard?.writeText(`${platform === 'web' ? location.origin + location.pathname : 'https://ptechsolutions.net/portal/admin'}#ticket=${t.id}`),
    },
  ], `#${t.id} actions`);
  const state = running ? 'live' : NEEDS_YOU.has(t.status) ? 'needs' : 'open';
  const stateText = running ? 'agent running' : STATUS_LABEL[t.status] ?? t.status;
  return (
    <li role="treeitem" aria-selected={active}>
      <div className={cx('aw-tree__leafrow', active && 'is-active')} {...menu.bind}>
        <button type="button" className="aw-tree__leaf" onClick={() => openTicket(t.id)} title={`#${t.id} ${t.title} · ${stateText}`}>
          <span className={cx('aw-mark', state !== 'open' && `aw-mark--${state}`)} aria-hidden="true" />
          <span className="aw-tree__title">{t.title}</span>
          <span className="aw-sr">, {stateText}</span>
          <span className="aw-tree__id">#{t.id}</span>
        </button>
      </div>
      {menu.menu}
    </li>
  );
}

/** One line: fleet health, this Mac, sync time (click = refresh), the palette and the key sheet. */
function StatusBar({ onPalette, onKeys }) {
  const { data, open, reload, platform } = useAdminCtx();
  const [syncing, setSyncing] = useState(false);
  const online = data.nodes.filter((n) => n.online).length;
  const waiting = data.queue.length;
  const stuck = data.queue.filter((q) => !q.eligible.length).length;
  const health = !data.nodes.length ? 'bad' : online === data.nodes.length ? 'ok' : online ? 'warn' : 'bad';
  const sync = () => {
    setSyncing(true);
    void Promise.resolve(reload()).finally(() => setSyncing(false));
  };
  const time = data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <footer className="aw-status">
      {data.access?.superAdmin ? (
        <button type="button" onClick={() => open('fleet')} title="Open Fleet: nodes, the queue and health">
          <Dot state={health} />
          <span>
            {online} of {data.nodes.length} {data.nodes.length === 1 ? 'node' : 'nodes'} online · {data.running.length} running · {waiting} queued
            {stuck ? ` · ${stuck} stuck` : ''}
          </span>
        </button>
      ) : (
        <span className="aw-status__item">{data.projects.length} {data.projects.length === 1 ? 'project' : 'projects'}</span>
      )}
      {platform === 'dsh' ? <MachineStatusPill /> : null}
      <span className="aw-status__fill" />
      <button type="button" onClick={sync} disabled={syncing} title="Refresh now (it also refreshes every 15 seconds)" className={data.error ? 'aw-status__err' : undefined}>
        <Icon name="refresh" size={12} />
        {syncing ? 'Syncing…' : data.error ? 'Sync failed · retry' : time ? `Synced ${time}` : 'Not synced yet'}
      </button>
      <button type="button" onClick={onPalette} title="Search and commands">
        <kbd>{MOD}K</kbd>
      </button>
      <button type="button" onClick={onKeys} title="Keyboard shortcuts" aria-label="Keyboard shortcuts">
        <kbd>?</kbd>
      </button>
    </footer>
  );
}

/* ————— the palette: jump to anything, run any command ————— */

function Palette({ onClose, onKeys, toggleExplorer }) {
  const { data, open, openTicket, setModal, reload, activeTab, closeTab, platform } = useAdminCtx();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef(null);
  const listRef = useRef(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    return () => opener?.focus?.();
  }, []);
  const { items, total } = useMemo(() => {
    const cmds = [
      { label: 'New task…', hint: 'N', run: () => setModal({ kind: 'task' }) },
      ...(data.access?.canUseWorkbench ? [{ label: 'New project…', hint: 'command', run: () => setModal({ kind: 'project' }) }] : []),
      { label: 'Refresh', hint: 'command', run: () => void reload() },
      { label: 'Toggle explorer', hint: `${MOD}B`, run: toggleExplorer },
      ...(activeTab ? [{ label: 'Close tab', hint: closeKey(platform), run: () => closeTab(activeTab) }] : []),
      { label: 'Keyboard shortcuts', hint: '?', run: onKeys },
      ...VIEWS.filter((v) => workbenchAllowed(v.key, data.access)).map((v) => ({ label: `Go to ${v.label}`, hint: viewKey(platform, VIEWS.indexOf(v) + 1), run: () => open(v.key) })),
      ...data.projects.map((p) => ({ label: p.name, hint: 'project', run: () => open(`p:${p.id}`) })),
      ...data.clients.map((c) => ({ label: c.name || c.email, hint: c.name ? `client · ${c.email}` : 'client', run: () => open(`c:${c.id}`) })),
      ...data.tickets.map((t) => ({ label: `#${t.id} ${t.title}`, hint: `${STATUS_LABEL[t.status]} · ${t.project_name ?? 'no project'}`, run: () => openTicket(t.id) })),
    ];
    const needle = q.trim().toLowerCase();
    const matched = needle ? cmds.filter((c) => `${c.label} ${c.hint}`.toLowerCase().includes(needle)) : cmds;
    return { items: matched.slice(0, 40), total: matched.length };
  }, [q, data, open, openTicket, setModal, reload, toggleExplorer, activeTab, closeTab, onKeys, platform]);
  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' });
  }, [i]);
  const pick = (item) => {
    onClose();
    item?.run();
  };
  return (
    <div className="aw-scrim aw-scrim--top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="aw-palette" role="dialog" aria-label="Command palette">
        <input
          ref={input}
          role="combobox"
          aria-label="Search tickets, views and commands"
          aria-expanded="true"
          aria-controls="aw-palette-list"
          aria-autocomplete="list"
          aria-activedescendant={items[i] ? `aw-palette-option-${i}` : undefined}
          value={q}
          placeholder="Search tickets, projects, clients and commands…"
          onChange={(e) => {
            setQ(e.target.value);
            setI(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') (e.preventDefault(), setI((n) => Math.min(items.length - 1, n + 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setI((n) => Math.max(0, n - 1)));
            else if (e.key === 'Home' && e.metaKey) (e.preventDefault(), setI(0));
            else if (e.key === 'Enter') pick(items[i]);
            else if (e.key === 'Tab') e.preventDefault();
          }}
        />
        <ul id="aw-palette-list" role="listbox" aria-label="Results" ref={listRef}>
          {items.map((item, n) => (
            <li
              key={item.label + n}
              id={`aw-palette-option-${n}`}
              role="option"
              aria-selected={n === i}
              className={n === i ? 'is-active' : ''}
              onMouseEnter={() => setI(n)}
              onMouseDown={() => pick(item)}
            >
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </li>
          ))}
          {!items.length ? <li className="aw-muted" role="presentation">No matches. Try a ticket number, a project or a view.</li> : null}
        </ul>
        {total > items.length ? <p className="aw-palette__count">Showing {items.length} of {total}</p> : null}
      </div>
    </div>
  );
}

/** `?`: every shortcut on one sheet. */
function ShortcutSheet({ onClose }) {
  const { platform } = useAdminCtx();
  const alt = isMac ? '⌃⌥' : 'Ctrl+Alt+';
  const rows = [
    [[`${MOD}K`], 'Search and commands'],
    [[`${MOD}B`], 'Show or hide the explorer'],
    [[platform === 'dsh' ? `${MOD}1…8` : `${alt}1…8`], 'Needs you, Board, All work, Marketing, SEO, Fleet, Clients, Settings'],
    [[closeKey(platform)], 'Close the tab'],
    [['⌃Tab', '⌃⇧Tab'], 'Next / previous tab'],
    [['←', '→', 'Home', 'End'], 'Move along tabs and section tabs'],
    [['N'], 'New task'],
    [['/'], 'Filter the list (web)'],
    [['J', 'K', '↑', '↓'], 'Move between rows'],
    [['Return'], 'Open the row, or confirm'],
    [['⇧F10'], 'Actions for the focused row or tab'],
    [[`${MOD}Return`], 'Send or save the form'],
    [['Esc'], 'Close the menu, dialog or drawer'],
    [['?'], 'This sheet'],
  ];
  return (
    <Modal kind="confirm" title="Keyboard shortcuts" subtitle="Everything else is in the palette." onClose={onClose} wide>
      <dl className="aw-keys">
        {rows.map(([keys, what]) => (
          <div key={what}>
            <dt>{keys.map((k) => <kbd key={k} className="aw-kbd">{k}</kbd>)}</dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </Modal>
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
    <Modal kind="create"
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
          <Button
            kind="primary"
            disabled={busy || !title.trim() || !brief.trim() || !projectId}
            disabledReason={busy ? undefined : !title.trim() ? 'Add a title first.' : !brief.trim() ? 'Write the brief first.' : !projectId ? 'Pick a project first.' : undefined}
            onClick={submit}
          >
            {busy ? 'Saving…' : approve ? 'Save and queue agent' : 'Save draft'}
          </Button>
        </>
      }
    >
      <fieldset disabled={busy} className="aw-formset">
      <Field label="Title">
        <input disabled={busy} value={title} maxLength={140} placeholder="Fix the checkout total rounding" onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Brief" hint="What to change, where, and how to check it.">
        <textarea
          disabled={busy}
          rows={4}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void submit(); } }}
        />
      </Field>
      <div className="aw-grid2 aw-taskform">
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
          <select value={executor ?? ''} onChange={(e) => setExecutor(e.target.value || null)}>
            {AGENTS.map((agent) => (
              <option key={String(agent.value)} value={agent.value ?? ''} title={agent.hint}>
                {agent.label}
              </option>
            ))}
          </select>
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
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [edited, setEdited] = useState(false);
  const [kind, setKind] = useState('existing');
  const [code, setCode] = useState('folder');
  const [repo, setRepo] = useState('');
  const [what, setWhat] = useState('');
  const [goal, setGoal] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [localPath, setLocalPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [setupError, setSetupError] = useState(null);
  const [clientIds, setClientIds] = useState([]);
  const [clientQuery, setClientQuery] = useState('');
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
  const existing = kind === 'existing';
  const steps = existing ? ['Source', 'Details', 'Clients', 'Review'] : ['Details'];
  const last = steps.length - 1;
  const readyName = name.trim() && (!data.access?.superAdmin || /^[a-z0-9][a-z0-9-]{0,62}$/.test(slug));
  const readyBrief = data.access?.superAdmin || (what.trim() && goal.trim());
  const readySource = !existing || (code === 'folder' ? localPath.trim() : code === 'repo' ? repo.trim() : true);
  const ready = readyName && readyBrief && readySource;
  const stepReady = !existing || (step === 0 ? readySource : step === 1 ? readyName && readyBrief : true);
  const go = (project) => { onClose(); open(`p:${project.id}`); };
  const detect = (value, fromRepo) => {
    const base = String(value).trim().replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() ?? '';
    const cleaned = fromRepo ? base.replace(/\.git$/, '') : base;
    if (!cleaned) return;
    if (!name.trim()) setName(cleaned.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
    if (!edited && !slug.trim()) setSlug(slugify(cleaned));
  };
  const submit = async () => {
    if (busyRef.current || !ready) return;
    busyRef.current = true; setBusy(true); setSetupError(null);
    try {
      const project = await submission.current({ name, slug, kind, code, repo: code === 'repo' ? repo.trim() : undefined, brief: { what: what.trim(), goal: goal.trim() }, localPath: localPath.trim() });
      if (!project) return;
      for (const id of clientIds) {
        await api('PUT', `/admin/clients/${id}/projects/${project.id}`).catch(() => notify?.('Project created, but assigning a client failed.', 'error'));
      }
      go(project);
    } catch (error) { setSetupError(errorText(error)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const next = () => { if (step < last) setStep(step + 1); else void submit(); };
  const back = () => (step === 0 || !existing ? onClose() : setStep(step - 1));
  const clients = data.clients ?? [];
  const shownClients = clients.filter((c) => !clientQuery.trim() || `${c.name ?? ''} ${c.email ?? ''}`.toLowerCase().includes(clientQuery.trim().toLowerCase()));
  return (
    <Modal kind="create"
      title={existing ? 'Add an existing project' : 'New project'}
      subtitle={existing ? `Step ${step + 1} of ${steps.length} · ${steps[step]}` : 'Create the project, then choose where to develop it.'}
      onClose={() => !busyRef.current && onClose()}
      actions={
        <>
          <Button disabled={busy} onClick={back}>{step === 0 || !existing ? (created ? 'Open project' : 'Cancel') : 'Back'}</Button>
          {!created ? (
            <Button kind="primary" disabled={busy || !stepReady || (step === last && !ready)} disabledReason={busy ? undefined : step === 0 && !readySource ? 'Choose a folder or repository first.' : 'Fill in the name and the required fields first.'} onClick={next}>
              {busy ? 'Saving…' : step < last ? 'Continue' : 'Create project'}
            </Button>
          ) : (
            <Button kind="primary" disabled={busy} onClick={() => created && go(created)}>Open project</Button>
          )}
        </>
      }
    >
      {receipt?.repoError ? <p role="status" className="aw-callout">Project created; repository setup needs attention: {String(receipt.repoError)}</p> : null}
      {setupError ? <p role="alert" className="aw-callout">{created ? 'Project created. Local setup failed; retry does not create another project. ' : ''}{setupError}</p> : null}
      {existing ? (
        <ol className="aw-steps" aria-label="Setup steps">
          {steps.map((label, index) => (
            <li key={label} data-current={index === step || undefined} data-done={index < step || undefined}>{label}</li>
          ))}
        </ol>
      ) : null}
      <fieldset disabled={busy || Boolean(created)} className="aw-formset">
        {existing && step === 0 ? (
          <>
            <Field label="Where is it?">
              <Segmented value={code} options={[{ value: 'folder', label: 'Folder on this computer' }, { value: 'repo', label: 'Git repository' }]} onChange={(value) => { setCode(value); setStep(0); }} />
            </Field>
            {code === 'folder' ? (
              <Field label="Folder" hint="An existing checkout on this computer. Nothing is cloned or created in it.">
                <input className="aw-mono" value={localPath} placeholder={host?.projectConfigureLocal ? '/Users/you/Projects/acme' : 'Unavailable in this host'} disabled={!host?.projectConfigureLocal} onChange={(e) => { setLocalPath(e.target.value); detect(e.target.value, false); }} />
              </Field>
            ) : (
              <Field label="Repository URL" hint="Nodes clone this. A private repo needs a node whose git can reach it.">
                <input className="aw-mono" value={repo} maxLength={300} placeholder="https://github.com/owner/repo" onChange={(e) => { setRepo(e.target.value); detect(e.target.value, true); }} />
              </Field>
            )}
            <p className="ui-note">{name.trim() ? `Will create “${name.trim()}”${slug ? ` (${slug})` : ''}.` : 'The name and slug are taken from the folder or repository; you can change them next.'}</p>
          </>
        ) : null}

        {!existing || step === 1 ? (
          <>
            <Field label="What it is">
              <Segmented value={kind} options={[{ value: 'existing', label: 'Existing code or system' }, { value: 'new', label: 'New website' }]} onChange={(value) => { setKind(value); setStep(0); }} />
            </Field>
            <Field label="Name">
              <input value={name} maxLength={80} placeholder="Acme storefront" onChange={(e) => { setName(e.target.value); if (!edited) setSlug(slugify(e.target.value)); }} />
            </Field>
            {data.access?.superAdmin ? <Field label="Slug" hint="Lowercase and dashes.">
              <input className="aw-mono" value={slug} maxLength={63} onChange={(e) => { setEdited(true); setSlug(e.target.value.toLowerCase()); }} />
            </Field> : null}
            {!data.access?.superAdmin ? <>
              <Field label="What are you building?"><textarea value={what} maxLength={4000} onChange={(e) => setWhat(e.target.value)} /></Field>
              <Field label="What should happen first?"><textarea value={goal} maxLength={4000} onChange={(e) => setGoal(e.target.value)} /></Field>
            </> : null}
            {!existing ? (
              <>
                <Field label="Code" hint={code === 'create' ? 'A node makes a private repo from the site template (main + preview).' : code === 'repo' ? 'Nodes clone this. A private repo needs a node whose git can reach it.' : data.access?.superAdmin ? 'A node with a folder named like the slug shares its origin.' : 'Create the project without linking a repository yet.'}>
                  <Segmented value={code} options={[{ value: 'create', label: 'Create a repo' }, { value: 'repo', label: 'Use a repo URL' }, { value: 'folder', label: data.access?.superAdmin ? 'Folder on a node' : 'Not linked yet' }]} onChange={setCode} />
                </Field>
                {code === 'repo' ? <Field label="Repo URL"><input className="aw-mono" value={repo} maxLength={300} placeholder="https://github.com/owner/repo" onChange={(e) => setRepo(e.target.value)} /></Field> : null}
                {host?.projectConfigureLocal ? <Field label="Local checkout folder (optional)" hint="Map an existing checkout on this computer. This does not clone a repository."><input disabled={busy} value={localPath} placeholder="/Users/you/Projects/acme" onChange={(e) => setLocalPath(e.target.value)} /></Field> : null}
              </>
            ) : (
              <p className="ui-note">Source: <span className="aw-mono">{code === 'folder' ? localPath || '—' : repo || '—'}</span></p>
            )}
          </>
        ) : null}

        {existing && step === 2 ? (
          <>
            <Field label="Find a client">
              <input value={clientQuery} placeholder="Search by name or email…" onChange={(e) => setClientQuery(e.target.value)} />
            </Field>
            <div className="aw-assign__list" role="group" aria-label="Clients">
              {shownClients.length === 0 ? <p className="aw-muted">{clients.length ? `No client matches “${clientQuery}”.` : 'No clients yet. You can assign them from the client page later.'}</p> : shownClients.map((c) => {
                const checked = clientIds.includes(c.id);
                return (
                  <label key={c.id} className="aw-assign__row" data-checked={checked || undefined}>
                    <input type="checkbox" checked={checked} onChange={() => setClientIds((current) => checked ? current.filter((id) => id !== c.id) : [...current, c.id])} />
                    <span className="aw-assign__name">{c.name || c.email}</span>
                    {c.name ? <span className="aw-assign__slug">{c.email}</span> : null}
                    {checked ? <span className="aw-assign__state">Assigned</span> : null}
                  </label>
                );
              })}
            </div>
            <p className="aw-muted">{clientIds.length} of {clients.length} clients selected. You can change this later on either side.</p>
          </>
        ) : null}

        {existing && step === 3 ? (
          <dl className="ui-props">
            <dt>Name</dt><dd>{name}</dd>
            <dt>Slug</dt><dd className="aw-mono">{slug || '—'}</dd>
            <dt>Source</dt><dd className="aw-mono">{code === 'folder' ? localPath : repo}</dd>
            <dt>Clients</dt><dd>{clientIds.length ? clientIds.map((id) => clients.find((c) => c.id === id)?.name || clients.find((c) => c.id === id)?.email).join(', ') : 'None yet'}</dd>
            {!data.access?.superAdmin ? <><dt>Brief</dt><dd>{what}</dd></> : null}
          </dl>
        ) : null}
      </fieldset>
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
  const [boardProject, setBoardProject] = useState(id);
  const open = useCallback((key) => {
    if (key.startsWith('p:') && host?.openProject) return host.openProject(key.slice(2));
    if (key.startsWith('t:') && host?.openTicket) return host.openTicket(Number(key.slice(2)));
    setNavigation({ id, destination: key });
  }, [host, id]);
  const openTicket = useCallback((target) => open(`t:${target}`), [open]);
  const onNotify = useCallback((text, kind) => host?.notify?.(text, kind), [host]);
  const { notify, act, setStatus, toast, dismissToast } = useWorkbenchActions({ api, reload, setAsk: setQuestion, onNotify });
  const value = { api, files, host, platform: host ? 'dsh' : 'web', data, reload, open, openTicket, notify, act, setStatus, ask: setQuestion, setModal, boardProject, setBoardProject };
  return <div className={cx('aw', host && 'aw--dsh', 'aw--scroll')}>
    <InjectedStyles id="aw-app-styles" css={STYLES} />
    <AdminContext.Provider value={value}>
      {destination.startsWith('p:') ? <ProjectView key={destination} id={destination.slice(2)} /> : destination.startsWith('t:') ? <TicketView key={destination} id={Number(destination.slice(2))} active /> : workbenchAllowed(destination, data.access) ? <View name={destination} /> : <p className="aw-empty">This destination requires administrator access.</p>}
      <Toast toast={toast} onDismiss={dismissToast} />
      {modal?.kind === 'task' ? <TaskModal preset={modal} onClose={() => setModal(null)} /> : null}
      {modal?.kind === 'project' && data.access?.canUseWorkbench ? <ProjectModal onClose={() => setModal(null)} /> : null}
      {modal?.kind === 'custom' ? modal.render(() => setModal(null)) : null}
      {question ? <Confirm ask={question} onClose={() => setQuestion(null)} /> : null}
    </AdminContext.Provider>
  </div>;
}


/**
 * The AdminContext a standalone ticket host has to supply, gathered once so the
 * details pane and the whole page cannot answer differently — through the same
 * actions the shell uses. `files` is how the host saves attachments (a download);
 * `host.upload` is how it sends them, and a host without one gets no attach
 * control. A host without a dialog asks with `window.confirm` instead.
 */
function useTicketContext({ api, data, reload, host, files }) {
  const ask = useCallback((question) => {
    if (typeof window !== 'undefined' && window.confirm(`${question.title}\n\n${question.text ?? ''}`)) {
      void question.run?.();
    }
  }, []);
  const onNotify = useCallback((text, kind) => host?.notify?.(text, kind), [host]);
  const { notify, act, setStatus, toast, dismissToast } = useWorkbenchActions({ api, reload, setAsk: ask, onNotify });
  const value = useMemo(
    () => ({
      api,
      files: files ?? null,
      data,
      reload,
      platform: 'dsh',
      host,
      open: () => {},
      openTicket: (target) => host?.openTicket?.(target),
      setStatus,
      act,
      notify,
      ask,
      setModal: () => {},
      boardProject: 'all',
      setBoardProject: () => {},
    }),
    [api, files, data, reload, host, setStatus, act, notify, ask],
  );
  return { value, toast, dismissToast };
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
  const { value, toast, dismissToast } = useTicketContext({ api, data, reload, host, files: null });

  // The theme lives on `.aw` (every `--aw-*` variable is defined there). Without
  // it the panel renders with no accent, no panel background and the wrong ink —
  // which is exactly how it looked in the conversation's side pane. Block
  // layout, because `.aw` is also the app shell's grid. As a page, the host
  // scrolls and this only sets the frame.
  const scope = page ? 'aw--page' : 'aw--scroll';
  if (loading && !ticket) {
    return (
      <div className={cx('aw', scope)}>
        <InjectedStyles id="aw-app-styles" css={STYLES} />
        <Skeleton variant="ticket" label="Loading ticket…" />
      </div>
    );
  }
  if (!ticket) {
    return (
      <div className={cx('aw', scope)}>
        <InjectedStyles id="aw-app-styles" css={STYLES} />
        <p className="aw-muted aw-unavailable">That ticket is not available.</p>
      </div>
    );
  }
  return (
    <div className={cx('aw aw--dsh', scope)}>
      <InjectedStyles id="aw-app-styles" css={STYLES} />
      <AdminContext.Provider value={value}>
        <TicketDetails ticket={ticket} runs={runs} land={land} meter={meter} reload={reload} page={page} />
        <Toast toast={toast} onDismiss={dismissToast} />
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
export function TicketPage({ api, host = null, files = null, ticketId, part = 'thread', autoMeter = true, chrome = true }) {
  // A host with a narrow conversation shows the details as a tab of their own
  // (`part: 'details'`) rather than as a column that squeezes the thread.
  if (part === 'details') return <TicketSidePanel api={api} host={host} ticketId={ticketId} page />;
  return <TicketThread api={api} host={host} files={files} ticketId={ticketId} autoMeter={autoMeter} chrome={chrome} />;
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
  const { value, toast, dismissToast } = useTicketContext({ api, data, reload, host, files });
  return (
    <div className="aw aw--dsh aw--scroll">
      <InjectedStyles id="aw-app-styles" css={STYLES} />
      <AdminContext.Provider value={value}>
        {data.error ? <p className="aw-empty">{errorText(data.error)}</p> : <ClientView id={clientId} />}
        <Toast toast={toast} onDismiss={dismissToast} />
      </AdminContext.Provider>
    </div>
  );
}

function TicketThread({ api, host, files, ticketId, autoMeter, chrome = true }) {
  const [data, reloadData] = useAdminData(api);
  const reload = useCallback(() => {
    void reloadData();
  }, [reloadData]);
  const { value, toast, dismissToast } = useTicketContext({ api, data, reload, host, files });
  // `.aw` scopes the panel's variables; block layout, because `.aw` is also the
  // app shell's grid. The page scrolls inside the tab, not the conversation.
  return (
    <div className="aw aw--dsh aw--scroll">
      <InjectedStyles id="aw-app-styles" css={STYLES} />
      <AdminContext.Provider value={value}>
        <TicketView id={ticketId} active={autoMeter} details={false} chrome={chrome} />
        <Toast toast={toast} onDismiss={dismissToast} />
      </AdminContext.Provider>
    </div>
  );
}
