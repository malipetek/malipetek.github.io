/**
 * Client half of the Admin panel bundle: the shared admin workbench
 * (packages/admin-ui), the same app /portal/admin serves on the web.
 *
 * Every portal call is an `/admin api <METHOD> <path> [json]` line run by the
 * Host half, so the session token stays there and a click spends no model turn.
 * The line goes to the Host's `/api/admin/command` route (see `makeTransport`),
 * which touches no Session; the loopback bridge and `remote.commands.execute`
 * are fallbacks for a Host without it. Built into ../client.js by
 * build.mjs.
 *
 * @module @malipetek/dsh-admin
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AdminApp, ClientPage } from '../../admin-ui/src/index.js';

/** Panel identity: one id addresses both the sidebar row and the main page. */
const PANEL_ID = 'admin';
const NAMESPACE = 'admin';
/** Reported to the Host on activation, so "did the panel load?" has an answer. */
const CLIENT_VERSION = '3.9.0';
const DICTIONARY = { title: 'Admin' };

/**
 * Rejections that mean "not this Session" rather than "this call failed".
 * A Session another process owns, one that is gone, and one owned by
 * subagent routing are all reasons to ask the next Session instead.
 */
const SESSION_RETRY_CODES = new Set(['session/writer-held', 'session/not-found', 'session/agent-busy']);
const MAX_SESSION_TRIES = 4;
let lastSessionId;

/**
 * Sessions this panel may borrow for a Host call, best first: the one the main
 * view retains (what the user is looking at), then the rest newest first.
 */
function sessionCandidates(ctx) {
  const snapshot = ctx.sessions?.list?.getSnapshot();
  const rows = Object.values(snapshot?.byId ?? {});
  const inMainView = (row) => (row?.retainedBy?.mainView ?? 0) > 0;
  const newestFirst = (a, b) => (b?.updatedAt ?? 0) - (a?.updatedAt ?? 0);
  const ids = [...rows.filter(inMainView).sort(newestFirst), ...rows.filter((row) => !inMainView(row)).sort(newestFirst)]
    .map((row) => row?.id)
    .filter((id) => typeof id === 'string' && id.length > 0);
  if (ids.length > 0) return ids;
  return (Array.isArray(snapshot?.ids) ? snapshot.ids : []).filter((id) => typeof id === 'string' && id.length > 0);
}

async function withSession(ctx, call) {
  const candidates = sessionCandidates(ctx);
  if (candidates.length === 0) return { ok: false, text: 'No session is open. Open a session, then try again.' };
  const known = candidates.indexOf(lastSessionId);
  if (known > 0) candidates.unshift(candidates.splice(known, 1)[0]);
  let failure = { ok: false, text: 'No open session would take the call.' };
  for (const sessionId of candidates.slice(0, MAX_SESSION_TRIES)) {
    const result = await call(sessionId);
    if (result.ok) {
      lastSessionId = sessionId;
      return result;
    }
    failure = result;
    if (!SESSION_RETRY_CODES.has(result.code)) break;
  }
  return failure;
}

/**
 * Run one `/admin …` Host command. The Remote answers in two layers: `ok:false`
 * when the call itself failed, and `value.result.kind === 'error'` when the
 * command refused. Both come back as `{ ok: false, text }`.
 */
function makeCommand(ctx) {
  return (line) =>
    withSession(ctx, async (sessionId) => {
      try {
        const result = await ctx.remote.commands.execute(sessionId, `/admin ${line}`, []);
        if (result?.ok !== true) {
          const error = result?.error ?? {};
          const code = error.code ?? 'command-failed';
          return { ok: false, code, text: `${code}${typeof error.message === 'string' ? `: ${error.message}` : ''}` };
        }
        const payload = result.value?.result;
        const text = typeof payload?.text === 'string' ? payload.text : '';
        return payload?.kind === 'success' ? { ok: true, text: text || 'Done.' } : { ok: false, text: text || 'The command failed.' };
      } catch (error) {
        return { ok: false, text: error?.message ?? String(error) };
      }
    });
}

/**
 * Every command lands in the session log, result text included, and the
 * workbench polls — so after one `/admin bridge` the panel talks to the Host's
 * loopback bridge with `fetch` instead, which logs nothing. A failed bridge
 * call asks for the bridge again once (the Host may have restarted with a new
 * port and secret); if that fails too, this page load falls back to commands.
 *
 * The fallback must not flood the log the way polling did: a read is answered
 * from cache for FALLBACK_READ_MS, and any write clears the cache so its effect
 * shows on the next poll.
 *
 * Losing the bridge is not final. Finding it is itself a command, so it fails
 * whenever every Session is busy (an agent mid-turn holds its writer) — and the
 * fallback fails then too, with `session/writer-held`. So after a failure the
 * bridge is tried again once BRIDGE_RETRY_MS has passed instead of never.
 */
const FALLBACK_READ_MS = 5 * 60_000;
const BRIDGE_RETRY_MS = 15_000;
const isRead = (line) => line.startsWith('api GET ') || line === 'localinfo';

/** What to say when every Session refused and the bridge is not up yet. */
const BUSY_TEXT =
  'Every open session is busy (an agent is working in it), so the panel could not reach the Admin Host. ' +
  'It will reconnect on its own in a few seconds; or open a new session.';

function makeTransport(command) {
  let bridge = null;
  let retryAt = 0;
  const cache = new Map();

  const explain = (result) => (SESSION_RETRY_CODES.has(result.code) ? { ...result, text: BUSY_TEXT } : result);

  const fallback = async (line) => {
    if (!isRead(line)) {
      cache.clear();
      return explain(await command(line));
    }
    const hit = cache.get(line);
    if (hit && Date.now() - hit.at < FALLBACK_READ_MS) return hit.result;
    const result = await command(line);
    if (result.ok) cache.set(line, { at: Date.now(), result });
    return explain(result);
  };

  const locate = async () => {
    const r = await command('bridge');
    if (!r.ok) throw new Error(r.text);
    const value = JSON.parse(r.text);
    if (typeof value?.url !== 'string' || typeof value?.secret !== 'string') throw new Error('Malformed bridge reply.');
    return value;
  };

  const send = async ({ url, secret }, line) => {
    const response = await fetch(`${url}/command`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ line }),
    });
    if (response.status !== 200) throw new Error(`Bridge answered ${response.status}.`);
    const { kind, text } = await response.json();
    return kind === 'success' ? { ok: true, text: text || 'Done.' } : { ok: false, text: text || 'The command failed.' };
  };

  // First choice: the Host's `/api/admin/command` route — authenticated by the
  // Harness, no Session involved, nothing logged, nothing to look up. A 404
  // means a Host from before the route; any failure tries the bridge instead,
  // and the route is asked again after BRIDGE_RETRY_MS.
  let routeRetryAt = 0;
  const viaRoute = async (line) => {
    const response = await fetch('api/admin/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ line }),
    });
    if (response.status !== 200) throw new Error(`Route answered ${response.status}.`);
    const { kind, text } = await response.json();
    return kind === 'success' ? { ok: true, text: text || 'Done.' } : { ok: false, text: text || 'The command failed.' };
  };

  const transport = async (line) => {
    if (Date.now() >= routeRetryAt) {
      try {
        return await viaRoute(line);
      } catch {
        routeRetryAt = Date.now() + BRIDGE_RETRY_MS;
      }
    }
    if (Date.now() < retryAt) return fallback(line);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      // One lookup shared by the calls the board fires together.
      const pending = (bridge ??= locate());
      try {
        return await send(await pending, line);
      } catch {
        if (bridge === pending) bridge = null;
      }
    }
    retryAt = Date.now() + BRIDGE_RETRY_MS;
    return fallback(line);
  };
  return transport;
}

/** The sidebar glyph and the ticket stub: a torn ticket, for the header control. */
function TicketGlyph({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4z" />
      <path d="M14 6v12" strokeDasharray="2 2" />
    </svg>
  );
}

function AdminIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v7h-4z" />
    </svg>
  );
}

const inject = ['slots', 'sessions', 'layout', 'remote', 'remote.commands', 'sidebarRightTabs', 'sidebarRight'];

function apply(ctx) {
  const command = makeTransport(makeCommand(ctx));
  /**
   * PTech Admin's Electron preload exposes clickable native notifications.
   * When it does, the Host stops its osascript fallback and this half shows
   * the banner, so clicking it opens the ticket.
   */
  const desktopNotifications = typeof globalThis.dshDesktop?.notifications?.show === 'function'
    ? globalThis.dshDesktop.notifications
    : null;
  /** Host commands whose text is JSON. */
  const json = async (line) => {
    const r = await command(line);
    let value = null;
    try {
      value = JSON.parse(r.text);
    } catch {
      /* not JSON */
    }
    if (!r.ok) {
      throw Object.assign(new Error(value?.message ?? r.text), { code: value?.code ?? r.code ?? 'command-failed', status: value?.status });
    }
    return value;
  };
  /**
   * Git Graph, when its plugin is installed: it publishes its view and a
   * `focus(repo, ref)` on `globalThis.__dshGitGraphNative`. Its Host binds to
   * one session, so the review uses the session this panel would borrow.
   */
  const gitGraph = {
    available: () => typeof globalThis.__dshGitGraphNative?.View === 'function',
    sessionId: () => sessionCandidates(ctx)[0] ?? null,
    View: (props) => {
      const View = globalThis.__dshGitGraphNative?.View;
      return View ? View(props) : null;
    },
    focus: (args) => globalThis.__dshGitGraphNative.focus(args),
  };
  /**
   * A run's Harness conversation, opened in the main view. The Host finds the
   * session on this disk or imports the log its node uploaded; then the
   * built-in `uiWorkspace` service opens it. `uiWorkspace` is optional: a
   * Harness without it leaves `available()` false and activation unblocked.
   */
  let workspace = null;
  ctx.inject(['uiWorkspace'], (scope) => {
    workspace = scope.uiWorkspace ?? null;
    // Tidy Ungrouped as soon as the archive call exists.
    const first = setTimeout(() => void archiveFleetSessions(), 3000);
    scope.effect(() => () => clearTimeout(first), 'admin: first archive pass');
    scope.effect(
      () => () => {
        workspace = null;
      },
      'admin: uiWorkspace',
    );
  });
  const conversation = {
    available: () => typeof workspace?.openSession === 'function',
    open: async ({ runId, sessionId, sessionDir }) => {
      if (!sessionId || !sessionDir) throw new Error('This run did not record its Harness session.');
      const found = await json(`session ${runId} ${sessionId} ${sessionDir}`);
      const ws = workspace;
      if (typeof ws?.openSession !== 'function') throw new Error('This Harness cannot open sessions from a plugin.');
      // The log is on disk now, but the session catalog still lists what it
      // found before the import — retain() would call the id unknown.
      if (typeof ctx.sessions?.refresh === 'function') await ctx.sessions.refresh().catch(() => undefined);
      const id = found?.sessionId ?? sessionId;
      // Fleet runs are kept archived (see archiveFleetSessions); the sidebar
      // will not open an archived session, so bring it back first.
      opened.set(id, Date.now());
      if (archivedIds().includes(id) && typeof ws.unarchiveSession === 'function') await ws.unarchiveSession(id).catch(() => undefined);
      await ws.openSession(id);
      return found;
    },
  };

  /* ————— Fleet run sessions stay out of "Ungrouped" ————— */

  /*
   * A fleet run works in a worktree, and the Harness only counts a session in
   * a workspace whose folder is exactly the session's own (dsh-workspace
   * `candidateMatches`), so a run can never be grouped under its project; it
   * lands in Ungrouped. Writing workspace.json from outside does not help: the
   * app keeps that file in memory and rewrites it whole on every save.
   *
   * So runs are listed in the Tasks tab instead, and their sessions are
   * archived through the app's own `archiveSession`, which leaves workspace
   * accounting alone. Opening one from the Tasks tab or Admin unarchives it.
   */
  const FLEET_CWD = '/malipetek-runner/worktrees/';
  /** Sessions opened from here recently: not archived again while you read them. */
  const opened = new Map();
  const KEEP_OPENED_MS = 10 * 60_000;
  const archivedIds = () => workspace?.workspaces?.list?.getSnapshot?.()?.archivedSessionIds ?? [];

  let archiving = false;
  async function archiveFleetSessions() {
    const ws = workspace;
    if (archiving || typeof ws?.archiveSession !== 'function') return;
    archiving = true;
    try {
      // This machine's project run folders: their runs are grouped, not archived.
      let local = [];
      try {
        local = (await json('localinfo'))?.runGrouping?.folders ?? [];
      } catch {
        /* an older Host: treat every run folder as foreign */
      }
      const archived = new Set(archivedIds());
      const rows = ctx.sessions?.list?.getSnapshot?.()?.byId ?? {};
      for (const [id, row] of Object.entries(rows)) {
        if (typeof row?.cwd !== 'string' || !row.cwd.includes(FLEET_CWD) || archived.has(id)) continue;
        // A project's one run folder on this machine is grouped under "<project> · runs" by
        // the Host side; leave those. A run folder from another node cannot be grouped here.
        const perRun = RUN_DIR_RE.test(row.cwd.replace(/\/+$/, '').split('/').pop() ?? '');
        if (!perRun && local.includes(row.cwd.replace(/\/+$/, ''))) continue;
        if ((row.retainedBy?.mainView ?? 0) > 0) continue; // on screen
        if (Date.now() - (opened.get(id) ?? 0) < KEEP_OPENED_MS) continue;
        // A session with live work is refused by the app itself; the next pass retries.
        await ws.archiveSession(id).catch(() => undefined);
      }
    } finally {
      archiving = false;
    }
  }
  {
    let timer = null;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void archiveFleetSessions(), 3000);
    };
    const list = ctx.sessions?.list;
    const stop = typeof list?.subscribe === 'function' ? list.subscribe(soon) : () => {};
    const every = setInterval(soon, 5 * 60_000);
    soon();
    ctx.effect(
      () => () => {
        stop();
        clearTimeout(timer);
        clearInterval(every);
      },
      'admin: archive fleet sessions',
    );
  }
  /** One stable object so React effects that depend on it do not re-run. */
  const host = { command, json, gitGraph, conversation, openTicket: (target) => openTicket(target) };
  const api = (method, path, body) => json(`api ${method} ${path}${body === undefined ? '' : ` ${JSON.stringify(body)}`}`);

  /* ————— Ticket runs in the session list ————— */

  const RUN_DIR_RE = /^(.+)-(task|ticket)-(\d+)(?:-run(\d+))?$/;
  /**
   * The title a node gives a ticket's session: `Task #24 — …` (one thread for
   * every run of the ticket); older ones carry the run, `Task #24 · run 43 — …`
   * or `#24 · run 43 — …`.
   */
  const RUN_TITLE_RE = /^(Task|Ticket)?\s*#(\d+)(?: · run (\d+))?\s*(?:—|$)/;
  const SEP = '\u0000';

  /**
   * The ticket a session ran for. A run in its own worktree says it in the
   * folder (`<slug>-(task|ticket)-<id>[-run<n>]`); a run in its project's one
   * run folder (`worktrees/<slug>`) says it in the session title.
   */
  function ticketFromCwd(key) {
    const [cwd, title = ''] = String(key ?? '').split(SEP);
    if (typeof cwd !== 'string' || !cwd.includes('/malipetek-runner/worktrees/')) return null;
    const folder = cwd.replace(/\/+$/, '').split('/').pop() ?? '';
    const match = RUN_DIR_RE.exec(folder);
    if (match) return { slug: match[1], kind: match[2], ticketId: Number(match[3]), runId: match[4] ? Number(match[4]) : null, cwd };
    const named = RUN_TITLE_RE.exec(title.trim());
    if (!named) return null;
    return { slug: folder, kind: named[1] === 'Ticket' ? 'ticket' : 'task', ticketId: Number(named[2]), runId: named[3] ? Number(named[3]) : null, cwd };
  }

  /** Live-read one session's folder and title from the catalog, as one string (updates on refresh/import). */
  function useSessionCwd(sessionId) {
    const list = ctx.sessions?.list;
    return useSyncExternalStore(
      (notify) => (typeof list?.subscribe === 'function' ? list.subscribe(notify) : () => {}),
      () => {
        const row = list?.getSnapshot?.()?.byId?.[sessionId];
        return row?.cwd === undefined ? undefined : `${row.cwd}${SEP}${typeof row.title === 'string' ? row.title : ''}`;
      },
    );
  }

  const TICKET_COLORS = {
    task: 'var(--dsw-alias-state-business-primary, #4c8dff)',
    ticket: 'var(--dsw-alias-state-warning-primary, #d18f2e)',
  };

  function openTicket(run) {
    // The full ticket lives in the workbench; a ticket with a run opens its
    // conversation instead (see openTicketRun).
    ctx.layout?.selectPanel?.('admin-workbench');
    const target = `#ticket=${run.ticketId}`;
    if (window.location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
    else window.location.hash = target;
  }

  /** The `sidebar.session.row.leading` mark: a colored #N chip on run sessions. */
  function TicketMark({ sessionId }) {
    const run = ticketFromCwd(useSessionCwd(sessionId));
    if (!run) return null;
    const color = TICKET_COLORS[run.kind];
    return (
      <span
        title={`${run.kind === 'task' ? 'System task' : 'Client ticket'} #${run.ticketId}${run.runId ? ` · run ${run.runId}` : ''} — click opens the ticket`}
        onClick={(e) => {
          e.stopPropagation();
          void openTicketRun({ id: run.ticketId });
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 14,
          height: 14,
          padding: '0 3px',
          borderRadius: 4,
          fontSize: 9,
          fontWeight: 700,
          lineHeight: 1,
          color: '#fff',
          background: color,
          cursor: 'pointer',
        }}
      >
        {run.ticketId}
      </span>
    );
  }

  /** Extra line in the row hover card: what ticket and run this session was. */
  function TicketHover({ sessionId }) {
    const run = ticketFromCwd(useSessionCwd(sessionId));
    if (!run) return null;
    return (
      <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary, #adb2b8)' }}>
        {run.kind === 'task' ? 'System task' : 'Client ticket'} #{run.ticketId}
        {run.runId ? ` · run ${run.runId}` : ''} · {run.slug}
      </div>
    );
  }

  /* ————— The task desk, as a right-pane tab ————— */

  const TASK_TINT = {
    new: 'var(--dsw-alias-state-warning-primary, #f0a13a)',
    review: 'var(--dsw-alias-state-business-primary, #4c8bf5)',
    in_progress: 'var(--dsw-alias-state-success-primary, #35c07a)',
  };
  const taskRowStyle = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    width: '100%',
    padding: '6px 8px',
    border: 0,
    borderRadius: 6,
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    fontSize: 12.5,
    cursor: 'pointer',
    textAlign: 'left',
  };
  const taskHeadStyle = {
    margin: '0 0 4px',
    padding: '0 8px',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: 'var(--dsw-alias-label-secondary, #adb2b8)',
  };
  const taskEmptyStyle = { margin: 0, padding: '2px 8px', fontSize: 12, opacity: 0.6 };

  const RUN_TINT = {
    running: 'var(--dsw-alias-state-success-primary, #35c07a)',
    ok: 'var(--dsw-alias-label-secondary, #8a9099)',
    failed: 'var(--dsw-alias-state-danger-primary, #e5534b)',
  };
  const ago = (unix) => {
    const s = Math.max(0, Math.floor(Date.now() / 1000) - Number(unix || 0));
    return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
  };
  const dot = (color) => (
    <span style={{ width: 7, height: 7, borderRadius: 4, marginTop: 5, flex: '0 0 auto', background: color ?? '#888' }} />
  );
  const RUNS_SHOWN = 3;
  const lineStyle = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

  /**
   * The task desk in the right pane: what waits on Ali, then every recent
   * run by project and ticket. Fleet run sessions are archived out of the
   * sidebar's Ungrouped pile, so this is where their conversations are: a run
   * row opens its conversation, a ticket row opens the ticket in Admin.
   */
  function TasksTab() {
    const [state, setState] = useState({ tickets: [], runs: [], loading: true });
    const [note, setNote] = useState('');
    /** Tickets showing all their runs; the rest show the newest RUNS_SHOWN. */
    const [expanded, setExpanded] = useState(() => new Set());
    useEffect(() => {
      let alive = true;
      const load = () =>
        Promise.all([api('GET', '/admin/tickets').catch(() => null), api('GET', '/admin/runs').catch(() => null)]).then(([t, r]) => {
          if (!alive) return;
          setState((prev) => ({
            tickets: Array.isArray(t?.tickets) ? t.tickets : prev.tickets,
            // A live run is in `running` and also among the newest `recent`; keep one of each id.
            runs: [...new Map([...(r?.recent ?? []), ...(r?.running ?? []).map((x) => ({ ...x, status: 'running' }))].map((x) => [x.id, x])).values()],
            loading: false,
          }));
        });
      void load();
      const timer = setInterval(load, 20_000);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, []);

    const openRun = async (run) => {
      if (!run.session_id || !run.session_dir || !conversation.available()) {
        openTicket({ ticketId: run.ticket_id });
        return;
      }
      setNote(`Opening run ${run.id}…`);
      try {
        await conversation.open({ runId: run.id, sessionId: run.session_id, sessionDir: run.session_dir });
        setNote('');
      } catch (error) {
        setNote(`Run ${run.id}: ${error?.message ?? 'could not open its conversation'}`);
      }
    };

    const waiting = state.tickets.filter((t) => t.status === 'new' || t.status === 'review');
    const ticketRow = (ticket) => (
      <button key={ticket.id} type="button" style={taskRowStyle} onClick={() => void openTicketRun(ticket)}>
        {dot(TASK_TINT[ticket.status])}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={lineStyle}>
            #{ticket.id} {ticket.title}
          </span>
          <span style={{ ...lineStyle, fontSize: 11, opacity: 0.65 }}>
            {ticket.project_name ?? 'no project'}
            {ticket.kind === 'system' ? ' · your task' : ''}
          </span>
        </span>
      </button>
    );

    // project → ticket → runs, newest first at every level (runs arrive newest first).
    const projects = new Map();
    for (const run of state.runs) {
      const slug = run.slug ?? 'no project';
      if (!projects.has(slug)) projects.set(slug, new Map());
      const tickets = projects.get(slug);
      if (!tickets.has(run.ticket_id)) tickets.set(run.ticket_id, []);
      tickets.get(run.ticket_id).push(run);
    }

    if (state.loading) return <div style={{ padding: 12, fontSize: 13, opacity: 0.7 }}>Loading tasks…</div>;
    return (
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <section>
          <h4 style={taskHeadStyle}>Waiting on you · {waiting.length}</h4>
          {waiting.length > 0 ? waiting.map(ticketRow) : <p style={taskEmptyStyle}>Nothing waiting.</p>}
        </section>
        {note ? <p style={{ ...taskEmptyStyle, opacity: 0.85 }}>{note}</p> : null}
        {projects.size === 0 ? <p style={taskEmptyStyle}>No runs yet.</p> : null}
        {[...projects].map(([slug, tickets]) => (
          <section key={slug}>
            <h4 style={taskHeadStyle}>{slug}</h4>
            {[...tickets].map(([ticketId, runs]) => (
              <div key={ticketId} style={{ marginBottom: 4 }}>
                <button type="button" style={taskRowStyle} title="Open the ticket's conversation" onClick={() => void openTicketRun({ id: ticketId, title: runs[0].title })}>
                  {dot(TASK_TINT[runs[0].ticket_status])}
                  <span style={{ ...lineStyle, flex: 1, minWidth: 0 }}>
                    #{ticketId} {runs[0].title}
                  </span>
                </button>
                {(expanded.has(ticketId) ? runs : runs.slice(0, RUNS_SHOWN)).map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    style={{ ...taskRowStyle, padding: '3px 8px 3px 23px', fontSize: 11.5 }}
                    title={run.session_id ? 'Open this run’s conversation' : 'This run kept no conversation; opens the ticket'}
                    onClick={() => void openRun(run)}
                  >
                    {dot(RUN_TINT[run.status] ?? 'var(--dsw-alias-label-tertiary, #666)')}
                    <span style={{ ...lineStyle, flex: 1, minWidth: 0, opacity: run.session_id ? 1 : 0.6 }}>
                      run {run.id} · {run.executor ?? 'agent'}
                      {run.node_id ? ` · ${run.node_id}` : ''}
                      {run.status === 'running' ? ' · running' : run.status === 'failed' ? ' · failed' : ''}
                    </span>
                    <span style={{ fontSize: 11, opacity: 0.55 }}>{ago(run.finished_at ?? run.started_at)}</span>
                  </button>
                ))}
                {runs.length > RUNS_SHOWN ? (
                  <button
                    type="button"
                    style={{ ...taskRowStyle, padding: '2px 8px 2px 23px', fontSize: 11, opacity: 0.6 }}
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(ticketId)) next.delete(ticketId);
                        else next.add(ticketId);
                        return next;
                      })
                    }
                  >
                    {expanded.has(ticketId) ? 'Show fewer' : `+${runs.length - RUNS_SHOWN} more`}
                  </button>
                ) : null}
              </div>
            ))}
          </section>
        ))}
      </div>
    );
  }

  function TasksTabTitle() {
    return <span>Tasks</span>;
  }

  /* ————— What needs Ali, on the Admin entry ————— */

  const ATTENTION_MS = 15_000;

  /**
   * One poller for `/admin/attention` — the cheapest portal read there is, four
   * counts from one query — shared by everything that shows it and running only
   * while something does. It goes over the panel route, so a poll never lands
   * in a session log. Subscribers are told only when the counts actually
   * change, so a quiet minute re-renders nothing. Signed out or offline reads
   * as null.
   */
  const attention = (() => {
    let value = null;
    let signature = null;
    let timer = null;
    const subs = new Set();
    const pull = async () => {
      let next = null;
      try {
        next = await api('GET', '/admin/attention');
      } catch {
        next = null;
      }
      const nextSignature = JSON.stringify(next);
      if (nextSignature === signature) return;
      signature = nextSignature;
      value = next;
      for (const notify of subs) notify();
    };
    const onFocus = () => void pull();
    return {
      subscribe(notify) {
        subs.add(notify);
        if (subs.size === 1) {
          void pull();
          timer = setInterval(() => void pull(), ATTENTION_MS);
          window.addEventListener('focus', onFocus);
        }
        return () => {
          subs.delete(notify);
          if (subs.size === 0) {
            clearInterval(timer);
            timer = null;
            window.removeEventListener('focus', onFocus);
          }
        };
      },
      get: () => value,
      pull,
    };
  })();

  /* ————— New work reaches the window ————— */

  /**
   * The Host's event feed, polled over the panel route (no Session, nothing
   * logged). The Host already diffs each 60-second portal poll, so this is a
   * two-word answer when nothing happened: `{ seq, events: [] }`.
   *
   * The first call is the cursor only. It answers the current sequence with no
   * events, so a panel that has just loaded never toasts a queue from an hour
   * ago; from then on every event after the cursor is shown once. Each event
   * is also broadcast on `window` as `admin:changed`, which is what the
   * Clients tree reloads on — no second timer, no blind 15-second poll.
   */
  const NOTIFY_POLL_MS = 10_000;
  const notificationFeed = (() => {
    let cursor = null;
    let timer = null;
    let running = false;
    const subs = new Set();
    const pull = async () => {
      if (running) return;
      running = true;
      try {
        const value = cursor === null ? await json('events') : await json(`events ${cursor}`);
        if (cursor === null) {
          cursor = Number(value?.seq) || 0;
          return;
        }
        const events = Array.isArray(value?.events) ? value.events : [];
        cursor = Math.max(cursor, Number(value?.seq) || cursor);
        for (const event of events) {
          for (const notify of subs) notify(event);
          window.dispatchEvent(new CustomEvent('admin:changed', { detail: event }));
        }
      } catch {
        // Signed out, offline, or a Host from before the feed: nothing to show.
      } finally {
        running = false;
      }
    };
    return {
      subscribe(notify) {
        subs.add(notify);
        if (timer === null) {
          void pull();
          timer = setInterval(() => void pull(), NOTIFY_POLL_MS);
        }
        return () => {
          subs.delete(notify);
          if (subs.size === 0) {
            clearInterval(timer);
            timer = null;
          }
        };
      },
      pull,
    };
  })();

  const TOAST_TINT = {
    'ticket.new': 'var(--dsw-alias-state-warning-primary, #d18f2e)',
    'ticket.approval': 'var(--dsw-alias-state-warning-primary, #d18f2e)',
    'ticket.reply': 'var(--dsw-alias-state-business-primary, #4c8dff)',
    'run.finished': 'var(--dsw-alias-state-success-primary, #2f9e5b)',
    'run.failed': 'var(--dsw-alias-state-danger-primary, #e5534b)',
  };
  const TOAST_MS = 7000;

  /** One in-app notice: the same event macOS got, with a click through to the ticket. */
  function NotificationToast({ toast, onOpen, onClose }) {
    const tint = TOAST_TINT[toast.kind] ?? 'var(--dsw-alias-label-tertiary, #8a9099)';
    return (
      <div
        role="status"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          width: '100%',
          maxWidth: 360,
          boxSizing: 'border-box',
          padding: '10px 12px 10px 10px',
          borderRadius: 10,
          border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.28))',
          borderLeft: `3px solid ${tint}`,
          background: 'var(--dsw-alias-bg-elevated, #23252a)',
          color: 'var(--dsw-alias-label-primary, inherit)',
          boxShadow: '0 10px 30px rgba(0,0,0,0.28)',
          font: 'inherit',
          fontSize: 12.5,
          cursor: toast.ticketId ? 'pointer' : 'default',
        }}
        onClick={() => toast.ticketId && onOpen(toast)}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 600, fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', opacity: 0.65 }}>
            PTech Admin
          </span>
          <span style={{ display: 'block', lineHeight: 1.35, marginTop: 2 }}>{toast.body}</span>
        </span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={(event) => {
            event.stopPropagation();
            onClose(toast);
          }}
          style={{ border: 0, background: 'transparent', color: 'inherit', opacity: 0.55, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0 }}
        >
          ×
        </button>
      </div>
    );
  }

  /**
   * The frame-wide toast stack. It lives in `shell.overlay`, the Harness's own
   * click-through layer, so a notice survives switching panels and pages.
   */
  function NotificationHost() {
    const [toasts, setToasts] = useState([]);
    /** key → its auto-dismiss timer, shared by the effect and the close button. */
    const timers = useRef(new Map());
    const remove = (key) => {
      clearTimeout(timers.current.get(key));
      timers.current.delete(key);
      setToasts((prev) => prev.filter((item) => item.key !== key));
    };
    useEffect(() => {
      const add = (event) => {
        const key = `${event.seq ?? Date.now()}-${Math.random().toString(36).slice(2)}`;
        setToasts((prev) => [...prev.slice(-2), { ...event, key }]);
        timers.current.set(key, setTimeout(() => {
          timers.current.delete(key);
          setToasts((prev) => prev.filter((item) => item.key !== key));
        }, TOAST_MS));
        if (desktopNotifications) {
          void desktopNotifications.show({
            title: 'PTech Admin',
            body: event.body,
            ...(event.ticketId ? { url: `ptech-admin://ticket/${event.ticketId}` } : {}),
          }).catch(() => undefined);
        }
      };
      const stop = notificationFeed.subscribe(add);
      return () => {
        stop();
        for (const timer of timers.current.values()) clearTimeout(timer);
        timers.current.clear();
      };
    }, []);
    if (toasts.length === 0) return null;
    return (
      <div
        style={{
          position: 'fixed',
          top: 48,
          right: 18,
          zIndex: 2147483000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 8,
          pointerEvents: 'auto',
        }}
      >
        {toasts.map((toast) => (
          <NotificationToast
            key={toast.key}
            toast={toast}
            onOpen={(item) => {
              openTicket({ ticketId: item.ticketId });
              remove(item.key);
            }}
            onClose={(item) => remove(item.key)}
          />
        ))}
      </div>
    );
  }

  /**
   * The Admin settings page: the notification switch, and where to sign in.
   * The switch is the `/admin notify` command, so the panel and the slash
   * command never disagree.
   */
  function AdminSettingsSection() {
    const [state, setState] = useState({ loaded: false, notify: true, busy: false, error: '' });
    useEffect(() => {
      let alive = true;
      json('notify').then(
        (value) => { if (alive) setState({ loaded: true, notify: value?.notify !== false, busy: false, error: '' }); },
        (error) => { if (alive) setState((prev) => ({ ...prev, loaded: true, error: error?.message ?? 'Could not read the setting.' })); },
      );
      return () => { alive = false; };
    }, []);
    const toggle = async () => {
      const next = !state.notify;
      setState((prev) => ({ ...prev, busy: true, error: '' }));
      try {
        await command(`notify ${next ? 'on' : 'off'}`);
        setState({ loaded: true, notify: next, busy: false, error: '' });
      } catch (error) {
        setState((prev) => ({ ...prev, busy: false, error: error?.message ?? 'Could not save the setting.' }));
      }
    };
    const rowStyle = { display: 'flex', alignItems: 'center', gap: 16, padding: '14px 0', borderTop: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.22))' };
    const switchStyle = {
      width: 38,
      height: 22,
      padding: 2,
      borderRadius: 11,
      border: 0,
      cursor: state.busy ? 'wait' : 'pointer',
      background: state.notify ? 'var(--dsw-alias-state-success-primary, #2f9e5b)' : 'var(--dsw-alias-bg-secondary, rgba(127,127,127,0.35))',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: state.notify ? 'flex-end' : 'flex-start',
      boxSizing: 'border-box',
    };
    return (
      <div style={{ padding: '20px 24px', maxWidth: 680 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>Admin</h2>
        <p style={{ margin: '0 0 14px', fontSize: 12.5, opacity: 0.65, lineHeight: 1.45 }}>
          The PTech client portal (ptechsolutions.net) inside the Harness: tickets, the work queue and its fleet, clients and projects.
          The Host refreshes every minute and notifies you about new work in the window and on this Mac.
        </p>
        <div style={rowStyle}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13 }}>Notify me about new work</span>
            <span style={{ display: 'block', fontSize: 12, opacity: 0.6, marginTop: 2 }}>
              A new ticket, one waiting for approval, a client reply, or a finished or failed run — in-app and as a
              macOS notification, never twice.
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={state.notify}
            aria-label="Notify me about new work"
            disabled={!state.loaded || state.busy}
            onClick={() => void toggle()}
            style={switchStyle}
          >
            <span style={{ width: 18, height: 18, borderRadius: 9, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }} />
          </button>
        </div>
        {state.error ? <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--dsw-alias-state-danger-primary, #e5534b)' }}>{state.error}</p> : null}
        <div style={rowStyle}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13, marginBottom: 2 }}>Portal connection</span>
            <span style={{ display: 'block', fontSize: 12, opacity: 0.6, marginBottom: 8 }}>
              Sign in with a portal admin account. The browser approves this app; the token stays on this machine.
            </span>
            <PortalSignIn compact />
          </span>
        </div>
      </div>
    );
  }

  /**
   * The Admin entry's icon, with a count of what is waiting on Ali — tickets
   * to approve or review, clients waiting for an answer — and a green dot when
   * nothing is waiting but an agent is working.
   */
  function AdminEntryIcon(props) {
    const counts = useSyncExternalStore(attention.subscribe, attention.get);
    const waiting = counts ? counts.approve + counts.review + counts.waiting : 0;
    const parts = counts
      ? [
          counts.approve && `${counts.approve} to approve`,
          counts.review && `${counts.review} to review`,
          counts.waiting && `${counts.waiting} client${counts.waiting === 1 ? '' : 's'} waiting`,
          counts.running && `${counts.running} running`,
        ].filter(Boolean)
      : [];
    const badge = {
      position: 'absolute',
      top: -5,
      right: -7,
      minWidth: 13,
      height: 13,
      padding: '0 3px',
      borderRadius: 7,
      fontSize: 9,
      fontWeight: 700,
      lineHeight: '13px',
      textAlign: 'center',
      color: '#fff',
      boxSizing: 'border-box',
    };
    return (
      <span style={{ position: 'relative', display: 'inline-flex' }} title={parts.length ? parts.join(' · ') : undefined}>
        <AdminIcon size={props?.size ?? 16} />
        {waiting > 0 ? (
          <span style={{ ...badge, background: 'var(--dsw-alias-state-warning-primary, #d18f2e)' }}>{waiting > 99 ? '99+' : waiting}</span>
        ) : counts?.running ? (
          <span style={{ ...badge, minWidth: 7, width: 7, height: 7, top: -2, right: -3, padding: 0, background: 'var(--dsw-alias-state-success-primary, #2f9e5b)' }} />
        ) : null}
      </span>
    );
  }

  /** The Inbox's own glyph: a tray, with the actionable count. */
  function InboxIcon({ size = 16 }) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 13h4l2 3h4l2-3h4" />
        <path d="M5.5 5h13l1.5 8v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5z" />
      </svg>
    );
  }

  function InboxEntryIcon(props) {
    const counts = useSyncExternalStore(attention.subscribe, attention.get);
    const waiting = counts ? counts.approve + counts.review + counts.waiting : 0;
    return (
      <span style={{ position: 'relative', display: 'inline-flex' }} title={waiting ? `${waiting} item(s) need you` : 'Inbox'}>
        <InboxIcon size={props?.size ?? 16} />
        {waiting > 0 ? (
          <span
            style={{
              position: 'absolute',
              top: -5,
              right: -7,
              minWidth: 13,
              height: 13,
              padding: '0 3px',
              borderRadius: 7,
              fontSize: 9,
              fontWeight: 700,
              lineHeight: '13px',
              textAlign: 'center',
              color: '#fff',
              boxSizing: 'border-box',
              background: 'var(--dsw-alias-state-warning-primary, #d18f2e)',
            }}
          >
            {waiting > 99 ? '99+' : waiting}
          </span>
        ) : null}
      </span>
    );
  }

  /* ————— Clients in the sidebar ————— */

  /*
   * Two presentations of the same data. When the Harness declares the
   * `sidebar.workspaces.section` slot — the PTech Admin build does — a "Clients"
   * section owns the tree; otherwise the flat `sidebar.panellist` rows stay,
   * exactly as they were. Both open a `main` page per client, so the tree's
   * client rows can select the page the rows would have opened.
   *
   * A row is a `main` page under `admin-client-<id>` plus, without the
   * section, a `sidebar.panellist` entry under the same id; the set is rebuilt
   * from `/admin/clients` and `/admin/tickets` once a minute and on focus.
   */
  const CLIENT_ROWS_MS = 60_000;
  const CLIENT_ROWS_MAX = 12;
  const CLIENT_ROWS_ORDER = 13;
  const CLIENT_TINTS = ['#4c8dff', '#d18f2e', '#2f9e5b', '#b45fd6', '#d1495b', '#1f9fb4', '#8a8f2e', '#6b6fd6'];

  /** True while the workspace browser declares the section slot. */
  let sectionAvailable = false;
  /** Run the client-row sync now; replaced while the rows are registered. */
  let refreshClientRows = () => {};

  /** client id → what is waiting on Ali for that client, for the row's badge. */
  const clientBadges = (() => {
    let value = new Map();
    const subs = new Set();
    return {
      set(next) {
        value = next;
        for (const notify of subs) notify();
      },
      subscribe(notify) {
        subs.add(notify);
        return () => subs.delete(notify);
      },
      get: () => value,
    };
  })();

  const initials = (c) => {
    const words = (c.name || c.email.split('@')[0]).split(/[\s._-]+/).filter(Boolean);
    return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase();
  };
  const tintOf = (id) => CLIENT_TINTS[[...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % CLIENT_TINTS.length];

  /** The round initials chip shared by the legacy row and the tree row. */
  function clientAvatar(c, size = 16) {
    return (
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: tintOf(c.id),
          color: '#fff',
          fontSize: Math.round(size * 0.5),
          fontWeight: 700,
          lineHeight: `${size}px`,
          textAlign: 'center',
          letterSpacing: -0.3,
        }}
      >
        {initials(c)}
      </span>
    );
  }

  /** A project row's folder: the count and tint say how much is open in it. */
  function ProjectGlyph({ color }) {
    return (
      <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color }}>
        <path d="M1.8 4.2a1 1 0 0 1 1-1h3.1l1.3 1.5h5.9a1 1 0 0 1 1 1v6.1a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z" />
      </svg>
    );
  }

  function clientIcon(c) {
    return function ClientRowIcon(props) {
      const size = props?.size ?? 16;
      const badge = useSyncExternalStore(clientBadges.subscribe, clientBadges.get, clientBadges.get).get(c.id);
      return (
        <span style={{ position: 'relative', display: 'inline-flex' }} title={badge?.text}>
          {clientAvatar(c, size)}
          {badge?.count ? (
            <span
              style={{
                position: 'absolute',
                top: -4,
                right: -5,
                minWidth: 11,
                height: 11,
                padding: '0 2px',
                borderRadius: 6,
                fontSize: 8,
                fontWeight: 700,
                lineHeight: '11px',
                textAlign: 'center',
                color: '#fff',
                boxSizing: 'border-box',
                background: 'var(--dsw-alias-state-warning-primary, #d18f2e)',
              }}
            >
              {badge.count > 9 ? '9+' : badge.count}
            </span>
          ) : null}
        </span>
      );
    };
  }

  function clientPage(clientId) {
    return function ClientRowPage() {
      return <ClientPage api={api} host={host} files={files} clientId={clientId} />;
    };
  }

  /** client id → the disposer of its `main` page. */
  const clientPages = new Map();

  /** Register a client's main page on demand, so a tree click never races the poll. */
  function ensureClientPage(c) {
    if (clientPages.has(c.id)) return;
    try {
      clientPages.set(
        c.id,
        ctx.slots.register({ name: 'main', key: `admin-client-${c.id}`, locale: NAMESPACE }, clientPage(c.id)),
      );
    } catch (error) {
      console.warn(`admin: could not register client page ${c.id}:`, error?.message ?? error);
    }
  }

  function releaseClientPage(id) {
    clientPages.get(id)?.();
    clientPages.delete(id);
  }

  /** Keep the rows and pages in step with the client list until the returned stop runs. */
  function syncClientRows() {
    /** panellist row id → { sig, dispose } */
    const rows = new Map();
    let stopped = false;
    const pass = async () => {
      // With the workspace section, the tree above owns the lists and is the
      // only poller; the flat rows are empty, so this legacy pass stays out of
      // the network instead of fetching the same three endpoints every minute.
      if (sectionAvailable) {
        for (const row of rows.values()) row.dispose();
        rows.clear();
        return;
      }
      let clients;
      let tickets;
      try {
        const [c, t] = await Promise.all([api('GET', '/admin/clients'), api('GET', '/admin/tickets')]);
        clients = c?.clients ?? [];
        tickets = t?.tickets ?? [];
      } catch {
        return; // signed out or offline: keep what is shown
      }
      if (stopped) return;
      const latest = new Map();
      const badges = new Map();
      for (const t of tickets) {
        if (t.kind === 'system' || !t.client_email) continue;
        latest.set(t.client_email, Math.max(latest.get(t.client_email) ?? 0, t.updated_at ?? 0));
        const fresh = t.status === 'new';
        const waiting = Boolean(t.client_waiting_since) && !['new', 'done', 'declined'].includes(t.status);
        if (!fresh && !waiting) continue;
        const b = badges.get(t.client_email) ?? { approve: 0, answer: 0 };
        if (fresh) b.approve += 1;
        if (waiting) b.answer += 1;
        badges.set(t.client_email, b);
      }
      const active = (c) => Math.max(latest.get(c.email) ?? 0, c.created_at ?? 0);
      const eligible = clients
        .filter((c) => c.role !== 'admin' && typeof c.id === 'string' && c.email)
        .sort((a, b) => active(b) - active(a));
      // The tree shows every client; the legacy rows keep their 12-row limit.
      const pageClients = sectionAvailable ? eligible : eligible.slice(0, CLIENT_ROWS_MAX);
      const wantedPages = new Set(pageClients.map((c) => c.id));
      for (const c of pageClients) ensureClientPage(c);
      for (const id of [...clientPages.keys()]) {
        if (!wantedPages.has(id)) releaseClientPage(id);
      }
      const byId = new Map();
      for (const c of eligible) {
        const b = badges.get(c.email);
        if (!b) continue;
        const text = [b.approve && `${b.approve} to approve`, b.answer && `${b.answer} waiting for an answer`].filter(Boolean).join(' · ');
        byId.set(c.id, { count: b.approve + b.answer, text });
      }
      clientBadges.set(byId);
      // With the section, the client rows live in its tree; keep the flat list empty.
      if (sectionAvailable) {
        for (const row of rows.values()) row.dispose();
        rows.clear();
        return;
      }
      const shown = eligible.slice(0, CLIENT_ROWS_MAX);
      const wanted = new Set();
      shown.forEach((c, i) => {
        const id = `admin-client-${c.id}`;
        const label = c.name || c.email;
        const sig = `${CLIENT_ROWS_ORDER + i}|${label}|${initials(c)}`;
        wanted.add(id);
        if (rows.get(id)?.sig === sig) return;
        rows.get(id)?.dispose();
        rows.set(id, {
          sig,
          dispose: ctx.slots.register({ name: 'sidebar.panellist', id, order: CLIENT_ROWS_ORDER + i, label }, clientIcon(c)),
        });
      });
      for (const [id, row] of rows) {
        if (wanted.has(id)) continue;
        row.dispose();
        rows.delete(id);
      }
    };
    void pass();
    refreshClientRows = () => { void pass(); };
    const timer = setInterval(() => void pass(), CLIENT_ROWS_MS);
    const onFocus = () => void pass();
    window.addEventListener('focus', onFocus);
    return () => {
      stopped = true;
      refreshClientRows = () => {};
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      for (const row of rows.values()) row.dispose();
      rows.clear();
      for (const id of [...clientPages.keys()]) releaseClientPage(id);
    };
  }

  /* ————— Clients → Projects → Tickets, in the workspace browser ————— */

  const TICKET_DOT = {
    new: 'var(--dsw-alias-state-warning-primary, #d18f2e)',
    approved: 'var(--dsw-alias-state-business-primary, #4c8dff)',
    in_progress: 'var(--dsw-alias-state-success-primary, #2f9e5b)',
    review: 'var(--dsw-alias-state-business-primary, #4c8dff)',
    done: 'var(--dsw-alias-label-tertiary, #8a9099)',
    declined: 'var(--dsw-alias-label-tertiary, #8a9099)',
  };
  const isClosedTicket = (t) => t.status === 'done' || t.status === 'declined';
  const openTicketCount = (tickets) => tickets.filter((t) => !isClosedTicket(t)).length;
  /** Open first, then newest; a closed ticket never outranks an open one. */
  const ticketOrder = (a, b) => Number(isClosedTicket(a)) - Number(isClosedTicket(b)) || (b.updated_at ?? 0) - (a.updated_at ?? 0);

  function copyTicketLink(ticket) {
    const link = `https://ptechsolutions.net/portal/admin#ticket=${ticket.id}`;
    void navigator.clipboard?.writeText(link).catch(() => undefined);
  }

  /**
   * Approve a new ticket, then let the tree poll again. A client's ticket asks
   * first, as the workbench does: approving it emails the client.
   */
  async function approveTicket(ticket, changed) {
    if (ticket.kind !== 'system') {
      const who = ticket.client_email ?? 'The client';
      if (!window.confirm(`Approve #${ticket.id}?\n\n${who} is emailed about this change.`)) return;
    }
    try {
      await api('PATCH', `/admin/tickets/${ticket.id}`, { status: 'approved' });
      changed?.();
    } catch (error) {
      console.warn(`admin: could not approve ticket ${ticket.id}:`, error?.message ?? error);
    }
  }

  /**
   * Open a ticket's latest run conversation when it has one; otherwise (or on
   * any failure) open the ticket in Admin. The run fields are the same ones
   * the Tasks tab hands `host.conversation.open`.
   */
  async function openTicketRun(ticket) {
    try {
      const detail = await api('GET', `/admin/tickets/${ticket.id}`);
      const runs = Array.isArray(detail?.runs) ? detail.runs : [];
      for (let i = runs.length - 1; i >= 0; i -= 1) {
        const run = runs[i];
        if (!run?.session_id || !run?.session_dir) continue;
        if (!conversation.available()) break;
        await conversation.open({ runId: run.id, sessionId: run.session_id, sessionDir: run.session_dir });
        return;
      }
    } catch (error) {
      console.warn(`admin: could not open a run for ticket ${ticket.id}:`, error?.message ?? error);
    }
    openTicket({ ticketId: ticket.id });
  }

  /** Open a client's main page, registering it first if the poll has not run yet. */
  function openClientPage(client, selectPanel) {
    ensureClientPage(client);
    try {
      selectPanel(`admin-client-${client.id}`);
    } catch (error) {
      console.warn(`admin: could not select the page for client ${client.id}:`, error?.message ?? error);
    }
  }

  /** A non-interactive line inside the tree: no pointer, no hover, no fake row. */
  function TreeNote({ children, nested = false }) {
    return <div className="pta-tree-note" style={nested ? { paddingLeft: 30 } : undefined}>{children}</div>;
  }

  /** The ticket rows of one project (or of Mine), with done/declined behind one row. */
  function TicketList({ Row, tickets, changed }) {
    const [showClosed, setShowClosed] = useState(false);
    const open = tickets.filter((t) => !isClosedTicket(t));
    const closed = tickets.filter((t) => isClosedTicket(t));
    const shown = showClosed ? [...open, ...closed] : open;
    const menu = (ticket) => {
      const items = [
        { id: 'open', label: 'Open conversation', onSelect: () => void openTicketRun(ticket) },
        { id: 'workbench', label: 'Open in workbench', onSelect: () => openTicket({ ticketId: ticket.id }) },
      ];
      if (ticket.status === 'new') items.push({ id: 'approve', label: 'Approve', onSelect: () => void approveTicket(ticket, changed) });
      items.push({ id: 'copy', label: 'Copy ticket link', separatorBefore: true, onSelect: () => copyTicketLink(ticket) });
      return items;
    };
    return (
      <>
        {shown.map((ticket) => (
          <Row
            key={ticket.id}
            dot={TICKET_DOT[ticket.status] ?? TICKET_DOT.done}
            label={`#${ticket.id} ${ticket.title || ticket.title_en || '(untitled)'}`}
            trailing={(
              <span className="pta-trail">
                {ago(ticket.updated_at)}
                <span className="pta-trail__go" aria-hidden="true">↗</span>
              </span>
            )}
            menuItems={menu(ticket)}
            onClick={() => void openTicketRun(ticket)}
          />
        ))}
        {closed.length > 0 && (
          <Row
            label={showClosed ? `Hide closed` : `Show closed · ${closed.length}`}
            onClick={() => setShowClosed((value) => !value)}
          />
        )}
      </>
    );
  }

  /** The status dot of a project row: its most urgent open ticket, if any. */
  function projectTint(tickets) {
    const open = tickets.filter((ticket) => !isClosedTicket(ticket));
    if (open.some((ticket) => ticket.status === 'new')) return TICKET_DOT.new;
    if (open.some((ticket) => ticket.status === 'review')) return TICKET_DOT.review;
    if (open.some((ticket) => ticket.status === 'in_progress')) return TICKET_DOT.in_progress;
    return open.length > 0 ? TICKET_DOT.approved : undefined;
  }

  /**
   * Shape clients, projects and tickets into the tree rows the section renders.
   * A ticket the tree cannot place — no client on it, or a client the portal no
   * longer lists — is returned separately as `unsorted`, so it is still
   * reachable instead of silently missing from the sidebar.
   */
  function buildClientTree(clients, projects, tickets) {
    const projectById = new Map(projects.map((p) => [String(p.id), p]));
    const latest = new Map();
    for (const t of tickets) {
      if (t.kind === 'system' || !t.client_email) continue;
      latest.set(t.client_email, Math.max(latest.get(t.client_email) ?? 0, t.updated_at ?? 0));
    }
    const active = (c) => Math.max(latest.get(c.email) ?? 0, c.created_at ?? 0);
    const eligible = clients
      .filter((c) => c.role !== 'admin' && typeof c.id === 'string' && c.email)
      .sort((a, b) => active(b) - active(a));
    /** Ticket ids already shown under their client and project. */
    const placed = new Set();
    const tree = eligible.map((client) => {
      const own = tickets.filter((t) => t.kind !== 'system' && t.client_email === client.email);
      for (const t of own) placed.add(t.id);
      const byProject = new Map();
      const noProject = [];
      for (const t of own) {
        if (t.project_id === null || t.project_id === undefined) {
          noProject.push(t);
          continue;
        }
        const pid = String(t.project_id);
        if (!byProject.has(pid)) byProject.set(pid, []);
        byProject.get(pid).push(t);
      }
      const ids = [...new Set((Array.isArray(client.projectIds) ? client.projectIds : []).map(String))];
      for (const pid of byProject.keys()) if (!ids.includes(pid)) ids.push(pid);
      const groups = ids.map((pid) => ({
        id: pid,
        name: projectById.get(pid)?.name ?? pid,
        tickets: [...(byProject.get(pid) ?? [])].sort(ticketOrder),
      }));
      groups.sort((a, b) => openTicketCount(b.tickets) - openTicketCount(a.tickets) || a.name.localeCompare(b.name));
      if (noProject.length > 0) {
        groups.push({ id: '__none__', name: 'No project', tickets: [...noProject].sort(ticketOrder) });
      }
      const approve = own.filter((t) => t.status === 'new').length;
      const answer = own.filter((t) => Boolean(t.client_waiting_since) && !['new', 'done', 'declined'].includes(t.status)).length;
      return { client, approve, answer, badge: approve + answer, projects: groups };
    });
    const unsorted = tickets
      .filter((t) => t.kind !== 'system' && !placed.has(t.id))
      .sort(ticketOrder);
    return { tree, unsorted };
  }

  /** A section reload can be asked for by three watchers at once; run one. */
  const SECTION_REFRESH_MS = 5 * 60_000;
  const SECTION_DEBOUNCE_MS = 300;

  /**
   * The Clients section: clients, their projects and their open tickets, live.
   *
   * The tree reads the three lists once and then reloads only when something
   * says they changed: the 15-second `/admin/attention` count diff, an event
   * from the Host's own poll, window focus, or the refresh button. A reload
   * that returns the same data does not re-render (`sig`), and a five-minute
   * safety pass catches anything the cursors missed. `Section` and `Row` come
   * from the ui-workspace section slot, so this file imports no Harness
   * internals.
   */
  function ClientsSection({ Section, TreeRow, selectPanel }) {
    const [state, setState] = useState({ clients: [], projects: [], tickets: [], loading: true, error: '' });
    const signature = useRef('');
    const mounted = useRef(true);
    /** Controlled expansion: rows toggle on their whole surface, not only the chevron. */
    const [openRows, setOpenRows] = useState({});
    const rowOpen = (key, fallback) => (openRows[key] === undefined ? fallback : openRows[key]);
    const setRowOpen = (key, open) => setOpenRows((previous) => ({ ...previous, [key]: open }));
    const toggleRow = (key, fallback) => setRowOpen(key, !rowOpen(key, fallback));
    const load = useCallback(async () => {
      try {
        const [c, p, t] = await Promise.all([
          api('GET', '/admin/clients'),
          api('GET', '/admin/projects'),
          api('GET', '/admin/tickets'),
        ]);
        if (!mounted.current) return;
        const next = {
          clients: Array.isArray(c?.clients) ? c.clients : [],
          projects: Array.isArray(p?.projects) ? p.projects : [],
          tickets: Array.isArray(t?.tickets) ? t.tickets : [],
          loading: false,
          error: '',
        };
        const sig = JSON.stringify([next.clients, next.projects, next.tickets]);
        if (sig === signature.current) return;
        signature.current = sig;
        setState(next);
      } catch (error) {
        if (mounted.current) {
          setState((prev) => ({ ...prev, loading: false, error: error?.message ?? 'Could not load clients' }));
        }
      }
    }, []);
    useEffect(() => {
      mounted.current = true;
      void load();
      let pending = null;
      const soon = () => {
        clearTimeout(pending);
        pending = setTimeout(() => void load(), SECTION_DEBOUNCE_MS);
      };
      const stopAttention = attention.subscribe(soon);
      window.addEventListener('admin:changed', soon);
      window.addEventListener('focus', soon);
      const every = setInterval(() => void load(), SECTION_REFRESH_MS);
      return () => {
        mounted.current = false;
        stopAttention();
        clearTimeout(pending);
        clearInterval(every);
        window.removeEventListener('admin:changed', soon);
        window.removeEventListener('focus', soon);
      };
    }, [load]);

    const { tree, unsorted } = buildClientTree(state.clients, state.projects, state.tickets);
    const mine = state.tickets.filter((t) => t.kind === 'system').sort(ticketOrder);
    const openTotal =
      tree.reduce((sum, client) => sum + client.projects.reduce((inner, project) => inner + openTicketCount(project.tickets), 0), 0) +
      openTicketCount(unsorted) +
      openTicketCount(mine);
    const refresh = (
      <button
        type="button"
        aria-label="Refresh clients"
        title="Refresh clients"
        onClick={() => void load()}
        style={{ width: 24, height: 24, border: 0, borderRadius: 4, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
      >
        ↻
      </button>
    );
    return (
      <Section id="admin-clients" title="Clients" count={openTotal || undefined} actions={refresh}>
        {state.loading && <TreeNote>Loading clients…</TreeNote>}
        {state.error !== '' && <TreeRow label={`${state.error} — click to retry`} onClick={() => void load()} />}
        {tree.map(({ client, badge, projects }, index) => {
          const clientKey = `client:${client.id}`;
          const clientExpanded = rowOpen(clientKey, index === 0);
          return (
            <TreeRow
              key={client.id}
              icon={clientAvatar(client)}
              label={client.name || client.email}
              badge={badge || undefined}
              expanded={clientExpanded}
              onToggle={(open) => setRowOpen(clientKey, open)}
              onClick={() => openClientPage(client, selectPanel)}
              menuItems={[{ id: 'open-client', label: 'Open client page', onSelect: () => openClientPage(client, selectPanel) }]}
              children={projects.length > 0 ? projects.map((project, projectIndex) => {
                const projectKey = `project:${client.id}:${project.id}`;
                const projectDefault = index === 0 && projectIndex === 0 && project.tickets.length > 0;
                const projectExpanded = rowOpen(projectKey, projectDefault);
                return (
                  <TreeRow
                    key={`${client.id}:${project.id}`}
                    icon={<ProjectGlyph color={projectTint(project.tickets)} />}
                    label={project.name}
                    badge={openTicketCount(project.tickets) || undefined}
                    expanded={projectExpanded}
                    onToggle={(open) => setRowOpen(projectKey, open)}
                    onClick={() => toggleRow(projectKey, projectDefault)}
                    menuItems={[{ id: 'open-project-tickets', label: 'Show project tickets', onSelect: () => setRowOpen(projectKey, true) }]}
                    children={project.tickets.length > 0
                      ? <TicketList Row={TreeRow} tickets={project.tickets} changed={() => void load()} />
                      : <TreeNote nested>No open tickets</TreeNote>}
                  />
                );
              }) : undefined}
            />
          );
        })}
        {!state.loading && state.error === '' && tree.length === 0 && <TreeNote>No clients yet</TreeNote>}
        {unsorted.length > 0 && (() => {
          const key = 'group:unsorted';
          const expanded = rowOpen(key, true);
          return (
            <TreeRow
              label="Unsorted"
              badge={openTicketCount(unsorted) || undefined}
              expanded={expanded}
              onToggle={(open) => setRowOpen(key, open)}
              onClick={() => toggleRow(key, true)}
            >
              <TicketList Row={TreeRow} tickets={unsorted} changed={() => void load()} />
            </TreeRow>
          );
        })()}
        {mine.length > 0 && (() => {
          const key = 'group:mine';
          const expanded = rowOpen(key, false);
          return (
            <TreeRow
              label="Mine"
              badge={openTicketCount(mine) || undefined}
              expanded={expanded}
              onToggle={(open) => setRowOpen(key, open)}
              onClick={() => toggleRow(key, false)}
            >
              <TicketList Row={TreeRow} tickets={mine} changed={() => void load()} />
            </TreeRow>
          );
        })()}
      </Section>
    );
  }

  /* ————— The ticket, merged into its conversation ————— */

  /**
   * One ticket's live detail: its fields, its thread and its runs. The
   * conversation dock reads it once and again when the portal says something
   * changed, so the chat and the ticket are the same surface.
   */
  function useTicketDetail(ticketId) {
    const [state, setState] = useState({ ticket: null, messages: [], runs: [], loading: true, error: '' });
    const load = useCallback(async () => {
      if (ticketId === null || ticketId === undefined) return;
      try {
        const detail = await api('GET', `/admin/tickets/${ticketId}`);
        setState({
          ticket: detail?.ticket ?? null,
          messages: Array.isArray(detail?.messages) ? detail.messages : [],
          runs: Array.isArray(detail?.runs) ? detail.runs : [],
          loading: false,
          error: '',
        });
      } catch (error) {
        setState((prev) => ({ ...prev, loading: false, error: error?.message ?? 'Could not load the ticket.' }));
      }
    }, [ticketId]);
    useEffect(() => {
      // A different ticket must not show the previous one's thread while the
      // new read is in flight.
      setState({ ticket: null, messages: [], runs: [], loading: true, error: '' });
    }, [ticketId]);
    useEffect(() => {
      let alive = true;
      void load();
      const changed = () => { if (alive) void load(); };
      window.addEventListener('admin:changed', changed);
      window.addEventListener('focus', changed);
      return () => {
        alive = false;
        window.removeEventListener('admin:changed', changed);
        window.removeEventListener('focus', changed);
      };
    }, [load]);
    return [state, load];
  }

  /**
   * While this conversation is on screen, what is typed in it belongs to the
   * ticket: the Host mirrors each new user message as a private note. The
   * header can mount more than once for the same conversation (split pane,
   * pop-out), so count the mounts and only the last one unfollows.
   */
  const ticketFollow = { key: null, mounts: 0 };

  function followTicket(ticketId, sessionId) {
    const key = `${ticketId}:${sessionId}`;
    if (ticketFollow.key !== key) {
      ticketFollow.key = key;
      ticketFollow.mounts = 0;
    }
    ticketFollow.mounts += 1;
    if (ticketFollow.mounts === 1) void command(`follow ${ticketId} ${sessionId}`).catch(() => undefined);
    return () => {
      if (ticketFollow.key !== key) return;
      ticketFollow.mounts -= 1;
      if (ticketFollow.mounts > 0) return;
      ticketFollow.key = null;
      // Named, so a late unfollow cannot cancel the conversation now on screen.
      void command(`unfollow ${sessionId}`).catch(() => undefined);
    };
  }

  /** Ticket summaries for the conversation header, kept briefly across mounts. */
  const ticketBriefs = new Map();
  const TICKET_BRIEF_MS = 30_000;

  /**
   * The ticket behind a run session, for the header's actions. One read when
   * the header mounts (and after a minute), not a poll: the header only needs
   * the status to decide whether Approve is offered.
   */
  function useTicketBrief(ticketId) {
    const [brief, setBrief] = useState(() => (ticketId === null ? null : ticketBriefs.get(ticketId)?.ticket ?? null));
    useEffect(() => {
      if (ticketId === null) return undefined;
      const hit = ticketBriefs.get(ticketId);
      if (hit && Date.now() - hit.at < TICKET_BRIEF_MS) {
        setBrief(hit.ticket);
        return undefined;
      }
      // Another ticket's summary would offer the wrong moves while this read runs.
      setBrief(null);
      let alive = true;
      api('GET', `/admin/tickets/${ticketId}`).then(
        (detail) => {
          if (!alive) return;
          const ticket = detail?.ticket ?? null;
          if (ticket) ticketBriefs.set(ticketId, { at: Date.now(), ticket });
          setBrief(ticket);
        },
        () => undefined,
      );
      return () => { alive = false; };
    }, [ticketId]);
    return brief;
  }

  const headerActionStyle = {
    height: 24,
    padding: '0 8px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.35))',
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    fontSize: 12,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };

  /**
   * In a run's own conversation header: the ticket's name, one click to the
   * workbench copy, and the moves that belong to the ticket rather than the
   * conversation. The ticket itself lives in the composer dock below, so the
   * chat and the ticket are one screen instead of two tabs.
   */
  function TicketHeaderChip({ sessionId }) {
    const run = ticketFromCwd(useSessionCwd(sessionId));
    const ticketId = run?.ticketId ?? null;
    const brief = useTicketBrief(ticketId);
    useEffect(() => {
      if (ticketId === null || !sessionId) return undefined;
      return followTicket(ticketId, sessionId);
    }, [ticketId, sessionId]);
    if (!run) return null;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <button
          type="button"
          onClick={() => void openTicketRun({ id: run.ticketId })}
          title={`Open ${run.kind === 'task' ? 'system task' : 'client ticket'} #${run.ticketId}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            height: 24,
            padding: '0 8px',
            borderRadius: 6,
            border: `1px solid ${TICKET_COLORS[run.kind]}`,
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            fontSize: 12,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <TicketGlyph size={13} />
          <span>
            {run.kind === 'task' ? 'Task' : 'Ticket'} #{run.ticketId}
          </span>
        </button>
        {brief ? <StatusPill status={brief.status} /> : null}
        <button type="button" style={headerActionStyle} onClick={() => openWorkbenchTicket(run.ticketId)} title="Open the full ticket in the workbench">
          Workbench
        </button>
      </span>
    );
  }

  // Downloads go through the Host (it holds the token and the disk). Uploads
  // need the bytes, which the bridge cannot carry: /admin attach takes paths.
  const files = { download: (path) => json(`download ${path}`) };

  function AdminPage() {
    return <AdminApp api={api} host={host} files={files} platform="dsh" />;
  }

  /* ————— PTech Admin: the native surfaces ————— */

  /**
   * The native admin experience: a Needs-you home, an Inbox, and a ticket
   * strip that lives in the run's own chat. The workbench stays one click
   * away for fleet, SEO, health and the settings that do not belong in chat.
   */

  const NATIVE_STYLES = `
    .pta-page{height:100%;overflow-y:auto;box-sizing:border-box;padding:26px 30px 56px;max-width:1120px;margin:0 auto;color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:1.45}
    .pta-head{display:flex;align-items:flex-start;gap:18px;margin:0 0 18px}
    .pta-head h1{margin:0;font-size:24px;line-height:1.15;font-weight:650;letter-spacing:-0.02em}
    .pta-head p{margin:6px 0 0;font-size:13px;opacity:.65;max-width:620px}
    .pta-head__actions{display:flex;align-items:center;gap:8px;margin-left:auto;padding-top:2px}
    .pta-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 0 22px}
    .pta-kpi{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:12px 14px;border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.22));border-radius:10px;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.06));color:inherit;font:inherit;text-align:left;cursor:pointer}
    .pta-kpi:disabled{cursor:default}
    .pta-kpi:not(:disabled):hover{border-color:var(--dsw-alias-border-primary,rgba(127,127,127,.4))}
    .pta-kpi__value{font-size:22px;font-weight:650;line-height:1.1;font-variant-numeric:tabular-nums}
    .pta-kpi__label{font-size:11.5px;opacity:.7}
    .pta-section{margin:0 0 22px}
    .pta-section__head{display:flex;align-items:baseline;gap:10px;padding:0 2px 7px}
    .pta-section__head h3{margin:0;font-size:13px;font-weight:600}
    .pta-count{display:inline-block;min-width:16px;margin-left:5px;padding:0 5px;border-radius:8px;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.16));font-size:10px;line-height:16px;text-align:center;vertical-align:1px}
    .pta-rows{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.22));border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-primary,transparent)}
    .pta-rows--inbox{max-width:none}
    .pta-row{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:8px 12px;border:0;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.14));background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
    .pta-row:last-child{border-bottom:0}
    .pta-row:hover{background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.07))}
    .pta-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#ff5a1f);outline-offset:-2px}
    .pta-dot{flex:0 0 auto;width:7px;height:7px;border-radius:50%}
    .pta-id{flex:0 0 auto;font-variant-numeric:tabular-nums;font-size:11.5px;opacity:.6}
    .pta-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
    .pta-tag{flex:0 0 auto;padding:1px 5px;border-radius:4px;border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.3));font-size:10px;opacity:.8;max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pta-tag--client{border-color:transparent;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.14));opacity:.75}
    .pta-meta{flex:0 0 auto;font-size:11px;opacity:.55;white-space:nowrap}
    .pta-warn{flex:0 0 auto;font-size:11px;color:var(--dsw-alias-state-warning-primary,#d18f2e);white-space:nowrap}
    .pta-fill{flex:1 1 auto;min-width:8px}
    .pta-actions{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto}
    .pta-btn{height:23px;padding:0 8px;border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.34));border-radius:5px;background:transparent;color:inherit;font:inherit;font-size:11.5px;line-height:1;white-space:nowrap;cursor:pointer}
    .pta-btn:hover{background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.1))}
    .pta-btn:disabled{opacity:.45;cursor:default}
    .pta-btn--primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#ff5a1f);color:#fff}
    .pta-btn--primary:hover{filter:brightness(1.06);background:var(--dsw-alias-brand-primary,#ff5a1f)}
    .pta-btn--ghost{border-color:transparent;opacity:.72}
    .pta-pill{display:inline-flex;align-items:center;height:19px;padding:0 7px;border:1px solid currentColor;border-radius:10px;font-size:10.5px;line-height:1;white-space:nowrap;opacity:.9}
    .pta-empty{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:28px 24px;border:1px dashed var(--dsw-alias-border-secondary,rgba(127,127,127,.3));border-radius:12px}
    .pta-empty h3{margin:0;font-size:15px}
    .pta-empty p{margin:0;opacity:.65;max-width:560px}
    .pta-empty__mark{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:var(--dsw-alias-state-success-secondary,rgba(47,158,91,.16));color:var(--dsw-alias-state-success-primary,#2f9e5b);font-weight:700}
    .pta-signin{display:flex;flex-direction:column;align-items:flex-start;gap:8px;max-width:560px;padding:16px 18px;border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.26));border-radius:10px;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.05))}
    .pta-signin p{margin:0;font-size:12.5px;opacity:.8}
    .pta-signin--compact{padding:10px 12px;border:0;background:transparent}
    .pta-link{color:var(--dsw-alias-brand-primary,#ff5a1f);text-decoration:none}
    .pta-link:hover{text-decoration:underline}
    .pta-search{height:28px;min-width:220px;box-sizing:border-box;padding:0 9px;border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.28));border-radius:6px;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.06));color:inherit;font:inherit;font-size:12px}
    .pta-filters{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}
    .pta-filter{height:24px;padding:0 9px;border:1px solid transparent;border-radius:12px;background:transparent;color:inherit;font:inherit;font-size:11.5px;opacity:.62;cursor:pointer}
    .pta-filter:hover{opacity:.9;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.08))}
    .pta-filter.is-active{opacity:1;border-color:var(--dsw-alias-border-secondary,rgba(127,127,127,.32));background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.12))}
    .pta-tree-note{padding:5px 8px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.7));font-size:12px;line-height:18px;user-select:none}
    .pta-trail{display:inline-flex;align-items:center;gap:4px}
    .pta-trail__go{font-size:10px;line-height:1;opacity:.35}
    .pta-dock{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance,0px) - var(--dsh-composer-side-clearance,0px));max-width:var(--dsh-composer-card-max-width,760px);margin:0 auto 8px;border:0;border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-specific-menu,var(--dsw-alias-bg-elevated,#23252a));backdrop-filter:var(--dsw-menu-backdrop-filter,blur(12px));box-shadow:var(--dsw-elevation-panel,0 10px 30px rgba(0,0,0,.28));--dsw-elevation-stroke-color:var(--dsw-alias-border-l1,rgba(127,127,127,.24));overflow:hidden;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,inherit);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
    .pta-dock .pta-meta{font-size:12px;opacity:.58}
    .pta-dock .pta-btn{height:24px;font-size:12px;border-radius:var(--dsw-radius-sm,6px)}
    .pta-dock .pta-pill{height:20px;font-size:11px}
    .pta-dock__head{display:flex;align-items:center;gap:8px;padding:7px 10px;min-height:34px;flex-wrap:wrap}
    .pta-dock__id{flex:none;font-variant-numeric:tabular-nums;font-size:12px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.72))}
    .pta-dock__title{min-width:0;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500}
    .pta-dock__toggle{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 6px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:12px;cursor:pointer}
    .pta-dock__toggle:hover{color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
    .pta-dock__chev{font-size:10px;line-height:1;opacity:.55}
    .pta-dock__body{border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));max-height:260px;overflow-y:auto;padding:8px 10px}
    .pta-dock__last{padding:0 10px 7px;font-size:12px;color:var(--dsw-alias-label-secondary,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pta-dock__last .pta-meta{font-size:12px}
    .pta-dock__compose{display:flex;align-items:center;gap:8px;padding:6px 10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));flex-wrap:wrap}
    .pta-modes{display:inline-flex;padding:2px;gap:1px;border-radius:var(--dsw-radius-md,7px);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.13))}
    .pta-mode{height:22px;padding:0 8px;border:0;border-radius:calc(var(--dsw-radius-md,7px) - 2px);background:transparent;color:var(--dsw-alias-label-tertiary,inherit);font:inherit;font-size:12px;line-height:22px;cursor:pointer}
    .pta-mode:hover{color:var(--dsw-alias-label-secondary,inherit)}
    .pta-mode.is-active{color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-specific-menu,var(--dsw-alias-bg-elevated,#23252a));box-shadow:0 1px 2px rgba(0,0,0,.18)}
    .pta-mode:disabled{opacity:.35;cursor:default}
    .pta-hint{min-width:0;font-size:12px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.7));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pta-facts{display:flex;flex-wrap:wrap;gap:4px 12px;padding:0 0 8px;margin:0 0 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));font-size:12px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.72))}
    .pta-facts strong{font-weight:500;color:var(--dsw-alias-label-secondary,inherit)}
    .pta-thread{display:flex;flex-direction:column;gap:8px}
    .pta-msg{padding:7px 9px;border-radius:var(--dsw-radius-md,7px);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.09))}
    .pta-msg--client{background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.13))}
    .pta-msg.is-note{border-left:2px solid var(--dsw-alias-state-warning-primary,#d18f2e)}
    .pta-msg__meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.72));margin-bottom:3px}
    .pta-msg__body{font-size:13px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:120px;overflow-y:auto}
    .pta-runs{display:flex;flex-direction:column;gap:4px;margin-top:2px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18))}
    .pta-run{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary,inherit)}
    @media (max-width:760px){.pta-page{padding:18px 16px 40px}.pta-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.pta-head{flex-direction:column}.pta-head__actions{margin-left:0;width:100%}.pta-search{flex:1 1 auto;min-width:0}.pta-tag{max-width:120px}}
  `;

  const CLIENT_VISIBLE_STATUSES = new Set(['approved', 'declined', 'done']);
  /** A deep link arrived before the initial-view timer: it owns the first screen. */
  let handledDeepLink = false;
  const WORKBENCH_PANEL = 'admin-workbench';
  const INBOX_PANEL = 'admin-inbox';
  const HOME_PANEL = 'admin';

  const STATUS_TINT = {
    new: 'var(--dsw-alias-state-warning-primary, #d18f2e)',
    approved: 'var(--dsw-alias-state-business-primary, #4c8dff)',
    in_progress: 'var(--dsw-alias-state-success-primary, #2f9e5b)',
    review: 'var(--dsw-alias-state-business-primary, #4c8dff)',
    done: 'var(--dsw-alias-label-tertiary, #8a9099)',
    declined: 'var(--dsw-alias-label-tertiary, #8a9099)',
  };
  const STATUS_TEXT = {
    new: 'Needs approval',
    approved: 'Approved',
    in_progress: 'Running',
    review: 'Review',
    done: 'Done',
    declined: 'Declined',
  };
  const tintOfStatus = (status) => STATUS_TINT[status] ?? STATUS_TINT.done;
  const ticketLabel = (ticket) => ticket?.title_en || ticket?.title || '(untitled)';
  const dollars = (cents) => (Number.isFinite(Number(cents)) ? `$${(Number(cents) / 100).toFixed(2)}` : '');
  const isWaiting = (ticket) => Boolean(ticket) && Number(ticket?.client_waiting_since ?? 0) > 0 && !isClosedTicket(ticket) && ticket?.status !== 'new';

  /**
   * The four lists the native pages share, refreshed when the portal says
   * something changed. One fetch per page, not a poll per widget.
   */
  function useLiveAdmin() {
    const [state, setState] = useState({
      tickets: [], running: [], recent: [], queue: [], attention: null, loading: true, error: '', code: '', at: 0,
    });
    const mounted = useRef(true);
    const load = useCallback(async () => {
      try {
        // Tickets are the sentinel: their failure is the page's (signed out,
        // offline). The extra desks are best-effort, so an older Worker
        // without one still leaves the home usable.
        const tickets = await api('GET', '/admin/tickets');
        const [runs, queue, attentionNow] = await Promise.all([
          api('GET', '/admin/runs').catch(() => null),
          api('GET', '/admin/queue').catch(() => null),
          api('GET', '/admin/attention').catch(() => null),
        ]);
        if (!mounted.current) return;
        setState({
          tickets: Array.isArray(tickets?.tickets) ? tickets.tickets : [],
          running: Array.isArray(runs?.running) ? runs.running : [],
          recent: Array.isArray(runs?.recent) ? runs.recent : [],
          queue: Array.isArray(queue?.queue) ? queue.queue : [],
          attention: attentionNow ?? null,
          loading: false,
          error: '',
          code: '',
          at: Date.now(),
        });
      } catch (error) {
        if (!mounted.current) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: error?.message ?? 'Could not reach the portal.',
          code: error?.code ?? '',
        }));
      }
    }, []);
    useEffect(() => {
      mounted.current = true;
      void load();
      let pending = null;
      const soon = () => {
        clearTimeout(pending);
        pending = setTimeout(() => void load(), 250);
      };
      const stopAttention = attention.subscribe(soon);
      window.addEventListener('admin:changed', soon);
      window.addEventListener('focus', soon);
      const every = setInterval(() => void load(), 30_000);
      return () => {
        mounted.current = false;
        stopAttention();
        clearTimeout(pending);
        clearInterval(every);
        window.removeEventListener('admin:changed', soon);
        window.removeEventListener('focus', soon);
      };
    }, [load]);
    return { ...state, reload: load };
  }

  /** Group one live snapshot into what a person can act on, in urgency order. */
  function ticketGroups(data) {
    const nowSeconds = Date.now() / 1000;
    const tickets = Array.isArray(data.tickets) ? data.tickets : [];
    const queue = Array.isArray(data.queue) ? data.queue : [];
    const stuck = new Set(
      queue
        .filter((item) => !(Array.isArray(item?.eligible) ? item.eligible.length > 0 : Boolean(item?.eligible)))
        .map((item) => Number(item?.id)),
    );
    return {
      approvals: tickets.filter((ticket) => ticket.status === 'new'),
      reviews: tickets.filter((ticket) => ticket.status === 'review'),
      waiting: tickets.filter(isWaiting),
      stalled: tickets.filter((ticket) => ticket.status === 'in_progress' && nowSeconds - Number(ticket.updated_at ?? 0) > 45 * 60),
      stuck: tickets.filter((ticket) => ticket.status === 'approved' && stuck.has(Number(ticket.id))),
      running: Array.isArray(data.running) ? data.running : [],
      failed: (Array.isArray(data.recent) ? data.recent : [])
        .filter((run) => run.status === 'failed' && nowSeconds - Number(run.finished_at ?? 0) < 86_400)
        .slice(0, 8),
    };
  }

  function actionableCount(groups) {
    const ids = new Set();
    for (const list of [groups.approvals, groups.reviews, groups.waiting, groups.stalled, groups.stuck]) {
      for (const ticket of list) ids.add(ticket.id);
    }
    return ids.size;
  }

  /** Set a ticket's status, confirming the moves that email the client. */
  async function changeTicketStatus(ticket, status) {
    if (CLIENT_VISIBLE_STATUSES.has(status) && ticket.kind !== 'system') {
      const who = ticket.client_email || ticket.client_name || 'The client';
      const what = status === 'approved' ? 'Approve' : status === 'declined' ? 'Decline' : 'Mark done';
      if (!window.confirm(`${what} #${ticket.id}?\n\n${who} is emailed about this change.`)) return false;
    }
    await api('PATCH', `/admin/tickets/${ticket.id}`, { status });
    ticketBriefs.delete(ticket.id);
    window.dispatchEvent(new CustomEvent('admin:changed', { detail: { kind: 'ticket.status', ticketId: ticket.id } }));
    return true;
  }

  async function markTicketAnswered(ticket) {
    await api('POST', `/admin/tickets/${ticket.id}/answered`);
    window.dispatchEvent(new CustomEvent('admin:changed', { detail: { kind: 'ticket.answered', ticketId: ticket.id } }));
  }

  /** The moves a row offers, chosen by status rather than by page. */
  function TicketRowActions({ ticket }) {
    if (ticket.status === 'new') {
      return (
        <>
          <PtaButton kind="primary" onClick={() => void changeTicketStatus(ticket, 'approved')}>Approve</PtaButton>
          <PtaButton kind="ghost" onClick={() => void changeTicketStatus(ticket, 'declined')}>Decline</PtaButton>
        </>
      );
    }
    if (ticket.status === 'review') {
      return (
        <>
          <PtaButton kind="primary" onClick={() => void changeTicketStatus(ticket, 'done')}>Done</PtaButton>
          <PtaButton onClick={() => void changeTicketStatus(ticket, 'approved')}>Run again</PtaButton>
        </>
      );
    }
    if (isWaiting(ticket)) {
      return <PtaButton kind="ghost" onClick={() => void markTicketAnswered(ticket)}>No reply needed</PtaButton>;
    }
    if (ticket.status === 'in_progress') {
      return <PtaButton onClick={() => void changeTicketStatus(ticket, 'approved')}>Requeue</PtaButton>;
    }
    return null;
  }

  function PtaButton({ children, kind = 'default', className = '', ...rest }) {
    return <button type="button" className={`pta-btn pta-btn--${kind}${className ? ` ${className}` : ''}`} {...rest}>{children}</button>;
  }

  function StatusPill({ status }) {
    const tint = tintOfStatus(status);
    return (
      <span className="pta-pill" style={{ color: tint, borderColor: tint }}>
        {STATUS_TEXT[status] ?? status ?? 'unknown'}
      </span>
    );
  }

  function TicketLine({ ticket, actions = null, reason = '', detail = '' }) {
    const open = () => void openTicketRun(ticket);
    return (
      <div
        className="pta-row"
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        }}
      >
        <span className="pta-dot" style={{ background: tintOfStatus(ticket.status) }} />
        <span className="pta-id">#{ticket.id}</span>
        <span className="pta-title" title={ticketLabel(ticket)}>{ticketLabel(ticket)}</span>
        {ticket.kind === 'system'
          ? <span className="pta-tag">mine</span>
          : <span className="pta-tag pta-tag--client" title={ticket.client_email ?? ''}>{ticket.client_email || 'client'}</span>}
        <span className="pta-meta">{ticket.project_name || 'no project'}</span>
        {reason ? <span className="pta-warn">{reason}</span> : null}
        <span className="pta-fill" />
        {detail ? <span className="pta-meta">{detail}</span> : null}
        <span className="pta-meta">{ago(ticket.updated_at)}</span>
        {actions ? <span className="pta-actions" onClick={(event) => event.stopPropagation()}>{actions}</span> : null}
      </div>
    );
  }

  function Kpi({ label, value, hint, tint, onClick }) {
    return (
      <button type="button" className="pta-kpi" onClick={onClick} title={hint} disabled={!onClick}>
        <span className="pta-kpi__value" style={{ color: tint }}>{value}</span>
        <span className="pta-kpi__label">{label}</span>
      </button>
    );
  }

  function EmptyState({ title, text, children }) {
    return (
      <div className="pta-empty">
        <div className="pta-empty__mark" aria-hidden="true">✓</div>
        <h3>{title}</h3>
        <p>{text}</p>
        {children}
      </div>
    );
  }

  function isAuthError(code) {
    return code === 'signed_out' || code === 'unauthorized' || code === 'forbidden' || code === 'no_signin';
  }

  /**
   * The one sign-in surface: start a PKCE flow, send the browser to the portal,
   * then wait for the `ptech-admin://auth` code to come back. The same flow
   * works from a cold start because the Host keeps the verifier on disk.
   */
  function PortalSignIn({ onDone = null, compact = false }) {
    const [state, setState] = useState({ phase: 'idle', url: '', error: '' });
    const done = useRef(onDone);
    done.current = onDone;
    useEffect(() => {
      if (state.phase !== 'waiting') return undefined;
      let alive = true;
      let timer = null;
      const poll = async () => {
        try {
          const status = await json('signin-status');
          if (!alive) return;
          if (status?.verificationUrl) setState((prev) => ({ ...prev, url: status.verificationUrl }));
          if (status?.signedIn) {
            setState({ phase: 'done', url: '', error: '' });
            done.current?.();
            return;
          }
          if (status?.startedAt && Date.now() - Number(status.startedAt) > 10 * 60_000) {
            setState({ phase: 'idle', url: '', error: 'That sign-in expired. Start again.' });
            return;
          }
        } catch {
          // The Host may be between reloads; the next tick tries again.
        }
        if (alive) timer = setTimeout(poll, 2000);
      };
      void poll();
      return () => {
        alive = false;
        clearTimeout(timer);
      };
    }, [state.phase]);
    const start = async () => {
      setState({ phase: 'starting', url: '', error: '' });
      try {
        const result = await command('signin');
        if (!result?.ok) throw new Error(result?.text ?? 'Could not start the sign-in.');
        setState({ phase: 'waiting', url: '', error: '' });
      } catch (error) {
        setState({ phase: 'idle', url: '', error: error?.message ?? 'Could not start the sign-in.' });
      }
    };
    if (state.phase === 'done') {
      return <p className="pta-meta" role="status">Signed in. Reloading the portal data…</p>;
    }
    return (
      <div className={compact ? 'pta-signin pta-signin--compact' : 'pta-signin'}>
        {state.phase === 'waiting' ? (
          <>
            <p>Finish in your browser: sign in to the portal as an admin, then approve PTech Admin.</p>
            {state.url ? (
              <p><a className="pta-link" href={state.url} target="_blank" rel="noreferrer">Open the sign-in page again</a></p>
            ) : null}
            <p className="pta-meta" role="status">Waiting for the browser to hand the sign-in back…</p>
            <PtaButton kind="ghost" onClick={() => setState({ phase: 'idle', url: '', error: '' })}>Cancel</PtaButton>
          </>
        ) : (
          <>
            <p>Sign in with your PTech portal admin account. No token to copy: the browser approves this app and sends it back.</p>
            <PtaButton kind="primary" disabled={state.phase === 'starting'} onClick={() => void start()}>
              {state.phase === 'starting' ? 'Opening…' : 'Sign in with portal'}
            </PtaButton>
          </>
        )}
        {state.error ? <p className="pta-warn" role="status">{state.error}</p> : null}
      </div>
    );
  }

  function NeedsYouPage() {
    const data = useLiveAdmin();
    const groups = useMemo(() => ticketGroups(data), [data]);
    const total = actionableCount(groups);
    const goInbox = () => ctx.layout?.selectPanel?.(INBOX_PANEL);
    const goWorkbench = () => ctx.layout?.selectPanel?.(WORKBENCH_PANEL);
    if (data.loading && data.at === 0) return <div className="pta-page"><p className="pta-empty">Loading…</p></div>;
    if (data.error) {
      return (
        <div className="pta-page">
          <header className="pta-head">
            <div>
              <h1>Needs you</h1>
              <p>{isAuthError(data.code) ? 'Connect PTech Admin to the portal to see what is waiting.' : 'The portal could not be reached.'}</p>
            </div>
          </header>
          {isAuthError(data.code) ? (
            <PortalSignIn onDone={() => void data.reload()} />
          ) : (
            <div className="pta-empty">
              <h3>Could not reach the portal</h3>
              <p>{data.error}</p>
              <PtaButton onClick={() => void data.reload()}>Try again</PtaButton>
            </div>
          )}
          <p className="pta-meta" style={{ marginTop: 10 }}>{data.error}</p>
        </div>
      );
    }
    const section = (key, title, hint, items, actions, reasonOf) => items.length === 0 ? null : (
      <section key={key} className="pta-section">
        <div className="pta-section__head">
          <h3>{title} <span className="pta-count">{items.length}</span></h3>
          <span className="pta-meta">{hint}</span>
        </div>
        <div className="pta-rows">
          {items.map((ticket) => (
            <TicketLine
              key={ticket.id}
              ticket={ticket}
              reason={reasonOf ? reasonOf(ticket) : ''}
              actions={actions ? actions(ticket) : <TicketRowActions ticket={ticket} />}
            />
          ))}
        </div>
      </section>
    );
    const stuckReason = new Map(
      data.queue
        .filter((item) => !(Array.isArray(item?.eligible) ? item.eligible.length > 0 : Boolean(item?.eligible)))
        .map((item) => [Number(item.id), item.reason ?? 'no eligible node']),
    );
    return (
      <div className="pta-page">
        <header className="pta-head">
          <div>
            <h1>Needs you</h1>
            <p>
              {total === 0
                ? 'Nothing is waiting on you. Agents are on it.'
                : `${total} item${total === 1 ? '' : 's'} want a decision.`}
            </p>
          </div>
          <div className="pta-head__actions">
            <PtaButton onClick={goInbox}>Open Inbox</PtaButton>
            <PtaButton kind="ghost" onClick={goWorkbench}>Workbench</PtaButton>
          </div>
        </header>

        <div className="pta-kpis">
          <Kpi label="To approve" value={groups.approvals.length} tint={tintOfStatus('new')} onClick={goInbox} hint="New requests; nothing runs until you approve." />
          <Kpi label="To review" value={groups.reviews.length} tint={tintOfStatus('review')} onClick={goInbox} hint="Finished runs waiting for your check." />
          <Kpi label="Clients waiting" value={groups.waiting.length} tint={tintOfStatus('approved')} onClick={goInbox} hint="They wrote last and have heard nothing since." />
          <Kpi label="Running now" value={groups.running.length} tint={tintOfStatus('in_progress')} onClick={goInbox} hint="Agents working right now." />
        </div>

        {section('approvals', 'Approve or decline', 'New requests. Nothing runs until you decide.', groups.approvals)}
        {section('review', 'Check the agent’s work', 'Finished runs waiting for you.', groups.reviews)}
        {section('waiting', 'Answer the client', 'They wrote last and have heard nothing since.', groups.waiting)}
        {section('stalled', 'Stalled', 'In progress for 45+ minutes without a report.', groups.stalled)}
        {section('stuck', 'No node can take these', 'Approved, but nothing eligible can run them.', groups.stuck, null, (ticket) => stuckReason.get(Number(ticket.id)) ?? '')}

        {groups.running.length > 0 ? (
          <section className="pta-section">
            <div className="pta-section__head"><h3>Running now <span className="pta-count">{groups.running.length}</span></h3><span className="pta-meta">Live agent work.</span></div>
            <div className="pta-rows">
              {groups.running.map((run) => (
                <button key={run.id} type="button" className="pta-row" onClick={() => void openTicketRun({ id: run.ticket_id, title: run.title })}>
                  <span className="pta-dot" style={{ background: tintOfStatus('in_progress') }} />
                  <span className="pta-id">#{run.ticket_id}</span>
                  <span className="pta-title">{run.title || 'run'}</span>
                  <span className="pta-meta">{run.executor}</span>
                  <span className="pta-meta">on {run.node_id ?? 'this machine'}</span>
                  <span className="pta-fill" />
                  <span className="pta-meta">{ago(run.started_at ?? run.updated_at)}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {groups.failed.length > 0 ? (
          <section className="pta-section">
            <div className="pta-section__head"><h3>Failed runs, last 24h</h3><span className="pta-meta">These stop until someone looks.</span></div>
            <div className="pta-rows">
              {groups.failed.map((run) => (
                <button key={run.id} type="button" className="pta-row" onClick={() => void openTicketRun({ id: run.ticket_id, title: run.title })}>
                  <span className="pta-dot" style={{ background: 'var(--dsw-alias-state-danger-primary, #e5534b)' }} />
                  <span className="pta-id">#{run.ticket_id}</span>
                  <span className="pta-title">{run.title || 'run'}</span>
                  <span className="pta-meta">{run.executor}</span>
                  <span className="pta-meta">on {run.node_id ?? 'this machine'}</span>
                  <span className="pta-fill" />
                  <span className="pta-meta">{ago(run.finished_at)}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {total === 0 && groups.failed.length === 0 ? (
          <EmptyState title="Inbox zero" text="No approvals, no reviews, no client waiting. New work will appear here and in a notification.">
            <PtaButton onClick={goInbox}>Open Inbox</PtaButton>
            <PtaButton kind="ghost" onClick={goWorkbench}>Workbench</PtaButton>
          </EmptyState>
        ) : null}
      </div>
    );
  }

  function InboxPage() {
    const data = useLiveAdmin();
    const groups = useMemo(() => ticketGroups(data), [data]);
    const [filter, setFilter] = useState('all');
    const [query, setQuery] = useState('');
    const goWorkbench = () => ctx.layout?.selectPanel?.(WORKBENCH_PANEL);
    const all = useMemo(() => {
      const seen = new Map();
      // One ticket can be in more than one bucket — a review ticket the client
      // also wrote last on belongs under Reviews and Client replies. Keep every
      // kind it matched instead of the first one.
      const add = (ticket, kind) => {
        const entry = seen.get(ticket.id);
        if (entry) {
          entry.kinds.add(kind);
          return;
        }
        seen.set(ticket.id, { ticket, kinds: new Set([kind]) });
      };
      for (const ticket of groups.approvals) add(ticket, 'approval');
      for (const ticket of groups.reviews) add(ticket, 'review');
      for (const ticket of groups.waiting) add(ticket, 'reply');
      for (const ticket of groups.stalled) add(ticket, 'stalled');
      for (const ticket of groups.stuck) add(ticket, 'stuck');
      return [...seen.values()];
    }, [groups]);
    const filters = [
      { key: 'all', label: 'All', count: all.length },
      { key: 'approval', label: 'Approvals', count: groups.approvals.length },
      { key: 'review', label: 'Reviews', count: groups.reviews.length },
      { key: 'reply', label: 'Client replies', count: groups.waiting.length },
      { key: 'stalled', label: 'Stalled', count: groups.stalled.length },
      { key: 'stuck', label: 'Stuck', count: groups.stuck.length },
    ];
    const needle = query.trim().toLowerCase();
    const shown = all.filter(({ ticket, kinds }) => {
      if (filter !== 'all' && !kinds.has(filter)) return false;
      if (needle.length === 0) return true;
      return `${ticket.id} ${ticketLabel(ticket)} ${ticket.project_name ?? ''} ${ticket.client_email ?? ''}`
        .toLowerCase()
        .includes(needle);
    });
    if (data.error && isAuthError(data.code)) {
      return (
        <div className="pta-page">
          <header className="pta-head"><div><h1>Inbox</h1><p>Connect PTech Admin to the portal to see what is waiting.</p></div></header>
          <PortalSignIn onDone={() => void data.reload()} />
        </div>
      );
    }
    return (
      <div className="pta-page">
        <header className="pta-head">
          <div>
            <h1>Inbox</h1>
            <p>Approvals, reviews and client replies in one place. The same items notify you as they arrive.</p>
          </div>
          <div className="pta-head__actions">
            <input
              className="pta-search"
              value={query}
              placeholder="Search tickets, clients, projects…"
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search the inbox"
            />
            <PtaButton kind="ghost" onClick={goWorkbench}>Workbench</PtaButton>
          </div>
        </header>
        <div className="pta-filters">
          {filters.map((item) => (
            <button key={item.key} type="button" className={`pta-filter${filter === item.key ? ' is-active' : ''}`} onClick={() => setFilter(item.key)}>
              {item.label}{item.count ? <span className="pta-count">{item.count}</span> : null}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <EmptyState title={all.length === 0 ? 'Inbox zero' : 'Nothing in this filter'} text={all.length === 0 ? 'New approvals, reviews and client replies will land here and notify you.' : 'Try another filter, or clear the search.'} />
        ) : (
          <div className="pta-rows pta-rows--inbox">
            {shown.map(({ ticket }) => (
              <TicketLine
                key={ticket.id}
                ticket={ticket}
                actions={<TicketRowActions ticket={ticket} />}
                detail={isWaiting(ticket) ? 'waiting' : ''}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  function openWorkbenchTicket(ticketId) {
    ctx.layout?.selectPanel?.(WORKBENCH_PANEL);
    const hash = `#ticket=${ticketId}`;
    if (window.location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
    else window.location.hash = hash;
  }

  /**
   * The ticket strip above a run's own composer: what the ticket is, what the
   * client last said, and the three moves that are not a chat message. The
   * chat input stays the action surface; the mode buttons change where a typed
   * draft goes.
   */
  function TicketDock({ sessionId, input, inputActions }) {
    const run = ticketFromCwd(useSessionCwd(sessionId));
    const ticketId = run?.ticketId ?? null;
    const [detail, reload] = useTicketDetail(ticketId);
    const [expanded, setExpanded] = useState(false);
    const [mode, setMode] = useState('chat');
    const [busy, setBusy] = useState('');
    const [note, setNote] = useState('');
    useEffect(() => {
      setExpanded(false);
      setMode('chat');
      setBusy('');
      setNote('');
    }, [ticketId]);
    if (!run) return null;
    const ticket = detail.ticket;
    const draft = typeof input?.draft === 'string' ? input.draft : '';
    const messages = Array.isArray(detail.messages) ? detail.messages : [];
    const runs = Array.isArray(detail.runs) ? detail.runs : [];
    const waiting = isWaiting(ticket);
    const latestClient = [...messages].reverse().find((message) => message.author === 'client' && !message.internal) ?? null;
    const canReply = ticket?.kind !== 'system';
    const send = async (internal) => {
      const body = draft.trim();
      if (!ticket || body.length === 0) return;
      setBusy(internal ? 'note' : 'reply');
      setNote('');
      try {
        await api('POST', `/admin/tickets/${ticket.id}/messages`, { body, internal });
        inputActions?.setDraft?.('');
        setNote(internal ? 'Note saved' : 'Reply sent');
        window.dispatchEvent(new CustomEvent('admin:changed', { detail: { kind: 'ticket.reply', ticketId: ticket.id } }));
        void reload();
      } catch (error) {
        setNote(error?.message ?? 'Could not send it');
      } finally {
        setBusy('');
      }
    };
    return (
      <section className="pta-dock" aria-label={`Ticket #${run.ticketId}`}>
        <div className="pta-dock__head">
          <StatusPill status={ticket?.status ?? ''} />
          <span className="pta-dock__id">#{run.ticketId}</span>
          <span className="pta-dock__title" title={ticketLabel(ticket)}>{detail.loading && !ticket ? 'Loading ticket…' : ticketLabel(ticket)}</span>
          {ticket ? <span className="pta-meta">{ticket.project_name || 'no project'}</span> : null}
          {ticket && ticket.kind !== 'system' ? <span className="pta-meta">{ticket.client_email}</span> : null}
          {waiting ? <span className="pta-warn">client waiting {ago(ticket.client_waiting_since)}</span> : null}
          <span className="pta-fill" />
          {ticket ? <TicketRowActions ticket={ticket} /> : null}
          <button
            type="button"
            className="pta-dock__toggle"
            aria-expanded={expanded}
            title={expanded ? 'Hide the ticket thread and details' : 'Show the client thread and ticket details'}
            onClick={() => setExpanded((value) => !value)}
          >
            <span>{expanded ? 'Hide ticket' : `Ticket${messages.length ? ` · ${messages.length}` : ''}`}</span>
            <span className="pta-dock__chev" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          </button>
          <PtaButton kind="ghost" onClick={() => openWorkbenchTicket(run.ticketId)}>Workbench</PtaButton>
        </div>
        {!expanded && latestClient ? (
          <div className="pta-dock__last" title={latestClient.body}>
            <span className="pta-meta">Client:</span> {latestClient.body}
          </div>
        ) : null}
        {expanded ? (
          <div className="pta-dock__body">
            {ticket ? (
              <div className="pta-facts">
                <span>Priority <strong>{ticket.priority ?? 0}</strong></span>
                <span>Agent <strong>{ticket.executor || 'auto'}</strong></span>
                {ticket.attention ? <span>Attention <strong>{ticket.attention}</strong></span> : null}
                {ticket.budget_cents !== null && ticket.budget_cents !== undefined ? <span>Budget <strong>{dollars(ticket.budget_cents)}</strong></span> : null}
                {ticket.price_cents !== null && ticket.price_cents !== undefined ? <span>Cost <strong>{dollars(ticket.price_cents)}</strong></span> : null}
                {ticket.requires ? <span>Needs <strong>{String(ticket.requires).replace(/^\[|\]$/g, '').replace(/"/g, '') || 'nothing'}</strong></span> : null}
              </div>
            ) : null}
            <div className="pta-thread">
              {messages.length === 0 ? <p className="pta-meta">No messages yet.</p> : null}
              {messages.slice(-12).map((message) => (
                <div key={message.id} className={`pta-msg pta-msg--${message.author}${message.internal ? ' is-note' : ''}`}>
                  <div className="pta-msg__meta">
                    {message.author === 'client' ? 'Client' : message.author === 'ali' ? 'You' : 'System'}
                    {message.internal ? ' · private note' : ''}
                    {' · '}
                    {ago(message.created_at)}
                  </div>
                  <div className="pta-msg__body">{message.body}</div>
                </div>
              ))}
              {runs.length > 0 ? (
                <div className="pta-runs">
                  {runs.slice(-4).map((ticketRun) => (
                    <div key={ticketRun.id} className="pta-run">
                      <span className="pta-dot" style={{ background: ticketRun.status === 'failed' ? 'var(--dsw-alias-state-danger-primary, #e5534b)' : ticketRun.status === 'running' ? tintOfStatus('in_progress') : 'var(--dsw-alias-label-tertiary, #8a9099)' }} />
                      <span>Run {ticketRun.id}</span>
                      <span className="pta-meta">{ticketRun.executor ?? 'agent'}</span>
                      <span className="pta-meta">{ticketRun.status}</span>
                      <span className="pta-meta">{ago(ticketRun.finished_at ?? ticketRun.started_at ?? ticketRun.created_at)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="pta-dock__compose">
          <div className="pta-modes" role="group" aria-label="Where the draft goes">
            {[
              ['chat', 'Chat'],
              ['reply', 'Reply to client'],
              ['note', 'Private note'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`pta-mode${mode === key ? ' is-active' : ''}`}
                aria-pressed={mode === key}
                disabled={key !== 'chat' && key === 'reply' && !canReply}
                onClick={() => setMode(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="pta-hint">
            {mode === 'chat'
              ? 'Typing here talks to the agent; the Host mirrors it to the ticket as a private note.'
              : mode === 'reply'
                ? 'Type in the chat input, then send it to the client. This emails them.'
                : 'Type in the chat input, then save it as an internal note. The client never sees it.'}
          </span>
          <span className="pta-fill" />
          {mode === 'reply' ? (
            <PtaButton kind="primary" disabled={!canReply || draft.trim().length === 0 || busy === 'reply'} onClick={() => void send(false)}>
              {busy === 'reply' ? 'Sending…' : 'Send reply'}
            </PtaButton>
          ) : null}
          {mode === 'note' ? (
            <PtaButton kind="primary" disabled={draft.trim().length === 0 || busy === 'note'} onClick={() => void send(true)}>
              {busy === 'note' ? 'Saving…' : 'Save note'}
            </PtaButton>
          ) : null}
          {note ? <span className="pta-meta" role="status">{note}</span> : null}
        </div>
      </section>
    );
  }

  /* ————— ptech-admin:// links ————— */

  /**
   * Open a `ptech-admin://` link: the plugin half of the desktop URL scheme.
   *
   *   ptech-admin://ticket/12   the ticket's conversation, or the workbench
   *   ptech-admin://client/<id> that client's page
   *   ptech-admin://seo         the SEO desk
   *   ptech-admin://health      the health desk
   *   ptech-admin://auth?code=  finish a portal sign-in started in the browser
   *
   * The fork's URL handler calls `globalThis.__dshAdminOpenLink(url)` (or
   * dispatches a `window` CustomEvent with `{url}`); both land here, so one
   * function owns the routing. Returns false for an unknown route rather than
   * guessing, so the caller can fall back.
   */
  function openAdminLink(url) {
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch {
      return false;
    }
    if (parsed.protocol !== 'ptech-admin:') return false;
    const parts = [parsed.hostname, ...parsed.pathname.split('/')]
      .filter((part) => typeof part === 'string' && part.length > 0)
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      });
    const route = (parts.shift() ?? '').toLowerCase();
    const target = parts.join('/');
    /**
     * Select the Admin panel and put a route in its hash. A hash that is
     * already current still dispatches `hashchange`, because the workbench
     * only reads the hash on mount and on that event.
     */
    const openHash = (hash) => {
      ctx.layout?.selectPanel?.(WORKBENCH_PANEL);
      const wanted = `#${hash}`;
      if (window.location.hash === wanted) window.dispatchEvent(new HashChangeEvent('hashchange'));
      else window.location.hash = wanted;
    };
    if (route === 'ticket') {
      const id = Number.parseInt(target, 10);
      if (!Number.isInteger(id) || id <= 0) return false;
      handledDeepLink = true;
      void openTicketRun({ id });
      return true;
    }
    if (route === 'auth') {
      // The browser finished the portal handoff and sent a one-time code back.
      const code = parsed.searchParams.get('code') ?? target;
      if (typeof code !== 'string' || code.length === 0) return false;
      handledDeepLink = true;
      void command(`login-code ${code}`)
        .then((result) => {
          if (!result?.ok) throw new Error(result?.text ?? 'The portal did not accept the sign-in.');
          window.dispatchEvent(new CustomEvent('admin:changed', { detail: { kind: 'auth.signed-in' } }));
          return undefined;
        })
        .catch((error) => {
          console.warn('admin: device sign-in failed:', error?.message ?? error);
        });
      return true;
    }
    if (route === 'client') {
      if (target.length === 0) return false;
      handledDeepLink = true;
      openHash(`client=${encodeURIComponent(target)}`);
      return true;
    }
    if (route === 'seo' || route === 'health') {
      handledDeepLink = true;
      openHash(route);
      return true;
    }
    return false;
  }

  const onAdminLink = (event) => {
    const url = typeof event?.detail === 'string' ? event.detail : event?.detail?.url;
    if (typeof url === 'string') openAdminLink(url);
  };
  globalThis.__dshAdminOpenLink = openAdminLink;
  // `ptech-admin:open-link` is this build's event; the old name stays for a
  // renderer built before the rename.
  window.addEventListener('ptech-admin:open-link', onAdminLink);
  window.addEventListener('dsh-admin:open-link', onAdminLink);
  ctx.effect(
    () => () => {
      window.removeEventListener('ptech-admin:open-link', onAdminLink);
      window.removeEventListener('dsh-admin:open-link', onAdminLink);
      if (globalThis.__dshAdminOpenLink === openAdminLink) delete globalThis.__dshAdminOpenLink;
    },
    'admin: ptech-admin links',
  );

  ctx.inject(['locale'], (localeCtx) => {
    localeCtx.effect(() => localeCtx.locale.register(NAMESPACE, { en: DICTIONARY }), 'admin: locale namespace');
  });
  // The native home is the default main page; Inbox is its own page and the
  // full workbench stays one click away.
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: HOME_PANEL, locale: NAMESPACE }, NeedsYouPage));
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: INBOX_PANEL, locale: NAMESPACE }, InboxPage));
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: WORKBENCH_PANEL, locale: NAMESPACE }, AdminPage));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: HOME_PANEL, order: 11, label: 'Needs you' }, AdminEntryIcon));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: INBOX_PANEL, order: 12, label: 'Inbox' }, InboxEntryIcon));
  // A run's ticket lives above its own composer: status, the client's last
  // words and the moves that are not a chat message, with the chat input as
  // the one place to type.
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register({ name: 'conversation.input.dock', id: 'admin-ticket', order: 20, locale: NAMESPACE }, TicketDock));
  // The native pages own their own small stylesheet; no workbench CSS leaks
  // into the native conversation.
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.admin = 'native';
    style.textContent = NATIVE_STYLES;
    document.head.append(style);
    return () => style.remove();
  }, 'admin: native styles');
  // A cold launch lands on Needs you. A deep link that arrived first (a
  // ticket, a client, a sign-in) wins, and a renderer reload of the same
  // window simply comes back here.
  ctx.effect(() => {
    const timer = setTimeout(() => {
      try {
        if (window.location.hash !== '' || handledDeepLink) return;
        ctx.layout?.selectPanel?.(HOME_PANEL);
      } catch {
        // The host may not have the panel registry ready yet; keep the conversation.
      }
    }, 900);
    return () => clearTimeout(timer);
  }, 'admin: initial needs-you view');
  // Each client gets a row of its own under Admin.
  ctx.slots.inject('sidebar.panellist', () => syncClientRows());
  // The PTech Admin workspace browser declares `sidebar.workspaces.section`.
  // There the tree replaces the flat client rows; an upstream Harness never
  // fires this and keeps the rows.
  ctx.slots.inject('sidebar.workspaces.section', () => {
    sectionAvailable = true;
    const dispose = ctx.slots.register(
      { name: 'sidebar.workspaces.section', id: 'admin-clients', order: 10 },
      ClientsSection,
    );
    refreshClientRows();
    return () => {
      sectionAvailable = false;
      dispose();
      refreshClientRows();
    };
  });
  // Client rows make the panel list long; give it its own scroll so the
  // workspace browser below keeps at least half the column.
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.admin = 'panel-scroll';
    style.textContent = '[class*="_panelList"]{max-height:45vh;overflow-y:auto;overscroll-behavior:contain;flex-shrink:0}';
    document.head.append(style);
    return () => style.remove();
  }, 'admin: scrollable panel list');
  // A run's ticket, as a view of its own conversation: the whole ticket page
  // beside Chat and Trajectory, and a chip in the header that names it. The
  // chip registers the view, because it renders for exactly the session in front.
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register({ name: 'conversation.session.header.actions', id: 'admin-ticket', order: 5, locale: NAMESPACE }, TicketHeaderChip));
  // Run sessions also get a ticket chip on their row and a line in the hover card.
  ctx.slots.inject('sidebar.session.row.leading', () =>
    ctx.slots.register({ name: 'sidebar.session.row.leading', id: 'admin-ticket', order: 10, locale: NAMESPACE }, TicketMark));
  ctx.slots.inject('sidebar.session.row.hover', () =>
    ctx.slots.register({ name: 'sidebar.session.row.hover', id: 'admin-ticket', order: 10, locale: NAMESPACE }, TicketHover));
  // Notifications live in the frame-wide overlay, so a toast survives switching
  // panels and pages and never sits inside a column's scroll container.
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'admin-notifications', order: 40 }, NotificationHost));
  // One page in Settings for the switch the /admin notify command reads.
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register({ name: 'settings.section', id: 'admin', order: 60, label: 'Admin' }, AdminSettingsSection));
  // The desk itself in the right pane: the queue at a glance, beside whatever
  // conversation is open — no trip to the main panel to see what is waiting.
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: 'admin-tasks',
        kind: 'tasks',
        priority: 'extension',
        keepMounted: true,
        title: () => 'Tasks',
        guide: [
          {
            id: 'admin-tasks',
            order: 13,
            title: () => 'Tasks',
            description: () => 'What is waiting on you, and every recent run by project and ticket. A run opens its conversation.',
            icon: () => <TicketGlyph />,
          },
        ],
      }),
    'admin: tasks tab type',
  );
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'admin-tasks', locale: NAMESPACE }, TasksTab));
  ctx.slots.inject('sidebar.right.pane.tab.title', () =>
    ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: 'admin-tasks', locale: NAMESPACE }, TasksTabTitle));
  // Goes over the route when the Host has it; only an older Host makes this
  // (and the bridge lookup behind it) a session command.
  void command(`hello ${CLIENT_VERSION}`).catch(() => undefined);
  // The renderer owns native banners when it can; the Host's osascript
  // fallback only runs on a Harness without the desktop bridge.
  void command(`native-notify ${desktopNotifications ? 'on' : 'off'}`).catch(() => undefined);
}

export default { name: PANEL_ID, inject, apply };
