/*
 * This machine as a fleet worker: the header pill that always says what it is
 * doing, the one-time explanation that records the admin's answer, and the
 * panel that controls it. The Host half owns the record
 * (`/admin machine-consent get|set` → packages/dsh-admin/machine-consent.mjs,
 * `~/.dsh-admin/machine-consent.json`); this half reads it, watches the live
 * node, and never lets this Mac work invisibly.
 */
import { useCallback, useState, useSyncExternalStore } from 'react';
import { useAdmin } from './store.js';
import { ago, when } from './format.js';
import { Button, Dot, Icon, Modal, Tag, cx } from './ui.jsx';

/** Mirrors packages/dsh-admin/machine-consent.mjs, which owns the shape. */
const CONSENT_VERSION = 1;

/**
 * What lending one executor spends, in the admin's own terms: the plan it
 * uses and what its usage counts against. Order here is the checkbox order.
 */
const LEND = {
  'dsh-go': { label: 'Flash', plan: 'OpenCode Go · DeepSeek v4.1 flash', note: 'counts against the OpenCode Go plan’s limits' },
  'dsh-claude': { label: 'Opus', plan: 'Claude Code on Opus, through the Harness', note: 'counts against the Claude plan’s limits' },
  dsh: { label: 'DeepSeek', plan: 'the DeepSeek API key', note: 'billed to the DeepSeek account' },
  'dsh-devin': { label: 'SWE-2', plan: 'Devin SWE-2', note: 'free' },
  'dsh-opencode': { label: 'OpenCode (Harness)', plan: 'OpenCode in the Harness', note: 'counts against the OpenCode plan’s limits' },
  claude: { label: 'Claude Code CLI', plan: 'Claude Code on its own login', note: 'counts against the Claude plan’s limits' },
  opencode: { label: 'OpenCode CLI', plan: 'OpenCode on its own login', note: 'counts against the OpenCode plan’s limits' },
  devin: { label: 'Devin CLI', plan: 'Devin on its own login', note: 'billed to the Devin account' },
};
const lendLabel = (e) => LEND[e]?.label ?? e;

/** The dsh family a machine with no narrower list offers by default. */
const DEFER_LENDING_KEY = 'aw.deferMachineLending';
const lendingDeferred = () => {
  try { return globalThis.sessionStorage?.getItem(DEFER_LENDING_KEY) === '1'; } catch { return false; }
};
const deferLending = () => {
  try { globalThis.sessionStorage?.setItem(DEFER_LENDING_KEY, '1'); } catch { /* The modal still closes when storage is restricted. */ }
};

const DEFAULT_LEND = ['dsh-go', 'dsh-claude', 'dsh', 'dsh-devin'];

const STATE_DOT = { working: 'ok', ready: 'ok', pausing: 'warn', paused: 'warn', off: 'bad', unset: null };
const HINT = {
  working: 'This Mac is running approved client tickets with your subscriptions.',
  ready: 'This Mac takes approved client work when it arrives.',
  pausing: 'Drained: what is running finishes, nothing new starts.',
  paused: 'Paused: this Mac takes no new work.',
  off: 'The worker service on this Mac is not running.',
  unset: 'This Mac can run approved client tickets. Say yes or no once.',
};

const nowSec = () => Math.floor(Date.now() / 1000);
const notEmpty = (list) => (Array.isArray(list) && list.length ? list : null);

/*
 * One poll for every consumer. The header pill, the onboarding and the fleet
 * panel all read the same two Host commands, so they share one 15 s timer
 * instead of each running its own: the store reads `localinfo` and
 * `machine-consent get`, keeps the last good answer on a failure, and every
 * mounted component re-renders from the same snapshot. `IDLE` is what the web
 * platform reads: there is no "this machine" there at all.
 */
const IDLE = { loaded: false, info: null, consent: null, consentError: null, error: null };
const machineStore = {
  snapshot: IDLE,
  host: null,
  timer: null,
  inflight: false,
  listeners: new Set(),
  subscribe(listener, host) {
    this.host = host;
    this.listeners.add(listener);
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), 15_000);
      void this.tick();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  },
  getSnapshot() {
    return this.snapshot;
  },
  async tick() {
    const host = this.host;
    if (!host || typeof host.json !== 'function' || this.inflight) return;
    this.inflight = true;
    let error = null;
    let consentError = null;
    let info;
    let consent = null;
    try {
      info = await host.json('localinfo').catch((e) => {
        error = e?.message ?? String(e);
        return undefined;
      });
      consent = await host.json('machine-consent get').catch((e) => {
        consentError = e?.message ?? String(e);
        return null;
      });
    } finally {
      this.inflight = false;
    }
    this.snapshot = {
      loaded: true,
      info: info === undefined ? this.snapshot.info : info,
      consent: consent ?? this.snapshot.consent,
      consentError,
      error,
    };
    for (const listener of this.listeners) listener();
  },
};

/** The test seam: machine.test.mjs seeds the snapshot to render each state. */
export const __machineStore = machineStore;

/**
 * This machine's worker: the Host half's view of the service, the consent
 * record, and this machine's own node in the fleet, kept fresh every 15 s.
 * Only the Harness (`platform === 'dsh'` with a Host) has a "this machine".
 */
export function useMachine() {
  const { api, act, ask, data, host, notify, platform, reload } = useAdmin();
  const live = platform === 'dsh' && Boolean(host);
  const subscribe = useCallback((listener) => (live ? machineStore.subscribe(listener, host) : () => {}), [live, host]);
  // One reader for the client and the server render: a static render shows
  // the current snapshot without subscribing to anything.
  const readSnapshot = () => (live ? machineStore.getSnapshot() : IDLE);
  const read = useSyncExternalStore(subscribe, readSnapshot, readSnapshot);
  const refresh = useCallback(() => void machineStore.tick(), []);

  const svc = read.info?.local?.service;
  const nodeId = read.info?.localConfig?.nodeId ?? '';
  const node = nodeId ? (data.nodes.find((n) => n.id === nodeId) ?? null) : null;
  const serviceUp = svc?.state === 'running';
  const running = node?.running ?? [];
  const consent = read.consent;
  const recorded = Boolean(consent && (consent.acceptedAt || consent.declinedAt));
  const consented = Boolean(consent?.acceptedAt && !consent.declinedAt);
  const stateKey =
    !recorded
      ? running.length
        ? 'working'
        : 'unset'
      : !serviceUp || (node && !node.online)
        ? 'off'
        : node?.draining
          ? running.length
            ? 'pausing'
            : 'paused'
          : running.length
            ? 'working'
            : 'ready';

  // One host command that fails loudly instead of pretending it ran.
  const hostMust = async (line) => {
    const r = await host.command(line);
    if (!r.ok) throw new Error(r.text);
    return r;
  };
  const saveConsent = (record) => hostMust(`machine-consent set ${JSON.stringify({ version: CONSENT_VERSION, ...record })}`);
  const needNode = () => {
    if (!node) throw new Error(`This Mac’s node (“${nodeId || 'unnamed'}”) is not registered with the portal yet.`);
  };

  const pause = () =>
    act(async () => {
      needNode();
      await api('PATCH', `/admin/nodes/${node.id}`, { draining: true });
    }, 'This Mac finishes what it has, then takes nothing new.').catch(() => undefined);

  const resume = () =>
    act(async () => {
      needNode();
      await api('PATCH', `/admin/nodes/${node.id}`, { draining: false });
    }, 'This Mac takes work again.').catch(() => undefined);

  const control = async (verb) => {
    const r = await host.command(`node ${verb}`);
    notify(r.text, r.ok ? 'ok' : 'error');
    refresh();
    void reload();
  };
  const start = () => control(svc?.loaded ? 'start' : 'install');
  const restart = () => control('restart');
  const stopNow = () =>
    ask({
      title: 'Stop this Mac’s worker now?',
      text: 'Anything it is running goes back to the queue within three minutes, unfinished. Pause instead if you can wait it out.',
      confirm: 'Stop now',
      danger: true,
      run: () => void control('stop'),
    });

  /**
   * Change which subscriptions this Mac lends. The Worker merges node
   * overrides, so `executors` alone leaves slots and capabilities alone; the
   * consent record keeps the same choice next to the acceptance.
   */
  const setLend = (lend) =>
    act(async () => {
      needNode();
      await saveConsent({ acceptedAt: consent?.acceptedAt ?? null, declinedAt: consent?.declinedAt ?? null, lend });
      await api('PATCH', `/admin/nodes/${node.id}`, { overrides: { executors: lend } });
    }, 'Saved. The node picks it up on its next heartbeat (within 30s).').then(refresh, () => undefined);

  /** Say yes: record the acceptance, narrow the node to what was chosen, and make sure the worker runs. */
  const accept = (lend) =>
    act(async () => {
      await saveConsent({ acceptedAt: nowSec(), declinedAt: null, lend });
      if (node) {
        // Registered: the portal override is the live list the views show.
        await api('PATCH', `/admin/nodes/${node.id}`, { overrides: { executors: lend } });
        if (node.draining) await api('PATCH', `/admin/nodes/${node.id}`, { draining: false });
      } else {
        // Not registered yet: narrow the machine's own allowlist instead,
        // so the node comes up offering exactly what was chosen.
        await hostMust(`local ${JSON.stringify({ executors: lend })}`);
      }
      if (!serviceUp) await hostMust(`node ${svc?.loaded ? 'start' : 'install'}`);
    }, 'This Mac is a fleet worker now. Pause it any time from the header.');

  /** Drain before recording a decline, so a failed drain never looks like a withdrawal. */
  const decline = async () => {
    try {
      await act(async () => {
        if (node) await api('PATCH', `/admin/nodes/${node.id}`, { draining: true });
        await saveConsent({ acceptedAt: consent?.acceptedAt ?? null, declinedAt: nowSec(), lend: consent?.lend ?? [] });
      }, 'Noted. This Mac takes no new work.');
    } finally {
      refresh();
    }
  };
  const withdraw = () => ask({
    title: 'Stop lending this Mac?',
    text: 'Running work finishes; nothing new starts here.',
    confirm: 'Stop lending',
    danger: true,
    run: () => decline().catch(() => undefined),
  });

  const offered = notEmpty(node?.executors) ?? notEmpty(read.info?.localConfig?.executors) ?? DEFAULT_LEND;
  const lending = consent?.lend ?? notEmpty(node?.executors) ?? [];
  // The same test the shell uses: a signed-out app has no admin to ask.
  const signedOut = Boolean(data.error && ['unauthorized', 'signed_out', 'forbidden'].includes(data.error.code));

  return {
    live,
    loaded: read.loaded,
    error: read.error,
    consentError: read.consentError,
    info: read.info,
    svc,
    serviceUp,
    nodeId,
    node,
    running,
    slots: node?.slots ?? read.info?.localConfig?.slots ?? 1,
    consent,
    consented,
    state: stateKey,
    offered,
    lending,
    pause,
    resume,
    start,
    restart,
    stopNow,
    setLend,
    accept,
    decline,
    withdraw,
    refresh,
    signedOut,
  };
}

/* ————— the header pill ————— */

const lendNames = (m) => {
  const names = (notEmpty(m.node?.executors) ?? m.lending).map(lendLabel).join(', ');
  return names || 'nothing';
};

const pillText = (m) => {
  if (m.consentError) return 'This Mac: lending record unavailable';
  if (!m.loaded) return 'Checking this Mac…';
  const prefix = 'This Mac: ';
  switch (m.state) {
    case 'working':
      return `${prefix}${m.running.length} of ${m.slots} runs busy · ${lendNames(m)}`;
    case 'pausing':
      return `${prefix}pausing · ${m.running.length} of ${m.slots} runs busy`;
    case 'paused':
      return `${prefix}paused`;
    case 'off':
      return `${prefix}off`;
    case 'ready':
      return `${prefix}ready · ${lendNames(m)}`;
    default:
      return `${prefix}not set up`;
  }
};

function PauseIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M9 5v14M15 5v14" />
    </svg>
  );
}

/**
 * Always in the header on the Harness: what this Mac is doing as a worker
 * right now. One click opens the panel; the icon beside it pauses or resumes
 * without opening anything.
 */
export function MachineStatusPill() {
  const m = useMachine();
  const { setModal } = useAdmin();
  if (!m.live) return null;
  const open = () => setModal({ kind: 'custom', render: (close) => <MachineModal onClose={close} /> });
  const toggle =
    !m.loaded || m.consentError ? null : m.state === 'working' || m.state === 'ready' ? (
      <Button kind="ghost" size="sm" title="Pause: what is running finishes, nothing new starts" onClick={() => void m.pause()}>
        <PauseIcon />
      </Button>
    ) : m.consented && (m.state === 'pausing' || m.state === 'paused') ? (
      <Button kind="ghost" size="sm" title="Resume: this Mac takes work again" onClick={() => void m.resume()}>
        <Icon name="play" size={13} />
      </Button>
    ) : null;
  return (
    <span className="aw-mpillbar">
      <button type="button" className="aw-mpill" title={m.loaded && !m.consentError ? `${HINT[m.state] ?? ''} Click for the panel.` : 'Open this Mac’s worker panel'} onClick={open}>
        <Dot state={STATE_DOT[m.state]} />
        {pillText(m)}
      </button>
      {toggle}
    </span>
  );
}

/* ————— the first-launch question ————— */

/**
 * Shows itself once, on the Harness, while the consent record is empty: what
 * runs here, whose subscriptions it spends, what it touches, and the two
 * answers. After either answer it never comes back by itself.
 */
export function MachineOnboarding() {
  const m = useMachine();
  const [dismissed, setDismissed] = useState(lendingDeferred);
  const show =
    m.live && m.loaded && !dismissed && !m.signedOut && !m.consentError && m.consent && !m.consent.acceptedAt && !m.consent.declinedAt;
  return show ? <OnboardingModal m={m} onClose={() => setDismissed(true)} /> : null;
}

function OnboardingModal({ m, onClose }) {
  const [lend, setLend] = useState(() => DEFAULT_LEND.slice());
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const options = showAll ? [...new Set([...Object.keys(LEND), ...m.offered])] : DEFAULT_LEND;
  const later = () => { deferLending(); onClose(); };
  const go = async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      onClose();
    } catch {
      setBusy(false); // act already said why; keep the form for a retry.
    }
  };
  return (
    <Modal kind="confirm"
      title="Lend this Mac to the fleet?"
      onClose={() => !busy && later()}
      actions={
        <>
          <Button disabled={busy} onClick={later}>Ask me later</Button>
          <Button disabled={busy} kind="ghost" onClick={() => void go(m.decline)}>Don't use this Mac</Button>
          <Button kind="primary" disabled={busy || !lend.length} onClick={() => void go(() => m.accept(lend))}>
            {busy ? 'Saving…' : 'Lend this Mac'}
          </Button>
        </>
      }
    >
      <p>
        Lending lets the fleet run approved client work on this Mac. It works in its own checkout under{' '}
        <span className="aw-mono">~/.cache/malipetek-runner</span>, using CPU, battery and network, and every run is a Harness
        conversation saved on this machine. Only tickets you approved run here.
      </p>
      <p className="aw-muted">Pick which subscriptions it may use. Each one runs tickets with that plan, and its usage counts against that plan’s own limits.</p>
      <div className="aw-mexes">
        {options.map((e) => (
          <label key={e} className="aw-mexe">
            <input
              type="checkbox"
              checked={lend.includes(e)}
              onChange={(ev) => setLend(ev.target.checked ? [...lend, e] : lend.filter((x) => x !== e))}
            />
            <span className="aw-mexe__name">{lendLabel(e)}</span>
            <span className="aw-muted">
              {LEND[e]?.plan ?? e} · {LEND[e]?.note ?? 'counts against that subscription'}
            </span>
          </label>
        ))}
      </div>
      <Button size="sm" kind="ghost" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
        {showAll ? 'Show recommended agents' : 'Show all agents'}
      </Button>
      <p className="aw-muted">
        You can pause it any time from the “This Mac” pill in the header — running work finishes, nothing new starts — and lend or
        un-lend single subscriptions from the Fleet view.
      </p>
    </Modal>
  );
}

/* ————— the panel ————— */

/** The pill’s modal: the panel with a frame. */
function MachineModal({ onClose }) {
  return (
    <Modal kind="create" title="This Mac as a fleet worker" onClose={onClose}>
      <MachinePanel />
    </Modal>
  );
}

const stateLine = (m) => {
  switch (m.state) {
    case 'working':
      return `Working — ${m.running.length} of ${m.slots} runs busy, lending ${lendNames(m)}.`;
    case 'pausing':
      return `Pausing — ${m.running.length} to finish, then nothing new.`;
    case 'paused':
      return 'Paused — takes no new work.';
    case 'ready':
      return `Ready — takes approved work when it arrives, lending ${lendNames(m)}.`;
    case 'off':
      return `Off — the launchd service is ${m.svc?.state ?? 'unknown'}${m.svc?.lastExit ? `, last exit ${m.svc.lastExit}` : ''}.`;
    default:
      return 'Not set up — no lending record yet.';
  }
};

/**
 * This machine's worker, in full: the state, Pause/Resume/Stop/Start, the
 * subscriptions it lends, what is running, the consent record, and the log.
 * Fleet shows it as the first node card; the header pill opens the same panel
 * in a modal. Both share the same machine store.
 */
export function MachinePanel() {
  const m = useMachine();
  const { openTicket, setModal } = useAdmin();
  if (!m.live) return null;
  if (!m.loaded || m.consentError) return (
    <article className="aw-node aw-machine">
      <header><h3>This Mac</h3></header>
      {!m.loaded ? <p className="aw-muted">Checking this Mac…</p> : (
        <div className="aw-inline">
          <span className="aw-warn" role="alert">Could not read the lending record</span>
          <Button size="sm" onClick={m.refresh}>Retry</Button>
        </div>
      )}
    </article>
  );
  const askAgain = () => setModal({ kind: 'custom', render: (close) => <OnboardingModal m={m} onClose={close} /> });
  return (
    <article className={cx('aw-node', 'aw-machine', `aw-node--${STATE_DOT[m.state] ?? 'warn'}`)}>
      <header>
        <Dot state={STATE_DOT[m.state]} />
        <h3>This Mac</h3>
        <span className="aw-muted">
          {m.nodeId || 'no node id yet'} · {m.svc?.state ?? 'unknown'}
          {m.svc?.pid ? ` · pid ${m.svc.pid}` : ''}
        </span>
        <span className="aw-toolbar__fill" />
        {m.state === 'working' || m.state === 'ready' ? (
          <Button size="sm" onClick={() => void m.pause()}>
            Pause
          </Button>
        ) : null}
        {m.consented && (m.state === 'pausing' || m.state === 'paused') ? (
          <Button size="sm" onClick={() => void m.resume()}>
            Resume
          </Button>
        ) : null}
        {m.serviceUp ? (
          <>
            <Button size="sm" kind="ghost" title="Restart the worker service" onClick={() => void m.restart()}>
              Restart
            </Button>
            <Button size="sm" kind="ghost" onClick={() => m.stopNow()}>
              Stop now
            </Button>
          </>
        ) : m.consented ? (
          <Button size="sm" kind="primary" onClick={() => void m.start()}>
            {m.svc?.loaded ? 'Start worker' : 'Install worker'}
          </Button>
        ) : null}
      </header>

      <p className={cx('aw-mstate', (m.state === 'off' || m.state === 'unset') && 'aw-warn')}>{stateLine(m)}</p>
      {m.error ? <p className="aw-warn">Could not read this Mac’s worker: {m.error}</p> : null}

      {m.consented ? (
        <dl className="aw-kv">
          <dt>Lends</dt>
          <dd>
            <div className="aw-mexes">
              {[...new Set([...DEFAULT_LEND, ...m.offered, ...m.lending])].map((e) => {
                const health = m.node?.health?.executors?.[e];
                const on = m.lending.includes(e);
                return (
                  <label key={e} className="aw-mexe" title={LEND[e]?.note ?? undefined}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(ev) =>
                        void m.setLend(ev.target.checked ? [...m.lending, e] : m.lending.filter((x) => x !== e))
                      }
                    />
                    <span className="aw-mexe__name">{lendLabel(e)}</span>
                    <span className="aw-muted">{LEND[e]?.plan ?? e}</span>
                    {health ? <Tag tone={health.ok ? undefined : 'bad'}>{e}{health.version ? ` ${health.version}` : ''}</Tag> : null}
                  </label>
                );
              })}
            </div>
            {!m.lending.length ? <span className="aw-warn">Nothing lent — this Mac takes no work.</span> : null}
          </dd>
        </dl>
      ) : null}

      {m.running.length ? (
        <ul className="aw-rows">
          {m.running.map((r) => (
            <li key={r.id} className="aw-row" onClick={() => openTicket(r.ticket_id)}>
              <span className="aw-live" />
              <span className="aw-mono aw-muted">#{r.ticket_id}</span>
              <span className="aw-row__title">{r.title}</span>
              <span className="aw-muted">
                {r.executor} · {ago(r.started_at)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="aw-muted">
        {m.consented ? (
          <>
            Lent since {when(m.consent.acceptedAt)}.
            <Button size="sm" kind="ghost" title="Record a no and drain the node; running work finishes" onClick={m.withdraw}>
              Stop lending
            </Button>
          </>
        ) : m.consent?.declinedAt ? (
          <>
            Declined {when(m.consent.declinedAt)}
            {m.consent.acceptedAt ? ` (previously lent ${when(m.consent.acceptedAt)})` : ''}.
            <Button size="sm" kind="ghost" onClick={askAgain}>
              Lend this Mac…
            </Button>
          </>
        ) : (
          <>
            No lending record yet.
            <Button size="sm" kind="primary" onClick={askAgain}>
              Decide now…
            </Button>
          </>
        )}
      </p>

      {m.info?.local?.log ? (
        <details className="aw-mlog">
          <summary>Worker log</summary>
          <pre className="aw-log">{m.info.local.log}</pre>
        </details>
      ) : null}
    </article>
  );
}
