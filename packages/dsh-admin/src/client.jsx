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
import { createTicketDetailReader, ticketActivity, sendTicketMessage, requestTicketWorkspace, migrateTicketView, adminOperation, startTicketThread } from './ticket-chat.mjs';
import { startSuperagent } from '../superagent-start.mjs';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ClientPage, ProjectPage, TicketPage } from '../../admin-ui/src/index.js';
import { TaskModal, ProjectModal } from '../../admin-ui/src/app.jsx';
import { openLocalProject } from '../native-project.mjs';
import { sidebarTicketLabel, sidebarRunShortcut } from './sidebar-presentation.mjs';
import { createConversationMeter, formatRecordedTime } from './conversation-meter.mjs';
import { AdminContext, useAdminData } from '../../admin-ui/src/store.js';
import { ConversationGitGraph } from './conversation-git-graph.mjs';
import { BoardView, ListView } from '../../admin-ui/src/board.jsx';
import { ClientsView, FleetView, SettingsView } from '../../admin-ui/src/fleet.jsx';
import { SuperagentView } from '../../admin-ui/src/superagent.jsx';
import { isSettingsKey, openSettings, settingsSection } from '../../admin-ui/src/settings-link.js';
import { MarketingView } from '../../admin-ui/src/marketing.jsx';
import { SeoView } from '../../admin-ui/src/seo.jsx';
import { Confirm, Icon, Segmented, Skeleton } from '../../admin-ui/src/ui.jsx';
import { Inspector, MetaChip, StateIndicator, UiStyles, resolveState } from '../../admin-ui/src/ui/index.js';
import { STYLES } from '../../admin-ui/src/styles.js';
import { assistantBadge, assistantBadgeTitle } from '../../admin-ui/src/ticket-assistant.mjs';
import { STATUS_LABEL, needsYou } from '../../admin-ui/src/format.js';
import { panelTransport } from './panel-transport.mjs';
import { ConversationHistory } from './conversation-history.jsx';
import { nextRowIndex } from './row-navigation.mjs';

/** Panel identity: one id addresses both the sidebar row and the main page. */
const PANEL_ID = 'admin';
const NAMESPACE = 'admin';
/** Reported to the Host on activation, so "did the panel load?" has an answer. */
const CLIENT_VERSION = '3.9.0';
/** The conversation the Superagent panel started, so it can be continued. */
const SUPERAGENT_SESSION = 'pta.superagent.session';
/** Every superagent conversation is titled with this prefix, so the panel can list its own. */
const SUPERAGENT_TITLE = 'Superagent · ';
/**
 * The permission preset a superagent conversation runs under. It has to ask
 * before a write: under the profile's `danger-full-access` default the Host
 * answers every approval with "rejected" and the admin write gate blocks the
 * agent entirely. A host without this preset keeps its own and the gate stays
 * closed on writes, which is the safe half of the same choice.
 */
const SUPERAGENT_PRESET = 'workspace-write';
const DICTIONARY = { title: 'Admin' };

/**
 * The one ticket-status tint map: the task desk, the client tree and the
 * native pages all read it, so a status has one colour in the whole plugin.
 * The words are `STATUS_LABEL` from `packages/admin-ui`.
 */
const STATUS_TINT = {
  stalled: 'var(--dsw-alias-state-danger-primary, #e5534b)',
  new: 'var(--dsw-alias-state-warning-primary, #d18f2e)',
  review: 'var(--dsw-alias-state-warning-primary, #d18f2e)',
  running: 'var(--dsw-alias-state-business-primary, #4c8dff)',
  in_progress: 'var(--dsw-alias-state-business-primary, #4c8dff)',
  approved: 'var(--dsw-alias-state-business-primary, #4c8dff)',
  done: 'var(--dsw-alias-state-success-primary, #2f9e5b)',
  ok: 'var(--dsw-alias-state-success-primary, #2f9e5b)',
  declined: 'var(--dsw-alias-label-tertiary, #8a9099)',
};
const tintOfStatus = (status) => STATUS_TINT[status] ?? STATUS_TINT.declined;

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

const inject = ['slots', 'sessions', 'layout', 'remote', 'remote.commands', 'sidebarRightTabs', 'sidebarRight', 'remote.directoryPicker'];

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
  // The shell's directory picker, reached through the remote namespace the
  // workspace picker uses; it is absent in hosts that cannot open one.
  const folderPicker = () => {
    try { return ctx.remote?.directoryPicker ?? null; } catch { return null; }
  };
  /** The panel's own conversations, newest first, from the session catalog. */
  const superagentRows = () => {
    const snapshot = ctx.sessions?.list?.getSnapshot?.();
    if (!snapshot?.byId) return [];
    return Object.values(snapshot.byId)
      .filter((row) => typeof row.title === 'string' && row.title.startsWith(SUPERAGENT_TITLE))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((row) => ({ id: String(row.id), title: row.title, updatedAt: row.updatedAt, running: Boolean(row.running) }));
  };
  const host = {
    version: typeof __PTECH_ADMIN_VERSION__ === 'undefined' ? undefined : __PTECH_ADMIN_VERSION__,
    canPickDirectory: Boolean(folderPicker()?.pick),
    pickDirectory: async () => {
      const picker = folderPicker();
      if (typeof picker?.pick !== 'function') throw new Error('No native folder picker is available in this host.');
      return picker.pick();
    },
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
    /**
     * The superagent is a Harness session, not a second chat: the Host registers
     * the admin tools, so the panel starts a conversation with the admin brief
     * and hands it to the main view. `start` resolves the conversation id.
     */
    superagent: {
      last: () => {
        try { return globalThis.localStorage?.getItem(SUPERAGENT_SESSION) || null; } catch { return null; }
      },
      /** The conversations this panel started, newest first, from the session catalog. */
      recent: () => superagentRows().slice(0, 5),
      /** How many there are in all, so the list can say it is showing the newest. */
      recentTotal: () => superagentRows().length,
      open: (sessionId) => {
        if (typeof workspace?.openSession !== 'function') throw new Error('This Harness cannot open a conversation from a plugin.');
        workspace.openSession(sessionId);
      },
      start: async ({ brief, title }) => {
        // The Host owns the folder (it creates it); a host without the command
        // keeps its default cwd and the conversation still starts.
        const cwd = await json('superagent-cwd').then((value) => value?.cwd ?? null).catch(() => null);
        return startSuperagent({
          sessions: ctx.sessions,
          brief,
          title,
          preset: SUPERAGENT_PRESET,
          cwd,
          open: (sessionId) => {
            if (typeof workspace?.openSession === 'function') workspace.openSession(sessionId);
          },
          remember: (sessionId) => {
            try { globalThis.localStorage?.setItem(SUPERAGENT_SESSION, String(sessionId)); } catch { /* ignore */ }
          },
        });
      },
    },
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
    // A ticket's own chat folder (a client's agent works it; no local run did).
    if (typeof cwd === 'string' && cwd.includes('/.dsh-admin/tickets/')) {
      const thread = RUN_DIR_RE.exec(cwd.replace(/\/+$/, '').split('/').pop() ?? '');
      return thread && thread[2] === 'ticket' && !thread[4]
        ? { slug: thread[1], kind: 'ticket', ticketId: Number(thread[3]), runId: null, cwd, thread: true }
        : null;
    }
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
    return (
      <div className="pta-native-task">
        <TicketPage key={`${sessionId}:${ticket.ticketId}`} api={api} host={host} files={files} ticketId={ticket.ticketId} autoMeter={false} chrome={false} />
      </div>
    );
  }

  function NativeHistory({ sessionId }) {
    const ticket = ticketFromCwd(useSessionCwd(sessionId));
    if (!ticket) return null;
    return (
      <div className="pta-native-history">
        <ConversationHistory key={`${sessionId}:${ticket.ticketId}`} api={api} ticketId={ticket.ticketId} openTicket={openTicketRun} />
      </div>
    );
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

  /** Native ticket pages, registered on demand for tickets without a session. */
  const ticketPages = new Map();
  function openTicket(run, selectPanel = (key) => ctx.layout?.selectPanel?.(key)) {
    const id = Number(run?.ticketId ?? run?.id ?? run);
    if (!Number.isInteger(id) || id <= 0) return;
    const key = `admin-ticket-${id}`;
    if (!ticketPages.has(id)) {
      ticketPages.set(
        id,
        ctx.slots.register({ name: 'main', key, locale: NAMESPACE }, () => (
          <TicketPage key={key} api={api} host={host} files={files} ticketId={id} />
        )),
      );
    }
    selectPanel(key);
  }
  ctx.effect(() => () => {
    for (const dispose of ticketPages.values()) dispose();
    ticketPages.clear();
  }, 'admin: ticket pages');

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
    running: 'var(--dsw-alias-state-business-primary, #4c8dff)',
    ok: 'var(--dsw-alias-state-success-primary, #2f9e5b)',
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
  /** Where Command-K can go, independent of the current panel. */
  const PALETTE_DESTINATIONS = [
    { id: 'admin', label: 'Inbox', hint: 'tickets that want a decision' },
    { id: 'admin-superagent', label: 'Superagent', hint: 'ask the system, confirm changes' },
    { id: 'admin-work', label: 'Work', hint: 'list and board of all work' },
    { id: 'admin-marketing', label: 'Marketing', hint: 'contacts, email, social' },
    { id: 'admin-seo', label: 'SEO', hint: 'audit, rankings, citations' },
    { id: 'admin-clients', label: 'Clients', hint: 'people, projects, invites' },
    { id: 'admin-fleet', label: 'Fleet', hint: 'nodes, queue, runs' },
    { id: 'admin-settings', label: 'Settings', hint: 'queue, portal, marketing, SEO' },
    { id: 'projects', label: 'Projects', hint: 'the workspace projects' },
    { id: 'plugins', label: 'Plugins', hint: 'installed Harness plugins' },
  ];

  /**
   * Command-K: destinations and the sessions the old sidebar search found,
   * in one palette. It replaces the core binding; nothing is lost because
   * session titles are still matched by the same query.
   */
  function CommandPaletteHost() {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const [sessions, setSessions] = useState([]);
    const input = useRef(null);

    useEffect(() => {
      const onKey = (event) => {
        const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
        if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && key === 'k') {
          event.preventDefault();
          event.stopImmediatePropagation();
          setQuery('');
          setActive(0);
          setOpen((value) => !value);
          return;
        }
        if (event.key === 'Escape') setOpen(false);
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, []);

    useEffect(() => {
      if (!open) return undefined;
      try {
        const snapshot = ctx.sessions?.list?.getSnapshot?.();
        const rows = snapshot?.byId ? Object.values(snapshot.byId) : [];
        setSessions(rows.filter((row) => row?.id));
      } catch { setSessions([]); }
      const timer = setTimeout(() => input.current?.focus(), 0);
      return () => clearTimeout(timer);
    }, [open]);

    const needle = query.trim().toLowerCase();
    const destinations = PALETTE_DESTINATIONS.filter((item) => !needle || `${item.label} ${item.hint}`.toLowerCase().includes(needle));
    const found = sessions.filter((row) => {
      if (!needle) return false;
      const title = String(row.title ?? row.name ?? '').toLowerCase();
      const cwd = String(row.cwd ?? '').toLowerCase();
      return title.includes(needle) || cwd.includes(needle);
    }).slice(0, 8);
    const items = [
      ...destinations.map((item) => ({ kind: 'go', ...item })),
      ...found.map((row) => ({ kind: 'session', id: row.id, label: row.title || row.id, hint: row.cwd || 'session' })),
    ];
    const chosen = Math.min(active, Math.max(0, items.length - 1));

    const run = (item) => {
      if (!item) return;
      setOpen(false);
      if (item.kind === 'go') { ctx.layout?.selectPanel?.(item.id); return; }
      const ws = workspace;
      if (typeof ws?.openSession === 'function') void ws.openSession(item.id).catch(() => undefined);
    };

    if (!open) return null;
    return (
      <div className="pta-palette__scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <div className="pta-palette" role="dialog" aria-modal="true" aria-label="Command palette">
          <input
            ref={input}
            className="pta-palette__input"
            value={query}
            placeholder="Go to a panel, or search sessions…"
            aria-label="Command palette search"
            onChange={(event) => { setQuery(event.target.value); setActive(0); }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive((value) => Math.min(value + 1, items.length - 1)); }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
              else if (event.key === 'Enter') { event.preventDefault(); run(items[chosen]); }
              else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
            }}
          />
          <div className="pta-palette__list">
            {items.length === 0 ? <p className="pta-palette__empty">Nothing matches “{query}”.</p> : items.map((item, index) => (
              <button
                type="button"
                key={`${item.kind}-${item.id}`}
                className={`pta-palette__row${index === chosen ? ' pta-palette__row--active' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => run(item)}
              >
                <span className="pta-palette__label">{item.label}</span>
                <span className="pta-palette__hint">{item.kind === 'session' ? 'Session · ' : ''}{item.hint}</span>
              </button>
            ))}
          </div>
          <footer className="pta-palette__foot"><span>↑↓ move</span><span>↵ open</span><span>esc close</span><span className="pta-palette__fill" /><span>⌘K</span></footer>
        </div>
      </div>
    );
  }

  /** A tiny relative clock for the runs dock. */
  function dockAge(value) {
    const raw = typeof value === 'number' ? value : Number(value);
    const stamp = Number.isFinite(raw) && raw > 0 && raw < 1e12 ? raw * 1000 : new Date(value).getTime();
    const ms = Date.now() - stamp;
    if (!Number.isFinite(ms)) return '';
    const minutes = Math.max(0, Math.floor(ms / 60000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
  }

  /**
   * The Agent Dock: every live run across the fleet, from any panel.
   * Command-J toggles it; Escape closes it. It polls only while open.
   */
  function RunsDockHost() {
    const [open, setOpen] = useState(false);
    const [runs, setRuns] = useState({ running: [], recent: [] });
    const [busy, setBusy] = useState(0);

    useEffect(() => {
      const onKey = (event) => {
        const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
        if ((event.metaKey || event.ctrlKey) && !event.shiftKey && key === 'j') {
          const target = event.target;
          if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]') !== null) return;
          event.preventDefault();
          setOpen((value) => !value);
          return;
        }
        if (event.key === 'Escape') setOpen(false);
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, []);

    useEffect(() => {
      if (!open) return undefined;
      let cancelled = false;
      const load = () => {
        api('GET', '/admin/runs').then((data) => {
          if (cancelled) return;
          setRuns({
            running: Array.isArray(data?.running) ? data.running : [],
            recent: Array.isArray(data?.recent) ? data.recent : [],
          });
        }).catch(() => undefined);
      };
      load();
      const timer = setInterval(load, 5000);
      return () => { cancelled = true; clearInterval(timer); };
    }, [open]);

    if (!open) return null;
    const stop = (run) => {
      setBusy(run.id);
      api('POST', `/admin/runs/${run.id}/cancel`).catch(() => undefined).finally(() => {
        setBusy(0);
        api('GET', '/admin/runs').then((data) => setRuns({
          running: Array.isArray(data?.running) ? data.running : [],
          recent: Array.isArray(data?.recent) ? data.recent : [],
        })).catch(() => undefined);
      });
    };

    return (
      <div className="pta-agentdock" role="dialog" aria-label="Live runs">
        <header className="pta-agentdock__head">
          <strong>Runs</strong>
          <span className="pta-agentdock__meta">{runs.running.length ? `${runs.running.length} live` : 'nothing live'}</span>
          <span className="pta-agentdock__fill" />
          <span className="pta-agentdock__hint">⌘J</span>
          <button type="button" className="pta-agentdock__close" aria-label="Close runs" onClick={() => setOpen(false)}>×</button>
        </header>
        <div className="pta-agentdock__list">
          {runs.running.length ? runs.running.map((run) => (
            <div className="pta-agentdock__row" key={run.id}>
              <span className="pta-agentdock__dot pta-agentdock__dot--live" aria-hidden="true" />
              <button type="button" className="pta-agentdock__title" onClick={() => { setOpen(false); void openTicketRun({ id: run.ticket_id ?? run.ticketId ?? run.id }); }}>
                {run.title || `Run #${run.id}`}
              </button>
              <span className="pta-agentdock__detail">#{run.id}{run.node ? ` · ${run.node}` : ''}{run.executor ? ` · ${run.executor}` : ''}</span>
              <span className="pta-agentdock__age">{dockAge(run.started_at)}</span>
              <button type="button" className="pta-agentdock__stop" disabled={busy === run.id} onClick={() => stop(run)}>
                {busy === run.id ? 'Stopping…' : 'Stop'}
              </button>
            </div>
          )) : <p className="pta-agentdock__empty">No run is live. Open one from Inbox, or press ⌘J to close.</p>}
          {runs.recent.length ? <p className="pta-agentdock__label">Recent</p> : null}
          {runs.recent.slice(0, 4).map((run) => (
            <div className="pta-agentdock__row pta-agentdock__row--quiet" key={`recent-${run.id}`}>
              <span className={`pta-agentdock__dot pta-agentdock__dot--${run.result === 'failed' ? 'bad' : run.result === 'passed' ? 'done' : 'idle'}`} aria-hidden="true" />
              <button type="button" className="pta-agentdock__title" onClick={() => { setOpen(false); void openTicketRun({ id: run.ticket_id ?? run.ticketId ?? run.id }); }}>
                {run.title || `Run #${run.id}`}
              </button>
              <span className="pta-agentdock__detail">#{run.id}{run.node ? ` · ${run.node}` : ''}</span>
              <span className="pta-agentdock__age">{dockAge(run.finished_at || run.started_at)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

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
              void openTicketRun({ id: item.ticketId });
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

  /** The Inbox's own glyph: a tray, with a right-aligned tabular count. */
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

  function WorkEntryIcon(props) {
    return <AdminIcon size={props?.size ?? 16} />;
  }

  function SuperagentEntryIcon(props) {
    return <Icon name="spark" size={props?.size ?? 16} />;
  }

  function MarketingEntryIcon(props) {
    return <MarketingGlyph size={props?.size ?? 16} />;
  }

  function SeoEntryIcon(props) {
    return <SeoGlyph size={props?.size ?? 16} />;
  }

  function ClientsEntryIcon(props) {
    return <Icon name="clients" size={props?.size ?? 16} />;
  }

  function FleetEntryIcon(props) {
    return <Icon name="fleet" size={props?.size ?? 16} />;
  }

  function SettingsEntryIcon(props) {
    return <Icon name="settings" size={props?.size ?? 16} />;
  }

  function InboxEntryIcon(props) {
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
    return (
      <span className="pta-sidebar-inbox" title={parts.length ? parts.join(' · ') : 'Inbox'}>
        <InboxIcon size={props?.size ?? 16} />
        {waiting > 0 ? <span className="pta-sidebar-count">{waiting > 99 ? '99+' : waiting}</span> : null}
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
  const CLIENT_ROWS_ORDER = 20;
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
    if (await openTicketThread(ticket)) return;
    openTicket({ ticketId: ticket.id });
  }

  /**
   * No local run opened this ticket (a client's own agent works it): open it
   * in the real chat view anyway, as a session in the ticket's own folder.
   * The folder is a history-only clone of the project, so Git Graph has the
   * remote's branches; the composer stays locked until the repo is pulled.
   * @returns true when the conversation opened.
   */
  async function openTicketThread(ticket) {
    const ws = workspace;
    if (!desktop || typeof ws?.openSession !== 'function' || typeof ctx.sessions?.create !== 'function') return false;
    try {
      const out = await adminOperation({ operation: 'ticket-thread', ticketId: ticket.id });
      if (!out?.dir) return false;
      const rows = Object.values(ctx.sessions?.list?.getSnapshot?.()?.byId ?? {});
      const existing = rows.find((row) => typeof row?.cwd === 'string' && row.cwd.replace(/\/+$/, '') === out.dir);
      const sessionId = existing && !existing.blank ? existing.id : await startTicketThread({
        sessions: ctx.sessions,
        sessionId: existing?.id ?? null,
        cwd: out.dir,
        title: `Ticket #${ticket.id} — ${out.title || ticket.title || ''}`.trim(),
        ticketId: ticket.id,
      });
      // Group it under its ticket's workspace now, not on the next 30-second pass.
      await adminOperation({ operation: 'group-now' });
      if (typeof ctx.sessions?.refresh === 'function') await ctx.sessions.refresh().catch(() => undefined);
      if (archivedIds().includes(sessionId) && typeof ws.unarchiveSession === 'function') await ws.unarchiveSession(sessionId).catch(() => undefined);
      await ws.openSession(sessionId);
      nativeConversation?.selectView?.(sessionId, 'chat');
      return true;
    } catch (error) {
      console.warn(`admin: could not open the chat for ticket ${ticket.id}:`, error?.message ?? error);
      return false;
    }
  }

  /** Open a client's main page, registering it first if the poll has not run yet. */
  function openClientPage(client, selectPanel = (key) => ctx.layout?.selectPanel?.(key)) {
    if (!client?.id) return;
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
        { id: 'ticket', label: 'Open ticket page', onSelect: () => openTicket({ ticketId: ticket.id }) },
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
    const stalledBefore = Date.now() / 1000 - 45 * 60;
    if (open.some((ticket) => ticket.status === 'in_progress' && Number(ticket.updated_at ?? 0) < stalledBefore)) return tintOfStatus('stalled');
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

  function useLinkedTicketDetail(ticketId, sessionId, thread = false) {
    const key = ticketId && sessionId ? `${ticketId}:${sessionId}:${thread ? 't' : 'r'}` : null;
    const [state, setState] = useState(null);
    useEffect(() => {
      if (!key) return;
      const reader = createTicketDetailReader({ ticketId, sessionId, thread, api: ticketCommandApi, update: next => setState({ ...next, key }) });
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
    const { detail } = useLinkedTicketDetail(candidate?.ticketId, sessionId, Boolean(candidate?.thread));
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

  function TicketHeaderReadout({ sessionId, run, titled = false }) {
    const { ticketId } = run;
    const key = `${ticketId}:${sessionId}`;
    const root = useRef(null);
    const refresh = useRef(null);
    // Who filed the ticket, off the same detail read the meter takes.
    const [assistantApp, setAssistantApp] = useState(null);
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
          if (alive) setAssistantApp(typeof detail?.ticket?.assistant_app === 'string' ? detail.ticket.assistant_app : null);
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
    return (
      <span ref={root} className="pta-chat-ticket" title={hint}>
        <span className={`pta-chat-ticket__id${titled ? ' pta-sr' : ''}`}>{run.kind === 'task' ? 'Task' : 'Ticket'} #{ticketId}</span>
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
    // The session title usually starts "Ticket #27 —"; then the id would only repeat it.
    const titled = new RegExp(`#${run.ticketId}\\b`).test(String(key ?? '').split(SEP)[1] ?? '');
    return <TicketHeaderReadout key={`${run.ticketId}:${sessionId}`} sessionId={sessionId} run={run} titled={titled} />;
  }

  // Downloads go through the Host (it holds the token and the disk). Uploads
  // need the bytes, which the bridge cannot carry: /admin attach takes paths.
  const files = { download: (path) => json(`download ${path}`) };

  /* ————— PTech Admin: the native surfaces ————— */

  /**
   * The native admin experience: one Inbox home, native Work/Fleet/Settings
   * and Marketing/SEO desks, and a ticket strip that lives in the run's own chat.
   */

  const NATIVE_STYLES = `

    /* One scroller for the sidebar: navigation and workspaces flow together in
       the same scrollport instead of nesting a second scroll area. */
    [data-sidebar-scrollport]{grid-template-rows:8px max-content 2px max-content!important;overflow-y:auto!important}
    div:has(> [data-sidebar-scrollport]){container-type:normal!important}
    [data-sidebar-scrollport] > div:last-child{container-type:normal!important;min-height:0!important;overflow:visible!important}
    [data-sidebar-scrollport] > div:last-child > *{min-height:0!important;max-height:none!important;height:auto!important;overflow:visible!important}
    .pta-sidebar-inbox{display:inline-flex;align-items:center;justify-content:center}
    .pta-sidebar-count{display:none}
    [class*="_panelEntryWide"] .pta-sidebar-count{display:inline-block;position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:11px;font-weight:500;font-variant-numeric:tabular-nums;line-height:1;color:var(--dsw-alias-label-tertiary,#8a9099);pointer-events:none;transition:opacity 120ms ease}
    [class*="_panelEntryWide"]:hover:has([class*="_panelUnpin"]) .pta-sidebar-count,[class*="_panelEntryWide"]:has(:focus-visible):has([class*="_panelUnpin"]) .pta-sidebar-count{opacity:0}
    .pta-work{display:flex;flex-direction:column;height:100%;min-height:0}
    .pta-work__bar{display:flex;align-items:center;gap:8px;padding:14px 20px 0;flex:none}
    .pta-work>.aw-view{flex:1 1 auto;min-height:0;padding-top:10px}
    .pta-work>.aw-view--board{height:auto}
    .pta-ticket-form{display:grid;gap:6px;max-width:40rem}
    .pta-ticket-form label{display:grid;gap:4px}
    .pta-ticket-form textarea{min-height:4rem;font:inherit;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-translucent,currentColor);border-radius:6px}
    .pta-ticket-form .pta-btn{justify-self:start}
    .pta-ticket-form__row{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .pta-dock .pta-ticket-form{max-width:none}
    .pta-dock .pta-ticket-form textarea{min-height:0;resize:vertical;padding:4px 6px}
    .pta-chat-ticket{display:inline-flex;align-items:center;flex-wrap:wrap;gap:3px 8px;min-width:0;max-width:100%;line-height:1.3;font-size:12px}
    .pta-chat-ticket__id,.pta-chat-ticket__time{white-space:nowrap}
    .pta-chat-ticket__status{color:var(--dsw-alias-label-secondary,currentColor);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pta-chat-ticket__time{font-variant-numeric:tabular-nums}
    .pta-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
    [class*="_titleCluster"]:has(.pta-chat-ticket) [class*="_crumbCurrent"]{max-width:min(460px,42vw)}
    .pta-chat-ticket .pta-chat-ticket__action{min-height:24px;padding:2px 7px}
    .pta-chat-ticket__action:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,currentColor);outline-offset:2px}
    .pta-chat-ticket__feedback{font-size:11px;max-width:100%;color:var(--dsw-alias-label-secondary,currentColor);overflow-wrap:anywhere}
    .pta-chat-ticket__feedback:empty{position:absolute;width:1px;height:1px;overflow:hidden}
    .pta-page{height:100%;overflow-y:auto;box-sizing:border-box;min-width:0;flex:1 1 auto;width:100%;padding:26px 30px 56px;max-width:1120px;margin:0 auto;color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:1.45}
    .pta-head{display:flex;align-items:flex-start;gap:18px;margin:0 0 18px}
    .pta-head h1{margin:0;font-size:24px;line-height:1.15;font-weight:650;letter-spacing:-0.02em}
    .pta-head p{margin:6px 0 0;font-size:13px;opacity:.65;max-width:620px}
    .pta-head__actions{display:flex;align-items:center;gap:8px;margin-left:auto;padding-top:2px}
    @media (hover:hover){.pta-row .pta-actions{opacity:0;pointer-events:none;transition:opacity 120ms ease}.pta-row:hover .pta-actions,.pta-row:focus-visible .pta-actions,.pta-row:focus-within .pta-actions{opacity:1;pointer-events:auto}}
    .pta-section{margin:0 0 22px}
    .pta-section__head{display:flex;align-items:baseline;gap:10px;padding:0 2px 7px}
    .pta-section__head h3{margin:0;font-size:13px;font-weight:600}
    .pta-count{display:inline-block;min-width:16px;margin-left:5px;padding:0 5px;border-radius:8px;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.16));font-size:10px;line-height:16px;text-align:center;vertical-align:1px}
    .pta-rows{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.22));border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-primary,transparent)}
    .pta-rows--inbox{max-width:none;container-type:inline-size;container-name:pta-inbox-list}
    .pta-row{position:relative;display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:8px 12px;border:0;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.14));background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
    .pta-row:last-child{border-bottom:0}
    .pta-row:hover{background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.07))}
    .pta-row[aria-selected="true"]{background:var(--ui-bg-selected,var(--dsw-alias-bg-secondary,rgba(127,127,127,.12)));box-shadow:inset 2px 0 0 var(--ui-accent,var(--dsw-alias-brand-primary,#ff5a1f))}
    .pta-row[aria-selected="true"]:hover{background:var(--ui-bg-selected,var(--dsw-alias-bg-secondary,rgba(127,127,127,.14)))}
    .pta-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#ff5a1f);outline-offset:-2px}
    .pta-row__state{flex:0 0 auto}
    .pta-row__chip{flex:0 0 auto;max-width:190px}
.pta-palette__scrim{position:fixed;inset:0;z-index:80;display:flex;justify-content:center;align-items:flex-start;padding-top:12vh;background:rgba(0,0,0,.38)}
    .pta-palette{width:min(560px,calc(100vw - 32px));max-height:60vh;display:flex;flex-direction:column;border:1px solid var(--ui-border,rgba(127,127,127,.24));border-radius:12px;background:#23252a;color:var(--dsw-alias-label-primary,inherit);box-shadow:0 24px 64px rgba(0,0,0,.5);overflow:hidden}
    .pta-palette__input{width:100%;box-sizing:border-box;border:0;border-bottom:1px solid var(--ui-border,rgba(127,127,127,.18));background:transparent;color:inherit;font:inherit;font-size:14px;padding:14px 16px;outline:none}
    .pta-palette__input::placeholder{color:inherit;opacity:.4}
    .pta-palette__list{overflow:auto;padding:4px 0}
    .pta-palette__row{display:flex;align-items:baseline;gap:12px;width:100%;box-sizing:border-box;border:0;background:transparent;color:inherit;font:inherit;text-align:left;padding:9px 16px;cursor:pointer}
    .pta-palette__row--active{background:rgba(255,255,255,.07);box-shadow:inset 2px 0 0 #ff5a1f}
    .pta-palette__label{flex:0 0 auto;font-weight:500;font-size:13px}
    .pta-palette__hint{flex:1;min-width:0;font-size:11.5px;opacity:.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pta-palette__empty{margin:0;padding:16px;font-size:12.5px;opacity:.6}
    .pta-palette__foot{display:flex;align-items:center;gap:12px;padding:7px 16px;border-top:1px solid var(--ui-border,rgba(127,127,127,.18));font-size:10.5px;opacity:.45;flex:none}
    .pta-palette__fill{flex:1}
    .pta-agentdock{position:fixed;right:18px;bottom:46px;z-index:70;width:400px;max-width:calc(100vw - 24px);max-height:52vh;display:flex;flex-direction:column;border:1px solid var(--ui-border,rgba(127,127,127,.24));border-radius:12px;background:var(--dsw-alias-bg-elevated,#23252a);color:var(--dsw-alias-label-primary,inherit);box-shadow:0 18px 48px rgba(0,0,0,.45);overflow:hidden;font-size:12.5px}
    .pta-agentdock__head{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--ui-border,rgba(127,127,127,.18));flex:none}
    .pta-agentdock__head strong{font-size:12px;letter-spacing:.04em;text-transform:uppercase;opacity:.75}
    .pta-agentdock__meta{font-size:11.5px;opacity:.55}
    .pta-agentdock__fill{flex:1}
    .pta-agentdock__hint{font-size:10.5px;opacity:.4;border:1px solid var(--ui-border,rgba(127,127,127,.24));border-radius:4px;padding:0 4px}
    .pta-agentdock__close{border:0;background:transparent;color:inherit;font-size:16px;line-height:1;opacity:.55;cursor:pointer;padding:0 2px}
    .pta-agentdock__list{overflow:auto;padding:2px 0 6px}
    .pta-agentdock__row{display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid var(--ui-border,rgba(127,127,127,.10));min-width:0}
    .pta-agentdock__row:last-child{border-bottom:0}
    .pta-agentdock__row--quiet{opacity:.72}
    .pta-agentdock__dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--ui-ink-3,#888)}
    .pta-agentdock__dot--live{background:var(--ui-info,#5b9cf5)}
    .pta-agentdock__dot--bad{background:var(--ui-bad,#e5484d)}
    .pta-agentdock__dot--done{background:var(--ui-done,#30a46c)}
    .pta-agentdock__title{flex:1 1 14ch;min-width:8ch;border:0;background:transparent;color:inherit;font:inherit;font-weight:500;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;padding:0}
    .pta-agentdock__title:hover{text-decoration:underline}
    .pta-agentdock__detail{flex:0 1 auto;min-width:0;font-size:11px;opacity:.55;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pta-agentdock__age{flex:none;font-size:11px;opacity:.55;font-variant-numeric:tabular-nums}
    .pta-agentdock__stop{flex:none;border:1px solid var(--ui-border,rgba(127,127,127,.28));border-radius:5px;background:transparent;color:inherit;font-size:11px;padding:1px 6px;cursor:pointer;opacity:.8}
    .pta-agentdock__stop:hover{opacity:1;border-color:var(--ui-accent,#ff5a1f)}
    .pta-agentdock__empty{margin:0;padding:14px 12px;font-size:12px;opacity:.6;line-height:1.5}
    .pta-agentdock__label{margin:8px 12px 2px;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;opacity:.4}
.pta-native-task,.pta-native-history{min-height:0;padding-bottom:calc(var(--dsh-composer-height, 96px) + 12px);box-sizing:border-box}
    .pta-native-task .aw-ticket,.pta-native-history > *{min-height:0}
    .pta-inbox{position:relative;display:flex;flex-direction:row;height:100%;min-height:0;min-width:0;width:100%;overflow:hidden;background:transparent;container-type:inline-size;container-name:pta-inbox}
    .pta-inbox__main{flex:1 1 auto;min-width:0;height:100%;overflow-y:auto}
    .pta-inbox__page{height:auto;overflow:visible}
    .pta-inbox__scrim{display:none}
    .pta-inbox__inspector{height:100%}
    .pta-insp{display:flex;flex-direction:column;gap:var(--ui-sp-4,16px)}
    .pta-insp__top{display:flex;flex-direction:column;gap:var(--ui-sp-2,8px)}
    .pta-insp__badges{display:flex;flex-wrap:wrap;align-items:center;gap:var(--ui-sp-2,8px)}
    .pta-insp__title{margin:0;font-size:var(--ui-fs-lg,15px);line-height:var(--ui-lh-tight,1.25);font-weight:600;color:var(--ui-ink,inherit);overflow-wrap:anywhere}
    .pta-insp__reason{margin:0;padding:var(--ui-sp-2,8px) var(--ui-sp-3,12px);border-radius:var(--ui-r-md,6px);background:color-mix(in srgb,var(--ui-warn,#d18f2e) 12%,transparent);color:var(--ui-warn,#d18f2e);font-size:var(--ui-fs-sm,12px);line-height:var(--ui-lh,1.45)}
    .pta-insp__actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--ui-sp-2,8px);padding-bottom:var(--ui-sp-4,16px);border-bottom:1px solid var(--ui-border,rgba(127,127,127,.2))}
    .pta-insp__actions .pta-btn{height:var(--ui-ctl-h,28px);padding:0 var(--ui-sp-3,12px);font-size:var(--ui-fs-md,13px);font-weight:500;border-radius:var(--ui-r-md,6px)}
    .pta-insp__meta{display:grid;grid-template-columns:84px minmax(0,1fr);gap:var(--ui-sp-2,8px) var(--ui-sp-3,12px);margin:0;font-size:var(--ui-fs-sm,12px);line-height:var(--ui-lh,1.45)}
    .pta-insp__meta dt{color:var(--ui-ink-3,rgba(127,127,127,.75));font-weight:500}
    .pta-insp__meta dd{margin:0;color:var(--ui-ink,inherit);min-width:0;overflow-wrap:anywhere}
    .pta-insp__chips{display:flex;flex-wrap:wrap;gap:var(--ui-sp-1,4px)}
    @container pta-inbox-list (max-width:600px){.pta-row__state{gap:0}.pta-row__state>span:last-child{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}.pta-row__chip{max-width:130px}}
    @container pta-inbox-list (max-width:440px){.pta-row__project{display:none}.pta-row__chip{max-width:96px}}
    @media (max-width:900px){.pta-inbox__scrim{display:block;position:absolute;inset:0;z-index:9;background:var(--ui-scrim,rgba(0,0,0,.32))}.pta-inbox .pta-inbox__inspector{position:absolute;top:0;right:0;bottom:0;z-index:10;width:min(380px,calc(100% - 24px));max-width:100%;border-top:0;border-left:1px solid var(--ui-border,rgba(127,127,127,.22));background:var(--ui-bg-subtle,var(--dsw-alias-bg-elevated,#23252a));box-shadow:var(--ui-shadow,0 12px 32px rgba(0,0,0,.32))}}
    @container pta-inbox (max-width:740px){.pta-inbox__scrim{display:block;position:absolute;inset:0;z-index:9;background:var(--ui-scrim,rgba(0,0,0,.32))}.pta-inbox .pta-inbox__inspector{position:absolute;top:0;right:0;bottom:0;z-index:10;width:min(380px,calc(100% - 24px));max-width:100%;border-top:0;border-left:1px solid var(--ui-border,rgba(127,127,127,.22));background:var(--ui-bg-subtle,var(--dsw-alias-bg-elevated,#23252a));box-shadow:var(--ui-shadow,0 12px 32px rgba(0,0,0,.32))}.pta-inbox .pta-inbox__inspector .ui-resize{display:none}}
    .pta-dot{flex:0 0 auto;width:7px;height:7px;border-radius:50%}
    .pta-id{flex:0 0 auto;font-variant-numeric:tabular-nums;font-size:11.5px;opacity:.6}
    .pta-title{flex:1 1 260px;min-width:16ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
    .pta-tag{flex:0 1 auto;padding:1px 5px;border-radius:4px;border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.3));font-size:10px;opacity:.8;max-width:130px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pta-tag--client{border-color:transparent;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.14));opacity:.75}
    .pta-meta{flex:0 0 auto;font-size:11px;opacity:.55;white-space:nowrap}
    .pta-hint{margin:6px 2px 10px;font-size:10.5px;opacity:.45}
    .pta-warn{flex:0 1 auto;min-width:0;max-width:150px;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:var(--dsw-alias-state-warning-primary,#d18f2e);white-space:nowrap}
    .pta-fill{flex:0 0 8px;min-width:8px}
    .pta-actions{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto;position:absolute;right:10px;top:50%;transform:translateY(-50%);padding:4px 6px 4px 22px;border-radius:6px;background:linear-gradient(90deg,transparent,var(--dsw-alias-bg-secondary,rgba(127,127,127,.12)) 20px)}
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
    .pta-dot--running{background:var(--dsw-alias-state-business-primary,#4c8dff)}
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
    .pta-dock__toggle{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 6px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:12px;cursor:pointer}
    .pta-dock__toggle:hover{color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
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
    .pta-dock__ws[data-state=unavailable] .pta-dock__dot{background:#f85149}
    .pta-dock__actions{display:inline-flex;gap:2px;flex:none}
    .pta-dock__thread{border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));padding:6px 8px 6px 10px;align-items:center}
    .pta-dock__thread-text{flex:1 1 auto;min-width:0;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary,inherit)}
    .pta-dock__pull{flex:none;height:26px;padding:0 12px;border:0;border-radius:999px;background:var(--dsw-alias-state-business-primary,#ff8a5c);color:var(--dsw-alias-label-on-primary,#0f1115);font:inherit;font-size:12px;font-weight:600;cursor:pointer}
    .pta-dock__pull:hover:not(:disabled){filter:brightness(1.08)}
    .pta-dock__pull:disabled{opacity:.55;cursor:default}
    .pta-dock__toggle[aria-expanded=true]{color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
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
    .pta-hist__item[data-status="in review"] .pta-hist__dot{background:var(--dsw-alias-state-warning-primary,#d18f2e)}
    .pta-hist__item[data-status="in progress"] .pta-hist__dot,.pta-hist__item[data-status=approved] .pta-hist__dot{background:var(--dsw-alias-state-business-primary,#4c8dff)}
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
  `;

  const CLIENT_VISIBLE_STATUSES = new Set(['approved', 'declined', 'done']);
  /** A deep link arrived before the initial-view timer: it owns the first screen. */
  let handledDeepLink = false;
  const HOME_PANEL = 'admin';
  const SUPERAGENT_PANEL = 'admin-superagent';
  const WORK_PANEL = 'admin-work';
  const MARKETING_PANEL = 'admin-marketing';
  const SEO_PANEL = 'admin-seo';
  const CLIENTS_PANEL = 'admin-clients';
  const FLEET_PANEL = 'admin-fleet';
  const SETTINGS_PANEL = 'admin-settings';

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

  /** Why a stalled row is flagged, with how long it has been quiet. */
  const stalledReason = (ticket) => `no report for ${ago(ticket.updated_at)}`;

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

  /** The moves a row offers, chosen by status rather than by page. Quiet by default. */
  function TicketRowActions({ ticket }) {
    if (ticket.status === 'new') {
      return (
        <>
          <PtaButton kind="default" onClick={() => void changeTicketStatus(ticket, 'approved')}>Approve</PtaButton>
          <PtaButton kind="ghost" onClick={() => void changeTicketStatus(ticket, 'declined')}>Decline</PtaButton>
        </>
      );
    }
    if (ticket.status === 'review') {
      return (
        <>
          <PtaButton kind="default" onClick={() => void changeTicketStatus(ticket, 'done')}>Mark done</PtaButton>
          <PtaButton kind="ghost" onClick={() => void changeTicketStatus(ticket, 'approved')}>Queue another run</PtaButton>
        </>
      );
    }
    if (isWaiting(ticket)) {
      return <PtaButton kind="ghost" onClick={() => void markTicketAnswered(ticket)}>No reply needed</PtaButton>;
    }
    if (ticket.status === 'in_progress') {
      return <PtaButton kind="ghost" onClick={() => void changeTicketStatus(ticket, 'approved')}>Queue another run</PtaButton>;
    }
    return null;
  }

  /**
   * Applicable Inspector actions for one Inbox ticket: always includes Open,
   * reuses the row action functions, and marks exactly one action as primary.
   */
  function inspectorActions(ticket, stalled) {
    const actions = [];
    if (ticket.status === 'new') {
      actions.push({ key: 'approve', label: 'Approve', primary: true, run: () => void changeTicketStatus(ticket, 'approved') });
      actions.push({ key: 'decline', label: 'Decline', kind: 'ghost', run: () => void changeTicketStatus(ticket, 'declined') });
      actions.push({ key: 'open', label: 'Open', kind: 'default', title: 'Open conversation or ticket (Enter)', run: () => void openTicketRun(ticket) });
      return actions;
    }
    if (ticket.status === 'review') {
      actions.push({ key: 'done', label: 'Mark done', primary: true, run: () => void changeTicketStatus(ticket, 'done') });
      actions.push({ key: 'requeue', label: 'Queue another run', kind: 'default', run: () => void changeTicketStatus(ticket, 'approved') });
      if (isWaiting(ticket)) {
        actions.push({ key: 'answered', label: 'No reply needed', kind: 'ghost', run: () => void markTicketAnswered(ticket) });
      }
      actions.push({ key: 'open', label: 'Open', kind: 'default', title: 'Open conversation or ticket (Enter)', run: () => void openTicketRun(ticket) });
      return actions;
    }
    if (stalled && ticket.status === 'in_progress') {
      actions.push({ key: 'requeue', label: 'Queue another run', primary: true, run: () => void changeTicketStatus(ticket, 'approved') });
      if (isWaiting(ticket)) {
        actions.push({ key: 'answered', label: 'No reply needed', kind: 'ghost', run: () => void markTicketAnswered(ticket) });
      }
      actions.push({ key: 'open', label: 'Open', kind: 'default', title: 'Open conversation or ticket (Enter)', run: () => void openTicketRun(ticket) });
      return actions;
    }
    actions.push({ key: 'open', label: 'Open', primary: true, title: 'Open conversation or ticket (Enter)', run: () => void openTicketRun(ticket) });
    if (isWaiting(ticket)) {
      actions.push({ key: 'answered', label: 'No reply needed', kind: 'default', run: () => void markTicketAnswered(ticket) });
    }
    if (ticket.status === 'in_progress') {
      actions.push({ key: 'requeue', label: 'Queue another run', kind: 'ghost', run: () => void changeTicketStatus(ticket, 'approved') });
    }
    return actions;
  }

  function InboxInspector({ entry, reason, onClose }) {
    const { ticket, kinds } = entry;
    const stalled = kinds.has('stalled');
    const waiting = isWaiting(ticket);
    const stateKey = stalled ? 'stalled' : ticket.status;
    const via = assistantBadge(ticket);
    const actions = inspectorActions(ticket, stalled);
    const updatedAt = ticket.updated_at ? new Date(Number(ticket.updated_at) * 1000).toLocaleString() : '';
    const waitingSince = waiting && ticket.client_waiting_since ? ago(ticket.client_waiting_since) : '';
    const ownerLabel = ticket.kind === 'system' ? 'Owner' : 'Client';
    const ownerValue = ticket.kind === 'system'
      ? 'My task'
      : (ticket.client_name && ticket.client_email
          ? `${ticket.client_name} (${ticket.client_email})`
          : (ticket.client_name || ticket.client_email || 'Client'));
    const kindLabels = [
      kinds.has('approval') && 'Needs approval',
      kinds.has('review') && 'Ready for review',
      kinds.has('reply') && 'Client reply',
      kinds.has('stalled') && 'Stalled',
      kinds.has('stuck') && 'Stuck in queue',
    ].filter(Boolean);

    return (
      <Inspector
        className="pta-inbox__inspector"
        title={`#${ticket.id}`}
        label={`Ticket #${ticket.id}`}
        storageKey="pta.inbox.inspector.width"
        defaultWidth={380}
        onClose={onClose}
      >
        <div className="pta-insp">
          <div className="pta-insp__top">
            <div className="pta-insp__badges">
              <StateIndicator state={stateKey} />
              {waiting ? <MetaChip>Client waiting</MetaChip> : null}
              {ticket.kind === 'system' ? <MetaChip>My task</MetaChip> : null}
              {via ? <MetaChip title={assistantBadgeTitle(ticket)}>{via}</MetaChip> : null}
            </div>
            <h3 className="pta-insp__title">{ticketLabel(ticket)}</h3>
            {reason ? <p className="pta-insp__reason" role="status">{reason}</p> : null}
          </div>

          <div className="pta-insp__actions">
            {actions.map((action) => (
              <PtaButton
                key={action.key}
                kind={action.primary ? 'primary' : (action.kind ?? 'default')}
                title={action.title}
                onClick={action.run}
              >
                {action.label}
              </PtaButton>
            ))}
          </div>

          <dl className="pta-insp__meta">
            <dt>Ticket</dt>
            <dd><MetaChip mono>#{ticket.id}</MetaChip></dd>
            <dt>Project</dt>
            <dd>{ticket.project_name || 'No project'}</dd>
            <dt>{ownerLabel}</dt>
            <dd>{ownerValue}</dd>
            <dt>Age</dt>
            <dd title={updatedAt || undefined}>{ago(ticket.updated_at)}</dd>
            {waitingSince ? (
              <>
                <dt>Waiting</dt>
                <dd>{waitingSince}</dd>
              </>
            ) : null}
            {kindLabels.length > 0 ? (
              <>
                <dt>Queue</dt>
                <dd className="pta-insp__chips">
                  {kindLabels.map((label) => <MetaChip key={label}>{label}</MetaChip>)}
                </dd>
              </>
            ) : null}
          </dl>
        </div>
      </Inspector>
    );
  }

  function PtaButton({ children, kind = 'default', className = '', ...rest }) {
    return (
      <button
        type="button"
        className={`pta-btn pta-btn--${kind}${className ? ` ${className}` : ''}`}
        data-primary={kind === 'primary' ? 'true' : undefined}
        {...rest}
      >
        {children}
      </button>
    );
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

  function TicketLine({
    ticket,
    actions = null,
    reason = '',
    detail = '',
    showAge = true,
    stalled = false,
    selected = false,
    onSelect = null,
    onOpen = null,
  }) {
    const open = () => (onOpen ? onOpen(ticket) : void openTicketRun(ticket));
    const select = () => (onSelect ? onSelect(ticket) : open());
    // Who filed it: a person in the portal, or the client's assistant over MCP.
    const via = assistantBadge(ticket);
    const stateKey = stalled ? 'stalled' : ticket.status;
    const stateLabel = resolveState(stateKey).label;
    const rowTitle = `${stateLabel} · #${ticket.id} ${ticketLabel(ticket)}`;
    return (
      <div
        className={`pta-row${selected ? ' is-selected' : ''}`}
        role="option"
        aria-selected={selected}
        data-ticket-id={ticket.id}
        tabIndex={0}
        title={rowTitle}
        onClick={select}
        onDoubleClick={open}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            open();
          } else if (event.key === ' ') {
            event.preventDefault();
            select();
          }
        }}
      >
        <StateIndicator state={stateKey} className="pta-row__state" title={stateLabel} />
        <span className="pta-id">#{ticket.id}</span>
        <span className="pta-title" title={ticketLabel(ticket)}>{ticketLabel(ticket)}</span>
        {ticket.kind === 'system'
          ? <MetaChip className="pta-row__chip">My task</MetaChip>
          : <MetaChip className="pta-row__chip" title={ticket.client_email ?? ''}>{ticket.client_email || 'client'}</MetaChip>}
        {via ? <MetaChip className="pta-row__chip" title={assistantBadgeTitle(ticket)}>{via}</MetaChip> : null}
        <span className="pta-meta pta-row__project">{ticket.project_name || 'no project'}</span>
        {reason ? <span className="pta-warn">{reason}</span> : null}
        <span className="pta-fill" />
        {detail ? <span className="pta-meta">{detail}</span> : null}
        {showAge ? <span className="pta-meta">{ago(ticket.updated_at)}</span> : null}
        {actions ? <span className="pta-actions" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>{actions}</span> : null}
      </div>
    );
  }

  /**
   * j/k, the arrows, Home and End move focus between the ticket rows of one
   * page. The rows are queried from that page's own root element, so a
   * mounted-but-hidden page never moves focus for the page the user is looking
   * at. Rows are plain `.pta-row` elements, which covers the divs on Inbox and
   * the run buttons on Tasks alike.
   */
  function navigateRowFocus(root, event, { currentIndex = null, onMove = null } = {}) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return false;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return false;
    if (target instanceof Element && target.closest('[role="separator"], .pta-confirm')) return false;
    if (document.querySelector('.pta-confirm')) return false;
    if (!root?.isConnected || root.offsetParent === null) return false;
    const rows = Array.from(root.querySelectorAll('.pta-row'));
    const active = document.activeElement;
    const focusedRow = active instanceof Element ? active.closest('.pta-row') : null;
    const focusedIndex = focusedRow ? rows.indexOf(focusedRow) : -1;
    const baseIndex = focusedIndex >= 0 ? focusedIndex : (typeof currentIndex === 'number' ? currentIndex : -1);
    const index = nextRowIndex(baseIndex, rows.length, event.key);
    if (index === null || index >= rows.length) return false;
    event.preventDefault();
    rows[index].focus({ preventScroll: true });
    rows[index].scrollIntoView({ block: 'nearest' });
    onMove?.(index, rows[index]);
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

  function InboxPage() {
    const data = useLiveAdmin();
    const groups = useMemo(() => ticketGroups(data), [data]);
    const [filter, setFilter] = useState('all');
    const [query, setQuery] = useState('');
    const [selectedId, setSelectedId] = useState(null);
    const [inspectorOpen, setInspectorOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth > 900));
    const search = useRef(null);
    const root = useRef(null);
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
    const stuckReason = useMemo(() => new Map(
      data.queue
        .filter((item) => !(Array.isArray(item?.eligible) ? item.eligible.length > 0 : Boolean(item?.eligible)))
        .map((item) => [Number(item.id), item.reason ?? 'no eligible node']),
    ), [data.queue]);
    const filters = [
      { key: 'all', label: 'All', count: all.length },
      { key: 'approval', label: 'Approvals', count: groups.approvals.length },
      { key: 'review', label: 'Reviews', count: groups.reviews.length },
      { key: 'reply', label: 'Client replies', count: groups.waiting.length },
      { key: 'stalled', label: 'Stalled', count: groups.stalled.length },
      { key: 'stuck', label: 'Stuck', count: groups.stuck.length },
    ];
    const needle = query.trim().toLowerCase();
    const shown = useMemo(() => all.filter(({ ticket, kinds }) => {
      if (filter !== 'all' && !kinds.has(filter)) return false;
      if (needle.length === 0) return true;
      return `${ticket.id} ${ticketLabel(ticket)} ${ticket.project_name ?? ''} ${ticket.client_email ?? ''}`
        .toLowerCase()
        .includes(needle);
    }), [all, filter, needle]);

    // Selection survives filter/search changes when still visible; otherwise
    // falls back to the first visible row.
    const matchedIndex = selectedId == null ? -1 : shown.findIndex((entry) => entry.ticket.id === selectedId);
    const activeIndex = shown.length === 0 ? -1 : (matchedIndex >= 0 ? matchedIndex : 0);
    const selectedEntry = inspectorOpen && activeIndex >= 0 ? shown[activeIndex] : null;
    useEffect(() => {
      if (shown.length === 0) return;
      if (matchedIndex >= 0) return;
      if (selectedId != null || inspectorOpen) setSelectedId(shown[0].ticket.id);
    }, [shown, matchedIndex, selectedId, inspectorOpen]);

    const reasonFor = useCallback((entry) => {
      if (!entry) return '';
      if (entry.kinds.has('stalled')) return stalledReason(entry.ticket);
      if (entry.kinds.has('stuck')) return stuckReason.get(Number(entry.ticket.id)) ?? 'no eligible node';
      return '';
    }, [stuckReason]);

    const closeInspector = useCallback(() => {
      setInspectorOpen(false);
      const rows = root.current ? Array.from(root.current.querySelectorAll('.pta-row')) : [];
      const row = activeIndex >= 0 ? rows[activeIndex] : null;
      if (row) row.focus({ preventScroll: true });
    }, [activeIndex]);

    const navRef = useRef({ shown: [], activeIndex: -1, selectedEntry: null, inspectorOpen: false, closeInspector: () => {} });
    navRef.current = { shown, activeIndex, selectedEntry, inspectorOpen, closeInspector };

    useEffect(() => {
      const onPreset = (event) => setFilter(event.detail?.filter ?? 'all');
      // "/" jumps to search from anywhere on the page; Escape closes the
      // Inspector (or clears search when focused there); Enter opens the
      // selected ticket; j/k/arrows/Home/End move selection.
      const onKey = (event) => {
        const currentRoot = root.current;
        if (!currentRoot?.isConnected || currentRoot.offsetParent === null) return;
        const target = event.target;
        const typing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
        if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
          if (!typing && !document.querySelector('.pta-confirm') && search.current?.isConnected && search.current.offsetParent !== null) {
            event.preventDefault();
            search.current.focus();
            return;
          }
        }
        if (event.key === 'Escape' && !event.defaultPrevented && !typing && !document.querySelector('.pta-confirm')) {
          if (navRef.current.inspectorOpen) {
            event.preventDefault();
            navRef.current.closeInspector();
            return;
          }
        }
        if (event.key === 'Enter' && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.altKey && !typing && !document.querySelector('.pta-confirm')) {
          const interactive = target instanceof Element && target.closest('button, a, [role="separator"], .pta-row');
          if (!interactive && navRef.current.selectedEntry) {
            event.preventDefault();
            void openTicketRun(navRef.current.selectedEntry.ticket);
            return;
          }
        }
        navigateRowFocus(currentRoot, event, {
          currentIndex: navRef.current.activeIndex,
          onMove: (index) => {
            const entry = navRef.current.shown[index];
            if (!entry) return;
            setSelectedId(entry.ticket.id);
            setInspectorOpen(true);
          },
        });
      };
      window.addEventListener('pta:inbox-filter', onPreset);
      window.addEventListener('keydown', onKey);
      return () => { window.removeEventListener('pta:inbox-filter', onPreset); window.removeEventListener('keydown', onKey); };
    }, []);
    if (data.loading && data.at === 0) {
      return (
        <div className="ui pta-inbox" ref={root}>
          <div className="pta-inbox__main">
            <div className="pta-page pta-inbox__page"><p className="pta-empty">Loading…</p></div>
          </div>
        </div>
      );
    }
    if (data.error) {
      return (
        <div className="ui pta-inbox" ref={root}>
          <div className="pta-inbox__main">
            <div className="pta-page pta-inbox__page">
              <header className="pta-head">
                <div>
                  <h1>Inbox</h1>
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
          </div>
        </div>
      );
    }
    return (
      <div className="ui pta-inbox" ref={root} data-inspector={selectedEntry ? 'open' : 'closed'}>
        <div className="pta-inbox__main">
          <div className="pta-page pta-inbox__page">
            <header className="pta-head">
              <div>
                <h1>Inbox</h1>
                <p>
                  {all.length === 0
                    ? 'Nothing is waiting on you. Agents are on it.'
                    : `${all.length} item${all.length === 1 ? '' : 's'} want a decision.`}
                </p>
              </div>
              <div className="pta-head__actions">
                <input
                  ref={search}
                  className="pta-search"
                  value={query}
                  placeholder="Search tickets, clients, projects…  /"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      setQuery('');
                      event.currentTarget.blur();
                    }
                  }}
                  aria-label="Search the inbox"
                />
              </div>
            </header>
            <div className="pta-filters">
              {filters.map((item) => (
                <button key={item.key} type="button" className={`pta-filter${filter === item.key ? ' is-active' : ''}`} onClick={() => setFilter(item.key)}>
                  {item.label}{item.count ? <span className="pta-count">{item.count}</span> : null}
                </button>
              ))}
            </div>
            <p className="pta-meta pta-hint">j/k to move · Enter to open · Esc to close · / to search</p>
            {shown.length === 0 ? (
              <EmptyState title={all.length === 0 ? 'Inbox zero' : 'Nothing in this filter'} text={all.length === 0 ? 'New approvals, reviews and client replies will land here and notify you.' : 'Try another filter, or clear the search.'} />
            ) : (
              <div className="pta-rows pta-rows--inbox" role="listbox" aria-label="Inbox tickets">
                {shown.map((entry) => {
                  const { ticket, kinds } = entry;
                  const stalled = kinds.has('stalled');
                  const reason = reasonFor(entry);
                  const selected = selectedEntry?.ticket.id === ticket.id;
                  return (
                    <TicketLine
                      key={ticket.id}
                      ticket={ticket}
                      stalled={stalled}
                      reason={reason}
                      showAge={!stalled}
                      selected={selected}
                      onSelect={() => {
                        setSelectedId(ticket.id);
                        setInspectorOpen(true);
                      }}
                      onOpen={() => void openTicketRun(ticket)}
                      actions={<TicketRowActions ticket={ticket} />}
                      detail={isWaiting(ticket) ? 'waiting' : ''}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {selectedEntry ? (
          <>
            <div className="pta-inbox__scrim" aria-hidden="true" onClick={closeInspector} />
            <InboxInspector
              entry={selectedEntry}
              reason={reasonFor(selectedEntry)}
              onClose={closeInspector}
            />
          </>
        ) : null}
      </div>
    );
  }

  const EMPTY_DESK_DATA = {
    loaded: true, error: null, fetchedAt: 0,
    tickets: [], projects: [], clients: [], usageTotal: null,
    nodes: [], queue: [], running: [], recent: [], settings: null, catalog: null,
  };

  /** Route an internal `admin-ui` destination key to its native desktop panel. */
  function openNativeDestination(key) {
    const target = String(key ?? '');
    if (!target) return;
    if (target.startsWith('t:')) { void openTicketRun({ id: Number(target.slice(2)) }); return; }
    if (target.startsWith('p:')) { openProjectPage({ id: target.slice(2) }); return; }
    if (target.startsWith('c:')) { openClientPage({ id: target.slice(2) }); return; }
    if (target === 'inbox') { ctx.layout?.selectPanel?.(HOME_PANEL); return; }
    if (target === 'board' || target === 'list' || target === 'work') { ctx.layout?.selectPanel?.(WORK_PANEL); return; }
    if (target === 'marketing') { ctx.layout?.selectPanel?.(MARKETING_PANEL); return; }
    if (target === 'seo') { ctx.layout?.selectPanel?.(SEO_PANEL); return; }
    if (target === 'fleet' || target === 'health') { ctx.layout?.selectPanel?.(FLEET_PANEL); return; }
    // `settings#marketing` etc.: the section rides settings-link's handoff.
    if (isSettingsKey(target)) { openSettings(() => ctx.layout?.selectPanel?.(SETTINGS_PANEL), settingsSection(target) ?? undefined); }
  }

  function DeskShell({ children, data, reload, allowSignedOut = false }) {
    const [toast, setToast] = useState(null);
    const [modal, setModal] = useState(null);
    const [askState, setAskState] = useState(null);
    const [boardProject, setBoardProject] = useState('all');
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
        void reload();
        window.dispatchEvent(new CustomEvent('admin:changed', { detail: { kind: 'desk.mutation' } }));
        return out;
      } catch (error) {
        notify(error?.message ?? String(error), 'error');
        throw error;
      }
    }, [notify, reload]);
    const setStatus = useCallback((ticket, status) => {
      if (status === ticket.status) return Promise.resolve();
      const run = () => act(() => api('PATCH', `/admin/tickets/${ticket.id}`, { status }), `#${ticket.id} → ${STATUS_LABEL[status] ?? status}`);
      if (ticket.kind !== 'system' && CLIENT_VISIBLE_STATUSES.has(status)) {
        return new Promise((resolve) =>
          setAskState({
            title: `${STATUS_LABEL[status] ?? status}: #${ticket.id}?`,
            text: `${ticket.client_email ?? ticket.clientEmail ?? 'The client'} is emailed about this change.`,
            confirm: STATUS_LABEL[status] ?? status,
            danger: status === 'declined',
            run: () => run().then(resolve, resolve),
          }),
        );
      }
      return run().catch(() => undefined);
    }, [act]);
    const context = useMemo(() => ({
      api,
      act,
      notify,
      ask: setAskState,
      setModal,
      setStatus,
      data,
      reload,
      boardProject,
      setBoardProject,
      open: openNativeDestination,
      openTicket: (id) => void openTicketRun({ id }),
      activeTab: null,
      closeTab: () => {},
      platform: 'dsh',
      host,
      files,
    }), [act, notify, setStatus, data, reload, boardProject]);
    const signedOut = !allowSignedOut && Boolean(data.error && isAuthError(data.error.code));
    return (
      <div
        className="aw aw--dsh pta-desk"
        style={{ gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)', height: '100%', minHeight: 0 }}
      >
        <style>{STYLES}</style>
        <div className="aw-content" style={{ overflow: 'auto', height: '100%' }}>
          <AdminContext.Provider value={context}>
            {signedOut ? (
              <div className="pta-page">
                <PortalSignIn onDone={() => void reload()} />
              </div>
            ) : !allowSignedOut && !data.loaded ? (
              <div className="aw-loading--fill">
                <Skeleton variant="pane" label="Loading…" />
              </div>
            ) : (
              children
            )}
            {modal?.kind === 'task' ? <TaskModal preset={modal} onClose={() => setModal(null)} /> : null}
            {modal?.kind === 'project' ? <ProjectModal onClose={() => setModal(null)} /> : null}
            {modal?.kind === 'custom' ? modal.render(() => setModal(null)) : null}
            {askState ? <Confirm ask={askState} onClose={() => setAskState(null)} /> : null}
          </AdminContext.Provider>
        </div>
        {toast ? (
          <div className={`aw-toast${toast.kind === 'error' ? ' is-error' : ''}`} role="status">
            {toast.text}
          </div>
        ) : null}
      </div>
    );
  }

  function DeskPageWithData({ children, allowSignedOut = false }) {
    const [data, reload] = useAdminData(api);
    useEffect(() => {
      const onChanged = () => void reload();
      window.addEventListener('admin:changed', onChanged);
      return () => window.removeEventListener('admin:changed', onChanged);
    }, [reload]);
    return <DeskShell data={data} reload={reload} allowSignedOut={allowSignedOut}>{children}</DeskShell>;
  }

  /**
   * Native host wrapper for shared `admin-ui` views (Work, Marketing, SEO,
   * Fleet, Settings): supplies `AdminContext`, confirms, modals and toasts
   * directly on the stage with zero outer activity bar, tabs or explorer.
   */
  function DeskPage({ children, withData = false, allowSignedOut = false }) {
    const noopReload = useCallback(() => Promise.resolve(), []);
    if (withData) return <DeskPageWithData allowSignedOut={allowSignedOut}>{children}</DeskPageWithData>;
    return <DeskShell data={EMPTY_DESK_DATA} reload={noopReload} allowSignedOut>{children}</DeskShell>;
  }

  function WorkPage() {
    const [mode, setMode] = useState(() => {
      try {
        return localStorage.getItem('pta.work.mode') === 'board' ? 'board' : 'list';
      } catch {
        return 'list';
      }
    });
    const switchMode = (next) => {
      setMode(next);
      try { localStorage.setItem('pta.work.mode', next); } catch { /* ignore */ }
    };
    return (
      <DeskPage withData>
        <div className="pta-work">
          <div className="pta-work__bar">
            <Segmented
              value={mode}
              label="Work view"
              options={[
                { value: 'list', label: 'List' },
                { value: 'board', label: 'Board' },
              ]}
              onChange={switchMode}
            />
          </div>
          {mode === 'board' ? <BoardView /> : <ListView />}
        </div>
      </DeskPage>
    );
  }

  function MarketingPage() {
    return <DeskPage><MarketingView /></DeskPage>;
  }

  function SuperagentPage() {
    return <DeskPage withData><SuperagentView /></DeskPage>;
  }

  function SeoPage() {
    return <DeskPage><SeoView /></DeskPage>;
  }

  function ClientsPage() {
    return <DeskPage withData><ClientsView /></DeskPage>;
  }

  function FleetPage() {
    return <DeskPage withData><FleetView /></DeskPage>;
  }

  function SettingsPage() {
    return <DeskPage withData allowSignedOut><SettingsView /></DeskPage>;
  }

  const WORKSPACE_TEXT = {
    ready: 'Workspace ready.',
    missing: 'Workspace is missing. Restore it from the saved commit.',
    conflict: 'Restore is blocked by an existing checkout or local changes. Preserve that work before retrying.',
    unavailable: 'No verified workspace is available. Check that the run recorded its repository and commit.',
    pending: 'Checking or restoring this session’s workspace…',
    unmanaged: 'This session has no managed workspace to restore.',
  };

  const WORKSPACE_LABEL = {
    ready: 'Workspace ready',
    missing: 'Workspace missing',
    conflict: 'Restore blocked',
    unavailable: 'No workspace',
    pending: 'Checking workspace…',
    unmanaged: 'No managed workspace',
  };

  /** One inline chip in the dock row; the full explanation lives in its tooltip. */
  function TicketWorkspace({ sessionId, ticketId }) {
    const [opening, setOpening] = useState(false);
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
    const detail = [WORKSPACE_TEXT[result.state], result.reason].filter(Boolean).join(' ');
    const checkable = ['conflict', 'unavailable', 'pending', 'ready'].includes(result.state);
    return <span className="pta-dock__ws" data-state={result.state}>
      <button type="button" className="pta-dock__chip" title={checkable ? `${detail} Click to check again.` : detail}
        aria-label={detail} disabled={!checkable} onClick={() => void request('status')}>
        <span className="pta-dock__dot" aria-hidden="true" />
        <span role="status">{WORKSPACE_LABEL[result.state] ?? result.state}</span>
      </button>
      {result.state === 'missing' ? <PtaButton onClick={() => void restore()}>Restore</PtaButton> : null}
      {(result.state === 'unavailable' || result.state === 'unmanaged') && ticketId ? (
        <PtaButton disabled={opening}
          title="Open this ticket in its own folder, cloned from the remote: Git Graph shows its branch, and pulling the repo lets an agent work on it again."
          onClick={() => { setOpening(true); void openTicketThread({ id: ticketId }).finally(() => setOpening(false)); }}>
          {opening ? 'Opening…' : 'Open from remote'}
        </PtaButton>
      ) : null}
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
  function LinkedTicketDock({ sessionId, ticketId, thread = null }) {
    const { detail, error } = useLinkedTicketDetail(ticketId, sessionId, Boolean(thread));
    const ticket = detail?.ticket;
    const [open, setOpen] = useState(null);
    const canReply = ticket && ticket.kind !== 'system' && ticket.client_email;
    const toggle = (mode, label) => <button type="button" className="pta-dock__toggle" aria-expanded={open === mode}
      onClick={() => setOpen(open === mode ? null : mode)}>{label}</button>;
    const title = error || (ticket ? ticketLabel(ticket) : 'Loading linked ticket…');
    return <section className="pta-dock" aria-label={`Ticket #${ticketId}`}
      title="Type below to message the agent. That does not email the client or save a private note.">
      <div className="pta-dock__head pta-dock__row">
        {ticket ? <StatusPill status={ticket.status} /> : null}
        <span className="pta-dock__id">#{ticketId}</span>
        <span className="pta-dock__title" title={title}>{title}</span>
        {desktop && !thread ? <TicketWorkspace sessionId={sessionId} ticketId={ticketId} /> : null}
        {ticket ? <span className="pta-dock__actions">
          {nativeConversation?.selectView ? <button type="button" className="pta-dock__toggle"
            title="Status, run again, land, reopen and the rest of this ticket's actions"
            onClick={() => nativeConversation?.selectView?.(sessionId, 'admin-task')}>Ticket actions</button> : null}
          {toggle('note', 'Add private note')}
          {canReply ? toggle('reply', 'Reply by email') : null}
        </span> : null}
      </div>
      {thread ? <ThreadPull thread={thread} ticket={ticket} /> : null}
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
    const thread = useThreadLock(run?.thread ? sessionId : null, run?.cwd);
    if (!run || !sessionId) return null;
    return <div ref={anchor} style={{ display: 'contents' }}>
      {chat ? <LinkedTicketDock key={`${run.ticketId}:${sessionId}`} ticketId={run.ticketId} sessionId={sessionId} thread={thread} /> : null}
    </div>;
  }

  const THREAD_LOCK = 'The client’s own agent works this ticket. Pull the repo to chat with an agent here.';

  /**
   * A ticket chat folder's state, and the composer lock that goes with it: a
   * history-only clone keeps the input inert until the repo is pulled.
   * Returns null for any other session.
   */
  function useThreadLock(sessionId, cwd) {
    const [state, setState] = useState(sessionId ? 'pending' : null);
    const [error, setError] = useState('');
    const refresh = useCallback(async () => {
      if (!sessionId || !cwd) return;
      const out = await adminOperation({ operation: 'ticket-thread-state', cwd });
      setState(out?.state ?? 'none');
    }, [sessionId, cwd]);
    useEffect(() => { void refresh(); }, [refresh]);
    useEffect(() => {
      const blocks = nativeConversation?.blocks;
      if (!sessionId || typeof blocks?.set !== 'function') return undefined;
      blocks.set(sessionId, state === 'history' || state === 'pending' || state === 'pulling' ? { reason: THREAD_LOCK } : undefined);
      return () => blocks.set(sessionId, undefined);
    }, [sessionId, state]);
    if (!sessionId) return null;
    const pull = async () => {
      setState('pulling');
      setError('');
      const out = await adminOperation({ operation: 'ticket-pull', cwd });
      if (out?.error) setError(`Could not pull the repo: ${out.error}`);
      setState(out?.state ?? 'history');
    };
    return { state, pull, cwd, error };
  }

  /** The dock row for a ticket chat folder: why the input is locked, and the pull that unlocks it. */
  function ThreadPull({ thread, ticket }) {
    if (thread.state === 'checkout') return null;
    const who = ticket?.worked_by === 'client_agent' ? 'The client’s own agent works this ticket over the portal. ' : '';
    const text = thread.state === 'none'
      ? 'This project has no repository to pull, so there is nothing to work on here. Reply or add a note above.'
      : `${who}Git Graph shows the remote’s history; pull the repo to check out the ticket’s branch and chat with an agent here.`;
    return <div className="pta-dock__row pta-dock__thread">
      <span className="pta-dock__thread-text">{thread.error || text}</span>
      {thread.state === 'none' ? null : (
        <button type="button" className="pta-dock__pull" disabled={thread.state === 'pulling' || thread.state === 'pending'} onClick={() => void thread.pull()}>
          {thread.state === 'pulling' ? 'Pulling…' : 'Pull the repo'}
        </button>
      )}
    </div>;
  }

  /* ————— ptech-admin:// links ————— */

  /**
   * Open a `ptech-admin://` link: the plugin half of the desktop URL scheme.
   *
   *   ptech-admin://ticket/12   the ticket's conversation, or native ticket page
   *   ptech-admin://client/<id> that client's native page
   *   ptech-admin://project/<id> that project's native page
   *   ptech-admin://inbox       the Inbox home
   *   ptech-admin://work        the Work desk (List / Board)
   *   ptech-admin://seo         the SEO desk
   *   ptech-admin://marketing   the Marketing desk
   *   ptech-admin://fleet       the Fleet & health desk
   *   ptech-admin://health      the Fleet & health desk
   *   ptech-admin://settings    the Settings desk
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
      openClientPage({ id: target });
      return true;
    }
    if (route === 'project') {
      if (target.length === 0) return false;
      handledDeepLink = true;
      openProjectPage({ id: target });
      return true;
    }
    if (route === 'inbox') {
      handledDeepLink = true;
      ctx.layout?.selectPanel?.(HOME_PANEL);
      return true;
    }
    if (route === 'work' || route === 'board' || route === 'list') {
      handledDeepLink = true;
      ctx.layout?.selectPanel?.(WORK_PANEL);
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
    if (route === 'fleet' || route === 'health') {
      handledDeepLink = true;
      ctx.layout?.selectPanel?.(FLEET_PANEL);
      return true;
    }
    if (route === 'settings') {
      handledDeepLink = true;
      openSettings(() => ctx.layout?.selectPanel?.(SETTINGS_PANEL), (target ? settingsSection(`settings#${target}`) : null) ?? undefined);
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
  // Inbox is the default main page; Work, Marketing, SEO, Fleet and Settings
  // mount natively through DeskPage with no outer shell-in-shell chrome.
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: HOME_PANEL, locale: NAMESPACE }, InboxPage));
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: WORK_PANEL, locale: NAMESPACE }, WorkPage));
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: MARKETING_PANEL, locale: NAMESPACE }, MarketingPage));
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: SUPERAGENT_PANEL, locale: NAMESPACE }, SuperagentPage));
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: SEO_PANEL, locale: NAMESPACE }, SeoPage));
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: CLIENTS_PANEL, locale: NAMESPACE }, ClientsPage));
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: FLEET_PANEL, locale: NAMESPACE }, FleetPage));
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: SETTINGS_PANEL, locale: NAMESPACE }, SettingsPage));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: HOME_PANEL, order: 11, label: 'Inbox' }, InboxEntryIcon));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: SUPERAGENT_PANEL, order: 11.5, label: 'Superagent' }, SuperagentEntryIcon));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: WORK_PANEL, order: 12, label: 'Work' }, WorkEntryIcon));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: MARKETING_PANEL, order: 13, label: 'Marketing' }, MarketingEntryIcon));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: SEO_PANEL, order: 14, label: 'SEO' }, SeoEntryIcon));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: CLIENTS_PANEL, order: 14.5, label: 'Clients' }, ClientsEntryIcon));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: FLEET_PANEL, order: 15, label: 'Fleet' }, FleetEntryIcon));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: SETTINGS_PANEL, order: 16, label: 'Settings' }, SettingsEntryIcon));
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
  // The native pages own their own small stylesheet; no admin-ui CSS leaks
  // into the native conversation.
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.admin = 'native';
    style.textContent = NATIVE_STYLES;
    document.head.append(style);
    return () => style.remove();
  }, 'admin: native styles');
  // A cold launch lands on Superagent. A deep link that arrived first (a
  // ticket, a client, a sign-in) wins, and a renderer reload of the same
  // window simply comes back here. The shell restores its last session once
  // the session list is ready (seconds later), which would replace the panel;
  // until the operator touches anything, that restore hands the view back.
  ctx.effect(() => {
    let touched = false;
    let settled = false;
    let shown = false;
    const land = () => {
      try {
        if (window.location.hash !== '' || handledDeepLink || touched) return;
        ctx.layout?.selectPanel?.(SUPERAGENT_PANEL);
      } catch {
        // The host may not have the panel registry ready yet; keep the conversation.
      }
    };
    const touch = (event) => { if (event.isTrusted) touched = true; };
    window.addEventListener('pointerdown', touch, true);
    window.addEventListener('keydown', touch, true);
    const timer = setTimeout(land, 900);
    const panelInfo = ctx.layout?.panelInfo;
    const unwatch = typeof panelInfo?.subscribe === 'function'
      ? panelInfo.subscribe(() => {
        if (settled || touched) return;
        const active = panelInfo.getSnapshot?.().activePanelId ?? null;
        if (active === SUPERAGENT_PANEL) { shown = true; return; }
        if (shown && active === null) { settled = true; land(); }
      })
      : () => {};
    const stop = setTimeout(() => { settled = true; }, 60_000);
    return () => {
      clearTimeout(timer); clearTimeout(stop); unwatch();
      window.removeEventListener('pointerdown', touch, true);
      window.removeEventListener('keydown', touch, true);
    };
  }, 'admin: initial superagent view');
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
  // Mount the v2 primitive stylesheet once at the plugin root so StateIndicator,
  // MetaChip and Inspector are styled without restyling the host app.
  function PluginUiStyles() {
    return <UiStyles />;
  }
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'admin-ui-styles', order: 1 }, PluginUiStyles));
  // Notifications live in the frame-wide overlay, so a toast survives switching
  // panels and pages and never sits inside a column's scroll container.
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'admin-notifications', order: 40 }, NotificationHost));
  // The in-app confirm: one dialog for every ask that emails a client or
  // restores a workspace, instead of the browser's `window.confirm`.
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'admin-confirm', order: 45 }, ConfirmHost));
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'admin-runs-dock', order: 47 }, RunsDockHost));
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'admin-command-palette', order: 46 }, CommandPaletteHost));
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
