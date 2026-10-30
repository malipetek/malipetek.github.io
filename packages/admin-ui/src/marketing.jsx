/* The marketing desk: who we write to, what is queued, and the switch that sends it. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAdmin, usePoll } from './store.js';
import { ago, when } from './format.js';
import { Button, Field, Modal, Segmented, Tag, cx } from './ui.jsx';

const CONTACT_TONE = { new: 'dash', queued: undefined, contacted: 'ok', replied: 'ok', opted_out: 'bad', bounced: 'bad', paused: 'warn' };
const MESSAGE_TONE = { draft: 'dash', scheduled: undefined, sending: 'warn', sent: 'ok', failed: 'bad', cancelled: 'dash' };
const CHANNELS = [
  { value: '', label: 'All' },
  { value: 'email', label: 'Email' },
  { value: 'x', label: 'X' },
  { value: 'linkedin', label: 'LinkedIn' },
];
const REASONS = {
  paused: 'Paused: nothing is sent while the switch is off.',
  sender_unbound: 'The outreach sender is not bound on the Worker.',
  postal_address_unset: 'Add a postal address before anything goes out.',
  outside_hours: 'Outside the send window — it waits for the next one.',
  weekend: 'Weekends are off in the settings.',
  daily_cap: 'Today’s cap is used up. It resumes tomorrow.',
};

const WINDOW_REASON = {
  outside_hours: 'outside the send window',
  weekend: 'weekend',
  daily_cap: 'the day’s cap is used',
};

const CYCLE_SKIP = {
  open_cycle: 'A cycle ticket is already open — its agent is writing.',
  recent_cycle: 'The last cycle was filed less than a day ago.',
  weekly_cycle: 'This week’s cycle is already queued.',
  stocked: 'The next week already has three posts queued.',
  no_project: 'No malipetek-dev-site project to run the agent in.',
  no_admin: 'No admin account to file the ticket for.',
};
const cycleMessage = (result) =>
  result?.filed
    ? `Filed #${result.id}: an agent writes the posts and the desk queues them.`
    : (CYCLE_SKIP[result?.reason] ?? `Nothing filed: ${result?.reason ?? 'unknown reason'}`);

const offsetLabel = (minutes) => `UTC${minutes >= 0 ? '+' : '−'}${Math.abs(minutes) / 60}`;
const snippet = (text, max = 90) => (text.length > max ? `${text.slice(0, max)}…` : text);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function MarketingView() {
  const { api, act, notify } = useAdmin();
  const [overview, setOverview] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('contacts');
  const [modal, setModal] = useState(null);
  const [filters, setFilters] = useState({ status: '', q: '', channel: '', messageStatus: '' });

  const load = useCallback(() => {
    const qs = (params) => {
      const search = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
      return search ? `?${search}` : '';
    };
    return Promise.all([
      api('GET', '/admin/marketing'),
      api('GET', `/admin/marketing/contacts${qs({ status: filters.status, q: filters.q })}`),
      api('GET', `/admin/marketing/messages${qs({ channel: filters.channel, status: filters.messageStatus })}`),
    ])
      .then(([o, c, m]) => {
        setOverview(o);
        setContacts(c.contacts ?? []);
        setMessages(m.messages ?? []);
        setError(null);
      })
      .catch(setError);
  }, [api, filters.status, filters.q, filters.channel, filters.messageStatus]);

  useEffect(() => {
    void load();
  }, [load]);
  usePoll(load, 30_000, [load]);

  const run = useCallback(
    (fn, message) => act(fn, message).then(load, () => undefined),
    [act, load],
  );

  const contactsById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const done = useCallback(
    (message) => {
      setModal(null);
      notify(message);
      void load();
    },
    [load, notify],
  );

  if (error) return <p className="aw-empty">Could not load the desk: {error.message ?? error.code}</p>;
  if (!overview) return <p className="aw-empty">Loading…</p>;

  const { settings } = overview;
  const messagesToday = `${overview.today}/${settings.dailyCap} sent today`;

  return (
    <div className="aw-view">
      <header className="aw-hero">
        <h2>Marketing</h2>
        <p className="aw-muted">
          Email sequences, X and LinkedIn posts, from <span className="aw-mono">{overview.sender}</span>. Replies to that
          address land here; “no” stops everything queued for that contact.
        </p>
      </header>

      {!overview.bound ? (
        <div className="aw-banner aw-banner--bad">No outreach sender is bound on the Worker (MARKETING). Nothing can send.</div>
      ) : !settings.postalAddress ? (
        <div className="aw-banner aw-banner--bad">
          Set a postal address in Settings before a cold email goes out — anti-spam law asks for one on every send.
        </div>
      ) : !settings.live ? (
        <div className="aw-banner aw-banner--warn">
          Paused. {overview.due.email ? `${overview.due.email} email${overview.due.email === 1 ? '' : 's'} are due.` : 'Nothing is due yet.'}
          <span className="aw-toolbar__fill" />
          <Button size="sm" onClick={() => run(() => api('PUT', '/admin/marketing/settings', { live: true }), 'Outreach is live.')}>
            Go live
          </Button>
        </div>
      ) : (
        <div className="aw-banner">
          Live · {settings.startHour}:00–{settings.endHour}:00 {offsetLabel(settings.offsetMinutes)}
          {settings.weekdaysOnly ? ', weekdays' : ''} · {messagesToday} · window{' '}
          {overview.window.open ? 'open' : `closed (${WINDOW_REASON[overview.window.reason] ?? overview.window.reason})`}
          <span className="aw-toolbar__fill" />
          <Button size="sm" kind="ghost" onClick={() => run(() => api('POST', '/admin/marketing/run'), 'Ran the sender.')}>
            Run now
          </Button>
          <Button size="sm" kind="ghost" onClick={() => run(() => api('PUT', '/admin/marketing/settings', { live: false }), 'Paused.')}>
            Pause
          </Button>
        </div>
      )}

      <div className="aw-tags">
        <Tag>{plural(overview.counts.contacts.queued, 'queued contact', 'queued contacts')}</Tag>
        <Tag>{overview.counts.contacts.replied} replied</Tag>
        <Tag tone={overview.counts.contacts.opted_out ? 'bad' : 'dash'}>{overview.counts.contacts.opted_out} opted out</Tag>
        <Tag tone={overview.counts.messages.failed ? 'bad' : 'dash'}>{plural(overview.counts.messages.failed, 'failed send', 'failed sends')}</Tag>
        <Tag tone={overview.due.email ? 'warn' : 'dash'}>{plural(overview.due.email, 'email due', 'emails due')}</Tag>
        <Tag tone={overview.due.x + overview.due.linkedin ? 'warn' : 'dash'}>{plural(overview.due.x + overview.due.linkedin, 'post due', 'posts due')}</Tag>
      </div>

      <div className="aw-toolbar">
        <Segmented
          value={tab}
          options={[
            { value: 'contacts', label: `Contacts (${contacts.length})` },
            { value: 'queue', label: `Queue (${messages.length})` },
            { value: 'settings', label: 'Settings' },
          ]}
          onChange={setTab}
        />
        <span className="aw-toolbar__fill" />
        {tab === 'contacts' ? (
          <>
            <input className="aw-search" value={filters.q} placeholder="Search email, name, business…" onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
            <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="">Every status</option>
              {Object.keys(CONTACT_TONE).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <Button onClick={() => setModal({ kind: 'import' })}>Import CSV</Button>
            <Button kind="primary" onClick={() => setModal({ kind: 'contact' })}>
              Add contact
            </Button>
          </>
        ) : null}
        {tab === 'queue' ? (
          <>
            <select value={filters.channel} onChange={(e) => setFilters((f) => ({ ...f, channel: e.target.value }))}>
              {CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <select value={filters.messageStatus} onChange={(e) => setFilters((f) => ({ ...f, messageStatus: e.target.value }))}>
              <option value="">Every status</option>
              {Object.keys(MESSAGE_TONE).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <Button onClick={() => setModal({ kind: 'compose' })}>Compose</Button>
            <Button kind="primary" onClick={() => run(() => api('POST', '/admin/marketing/cycle?force=1'), cycleMessage)}>
              Draft posts
            </Button>
          </>
        ) : null}
        {tab === 'settings' ? (
          <Button onClick={() => run(() => api('POST', '/admin/marketing/run'), 'Ran the sender.')}>Run now</Button>
        ) : null}
      </div>

      {tab === 'contacts' ? (
        <section className="aw-panel">
          <table className="aw-table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Business / site</th>
                <th>Status</th>
                <th>Sent</th>
                <th>Next</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td className="aw-table__title">
                    <span className="aw-mono">{c.email}</span>
                    {c.name ? <span className="aw-muted"> {c.name}</span> : null}
                    {c.gap ? <div className="aw-muted">{snippet(c.gap, 110)}</div> : null}
                  </td>
                  <td>
                    {c.business ?? '—'}
                    {c.site ? <div className="aw-muted">{c.site}</div> : null}
                  </td>
                  <td>
                    <Tag tone={CONTACT_TONE[c.status]}>{c.status}</Tag>
                  </td>
                  <td>{c.sentCount}</td>
                  <td className="aw-muted">{c.nextAt ? when(c.nextAt) : '—'}</td>
                  <td>
                    <div className="aw-inline">
                      {['new', 'paused', 'contacted'].includes(c.status) && !c.nextAt ? (
                        <Button size="sm" onClick={() => setModal({ kind: 'queue', contact: c })}>
                          Queue
                        </Button>
                      ) : null}
                      <Button size="sm" kind="ghost" onClick={() => setModal({ kind: 'contact', contact: c })}>
                        Edit
                      </Button>
                      {c.status !== 'opted_out' ? (
                        <Button
                          size="sm"
                          kind="ghost"
                          onClick={() =>
                            run(() => api('PATCH', `/admin/marketing/contacts/${c.id}`, { status: 'opted_out' }), `${c.email} opted out; queued mail cancelled.`)
                          }
                        >
                          Opt out
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!contacts.length ? <p className="aw-muted">No contacts match. Import a CSV, or add one by hand.</p> : null}
        </section>
      ) : null}

      {tab === 'queue' ? (
        <section className="aw-panel">
          <table className="aw-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Channel</th>
                <th>To</th>
                <th>Message</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => {
                const closed = m.status === 'sent' || m.status === 'cancelled' || m.status === 'sending';
                return (
                  <tr key={m.id}>
                    <td className="aw-muted">{m.sentAt ? ago(m.sentAt) : m.scheduledAt ? when(m.scheduledAt) : 'draft'}</td>
                    <td>
                      <Tag tone={m.channel === 'email' ? 'dash' : undefined}>{m.channel}</Tag>
                    </td>
                    <td className="aw-mono">{m.contactEmail ?? '—'}</td>
                    <td className="aw-table__title">
                      {m.subject ? <div>{m.subject}</div> : null}
                      <div className="aw-muted">{snippet(m.body.replace(/\s+/g, ' '), 120)}</div>
                      {m.error ? <div className="aw-warn">{m.error}</div> : null}
                    </td>
                    <td>
                      <Tag tone={MESSAGE_TONE[m.status]}>{m.status}</Tag>
                    </td>
                    <td>
                      <div className="aw-inline">
                        {m.status === 'failed' ? (
                          <Button size="sm" onClick={() => run(() => api('POST', `/admin/marketing/messages/${m.id}/retry`), 'Queued again.')}>
                            Retry
                          </Button>
                        ) : null}
                        {m.channel === 'email' && ['draft', 'scheduled', 'failed'].includes(m.status) ? (
                          <Button size="sm" kind="primary" onClick={() => run(() => api('POST', `/admin/marketing/messages/${m.id}/send`), 'Sent.')}>
                            Send now
                          </Button>
                        ) : null}
                        {m.channel !== 'email' && ['draft', 'scheduled', 'failed'].includes(m.status) ? (
                          <Button size="sm" onClick={() => setModal({ kind: 'edit', message: m })}>
                            Edit
                          </Button>
                        ) : null}
                        {m.channel !== 'email' && ['draft', 'scheduled', 'failed'].includes(m.status) ? (
                          <Button
                            size="sm"
                            onClick={() =>
                              run(
                                () => api('POST', `/admin/marketing/messages/${m.id}/send`),
                                m.status === 'scheduled' ? 'Due now — the publisher posts it within 15 minutes.' : 'Queued for the publisher.',
                              )
                            }
                          >
                            {m.status === 'scheduled' ? 'Post now' : 'Queue now'}
                          </Button>
                        ) : null}
                        {!closed ? (
                          <Button size="sm" kind="ghost" onClick={() => run(() => api('POST', `/admin/marketing/messages/${m.id}/cancel`), 'Cancelled.')}>
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!messages.length ? <p className="aw-muted">Nothing queued. Import contacts to build a sequence, or compose a post.</p> : null}

          <div className="aw-group">
            <h3>Recent events</h3>
            <ul className="aw-rows">
              {overview.events.map((e) => (
                <li key={e.id} className="aw-row">
                  <Tag tone={e.kind === 'failed' || e.kind === 'bounce' || e.kind === 'opt_out' || e.kind === 'cycle_failed' ? 'bad' : e.kind === 'reply' || e.kind === 'sent' || e.kind === 'published' || e.kind === 'cycle' ? 'ok' : 'dash'}>
                    {e.kind.replace('_', ' ')}
                  </Tag>
                  <span className="aw-row__title">{e.email ?? '—'}</span>
                  <span className="aw-muted">{snippet(e.detail ?? '', 100)}</span>
                  <span className="aw-muted">{ago(e.createdAt)} ago</span>
                </li>
              ))}
            </ul>
            {!overview.events.length ? <p className="aw-muted">Nothing has happened yet.</p> : null}
          </div>
        </section>
      ) : null}

      {tab === 'settings' ? (
        <SettingsTab overview={overview} run={run} api={api} contactsById={contactsById} />
      ) : null}

      {modal?.kind === 'import' ? (
        <ImportModal
          sequences={overview.sequences}
          onClose={() => setModal(null)}
          onDone={(result) =>
            done(
              `${result.added} added${result.paused ? `, ${result.paused} held for a missing observation` : ''}${result.skipped.length ? `, ${result.skipped.length} skipped` : ''}.`,
            )
          }
          api={api}
        />
      ) : null}

      {modal?.kind === 'contact' ? (
        <ContactModal contact={modal.contact} sequences={overview.sequences} api={api} onClose={() => setModal(null)} onSaved={done} />
      ) : null}

      {modal?.kind === 'queue' ? (
        <QueueModal
          contact={modal.contact}
          sequences={overview.sequences}
          api={api}
          onClose={() => setModal(null)}
          onQueued={(count) => done(`${count} emails queued for ${modal.contact.email}.`)}
        />
      ) : null}

      {modal?.kind === 'compose' ? (
        <ComposeModal
          contacts={contacts.filter((c) => !['opted_out', 'bounced'].includes(c.status))}
          api={api}
          onClose={() => setModal(null)}
          onSaved={done}
        />
      ) : null}

      {modal?.kind === 'edit' ? (
        <EditPostModal message={modal.message} api={api} onClose={() => setModal(null)} onSaved={done} />
      ) : null}
    </div>
  );
}

/* —— settings —— */

function SettingsTab({ overview, run, api, contactsById }) {
  const [draft, setDraft] = useState(overview.settings);
  useEffect(() => setDraft(overview.settings), [overview.settings]);
  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const changed = Object.keys(draft).some((key) => draft[key] !== overview.settings[key]);
  const save = () => {
    const patch = Object.fromEntries(Object.entries(draft).filter(([key, value]) => value !== overview.settings[key]));
    void run(() => api('PUT', '/admin/marketing/settings', patch), 'Marketing settings saved.');
  };
  const actions = (
    <div className="aw-inline">
      <span className="aw-toolbar__fill" />
      <Button disabled={!changed} onClick={() => setDraft(overview.settings)}>
        Reset
      </Button>
      <Button kind="primary" disabled={!changed} onClick={save}>
        Save
      </Button>
    </div>
  );

  return (
    <>
      <section className="aw-panel">
        <h3>Sending</h3>
        <div className="aw-grid2">
          <Field label="Outreach">
            <Segmented
              value={Boolean(draft.live)}
              options={[
                { value: true, label: 'Live' },
                { value: false, label: 'Paused' },
              ]}
              onChange={(v) => set('live', v)}
            />
          </Field>
          <Field label="Postal address" hint="On every cold email, as anti-spam law requires.">
            <input value={draft.postalAddress} placeholder="Street, city, country" onChange={(e) => set('postalAddress', e.target.value)} />
          </Field>
          <Field label="From name">
            <input value={draft.fromName} onChange={(e) => set('fromName', e.target.value)} />
          </Field>
          <Field label="Daily cap" hint="Emails per day across every sequence.">
            <input inputMode="numeric" value={draft.dailyCap} onChange={(e) => set('dailyCap', Number(e.target.value))} />
          </Field>
          <Field label="Per run" hint="The cron runs every five minutes.">
            <input inputMode="numeric" value={draft.perRun} onChange={(e) => set('perRun', Number(e.target.value))} />
          </Field>
          <Field label="Weekdays only">
            <Segmented
              value={Boolean(draft.weekdaysOnly)}
              options={[
                { value: true, label: 'Weekdays' },
                { value: false, label: 'Every day' },
              ]}
              onChange={(v) => set('weekdaysOnly', v)}
            />
          </Field>
          <Field label="Send window (start)">
            <input inputMode="numeric" value={draft.startHour} onChange={(e) => set('startHour', Number(e.target.value))} />
          </Field>
          <Field label="Send window (end)" hint="24 means midnight.">
            <input inputMode="numeric" value={draft.endHour} onChange={(e) => set('endHour', Number(e.target.value))} />
          </Field>
          <Field label="Local offset (minutes)" hint={`${offsetLabel(draft.offsetMinutes)}. The window and the daily count use this clock.`}>
            <input inputMode="numeric" value={draft.offsetMinutes} onChange={(e) => set('offsetMinutes', Number(e.target.value))} />
          </Field>
        </div>
        {actions}
      </section>

      <section className="aw-panel">
        <h3>Written posts</h3>
        <Field
          label="Voice notes"
          hint="Added to every content brief, after the launch kit. Leave empty to follow the kit alone. The next cycle picks it up; Draft posts shows it at once."
        >
          <textarea
            rows={3}
            value={draft.voiceNotes ?? ''}
            placeholder="Shorter sentences. No exclamation marks. Talk about the client's week, not the machine."
            onChange={(e) => set('voiceNotes', e.target.value)}
          />
        </Field>
        {actions}
      </section>

      <section className="aw-panel">
        <h3>The publisher</h3>
        <p className="aw-muted">
          X and LinkedIn have no affordable posting API, so the machine posts from a real browser profile:
          <span className="aw-mono"> marketing/publisher/publish.mjs</span>. It polls this desk with{' '}
          <span className="aw-mono">MARKETING_TOKEN</span>, opens the composer with the queued text, and reports back. Keep
          it launched from this machine — it uses that browser session, not a password.
        </p>
        <p className="aw-muted">
          Replies to the outreach address are filed here. A reply or “no” from a contact cancels every queued email for
          them; strangers are forwarded to your inbox and never added to the list.
        </p>
        <p className="aw-muted">Contacts on file: {contactsById.size}. Sender: {overview.sender}. Inbox: {overview.inbox}.</p>
      </section>
    </>
  );
}

/* —— modals —— */

function ImportModal({ api, sequences, onClose, onDone }) {
  const [csv, setCsv] = useState('');
  const [sequence, setSequence] = useState('cold_a');
  const [campaign, setCampaign] = useState('launch');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await api('POST', '/admin/marketing/contacts/import', { csv, sequence, campaign }));
    } catch (err) {
      setError(err.message ?? err.code);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Import contacts"
      subtitle="One row per address. Columns: email, name, business, site, gap, source_url, notes. The gap is the one specific, true observation the first email opens with."
      onClose={onClose}
      wide
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={busy || !csv.trim()} onClick={submit}>
            Import
          </Button>
        </>
      }
    >
      <Field label="Sequence">
        <Segmented value={sequence} options={sequences.map((s) => ({ value: s.key, label: s.label }))} onChange={setSequence} />
      </Field>
      <Field label="Campaign" hint="Kept on every message so a later read can tell batches apart.">
        <input value={campaign} maxLength={40} onChange={(e) => setCampaign(e.target.value)} />
      </Field>
      <Field label="CSV">
        <textarea rows={10} className="aw-mono" value={csv} placeholder={'email,name,business,site,gap\nsara@bakery.test,Sara,Bakery Nine,bakerynine.test,the menu still says summer'} onChange={(e) => setCsv(e.target.value)} />
      </Field>
      {error ? <div className="aw-banner aw-banner--bad">{error}</div> : null}
    </Modal>
  );
}

function ContactModal({ api, contact, sequences, onClose, onSaved }) {
  const editing = Boolean(contact);
  const [form, setForm] = useState({
    email: contact?.email ?? '',
    name: contact?.name ?? '',
    business: contact?.business ?? '',
    site: contact?.site ?? '',
    gap: contact?.gap ?? '',
    notes: contact?.notes ?? '',
  });
  const [queue, setQueue] = useState(!editing);
  const [sequence, setSequence] = useState('cold_a');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        const patch = Object.fromEntries(Object.entries(form).filter(([key, value]) => value !== (contact[key] ?? '')));
        await api('PATCH', `/admin/marketing/contacts/${contact.id}`, patch);
        onSaved(`${contact.email} saved.`);
      } else {
        const out = await api('POST', '/admin/marketing/contacts', { ...form, sequence: queue ? sequence : undefined });
        onSaved(`${out.contact.email} added${queue ? ' and queued' : ''}.`);
      }
    } catch (err) {
      setError(err.message ?? err.code);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? contact.email : 'Add a contact'}
      subtitle={editing ? 'The gap is what the cold email opens with; leave it blank and the sequence will not queue.' : 'Only someone you chose to write to. There is no list building in here.'}
      onClose={onClose}
      wide
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={busy || !form.email.trim()} onClick={submit}>
            {editing ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="aw-grid2">
        <Field label="Email">
          <input value={form.email} disabled={editing} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Name">
          <input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Business">
          <input value={form.business} onChange={(e) => set('business', e.target.value)} />
        </Field>
        <Field label="Site">
          <input value={form.site} onChange={(e) => set('site', e.target.value)} />
        </Field>
      </div>
      <Field label="The gap" hint="One specific, true observation. If it is not true, the whole email is spam.">
        <textarea rows={3} value={form.gap} onChange={(e) => set('gap', e.target.value)} />
      </Field>
      <Field label="Notes">
        <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      {!editing ? (
        <>
          <Field label="Queue now">
            <Segmented
              value={queue}
              options={[
                { value: true, label: 'Queue a sequence' },
                { value: false, label: 'Keep as a contact' },
              ]}
              onChange={setQueue}
            />
          </Field>
          {queue ? (
            <Field label="Sequence">
              <Segmented value={sequence} options={sequences.map((s) => ({ value: s.key, label: s.label }))} onChange={setSequence} />
            </Field>
          ) : null}
        </>
      ) : null}
      {error ? <div className="aw-banner aw-banner--bad">{error}</div> : null}
    </Modal>
  );
}

function QueueModal({ api, contact, sequences, onClose, onQueued }) {
  const [sequence, setSequence] = useState('cold_a');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    setBusy(true);
    try {
      const out = await api('POST', `/admin/marketing/contacts/${contact.id}/queue`, { sequence });
      onQueued(out.queued);
    } catch (err) {
      setError(err.message ?? err.code);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Queue for ${contact.email}`}
      subtitle="Three emails, days 0, 4 and 10. A reply or “no” cancels the rest."
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={busy} onClick={submit}>
            Queue
          </Button>
        </>
      }
    >
      <Field label="Sequence">
        <Segmented value={sequence} options={sequences.map((s) => ({ value: s.key, label: s.label }))} onChange={setSequence} />
      </Field>
      {error ? <div className="aw-banner aw-banner--bad">{error}</div> : null}
    </Modal>
  );
}

function EditPostModal({ api, message, onClose, onSaved }) {
  const [body, setBody] = useState(message.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const limit = message.channel === 'x' ? 280 : 3000;
  const length = body.trim().length;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('PATCH', `/admin/marketing/messages/${message.id}`, { body });
      onSaved('Post updated.');
    } catch (err) {
      setError(err.message ?? err.code);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Edit ${message.channel === 'x' ? 'X' : 'LinkedIn'} post`}
      subtitle={message.status === 'scheduled' ? 'Scheduled. The publisher posts the text as written.' : 'Not queued yet.'}
      onClose={onClose}
      wide
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={busy || !body.trim() || length > limit} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Text" hint={`${length} of ${limit} characters.`}>
        <textarea rows={10} value={body} maxLength={20000} onChange={(e) => setBody(e.target.value)} />
      </Field>
      {length > limit ? <div className="aw-banner aw-banner--bad">{message.channel === 'x' ? 'X allows 280 characters.' : 'LinkedIn allows 3,000 characters.'}</div> : null}
      {error ? <div className="aw-banner aw-banner--bad">{error}</div> : null}
    </Modal>
  );
}

function ComposeModal({ api, contacts, onClose, onSaved }) {
  const [channel, setChannel] = useState('x');
  const [contactId, setContactId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (queueNow) => {
    setBusy(true);
    setError(null);
    try {
      const out = await api('POST', '/admin/marketing/messages', {
        channel,
        contactId: channel === 'email' ? Number(contactId) : undefined,
        subject: channel === 'email' ? subject : undefined,
        body,
      });
      if (queueNow) await api('POST', `/admin/marketing/messages/${out.message.id}/send`);
      onSaved(queueNow ? (channel === 'email' ? 'Sent.' : 'Queued for the publisher.') : 'Saved as a draft.');
    } catch (err) {
      setError(err.message ?? err.code);
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Compose"
      subtitle={channel === 'email' ? 'One-off email to a contact. The footer and opt-out line are added when it sends.' : 'A post for the local publisher. It posts from your own X or LinkedIn session.'}
      onClose={onClose}
      wide
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !body.trim()} onClick={() => submit(false)}>
            Save draft
          </Button>
          <Button kind="primary" disabled={busy || !body.trim()} onClick={() => submit(true)}>
            {channel === 'email' ? 'Send now' : 'Queue now'}
          </Button>
        </>
      }
    >
      <Field label="Channel">
        <Segmented value={channel} options={CHANNELS.filter((c) => c.value).map((c) => ({ value: c.value, label: c.label }))} onChange={setChannel} />
      </Field>
      {channel === 'email' ? (
        <>
          <Field label="Contact">
            <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">Pick a contact…</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.email}
                  {c.business ? ` — ${c.business}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Subject">
            <input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          </Field>
        </>
      ) : null}
      <Field label="Text" hint="X allows 280 characters; LinkedIn a little over 3,000.">
        <textarea rows={10} value={body} maxLength={20000} onChange={(e) => setBody(e.target.value)} />
      </Field>
      {channel !== 'email' ? <p className="aw-muted">Drafts do not reach the publisher until you queue them.</p> : null}
      {error ? <div className="aw-banner aw-banner--bad">{error}</div> : null}
    </Modal>
  );
}
