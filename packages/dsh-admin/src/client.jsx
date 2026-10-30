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
import { useSyncExternalStore } from 'react';
import { AdminApp } from '../../admin-ui/src/index.js';

/** Panel identity: one id addresses both the sidebar row and the main page. */
const PANEL_ID = 'admin';
const NAMESPACE = 'admin';
/** Reported to the Host on activation, so "did the panel load?" has an answer. */
const CLIENT_VERSION = '3.5.0';
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

/** The sidebar glyph. */
/** The Ticket tab's glyph in the right pane's guide: a ticket stub. */
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
      await ws.openSession(found?.sessionId ?? sessionId);
      return found;
    },
  };
  /** One stable object so React effects that depend on it do not re-run. */
  const host = { command, json, gitGraph, conversation, TicketPanel };
  const api = (method, path, body) => json(`api ${method} ${path}${body === undefined ? '' : ` ${JSON.stringify(body)}`}`);

  /* ————— Ticket runs in the session list ————— */

  const RUN_DIR_RE = /^(.+)-(task|ticket)-(\d+)(?:-run(\d+))?$/;

  /** The ticket a worktree cwd belongs to: `<slug>-(task|ticket)-<id>[-run<n>]`. */
  function ticketFromCwd(cwd) {
    if (typeof cwd !== 'string' || !cwd.includes('/malipetek-runner/worktrees/')) return null;
    const match = RUN_DIR_RE.exec(cwd.replace(/\/+$/, '').split('/').pop() ?? '');
    if (!match) return null;
    return { slug: match[1], kind: match[2], ticketId: Number(match[3]), runId: match[4] ? Number(match[4]) : null, cwd };
  }

  /** Live-read one session's cwd from the catalog (updates on refresh/import). */
  function useSessionCwd(sessionId) {
    const list = ctx.sessions?.list;
    return useSyncExternalStore(
      (notify) => (typeof list?.subscribe === 'function' ? list.subscribe(notify) : () => {}),
      () => list?.getSnapshot?.()?.byId?.[sessionId]?.cwd,
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

  /** The session a right-pane tab is open on, whatever shape the slot gives it. */
  function tabSessionId(props) {
    const params = props?.params ?? props?.tab?.params ?? props ?? {};
    return typeof params.sessionId === 'string' ? params.sessionId : null;
  }

  const actionStyle = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '8px 12px',
    margin: '0 0 8px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-l4, #333)',
    background: 'var(--dsw-alias-button-elevated-fill, transparent)',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
  };

  /**
   * The right-pane Ticket tab: the run's ticket info and its actions, out of
   * the session rows. One tab kind for every session — a session that did not
   * come from a run says so.
   */
  /**
   * The ticket panel: identity and everything a ticket can do, wherever it is
   * shown — the conversation's right pane, or the admin ticket's right column
   * (`host.TicketPanel`). It reads the ticket, so the buttons match its state:
   * approve a new one, mark a review done, run it again, stop a live run, land
   * the branch — and the links out. `embedded` hides "open in Admin" when you
   * are already there.
   */
  function TicketPanel({ ticketId, slug = null, kind = 'task', runId = null, sessionId = null, embedded = false }) {
    const [detail, setDetail] = useState(null);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState(null);

    const load = useCallback(() => {
      api('GET', `/admin/tickets/${ticketId}`)
        .then(setDetail)
        .catch(() => setDetail(null));
    }, [ticketId]);
    useEffect(load, [load]);

    const call = async (method, path, body, done) => {
      setBusy(true);
      setNote(null);
      try {
        await api(method, path, body);
        setNote(done);
        load();
      } catch (error) {
        setNote(error?.message ?? 'That did not go through.');
      } finally {
        setBusy(false);
      }
    };

    const ticket = detail?.ticket ?? null;
    const runs = Array.isArray(detail?.runs) ? detail.runs : [];
    const live = runs.find((r) => r.status === 'running') ?? null;
    const status = ticket?.status ?? null;
    const setStatus = (next, done) => call('PATCH', `/admin/tickets/${ticketId}`, { status: next }, done);

    const buttons = [];
    if (status === 'new') {
      buttons.push(['Approve', 'primary', () => setStatus('approved', 'Approved.')]);
      buttons.push(['Decline', null, () => setStatus('declined', 'Declined.')]);
    }
    if (status === 'approved') buttons.push(['Hold', null, () => setStatus('new', 'Held.')]);
    if (status === 'review') {
      buttons.push(['Mark done', 'primary', () => setStatus('done', 'Marked done.')]);
      buttons.push(['Run again', null, () => setStatus('approved', 'Queued again.')]);
    }
    if (live) buttons.push(['Stop run', null, () => call('POST', `/admin/runs/${live.id}/cancel`, undefined, 'Stopping the run.')]);
    if (runs.length > 0 && status !== 'in_progress') {
      buttons.push(['Land on main', null, () => call('POST', `/admin/tickets/${ticketId}/land`, undefined, 'A node will land it on its next heartbeat.')]);
    }

    const review = async () => {
      let repo = null;
      try {
        const where = await json(`review ${slug}`);
        if (where?.found && where.repo) repo = where.repo;
      } catch {
        /* the ref is enough for Git Graph */
      }
      try {
        await gitGraph.focus({ sessionId, repo, ref: `malipetek/${kind}-${ticketId}` });
      } catch {
        /* Git Graph not reachable */
      }
    };

    return (
      <div style={{ padding: 12 }}>
        <div style={{ fontSize: 13, marginBottom: 10, color: 'var(--dsw-alias-label-secondary, #adb2b8)' }}>
          {kind === 'task' ? 'System task' : 'Client ticket'} #{ticketId}
          {runId ? ` · run ${runId}` : ''}
          {status ? ` · ${status.replace('_', ' ')}` : ''}
          {slug ? (
            <>
              <br />
              {slug}
            </>
          ) : null}
        </div>
        {status === 'in_progress' && live ? (
          <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.8 }}>
            {live.executor ?? 'agent'} running{live.node_id ? ` on ${live.node_id}` : ''}
          </div>
        ) : null}
        {buttons.map(([label, kindOf, run]) => (
          <button
            key={label}
            type="button"
            style={{
              ...actionStyle,
              ...(kindOf === 'primary'
                ? { background: 'var(--dsw-alias-button-primary-fill, #4c8bf5)', borderColor: 'transparent', color: '#fff' }
                : null),
            }}
            disabled={busy}
            onClick={() => void run()}
          >
            {label}
          </button>
        ))}
        {embedded ? null : (
          <button type="button" style={actionStyle} onClick={() => openTicket({ ticketId })}>
            Open ticket #{ticketId} in Admin
          </button>
        )}
        {sessionId ? (
          <button type="button" style={actionStyle} onClick={() => void conversation.open(sessionId)}>
            Open conversation
          </button>
        ) : null}
        {gitGraph.available() ? (
          <button type="button" style={actionStyle} onClick={() => void review()}>
            Review in Git Graph
          </button>
        ) : null}
        {note ? <div style={{ fontSize: 12, marginTop: 8, opacity: 0.8 }}>{note}</div> : null}
      </div>
    );
  }

  function TicketTab(props) {
    const sessionId = tabSessionId(props);
    const run = ticketFromCwd(useSessionCwd(sessionId));
    if (!run) return <div style={{ padding: 12, fontSize: 13, opacity: 0.7 }}>This session did not come from a ticket run.</div>;
    return <TicketPanel ticketId={run.ticketId} slug={run.slug} kind={run.kind} runId={run.runId} sessionId={sessionId} />;
  }

  function TicketTabTitle(props) {
    const run = ticketFromCwd(useSessionCwd(tabSessionId(props)));
    return <span>{run ? `Ticket #${run.ticketId}` : 'Ticket'}</span>;
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

  /**
   * The task desk in the right pane: what waits on Ali and what is running,
   * nothing else. A row opens the task in the Admin panel.
   */
  function TasksTab() {
    const [state, setState] = useState({ tickets: [], loading: true });
    useEffect(() => {
      let alive = true;
      const load = () =>
        api('GET', '/admin/tickets')
          .then((d) => {
            if (alive) setState({ tickets: Array.isArray(d?.tickets) ? d.tickets : [], loading: false });
          })
          .catch(() => {
            if (alive) setState((s) => ({ ...s, loading: false }));
          });
      void load();
      const timer = setInterval(load, 20_000);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, []);

    const waiting = state.tickets.filter((t) => t.status === 'new' || t.status === 'review');
    const running = state.tickets.filter((t) => t.status === 'in_progress');

    const row = (ticket) => (
      <button key={ticket.id} type="button" style={taskRowStyle} onClick={() => openTicket({ ticketId: ticket.id })}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            marginTop: 5,
            flex: '0 0 auto',
            background: TASK_TINT[ticket.status] ?? '#888',
          }}
        />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            #{ticket.id} {ticket.title}
          </span>
          <span
            style={{
              display: 'block',
              fontSize: 11,
              opacity: 0.65,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {ticket.project_name ?? 'no project'}
            {ticket.kind === 'system' ? ' · your task' : ''}
          </span>
        </span>
      </button>
    );

    if (state.loading) return <div style={{ padding: 12, fontSize: 13, opacity: 0.7 }}>Loading tasks…</div>;
    return (
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <section>
          <h4 style={taskHeadStyle}>Waiting on you · {waiting.length}</h4>
          {waiting.length > 0 ? waiting.map(row) : <p style={taskEmptyStyle}>Nothing waiting.</p>}
        </section>
        <section>
          <h4 style={taskHeadStyle}>Running · {running.length}</h4>
          {running.length > 0 ? running.map(row) : <p style={taskEmptyStyle}>Nothing running.</p>}
        </section>
      </div>
    );
  }

  function TasksTabTitle() {
    return <span>Tasks</span>;
  }

  /* ————— What needs Ali, on the Admin entry ————— */

  const ATTENTION_MS = 60_000;

  /**
   * One poller for `/admin/attention`, shared by everything that shows it, and
   * running only while something does. It goes over the panel route, so a
   * poll never lands in a session log. Signed out or offline reads as null.
   */
  const attention = (() => {
    let value = null;
    let timer = null;
    const subs = new Set();
    const pull = async () => {
      try {
        value = await api('GET', '/admin/attention');
      } catch {
        value = null;
      }
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
    };
  })();

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

  /** In a run's own conversation header: which ticket it came from, one click away. */
  function TicketHeaderChip({ sessionId }) {
    const run = ticketFromCwd(useSessionCwd(sessionId));
    if (!run) return null;
    return (
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
          {run.runId ? ` · run ${run.runId}` : ''}
        </span>
      </button>
    );
  }

  // Downloads go through the Host (it holds the token and the disk). Uploads
  // need the bytes, which the bridge cannot carry: /admin attach takes paths.
  const files = { download: (path) => json(`download ${path}`) };

  function AdminPage() {
    return <AdminApp api={api} host={host} files={files} platform="dsh" />;
  }

  ctx.inject(['locale'], (localeCtx) => {
    localeCtx.effect(() => localeCtx.locale.register(NAMESPACE, { en: DICTIONARY }), 'admin: locale namespace');
  });
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NAMESPACE }, AdminPage));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 12, label: 'Admin' }, AdminEntryIcon));
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register({ name: 'conversation.session.header.actions', id: 'admin-ticket', order: 5, locale: NAMESPACE }, TicketHeaderChip));
  // Run sessions get a ticket chip on the row and a line in the hover card;
  // the actions themselves live in the right-pane Ticket tab.
  ctx.slots.inject('sidebar.session.row.leading', () =>
    ctx.slots.register({ name: 'sidebar.session.row.leading', id: 'admin-ticket', order: 10, locale: NAMESPACE }, TicketMark));
  ctx.slots.inject('sidebar.session.row.hover', () =>
    ctx.slots.register({ name: 'sidebar.session.row.hover', id: 'admin-ticket', order: 10, locale: NAMESPACE }, TicketHover));
  // A right-pane tab type is only listed where a person can pick it — the
  // pane's "+" guide — when it declares a `guide` entry; without one it exists
  // but nothing opens it.
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: 'admin-ticket',
        kind: 'ticket',
        priority: 'extension',
        keepMounted: false,
        title: () => 'Ticket',
        guide: [
          {
            id: 'admin-ticket',
            order: 14,
            title: () => 'Ticket',
            description: () => 'The ticket this run session came from: open it in Admin, or review its branch in Git Graph.',
            icon: () => <TicketGlyph />,
          },
        ],
      }),
    'admin: ticket tab type',
  );
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'admin-ticket', locale: NAMESPACE }, TicketTab));
  ctx.slots.inject('sidebar.right.pane.tab.title', () =>
    ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: 'admin-ticket', locale: NAMESPACE }, TicketTabTitle));
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
            description: () => 'What is waiting on you and what is running. A row opens the task in Admin.',
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
