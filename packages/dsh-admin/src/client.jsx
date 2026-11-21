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
import { createTicketDetailReader, ticketActivity, sendTicketMessage, requestTicketWorkspace, migrateTicketView } from './ticket-chat.mjs';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AdminApp, ClientPage, ProjectPage, TicketPage } from '../../admin-ui/src/index.js';
import { openLocalProject } from '../native-project.mjs';
import { sidebarTicketLabel, sidebarRunShortcut } from './sidebar-presentation.mjs';
import { createConversationMeter, formatRecordedTime } from './conversation-meter.mjs';
import { AdminContext } from '../../admin-ui/src/store.js';
import { ConversationGitGraph } from './conversation-git-graph.mjs';
import { MarketingView } from '../../admin-ui/src/marketing.jsx';
import { SeoView } from '../../admin-ui/src/seo.jsx';
import { STYLES } from '../../admin-ui/src/styles.js';
import { assistantBadge, assistantBadgeTitle } from '../../admin-ui/src/ticket-assistant.mjs';
import { STATUS_LABEL, needsYou } from '../../admin-ui/src/format.js';
import { panelTransport } from './panel-transport.mjs';
import { ConversationHistory } from './conversation-history.jsx';
import { nextRowIndex } from './row-navigation.mjs';
import { ProjectPark, PROJECT_PARK_STYLES } from './project-park.jsx';

/** Panel identity: one id addresses both the sidebar row and the main page. */
const PANEL_ID = 'admin';
const NAMESPACE = 'admin';
/** Reported to the Host on activation, so "did the panel load?" has an answer. */
const CLIENT_VERSION = '3.10.0';
const DICTIONARY = { title: 'Admin' };

/**
 * The one ticket-status tint map: the task desk, the client tree and the
 * native pages all read it, so a status has one colour in the whole plugin.
 * The words are `STATUS_LABEL` from the shared workbench (packages/admin-ui).
 */
const STATUS_TINT = {
  new: 'var(--dsw-alias-state-warning-primary, #d18f2e)',
  approved: 'var(--dsw-alias-state-business-primary, #4c8dff)',
  in_progress: 'var(--dsw-alias-state-success-primary, #2f9e5b)',
  review: 'var(--dsw-alias-state-business-primary, #4c8dff)',
  done: 'var(--dsw-alias-label-tertiary, #8a9099)',
  declined: 'var(--dsw-alias-label-tertiary, #8a9099)',
};
const tintOfStatus = (status) => STATUS_TINT[status] ?? STATUS_TINT.done;

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
const isRead = (line) => line.startsWith('api GET ') || line === 'localinfo' || line === 'machine-consent get';

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
  migrateTicketView(globalThis.localStorage);
  const desktop = globalThis.location?.protocol === 'dsh-app:' && globalThis.location?.hostname === 'app';
  const command = panelTransport(makeTransport(makeCommand(ctx)), { desktop });
  /**
   * PTech Admin's Electron preload exposes clickable native notifications.
   * When it does, the Host stops its osascript fallback and this half shows
   * the banner, so clicking it opens the ticket.
   */
  const desktopNotifications = typeof globalThis.dshDesktop?.notifications?.show === 'function'
    ? globalThis.dshDesktop.notifications
    : null;
  /** Host commands whose text is JSON. */
  const json = async (line, run = command) => {
    const r = await run(line);
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
  let nativeConversation = null;
  const conversation = {
    available: () => typeof workspace?.openSession === 'function',
    open: async ({ runId, sessionId, sessionDir, taskTicketId }) => {
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
      if (taskTicketId != null && nativeConversation?.selectView) {
        const row = ctx.sessions?.list?.getSnapshot?.()?.byId?.[id];
        if (ticketForSession(row)?.ticketId !== Number(taskTicketId) || !nativeConversation.selectView(id, 'chat')) {
          throw new Error('The opened conversation is not linked to this task.');
        }
      }
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
  const localProject = (action, args) => json(`project-local ${action} ${JSON.stringify(args)}`);
  const host = {
    command, json, gitGraph, conversation, openTicket: (target) => openTicketRun({ id: target?.ticketId ?? target }),
    projectLocalInfo: (args) => localProject('info', args),
    projectConfigureLocal: (args) => localProject('configure', args),
    projectCloneLocal: (args) => localProject('clone', args),
    projectLocalOperation: (args) => localProject('operation', args),
    projectFiles: (args) => localProject('files', args),
    projectGitInfo: (args) => localProject('git', args),
    projectOpenLocal: (args) => openLocalProject(args, {
      info: (value) => localProject('info', value), sessions: ctx.sessions, workspace, remote: ctx.remote,
    }),
    // The workbench's project destination selects this panel instead of an in-panel copy.
    openProject: (id) => openProjectPage({ id }),
  };
  const api = (method, path, body) => json(`api ${method} ${path}${body === undefined ? '' : ` ${JSON.stringify(body)}`}`);
  // The public portal (and non-desktop Harness clients) keep the legacy meter.
  api.conversationMeter = desktop;

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

  function ticketForSession(row) {
    return row?.cwd === undefined ? null : ticketFromCwd(`${row.cwd}${SEP}${typeof row.title === 'string' ? row.title : ''}`);
  }

  function NativeTask({ sessionId }) {
    const ticket = ticketFromCwd(useSessionCwd(sessionId));
    if (!ticket) return null;
    return <TicketPage key={`${sessionId}:${ticket.ticketId}`} api={api} host={host} files={files} ticketId={ticket.ticketId} autoMeter={false} />;
  }

  function NativeHistory({ sessionId }) {
    const ticket = ticketFromCwd(useSessionCwd(sessionId));
    if (!ticket) return null;
    return <ConversationHistory key={`${sessionId}:${ticket.ticketId}`} api={api} ticketId={ticket.ticketId} openTicket={openTicketRun} />;
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

  function openTicket(run) {
    // The full ticket lives in the workbench; a ticket with a run opens its
    // conversation instead (see openTicketRun).
    ctx.layout?.selectPanel?.('admin-workbench');
    const target = `#ticket=${run.ticketId}`;
    if (window.location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
    else window.location.hash = target;
  }

  /** A bounded shortcut in the run row's leading cell; the title owns visible text. */
  function TicketMark({ sessionId }) {
    const run = ticketFromCwd(useSessionCwd(sessionId));
    if (!run) return null;
    const label = sidebarRunShortcut(run);
    return (
      <button
        type="button"
        className="pta-run-shortcut"
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          void openTicketRun({ id: run.ticketId });
        }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {run.kind === 'task' ? <path d="m4 8 2.5 2.5L12 5" /> : <path d="M3 4.5h10v6H7l-2.5 2v-2H3z" />}
        </svg>
      </button>
    );
  }

  /** Extra line in the row hover card: what ticket and run this session was. */
  function TicketHover({ sessionId }) {
    const run = ticketFromCwd(useSessionCwd(sessionId));
    if (!run) return null;
    return (
      <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary, #adb2b8)' }}>
        {run.kind === 'task' ? 'My task' : 'Client ticket'} #{run.ticketId}
        {run.runId ? ` · run ${run.runId}` : ''} · {run.slug}
      </div>
    );
  }

  /* ————— The task desk, as a right-pane tab ————— */

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
    const root = useRef(null);
    useRowNavigation(root);
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
        await conversation.open({ runId: run.id, sessionId: run.session_id, sessionDir: run.session_dir, taskTicketId: run.ticket_id });
        setNote('');
      } catch (error) {
        setNote(`Run ${run.id}: ${error?.message ?? 'could not open its conversation'}`);
      }
    };

    const waiting = state.tickets.filter((t) => t.status === 'new' || t.status === 'review');
    const ticketRow = (ticket) => (
      <button key={ticket.id} type="button" className="pta-row pta-task-row" style={taskRowStyle} onClick={() => void openTicketRun(ticket)}>
        {dot(tintOfStatus(ticket.status))}
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
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 12 }} ref={root}>
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
                <button type="button" className="pta-row pta-task-row" style={taskRowStyle} title="Open the ticket's conversation" onClick={() => void openTicketRun({ id: ticketId, title: runs[0].title })}>
                  {dot(tintOfStatus(runs[0].ticket_status))}
                  <span style={{ ...lineStyle, flex: 1, minWidth: 0 }}>
                    #{ticketId} {runs[0].title}
                  </span>
                </button>
                {(expanded.has(ticketId) ? runs : runs.slice(0, RUNS_SHOWN)).map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    className="pta-row pta-task-row pta-task-row--run"
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
                    className="pta-row pta-task-row pta-task-row--more"
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
    return (
      <div className="pta-settings">
        <h2>Admin</h2>
        <p className="pta-settings__intro">
          The PTech client portal (ptechsolutions.net) inside the Harness: tickets, the work queue and its fleet, clients and projects.
          The Host refreshes every minute and notifies you about new work in the window and on this Mac.
        </p>
        <div className="pta-settings__row">
          <span className="pta-settings__text">
            <span className="pta-settings__label">Notify me about new work</span>
            <span className="pta-settings__hint">
              A new ticket, one waiting for approval, a client reply, or a finished or failed run — in-app and as a
              macOS notification, never twice.
            </span>
          </span>
          <button
            type="button"
            role="switch"
            className="pta-switch"
            aria-checked={state.notify}
            aria-label="Notify me about new work"
            disabled={!state.loaded || state.busy}
            onClick={() => void toggle()}
          >
            <span className="pta-switch__knob" />
          </button>
        </div>
        {state.error ? <p className="pta-settings__error">{state.error}</p> : null}
        <div className="pta-settings__row">
          <span className="pta-settings__text">
            <span className="pta-settings__label">Portal connection</span>
            <span className="pta-settings__hint">
              Sign in with a portal admin account. The browser approves this app; the token stays on this machine.
            </span>
            <PortalSignIn compact />
          </span>
        </div>
      </div>
    );
  }

  /**
   * The Needs-you entry's icon. The host renders a panel row as icon + label
   * with no trailing slot, so the count lives in the tooltip and the state is
   * a small dot on the glyph's top-right corner: amber while a decision is
   * waiting (approve, review, a client reply), green while agents work and
   * nothing needs a decision. The dot sits in the 6px label gap, never on the
   * label. The Inbox entry shows only the client messages waiting, in the
   * business tint its KPI uses.
   */
  function AdminEntryIcon(props) {
    const counts = useSyncExternalStore(attention.subscribe, attention.get);
    // Every actionable bucket the attention read covers: a new request, a run
    // to review, and a client whose last message has no answer yet.
    const decisions = counts ? counts.approve + counts.review + counts.waiting : 0;
    const title = decisions > 0
      ? `${decisions} item${decisions === 1 ? '' : 's'} need${decisions === 1 ? 's' : ''} you`
      : counts?.running
        ? `${counts.running} run${counts.running === 1 ? '' : 's'} running`
        : 'Needs you';
    return (
      <span className="pta-entry-icon" title={title}>
        <AdminIcon size={props?.size ?? 16} />
        {decisions > 0 ? (
          <span className="pta-entry-dot pta-entry-dot--wait" aria-hidden="true" />
        ) : counts?.running ? (
          <span className="pta-entry-dot pta-entry-dot--live" aria-hidden="true" />
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

  /** The Marketing and SEO desk glyphs, matching the sidebar's 16px language. */
  function MarketingGlyph({ size = 16 }) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 10v4a1 1 0 0 0 1 1h3l7 3V6l-7 3H5a1 1 0 0 0-1 1z" />
        <path d="M8 15v4M18 9a3 3 0 0 1 0 6" />
      </svg>
    );
  }

  function SeoGlyph({ size = 16 }) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="5.5" />
        <path d="m15 15 5 5M8 11h5M8 8.5h3" />
      </svg>
    );
  }

  function MarketingEntryIcon(props) {
    return <MarketingGlyph size={props?.size ?? 16} />;
  }

  function SeoEntryIcon(props) {
    return <SeoGlyph size={props?.size ?? 16} />;
  }

  function InboxEntryIcon(props) {
    const counts = useSyncExternalStore(attention.subscribe, attention.get);
    const waiting = counts?.waiting ?? 0;
    const title = waiting > 0
      ? `${waiting} client message${waiting === 1 ? '' : 's'} waiting`
      : 'Inbox';
    return (
      <span className="pta-entry-icon" title={title}>
        <InboxIcon size={props?.size ?? 16} />
        {waiting > 0 ? <span className="pta-entry-dot pta-entry-dot--waiting" aria-hidden="true" /> : null}
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
  const CLIENT_ROWS_ORDER = 15;
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

  /** Project labels navigate independently from their disclosure chevron. */
  const projectPages = new Map();
  function openProjectPage(project, selectPanel = (key) => ctx.layout?.selectPanel?.(key)) {
    if (!project?.id || project.id === '__none__') return;
    const key = `admin-project-${project.id}`;
    if (!projectPages.has(project.id)) {
      projectPages.set(project.id, ctx.slots.register({ name: 'main', key, locale: NAMESPACE }, () => <ProjectPage api={api} host={host} files={files} id={project.id} />));
    }
    selectPanel(key);
  }
  ctx.effect(() => () => {
    for (const dispose of projectPages.values()) dispose();
    projectPages.clear();
  }, 'admin: project pages');

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
      const ok = await confirmAsk({
        title: `Approve #${ticket.id}?`,
        text: `${who} is emailed about this change.`,
        confirm: 'Approve',
      });
      if (!ok) return;
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
        await conversation.open({ runId: run.id, sessionId: run.session_id, sessionDir: run.session_dir, taskTicketId: ticket.id });
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

  /** The ticket rows of one project (or of my own tasks), with done/declined behind one row. */
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
            dot={tintOfStatus(ticket.status)}
            label={sidebarTicketLabel(ticket)}
            trailing={ago(ticket.updated_at)}
            menuItems={menu(ticket)}
            onClick={() => void openTicketRun(ticket)}
          />
        ))}
        {closed.length > 0 && (
          <Row
            appearance="secondary"
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
    if (open.some((ticket) => ticket.status === 'new')) return tintOfStatus('new');
    if (open.some((ticket) => ticket.status === 'review')) return tintOfStatus('review');
    if (open.some((ticket) => ticket.status === 'in_progress')) return tintOfStatus('in_progress');
    return open.length > 0 ? tintOfStatus('approved') : undefined;
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
      <button type="button" className="pta-iconbtn" aria-label="Refresh clients" title="Refresh clients" onClick={() => void load()}>
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
              appearance="container"
              icon={clientAvatar(client)}
              label={client.name || client.email}
              badge={badge || undefined}
              expanded={clientExpanded}
              onToggle={(open) => setRowOpen(clientKey, open)}
              onClick={() => openClientPage(client, selectPanel)}
              children={projects.length > 0 ? projects.map((project, projectIndex) => {
                const projectKey = `project:${client.id}:${project.id}`;
                const projectDefault = index === 0 && projectIndex === 0 && project.tickets.length > 0;
                const projectExpanded = rowOpen(projectKey, projectDefault);
                return (
                  <TreeRow
                    key={`${client.id}:${project.id}`}
                    appearance="container"
                     icon={<ProjectGlyph color={projectTint(project.tickets)} />}
                    label={project.name}
                    badge={openTicketCount(project.tickets) || undefined}
                    expanded={projectExpanded}
                    onToggle={(open) => setRowOpen(projectKey, open)}
                    onClick={() => project.id === '__none__' ? toggleRow(projectKey, projectDefault) : openProjectPage(project, selectPanel)}
                    menuItems={project.tickets.length === 0
                      ? undefined
                      : [{ id: 'open-project-tickets', label: 'Show project tickets', onSelect: () => setRowOpen(projectKey, true) }]}
                    children={project.tickets.length > 0
                      ? <TicketList Row={TreeRow} tickets={project.tickets} changed={() => void load()} />
                      : undefined}
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
              appearance="group"
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
              appearance="group"
               label="My task"
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

  const ticketCommandApi = (method, path, body) => desktop
    ? json(`api ${method} ${path}${body === undefined ? '' : ` ${JSON.stringify(body)}`}`, command.quiet)
    : api(method, path, body);

  function useLinkedTicketDetail(ticketId, sessionId) {
    const key = ticketId && sessionId ? `${ticketId}:${sessionId}` : null;
    const [state, setState] = useState(null);
    useEffect(() => {
      if (!key) return;
      const reader = createTicketDetailReader({ ticketId, sessionId, api: ticketCommandApi, update: next => setState({ ...next, key }) });
      const changed = event => {
        if (event.detail?.ticketId == null || Number(event.detail.ticketId) === ticketId) void reader.load();
      };
      void reader.load();
      window.addEventListener('admin:changed', changed);
      window.addEventListener('focus', changed);
      return () => {
        reader.dispose();
        window.removeEventListener('admin:changed', changed);
        window.removeEventListener('focus', changed);
      };
    }, [key, ticketId, sessionId]);
    return (state?.key === key ? state : null) ?? { detail: null, error: '' };
  }

  function TicketActivityFrame({ sessionId, ActivityProvider, children }) {
    const candidate = ticketFromCwd(useSessionCwd(sessionId));
    const { detail } = useLinkedTicketDetail(candidate?.ticketId, sessionId);
    const activity = useMemo(() => ticketActivity(detail), [detail]);
    return <ActivityProvider value={activity}>{children}</ActivityProvider>;
  }

  const meterApi = (method, path, body) =>
    json(`api ${method} ${path}${body === undefined ? '' : ` ${JSON.stringify(body)}`}`, command.quiet);
  const meter = createConversationMeter({
    api: meterApi,
    locks: desktop ? navigator.locks : null,
    now: () => performance.now(),
    foreground: () => document.visibilityState === 'visible' && document.hasFocus(),
  });
  if (desktop) ctx.effect(() => {
    const input = ['pointermove', 'pointerdown', 'keydown', 'scroll'];
    const options = { capture: true, passive: true };
    for (const event of input) window.addEventListener(event, meter.input, options);
    window.addEventListener('blur', meter.suspend);
    window.addEventListener('pagehide', meter.leave);
    document.addEventListener('visibilitychange', meter.suspend);
    const timer = setInterval(meter.tick, 250);
    return () => {
      clearInterval(timer);
      for (const event of input) window.removeEventListener(event, meter.input, options);
      window.removeEventListener('blur', meter.suspend);
      window.removeEventListener('pagehide', meter.leave);
      document.removeEventListener('visibilitychange', meter.suspend);
      meter.leave();
    };
  }, 'admin: conversation time eligibility');

  const meterNotices = {
    occupied: 'Time is already being recorded in another conversation or window.',
    unavailable: 'Time recording is unavailable in this window.',
    unconfirmed: 'Save not confirmed. Check the recorded total before resuming.',
    readFailed: 'Could not read the recorded time. Recording is paused.',
  };

  function TicketHeaderReadout({ sessionId, run, titled = false, sessionTitle = '' }) {
    const { ticketId } = run;
    const key = `${ticketId}:${sessionId}`;
    const root = useRef(null);
    const refresh = useRef(null);
    // Who filed the ticket, off the same detail read the meter takes.
    const [assistantApp, setAssistantApp] = useState(null);
    // The ticket's own title: the Host titles a session from the leading five
    // words of the run's first line, so a ticket session's title stops at
    // "Ticket #27 — First look:" even though the ticket says more.
    const [ticketTitle, setTicketTitle] = useState('');
    const snapshot = useSyncExternalStore(meter.subscribe, () => meter.snapshot(key));
    useEffect(() => {
      const isCurrent = () => {
        const element = root.current;
        return Boolean(element?.isConnected && (element.checkVisibility?.({ visibilityProperty: true }) ?? element.getClientRects().length));
      };
      const release = meter.retain(key, ticketId, isCurrent);
      let alive = true;
      let inFlight = false;
      let queued = false;
      async function read(force = false) {
        if (!alive || (!force && (document.hidden || !isCurrent()))) return;
        if (inFlight) { queued ||= force; return; }
        inFlight = true;
        const revision = meter.revision();
        try {
          const detail = await (desktop ? meterApi : api)('GET', `/admin/tickets/${ticketId}`);
          if (alive && !meter.observe(key, detail?.ticket, revision)) meter.readFailed(key);
          if (alive) {
            const ticket = detail?.ticket;
            setAssistantApp(typeof ticket?.assistant_app === 'string' ? ticket.assistant_app : null);
            // The run brief's first line is `${kind} #${id} — ${ticket.title}`, so
            // the stored title must be completed from the same field.
            const title = typeof ticket?.title === 'string' && ticket.title.trim() ? ticket.title.trim() : typeof ticket?.title_en === 'string' ? ticket.title_en.trim() : '';
            setTicketTitle(title);
          }
        } catch {
          if (alive) meter.readFailed(key);
        } finally {
          inFlight = false;
          if (queued) { queued = false; void read(true); }
        }
      }
      const changed = event => {
        if (event.detail?.ticketId == null || Number(event.detail.ticketId) === ticketId) void read(true);
      };
      const foreground = () => void read();
      refresh.current = () => void read(true);
      void read(true);
      window.addEventListener('admin:changed', changed);
      if (desktop) window.addEventListener('focus', foreground);
      const timer = desktop ? setInterval(foreground, 30_000) : null;
      return () => {
        alive = false;
        refresh.current = null;
        clearInterval(timer);
        window.removeEventListener('admin:changed', changed);
        window.removeEventListener('focus', foreground);
        release();
      };
    }, [key, ticketId]);
    useEffect(() => {
      if (snapshot.notice === 'unconfirmed') refresh.current?.();
    }, [snapshot.notice]);

    const { phase, notice, seconds, status, needsRead } = snapshot;
    const enabled = phase === 'running' || phase === 'waiting';
    const busy = phase === 'starting' || phase === 'saving';
    const recorded = seconds === null ? '—' : formatRecordedTime(seconds);
    const hint = meterNotices[notice] ?? (phase === 'waiting' ? 'Time waits while this conversation is idle or out of focus.' : 'Recorded human time');
    const via = assistantBadge({ assistant_app: assistantApp });
    // Only complete a title the Host shortened: a session renamed by hand has
    // its own words, and the header keeps them.
    const fullTitle = ticketTitle ? `${run.kind === 'task' ? 'Task' : 'Ticket'} #${ticketId} — ${ticketTitle}` : '';
    const generated = sessionTitle.trim();
    const heading = generated && fullTitle.startsWith(generated) && fullTitle.length > generated.length ? fullTitle : '';
    return (
      <span ref={root} className={`pta-chat-ticket${heading ? ' pta-chat-ticket--heading' : ''}`} title={hint}>
        {heading ? <span className="pta-chat-ticket__title" title={heading}>{heading}</span> : null}
        {heading ? null : <span className={`pta-chat-ticket__id${titled ? ' pta-sr' : ''}`}>{run.kind === 'task' ? 'Task' : 'Ticket'} #{ticketId}</span>}
        <span className="pta-chat-ticket__status">{status ? (STATUS_LABEL[status] ?? status) : needsRead ? 'Unavailable' : 'Loading…'}</span>
        {via ? <span className="pta-tag pta-tag--client" title={assistantBadgeTitle({ assistant_app: assistantApp })}>{via}</span> : null}
        {desktop ? (
          <>
            <span className="pta-chat-ticket__time" aria-label={`Recorded human time: ${seconds === null ? 'unavailable' : recorded}`}><span aria-hidden="true">⏱ </span>{recorded}</span>
            {status && seconds !== null && phase !== 'closed' ? (
              <PtaButton className="pta-chat-ticket__action" disabled={busy || needsRead}
                onClick={() => enabled ? meter.pause(key) : void meter.resume(key)}>
                {enabled ? 'Pause' : phase === 'starting' ? 'Starting…' : phase === 'saving' ? 'Saving…' : 'Resume'}
              </PtaButton>
            ) : null}
            <span className="pta-chat-ticket__feedback" role="status">{notice ? hint : ''}</span>
          </>
        ) : null}
      </span>
    );
  }

  function TicketHeaderChip({ sessionId }) {
    const key = useSessionCwd(sessionId);
    const run = ticketFromCwd(key);
    if (!run || !sessionId) return null;
    const sessionTitle = String(key ?? '').split(SEP)[1] ?? '';
    // The session title usually starts "Ticket #27 —"; then the id would only repeat it.
    const titled = new RegExp(`#${run.ticketId}\\b`).test(sessionTitle);
    return <TicketHeaderReadout key={`${run.ticketId}:${sessionId}`} sessionId={sessionId} run={run} titled={titled} sessionTitle={sessionTitle} />;
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
    .pta-ticket-form{display:grid;gap:6px;max-width:40rem}
    .pta-ticket-form label{display:grid;gap:4px}
    .pta-ticket-form textarea{min-height:4rem;font:inherit;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-translucent,currentColor);border-radius:6px}
    .pta-ticket-form .pta-btn{justify-self:start}
    .pta-ticket-form__row{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .pta-dock .pta-ticket-form{max-width:none}
    .pta-dock .pta-ticket-form textarea{min-height:0;resize:vertical;padding:4px 6px}
    .pta-chat-ticket{display:inline-flex;align-items:center;flex-wrap:wrap;gap:2px 6px;flex:0 0 auto;min-width:0;max-width:100%;line-height:1.3;font-size:11.5px}
    .pta-chat-ticket__id,.pta-chat-ticket__time{white-space:nowrap}
    .pta-chat-ticket__status{color:var(--dsw-alias-label-secondary,currentColor);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pta-chat-ticket__time{font-variant-numeric:tabular-nums}
    .pta-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
    /* The header chip keeps its status, timer and Resume compact, so the session
       title gets every pixel left over: one line, ellipsis at the end. The host
       caps crumbs at 220px; on this row that cuts a title mid-word, so the
       current crumb shrinks instead (its flex min-width must be 0 to shrink). */
    [class*="_titleCluster"]:has(.pta-chat-ticket) [class*="_crumbs"]{flex:1 1 auto;min-width:0}
    [class*="_titleCluster"]:has(.pta-chat-ticket) [class*="_crumbSeg"]{min-width:0}
    [class*="_titleCluster"]:has(.pta-chat-ticket) [class*="_crumbCurrent"]{flex:0 1 auto;min-width:0;max-width:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    /* When the Host only stored its five-word fallback title, the chip carries
       the ticket's full title in the crumb's place: it takes the free width,
       one line, ellipsis at the end, while status, timer and Resume keep their
       natural size after it. */
    [class*="_titleCluster"]:has(.pta-chat-ticket--heading) [class*="_crumbs"]{display:none}
    [class*="_titleCluster"]:has(.pta-chat-ticket--heading) [class*="_headerActions"]{flex:1 1 auto;min-width:0}
    .pta-chat-ticket--heading{flex:1 1 auto;flex-wrap:nowrap;min-width:0}
    .pta-chat-ticket__title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary,inherit)}
    .pta-chat-ticket--heading .pta-chat-ticket__status,.pta-chat-ticket--heading .pta-chat-ticket__time,.pta-chat-ticket--heading .pta-chat-ticket__action,.pta-chat-ticket--heading .pta-tag{flex:none}
    .pta-chat-ticket .pta-chat-ticket__action{min-height:22px;padding:1px 6px;font-size:11px}
    .pta-chat-ticket__action:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,currentColor);outline-offset:2px}
    .pta-chat-ticket__feedback{font-size:11px;max-width:100%;color:var(--dsw-alias-label-secondary,currentColor);overflow-wrap:anywhere}
    .pta-chat-ticket__feedback:empty{position:absolute;width:1px;height:1px;overflow:hidden}
    /* Sidebar panel entries: the host draws one glyph span and then the label,
       with no trailing slot, so a count cannot sit after the text. State is a
       small dot on the glyph's corner instead — amber for a decision waiting,
       green for live runs, business blue for client messages waiting — kept
       inside the 6px label gap so it never covers the label's first letter. */
    .pta-entry-icon{position:relative;display:inline-flex;align-items:center;justify-content:center;line-height:0}
    .pta-entry-dot{position:absolute;top:-2px;right:-2px;width:7px;height:7px;border-radius:50%;box-sizing:border-box;box-shadow:0 0 0 1.5px var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-base,transparent))}
    .pta-entry-dot--wait{background:var(--dsw-alias-state-warning-primary,#d18f2e)}
    .pta-entry-dot--live{background:var(--dsw-alias-state-success-primary,#2f9e5b)}
    .pta-entry-dot--waiting{background:var(--dsw-alias-state-business-primary,#4c8dff)}
    .pta-page{height:100%;overflow-y:auto;box-sizing:border-box;min-width:0;flex:1 1 auto;width:100%;padding:26px 30px 56px;max-width:1120px;margin:0 auto;color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:1.45}
    .pta-head{display:flex;align-items:flex-start;gap:18px;margin:0 0 18px}
    .pta-head h1{margin:0;font-size:24px;line-height:1.15;font-weight:650;letter-spacing:-0.02em}
    .pta-head p{margin:6px 0 0;font-size:13px;opacity:.65;max-width:620px}
    .pta-head__actions{display:flex;align-items:center;gap:8px;margin-left:auto;padding-top:2px}
    /* The Needs-you filter chips: compact, non-zero only, colour by status. */
    .pta-filters .pta-filter{display:inline-flex;align-items:center;gap:5px}
    .pta-filters .pta-filter .pta-dot{flex:0 0 auto}
    .pta-dot--new{background:var(--dsw-alias-state-warning-primary,#d18f2e)}
    .pta-dot--review,.pta-dot--waiting{background:var(--dsw-alias-state-business-primary,#4c8dff)}
    .pta-dot--stalled{background:var(--dsw-alias-state-success-primary,#2f9e5b)}
    .pta-head__stalled{opacity:.55}
    /* One line per ticket row, 36px at most, with quiet actions on the right. */
    .pta-rows .pta-row{padding:4px 12px;min-height:36px;max-height:36px}
    .pta-row__email{max-width:200px;overflow:hidden;text-overflow:ellipsis}
    .pta-rows .pta-row .pta-actions .pta-btn{height:22px;min-width:78px;padding:0 9px;font-size:11px;border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.34));background:transparent;color:inherit;text-align:center;opacity:.62}
    .pta-rows .pta-row .pta-actions .pta-btn:hover{background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.12))}
    .pta-rows .pta-row:hover .pta-actions .pta-btn,.pta-rows .pta-row:focus-within .pta-actions .pta-btn{opacity:1}
    .pta-rows .pta-row .pta-actions .pta-btn--primary{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.34));background:transparent;color:inherit}
    .pta-rows .pta-row:hover .pta-actions .pta-btn--primary,.pta-rows .pta-row:focus-within .pta-actions .pta-btn--primary{background:var(--dsw-alias-brand-primary,#ff5a1f);border-color:transparent;color:#fff;opacity:1}
    .pta-rows .pta-row--more{justify-content:center;min-height:32px;max-height:32px;font-size:11.5px;opacity:.55}
    .pta-rows .pta-row--more:hover{opacity:.95}
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
    .pta-hint{margin:6px 2px 10px;font-size:10.5px;opacity:.45}
    .pta-warn{flex:0 0 auto;font-size:11px;color:var(--dsw-alias-state-warning-primary,#d18f2e);white-space:nowrap}
    .pta-fill{flex:1 1 auto;min-width:8px}
    .pta-actions{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto}
    .pta-btn{height:23px;padding:0 8px;border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.34));border-radius:5px;background:transparent;color:inherit;font:inherit;font-size:11.5px;line-height:1;white-space:nowrap;cursor:pointer}
    .pta-btn:hover{background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.1))}
    .pta-btn:disabled{opacity:.45;cursor:default}
    .pta-btn--primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#ff5a1f);color:#fff}
    .pta-btn--primary:hover{filter:brightness(1.06);background:var(--dsw-alias-brand-primary,#ff5a1f)}
    .pta-btn--ghost{border-color:transparent;opacity:.72}
    .pta-btn--danger{border-color:transparent;background:var(--dsw-alias-state-danger-primary,#e5534b);color:#fff}
    .pta-btn--danger:hover{filter:brightness(1.06);background:var(--dsw-alias-state-danger-primary,#e5534b)}
    .pta-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;font-size:14px;line-height:1;cursor:pointer}
    .pta-iconbtn:hover{background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.1))}
    .pta-settings{padding:20px 24px;max-width:680px}
    .pta-settings h2{margin:0 0 4px;font-size:17px}
    .pta-settings__intro{margin:0 0 14px;font-size:12.5px;opacity:.65;line-height:1.45}
    .pta-settings__row{display:flex;align-items:center;gap:16px;padding:14px 0;border-top:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.22))}
    .pta-settings__label{display:block;font-size:13px}
    .pta-settings__hint{display:block;margin-top:2px;font-size:12px;opacity:.6}
    .pta-settings__text{flex:1;min-width:0}
    .pta-settings__error{margin:10px 0 0;font-size:12px;color:var(--dsw-alias-state-danger-primary,#e5534b)}
    .pta-switch{display:inline-flex;align-items:center;box-sizing:border-box;width:38px;height:22px;padding:2px;border:0;border-radius:11px;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.35));cursor:pointer}
    .pta-switch[aria-checked=true]{justify-content:flex-end;background:var(--dsw-alias-state-success-primary,#2f9e5b)}
    .pta-switch:disabled{cursor:wait}
    .pta-switch__knob{width:18px;height:18px;border-radius:9px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3)}
    .pta-confirm{position:fixed;inset:0;z-index:2147482999;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.35);pointer-events:auto}
    .pta-confirm__box{width:min(440px,100%);padding:16px 18px;border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.3));border-radius:12px;background:var(--dsw-alias-bg-elevated,#23252a);box-shadow:0 18px 50px rgba(0,0,0,.35);font-size:13px;line-height:1.45}
    .pta-confirm__box h3{margin:0 0 6px;font-size:15px}
    .pta-confirm__box p{margin:0;font-size:12.5px;color:var(--dsw-alias-label-secondary,inherit)}
    .pta-confirm__actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
    .pta-dot--running{background:var(--dsw-alias-state-success-primary,#2f9e5b)}
    .pta-dot--danger{background:var(--dsw-alias-state-danger-primary,#e5534b)}
    .pta-task-row{border-bottom:0;border-radius:6px;padding:6px 8px;align-items:flex-start}
    .pta-task-row--run{padding:3px 8px 3px 23px;font-size:11.5px}
    .pta-task-row--more{padding:2px 8px 2px 23px;font-size:11px;opacity:.6}
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
    .pta-run-shortcut{display:grid;place-items:center;width:16px;height:20px;padding:0;border:0;border-radius:3px;background:transparent;color:inherit;cursor:pointer}
    .pta-run-shortcut:hover,.pta-run-shortcut:focus-visible{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-skeleton)}
    .pta-run-shortcut:focus-visible{outline:1px solid currentColor;outline-offset:-1px}
    .pta-dock{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance,0px) - var(--dsh-composer-side-clearance,0px));max-width:var(--dsh-composer-card-max-width,760px);margin:0 auto 8px;border:0;border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-specific-menu,var(--dsw-alias-bg-elevated,#23252a));backdrop-filter:var(--dsw-menu-backdrop-filter,blur(12px));box-shadow:var(--dsw-elevation-panel,0 10px 30px rgba(0,0,0,.28));--dsw-elevation-stroke-color:var(--dsw-alias-border-l1,rgba(127,127,127,.24));overflow:hidden;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,inherit);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
    .pta-dock .pta-meta{font-size:12px;opacity:.58}
    .pta-dock .pta-btn{height:24px;font-size:12px;border-radius:var(--dsw-radius-sm,6px)}
    .pta-dock .pta-pill{height:20px;font-size:11px}
    .pta-dock__head{display:flex;align-items:center;gap:8px;padding:7px 10px;min-height:34px;flex-wrap:wrap}
    .pta-dock__id{flex:none;font-variant-numeric:tabular-nums;font-size:12px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.72))}
    .pta-dock__title{min-width:0;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500}
    /* The strip's two actions are link-buttons: text-sized, quiet, and lighter
       than the workspace chip, so the row reads one line and no controls. */
    .pta-dock__link{display:inline-flex;align-items:center;height:20px;padding:0;border:0;border-radius:2px;background:none;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:12px;line-height:20px;white-space:nowrap;cursor:pointer;text-decoration:none}
    .pta-dock__link:hover{color:var(--dsw-alias-label-primary,inherit);text-decoration:underline;text-underline-offset:2px}
    .pta-dock__link:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,currentColor);outline-offset:2px}
    .pta-dock__link[aria-expanded=true]{color:var(--dsw-alias-label-primary,inherit);text-decoration:underline;text-underline-offset:2px}
    .pta-dock__chev{font-size:10px;line-height:1;opacity:.55}
    .pta-dock__body{border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));max-height:260px;overflow-y:auto;padding:8px 10px}
    .pta-dock__last{padding:0 10px 7px;font-size:12px;color:var(--dsw-alias-label-secondary,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pta-dock__last .pta-meta{font-size:12px}
    .pta-dock__row{flex-wrap:nowrap;padding:4px 8px;min-height:32px;gap:6px}
    .pta-dock__row .pta-dock__title{flex:1 1 auto;max-width:none}
    .pta-dock__ws{display:inline-flex;align-items:center;gap:4px;flex:none}
    .pta-dock__chip{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 6px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}
    .pta-dock__chip:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
    .pta-dock__chip:disabled{cursor:default}
    .pta-dock__dot{width:7px;height:7px;border-radius:50%;background:#9aa0a6}
    .pta-dock__ws[data-state=ready] .pta-dock__dot{background:#3fb950}
    .pta-dock__ws[data-state=missing] .pta-dock__dot,.pta-dock__ws[data-state=conflict] .pta-dock__dot{background:#d29922}
    /* No local checkout is a normal ticket, not a failure: the dot stays
       neutral and the words stay quiet, so red is reserved for a real one. */
    .pta-dock__ws[data-state=unavailable] .pta-dock__dot{background:var(--dsw-alias-label-tertiary,#8a9099)}
    .pta-dock__ws[data-state=unavailable] .pta-dock__chip,.pta-dock__ws[data-state=unmanaged] .pta-dock__chip{color:var(--dsw-alias-label-tertiary,inherit);opacity:.85}
    .pta-dock__actions{display:inline-flex;align-items:center;gap:12px;flex:none}
    .pta-dock-anchor{display:contents}
    .pta-hist{height:100%;width:100%;overflow-y:auto;box-sizing:border-box;padding:18px 24px 140px;max-width:860px;margin:0 auto;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,inherit)}
    .pta-hist__bar{display:flex;align-items:center;gap:10px;margin:0 0 14px}
    .pta-seg{display:inline-flex;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.1))}
    .pta-seg button{height:26px;padding:0 12px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:12.5px;cursor:pointer}
    .pta-seg button[aria-pressed=true]{background:var(--dsw-alias-bg-elevated,rgba(127,127,127,.22));color:var(--dsw-alias-label-primary,inherit);box-shadow:0 1px 2px rgba(0,0,0,.25)}
    .pta-hist__reload{margin-left:auto;height:26px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:12px;cursor:pointer}
    .pta-hist__reload:hover,.pta-hist__tickets button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
    .pta-hist__day h3{margin:14px 0 4px;font-size:11.5px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8))}
    .pta-hist__day ol{list-style:none;margin:0;padding:0}
    .pta-hist__item{position:relative;display:grid;grid-template-columns:44px 14px 1fr;align-items:baseline;gap:6px;padding:3px 0}
    .pta-hist__item time{font-variant-numeric:tabular-nums;font-size:12px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8))}
    .pta-hist__item:not(:last-child)::after{content:"";position:absolute;left:56px;top:17px;bottom:-5px;width:1px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.22))}
    .pta-hist__dot{justify-self:center;width:8px;height:8px;border-radius:50%;background:#9aa0a6;transform:translateY(-1px)}
    .pta-hist__item[data-type=run] .pta-hist__dot{background:#58a6ff}
    .pta-hist__item[data-type=land] .pta-hist__dot{background:#3fb950}
    .pta-hist__item[data-status=done] .pta-hist__dot{background:#3fb950}
    .pta-hist__item[data-status="in review"] .pta-hist__dot{background:#a371f7}
    .pta-hist__item[data-status="in progress"] .pta-hist__dot,.pta-hist__item[data-status=approved] .pta-hist__dot{background:#d29922}
    .pta-hist__item[data-status=declined] .pta-hist__dot{background:#f85149}
    .pta-hist__text{min-width:0;overflow-wrap:anywhere}
    .pta-hist__text strong{font-weight:550}
    .pta-hist__detail{color:var(--dsw-alias-label-secondary,inherit)}
    .pta-hist__empty{color:var(--dsw-alias-label-secondary,inherit)}
    .pta-hist__scope{margin:0;font-size:13px;font-weight:600}
    .pta-hist__tickets{list-style:none;margin:0;padding:0}
    .pta-hist__tickets button{display:flex;align-items:baseline;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:start;cursor:pointer}
    .pta-hist__tid{flex:none;font-variant-numeric:tabular-nums;font-size:12px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8))}
    .pta-hist__ttitle{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pta-hist__tstatus{flex:none;font-size:11.5px;color:var(--dsw-alias-label-secondary,inherit);text-transform:capitalize}
    .pta-hist__tickets time{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8))}
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
    @media (max-width:760px){.pta-page{padding:18px 16px 40px}.pta-head{flex-direction:column}.pta-head__actions{margin-left:0;width:100%}.pta-search{flex:1 1 auto;min-width:0}.pta-tag{max-width:120px}}
    ${PROJECT_PARK_STYLES}
  `;

  const CLIENT_VISIBLE_STATUSES = new Set(['approved', 'declined', 'done']);
  /** A deep link arrived before the initial-view timer: it owns the first screen. */
  let handledDeepLink = false;
  const WORKBENCH_PANEL = 'admin-workbench';
  const INBOX_PANEL = 'admin-inbox';
  const HOME_PANEL = 'admin';
  const MARKETING_PANEL = 'admin-marketing';
  const SEO_PANEL = 'admin-seo';

  const ticketLabel = (ticket) => ticket?.title_en || ticket?.title || '(untitled)';
  const dollars = (cents) => (Number.isFinite(Number(cents)) ? `$${(Number(cents) / 100).toFixed(2)}` : '');
  const isWaiting = (ticket) => Boolean(ticket) && Number(ticket?.client_waiting_since ?? 0) > 0 && !isClosedTicket(ticket) && ticket?.status !== 'new';

  /**
   * The four lists the native pages share, refreshed when the portal says
   * something changed. One fetch per page, not a poll per widget.
   */
  function useLiveAdmin() {
    const [state, setState] = useState({
      tickets: [], projects: [], running: [], recent: [], queue: [], attention: null, loading: true, error: '', code: '', at: 0,
    });
    const mounted = useRef(true);
    const load = useCallback(async () => {
      try {
        // Tickets are the sentinel: their failure is the page's (signed out,
        // offline). The extra desks are best-effort, so an older Worker
        // without one still leaves the home usable.
        const tickets = await api('GET', '/admin/tickets');
        const [projects, runs, queue, attentionNow] = await Promise.all([
          api('GET', '/admin/projects').catch(() => null),
          api('GET', '/admin/runs').catch(() => null),
          api('GET', '/admin/queue').catch(() => null),
          api('GET', '/admin/attention').catch(() => null),
        ]);
        if (!mounted.current) return;
        setState({
          tickets: Array.isArray(tickets?.tickets) ? tickets.tickets : [],
          projects: Array.isArray(projects?.projects) ? projects.projects : [],
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

  /**
   * Group one live snapshot into what a person can act on, in urgency order.
   * The ticket buckets come from the shared `needsYou` rule in admin-ui, so the
   * desktop and the web workbench put a ticket under the same heading. Only the
   * desktop's run lists (running now, failed runs) are additions after it.
   */
  function ticketGroups(data) {
    const nowSeconds = Date.now() / 1000;
    const shared = needsYou({
      tickets: Array.isArray(data.tickets) ? data.tickets : [],
      queue: Array.isArray(data.queue) ? data.queue : [],
      nodes: [],
    });
    // format.js's waiting rule does not exclude finished tickets yet; a done or
    // declined ticket is never waiting on an answer.
    const openWaiting = shared.waiting.filter((ticket) => !isClosedTicket(ticket));
    return {
      approvals: shared.new,
      reviews: shared.review,
      waiting: openWaiting,
      stalled: shared.stalled,
      stuck: shared.stuck,
      running: Array.isArray(data.running) ? data.running : [],
      failed: (Array.isArray(data.recent) ? data.recent : [])
        .filter((run) => run.status === 'failed' && nowSeconds - Number(run.finished_at ?? 0) < 86_400)
        .slice(0, 8),
    };
  }

  /**
   * "Needs a decision" is one number everywhere: the sidebar badge counts
   * approve + review + client waiting from `/admin/attention`, and this page
   * counts the same three buckets, so the header agrees with the badge by
   * construction. Stalled work is urgent too, but it is an agent's problem
   * ("run again"), not a decision, so it is never part of this count.
   */
  function decisionCount(groups) {
    return groups.approvals.length + groups.reviews.length + groups.waiting.length;
  }

  /** Lets a `pta:inbox-filter` event preset the Inbox's filter before it mounts. */
  let pendingInboxFilter = null;

  /** Set a ticket's status, confirming the moves that email the client. */
  async function changeTicketStatus(ticket, status) {
    const requeue = status === 'approved' && ticket.status !== 'new';
    if (requeue) {
      const ok = await confirmAsk({
        title: `Queue another Fleet run for #${ticket.id}?`,
        text: 'This can change ticket status and notify the client. Fleet may resume the prior session with newer instructions.',
        confirm: 'Queue another run',
      });
      if (!ok) return false;
    }
    if (!requeue && CLIENT_VISIBLE_STATUSES.has(status) && ticket.kind !== 'system') {
      const who = ticket.client_email || ticket.client_name || 'The client';
      const what = status === 'approved' ? 'Approve' : status === 'declined' ? 'Decline' : 'Mark done';
      const ok = await confirmAsk({
        title: `${what} #${ticket.id}?`,
        text: `${who} is emailed about this change.`,
        confirm: what,
        danger: status === 'declined',
      });
      if (!ok) return false;
    }
    await api('PATCH', `/admin/tickets/${ticket.id}`, { status });
    window.dispatchEvent(new CustomEvent('admin:changed', { detail: { kind: 'ticket.status', ticketId: ticket.id } }));
    return true;
  }

  async function markTicketAnswered(ticket) {
    await api('POST', `/admin/tickets/${ticket.id}/answered`);
    window.dispatchEvent(new CustomEvent('admin:changed', { detail: { kind: 'ticket.answered', ticketId: ticket.id } }));
  }

  /**
   * The moves a row offers, chosen by status rather than by page. Every button
   * is a small outline at rest and only turns strong on row hover/focus (the
   * CSS in `.pta-rows .pta-row .pta-actions`); one primary move per group:
   * review → Done, approve → Approve, stalled → Run again. "Open" goes to the
   * conversation, the same place a row click takes you.
   */
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
          <PtaButton kind="ghost" onClick={() => void openTicketRun(ticket)}>Open</PtaButton>
        </>
      );
    }
    if (isWaiting(ticket)) {
      return <PtaButton kind="ghost" onClick={() => void markTicketAnswered(ticket)}>No reply needed</PtaButton>;
    }
    if (ticket.status === 'in_progress') {
      return (
        <>
          <PtaButton kind="primary" onClick={() => void changeTicketStatus(ticket, 'approved')}>Run again</PtaButton>
          <PtaButton kind="ghost" onClick={() => void openTicketRun(ticket)}>Open</PtaButton>
        </>
      );
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
        {STATUS_LABEL[status] ?? status ?? 'unknown'}
      </span>
    );
  }

  /**
   * One in-app confirm for every ask that emails a client or restores a
   * workspace: never the browser's `window.confirm`. The dialog lives in the
   * frame overlay (`ConfirmHost`), so a confirm survives a page switch; a host
   * without that slot falls back to the browser dialog rather than losing the ask.
   */
  const confirmHost = { open: null };
  function confirmAsk(ask) {
    return new Promise((resolve) => {
      if (!confirmHost.open) {
        resolve(window.confirm([ask.title, ask.text].filter(Boolean).join('\n\n')));
        return;
      }
      confirmHost.open({ ...ask, resolve });
    });
  }

  function ConfirmHost() {
    const [ask, setAsk] = useState(null);
    const close = useCallback((answer) => {
      setAsk((current) => {
        if (current) current.resolve(answer);
        return null;
      });
    }, []);
    useEffect(() => {
      confirmHost.open = (next) => setAsk((current) => {
        if (current) current.resolve(false);
        return next;
      });
      return () => { confirmHost.open = null; };
    }, []);
    useEffect(() => {
      if (!ask) return undefined;
      const onKey = (event) => {
        if (event.key === 'Escape') close(false);
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [ask, close]);
    if (!ask) return null;
    return (
      <div className="pta-confirm" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close(false)}>
        <div className="pta-confirm__box" role="dialog" aria-modal="true" aria-label={ask.title}>
          <h3>{ask.title}</h3>
          {ask.text ? <p>{ask.text}</p> : null}
          <div className="pta-confirm__actions">
            <PtaButton onClick={() => close(false)}>Cancel</PtaButton>
            <PtaButton kind={ask.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>{ask.confirm ?? 'Confirm'}</PtaButton>
          </div>
        </div>
      </div>
    );
  }

  /**
   * One ticket line: dot, number, ellipsized title, then who filed it as quiet
   * muted text (a "My task" or "stuck" label keeps its small badge), the
   * project, the age, and the row's actions on the right.
   */
  function TicketLine({ ticket, actions = null, tag = '', reason = '', detail = '', showAge = true }) {
    const open = () => void openTicketRun(ticket);
    // Who filed it: a person in the portal, or the client's assistant over MCP.
    const via = assistantBadge(ticket);
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
        {tag ? <span className="pta-tag">{tag}</span> : null}
        {ticket.kind === 'system'
          ? <span className="pta-tag">My task</span>
          : ticket.client_email ? <span className="pta-meta pta-row__email" title={ticket.client_email}>{ticket.client_email}</span> : null}
        {via ? <span className="pta-tag pta-tag--client" title={assistantBadgeTitle(ticket)}>{via}</span> : null}
        <span className="pta-meta">{ticket.project_name || 'no project'}</span>
        {reason ? <span className="pta-warn">{reason}</span> : null}
        <span className="pta-fill" />
        {detail ? <span className="pta-meta">{detail}</span> : null}
        {showAge ? <span className="pta-meta">{ago(ticket.updated_at)}</span> : null}
        {actions ? <span className="pta-actions" onClick={(event) => event.stopPropagation()}>{actions}</span> : null}
      </div>
    );
  }

  /**
   * j/k, the arrows, Home and End move focus between the ticket rows of one
   * page. The rows are queried from that page's own root element, so a
   * mounted-but-hidden page never moves focus for the page the user is looking
   * at. Rows are plain `.pta-row` elements, which covers the divs on Inbox and
   * Needs you and the run buttons on Needs you alike.
   */
  function navigateRowFocus(root, event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return false;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return false;
    if (!root?.isConnected || root.offsetParent === null) return false;
    const rows = Array.from(root.querySelectorAll('.pta-row'));
    const active = document.activeElement;
    const focusedRow = active instanceof Element ? active.closest('.pta-row') : null;
    const index = nextRowIndex(focusedRow ? rows.indexOf(focusedRow) : -1, rows.length, event.key);
    if (index === null || index >= rows.length) return false;
    event.preventDefault();
    rows[index].focus({ preventScroll: true });
    rows[index].scrollIntoView({ block: 'nearest' });
    return true;
  }

  /** One window keydown listener for a page that has no other page-wide keys. */
  function useRowNavigation(rootRef) {
    useEffect(() => {
      const onKeyDown = (event) => { navigateRowFocus(rootRef.current, event); };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, [rootRef]);
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
    const root = useRef(null);
    useRowNavigation(root);
    const groups = useMemo(() => ticketGroups(data), [data]);
    // A chip filters the list below; clicking the active chip goes back to all.
    const [listFilter, setListFilter] = useState('all');
    // The stalled group stays folded to its first rows until asked for more.
    const [stalledOpen, setStalledOpen] = useState(false);
    const decisions = decisionCount(groups);
    const goInbox = () => ctx.layout?.selectPanel?.(INBOX_PANEL);
    const goWorkbench = () => ctx.layout?.selectPanel?.(WORKBENCH_PANEL);
    if (data.loading && data.at === 0) return <div className="pta-page" ref={root}><p className="pta-empty">Loading…</p></div>;
    if (data.error) {
      return (
        <div className="pta-page" ref={root}>
          <header className="pta-head">
            <div>
              <h1>Needs you</h1>
              <p>{isAuthError(data.code) ? data.error || 'Connect PTech Admin to the portal to see what is waiting.' : 'The portal could not be reached.'}</p>
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
        </div>
      );
    }
    /**
     * One list section. `options.collapse` folds the group to its first
     * STALLED_PREVIEW rows behind a "Show N more" row; `options.tag` badges
     * every row (the stalled group says "stuck", with a muted age).
     */
    const STALLED_PREVIEW = 3;
    const section = (key, title, hint, items, options = {}) => {
      if (items.length === 0) return null;
      const { tag = '', reasonOf = null, collapse = false } = options;
      const shown = collapse && !stalledOpen ? items.slice(0, STALLED_PREVIEW) : items;
      const hidden = items.length - shown.length;
      return (
        <section key={key} className="pta-section">
          <div className="pta-section__head">
            <h3>{title} <span className="pta-count">{items.length}</span></h3>
            <span className="pta-meta">{hint}</span>
          </div>
          <div className="pta-rows">
            {shown.map((ticket) => (
              <TicketLine
                key={ticket.id}
                ticket={ticket}
                tag={tag}
                reason={reasonOf ? reasonOf(ticket) : ''}
                actions={<TicketRowActions ticket={ticket} />}
              />
            ))}
            {hidden > 0 ? (
              <button type="button" className="pta-row pta-row--more" onClick={() => setStalledOpen(true)}>
                Show {hidden} more
              </button>
            ) : null}
          </div>
        </section>
      );
    };
    const shows = (key) => listFilter === 'all' || listFilter === key;
    const stuckReason = new Map(
      data.queue
        .filter((item) => !(Array.isArray(item?.eligible) ? item.eligible.length > 0 : Boolean(item?.eligible)))
        .map((item) => [Number(item.id), item.reason ?? 'no eligible node']),
    );
    // Only the non-zero groups become chips; stalled is shown, never counted
    // as a decision.
    const chips = [
      { key: 'approvals', label: 'To approve', dot: 'new', count: groups.approvals.length, hint: 'New requests. Nothing runs until you decide.' },
      { key: 'reviews', label: 'To review', dot: 'review', count: groups.reviews.length, hint: 'Finished runs waiting for your check.' },
      { key: 'waiting', label: 'Clients waiting', dot: 'waiting', count: groups.waiting.length, hint: 'They wrote last and have heard nothing since.' },
      { key: 'stalled', label: 'Stalled', dot: 'stalled', count: groups.stalled.length, hint: 'In progress for 45+ minutes without a report. Not a decision: run again or leave it.' },
      { key: 'running', label: 'Running now', dot: 'running', count: groups.running.length, hint: 'Agents working right now.' },
    ].filter((chip) => chip.count > 0);
    return (
      <div className="pta-page" ref={root}>
        <header className="pta-head">
          <div>
            <h1>Needs you</h1>
            <p>
              {decisions === 0 && groups.stalled.length === 0
                ? 'Nothing is waiting on you. Agents are on it.'
                : (
                  <>
                    {decisions > 0
                      ? `${decisions} item${decisions === 1 ? '' : 's'} want${decisions === 1 ? 's' : ''} a decision.`
                      : 'No decisions waiting.'}
                    {groups.stalled.length > 0 ? <span className="pta-head__stalled"> {groups.stalled.length} stalled.</span> : null}
                  </>
                )}
            </p>
          </div>
          <div className="pta-head__actions">
            <PtaButton onClick={goInbox}>Open Inbox</PtaButton>
            <PtaButton kind="ghost" onClick={goWorkbench}>Workbench</PtaButton>
          </div>
        </header>

        <ProjectPark
          projects={data.projects}
          tickets={data.tickets}
          runs={data.running}
          recentRuns={data.recent}
          now={data.at || Date.now()}
          onSelect={(plot) => openProjectPage(plot)}
          onOpenTicket={(ticket) => void openTicketRun(ticket)}
        />

        {chips.length > 0 ? (
          <div className="pta-filters" role="group" aria-label="Filter the list">
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className={`pta-filter${listFilter === chip.key ? ' is-active' : ''}`}
                title={chip.hint}
                aria-pressed={listFilter === chip.key}
                onClick={() => setListFilter((prev) => (prev === chip.key ? 'all' : chip.key))}
              >
                <span className={`pta-dot pta-dot--${chip.dot}`} aria-hidden="true" />
                {chip.label}
                <span className="pta-count">{chip.count}</span>
              </button>
            ))}
          </div>
        ) : null}

        {shows('approvals') ? section('approvals', 'Approve or decline', 'New requests. Nothing runs until you decide.', groups.approvals) : null}
        {shows('reviews') ? section('review', 'Check the agent’s work', 'Finished runs waiting for you.', groups.reviews) : null}
        {shows('waiting') ? section('waiting', 'Answer the client', 'They wrote last and have heard nothing since.', groups.waiting) : null}
        {shows('stalled') ? section('stalled', 'Stalled', 'In progress for 45+ minutes without a report.', groups.stalled, { tag: 'stuck', collapse: true }) : null}
        {listFilter === 'all' ? section('stuck', 'No node can take these', 'Approved, but nothing eligible can run them.', groups.stuck, { reasonOf: (ticket) => stuckReason.get(Number(ticket.id)) ?? '' }) : null}

        {groups.running.length > 0 && shows('running') ? (
          <section className="pta-section">
            <div className="pta-section__head"><h3>Running now <span className="pta-count">{groups.running.length}</span></h3><span className="pta-meta">Live agent work.</span></div>
            <div className="pta-rows">
              {groups.running.map((run) => (
                <button key={run.id} type="button" className="pta-row" onClick={() => void openTicketRun({ id: run.ticket_id, title: run.title })}>
                  <span className="pta-dot pta-dot--running" />
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

        {groups.failed.length > 0 && listFilter === 'all' ? (
          <section className="pta-section">
            <div className="pta-section__head"><h3>Failed runs, last 24h</h3><span className="pta-meta">These stop until someone looks.</span></div>
            <div className="pta-rows">
              {groups.failed.map((run) => (
                <button key={run.id} type="button" className="pta-row" onClick={() => void openTicketRun({ id: run.ticket_id, title: run.title })}>
                  <span className="pta-dot pta-dot--danger" />
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

        {decisions === 0 && groups.stalled.length === 0 && groups.stuck.length === 0 && groups.failed.length === 0 ? (
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
    const [filter, setFilter] = useState(() => {
      const preset = pendingInboxFilter;
      pendingInboxFilter = null;
      return preset ?? 'all';
    });
    const [query, setQuery] = useState('');
    const search = useRef(null);
    const root = useRef(null);
    useEffect(() => {
      const onPreset = (event) => { pendingInboxFilter = null; setFilter(event.detail?.filter ?? 'all'); };
      // "/" jumps to search from anywhere on the page; Escape clears it. The
      // same listener runs the row keys (j/k, arrows, Home/End), so this page
      // has exactly one page-wide key handler.
      const onKey = (event) => {
        if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const target = event.target;
          const typing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
          if (!typing && search.current?.isConnected && search.current.offsetParent !== null) {
            event.preventDefault();
            search.current.focus();
            return;
          }
        }
        navigateRowFocus(root.current, event);
      };
      window.addEventListener('pta:inbox-filter', onPreset);
      window.addEventListener('keydown', onKey);
      return () => { window.removeEventListener('pta:inbox-filter', onPreset); window.removeEventListener('keydown', onKey); };
    }, []);
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
        <div className="pta-page" ref={root}>
          <header className="pta-head"><div><h1>Inbox</h1><p>Connect PTech Admin to the portal to see what is waiting.</p></div></header>
          <PortalSignIn onDone={() => void data.reload()} />
        </div>
      );
    }
    return (
      <div className="pta-page" ref={root}>
        <header className="pta-head">
          <div>
            <h1>Inbox</h1>
            <p>Approvals, reviews and client replies in one place. The same items notify you as they arrive.</p>
          </div>
          <div className="pta-head__actions">
            <input
              ref={search}
              className="pta-search"
              value={query}
              placeholder="Search tickets, clients, projects…  /"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); event.currentTarget.blur(); } }}
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
        <p className="pta-meta pta-hint">j/k to move · Enter to open · / to search</p>
        {shown.length === 0 ? (
          <EmptyState title={all.length === 0 ? 'Inbox zero' : 'Nothing in this filter'} text={all.length === 0 ? 'New approvals, reviews and client replies will land here and notify you.' : 'Try another filter, or clear the search.'} />
        ) : (
          <div className="pta-rows pta-rows--inbox">
            {shown.map(({ ticket, kinds }) => (
              <TicketLine
                key={ticket.id}
                ticket={ticket}
                tag={kinds.has('stalled') ? 'stuck' : ''}
                actions={<TicketRowActions ticket={ticket} />}
                detail={isWaiting(ticket) ? 'waiting' : ''}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  /**
   * The Marketing and SEO desks are the shared workbench views, but they are
   * first-class main pages here. Their contract is tiny: `api`, `act`,
   * `notify` and (for SEO) `openTicket`, so a local provider is enough; no
   * activity bar, tabs or explorer around them.
   */
  function DeskPage({ children }) {
    const [toast, setToast] = useState(null);
    const timer = useRef(null);
    const notify = useCallback((text, kind = 'ok') => {
      clearTimeout(timer.current);
      setToast({ text: String(text ?? ''), kind });
      timer.current = setTimeout(() => setToast(null), kind === 'error' ? 8000 : 4000);
    }, []);
    useEffect(() => () => clearTimeout(timer.current), []);
    const act = useCallback(async (fn, done) => {
      try {
        const out = await fn();
        if (done !== undefined) notify(typeof done === 'function' ? done(out) : done);
        return out;
      } catch (error) {
        notify(error?.message ?? String(error), 'error');
        throw error;
      }
    }, [notify]);
    const context = useMemo(() => ({
      api,
      act,
      notify,
      openTicket: (id) => void openTicketRun({ id }),
      platform: 'dsh',
      host,
      files,
    }), [api, act, notify, host]);
    return (
      <div
        className="aw pta-desk"
        style={{ gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)', height: '100%', minHeight: 0 }}
      >
        <style>{STYLES}</style>
        <div className="aw-content" style={{ overflow: 'auto', height: '100%' }}>
          <AdminContext.Provider value={context}>{children}</AdminContext.Provider>
        </div>
        {toast ? (
          <div className={`aw-toast${toast.kind === 'error' ? ' is-error' : ''}`} role="status">
            {toast.text}
          </div>
        ) : null}
      </div>
    );
  }

  function MarketingPage() {
    return <DeskPage><MarketingView /></DeskPage>;
  }

  function SeoPage() {
    return <DeskPage><SeoView /></DeskPage>;
  }

  /**
   * The workspace chip is metadata, not a failure report: a ticket that never
   * had a local checkout says so quietly ("no local checkout", neutral dot).
   * Red is reserved for a checkout that is actually missing or blocked.
   */
  const WORKSPACE_TEXT = {
    ready: 'Workspace ready.',
    missing: 'Workspace is missing. Restore it from the saved commit.',
    conflict: 'Restore is blocked by an existing checkout or local changes. Preserve that work before retrying.',
    unavailable: 'This ticket has no local checkout on this machine. That is normal for a ticket that never needed one: nothing is broken and there is nothing to restore.',
    pending: 'Checking or restoring this session’s workspace…',
    unmanaged: 'This conversation has no local checkout on this machine. That is normal: nothing is broken and there is nothing to restore.',
  };

  const WORKSPACE_LABEL = {
    ready: 'Workspace ready',
    missing: 'Workspace missing',
    conflict: 'Restore blocked',
    unavailable: 'no local checkout',
    pending: 'Checking workspace…',
    unmanaged: 'no local checkout',
  };

  /** Host reason codes for `unavailable`, in words — the tooltip never shows one. */
  const WORKSPACE_REASON = {
    invalid_session: 'This conversation has no workspace identity.',
    session_not_found: 'This conversation is no longer open.',
    workspace_policy_unavailable: 'The workspace service is not available in this window.',
    source_unavailable: 'The workspace source could not be read.',
  };

  /** One inline chip in the dock row; the full explanation lives in its tooltip. */
  function TicketWorkspace({ sessionId }) {
    const [result, setResult] = useState({ state: 'pending' });
    const active = useRef(null);
    const request = useCallback(async (action) => {
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      setResult({ state: 'pending' });
      const next = await requestTicketWorkspace(sessionId, action, controller.signal);
      if (!controller.signal.aborted) setResult(next);
    }, [sessionId]);
    useEffect(() => {
      void request('status');
      return () => active.current?.abort();
    }, [request]);
    useEffect(() => {
      if (result.state !== 'pending') return;
      const refresh = () => void request('status');
      window.addEventListener('focus', refresh);
      return () => window.removeEventListener('focus', refresh);
    }, [result.state, request]);
    const restore = async () => {
      const ok = await confirmAsk({
        title: 'Restore this workspace?',
        text: 'It is rebuilt from its saved commit. Uncommitted edits are not recovered. This does not change the ticket or queue a Fleet run.',
        confirm: 'Restore',
        danger: true,
      });
      if (ok) void request('restore');
    };
    const detail = [WORKSPACE_TEXT[result.state], WORKSPACE_REASON[result.reason]].filter(Boolean).join(' ');
    const checkable = ['conflict', 'unavailable', 'pending', 'ready'].includes(result.state);
    return <span className="pta-dock__ws" data-state={result.state}>
      <button type="button" className="pta-dock__chip" title={checkable ? `${detail} Click to check again.` : detail}
        aria-label={detail} disabled={!checkable} onClick={() => void request('status')}>
        <span className="pta-dock__dot" aria-hidden="true" />
        <span role="status">{WORKSPACE_LABEL[result.state] ?? result.state}</span>
      </button>
      {result.state === 'missing' ? <PtaButton onClick={() => void restore()}>Restore</PtaButton> : null}
    </span>;
  }

  function TicketMessageForm({ mode, ticket }) {
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const internal = mode === 'note';
    const label = internal ? 'Add private note' : 'Reply by email';
    const submit = async (event) => {
      event.preventDefault();
      if (busy) return;
      setNotice('');
      setBusy(true);
      try {
        const confirmed = (message) => confirmAsk({ title: 'Email this reply?', text: message, confirm: 'Send reply' });
        if (await sendTicketMessage({ api: ticketCommandApi, ticket, mode, text, confirm: confirmed })) {
          setText('');
          setNotice(internal ? 'Private note saved.' : 'Email reply sent.');
          window.dispatchEvent(new CustomEvent('admin:changed', { detail: { kind: 'ticket.reply', ticketId: ticket.id } }));
        }
      } catch {
        setNotice(internal ? 'Could not save the private note.' : 'Could not send the email reply.');
      } finally { setBusy(false); }
    };
    return <form className="pta-dock__body pta-ticket-form" onSubmit={submit}>
      <textarea aria-label={label} autoFocus rows={2} value={text} onChange={event => setText(event.target.value)} disabled={busy}
        placeholder={internal ? 'Private to the team and future Fleet runs. Saving does not queue a run.' : `Emails ${ticket.client_email} after confirmation.`} />
      <div className="pta-ticket-form__row">
        <span className="pta-meta" role="status">{notice}</span>
        <PtaButton type="submit" disabled={busy || !text.trim()}>{internal ? 'Save private note' : 'Send email reply'}</PtaButton>
      </div>
    </form>;
  }

  /**
   * The ticket card above the composer: one row (status, id, title, workspace,
   * note/email toggles). A form opens below the row only when asked for.
   * Messages to the agent go through the native composer underneath.
   */
  function LinkedTicketDock({ sessionId, ticketId }) {
    const { detail, error } = useLinkedTicketDetail(ticketId, sessionId);
    const ticket = detail?.ticket;
    const [open, setOpen] = useState(null);
    const canReply = ticket && ticket.kind !== 'system' && ticket.client_email;
    const toggle = (mode, label) => <button type="button" className="pta-dock__link" aria-expanded={open === mode}
      onClick={() => setOpen(open === mode ? null : mode)}>{label}</button>;
    const title = error || (ticket ? ticketLabel(ticket) : 'Loading linked ticket…');
    return <section className="pta-dock" aria-label={`Ticket #${ticketId}`}
      title="Type below to message the agent. That does not email the client or save a private note.">
      <div className="pta-dock__head pta-dock__row">
        {ticket ? <StatusPill status={ticket.status} /> : null}
        <span className="pta-dock__id">#{ticketId}</span>
        <span className="pta-dock__title" title={title}>{title}</span>
        {desktop ? <TicketWorkspace sessionId={sessionId} /> : null}
        {ticket ? <span className="pta-dock__actions">
          {toggle('note', 'Add private note')}
          {canReply ? toggle('reply', 'Reply by email') : null}
        </span> : null}
      </div>
      {ticket && open === 'note' ? <TicketMessageForm key="note" mode="note" ticket={ticket} /> : null}
      {canReply && open === 'reply' ? <TicketMessageForm key="reply" mode="reply" ticket={ticket} /> : null}
    </section>;
  }

  /**
   * True while this session shows its Chat view. Chat is always the strip's
   * first tab; with no tab strip there is only Chat. Read from the session's
   * own tab strip so another open session cannot answer for this one.
   */
  function useChatViewActive(anchor, ready) {
    const [active, setActive] = useState(true);
    useEffect(() => {
      let scope = anchor.current?.parentElement ?? null;
      while (scope && !scope.querySelector('[data-conversation-tabs]')) scope = scope.parentElement;
      if (!scope) return undefined;
      const read = () => {
        const strip = scope.querySelector('[data-conversation-tabs]');
        setActive(!strip || strip.firstElementChild?.getAttribute('aria-selected') === 'true');
      };
      read();
      const observer = new MutationObserver(read);
      observer.observe(scope, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected'] });
      return () => observer.disconnect();
    }, [anchor, ready]);
    return active;
  }

  /** The ticket card belongs to Chat; Task and History already show the ticket. */
  function TicketDock({ sessionId }) {
    const run = ticketFromCwd(useSessionCwd(sessionId));
    const anchor = useRef(null);
    const chat = useChatViewActive(anchor, Boolean(run && sessionId));
    if (!run || !sessionId) return null;
    return <div ref={anchor} className="pta-dock-anchor">
      {chat ? <LinkedTicketDock key={`${run.ticketId}:${sessionId}`} ticketId={run.ticketId} sessionId={sessionId} /> : null}
    </div>;
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
    if (route === 'seo') {
      handledDeepLink = true;
      ctx.layout?.selectPanel?.(SEO_PANEL);
      return true;
    }
    if (route === 'marketing') {
      handledDeepLink = true;
      ctx.layout?.selectPanel?.(MARKETING_PANEL);
      return true;
    }
    if (route === 'health') {
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
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: MARKETING_PANEL, locale: NAMESPACE }, MarketingPage));
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: SEO_PANEL, locale: NAMESPACE }, SeoPage));
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: WORKBENCH_PANEL, locale: NAMESPACE }, AdminPage));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: HOME_PANEL, order: 11, label: 'Needs you' }, AdminEntryIcon));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: INBOX_PANEL, order: 12, label: 'Inbox' }, InboxEntryIcon));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: MARKETING_PANEL, order: 13, label: 'Marketing' }, MarketingEntryIcon));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: SEO_PANEL, order: 14, label: 'SEO' }, SeoEntryIcon));
  ctx.inject(['conversation'], (scope) => {
    nativeConversation = scope.conversation;
    scope.effect(() => () => { nativeConversation = null; }, 'admin: native view selection');
    // Older shells do not understand visibility. Do not register global tabs on them.
    if (!nativeConversation?.selectView) return;
    scope.slots.inject('conversation.view', function* () {
      const visible = (row) => Boolean(ticketForSession(row));
      yield scope.slots.register({ name: 'conversation.view', id: 'admin-task', order: 20, label: 'Task', visible }, NativeTask);
      yield scope.slots.register({ name: 'conversation.view', id: 'admin-history', order: 21, label: 'History', visible }, NativeHistory);
    });
  });
  ctx.slots.inject('conversation.chat.activity-frame', () =>
    ctx.slots.register({ name: 'conversation.chat.activity-frame', id: 'admin-ticket-activity' }, TicketActivityFrame));
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
  // The in-app confirm: one dialog for every ask that emails a client or
  // restores a workspace, instead of the browser's `window.confirm`.
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'admin-confirm', order: 45 }, ConfirmHost));
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
  ctx.slots.inject('conversation.view', () =>
    ctx.slots.register({ name: 'conversation.view', id: 'admin-git-graph', order: 22, label: 'Git Graph' }, ConversationGitGraph));
  // Goes over the route when the Host has it; only an older Host makes this
  // (and the bridge lookup behind it) a session command.
  void command(`hello ${CLIENT_VERSION}`).catch(() => undefined);
  // The renderer owns native banners when it can; the Host's osascript
  // fallback only runs on a Harness without the desktop bridge.
  void command(`native-notify ${desktopNotifications ? 'on' : 'off'}`).catch(() => undefined);
}

export default { name: PANEL_ID, inject, apply };
