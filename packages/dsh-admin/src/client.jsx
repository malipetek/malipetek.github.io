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
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AdminApp, ClientPage, TicketPage } from '../../admin-ui/src/index.js';

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
    ctx.layout?.selectPanel?.(PANEL_ID);
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
          openTicket(run);
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
      <button key={ticket.id} type="button" style={taskRowStyle} onClick={() => openTicket({ ticketId: ticket.id })}>
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
                <button type="button" style={taskRowStyle} title="Open the ticket in Admin" onClick={() => openTicket({ ticketId })}>
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
            DSH Admin
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

  /* ————— Clients in the sidebar ————— */

  /*
   * Two presentations of the same data. When the Harness declares the
   * `sidebar.workspaces.section` slot — the DSH Admin build does — a "Clients"
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

  /** The ticket rows of one project (or of Mine), with done/declined behind one row. */
  function TicketList({ Row, tickets, changed }) {
    const [showClosed, setShowClosed] = useState(false);
    const open = tickets.filter((t) => !isClosedTicket(t));
    const closed = tickets.filter((t) => isClosedTicket(t));
    const shown = showClosed ? [...open, ...closed] : open;
    const menu = (ticket) => {
      const items = [{ id: 'open', label: 'Open in Admin', onSelect: () => openTicket({ ticketId: ticket.id }) }];
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
            trailing={ago(ticket.updated_at)}
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
        {state.loading && <TreeRow label="Loading clients…" />}
        {state.error !== '' && <TreeRow label={`${state.error} — click to retry`} onClick={() => void load()} />}
        {tree.map(({ client, badge, projects }, index) => (
          <TreeRow
            key={client.id}
            icon={clientAvatar(client)}
            label={client.name || client.email}
            badge={badge || undefined}
            defaultExpanded={index === 0}
            onClick={() => openClientPage(client, selectPanel)}
            menuItems={[{ id: 'open-client', label: 'Open client page', onSelect: () => openClientPage(client, selectPanel) }]}
            children={projects.length > 0 ? projects.map((project, projectIndex) => (
              <TreeRow
                key={`${client.id}:${project.id}`}
                dot={projectTint(project.tickets)}
                label={project.name}
                badge={openTicketCount(project.tickets) || undefined}
                defaultExpanded={index === 0 && projectIndex === 0 && project.tickets.length > 0}
                children={project.tickets.length > 0
                  ? <TicketList Row={TreeRow} tickets={project.tickets} changed={() => void load()} />
                  : undefined}
              />
            )) : undefined}
          />
        ))}
        {!state.loading && state.error === '' && tree.length === 0 && <TreeRow label="No clients yet" />}
        {unsorted.length > 0 && (
          <TreeRow label="Unsorted" badge={openTicketCount(unsorted) || undefined} defaultExpanded>
            <TicketList Row={TreeRow} tickets={unsorted} changed={() => void load()} />
          </TreeRow>
        )}
        {mine.length > 0 && (
          <TreeRow label="Mine" badge={openTicketCount(mine) || undefined}>
            <TicketList Row={TreeRow} tickets={mine} changed={() => void load()} />
          </TreeRow>
        )}
      </Section>
    );
  }

  /* ————— The ticket, as a view of its own conversation ————— */

  /**
   * The ticket a conversation view is showing. Its Session arrives as a
   * standard prop; `params` is the fallback for a build that hands it in there.
   */
  function useTicketRun(props) {
    const sessionId = typeof props?.sessionId === 'string' ? props.sessionId : (props?.params?.sessionId ?? null);
    return ticketFromCwd(useSessionCwd(sessionId));
  }

  function NotATicketRun() {
    return <div style={{ padding: '18px 24px', fontSize: 13, opacity: 0.7 }}>This session did not come from a ticket run.</div>;
  }

  /** The ticket as a conversation view: its thread, runs and composer, full width. */
  function TicketConversationView(props) {
    const run = useTicketRun(props);
    if (!run) return <NotATicketRun />;
    return (
      <div style={{ height: '100%', minHeight: 0 }}>
        <TicketPage api={api} host={host} files={files} ticketId={run.ticketId} part="thread" />
      </div>
    );
  }

  /** The same ticket's details and moves, with the width a tab can give them. */
  function TicketDetailsConversationView(props) {
    const run = useTicketRun(props);
    if (!run) return <NotATicketRun />;
    return (
      <div style={{ height: '100%', minHeight: 0, overflowY: 'auto' }}>
        <TicketPage api={api} host={host} files={files} ticketId={run.ticketId} part="details" />
      </div>
    );
  }

  /**
   * In a run's own conversation header: the ticket's name, one click to the
   * Admin copy — and the Ticket view, registered while this conversation is the
   * one on screen, so no other session grows a tab with nothing in it.
   */
  /**
   * The views belong to the session in front, and the header can mount more
   * than once for it (a split pane, a pop-out). Count the mounts per
   * conversation so the first one registers and follows, and only the last one
   * unregisters and unfollows.
   */
  const ticketViews = { key: null, mounts: 0, disposers: [] };

  function openTicketViews(ticketId, sessionId) {
    const key = `${ticketId}:${sessionId}`;
    if (ticketViews.key !== key) {
      for (const dispose of ticketViews.disposers) dispose?.();
      ticketViews.disposers = [];
      ticketViews.key = key;
      ticketViews.mounts = 0;
    }
    ticketViews.mounts += 1;
    if (ticketViews.disposers.length === 0) {
      const register = (id, order, label, Component) =>
        ctx.slots.register({ name: 'conversation.view', id, order, label, locale: NAMESPACE }, Component);
      ticketViews.disposers = [
        register('admin-ticket', 20, `Ticket #${ticketId}`, TicketConversationView),
        register('admin-ticket-details', 21, 'Details', TicketDetailsConversationView),
      ];
      // While this conversation is on screen, what is typed in it is the
      // ticket's: the Host turns each new message into a private note.
      void command(`follow ${ticketId} ${sessionId}`).catch(() => undefined);
    }
    return () => {
      if (ticketViews.key !== key) return;
      ticketViews.mounts -= 1;
      if (ticketViews.mounts > 0) return;
      for (const dispose of ticketViews.disposers) dispose?.();
      ticketViews.disposers = [];
      ticketViews.key = null;
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
   * Admin copy — plus the three moves that belong to the ticket rather than
   * the conversation: Approve, Reply to the client, and Open in portal. The
   * ticket views register while this conversation is the one on screen, so no
   * other session grows a tab with nothing in it.
   */
  function TicketHeaderChip({ sessionId }) {
    const run = ticketFromCwd(useSessionCwd(sessionId));
    const ticketId = run?.ticketId ?? null;
    const brief = useTicketBrief(ticketId);
    const [status, setStatus] = useState(null);
    const [replyOpen, setReplyOpen] = useState(false);
    const [text, setText] = useState('');
    const [busy, setBusy] = useState('');
    const [note, setNote] = useState('');
    useEffect(() => {
      setStatus(null);
      setReplyOpen(false);
      setText('');
      setNote('');
    }, [ticketId]);
    useEffect(() => {
      if (ticketId === null || !sessionId) return undefined;
      return openTicketViews(ticketId, sessionId);
    }, [ticketId, sessionId]);
    if (!run) return null;
    const currentStatus = status ?? brief?.status ?? '';
    const approve = async () => {
      if (!brief) return;
      const who = brief.client_email || brief.client_name || 'The client';
      if (brief.kind !== 'system' && !window.confirm(`Approve #${brief.id}?\n\n${who} is emailed about this change.`)) return;
      setBusy('approve');
      setNote('');
      try {
        await api('PATCH', `/admin/tickets/${brief.id}`, { status: 'approved' });
        ticketBriefs.delete(brief.id);
        setStatus('approved');
        // The Admin tab, the tree and the notifications all read the same
        // portal; a short event wakes them instead of waiting for the poll.
        window.dispatchEvent(new CustomEvent('admin:changed', { detail: { kind: 'ticket.approval', ticketId: brief.id } }));
        setNote('Approved');
      } catch (error) {
        setNote(error?.message ?? 'Could not approve');
      } finally {
        setBusy('');
      }
    };
    const send = async () => {
      const body = text.trim();
      if (!brief || body.length === 0) return;
      setBusy('reply');
      setNote('');
      try {
        await api('POST', `/admin/tickets/${brief.id}/messages`, { body, internal: false });
        setText('');
        setReplyOpen(false);
        setNote('Reply sent');
        window.dispatchEvent(new CustomEvent('admin:changed', { detail: { kind: 'ticket.reply', ticketId: brief.id } }));
      } catch (error) {
        setNote(error?.message ?? 'Could not send the reply');
      } finally {
        setBusy('');
      }
    };
    const openInPortal = () => {
      const id = brief?.id ?? run.ticketId;
      window.open(`https://ptechsolutions.net/portal/admin#ticket=${id}`, '_blank', 'noopener,noreferrer');
    };
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, position: 'relative' }}>
        <button
          type="button"
          onClick={() => openTicket(run)}
          title={`Open ${run.kind === 'task' ? 'system task' : 'client ticket'} #${run.ticketId} in Admin`}
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
        {currentStatus === 'new' ? (
          <button type="button" style={headerActionStyle} disabled={busy === 'approve'} title="Approve this ticket (emails the client)" onClick={() => void approve()}>
            {busy === 'approve' ? 'Approving…' : 'Approve'}
          </button>
        ) : null}
        {brief && brief.kind !== 'system' ? (
          <button type="button" style={{ ...headerActionStyle, borderColor: replyOpen ? 'var(--dsw-alias-state-business-primary, #4c8dff)' : undefined }} onClick={() => setReplyOpen((value) => !value)} title="Reply to the client (emails them)">
            Reply
          </button>
        ) : null}
        <button type="button" style={headerActionStyle} onClick={openInPortal} title="Open this ticket in the portal">
          Open in portal
        </button>
        {note ? (
          <span title={note} style={{ fontSize: 11, opacity: 0.65, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {note}
          </span>
        ) : null}
        {replyOpen && brief ? (
          <div
            style={{
              position: 'absolute',
              top: 30,
              right: 0,
              zIndex: 60,
              width: 320,
              boxSizing: 'border-box',
              padding: 10,
              borderRadius: 8,
              border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.32))',
              background: 'var(--dsw-alias-bg-elevated, #23252a)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.32)',
            }}
          >
            <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 6 }}>To {brief.client_email || brief.client_name || 'the client'} — this emails them.</div>
            <textarea
              autoFocus
              rows={3}
              value={text}
              placeholder="Write to the client…"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => (event.metaKey || event.ctrlKey) && event.key === 'Enter' && void send()}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                resize: 'vertical',
                minHeight: 64,
                padding: '6px 8px',
                borderRadius: 6,
                border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.32))',
                background: 'var(--dsw-alias-bg-secondary, rgba(127,127,127,0.12))',
                color: 'inherit',
                font: 'inherit',
                fontSize: 12.5,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
              <button type="button" style={headerActionStyle} onClick={() => setReplyOpen(false)}>Cancel</button>
              <button
                type="button"
                style={{ ...headerActionStyle, borderColor: 'transparent', background: 'var(--dsw-alias-state-business-primary, #4c8dff)', color: '#fff' }}
                disabled={busy === 'reply' || text.trim().length === 0}
                onClick={() => void send()}
              >
                {busy === 'reply' ? 'Sending…' : 'Send reply'}
              </button>
            </div>
          </div>
        ) : null}
      </span>
    );
  }

  // Downloads go through the Host (it holds the token and the disk). Uploads
  // need the bytes, which the bridge cannot carry: /admin attach takes paths.
  const files = { download: (path) => json(`download ${path}`) };

  function AdminPage() {
    return <AdminApp api={api} host={host} files={files} platform="dsh" />;
  }

  /* ————— dsh-admin:// links ————— */

  /**
   * Open a `dsh-admin://` link: the plugin half of the desktop URL scheme.
   *
   *   dsh-admin://ticket/12   the ticket, in the Admin panel
   *   dsh-admin://client/<id> that client's page
   *   dsh-admin://seo         the SEO desk
   *   dsh-admin://health      the health desk
   *
   * The fork's URL handler calls `globalThis.__dshAdminOpenLink(url)` (or
   * dispatches `window`'s `dsh-admin:open-link` CustomEvent with `{url}`); both
   * land here, so one function owns the routing. Returns false for an unknown
   * route rather than guessing, so the caller can fall back.
   */
  function openAdminLink(url) {
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch {
      return false;
    }
    if (parsed.protocol !== 'dsh-admin:') return false;
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
      ctx.layout?.selectPanel?.(PANEL_ID);
      const wanted = `#${hash}`;
      if (window.location.hash === wanted) window.dispatchEvent(new HashChangeEvent('hashchange'));
      else window.location.hash = wanted;
    };
    if (route === 'ticket') {
      const id = Number.parseInt(target, 10);
      if (!Number.isInteger(id) || id <= 0) return false;
      openTicket({ ticketId: id });
      return true;
    }
    if (route === 'client') {
      if (target.length === 0) return false;
      openHash(`client=${encodeURIComponent(target)}`);
      return true;
    }
    if (route === 'seo' || route === 'health') {
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
  window.addEventListener('dsh-admin:open-link', onAdminLink);
  ctx.effect(
    () => () => {
      window.removeEventListener('dsh-admin:open-link', onAdminLink);
      if (globalThis.__dshAdminOpenLink === openAdminLink) delete globalThis.__dshAdminOpenLink;
    },
    'admin: dsh-admin links',
  );

  ctx.inject(['locale'], (localeCtx) => {
    localeCtx.effect(() => localeCtx.locale.register(NAMESPACE, { en: DICTIONARY }), 'admin: locale namespace');
  });
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NAMESPACE }, AdminPage));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 12, label: 'Admin' }, AdminEntryIcon));
  // Each client gets a row of its own under Admin.
  ctx.slots.inject('sidebar.panellist', () => syncClientRows());
  // The DSH Admin workspace browser declares `sidebar.workspaces.section`.
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
}

export default { name: PANEL_ID, inject, apply };
