/* The marketing desk: who we write to, what is queued, and the switch that sends it. */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAdmin, usePoll } from './store.js';
import { ago, when } from './format.js';
import { Button, Dot, Field, Modal, Segmented, Tag, cx } from './ui.jsx';

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
  no_project: 'No project is set up to run the agent in.',
  no_admin: 'No admin account to file the ticket for.',
};
const cycleMessage = (result) =>
  result?.filed
    ? `Filed #${result.id}: an agent writes the posts and the desk queues them.`
    : (CYCLE_SKIP[result?.reason] ?? `Nothing filed: ${result?.reason ?? 'unknown reason'}`);

const offsetLabel = (minutes) => `UTC${minutes >= 0 ? '+' : '−'}${Math.abs(minutes) / 60}`;
const snippet = (text, max = 90) => (text.length > max ? `${text.slice(0, max)}…` : text);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const dateLabel = (unix) => (unix ? new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** The one-line state beside the Marketing title: running, paused, or blocked. */
function deskState(overview) {
  const { settings, bound, senderState, autoResume } = overview;
  if (!bound) {
    const reason = senderState?.reason;
    const short =
      reason === 'ses_unconfigured' ? 'SES has no keys' : reason === 'sender_unbound' ? 'no sender bound' : (REASONS[reason] ?? reason ?? 'no sender bound');
    return { tone: 'bad', text: `Can't send: ${short}` };
  }
  if (!settings.postalAddress) return { tone: 'bad', text: "Can't send: no postal address in Settings" };
  if (!settings.live) {
    if (autoResume?.autoPausedAt) {
      const back = autoResume.resumesAfter ? `, back on ${dateLabel(autoResume.resumesAfter)}` : '';
      return { tone: 'warn', text: `Paused itself on ${dateLabel(autoResume.autoPausedAt)}${back} if the numbers stay clean` };
    }
    return { tone: 'warn', text: 'Paused by you' };
  }
  return { tone: 'ok', text: 'Running on its own' };
}

/** The next moment the send window opens, on the settings' own clock. */
function nextWindowOpen(settings, nowSec) {
  const offset = settings.offsetMinutes ?? 0;
  const start = settings.startHour ?? 8;
  const local = new Date((nowSec + offset * 60) * 1000);
  for (let add = 0; add < 8; add += 1) {
    const day = new Date(local.getTime() + add * 86400000);
    const dow = day.getUTCDay();
    if (settings.weekdaysOnly && (dow === 0 || dow === 6)) continue;
    const open = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), start) - offset * 60000);
    if (open.getTime() / 1000 > nowSec) return open.getTime() / 1000;
  }
  return null;
}

const obsEtaMinutes = (pending) => (pending * 5) / 12;

function fmtEta(minutes) {
  if (minutes < 90) return `~${Math.max(1, Math.round(minutes))}m`;
  if (minutes < 60 * 36) return `~${Math.round(minutes / 60)}h`;
  return `~${(minutes / 1440).toFixed(1)}d`;
}

const limitPct = (limit) => {
  const v = limit * 100;
  return `${v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : Math.round(v)}%`;
};

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
  const state = deskState(overview);

  return (
    <div className="aw-view">
      <header className="aw-hero aw-hero--mk">
        <h2>Marketing</h2>
        <span className="aw-mk-state">
          <Dot state={state.tone} />
          <span>{state.text}</span>
        </span>
        <span className="aw-toolbar__fill" />
        <Button size="sm" kind="ghost" onClick={() => run(() => api('POST', '/admin/marketing/run'), runMessage)}>
          Run now
        </Button>
        {settings.live ? (
          <Button size="sm" kind="ghost" onClick={() => run(() => api('PUT', '/admin/marketing/settings', { live: false }), 'Paused.')}>
            Pause
          </Button>
        ) : (
          <Button size="sm" onClick={() => run(() => api('PUT', '/admin/marketing/settings', { live: true }), 'Outreach is live.')}>
            Go live
          </Button>
        )}
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
      ) : null}

      {overview.postsAwaiting ? (
        <div className="aw-banner aw-banner--warn">
          {plural(overview.postsAwaiting, 'post waits', 'posts wait')} for your approval. Nothing is posted until you approve it.
          <span className="aw-toolbar__fill" />
          <Button size="sm" onClick={() => setTab('posts')}>
            Review posts
          </Button>
        </div>
      ) : null}

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
              title="The desk re-renders scheduled emails by itself when the templates change; this does it now. Emails you edited by hand are left alone."
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
      </div>

      {tab === 'overview' ? (
        <OverviewTab api={api} tick={tick} health={health} overview={overview} onReview={() => setModal({ kind: 'review' })} onContact={(id) => setModal({ kind: 'person', id })} onTab={setTab} />
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
          <div className="aw-table-wrap">
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
          </div>
          {!contacts.length ? <p className="aw-muted">No contacts match. Import a CSV, or add one by hand.</p> : null}
        </section>
      ) : null}

      {tab === 'email' ? <EmailTab api={api} run={run} tick={tick} events={overview.events} onOpen={(m) => setModal({ kind: 'message', id: m.id })} /> : null}

      {tab === 'posts' ? <PostsTab api={api} run={run} tick={tick} holdHours={settings.postHoldHours ?? 0} onEdit={(m) => setModal({ kind: 'edit', message: m })} /> : null}

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

      {tab === 'settings' ? <SettingsTab overview={overview} run={run} api={api} /> : null}

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

const REPLY_TONE = { reply: 'ok', opt_out: 'warn', complaint: 'bad' };
const REPLY_LABEL = { reply: 'replied', opt_out: 'opted out', complaint: 'spam complaint' };

const OBSERVE_KIND = {
  no_https: 'opens over http',
  no_viewport: 'no mobile tag',
  old_copyright: 'old copyright',
  pdf_menu: 'PDF menu',
  slow: 'slow to load',
  no_description: 'no description',
  none: 'clean',
  unreachable: 'unreachable',
};

const postChannelLabel = { x: 'X', linkedin: 'LinkedIn' };

/** A thin meter for one health rate against its limit; the tick marks the limit. */
function RateMeter({ label, rate, limit }) {
  const pctOf = Math.min((rate ?? 0) / limit, 1);
  const tone = (rate ?? 0) >= limit ? 'bad' : (rate ?? 0) >= limit / 2 ? 'warn' : 'ok';
  return (
    <span className="aw-mk-meter" title={`${label}: ${pct(rate ?? 0)} of the ${limitPct(limit)} limit`}>
      <span className="aw-mk-meter__label">{label}</span>
      <span className="aw-mk-meter__track">
        <i className={cx('aw-mk-meter__fill', `aw-mk-meter__fill--${tone}`)} style={{ width: `${pctOf * 80}%` }} />
        <i className="aw-mk-meter__limit" />
      </span>
      <span className="aw-mk-meter__num">
        {pct(rate ?? 0)} of {limitPct(limit)}
      </span>
    </span>
  );
}

/** One row per loop the desk runs on its own: what it is doing, what it did, what is next, and its health. */
function AutopilotTable({ overview }) {
  const { settings, window: win, health, observe, domains, due, today, pulse = {} } = overview;
  const cap = Math.min(settings.dailyCap, overview.autoResume?.cap ?? settings.dailyCap);
  const ramping = (overview.autoResume?.cap ?? settings.dailyCap) < settings.dailyCap;
  const events = overview.events ?? [];
  const newest = (kind) => events.filter((e) => e.kind === kind).map((e) => e.createdAt).sort((a, b) => b - a)[0] ?? null;
  const lastSentAt = pulse.lastSentAt ?? newest('sent');
  const lastPublishedAt = pulse.lastPublishedAt ?? newest('published');
  const lastPublishedChannel = pulse.lastPublishedChannel ?? null;
  const emailState = !settings.live
    ? 'paused'
    : win?.open
      ? 'sending'
      : `waiting: ${WINDOW_REASON[win?.reason] ?? win?.reason ?? 'outside the window'}`;
  const nextOpen = win && !win.open ? nextWindowOpen(settings, Math.floor(Date.now() / 1000)) : null;
  const emailNext = [
    due?.email ? `${due.email} due` : 'queue clear',
    !win?.open && nextOpen ? `opens ${when(nextOpen)}` : pulse.nextEmailAt ? `next ${when(pulse.nextEmailAt)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const holdHours = settings.postHoldHours ?? 0;
  const postState = holdHours > 0 ? `hold ${holdHours}h` : settings.postApproval ? 'approve by hand' : 'on schedule';
  const postNext = [
    pulse.nextPostAt ? `${when(pulse.nextPostAt)}${pulse.nextPostChannel ? ` · ${postChannelLabel[pulse.nextPostChannel] ?? pulse.nextPostChannel}` : ''}` : '',
    pulse.postsQueued ? `${pulse.postsQueued} queued` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const pending = observe?.pending ?? 0;
  const observed = observe?.observed ?? 0;
  const withGap = observe?.withGap ?? 0;
  const kindEntries = Object.entries(observe?.byKind ?? {}).sort((a, b) => b[1] - a[1]);
  const bounceRate = health?.bounceRate ?? 0;
  const complaintRate = health?.complaintRate ?? 0;
  return (
    <div>
      <div className="aw-table-wrap">
        <table className="aw-table aw-table--compact aw-table--static aw-table--stack">
          <thead>
            <tr>
              <th>Loop</th>
              <th>State</th>
              <th>Last</th>
              <th>Next</th>
              <th>Health</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Email</td>
              <td data-label="State">{emailState}</td>
              <td data-label="Last">
                {lastSentAt ? when(lastSentAt) : 'no sends yet'}
                <span className="aw-muted">
                  {' '}
                  · {today ?? 0}/{cap} today{ramping ? ' · ramping' : ''}
                </span>
              </td>
              <td data-label="Next">{emailNext || '—'}</td>
              <td data-label="Health">
                <div className="aw-mk-health">
                  <RateMeter label="bounces" rate={bounceRate} limit={health?.maxBounceRate ?? 0.04} />
                  <RateMeter label="complaints" rate={complaintRate} limit={health?.maxComplaintRate ?? 0.002} />
                </div>
              </td>
            </tr>
            <tr>
              <td>Posts</td>
              <td data-label="State">{postState}</td>
              <td data-label="Last">
                {lastPublishedAt
                  ? `${when(lastPublishedAt)}${lastPublishedChannel ? ` · ${postChannelLabel[lastPublishedChannel] ?? lastPublishedChannel}` : ''}`
                  : 'none yet'}
              </td>
              <td data-label="Next">{postNext || '—'}</td>
              <td data-label="Health" className={pulse.postsFailed ? 'aw-mk-bad' : undefined}>
                {pulse.postsFailed == null ? '—' : `${pulse.postsFailed} failed`}
              </td>
            </tr>
            <tr>
              <td>Site reading</td>
              <td data-label="State">{pending > 0 ? 'reading' : 'idle'}</td>
              <td data-label="Last">
                {observed} read
                {pulse.lastObservedAt ? <span className="aw-muted"> · last {when(pulse.lastObservedAt)}</span> : null}
              </td>
              <td data-label="Next">{pending > 0 ? `${pending} waiting · ${fmtEta(obsEtaMinutes(pending))}` : 'all read'}</td>
              <td data-label="Health">{observed > 0 ? `${pct(withGap / observed)} found something` : '—'}</td>
            </tr>
            <tr>
              <td>Domain checks</td>
              <td data-label="State">checking</td>
              <td data-label="Last">{domains?.checked ?? 0} domains</td>
              <td data-label="Next">—</td>
              <td data-label="Health" className={domains?.undeliverable ? 'aw-mk-bad' : undefined}>
                {domains?.undeliverable ?? 0} undeliverable
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {kindEntries.length ? (
        <>
          <p className="aw-muted aw-mk-kinds-label">What the reader finds:</p>
          <dl className="aw-mk-kinds">
            {kindEntries.map(([kind, n]) => (
              <div key={kind} className="aw-mk-kind">
                <dt>{OBSERVE_KIND[kind] ?? kind}</dt>
                <dd>{n}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
    </div>
  );
}

/** The handful of things only a person can do, each with the button that does it. */
function NeedsYou({ api, tick, overview, replies, onTab, onReview, onContact }) {
  const { settings, bound, senderState, pulse = {} } = overview;
  const [queue, setQueue] = useState(null);
  useEffect(() => {
    if (!settings.reviewFirst) {
      setQueue(null);
      return undefined;
    }
    let live = true;
    api('GET', '/admin/marketing/review?limit=100')
      .then((r) => live && setQueue(r))
      .catch(() => live && setQueue({ messages: [] }));
    return () => {
      live = false;
    };
  }, [api, settings.reviewFirst, tick]);
  const items = [];
  if (!bound) {
    items.push({
      key: 'sender',
      text:
        senderState?.reason === 'ses_unconfigured'
          ? 'The sender is Amazon SES but the Worker has no SES keys.'
          : 'No outreach sender is bound on the Worker.',
      action: { label: 'Open Settings', run: () => onTab('settings') },
    });
  } else if (!settings.postalAddress) {
    items.push({
      key: 'postal',
      text: 'Cold email cannot go out without a postal address.',
      action: { label: 'Open Settings', run: () => onTab('settings') },
    });
  }
  const cutoff = Math.floor(Date.now() / 1000) - 14 * 86400;
  for (const r of (replies ?? []).filter((x) => x.kind === 'reply' && x.at >= cutoff && x.contact?.id)) {
    items.push({
      key: `reply-${r.id}`,
      text: `${r.contact.business ?? r.contact.email} replied ${ago(r.at)} ago`,
      action: { label: 'Open contact', run: () => onContact(r.contact.id) },
    });
  }
  if (pulse.postsFailed > 0) {
    items.push({
      key: 'posts-failed',
      text: `${pulse.postsFailed} post${pulse.postsFailed === 1 ? '' : 's'} failed to publish.`,
      action: { label: 'Open Posts', run: () => onTab('posts') },
    });
  }
  if (settings.reviewFirst && queue?.messages?.length) {
    const n = queue.messages.length;
    items.push({
      key: 'review',
      text: `${n >= 100 ? '100+' : n} first email${n === 1 ? '' : 's'} wait for review.`,
      action: { label: 'Review next', run: onReview },
    });
  }
  return (
    <section className="aw-panel">
      <h3>Needs you</h3>
      {items.length ? (
        <ul className="aw-needs">
          {items.map((item) => (
            <li key={item.key}>
              <span>{item.text}</span>
              <Button size="sm" onClick={item.action.run}>
                {item.action.label}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="aw-muted">Nothing needs you. The desk is running on its own.</p>
      )}
    </section>
  );
}

const shortDay = (unix, offsetMinutes = 0) => {
  const d = new Date((unix + offsetMinutes * 60) * 1000);
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
};

/** The last days as bars: sent, bounces on top, replies as a mark, posts under the axis. */
function StatsChart({ stats }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  const days = useMemo(() => (stats?.days ? [...stats.days].reverse() : []), [stats]);
  // The box only exists once rows arrive, so measure again when they do.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [days.length]);
  if (!days.length) return <p className="aw-muted">Loading…</p>;
  const sum = (key) => days.reduce((n, d) => n + (d[key] ?? 0), 0);
  const sent = sum('sent');
  const replies = sum('reply');
  const bounces = sum('bounce');
  const optOuts = sum('opt_out');
  const published = sum('published');
  const offset = stats.offsetMinutes ?? 0;
  const H = 180;
  const padL = 40;
  const padR = 10;
  const padT = 12;
  const padB = 26;
  // Until the wrapper is measured the chart lays out on a 720px viewBox so it
  // never renders tiny; after that it is drawn at the real pixel width.
  const measured = width > 0;
  const w = measured ? Math.max(width, 200) : 720;
  const plotW = w - padL - padR;
  const plotH = H - padT - padB;
  const baseY = padT + plotH;
  const maxSent = Math.max(...days.map((d) => d.sent), 1);
  const step = maxSent > 50 ? 10 : maxSent > 10 ? 5 : 1;
  const yMax = Math.max(step, Math.ceil(maxSent / step) * step);
  const slot = plotW / days.length;
  const barW = Math.min(18, Math.max(3, slot * 0.6));
  const labelEvery = Math.max(1, Math.ceil(56 / slot));
  const y = (v) => baseY - (v / yMax) * plotH;
  const aria = `${days.length} days: ${sent} sent, ${replies} replies, ${bounces} bounces, ${optOuts} opt-outs, ${published} posts published.`;
  return (
    <figure className="aw-chart">
      <figcaption className="aw-chart__totals">
        {sent} sent · {replies} replies · {bounces} bounces · {optOuts} opt-outs · {published} posts
      </figcaption>
      <div ref={ref} className="aw-chart__box">
        <svg
          className="aw-chart__svg"
          width={measured ? w : '100%'}
          height={H}
          viewBox={measured ? undefined : `0 0 ${w} ${H}`}
          preserveAspectRatio={measured ? undefined : 'xMidYMid meet'}
          role="img"
          aria-label={aria}
        >
          {[0, 0.5, 1].map((f) => {
            const v = yMax * f;
            return (
              <g key={f}>
                <line className="aw-chart__grid" x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} />
                <text className="aw-chart__tick" x={padL - 6} y={y(v) + 3} textAnchor="end">
                  {Math.round(v)}
                </text>
              </g>
            );
          })}
          {days.map((d, i) => {
            const cx = padL + i * slot + slot / 2;
            const sentH = (d.sent / yMax) * plotH;
            const bounceH = Math.min(((d.bounce ?? 0) / yMax) * plotH, sentH);
            return (
              <g key={d.day}>
                <title>{`${shortDay(d.day, offset)}: ${d.sent} sent, ${d.reply} replies, ${d.bounce} bounces, ${d.opt_out} opt-outs, ${d.published ?? 0} posts`}</title>
                {d.sent ? <rect className="aw-chart__bar" x={cx - barW / 2} y={y(d.sent)} width={barW} height={sentH} rx={1.5} /> : null}
                {d.bounce && d.sent ? <rect className="aw-chart__bounce" x={cx - barW / 2} y={y(d.sent)} width={barW} height={bounceH} rx={1.5} /> : null}
                {d.reply ? <circle className="aw-chart__reply" cx={cx} cy={padT + 4} r={3} /> : null}
                {i % labelEvery === 0 ? (
                  <text className="aw-chart__day" x={cx} y={H - 8} textAnchor="middle">
                    {shortDay(d.day, offset)}
                  </text>
                ) : null}
                {d.published
                  ? Array.from({ length: Math.min(d.published, 3) }).map((_, j) => (
                      <rect key={j} className="aw-chart__post" x={cx - 5 + j * 4} y={baseY + 7} width={3} height={3} rx={1} />
                    ))
                  : null}
              </g>
            );
          })}
          <line className="aw-chart__axis" x1={padL} x2={w - padR} y1={baseY} y2={baseY} />
        </svg>
      </div>
      <table className="aw-sr-only">
        <caption>Daily marketing numbers</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Sent</th>
            <th>Replies</th>
            <th>Bounces</th>
            <th>Opt-outs</th>
            <th>Posts</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <td>{shortDay(d.day, offset)}</td>
              <td>{d.sent}</td>
              <td>{d.reply}</td>
              <td>{d.bounce}</td>
              <td>{d.opt_out}</td>
              <td>{d.published ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** The cold A/B test: the control against the observation opener, honestly labelled. */
function ExperimentPanel({ overview, onTab }) {
  const rows = (overview.sequences ?? []).filter((s) => s.key === 'cold_a' || s.key === 'cold_obs');
  if (rows.length < 2) return null;
  const control = rows.find((s) => s.key === 'cold_a');
  const challenger = rows.find((s) => s.key === 'cold_obs');
  if (!control || !challenger) return null;
  const rate = (s) => (s.stats.sent ? s.stats.replies / s.stats.sent : 0);
  const enough = control.stats.sent >= 100 && challenger.stats.sent >= 100;
  let verdict;
  if (!enough) {
    verdict = `Too early to call: ${control.stats.sent} and ${challenger.stats.sent} sends so far.`;
  } else {
    const diff = rate(challenger) - rate(control);
    verdict =
      Math.abs(diff) < 0.0005
        ? 'Same reply rate so far.'
        : `${diff > 0 ? challenger.key : control.key} leads: ${pct(Math.max(rate(challenger), rate(control)))} vs ${pct(Math.min(rate(challenger), rate(control)))} reply rate, ${(Math.abs(diff) * 100).toFixed(1)} pts apart.`;
  }
  return (
    <section className="aw-panel">
      <h3>Experiment</h3>
      <div className="aw-table-wrap">
        <table className="aw-table aw-table--compact aw-table--static aw-table--stack">
          <thead>
            <tr>
              <th>Sequence</th>
              <th>Sent</th>
              <th>Replies</th>
              <th>Reply rate</th>
              <th>Opt-outs</th>
              <th>Bounces</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.key}>
                <td>
                  {s.label}{' '}
                  {s.key === 'cold_a' ? <Tag>control</Tag> : null}
                  {s.key === 'cold_obs' ? <Tag>challenger</Tag> : null}
                </td>
                <td data-label="Sent">{s.stats.sent}</td>
                <td data-label="Replies">{s.stats.replies}</td>
                <td data-label="Reply rate">{pct(rate(s))}</td>
                <td data-label="Opt-outs">{s.stats.optedOut}</td>
                <td data-label="Bounces">{s.stats.bounced}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="aw-muted">{verdict}</p>
      <p className="aw-muted">
        {overview.settings.obsShare}% of observed contacts get the observation opener.{' '}
        <Button size="sm" kind="ghost" onClick={() => onTab('settings')}>
          Settings
        </Button>
      </p>
    </section>
  );
}

function OverviewTab({ api, tick, health, overview, onReview, onContact, onTab }) {
  const [stats, setStats] = useState(null);
  const [replies, setReplies] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.all([api('GET', '/admin/marketing/stats?days=14'), api('GET', '/admin/marketing/replies')])
      .then(([s, r]) => {
        if (!live) return;
        setStats(s);
        setReplies(r.replies ?? []);
      })
      .catch(() => live && setReplies([]));
    return () => {
      live = false;
    };
  }, [api, tick]);

  const ordered = [...(replies ?? [])].sort((a, b) => Number(b.kind === 'reply') - Number(a.kind === 'reply') || b.at - a.at);
  return (
    <>
      <section className="aw-panel">
        <h3>Autopilot</h3>
        <AutopilotTable overview={overview} />
      </section>

      <NeedsYou api={api} tick={tick} overview={overview} replies={replies} onTab={onTab} onReview={onReview} onContact={onContact} />

      <ExperimentPanel overview={overview} onTab={onTab} />

      <section className="aw-panel">
        <h3>Last 14 days</h3>
        <StatsChart stats={stats} />
      </section>

      <section className="aw-panel">
        <h3>What came back</h3>
        <p className="aw-muted">Replies are also forwarded to your inbox; answer them from there. Opt-outs and complaints are closed already.</p>
        {ordered.length ? (
          <ul className="aw-rows">
            {ordered.map((r) => (
              <li key={r.id} className="aw-row" style={{ alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => onContact(r.contact.id)}>
                <Tag tone={REPLY_TONE[r.kind]}>{REPLY_LABEL[r.kind] ?? r.kind}</Tag>
                <span className="aw-row__title">
                  {r.contact.business ?? r.contact.email}
                  <div className="aw-muted" style={{ whiteSpace: 'pre-wrap', fontWeight: 'normal' }}>
                    {snippet(r.text ?? '', 220)}
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
  const [showDmarc, setShowDmarc] = useState(false);
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
          <div className="aw-inline">
            <h3>Events</h3>
            <Button size="sm" kind="ghost" onClick={() => setShowDmarc((v) => !v)}>
              {showDmarc ? 'Hide DMARC reports' : 'Show DMARC reports'}
            </Button>
          </div>
          <ul className="aw-rows">
            {data.events.filter((e) => showDmarc || e.kind !== 'dmarc_report').map((e) => (
              <li key={e.id} className="aw-row">
                <Tag tone={EVENT_BAD.has(e.kind) ? 'bad' : EVENT_GOOD.has(e.kind) ? 'ok' : 'dash'}>{EVENT_LABEL[e.kind] ?? e.kind.replaceAll('_', ' ')}</Tag>
                <span className="aw-muted" style={{ whiteSpace: 'pre-wrap' }}>
                  {snippet(e.detail ?? '', 300)}
                </span>
                <span className="aw-muted">{ago(e.createdAt)} ago</span>
              </li>
            ))}
          </ul>
          {!data.events.filter((e) => showDmarc || e.kind !== 'dmarc_report').length ? <p className="aw-muted">No events.</p> : null}
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
  const [showDmarc, setShowDmarc] = useState(false);
  const visibleEvents = events.filter((e) => showDmarc || e.kind !== 'dmarc_report');

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
        <div className="aw-table-wrap">
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
        </div>
      ) : messages ? (
        <p className="aw-muted">No email matches.</p>
      ) : null}
      {messages?.length === 200 ? <p className="aw-muted">The first 200 are shown.</p> : null}

      <div className="aw-group">
        <div className="aw-inline">
          <h3>Recent events</h3>
          <Button size="sm" kind="ghost" onClick={() => setShowDmarc((v) => !v)}>
            {showDmarc ? 'Hide DMARC reports' : 'Show DMARC reports'}
          </Button>
        </div>
        <ul className="aw-rows">
          {visibleEvents.map((e) => (
            <li key={e.id} className="aw-row">
              <Tag tone={EVENT_BAD.has(e.kind) ? 'bad' : EVENT_GOOD.has(e.kind) ? 'ok' : 'dash'}>{EVENT_LABEL[e.kind] ?? e.kind.replaceAll('_', ' ')}</Tag>
              <span className="aw-row__title">{e.email ?? '—'}</span>
              <span className="aw-muted">{snippet(e.detail ?? '', 100)}</span>
              <span className="aw-muted">{ago(e.createdAt)} ago</span>
            </li>
          ))}
        </ul>
        {!visibleEvents.length ? <p className="aw-muted">Nothing has happened yet.</p> : null}
      </div>
    </section>
  );
}

const EVENT_BAD = new Set(['failed', 'bounce', 'opt_out', 'complaint', 'cycle_failed', 'auto_paused', 'blocked', 'undeliverable']);
const EVENT_GOOD = new Set(['reply', 'sent', 'published', 'cycle', 'approved', 'auto_resumed', 'auto_approved']);
const EVENT_LABEL = { dmarc_report: 'DMARC report', auto_resumed: 'auto-resumed', auto_approved: 'auto-approved', auto_paused: 'auto-paused' };

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

function PostsTab({ api, run, tick, holdHours = 0, onEdit }) {
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
              <PostCard key={m.id} post={m} api={api} run={run} holdHours={holdHours} onEdit={onEdit} />
            ))}
          </section>
        ) : null,
      )}
      {!posts.length ? <p className="aw-muted">No posts yet. Draft posts files a content cycle; Compose writes one by hand.</p> : null}
    </>
  );
}

function PostCard({ post: m, api, run, holdHours = 0, onEdit }) {
  const open = ['draft', 'scheduled', 'failed'].includes(m.status);
  const max = POST_MAX[m.channel] ?? 3000;
  // A held draft goes out on its own: the later of its hold expiring and its slot.
  const releaseAt = m.status === 'draft' && holdHours > 0 ? Math.max((m.createdAt ?? 0) + holdHours * 3600, m.scheduledAt ?? 0) : null;
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
      {releaseAt ? <div className="aw-muted">Goes out automatically {when(releaseAt)} unless you cancel it first.</div> : null}
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

  const replyRate = (s) => (s.sent ? pct(s.replies / s.sent) : '—');

  return (
    <section className="aw-panel">
      <h3>How each sequence is doing</h3>
      <p className="aw-muted">Sent, replies and outcomes per sequence, counted on the contact's latest send.</p>
      <table className="aw-table">
        <thead>
          <tr>
            <th>Sequence</th>
            <th>Sent</th>
            <th>Replies</th>
            <th>Reply rate</th>
            <th>Opt-outs</th>
            <th>Bounces</th>
          </tr>
        </thead>
        <tbody>
          {sequences.map((s) => (
            <tr key={s.key}>
              <td className="aw-table__title">
                {s.label}{' '}
                {s.key === 'cold_a' ? <Tag>control</Tag> : null}
                {s.key === 'cold_obs' ? <Tag>challenger</Tag> : null}
                {s.needsGap ? <div className="aw-muted">needs a site observation</div> : null}
              </td>
              <td>{s.stats.sent || '·'}</td>
              <td>{s.stats.replies || '·'}</td>
              <td>{replyRate(s.stats)}</td>
              <td className={s.stats.optedOut ? 'aw-warn' : undefined}>{s.stats.optedOut || '·'}</td>
              <td className={s.stats.bounced ? 'aw-warn' : undefined}>{s.stats.bounced || '·'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="aw-inline" style={{ marginTop: 14 }}>
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
        The wording lives in <span className="aw-mono">SEQUENCES</span> in <span className="aw-mono">worker/src/marketing.ts</span>; the desk
        re-renders the queue by itself when it changes. To change it for one person, open their email in the Email tab and rewrite it there.
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
      <div className="aw-table-wrap">
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
      </div>
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

function SettingsTab({ overview, run, api }) {
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
        <p className="aw-muted">Who the mail comes from and whether it goes out.</p>
        <div className="aw-form2">
          <Field label="Outreach" hint="The master switch.">
            <Segmented
              value={Boolean(draft.live)}
              options={[
                { value: true, label: 'Live' },
                { value: false, label: 'Paused' },
              ]}
              onChange={(v) => set('live', v)}
            />
          </Field>
          <Field
            label="Sender"
            hint={
              draft.provider === 'ses'
                ? overview.providers.ses
                  ? 'Amazon SES: bounces and complaints file back to hello@.'
                  : 'Needs AWS_SES_ACCESS_KEY_ID and AWS_SES_SECRET_ACCESS_KEY as Worker secrets.'
                : 'The MARKETING binding on the Worker.'
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
          <Field label="From name" hint="On the From line of every email.">
            <input value={draft.fromName} onChange={(e) => set('fromName', e.target.value)} />
          </Field>
          <Field label="Postal address" hint="Required on every cold email.">
            <input value={draft.postalAddress} placeholder="Street, city, country" onChange={(e) => set('postalAddress', e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="aw-panel">
        <h3>Schedule and volume</h3>
        <p className="aw-muted">When mail may leave, and how much of it.</p>
        <div className="aw-form2">
          <Field label="Send window" hint="Local time on the offset clock; an end of 24 means midnight.">
            <span className="aw-inline aw-mk-window">
              From{' '}
              <input
                inputMode="numeric"
                aria-label="Window start hour"
                value={draft.startHour}
                onChange={(e) => set('startHour', Number(e.target.value))}
              />{' '}
              to{' '}
              <input
                inputMode="numeric"
                aria-label="Window end hour"
                value={draft.endHour}
                onChange={(e) => set('endHour', Number(e.target.value))}
              />{' '}
              · offset{' '}
              <input
                inputMode="numeric"
                aria-label="Window offset minutes"
                value={draft.offsetMinutes}
                onChange={(e) => set('offsetMinutes', Number(e.target.value))}
              />{' '}
              min ({offsetLabel(draft.offsetMinutes)})
            </span>
          </Field>
          <Field label="Weekdays only" hint="Skip Saturday and Sunday.">
            <Segmented
              value={Boolean(draft.weekdaysOnly)}
              options={[
                { value: true, label: 'Weekdays' },
                { value: false, label: 'Every day' },
              ]}
              onChange={(v) => set('weekdaysOnly', v)}
            />
          </Field>
          <Field label="Daily cap" hint="Emails a day across every sequence.">
            <input
              inputMode="numeric"
              value={draft.dailyCap}
              title={`At ${draft.perRun} per run the window allows about ${windowRoom(draft)} a day.`}
              onChange={(e) => set('dailyCap', Number(e.target.value))}
            />
          </Field>
          <Field label="Per run" hint="The cron runs every five minutes; up to 200.">
            <input inputMode="numeric" value={draft.perRun} onChange={(e) => set('perRun', Number(e.target.value))} />
          </Field>
        </div>
      </section>

      <section className="aw-panel">
        <h3>Safety</h3>
        <p className="aw-muted">The checks that keep the list healthy.</p>
        <div className="aw-form2">
          <Field
            label="Auto-resume"
            hint="A pause the desk caused itself lifts after 7 quiet days, ramping from 20 a day. A pause you set by hand is never undone."
          >
            <Segmented
              value={Boolean(draft.autoResume)}
              options={[
                { value: true, label: 'On' },
                { value: false, label: 'Off' },
              ]}
              onChange={(v) => set('autoResume', v)}
            />
          </Field>
          <Field label="Review first emails" hint="First emails send only after you read them in Review next.">
            <Segmented
              value={Boolean(draft.reviewFirst)}
              options={[
                { value: true, label: 'Only reviewed' },
                { value: false, label: 'Send all' },
              ]}
              onChange={(v) => set('reviewFirst', v)}
            />
          </Field>
        </div>
        <p className="aw-muted">
          Last 14 days: {overview.health.sent} sent, {overview.health.bounces} bounced ({pct(overview.health.bounceRate)}), {overview.health.complaints}{' '}
          complaints ({pct(overview.health.complaintRate)}). The desk pauses itself and emails you above {pct(overview.health.maxBounceRate)} bounces or{' '}
          {pct(overview.health.maxComplaintRate)} complaints, before SES would review the account (5% and 0.1%). Every email carries a one-click
          unsubscribe header.
        </p>
      </section>

      <section className="aw-panel">
        <h3>Experiment</h3>
        <p className="aw-muted">The cold A/B test.</p>
        <Field
          label="Observation sequence share (%)"
          hint="Of contacts with a site observation, this percent get the observation opener. 0 keeps the experiment off, 100 makes it the only cold opener."
        >
          <input inputMode="numeric" min="0" max="100" value={draft.obsShare ?? 50} onChange={(e) => set('obsShare', Number(e.target.value))} />
        </Field>
      </section>

      <section className="aw-panel">
        <h3>Email look</h3>
        <p className="aw-muted">What the HTML version carries.</p>
        <Field label="Workshop GIF" hint="Off sends plain text only; First emails and Every email add the workshop images.">
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
      </section>

      <section className="aw-panel">
        <h3>Posts</h3>
        <p className="aw-muted">How written posts reach X and LinkedIn.</p>
        <Field label="Approval" hint="Drafted posts wait for approval or the hold; every post that goes out is also emailed to you.">
          <Segmented
            value={Boolean(draft.postApproval)}
            options={[
              { value: true, label: 'Approve each post' },
              { value: false, label: 'Post on schedule' },
            ]}
            onChange={(v) => set('postApproval', v)}
          />
        </Field>
        <Field label="Post hold (hours)" hint="How long a drafted post waits before it goes out on its own. 0 means approve by hand. Up to 168.">
          <input inputMode="numeric" min="0" max="168" value={draft.postHoldHours ?? 24} onChange={(e) => set('postHoldHours', Number(e.target.value))} />
        </Field>
        <Field label="Voice notes" hint="Added to every content brief after the launch kit.">
          <textarea
            rows={3}
            value={draft.voiceNotes ?? ''}
            placeholder="Shorter sentences. No exclamation marks. Talk about the client's week, not the machine."
            onChange={(e) => set('voiceNotes', e.target.value)}
          />
        </Field>
        {actions}
      </section>

      <div className="aw-divider" />
      <ModelHealth api={api} />
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
        <p className="aw-muted">
          Contacts on file:{' '}
          {Object.values(overview.counts?.contacts ?? {})
            .reduce((a, b) => a + (b ?? 0), 0)
            .toLocaleString('en-US')}
          . Sender: {overview.sender}. Inbox: {overview.inbox}.
        </p>
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
