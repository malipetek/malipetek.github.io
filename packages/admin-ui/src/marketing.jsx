/* The marketing desk: who we write to, what is queued, and the switch that sends it. */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAdmin, usePoll } from './store.js';
import { POST_MAX, postLength } from './post-length.js';
import { openSettings } from './settings-link.js';
import { ago, errorText, when } from './format.js';
import { nextRowIndex } from './row-navigation.mjs';
import {
  Button,
  Chips,
  DataTable,
  EmptyState,
  ErrorNote,
  Field,
  FormPane,
  Inspector,
  MetaChip,
  Modal,
  PageHeader,
  PageTabs,
  Panel,
  SaveBar,
  Segmented,
  Skeleton,
  StateIndicator,
  UiStyles,
  cx,
  humanize,
  useMedia,
} from './ui/index.js';

const CONTACT_STATUSES = ['new', 'queued', 'contacted', 'replied', 'paused', 'opted_out', 'bounced'];
const MESSAGE_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'];
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
const siteHref = (site) => (/^https?:/.test(site) ? site : `https://${site}`);

const CONTACT_STATE = {
  new: { state: 'new', label: 'New' },
  queued: { state: 'queued', label: 'Queued' },
  contacted: { state: 'contacted', tone: 'ok', label: 'Contacted' },
  replied: { state: 'replied', label: 'Replied' },
  paused: { state: 'paused', tone: 'warn', label: 'Paused' },
  opted_out: { state: 'opted_out', label: 'Opted out' },
  bounced: { state: 'bounced', label: 'Bounced' },
};

function ContactStatus({ status }) {
  const s = CONTACT_STATE[status] ?? { state: status };
  return <StateIndicator state={s.state} tone={s.tone} label={s.label} />;
}

function messageState(status, isPost = false) {
  if (status === 'draft') return isPost ? { state: 'review', tone: 'warn', label: 'To approve' } : { state: 'draft', tone: 'neutral', label: 'Draft' };
  if (status === 'scheduled') return { state: 'queued', tone: 'neutral', label: 'Scheduled' };
  if (status === 'sending') return { state: 'running', tone: 'info', label: 'Sending', live: true };
  if (status === 'sent') return { state: 'done', tone: 'ok', label: isPost ? 'Published' : 'Sent' };
  if (status === 'failed') return { state: 'failed', label: 'Failed' };
  if (status === 'cancelled') return { state: 'declined', tone: 'neutral', label: 'Cancelled' };
  return { state: status };
}

function MessageStatus({ status, isPost = false }) {
  const s = messageState(status, isPost);
  return <StateIndicator state={s.state} tone={s.tone} label={s.label} live={s.live} />;
}

const EVENT_BAD = new Set(['failed', 'bounce', 'opt_out', 'complaint', 'cycle_failed', 'auto_paused', 'blocked', 'undeliverable']);
const EVENT_GOOD = new Set(['reply', 'sent', 'published', 'cycle', 'approved', 'auto_resumed', 'auto_approved']);
const EVENT_LABEL = {
  dmarc_report: 'DMARC report',
  auto_resumed: 'Auto-resumed',
  auto_approved: 'Auto-approved',
  auto_paused: 'Auto-paused',
  opt_out: 'Opted out',
  reply: 'Replied',
  complaint: 'Spam complaint',
  sent: 'Sent',
  published: 'Published',
  bounce: 'Bounced',
  failed: 'Failed',
  cycle: 'Cycle filed',
  cycle_failed: 'Cycle failed',
  approved: 'Approved',
  blocked: 'Blocked',
  undeliverable: 'Undeliverable',
};

function EventStatus({ kind }) {
  const tone = EVENT_BAD.has(kind) ? 'bad' : EVENT_GOOD.has(kind) ? 'ok' : 'neutral';
  return <StateIndicator state={kind} tone={tone} label={EVENT_LABEL[kind] ?? humanize(kind)} />;
}

const REPLY_STATE = {
  reply: { state: 'replied', tone: 'ok', label: 'Replied' },
  opt_out: { state: 'opted_out', tone: 'warn', label: 'Opted out' },
  complaint: { state: 'failed', tone: 'bad', label: 'Spam complaint' },
};

function ReplyStatus({ kind }) {
  const s = REPLY_STATE[kind] ?? { state: kind, tone: 'neutral', label: humanize(kind) };
  return <StateIndicator state={s.state} tone={s.tone} label={s.label} />;
}

/** The one-line state beside the Marketing title: running, paused, or blocked. */
function deskState(overview) {
  const { settings, bound, senderState, autoResume } = overview;
  if (!bound) {
    const reason = senderState?.reason;
    const short =
      reason === 'ses_unconfigured' ? 'SES has no keys' : reason === 'sender_unbound' ? 'no sender bound' : (REASONS[reason] ?? reason ?? 'no sender bound');
    return { state: 'blocked', tone: 'bad', text: `Can't send: ${short}`, live: false };
  }
  if (!settings.postalAddress) return { state: 'blocked', tone: 'bad', text: "Can't send: no postal address", live: false };
  if (!settings.live) {
    if (autoResume?.autoPausedAt) {
      const back = autoResume.resumesAfter ? `, back ${dateLabel(autoResume.resumesAfter)}` : '';
      return { state: 'paused', tone: 'warn', text: `Auto-paused ${dateLabel(autoResume.autoPausedAt)}${back}`, live: false };
    }
    return { state: 'paused', tone: 'warn', text: 'Paused', live: false };
  }
  return { state: 'running', tone: 'ok', text: 'Live', live: true };
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

/** Wait for selection to rest before fetching detail, so j/k does not fire a request per row. */
function useSettled(value, ms = 180) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Selection survival: keep the selected item while it stays in the filtered
 * rows; otherwise fall back to the first visible row (or null when empty).
 * Never auto-opens when the user closed the Inspector (activeKey == null).
 */
function useSurvivedSelection(activeKey, rows, getKey, loading, onChange) {
  const resolved = useMemo(() => {
    if (activeKey == null) return null;
    const hit = rows.find((r) => String(getKey(r)) === String(activeKey));
    if (hit) return hit;
    if (loading) return null;
    return rows[0] ?? null;
  }, [activeKey, rows, getKey, loading]);

  useEffect(() => {
    if (activeKey == null || loading) return;
    if (rows.some((r) => String(getKey(r)) === String(activeKey))) return;
    onChange(rows[0] ?? null);
  }, [activeKey, rows, getKey, loading, onChange]);

  return resolved;
}

/** Escape closes the Inspector from anywhere in the workspace, unless something nearer handled it. */
const closeOnEscape = (open, close) => (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || !open) return;
  if (e.target?.closest?.('input, textarea, select, [contenteditable], .aw-menu, [role="dialog"]')) return;
  e.preventDefault();
  close();
};

function ResourceNote({ resource, label, empty, hint, action, variant = 'rows', rows = 3 }) {
  if (resource.error) return <ErrorNote error={resource.error} onRetry={resource.reload} />;
  if (resource.loading) return <Skeleton label={label} variant={variant} rows={rows} />;
  return empty ? <EmptyState title={empty} hint={hint} action={action} /> : null;
}

/** Split master-detail layout with an overlay scrim behind the Inspector at ≤900px. */
function SplitPane({ inspector, onClose, children }) {
  return (
    <div className="ui-split">
      <div className="ui-split__main">{children}</div>
      {inspector ? (
        <>
          <div className="aw-mk-scrim" onClick={onClose} aria-hidden="true" />
          {inspector}
        </>
      ) : null}
    </div>
  );
}

const runMessage = (result) =>
  result?.reason ? (REASONS[result.reason] ?? `Nothing sent: ${result.reason}`) : `Sent ${result?.sent ?? 0}${result?.failed ? `, ${result.failed} failed` : ''}.`;

export function MarketingView() {
  const { api, act, ask, notify, open } = useAdmin();
  const [selectedBulk, setSelectedBulk] = useState(() => new Set());
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState(null);
  const [inspector, setInspector] = useState(null);
  const [filters, setFilters] = useState({ status: '', q: '', source: '', offset: 0 });

  const filter = useCallback((patch) => {
    setSelectedBulk(new Set());
    setFilters((f) => ({ ...f, offset: 0, ...patch }));
  }, []);

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
      if (message) notify(message);
      refresh();
    },
    [refresh, notify],
  );

  const closeInspector = useCallback(() => setInspector(null), []);
  const switchTab = useCallback((next) => {
    setTab(next);
    setInspector(null);
  }, []);
  // Marketing settings live in the unified Settings; links that said "Settings" go there.
  const openMarketingSettings = useCallback(() => openSettings(open, 'marketing'), [open]);
  const goTab = useCallback((next) => (next === 'settings' ? openMarketingSettings() : switchTab(next)), [openMarketingSettings, switchTab]);
  const sending = useSendingSwitch({ api, ask, mutate, overview, resource: desk });

  if (!overview) {
    return (
      <div className="ui-workspace aw-mk">
        <UiStyles />
        <ResourceNote resource={desk} label="Loading Marketing…" variant="pane" />
      </div>
    );
  }

  const { settings, health } = overview;
  const state = deskState(overview);
  const startSending = sending.start;
  const bulk = (action) => {
    void mutate(
      () => api('POST', '/admin/marketing/contacts/bulk', { action, ids: [...selectedBulk] }),
      (out) => `${out.changed} ${action === 'pause' ? 'paused' : 'opted out'}; their queued mail was cancelled.`,
    ).then(() => setSelectedBulk(new Set()), () => undefined);
  };
  const optOutContact = (contact) =>
    mutate(
      () => api('PATCH', `/admin/marketing/contacts/${contact.id}`, { status: 'opted_out' }),
      `${contact.email} opted out; queued mail cancelled.`,
    );

  const sendDisabled = sending.disabled;
  const sendDisabledReason = sending.disabledReason;
  const toggleSending = sending.toggle;
  const runNow = () => run(() => api('POST', '/admin/marketing/run'), runMessage);
  const rerenderScheduled = () => run(() => api('POST', '/admin/marketing/messages/rerender'), 'Scheduled emails now use the current wording.');
  const draftPosts = () => run(() => api('POST', '/admin/marketing/cycle?force=1'), cycleMessage);

  // At most ONE visible primary action per viewport: step header CTA down whenever
  // an Inspector or Create modal holds the primary button.
  const quietHeader = Boolean(inspector) || Boolean(modal);
  const headerPrimaryKind = quietHeader ? 'default' : 'primary';

  const sendingOverflowItem = {
    label: settings.live ? 'Pause sending' : 'Go live',
    disabled: sendDisabled,
    disabledReason: sendDisabledReason,
    danger: !settings.live,
    run: toggleSending,
  };
  const settingsItem = { label: 'Marketing settings…', run: openMarketingSettings };
  const deskOverflowItems = [
    { label: 'Run now', run: runNow },
    sendingOverflowItem,
    { separator: true },
    settingsItem,
  ];

  let headerAction = null;
  let headerOverflow = [];
  if (tab === 'overview') {
    headerAction = !settings.live ? (
      <Button kind={headerPrimaryKind} disabled={sendDisabled} disabledReason={sendDisabledReason} onClick={startSending}>
        Go live
      </Button>
    ) : (
      <Button
        kind={headerPrimaryKind}
        title="Read the next first emails one by one: let each go, rewrite it, or cancel it."
        onClick={() => setInspector({ kind: 'review' })}
      >
        Review next
      </Button>
    );
    headerOverflow = [
      settings.live ? sendingOverflowItem : { label: 'Review next', run: () => setInspector({ kind: 'review' }) },
      { label: 'Run now', run: runNow },
      { separator: true },
      { label: 'Add contact', run: () => setModal({ kind: 'contact' }) },
      { label: 'Import CSV', run: () => setModal({ kind: 'import' }) },
      { label: 'Compose', run: () => setModal({ kind: 'compose', channel: 'email' }) },
      { label: 'Draft posts', run: draftPosts },
      { separator: true },
      settingsItem,
    ];
  } else if (tab === 'contacts') {
    headerAction = (
      <Button kind={headerPrimaryKind} onClick={() => setModal({ kind: 'contact' })}>
        Add contact
      </Button>
    );
    headerOverflow = [
      { label: 'Import CSV', run: () => setModal({ kind: 'import' }) },
      { label: 'Queue everyone', run: () => setModal({ kind: 'bulkqueue' }) },
      { separator: true },
      ...deskOverflowItems,
    ];
  } else if (tab === 'email') {
    headerAction = (
      <Button
        kind={headerPrimaryKind}
        title="Read the next first emails one by one: let each go, rewrite it, or cancel it."
        onClick={() => setInspector({ kind: 'review' })}
      >
        Review next
      </Button>
    );
    headerOverflow = [
      { label: 'Compose email', run: () => setModal({ kind: 'compose', channel: 'email' }) },
      {
        label: 'Re-render scheduled',
        hint: 'Re-render unedited scheduled emails using current sequence wording',
        run: rerenderScheduled,
      },
      { separator: true },
      ...deskOverflowItems,
    ];
  } else if (tab === 'posts') {
    headerAction = (
      <Button kind={headerPrimaryKind} onClick={draftPosts}>
        Draft posts
      </Button>
    );
    headerOverflow = [
      { label: 'Compose post', run: () => setModal({ kind: 'compose', channel: 'x' }) },
      { separator: true },
      ...deskOverflowItems,
    ];
  } else if (tab === 'sequences') {
    headerAction = !settings.live ? (
      <Button kind={headerPrimaryKind} disabled={sendDisabled} disabledReason={sendDisabledReason} onClick={startSending}>
        Go live
      </Button>
    ) : null;
    headerOverflow = [
      { label: 'Re-render scheduled', run: rerenderScheduled },
      { separator: true },
      ...(settings.live ? deskOverflowItems : [{ label: 'Run now', run: runNow }, { separator: true }, settingsItem]),
    ];
  }

  return (
    <div className="ui-workspace aw-mk" onKeyDown={closeOnEscape(Boolean(inspector), closeInspector)}>
      <UiStyles />
      <PageHeader
        title="Marketing"
        subtitle="Email outreach, contacts, and scheduled posts."
        meta={<StateIndicator state={state.state} tone={state.tone} label={state.text} live={state.live} />}
        actions={headerAction}
        overflow={headerOverflow}
      />
      {desk.error ? <ResourceNote resource={desk} /> : null}

      <PageTabs
        ariaLabel="Marketing tabs"
        value={tab}
        onChange={switchTab}
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'contacts', label: 'Contacts' },
          { value: 'email', label: 'Email' },
          { value: 'posts', label: 'Posts', badge: overview.postsAwaiting > 0 ? overview.postsAwaiting : undefined },
          { value: 'sequences', label: 'Sequences' },
        ]}
      />

      {tab === 'overview' ? (
        <OverviewTab
          api={api}
          tick={tick}
          health={health}
          overview={overview}
          inspector={inspector}
          setInspector={setInspector}
          closeInspector={closeInspector}
          onTab={goTab}
          onToggleSending={toggleSending}
          onRunNow={runNow}
          onDraftPosts={draftPosts}
          onOptOut={optOutContact}
          onRefresh={refresh}
          notify={notify}
          sendDisabled={sendDisabled}
          sendDisabledReason={sendDisabledReason}
        />
      ) : null}

      {tab === 'contacts' ? (
        <ContactsTab
          api={api}
          tick={tick}
          overview={overview}
          people={people}
          contacts={contacts}
          paging={paging}
          filters={filters}
          filter={filter}
          selectedBulk={selectedBulk}
          setSelectedBulk={setSelectedBulk}
          bulk={bulk}
          inspector={inspector}
          setInspector={setInspector}
          closeInspector={closeInspector}
          onOptOut={optOutContact}
          onRefresh={refresh}
          notify={notify}
          onAddContact={() => setModal({ kind: 'contact' })}
          onImport={() => setModal({ kind: 'import' })}
        />
      ) : null}

      {tab === 'email' ? (
        <EmailTab
          api={api}
          run={run}
          tick={tick}
          events={overview.events}
          sequences={overview.sequences}
          inspector={inspector}
          setInspector={setInspector}
          closeInspector={closeInspector}
          onOptOut={optOutContact}
          onRefresh={refresh}
          notify={notify}
        />
      ) : null}

      {tab === 'posts' ? (
        <PostsTab
          api={api}
          run={run}
          mutate={mutate}
          ask={ask}
          tick={tick}
          holdHours={settings.postHoldHours ?? 0}
          inspector={inspector}
          setInspector={setInspector}
          closeInspector={closeInspector}
          onRefresh={refresh}
          notify={notify}
        />
      ) : null}

      {tab === 'sequences' ? (
        <SequencesTab
          api={api}
          sequences={overview.sequences}
          inspector={inspector}
          setInspector={setInspector}
          closeInspector={closeInspector}
        />
      ) : null}

      {modal?.kind === 'import' ? <ImportModal sequences={overview.sequences} onClose={() => setModal(null)} onDone={done} api={api} /> : null}

      {modal?.kind === 'bulkqueue' ? <BulkQueueModal sequences={overview.sequences} onClose={() => setModal(null)} onDone={done} api={api} /> : null}

      {modal?.kind === 'contact' ? (
        <ContactModal sequences={overview.sequences} api={api} onClose={() => setModal(null)} onSaved={done} />
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
    </div>
  );
}

/* —— overview: autopilot, needs you, experiment, 14-day chart, what came back —— */

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

/** Build the four autopilot loop rows once so both the table/compact list and Inspector share one source of truth. */
function buildLoops(overview) {
  const { settings, window: win, health, observe, domains, due, today, pulse = {} } = overview;
  const cap = Math.min(settings.dailyCap, overview.autoResume?.cap ?? settings.dailyCap);
  const ramping = (overview.autoResume?.cap ?? settings.dailyCap) < settings.dailyCap;
  const events = overview.events ?? [];
  const newest = (kind) => events.filter((e) => e.kind === kind).map((e) => e.createdAt).sort((a, b) => b - a)[0] ?? null;
  const lastSentAt = pulse.lastSentAt ?? newest('sent');
  const lastPublishedAt = pulse.lastPublishedAt ?? newest('published');
  const lastPublishedChannel = pulse.lastPublishedChannel ?? null;

  const emailIndicator = !settings.live
    ? { state: 'paused', tone: 'warn', label: 'Paused', live: false }
    : win?.open
      ? { state: 'running', tone: 'ok', label: 'Sending', live: true }
      : { state: 'waiting', tone: 'neutral', label: `Waiting (${WINDOW_REASON[win?.reason] ?? win?.reason ?? 'outside window'})`, live: false };
  const nextOpen = win && !win.open ? nextWindowOpen(settings, Math.floor(Date.now() / 1000)) : null;
  const emailNext = [
    due?.email ? `${due.email} due` : 'queue clear',
    !win?.open && nextOpen ? `opens ${when(nextOpen)}` : pulse.nextEmailAt ? `next ${when(pulse.nextEmailAt)}` : '',
  ].filter(Boolean).join(' · ');

  const holdHours = settings.postHoldHours ?? 0;
  const postStateLabel = holdHours > 0 ? `Hold ${holdHours}h` : settings.postApproval ? 'Approve by hand' : 'On schedule';
  const postTone = pulse.postsFailed ? 'bad' : overview.postsAwaiting ? 'warn' : 'ok';
  const postNext = [
    pulse.nextPostAt ? `${when(pulse.nextPostAt)}${pulse.nextPostChannel ? ` · ${postChannelLabel[pulse.nextPostChannel] ?? pulse.nextPostChannel}` : ''}` : '',
    pulse.postsQueued ? `${pulse.postsQueued} queued` : '',
  ].filter(Boolean).join(' · ');

  const pending = observe?.pending ?? 0;
  const observed = observe?.observed ?? 0;
  const withGap = observe?.withGap ?? 0;
  const bounceRate = health?.bounceRate ?? 0;
  const complaintRate = health?.complaintRate ?? 0;

  return [
    {
      id: 'email',
      name: 'Email',
      indicator: emailIndicator,
      last: `${lastSentAt ? when(lastSentAt) : 'No sends yet'} · ${today ?? 0}/${cap} today${ramping ? ' · ramping' : ''}`,
      next: emailNext || '—',
      bounceRate,
      complaintRate,
      maxBounceRate: health?.maxBounceRate ?? 0.04,
      maxComplaintRate: health?.maxComplaintRate ?? 0.002,
      healthText: `${pct(bounceRate)} bounces · ${pct(complaintRate)} complaints`,
    },
    {
      id: 'posts',
      name: 'Posts',
      indicator: { state: 'posts', tone: postTone, label: postStateLabel, live: false },
      last: lastPublishedAt
        ? `${when(lastPublishedAt)}${lastPublishedChannel ? ` · ${postChannelLabel[lastPublishedChannel] ?? lastPublishedChannel}` : ''}`
        : 'None yet',
      next: postNext || '—',
      failed: pulse.postsFailed,
      healthText: pulse.postsFailed == null ? '—' : `${pulse.postsFailed} failed`,
      badHealth: Boolean(pulse.postsFailed),
    },
    {
      id: 'observe',
      name: 'Site reading',
      indicator: pending > 0
        ? { state: 'running', tone: 'info', label: 'Reading', live: true }
        : { state: 'idle', tone: 'neutral', label: 'Idle', live: false },
      last: `${observed} read${pulse.lastObservedAt ? ` · last ${when(pulse.lastObservedAt)}` : ''}`,
      next: pending > 0 ? `${pending} waiting · ${fmtEta(obsEtaMinutes(pending))}` : 'All read',
      healthText: observed > 0 ? `${pct(withGap / observed)} found something` : '—',
    },
    {
      id: 'domains',
      name: 'Domain checks',
      indicator: { state: 'checking', tone: domains?.undeliverable ? 'warn' : 'ok', label: 'Checking', live: false },
      last: `${domains?.checked ?? 0} domains`,
      next: '—',
      healthText: `${domains?.undeliverable ?? 0} undeliverable`,
      badHealth: Boolean(domains?.undeliverable),
    },
  ];
}

/**
 * Autopilot: DataTable on wide viewports; at ≤720px one compact row per loop
 * (name, state, next) with all metrics and controls behind the Inspector or disclosure.
 */
function AutopilotSection({ overview, selectedLoopId, onSelectLoop }) {
  const narrow = useMedia('(max-width: 720px)');
  const loops = useMemo(() => buildLoops(overview), [overview]);
  const kindEntries = Object.entries(overview.observe?.byKind ?? {}).sort((a, b) => b[1] - a[1]);
  const rowRefs = useRef(new Map());

  const onCompactKey = (i) => (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelectLoop(loops[i].id);
      return;
    }
    const next = nextRowIndex(i, loops.length, e.key);
    if (next == null) return;
    e.preventDefault();
    onSelectLoop(loops[next].id);
    rowRefs.current.get(next)?.focus();
  };

  const columns = [
    { key: 'name', header: 'Loop', fit: true, render: (l) => <strong>{l.name}</strong> },
    {
      key: 'state',
      header: 'State',
      fit: true,
      render: (l) => <StateIndicator state={l.indicator.state} tone={l.indicator.tone} label={l.indicator.label} live={l.indicator.live} />,
    },
    { key: 'last', header: 'Last', render: (l) => <span className="aw-muted">{l.last}</span> },
    { key: 'next', header: 'Next', render: (l) => l.next },
    {
      key: 'health',
      header: 'Health',
      render: (l) =>
        l.id === 'email' ? (
          <div className="aw-mk-health">
            <RateMeter label="bounces" rate={l.bounceRate} limit={l.maxBounceRate} />
            <RateMeter label="complaints" rate={l.complaintRate} limit={l.maxComplaintRate} />
          </div>
        ) : (
          <span className={l.badHealth ? 'aw-mk-bad' : 'aw-muted'}>{l.healthText}</span>
        ),
    },
  ];

  return (
    <div>
      {narrow ? (
        <ul className="aw-mk-loops" aria-label="Autopilot loops">
          {loops.map((l, i) => {
            const active = selectedLoopId === l.id;
            return (
              <li key={l.id}>
                <button
                  ref={(el) => { if (el) rowRefs.current.set(i, el); else rowRefs.current.delete(i); }}
                  type="button"
                  className="aw-mk-loop"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onSelectLoop(l.id)}
                  onKeyDown={onCompactKey(i)}
                >
                  <span className="aw-mk-loop__name">{l.name}</span>
                  <StateIndicator state={l.indicator.state} tone={l.indicator.tone} label={l.indicator.label} live={l.indicator.live} />
                  <span className="aw-mk-loop__next">{l.next !== '—' ? l.next : l.healthText}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <DataTable
          label="Autopilot loops"
          columns={columns}
          rows={loops}
          rowKey={(l) => l.id}
          selected={selectedLoopId}
          onSelect={(l) => onSelectLoop(l.id)}
          onOpen={(l) => onSelectLoop(l.id)}
        />
      )}

      {kindEntries.length ? (
        narrow ? (
          <details className="ui-disclosure">
            <summary>
              Reader findings
              <span className="ui-disclosure__hint">{overview.observe?.observed ?? 0} read</span>
            </summary>
            <div className="ui-disclosure__body">
              <dl className="aw-mk-kinds">
                {kindEntries.map(([kind, value]) => (
                  <div className="aw-mk-kind" key={kind}>
                    <dd>{value}</dd>
                    <dt>{OBSERVE_KIND[kind] ?? humanize(kind)}</dt>
                  </div>
                ))}
              </dl>
            </div>
          </details>
        ) : (
          <div className="aw-mk-findings">
            <span className="aw-muted aw-mk-kinds-label">Reader findings:</span>
            <dl className="aw-mk-kinds">
              {kindEntries.map(([kind, value]) => (
                <div className="aw-mk-kind" key={kind}>
                  <dd>{value}</dd>
                  <dt>{OBSERVE_KIND[kind] ?? humanize(kind)}</dt>
                </div>
              ))}
            </dl>
          </div>
        )
      ) : null}
    </div>
  );
}

/** The handful of things only a person can do, each with a quiet button. */
function NeedsYou({ api, tick, overview, replies, onTab, onReview, onContact }) {
  const { settings, bound, senderState, postsAwaiting, pulse = {} } = overview;
  const review = useResource(
    () => (settings.reviewFirst ? api('GET', '/admin/marketing/review?limit=100') : null),
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
      ) : (!settings.reviewFirst || queue) && replies ? (
        <StateIndicator state="ok" label="All caught up" />
      ) : null}
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
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [days.length]);
  if (!days.length) return <EmptyState title="No outreach activity yet" />;
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
            const cxPos = padL + i * slot + slot / 2;
            const sentH = (d.sent / yMax) * plotH;
            const bounceH = Math.min(((d.bounce ?? 0) / yMax) * plotH, sentH);
            return (
              <g key={d.day}>
                <title>{`${shortDay(d.day, offset)}: ${d.sent} sent, ${d.reply} replies, ${d.bounce} bounces, ${d.opt_out} opt-outs, ${d.published ?? 0} posts`}</title>
                {d.sent ? <rect className="aw-chart__bar" x={cxPos - barW / 2} y={y(d.sent)} width={barW} height={sentH} rx={1.5} /> : null}
                {d.bounce && d.sent ? <rect className="aw-chart__bounce" x={cxPos - barW / 2} y={y(d.sent)} width={barW} height={bounceH} rx={1.5} /> : null}
                {d.reply ? <circle className="aw-chart__reply" cx={cxPos} cy={padT + 4} r={3} /> : null}
                {i % labelEvery === 0 ? (
                  <text className="aw-chart__day" x={cxPos} y={H - 8} textAnchor="middle">
                    {shortDay(d.day, offset)}
                  </text>
                ) : null}
                {d.published
                  ? Array.from({ length: Math.min(d.published, 3) }).map((_, j) => (
                      <rect key={j} className="aw-chart__post" x={cxPos - 5 + j * 4} y={baseY + 7} width={3} height={3} rx={1} />
                    ))
                  : null}
              </g>
            );
          })}
          <line className="aw-chart__axis" x1={padL} x2={w - padR} y1={baseY} y2={baseY} />
        </svg>
      </div>
      <ul className="ui-sr" aria-label="Daily marketing numbers">
        {days.map((d) => (
          <li key={d.day}>
            {`${shortDay(d.day, offset)}: ${d.sent} sent, ${d.reply} replies, ${d.bounce} bounces, ${d.opt_out} opt-outs, ${d.published ?? 0} posts`}
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** The cold A/B test: the control against the observation opener, honestly labelled. */
function ExperimentPanel({ overview, selectedKey, onSelectSequence, onTab }) {
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
    const leader = diff > 0 ? challenger.label : control.label;
    verdict =
      Math.abs(diff) < 0.0005
        ? 'Same reply rate so far.'
        : `${leader} leads: ${pct(Math.max(rate(challenger), rate(control)))} vs ${pct(Math.min(rate(challenger), rate(control)))} reply rate, ${percentNumber.format(Math.abs(diff) * 100)} pts apart.`;
  }

  const columns = [
    {
      key: 'label',
      header: 'Sequence',
      render: (s) => (
        <span className="aw-mk-cell-row">
          <span className="aw-mk-cell-title">{s.label}</span>
          {s.key === 'cold_a' ? <MetaChip>Control</MetaChip> : null}
          {s.key === 'cold_obs' ? <MetaChip>Challenger</MetaChip> : null}
        </span>
      ),
    },
    { key: 'sent', header: 'Sent', numeric: true, render: (s) => s.stats.sent },
    { key: 'replies', header: 'Replies', numeric: true, render: (s) => s.stats.replies },
    { key: 'rate', header: 'Reply rate', numeric: true, render: (s) => pct(rate(s)) },
    { key: 'optout', header: 'Opt-outs', numeric: true, render: (s) => s.stats.optedOut },
    { key: 'bounces', header: 'Bounces', numeric: true, render: (s) => s.stats.bounced },
  ];

  return (
    <Panel title="Experiment">
      <DataTable
        label="Experiment sequences"
        columns={columns}
        rows={rows}
        rowKey={(s) => s.key}
        selected={selectedKey}
        onSelect={(s) => onSelectSequence(s.key)}
        onOpen={(s) => onSelectSequence(s.key)}
      />
      <div className="aw-mk-exp-foot">
        <p className="aw-muted">{verdict}</p>
        <p className="aw-muted">
          {overview.settings.obsShare}% of observed contacts get the observation opener.{' '}
          <Button size="sm" kind="ghost" onClick={() => onTab('settings')}>
            Settings
          </Button>
        </p>
      </div>
    </Panel>
  );
}

function OverviewTab({
  api,
  tick,
  overview,
  inspector,
  setInspector,
  closeInspector,
  onTab,
  onToggleSending,
  onRunNow,
  onDraftPosts,
  onOptOut,
  onRefresh,
  notify,
  sendDisabled,
  sendDisabledReason,
}) {
  const stats = useResource(() => api('GET', '/admin/marketing/stats?days=14'), [api, tick]);
  const replies = useResource(() => api('GET', '/admin/marketing/replies').then((out) => out.replies ?? []), [api, tick]);
  const ordered = useMemo(
    () => [...(replies.data ?? [])].sort((a, b) => Number(b.kind === 'reply') - Number(a.kind === 'reply') || b.at - a.at),
    [replies.data],
  );

  const replyColumns = [
    {
      key: 'contact',
      header: 'Contact',
      render: (r) => (
        <>
          <strong>{r.contact.business ?? r.contact.email}</strong>
          {r.text ? <span className="aw-mk-cell-sub">{snippet(r.text, 140)}</span> : null}
        </>
      ),
    },
    { key: 'kind', header: 'Outcome', fit: true, render: (r) => <ReplyStatus kind={r.kind} /> },
    { key: 'age', header: 'When', fit: true, numeric: true, render: (r) => `${ago(r.at)} ago` },
  ];

  let inspectorPane = null;
  if (inspector?.kind === 'loop') {
    inspectorPane = (
      <LoopInspector
        id={inspector.id}
        overview={overview}
        onClose={closeInspector}
        onTab={onTab}
        onToggleSending={onToggleSending}
        onRunNow={onRunNow}
        onDraftPosts={onDraftPosts}
        sendDisabled={sendDisabled}
        sendDisabledReason={sendDisabledReason}
      />
    );
  } else if (inspector?.kind === 'contact') {
    inspectorPane = (
      <ContactInspector
        id={inspector.id}
        initialMode={inspector.mode}
        back={inspector.back}
        api={api}
        sequences={overview.sequences}
        onClose={closeInspector}
        onBack={inspector.back ? () => setInspector(inspector.back) : undefined}
        onOptOut={onOptOut}
        onOpenMessage={(id) => setInspector({ kind: 'message', id, back: { kind: 'contact', id: inspector.id } })}
        onSaved={(msg) => { notify(msg); onRefresh(); }}
      />
    );
  } else if (inspector?.kind === 'message') {
    inspectorPane = (
      <MessageInspector
        id={inspector.id}
        back={inspector.back}
        api={api}
        onClose={closeInspector}
        onBack={inspector.back ? () => setInspector(inspector.back) : undefined}
        onOpenContact={(id) => setInspector({ kind: 'contact', id, back: { kind: 'message', id: inspector.id } })}
        onDone={(msg) => { if (msg) notify(msg); onRefresh(); }}
      />
    );
  } else if (inspector?.kind === 'review') {
    inspectorPane = (
      <ReviewInspector
        api={api}
        onClose={(didAct) => {
          closeInspector();
          if (didAct) notify('Review saved.');
          onRefresh();
        }}
      />
    );
  } else if (inspector?.kind === 'sequence') {
    inspectorPane = (
      <SequenceInspector
        api={api}
        sequences={overview.sequences}
        sequenceKey={inspector.key}
        onClose={closeInspector}
      />
    );
  }

  return (
    <SplitPane inspector={inspectorPane} onClose={closeInspector}>
      <div className="aw-mk-overview">
        <Panel title="Autopilot">
          <AutopilotSection
            overview={overview}
            selectedLoopId={inspector?.kind === 'loop' ? inspector.id : null}
            onSelectLoop={(id) => setInspector({ kind: 'loop', id })}
          />
        </Panel>

        <NeedsYou
          api={api}
          tick={tick}
          overview={overview}
          replies={replies.data}
          onTab={onTab}
          onReview={() => setInspector({ kind: 'review' })}
          onContact={(id) => setInspector({ kind: 'contact', id })}
        />

        <ExperimentPanel
          overview={overview}
          selectedKey={inspector?.kind === 'sequence' ? inspector.key : null}
          onSelectSequence={(key) => setInspector({ kind: 'sequence', key })}
          onTab={onTab}
        />

        <Panel title="Last 14 days">
          <ResourceNote resource={stats} label="Loading outreach stats…" variant="text" lines={4} />
          {stats.data ? (
            stats.data.days?.length ? (
              <StatsChart stats={stats.data} />
            ) : (
              <EmptyState title="No outreach stats yet" hint="Daily send, reply, bounce and post activity appears here once sending begins." />
            )
          ) : null}
        </Panel>

        <Panel title="What came back" subtitle="Replies are forwarded to your inbox. Opt-outs and complaints are already closed.">
          <DataTable
            label="Replies and opt-outs"
            columns={replyColumns}
            rows={ordered}
            rowKey={(r) => r.id}
            state={replies.error ? 'error' : replies.loading && !replies.data ? 'loading' : 'ready'}
            error={replies.error}
            onRetry={replies.reload}
            selected={inspector?.kind === 'contact' ? ordered.find((r) => r.contact.id === inspector.id)?.id ?? null : null}
            onSelect={(r) => setInspector({ kind: 'contact', id: r.contact.id })}
            onOpen={(r) => setInspector({ kind: 'contact', id: r.contact.id })}
            menu={(r) => [{ label: 'Inspect contact', run: () => setInspector({ kind: 'contact', id: r.contact.id }) }]}
            empty={{
              title: 'No replies or opt-outs yet',
              hint: 'Incoming replies and unsubscribe notices appear here.',
            }}
          />
        </Panel>
      </div>
    </SplitPane>
  );
}

/* —— contacts (with folded sources filter & breakdown) —— */

function ContactsTab({
  api,
  tick,
  overview,
  people,
  contacts,
  paging,
  filters,
  filter,
  selectedBulk,
  setSelectedBulk,
  bulk,
  inspector,
  setInspector,
  closeInspector,
  onOptOut,
  onRefresh,
  notify,
  onAddContact,
  onImport,
}) {
  const { platform } = useAdmin();
  const searchRef = useRef(null);
  const sourcesRes = useResource(() => api('GET', '/admin/marketing/sources').then((out) => out.sources ?? []), [api, tick]);
  const sources = sourcesRes.data ?? [];

  useEffect(() => {
    if (platform !== 'web') return undefined;
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [platform]);

  const activeContactId = inspector?.kind === 'contact' ? inspector.id : null;
  const onSurvive = useCallback(
    (fallback) => setInspector(fallback ? { kind: 'contact', id: fallback.id } : null),
    [setInspector],
  );
  const resolvedContact = useSurvivedSelection(activeContactId, contacts, (c) => c.id, people.loading, onSurvive);

  const hasFilters = Boolean(filters.q || filters.status || filters.source);
  const sourceRate = (n, d) => (d ? pct(n / d) : '—');
  const sourceOptions = useMemo(() => {
    const names = new Set(sources.map((s) => s.source));
    const list = sources.map((s) => ({ value: s.source, label: `${s.source} (${s.contacts.toLocaleString('en-US')})` }));
    if (filters.source && !names.has(filters.source)) list.unshift({ value: filters.source, label: filters.source });
    return list;
  }, [sources, filters.source]);

  const contactColumns = [
    {
      key: 'contact',
      header: (
        <span className="aw-mk-cell-row">
          <input
            type="checkbox"
            aria-label="Select this page"
            checked={contacts.length > 0 && contacts.every((c) => selectedBulk.has(c.id))}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setSelectedBulk(e.target.checked ? new Set(contacts.map((c) => c.id)) : new Set())}
          />
          <span>Contact</span>
        </span>
      ),
      label: 'Contact',
      render: (c) => (
        <>
          <span className="aw-mk-cell-row">
            <input
              type="checkbox"
              aria-label={`Select ${c.email}`}
              checked={selectedBulk.has(c.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                setSelectedBulk((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(c.id);
                  else next.delete(c.id);
                  return next;
                })
              }
            />
            <span className="aw-mono aw-mk-cell-title">{c.email}</span>
            {c.name ? <span className="aw-muted"> {c.name}</span> : null}
          </span>
          {c.gap ? <span className="aw-mk-cell-sub">{snippet(c.gap, 110)}</span> : null}
        </>
      ),
    },
    {
      key: 'business',
      header: 'Business / site',
      render: (c) => (
        <>
          <span>{c.business ?? '—'}</span>
          {c.site ? <span className="aw-mk-cell-sub">{c.site}</span> : null}
        </>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      fit: true,
      render: (c) => (
        <span className="aw-mk-chips">
          {c.sourceKind ? <MetaChip>{c.sourceKind}</MetaChip> : <span className="aw-muted">—</span>}
          {c.country ? <MetaChip>{c.country}</MetaChip> : null}
        </span>
      ),
    },
    { key: 'status', header: 'Status', fit: true, render: (c) => <ContactStatus status={c.status} /> },
    { key: 'sent', header: 'Sent', numeric: true, render: (c) => c.sentCount },
    { key: 'next', header: 'Next', fit: true, render: (c) => <span className="aw-muted">{c.nextAt ? when(c.nextAt) : '—'}</span> },
  ];

  const sourceColumns = [
    { key: 'source', header: 'Source', mono: true, render: (s) => s.source },
    { key: 'contacts', header: 'Contacts', numeric: true, render: (s) => s.contacts },
    { key: 'queued', header: 'Queued', numeric: true, render: (s) => s.queued },
    { key: 'reached', header: 'Reached', numeric: true, render: (s) => s.reached },
    {
      key: 'replied',
      header: 'Replied',
      numeric: true,
      render: (s) => (
        <>
          {s.replied} <span className="aw-muted">{sourceRate(s.replied, s.reached)}</span>
        </>
      ),
    },
    {
      key: 'bounced',
      header: 'Bounced',
      numeric: true,
      render: (s) => (
        <>
          {s.bounced}{' '}
          <span className={s.reached && s.bounced / s.reached > 0.04 ? 'aw-mk-bad' : 'aw-muted'}>
            {sourceRate(s.bounced, s.reached)}
          </span>
        </>
      ),
    },
    {
      key: 'optedOut',
      header: 'Opted out',
      numeric: true,
      render: (s) => (
        <>
          {s.optedOut} <span className="aw-muted">{sourceRate(s.optedOut, s.reached)}</span>
        </>
      ),
    },
    {
      key: 'complaints',
      header: 'Complaints',
      numeric: true,
      render: (s) => (
        <>
          {s.complaints}{' '}
          <span className={s.complaints ? 'aw-mk-bad' : 'aw-muted'}>{sourceRate(s.complaints, s.reached)}</span>
        </>
      ),
    },
  ];

  let inspectorPane = null;
  if (inspector?.kind === 'contact' && resolvedContact) {
    inspectorPane = (
      <ContactInspector
        id={resolvedContact.id}
        initialMode={inspector.id === resolvedContact.id ? inspector.mode : undefined}
        api={api}
        sequences={overview.sequences}
        onClose={closeInspector}
        onOptOut={onOptOut}
        onOpenMessage={(id) => setInspector({ kind: 'message', id, back: { kind: 'contact', id: resolvedContact.id } })}
        onSaved={(msg) => { notify(msg); onRefresh(); }}
      />
    );
  } else if (inspector?.kind === 'message') {
    inspectorPane = (
      <MessageInspector
        id={inspector.id}
        back={inspector.back}
        api={api}
        onClose={closeInspector}
        onBack={inspector.back ? () => setInspector(inspector.back) : undefined}
        onOpenContact={(id) => setInspector({ kind: 'contact', id })}
        onDone={(msg) => { if (msg) notify(msg); onRefresh(); }}
      />
    );
  }

  return (
    <SplitPane inspector={inspectorPane} onClose={closeInspector}>
      <div className="aw-mk-bar" role="region" aria-label="Contact filters">
        <input
          ref={searchRef}
          className="aw-search"
          type="search"
          value={filters.q}
          aria-label="Search contacts"
          aria-keyshortcuts={platform === 'web' ? '/' : undefined}
          placeholder="Search email, name, business…"
          onChange={(e) => filter({ q: e.target.value })}
        />
        <select value={filters.status} aria-label="Filter by status" onChange={(e) => filter({ status: e.target.value })}>
          <option value="">Every status</option>
          {CONTACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CONTACT_STATE[s]?.label ?? humanize(s)}
            </option>
          ))}
        </select>
        <select value={filters.source} aria-label="Filter by source" onChange={(e) => filter({ source: e.target.value })}>
          <option value="">Every source</option>
          {sourceOptions.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {hasFilters ? (
          <Button size="sm" kind="ghost" onClick={() => filter({ q: '', status: '', source: '' })}>
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="aw-mk-bar">
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
        <span className="aw-mk-spacer" />
        {selectedBulk.size ? (
          <>
            <span>{plural(selectedBulk.size, 'contact selected', 'contacts selected')}</span>
            <Button size="sm" onClick={() => bulk('pause')}>Pause</Button>
            <Button size="sm" onClick={() => bulk('opt_out')}>Opt out</Button>
            <Button size="sm" kind="ghost" onClick={() => setSelectedBulk(new Set())}>Clear</Button>
          </>
        ) : null}
      </div>

      <DataTable
        label="Contacts"
        columns={contactColumns}
        rows={contacts}
        rowKey={(c) => c.id}
        state={people.error ? 'error' : people.loading && !people.data ? 'loading' : 'ready'}
        error={people.error}
        onRetry={people.reload}
        selected={resolvedContact?.id ?? null}
        onSelect={(c) => setInspector({ kind: 'contact', id: c.id })}
        onOpen={(c) => setInspector({ kind: 'contact', id: c.id })}
        menu={(c) => [
          { label: 'Inspect contact', run: () => setInspector({ kind: 'contact', id: c.id }) },
          ['new', 'paused', 'contacted'].includes(c.status) && !c.nextAt
            ? { label: 'Queue sequence', run: () => setInspector({ kind: 'contact', id: c.id, mode: 'queue' }) }
            : null,
          { label: 'Edit contact', run: () => setInspector({ kind: 'contact', id: c.id, mode: 'edit' }) },
          c.status !== 'opted_out' ? { separator: true } : null,
          c.status !== 'opted_out' ? { label: 'Opt out', danger: true, run: () => void onOptOut(c).catch(() => undefined) } : null,
        ]}
        empty={{
          title: hasFilters ? 'No contacts match these filters.' : 'No contacts yet.',
          hint: hasFilters ? 'Clear the filters or pick another source.' : 'Import a CSV or add a contact by hand.',
          action: hasFilters ? (
            <Button onClick={() => filter({ q: '', status: '', source: '' })}>Clear filters</Button>
          ) : (
            <div className="aw-inline">
              <Button onClick={onImport}>Import CSV</Button>
              <Button onClick={onAddContact}>Add contact</Button>
            </div>
          ),
        }}
      />

      <details className="ui-disclosure">
        <summary>
          Source health breakdown
          <span className="ui-disclosure__hint">
            {sources.length ? plural(sources.length, 'source', 'sources') : sourcesRes.loading ? 'Loading…' : 'None'}
          </span>
        </summary>
        <div className="ui-disclosure__body">
          <p className="aw-muted aw-mk-no-top">
            A source is the label given at import (the file name by default). Rates are per contact reached. A source whose bounces pass 4%
            will pause the whole desk, so drop or verify it first. Click any source to filter Contacts.
          </p>
          <DataTable
            label="Contact sources"
            columns={sourceColumns}
            rows={sources}
            rowKey={(s) => s.source}
            state={sourcesRes.error ? 'error' : sourcesRes.loading && !sourcesRes.data ? 'loading' : 'ready'}
            error={sourcesRes.error}
            onRetry={sourcesRes.reload}
            selected={filters.source || null}
            onSelect={(s) => filter({ source: filters.source === s.source ? '' : s.source })}
            onOpen={(s) => filter({ source: s.source })}
            empty={{ title: 'No contact sources yet' }}
          />
        </div>
      </details>
    </SplitPane>
  );
}

/* —— email: the send queue, in send order —— */

function EmailTab({
  api,
  run,
  tick,
  events,
  sequences,
  inspector,
  setInspector,
  closeInspector,
  onOptOut,
  onRefresh,
  notify,
}) {
  const [order, setOrder] = useState('next');
  const [status, setStatus] = useState('scheduled');
  const [showDmarc, setShowDmarc] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const visibleEvents = useMemo(() => events.filter((e) => showDmarc || e.kind !== 'dmarc_report'), [events, showDmarc]);
  const resource = useResource(() => {
    const search = new URLSearchParams({ channel: 'email', ...(status ? { status } : {}), ...(order === 'next' ? { order: 'next' } : {}) });
    return api('GET', `/admin/marketing/messages?${search}`).then((out) => out.messages ?? []);
  }, [api, order, status, tick]);
  const messages = resource.data ?? [];

  const activeMessageId = inspector?.kind === 'message' && !inspector.back ? inspector.id : null;
  const onSurvive = useCallback(
    (fallback) => setInspector(fallback ? { kind: 'message', id: fallback.id } : null),
    [setInspector],
  );
  const resolvedMessage = useSurvivedSelection(activeMessageId, messages, (m) => m.id, resource.loading, onSurvive);

  const columns = [
    {
      key: 'email',
      header: 'Email',
      render: (m) => (
        <>
          <span className="aw-mk-cell-row">
            <span className="aw-mk-cell-title">{m.subject ?? '(no subject)'}</span>
            {m.editedAt ? <MetaChip>Edited</MetaChip> : m.reviewedAt ? <MetaChip>Reviewed</MetaChip> : null}
            <MetaChip>Step {(m.step ?? 0) + 1}</MetaChip>
          </span>
          <span className="aw-mk-cell-sub">{snippet((m.body ?? '').replace(/\s+/g, ' '), 120)}</span>
          {m.error ? <span className="aw-mk-cell-err">{m.error}</span> : null}
        </>
      ),
    },
    { key: 'to', header: 'To', mono: true, render: (m) => m.contactEmail ?? '—' },
    { key: 'status', header: 'Status', fit: true, render: (m) => <MessageStatus status={m.status} /> },
    {
      key: 'when',
      header: 'When',
      fit: true,
      render: (m) => <span className="aw-muted">{m.sentAt ? `${ago(m.sentAt)} ago` : m.scheduledAt ? when(m.scheduledAt) : 'Draft'}</span>,
    },
  ];

  let inspectorPane = null;
  if (inspector?.kind === 'review') {
    inspectorPane = (
      <ReviewInspector
        api={api}
        onClose={(didAct) => {
          closeInspector();
          if (didAct) notify('Review saved.');
          onRefresh();
        }}
      />
    );
  } else if (inspector?.kind === 'contact') {
    inspectorPane = (
      <ContactInspector
        id={inspector.id}
        back={inspector.back}
        api={api}
        sequences={sequences}
        onClose={closeInspector}
        onBack={inspector.back ? () => setInspector(inspector.back) : undefined}
        onOptOut={onOptOut}
        onOpenMessage={(id) => setInspector({ kind: 'message', id, back: { kind: 'contact', id: inspector.id } })}
        onSaved={(msg) => { notify(msg); onRefresh(); }}
      />
    );
  } else if (inspector?.kind === 'message') {
    const id = inspector.back ? inspector.id : resolvedMessage?.id;
    if (id != null) {
      inspectorPane = (
        <MessageInspector
          id={id}
          initialMode={inspector.id === id ? inspector.mode : undefined}
          back={inspector.back}
          api={api}
          onClose={closeInspector}
          onBack={inspector.back ? () => setInspector(inspector.back) : undefined}
          onOpenContact={(contactId) => setInspector({ kind: 'contact', id: contactId, back: { kind: 'message', id } })}
          onDone={(msg) => { if (msg) notify(msg); onRefresh(); }}
        />
      );
    }
  }

  return (
    <SplitPane inspector={inspectorPane} onClose={closeInspector}>
      <div className="aw-mk-bar" role="region" aria-label="Email filters">
        <Segmented
          label="Email order"
          value={order}
          options={[
            { value: 'next', label: 'Next to send' },
            { value: 'recent', label: 'Latest first' },
          ]}
          onChange={setOrder}
        />
        <select value={status} aria-label="Filter email by status" onChange={(e) => setStatus(e.target.value)}>
          <option value="">Every status</option>
          {MESSAGE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {messageState(s).label}
            </option>
          ))}
        </select>
      </div>

      <DataTable
        label="Email queue"
        columns={columns}
        rows={messages}
        rowKey={(m) => m.id}
        state={resource.error ? 'error' : resource.loading && !resource.data ? 'loading' : 'ready'}
        error={resource.error}
        onRetry={resource.reload}
        selected={resolvedMessage?.id ?? null}
        onSelect={(m) => setInspector({ kind: 'message', id: m.id })}
        onOpen={(m) => setInspector({ kind: 'message', id: m.id })}
        menu={(m) => {
          const editable = ['draft', 'scheduled', 'failed'].includes(m.status);
          return [
            { label: 'Inspect email', run: () => setInspector({ kind: 'message', id: m.id }) },
            editable ? { label: 'Rewrite', run: () => setInspector({ kind: 'message', id: m.id, mode: 'edit' }) } : null,
            {
              label: 'Send me a test',
              run: () => run(() => api('POST', `/admin/marketing/messages/${m.id}/test`), (out) => `Test sent to ${out.to} via ${out.provider}.`),
            },
            editable ? { label: 'Send now', run: () => run(() => api('POST', `/admin/marketing/messages/${m.id}/send`), 'Sent.') } : null,
            editable ? { separator: true } : null,
            editable ? { label: 'Cancel email', danger: true, run: () => run(() => api('POST', `/admin/marketing/messages/${m.id}/cancel`), 'Cancelled.') } : null,
          ];
        }}
        empty={{
          title: 'No email matches these filters',
          hint: status ? 'Switch status to Every status to see sent and cancelled emails.' : undefined,
          action: status ? <Button onClick={() => setStatus('')}>Show every status</Button> : undefined,
        }}
      />
      {messages.length === 200 ? <p className="aw-muted">The first 200 are shown.</p> : null}

      <details className="ui-disclosure">
        <summary>
          Recent events
          <span className="ui-disclosure__hint">{plural(visibleEvents.length, 'event', 'events')}</span>
        </summary>
        <div className="ui-disclosure__body">
          <div className="aw-mk-bar">
            {visibleEvents.length > 10 ? (
              <Button size="sm" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show less' : `Show all (${visibleEvents.length})`}
              </Button>
            ) : null}
            <Button size="sm" kind="ghost" onClick={() => setShowDmarc((v) => !v)}>
              {showDmarc ? 'Hide DMARC reports' : 'Show DMARC reports'}
            </Button>
          </div>
          {visibleEvents.length ? (
            <ul className="aw-mk-inspector-list">
              {visibleEvents.slice(0, showAll ? undefined : 10).map((e) => (
                <li key={e.id} className="aw-mk-inspector-item">
                  <div className="aw-mk-inspector-row">
                    <EventStatus kind={e.kind} />
                    <span className="aw-mono aw-mk-cell-title">{e.email ?? '—'}</span>
                    <span className="aw-muted">{ago(e.createdAt)} ago</span>
                  </div>
                  {e.detail ? <span className="aw-muted">{snippet(e.detail, 140)}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No recent events" inline />
          )}
        </div>
      </details>
    </SplitPane>
  );
}

/* —— posts: the audit, before and after they go out —— */

const POST_ORDER = { draft: 0, failed: 1, sending: 2, scheduled: 3, sent: 4, cancelled: 5 };

function PostsTab({
  api,
  run,
  mutate,
  ask,
  tick,
  holdHours = 0,
  inspector,
  setInspector,
  closeInspector,
  onRefresh,
  notify,
}) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('');
  const resource = useResource(
    () =>
      Promise.all(['x', 'linkedin'].map((channel) => api('GET', `/admin/marketing/messages?channel=${channel}`)))
        .then((lists) => lists.flatMap((out) => out.messages ?? [])),
    [api, tick],
  );

  const allPosts = useMemo(() => {
    const raw = resource.data ?? [];
    const at = (m) => m.scheduledAt ?? m.createdAt ?? 0;
    return [...raw].sort((a, b) => {
      const rank = (POST_ORDER[a.status] ?? 9) - (POST_ORDER[b.status] ?? 9);
      if (rank !== 0) return rank;
      if (a.status === 'sent') return (b.sentAt ?? 0) - (a.sentAt ?? 0);
      return at(a) - at(b);
    });
  }, [resource.data]);

  const rows = useMemo(
    () =>
      allPosts.filter((m) => {
        if (channelFilter && m.channel !== channelFilter) return false;
        if (statusFilter === 'all') return true;
        if (statusFilter === 'scheduled') return m.status === 'scheduled' || m.status === 'sending';
        return m.status === statusFilter;
      }),
    [allPosts, statusFilter, channelFilter],
  );

  const activePostId = inspector?.kind === 'post' ? inspector.id : null;
  const onSurvive = useCallback(
    (fallback) => setInspector(fallback ? { kind: 'post', id: fallback.id } : null),
    [setInspector],
  );
  const resolvedPost = useSurvivedSelection(activePostId, rows, (m) => m.id, resource.loading, onSurvive);

  const approvePost = (m) => run(() => api('POST', `/admin/marketing/messages/${m.id}/approve`), 'Approved: it goes out in its slot.');
  const retryPost = (m) => run(() => api('POST', `/admin/marketing/messages/${m.id}/retry`), 'Queued again.');
  const postNow = (m) =>
    ask({
      title: `Post publicly on ${postChannelLabel[m.channel] ?? m.channel} now?`,
      text: 'The publisher can post this as soon as it next checks the queue.',
      confirm: 'Post now',
      danger: true,
      run: () => mutate(() => api('POST', `/admin/marketing/messages/${m.id}/send`), 'Due now: the publisher posts it within 15 minutes.'),
    });
  const cancelPost = (m) =>
    ask({
      title: m.status === 'draft' ? 'Reject this draft?' : 'Cancel this post?',
      text: 'This removes it from the publishing queue.',
      confirm: m.status === 'draft' ? 'Reject' : 'Cancel post',
      danger: true,
      run: () => mutate(() => api('POST', `/admin/marketing/messages/${m.id}/cancel`), m.status === 'draft' ? 'Draft rejected.' : 'Post cancelled.'),
    });

  const columns = [
    {
      key: 'body',
      header: 'Post',
      render: (m) => (
        <>
          <span className="aw-mk-cell-row">
            <span className="aw-mk-cell-title">{snippet((m.body ?? '').replace(/\s+/g, ' '), 110)}</span>
            {m.kind === 'auto' ? <MetaChip>Cycle</MetaChip> : null}
          </span>
          {m.error ? <span className="aw-mk-cell-err">{m.error}</span> : null}
        </>
      ),
    },
    {
      key: 'channel',
      header: 'Channel',
      fit: true,
      render: (m) => <MetaChip>{postChannelLabel[m.channel] ?? m.channel}</MetaChip>,
    },
    { key: 'status', header: 'Status', fit: true, render: (m) => <MessageStatus status={m.status} isPost /> },
    {
      key: 'length',
      header: 'Chars',
      numeric: true,
      render: (m) => `${postLength(m.body, m.channel)}/${POST_MAX[m.channel] ?? 3000}`,
    },
    {
      key: 'when',
      header: 'When',
      fit: true,
      render: (m) => (
        <span className="aw-muted">
          {m.sentAt ? `${ago(m.sentAt)} ago` : m.scheduledAt ? when(m.scheduledAt) : 'No slot'}
        </span>
      ),
    },
  ];

  const inspectorPane =
    inspector?.kind === 'post' && resolvedPost ? (
      <PostInspector
        key={resolvedPost.id}
        post={resolvedPost}
        initialMode={inspector.id === resolvedPost.id ? inspector.mode : undefined}
        api={api}
        holdHours={holdHours}
        onClose={closeInspector}
        onApprove={() => approvePost(resolvedPost)}
        onRetry={() => retryPost(resolvedPost)}
        onPostNow={() => postNow(resolvedPost)}
        onCancel={() => cancelPost(resolvedPost)}
        onSaved={() => { notify('Post saved.'); onRefresh(); }}
      />
    ) : null;

  return (
    <SplitPane inspector={inspectorPane} onClose={closeInspector}>
      <div className="aw-mk-bar" role="region" aria-label="Post filters">
        <Segmented
          label="Post status"
          value={statusFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'draft', label: 'To approve' },
            { value: 'scheduled', label: 'Scheduled' },
            { value: 'failed', label: 'Failed' },
            { value: 'sent', label: 'Published' },
          ]}
          onChange={setStatusFilter}
        />
        <Segmented
          label="Post channel"
          value={channelFilter}
          options={[
            { value: '', label: 'All channels' },
            { value: 'x', label: 'X' },
            { value: 'linkedin', label: 'LinkedIn' },
          ]}
          onChange={setChannelFilter}
        />
      </div>

      <DataTable
        label="Posts"
        columns={columns}
        rows={rows}
        rowKey={(m) => m.id}
        state={resource.error ? 'error' : resource.loading && !resource.data ? 'loading' : 'ready'}
        error={resource.error}
        onRetry={resource.reload}
        selected={resolvedPost?.id ?? null}
        onSelect={(m) => setInspector({ kind: 'post', id: m.id })}
        onOpen={(m) => setInspector({ kind: 'post', id: m.id })}
        menu={(m) => {
          const open = ['draft', 'scheduled', 'failed'].includes(m.status);
          return [
            { label: 'Inspect post', run: () => setInspector({ kind: 'post', id: m.id }) },
            m.status === 'draft' ? { label: 'Approve', run: () => approvePost(m) } : null,
            m.status === 'failed' ? { label: 'Retry', run: () => retryPost(m) } : null,
            open ? { label: 'Edit post', run: () => setInspector({ kind: 'post', id: m.id, mode: 'edit' }) } : null,
            open ? { label: 'Post now', run: () => postNow(m) } : null,
            open ? { separator: true } : null,
            open ? { label: m.status === 'draft' ? 'Reject draft' : 'Cancel post', danger: true, run: () => cancelPost(m) } : null,
            m.url ? { label: 'Open published post', run: () => window.open(m.url, '_blank', 'noopener,noreferrer') } : null,
          ];
        }}
        empty={{
          title: allPosts.length ? 'No posts match these filters' : 'No posts to review, schedule or track',
          action:
            statusFilter !== 'all' || channelFilter ? (
              <Button onClick={() => { setStatusFilter('all'); setChannelFilter(''); }}>Clear filters</Button>
            ) : undefined,
        }}
      />
    </SplitPane>
  );
}

/* —— sequences: performance table + live sample preview in the Inspector —— */

function SequencesTab({ api, sequences, inspector, setInspector, closeInspector }) {
  const activeKey = inspector?.kind === 'sequence' ? inspector.key : null;
  const onSurvive = useCallback(
    (fallback) => setInspector(fallback ? { kind: 'sequence', key: fallback.key } : null),
    [setInspector],
  );
  const resolved = useSurvivedSelection(activeKey, sequences, (s) => s.key, false, onSurvive);
  const replyRate = (s) => (s.sent ? pct(s.replies / s.sent) : '—');

  const columns = [
    {
      key: 'label',
      header: 'Sequence',
      render: (s) => (
        <>
          <span className="aw-mk-cell-row">
            <span className="aw-mk-cell-title">{s.label}</span>
            {s.key === 'cold_a' ? <MetaChip>Control</MetaChip> : null}
            {s.key === 'cold_obs' ? <MetaChip>Challenger</MetaChip> : null}
          </span>
          {s.needsGap ? <span className="aw-mk-cell-sub">Needs a site observation</span> : null}
        </>
      ),
    },
    { key: 'sent', header: 'Sent', numeric: true, render: (s) => s.stats.sent || '·' },
    { key: 'replies', header: 'Replies', numeric: true, render: (s) => s.stats.replies || '·' },
    { key: 'rate', header: 'Reply rate', numeric: true, render: (s) => replyRate(s.stats) },
    {
      key: 'optedOut',
      header: 'Opt-outs',
      numeric: true,
      render: (s) => <span className={s.stats.optedOut ? 'aw-warn' : undefined}>{s.stats.optedOut || '·'}</span>,
    },
    {
      key: 'bounced',
      header: 'Bounces',
      numeric: true,
      render: (s) => <span className={s.stats.bounced ? 'aw-warn' : undefined}>{s.stats.bounced || '·'}</span>,
    },
  ];

  const inspectorPane =
    inspector?.kind === 'sequence' && resolved ? (
      <SequenceInspector api={api} sequences={sequences} sequenceKey={resolved.key} onClose={closeInspector} />
    ) : null;

  return (
    <SplitPane inspector={inspectorPane} onClose={closeInspector}>
      <Panel title="How each sequence is doing" subtitle="Sent, replies and outcomes per sequence, counted on the contact's latest send. Select a sequence to preview its filled-in emails.">
        <DataTable
          label="Sequences"
          columns={columns}
          rows={sequences}
          rowKey={(s) => s.key}
          selected={resolved?.key ?? null}
          onSelect={(s) => setInspector({ kind: 'sequence', key: s.key })}
          onOpen={(s) => setInspector({ kind: 'sequence', key: s.key })}
          menu={(s) => [{ label: 'Preview sequence', run: () => setInspector({ kind: 'sequence', key: s.key }) }]}
          empty={{ title: 'No sequences configured' }}
        />
      </Panel>
      <p className="aw-muted">
        The wording lives in <span className="aw-mono">SEQUENCES</span> in <span className="aw-mono">worker/src/marketing.ts</span>; the desk
        re-renders the queue by itself when it changes. To change it for one person, open their email in the Email tab and rewrite it there.
      </p>
    </SplitPane>
  );
}

/* —— right Inspectors (replacing PersonModal, QueueModal, MessageModal, ReviewModal, EditPostModal) —— */

function LoopInspector({ id, overview, onClose, onTab, onToggleSending, onRunNow, onDraftPosts, sendDisabled, sendDisabledReason }) {
  const loops = useMemo(() => buildLoops(overview), [overview]);
  const loop = loops.find((l) => l.id === id) ?? loops[0];
  const kindEntries = Object.entries(overview.observe?.byKind ?? {}).sort((a, b) => b[1] - a[1]);
  const { settings, health } = overview;

  return (
    <Inspector title={loop.name} label={`${loop.name} loop`} storageKey="ptech.marketing.inspector.w" onClose={onClose}>
      <StateIndicator state={loop.indicator.state} tone={loop.indicator.tone} label={loop.indicator.label} live={loop.indicator.live} />

      <div className="ui-actions">
        {loop.id === 'email' ? (
          <>
            <Button
              kind="primary"
              disabled={sendDisabled}
              disabledReason={sendDisabledReason}
              onClick={onToggleSending}
            >
              {settings.live ? 'Pause sending' : 'Go live'}
            </Button>
            <Button onClick={onRunNow}>Run now</Button>
            <Button kind="ghost" onClick={() => onTab('settings')}>Marketing settings</Button>
          </>
        ) : loop.id === 'posts' ? (
          <>
            <Button kind="primary" onClick={() => onTab('posts')}>Open Posts</Button>
            <Button onClick={onDraftPosts}>Draft posts</Button>
          </>
        ) : (
          <Button kind="primary" onClick={() => onTab('contacts')}>Open Contacts</Button>
        )}
      </div>

      <dl className="ui-props">
        <dt>Last</dt>
        <dd>{loop.last}</dd>
        <dt>Next</dt>
        <dd>{loop.next}</dd>
        <dt>Health</dt>
        <dd className={loop.badHealth ? 'aw-mk-bad' : undefined}>{loop.healthText}</dd>
      </dl>

      {loop.id === 'email' ? (
        <div className="ui-section">
          <h3 className="ui-section__title">Deliverability limits (14 days)</h3>
          <div className="aw-mk-health">
            <RateMeter label="bounces" rate={health?.bounceRate ?? 0} limit={health?.maxBounceRate ?? 0.04} />
            <RateMeter label="complaints" rate={health?.complaintRate ?? 0} limit={health?.maxComplaintRate ?? 0.002} />
          </div>
        </div>
      ) : null}

      {loop.id === 'observe' && kindEntries.length ? (
        <div className="ui-section">
          <h3 className="ui-section__title">Reader findings</h3>
          <dl className="ui-props">
            {kindEntries.map(([kind, value]) => (
              <Fragment key={kind}>
                <dt>{OBSERVE_KIND[kind] ?? humanize(kind)}</dt>
                <dd className="aw-mono">{value}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      ) : null}
    </Inspector>
  );
}

/** Contact Inspector: replaces PersonModal, QueueModal, and edit-mode ContactModal. */
function ContactInspector({ id, initialMode, back, api, sequences, onClose, onBack, onOptOut, onOpenMessage, onSaved }) {
  const settledId = useSettled(id, 160);
  const resource = useResource(
    () => (settledId != null ? api('GET', `/admin/marketing/contacts/${settledId}`) : null),
    [api, settledId],
  );
  const data = resource.data;
  const c = data?.contact ?? null;

  const [mode, setMode] = useState(initialMode ?? 'view');
  const [showDmarc, setShowDmarc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Edit form state
  const [editForm, setEditForm] = useState(null);
  // Queue form state
  const [queueSeq, setQueueSeq] = useState(sequences[0]?.key ?? 'cold_a');
  const [genericGap, setGenericGap] = useState(false);

  useEffect(() => {
    setMode(initialMode ?? 'view');
    setError(null);
    setEditForm(null);
  }, [id, initialMode]);

  useEffect(() => {
    if (mode === 'edit' && c && !editForm) {
      setEditForm({
        name: c.name ?? '',
        business: c.business ?? '',
        site: c.site ?? '',
        gap: c.gap ?? '',
        notes: c.notes ?? '',
      });
    }
  }, [mode, c, editForm]);

  const startEdit = () => {
    if (!c) return;
    setEditForm({
      name: c.name ?? '',
      business: c.business ?? '',
      site: c.site ?? '',
      gap: c.gap ?? '',
      notes: c.notes ?? '',
    });
    setError(null);
    setMode('edit');
  };
  const startQueue = () => {
    setQueueSeq(sequences[0]?.key ?? 'cold_a');
    setGenericGap(false);
    setError(null);
    setMode('queue');
  };

  const optOut = async () => {
    if (!c) return;
    setBusy(true);
    setError(null);
    try {
      await onOptOut(c);
      resource.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!c || !editForm) return;
    setBusy(true);
    setError(null);
    try {
      const patch = Object.fromEntries(Object.entries(editForm).filter(([key, value]) => value !== (c[key] ?? '')));
      await api('PATCH', `/admin/marketing/contacts/${c.id}`, patch);
      setMode('view');
      setEditForm(null);
      resource.reload();
      onSaved(`${c.email} saved.`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const submitQueue = async () => {
    if (!c) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api('POST', `/admin/marketing/contacts/${c.id}/queue`, { sequence: queueSeq, genericGap });
      setMode('view');
      resource.reload();
      onSaved(`${out.queued} emails queued for ${c.email}.`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const onFormKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setMode('view');
      setError(null);
    }
  };

  const canQueue = Boolean(c && ['new', 'paused', 'contacted'].includes(c.status) && !c.nextAt);
  const chosenSeq = sequences.find((s) => s.key === queueSeq);
  const visibleEvents = (data?.events ?? []).filter((e) => showDmarc || e.kind !== 'dmarc_report');

  return (
    <Inspector
      title={c?.email ?? 'Contact'}
      label={c ? `Contact ${c.email}` : 'Contact'}
      storageKey="ptech.marketing.inspector.w"
      actions={back && onBack ? <Button size="sm" kind="ghost" onClick={onBack}>Back</Button> : null}
      onClose={onClose}
    >
      {error ? <ErrorNote error={error} /> : null}
      {settledId !== id || (resource.loading && !c) ? (
        <Skeleton label="Loading contact…" variant="text" lines={5} />
      ) : !c ? (
        <ResourceNote resource={resource} label="Loading contact…" empty="No contact found" />
      ) : mode === 'edit' && editForm ? (
        <div className="aw-mk-field-stack" onKeyDown={onFormKey}>
          <p className="ui-note">The gap is what the cold email opens with; leave it blank and the sequence will not queue.</p>
          <Field label="Name">
            <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Business">
            <input value={editForm.business} onChange={(e) => setEditForm((f) => ({ ...f, business: e.target.value }))} />
          </Field>
          <Field label="Site">
            <input value={editForm.site} onChange={(e) => setEditForm((f) => ({ ...f, site: e.target.value }))} />
          </Field>
          <Field label="The gap" hint="One specific, true observation. If it is not true, the whole email is spam.">
            <textarea rows={3} value={editForm.gap} onChange={(e) => setEditForm((f) => ({ ...f, gap: e.target.value }))} />
          </Field>
          <Field label="Notes">
            <textarea rows={2} value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
          <div className="ui-actions">
            <Button kind="primary" busy={busy} onClick={saveEdit}>Save contact</Button>
            <Button disabled={busy} onClick={() => setMode('view')}>Cancel</Button>
          </div>
        </div>
      ) : mode === 'queue' ? (
        <div className="aw-mk-field-stack" onKeyDown={onFormKey}>
          <p className="ui-note">Three emails, days 0, 4 and 10. A reply or “no” cancels the rest.</p>
          <Field label="Sequence">
            <select value={queueSeq} onChange={(e) => setQueueSeq(e.target.value)}>
              {sequences.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          {chosenSeq?.needsGap && !c.gap ? (
            <Field label="No observation on this contact" hint="A cold email without one is usually spam.">
              <label className="aw-inline">
                <input type="checkbox" checked={genericGap} onChange={(e) => setGenericGap(e.target.checked)} />
                Queue with a general opener
              </label>
            </Field>
          ) : null}
          <div className="ui-actions">
            <Button kind="primary" busy={busy} onClick={submitQueue}>Queue</Button>
            <Button disabled={busy} onClick={() => setMode('view')}>Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="aw-mk-chips">
            <ContactStatus status={c.status} />
            {c.sourceKind ? <MetaChip>{c.sourceKind}</MetaChip> : null}
            {c.country ? <MetaChip>{c.country}</MetaChip> : null}
            <MetaChip>Added {ago(c.createdAt)} ago</MetaChip>
          </div>

          <div className="ui-actions">
            {canQueue ? (
              <Button kind="primary" disabled={busy} onClick={startQueue}>Queue</Button>
            ) : null}
            <Button kind={canQueue ? 'default' : 'primary'} disabled={busy} onClick={startEdit}>
              Edit contact
            </Button>
            {c.status !== 'opted_out' ? (
              <Button kind="ghost" disabled={busy} onClick={optOut}>Opt out</Button>
            ) : null}
          </div>

          <dl className="ui-props">
            {c.name ? (<><dt>Name</dt><dd>{c.name}</dd></>) : null}
            {c.business ? (<><dt>Business</dt><dd>{c.business}</dd></>) : null}
            {c.site ? (
              <>
                <dt>Site</dt>
                <dd>
                  <a href={siteHref(c.site)} target="_blank" rel="noreferrer">{c.site}</a>
                </dd>
              </>
            ) : null}
            {c.sourceUrl ? (
              <>
                <dt>Found on</dt>
                <dd>
                  <a href={c.sourceUrl} target="_blank" rel="noreferrer">{c.sourceUrl}</a>
                </dd>
              </>
            ) : null}
            <dt>Observation</dt>
            <dd>{c.gap || <span className="aw-muted">None — plain version used.</span>}</dd>
            {c.notes ? (<><dt>Notes</dt><dd>{c.notes}</dd></>) : null}
            <dt>Sent</dt>
            <dd className="aw-mono">{c.sentCount ?? 0}</dd>
            {c.nextAt ? (<><dt>Next email</dt><dd>{when(c.nextAt)}</dd></>) : null}
          </dl>

          <div className="ui-section">
            <h3 className="ui-section__title">Messages ({data.messages.length})</h3>
            {data.messages.length ? (
              <ul className="aw-mk-inspector-list">
                {data.messages.map((m) => (
                  <li key={m.id}>
                    <button type="button" className="aw-mk-inspector-item aw-mk-inspector-item--btn" onClick={() => onOpenMessage(m.id)}>
                      <span className="aw-mk-inspector-row">
                        <span className="aw-mk-cell-title">{m.subject ?? '(no subject)'}</span>
                        <MessageStatus status={m.status} />
                      </span>
                      <span className="ui-meta">
                        <span>{m.sentAt ? `${ago(m.sentAt)} ago` : m.scheduledAt ? when(m.scheduledAt) : 'Draft'}</span>
                        {m.editedAt ? <MetaChip>Edited</MetaChip> : m.reviewedAt ? <MetaChip>Reviewed</MetaChip> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ui-note">Nothing queued or sent.</p>
            )}
          </div>

          <div className="ui-section">
            <div className="aw-mk-bar">
              <h3 className="ui-section__title">Events ({visibleEvents.length})</h3>
              <span className="aw-mk-spacer" />
              <Chips
                label="Event filters"
                value={showDmarc ? ['dmarc'] : []}
                options={[{ value: 'dmarc', label: 'Show DMARC' }]}
                onChange={(values) => setShowDmarc(values.includes('dmarc'))}
              />
            </div>
            {visibleEvents.length ? (
              <ul className="aw-mk-inspector-list">
                {visibleEvents.map((e) => (
                  <li key={e.id} className="aw-mk-inspector-item">
                    <span className="aw-mk-inspector-row">
                      <EventStatus kind={e.kind} />
                      <span className="aw-mk-spacer" />
                      <span className="ui-meta">{ago(e.createdAt)} ago</span>
                    </span>
                    {e.detail ? <span className="aw-muted aw-mk-copy">{snippet(e.detail, 260)}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ui-note">No events.</p>
            )}
          </div>
        </>
      )}
    </Inspector>
  );
}

/** Email Inspector: replaces MessageModal (preview, test send, rewrite, send now, cancel). */
function MessageInspector({ id, initialMode, back, api, onClose, onBack, onOpenContact, onDone }) {
  const settledId = useSettled(id, 160);
  const resource = useResource(
    () => (settledId != null ? api('GET', `/admin/marketing/messages/${settledId}`) : null),
    [api, settledId],
  );
  const data = resource.data;
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDraft(null);
    setError(null);
  }, [id]);

  useEffect(() => {
    if (initialMode === 'edit' && data?.message && !draft) {
      setDraft({ subject: data.message.subject ?? '', body: data.message.body ?? '' });
    }
  }, [initialMode, data, draft]);

  const doing = async (fn, message, keepOpen = false) => {
    setBusy(true);
    setError(null);
    try {
      const out = await fn();
      const text = typeof message === 'function' ? message(out) : message;
      setDraft(null);
      resource.reload();
      onDone(text);
      if (!keepOpen && message === 'Cancelled.') onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onFormKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDraft(null);
    }
  };

  const m = data?.message;
  const preview = data?.preview;
  const contact = data?.contact;
  const editable = m ? ['draft', 'scheduled', 'failed'].includes(m.status) : false;

  return (
    <Inspector
      title={m?.subject ?? 'Email'}
      label={m ? `Email: ${m.subject ?? m.contactEmail}` : 'Email'}
      storageKey="ptech.marketing.inspector.w"
      actions={back && onBack ? <Button size="sm" kind="ghost" onClick={onBack}>Back</Button> : null}
      onClose={onClose}
    >
      {error ? <ErrorNote error={error} /> : null}
      {settledId !== id || (resource.loading && !data) ? (
        <Skeleton label="Loading email…" variant="text" lines={6} />
      ) : !data ? (
        <ResourceNote resource={resource} label="Loading email…" empty="Email not found" />
      ) : draft ? (
        <div className="aw-mk-field-stack" onKeyDown={onFormKey}>
          <Field label="Subject">
            <input value={draft.subject} maxLength={200} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} />
          </Field>
          <Field label="Body" hint="The footer (your name, postal address and the opt-out line) is added when it sends. Re-render will not overwrite a hand edit.">
            <textarea rows={14} value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
          </Field>
          <div className="ui-actions">
            <Button
              kind="primary"
              busy={busy}
              disabled={!draft.subject.trim() || !draft.body.trim()}
              onClick={() => doing(() => api('PATCH', `/admin/marketing/messages/${m.id}`, draft), 'Wording saved.', true)}
            >
              Save wording
            </Button>
            <Button disabled={busy} onClick={() => setDraft(null)}>Discard</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="aw-mk-chips">
            <MessageStatus status={m.status} />
            {m.provider ? <MetaChip>via {m.provider}</MetaChip> : null}
            {m.editedAt ? <MetaChip>Edited</MetaChip> : m.reviewedAt ? <MetaChip>Reviewed</MetaChip> : null}
            <MetaChip>Step {(m.step ?? 0) + 1}</MetaChip>
          </div>

          <div className="ui-actions">
            {editable ? (
              <>
                <Button kind="primary" busy={busy} onClick={() => doing(() => api('POST', `/admin/marketing/messages/${m.id}/send`), 'Sent.', true)}>
                  Send now
                </Button>
                <Button disabled={busy} onClick={() => setDraft({ subject: m.subject ?? '', body: m.body ?? '' })}>
                  Rewrite
                </Button>
              </>
            ) : null}
            <Button
              kind={editable ? 'default' : 'primary'}
              disabled={busy}
              onClick={() => doing(() => api('POST', `/admin/marketing/messages/${m.id}/test`), (out) => `Test sent to ${out.to} via ${out.provider}.`, true)}
            >
              Send test
            </Button>
            {contact?.id && onOpenContact ? (
              <Button kind="ghost" onClick={() => onOpenContact(contact.id)}>Open contact</Button>
            ) : null}
            {editable ? (
              <Button kind="ghost" disabled={busy} onClick={() => doing(() => api('POST', `/admin/marketing/messages/${m.id}/cancel`), 'Cancelled.')}>
                Cancel email
              </Button>
            ) : null}
          </div>

          <dl className="ui-props">
            <dt>From</dt>
            <dd className="aw-mono">{preview.from}</dd>
            <dt>To</dt>
            <dd className="aw-mono">
              {preview.to}
              {contact?.business ? ` (${contact.business})` : ''}
            </dd>
            <dt>Reply-To</dt>
            <dd className="aw-mono">{preview.replyTo}</dd>
            {m.sentAt ? (
              <>
                <dt>Sent</dt>
                <dd>{ago(m.sentAt)} ago</dd>
              </>
            ) : m.scheduledAt ? (
              <>
                <dt>Scheduled</dt>
                <dd>{when(m.scheduledAt)}</dd>
              </>
            ) : null}
            {Object.entries(preview.headers ?? {}).map(([name, value]) => (
              <Fragment key={name}>
                <dt>{name}</dt>
                <dd className="aw-mono">{value}</dd>
              </Fragment>
            ))}
            <dt>Subject</dt>
            <dd>{preview.subject}</dd>
          </dl>

          <pre className="aw-mk-copy aw-mk-preview">{preview.text}</pre>

          {preview.image ? (
            <figure className="aw-mk-figure">
              <img src={preview.image} alt="" width={280} className="aw-mk-preview-image" />
              <figcaption className="aw-muted">
                Sent as HTML with this GIF above the signature; the text above is the plain-text part.
              </figcaption>
            </figure>
          ) : null}

          {contact ? (
            <p className="ui-note ui-section">
              {contact.site ? `Site ${contact.site}. ` : ''}
              {contact.sourceKind ? `Source ${contact.sourceKind}. ` : ''}
              {contact.gap ? `Observation: ${contact.gap}` : 'No observation on this contact, so the plain version is used.'}
            </p>
          ) : null}

          {data.events?.length ? (
            <div className="ui-section">
              <h3 className="ui-section__title">Events ({data.events.length})</h3>
              <ul className="aw-mk-inspector-list">
                {data.events.map((e) => (
                  <li key={e.id} className="aw-mk-inspector-item">
                    <span className="aw-mk-inspector-row">
                      <EventStatus kind={e.kind} />
                      <span className="aw-mk-spacer" />
                      <span className="ui-meta">{ago(e.createdAt)} ago</span>
                    </span>
                    {e.detail ? <span className="aw-muted">{snippet(e.detail, 120)}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </Inspector>
  );
}

/** Review queue Inspector: replaces ReviewModal (step through first emails one by one). */
function ReviewInspector({ api, onClose }) {
  const [queue, setQueue] = useState(null);
  const [nextDay, setNextDay] = useState(null);
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState(null);
  const [done, setDone] = useState({ ok: 0, rewritten: 0, cancelled: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const loadQueue = useCallback(() => {
    setError(null);
    return api('GET', '/admin/marketing/review?limit=50').then((out) => {
      setQueue(out.messages ?? []);
      setNextDay(out.nextDay);
      setIndex(0);
    });
  }, [api]);

  useEffect(() => {
    void loadQueue().catch((err) => setError(errorText(err)));
  }, [loadQueue]);

  const current = queue?.[index] ?? null;
  const detailResource = useResource(() => (current ? api('GET', `/admin/marketing/messages/${current.id}`) : null), [api, current]);
  const detail = detailResource.data;
  useEffect(() => setDraft(null), [current]);

  const didAct = done.ok + done.rewritten + done.cancelled > 0;
  const finish = () => onClose(didAct);

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
  const contact = detail?.contact;

  return (
    <Inspector
      title={current ? `Review ${index + 1}/${queue.length}` : 'Review first emails'}
      label="Review first emails"
      storageKey="ptech.marketing.inspector.w"
      onClose={finish}
    >
      <p className="ui-note">{progress}</p>

      {queue && !current ? (
        <div className="ui-section">
          <EmptyState
            title="No first emails waiting for review"
            hint="Follow-ups go with their first email."
            action={<Button kind="primary" onClick={finish}>Done</Button>}
            inline
          />
        </div>
      ) : (
        <>
          {draft ? (
            <div
              className="aw-mk-field-stack"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setDraft(null);
                }
              }}
            >
              <Field label="Subject">
                <input value={draft.subject} maxLength={200} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} />
              </Field>
              <Field label="Body" hint="The footer is added when it sends.">
                <textarea rows={14} value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} autoFocus />
              </Field>
              <div className="ui-actions">
                <Button
                  kind="primary"
                  busy={busy}
                  disabled={!draft.subject.trim() || !draft.body.trim()}
                  onClick={() => step(() => api('PATCH', `/admin/marketing/messages/${current.id}`, draft), 'rewritten')}
                >
                  Save & next
                </Button>
                <Button disabled={busy} onClick={() => setDraft(null)}>Back</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="ui-actions">
                <Button
                  kind="primary"
                  busy={busy}
                  disabled={!detail}
                  onClick={() => step(() => api('POST', `/admin/marketing/messages/${current.id}/review`), 'ok')}
                >
                  Review & next
                </Button>
                <Button disabled={busy || !detail} onClick={() => setDraft({ subject: current.subject ?? '', body: current.body ?? '' })}>
                  Rewrite
                </Button>
                <Button disabled={busy || !current} onClick={() => step(null, null)}>
                  Skip
                </Button>
                <Button
                  kind="ghost"
                  disabled={busy || !current}
                  onClick={() => step(() => api('POST', `/admin/marketing/messages/${current.id}/cancel`), 'cancelled')}
                >
                  Cancel
                </Button>
              </div>

              {current ? (
                <dl className="ui-props">
                  <dt>To</dt>
                  <dd className="aw-mono">{current.contactEmail}</dd>
                  {contact?.business ? (<><dt>Business</dt><dd>{contact.business}</dd></>) : null}
                  {contact?.site ? (
                    <>
                      <dt>Site</dt>
                      <dd>
                        <a href={siteHref(contact.site)} target="_blank" rel="noreferrer">{contact.site}</a>
                      </dd>
                    </>
                  ) : null}
                  {current.scheduledAt ? (<><dt>Goes</dt><dd>{when(current.scheduledAt)}</dd></>) : null}
                  {contact?.sourceKind || contact?.country ? (
                    <>
                      <dt>Source</dt>
                      <dd>{[contact.sourceKind, contact.country].filter(Boolean).join(' · ')}</dd>
                    </>
                  ) : null}
                </dl>
              ) : null}

              {detail ? (
                <div className="ui-section">
                  <p className="aw-mk-subject">{detail.preview.subject}</p>
                  <pre className="aw-mk-copy aw-mk-preview">{detail.preview.text}</pre>
                </div>
              ) : current ? (
                <ResourceNote resource={detailResource} label="Loading email…" variant="text" lines={6} />
              ) : !error ? (
                <Skeleton label="Loading review queue…" variant="text" lines={5} />
              ) : null}
            </>
          )}
        </>
      )}
      {error ? <ErrorNote error={error} onRetry={!queue ? () => void loadQueue().catch((e) => setError(errorText(e))) : undefined} /> : null}
    </Inspector>
  );
}

/** Post Inspector: replaces EditPostModal and inline post action buttons. */
function PostInspector({ post: m, initialMode, api, holdHours = 0, onClose, onApprove, onRetry, onPostNow, onCancel, onSaved }) {
  const [editing, setEditing] = useState(initialMode === 'edit');
  const [body, setBody] = useState(m.body ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setBody(m.body ?? '');
    setEditing(initialMode === 'edit');
    setError(null);
  }, [m.id, m.body, initialMode]);

  const max = POST_MAX[m.channel] ?? 3000;
  const counted = postLength(body, m.channel);
  const open = ['draft', 'scheduled', 'failed'].includes(m.status);
  const releaseAt = m.status === 'draft' && holdHours > 0 ? Math.max((m.createdAt ?? 0) + holdHours * 3600, m.scheduledAt ?? 0) : null;
  const channelLabel = postChannelLabel[m.channel] ?? m.channel;

  const savePost = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('PATCH', `/admin/marketing/messages/${m.id}`, { body });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Inspector
      title={`${channelLabel} post`}
      label={`${channelLabel} post`}
      storageKey="ptech.marketing.inspector.w"
      onClose={onClose}
    >
      <div className="aw-mk-chips">
        <MessageStatus status={m.status} isPost />
        <MetaChip>{channelLabel}</MetaChip>
        <MetaChip mono>{(editing ? body : m.body ?? '').length}/{max}</MetaChip>
        {m.kind === 'auto' ? <MetaChip>Content cycle</MetaChip> : null}
      </div>

      {editing ? (
        <div
          className="aw-mk-field-stack"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setEditing(false);
              setBody(m.body ?? '');
            }
          }}
        >
          {m.scheduledAt ? (
            <p className="ui-note">Slot {when(m.scheduledAt)}. Editing keeps the slot and the approval state.</p>
          ) : null}
          <Field label="Text" hint={`${counted}/${max} characters${m.channel === 'x' ? ' (a link counts as 23)' : ''}. No em dashes, no stock AI phrasing: marketing/style/README.md.`}>
            <textarea rows={m.channel === 'x' ? 6 : 14} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
          </Field>
          {error ? <ErrorNote error={error} /> : null}
          <div className="ui-actions">
            <Button kind="primary" busy={busy} disabled={!body.trim() || counted > max} onClick={savePost}>
              Save post
            </Button>
            <Button disabled={busy} onClick={() => { setEditing(false); setBody(m.body ?? ''); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          {open ? (
            <div className="ui-actions">
              {m.status === 'draft' ? (
                <Button kind="primary" onClick={onApprove}>Approve</Button>
              ) : m.status === 'failed' ? (
                <Button kind="primary" onClick={onRetry}>Retry</Button>
              ) : (
                <Button kind="primary" onClick={() => setEditing(true)}>Edit post</Button>
              )}
              {m.status !== 'scheduled' ? <Button onClick={() => setEditing(true)}>Edit post</Button> : null}
              <Button onClick={onPostNow}>Post now</Button>
              <Button kind="ghost" onClick={onCancel}>{m.status === 'draft' ? 'Reject' : 'Cancel'}</Button>
            </div>
          ) : m.url ? (
            <div className="ui-actions">
              <a href={m.url} target="_blank" rel="noreferrer">Open published post</a>
            </div>
          ) : null}

          <dl className="ui-props">
            <dt>Channel</dt>
            <dd>{channelLabel}</dd>
            <dt>{m.sentAt ? 'Published' : 'Slot'}</dt>
            <dd>{m.sentAt ? `${ago(m.sentAt)} ago` : m.scheduledAt ? when(m.scheduledAt) : 'No slot'}</dd>
            {releaseAt ? (
              <>
                <dt>Auto-release</dt>
                <dd>{when(releaseAt)} unless cancelled</dd>
              </>
            ) : null}
          </dl>

          {m.error ? (
            <div className="ui-section">
              <ErrorNote error={m.error} />
            </div>
          ) : null}

          <div className="ui-section">
            <h3 className="ui-section__title">Copy</h3>
            <p className="aw-mk-copy aw-mk-preview">{m.body}</p>
          </div>
        </>
      )}
    </Inspector>
  );
}

/** Sequence Inspector: shows filled-in steps for a real contact right beside the sequences table. */
function SequenceInspector({ api, sequences, sequenceKey, onClose }) {
  const seq = sequences.find((s) => s.key === sequenceKey) ?? sequences[0];
  const resource = useResource(
    () => (seq ? api('GET', `/admin/marketing/sequences/preview?sequence=${seq.key}`) : null),
    [api, seq?.key],
  );
  const data = resource.data;

  return (
    <Inspector
      title={seq?.label ?? 'Sequence'}
      label={seq ? `Sequence ${seq.label}` : 'Sequence'}
      storageKey="ptech.marketing.inspector.w"
      onClose={onClose}
    >
      <div className="aw-mk-chips">
        {seq?.key === 'cold_a' ? <MetaChip>Control</MetaChip> : null}
        {seq?.key === 'cold_obs' ? <MetaChip>Challenger</MetaChip> : null}
        {seq?.needsGap ? <MetaChip>Needs observation</MetaChip> : null}
      </div>

      <div className="ui-actions">
        <Button kind="primary" busy={resource.loading} onClick={resource.reload}>
          Another contact
        </Button>
      </div>

      {data?.contact ? (
        <p className="ui-note">
          Filled in for <span className="aw-mono">{data.contact.email}</span>
          {data.contact.business ? ` (${data.contact.business})` : ''}.
        </p>
      ) : data ? (
        <p className="ui-note">Filled in for a sample contact.</p>
      ) : null}

      {resource.loading || !data?.steps?.length ? (
        <div className="ui-section">
          <ResourceNote resource={resource} label="Loading sequence preview…" empty="No steps in this sequence" variant="text" lines={5} />
        </div>
      ) : (
        <div className="ui-section">
          {data.steps.map((step) => (
            <article key={step.kind} className="aw-mk-entry">
              <div className="aw-mk-chips">
                <MetaChip mono>Day {step.day}</MetaChip>
                <strong>{step.subject}</strong>
                {step.usesPlain ? <MetaChip>Plain version</MetaChip> : null}
              </div>
              <pre className="aw-mk-copy aw-mk-preview">
                {step.body}
                <span className="aw-muted">{data.footer}</span>
              </pre>
            </article>
          ))}
        </div>
      )}
    </Inspector>
  );
}

/* —— settings: rendered by the unified Settings (Settings → Marketing) —— */

function windowRoom(settings) {
  const hours = settings.startHour === settings.endHour ? 24 : (settings.endHour - settings.startHour + 24) % 24 || 24;
  return (hours * 12 * settings.perRun).toLocaleString('en-US');
}

function ModelHealth({ api }) {
  const resource = useResource(() => api('GET', '/admin/health/deepseek'), [api]);
  const state = resource.data;
  if (!state) return <ResourceNote resource={resource} label="Checking model health…" empty="No model health report" variant="text" lines={1} />;
  const tone = state.chat ? 'ok' : state.bridge ? 'warn' : 'bad';
  const label = state.chat ? 'DeepSeek up' : state.bridge ? 'Workers AI fallback' : 'Both engines down';
  return <StateIndicator state={state.chat ? 'online' : 'degraded'} tone={tone} label={label} />;
}

/**
 * The outreach switch: pause at once, go live only after a confirmation that
 * names the saved cap and any active ramp. One implementation for the desk
 * header, the loop Inspector and Settings → Marketing.
 */
function useSendingSwitch({ api, ask, mutate, overview, resource }) {
  const [busy, setBusy] = useState(false);
  const settings = overview?.settings ?? {};
  const change = async (live) => {
    setBusy(true);
    try {
      await mutate(async () => {
        const out = await api('PUT', '/admin/marketing/settings', { live });
        if (out.rejected?.includes('live')) throw new Error('The server rejected the sending change.');
        return out;
      }, live ? 'Outreach is live.' : 'Paused.');
    } finally {
      setBusy(false);
    }
  };
  const start = () => {
    const cap = settings.dailyCap;
    const currentCap = overview?.autoResume?.cap ?? cap;
    const ramp = overview?.autoResume?.resumedAt ? `The active ramp currently limits sending to ${currentCap}/day.` : 'No send ramp is active.';
    ask({
      title: 'Start sending cold email?',
      text: `The five-minute cron can start sending eligible emails on its next run. Saved daily cap: ${cap}/day. ${ramp}`,
      confirm: 'Go live',
      danger: true,
      run: () => change(true),
    });
  };
  const disabled = busy || resource.loading || Boolean(resource.error);
  const disabledReason = busy
    ? 'Updating sending state…'
    : resource.loading
      ? 'Refreshing marketing status…'
      : resource.error
        ? 'Refresh the desk before changing sending state.'
        : undefined;
  const toggle = () => (settings.live ? void change(false).catch(() => undefined) : start());
  return { start, toggle, disabled, disabledReason };
}

const MARKETING_GROUPS = ['Sending', 'Safety', 'Content'];

/**
 * Settings → Marketing: sending, safety and content in one bounded form, one
 * Segmented to pick the group, one SaveBar. Reads the desk itself, so it works
 * wherever Settings is mounted.
 */
export function MarketingSettings({ onDirtyChange }) {
  const { api, act, ask } = useAdmin();
  const desk = useResource(() => api('GET', '/admin/marketing'), [api], { keepOnError: true });
  const overview = desk.data;
  const { reload } = desk;
  const mutate = useCallback(async (fn, message) => {
    const result = await act(fn, message);
    reload();
    return result;
  }, [act, reload]);
  const sending = useSendingSwitch({ api, ask, mutate, overview, resource: desk });
  const [group, setGroup] = useState('Sending');
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const changed = Object.keys(edits).length > 0;

  useEffect(() => {
    onDirtyChange?.(changed);
  }, [changed, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  if (!overview) return <ResourceNote resource={desk} label="Loading Marketing settings…" variant="rows" />;

  const saved = overview.settings;
  const draft = { ...saved, ...edits };
  const set = (key, value) =>
    setEdits((before) => {
      const next = { ...before };
      if (value === saved[key]) delete next[key];
      else next[key] = value;
      return next;
    });

  const save = async () => {
    const { live: _live, ...patch } = edits;
    setBusy(true);
    setError(null);
    try {
      const out = await mutate(
        () => api('PUT', '/admin/marketing/settings', patch),
        (result) => (result.rejected?.length ? 'Settings were not fully saved.' : 'Marketing settings saved.'),
      );
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
      <FormPane className="aw-settings-form">
        {desk.error ? <ResourceNote resource={desk} /> : null}
        <div className="aw-settings-form__head">
          <Segmented
            label="Marketing settings group"
            value={group}
            options={MARKETING_GROUPS.map((label) => ({ value: label, label }))}
            onChange={setGroup}
          />
          <span className="aw-settings-form__fill" />
          <ModelHealth api={api} />
        </div>
        <fieldset disabled={busy} className="aw-mk-settings-fields">
          {group === 'Sending' ? (
            <>
              <Panel title="Sender" subtitle="Who the mail comes from.">
                <div className="aw-field">
                  <span className="aw-field__label">Outreach</span>
                  <div className="aw-inline">
                    <StateIndicator state={saved.live ? 'running' : 'paused'} tone={saved.live ? 'ok' : 'warn'} label={saved.live ? 'Live' : 'Paused'} live={saved.live} />
                    <Button size="sm" disabled={sending.disabled} disabledReason={sending.disabledReason} onClick={sending.toggle}>
                      {saved.live ? 'Pause sending' : 'Go live'}
                    </Button>
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
                    label="Email sender"
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
              </Panel>

              <Panel title="Schedule and volume" subtitle="When mail may leave, and how much of it.">
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
                    label="Weekdays only"
                    value={Boolean(draft.weekdaysOnly)}
                    options={[
                      { value: true, label: 'Weekdays' },
                      { value: false, label: 'Every day' },
                    ]}
                    onChange={(v) => set('weekdaysOnly', v)}
                  />
                </Field>
                <Field label="Daily cap" hint={`Emails a day across every sequence. At ${draft.perRun} per run the window allows about ${windowRoom(draft)} a day.`}>
                  <input
                    inputMode="numeric"
                    className="aw-settings-num"
                    value={draft.dailyCap}
                    title={`At ${draft.perRun} per run the window allows about ${windowRoom(draft)} a day.`}
                    onChange={(e) => set('dailyCap', Number(e.target.value))}
                  />
                </Field>
                <Field label="Per run" hint="The cron runs every five minutes; up to 200.">
                  <input inputMode="numeric" className="aw-settings-num" value={draft.perRun} onChange={(e) => set('perRun', Number(e.target.value))} />
                </Field>
              </Panel>
            </>
          ) : group === 'Safety' ? (
            <>
              <Panel title="Safety" subtitle="The checks that keep the list healthy.">
                <Field
                  label="Auto-resume"
                  hint="A pause the desk caused itself lifts after 7 quiet days, ramping from 20 a day. A pause you set by hand is never undone."
                >
                  <Segmented
                    label="Auto-resume"
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
                    label="Review first emails"
                    value={Boolean(draft.reviewFirst)}
                    options={[
                      { value: true, label: 'Only reviewed' },
                      { value: false, label: 'Send all' },
                    ]}
                    onChange={(v) => set('reviewFirst', v)}
                  />
                </Field>
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
                  <input inputMode="numeric" className="aw-settings-num" min="0" max="100" value={draft.obsShare ?? 50} onChange={(e) => set('obsShare', Number(e.target.value))} />
                </Field>
              </Panel>
            </>
          ) : (
            <>
              <Panel title="Email look" subtitle="What the HTML version carries.">
                <Field label="Workshop GIF" hint="Off sends plain text only; First emails and Every email add the workshop images.">
                  <Segmented
                    label="Workshop GIF"
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
                    label="Post approval"
                    value={Boolean(draft.postApproval)}
                    options={[
                      { value: true, label: 'Approve each post' },
                      { value: false, label: 'Post on schedule' },
                    ]}
                    onChange={(v) => set('postApproval', v)}
                  />
                </Field>
                <Field label="Post hold (hours)" hint="How long a drafted post waits before it goes out on its own. 0 means approve by hand. Up to 168.">
                  <input inputMode="numeric" className="aw-settings-num" min="0" max="168" value={draft.postHoldHours ?? 24} onChange={(e) => set('postHoldHours', Number(e.target.value))} />
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
                <details className="ui-disclosure">
                  <summary>How publishing works</summary>
                  <div className="ui-disclosure__body">
                    <p className="aw-muted aw-mk-no-top">
                      X and LinkedIn have no affordable posting API, so the machine posts from a real browser profile:{' '}
                      <span className="aw-mono">marketing/publisher/publish.mjs</span>. It polls this desk with{' '}
                      <span className="aw-mono">MARKETING_TOKEN</span>, opens the composer with the queued text, and reports back. Keep
                      it launched from this machine — it uses that browser session, not a password.
                    </p>
                  </div>
                </details>
              </Panel>
            </>
          )}
        </fieldset>
      </FormPane>
      <SaveBar
        dirty={changed}
        saving={busy}
        error={error}
        onSave={save}
        onDiscard={() => { setEdits({}); setError(null); }}
        saveLabel="Save Marketing settings"
        discardLabel="Discard"
      />
    </>
  );
}

/* —— create modals (kind="create" only; all object inspection lives in Inspector) —— */

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
      kind="create"
      title="Import contacts"
      subtitle="Upload a CSV with email, name, business, site, gap, source URL, notes, and optionally source kind and two-letter country code (DE, AT, CH, IT, ES, PL, DK, NO and TR are never mailed cold). The gap is the one specific, true observation the first email opens with."
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
      <Field label="Sequence" hint="Choose “Import only” to review the list first; Queue everyone can queue them later.">
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
      <Field label="Source" hint="Which list this is. Source health breakdown in Contacts tracks reply, bounce and complaint rates per source.">
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

function ContactModal({ api, sequences, onClose, onSaved }) {
  const [form, setForm] = useState({ email: '', name: '', business: '', site: '', gap: '', notes: '' });
  const [queue, setQueue] = useState(true);
  const [sequence, setSequence] = useState(sequences[0]?.key ?? 'cold_a');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await api('POST', '/admin/marketing/contacts', { ...form, sequence: queue ? sequence : undefined });
      onSaved(`${out.contact.email} added${queue ? ' and queued' : ''}.`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      kind="create"
      title="Add a contact"
      subtitle="Only someone you chose to write to. There is no list building in here."
      onClose={onClose}
      wide
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={busy || !form.email.trim()} onClick={submit}>
            Add
          </Button>
        </>
      }
    >
      <div className="aw-grid2">
        <Field label="Email">
          <input value={form.email} onChange={(e) => set('email', e.target.value)} />
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
      <Field label="Queue now">
        <Segmented
          label="Queue now"
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
          <select value={sequence} onChange={(e) => setSequence(e.target.value)}>
            {sequences.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {error ? <ErrorNote error={error} /> : null}
    </Modal>
  );
}

function BulkQueueModal({ api, sequences, onClose, onDone }) {
  const [sequence, setSequence] = useState(sequences[0]?.key ?? 'cold_a');
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
      kind="create"
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
      kind="create"
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
        <Segmented label="Channel" value={channel} options={CHANNELS.filter((c) => c.value).map((c) => ({ value: c.value, label: c.label }))} onChange={setChannel} />
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
