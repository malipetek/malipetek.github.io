/* The marketing desk: who we write to, what is queued, and the switch that sends it. */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
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
  ses_unconfigured: 'The sender is Amazon SES, but the Worker has no SES keys.',
  bounce_rate: 'Paused itself: the bounce rate passed 4%.',
  complaint_rate: 'Paused itself: the complaint rate passed 0.2%.',
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
  const [paging, setPaging] = useState({ total: 0, page: 200 });
  const [selected, setSelected] = useState(() => new Set());
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState(null);
  const [filters, setFilters] = useState({ status: '', q: '', source: '', offset: 0 });
  const filter = (patch) => {
    setSelected(new Set());
    setFilters((f) => ({ ...f, offset: 0, ...patch }));
  };
  // Bumped after any action, so the tab that owns its own list reloads too.
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    const search = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
    return Promise.all([api('GET', '/admin/marketing'), api('GET', `/admin/marketing/contacts${search ? `?${search}` : ''}`)])
      .then(([o, c]) => {
        setOverview(o);
        setContacts(c.contacts ?? []);
        setPaging({ total: c.total ?? (c.contacts ?? []).length, page: c.page ?? 200 });
        setError(null);
      })
      .catch(setError);
  }, [api, filters]);

  useEffect(() => {
    void load();
  }, [load]);
  usePoll(load, 30_000, [load]);

  const refresh = useCallback(() => {
    setTick((n) => n + 1);
    return load();
  }, [load]);
  const run = useCallback((fn, message) => act(fn, message).then(refresh, () => undefined), [act, refresh]);

  const contactsById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const done = useCallback(
    (message) => {
      setModal(null);
      notify(message);
      void refresh();
    },
    [refresh, notify],
  );

  if (error) return <p className="aw-empty">Could not load the desk: {error.message ?? error.code}</p>;
  if (!overview) return <p className="aw-empty">Loading…</p>;

  const { settings, health } = overview;
  const messagesToday = `${overview.today}/${settings.dailyCap} sent today`;
  const providerName = settings.provider === 'ses' ? 'Amazon SES' : 'Cloudflare';

  return (
    <div className="aw-view">
      <header className="aw-hero">
        <h2>Marketing</h2>
        <p className="aw-muted">
          Email sequences, X and LinkedIn posts, from <span className="aw-mono">{overview.sender}</span>. Replies to that
          address land here; “no”, the unsubscribe button or a spam complaint stops everything queued for that contact.
        </p>
      </header>

      {!overview.bound ? (
        <div className="aw-banner aw-banner--bad">
          {overview.senderState?.reason === 'ses_unconfigured'
            ? 'The sender is set to Amazon SES, but the Worker has no SES keys (AWS_SES_ACCESS_KEY_ID / AWS_SES_SECRET_ACCESS_KEY). Nothing can send.'
            : 'No outreach sender is bound on the Worker (MARKETING). Nothing can send.'}
        </div>
      ) : !settings.postalAddress ? (
        <div className="aw-banner aw-banner--bad">
          Set a postal address in Settings before a cold email goes out — anti-spam law asks for one on every send.
        </div>
      ) : !settings.live ? (
        <div className="aw-banner aw-banner--warn">
          Paused. {overview.due.email ? `${overview.due.email} email${overview.due.email === 1 ? '' : 's'} are due.` : 'Nothing is due yet.'}
          {health?.trip ? ` The desk paused itself: ${health.trip === 'bounce_rate' ? 'too many bounces' : 'too many complaints'}.` : ''}
          <span className="aw-toolbar__fill" />
          <Button size="sm" onClick={() => run(() => api('PUT', '/admin/marketing/settings', { live: true }), 'Outreach is live.')}>
            Go live
          </Button>
        </div>
      ) : (
        <div className="aw-banner">
          Live via {providerName} · {settings.startHour}:00–{settings.endHour}:00 {offsetLabel(settings.offsetMinutes)}
          {settings.weekdaysOnly ? ', weekdays' : ''} · {messagesToday} · window{' '}
          {overview.window.open ? 'open' : `closed (${WINDOW_REASON[overview.window.reason] ?? overview.window.reason})`}
          <span className="aw-toolbar__fill" />
          <Button size="sm" kind="ghost" onClick={() => run(() => api('POST', '/admin/marketing/run'), runMessage)}>
            Run now
          </Button>
          <Button size="sm" kind="ghost" onClick={() => run(() => api('PUT', '/admin/marketing/settings', { live: false }), 'Paused.')}>
            Pause
          </Button>
        </div>
      )}

      {overview.postsAwaiting ? (
        <div className="aw-banner aw-banner--warn">
          {plural(overview.postsAwaiting, 'post waits', 'posts wait')} for your approval. Nothing is posted until you approve it.
          <span className="aw-toolbar__fill" />
          <Button size="sm" onClick={() => setTab('posts')}>
            Review posts
          </Button>
        </div>
      ) : null}

      <div className="aw-tags">
        <Tag>{plural(overview.counts.contacts.queued, 'queued contact', 'queued contacts')}</Tag>
        <Tag>{overview.counts.contacts.replied} replied</Tag>
        <Tag tone={overview.counts.contacts.opted_out ? 'bad' : 'dash'}>{overview.counts.contacts.opted_out} opted out</Tag>
        <Tag tone={overview.counts.contacts.bounced ? 'bad' : 'dash'}>{overview.counts.contacts.bounced} bounced</Tag>
        <Tag tone={overview.counts.messages.failed ? 'bad' : 'dash'}>{plural(overview.counts.messages.failed, 'failed send', 'failed sends')}</Tag>
        <Tag tone={overview.due.email ? 'warn' : 'dash'}>{plural(overview.due.email, 'email due', 'emails due')}</Tag>
        <Tag tone={overview.due.x + overview.due.linkedin ? 'warn' : 'dash'}>{plural(overview.due.x + overview.due.linkedin, 'post due', 'posts due')}</Tag>
        {health ? (
          <Tag
            tone={health.trip ? 'bad' : health.bounceRate > health.maxBounceRate / 2 ? 'warn' : 'dash'}
            title={`Last 14 days: ${health.sent} sent, ${health.bounces} bounced, ${health.complaints} complaints. The desk pauses itself above ${pct(health.maxBounceRate)} bounces or ${pct(health.maxComplaintRate)} complaints.`}
          >
            bounces {pct(health.bounceRate)} · complaints {pct(health.complaintRate)}
          </Tag>
        ) : null}
      </div>

      <div className="aw-toolbar">
        <Segmented
          value={tab}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'contacts', label: `Contacts (${paging.total.toLocaleString('en-US')})` },
            { value: 'email', label: 'Email' },
            { value: 'posts', label: overview.postsAwaiting ? `Posts (${overview.postsAwaiting} to approve)` : 'Posts' },
            { value: 'sequences', label: 'Sequences' },
            { value: 'sources', label: 'Sources' },
            { value: 'settings', label: 'Settings' },
          ]}
          onChange={setTab}
        />
        <span className="aw-toolbar__fill" />
        {tab === 'contacts' ? (
          <>
            <input className="aw-search" value={filters.q} placeholder="Search email, name, business…" onChange={(e) => filter({ q: e.target.value })} />
            <select value={filters.status} onChange={(e) => filter({ status: e.target.value })}>
              <option value="">Every status</option>
              {Object.keys(CONTACT_TONE).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {filters.source ? (
              <Button size="sm" kind="ghost" onClick={() => filter({ source: '' })} title="Show every source">
                Source: {filters.source} ✕
              </Button>
            ) : null}
            <Button onClick={() => setModal({ kind: 'import' })}>Import CSV</Button>
            <Button onClick={() => setModal({ kind: 'bulkqueue' })}>Queue everyone</Button>
            <Button kind="primary" onClick={() => setModal({ kind: 'contact' })}>
              Add contact
            </Button>
          </>
        ) : null}
        {tab === 'email' ? (
          <>
            <Button kind="primary" onClick={() => setModal({ kind: 'review' })} title="Read the next first emails one by one: let each go, rewrite it, or cancel it.">
              Review next
            </Button>
            <Button onClick={() => setModal({ kind: 'compose', channel: 'email' })}>Compose</Button>
            <Button
              title="Rewrite every scheduled email from the current templates. Emails you edited by hand are left alone."
              onClick={() => run(() => api('POST', '/admin/marketing/messages/rerender'), 'Scheduled emails now use the current wording.')}
            >
              Re-render scheduled
            </Button>
          </>
        ) : null}
        {tab === 'posts' ? (
          <>
            <Button onClick={() => setModal({ kind: 'compose', channel: 'x' })}>Compose</Button>
            <Button kind="primary" onClick={() => run(() => api('POST', '/admin/marketing/cycle?force=1'), cycleMessage)}>
              Draft posts
            </Button>
          </>
        ) : null}
        {tab === 'settings' ? (
          <Button onClick={() => run(() => api('POST', '/admin/marketing/run'), runMessage)}>Run now</Button>
        ) : null}
      </div>

      {tab === 'overview' ? (
        <OverviewTab api={api} tick={tick} health={health} onReview={() => setModal({ kind: 'review' })} onContact={(id) => setModal({ kind: 'person', id })} />
      ) : null}

      {tab === 'contacts' ? (
        <section className="aw-panel">
          <div className="aw-inline" style={{ marginBottom: 8 }}>
            <span className="aw-muted">
              {paging.total
                ? `${(filters.offset + 1).toLocaleString('en-US')}–${Math.min(filters.offset + paging.page, paging.total).toLocaleString('en-US')} of ${paging.total.toLocaleString('en-US')}`
                : 'None'}
            </span>
            <Button size="sm" disabled={!filters.offset} onClick={() => setFilters((f) => ({ ...f, offset: Math.max(0, f.offset - paging.page) }))}>
              Previous
            </Button>
            <Button size="sm" disabled={filters.offset + paging.page >= paging.total} onClick={() => setFilters((f) => ({ ...f, offset: f.offset + paging.page }))}>
              Next
            </Button>
            <span className="aw-toolbar__fill" />
            {selected.size ? (
              <>
                <span>{plural(selected.size, 'contact selected', 'contacts selected')}</span>
                <Button
                  size="sm"
                  onClick={() =>
                    run(() => api('POST', '/admin/marketing/contacts/bulk', { action: 'pause', ids: [...selected] }), (out) => `${out.changed} paused; their queued mail was cancelled.`).then(() =>
                      setSelected(new Set()),
                    )
                  }
                >
                  Pause
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    run(() => api('POST', '/admin/marketing/contacts/bulk', { action: 'opt_out', ids: [...selected] }), (out) => `${out.changed} opted out; their queued mail was cancelled.`).then(() =>
                      setSelected(new Set()),
                    )
                  }
                >
                  Opt out
                </Button>
                <Button size="sm" kind="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </>
            ) : null}
          </div>
          <table className="aw-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select this page"
                    checked={contacts.length > 0 && contacts.every((c) => selected.has(c.id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(contacts.map((c) => c.id)) : new Set())}
                  />
                </th>
                <th>Contact</th>
                <th>Business / site</th>
                <th>Source</th>
                <th>Status</th>
                <th>Sent</th>
                <th>Next</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${c.email}`}
                      checked={selected.has(c.id)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(c.id);
                          else next.delete(c.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td className="aw-table__title" onClick={() => setModal({ kind: 'person', id: c.id })} style={{ cursor: 'pointer' }} title="Open the contact's history">
                    <span className="aw-mono">{c.email}</span>
                    {c.name ? <span className="aw-muted"> {c.name}</span> : null}
                    {c.gap ? <div className="aw-muted">{snippet(c.gap, 110)}</div> : null}
                  </td>
                  <td>
                    {c.business ?? '—'}
                    {c.site ? <div className="aw-muted">{c.site}</div> : null}
                  </td>
                  <td className="aw-muted">
                    {c.sourceKind ?? '—'}
                    {c.country ? <div>{c.country}</div> : null}
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

      {tab === 'email' ? <EmailTab api={api} run={run} tick={tick} events={overview.events} onOpen={(m) => setModal({ kind: 'message', id: m.id })} /> : null}

      {tab === 'posts' ? <PostsTab api={api} run={run} tick={tick} onEdit={(m) => setModal({ kind: 'edit', message: m })} /> : null}

      {tab === 'sequences' ? <SequencesTab api={api} sequences={overview.sequences} /> : null}

      {tab === 'sources' ? (
        <SourcesTab
          api={api}
          tick={tick}
          onPick={(source) => {
            filter({ source });
            setTab('contacts');
          }}
        />
      ) : null}

      {tab === 'settings' ? <SettingsTab overview={overview} run={run} api={api} contactsById={contactsById} /> : null}

      {modal?.kind === 'import' ? <ImportModal sequences={overview.sequences} onClose={() => setModal(null)} onDone={done} api={api} /> : null}

      {modal?.kind === 'bulkqueue' ? <BulkQueueModal sequences={overview.sequences} onClose={() => setModal(null)} onDone={done} api={api} /> : null}

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
          initialChannel={modal.channel}
          contacts={contacts.filter((c) => !['opted_out', 'bounced'].includes(c.status))}
          api={api}
          onClose={() => setModal(null)}
          onSaved={done}
        />
      ) : null}

      {modal?.kind === 'edit' ? <EditPostModal message={modal.message} api={api} onClose={() => setModal(null)} onSaved={done} /> : null}

      {modal?.kind === 'message' ? <MessageModal id={modal.id} api={api} onClose={() => setModal(null)} onDone={done} /> : null}

      {modal?.kind === 'review' ? <ReviewModal api={api} onClose={() => done('Review saved.')} /> : null}

      {modal?.kind === 'person' ? (
        <PersonModal
          id={modal.id}
          api={api}
          onClose={() => setModal(null)}
          onEdit={(contact) => setModal({ kind: 'contact', contact })}
          onOpenMessage={(id) => setModal({ kind: 'message', id })}
        />
      ) : null}
    </div>
  );
}

const pct = (rate) => `${(rate * 100).toFixed(rate && rate < 0.01 ? 2 : 1)}%`;

const runMessage = (result) =>
  result?.reason ? (REASONS[result.reason] ?? `Nothing sent: ${result.reason}`) : `Sent ${result?.sent ?? 0}${result?.failed ? `, ${result.failed} failed` : ''}.`;

/* —— overview: what left, what came back —— */

const dayName = (unix, offsetMinutes) => {
  const d = new Date((unix + offsetMinutes * 60) * 1000);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
};

const REPLY_TONE = { reply: 'ok', opt_out: 'warn', complaint: 'bad' };
const REPLY_LABEL = { reply: 'replied', opt_out: 'opted out', complaint: 'spam complaint' };

function OverviewTab({ api, tick, health, onReview, onContact }) {
  const [stats, setStats] = useState(null);
  const [replies, setReplies] = useState(null);
  const [review, setReview] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.all([
      api('GET', '/admin/marketing/stats?days=14'),
      api('GET', '/admin/marketing/replies'),
      api('GET', '/admin/marketing/review?limit=1'),
    ])
      .then(([s, r, v]) => {
        if (!live) return;
        setStats(s);
        setReplies(r.replies ?? []);
        setReview(v.nextDay);
      })
      .catch(() => live && setReplies([]));
    return () => {
      live = false;
    };
  }, [api, tick]);

  const sum = (key) => (stats?.days ?? []).reduce((n, d) => n + d[key], 0);
  const sent = sum('sent');
  return (
    <>
      <section className="aw-panel">
        <div className="aw-inline">
          <h3 style={{ margin: 0 }}>Next 24 hours</h3>
          <span className="aw-muted">
            {review ? `${review.reviewed} of ${plural(review.total, 'first email', 'first emails')} due by this time tomorrow are reviewed.` : '…'}
          </span>
          <span className="aw-toolbar__fill" />
          <Button kind="primary" onClick={onReview}>
            Review next
          </Button>
        </div>
      </section>

      <section className="aw-panel">
        <h3>Last 14 days</h3>
        <div className="aw-tags">
          <Tag>{sent.toLocaleString('en-US')} sent</Tag>
          <Tag tone={sum('reply') ? 'ok' : 'dash'}>
            {sum('reply')} replies {sent ? `(${pct(sum('reply') / sent)})` : ''}
          </Tag>
          <Tag tone={health?.trip === 'bounce_rate' ? 'bad' : 'dash'}>{sum('bounce')} bounces</Tag>
          <Tag tone="dash">{sum('opt_out')} opt-outs</Tag>
          <Tag tone={sum('complaint') ? 'bad' : 'dash'}>{sum('complaint')} complaints</Tag>
          <Tag tone="dash">{sum('published')} posts published</Tag>
        </div>
        {stats ? (
          <table className="aw-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Sent</th>
                <th>Replies</th>
                <th>Bounces</th>
                <th>Opt-outs</th>
                <th>Complaints</th>
                <th>Posts</th>
              </tr>
            </thead>
            <tbody>
              {stats.days.map((d) => (
                <tr key={d.day}>
                  <td className="aw-muted">{dayName(d.day, stats.offsetMinutes)}</td>
                  <td>{d.sent || '·'}</td>
                  <td>{d.reply || '·'}</td>
                  <td className={d.bounce ? 'aw-warn' : undefined}>{d.bounce || '·'}</td>
                  <td>{d.opt_out || '·'}</td>
                  <td className={d.complaint ? 'aw-warn' : undefined}>{d.complaint || '·'}</td>
                  <td>{d.published || '·'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="aw-muted">Loading…</p>
        )}
      </section>

      <section className="aw-panel">
        <h3>What came back</h3>
        <p className="aw-muted">Replies are also forwarded to your inbox; answer them from there. Opt-outs and complaints are closed already.</p>
        {replies?.length ? (
          <ul className="aw-rows">
            {replies.map((r) => (
              <li key={r.id} className="aw-row" style={{ alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => onContact(r.contact.id)}>
                <Tag tone={REPLY_TONE[r.kind]}>{REPLY_LABEL[r.kind] ?? r.kind}</Tag>
                <span className="aw-row__title">
                  {r.contact.business ?? r.contact.email}
                  <div className="aw-muted" style={{ whiteSpace: 'pre-wrap', fontWeight: 'normal' }}>
                    {snippet(r.text ?? '', 400)}
                  </div>
                </span>
                <span className="aw-muted">{ago(r.at)} ago</span>
              </li>
            ))}
          </ul>
        ) : replies ? (
          <p className="aw-muted">Nothing yet.</p>
        ) : null}
      </section>
    </>
  );
}

/* —— review: the next first emails, one at a time —— */

function ReviewModal({ api, onClose }) {
  const [queue, setQueue] = useState(null);
  const [nextDay, setNextDay] = useState(null);
  const [index, setIndex] = useState(0);
  const [detail, setDetail] = useState(null);
  const [draft, setDraft] = useState(null);
  const [done, setDone] = useState({ ok: 0, rewritten: 0, cancelled: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const loadQueue = useCallback(
    () =>
      api('GET', '/admin/marketing/review?limit=50').then((out) => {
        setQueue(out.messages ?? []);
        setNextDay(out.nextDay);
        setIndex(0);
      }),
    [api],
  );
  useEffect(() => {
    void loadQueue().catch((err) => setError(err.message ?? err.code));
  }, [loadQueue]);

  const current = queue?.[index] ?? null;
  useEffect(() => {
    if (!current) return undefined;
    let live = true;
    setDetail(null);
    setDraft(null);
    api('GET', `/admin/marketing/messages/${current.id}`)
      .then((out) => live && setDetail(out))
      .catch((err) => live && setError(err.message ?? err.code));
    return () => {
      live = false;
    };
  }, [api, current]);

  const step = async (fn, counter) => {
    setBusy(true);
    setError(null);
    try {
      if (fn) await fn();
      if (counter) setDone((d) => ({ ...d, [counter]: d[counter] + 1 }));
      if (index + 1 < queue.length) setIndex(index + 1);
      else await loadQueue();
    } catch (err) {
      setError(err.message ?? err.code);
    } finally {
      setBusy(false);
    }
  };

  const progress = `${done.ok} let go · ${done.rewritten} rewritten · ${done.cancelled} cancelled${nextDay ? ` · next 24h: ${nextDay.reviewed + done.ok + done.rewritten}/${nextDay.total} reviewed` : ''}`;

  if (queue && !current) {
    return (
      <Modal title="Review" subtitle={progress} onClose={onClose} actions={<Button kind="primary" onClick={onClose}>Done</Button>}>
        <p>Every queued first email is reviewed. Follow-ups go with their first email.</p>
      </Modal>
    );
  }

  const contact = detail?.contact;
  return (
    <Modal
      title={current ? `${index + 1} of ${queue.length}: ${current.contactEmail}` : 'Review'}
      subtitle={progress}
      onClose={onClose}
      wide
      actions={
        draft ? (
          <>
            <Button onClick={() => setDraft(null)}>Back</Button>
            <Button
              kind="primary"
              disabled={busy || !draft.subject.trim() || !draft.body.trim()}
              onClick={() => step(() => api('PATCH', `/admin/marketing/messages/${current.id}`, draft), 'rewritten')}
            >
              Save and next
            </Button>
          </>
        ) : (
          <>
            <Button kind="ghost" disabled={busy || !current} onClick={() => step(() => api('POST', `/admin/marketing/messages/${current.id}/cancel`), 'cancelled')}>
              Cancel this email
            </Button>
            <Button disabled={busy || !current} onClick={() => step(null, null)}>
              Skip
            </Button>
            <Button disabled={busy || !detail} onClick={() => setDraft({ subject: current.subject ?? '', body: current.body })}>
              Rewrite
            </Button>
            <Button kind="primary" disabled={busy || !current} onClick={() => step(() => api('POST', `/admin/marketing/messages/${current.id}/review`), 'ok')}>
              Looks good, next
            </Button>
          </>
        )
      }
    >
      {contact ? (
        <p className="aw-muted" style={{ marginTop: 0 }}>
          {[contact.business, contact.site, contact.sourceKind, contact.country].filter(Boolean).join(' · ')}
          {current?.scheduledAt ? ` · goes ${when(current.scheduledAt)}` : ''}
          {contact.site ? (
            <>
              {' · '}
              <a href={/^https?:/.test(contact.site) ? contact.site : `https://${contact.site}`} target="_blank" rel="noreferrer">
                open site
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {draft ? (
        <>
          <Field label="Subject">
            <input value={draft.subject} maxLength={200} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} />
          </Field>
          <Field label="Body" hint="The footer is added when it sends.">
            <textarea rows={16} value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} autoFocus />
          </Field>
        </>
      ) : detail ? (
        <>
          <p style={{ fontWeight: 600, margin: '0 0 8px' }}>{detail.preview.subject}</p>
          <pre style={{ whiteSpace: 'pre-wrap', font: 'inherit', lineHeight: 1.5, padding: 12, border: '1px solid var(--aw-line, #ddd)', borderRadius: 6, margin: 0 }}>
            {detail.preview.text}
          </pre>
        </>
      ) : (
        <p className="aw-muted">Loading…</p>
      )}
      {error ? <div className="aw-banner aw-banner--bad">{error}</div> : null}
    </Modal>
  );
}

/* —— one contact, everything that happened —— */

function PersonModal({ id, api, onClose, onEdit, onOpenMessage }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    api('GET', `/admin/marketing/contacts/${id}`)
      .then((out) => live && setData(out))
      .catch((err) => live && setError(err.message ?? err.code));
    return () => {
      live = false;
    };
  }, [api, id]);
  const c = data?.contact;
  return (
    <Modal
      title={c?.email ?? 'Contact'}
      subtitle={c ? [c.name, c.business, c.site].filter(Boolean).join(' · ') : undefined}
      onClose={onClose}
      wide
      actions={
        <>
          <Button onClick={onClose}>Close</Button>
          {c ? (
            <Button kind="primary" onClick={() => onEdit(c)}>
              Edit contact
            </Button>
          ) : null}
        </>
      }
    >
      {error ? <div className="aw-banner aw-banner--bad">{error}</div> : null}
      {c ? (
        <>
          <div className="aw-tags">
            <Tag tone={CONTACT_TONE[c.status]}>{c.status}</Tag>
            {c.sourceKind ? <Tag tone="dash">{c.sourceKind}</Tag> : null}
            {c.country ? <Tag tone="dash">{c.country}</Tag> : null}
            <Tag tone="dash">added {ago(c.createdAt)} ago</Tag>
          </div>
          {c.gap ? <p>Observation: {c.gap}</p> : <p className="aw-muted">No observation written; the plain versions are used.</p>}
          {c.sourceUrl ? (
            <p className="aw-muted">
              Found on{' '}
              <a href={c.sourceUrl} target="_blank" rel="noreferrer">
                {c.sourceUrl}
              </a>
            </p>
          ) : null}
          {c.notes ? <p className="aw-muted">{c.notes}</p> : null}
          <h3>Messages</h3>
          <table className="aw-table">
            <tbody>
              {data.messages.map((m) => (
                <tr key={m.id} onClick={() => onOpenMessage(m.id)} style={{ cursor: 'pointer' }}>
                  <td className="aw-muted">{m.sentAt ? `${ago(m.sentAt)} ago` : m.scheduledAt ? when(m.scheduledAt) : '—'}</td>
                  <td>
                    {m.subject} {m.editedAt ? <Tag tone="ok">edited</Tag> : m.reviewedAt ? <Tag tone="ok">reviewed</Tag> : null}
                  </td>
                  <td>
                    <Tag tone={MESSAGE_TONE[m.status]}>{m.status}</Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.messages.length ? <p className="aw-muted">Nothing queued or sent.</p> : null}
          <h3>Events</h3>
          <ul className="aw-rows">
            {data.events.map((e) => (
              <li key={e.id} className="aw-row">
                <Tag tone={EVENT_BAD.has(e.kind) ? 'bad' : EVENT_GOOD.has(e.kind) ? 'ok' : 'dash'}>{e.kind.replaceAll('_', ' ')}</Tag>
                <span className="aw-muted" style={{ whiteSpace: 'pre-wrap' }}>
                  {snippet(e.detail ?? '', 300)}
                </span>
                <span className="aw-muted">{ago(e.createdAt)} ago</span>
              </li>
            ))}
          </ul>
          {!data.events.length ? <p className="aw-muted">No events.</p> : null}
        </>
      ) : !error ? (
        <p className="aw-muted">Loading…</p>
      ) : null}
    </Modal>
  );
}

/* —— email: the send queue, in send order —— */

function EmailTab({ api, run, tick, events, onOpen }) {
  const [order, setOrder] = useState('next');
  const [status, setStatus] = useState('scheduled');
  const [messages, setMessages] = useState(null);

  useEffect(() => {
    let live = true;
    const search = new URLSearchParams({ channel: 'email', ...(status ? { status } : {}), ...(order === 'next' ? { order: 'next' } : {}) });
    api('GET', `/admin/marketing/messages?${search}`)
      .then((out) => live && setMessages(out.messages ?? []))
      .catch(() => live && setMessages([]));
    return () => {
      live = false;
    };
  }, [api, order, status, tick]);

  return (
    <section className="aw-panel">
      <div className="aw-inline" style={{ marginBottom: 8 }}>
        <Segmented
          value={order}
          options={[
            { value: 'next', label: 'Next to send' },
            { value: 'recent', label: 'Latest first' },
          ]}
          onChange={setOrder}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Every status</option>
          {Object.keys(MESSAGE_TONE).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="aw-muted">Click an email to read it exactly as it leaves, rewrite it, or send yourself a test.</span>
      </div>
      {messages === null ? <p className="aw-muted">Loading…</p> : null}
      {messages?.length ? (
        <table className="aw-table">
          <thead>
            <tr>
              <th>When</th>
              <th>To</th>
              <th>Email</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <tr key={m.id} onClick={() => onOpen(m)} style={{ cursor: 'pointer' }}>
                <td className="aw-muted">{m.sentAt ? `${ago(m.sentAt)} ago` : m.scheduledAt ? when(m.scheduledAt) : 'draft'}</td>
                <td className="aw-mono">{m.contactEmail ?? '—'}</td>
                <td className="aw-table__title">
                  <div>
                    {m.subject} {m.editedAt ? <Tag tone="ok">edited</Tag> : m.reviewedAt ? <Tag tone="ok">reviewed</Tag> : null}{' '}
                    <span className="aw-muted">· step {m.step + 1}</span>
                  </div>
                  <div className="aw-muted">{snippet(m.body.replace(/\s+/g, ' '), 140)}</div>
                  {m.error ? <div className="aw-warn">{m.error}</div> : null}
                </td>
                <td>
                  <Tag tone={MESSAGE_TONE[m.status]}>{m.status}</Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : messages ? (
        <p className="aw-muted">No email matches.</p>
      ) : null}
      {messages?.length === 200 ? <p className="aw-muted">The first 200 are shown.</p> : null}

      <div className="aw-group">
        <h3>Recent events</h3>
        <ul className="aw-rows">
          {events.map((e) => (
            <li key={e.id} className="aw-row">
              <Tag tone={EVENT_BAD.has(e.kind) ? 'bad' : EVENT_GOOD.has(e.kind) ? 'ok' : 'dash'}>{e.kind.replaceAll('_', ' ')}</Tag>
              <span className="aw-row__title">{e.email ?? '—'}</span>
              <span className="aw-muted">{snippet(e.detail ?? '', 100)}</span>
              <span className="aw-muted">{ago(e.createdAt)} ago</span>
            </li>
          ))}
        </ul>
        {!events.length ? <p className="aw-muted">Nothing has happened yet.</p> : null}
      </div>
    </section>
  );
}

const EVENT_BAD = new Set(['failed', 'bounce', 'opt_out', 'complaint', 'cycle_failed', 'auto_paused', 'blocked']);
const EVENT_GOOD = new Set(['reply', 'sent', 'published', 'cycle', 'approved']);

/** One email: what leaves, word for word, and the hand edit. */
function MessageModal({ id, api, onClose, onDone }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api('GET', `/admin/marketing/messages/${id}`)
        .then(setData)
        .catch((err) => setError(err.message ?? err.code)),
    [api, id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const doing = async (fn, message, close = true) => {
    setBusy(true);
    setError(null);
    try {
      const out = await fn();
      if (close) onDone(typeof message === 'function' ? message(out) : message);
      else {
        await load();
        setDraft(null);
      }
    } catch (err) {
      setError(err.message ?? err.code);
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <Modal title="Email" onClose={onClose}>
        {error ? <div className="aw-banner aw-banner--bad">{error}</div> : <p className="aw-muted">Loading…</p>}
      </Modal>
    );
  }

  const { message: m, preview, contact } = data;
  const editable = ['draft', 'scheduled', 'failed'].includes(m.status);
  return (
    <Modal
      title={m.subject ?? 'Email'}
      subtitle={`${m.status}${m.scheduledAt && !m.sentAt ? ` for ${when(m.scheduledAt)}` : ''}${m.sentAt ? `, sent ${ago(m.sentAt)} ago` : ''}${m.provider ? ` via ${m.provider}` : ''}${m.editedAt ? ' · edited by hand' : ''}`}
      onClose={onClose}
      wide
      actions={
        draft ? (
          <>
            <Button onClick={() => setDraft(null)}>Discard</Button>
            <Button
              kind="primary"
              disabled={busy || !draft.subject.trim() || !draft.body.trim()}
              onClick={() => doing(() => api('PATCH', `/admin/marketing/messages/${m.id}`, draft), null, false)}
            >
              Save wording
            </Button>
          </>
        ) : (
          <>
            {editable ? (
              <Button kind="ghost" disabled={busy} onClick={() => doing(() => api('POST', `/admin/marketing/messages/${m.id}/cancel`), 'Cancelled.')}>
                Cancel email
              </Button>
            ) : null}
            <Button disabled={busy} onClick={() => doing(() => api('POST', `/admin/marketing/messages/${m.id}/test`), (out) => `Test sent to ${out.to} via ${out.provider}.`)}>
              Send me a test
            </Button>
            {editable ? (
              <Button onClick={() => setDraft({ subject: m.subject ?? '', body: m.body })}>Rewrite</Button>
            ) : null}
            {editable ? (
              <Button kind="primary" disabled={busy} onClick={() => doing(() => api('POST', `/admin/marketing/messages/${m.id}/send`), 'Sent.')}>
                Send now
              </Button>
            ) : null}
          </>
        )
      }
    >
      {draft ? (
        <>
          <Field label="Subject">
            <input value={draft.subject} maxLength={200} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} />
          </Field>
          <Field label="Body" hint="The footer (your name, postal address and the opt-out line) is added when it sends. Re-render will not overwrite a hand edit.">
            <textarea rows={16} value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
          </Field>
        </>
      ) : (
        <>
          <dl className="aw-mono" style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '2px 12px', fontSize: 12, margin: 0 }}>
            <dt className="aw-muted">From</dt>
            <dd style={{ margin: 0 }}>{preview.from}</dd>
            <dt className="aw-muted">To</dt>
            <dd style={{ margin: 0 }}>
              {preview.to}
              {contact?.business ? ` (${contact.business})` : ''}
            </dd>
            <dt className="aw-muted">Reply-To</dt>
            <dd style={{ margin: 0 }}>{preview.replyTo}</dd>
            {Object.entries(preview.headers ?? {}).map(([name, value]) => (
              <Fragment key={name}>
                <dt className="aw-muted">{name}</dt>
                <dd style={{ margin: 0, wordBreak: 'break-all' }}>{value}</dd>
              </Fragment>
            ))}
            <dt className="aw-muted">Subject</dt>
            <dd style={{ margin: 0 }}>{preview.subject}</dd>
          </dl>
          <pre style={{ whiteSpace: 'pre-wrap', font: 'inherit', lineHeight: 1.5, padding: 12, border: '1px solid var(--aw-line, #ddd)', borderRadius: 6, marginTop: 12 }}>
            {preview.text}
          </pre>
          {preview.image ? (
            <figure style={{ margin: '0 0 12px' }}>
              <img src={preview.image} alt="" width={280} style={{ display: 'block', height: 'auto', border: '1px solid var(--aw-line, #ddd)', borderRadius: 6 }} />
              <figcaption className="aw-muted" style={{ fontSize: 12 }}>
                Sent as HTML with this GIF above the signature; the text above is the plain-text part.
              </figcaption>
            </figure>
          ) : null}
          {contact ? (
            <p className="aw-muted">
              {contact.site ? `Site ${contact.site}. ` : ''}
              {contact.sourceKind ? `Source ${contact.sourceKind}. ` : ''}
              {contact.gap ? `Observation: ${contact.gap}` : 'No observation on this contact, so the plain version is used.'}
            </p>
          ) : null}
          {data.events?.length ? (
            <ul className="aw-rows">
              {data.events.map((e) => (
                <li key={e.id} className="aw-row">
                  <Tag tone={EVENT_BAD.has(e.kind) ? 'bad' : EVENT_GOOD.has(e.kind) ? 'ok' : 'dash'}>{e.kind}</Tag>
                  <span className="aw-muted">{snippet(e.detail ?? '', 100)}</span>
                  <span className="aw-muted">{ago(e.createdAt)} ago</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {error ? <div className="aw-banner aw-banner--bad">{error}</div> : null}
    </Modal>
  );
}

/* —— posts: the audit, before and after they go out —— */

const POST_MAX = { x: 280, linkedin: 3000 };

function PostsTab({ api, run, tick, onEdit }) {
  const [posts, setPosts] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.all(['x', 'linkedin'].map((channel) => api('GET', `/admin/marketing/messages?channel=${channel}`)))
      .then((lists) => live && setPosts(lists.flatMap((out) => out.messages ?? [])))
      .catch(() => live && setPosts([]));
    return () => {
      live = false;
    };
  }, [api, tick]);

  if (!posts) return <p className="aw-muted">Loading…</p>;
  const at = (m) => m.scheduledAt ?? m.createdAt;
  const groups = [
    { title: 'Waiting for your approval', hint: 'Written by the content cycle. Nothing here is posted until you approve it.', list: posts.filter((m) => m.status === 'draft').sort((a, b) => at(a) - at(b)) },
    { title: 'Scheduled', hint: 'The publisher posts these at their time from your browser profile. You get an email when each goes out.', list: posts.filter((m) => m.status === 'scheduled' || m.status === 'sending').sort((a, b) => at(a) - at(b)) },
    { title: 'Failed', list: posts.filter((m) => m.status === 'failed') },
    { title: 'Published', list: posts.filter((m) => m.status === 'sent').sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0)) },
  ];

  return (
    <>
      {groups.map((group) =>
        group.list.length ? (
          <section key={group.title} className="aw-panel">
            <h3>
              {group.title} ({group.list.length})
            </h3>
            {group.hint ? <p className="aw-muted">{group.hint}</p> : null}
            {group.list.map((m) => (
              <PostCard key={m.id} post={m} api={api} run={run} onEdit={onEdit} />
            ))}
          </section>
        ) : null,
      )}
      {!posts.length ? <p className="aw-muted">No posts yet. Draft posts files a content cycle; Compose writes one by hand.</p> : null}
    </>
  );
}

function PostCard({ post: m, api, run, onEdit }) {
  const open = ['draft', 'scheduled', 'failed'].includes(m.status);
  const max = POST_MAX[m.channel] ?? 3000;
  return (
    <article style={{ borderTop: '1px solid var(--aw-line, #e5e5e5)', padding: '10px 0' }}>
      <div className="aw-inline">
        <Tag>{m.channel === 'x' ? 'X' : 'LinkedIn'}</Tag>
        <Tag tone={MESSAGE_TONE[m.status]}>{m.status === 'draft' ? 'to approve' : m.status}</Tag>
        <span className="aw-muted">
          {m.sentAt ? `posted ${ago(m.sentAt)} ago` : m.scheduledAt ? `slot ${when(m.scheduledAt)}` : 'no slot'} · {m.body.length}/{max} characters
          {m.kind === 'auto' ? ' · written by the content cycle' : ''}
        </span>
        <span className="aw-toolbar__fill" />
        {m.url ? (
          <a href={m.url} target="_blank" rel="noreferrer">
            Open post
          </a>
        ) : null}
      </div>
      <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0' }}>{m.body}</p>
      {m.error ? <div className="aw-warn">{m.error}</div> : null}
      {open ? (
        <div className="aw-inline">
          {m.status === 'draft' ? (
            <Button size="sm" kind="primary" onClick={() => run(() => api('POST', `/admin/marketing/messages/${m.id}/approve`), 'Approved: it goes out in its slot.')}>
              Approve
            </Button>
          ) : null}
          <Button size="sm" onClick={() => onEdit(m)}>
            Edit
          </Button>
          {m.status === 'failed' ? (
            <Button size="sm" onClick={() => run(() => api('POST', `/admin/marketing/messages/${m.id}/retry`), 'Queued again.')}>
              Retry
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => run(() => api('POST', `/admin/marketing/messages/${m.id}/send`), 'Due now: the publisher posts it within 15 minutes.')}
          >
            Post now
          </Button>
          <Button size="sm" kind="ghost" onClick={() => run(() => api('POST', `/admin/marketing/messages/${m.id}/cancel`), 'Cancelled.')}>
            {m.status === 'draft' ? 'Reject' : 'Cancel'}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

/* —— sequences: the templates, filled in for a real contact —— */

function SequencesTab({ api, sequences }) {
  const [sequence, setSequence] = useState(sequences[0]?.key ?? 'cold_a');
  const [data, setData] = useState(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setData(null);
    api('GET', `/admin/marketing/sequences/preview?sequence=${sequence}`)
      .then((out) => live && setData(out))
      .catch(() => live && setData({ steps: [] }));
    return () => {
      live = false;
    };
  }, [api, sequence, nonce]);

  return (
    <section className="aw-panel">
      <div className="aw-inline">
        <select value={sequence} onChange={(e) => setSequence(e.target.value)}>
          {sequences.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={() => setNonce((n) => n + 1)}>
          Another contact
        </Button>
        <span className="aw-muted">
          {data?.contact ? `Filled in for ${data.contact.email}${data.contact.business ? ` (${data.contact.business})` : ''}.` : data ? 'Filled in for a sample contact.' : ''}
        </span>
      </div>
      <p className="aw-muted">
        The wording lives in <span className="aw-mono">SEQUENCES</span> in <span className="aw-mono">worker/src/marketing.ts</span>. To change it for one
        person, open their email in the Email tab and rewrite it there.
      </p>
      {data?.steps.map((step) => (
        <article key={step.kind} style={{ borderTop: '1px solid var(--aw-line, #e5e5e5)', padding: '10px 0' }}>
          <div className="aw-inline">
            <Tag>day {step.day}</Tag>
            <strong>{step.subject}</strong>
            {step.usesPlain ? <Tag tone="dash">plain version: no observation</Tag> : null}
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', font: 'inherit', lineHeight: 1.5 }}>
            {step.body}
            <span className="aw-muted">{data.footer}</span>
          </pre>
        </article>
      ))}
    </section>
  );
}

/* —— sources: which list deserves the next hour —— */

function SourcesTab({ api, tick, onPick }) {
  const [sources, setSources] = useState(null);
  useEffect(() => {
    let live = true;
    api('GET', '/admin/marketing/sources')
      .then((out) => live && setSources(out.sources ?? []))
      .catch(() => live && setSources([]));
    return () => {
      live = false;
    };
  }, [api, tick]);
  if (!sources) return <p className="aw-muted">Loading…</p>;
  const rate = (n, d) => (d ? pct(n / d) : '—');
  return (
    <section className="aw-panel">
      <p className="aw-muted">
        A source is the label given at import (the file name by default). Rates are per contact reached. A source whose bounces pass 4%
        will pause the whole desk, so drop or verify it first.
      </p>
      <table className="aw-table">
        <thead>
          <tr>
            <th>Source</th>
            <th>Contacts</th>
            <th>Queued</th>
            <th>Reached</th>
            <th>Replied</th>
            <th>Bounced</th>
            <th>Opted out</th>
            <th>Complaints</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.source} onClick={() => onPick(s.source)} style={{ cursor: 'pointer' }} title="Show these contacts">
              <td className="aw-mono">{s.source}</td>
              <td>{s.contacts}</td>
              <td>{s.queued}</td>
              <td>{s.reached}</td>
              <td>
                {s.replied} <span className="aw-muted">{rate(s.replied, s.reached)}</span>
              </td>
              <td>
                {s.bounced} <span className={s.reached && s.bounced / s.reached > 0.04 ? 'aw-warn' : 'aw-muted'}>{rate(s.bounced, s.reached)}</span>
              </td>
              <td>
                {s.optedOut} <span className="aw-muted">{rate(s.optedOut, s.reached)}</span>
              </td>
              <td>
                {s.complaints} <span className={s.complaints ? 'aw-warn' : 'aw-muted'}>{rate(s.complaints, s.reached)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!sources.length ? <p className="aw-muted">No contacts yet.</p> : null}
    </section>
  );
}

/** Emails the send window can carry in a day at the current per-run size. */
function windowRoom(settings) {
  const hours = settings.startHour === settings.endHour ? 24 : (settings.endHour - settings.startHour + 24) % 24 || 24;
  return (hours * 12 * settings.perRun).toLocaleString('en-US');
}

/* —— model health —— */

function ModelHealth({ api }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    let live = true;
    api('GET', '/admin/health/deepseek')
      .then((out) => {
        if (live) setState(out);
      })
      .catch(() => {
        if (live) setState({ bridge: false, chat: false });
      });
    return () => {
      live = false;
    };
  }, [api]);
  if (!state) return null;
  const tone = state.chat ? 'ok' : state.bridge ? 'warn' : 'bad';
  const label = state.chat ? 'DeepSeek up' : state.bridge ? 'Workers AI fallback' : 'both engines down';
  return (
    <section className="aw-panel">
      <h3>The model</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Tag tone={tone}>{label}</Tag>
        <span className="aw-muted">
          {state.chat
            ? 'The site chat and the ticket bridge both use DeepSeek.'
            : state.bridge
              ? `DeepSeek is out of balance. The ticket bridge is on ${state.engine ?? 'Workers AI'}; the site chat is handing visitors to email until it is topped up.`
              : 'The site chat and the ticket bridge are both handing off.'}
        </span>
      </div>
    </section>
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
      <ModelHealth api={api} />
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
          <Field
            label="Sender"
            hint={
              overview.providers.ses
                ? 'Amazon SES: 50,000 a day, 14 a second, DKIM on malipetek.dev. Bounces and complaints come back to hello@ and are filed here.'
                : 'Amazon SES needs AWS_SES_ACCESS_KEY_ID and AWS_SES_SECRET_ACCESS_KEY as Worker secrets first.'
            }
          >
            <Segmented
              value={draft.provider}
              options={[
                { value: 'cloudflare', label: 'Cloudflare' },
                { value: 'ses', label: 'Amazon SES' },
              ]}
              onChange={(v) => set('provider', v)}
            />
          </Field>
          <Field
            label="Review first emails"
            hint="On: a first email goes out only after you read it in Review next (or rewrote it). Follow-ups ride on the first. Off: everything queued goes at its time."
          >
            <Segmented
              value={Boolean(draft.reviewFirst)}
              options={[
                { value: true, label: 'Only reviewed' },
                { value: false, label: 'Send all' },
              ]}
              onChange={(v) => set('reviewFirst', v)}
            />
          </Field>
          <Field
            label="Workshop GIF"
            hint="The homepage conveyor as a looping GIF above the signature (malipetek.dev/email/conveyor.gif, linked, about 470 KB). Emails without it go as plain text only."
          >
            <Segmented
              value={draft.image ?? 'first'}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'first', label: 'First emails' },
                { value: 'all', label: 'Every email' },
              ]}
              onChange={(v) => set('image', v)}
            />
          </Field>
          <Field
            label="Daily cap"
            hint={`Emails per day across every sequence. Raise it in steps (for example 50, 100, 250, 500, 1,000 over two weeks) and watch the bounce rate in Sources between steps. At ${draft.perRun} per run, the window allows about ${windowRoom(draft)} a day.`}
          >
            <input inputMode="numeric" value={draft.dailyCap} onChange={(e) => set('dailyCap', Number(e.target.value))} />
          </Field>
          <Field label="Per run" hint="The cron runs every five minutes; up to 200.">
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
        <h3>List health</h3>
        <p className="aw-muted">
          Last 14 days: {overview.health.sent} sent, {overview.health.bounces} bounced ({pct(overview.health.bounceRate)}), {overview.health.complaints}{' '}
          complaints ({pct(overview.health.complaintRate)}). The desk pauses itself and emails you above {pct(overview.health.maxBounceRate)} bounces or{' '}
          {pct(overview.health.maxComplaintRate)} complaints, before SES would review the account (5% and 0.1%). Every email carries a one-click
          unsubscribe header.
        </p>
      </section>

      <section className="aw-panel">
        <h3>Written posts</h3>
        <Field label="Approval" hint="On: posts the content cycle writes wait in Posts until you approve them, and you get an email with their text. Every post that goes out is also emailed to you.">
          <Segmented
            value={Boolean(draft.postApproval)}
            options={[
              { value: true, label: 'Approve each post' },
              { value: false, label: 'Post on schedule' },
            ]}
            onChange={(v) => set('postApproval', v)}
          />
        </Field>
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
  const [file, setFile] = useState(null);
  const [sequence, setSequence] = useState('none');
  const [campaign, setCampaign] = useState('launch');
  const [genericGap, setGenericGap] = useState(false);
  const [sourceKind, setSourceKind] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const chosen = sequences.find((s) => s.key === sequence);
  const needsGap = Boolean(chosen?.needsGap);

  const pick = async (event) => {
    const picked = event.target.files?.[0] ?? null;
    setFile(picked);
    setCsv(picked ? await picked.text() : '');
    // The file name says which list it is, which is what Sources groups by.
    if (picked) setSourceKind(picked.name.replace(/\.csv$/i, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-'));
    if (picked && /mail-only/i.test(picked.name)) setSequence('nosite');
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api('POST', '/admin/marketing/contacts/import', { csv, sequence, campaign, genericGap, sourceKind });
      onDone(
        `${result.added} added${result.queued ? `, ${result.queued} queued (${result.emails} emails)` : ''}` +
          `${result.paused ? `, ${result.paused} held for a missing observation` : ''}` +
          `${result.skipped.length ? `, ${result.skipped.length} skipped` : ''}.`,
      );
    } catch (err) {
      setError(err.message ?? err.code);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Import contacts"
      subtitle="Upload a CSV. Columns: email, name, business, site, gap, source_url, notes, and optionally source_kind and country (two letters; DE, AT, CH, IT, ES, PL, DK, NO and TR are never mailed cold). The gap is the one specific, true observation the first email opens with."
      onClose={onClose}
      wide
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={busy || !csv.trim()} onClick={submit}>
            {busy ? 'Importing…' : 'Import'}
          </Button>
        </>
      }
    >
      <Field label="CSV file" hint="A file with a header row. It is read in the browser and sent as text, so a large export does not have to be pasted.">
        <input type="file" accept=".csv,text/csv" onChange={pick} />
      </Field>
      {file ? (
        <p className="aw-muted">
          {file.name} · {Math.round(file.size / 1024)} KB
        </p>
      ) : null}
      <Field label="Sequence" hint="Choose “Import only” to review the list first; the bulk Queue action can queue everyone later.">
        <select value={sequence} onChange={(e) => setSequence(e.target.value)}>
          <option value="none">Import only — do not queue yet</option>
          {sequences.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Campaign" hint="Kept on every message so a later read can tell batches apart.">
        <input value={campaign} maxLength={40} onChange={(e) => setCampaign(e.target.value)} />
      </Field>
      <Field label="Source" hint="Which list this is. Sources shows reply, bounce and complaint rates per source, so you know which kind of list to build more of.">
        <input value={sourceKind} maxLength={60} placeholder="osm-colorado-mail-only" onChange={(e) => setSourceKind(e.target.value)} />
      </Field>
      {needsGap ? (
        <Field label="Contacts without an observation" hint="A cold email without one is usually spam. Leave this off to hold them; turn it on to use a general, true opener instead.">
          <label className="aw-inline">
            <input type="checkbox" checked={genericGap} onChange={(e) => setGenericGap(e.target.checked)} />
            Use a general opener when the gap is empty
          </label>
        </Field>
      ) : null}
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
  const [genericGap, setGenericGap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const chosen = sequences.find((s) => s.key === sequence);
  const submit = async () => {
    setBusy(true);
    try {
      const out = await api('POST', `/admin/marketing/contacts/${contact.id}/queue`, { sequence, genericGap });
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
      {chosen?.needsGap && !contact.gap ? (
        <Field label="No observation on this contact" hint="A cold email without one is usually spam.">
          <label className="aw-inline">
            <input type="checkbox" checked={genericGap} onChange={(e) => setGenericGap(e.target.checked)} />
            Queue with a general opener
          </label>
        </Field>
      ) : null}
      {error ? <div className="aw-banner aw-banner--bad">{error}</div> : null}
    </Modal>
  );
}

function BulkQueueModal({ api, sequences, onClose, onDone }) {
  const [sequence, setSequence] = useState('cold_a');
  const [campaign, setCampaign] = useState('launch');
  const [genericGap, setGenericGap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const chosen = sequences.find((s) => s.key === sequence);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api('POST', '/admin/marketing/contacts/queue', { sequence, campaign, genericGap });
      onDone(
        `${result.queued} contacts queued (${result.emails} emails)` +
          `${result.skippedNoGap ? `, ${result.skippedNoGap} skipped without an observation` : ''}.`,
      );
    } catch (err) {
      setError(err.message ?? err.code);
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Queue everyone"
      subtitle="Every new or paused contact without mail already queued. Contacts with an observation are queued; the rest are skipped unless you choose the general opener."
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={busy} onClick={submit}>
            {busy ? 'Queueing…' : 'Queue everyone'}
          </Button>
        </>
      }
    >
      <Field label="Sequence">
        <select value={sequence} onChange={(e) => setSequence(e.target.value)}>
          {sequences.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Campaign">
        <input value={campaign} maxLength={40} onChange={(e) => setCampaign(e.target.value)} />
      </Field>
      {chosen?.needsGap ? (
        <Field label="Contacts without an observation" hint="Leave this off to skip them; turn it on to use a general, true opener.">
          <label className="aw-inline">
            <input type="checkbox" checked={genericGap} onChange={(e) => setGenericGap(e.target.checked)} />
            Queue them anyway with a general opener
          </label>
        </Field>
      ) : null}
      {error ? <div className="aw-banner aw-banner--bad">{error}</div> : null}
    </Modal>
  );
}

function EditPostModal({ api, message, onClose, onSaved }) {
  const [body, setBody] = useState(message.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const max = POST_MAX[message.channel] ?? 3000;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('PATCH', `/admin/marketing/messages/${message.id}`, { body });
      onSaved('Post saved.');
    } catch (err) {
      setError(err.message ?? err.code);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Edit ${message.channel === 'x' ? 'X' : 'LinkedIn'} post`}
      subtitle={message.scheduledAt ? `Slot ${when(message.scheduledAt)}. Editing keeps the slot and the approval state.` : undefined}
      onClose={onClose}
      wide
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={busy || !body.trim() || body.length > max} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Text" hint={`${body.length}/${max} characters. No em dashes, no stock AI phrasing: marketing/style/README.md.`}>
        <textarea rows={message.channel === 'x' ? 5 : 14} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      {error ? <div className="aw-banner aw-banner--bad">{error}</div> : null}
    </Modal>
  );
}

function ComposeModal({ api, contacts, initialChannel = 'x', onClose, onSaved }) {
  const [channel, setChannel] = useState(initialChannel);
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
