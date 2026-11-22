/*
 * The SEO desk: how our own two hosts look to search engines and to
 * assistants, what is wrong with them, and what we did about it.
 *
 * Everything here reads worker/src/seo.ts through api(method, path, body).
 * Days are UTC calendar days ('YYYY-MM-DD'); times are unix seconds.
 *
 * Grammar (06-design-system.md §6): one PageHeader with one primary
 * (`Run audit`), five tabs, and on each tab an object list (DataTable) with
 * the selected object in the right Inspector. Status is a StateIndicator;
 * scores and positions are plain numbers. The desk's settings live in the
 * unified Settings (Settings → SEO, `SeoSettings` below); the header's
 * overflow links there.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAdmin, usePoll } from './store.js';
import { openSettings } from './settings-link.js';
import { ago, errorText, when } from './format.js';
import {
  Button,
  DataTable,
  Empty,
  ErrorNote,
  Field,
  FormPane,
  Inspector,
  Loading,
  MetaChip,
  PageHeader,
  PageTabs,
  Panel,
  SaveBar,
  Segmented,
  StateIndicator,
  StatRow,
  UiStyles,
} from './ui/index.js';

const DAY = 86_400_000;
/** 320px keeps the list beside an open Inspector above DataTable's 720px stacking width on a 1440 screen with the sidebar. */
const SEO_INSPECTOR_W = 320;

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
const SEVERITY_STATE = {
  high: { tone: 'bad', label: 'High' },
  medium: { tone: 'warn', label: 'Medium' },
  low: { tone: 'neutral', label: 'Low' },
};
const severityProps = (severity) => ({ state: `severity_${severity}`, ...(SEVERITY_STATE[severity] ?? { tone: 'neutral', label: 'Unknown' }) });

const CITATION_STATUSES = ['todo', 'drafted', 'live', 'verified', 'skipped'];
const CITATION_RANK = { todo: 0, drafted: 1, live: 2, verified: 3, skipped: 4 };
const CITATION_STATE = {
  todo: { tone: 'neutral', label: 'To do' },
  drafted: { tone: 'info', label: 'Drafted' },
  live: { tone: 'warn', label: 'Live, not verified' },
  verified: { tone: 'ok', label: 'Verified' },
  skipped: { tone: 'neutral', label: 'Skipped' },
};
const CITATION_OPTION = { todo: 'To do', drafted: 'Drafted', live: 'Live', verified: 'Verified', skipped: 'Skipped' };
const citationProps = (status) => ({ state: `citation_${status}`, ...(CITATION_STATE[status] ?? { tone: 'neutral', label: status }) });

const EVENT_KINDS = [
  { value: 'core_update', label: 'Core update' },
  { value: 'algorithm_update', label: 'Algorithm update' },
  { value: 'fix', label: 'Fix' },
  { value: 'note', label: 'Note' },
];
const EVENT_LABEL = {
  core_update: 'core update',
  algorithm_update: 'algorithm update',
  fix: 'fix',
  note: 'note',
  guide: 'guide',
  indexnow: 'IndexNow',
};
const CYCLE_REASON = {
  auto_off: 'automatic cycles are off',
  open_cycle: 'a cycle ticket is already open',
  no_findings: 'there are no open findings at medium or above',
  recent_cycle: 'a cycle was filed in the last day',
  no_project: 'the ptechsolutions project is missing',
  no_admin: 'there is no admin account to file it for',
  insert_failed: 'the ticket could not be written',
};
const GUIDE_REASON = {
  auto_off: 'automatic guide cycles are off; force still files one',
  open_cycle: 'a guide ticket is already open',
  weekly_cap: 'this week’s guide cycles are used up',
  recent_cycle: 'a guide cycle was filed in the last two days',
  all_covered: 'every target already has a guide or a fresh attempt',
  no_project: 'the ptechsolutions project is missing',
  no_admin: 'there is no admin account to file it for',
  insert_failed: 'the ticket could not be written',
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** Our own hosts: the lab and the PTech portal. */
const OUR_DOMAINS = ['malipetek.dev', 'ptechsolutions.net'];
/** True for one of our own hosts or a subdomain of one. */
const isOurDomain = (domain) => OUR_DOMAINS.some((host) => domain === host || domain.endsWith(`.${host}`));

/** A share as a percent: at most one decimal, and a whole number keeps no .0. */
const pct = (rate) => `${Number(((rate ?? 0) * 100).toFixed(1))}%`;
const dayNumber = (day) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '');
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY : NaN;
};
const dayOfNumber = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const shortDay = (day) => {
  const n = dayNumber(day);
  if (!Number.isFinite(n)) return day ?? '';
  return new Date(n * DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};
const longDay = (day) => {
  const n = dayNumber(day);
  if (!Number.isFinite(n)) return day ?? '';
  return new Date(n * DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const instantDay = (unix) => (unix ? new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const swingText = (swing) =>
  swing === null || swing === undefined ? 'no swing yet' : `±${swing} position${swing === 1 ? '' : 's'} week over week`;
const hasValue = (value) => value !== null && value !== undefined;

/**
 * What each paid or ticketed desk action does, in the confirm's words. The
 * audit only reads our own hosts; the GEO probe spends DeepSeek calls, the rank
 * check spends DataForSEO credit, and a cycle files a real ticket.
 */
const RUN_ASK = {
  audit: {
    title: 'Run the audit now?',
    text: 'Reads our own hosts’ sitemaps and up to 200 pages, then opens or resolves findings. No paid API is called.',
    confirm: 'Run audit',
  },
  geo: {
    title: 'Run the GEO probe now?',
    text: 'Asks DeepSeek every buyer question once (one paid API call per question) and keeps whether the answer named us.',
    confirm: 'Run probe',
  },
  citations: {
    title: 'Check citations now?',
    text: 'Re-reads every profile URL once. A page that no longer links back loses its verified date; a page we cannot read keeps it.',
    confirm: 'Check citations',
  },
  cycle: {
    title: 'Run a fix cycle now?',
    text: 'Files a system ticket on ptechsolutions for the worst open findings; an agent then works it. This cannot be undone from here.',
    confirm: 'File the cycle',
  },
  ranks: {
    title: 'Check rankings now?',
    text: 'Posts every tracked keyword to DataForSEO, which charges about $0.006 per keyword at depth 100.',
    confirm: 'Check rankings',
  },
};
const RUN_BUSY = { audit: 'audit', geo: 'GEO probe', citations: 'citations check', cycle: 'fix cycle', ranks: 'rank check' };
/** The desk's runs and the cadence each should keep, in days. */
const RUN_CADENCE = [
  { key: 'audit', label: 'Audit', stateKey: 'lastAuditAt', days: 2 },
  { key: 'geo', label: 'GEO probe', stateKey: 'lastGeoAt', days: 8 },
  { key: 'citations', label: 'Citations', stateKey: 'lastCitationsAt', days: 8 },
  { key: 'ranks', label: 'Rankings', stateKey: 'lastRanksAt', days: 8 },
];
/** A run is late when it never happened or is older than its cadence. */
const runLate = (at, days) => !at || Date.now() / 1000 - at > days * 86_400;

/** A ticket opens in the workbench the same way every other view opens one. */
function TicketLink({ id, openTicket }) {
  if (!id) return <span className="ui-note">—</span>;
  return (
    <a
      href={`#ticket=${id}`}
      className="aw-link"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openTicket?.(id);
      }}
    >
      #{id}
    </a>
  );
}

/** An outside link that never selects the row it sits in. */
function OutLink({ href, children, className = 'aw-link' }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className} onClick={(event) => event.stopPropagation()}>
      {children}
    </a>
  );
}

/** Escape closes the Inspector from anywhere in the tab, unless something nearer used it. */
const closeOnEscape = (open, close) => (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || !open) return;
  if (e.target?.closest?.('input, textarea, select, [contenteditable], [role=menu], [role=dialog], .aw-menu')) return;
  e.preventDefault();
  close();
};

/** List on the left, Inspector on the right; ≤900px the Inspector is a bottom sheet over a scrim. */
function SeoSplit({ inspector, onClose, children }) {
  return (
    <div className="ui-split" onKeyDown={closeOnEscape(Boolean(inspector), onClose)}>
      <div className="ui-split__main">{children}</div>
      {inspector ? (
        <>
          <div className="aw-seo-scrim" onClick={onClose} aria-hidden="true" />
          {inspector}
        </>
      ) : null}
    </div>
  );
}

/** The row selection of one tab: the key, the row it names in `rows`, and close. */
function useSelection(rows, keyOf) {
  const [key, setKey] = useState(null);
  const selected = key == null ? null : rows.find((row) => String(keyOf(row)) === String(key)) ?? null;
  const close = useCallback(() => setKey(null), []);
  return { key: selected ? String(key) : null, selected, select: (row) => setKey(String(keyOf(row))), close };
}

/** A title line for an Inspector section. */
const SectionTitle = ({ children }) => <h3 className="ui-section__title">{children}</h3>;

export function SeoView() {
  const { api, ask, notify, openTicket, open } = useAdmin();
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('overview');
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(null);
  const [guideBusy, setGuideBusy] = useState(false);
  // An Inspector with unsaved edits owns the one primary; the header's yields.
  const [primaryClaimed, setPrimaryClaimed] = useState(false);

  const load = useCallback(
    () =>
      api('GET', '/admin/seo/overview')
        .then((data) => {
          setOverview(data);
          setError(null);
        })
        .catch(setError),
    [api],
  );

  useEffect(() => {
    void load();
  }, [load]);
  usePoll(load, 60_000, [load]);

  const refresh = useCallback(() => {
    setTick((n) => n + 1);
    return load();
  }, [load]);

  /** A paid or ticketed run: confirm what it costs or files, then toast the outcome. */
  const run = useCallback(
    (what) =>
      ask({
        ...RUN_ASK[what],
        run: async () => {
          setBusy(what);
          try {
            const out = await api('POST', '/admin/seo/run', { what });
            setTick((n) => n + 1);
            await load();
            notify?.(runText(out));
          } finally {
            setBusy(null);
          }
        },
      }),
    [api, ask, load, notify],
  );

  /** File a guide cycle now, past the weekly cadence (never past an open one). */
  const writeGuide = useCallback(
    () =>
      ask({
        title: 'Write a guide now?',
        text: 'Files a guide-cycle ticket on ptechsolutions, bypassing the weekly cadence. An agent writes the page and the desk merges it.',
        confirm: 'File the guide cycle',
        run: async () => {
          setGuideBusy(true);
          try {
            const out = await api('POST', '/admin/seo/guide-cycle?force=1');
            await refresh();
            notify?.(guideCycleText(out));
          } finally {
            setGuideBusy(false);
          }
        },
      }),
    [api, ask, notify, refresh],
  );

  const switchTab = (value) => {
    setPrimaryClaimed(false);
    setTab(value);
  };

  if (error && !overview) return <div className="aw-view"><ErrorNote error={error} onRetry={load} /></div>;
  if (!overview) return <div className="aw-view"><Loading label="Loading the SEO desk…" /></div>;

  const hosts = overview.hostsAvailable ?? overview.hosts.map((h) => h.host);
  const state = overview.state ?? {};
  const cadence = RUN_CADENCE.map((entry) => ({ ...entry, at: state[entry.stateKey] ?? null }));
  const late = cadence.filter((entry) => runLate(entry.at, entry.days));
  const waitReason = busy ? `Wait for the ${RUN_BUSY[busy] ?? busy} to finish.` : undefined;

  const desk = { api, ask, notify, openTicket, refresh, run, busy, tick, hosts, overview, writeGuide, guideBusy };

  return (
    <div className="ui-workspace aw-seo">
      <UiStyles />
      <PageHeader
        title="SEO"
        subtitle={cadence.map((entry) => `${entry.label} ${entry.at ? `${ago(entry.at)} ago` : 'not run yet'}`).join(' · ')}
        meta={
          late.length ? (
            <StateIndicator
              state="late"
              tone="warn"
              label={late.length === 1 ? `${late[0].label} overdue` : `${late.length} runs overdue`}
              title={late.map((entry) => `${entry.label}: due every ${plural(entry.days, 'day', 'days')}`).join('; ')}
            />
          ) : (
            <StateIndicator state="on_schedule" tone="ok" label="On schedule" />
          )
        }
        actions={
          <Button
            kind={primaryClaimed ? 'default' : 'primary'}
            busy={busy === 'audit'}
            disabled={Boolean(busy)}
            disabledReason={waitReason}
            onClick={() => run('audit')}
          >
            Run audit
          </Button>
        }
        secondary={[
          { label: busy === 'geo' ? 'Running GEO probe…' : 'Run GEO probe', run: () => run('geo'), disabled: Boolean(busy), disabledReason: waitReason },
          { label: busy === 'citations' ? 'Checking citations…' : 'Check citations', run: () => run('citations'), disabled: Boolean(busy), disabledReason: waitReason },
        ]}
        overflow={[
          { label: busy === 'ranks' ? 'Checking rankings…' : 'Check rankings now…', run: () => run('ranks'), disabled: Boolean(busy), disabledReason: waitReason },
          { label: busy === 'cycle' ? 'Filing the fix cycle…' : 'Run a fix cycle now…', run: () => run('cycle'), disabled: Boolean(busy), disabledReason: waitReason },
          { label: guideBusy ? 'Filing the guide cycle…' : 'Write a guide now…', run: writeGuide, disabled: guideBusy },
          { separator: true },
          { label: 'SEO settings…', run: () => openSettings(open, 'seo') },
        ]}
      />

      {error ? <ErrorNote error={error} onRetry={load} /> : null}

      <PageTabs
        ariaLabel="SEO desk section"
        value={tab}
        onChange={switchTab}
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'audit', label: 'Audit' },
          { value: 'answers', label: 'AI answers' },
          { value: 'ranks', label: 'Rankings' },
          { value: 'citations', label: 'Citations' },
        ]}
      />

      {tab === 'overview' ? <OverviewTab desk={desk} cadence={cadence} /> : null}
      {tab === 'audit' ? <AuditTab desk={desk} /> : null}
      {tab === 'answers' ? <GeoTab desk={desk} /> : null}
      {tab === 'ranks' ? <RankingsTab desk={desk} /> : null}
      {tab === 'citations' ? <CitationsTab desk={desk} onClaimPrimary={setPrimaryClaimed} /> : null}
    </div>
  );
}

/* ——————————————————————— run outcomes ——————————————————————— */

function runText(result) {
  if (!result || typeof result !== 'object') return 'Done.';
  if (result.what === 'audit') {
    const hosts = result.hosts ?? [];
    if (!hosts.length) return 'The audit ran but no host answered.';
    return hosts
      .map((h) => `${h.host}: ${h.pages ?? 0} pages, average ${h.averageScore ?? 0}, ${h.opened ?? 0} opened, ${h.resolved ?? 0} resolved`)
      .join('. ')
      .concat('.');
  }
  if (result.what === 'geo') {
    if (result.skipped === 'no_key') return 'Skipped: the Worker has no DEEPSEEK_API_KEY.';
    return `Asked ${result.questions ?? 0} questions, kept ${result.runs ?? 0} answers, ${result.mentions ?? 0} named us.`;
  }
  if (result.what === 'citations') {
    return `Checked ${result.checked ?? 0} profiles: ${result.verified ?? 0} verified, ${result.dropped ?? 0} dropped.`;
  }
  if (result.what === 'ranks') {
    if (result.skipped === 'no_key') return 'Skipped: the Worker has no DATAFORSEO_API_KEY.';
    if (result.skipped === 'no_keywords') return 'No keywords tracked. Add some in Settings first.';
    if (result.skipped === 'api_failed') return 'DataForSEO did not answer; nothing was queued or charged.';
    if (result.posted) {
      return `Queued ${plural(result.posted, 'keyword', 'keywords')} on the standard queue (~$${(result.cost ?? 0).toFixed(4)}). Results land on later cron ticks.`;
    }
    return `Collected ${plural(result.collected ?? 0, 'keyword', 'keywords')}; ${result.pending ?? 0} still queued.`;
  }
  if (result.what === 'cycle') {
    if (result.filed) return `Filed #${result.id}. An agent takes the worst findings next.`;
    const reason = CYCLE_REASON[result.reason] ?? result.reason ?? 'unknown reason';
    return `Nothing filed: ${reason}${result.id ? ` (#${result.id})` : ''}.`;
  }
  return 'Done.';
}

function guideCycleText(result) {
  if (!result || typeof result !== 'object') return 'Done.';
  if (result.filed) return `Filed #${result.id}: an agent writes the guide and the desk merges it.`;
  const reason = GUIDE_REASON[result.reason] ?? result.reason ?? 'unknown reason';
  return `Nothing filed: ${reason}${result.id ? ` (#${result.id})` : ''}.`;
}

/* ——————————————————————— overview ——————————————————————— */

const coverageState = (entry) =>
  entry.guide
    ? { state: 'guide_live', tone: 'ok', label: 'Published' }
    : entry.inProgress
      ? { state: 'guide_writing', tone: 'info', label: 'Writing', live: true }
      : entry.lastAttemptAt
        ? { state: 'guide_attempted', tone: 'warn', label: 'Attempted' }
        : { state: 'guide_none', tone: 'neutral', label: 'No page yet' };

function OverviewTab({ desk, cadence }) {
  const { overview, openTicket, writeGuide, guideBusy } = desk;
  const [showAllGuides, setShowAllGuides] = useState(false);
  const held = overview.cycle?.held;
  const coverage = overview.coverage ?? [];
  const covered = coverage.filter((entry) => entry.guide).length;
  const guideShown = showAllGuides ? coverage : coverage.slice(0, 5);
  const rank = overview.rank ?? {};
  const citations = overview.citations ?? {};
  const citationTotal = CITATION_STATUSES.reduce((sum, status) => sum + (citations[status] ?? 0), 0);
  const openFindings = overview.hosts.reduce((sum, host) => sum + (host.findings?.open ?? 0), 0);

  return (
    <div className="ui-split">
      <div className="ui-split__main">
        {held?.held ? (
          <div className="aw-banner aw-banner--warn">
            Google core update in progress: content rewrites paused until {longDay(held.until)}.
            {held.since ? <span className="aw-muted"> Started {longDay(held.since)}.</span> : null}
          </div>
        ) : null}

        <div className="aw-seo-strip">
          <StatRow
            items={[
              ...overview.hosts.map((host) => ({ label: `${host.host} score`, value: host.averageScore, hint: plural(host.pages, 'page', 'pages') })),
              { label: 'open findings', value: openFindings },
              { label: 'assistant mention rate', value: pct(overview.geo.rate), hint: `${overview.geo.mentions} of ${overview.geo.runs} answers named us` },
              { label: 'average Google position', value: hasValue(rank.avgPosition) ? rank.avgPosition : '—' },
              { label: 'citations verified', value: `${citations.verified ?? 0} of ${citationTotal}` },
              { label: 'targets with a guide', value: `${covered} of ${coverage.length}` },
            ]}
          />
        </div>

        <div className="aw-seo-grid">
          {overview.hosts.map((host) => (
            <section key={host.host} className="aw-seo-section">
              <h3 className="aw-seo-section__title">
                {host.host}
                <span className="ui-note">{host.day ? `Audited ${shortDay(host.day)}` : 'No audit yet'}</span>
              </h3>
              <ScoreChart series={host.series ?? []} events={overview.events ?? []} today={overview.day} />
              <p className="ui-meta">
                <span><strong>{host.findings.high}</strong> high</span>
                <span><strong>{host.findings.medium}</strong> medium</span>
                <span><strong>{host.findings.low}</strong> low</span>
                <span><strong>{host.findings.open}</strong> open</span>
                <span><strong>{host.pages}</strong> {host.pages === 1 ? 'page' : 'pages'}</span>
              </p>
            </section>
          ))}
          <section className="aw-seo-section">
            <h3 className="aw-seo-section__title">
              Assistant mentions
              <span className="ui-note">Whether the assistants name us when buyers ask</span>
            </h3>
            <GeoChart weeks={overview.geo.weeks ?? []} />
            <p className="ui-meta">
              <span><strong>{overview.geo.mentions}</strong> mentions</span>
              <span><strong>{overview.geo.runs}</strong> answers</span>
              <span><strong>{pct(overview.geo.rate)}</strong> mention rate</span>
            </p>
          </section>
        </div>

        <div className="aw-seo-grid">
          <section className="aw-seo-section">
            <h3 className="aw-seo-section__title">Runs</h3>
            <dl className="ui-props">
              {cadence.map((entry) => (
                <RunProp key={entry.key} entry={entry} />
              ))}
            </dl>
          </section>

          <section className="aw-seo-section">
            <h3 className="aw-seo-section__title">Google rankings</h3>
            <dl className="ui-props">
              <dt>Tracking</dt>
              <dd>{rank.rankReady ? <StateIndicator state="tracking_on" tone="ok" label="On" /> : <StateIndicator state="no_key" tone="bad" label="No API key" />}</dd>
              <dt>Average position</dt>
              <dd>{hasValue(rank.avgPosition) ? rank.avgPosition : '—'}</dd>
              <dt>In the top 10</dt>
              <dd>{rank.inTop10 ?? 0}</dd>
              <dt>In the top 100</dt>
              <dd>{rank.inTop100 ?? 0}</dd>
              <dt>Swing</dt>
              <dd title="Week over week; a few positions is normal">{swingText(rank.swing)}</dd>
              <dt>Keywords</dt>
              <dd>{plural(rank.keywords ?? 0, 'keyword', 'keywords')}</dd>
              {rank.pending ? (
                <>
                  <dt>Queued</dt>
                  <dd>{plural(rank.pending, 'task', 'tasks')}</dd>
                </>
              ) : null}
            </dl>
            <p className="ui-note aw-seo-gap">
              {rank.rankReady
                ? `Weekly Google positions for the keywords we sell against, last checked ${rank.latestDay ? shortDay(rank.latestDay) : 'never'}.`
                : 'Add the DATAFORSEO_API_KEY secret to the intercom Worker to turn rank tracking on.'}
            </p>
          </section>

          <section className="aw-seo-section">
            <h3 className="aw-seo-section__title">
              Citations
              <span className="ui-note">Profile placements that can link back</span>
            </h3>
            <dl className="ui-props">
              {CITATION_STATUSES.map((status) => (
                <PropPair key={status} label={CITATION_OPTION[status]} value={citations[status] ?? 0} />
              ))}
            </dl>
            <p className="ui-note aw-seo-gap">A weekly check keeps the verified ones honest.</p>
          </section>

          <section className="aw-seo-section">
            <h3 className="aw-seo-section__title">Fix cycle</h3>
            <dl className="ui-props">
              <dt>Auto cycle</dt>
              <dd>{overview.cycle.auto ? <StateIndicator state="cycle_on" tone="ok" label="On" /> : <StateIndicator state="cycle_off" tone="neutral" label="Off" />}</dd>
              <dt>Open at medium or above</dt>
              <dd>{overview.cycle.openFindings}</dd>
              <dt>Due</dt>
              <dd>{overview.cycle.wouldFile ? <StateIndicator state="cycle_due" tone="warn" label="A cycle would file" /> : 'No cycle due'}</dd>
              <dt>Open ticket</dt>
              <dd>{overview.cycle.openTicketId ? <TicketLink id={overview.cycle.openTicketId} openTicket={openTicket} /> : <span className="ui-note">None</span>}</dd>
              {held?.held ? (
                <>
                  <dt>Rewrites</dt>
                  <dd>Paused until {longDay(held.until)}</dd>
                </>
              ) : null}
            </dl>
          </section>
        </div>

        <section className="aw-seo-section">
          <div className="aw-seo-section__head">
            <h3 className="aw-seo-section__title">
              Guide coverage
              <span className="ui-note">
                {covered} of {coverage.length} targets have a page
              </span>
            </h3>
            <Button size="sm" disabled={guideBusy} onClick={writeGuide}>
              {guideBusy ? 'Filing…' : 'Write a guide now'}
            </Button>
          </div>
          <p className="ui-note">
            Every rank keyword and buyer question gets a guide on ptechsolutions.net.{' '}
            {overview.guidesAt ? `guides.json was read ${ago(overview.guidesAt)} ago.` : 'The site has not been read for guides yet.'}
          </p>
          <DataTable
            label="Guide coverage"
            rows={guideShown}
            rowKey={(entry) => `${entry.kind}:${entry.target}`}
            empty={{ title: 'No guide targets yet', hint: 'Add rank keywords or buyer questions in Settings and the desk starts filing guide cycles.' }}
            columns={[
              { key: 'target', header: 'Target', render: (entry) => <span title={entry.target}>{entry.target}</span> },
              { key: 'kind', header: 'Kind', fit: true, render: (entry) => <MetaChip>{entry.kind === 'keyword' ? 'Keyword' : 'Question'}</MetaChip> },
              { key: 'state', header: 'State', fit: true, render: (entry) => <StateIndicator {...coverageState(entry)} /> },
              {
                key: 'guide',
                header: 'Guide',
                render: (entry) =>
                  entry.guide ? (
                    <OutLink href={entry.guide.url}>{entry.guide.title}</OutLink>
                  ) : entry.inProgress ? (
                    <span className="ui-note">
                      Writing in <TicketLink id={entry.inProgress} openTicket={openTicket} />
                    </span>
                  ) : entry.lastAttemptAt ? (
                    <span className="ui-note">Attempted {instantDay(entry.lastAttemptAt)}</span>
                  ) : (
                    <span className="ui-note">—</span>
                  ),
              },
            ]}
          />
          {coverage.length > 5 ? (
            <div className="ui-actions">
              <Button size="sm" kind="ghost" aria-expanded={showAllGuides} onClick={() => setShowAllGuides((shown) => !shown)}>
                {showAllGuides ? 'Show fewer' : `Show all (${coverage.length})`}
              </Button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

const PropPair = ({ label, value }) => (
  <>
    <dt>{label}</dt>
    <dd>{value}</dd>
  </>
);

function RunProp({ entry }) {
  const late = runLate(entry.at, entry.days);
  return (
    <>
      <dt>{entry.label}</dt>
      <dd>
        {entry.at ? `${ago(entry.at)} ago` : 'Not run yet'}
        <span className="ui-note"> · every {plural(entry.days, 'day', 'days')}</span>
        {late ? (
          <>
            {' '}
            <StateIndicator state="late" tone="warn" label="Overdue" />
          </>
        ) : null}
      </dd>
    </>
  );
}

/* ——————————————————————— charts ——————————————————————— */

/**
 * The chart's own pixel width, so the SVG draws 1:1 and its 11px labels stay
 * 11px at every container width (a scaled viewBox would shrink them).
 */
function useChartWidth(fallback = 560) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, Math.max(240, width)];
}

const CHART_FONT = 11;
const markColour = (kind) =>
  kind === 'fix' || kind === 'guide' ? 'var(--ui-ok)' : kind === 'note' || kind === 'indexnow' ? 'var(--ui-ink-3)' : 'var(--ui-warn)';

function ChartLegend({ line }) {
  return (
    <div className="aw-seo-chart__legend">
      <span>
        <i className="aw-seo-chart__dot aw-seo-chart__dot--accent" /> {line}
      </span>
      <span>
        <i className="aw-seo-chart__dot aw-seo-chart__dot--warn" /> core or algorithm update
      </span>
      <span>
        <i className="aw-seo-chart__dot aw-seo-chart__dot--ok" /> our fix
      </span>
    </div>
  );
}

/** A dated line over `span + 1` days ending today, with event marks. */
function DayLineChart({ series, events, today, span, ticks, valueOf, yOf, yTicks, label, line, pointTitle, emptyTitle, emptyHint }) {
  const [ref, width] = useChartWidth();
  const end = today ?? series.at(-1)?.day;
  const endNumber = dayNumber(end);
  const ready = series.length && Number.isFinite(endNumber);

  const height = 170;
  const left = 34;
  const right = 10;
  const top = 10;
  const bottom = 24;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const start = endNumber - span;
  const xOf = (n) => left + ((n - start) / span) * innerW;
  const y = (value) => top + yOf(value) * innerH;
  const points = ready
    ? series
        .map((point) => ({ ...point, n: dayNumber(point.day) }))
        .filter((point) => Number.isFinite(point.n) && point.n >= start && point.n <= endNumber)
        .sort((a, b) => a.n - b.n)
    : [];
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${xOf(point.n).toFixed(1)},${y(valueOf(point)).toFixed(1)}`).join(' ');
  const marks = ready
    ? (events ?? []).map((event) => ({ ...event, n: dayNumber(event.day) })).filter((event) => Number.isFinite(event.n) && event.n >= start && event.n <= endNumber)
    : [];

  return (
    <div className="aw-seo-chart" ref={ref}>
      {!ready ? (
        <Empty title={emptyTitle} hint={emptyHint} />
      ) : (
        <>
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
            {yTicks.map((value) => (
              <g key={value}>
                <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="var(--ui-border)" strokeWidth="1" />
                <text x={left - 6} y={y(value) + 4} textAnchor="end" fontSize={CHART_FONT} fill="var(--ui-ink-3)">
                  {value}
                </text>
              </g>
            ))}
            {ticks.map((offset) => {
              const n = start + offset;
              return (
                <text key={offset} x={xOf(n)} y={height - 6} textAnchor={offset === 0 ? 'start' : offset === span ? 'end' : 'middle'} fontSize={CHART_FONT} fill="var(--ui-ink-3)">
                  {shortDay(dayOfNumber(n))}
                </text>
              );
            })}
            {marks.map((event) => (
              <g key={event.id}>
                <title>{`${event.label} (${EVENT_LABEL[event.kind] ?? event.kind}) on ${longDay(event.day)}`}</title>
                <line x1={xOf(event.n)} x2={xOf(event.n)} y1={top} y2={height - bottom} stroke={markColour(event.kind)} strokeWidth="1" strokeDasharray="3 3" opacity="0.65" />
                <circle cx={xOf(event.n)} cy={height - bottom - 4} r="3" fill={markColour(event.kind)} />
              </g>
            ))}
            {path ? <path d={path} fill="none" stroke="var(--ui-ink-2)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /> : null}
            {points.map((point) => (
              <circle key={point.day} cx={xOf(point.n)} cy={y(valueOf(point))} r="2.6" fill="var(--ui-ink-2)">
                <title>{pointTitle(point)}</title>
              </circle>
            ))}
          </svg>
          <ChartLegend line={line} />
        </>
      )}
    </div>
  );
}

function ScoreChart({ series, events, today }) {
  return (
    <DayLineChart
      series={series}
      events={events}
      today={today}
      span={29}
      ticks={[0, 7, 14, 21, 29]}
      valueOf={(point) => point.averageScore}
      yOf={(score) => 1 - Math.max(0, Math.min(100, score)) / 100}
      yTicks={[0, 50, 100]}
      label="Average score, last 30 days"
      line="score"
      pointTitle={(point) => `${longDay(point.day)}: ${point.averageScore} average over ${point.pages} pages`}
      emptyTitle="No audit series yet"
      emptyHint="The chart fills in once a daily audit has run."
    />
  );
}

function RankChart({ series, events, today }) {
  return (
    <DayLineChart
      series={series}
      events={events}
      today={today}
      span={89}
      ticks={[0, 30, 60, 89]}
      valueOf={(point) => point.avgPosition}
      // Position 1 is at the top; anything outside the top 100 is drawn at 100.
      yOf={(position) => (Math.max(1, Math.min(100, position ?? 100)) - 1) / 99}
      yTicks={[1, 50, 100]}
      label="Average Google position, last 90 days"
      line="average position"
      pointTitle={(point) => `${longDay(point.day)}: ${point.avgPosition} average (${point.inTop10} in the top 10, ${point.inTop100} in the top 100)`}
      emptyTitle="No rank checks yet"
      emptyHint="The first weekly check fills in the line."
    />
  );
}

function GeoChart({ weeks }) {
  const [ref, width] = useChartWidth();
  if (!weeks.length) {
    return (
      <div className="aw-seo-chart" ref={ref}>
        <Empty title="No probe answers yet" hint="Run the GEO probe from the header after the next audit." />
      </div>
    );
  }
  const height = 150;
  const left = 38;
  const right = 10;
  const top = 10;
  const bottom = 24;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const gap = 6;
  const barW = Math.max(6, Math.min(36, (innerW - gap * (weeks.length - 1)) / weeks.length));
  const used = weeks.length * barW + (weeks.length - 1) * gap;
  const x0 = left + Math.max(0, (innerW - used) / 2);
  return (
    <div className="aw-seo-chart" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Mention rate per week, last 12 weeks">
        {[0, 0.5, 1].map((value) => (
          <g key={value}>
            <line x1={left} x2={width - right} y1={top + innerH * (1 - value)} y2={top + innerH * (1 - value)} stroke="var(--ui-border)" strokeWidth="1" strokeDasharray={value ? '2 4' : undefined} />
            <text x={left - 6} y={top + innerH * (1 - value) + 4} textAnchor="end" fontSize={CHART_FONT} fill="var(--ui-ink-3)">
              {value * 100}%
            </text>
          </g>
        ))}
        {weeks.map((week, index) => {
          const x = x0 + index * (barW + gap);
          const barH = Math.max(1, innerH * Math.max(0, Math.min(1, week.rate ?? 0)));
          return (
            <g key={week.week}>
              <title>{`Week of ${longDay(week.week)}: ${week.mentions} of ${week.runs} answers named us (${pct(week.rate)})`}</title>
              <rect x={x} y={top + innerH - barH} width={barW} height={barH} rx="2" fill="var(--ui-ink-2)" opacity={week.runs ? 0.85 : 0.25} />
              {(index % 3 === 0 && weeks.length - 1 - index >= 2) || index === weeks.length - 1 ? (
                <text x={x + barW / 2} y={height - 6} textAnchor="middle" fontSize={CHART_FONT} fill="var(--ui-ink-3)">
                  {shortDay(week.week)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ——————————————————————— audit: pages + findings ——————————————————————— */

function AuditTab({ desk }) {
  const [view, setView] = useState('pages');
  const switcher = (
    <Segmented
      label="Audit view"
      value={view}
      options={[
        { value: 'pages', label: 'Per page' },
        { value: 'findings', label: 'Per finding' },
      ]}
      onChange={setView}
    />
  );
  return view === 'pages' ? <PagesView desk={desk} switcher={switcher} /> : <FindingsView desk={desk} switcher={switcher} />;
}

/** Whether a page's canonical names the page itself, nothing, or another URL. */
const canonicalProps = (page) => {
  if (!page.canonical) return { state: 'canonical_missing', tone: 'bad', label: 'Missing' };
  const expected = `https://${page.host}${page.path}`.replace(/\/$/, '');
  return page.canonical.replace(/\/$/, '') === expected
    ? { state: 'canonical_ok', tone: 'ok', label: 'Self' }
    : { state: 'canonical_other', tone: 'warn', label: 'Other URL', title: page.canonical };
};
const pageUrl = (page) => `https://${page.host}${page.path}`;
const bySeverity = (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);

const PAGE_SORTS = {
  path: (page) => page.path,
  score: (page) => page.score,
  issues: (page) => (page.issues ?? []).length,
};

function PagesView({ desk, switcher }) {
  const { api, hosts, tick, run, busy, writeGuide, guideBusy } = desk;
  const [host, setHost] = useState(hosts[0] ?? 'ptechsolutions.net');
  const [day, setDay] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState({ key: 'score', dir: 1 });

  const load = useCallback(
    () =>
      api('GET', `/admin/seo/pages?host=${encodeURIComponent(host)}${day ? `&day=${encodeURIComponent(day)}` : ''}`)
        .then((out) => {
          setData(out);
          setError(null);
        })
        .catch((err) => setError(err)),
    [api, host, day],
  );

  useEffect(() => {
    void load();
  }, [load, tick]);

  const rows = useMemo(() => {
    const get = PAGE_SORTS[sort.key] ?? PAGE_SORTS.score;
    return [...(data?.pages ?? [])].sort((a, b) => (get(a) > get(b) ? 1 : get(a) < get(b) ? -1 : 0) * sort.dir || a.path.localeCompare(b.path));
  }, [data, sort]);
  const { key, selected, select, close } = useSelection(rows, (page) => page.id);

  const selectedDay = day || data?.day || '';
  const dayOptions = [...(data?.days ?? [])];
  if (data?.day && !dayOptions.includes(data.day)) dayOptions.push(data.day);

  return (
    <SeoSplit
      onClose={close}
      inspector={
        selected ? (
          <PageInspector page={selected} day={data?.day} onClose={close} onReaudit={() => run('audit')} busy={busy} onWriteGuide={writeGuide} guideBusy={guideBusy} />
        ) : null
      }
    >
      <div className="aw-seo-filters" role="toolbar" aria-label="Audit filters">
        {switcher}
        {hosts.length > 1 && hosts.length <= 3 ? (
          <Segmented
            label="Host"
            value={host}
            options={hosts.map((name) => ({ value: name, label: name }))}
            onChange={(value) => {
              setHost(value);
              setDay('');
              close();
            }}
          />
        ) : (
          <select
            value={host}
            aria-label="Host"
            onChange={(event) => {
              setHost(event.target.value);
              setDay('');
              close();
            }}
          >
            {hosts.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
        <select value={selectedDay} aria-label="Day" onChange={(event) => setDay(event.target.value)}>
          {dayOptions.map((value) => (
            <option key={value} value={value}>
              {longDay(value)}
            </option>
          ))}
        </select>
        {data ? (
          <span className="aw-seo-filters__meta">
            {data.averageScore} average · {plural(data.pages?.length ?? 0, 'page', 'pages')}
          </span>
        ) : null}
      </div>

      {error && data ? <ErrorNote error={error} onRetry={load} /> : null}

      <DataTable
        label="Audited pages"
        state={!data && !error ? 'loading' : !data && error ? 'error' : 'ready'}
        error={error}
        onRetry={load}
        rows={rows}
        rowKey={(page) => page.id}
        selected={key}
        onSelect={select}
        onOpen={select}
        sort={sort}
        onSort={(column) => setSort((s) => ({ key: column, dir: s.key === column ? -s.dir : column === 'issues' ? -1 : 1 }))}
        empty={{ title: 'No audit for this day', hint: 'Pick another day, or run an audit from the page header.' }}
        columns={[
          { key: 'n', header: '#', numeric: true, render: (_, i) => i + 1 },
          {
            key: 'path',
            header: 'Page',
            sortable: true,
            render: (page) => (
              <span title={pageUrl(page)}>
                {page.path}
                {page.status !== 200 ? (
                  <>
                    {' '}
                    <StateIndicator state="http_error" tone="bad" label={`HTTP ${page.status}`} />
                  </>
                ) : null}
              </span>
            ),
          },
          { key: 'score', header: 'Score', numeric: true, sortable: true, render: (page) => page.score },
          { key: 'canonical', header: 'Canonical', fit: true, render: (page) => <StateIndicator {...canonicalProps(page)} /> },
          { key: 'issues', header: 'Issues', numeric: true, sortable: true, render: (page) => (page.issues ?? []).length },
        ]}
      />
    </SeoSplit>
  );
}

function PageInspector({ page, day, onClose, onReaudit, busy, onWriteGuide, guideBusy }) {
  const issues = [...(page.issues ?? [])].sort(bySeverity);
  const types = page.jsonldTypes ?? [];
  const titleOff = page.titleLen > 65 || page.titleLen < 15;
  return (
    <Inspector title={page.path} label={`Page ${page.path}`} storageKey="ptech.seo.inspector.w" defaultWidth={SEO_INSPECTOR_W} onClose={onClose}>
      <div className="ui-meta">
        <span>{page.host}</span>
        <span>
          Score <strong>{page.score}</strong>
        </span>
        {page.status !== 200 ? <StateIndicator state="http_error" tone="bad" label={`HTTP ${page.status}`} /> : null}
      </div>
      <div className="ui-actions">
        <Button
          disabled={Boolean(busy)}
          busy={busy === 'audit'}
          title="The audit re-reads every page on our hosts; no paid API is called."
          onClick={onReaudit}
        >
          Re-audit…
        </Button>
        <Button kind="ghost" disabled={guideBusy} title="Files a guide cycle for the first target without a page." onClick={onWriteGuide}>
          {guideBusy ? 'Filing…' : 'Write guide…'}
        </Button>
        <OutLink href={pageUrl(page)} className="aw-btn aw-btn--ghost">
          Open ↗
        </OutLink>
      </div>

      <section className="ui-section">
        <SectionTitle>Findings · {issues.length}</SectionTitle>
        {issues.length ? (
          <ul className="aw-seo-list">
            {issues.map((issue) => (
              <li key={issue.code}>
                <StateIndicator {...severityProps(issue.severity)} />
                <span className="aw-mono">{issue.code}</span>
                <span className="aw-seo-list__text">{issue.detail}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ui-note">No issues on this page.</p>
        )}
      </section>

      <section className="ui-section">
        <SectionTitle>JSON-LD</SectionTitle>
        {types.length ? (
          <div className="ui-meta">
            {types.map((type) => (
              <MetaChip key={type} mono>
                {type}
              </MetaChip>
            ))}
          </div>
        ) : (
          <p className="ui-note">No structured data on this page.</p>
        )}
      </section>

      <section className="ui-section">
        <SectionTitle>Page</SectionTitle>
        <dl className="ui-props">
          <dt>Title</dt>
          <dd title={page.title ?? ''}>
            {page.title || <span className="ui-note">No title</span>}
            <span className="ui-note">
              {' '}
              · {page.titleLen} characters{titleOff ? ', outside 15–65' : ''}
            </span>
          </dd>
          <dt>Description</dt>
          <dd>
            {page.description || <span className="ui-note">No description</span>}
            <span className="ui-note">
              {' '}
              · {page.descLen} characters{page.descLen > 160 ? ', over 160' : ''}
            </span>
          </dd>
          <dt>Canonical</dt>
          <dd>
            <StateIndicator {...canonicalProps(page)} />
            {page.canonical ? <span className="ui-note"> {page.canonical}</span> : null}
          </dd>
          <dt>Hreflang</dt>
          <dd>{page.hreflangCount}</dd>
          <dt>H1</dt>
          <dd>
            {page.h1Count}
            {page.h1Count === 1 ? null : <span className="ui-note"> · expected 1</span>}
          </dd>
          <dt>Load</dt>
          <dd>
            {page.ms} ms{page.ms > 1500 ? <span className="ui-note"> · slow</span> : null}
          </dd>
          <dt>Sitemap</dt>
          <dd>{page.inSitemap ? 'Listed' : 'Not listed'}</dd>
          <dt>llms.txt</dt>
          <dd>{page.inLlms ? 'Listed' : 'Not listed'}</dd>
          <dt>HTTP</dt>
          <dd>{page.status}</dd>
          {day ? (
            <>
              <dt>Audited</dt>
              <dd>{longDay(day)}</dd>
            </>
          ) : null}
        </dl>
      </section>
    </Inspector>
  );
}

/* ——————————————————————— findings ——————————————————————— */

function FindingsView({ desk, switcher }) {
  const { api, hosts, tick, openTicket, refresh, notify } = desk;
  const [status, setStatus] = useState('open');
  const [host, setHost] = useState(hosts[0] ?? '');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(
    () =>
      api('GET', `/admin/seo/findings?status=${status}${host ? `&host=${encodeURIComponent(host)}` : ''}`)
        .then((out) => {
          setData(out);
          setError(null);
        })
        .catch((err) => setError(err)),
    [api, status, host],
  );

  useEffect(() => {
    void load();
  }, [load, tick]);

  const rows = useMemo(
    () =>
      (data?.findings ?? [])
        .slice()
        .sort((a, b) => bySeverity(a, b) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0)),
    [data],
  );
  const { key, selected, select, close } = useSelection(rows, (finding) => finding.id);

  const dismiss = async (finding) => {
    setBusyId(finding.id);
    try {
      await api('POST', `/admin/seo/findings/${finding.id}/dismiss`);
      await load();
      await refresh();
      notify?.('Finding dismissed.');
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  };

  const counts = data?.counts ?? { high: 0, medium: 0, low: 0, open: 0, resolved: 0 };
  const resolved = status === 'resolved';

  return (
    <SeoSplit
      onClose={close}
      inspector={
        selected ? (
          <FindingInspector finding={selected} resolved={resolved} onClose={close} openTicket={openTicket} onDismiss={() => dismiss(selected)} dismissing={busyId === selected.id} />
        ) : null
      }
    >
      <div className="aw-seo-filters" role="toolbar" aria-label="Finding filters">
        {switcher}
        <Segmented
          label="Finding status"
          value={status}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'resolved', label: 'Resolved' },
          ]}
          onChange={(value) => {
            setStatus(value);
            setError(null);
            close();
          }}
        />
        <select
          value={host}
          aria-label="Host"
          onChange={(event) => {
            setHost(event.target.value);
            close();
          }}
        >
          <option value="">All hosts</option>
          {hosts.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <span className="aw-seo-filters__meta">
          {counts.high} high · {counts.medium} medium · {counts.low} low · {counts.open} open · {counts.resolved} resolved
        </span>
      </div>

      {error && data ? <ErrorNote error={error} onRetry={load} /> : null}

      <DataTable
        label="Findings"
        state={!data && !error ? 'loading' : !data && error ? 'error' : 'ready'}
        error={error}
        onRetry={load}
        rows={rows}
        rowKey={(finding) => finding.id}
        selected={key}
        onSelect={select}
        onOpen={select}
        empty={{
          title: resolved ? 'No resolved findings for this filter' : 'No open findings for this filter',
          hint: resolved ? 'Findings land here once a later audit no longer sees them.' : 'A clean host: the next audit opens new findings as they appear.',
        }}
        columns={[
          { key: 'severity', header: 'Severity', fit: true, render: (finding) => <StateIndicator {...severityProps(finding.severity)} /> },
          { key: 'detail', header: 'Finding', render: (finding) => <span title={finding.detail}>{finding.detail}</span> },
          { key: 'page', header: 'Page', render: (finding) => <span title={`https://${finding.host}${finding.path}`}>{finding.path}</span> },
          { key: 'host', header: 'Host', fit: true, render: (finding) => finding.host },
          {
            key: 'seen',
            header: resolved ? 'Resolved' : 'First seen',
            fit: true,
            render: (finding) =>
              resolved ? (finding.resolvedAt ? `${ago(finding.resolvedAt)} ago` : '—') : <span title={when(finding.firstSeen)}>{ago(finding.firstSeen)} ago</span>,
          },
          { key: 'ticket', header: 'Ticket', fit: true, render: (finding) => <TicketLink id={finding.ticketId} openTicket={openTicket} /> },
        ]}
      />
    </SeoSplit>
  );
}

function FindingInspector({ finding, resolved, onClose, openTicket, onDismiss, dismissing }) {
  const url = `https://${finding.host}${finding.path}`;
  return (
    <Inspector title={finding.code} label={`Finding ${finding.code}`} storageKey="ptech.seo.inspector.w" defaultWidth={SEO_INSPECTOR_W} onClose={onClose}>
      <div className="ui-meta">
        <StateIndicator {...severityProps(finding.severity)} />
        {resolved ? <StateIndicator state="resolved" tone="ok" label="Resolved" /> : null}
        <span>{finding.host}</span>
      </div>
      <p className="aw-seo-detail">{finding.detail}</p>
      <div className="ui-actions">
        {!resolved ? (
          <Button disabled={dismissing} onClick={onDismiss}>
            {dismissing ? 'Dismissing…' : 'Dismiss'}
          </Button>
        ) : null}
        <OutLink href={url} className="aw-btn aw-btn--ghost">
          Open page ↗
        </OutLink>
      </div>
      <dl className="ui-props">
        <dt>Page</dt>
        <dd>
          <OutLink href={url}>{finding.path}</OutLink>
        </dd>
        <dt>Code</dt>
        <dd className="aw-mono">{finding.code}</dd>
        <dt>First seen</dt>
        <dd title={when(finding.firstSeen)}>{ago(finding.firstSeen)} ago</dd>
        {finding.lastSeen ? (
          <>
            <dt>Last seen</dt>
            <dd title={when(finding.lastSeen)}>{ago(finding.lastSeen)} ago</dd>
          </>
        ) : null}
        {resolved ? (
          <>
            <dt>Resolved</dt>
            <dd>{finding.resolvedAt ? `${ago(finding.resolvedAt)} ago` : '—'}</dd>
          </>
        ) : null}
        <dt>Ticket</dt>
        <dd>
          <TicketLink id={finding.ticketId} openTicket={openTicket} />
        </dd>
      </dl>
    </Inspector>
  );
}

/* ——————————————————————— AI answers (GEO) ——————————————————————— */

/** One row per buyer question: the questions in Settings first, then any older question with kept answers. */
function questionRows(data) {
  const map = new Map();
  for (const question of data?.questions ?? []) if (question.trim()) map.set(question, { question, tracked: true, runs: [] });
  for (const run of data?.runs ?? []) {
    const entry = map.get(run.question) ?? { question: run.question, tracked: false, runs: [] };
    entry.runs.push(run);
    map.set(run.question, entry);
  }
  return [...map.values()].map((entry) => {
    const runs = [...entry.runs].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : (b.id ?? 0) - (a.id ?? 0)));
    return { ...entry, runs, latest: runs[0] ?? null, named: runs.filter((run) => run.mentionsUs).length };
  });
}

const namedProps = (entry) =>
  !entry.latest
    ? { state: 'not_asked', tone: 'neutral', label: 'Not asked yet' }
    : entry.latest.mentionsUs
      ? { state: 'named', tone: 'ok', label: 'Named' }
      : { state: 'not_named', tone: 'neutral', label: 'Not named' };

function GeoTab({ desk }) {
  const { api, tick, run, busy } = desk;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api('GET', '/admin/seo/geo')
      .then((out) => {
        if (!live) return;
        setData(out);
        setError(null);
      })
      .catch((err) => live && setError(err));
    return () => {
      live = false;
    };
  }, [api, tick, attempt]);

  const rows = useMemo(() => questionRows(data), [data]);
  const { key, selected, select, close } = useSelection(rows, (entry) => entry.question);
  const retry = () => setAttempt((n) => n + 1);

  return (
    <SeoSplit
      onClose={close}
      inspector={selected ? <AnswerInspector entry={selected} onClose={close} onProbe={() => run('geo')} busy={busy} engineReady={data?.engineReady !== false} /> : null}
    >
      {data?.engineReady === false ? (
        <div className="aw-banner aw-banner--warn">
          The probe is off: the Worker has no DEEPSEEK_API_KEY. The desk keeps the questions, and the probe runs once the key is set.
        </div>
      ) : null}

      {data ? (
        <div className="aw-seo-strip">
          <StatRow
            items={[
              { label: 'mention rate', value: pct(data.summary.rate) },
              { label: 'mentions', value: data.summary.mentions },
              { label: 'answers', value: data.summary.runs },
              { label: 'questions asked weekly', value: data.questions.length },
            ]}
          />
        </div>
      ) : null}

      {error && data ? <ErrorNote error={error} onRetry={retry} /> : null}

      {data ? (
        <details className="ui-disclosure">
          <summary>
            Last 12 weeks
            <span className="ui-disclosure__hint">{pct(data.summary.rate)} of answers named us</span>
          </summary>
          <div className="ui-disclosure__body">
            <GeoChart weeks={data.weeks ?? []} />
          </div>
        </details>
      ) : null}

      <DataTable
        label="Buyer questions"
        state={!data && !error ? 'loading' : !data && error ? 'error' : 'ready'}
        error={error}
        onRetry={retry}
        rows={rows}
        rowKey={(entry) => entry.question}
        selected={key}
        onSelect={select}
        onOpen={select}
        empty={{ title: 'No questions set', hint: 'Add buyer questions in Settings and the weekly probe asks them.' }}
        columns={[
          {
            key: 'question',
            header: 'Question',
            render: (entry) => (
              <span title={entry.question}>
                {entry.question}
                {!entry.tracked ? <span className="ui-note"> · no longer asked</span> : null}
              </span>
            ),
          },
          { key: 'asked', header: 'Asked', numeric: true, render: (entry) => entry.runs.length },
          { key: 'named', header: 'Named us', fit: true, render: (entry) => <StateIndicator {...namedProps(entry)} title={entry.runs.length ? `${entry.named} of ${entry.runs.length} answers named us` : undefined} /> },
          { key: 'checked', header: 'Last checked', fit: true, render: (entry) => (entry.latest ? shortDay(entry.latest.day) : '—') },
        ]}
      />
      <p className="ui-note aw-seo-gap">
        Each weekly probe asks every question once and keeps whether the answer named us, the URLs it cited and the companies it named instead.
      </p>
    </SeoSplit>
  );
}

function AnswerInspector({ entry, onClose, onProbe, busy, engineReady }) {
  const [runId, setRunId] = useState(entry.latest?.id ?? null);
  useEffect(() => setRunId(entry.latest?.id ?? null), [entry.question, entry.latest?.id]);
  const shown = entry.runs.find((run) => run.id === runId) ?? entry.latest;
  const cited = shown?.citedUrls ?? [];
  const competitors = shown?.competitors ?? [];
  return (
    <Inspector title={entry.question} label="Buyer question" storageKey="ptech.seo.inspector.w" defaultWidth={SEO_INSPECTOR_W} onClose={onClose}>
      <p className="aw-seo-detail">{entry.question}</p>
      <div className="ui-meta">
        <StateIndicator {...namedProps(entry)} />
        {!entry.tracked ? <MetaChip>No longer asked</MetaChip> : null}
      </div>
      <div className="ui-actions">
        <Button
          disabled={Boolean(busy) || !engineReady}
          busy={busy === 'geo'}
          title={engineReady ? 'Asks every buyer question once; one paid DeepSeek call per question.' : 'The Worker has no DEEPSEEK_API_KEY.'}
          onClick={onProbe}
        >
          Run GEO probe…
        </Button>
      </div>
      <dl className="ui-props">
        <dt>Asked</dt>
        <dd>{plural(entry.runs.length, 'time', 'times')}</dd>
        <dt>Named us</dt>
        <dd>
          {entry.named} of {entry.runs.length}
        </dd>
        <dt>Last checked</dt>
        <dd>{entry.latest ? longDay(entry.latest.day) : 'Not asked yet'}</dd>
      </dl>

      {shown ? (
        <>
          <section className="ui-section">
            <SectionTitle>
              {shown.engine ?? 'Engine'} answer · {longDay(shown.day)}
            </SectionTitle>
            <div className="ui-meta">
              {shown.mentionsUs ? <StateIndicator state="named" tone="ok" label="Named us" /> : <StateIndicator state="not_named" tone="neutral" label="Did not name us" />}
            </div>
            <p className="ui-quote">{shown.answerExcerpt || 'No answer kept.'}</p>
          </section>
          <section className="ui-section">
            <SectionTitle>Cited URLs · {cited.length}</SectionTitle>
            {cited.length ? (
              <ul className="aw-seo-list">
                {cited.map((url) => (
                  <li key={url}>
                    <OutLink href={url}>{url}</OutLink>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ui-note">No URLs cited.</p>
            )}
          </section>
          <section className="ui-section">
            <SectionTitle>Named instead · {competitors.length}</SectionTitle>
            {competitors.length ? (
              <div className="ui-meta">
                {competitors.map((name) => (
                  <MetaChip key={name}>{name}</MetaChip>
                ))}
              </div>
            ) : (
              <p className="ui-note">No other companies named.</p>
            )}
          </section>
          {entry.runs.length > 1 ? (
            <section className="ui-section">
              <SectionTitle>Every answer</SectionTitle>
              <DataTable
                label="Answers to this question"
                rows={entry.runs}
                selected={shown.id}
                onSelect={(run) => setRunId(run.id)}
                onOpen={(run) => setRunId(run.id)}
                columns={[
                  { key: 'day', header: 'Day', render: (run) => longDay(run.day) },
                  {
                    key: 'named',
                    header: 'Named us',
                    fit: true,
                    render: (run) => (run.mentionsUs ? <StateIndicator state="named" tone="ok" label="Named" /> : <StateIndicator state="not_named" tone="neutral" label="Not named" />),
                  },
                ]}
              />
            </section>
          ) : null}
        </>
      ) : (
        <p className="ui-note aw-seo-gap">No answers yet. Run the GEO probe from the header; its answers land here.</p>
      )}
    </Inspector>
  );
}

/* ——————————————————————— rankings ——————————————————————— */

const changeText = (change) => (change === null || change === undefined ? '—' : change > 0 ? `▲ ${change}` : change < 0 ? `▼ ${Math.abs(change)}` : '0');

function RankingsTab({ desk }) {
  const { api, overview, refresh, tick, ask, notify } = desk;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api('GET', '/admin/seo/ranks')
        .then((out) => {
          setData(out);
          setError(null);
        })
        .catch(setError),
    [api],
  );

  useEffect(() => {
    void load();
  }, [load, tick]);

  const check = () =>
    ask({
      ...RUN_ASK.ranks,
      run: async () => {
        setBusy(true);
        try {
          const out = await api('POST', '/admin/seo/run', { what: 'ranks' });
          await load();
          await refresh();
          notify?.(runText(out));
        } finally {
          setBusy(false);
        }
      },
    });

  const rows = data?.rows ?? [];
  const { key, selected, select, close } = useSelection(rows, (row) => row.keyword);
  const location = data?.location ?? { locationCode: 2840, languageCode: 'en' };
  const checkButton = (
    <Button disabled={busy || Boolean(desk.busy)} busy={busy} title="DataForSEO charges about $0.006 per keyword at depth 100." onClick={check}>
      {busy ? 'Checking…' : 'Check rankings…'}
    </Button>
  );

  return (
    <SeoSplit
      onClose={close}
      inspector={selected ? <RankInspector row={selected} day={data?.latestDay} location={location} onClose={close} checkButton={checkButton} /> : null}
    >
      {data && !data.rankReady ? (
        <div className="aw-banner aw-banner--warn">
          Rank tracking is off. Add the DATAFORSEO_API_KEY secret to the intercom Worker (
          <span className="aw-mono">npx wrangler secret put DATAFORSEO_API_KEY</span>, run in <span className="aw-mono">worker/</span>) and the
          weekly check starts on the next cron tick.
        </div>
      ) : null}

      {data ? (
        <div className="aw-seo-strip">
          <StatRow
            items={[
              { label: 'average position', value: hasValue(data.avgPosition) ? data.avgPosition : '—' },
              { label: 'in the top 10', value: data.inTop10 ?? 0 },
              { label: 'in the top 100', value: data.inTop100 ?? 0 },
              { label: 'swing', value: swingText(data.swing), hint: 'Week over week; a few positions is normal' },
              {
                label: 'keywords',
                value: plural((data.keywords ?? []).length, 'keyword', 'keywords'),
                hint: `DataForSEO location ${location.locationCode}/${location.languageCode}`,
              },
              ...(data.pending ? [{ label: 'queued', value: plural(data.pending, 'task', 'tasks') }] : []),
            ]}
          />
        </div>
      ) : null}

      {error && data ? <ErrorNote error={error} onRetry={load} /> : null}

      {data ? (
        <details className="ui-disclosure">
          <summary>
            Average position, last 90 days
            <span className="ui-disclosure__hint">{data.latestDay ? `Checked ${longDay(data.latestDay)}` : 'Not checked yet'} · lower is better</span>
          </summary>
          <div className="ui-disclosure__body">
            <RankChart series={data.series ?? []} events={overview.events ?? []} today={overview.day} />
          </div>
        </details>
      ) : null}

      <DataTable
        label="Tracked keywords"
        state={!data && !error ? 'loading' : !data && error ? 'error' : 'ready'}
        error={error}
        onRetry={load}
        rows={rows}
        rowKey={(row) => row.keyword}
        selected={key}
        onSelect={select}
        onOpen={select}
        empty={{
          title: 'No rank check yet',
          hint: data?.rankReady ? 'Check rankings now or wait for the weekly cron.' : 'Add the DATAFORSEO_API_KEY secret, then check rankings.',
          action: data?.rankReady ? checkButton : null,
        }}
        columns={[
          { key: 'keyword', header: 'Keyword', render: (row) => <span title={row.keyword}>{row.keyword}</span> },
          {
            key: 'position',
            header: 'Position',
            numeric: true,
            render: (row) => (row.position === null ? <span title="Not in the top 100">—</span> : row.position),
          },
          {
            key: 'change',
            header: 'Change',
            numeric: true,
            render: (row) => <span title={row.prevPosition === null || row.prevPosition === undefined ? 'No check last week' : `Was #${row.prevPosition} last week`}>{changeText(row.change)}</span>,
          },
          { key: 'checked', header: 'Last checked', fit: true, render: () => (data?.latestDay ? shortDay(data.latestDay) : '—') },
        ]}
      />
      <p className="ui-note aw-seo-gap">
        The weekly check asks Google Organic for every tracked keyword (United States, English, top 100). A keyword we are not in the top 100 for is
        kept as a row with no position, so the swing stays honest.
      </p>
    </SeoSplit>
  );
}

function RankInspector({ row, day, location, onClose, checkButton }) {
  const top = row.topDomains ?? [];
  const position = row.position === null || row.position === undefined ? 'Not in the top 100' : `#${row.position}`;
  const previous = row.prevPosition === null || row.prevPosition === undefined ? 'No check' : `#${row.prevPosition}`;
  return (
    <Inspector title={row.keyword} label={`Keyword ${row.keyword}`} storageKey="ptech.seo.inspector.w" defaultWidth={SEO_INSPECTOR_W} onClose={onClose}>
      <div className="ui-meta">
        <span>
          Position <strong>{position}</strong>
        </span>
        {row.change ? <span>{changeText(row.change)} since last week</span> : null}
      </div>
      <div className="ui-actions">{checkButton}</div>
      <section className="ui-section">
        <SectionTitle>History</SectionTitle>
        <dl className="ui-props">
          <dt>This check</dt>
          <dd>
            {position}
            {day ? <span className="ui-note"> · {longDay(day)}</span> : null}
          </dd>
          <dt>Last week</dt>
          <dd>{previous}</dd>
          <dt>Change</dt>
          <dd>{row.change === null || row.change === undefined ? '—' : row.change === 0 ? 'No change' : changeText(row.change)}</dd>
          <dt>Ranking URL</dt>
          <dd>{row.url ? <OutLink href={row.url}>{row.url}</OutLink> : <span className="ui-note">—</span>}</dd>
          <dt>Location</dt>
          <dd>
            {location.locationCode}/{location.languageCode}
          </dd>
        </dl>
        <p className="ui-note aw-seo-gap">The desk keeps this check and last week’s per keyword; the 90-day line on this tab averages every keyword.</p>
      </section>
      <section className="ui-section">
        <SectionTitle>Top competitors · {top.length}</SectionTitle>
        {top.length ? (
          <ol className="aw-seo-list aw-seo-list--ranked">
            {top.map((domain) => (
              <li key={domain}>
                <span className="aw-mono">{domain}</span>
                {isOurDomain(domain) ? <MetaChip>Us</MetaChip> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="ui-note">No organic results were in the top 100.</p>
        )}
      </section>
    </Inspector>
  );
}

/* ——————————————————————— citations ——————————————————————— */

function CitationsTab({ desk, onClaimPrimary }) {
  const { api, tick, notify } = desk;
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(null);

  const load = useCallback(
    () =>
      api('GET', '/admin/seo/citations')
        .then((out) => {
          setData(out);
          setError(null);
        })
        .catch((err) => setError(err)),
    [api],
  );

  useEffect(() => {
    void load();
  }, [load, tick]);

  const draftFor = (citation) =>
    drafts[citation.id] ?? { status: citation.status, profile_url: citation.profileUrl ?? '', note: citation.note ?? '' };
  const edit = (citation, patch) => setDrafts((prev) => ({ ...prev, [citation.id]: { ...draftFor(citation), ...patch } }));
  const dirty = (citation) => {
    const draft = draftFor(citation);
    return draft.status !== citation.status || draft.profile_url !== (citation.profileUrl ?? '') || draft.note !== (citation.note ?? '');
  };
  const discard = (citation) =>
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[citation.id];
      return next;
    });

  const save = async (citation) => {
    const draft = draftFor(citation);
    setSaving(citation.id);
    try {
      await api('POST', `/admin/seo/citations/${citation.id}`, {
        status: draft.status,
        profile_url: draft.profile_url,
        note: draft.note,
      });
      discard(citation);
      await load();
      notify?.(`${citation.platform} saved.`);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(null);
    }
  };

  const copy = async (text) => {
    if (!text) return notify?.('Nothing to copy yet.');
    try {
      await navigator.clipboard.writeText(text);
      notify?.('Draft copied.');
    } catch {
      notify?.('Could not copy. Select the text and copy it by hand.', 'error');
    }
  };

  const ordered = useMemo(() => {
    const list = [...(data?.citations ?? [])];
    return list.sort(
      (a, b) =>
        (CITATION_RANK[a.status] ?? 9) - (CITATION_RANK[b.status] ?? 9) ||
        (b.dr ?? -1) - (a.dr ?? -1) ||
        a.platform.localeCompare(b.platform),
    );
  }, [data]);
  const { key, selected, select, close } = useSelection(ordered, (citation) => citation.id);

  const selectedDirty = Boolean(selected && dirty(selected));
  useEffect(() => {
    onClaimPrimary?.(selectedDirty);
  }, [selectedDirty, onClaimPrimary]);
  useEffect(() => () => onClaimPrimary?.(false), [onClaimPrimary]);

  const counts = data?.counts ?? { todo: 0, drafted: 0, live: 0, verified: 0, skipped: 0, total: 0 };

  return (
    <SeoSplit
      onClose={close}
      inspector={
        selected ? (
          <CitationInspector
            citation={selected}
            draft={draftFor(selected)}
            statuses={data?.statuses ?? CITATION_STATUSES}
            changed={selectedDirty}
            saving={saving === selected.id}
            onEdit={(patch) => edit(selected, patch)}
            onSave={() => save(selected)}
            onDiscard={() => discard(selected)}
            onCopy={() => copy(draftFor(selected).note)}
            onClose={close}
          />
        ) : null
      }
    >
      {data ? (
        <div className="aw-seo-strip">
          <StatRow
            items={[
              { label: 'to do', value: counts.todo },
              { label: 'drafted', value: counts.drafted },
              { label: 'live', value: counts.live },
              { label: 'verified', value: counts.verified },
              { label: 'skipped', value: counts.skipped },
              { label: 'placements', value: counts.total ?? ordered.length },
            ]}
          />
        </div>
      ) : null}

      {error && data ? <ErrorNote error={error} onRetry={load} /> : null}

      <DataTable
        label="Citations"
        state={!data && !error ? 'loading' : !data && error ? 'error' : 'ready'}
        error={error}
        onRetry={load}
        rows={ordered}
        rowKey={(citation) => citation.id}
        selected={key}
        onSelect={select}
        onOpen={select}
        empty={{ title: 'No placements seeded', hint: 'The desk seeds its own profile placements; nothing to show yet.' }}
        columns={[
          {
            key: 'platform',
            header: 'Profile',
            render: (citation) => (
              <span title={citation.domain}>
                {citation.platform}
                <span className="ui-note"> {citation.domain}</span>
              </span>
            ),
          },
          { key: 'dr', header: 'DR', numeric: true, render: (citation) => citation.dr ?? '—' },
          {
            key: 'state',
            header: 'State',
            fit: true,
            render: (citation) => (
              <>
                <StateIndicator {...citationProps(citation.status)} />
                {dirty(citation) ? <span className="ui-note"> · unsaved</span> : null}
              </>
            ),
          },
          {
            key: 'verified',
            header: 'Link verified',
            fit: true,
            render: (citation) => (
              <span title={citation.lastChecked ? `Last checked ${when(citation.lastChecked)}` : 'Not checked yet'}>
                {citation.linkVerifiedAt ? instantDay(citation.linkVerifiedAt) : '—'}
              </span>
            ),
          },
        ]}
      />
      <p className="ui-note aw-seo-gap">
        To do and drafted rows come first, then the higher DR. The weekly check reads each profile URL; a page that no longer links back loses its
        verified date, a page that cannot be read keeps it.
      </p>
    </SeoSplit>
  );
}

function CitationInspector({ citation, draft, statuses, changed, saving, onEdit, onSave, onDiscard, onCopy, onClose }) {
  return (
    <Inspector title={citation.platform} label={`Citation ${citation.platform}`} storageKey="ptech.seo.inspector.w" defaultWidth={SEO_INSPECTOR_W} onClose={onClose}>
      <div className="ui-meta">
        <StateIndicator {...citationProps(citation.status)} />
        <span>{citation.domain}</span>
        {citation.dr != null ? <span>DR <strong>{citation.dr}</strong></span> : null}
      </div>
      <dl className="ui-props aw-seo-gap">
        <dt>Link verified</dt>
        <dd>{citation.linkVerifiedAt ? instantDay(citation.linkVerifiedAt) : 'Not verified'}</dd>
        <dt>Last checked</dt>
        <dd>{citation.lastChecked ? when(citation.lastChecked) : 'Not checked yet'}</dd>
        {citation.profileUrl ? (
          <>
            <dt>Profile</dt>
            <dd>
              <OutLink href={citation.profileUrl}>{citation.profileUrl}</OutLink>
            </dd>
          </>
        ) : null}
      </dl>
      <FormPane className="aw-seo-form">
        <Field label="Status">
          <select value={draft.status} aria-label={`Status for ${citation.platform}`} onChange={(event) => onEdit({ status: event.target.value })}>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {CITATION_OPTION[status] ?? status}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Profile URL">
          <input
            type="url"
            value={draft.profile_url}
            placeholder="https://…"
            aria-label={`Profile URL for ${citation.platform}`}
            onChange={(event) => onEdit({ profile_url: event.target.value })}
          />
        </Field>
        <Field label="Note or draft" hint="The bio or link text to paste into the profile.">
          <textarea
            rows={6}
            value={draft.note}
            placeholder="Draft bio or link text"
            aria-label={`Note or draft for ${citation.platform}`}
            onChange={(event) => onEdit({ note: event.target.value })}
          />
        </Field>
      </FormPane>
      <div className="ui-actions">
        <Button kind={changed ? 'primary' : 'default'} disabled={!changed || saving} busy={saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {changed ? (
          <Button kind="ghost" disabled={saving} onClick={onDiscard}>
            Discard
          </Button>
        ) : null}
        <Button kind="ghost" onClick={onCopy}>
          Copy draft
        </Button>
      </div>
    </Inspector>
  );
}

/* ——————————————————————— settings ——————————————————————— */

/**
 * Settings → SEO: cycles, guides, buyer questions, rank tracking and events in
 * one bounded form with one SaveBar. Reads the desk overview itself, so it
 * works wherever Settings is mounted. Events save on their own (add/delete).
 */
export function SeoSettings({ onDirtyChange }) {
  const { api, notify } = useAdmin();
  const [overview, setOverview] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const load = useCallback(
    () =>
      api('GET', '/admin/seo/overview')
        .then((data) => {
          setOverview(data);
          setLoadError(null);
        })
        .catch(setLoadError),
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  if (!overview) return loadError ? <ErrorNote error={loadError} onRetry={load} /> : <Loading label="Loading SEO settings…" />;
  return <SeoSettingsForm api={api} overview={overview} refresh={load} notify={notify} onDirtyChange={onDirtyChange} />;
}

function SeoSettingsForm({ api, overview, refresh, notify, onDirtyChange }) {
  const [draft, setDraft] = useState(overview.settings);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [eventForm, setEventForm] = useState({ kind: 'core_update', label: '', day: '' });
  const [eventBusy, setEventBusy] = useState(false);

  useEffect(() => {
    if (!touched) setDraft(overview.settings);
  }, [overview.settings, touched]);

  const set = (key, value) => {
    setTouched(true);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const questions = draft.geoQuestions ?? [];
  const usedQuestions = questions.filter((question) => question.trim()).length;
  const keywords = draft.rankKeywords ?? [];
  const location = draft.rankLocation ?? { locationCode: 2840, languageCode: 'en' };
  const changed =
    draft.autoCycle !== overview.settings.autoCycle ||
    draft.volatilityHold !== overview.settings.volatilityHold ||
    Boolean(draft.guidesAuto) !== Boolean(overview.settings.guidesAuto) ||
    Number(draft.guidesPerWeek) !== Number(overview.settings.guidesPerWeek) ||
    Boolean(draft.guidesAutoMerge) !== Boolean(overview.settings.guidesAutoMerge) ||
    (draft.geoQuestions ?? []).join('\n') !== (overview.settings.geoQuestions ?? []).join('\n') ||
    keywords.join('\n') !== (overview.settings.rankKeywords ?? []).join('\n') ||
    location.locationCode !== overview.settings.rankLocation?.locationCode ||
    location.languageCode !== overview.settings.rankLocation?.languageCode;

  useEffect(() => {
    onDirtyChange?.(changed);
  }, [changed, onDirtyChange]);

  const save = async () => {
    if (!changed || saving) return;
    setSaving(true);
    setMessage(null);
    setSaveError(null);
    try {
      const out = await api('POST', '/admin/seo/settings', {
        autoCycle: draft.autoCycle,
        volatilityHold: draft.volatilityHold,
        guidesAuto: draft.guidesAuto,
        guidesPerWeek: draft.guidesPerWeek,
        guidesAutoMerge: draft.guidesAutoMerge,
        geoQuestions: draft.geoQuestions,
        rankKeywords: draft.rankKeywords,
        rankLocation: draft.rankLocation,
      });
      setDraft(out.settings);
      setTouched(false);
      if (out.rejected?.length) setMessage({ tone: 'warn', text: `Saved, but these fields were rejected: ${out.rejected.join(', ')}.` });
      await refresh();
      notify?.('SEO settings saved.');
    } catch (error) {
      setSaveError(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setDraft(overview.settings);
    setTouched(false);
    setMessage(null);
    setSaveError(null);
  };

  const addEvent = async () => {
    if (!eventForm.label.trim()) {
      setMessage({ tone: 'bad', text: 'Write a label for the event first.' });
      return;
    }
    setEventBusy(true);
    try {
      const body = { kind: eventForm.kind, label: eventForm.label.trim() };
      if (eventForm.day) body.day = eventForm.day;
      await api('POST', '/admin/seo/events', body);
      setEventForm({ kind: 'core_update', label: '', day: '' });
      setMessage({ tone: 'ok', text: 'Event added.' });
      await refresh();
    } catch (error) {
      setMessage({ tone: 'bad', text: errorText(error) });
    } finally {
      setEventBusy(false);
    }
  };

  const removeEvent = async (event) => {
    try {
      await api('DELETE', `/admin/seo/events/${event.id}`);
      setMessage({ tone: 'ok', text: 'Event deleted.' });
      await refresh();
    } catch (error) {
      setMessage({ tone: 'bad', text: errorText(error) });
    }
  };

  return (
    <>
      <FormPane className="aw-settings-form">
      {message ? (
        <p className={message.tone === 'ok' ? 'aw-muted' : 'aw-warn'} role="status">
          {message.text}
        </p>
      ) : null}
      <Panel title="Cycle" subtitle="What the desk does on its own, and when it holds off.">
          <Field label="Automatic cycles" hint="On: the desk files a ticket for the worst open findings when none is open.">
            <Segmented
              label="Automatic cycles"
              value={Boolean(draft.autoCycle)}
              options={[
                { value: true, label: 'On' },
                { value: false, label: 'Off' },
              ]}
              onChange={(value) => set('autoCycle', value)}
            />
          </Field>
          <Field
            label="Volatility hold"
            hint="On: after a Google core update the agent only does technical fixes, because rankings swing during the update and a rewrite hides what worked."
          >
            <Segmented
              label="Volatility hold"
              value={Boolean(draft.volatilityHold)}
              options={[
                { value: true, label: 'On' },
                { value: false, label: 'Off' },
              ]}
              onChange={(value) => set('volatilityHold', value)}
            />
          </Field>
      </Panel>

      <Panel title="Guides" subtitle="One guide per rank keyword and buyer question, filed within the weekly limit.">
          <Field label="Automatic guide cycles" hint="On: the desk files a ticket for the first target no guide answers, within the weekly limit below.">
            <Segmented
              label="Automatic guide cycles"
              value={Boolean(draft.guidesAuto)}
              options={[
                { value: true, label: 'On' },
                { value: false, label: 'Off' },
              ]}
              onChange={(value) => set('guidesAuto', value)}
            />
          </Field>
          <Field label="Guides per week" hint="How many guide cycles a week at most, 0 to 7. A target waits three weeks between attempts.">
            <input inputMode="numeric" className="aw-settings-num" min="0" max="7" value={draft.guidesPerWeek ?? 2} onChange={(event) => set('guidesPerWeek', Number(event.target.value))} />
          </Field>
          <Field label="Auto-merge guide PRs" hint="On: a guide PR that passes the checks and the content gate merges itself and pings IndexNow. Off: it waits for you on GitHub.">
            <Segmented
              label="Auto-merge guide PRs"
              value={Boolean(draft.guidesAutoMerge)}
              options={[
                { value: true, label: 'On' },
                { value: false, label: 'Off' },
              ]}
              onChange={(value) => set('guidesAutoMerge', value)}
            />
          </Field>
      </Panel>

      <Panel title="Buyer questions">
        <Field label="Questions for the weekly GEO probe" hint={`One per line, at most 20. ${usedQuestions} used.`}>
          <textarea rows={10} value={questions.join('\n')} onChange={(event) => set('geoQuestions', event.target.value.split('\n').slice(0, 20))} />
        </Field>
      </Panel>

      <Panel
        title="Google ranks"
        actions={overview.rank?.rankReady ? <StateIndicator state="tracking_on" tone="ok" label="Tracking on" /> : <StateIndicator state="no_key" tone="bad" label="No API key" />}
      >
        {!overview.rank?.rankReady ? (
          <p className="aw-muted">
            Rank tracking is off. Add the DATAFORSEO_API_KEY secret to the intercom Worker (
            <span className="aw-mono">npx wrangler secret put DATAFORSEO_API_KEY</span>, run in <span className="aw-mono">worker/</span>).
          </p>
        ) : null}
        <Field
          label="Keywords to track on Google"
          hint={`One per line, at most 25. ${keywords.filter((keyword) => keyword.trim()).length} used. DataForSEO charges about $0.006 per keyword at depth 100.`}
        >
          <textarea rows={10} value={keywords.join('\n')} onChange={(event) => set('rankKeywords', event.target.value.split('\n').slice(0, 25))} />
        </Field>
          <Field label="Location code" hint="DataForSEO's Google location: 2840 is the United States.">
            <input
              type="number"
              className="aw-settings-num"
              min="1"
              value={location.locationCode ?? 2840}
              onChange={(event) => set('rankLocation', { ...location, locationCode: Number(event.target.value) })}
            />
          </Field>
          <Field label="Language code" hint="The search language, for example en.">
            <input className="aw-settings-num" value={location.languageCode ?? 'en'} onChange={(event) => set('rankLocation', { ...location, languageCode: event.target.value })} />
          </Field>
      </Panel>

      <Panel
        title="Events"
        subtitle="Core updates, algorithm updates, fixes and notes. The score line marks them, and a core update in the last 14 days holds content rewrites."
      >
        <div className="aw-inline aw-seo-events-form">
          <select value={eventForm.kind} aria-label="Event kind" onChange={(event) => setEventForm((form) => ({ ...form, kind: event.target.value }))}>
            {EVENT_KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
          <input
            value={eventForm.label}
            placeholder="Label, for example Google core update started"
            aria-label="Event label"
            onChange={(event) => setEventForm((form) => ({ ...form, label: event.target.value }))}
          />
          <input type="date" value={eventForm.day} aria-label="Event day" onChange={(event) => setEventForm((form) => ({ ...form, day: event.target.value }))} />
          <Button disabled={eventBusy} onClick={addEvent}>
            {eventBusy ? 'Adding…' : 'Add event'}
          </Button>
        </div>
        {(overview.events ?? []).length ? (
          <ul className="aw-rows">
            {overview.events.map((event) => (
              <li key={event.id} className="aw-seo-row">
                <MetaChip>{EVENT_LABEL[event.kind] ?? event.kind}</MetaChip>
                <span className="aw-row__title">{event.label}</span>
                <span className="aw-muted">
                  {longDay(event.day)}
                  {event.source ? ` · ${event.source}` : ''}
                </span>
                <span className="aw-toolbar__fill" />
                <Button size="sm" kind="ghost" onClick={() => removeEvent(event)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No events yet" hint="Add a core update so the score chart shows when the SERP was moving." />
        )}
      </Panel>

      </FormPane>
      <SaveBar
        dirty={changed}
        saving={saving}
        error={saveError}
        onSave={save}
        onDiscard={reset}
        saveLabel="Save SEO settings"
        discardLabel="Discard"
      />
    </>
  );
}
