/* The fleet (nodes, queue, runs), the directory (clients, projects), and settings. */
import { useEffect, useState } from 'react';
import { LOCALES } from '../../../src/lib/locales.js';
import { useAdmin } from './store.js';
import { EXECUTORS, PRIORITIES, ago, chargeOf, money, priorityName, span, usd } from './format.js';
import { Button, Chips, Dot, Field, Modal, Segmented, StatusPill, Tag, cx } from './ui.jsx';
import { SitePanel } from './ticket.jsx';

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function NodeCard({ node }) {
  const { api, act, ask, setModal, openTicket } = useAdmin();
  const h = node.health ?? {};
  const sys = h.system;
  const state = !node.online ? 'bad' : node.draining ? 'warn' : 'ok';
  return (
    <article className={cx('aw-node', `aw-node--${state}`)}>
      <header>
        <Dot state={state} />
        <h3>{node.id}</h3>
        <span className="aw-muted">
          {node.os} · v{node.version} · {node.online ? (node.draining ? 'draining' : 'online') : `offline ${ago(node.lastSeenAt)}`}
        </span>
        <span className="aw-toolbar__fill" />
        <Button size="sm" onClick={() => act(() => api('PATCH', `/admin/nodes/${node.id}`, { draining: !node.draining }), node.draining ? `${node.id} takes work again.` : `${node.id} finishes what it has, then takes nothing new.`)}>
          {node.draining ? 'Resume' : 'Drain'}
        </Button>
        <Button size="sm" onClick={() => setModal({ kind: 'custom', render: (close) => <NodeModal node={node} onClose={close} /> })}>
          Edit
        </Button>
        {!node.online ? (
          <Button
            size="sm"
            kind="ghost"
            onClick={() => ask({ title: `Forget ${node.id}?`, text: 'It re-registers on its next heartbeat if it is still alive.', confirm: 'Forget', danger: true, run: () => act(() => api('DELETE', `/admin/nodes/${node.id}`), `Forgot ${node.id}.`) })}
          >
            Forget
          </Button>
        ) : null}
      </header>
      <dl className="aw-kv">
        <dt>Agents</dt>
        <dd>
          {node.executors.map((e) => {
            const ex = h.executors?.[e];
            return (
              <Tag key={e} tone={ex && !ex.ok ? 'bad' : undefined}>
                {e}
                {ex?.version ? ` ${ex.version}` : ''}
              </Tag>
            );
          })}
        </dd>
        <dt>Can do</dt>
        <dd>{node.capabilities.map((c) => <Tag key={c} tone="dash">{c}</Tag>)}</dd>
        <dt>Projects</dt>
        <dd>{node.slugs.length ? node.slugs.map((s) => <Tag key={s}>{s}</Tag>) : <span className="aw-muted">none yet</span>}</dd>
        <dt>Slots</dt>
        <dd>
          {node.running.length}/{node.slots} busy
        </dd>
        {sys ? (
          <>
            <dt>Machine</dt>
            <dd className="aw-muted">
              load {sys.load?.[0]?.toFixed?.(2) ?? '—'} / {sys.cpus} cpu
              {sys.memFreePct != null ? ` · ${100 - sys.memFreePct}% mem` : ''}
              {sys.disk ? ` · ${pct(sys.disk.totalGb - sys.disk.freeGb, sys.disk.totalGb)}% disk` : ''}
              {sys.battery ? ` · battery ${sys.battery.percent}%${sys.battery.onPower ? ' ⚡' : ''}` : ''} · up {span(sys.uptimeSec)}
            </dd>
          </>
        ) : null}
        {h.process?.lastError ? (
          <>
            <dt>Last error</dt>
            <dd className="aw-warn">{h.process.lastError}</dd>
          </>
        ) : null}
      </dl>
      {node.running.length ? (
        <ul className="aw-rows">
          {node.running.map((r) => (
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
    </article>
  );
}

function NodeModal({ node, onClose }) {
  const { api, act, data } = useAdmin();
  const caps = data.catalog?.capabilities ?? [];
  const [slots, setSlots] = useState(node.overrides?.slots ?? node.slots);
  const [executors, setExecutors] = useState(node.overrides?.executors ?? node.executors);
  const [capabilities, setCapabilities] = useState(node.overrides?.capabilities ?? node.capabilities.filter((c) => !c.startsWith('os:')));
  const save = () =>
    act(() => api('PATCH', `/admin/nodes/${node.id}`, { overrides: { slots, executors, capabilities } }), `${node.id} picks this up on its next heartbeat.`).then(onClose, () => undefined);
  return (
    <Modal
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
        <Chips value={executors} options={EXECUTORS.map((e) => ({ value: e, label: e }))} onChange={setExecutors} />
      </Field>
      <Field label="Capabilities">
        <Chips value={capabilities} options={caps.map((c) => ({ value: c.id, label: c.label, hint: c.hint }))} onChange={setCapabilities} />
      </Field>
    </Modal>
  );
}

/** The Harness only: this machine's node, through the Host half. */
function ThisMachine() {
  const { host, notify, reload } = useAdmin();
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => host.json('localinfo').then(setInfo, (e) => notify(e.message, 'error'));
  useEffect(() => {
    void load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const control = async (verb) => {
    setBusy(true);
    const r = await host.command(`node ${verb}`);
    notify(r.text, r.ok ? 'ok' : 'error');
    setBusy(false);
    void load();
    void reload();
  };
  const svc = info?.local?.service;
  const up = svc?.state === 'running';
  return (
    <article className={cx('aw-node', `aw-node--${up ? 'ok' : 'bad'}`)}>
      <header>
        <Dot state={up ? 'ok' : 'bad'} />
        <h3>This machine</h3>
        <span className="aw-muted">
          {info ? `${info.localConfig?.nodeId || 'node'} · ${svc?.state ?? 'unknown'}${svc?.pid ? ` · pid ${svc.pid}` : ''}` : 'reading…'}
        </span>
        <span className="aw-toolbar__fill" />
        {svc?.loaded ? (
          <>
            <Button size="sm" disabled={busy} onClick={() => control('restart')}>
              Restart
            </Button>
            <Button size="sm" kind="ghost" disabled={busy} onClick={() => control('stop')}>
              Stop
            </Button>
          </>
        ) : (
          <Button size="sm" kind="primary" disabled={busy} onClick={() => control(svc ? 'start' : 'install')}>
            Start
          </Button>
        )}
      </header>
      {info?.local?.log ? <pre className="aw-log">{info.local.log}</pre> : null}
    </article>
  );
}

export function FleetView() {
  const { data, openTicket, platform, host } = useAdmin();
  return (
    <div className="aw-view aw-fleet">
      <header className="aw-hero">
        <h2>Fleet</h2>
        <p className="aw-muted">Nodes claim approved work they can do: the right project, capabilities and agent.</p>
      </header>
      <div className="aw-nodes">
        {platform === 'dsh' && host ? <ThisMachine /> : null}
        {data.nodes.map((n) => (
          <NodeCard key={n.id} node={n} />
        ))}
        {!data.nodes.length ? <p className="aw-empty">No node has connected yet. Run fleet/install.sh on a machine.</p> : null}
      </div>

      <section className="aw-group">
        <h3>
          Queue <span className="aw-count">{data.queue.length}</span>
        </h3>
        <table className="aw-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Title</th>
              <th>Project</th>
              <th>Priority</th>
              <th>Waiting</th>
              <th>Goes to</th>
            </tr>
          </thead>
          <tbody>
            {data.queue.map((q) => (
              <tr key={q.id} onClick={() => openTicket(q.id)}>
                <td className="aw-mono">#{q.id}</td>
                <td className="aw-table__title">{q.title}</td>
                <td>{q.slug ?? '—'}</td>
                <td>{priorityName(q.priority)}</td>
                <td>{span(q.waitingSeconds)}</td>
                <td className={q.eligible.length ? '' : 'aw-warn'}>{q.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.queue.length ? <p className="aw-muted">Nothing is waiting.</p> : null}
      </section>

      <section className="aw-group">
        <h3>Recent runs</h3>
        <table className="aw-table">
          <thead>
            <tr>
              <th />
              <th>#</th>
              <th>Title</th>
              <th>Agent</th>
              <th>Node</th>
              <th>Cost</th>
              <th>Finished</th>
            </tr>
          </thead>
          <tbody>
            {[...data.running, ...data.recent].slice(0, 30).map((r) => (
              <tr key={r.id} onClick={() => openTicket(r.ticket_id)}>
                <td>{r.status === 'running' || !r.status ? <span className="aw-live" /> : <Dot state={r.status === 'ok' ? 'ok' : 'bad'} />}</td>
                <td className="aw-mono">#{r.ticket_id}</td>
                <td className="aw-table__title">{r.title}</td>
                <td>
                  {r.executor}
                  {r.model ? <span className="aw-muted"> {r.model}</span> : null}
                </td>
                <td>{r.node_id ?? 'Harness'}</td>
                <td>{usd(r.cost_micro_usd)}</td>
                <td className="aw-muted">{r.finished_at ? `${ago(r.finished_at)} ago` : 'running'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
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

function RepoModal({ project, onClose }) {
  const { api, act } = useAdmin();
  const [repo, setRepo] = useState(project.repo ?? '');
  const submit = () => act(() => api('PUT', `/admin/projects/${project.id}/repo`, { repo: repo.trim() }), 'Repo saved.').then(onClose, () => undefined);
  return (
    <Modal
      title={`Repo for ${project.name}`}
      subtitle="Nodes clone this on their next sync. A private repo needs a node whose git can reach it."
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!repo.trim()} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Repo URL">
        <input className="aw-mono" value={repo} maxLength={300} placeholder="https://github.com/owner/repo" onChange={(e) => setRepo(e.target.value)} />
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

/** A client's bill, language, translator and projects: the card and the client page both show these. */
function ClientControls({ c }) {
  const { api, act, data } = useAdmin();
  const toggle = (ids) => {
    const added = ids.filter((x) => !c.projectIds.includes(x));
    const removed = c.projectIds.filter((x) => !ids.includes(x));
    return act(async () => {
      for (const p of added) await api('PUT', `/admin/clients/${c.id}/projects/${p}`);
      for (const p of removed) await api('DELETE', `/admin/clients/${c.id}/projects/${p}`);
    }, 'Saved.');
  };
  return (
    <>
      <p className="aw-muted">{usageLine(c.usage)}</p>
      <div className="aw-toolbar">
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
      <Chips value={c.projectIds} options={data.projects.map((p) => ({ value: p.id, label: p.name }))} onChange={(ids) => void toggle(ids)} />
    </>
  );
}

/** Where an invite got to, and the two things Ali can do about it. */
function InviteControls({ c }) {
  const { api, act } = useAdmin();
  // Once they have signed in, the invite row stops mattering: the normal
  // controls and their live session cover the account.
  if (!c.pending && !c.inviteExpiresAt) return null;
  const left = c.inviteExpiresAt ? Math.max(0, c.inviteExpiresAt - Date.now() / 1000) : 0;
  return (
    <div className="aw-inline">
      <Tag tone={c.pending ? 'warn' : undefined} title={c.email}>
        {c.pending ? 'Invited, not signed in yet' : 'Invite link live'}
      </Tag>
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
        onClick={() => void act(() => api('DELETE', `/admin/clients/${c.id}/invite`), 'Invite link revoked.')}
      >
        Revoke
      </Button>
    </div>
  );
}

/** Invite a client to existing projects: email, who, language, which projects, a note. */
function InviteClientModal({ onClose }) {
  const { api, act, data } = useAdmin();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [locale, setLocale] = useState('en-US');
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
          ? `Added ${email.trim()}, but the email could not be sent. Use Resend on their card.`
          : out.user?.verified_at
            ? `${email.trim()} now has ${projectIds.length} more project${projectIds.length === 1 ? '' : 's'} and a new link.`
            : `Invited ${email.trim()}.`,
    ).then(onClose, () => undefined);
  return (
    <Modal
      title="Invite a client"
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

/** One client: who they are, what they owe, and every request they filed, open ones first. */
export function ClientView({ id }) {
  const { data, openTicket } = useAdmin();
  const c = data.clients.find((x) => x.id === id);
  if (!c) return <p className="aw-empty">{data.loaded ? 'No such client.' : 'Loading…'}</p>;
  const closed = (t) => ['done', 'declined'].includes(t.status);
  const tickets = data.tickets
    .filter((t) => t.kind !== 'system' && t.client_email === c.email)
    .sort((a, b) => closed(a) - closed(b) || b.updated_at - a.updated_at);
  const open = tickets.filter((t) => !closed(t)).length;
  return (
    <div className="aw-view">
      <header className="aw-hero">
        <h2>{c.name || c.email}</h2>
        <p className="aw-muted">
          {c.name ? `${c.email} · ` : ''}
          {open} open of {tickets.length} · client for {ago(c.created_at)}
          {c.handoff ? ` · hand-off: ${c.handoff}` : ''}
        </p>
      </header>
      <section className="aw-group">
        <ClientControls c={c} />
      </section>
      <section className="aw-group">
        <h3>
          Requests <span className="aw-count">{tickets.length}</span>
        </h3>
        <div className="aw-tablewrap">
          <table className="aw-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Status</th>
                <th>Project</th>
                <th>Cost</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} onClick={() => openTicket(t.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openTicket(t.id)}>
                  <td className="aw-mono">#{t.id}</td>
                  <td className="aw-table__title">
                    {t.client_waiting_since && !closed(t) ? <Dot state="warn" /> : null} {t.title}
                  </td>
                  <td>
                    <StatusPill status={t.status} />
                  </td>
                  <td>{t.project_name ?? '—'}</td>
                  <td>{money(chargeOf(t).totalCents)}</td>
                  <td className="aw-muted">{ago(t.updated_at)} ago</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!tickets.length ? <p className="aw-empty">No requests yet.</p> : null}
        </div>
      </section>
    </div>
  );
}

export function ClientsView() {
  const { api, act, ask, data, setModal, setBoardProject, open } = useAdmin();
  return (
    <div className="aw-view">
      <header className="aw-hero">
        <h2>Clients & projects</h2>
        <p className="aw-muted">{data.usageTotal ? `Across all clients: ${usageLine(data.usageTotal)}.` : ''}</p>
        <Button
          size="sm"
          kind="primary"
          onClick={() => setModal({ kind: 'custom', render: (close) => <InviteClientModal onClose={close} /> })}
        >
          Invite client
        </Button>
        <Button
          size="sm"
          title="List the GitHub App’s installations from GitHub and record any the callback missed"
          onClick={() => void act(() => api('POST', '/admin/github/reconcile', {}), 'GitHub installations reconciled.')}
        >
          Reconcile GitHub
        </Button>
      </header>
      <div className="aw-split">
        <section className="aw-group">
          <h3>Clients</h3>
          <ul className="aw-cards">
            {data.clients.map((c) => (
              <li key={c.id} className="aw-panel">
                <header>
                  {c.role === 'admin' ? (
                    <strong>{c.email}</strong>
                  ) : (
                    <button type="button" className="aw-link" title="Open this client’s page" onClick={() => open(`c:${c.id}`)}>
                      <strong>{c.email}</strong>
                    </button>
                  )}
                  <span className="aw-muted">{c.role === 'admin' ? 'admin' : `${c.ticket_count} ticket(s)`}</span>
                </header>
                {c.role !== 'admin' ? <ClientControls c={c} /> : null}
              </li>
            ))}
          </ul>
        </section>
        <section className="aw-group">
          <h3 className="aw-row-h">
            Projects
            <span className="aw-toolbar__fill" />
            <Button size="sm" kind="primary" onClick={() => setModal({ kind: 'project' })}>
              New project
            </Button>
          </h3>
          <ul className="aw-cards">
            {data.projects.map((p) => {
              const holders = data.nodes.filter((n) => n.slugs.includes(p.slug));
              return (
                <li key={p.id} className="aw-panel">
                  <header>
                    <strong>{p.name}</strong>
                    <span className="aw-mono aw-muted">{p.slug}</span>
                    <span className="aw-toolbar__fill" />
                    <Button
                      size="sm"
                      kind="ghost"
                      onClick={() => {
                        setBoardProject(p.id);
                        open('board');
                      }}
                    >
                      Board →
                    </Button>
                  </header>
                  <p className={p.repoStatus && !['ready', 'creating', 'queued'].includes(p.repoStatus.state) ? 'aw-warn' : 'aw-muted'}>
                    {p.repoStatus?.detail ?? p.repo ?? 'no repo yet'}
                  </p>
                  {p.githubAccount ? <p className="aw-muted">GitHub: @{p.githubAccount}</p> : null}
                  <div className="aw-tags">
                    {holders.length ? holders.map((n) => <Tag key={n.id} tone={n.online ? undefined : 'bad'}>{n.id}</Tag>) : <span className="aw-warn">No node has it yet.</span>}
                    {p.sites?.length ? <Tag tone="dash">{p.sites.length} site{p.sites.length === 1 ? '' : 's'}</Tag> : null}
                    {(p.clients ?? []).map((client) => (
                      <Tag key={client.id} tone="client" title={client.pending ? `Invited, not signed in yet: ${client.email}` : client.email}>
                        {client.name || client.email}
                        {client.pending ? ' (invited)' : ''}
                      </Tag>
                    ))}
                  </div>
                  <SitePanel project={p} />
                  <div className="aw-inline">
                    {!p.repo ? (
                      <Button size="sm" kind="primary" onClick={() => void act(() => api('POST', `/admin/projects/${p.id}/repo/create`), `Creating a repo for ${p.name}.`)}>
                        {p.repoStatus?.state === 'failed' ? 'Retry repo' : 'Create repo'}
                      </Button>
                    ) : null}
                    {!p.repo && p.githubInstallationId ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          void act(
                            () => api('POST', `/admin/projects/${p.id}/repo/github`, {}),
                            `Creating ${p.slug} in @${p.githubAccount ?? 'the client’s GitHub'}.`,
                          )
                        }
                      >
                        Create in GitHub
                      </Button>
                    ) : null}
                    <Button size="sm" onClick={() => setModal({ kind: 'custom', render: (close) => <RepoModal project={p} onClose={close} /> })}>
                      {p.repo ? 'Change repo' : 'Use a repo URL'}
                    </Button>
                    <Button size="sm" onClick={() => void act(() => api('POST', `/admin/projects/${p.id}/site`, {}), `Adding a site to ${p.name}.`)}>
                      {p.sites?.length ? 'Add a site' : 'Start hosting'}
                    </Button>
                    <span className="aw-toolbar__fill" />
                    <Button
                      size="sm"
                      kind="ghost"
                      onClick={() =>
                        ask({
                          title: `Delete ${p.name}?`,
                          text: [
                            'Its finished requests stay, with their threads, but no longer belong to a project.',
                            'Clients lose access to it.',
                            p.sites?.length ? `${p.sites.length} hosted site${p.sites.length === 1 ? '' : 's'} go offline.` : null,
                            p.repo ? `The repo is not deleted: ${p.repo}.` : null,
                            'This cannot be undone.',
                          ]
                            .filter(Boolean)
                            .join(' '),
                          confirm: 'Delete project',
                          danger: true,
                          run: () => act(() => api('DELETE', `/admin/projects/${p.id}`), `Deleted ${p.name}.`).catch(() => undefined),
                        })
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function SettingsView() {
  const { api, act, data, platform, host, notify, reload } = useAdmin();
  const [draft, setDraft] = useState(data.settings ?? {});
  useEffect(() => setDraft(data.settings ?? {}), [data.settings]);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const changed = data.settings && Object.keys(draft).some((k) => draft[k] !== data.settings[k]);
  const [token, setToken] = useState('');
  return (
    <div className="aw-view aw-settings">
      <header className="aw-hero">
        <h2>Settings</h2>
      </header>
      {platform === 'dsh' && host ? (
        <section className="aw-panel">
          <h3>Portal connection</h3>
          <Field label="Session token" hint="Sign in on malipetek.dev/portal, then paste the session token here. It stays on this machine.">
            <div className="aw-inline">
              <input type="password" value={token} placeholder="paste token" onChange={(e) => setToken(e.target.value)} />
              <Button
                kind="primary"
                disabled={!token.trim()}
                onClick={async () => {
                  const r = await host.command(`login ${token.trim()}`);
                  notify(r.text, r.ok ? 'ok' : 'error');
                  setToken('');
                  void reload();
                }}
              >
                Save
              </Button>
              <Button kind="ghost" onClick={async () => notify((await host.command('logout')).text)}>
                Sign out
              </Button>
            </div>
          </Field>
        </section>
      ) : null}
      {data.settings ? (
        <section className="aw-panel">
          <h3>Work queue</h3>
          <div className="aw-grid2">
            <Field label="Stalled after (minutes)" hint="An in-progress item with no report for this long is flagged.">
              <input inputMode="numeric" value={draft.stallMinutes ?? ''} onChange={(e) => set('stallMinutes', Number(e.target.value))} />
            </Field>
            <Field label="Attempts before review" hint="Node restarts do not count.">
              <input inputMode="numeric" value={draft.maxAttempts ?? ''} onChange={(e) => set('maxAttempts', Number(e.target.value))} />
            </Field>
            <Field label="Default priority">
              <Segmented value={draft.defaultPriority ?? 0} options={PRIORITIES} onChange={(v) => set('defaultPriority', v)} />
            </Field>
            <Field label="Email me when a run finishes">
              <Segmented value={Boolean(draft.notifyRunFinished)} options={[{ value: true, label: 'On' }, { value: false, label: 'Off' }]} onChange={(v) => set('notifyRunFinished', v)} />
            </Field>
            <Field label="Autopilot cap (cents)" hint="An Autopilot request with its own budget at or below this starts without you. 0 turns it off.">
              <input inputMode="numeric" value={draft.autoApproveCents ?? ''} onChange={(e) => set('autoApproveCents', Number(e.target.value))} />
            </Field>
            <Field label="Sites domain">
              <input value={draft.sitesDomain ?? ''} onChange={(e) => set('sitesDomain', e.target.value)} />
            </Field>
            <Field label="Clients may publish their site">
              <Segmented value={Boolean(draft.clientPublish)} options={[{ value: true, label: 'Yes' }, { value: false, label: 'No' }]} onChange={(v) => set('clientPublish', v)} />
            </Field>
            <Field
              label="First preview limit (USD)"
              hint="A new client's first request starts by itself, with its AI run capped at this many dollars. Free to the client. 0 turns it off."
            >
              <input
                inputMode="decimal"
                value={draft.first_preview_limit_usd ?? ''}
                onChange={(e) => set('first_preview_limit_usd', e.target.value === '' ? 0 : Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="aw-inline">
            <span className="aw-toolbar__fill" />
            <Button disabled={!changed} onClick={() => setDraft(data.settings)}>
              Reset
            </Button>
            <Button
              kind="primary"
              disabled={!changed}
              onClick={() => {
                const patch = Object.fromEntries(Object.entries(draft).filter(([k, v]) => v !== data.settings[k]));
                void act(() => api('PATCH', '/admin/settings', patch), 'Settings saved.').catch(() => undefined);
              }}
            >
              Save
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
