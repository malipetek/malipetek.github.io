/* The fleet (nodes, queue, runs), the directory (clients, projects), and settings. */
import { useCallback, useEffect, useState } from 'react';
import { LOCALES } from '../../../src/lib/locales.js';
import { useAdmin, usePoll } from './store.js';
import { EXECUTORS, PRIORITIES, ago, chargeOf, money, priorityName, span, usd } from './format.js';
import { Button, Chips, Dot, Empty, Field, Modal, PageHeader, Segmented, Skeleton, StatusPill, Tag, cx, useContextMenu } from './ui.jsx';
import { HealthView } from './health.jsx';
import { MachinePanel, useMachine } from './machine.jsx';
import { ToolboxPanel } from './toolbox.jsx';

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

const capabilityLabel = (id, caps) => caps.find((c) => c.id === id)?.label ?? ({
  'os:darwin': 'macOS', 'os:linux': 'Linux', 'os:win32': 'Windows',
}[id] ?? id.replace(/^os:/, ''));

function NodeCard({ node, local }) {
  const { api, act, ask, data, setModal, openTicket } = useAdmin();
  const caps = data.catalog?.capabilities ?? [];
  const h = node.health ?? {};
  const sys = h.system;
  const state = !node.online ? 'bad' : node.draining ? 'warn' : 'ok';
  const machine = sys
    ? [
        `load ${sys.load?.[0]?.toFixed?.(2) ?? '—'} / ${sys.cpus} cpu`,
        sys.memFreePct != null ? `${100 - sys.memFreePct}% mem` : null,
        sys.disk ? `${pct(sys.disk.totalGb - sys.disk.freeGb, sys.disk.totalGb)}% disk` : null,
        sys.battery ? `battery ${sys.battery.percent}%${sys.battery.onPower ? ' ⚡' : ''}` : null,
        `up ${span(sys.uptimeSec)}`,
      ].filter(Boolean).join(' · ')
    : '';
  return (
    <article className={cx('aw-node', `aw-node--${state}`)}>
      <header>
        <Dot state={state} />
        <h3>{node.id}</h3>
        <span className="aw-muted aw-node__os">
          {node.os} · v{node.version}
          {node.online ? (node.draining ? ' · draining' : '') : ` · offline ${ago(node.lastSeenAt)}`}
        </span>
        <span className="aw-toolbar__fill" />
        {!local ? <Button size="sm" kind="ghost" onClick={() => act(() => api('PATCH', `/admin/nodes/${node.id}`, { draining: !node.draining }), node.draining ? `${node.id} takes work again.` : `${node.id} finishes what it has, then takes nothing new.`)}>
          {node.draining ? 'Resume' : 'Drain'}
        </Button> : null}
        <Button size="sm" kind="ghost" onClick={() => setModal({ kind: 'custom', render: (close) => <NodeModal node={node} local={local} onClose={close} /> })}>
          Edit
        </Button>
        {!local && !node.online ? (
          <Button
            size="sm"
            kind="ghost"
            onClick={() => ask({ title: `Forget ${node.id}?`, text: 'It re-registers on its next heartbeat if it is still alive.', confirm: 'Forget', danger: true, run: () => act(() => api('DELETE', `/admin/nodes/${node.id}`), `Forgot ${node.id}.`) })}
          >
            Forget
          </Button>
        ) : null}
      </header>
      <div className="aw-node__lines">
        {!local ? (
          <p className="aw-node__line">
            <span className="aw-muted">Agents: </span>
            {node.executors.map((e, i) => {
              const ex = h.executors?.[e];
              return (
                <span key={e} className={ex && !ex.ok ? 'aw-warn' : undefined} title={ex && !ex.ok ? (ex.error ?? 'not healthy') : ex?.version ? `${e} ${ex.version}` : undefined}>
                  {i ? ', ' : ''}{e}
                </span>
              );
            })}
          </p>
        ) : null}
        <p className="aw-node__line">
          <span className="aw-muted">Can do: </span>
          {node.capabilities.length ? node.capabilities.map((c) => capabilityLabel(c, caps)).join(', ') : '—'}
          <span className="aw-muted"> · </span>
          <span className="aw-muted" title={node.slugs.length ? node.slugs.join(', ') : undefined}>
            {node.slugs.length ? `${node.slugs.length} project${node.slugs.length === 1 ? '' : 's'}` : 'no projects yet'}
          </span>
        </p>
        <p className="aw-node__line" title={machine || undefined}>
          <span className="aw-muted">Workload: </span>
          {node.running.length} of {node.slots} runs busy
          <span className="aw-node__bar" aria-hidden="true"><i style={{ width: `${pct(node.running.length, node.slots)}%` }} /></span>
          {machine ? <span className="aw-muted aw-node__sys"> · {machine}</span> : null}
        </p>
        {h.process?.lastError ? <p className="aw-node__line aw-warn">Last error: {h.process.lastError}</p> : null}
      </div>
      {!local && node.running.length ? (
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

function NodeModal({ node, local, onClose }) {
  const { api, act, data } = useAdmin();
  const caps = data.catalog?.capabilities ?? [];
  const [slots, setSlots] = useState(node.overrides?.slots ?? node.slots);
  const [executors, setExecutors] = useState(node.overrides?.executors ?? node.executors);
  const [capabilities, setCapabilities] = useState(node.overrides?.capabilities ?? node.capabilities.filter((c) => !c.startsWith('os:')));
  const save = () =>
    act(() => api('PATCH', `/admin/nodes/${node.id}`, { overrides: { slots, capabilities, ...(!local ? { executors } : {}) } }), `${node.id} picks this up on its next heartbeat.`).then(onClose, () => undefined);
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
  const { data, openTicket, open } = useAdmin();
  const machine = useMachine();
  const runs = [...data.running, ...data.recent].slice(0, 8);
  return (
    <div className="aw-view aw-fleet">
      <PageHeader
        title="Fleet"
        subtitle="The machines that run agents, what waits for them, and the end-to-end checks."
        overflow={[{ label: 'Settings: work queue…', run: () => open('settings') }]}
      />
      <HealthView compact />
      <div className="aw-nodes">
        {machine.live ? <MachinePanel /> : null}
        {data.nodes.map((n) => (
          <NodeCard key={n.id} node={n} local={machine.live && n.id === machine.nodeId} />
        ))}
        {!data.nodes.length ? <Empty title="No node has connected yet." hint="Open the desktop app and lend This Mac from the status bar, or start a node with its config file." /> : null}
      </div>

      <section className="aw-group">
        <h3>
          Queue <span className="aw-count">{data.queue.length}</span>
        </h3>
        {data.queue.length ? <div className="aw-tablewrap"><table className="aw-table aw-table--stack aw-table--rows">
          <thead>
            <tr>
              <th className="aw-num">#</th>
              <th>Title</th>
              <th>Project</th>
              <th>Priority</th>
              <th className="aw-num">Waiting</th>
              <th>Why waiting</th>
            </tr>
          </thead>
          <tbody>
            {data.queue.map((q) => (
              <tr key={q.id} onClick={() => openTicket(q.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openTicket(q.id)}>
                <td className="aw-num aw-muted">#{q.id}</td>
                <td className="aw-table__title">{q.title}</td>
                <td data-label="Project">{q.slug ?? '—'}</td>
                <td data-label="Priority">{priorityName(q.priority)}</td>
                <td data-label="Waiting" className="aw-num">{span(q.waitingSeconds)}</td>
                <td data-label="Why waiting" className={q.eligible.length ? 'aw-muted' : 'aw-warn'} style={{ whiteSpace: 'normal' }}>{q.eligible.length ? null : <><Dot state="bad" />{' '}</>}{q.reason}</td>
              </tr>
            ))}
          </tbody>
        </table></div> : <Empty inline title="Nothing is waiting." hint="Approved work starts as soon as a node with a free slot can take it." />}
      </section>

      <section className="aw-group">
        <h3>Recent runs</h3>
        {runs.length ? <div className="aw-tablewrap"><table className="aw-table aw-table--stack aw-table--rows">
          <thead>
            <tr>
              <th className="aw-num">#</th>
              <th>Title</th>
              <th>Result</th>
              <th>Agent</th>
              <th>Node</th>
              <th className="aw-num">Cost</th>
              <th>Finished</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const live = r.status === 'running' || !r.status;
              return (
                <tr key={r.id} onClick={() => openTicket(r.ticket_id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openTicket(r.ticket_id)}>
                  <td className="aw-num aw-muted">#{r.ticket_id}</td>
                  <td className="aw-table__title">{r.title}</td>
                  <td data-label="Result">
                    <span className="aw-running">{live ? <span className="aw-live" /> : <Dot state={r.status === 'ok' ? 'ok' : 'bad'} />}{live ? 'running' : r.status === 'ok' ? 'ok' : r.status}</span>
                  </td>
                  <td data-label="Agent">
                    {r.executor}
                    {r.model ? <span className="aw-muted"> {r.model}</span> : null}
                  </td>
                  <td data-label="Node">{r.node_id ?? 'this Mac'}</td>
                  <td data-label="Cost" className="aw-num">{usd(r.cost_micro_usd)}</td>
                  <td data-label="Finished" className="aw-muted">{r.finished_at ? `${ago(r.finished_at)} ago` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div> : <Empty inline title="No runs yet." hint="Runs appear here when a node starts approved work." />}
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

export function RepoModal({ project, onClose }) {
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

/** A client’s bill, language, translator and projects. */
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
  const { api, act, ask } = useAdmin();
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
    <Modal
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
    <Modal
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

/** One client: who they are, what they owe, and every request they filed, open ones first. */
export function ClientView({ id }) {
  const { data, openTicket, open: openTab } = useAdmin();
  const c = data.clients.find((x) => x.id === id);
  if (!c) return data.loaded ? <div className="aw-view"><Empty title="No such client." hint="They may have been removed. The directory lists everyone." action={<Button onClick={() => openTab('clients')}>Open Clients</Button>} /></div> : <Skeleton variant="pane" label="Loading the client…" />;
  const closed = (t) => ['done', 'declined'].includes(t.status);
  const tickets = data.tickets
    .filter((t) => t.kind !== 'system' && t.client_email === c.email)
    .sort((a, b) => closed(a) - closed(b) || b.updated_at - a.updated_at);
  const open = tickets.filter((t) => !closed(t)).length;
  return (
    <div className="aw-view aw-client">
      <PageHeader
        title={c.name || c.email}
        subtitle={`${c.name ? `${c.email} · ` : ''}${open} open of ${tickets.length} · client for ${ago(c.created_at)}${c.handoff ? ` · hand-off: ${c.handoff}` : ''}`}
      />
      <section className="aw-group">
        <ClientControls c={c} />
      </section>
      <section className="aw-group">
        <h3>
          Requests <span className="aw-count">{tickets.length}</span>
        </h3>
        <div className="aw-tablewrap">
          <table className="aw-table aw-table--stack aw-table--rows">
            <thead>
              <tr>
                <th className="aw-num">#</th>
                <th>Title</th>
                <th>Status</th>
                <th>Project</th>
                <th className="aw-num">Cost</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} onClick={() => openTicket(t.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openTicket(t.id)}>
                  <td className="aw-num aw-muted">#{t.id}</td>
                  <td className="aw-table__title">
                    {t.title}
                    {t.client_waiting_since && !closed(t) ? <> <Tag tone="warn">waiting for you</Tag></> : null}
                  </td>
                  <td data-label="Status">
                    <StatusPill status={t.status} />
                  </td>
                  <td data-label="Project">{t.project_name ?? '—'}</td>
                  <td data-label="Cost" className="aw-num">{money(chargeOf(t).totalCents)}</td>
                  <td data-label="Updated" className="aw-muted">{ago(t.updated_at)} ago</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!tickets.length ? <Empty inline title="No requests yet." hint="What this client files in the portal, or asks their assistant for, appears here." /> : null}
        </div>
      </section>
    </div>
  );
}

/** A directory row: click opens the client; right-click or Shift+F10 offers open and email. */
function ClientRow({ c, onOpen, children }) {
  const menu = useContextMenu([
    { label: 'Open', run: onOpen },
    { label: 'Email…', run: () => window.open(`mailto:${c.email}`) },
    { label: 'Copy email address', run: () => void navigator.clipboard?.writeText(c.email) },
  ], `${c.name || c.email} actions`);
  return (
    <li>
      <button type="button" className="aw-row aw-directory__open" onClick={onOpen} {...menu.bind}>
        {children}
      </button>
      {menu.menu}
    </li>
  );
}

export function ClientsView() {
  const { data, setModal, open } = useAdmin();
  return (
    <div className="aw-view aw-clients">
      <PageHeader
        title="Clients & projects"
        subtitle={data.usageTotal ? `Across all clients: ${usageLine(data.usageTotal)}.` : 'Who you work for, and the projects you work on.'}
        actions={<Button kind="primary" icon="plus" onClick={() => setModal({ kind: 'custom', render: (close) => <InviteClientModal onClose={close} /> })}>Invite client</Button>}
        secondary={[{ label: 'New project', run: () => setModal({ kind: 'project' }) }]}
      />
      <div className="aw-split aw-directory">
        <section className="aw-group">
          <header className="aw-row-h">
            <h3>Clients <span className="aw-count">{data.clients.length}</span></h3>
          </header>
          {data.clients.length ? <ul className="aw-rows">
            {data.clients.map((c) => {
              const count = c.projectIds?.length ?? 0;
              const lastSeen = c.lastSeenAt ?? c.last_seen_at;
              return (
                <ClientRow key={c.id} c={c} onOpen={() => open(`c:${c.id}`)}>
                    <span className="aw-directory__name">
                      <strong>{c.name || c.email}</strong>
                      {c.name ? <span className="aw-muted">{c.email}</span> : null}
                    </span>
                    <span className="aw-muted">{count} {count === 1 ? 'project' : 'projects'}</span>
                    <span className="aw-muted">{c.usage ? (usageLine(c.usage) || 'No usage') : 'Usage unavailable'}</span>
                    <span className="aw-muted">{lastSeen ? `Seen ${ago(lastSeen)} ago` : 'Last seen unavailable'}</span>
                </ClientRow>
              );
            })}
          </ul> : <Empty inline title="No clients yet." hint="Invite a client and they get a portal account for their projects." />}
        </section>
        <section className="aw-group">
          <header className="aw-row-h">
            <h3>Projects <span className="aw-count">{data.projects.length}</span></h3>
          </header>
          {data.projects.length ? <ul className="aw-rows">
            {data.projects.map((p) => {
              const holders = data.nodes.filter((n) => n.slugs.includes(p.slug));
              const nodeState = holders.some((n) => n.online && !n.draining) ? 'ok' : holders.length ? 'warn' : 'bad';
              const nodeLabel = nodeState === 'ok' ? 'Node available' : nodeState === 'warn' ? 'Nodes offline or draining' : 'No node has this project';
              const people = p.clients?.length ?? 0;
              const sites = p.sites ?? (p.site ? [p.site] : []);
              const siteStates = [...new Set(sites.map((site) => site.state?.replaceAll('_', ' ')).filter(Boolean))];
              const siteState = sites.length ? siteStates.join(', ') || 'Site status unavailable' : 'No site';
              return (
                <li key={p.id} className="aw-row aw-directory__project">
                  <span title={nodeLabel} role="img" aria-label={nodeLabel}><Dot state={nodeState} /></span>
                  <span className="aw-directory__name">
                    <strong>{p.name}</strong>
                    <span className="aw-muted aw-mono">{p.slug}</span>
                  </span>
                  <span className="aw-muted">{people} {people === 1 ? 'person' : 'people'}</span>
                  <span className="aw-muted">{siteState}</span>
                  <Button size="sm" kind="ghost" aria-label={`Open ${p.name}`} onClick={() => open(`p:${p.id}`)}>Open</Button>
                </li>
              );
            })}
          </ul> : <Empty inline title="No projects yet." hint="A project is a codebase and its sites." action={<Button onClick={() => setModal({ kind: 'project' })}>New project</Button>} />}
        </section>
      </div>
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

export function SettingsView() {
  const { api, act, ask, platform, host, notify, reload } = useAdmin();
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
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
  const { patch, errors } = validateSettings(draft, read.settings ?? {});
  const invalid = Object.keys(errors).length > 0;
  const [token, setToken] = useState('');
  const textInput = (key, mode) => (
    <>
      <input
        inputMode={mode}
        value={draft[key] ?? ''}
        disabled={saving}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `aw-settings-error-${key}` : undefined}
        onChange={(e) => set(key, e.target.value)}
      />
      {errors[key] ? <span id={`aw-settings-error-${key}`} className="aw-warn">{errors[key]}</span> : null}
    </>
  );
  const save = async () => {
    setSaving(true);
    try {
      const { settings } = await act(() => api('PATCH', '/admin/settings', patch), 'Settings saved.');
      setRead({ loading: false, settings });
      setEdits({});
    } catch { /* act already reported the error; keep the draft to retry. */ }
    finally { setSaving(false); }
  };
  const submit = () => {
    if (invalid || saving || !Object.keys(patch).length) return;
    if (!Object.hasOwn(patch, 'sitesDomain')) return void save();
    ask({
      title: `Change sites domain to ${patch.sitesDomain}?`,
      text: 'This changes the default addresses shown for existing managed sites as well as new sites. Make sure the new domain is ready before saving.',
      confirm: 'Change domain',
      run: save,
    });
  };
  const retry = () => {
    setRead({ loading: true, settings: null });
    setReadAttempt((attempt) => attempt + 1);
  };
  return (
    <div className="aw-view aw-settings">
      <PageHeader title="Settings" subtitle="How the queue runs, what the portal does on its own, and this machine." />
      {platform === 'dsh' && host ? (
        <>
          <section className="aw-panel">
            <h3>Portal connection</h3>
            <Field label="Session token" hint="Sign in on ptechsolutions.net/portal, then paste the session token here. It stays on this machine.">
              <div className="aw-inline">
                <input type="password" value={token} placeholder="paste token" onChange={(e) => setToken(e.target.value)} />
                <Button
                  kind="primary"
                  disabled={!token.trim()}
                  disabledReason="Paste the session token first."
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
          <section className="aw-panel">
            <h3>This machine&rsquo;s tools</h3>
            <ToolboxPanel />
          </section>
        </>
      ) : null}
      <section className="aw-panel">
        <h3>Work queue</h3>
        {!read.settings ? (read.loading ? <Skeleton lines={4} label="Reading settings…" /> : (
          <div className="aw-inline">
            <p className="aw-warn" role="alert">Could not read settings.</p>
            <Button size="sm" onClick={retry}>Retry</Button>
          </div>
        )) : <>
          <div className="aw-grid2">
            <Field label="Stalled after (minutes)" hint="An in-progress item with no report for this long is flagged.">
              {textInput('stallMinutes', 'numeric')}
            </Field>
            <Field label="Attempts before review" hint="Node restarts do not count.">
              {textInput('maxAttempts', 'numeric')}
            </Field>
            <Field label="Default priority">
              <Segmented value={draft.defaultPriority ?? 0} options={PRIORITIES} onChange={(v) => !saving && set('defaultPriority', v)} />
            </Field>
            <Field label="Email me when a run finishes">
              <Segmented value={Boolean(draft.notifyRunFinished)} options={[{ value: true, label: 'On' }, { value: false, label: 'Off' }]} onChange={(v) => !saving && set('notifyRunFinished', v)} />
            </Field>
            <Field label="Auto-approve runs under (USD)" hint="An Autopilot request with its own budget at or below this starts without you. 0 turns it off.">
              {textInput('autoApproveCents', 'decimal')}
            </Field>
            <Field label="Sites domain">
              {textInput('sitesDomain', 'url')}
            </Field>
            <Field label="Clients may publish their site">
              <Segmented value={Boolean(draft.clientPublish)} options={[{ value: true, label: 'Yes' }, { value: false, label: 'No' }]} onChange={(v) => !saving && set('clientPublish', v)} />
            </Field>
            <Field
              label="First preview limit (USD)"
              hint="A new client's first request starts by itself, with its AI run capped at this many dollars. Free to the client. 0 turns it off."
            >
              {textInput('first_preview_limit_usd', 'decimal')}
            </Field>
          </div>
        </>}
      </section>
      <TranslationsPanel />
      {read.settings ? (
        <footer className="aw-settings__foot">
          {changed ? <span className="aw-muted">Unsaved changes</span> : null}
          <span className="aw-toolbar__fill" />
          <Button disabled={!changed || saving} onClick={() => setEdits({})}>Reset</Button>
          <Button kind="primary" busy={saving} disabled={invalid || !Object.keys(patch).length} disabledReason={invalid ? 'Fix the highlighted fields first.' : 'Nothing has changed yet.'} onClick={submit}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </footer>
      ) : null}
    </div>
  );
}
