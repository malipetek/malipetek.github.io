/* The marketing desk: who we write to, what is queued, and the switch that sends it. */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAdmin, usePoll } from './store.js';
import { ago, errorText, when } from './format.js';
import { Badge, Button, Chips, Empty, ErrorNote, Field, Loading, Modal, PageHeader, PageTabs, Panel, Segmented, StatRow, cx } from './ui.jsx';

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

const percentNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const pct = (rate) => `${percentNumber.format(rate * 100)}%`;

// Key results to the request inputs so a late response cannot replace a newer filter.
function useResource(load, deps, { keepOnError = false } = {}) {
  const request = useCallback(load, deps);
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState(null);
  const reload = useCallback(() => setVersion((n) => n + 1), []);
  useEffect(() => {
    let current = true;
    Promise.resolve().then(request).then(
      (data) => { if (current) setResult({ request, version, data, error: null }); },
      (error) => { if (current) setResult((prior) => ({ request, version, data: keepOnError && prior?.request === request ? prior.data : null, error })); },
    );
    return () => { current = false; };
  }, [request, version, keepOnError]);
  const latest = result?.request === request ? result : null;
  return {
    data: latest?.data ?? null,
    error: latest?.version === version ? latest.error : null,
    loading: latest?.version !== version,
    reload,
  };
}

function MarketingSkeleton({ label = 'Loading…', rows = 3, variant = 'rows' }) {
  return (
    <div className={cx('aw-mk-skel', `aw-mk-skel--${variant}`)} role="status" aria-label={label}>
      <span className="aw-sr-only">{label}</span>
      {variant === 'chart' ? (
        <span className="aw-mk-skel__chart" aria-hidden="true" />
      ) : (
        Array.from({ length: rows }).map((_, i) => <span key={i} className="aw-mk-skel__row" aria-hidden="true" />)
      )}
    </div>
  );
}

function ResourceNote({ resource, label, empty, hint, action, variant = 'rows', rows = 3 }) {
  if (resource.error) return <ErrorNote error={resource.error} onRetry={resource.reload} />;
  if (resource.loading) return <MarketingSkeleton label={label} variant={variant} rows={rows} />;
  return empty ? <Empty title={empty} hint={hint} action={action} /> : null;
}

export function MarketingView() {
  const { api, act, ask, notify } = useAdmin();
  const sendingControl = useRef(null);
  const [sendingBusy, setSendingBusy] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState(null);
  const [filters, setFilters] = useState({ status: '', q: '', source: '', offset: 0 });
  const filter = (patch) => {
    setSelected(new Set());
    setFilters((f) => ({ ...f, offset: 0, ...patch }));
  };
  // Bumped after any action, so the tab that owns its own list reloads too.
  const [tick, setTick] = useState(0);

  const desk = useResource(() => api('GET', '/admin/marketing'), [api], { keepOnError: true });
  const people = useResource(() => {
    const search = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
    return api('GET', `/admin/marketing/contacts${search ? `?${search}` : ''}`);
  }, [api, filters]);
  const overview = desk.data;
  const contacts = people.data?.contacts ?? [];
  const paging = { total: people.data?.total ?? contacts.length, page: people.data?.page ?? 200 };
  const { reload: reloadDesk } = desk;
  const { reload: reloadPeople } = people;
  const load = useCallback(() => { reloadDesk(); reloadPeople(); }, [reloadDesk, reloadPeople]);
  usePoll(load, 30_000, [load]);

  const refresh = useCallback(() => {
    setTick((n) => n + 1);
    load();
  }, [load]);
  const mutate = useCallback(async (fn, message) => {
    const result = await act(fn, message);
    refresh();
    return result;
  }, [act, refresh]);
  const run = useCallback((fn, message) => mutate(fn, message).catch(() => undefined), [mutate]);

  const done = useCallback(
    (message) => {
      setModal(null);
      notify(message);
      void refresh();
    },
    [refresh, notify],
  );

  if (!overview) return <ResourceNote resource={desk} label="Loading Marketing…" />;

  const { settings, health } = overview;
  const state = deskState(overview);
  const changeSending = async (live) => {
    setSendingBusy(true);
    try {
      await mutate(async () => {
        const out = await api('PUT', '/admin/marketing/settings', { live });
        if (out.rejected?.includes('live')) throw new Error('The server rejected the sending change.');
        return out;
      }, live ? 'Outreach is live.' : 'Paused.');
    } finally {
      setSendingBusy(false);
    }
  };
  const startSending = () => {
    const cap = settings.dailyCap;
    const currentCap = overview.autoResume?.cap ?? cap;
    const ramp = overview.autoResume?.resumedAt ? `The active ramp currently limits sending to ${currentCap}/day.` : 'No send ramp is active.';
    ask({
      title: 'Start sending cold email?',
      text: `The five-minute cron can start sending eligible emails on its next run. Saved daily cap: ${cap}/day. ${ramp}`,
      confirm: 'Go live',
      danger: true,
      run: () => changeSending(true),
    });
  };
  const bulk = (action) => {
    void mutate(() => api('POST', '/admin/marketing/contacts/bulk', { action, ids: [...selected] }),
      (out) => `${out.changed} ${action === 'pause' ? 'paused' : 'opted out'}; their queued mail was cancelled.`)
      .then(() => setSelected(new Set()), () => undefined);
  };

  const sendDisabledReason = sendingBusy
    ? 'Updating sending state…'
    : desk.loading
      ? 'Refreshing marketing status…'
      : desk.error
        ? 'Refresh the desk before changing sending state.'
        : undefined;

  return (
    <div className="aw-view aw-mk">
      <div ref={sendingControl} tabIndex={-1} className="aw-mk-anchor">
        <PageHeader
          title="Marketing"
          subtitle="Manage email outreach, contact lists, and social publishing."
          meta={<Badge tone={state.tone}>{state.text}</Badge>}
          actions={
            <>
              <Button kind="ghost" onClick={() => run(() => api('POST', '/admin/marketing/run'), runMessage)}>Run now</Button>
              <Button
                kind={settings.live ? undefined : 'primary'}
                disabled={sendingBusy || desk.loading || Boolean(desk.error)}
                title={sendDisabledReason}
                onClick={settings.live ? () => void changeSending(false).catch(() => undefined) : startSending}
              >
                {settings.live ? 'Pause sending' : 'Go live'}
              </Button>
            </>
          }
        />
      </div>
      {desk.error ? <ResourceNote resource={desk} /> : null}

      <PageTabs
        ariaLabel="Marketing tabs"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'contacts', label: 'Contacts' },
          { value: 'email', label: 'Email' },
          { value: 'posts', label: 'Posts' },
          { value: 'sequences', label: 'Sequences' },
          { value: 'sources', label: 'Sources' },
          { value: 'settings', label: 'Settings' },
        ]}
      />

      {tab === 'contacts' ? (
        <div className="aw-toolbar">
          <span className="aw-toolbar__fill" />
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
        </div>
      ) : null}

      {tab === 'email' ? (
        <div className="aw-toolbar">
          <span className="aw-toolbar__fill" />
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
        </div>
      ) : null}

      {tab === 'posts' ? (
        <div className="aw-toolbar">
          <span className="aw-toolbar__fill" />
          <Button onClick={() => setModal({ kind: 'compose', channel: 'x' })}>Compose</Button>
          <Button kind="primary" onClick={() => run(() => api('POST', '/admin/marketing/cycle?force=1'), cycleMessage)}>
            Draft posts
          </Button>
        </div>
      ) : null}

      {tab === 'overview' ? (
        <OverviewTab api={api} tick={tick} health={health} overview={overview} onReview={() => setModal({ kind: 'review' })} onContact={(id) => setModal({ kind: 'person', id })} onTab={setTab} />
      ) : null}

      {tab === 'contacts' ? (
        <section className="aw-panel">
          <div className="aw-inline aw-mk-controls">
            <span className="aw-muted">
              {paging.total
                ? `${(filters.offset + 1).toLocaleString('en-US')}–${Math.min(filters.offset + paging.page, paging.total).toLocaleString('en-US')} of ${paging.total.toLocaleString('en-US')}`
                : 'None'}
            </span>
            <Button size="sm" disabled={!filters.offset} onClick={() => filter({ offset: Math.max(0, filters.offset - paging.page) })}>
              Previous
            </Button>
            <Button size="sm" disabled={filters.offset + paging.page >= paging.total} onClick={() => filter({ offset: filters.offset + paging.page })}>
              Next
            </Button>
            <span className="aw-toolbar__fill" />
            {selected.size ? (
              <>
                <span>{plural(selected.size, 'contact selected', 'contacts selected')}</span>
                <Button size="sm" onClick={() => bulk('pause')}>Pause</Button>
                <Button size="sm" onClick={() => bulk('opt_out')}>Opt out</Button>
                <Button size="sm" kind="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </>
            ) : null}
          </div>
          {contacts.length ? <div className="aw-table-wrap">
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
                  <td className="aw-table__title">
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
                    <Badge tone={CONTACT_TONE[c.status]}>{c.status}</Badge>
                  </td>
                  <td>{c.sentCount}</td>
                  <td className="aw-muted">{c.nextAt ? when(c.nextAt) : '—'}</td>
                  <td>
                    <Button size="sm" onClick={() => setModal({ kind: 'person', id: c.id })} aria-label={`Open ${c.email}`}>Open</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div> : <ResourceNote resource={people} label="Loading contacts…" empty="No contacts match. Import a CSV or add one by hand." />}
        </section>
      ) : null}

      {tab === 'email' ? <EmailTab api={api} run={run} tick={tick} events={overview.events} onOpen={(m) => setModal({ kind: 'message', id: m.id })} /> : null}

      {tab === 'posts' ? <PostsTab api={api} run={run} mutate={mutate} ask={ask} tick={tick} holdHours={settings.postHoldHours ?? 0} onEdit={(m) => setModal({ kind: 'edit', message: m })} /> : null}

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

      {tab === 'settings' ? <SettingsTab overview={overview} mutate={mutate} api={api} onShowSending={() => sendingControl.current?.focus()} /> : null}

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
          onQueue={(contact) => setModal({ kind: 'queue', contact })}
          onOptOut={(contact) => mutate(() => api('PATCH', `/admin/marketing/contacts/${contact.id}`, { status: 'opted_out' }), `${contact.email} opted out; queued mail cancelled.`)}
          onEdit={(contact) => setModal({ kind: 'contact', contact })}
          onOpenMessage={(id) => setModal({ kind: 'message', id })}
        />
      ) : null}
    </div>
  );
}


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
    <span className="aw-mk-meter" title={`${label}: ${pct(rate ?? 0)} of the ${pct(limit)} limit`}>
      <span className="aw-mk-meter__label">{label}</span>
      <span className="aw-mk-meter__track">
        <i className={cx('aw-mk-meter__fill', `aw-mk-meter__fill--${tone}`)} style={{ width: `${pctOf * 80}%` }} />
        <i className="aw-mk-meter__limit" />
      </span>
      <span className="aw-mk-meter__num">
        {pct(rate ?? 0)} of {pct(limit)}
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
                <span>
                  {lastSentAt ? when(lastSentAt) : 'no sends yet'}
                  <span className="aw-muted">
                    {' '}
                    · {today ?? 0}/{cap} today{ramping ? ' · ramping' : ''}
                  </span>
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
                <span>
                  {observed} read
                  {pulse.lastObservedAt ? <span className="aw-muted"> · last {when(pulse.lastObservedAt)}</span> : null}
                </span>
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
        <div className="aw-mk-findings">
          <span className="aw-muted aw-mk-kinds-label">Reader findings:</span>
          <dl className="aw-mk-kinds">
            {kindEntries.map(([kind, value]) => (
              <div className="aw-mk-kind" key={kind}>
                <dd>{value}</dd>
                <dt>{OBSERVE_KIND[kind] ?? kind}</dt>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

/** The handful of things only a person can do, each with the button that does it. */
function NeedsYou({ api, tick, overview, replies, onTab, onReview, onContact }) {
  const { settings, bound, senderState, postsAwaiting, pulse = {} } = overview;
  const review = useResource(
    () => settings.reviewFirst ? api('GET', '/admin/marketing/review?limit=100') : null,
    [api, settings.reviewFirst, tick],
  );
  const queue = review.data;
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
  if (postsAwaiting > 0) {
    items.push({
      key: 'posts-awaiting',
      text: `${plural(postsAwaiting, 'post awaits', 'posts await')} approval.`,
      action: { label: 'Review posts', run: () => onTab('posts') },
    });
  }
  if (pulse.postsFailed > 0) {
    items.push({
      key: 'posts-failed',
      text: `${plural(pulse.postsFailed, 'post', 'posts')} failed to publish.`,
      action: { label: 'Open Posts', run: () => onTab('posts') },
    });
  }
  if (settings.reviewFirst && queue?.messages?.length) {
    const n = queue.messages.length;
    items.push({
      key: 'review',
      text: `${plural(n >= 100 ? '100+' : n, 'first email waits', 'first emails wait')} for review.`,
      action: { label: 'Review next', run: onReview },
    });
  }
  return (
    <Panel title="Needs you">
      {settings.reviewFirst && !queue ? <ResourceNote resource={review} label="Loading review queue…" /> : null}
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
      ) : (!settings.reviewFirst || queue) && replies ? <Empty title="All caught up" /> : null}
    </Panel>
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
  if (!days.length) return <Empty title="No outreach activity yet" />;
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
      <figcaption className="aw-chart__head">
        <span className="aw-chart__totals">
          {sent} sent · {replies} replies · {bounces} bounces · {optOuts} opt-outs · {published} posts
        </span>
        <span className="aw-chart__legend" aria-hidden="true">
          <span><i className="aw-chart__key aw-chart__key--sent" />Sent</span>
          <span><i className="aw-chart__key aw-chart__key--bounce" />Bounce</span>
          <span><i className="aw-chart__key aw-chart__key--reply" />Reply</span>
          <span><i className="aw-chart__key aw-chart__key--post" />Post</span>
        </span>
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
        : `${diff > 0 ? challenger.key : control.key} leads: ${pct(Math.max(rate(challenger), rate(control)))} vs ${pct(Math.min(rate(challenger), rate(control)))} reply rate, ${percentNumber.format(Math.abs(diff) * 100)} pts apart.`;
  }
  return (
    <section className="aw-panel aw-mk-section">
      <header className="aw-panel__head">
        <div className="aw-panel__titles"><h3>Experiment</h3></div>
      </header>
      <div className="aw-table-wrap">
        <table className="aw-table aw-table--compact aw-table--static aw-table--stack aw-mk-exp-table">
          <thead>
            <tr>
              <th>Sequence</th>
              <th className="aw-mk-num">Sent</th>
              <th className="aw-mk-num">Replies</th>
              <th className="aw-mk-num">Reply rate</th>
              <th className="aw-mk-num">Opt-outs</th>
              <th className="aw-mk-num">Bounces</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.key}>
                <td>
                  {s.label}{' '}
                  {s.key === 'cold_a' ? <Badge>control</Badge> : null}
                  {s.key === 'cold_obs' ? <Badge>challenger</Badge> : null}
                </td>
                <td className="aw-mk-num" data-label="Sent">{s.stats.sent}</td>
                <td className="aw-mk-num" data-label="Replies">{s.stats.replies}</td>
                <td className="aw-mk-num" data-label="Reply rate">{pct(rate(s))}</td>
                <td className="aw-mk-num" data-label="Opt-outs">{s.stats.optedOut}</td>
                <td className="aw-mk-num" data-label="Bounces">{s.stats.bounced}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="aw-mk-exp-foot">
        <p className="aw-muted">{verdict}</p>
        <p className="aw-muted">
          {overview.settings.obsShare}% of observed contacts get the observation opener.{' '}
          <Button size="sm" kind="ghost" onClick={() => onTab('settings')}>
            Settings
          </Button>
        </p>
      </div>
    </section>
  );
}

function OverviewTab({ api, tick, health, overview, onReview, onContact, onTab }) {
  const stats = useResource(() => api('GET', '/admin/marketing/stats?days=14'), [api, tick]);
  const replies = useResource(() => api('GET', '/admin/marketing/replies').then((out) => out.replies ?? []), [api, tick]);

  const ordered = [...(replies.data ?? [])].sort((a, b) => Number(b.kind === 'reply') - Number(a.kind === 'reply') || b.at - a.at);
  return (
    <div className="aw-mk-overview">
      <Panel title="Autopilot">
        <AutopilotTable overview={overview} />
      </Panel>

      <NeedsYou api={api} tick={tick} overview={overview} replies={replies.data} onTab={onTab} onReview={onReview} onContact={onContact} />

      <ExperimentPanel overview={overview} onTab={onTab} />

      <Panel title="Last 14 days">
        <ResourceNote resource={stats} label="Loading outreach stats…" variant="chart" />
        {stats.data ? (stats.data.days?.length ? <StatsChart stats={stats.data} /> : <Empty title="No outreach stats yet" hint="Daily send, reply, bounce and post activity appears here once sending begins." />) : null}
      </Panel>

      <Panel title="What came back" subtitle="Replies are forwarded to your inbox. Opt-outs and complaints are already closed.">
        {ordered.length ? (
          <ul className="aw-mk-replies">
            {ordered.map((r) => (
              <li
                key={r.id}
                className="aw-mk-reply"
                onClick={() => onContact(r.contact.id)}
              >
                <Badge tone={REPLY_TONE[r.kind]}>{REPLY_LABEL[r.kind] ?? r.kind}</Badge>
                <div className="aw-mk-reply__body">
                  <strong className="aw-mk-reply__who">{r.contact.business ?? r.contact.email}</strong>
                  <p className="aw-muted aw-mk-copy aw-mk-reply__text">{snippet(r.text ?? '', 220)}</p>
                </div>
                <div className="aw-mk-reply__meta">
                  <span className="aw-muted aw-mk-reply__age">{ago(r.at)} ago</span>
                  <Button
                    size="sm"
                    kind="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      onContact(r.contact.id);
                    }}
                  >
                    Open
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : <ResourceNote resource={replies} label="Loading replies…" empty="No replies or opt-outs yet" hint="Incoming replies and unsubscribe notices appear here." />}
      </Panel>
    </div>
  );
}

/* —— review: the next first emails, one at a time —— */

function ReviewModal({ api, onClose }) {
  const [queue, setQueue] = useState(null);
  const [nextDay, setNextDay] = useState(null);
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState(null);
  const [done, setDone] = useState({ ok: 0, rewritten: 0, cancelled: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const loadQueue = useCallback(
    () => {
      setError(null);
      return api('GET', '/admin/marketing/review?limit=50').then((out) => {
        setQueue(out.messages ?? []);
        setNextDay(out.nextDay);
        setIndex(0);
      });
    },
    [api],
  );
  useEffect(() => {
    void loadQueue().catch(setError);
  }, [loadQueue]);

  const current = queue?.[index] ?? null;
  const detailResource = useResource(() => current ? api('GET', `/admin/marketing/messages/${current.id}`) : null, [api, current]);
  const detail = detailResource.data;
  useEffect(() => setDraft(null), [current]);

  const step = async (fn, counter) => {
    setBusy(true);
    setError(null);
    try {
      if (fn) await fn();
      if (counter) setDone((d) => ({ ...d, [counter]: d[counter] + 1 }));
      if (index + 1 < queue.length) setIndex(index + 1);
      else await loadQueue();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const progress = `${done.ok} let go · ${done.rewritten} rewritten · ${done.cancelled} cancelled${nextDay ? ` · next 24h: ${nextDay.reviewed + done.ok + done.rewritten}/${nextDay.total} reviewed` : ''}`;

  if (queue && !current) {
    return (
      <Modal title="Review" subtitle={progress} onClose={onClose} actions={<Button kind="primary" onClick={onClose}>Done</Button>}>
        <Empty title="No first emails waiting for review" detail="Follow-ups go with their first email." />
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
            <Button kind="primary" disabled={busy || !detail} onClick={() => step(() => api('POST', `/admin/marketing/messages/${current.id}/review`), 'ok')}>
              Looks good, next
            </Button>
          </>
        )
      }
    >
      {contact ? (
        <p className="aw-muted aw-mk-no-top">
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
          <p className="aw-mk-subject">{detail.preview.subject}</p>
          <pre className="aw-mk-copy aw-mk-preview">
            {detail.preview.text}
          </pre>
        </>
      ) : (
        current ? <ResourceNote resource={detailResource} label="Loading email…" /> : !error ? <Loading label="Loading review queue…" /> : null
      )}
      {error ? <ErrorNote error={error} onRetry={!queue ? () => void loadQueue().catch(setError) : undefined} /> : null}
    </Modal>
  );
}

/* —— one contact, everything that happened —— */

function PersonModal({ id, api, onClose, onEdit, onQueue, onOptOut, onOpenMessage }) {
  const resource = useResource(() => api('GET', `/admin/marketing/contacts/${id}`), [api, id]);
  const data = resource.data;
  const [showDmarc, setShowDmarc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const optOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await onOptOut(data.contact);
      resource.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
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
          {c && ['new', 'paused', 'contacted'].includes(c.status) && !c.nextAt ? (
            <Button disabled={busy || resource.loading} onClick={() => onQueue(c)}>Queue</Button>
          ) : null}
          {c && c.status !== 'opted_out' ? (
            <Button disabled={busy || resource.loading} onClick={optOut}>Opt out</Button>
          ) : null}
          {c ? (
            <Button kind="primary" onClick={() => onEdit(c)}>
              Edit contact
            </Button>
          ) : null}
        </>
      }
    >
      {error ? <ErrorNote error={error} /> : null}
      {c && resource.error ? <ResourceNote resource={resource} /> : null}
      {c ? (
        <>
          <div className="aw-tags">
            <Badge tone={CONTACT_TONE[c.status]}>{c.status}</Badge>
            {c.sourceKind ? <Badge tone="neutral">{c.sourceKind}</Badge> : null}
            {c.country ? <Badge tone="neutral">{c.country}</Badge> : null}
            <Badge tone="neutral">added {ago(c.createdAt)} ago</Badge>
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
                <tr key={m.id} onClick={() => onOpenMessage(m.id)} className="aw-mk-click">
                  <td className="aw-muted">{m.sentAt ? `${ago(m.sentAt)} ago` : m.scheduledAt ? when(m.scheduledAt) : '—'}</td>
                  <td>
                    {m.subject} {m.editedAt ? <Badge tone="ok">edited</Badge> : m.reviewedAt ? <Badge tone="ok">reviewed</Badge> : null}
                  </td>
                  <td>
                    <Badge tone={MESSAGE_TONE[m.status]}>{m.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.messages.length ? <p className="aw-muted">Nothing queued or sent.</p> : null}
          <div className="aw-inline">
            <h3>Events</h3>
            <Chips label="Event filters" value={showDmarc ? ['dmarc'] : []} options={[{ value: 'dmarc', label: 'Show DMARC reports' }]} onChange={(values) => setShowDmarc(values.includes('dmarc'))} />
          </div>
          <ul className="aw-rows">
            {data.events.filter((e) => showDmarc || e.kind !== 'dmarc_report').map((e) => (
              <li key={e.id} className="aw-row">
                <Badge tone={EVENT_BAD.has(e.kind) ? 'bad' : EVENT_GOOD.has(e.kind) ? 'ok' : 'neutral'}>{EVENT_LABEL[e.kind] ?? e.kind.replaceAll('_', ' ')}</Badge>
                <span className="aw-muted aw-mk-copy">
                  {snippet(e.detail ?? '', 300)}
                </span>
                <span className="aw-muted">{ago(e.createdAt)} ago</span>
              </li>
            ))}
          </ul>
          {!data.events.filter((e) => showDmarc || e.kind !== 'dmarc_report').length ? <p className="aw-muted">No events.</p> : null}
        </>
      ) : <ResourceNote resource={resource} label="Loading contact history…" empty="No contact found" />}
    </Modal>
  );
}

/* —— email: the send queue, in send order —— */

function EmailTab({ api, run, tick, events, onOpen }) {
  const [order, setOrder] = useState('next');
  const [status, setStatus] = useState('scheduled');
  const [showDmarc, setShowDmarc] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const visibleEvents = events.filter((e) => showDmarc || e.kind !== 'dmarc_report');
  const resource = useResource(() => {
    const search = new URLSearchParams({ channel: 'email', ...(status ? { status } : {}), ...(order === 'next' ? { order: 'next' } : {}) });
    return api('GET', `/admin/marketing/messages?${search}`).then((out) => out.messages ?? []);
  }, [api, order, status, tick]);
  const messages = resource.data;

  return (
    <section className="aw-panel">
      <div className="aw-inline aw-mk-controls">
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
              <tr key={m.id} onClick={() => onOpen(m)} className="aw-mk-click">
                <td className="aw-muted">{m.sentAt ? `${ago(m.sentAt)} ago` : m.scheduledAt ? when(m.scheduledAt) : 'draft'}</td>
                <td className="aw-mono">{m.contactEmail ?? '—'}</td>
                <td className="aw-table__title">
                  <div>
                    {m.subject} {m.editedAt ? <Badge tone="ok">edited</Badge> : m.reviewedAt ? <Badge tone="ok">reviewed</Badge> : null}{' '}
                    <span className="aw-muted">· step {m.step + 1}</span>
                  </div>
                  <div className="aw-muted">{snippet(m.body.replace(/\s+/g, ' '), 140)}</div>
                  {m.error ? <div className="aw-warn">{m.error}</div> : null}
                </td>
                <td>
                  <Badge tone={MESSAGE_TONE[m.status]}>{m.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : <ResourceNote resource={resource} label="Loading email…" empty="No email matches these filters" />}
      {messages?.length === 200 ? <p className="aw-muted">The first 200 are shown.</p> : null}

      <div className="aw-group">
        <div className="aw-inline">
          <h3>Recent events</h3>
          {visibleEvents.length > 10 ? (
            <Button size="sm" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show less' : `Show all (${visibleEvents.length})`}</Button>
          ) : null}
          <Button size="sm" kind="ghost" onClick={() => setShowDmarc((v) => !v)}>
            {showDmarc ? 'Hide DMARC reports' : 'Show DMARC reports'}
          </Button>
        </div>
        <ul className="aw-rows">
          {visibleEvents.slice(0, showAll ? undefined : 10).map((e) => (
            <li key={e.id} className="aw-row">
              <Badge tone={EVENT_BAD.has(e.kind) ? 'bad' : EVENT_GOOD.has(e.kind) ? 'ok' : 'neutral'}>{EVENT_LABEL[e.kind] ?? e.kind.replaceAll('_', ' ')}</Badge>
              <span className="aw-row__title">{e.email ?? '—'}</span>
              <span className="aw-muted">{snippet(e.detail ?? '', 100)}</span>
              <span className="aw-muted">{ago(e.createdAt)} ago</span>
            </li>
          ))}
        </ul>
        {!visibleEvents.length ? <Empty title="No recent events" /> : null}
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
        .catch((err) => setError(errorText(err))),
    [api, id],
  );
  const retry = () => { setError(null); void load(); };
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
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <Modal title="Email" onClose={onClose}>
        {error ? <ErrorNote error={error} onRetry={retry} /> : <Loading label="Loading email…" />}
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
          <dl className="aw-mono aw-mk-message-meta">
            <dt className="aw-muted">From</dt>
            <dd>{preview.from}</dd>
            <dt className="aw-muted">To</dt>
            <dd>
              {preview.to}
              {contact?.business ? ` (${contact.business})` : ''}
            </dd>
            <dt className="aw-muted">Reply-To</dt>
            <dd>{preview.replyTo}</dd>
            {Object.entries(preview.headers ?? {}).map(([name, value]) => (
              <Fragment key={name}>
                <dt className="aw-muted">{name}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
            <dt className="aw-muted">Subject</dt>
            <dd>{preview.subject}</dd>
          </dl>
          <pre className="aw-mk-copy aw-mk-preview aw-mk-preview-spaced">
            {preview.text}
          </pre>
          {preview.image ? (
            <figure className="aw-mk-figure">
              <img src={preview.image} alt="" width={280} className="aw-mk-preview-image" />
              <figcaption className="aw-muted">
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
                  <Badge tone={EVENT_BAD.has(e.kind) ? 'bad' : EVENT_GOOD.has(e.kind) ? 'ok' : 'neutral'}>{e.kind}</Badge>
                  <span className="aw-muted">{snippet(e.detail ?? '', 100)}</span>
                  <span className="aw-muted">{ago(e.createdAt)} ago</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {error ? <ErrorNote error={error} /> : null}
    </Modal>
  );
}

/* —— posts: the audit, before and after they go out —— */

const POST_MAX = { x: 280, linkedin: 3000 };

function PostsTab({ api, run, mutate, ask, tick, holdHours = 0, onEdit }) {
  const resource = useResource(
    () => Promise.all(['x', 'linkedin'].map((channel) => api('GET', `/admin/marketing/messages?channel=${channel}`)))
      .then((lists) => lists.flatMap((out) => out.messages ?? [])),
    [api, tick],
  );
  if (!resource.data) return <ResourceNote resource={resource} label="Loading posts…" />;
  const posts = resource.data;
  const at = (m) => m.scheduledAt ?? m.createdAt;
  const groups = [
    { title: 'Waiting for your approval', hint: holdHours > 0 ? 'Approve a draft to schedule it, or let its hold expire.' : 'Approve a draft to schedule it.', list: posts.filter((m) => m.status === 'draft').sort((a, b) => at(a) - at(b)) },
    { title: 'Scheduled', hint: 'The publisher posts these at their time from your browser profile. You get an email when each goes out.', list: posts.filter((m) => m.status === 'scheduled' || m.status === 'sending').sort((a, b) => at(a) - at(b)) },
    { title: 'Failed', list: posts.filter((m) => m.status === 'failed') },
    { title: 'Published', list: posts.filter((m) => m.status === 'sent').sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0)) },
  ];

  return (
    <>
      {groups.map((group) =>
        group.list.length ? (
          <Panel key={group.title} title={`${group.title} (${group.list.length})`} subtitle={group.hint}>
            {group.list.map((m) => (
              <PostCard key={m.id} post={m} api={api} run={run} mutate={mutate} ask={ask} holdHours={holdHours} onEdit={onEdit} />
            ))}
          </Panel>
        ) : null,
      )}
      {!groups.some((group) => group.list.length) ? <ResourceNote resource={resource} label="Loading posts…" empty="No posts to review, schedule or track" /> : null}
    </>
  );
}

function PostCard({ post: m, api, run, mutate, ask, holdHours = 0, onEdit }) {
  const open = ['draft', 'scheduled', 'failed'].includes(m.status);
  const max = POST_MAX[m.channel] ?? 3000;
  // A held draft goes out on its own: the later of its hold expiring and its slot.
  const releaseAt = m.status === 'draft' && holdHours > 0 ? Math.max((m.createdAt ?? 0) + holdHours * 3600, m.scheduledAt ?? 0) : null;
  return (
    <article className="aw-mk-entry">
      <div className="aw-inline">
        <Badge>{m.channel === 'x' ? 'X' : 'LinkedIn'}</Badge>
        <Badge tone={MESSAGE_TONE[m.status]}>{m.status === 'draft' ? 'to approve' : m.status}</Badge>
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
      <p className="aw-mk-copy aw-mk-post-body">{m.body}</p>
      {releaseAt ? <div className="aw-muted">Goes out automatically {when(releaseAt)} unless you cancel it first.</div> : null}
      {m.error ? <div className="aw-warn">{m.error}</div> : null}
      {open ? (
        <div className="aw-inline aw-mk-post-actions">
          {m.status === 'draft' ? (
            <Button size="sm" kind="primary" onClick={() => run(() => api('POST', `/admin/marketing/messages/${m.id}/approve`), 'Approved: it goes out in its slot.')}>Approve</Button>
          ) : m.status === 'failed' ? (
            <Button size="sm" kind="primary" onClick={() => run(() => api('POST', `/admin/marketing/messages/${m.id}/retry`), 'Queued again.')}>Retry</Button>
          ) : <Button size="sm" kind="primary" onClick={() => onEdit(m)}>Edit</Button>}
          <details className="aw-mk-more">
            <summary>More</summary>
            <div className="aw-inline aw-mk-post-actions">
              {m.status !== 'scheduled' ? <Button size="sm" onClick={() => onEdit(m)}>Edit</Button> : null}
              <Button size="sm" onClick={() => ask({
                title: `Post publicly on ${postChannelLabel[m.channel] ?? m.channel} now?`,
                text: 'The publisher can post this as soon as it next checks the queue.',
                confirm: 'Post now', danger: true,
                run: () => mutate(() => api('POST', `/admin/marketing/messages/${m.id}/send`), 'Due now: the publisher posts it within 15 minutes.'),
              })}>Post now</Button>
              <Button size="sm" kind="ghost" onClick={() => ask({
                title: m.status === 'draft' ? 'Reject this draft?' : 'Cancel this post?',
                text: 'This removes it from the publishing queue.',
                confirm: m.status === 'draft' ? 'Reject' : 'Cancel post', danger: true,
                run: () => mutate(() => api('POST', `/admin/marketing/messages/${m.id}/cancel`), m.status === 'draft' ? 'Draft rejected.' : 'Post cancelled.'),
              })}>{m.status === 'draft' ? 'Reject' : 'Cancel'}</Button>
            </div>
          </details>
        </div>
      ) : null}
    </article>
  );
}

/* —— sequences: the templates, filled in for a real contact —— */

function SequencesTab({ api, sequences }) {
  const [sequence, setSequence] = useState(sequences[0]?.key ?? 'cold_a');
  const resource = useResource(
    () => api('GET', `/admin/marketing/sequences/preview?sequence=${sequence}`),
    [api, sequence],
  );
  const data = resource.data;

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
                {s.key === 'cold_a' ? <Badge>control</Badge> : null}
                {s.key === 'cold_obs' ? <Badge>challenger</Badge> : null}
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

      <div className="aw-inline aw-mk-sequence-tools">
        <select value={sequence} onChange={(e) => setSequence(e.target.value)}>
          {sequences.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={resource.reload} disabled={resource.loading}>
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
      {resource.loading || !data?.steps?.length ? <ResourceNote resource={resource} label="Loading sequence preview…" empty="No steps in this sequence" /> : null}
      {data?.steps?.map((step) => (
        <article key={step.kind} className="aw-mk-entry">
          <div className="aw-inline">
            <Badge>day {step.day}</Badge>
            <strong>{step.subject}</strong>
            {step.usesPlain ? <Badge tone="neutral">plain version: no observation</Badge> : null}
          </div>
          <pre className="aw-mk-copy">
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
  const resource = useResource(() => api('GET', '/admin/marketing/sources').then((out) => out.sources ?? []), [api, tick]);
  if (!resource.data?.length) return <Panel title="Sources"><ResourceNote resource={resource} label="Loading sources…" empty="No contact sources yet" /></Panel>;
  const sources = resource.data;
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
            <tr key={s.source} onClick={() => onPick(s.source)} className="aw-mk-click" title="Show these contacts">
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
  const resource = useResource(() => api('GET', '/admin/health/deepseek'), [api]);
  const state = resource.data;
  if (!state) return <ResourceNote resource={resource} label="Checking model health…" empty="No model health report" />;
  const tone = state.chat ? 'ok' : state.bridge ? 'warn' : 'bad';
  const label = state.chat ? 'DeepSeek up' : state.bridge ? 'Workers AI fallback' : 'both engines down';
  return <Badge tone={tone}>{label}</Badge>;
}

/* —— settings —— */

function SettingsTab({ overview, mutate, api, onShowSending }) {
  const [group, setGroup] = useState('Sending');
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const saved = overview.settings;
  const draft = { ...saved, ...edits };
  const set = (key, value) => setEdits((before) => {
    const next = { ...before };
    if (value === saved[key]) delete next[key];
    else next[key] = value;
    return next;
  });
  const changed = Object.keys(edits).length > 0;
  const save = async () => {
    const { live: _live, ...patch } = edits;
    setBusy(true);
    setError(null);
    try {
      const out = await mutate(() => api('PUT', '/admin/marketing/settings', patch), (result) => result.rejected?.length ? 'Settings were not fully saved.' : 'Marketing settings saved.');
      const rejected = out?.rejected ?? [];
      setEdits(Object.fromEntries(Object.entries(patch).filter(([key]) => rejected.includes(key))));
      if (rejected.length) setError(`Could not save: ${rejected.join(', ')}.`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Panel title="Marketing settings" actions={<ModelHealth api={api} />}>
        <Segmented label="Settings group" value={group} options={['Sending', 'Safety', 'Content'].map((label) => ({ value: label, label }))} onChange={setGroup} />
      </Panel>
      <fieldset disabled={busy} className="aw-mk-settings-fields">
      {group === 'Sending' ? <>
      <Panel title="Sender" subtitle="Who the mail comes from.">
        <div className="aw-form2">
          <div className="aw-field">
            <span className="aw-field__label">Outreach</span>
            <div className="aw-inline">
              <Badge tone={saved.live ? 'ok' : 'warn'}>{saved.live ? 'Live' : 'Paused'}</Badge>
              <Button size="sm" kind="ghost" onClick={onShowSending}>Go to sending control</Button>
            </div>
          </div>
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
      </Panel>

      <Panel title="Schedule and volume" subtitle="When mail may leave, and how much of it.">
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
      </Panel>

      </> : group === 'Safety' ? <>
      <Panel title="Safety" subtitle="The checks that keep the list healthy.">
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
      </Panel>

      <Panel title="Experiment" subtitle="The cold A/B test.">
        <Field
          label="Observation sequence share (%)"
          hint="Of contacts with a site observation, this percent get the observation opener. 0 keeps the experiment off, 100 makes it the only cold opener."
        >
          <input inputMode="numeric" min="0" max="100" value={draft.obsShare ?? 50} onChange={(e) => set('obsShare', Number(e.target.value))} />
        </Field>
      </Panel>

      </> : <>
      <Panel title="Email look" subtitle="What the HTML version carries.">
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
      </Panel>

      <Panel title="Posts" subtitle="How written posts reach X and LinkedIn.">
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
      </Panel>
      <Panel title="Publisher">
        <details className="aw-mk-publisher">
          <summary>How publishing works</summary>
        <p className="aw-muted">
          X and LinkedIn have no affordable posting API, so the machine posts from a real browser profile:
          <span className="aw-mono"> marketing/publisher/publish.mjs</span>. It polls this desk with{' '}
          <span className="aw-mono">MARKETING_TOKEN</span>, opens the composer with the queued text, and reports back. Keep
          it launched from this machine — it uses that browser session, not a password.
        </p>
        </details>
      </Panel>
      </>}
      </fieldset>
      <footer className="aw-inline aw-mk-settings-footer">
        <span className="aw-muted" role="status">{busy ? 'Saving…' : changed ? 'Unsaved changes' : 'No unsaved changes'}</span>
        {error ? <ErrorNote error={error} /> : null}
        <span className="aw-toolbar__fill" />
        <Button disabled={busy || !changed} title={!changed ? 'No unsaved changes to reset.' : undefined} onClick={() => { setEdits({}); setError(null); }}>Reset</Button>
        <Button kind="primary" disabled={busy || !changed} title={!changed ? 'Change a setting before saving.' : undefined} onClick={save}>Save</Button>
      </footer>
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
      setError(errorText(err));
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
      {error ? <ErrorNote error={error} /> : null}
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
      setError(errorText(err));
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
      {error ? <ErrorNote error={error} /> : null}
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
      setError(errorText(err));
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
      {error ? <ErrorNote error={error} /> : null}
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
      setError(errorText(err));
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
      {error ? <ErrorNote error={error} /> : null}
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
      setError(errorText(err));
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
      {error ? <ErrorNote error={error} /> : null}
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
      setError(errorText(err));
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
      {error ? <ErrorNote error={error} /> : null}
    </Modal>
  );
}
