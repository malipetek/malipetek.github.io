/* The fleet (nodes, queue, runs), the directory (clients, projects), and settings. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LOCALES } from '../../../src/lib/locales.js';
import { useAdmin, usePoll } from './store.js';
import { EXECUTORS, PRIORITIES, ago, chargeOf, money, priorityName, span, usd } from './format.js';
import { AskSuperagentButton } from './superagent-ask.jsx';
import { clientsLabel, projectRows } from './projects-model.mjs';
import {
  Button,
  Chips,
  DataTable,
  Empty,
  EmptyState,
  Field,
  FilterBar,
  FormPane,
  Inspector,
  MetaChip,
  Modal,
  PageHeader,
  Panel,
  SaveBar,
  Segmented,
  Skeleton,
  StateIndicator,
  Tag,
  UiStyles,
  useMedia,
} from './ui/index.js';
import { HealthView } from './health.jsx';
import { MachinePanel, useMachine } from './machine.jsx';
import { ToolboxPanel } from './toolbox.jsx';
import { MarketingSettings } from './marketing.jsx';
import { SeoSettings } from './seo.jsx';
import { onSettingsSection, openSettings, settingsSection, takePendingSection } from './settings-link.js';

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

const capabilityLabel = (id, caps) => caps.find((c) => c.id === id)?.label ?? ({
  'os:darwin': 'macOS', 'os:linux': 'Linux', 'os:win32': 'Windows',
}[id] ?? id.replace(/^os:/, ''));

const osLabel = (os) => (os ? capabilityLabel(`os:${os}`, []) : '—');

/** Escape closes an Inspector from anywhere in its workspace, unless something nearer used it. */
const closeOnEscape = (open, close) => (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || !open) return;
  if (e.target?.closest?.('input, textarea, select, [contenteditable], [role=menu], [role=dialog]')) return;
  e.preventDefault();
  close();
};

/** At ≤900px the Inspector sits below the list: bring it into view when the selection changes. */
function useRevealInspector(root, key) {
  const narrow = useMedia('(max-width: 900px)');
  useEffect(() => {
    if (narrow && key != null) root.current?.querySelector('.ui-inspector')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [narrow, key, root]);
}

/** A ticket title as a link: a plain click opens the ticket; modifier clicks stay the browser's. */
function TicketLink({ id, children }) {
  const { openTicket } = useAdmin();
  return (
    <a
      className="aw-titlelink"
      href={`#ticket=${id}`}
      tabIndex={-1}
      title={typeof children === 'string' ? children : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return void e.stopPropagation();
        e.preventDefault();
        e.stopPropagation();
        openTicket(id);
      }}
    >
      {children}
    </a>
  );
}

/** The one state word a node row shows: online, draining or offline (This Mac before it registers: what its worker says). */
function nodeStateProps(n, m) {
  if (n.unregistered) {
    if (!m.loaded) return { state: 'checking', label: 'Checking…' };
    if (m.state === 'unset') return { state: 'unset', label: 'Not set up', tone: 'warn' };
    return { state: 'unregistered', label: m.serviceUp ? 'Not registered yet' : 'Off', tone: m.serviceUp ? 'warn' : 'bad' };
  }
  if (!n.online) return { state: 'offline', label: `Offline · ${ago(n.lastSeenAt)}`, title: `Last seen ${ago(n.lastSeenAt)} ago` };
  if (n.draining) return { state: 'draining', label: 'Draining', tone: 'warn', title: 'Finishes what it has, then takes nothing new' };
  return { state: 'online' };
}

const unhealthy = (n) => (n.executors ?? []).filter((e) => n.health?.executors?.[e] && !n.health.executors[e].ok);

function workloadLine(n) {
  const sys = n.health?.system;
  const parts = [`${n.running.length}/${n.slots} busy`];
  if (sys) {
    const load = sys.load?.[0]?.toFixed?.(2);
    if (load != null) parts.push(`load ${load}/${sys.cpus ?? '?'}`);
    if (sys.memFreePct != null) parts.push(`mem ${100 - sys.memFreePct}%`);
    if (sys.disk) parts.push(`disk ${pct(sys.disk.totalGb - sys.disk.freeGb, sys.disk.totalGb)}%`);
  }
  return parts.join(' · ');
}

const NODE_COLUMNS = (m) => [
  {
    key: 'name',
    header: 'Node',
    render: (n) => (
      <>
        {n.local ? <><MetaChip>This Mac</MetaChip> </> : null}
        <strong title={n.id}>{n.id}</strong>
      </>
    ),
  },
  { key: 'state', header: 'State', fit: true, render: (n) => <StateIndicator {...nodeStateProps(n, m)} /> },
  { key: 'platform', header: 'Platform', fit: true, render: (n) => (n.unregistered ? '—' : `${osLabel(n.os)} · v${n.version}`) },
  {
    key: 'agents',
    header: 'Agents',
    render: (n) => {
      const bad = unhealthy(n);
      return (
        <>
          {bad.length ? (
            <>
              <StateIndicator state="check" label={`${bad.length} not healthy`} title={bad.map((e) => `${e}: ${n.health.executors[e].error ?? 'not healthy'}`).join('; ')} />{' '}
            </>
          ) : null}
          <span title={n.executors.join(', ') || undefined}>{n.executors.length ? n.executors.join(', ') : '—'}</span>
        </>
      );
    },
  },
  { key: 'workload', header: 'Workload', render: (n) => (n.unregistered ? '—' : <span title={workloadLine(n)}>{workloadLine(n)}</span>) },
  {
    key: 'battery',
    header: 'Battery',
    fit: true,
    render: (n) => {
      const b = n.health?.system?.battery;
      return b ? <span title={b.onPower ? 'On power' : 'On battery'}>{b.percent}%{b.onPower ? ' ⚡' : ''}</span> : '—';
    },
  },
  { key: 'projects', header: 'Projects', numeric: true, render: (n) => <span title={n.slugs.join(', ') || 'No projects yet'}>{n.slugs.length}</span> },
];

/** A run on a node, in the Inspector: the ticket opens on Enter, a click on the title, or a double-click. */
function RunsTable({ runs, label, empty }) {
  const { openTicket } = useAdmin();
  return (
    <DataTable
      label={label}
      rows={runs}
      onOpen={(r) => openTicket(r.ticket_id)}
      empty={empty}
      columns={[
        { key: 'title', header: 'Title', render: (r) => <TicketLink id={r.ticket_id}>{r.title}</TicketLink> },
        { key: 'id', header: '#', mono: true, fit: true, render: (r) => `#${r.ticket_id}` },
        { key: 'agent', header: 'Agent', fit: true, render: (r) => r.executor },
        { key: 'started', header: 'Started', fit: true, render: (r) => `${ago(r.started_at)} ago` },
      ]}
    />
  );
}

/**
 * The node Inspector: its state, its actions (Drain/Resume, Edit, Forget; on
 * This Mac the worker's Pause/Resume, Restart, Stop now, Start), telemetry,
 * agents, capabilities, projects, what it runs, and on This Mac the lending
 * panel (subscriptions it lends, the consent record, the worker log).
 */
function NodeInspector({ n, m, onClose }) {
  const { api, act, ask, data, setModal } = useAdmin();
  const caps = data.catalog?.capabilities ?? [];
  const sys = n.health?.system;
  const edit = () => setModal({ kind: 'custom', render: (close) => <NodeModal node={n} local={n.local} onClose={close} /> });
  const machineReady = n.local && m.loaded && !m.consentError;
  return (
    <Inspector title={n.id} label={`Node ${n.id}`} storageKey="ptech.fleet.inspector.w" onClose={onClose} className="aw-fleet__inspector">
      <div className="ui-meta">
        <StateIndicator {...nodeStateProps(n, m)} />
        {n.local ? <MetaChip>This Mac</MetaChip> : null}
      </div>
      <div className="ui-actions">
        {n.local ? (
          machineReady ? (
            <>
              {m.state === 'working' || m.state === 'ready' ? <Button title="What is running finishes, nothing new starts" onClick={() => void m.pause()}>Pause</Button> : null}
              {m.consented && (m.state === 'pausing' || m.state === 'paused') ? <Button title="This Mac takes work again" onClick={() => void m.resume()}>Resume</Button> : null}
              {m.serviceUp ? (
                <>
                  <Button kind="ghost" title="Restart the worker service" onClick={() => void m.restart()}>Restart</Button>
                  <Button kind="ghost" onClick={() => m.stopNow()}>Stop now</Button>
                </>
              ) : m.consented ? (
                <Button kind="primary" onClick={() => void m.start()}>{m.svc?.loaded ? 'Start worker' : 'Install worker'}</Button>
              ) : null}
            </>
          ) : null
        ) : (
          <Button
            onClick={() => act(() => api('PATCH', `/admin/nodes/${n.id}`, { draining: !n.draining }), n.draining ? `${n.id} takes work again.` : `${n.id} finishes what it has, then takes nothing new.`)}
          >
            {n.draining ? 'Resume' : 'Drain'}
          </Button>
        )}
        {!n.unregistered ? <Button kind="ghost" onClick={edit}>Edit…</Button> : null}
        {!n.local && !n.online ? (
          <Button
            kind="ghost"
            onClick={() => ask({ title: `Forget ${n.id}?`, text: 'It re-registers on its next heartbeat if it is still alive.', confirm: 'Forget', danger: true, run: () => act(() => api('DELETE', `/admin/nodes/${n.id}`), `Forgot ${n.id}.`) })}
          >
            Forget…
          </Button>
        ) : null}
      </div>
      <dl className="ui-props">
        {n.local ? (
          <>
            <dt>Worker</dt>
            <dd>{m.svc?.state ?? 'unknown'}{m.svc?.pid ? ` · pid ${m.svc.pid}` : ''}</dd>
          </>
        ) : null}
        {!n.unregistered ? (
          <>
            <dt>Platform</dt>
            <dd>{osLabel(n.os)} · v{n.version}</dd>
            <dt>Last seen</dt>
            <dd>{ago(n.lastSeenAt)} ago</dd>
            <dt>Workload</dt>
            <dd>{n.running.length} of {n.slots} runs busy</dd>
          </>
        ) : null}
        {sys ? (
          <>
            <dt>Load</dt>
            <dd>{sys.load?.[0]?.toFixed?.(2) ?? '—'} on {sys.cpus} CPUs</dd>
            {sys.memFreePct != null ? (<><dt>Memory</dt><dd>{100 - sys.memFreePct}% used</dd></>) : null}
            {sys.disk ? (<><dt>Disk</dt><dd>{pct(sys.disk.totalGb - sys.disk.freeGb, sys.disk.totalGb)}% used · {sys.disk.freeGb} GB free</dd></>) : null}
            {sys.battery ? (<><dt>Battery</dt><dd>{sys.battery.percent}% · {sys.battery.onPower ? 'on power' : 'on battery'}</dd></>) : null}
            {sys.uptimeSec != null ? (<><dt>Up</dt><dd>{span(sys.uptimeSec)}</dd></>) : null}
          </>
        ) : null}
      </dl>
      {n.health?.process?.lastError ? (
        <div className="ui-section">
          <StateIndicator state="failed" label="Last error" />
          <p className="ui-quote">{n.health.process.lastError}</p>
        </div>
      ) : null}
      {!n.local && !n.unregistered ? (
        <div className="ui-section">
          <h3 className="ui-section__title">Agents</h3>
          <div className="ui-meta">
            {n.executors.length ? n.executors.map((e) => {
              const ex = n.health?.executors?.[e];
              return ex ? (
                <StateIndicator key={e} state={ex.ok ? 'ok' : 'failed'} label={`${e}${ex.version ? ` ${ex.version}` : ''}`} title={ex.ok ? undefined : ex.error ?? 'not healthy'} />
              ) : (
                <StateIndicator key={e} state="unchecked" label={e} title="No health report yet" />
              );
            }) : <span className="ui-note">None</span>}
          </div>
        </div>
      ) : null}
      {!n.unregistered ? (
        <>
          <div className="ui-section">
            <h3 className="ui-section__title">Can do</h3>
            <div className="ui-meta">
              {n.capabilities.length ? n.capabilities.map((c) => <MetaChip key={c}>{capabilityLabel(c, caps)}</MetaChip>) : <span className="ui-note">—</span>}
            </div>
          </div>
          <div className="ui-section">
            <h3 className="ui-section__title">Projects · {n.slugs.length}</h3>
            <div className="ui-meta">
              {n.slugs.length ? n.slugs.map((s) => <MetaChip key={s} mono>{s}</MetaChip>) : <span className="ui-note">No projects yet</span>}
            </div>
          </div>
          <div className="ui-section">
            <h3 className="ui-section__title">Running · {n.running.length} of {n.slots}</h3>
            <RunsTable runs={n.running} label={`Runs on ${n.id}`} empty={{ title: 'Nothing running.', hint: `${n.slots} free ${n.slots === 1 ? 'slot' : 'slots'}.` }} />
          </div>
        </>
      ) : null}
      {n.local ? (
        <div className="ui-section aw-fleet-machine">
          <h3 className="ui-section__title">Lending</h3>
          <MachinePanel />
        </div>
      ) : null}
    </Inspector>
  );
}

function NodeModal({ node, local, onClose }) {
  const { api, act, data } = useAdmin();
  const caps = data.catalog?.capabilities ?? [];
  const [slots, setSlots] = useState(node.overrides?.slots ?? node.slots);
  const [executors, setExecutors] = useState(node.overrides?.executors ?? node.executors);
  const [capabilities, setCapabilities] = useState(node.overrides?.capabilities ?? node.capabilities.filter((c) => !c.startsWith('os:')));
  const save = () =>
    act(() => api('PATCH', `/admin/nodes/${node.id}`, { overrides: { slots, capabilities, ...(!local ? { executors } : {}) } }), `${node.id} picks this up on its next heartbeat.`).then(onClose, () => undefined);
  return (
    <Modal kind="create"
      title={`Node ${node.id}`}
      subtitle="Overrides from here win over the node’s own config file."
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Slots" hint="How many items it runs at once.">
        <Segmented value={slots} options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} onChange={setSlots} />
      </Field>
      <Field label="Agents it offers">
        {local ? <p className="aw-muted">Manage the agents this Mac lends from This Mac.</p> : (
          <Chips value={executors} options={EXECUTORS.map((e) => ({ value: e, label: e }))} onChange={setExecutors} />
        )}
      </Field>
      <Field label="Capabilities">
        <Chips value={capabilities} options={caps.map((c) => ({ value: c.id, label: capabilityLabel(c.id, caps), hint: c.hint }))} onChange={setCapabilities} />
      </Field>
    </Modal>
  );
}

export function FleetView() {
  const { data, open, openTicket } = useAdmin();
  const m = useMachine();
  const root = useRef(null);
  const [selectedKey, setSelectedKey] = useState(null);
  const nodes = useMemo(() => {
    const list = data.nodes.map((n) => ({ ...n, local: m.live && Boolean(m.nodeId) && n.id === m.nodeId }));
    // This Mac first. Before its node registers, it still has a row, so its controls stay one click away.
    if (m.live && !list.some((n) => n.local)) {
      list.unshift({ id: m.nodeId || 'This Mac', local: true, unregistered: true, online: false, draining: false, slots: m.slots, executors: m.lending, capabilities: [], slugs: [], running: [] });
    }
    return list.sort((a, b) => Number(b.local) - Number(a.local));
  }, [data.nodes, m.live, m.nodeId, m.slots, m.lending]);
  const keyOf = (n) => (n.unregistered ? '__this-mac' : n.id);
  const selected = selectedKey == null ? null : nodes.find((n) => keyOf(n) === selectedKey) ?? null;
  const close = () => setSelectedKey(null);
  useRevealInspector(root, selected ? selectedKey : null);
  const runs = [...data.running, ...data.recent].slice(0, 8);
  return (
    <div ref={root} className="ui-workspace aw-fleet" onKeyDown={closeOnEscape(Boolean(selected), close)}>
      <UiStyles />
      <PageHeader
        title="Fleet"
        subtitle="The machines that run agents, what waits for them, and the end-to-end checks. Select a node to inspect it."
        overflow={[{ label: 'Settings: work queue…', run: () => openSettings(open, 'queue') }]}
      />
      <div className="ui-split">
        <div className="ui-split__main">
          <HealthView compact />
          <section className="ui-section">
            <h3 className="ui-section__title">Nodes · {nodes.length}</h3>
            <DataTable
              label="Nodes"
              columns={NODE_COLUMNS(m)}
              rows={nodes}
              rowKey={keyOf}
              selected={selected ? selectedKey : null}
              onSelect={(n) => setSelectedKey(keyOf(n))}
              onOpen={(n) => setSelectedKey(keyOf(n))}
              empty={{ title: 'No node has connected yet.', hint: 'Open the desktop app and lend This Mac from the status bar, or start a node with its config file.' }}
            />
          </section>
          <section className="ui-section">
            <h3 className="ui-section__title">Queue · {data.queue.length}</h3>
            <DataTable
              label="Queue"
              rows={data.queue}
              onOpen={(q) => openTicket(q.id)}
              empty={{ title: 'Nothing is waiting.', hint: 'Approved work starts as soon as a node with a free slot can take it.' }}
              columns={[
                { key: 'title', header: 'Title', render: (q) => <TicketLink id={q.id}>{q.title}</TicketLink> },
                { key: 'id', header: '#', mono: true, fit: true, render: (q) => `#${q.id}` },
                { key: 'project', header: 'Project', fit: true, render: (q) => q.slug ?? '—' },
                { key: 'priority', header: 'Priority', fit: true, render: (q) => priorityName(q.priority) },
                { key: 'waiting', header: 'Waiting', numeric: true, render: (q) => span(q.waitingSeconds) },
                {
                  key: 'why',
                  header: 'Why waiting',
                  render: (q) =>
                    q.eligible.length ? (
                      <span title={q.reason}>{q.reason}</span>
                    ) : (
                      <span title={q.reason}>
                        <StateIndicator state="stuck" tone="bad" label="Blocked" /> {q.reason || 'No node can take this'}
                      </span>
                    ),
                },
              ]}
            />
          </section>
          <section className="ui-section">
            <h3 className="ui-section__title">Recent runs</h3>
            <DataTable
              label="Recent runs"
              rows={runs}
              onOpen={(r) => openTicket(r.ticket_id)}
              empty={{ title: 'No runs yet.', hint: 'Runs appear here when a node starts approved work.' }}
              columns={[
                { key: 'title', header: 'Title', render: (r) => <TicketLink id={r.ticket_id}>{r.title}</TicketLink> },
                { key: 'id', header: '#', mono: true, fit: true, render: (r) => `#${r.ticket_id}` },
                {
                  key: 'result',
                  header: 'Result',
                  fit: true,
                  render: (r) => (r.status === 'running' || !r.status ? <StateIndicator state="running" /> : <StateIndicator state={r.status} />),
                },
                { key: 'agent', header: 'Agent', render: (r) => <span title={r.model ? `${r.executor} ${r.model}` : r.executor}>{r.executor}{r.model ? <span className="ui-note"> {r.model}</span> : null}</span> },
                { key: 'node', header: 'Node', fit: true, render: (r) => r.node_id ?? 'This Mac' },
                { key: 'cost', header: 'Cost', numeric: true, render: (r) => usd(r.cost_micro_usd) },
                { key: 'finished', header: 'Finished', fit: true, render: (r) => (r.finished_at ? `${ago(r.finished_at)} ago` : '—') },
              ]}
            />
          </section>
        </div>
        {selected ? <NodeInspector n={selected} m={m} onClose={close} /> : null}
      </div>
    </div>
  );
}

const usageLine = (u) =>
  u
    ? [
        u.billedCents && `${money(u.billedCents)} billed`,
        u.openCents && `${money(u.openCents)} open`,
        u.aiCents && `AI ${money(u.aiCents)}`,
        u.ourCents && `first previews ${money(u.ourCents)} on us`,
      ]
        .filter(Boolean)
        .join(' · ') || 'nothing owed'
    : '';

export function RepoModal({ project, onClose }) {
  const { api, act, data } = useAdmin();
  const [repo, setRepo] = useState(project.repo ?? '');
  const key = (value) => String(value ?? '').trim().replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();
  const taken = Boolean(repo.trim()) && data.projects.some((p) => p.id !== project.id && key(p.repo) === key(repo));
  const submit = () => act(() => api('PUT', `/admin/projects/${project.id}/repo`, { repo: repo.trim() }), 'Repo saved.').then(onClose, () => undefined);
  return (
    <Modal kind="create"
      title={`Repo for ${project.name}`}
      subtitle="Nodes clone this on their next sync. A private repo needs a node whose git can reach it."
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!repo.trim() || taken} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Repo URL" hint={taken ? 'Another project already uses this repository. One repo, one project.' : undefined}>
        <input className="aw-mono" value={repo} maxLength={300} aria-invalid={taken || undefined} placeholder="https://github.com/owner/repo" onChange={(e) => setRepo(e.target.value)} />
      </Field>
    </Modal>
  );
}

/**
 * The account's one free first preview: its limit for this client, and the
 * grant again when it has been used.
 */
function FirstPreviewControl({ c }) {
  const { api, act, data } = useAdmin();
  const globalLimit = data.settings?.first_preview_limit_usd;
  const [usd, setUsd] = useState(c.firstPreviewLimitUsd ?? '');
  useEffect(() => setUsd(c.firstPreviewLimitUsd ?? ''), [c.id, c.firstPreviewLimitUsd]);
  const save = () => {
    const raw = String(usd).trim();
    const value = raw === '' ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1000)) return;
    if (value === (c.firstPreviewLimitUsd ?? null)) return;
    void act(() => api('PATCH', `/admin/clients/${c.id}`, { firstPreviewLimitUsd: value }), 'First preview limit saved.');
  };
  return (
    <Field
      label="First preview limit (USD)"
      hint={`Blank follows the setting (${globalLimit ?? 2}). 0 turns the first preview off for this client.`}
    >
      <div className="aw-inline">
        <input
          inputMode="decimal"
          value={usd}
          placeholder={String(globalLimit ?? 2)}
          aria-label="First preview limit in dollars"
          onChange={(e) => setUsd(e.target.value)}
          onBlur={save}
        />
        <span className="aw-muted">
          {c.first_preview_at ? `used ${ago(c.first_preview_at)} ago` : 'not used yet'}
        </span>
        {c.first_preview_at ? (
          <Button
            size="sm"
            title="Give this account its free first preview again"
            onClick={() => void act(() => api('PATCH', `/admin/clients/${c.id}`, { grantFirstPreview: true }), 'First preview granted again.')}
          >
            Grant again
          </Button>
        ) : null}
      </div>
    </Field>
  );
}

/** A client’s bill, language, translator and projects. */
function ClientControls({ c }) {
  const { api, act, data } = useAdmin();
  return (
    <>
      <p className="aw-muted">{usageLine(c.usage)}</p>
      <div className="ui-actions">
        <select
          aria-label="Language"
          value={c.locale ?? 'en-US'}
          onChange={(e) => void act(() => api('PATCH', `/admin/clients/${c.id}`, { locale: e.target.value }), 'Language saved.')}
        >
          {LOCALES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.english}
            </option>
          ))}
        </select>
        <select
          aria-label="Translation"
          title="Who translates this client’s messages. They can change it themselves."
          value={c.translation ?? 'deepseek'}
          onChange={(e) => void act(() => api('PATCH', `/admin/clients/${c.id}`, { translation: e.target.value }), 'Saved.')}
        >
          <option value="deepseek">DeepSeek</option>
          <option value="cloudflare">Workers AI</option>
          <option value="off">no translation</option>
        </select>
      </div>
      {c.role !== 'admin' ? <FirstPreviewControl c={c} /> : null}
      <InviteControls c={c} />
    </>
  );
}

/** Where an invite got to, and the two things Ali can do about it. */
function InviteControls({ c }) {
  const { api, act, ask } = useAdmin();
  // Once they have signed in, the invite row stops mattering: the normal
  // controls and their live session cover the account.
  if (!c.pending && !c.inviteExpiresAt) return null;
  const left = c.inviteExpiresAt ? Math.max(0, c.inviteExpiresAt - Date.now() / 1000) : 0;
  return (
    <div className="aw-inline">
      <StateIndicator state={c.pending ? 'invited' : 'invite_live'} tone={c.pending ? 'warn' : 'info'} label={c.pending ? 'Invited, not signed in yet' : 'Invite link live'} title={c.email} />
      {left > 0 ? <span className="aw-muted">link expires in {span(left)}</span> : <span className="aw-muted">link expired</span>}
      <Button
        size="sm"
        title="Send a fresh link. The old unused links stop working."
        onClick={() => void act(() => api('POST', `/admin/clients/${c.id}/invite`, {}), `Invite resent to ${c.email}.`)}
      >
        Resend
      </Button>
      <Button
        size="sm"
        kind="ghost"
        title="Every unused invite link stops working. A signed-in session is not touched."
        onClick={() => ask({
          title: `Revoke invite for ${c.name || c.email}?`,
          text: `Unused invite links for ${c.email} stop working. Existing signed-in sessions are not affected.`,
          confirm: 'Revoke link',
          danger: true,
          run: () => act(() => api('DELETE', `/admin/clients/${c.id}/invite`), 'Invite link revoked.').catch(() => undefined),
        })}
      >
        Revoke
      </Button>
    </div>
  );
}

/** Invite a client to existing projects: email, who, language, which projects, a note. */
function InviteClientModal({ onClose, client }) {
  const { api, act, data } = useAdmin();
  const [email, setEmail] = useState(client?.email ?? '');
  const [name, setName] = useState(client?.name ?? '');
  const [locale, setLocale] = useState(client?.locale ?? 'en-US');
  const [projectIds, setProjectIds] = useState(data.projects.length === 1 ? [data.projects[0].id] : []);
  const [note, setNote] = useState('');
  const ready = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && projectIds.length > 0;
  const send = () =>
    act(
      () =>
        api('POST', '/admin/clients', {
          email: email.trim(),
          name: name.trim() || undefined,
          locale,
          projectIds,
          note: note.trim() || undefined,
        }),
      (out) =>
        out.invite?.sent === false
          ? `Added ${email.trim()}, but the email could not be sent. Use Resend on their row in Clients.`
          : out.user?.verified_at
            ? `${email.trim()} now has ${projectIds.length} more project${projectIds.length === 1 ? '' : 's'} and a new link.`
            : `Invited ${email.trim()}.`,
    ).then(onClose, () => undefined);
  return (
    <Modal
      title={client ? `Add ${client.name || client.email} to projects` : 'Invite a client'}
      kind="create"
      subtitle="They get a link that signs them in for the projects you pick. No sign-up needed; the link works once and lasts 7 days."
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!ready} onClick={send}>
            Send invite
          </Button>
        </>
      }
    >
      <Field label="Email">
        <input type="email" value={email} maxLength={254} placeholder="client@example.com" onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Name" hint="Optional. The account keeps its own name if it already exists.">
        <input value={name} maxLength={80} placeholder="Their name" onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Language" hint="The language of the invite email and the portal. They can change it.">
        <select value={locale} onChange={(e) => setLocale(e.target.value)}>
          {LOCALES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.english}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Projects" hint="At least one. An existing account gains these and keeps the rest. They see every request on them.">
        {data.projects.length ? (
          <Chips value={projectIds} options={data.projects.map((p) => ({ value: p.id, label: p.name }))} onChange={setProjectIds} />
        ) : (
          <span className="aw-warn">No projects yet. Make one first.</span>
        )}
      </Field>
      <Field label="Note" hint="Optional. Your own words, added under the link. Not translated.">
        <textarea rows={3} value={note} maxLength={1000} placeholder="Anything you want them to read first" onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

/** Ali's hand edits to a project: its name and what it is. The slug stays (nodes and sites hang off it). */
export function ProjectEditModal({ project, onClose }) {
  const { api, act } = useAdmin();
  const [name, setName] = useState(project.name);
  const [kind, setKind] = useState(project.kind ?? 'existing');
  const changed = name.trim() !== project.name || kind !== (project.kind ?? 'existing');
  const save = () =>
    act(
      () =>
        api('PATCH', `/admin/projects/${project.id}`, {
          ...(name.trim() !== project.name ? { name: name.trim() } : {}),
          ...(kind !== (project.kind ?? 'existing') ? { kind } : {}),
        }),
      'Project saved.',
    ).then(onClose, () => undefined);
  return (
    <Modal kind="create"
      title={`Edit ${project.name}`}
      subtitle={`Slug ${project.slug} stays: nodes keep its folder under that name, and its first site is named after it.`}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!name.trim() || !changed} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Name" hint="What the client sees in the portal and in their emails.">
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
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
    </Modal>
  );
}

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const emailsIn = (text) => [...new Set(text.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];

/**
 * Add one or more addresses to a project. Each one is an ordinary invite: a new
 * address gets an account, an existing one gains the project. With copies on,
 * they are also mailed about every request on it, not only their own.
 */
function AddPeopleModal({ project, onClose }) {
  const { api, act, notify } = useAdmin();
  const [text, setText] = useState('');
  const [copy, setCopy] = useState(true);
  const [locale, setLocale] = useState('en-US');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const emails = emailsIn(text);
  const bad = emails.filter((e) => !EMAIL.test(e));
  const already = new Set((project.clients ?? []).map((c) => c.email.toLowerCase()));
  const fresh = emails.filter((e) => EMAIL.test(e) && !already.has(e));
  const send = async () => {
    setBusy(true);
    const failed = [];
    let unsent = 0;
    try {
      await act(async () => {
        for (const email of fresh) {
          try {
            const out = await api('POST', '/admin/clients', {
              email,
              locale,
              projectIds: [project.id],
              copy,
              note: note.trim() || undefined,
            });
            if (out?.invite?.sent === false) unsent += 1;
          } catch {
            failed.push(email);
          }
        }
      });
      const added = fresh.length - failed.length;
      if (failed.length) notify(`Added ${added} of ${fresh.length}. Not added: ${failed.join(', ')}`, 'error');
      else notify(`Added ${added} to ${project.name}.${unsent ? ` ${unsent} email${unsent === 1 ? '' : 's'} not sent; use Resend on their card.` : ''}`);
      if (!failed.length) onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal kind="create"
      title={`Add people to ${project.name}`}
      subtitle="Each address gets a link that signs them in (one use, 7 days). They see every request on this project; prices stay with whoever filed."
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={busy || !fresh.length || bad.length > 0} onClick={() => void send()}>
            {busy ? 'Adding…' : `Add ${fresh.length || ''}`.trim()}
          </Button>
        </>
      }
    >
      <Field
        label="Emails"
        hint={
          bad.length
            ? `Not an address: ${bad.join(', ')}`
            : emails.length > fresh.length
              ? `${emails.length - fresh.length} already on the project.`
              : 'One or more, separated by commas, spaces or new lines.'
        }
      >
        <textarea rows={3} value={text} placeholder="owner@example.com, office@example.com" onChange={(e) => setText(e.target.value)} />
      </Field>
      <Field label="Emails about requests">
        <label className="aw-check">
          <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
          Send them a copy of every request on this project (new requests, Ali’s replies, status changes)
        </label>
      </Field>
      <Field label="Language" hint="For new accounts: the invite email and the portal. Existing accounts keep theirs.">
        <select value={locale} onChange={(e) => setLocale(e.target.value)}>
          {LOCALES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.english}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Note" hint="Optional. Added under the link. Not translated.">
        <textarea rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

/** Everyone on a project: their copies switch, and taking them off it. */
export function ProjectPeople({ project: p }) {
  const { api, act, ask, setModal, open } = useAdmin();
  const people = p.clients ?? [];
  return (
    <div className="aw-people">
      <div className="aw-row-h">
        <span className="aw-muted">People {people.length ? `(${people.length})` : ''}</span>
        <span className="aw-toolbar__fill" />
        <Button size="sm" onClick={() => setModal({ kind: 'custom', render: (close) => <AddPeopleModal project={p} onClose={close} /> })}>
          Add people
        </Button>
      </div>
      {people.length ? (
        <ul>
          {people.map((person) => (
            <li key={person.id}>
              <button type="button" className="aw-link aw-people__who" title={person.email} onClick={() => open(`c:${person.id}`)}>
                {person.name ? `${person.name} · ` : ''}
                {person.email}
              </button>
              {person.pending ? <Tag tone="warn">invited</Tag> : null}
              <label className="aw-check" title="Mail them about every request on this project, not only the ones they filed">
                <input
                  type="checkbox"
                  checked={person.copy}
                  onChange={(e) =>
                    void act(
                      () => api('PUT', `/admin/clients/${person.id}/projects/${p.id}`, { copy: e.target.checked }),
                      e.target.checked ? `${person.email} gets every request on ${p.name}.` : `${person.email} gets only their own requests.`,
                    )
                  }
                />
                all emails
              </label>
              <Button
                size="sm"
                kind="ghost"
                title="Take them off this project"
                onClick={() =>
                  ask({
                    title: `Remove ${person.email} from ${p.name}?`,
                    text: 'They stop seeing its requests and stop getting its emails. Their account and their own requests stay.',
                    confirm: 'Remove',
                    danger: true,
                    run: () => act(() => api('DELETE', `/admin/clients/${person.id}/projects/${p.id}`), `Removed ${person.email}.`).catch(() => undefined),
                  })
                }
              >
                ✕
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="aw-muted">Nobody yet. Only you see it.</p>
      )}
    </div>
  );
}

const closedTicket = (t) => ['done', 'declined'].includes(t.status);
const ticketsOf = (data, c) =>
  data.tickets
    .filter((t) => t.kind !== 'system' && t.client_email === c.email)
    .sort((x, y) => closedTicket(x) - closedTicket(y) || y.updated_at - x.updated_at);
const lastSeenOf = (c) => c.lastSeenAt ?? c.last_seen_at ?? null;
const TRANSLATION_LABEL = { deepseek: 'DeepSeek', cloudflare: 'Workers AI', off: 'No translation' };
const localeName = (code) => LOCALES.find((l) => l.code === code)?.english ?? code;

/** Can a node build this project: one online and taking work, only offline or draining ones, or none. */
function projectNodeState(p, nodes) {
  const holders = nodes.filter((n) => n.slugs.includes(p.slug));
  if (holders.some((n) => n.online && !n.draining)) return { state: 'online', label: 'Node available' };
  if (holders.length) return { state: 'draining', tone: 'warn', label: 'Nodes offline or draining' };
  return { state: 'no_node', tone: 'bad', label: 'No node has this project' };
}

const siteStateOf = (p) => {
  const sites = p.sites ?? (p.site ? [p.site] : []);
  if (!sites.length) return 'No site';
  const states = [...new Set(sites.map((site) => site.state?.replaceAll('_', ' ')).filter(Boolean))];
  return states.join(', ') || 'Site status unavailable';
};

/** One client: who they are, what they owe, and every request they filed, open ones first. */
/**
 * Assign a client to projects: search, multi-select, one save. Replaces the
 * flat chip row, which stopped working once there were more than a handful
 * of projects and saved each toggle as its own request.
 */
function AssignProjectsModal({ client, onClose }) {
  const { api, act, data, setModal } = useAdmin();
  const [picked, setPicked] = useState(() => new Set(client.projectIds ?? []));
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const needle = query.trim().toLowerCase();
  const projects = data.projects
    .filter((p) => !needle || `${p.name} ${p.slug ?? ''}`.toLowerCase().includes(needle))
    .slice()
    .sort((a, b) => Number(picked.has(b.id)) - Number(picked.has(a.id)) || a.name.localeCompare(b.name));
  const added = [...picked].filter((id) => !(client.projectIds ?? []).includes(id));
  const removed = (client.projectIds ?? []).filter((id) => !picked.has(id));
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await act(async () => {
        for (const id of added) await api('PUT', `/admin/clients/${client.id}/projects/${id}`);
        for (const id of removed) await api('DELETE', `/admin/clients/${client.id}/projects/${id}`);
      }, added.length && removed.length ? `${added.length} added, ${removed.length} removed.` : added.length ? 'Projects assigned.' : removed.length ? 'Projects removed.' : 'Saved.');
      onClose();
    } catch { /* act reports */ } finally { setSaving(false); }
  };
  return (
    <Modal kind="create"
      title={`Projects for ${client.name || client.email}`}
      subtitle="Being on a project gives them its portal and its requests. Removing a project takes both away; their account and requests stay."
      onClose={onClose}
      actions={
        <>
          <Button onClick={() => { onClose(); setModal({ kind: 'project', clientIds: [client.id] }); }}>New project…</Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" busy={saving} disabled={saving || (!added.length && !removed.length)} onClick={() => void save()}>
            {saving ? 'Saving…' : added.length || removed.length ? `Save · ${added.length} added, ${removed.length} removed` : 'No changes'}
          </Button>
        </>
      }
    >
      <Field label="Find a project">
        <input value={query} placeholder="Search by name or slug…" onChange={(e) => setQuery(e.target.value)} />
      </Field>
      <div className="aw-assign__list" role="group" aria-label="Projects">
        {projects.length === 0 ? <p className="aw-muted">No project matches “{query}”.</p> : projects.map((p) => {
          const checked = picked.has(p.id);
          return (
            <label key={p.id} className="aw-assign__row" data-checked={checked || undefined}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => setPicked((current) => {
                  const next = new Set(current);
                  if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                  return next;
                })}
              />
              <span className="aw-assign__name">{p.name}</span>
              {p.slug ? <span className="aw-assign__slug">{p.slug}</span> : null}
              {checked ? <span className="aw-assign__state">Assigned</span> : null}
            </label>
          );
        })}
      </div>
      <p className="aw-muted">{picked.size} of {data.projects.length} projects selected.</p>
    </Modal>
  );
}

/** A client's projects as a real list: requests, open work, and a way out. */
function ClientProjects({ client }) {
  const { data, open, api, act, ask, setModal } = useAdmin();
  const tickets = ticketsOf(data, client);
  const projects = data.projects.filter((p) => (client.projectIds ?? []).includes(p.id));
  const stats = (project) => {
    const rows = tickets.filter((t) => t.project_id === project.id);
    return { total: rows.length, open: rows.filter((t) => !closedTicket(t)).length };
  };
  const remove = (project) => ask({
    title: `Remove ${client.email} from ${project.name}?`,
    text: 'They stop seeing its requests and stop getting its emails. Their account and their own requests stay.',
    confirm: 'Remove',
    danger: true,
    run: () => act(() => api('DELETE', `/admin/clients/${client.id}/projects/${project.id}`), `Removed ${client.email} from ${project.name}.`).catch(() => undefined),
  });
  return (
    <section className="ui-section">
      <div className="aw-section-head">
        <h3 className="ui-section__title">Projects · {projects.length}</h3>
        <Button size="sm" onClick={() => setModal({ kind: 'custom', render: (close) => <AssignProjectsModal client={client} onClose={close} /> })}>
          Assign projects…
        </Button>
      </div>
      <DataTable
        label={`Projects of ${client.name || client.email}`}
        rows={projects}
        rowKey={(p) => p.id}
        onOpen={(p) => open(`p:${p.id}`)}
        empty={{ title: 'Not on a project yet', hint: 'Assign a project to give this client its portal and its requests.' }}
        columns={[
          { key: 'name', header: 'Project', render: (p) => <span title={p.slug}>{p.name}{p.slug ? <span className="ui-note"> · {p.slug}</span> : null}</span> },
          { key: 'requests', header: 'Requests', numeric: true, fit: true, render: (p) => stats(p).total },
          { key: 'open', header: 'Open', numeric: true, fit: true, render: (p) => stats(p).open },
          { key: 'access', header: 'Portal', fit: true, render: () => <MetaChip>Open</MetaChip> },
          { key: 'remove', header: '', fit: true, render: (p) => <Button size="sm" kind="ghost" onClick={() => remove(p)}>Remove…</Button> },
        ]}
      />
    </section>
  );
}

export function ClientView({ id }) {
  const { data, openTicket, open: openTab } = useAdmin();
  const c = data.clients.find((x) => x.id === id);
  if (!c) return data.loaded ? <div className="aw-view"><Empty title="No such client." hint="They may have been removed. The directory lists everyone." action={<Button onClick={() => openTab('clients')}>Open Clients</Button>} /></div> : <Skeleton variant="pane" label="Loading the client…" />;
  const tickets = ticketsOf(data, c);
  const open = tickets.filter((t) => !closedTicket(t)).length;
  return (
    <div className="aw-view aw-client">
      <UiStyles />
      <PageHeader
        title={c.name || c.email}
        subtitle={`${c.name ? `${c.email} · ` : ''}${open} open of ${tickets.length} · client for ${ago(c.created_at)}${c.handoff ? ` · hand-off: ${c.handoff}` : ''}`}
        actions={
          <AskSuperagentButton
            scope={`c:${c.id}`}
            label={c.name || c.email}
            ask="What is the state of this client, and what do they need next?"
            title="Start a conversation that can read this client and their projects"
          />
        }
      />
      <FormPane className="aw-group">
        <ClientControls c={c} />
      </FormPane>
      <ClientProjects client={c} />
      <section className="ui-section">
        <h3 className="ui-section__title">Requests · {tickets.length}</h3>
        <DataTable
          label="Requests"
          rows={tickets}
          onOpen={(t) => openTicket(t.id)}
          empty={{ title: 'No requests yet.', hint: 'What this client files in the portal, or asks their assistant for, appears here.' }}
          columns={[
            { key: 'id', header: '#', mono: true, fit: true, render: (t) => `#${t.id}` },
            {
              key: 'title',
              header: 'Title',
              render: (t) => (
                <>
                  <TicketLink id={t.id}>{t.title}</TicketLink>
                  {t.client_waiting_since && !closedTicket(t) ? <> <StateIndicator state="waiting" tone="warn" label="Waiting for you" /></> : null}
                </>
              ),
            },
            { key: 'status', header: 'Status', fit: true, render: (t) => <StateIndicator state={t.status} /> },
            { key: 'project', header: 'Project', render: (t) => t.project_name ?? '—' },
            { key: 'cost', header: 'Cost', numeric: true, render: (t) => money(chargeOf(t).totalCents) },
            { key: 'updated', header: 'Updated', fit: true, render: (t) => `${ago(t.updated_at)} ago` },
          ]}
        />
      </section>
    </div>
  );
}

/** A client's right-click menu: open, email, copy the address. */
const clientMenu = (c, open) => [
  { label: 'Open', run: () => open(`c:${c.id}`) },
  { label: 'Email…', run: () => window.open(`mailto:${c.email}`) },
  { label: 'Copy email address', run: () => void navigator.clipboard?.writeText(c.email) },
];

/**
 * The client Inspector: who they are, their settings at a glance, usage,
 * where their invite got to, and their projects (open or take them off one).
 * Creating stays in the invite modal; the full client page has every control.
 */
function ClientInspector({ c, onClose }) {
  const { api, act, ask, data, open, setModal } = useAdmin();
  const tickets = ticketsOf(data, c);
  const openCount = tickets.filter((t) => !closedTicket(t)).length;
  const projects = data.projects.filter((p) => (c.projectIds ?? []).includes(p.id));
  const lastSeen = lastSeenOf(c);
  const remove = (p) =>
    ask({
      title: `Remove ${c.email} from ${p.name}?`,
      text: 'They stop seeing its requests and stop getting its emails. Their account and their own requests stay.',
      confirm: 'Remove',
      danger: true,
      run: () => act(() => api('DELETE', `/admin/clients/${c.id}/projects/${p.id}`), `Removed ${c.email} from ${p.name}.`).catch(() => undefined),
    });
  return (
    <Inspector title={c.name || c.email} label={`Client ${c.email}`} storageKey="ptech.clients.inspector.w" onClose={onClose}>
      {c.pending ? <StateIndicator state="invited" tone="warn" label="Invited, not signed in yet" /> : null}
      <div className="ui-actions">
        <Button onClick={() => open(`c:${c.id}`)} title="Open client page  Enter">Open client page</Button>
        <Button kind="ghost" onClick={() => setModal({
          kind: 'custom',
          render: (close) => c.pending
            ? <InviteClientModal client={c} onClose={close} />
            : <AssignProjectsModal client={c} onClose={close} />,
        })}>{c.pending ? 'Add to projects…' : 'Assign projects…'}</Button>
        <Button kind="ghost" onClick={() => window.open(`mailto:${c.email}`)}>Email…</Button>
      </div>
      <dl className="ui-props">
        <dt>Email</dt>
        <dd>{c.email}</dd>
        {c.name ? (<><dt>Name</dt><dd>{c.name}</dd></>) : null}
        <dt>Requests</dt>
        <dd>{openCount} open of {tickets.length}</dd>
        <dt>Client for</dt>
        <dd>{ago(c.created_at)}</dd>
        <dt>Last seen</dt>
        <dd>{lastSeen ? `${ago(lastSeen)} ago` : 'Unavailable'}</dd>
        <dt>Language</dt>
        <dd>{localeName(c.locale ?? 'en-US')}</dd>
        <dt>Translation</dt>
        <dd>{TRANSLATION_LABEL[c.translation ?? 'deepseek'] ?? c.translation}</dd>
        {c.role !== 'admin' ? (<><dt>First preview</dt><dd>{c.first_preview_at ? `used ${ago(c.first_preview_at)} ago` : 'not used yet'}</dd></>) : null}
        {c.handoff ? (<><dt>Hand-off</dt><dd>{c.handoff}</dd></>) : null}
      </dl>
      <div className="ui-section">
        <h3 className="ui-section__title">Usage</h3>
        <p className="ui-note">{c.usage ? usageLine(c.usage) : 'Usage unavailable'}</p>
      </div>
      {c.pending || c.inviteExpiresAt ? (
        <div className="ui-section">
          <h3 className="ui-section__title">Invite</h3>
          <InviteControls c={c} />
        </div>
      ) : null}
      <div className="ui-section">
        <h3 className="ui-section__title">Projects · {projects.length}</h3>
        <DataTable
          label={`Projects of ${c.name || c.email}`}
          rows={projects}
          onOpen={(p) => open(`p:${p.id}`)}
          empty={{ title: 'No projects.', hint: 'Add them to a project to give them a portal for it.' }}
          columns={[
            { key: 'name', header: 'Project', render: (p) => <strong title={p.slug}>{p.name}</strong> },
            { key: 'node', header: 'Node', render: (p) => <StateIndicator {...projectNodeState(p, data.nodes)} /> },
            { key: 'site', header: 'Site', render: (p) => siteStateOf(p) },
            { key: 'people', header: 'People', render: (p) => `${p.clients?.length ?? 0}` },
            {
              key: 'actions',
              header: 'Actions',
              fit: true,
              render: (p) => (
                <span className="ui-meta">
                  <Button size="sm" kind="ghost" aria-label={`Open ${p.name}`} onClick={(e) => { e.stopPropagation(); open(`p:${p.id}`); }}>Open</Button>
                  <Button size="sm" kind="ghost" aria-label={`Remove from ${p.name}`} onClick={(e) => { e.stopPropagation(); remove(p); }}>Remove…</Button>
                </span>
              ),
            },
          ]}
        />
      </div>
    </Inspector>
  );
}

const CLIENT_SORTS = {
  name: (c) => (c.name || c.email).toLowerCase(),
  projects: (c) => c.projectIds?.length ?? 0,
  seen: (c) => lastSeenOf(c) ?? 0,
};

export function ClientsView() {
  const { data, setModal, open } = useAdmin();
  const root = useRef(null);
  const [sort, setSort] = useState({ key: 'name', dir: 1 });
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (c) => (scope === 'invited' ? c.pending : scope === 'active' ? !c.pending : true)
      && (!q || `${c.name ?? ''} ${c.email ?? ''}`.toLowerCase().includes(q));
    const get = CLIENT_SORTS[sort.key];
    return data.clients.filter(match).sort((a, b) => (get(a) > get(b) ? 1 : get(a) < get(b) ? -1 : 0) * sort.dir);
  }, [data.clients, sort, query, scope]);
  const selected = selectedId == null ? null : rows.find((c) => c.id === selectedId) ?? null;
  const close = () => setSelectedId(null);
  useRevealInspector(root, selected?.id ?? null);
  const invite = () => setModal({ kind: 'custom', render: (onClose) => <InviteClientModal onClose={onClose} /> });
  return (
    <div ref={root} className="ui-workspace aw-clients" onKeyDown={closeOnEscape(Boolean(selected), close)}>
      <UiStyles />
      <PageHeader
        title="Clients"
        subtitle={data.usageTotal ? `Across all clients: ${usageLine(data.usageTotal)}.` : 'Who you work for. Select a client to inspect them; Enter opens their page.'}
        actions={
          <>
            <Button onClick={() => setModal({ kind: 'project' })}>New project</Button>
            <Button kind="primary" icon="plus" onClick={invite}>Invite client</Button>
          </>
        }
      />
      <div className="ui-split">
        <div className="ui-split__main">
          <FilterBar label="Client filters">
            <input className="aw-search" type="search" value={query} aria-label="Filter clients by name or email" placeholder="Filter clients…" onChange={(e) => setQuery(e.target.value)} />
            <Segmented value={scope} options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'invited', label: 'Invited' }]} onChange={setScope} label="Client state" />
            {query || scope !== 'all' ? <Button kind="ghost" size="sm" onClick={() => { setQuery(''); setScope('all'); }}>Clear filters</Button> : null}
            <span className="aw-toolbar__fill" />
            <span className="ui-note">{rows.length} of {data.clients.length}</span>
          </FilterBar>
          <DataTable
            label="Clients"
            rows={rows}
            selected={selected?.id ?? null}
            onSelect={(c) => setSelectedId(c.id)}
            onOpen={(c) => open(`c:${c.id}`)}
            menu={(c) => clientMenu(c, open)}
            sort={sort}
            onSort={(key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === 'name' ? 1 : -1 }))}
            empty={query || scope !== 'all'
              ? { title: 'No clients match those filters.', hint: 'Clear the search or choose All.' }
              : { title: 'No clients yet.', hint: 'Invite a client and they get a portal account for their projects.' }}
            columns={[
              {
                key: 'name',
                header: 'Client',
                sortable: true,
                render: (c) => (
                  <span title={c.email}>
                    <strong>{c.name || c.email}</strong>
                    {c.name ? <span className="ui-note"> {c.email}</span> : null}
                  </span>
                ),
              },
              { key: 'projects', header: 'Projects', numeric: true, sortable: true, render: (c) => c.projectIds?.length ?? 0 },
              { key: 'usage', header: 'Usage', render: (c) => (c.usage ? usageLine(c.usage) : 'Usage unavailable') },
              {
                key: 'seen',
                header: 'Last seen',
                fit: true,
                sortable: true,
                render: (c) =>
                  c.pending ? <StateIndicator state="invited" tone="warn" label="Invited" /> : lastSeenOf(c) ? `${ago(lastSeenOf(c))} ago` : <span title="Last seen unavailable">—</span>,
              },
            ]}
          />
        </div>
        {selected ? <ClientInspector c={selected} onClose={close} /> : null}
      </div>
    </div>
  );
}

/**
 * Every project in the portal, whether or not a client is on it yet. The
 * Clients page reaches a project through its client; this is the way in for a
 * project nobody has been invited to.
 */
export function ProjectsView() {
  const { data, setModal, open } = useAdmin();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const rows = useMemo(() => projectRows(data.projects, data.clients, { query, scope }), [data.projects, data.clients, query, scope]);
  const total = data.projects?.length ?? 0;
  return (
    <div className="ui-workspace aw-projects">
      <UiStyles />
      <PageHeader
        title="Projects"
        subtitle="Every project in the portal, with the clients who can file against it. Enter opens a project."
        actions={<Button kind="primary" icon="plus" onClick={() => setModal({ kind: 'project' })}>New project</Button>}
      />
      <FilterBar label="Project filters">
        <input className="aw-search" type="search" value={query} aria-label="Filter projects by name, slug or client" placeholder="Filter projects…" onChange={(e) => setQuery(e.target.value)} />
        <Segmented value={scope} options={[{ value: 'all', label: 'All' }, { value: 'clients', label: 'With clients' }, { value: 'none', label: 'No client' }]} onChange={setScope} label="Project clients" />
        {query || scope !== 'all' ? <Button kind="ghost" size="sm" onClick={() => { setQuery(''); setScope('all'); }}>Clear filters</Button> : null}
        <span className="aw-toolbar__fill" />
        <span className="ui-note">{rows.length} of {total}</span>
      </FilterBar>
      <DataTable
        label="Projects"
        rows={rows.map((row) => ({ ...row.project, _clients: row.clients }))}
        onOpen={(p) => open(`p:${p.id}`)}
        empty={query || scope !== 'all'
          ? { title: 'No projects match those filters.', hint: 'Clear the search or choose All.' }
          : { title: 'No projects yet.', hint: 'Create one, then invite its client from the project or the Clients page.' }}
        columns={[
          { key: 'name', header: 'Project', render: (p) => <span title={p.slug}><strong>{p.name}</strong> <span className="ui-note">{p.slug}</span></span> },
          {
            key: 'clients',
            header: 'Clients',
            render: (p) => p._clients.length
              ? <span title={p._clients.map((c) => c.email).join(', ')}>{clientsLabel(p._clients)}</span>
              : <StateIndicator state="none" tone="warn" label="No client" />,
          },
          { key: 'node', header: 'Node', render: (p) => <StateIndicator {...projectNodeState(p, data.nodes)} /> },
          { key: 'site', header: 'Site', render: (p) => siteStateOf(p) },
          {
            key: 'actions',
            header: 'Actions',
            fit: true,
            render: (p) => (
              <Button size="sm" kind="ghost" aria-label={`Open ${p.name}`} onClick={(e) => { e.stopPropagation(); open(`p:${p.id}`); }}>Open</Button>
            ),
          },
        ]}
      />
    </div>
  );
}

/**
 * The interface translations. The Worker translates with its own DeepSeek key
 * and commits the catalogs to master; nobody runs a script. Translate now is
 * the normal way; the switch makes it follow every English change by itself.
 */
function TranslationsPanel() {
  const { api, act } = useAdmin();
  const [status, setStatus] = useState(null);
  const load = useCallback(() => api('GET', '/admin/i18n').then(setStatus, () => undefined), [api]);
  usePoll(load, status?.requestedAt || status?.runningSince ? 15_000 : 120_000, [load, status?.requestedAt, status?.runningSince]);
  useEffect(() => void load(), [load]);
  const last = status?.last;
  const rejected = last ? Object.entries(last.rejected ?? {}) : [];
  const failed = last ? Object.entries(last.failed ?? {}) : [];
  const busy = Boolean(status?.requestedAt || status?.runningSince);
  return (
    <section className="aw-panel">
      <h3 className="aw-row-h">
        Translations
        <span className="aw-toolbar__fill" />
        <Button
          size="sm"
          disabled={!status?.ready || busy}
          disabledReason={!status ? 'Reading the translation status…' : !status.ready ? 'Needs DEEPSEEK_API_KEY and the GitHub App secrets on the Worker.' : 'A translation run is already queued or running.'}
          title="Translate every interface and email string that is missing or out of date, in all languages, and commit it to master"
          onClick={() => void act(() => api('POST', '/admin/i18n/sync', {}), 'Translation starts within 5 minutes.').then(setStatus, () => undefined)}
        >
          {status?.runningSince ? 'Translating…' : status?.requestedAt ? 'Queued' : 'Translate now'}
        </Button>
      </h3>
      <p className="aw-muted">
        Translates every interface and email string that is new or re-worded, in all languages, with DeepSeek, and commits it to {status?.repo ?? 'the repo'}. That push deploys like any other. Until then, untranslated strings show in English.
      </p>
      {status?.englishChanged && !busy ? (
        <p className="aw-warn">English changed on master since the last translation{status.checkedAt ? ` (checked ${ago(status.checkedAt)} ago)` : ''}.</p>
      ) : null}
      {status ? (
        <label className="aw-check">
          <input
            type="checkbox"
            checked={Boolean(status.auto)}
            onChange={(e) =>
              void act(
                () => api('PUT', '/admin/i18n', { auto: e.target.checked }),
                e.target.checked ? 'Translations now follow every English change.' : 'Translations run only from the button.',
              ).then(setStatus, () => undefined)
            }
          />
          Translate automatically whenever English changes
        </label>
      ) : null}
      {status && !status.ready ? <p className="aw-warn">Needs DEEPSEEK_API_KEY and the GitHub App secrets on the Worker.</p> : null}
      {status?.runningSince ? <p>Translating since {ago(status.runningSince)} ago.</p> : status?.requestedAt ? <p>Queued {ago(status.requestedAt)} ago; the next five-minute tick runs it.</p> : null}
      {last ? (
        <p className={last.ok ? 'aw-muted' : 'aw-warn'}>
          Last run {ago(last.at)} ago ({last.trigger === 'manual' ? 'by hand' : 'English changed'}):{' '}
          {last.error
            ? last.error
            : last.keys || last.removed
              ? `${last.keys} string${last.keys === 1 ? '' : 's'} in ${last.locales} language${last.locales === 1 ? '' : 's'}${last.removed ? `, ${last.removed} old removed` : ''}${last.commit ? `, commit ${last.commit.slice(0, 7)}` : ''}.`
              : 'everything was already translated.'}
        </p>
      ) : status ? (
        <p className="aw-muted">No run yet.</p>
      ) : null}
      {failed.length ? <p className="aw-warn">Failed: {failed.map(([code, why]) => `${code} (${why})`).join('; ')}</p> : null}
      {rejected.length ? (
        <p className="aw-muted">Kept in English (the placeholders did not survive): {rejected.map(([code, keys]) => `${code}: ${keys.join(', ')}`).join('; ')}</p>
      ) : null}
    </section>
  );
}

// These ranges mirror the Worker's settings contract. Keep the fields as text
// until validation passes, so editing a value never silently turns it into 0.
const SETTING_NUMBERS = {
  stallMinutes: { max: 1440, min: 0, error: 'Enter a whole number from 0 to 1,440.' },
  maxAttempts: { max: 10, min: 1, error: 'Enter a whole number from 1 to 10.' },
  autoApproveCents: { max: 100000, min: 0, decimal: true, error: 'Enter USD from 0 to 100,000, with at most two decimal places.' },
  first_preview_limit_usd: { max: 1000, min: 0, decimal: true, error: 'Enter USD from 0 to 1,000, with at most two decimal places.' },
};
const SITES_HOST = /^(?=.{3,100}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function settingsText(settings) {
  return Object.fromEntries(Object.entries(settings).map(([key, value]) => [
    key,
    key === 'autoApproveCents' ? (value / 100).toFixed(2) : key in SETTING_NUMBERS ? String(value) : value,
  ]));
}

function validateSettings(draft, current) {
  const parsed = { ...draft };
  const errors = {};
  for (const [key, { min, max, decimal, error }] of Object.entries(SETTING_NUMBERS)) {
    const input = (draft[key] ?? '').trim();
    const numeric = Number(input);
    const valid = decimal ? /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(input) : /^\d+$/.test(input);
    if (!valid || numeric < min || numeric > max) errors[key] = error;
    else parsed[key] = key === 'autoApproveCents' ? Math.round(numeric * 100) : numeric;
  }
  parsed.sitesDomain = (draft.sitesDomain ?? '').trim().toLowerCase();
  if (!SITES_HOST.test(parsed.sitesDomain)) errors.sitesDomain = 'Enter a hostname like ptechsolutions.dev, without a protocol or path.';
  const patch = Object.fromEntries(Object.entries(parsed).filter(([key, value]) => value !== current[key]));
  return { patch, errors };
}

/** Which /admin/settings fields each Settings section edits. */
const QUEUE_KEYS = ['stallMinutes', 'maxAttempts', 'defaultPriority', 'notifyRunFinished', 'autoApproveCents'];
const PORTAL_KEYS = ['sitesDomain', 'clientPublish', 'first_preview_limit_usd'];

const pick = (object, keys) => Object.fromEntries(Object.entries(object).filter(([key]) => keys.includes(key)));

/**
 * One section's slice of /admin/settings: read, draft, validate, and save only
 * the fields this section owns, so two sections never save each other's edits.
 */
function useAdminSettings(keys, onDirtyChange) {
  const { api, act, ask } = useAdmin();
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [read, setRead] = useState({ loading: true, settings: null });
  const [readAttempt, setReadAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    api('GET', '/admin/settings').then(({ settings }) => {
      if (current) setRead({ loading: false, settings: settings ?? null });
    }, () => {
      if (current) setRead({ loading: false, settings: null });
    });
    return () => { current = false; };
  }, [api, readAttempt]);
  const baseline = settingsText(read.settings ?? {});
  const draft = { ...baseline, ...edits };
  const set = (key, value) => setEdits((previous) => ({ ...previous, [key]: value }));
  const changed = Object.keys(edits).some((key) => edits[key] !== baseline[key]);
  const all = validateSettings(draft, read.settings ?? {});
  const patch = pick(all.patch, keys);
  const errors = pick(all.errors, keys);
  const invalid = Object.keys(errors).length > 0;
  const dirty = changed && (invalid || Object.keys(patch).length > 0);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const { settings } = await act(() => api('PATCH', '/admin/settings', patch), 'Settings saved.');
      setRead({ loading: false, settings });
      setEdits({});
    } catch (error) {
      // act already reported the error; keep the draft to retry.
      setSaveError(error?.message ?? 'Could not save.');
    } finally {
      setSaving(false);
    }
  };
  const submit = () => {
    if (saving || !Object.keys(patch).length) return;
    if (invalid) {
      setSaveError('Fix the highlighted fields first.');
      return;
    }
    if (!Object.hasOwn(patch, 'sitesDomain')) return void save();
    ask({
      title: `Change sites domain to ${patch.sitesDomain}?`,
      text: 'This changes the default addresses shown for existing managed sites as well as new sites. Make sure the new domain is ready before saving.',
      confirm: 'Change domain',
      run: save,
    });
  };
  const discard = () => {
    setEdits({});
    setSaveError(null);
  };
  const retry = () => {
    setRead({ loading: true, settings: null });
    setReadAttempt((attempt) => attempt + 1);
  };
  const textInput = (key, mode, className) => (
    <>
      <input
        inputMode={mode}
        className={className}
        value={draft[key] ?? ''}
        disabled={saving}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `aw-settings-error-${key}` : undefined}
        onChange={(e) => set(key, e.target.value)}
      />
      {errors[key] ? <span id={`aw-settings-error-${key}`} className="aw-warn">{errors[key]}</span> : null}
    </>
  );
  const status = !read.settings ? (read.loading ? <Skeleton lines={4} label="Reading settings…" /> : (
    <div className="aw-inline">
      <p className="aw-warn" role="alert">Could not read settings.</p>
      <Button size="sm" onClick={retry}>Retry</Button>
    </div>
  )) : null;
  const saveBar = read.settings ? (
    <SaveBar
      dirty={dirty}
      saving={saving}
      error={saveError ?? (dirty && invalid ? 'Fix the highlighted fields first.' : null)}
      onSave={submit}
      onDiscard={discard}
      saveLabel="Save"
    />
  ) : null;
  return { draft, set, saving, textInput, status, saveBar };
}

function QueueSettings({ onDirtyChange }) {
  const form = useAdminSettings(QUEUE_KEYS, onDirtyChange);
  const { draft, set, saving, textInput } = form;
  return (
    <>
      <FormPane className="aw-settings-form">
        <Panel>
          {form.status ?? <>
            <Field label="Stalled after (minutes)" hint="An in-progress item with no report for this long is flagged.">
              {textInput('stallMinutes', 'numeric', 'aw-settings-num')}
            </Field>
            <Field label="Attempts before review" hint="Node restarts do not count.">
              {textInput('maxAttempts', 'numeric', 'aw-settings-num')}
            </Field>
            <Field label="Default priority">
              <Segmented label="Default priority" value={draft.defaultPriority ?? 0} options={PRIORITIES} onChange={(v) => !saving && set('defaultPriority', v)} />
            </Field>
            <Field label="Email me when a run finishes">
              <Segmented label="Email me when a run finishes" value={Boolean(draft.notifyRunFinished)} options={[{ value: true, label: 'On' }, { value: false, label: 'Off' }]} onChange={(v) => !saving && set('notifyRunFinished', v)} />
            </Field>
            <Field label="Auto-approve runs under (USD)" hint="An Autopilot request with its own budget at or below this starts without you. 0 turns it off.">
              {textInput('autoApproveCents', 'decimal', 'aw-settings-num')}
            </Field>
          </>}
        </Panel>
      </FormPane>
      {form.saveBar}
    </>
  );
}

function PortalSettings({ onDirtyChange }) {
  const form = useAdminSettings(PORTAL_KEYS, onDirtyChange);
  const { draft, set, saving, textInput } = form;
  return (
    <>
      <FormPane className="aw-settings-form">
        <Panel title="Portal">
          {form.status ?? <>
            <Field label="Sites domain">
              {textInput('sitesDomain', 'url')}
            </Field>
            <Field label="Clients may publish their site">
              <Segmented label="Clients may publish their site" value={Boolean(draft.clientPublish)} options={[{ value: true, label: 'Yes' }, { value: false, label: 'No' }]} onChange={(v) => !saving && set('clientPublish', v)} />
            </Field>
            <Field
              label="First preview limit (USD)"
              hint="A new client's first request starts by itself, with its AI run capped at this many dollars. Free to the client. 0 turns it off."
            >
              {textInput('first_preview_limit_usd', 'decimal', 'aw-settings-num')}
            </Field>
          </>}
        </Panel>
        <TranslationsPanel />
      </FormPane>
      {form.saveBar}
    </>
  );
}

function MachineSettings() {
  const { platform, host } = useAdmin();
  if (platform !== 'dsh' || !host) {
    return (
      <FormPane className="aw-settings-form">
        <EmptyState title="Only in the desktop app" hint="MCP servers and skills belong to the machine that runs the agents. Open Settings in the desktop app to change them." />
      </FormPane>
    );
  }
  return (
    <FormPane className="aw-settings-form">
      <Panel title="This machine’s tools" subtitle="MCP servers and skills the agents on this machine can use.">
        <ToolboxPanel />
      </Panel>
    </FormPane>
  );
}

function AccountSettings() {
  const { platform, host, notify, reload, data } = useAdmin();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(null);
  const desktop = platform === 'dsh' && Boolean(host);
  const user = data?.user ?? data?.identity?.user ?? null;
  const access = data?.access;
  const signedIn = Boolean(user) && !data?.error;
  const who = user?.email ?? user?.name ?? null;
  const role = access?.superAdmin ? 'Administrator' : access?.canUseWorkbench ? 'Developer' : null;
  const signIn = async () => {
    setBusy('in');
    try {
      const r = await host.command(`login ${token.trim()}`);
      notify(r.text, r.ok ? 'ok' : 'error');
      setToken('');
      void reload?.();
    } finally {
      setBusy(null);
    }
  };
  const signOut = async () => {
    setBusy('out');
    try {
      notify((await host.command('logout')).text);
      void reload?.();
    } finally {
      setBusy(null);
    }
  };
  return (
    <FormPane className="aw-settings-form">
      <Panel
        title="Sign-in"
        actions={data?.loaded === false ? null : (
          <StateIndicator
            state={signedIn ? 'online' : 'offline'}
            tone={signedIn ? 'ok' : 'bad'}
            label={signedIn ? 'Signed in' : 'Not signed in'}
          />
        )}
      >
        {who ? (
          <div className="aw-field">
            <span className="aw-field__label">Account</span>
            <span>{who}{role ? <span className="aw-muted"> · {role}</span> : null}</span>
          </div>
        ) : null}
        {desktop ? (
          <Field label="Session token" hint="Sign in on ptechsolutions.net/portal, then paste the session token here. It stays on this machine.">
            <div className="aw-inline">
              <input type="password" className="aw-settings-token" value={token} placeholder="paste token" onChange={(e) => setToken(e.target.value)} />
              <Button
                kind="primary"
                busy={busy === 'in'}
                disabled={!token.trim() || Boolean(busy)}
                disabledReason="Paste the session token first."
                onClick={signIn}
              >
                Save
              </Button>
              <Button kind="ghost" busy={busy === 'out'} disabled={Boolean(busy)} onClick={signOut}>
                Sign out
              </Button>
            </div>
          </Field>
        ) : (
          <p className="aw-muted">
            This page uses your portal session. <a href="/portal">Manage sign-in on the portal</a>.
          </p>
        )}
      </Panel>
      <Panel title="About">
        <div className="aw-field">
          <span className="aw-field__label">Running in</span>
          <span>{desktop ? 'The desktop app' : 'The web admin'}</span>
        </div>
        {host?.version ? (
          <div className="aw-field">
            <span className="aw-field__label">Version</span>
            <span className="aw-mono">{host.version}</span>
          </div>
        ) : null}
        {data?.fetchedAt ? (
          <div className="aw-field">
            <span className="aw-field__label">Last synced</span>
            <span>{ago(Math.floor(data.fetchedAt / 1000))} ago</span>
          </div>
        ) : null}
        <p className="aw-muted">The theme follows {desktop ? 'the desktop app' : 'your system'}.</p>
      </Panel>
    </FormPane>
  );
}

/** The sections, in nav order. `desktop`: shown only where the Harness host is. */
const SETTINGS_SECTIONS = [
  { id: 'queue', label: 'Work queue', hint: 'How runs are picked up, retried and reported.' },
  { id: 'machine', label: 'This machine & tools', hint: 'MCP servers and skills on this machine.', desktop: true },
  { id: 'portal', label: 'Portal & translations', hint: 'What the client portal does on its own, and its languages.' },
  { id: 'marketing', label: 'Marketing', hint: 'Sending, safety and content for the outreach desk.' },
  { id: 'seo', label: 'SEO', hint: 'Cycles, guides, buyer questions, rank tracking and events.' },
  { id: 'account', label: 'Account & about', hint: 'Who is signed in, and where this admin runs.' },
];

const hashSection = () => (typeof window === 'undefined' ? null : settingsSection(window.location.hash.slice(1)));

/**
 * Settings: one workspace. One header, a 180px section nav, and one bounded
 * form per section with its own SaveBar. Addressable as `settings#<section>`
 * (prop `section`, an `openSettings()` link, or the page hash). The hash is
 * read, never written: a stale #settings/… would steal the next reload.
 */
export function SettingsView({ section: requested } = {}) {
  const { platform, host, ask } = useAdmin();
  const desktop = platform === 'dsh' && Boolean(host);
  const sections = SETTINGS_SECTIONS.filter((s) => !s.desktop || desktop);
  const known = (id) => (id && sections.some((s) => s.id === id) ? id : null);
  const [section, setSection] = useState(() => known(settingsSection(`settings#${requested ?? ''}`) ?? requested) ?? known(takePendingSection()) ?? known(hashSection()) ?? sections[0].id);
  const dirty = useRef(false);
  const current = useRef(section);
  current.current = section;
  const onDirtyChange = useCallback((value) => { dirty.current = value; }, []);

  const go = useCallback((next) => {
    if (!next || next === current.current) return;
    const show = () => {
      dirty.current = false;
      setSection(next);
    };
    if (!dirty.current) return show();
    const from = SETTINGS_SECTIONS.find((s) => s.id === current.current)?.label ?? 'this section';
    ask({
      title: 'Discard unsaved changes?',
      text: `${from} has changes that are not saved yet.`,
      confirm: 'Discard changes',
      danger: true,
      run: show,
    });
  }, [ask]);
  const goKnown = useCallback((id) => {
    const target = known(id);
    if (target) go(target);
  }, [go, desktop]); // eslint-disable-line react-hooks/exhaustive-deps

  // A section asked for by prop, by link, or by the page address.
  useEffect(() => { if (requested) goKnown(settingsSection(`settings#${requested}`) ?? requested); }, [requested, goKnown]);
  useEffect(() => onSettingsSection(goKnown), [goKnown]);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const fromHash = () => { const id = hashSection(); if (id) goKnown(id); };
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [goKnown]);

  const navRef = useRef(null);
  const onNavKey = (e) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const buttons = navRef.current ? [...navRef.current.querySelectorAll('button')] : [];
    if (!buttons.length) return;
    e.preventDefault();
    const i = buttons.indexOf(document.activeElement);
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (Math.max(i, 0) + step + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  const info = sections.find((s) => s.id === section) ?? sections[0];
  return (
    <div className="ui-workspace aw-settings">
      <UiStyles />
      <PageHeader title="Settings" subtitle={info.hint} />
      <div className="aw-settings__body">
        <nav className="aw-settings__nav" aria-label="Settings sections" ref={navRef} onKeyDown={onNavKey}>
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              className="aw-settings__navitem"
              aria-current={s.id === section ? 'page' : undefined}
              data-section={s.id}
              onClick={() => go(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <section className="aw-settings__main" aria-label={info.label} data-section={section}>
          {section === 'queue' ? <QueueSettings onDirtyChange={onDirtyChange} /> : null}
          {section === 'machine' ? <MachineSettings /> : null}
          {section === 'portal' ? <PortalSettings onDirtyChange={onDirtyChange} /> : null}
          {section === 'marketing' ? <MarketingSettings onDirtyChange={onDirtyChange} /> : null}
          {section === 'seo' ? <SeoSettings onDirtyChange={onDirtyChange} /> : null}
          {section === 'account' ? <AccountSettings /> : null}
        </section>
      </div>
    </div>
  );
}
