/*
 * The SEO desk: how our own two hosts look to search engines and to
 * assistants, what is wrong with them, and what we did about it.
 *
 * Everything here reads worker/src/seo.ts through api(method, path, body).
 * Days are UTC calendar days ('YYYY-MM-DD'); times are unix seconds.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useAdmin, usePoll } from './store.js';
import { ago, errorText, when } from './format.js';
import { Badge, Button, Empty, ErrorNote, Field, Loading, Panel, Segmented, StatRow, Tag } from './ui.jsx';

const DAY = 86_400_000;

const SEVERITY_TONE = { high: 'bad', medium: 'warn', low: 'dash' };
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
const CITATION_STATUSES = ['todo', 'drafted', 'live', 'verified', 'skipped'];
const CITATION_RANK = { todo: 0, drafted: 1, live: 2, verified: 3, skipped: 4 };
const EVENT_KINDS = [
  { value: 'core_update', label: 'Core update' },
  { value: 'algorithm_update', label: 'Algorithm update' },
  { value: 'fix', label: 'Fix' },
  { value: 'note', label: 'Note' },
];
const EVENT_TONE = { core_update: 'warn', algorithm_update: 'warn', fix: 'ok', note: 'dash', guide: 'ok', indexnow: 'dash' };
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
const instantDay = (unix) => (unix ? new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
const scoreTone = (score) => (score >= 90 ? 'ok' : score >= 70 ? 'warn' : 'bad');
const positionTone = (position) => (position === null || position === undefined ? 'dash' : position <= 10 ? 'ok' : position <= 30 ? 'warn' : 'dash');
/** A swing of a few positions is normal; 8+ means the SERP itself is moving. */
const swingTone = (swing) => (swing === null || swing === undefined ? 'dash' : swing >= 8 ? 'bad' : swing >= 3 ? 'warn' : 'ok');
const swingText = (swing) =>
  swing === null || swing === undefined ? 'no swing yet' : `±${swing} position${swing === 1 ? '' : 's'} week over week`;

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
/** A run's badge is quiet when it happened inside its cadence, warn when late. */
const runTone = (at, days) => (!at ? 'warn' : Date.now() / 1000 - at > days * 86_400 ? 'warn' : 'ok');

/** A ticket opens in the workbench the same way every other view opens one. */
function TicketLink({ id, openTicket }) {
  if (!id) return <span className="aw-muted">-</span>;
  return (
    <a
      href={`#ticket=${id}`}
      className="aw-link"
      onClick={(event) => {
        event.preventDefault();
        openTicket?.(id);
      }}
    >
      #{id}
    </a>
  );
}

export function SeoView() {
  const { api, ask, notify, openTicket } = useAdmin();
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('overview');
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(null);

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

  if (error && !overview) return <ErrorNote error={error} onRetry={load} />;
  if (!overview) return <Loading label="Loading the SEO desk…" />;

  const hosts = overview.hostsAvailable ?? overview.hosts.map((h) => h.host);
  const state = overview.state ?? {};
  const runs = [
    { key: 'audit', at: state.lastAuditAt, days: 2 },
    { key: 'GEO probe', at: state.lastGeoAt, days: 8 },
    { key: 'citations', at: state.lastCitationsAt, days: 8 },
    { key: 'rankings', at: state.lastRanksAt, days: 8 },
  ];

  return (
    <div className="aw-view aw-seo">
      <header className="aw-seo-head">
        <div className="aw-seo-head__titles">
          <h2>SEO</h2>
          <p>Our own hosts, checked daily: search scores, open fixes, the questions buyers ask assistants, and the profiles that link back.</p>
        </div>
        <div className="aw-seo-head__runs" aria-label="Last runs">
          {runs.map((last) => (
            <Badge key={last.key} tone={runTone(last.at, last.days)}>
              {last.key} · {last.at ? `${ago(last.at)} ago` : 'not yet'}
            </Badge>
          ))}
        </div>
        <div className="aw-seo-head__actions">
          <Button kind="primary" disabled={Boolean(busy)} onClick={() => run('audit')}>
            {busy === 'audit' ? 'Running…' : 'Run audit'}
          </Button>
          <Button disabled={Boolean(busy)} onClick={() => run('geo')}>
            {busy === 'geo' ? 'Running…' : 'Run GEO probe'}
          </Button>
          <Button disabled={Boolean(busy)} onClick={() => run('citations')}>
            {busy === 'citations' ? 'Checking…' : 'Check citations'}
          </Button>
          <Button disabled={Boolean(busy)} onClick={() => run('cycle')}>
            {busy === 'cycle' ? 'Filing…' : 'Run cycle now'}
          </Button>
        </div>
      </header>

      {error ? <ErrorNote error={error} onRetry={load} /> : null}

      <div className="aw-toolbar">
        <Segmented
          label="SEO desk section"
          value={tab}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'audit', label: 'Audit' },
            { value: 'answers', label: 'AI answers' },
            { value: 'ranks', label: 'Rankings' },
            { value: 'citations', label: 'Citations' },
            { value: 'settings', label: 'Settings' },
          ]}
          onChange={setTab}
        />
      </div>

      {tab === 'overview' ? (
        <OverviewTab overview={overview} api={api} ask={ask} notify={notify} refresh={refresh} openTicket={openTicket} />
      ) : null}
      {tab === 'audit' ? <AuditTab api={api} hosts={hosts} tick={tick} openTicket={openTicket} refresh={refresh} notify={notify} /> : null}
      {tab === 'answers' ? <GeoTab api={api} tick={tick} /> : null}
      {tab === 'ranks' ? <RankingsTab api={api} overview={overview} refresh={refresh} tick={tick} ask={ask} notify={notify} /> : null}
      {tab === 'citations' ? <CitationsTab api={api} tick={tick} notify={notify} /> : null}
      {tab === 'settings' ? <SettingsTab api={api} overview={overview} refresh={refresh} notify={notify} /> : null}
    </div>
  );
}

/* ——————————————————————— overview ——————————————————————— */

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

function OverviewTab({ overview, api, ask, notify, refresh, openTicket }) {
  const [guideBusy, setGuideBusy] = useState(false);
  const [showAllGuides, setShowAllGuides] = useState(false);
  const held = overview.cycle?.held;

  const writeGuide = () =>
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
    });

  const coverage = overview.coverage ?? [];
  const covered = coverage.filter((entry) => entry.guide).length;
  const guideShown = showAllGuides ? coverage : coverage.slice(0, 5);
  const rank = overview.rank ?? {};

  return (
    <>
      {held?.held ? (
        <div className="aw-banner aw-banner--warn">
          Google core update in progress: content rewrites paused until {longDay(held.until)}.
          {held.since ? <span className="aw-muted"> Started {longDay(held.since)}.</span> : null}
        </div>
      ) : null}

      <div className="aw-grid2">
        {overview.hosts.map((host) => (
          <Panel
            key={host.host}
            title={host.host}
            subtitle={host.day ? `Audited ${shortDay(host.day)}` : 'No audit yet'}
            actions={
              <>
                <Badge tone={scoreTone(host.averageScore)}>{host.averageScore} average</Badge>
                <Badge>{plural(host.pages, 'page', 'pages')}</Badge>
              </>
            }
          >
            <ScoreChart series={host.series ?? []} events={overview.events ?? []} today={overview.day} />
            <StatRow
              items={[
                { label: 'high', value: host.findings.high, tone: host.findings.high ? 'bad' : undefined },
                { label: 'medium', value: host.findings.medium, tone: host.findings.medium ? 'warn' : undefined },
                { label: 'low', value: host.findings.low },
                { label: 'open', value: host.findings.open, tone: host.findings.open ? 'warn' : 'ok' },
              ]}
            />
          </Panel>
        ))}
      </div>

      <div className="aw-grid2">
        <Panel
          title="Assistant mentions"
          subtitle="Whether the assistants name us when buyers ask"
          actions={<Badge tone={overview.geo.rate ? 'ok' : 'neutral'}>{pct(overview.geo.rate)} mention rate</Badge>}
        >
          <StatRow
            items={[
              { label: 'mentions', value: overview.geo.mentions, hint: overview.geo.mentions ? 'Answers that named us' : undefined },
              { label: 'answers', value: overview.geo.runs },
            ]}
          />
          <GeoChart weeks={overview.geo.weeks ?? []} />
        </Panel>

        <Panel title="Citations" subtitle="Profile placements that can link back. A weekly check keeps the verified ones honest.">
          <StatRow
            items={[
              { label: 'to do', value: overview.citations.todo, tone: overview.citations.todo ? 'warn' : undefined },
              { label: 'drafted', value: overview.citations.drafted },
              { label: 'live', value: overview.citations.live },
              { label: 'verified', value: overview.citations.verified, tone: overview.citations.verified ? 'ok' : undefined },
              { label: 'skipped', value: overview.citations.skipped },
            ]}
          />
        </Panel>
      </div>

      <Panel
        title="Google rankings"
        actions={<Badge tone={rank.rankReady ? 'ok' : 'bad'}>{rank.rankReady ? 'tracking on' : 'no API key'}</Badge>}
      >
        <StatRow
          items={[
            {
              label: 'average position',
              value: rank.avgPosition === null || rank.avgPosition === undefined ? '—' : rank.avgPosition,
              tone: rank.avgPosition === null || rank.avgPosition === undefined ? undefined : rank.avgPosition <= 20 ? 'ok' : 'warn',
            },
            { label: 'in the top 10', value: rank.inTop10 ?? 0, tone: rank.inTop10 ? 'ok' : undefined },
            { label: 'in the top 100', value: rank.inTop100 ?? 0, tone: rank.inTop100 ? undefined : 'warn' },
            { label: 'swing', value: swingText(rank.swing), hint: 'Week over week; a few positions is normal' },
            { label: 'keywords', value: plural(rank.keywords ?? 0, 'keyword', 'keywords') },
            ...(rank.pending ? [{ label: 'queued', value: plural(rank.pending, 'task', 'tasks'), tone: 'warn' }] : []),
          ]}
        />
        <p className="aw-muted aw-seo-note">
          {rank.rankReady
            ? `Weekly Google positions for the keywords we sell against, last checked ${rank.latestDay ? shortDay(rank.latestDay) : 'never'}.`
            : 'Add the DATAFORSEO_API_KEY secret to the intercom Worker to turn rank tracking on.'}
        </p>
      </Panel>

      <Panel title="Fix cycle">
        <StatRow
          items={[
            { label: 'auto cycle', value: overview.cycle.auto ? 'on' : 'off', tone: overview.cycle.auto ? 'ok' : undefined },
            {
              label: 'open at medium or above',
              value: overview.cycle.openFindings,
              tone: overview.cycle.openFindings ? 'warn' : 'ok',
            },
            { label: 'due', value: overview.cycle.wouldFile ? 'a cycle would file' : 'no cycle due', tone: overview.cycle.wouldFile ? 'warn' : undefined },
          ]}
        />
        <p>
          Open ticket:{' '}
          {overview.cycle.openTicketId ? (
            <TicketLink id={overview.cycle.openTicketId} openTicket={openTicket} />
          ) : (
            <span className="aw-muted">none</span>
          )}
          {held?.held ? <span className="aw-muted"> · rewrites pause until {longDay(held.until)}</span> : null}
        </p>
      </Panel>

      <Panel
        title="Guide coverage"
        actions={
          <>
            <Badge tone={coverage.length && covered === coverage.length ? 'ok' : 'warn'}>
              {covered} of {coverage.length} targets have a page
            </Badge>
            <Button size="sm" disabled={guideBusy} onClick={writeGuide}>
              {guideBusy ? 'Filing…' : 'Write a guide now'}
            </Button>
          </>
        }
      >
        <p className="aw-muted">
          Every rank keyword and buyer question gets a guide on ptechsolutions.net.{' '}
          {overview.guidesAt ? `guides.json was read ${ago(overview.guidesAt)} ago.` : 'The site has not been read for guides yet.'}
        </p>
        {coverage.length ? (
          <>
            <ul className="aw-rows">
              {guideShown.map((entry) => (
                <li key={`${entry.kind}:${entry.target}`} className="aw-seo-row">
                  <Tag tone={entry.kind === 'keyword' ? 'dash' : 'warn'}>{entry.kind}</Tag>
                  <span className="aw-row__title">{entry.target}</span>
                  <span className="aw-toolbar__fill" />
                  {entry.guide ? (
                    <a href={entry.guide.url} target="_blank" rel="noreferrer">
                      {entry.guide.title}
                    </a>
                  ) : entry.inProgress ? (
                    <span className="aw-muted">
                      writing <TicketLink id={entry.inProgress} openTicket={openTicket} />
                    </span>
                  ) : entry.lastAttemptAt ? (
                    <span className="aw-muted">attempted {instantDay(entry.lastAttemptAt)}</span>
                  ) : (
                    <span className="aw-muted">No page yet</span>
                  )}
                </li>
              ))}
            </ul>
            {coverage.length > 5 ? (
              <div className="aw-seo-guides__more">
                <Button size="sm" kind="ghost" aria-expanded={showAllGuides} onClick={() => setShowAllGuides((shown) => !shown)}>
                  {showAllGuides ? 'Show fewer' : `Show all (${coverage.length})`}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <Empty title="No guide targets yet" hint="Add rank keywords or buyer questions in Settings and the desk starts filing guide cycles." />
        )}
      </Panel>
    </>
  );
}

/* ——————————————————————— charts ——————————————————————— */

function ScoreChart({ series, events, today }) {
  const end = today ?? series.at(-1)?.day;
  const endNumber = dayNumber(end);
  if (!series.length || !Number.isFinite(endNumber)) return <Empty title="No audit series yet" hint="The chart fills in once a daily audit has run." />;

  const width = 560;
  const height = 170;
  const left = 30;
  const right = 8;
  const top = 10;
  const bottom = 24;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const start = endNumber - 29;
  const xOf = (n) => left + ((n - start) / 29) * innerW;
  const yOf = (score) => top + (1 - Math.max(0, Math.min(100, score)) / 100) * innerH;
  const points = series
    .map((point) => ({ ...point, n: dayNumber(point.day) }))
    .filter((point) => Number.isFinite(point.n) && point.n >= start && point.n <= endNumber)
    .sort((a, b) => a.n - b.n);
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${xOf(point.n).toFixed(1)},${yOf(point.averageScore).toFixed(1)}`).join(' ');
  const marks = (events ?? [])
    .map((event) => ({ ...event, n: dayNumber(event.day) }))
    .filter((event) => Number.isFinite(event.n) && event.n >= start && event.n <= endNumber);
  const markColour = (kind) =>
    kind === 'fix' || kind === 'guide' ? 'var(--aw-ok)' : kind === 'note' || kind === 'indexnow' ? 'var(--aw-text2)' : 'var(--aw-warn)';

  return (
    <div className="aw-seo-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Average score, last 30 days">
        {[0, 50, 100].map((value) => (
          <g key={value}>
            <line x1={left} x2={width - right} y1={yOf(value)} y2={yOf(value)} stroke="var(--aw-border)" strokeWidth="1" />
            <text x={left - 5} y={yOf(value) + 3} textAnchor="end" fontSize="9" fill="var(--aw-text2)">
              {value}
            </text>
          </g>
        ))}
        {[0, 7, 14, 21, 29].map((offset) => {
          const n = start + offset;
          return (
            <text key={offset} x={xOf(n)} y={height - 6} textAnchor={offset === 0 ? 'start' : offset === 29 ? 'end' : 'middle'} fontSize="9" fill="var(--aw-text2)">
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
        {path ? <path d={path} fill="none" stroke="var(--aw-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /> : null}
        {points.map((point) => (
          <circle key={point.day} cx={xOf(point.n)} cy={yOf(point.averageScore)} r="2.6" fill="var(--aw-accent)">
            <title>{`${longDay(point.day)}: ${point.averageScore} average over ${point.pages} pages`}</title>
          </circle>
        ))}
      </svg>
      <div className="aw-seo-chart__legend">
        <span>
          <i className="aw-seo-chart__dot aw-seo-chart__dot--accent" /> score
        </span>
        <span>
          <i className="aw-seo-chart__dot aw-seo-chart__dot--warn" /> core or algorithm update
        </span>
        <span>
          <i className="aw-seo-chart__dot aw-seo-chart__dot--ok" /> our fix
        </span>
      </div>
    </div>
  );
}

function GeoChart({ weeks }) {
  if (!weeks.length) return <Empty title="No probe answers yet" hint="Run the GEO probe from the header after the next audit." />;
  const width = 520;
  const height = 150;
  const left = 12;
  const right = 12;
  const top = 10;
  const bottom = 24;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const gap = 5;
  const barW = Math.max(6, (innerW - gap * (weeks.length - 1)) / weeks.length);
  return (
    <div className="aw-seo-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Mention rate per week, last 12 weeks">
        <line x1={left} x2={width - right} y1={top + innerH} y2={top + innerH} stroke="var(--aw-border2)" strokeWidth="1" />
        {[0, 0.5, 1].map((value) => (
          <line key={value} x1={left} x2={width - right} y1={top + innerH * (1 - value)} y2={top + innerH * (1 - value)} stroke="var(--aw-border)" strokeWidth="1" strokeDasharray="2 4" />
        ))}
        {weeks.map((week, index) => {
          const x = left + index * (barW + gap);
          const barH = Math.max(1, innerH * Math.max(0, Math.min(1, week.rate ?? 0)));
          return (
            <g key={week.week}>
              <title>{`Week of ${longDay(week.week)}: ${week.mentions} of ${week.runs} answers named us (${pct(week.rate)})`}</title>
              <rect x={x} y={top + innerH - barH} width={barW} height={barH} rx="2" fill="var(--aw-accent)" opacity={week.runs ? 0.85 : 0.25} />
              {index % 3 === 0 || index === weeks.length - 1 ? (
                <text x={x + barW / 2} y={height - 6} textAnchor="middle" fontSize="9" fill="var(--aw-text2)">
                  {shortDay(week.week)}
                </text>
              ) : null}
            </g>
          );
        })}
        <text x={left} y={top - 1} fontSize="9" fill="var(--aw-text2)">
          100%
        </text>
        <text x={left} y={top + innerH + 9} fontSize="9" fill="var(--aw-text2)">
          0%
        </text>
      </svg>
    </div>
  );
}

/* ——————————————————————— rankings ——————————————————————— */

function RankingsTab({ api, overview, refresh, tick, ask, notify }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(null);

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

  if (error && !data) return <ErrorNote error={error} onRetry={load} />;
  if (!data) return <Loading label="Loading rankings…" />;

  const rows = data.rows ?? [];
  const location = data.location ?? { locationCode: 2840, languageCode: 'en' };
  const noPosition = data.avgPosition === null || data.avgPosition === undefined;

  return (
    <>
      {!data.rankReady ? (
        <div className="aw-banner aw-banner--warn">
          Rank tracking is off. Add the DATAFORSEO_API_KEY secret to the intercom Worker (
          <span className="aw-mono">npx wrangler secret put DATAFORSEO_API_KEY</span>, run in <span className="aw-mono">worker/</span>) and the
          weekly check starts on the next cron tick.
        </div>
      ) : null}

      <div className="aw-seo-statrow">
        <StatRow
          items={[
            {
              label: 'average position',
              value: noPosition ? '—' : data.avgPosition,
              tone: noPosition ? undefined : data.avgPosition <= 20 ? 'ok' : 'warn',
            },
            { label: 'in the top 10', value: data.inTop10 ?? 0, tone: data.inTop10 ? 'ok' : undefined },
            { label: 'in the top 100', value: data.inTop100 ?? 0, tone: data.inTop100 ? undefined : 'warn' },
            { label: 'swing', value: swingText(data.swing), tone: swingTone(data.swing) === 'ok' ? 'ok' : swingTone(data.swing) === 'warn' ? 'warn' : swingTone(data.swing) === 'bad' ? 'bad' : undefined },
            {
              label: 'keywords',
              value: plural((data.keywords ?? []).length, 'keyword', 'keywords'),
              hint: `DataForSEO location ${location.locationCode}/${location.languageCode}`,
            },
            ...(data.pending ? [{ label: 'queued', value: plural(data.pending, 'task', 'tasks'), tone: 'warn' }] : []),
          ]}
        />
      </div>

      <div className="aw-toolbar">
        <span className="aw-toolbar__fill" />
        <span className="aw-muted">{data.latestDay ? `checked ${longDay(data.latestDay)}` : 'not checked yet'}</span>
        <Button kind="primary" disabled={busy} onClick={check}>
          {busy ? 'Checking…' : 'Check rankings now'}
        </Button>
      </div>

      {error ? <ErrorNote error={error} onRetry={load} /> : null}

      <Panel title="Average position" subtitle="Last 90 days, lower is better" actions={<Badge tone={swingTone(data.swing)}>{swingText(data.swing)}</Badge>}>
        <RankChart series={data.series ?? []} events={overview.events ?? []} today={overview.day} />
      </Panel>

      {!rows.length ? (
        <Empty
          title="No rank check yet"
          hint={data.rankReady ? 'Press "Check rankings now" or wait for the weekly cron.' : 'Add the DATAFORSEO_API_KEY secret, then check rankings.'}
        />
      ) : (
        <Panel>
          <div className="aw-table-wrap">
            <table className="aw-table aw-table--stack aw-seo-ranks">
              <thead>
                <tr>
                  <th>Keyword</th>
                  <th>Position</th>
                  <th>Change</th>
                  <th>Ranking URL</th>
                  <th>Top competitors</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const open = expanded === row.keyword;
                  const top = row.topDomains ?? [];
                  return (
                    <Fragment key={row.keyword}>
                      <tr onClick={() => setExpanded(open ? null : row.keyword)} aria-expanded={open} title={open ? 'Hide competitors' : 'Show competitors'}>
                        <td className="aw-table__title">{row.keyword}</td>
                        <td data-label="Position">
                          {row.position === null ? (
                            <Tag tone="dash" title="Not in the top 100">
                              not in top 100
                            </Tag>
                          ) : (
                            <Tag tone={positionTone(row.position)}>#{row.position}</Tag>
                          )}
                        </td>
                        <td data-label="Change" title={row.prevPosition === null ? 'No check last week' : `Was #${row.prevPosition} last week`}>
                          {row.change === null ? (
                            <span className="aw-muted">–</span>
                          ) : row.change > 0 ? (
                            <Tag tone="ok">▲ {row.change}</Tag>
                          ) : row.change < 0 ? (
                            <Tag tone="bad">▼ {Math.abs(row.change)}</Tag>
                          ) : (
                            <span className="aw-muted">no change</span>
                          )}
                        </td>
                        <td data-label="Ranking URL" className="aw-seo-ranks__url">
                          {row.url ? (
                            <a href={row.url} target="_blank" rel="noreferrer" className="aw-link" onClick={(event) => event.stopPropagation()}>
                              {row.url}
                            </a>
                          ) : (
                            <span className="aw-muted">—</span>
                          )}
                        </td>
                        <td data-label="Top competitors" className="aw-seo-types" title={top.join(', ') || 'no organic results'}>
                          {top.length ? `${top.slice(0, 3).join(', ')}${top.length > 3 ? ` +${top.length - 3}` : ''}` : '—'}
                        </td>
                      </tr>
                      {open ? (
                        <tr>
                          <td colSpan={5} className="aw-seo-cell--detail">
                            <div className="aw-seo-issues">
                              {top.length ? (
                                top.map((domain, index) => (
                                  <div className="aw-seo-issue" key={domain}>
                                    <Tag tone="dash">{index + 1}</Tag>
                                    <span className="aw-mono">{domain}</span>
                                    {isOurDomain(domain) ? <Tag tone="ok">us</Tag> : null}
                                  </div>
                                ))
                              ) : (
                                <span className="aw-muted">No organic results were in the top 100.</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="aw-muted aw-seo-note">
            The weekly check asks Google Organic for every tracked keyword (United States, English, top 100). A keyword we are not in the top 100 for
            is kept as a row with no position, so the swing stays honest.
          </p>
        </Panel>
      )}
    </>
  );
}

function RankChart({ series, events, today }) {
  const end = today ?? series.at(-1)?.day;
  const endNumber = dayNumber(end);
  if (!series.length || !Number.isFinite(endNumber)) return <Empty title="No rank checks yet" hint="The first weekly check fills in the line." />;

  const width = 560;
  const height = 170;
  const left = 30;
  const right = 8;
  const top = 10;
  const bottom = 24;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const span = 89;
  const start = endNumber - span;
  const xOf = (n) => left + ((n - start) / span) * innerW;
  // Position 1 is at the top; anything outside the top 100 is drawn at 100.
  const yOf = (position) => top + ((Math.max(1, Math.min(100, position ?? 100)) - 1) / 99) * innerH;
  const points = series
    .map((point) => ({ ...point, n: dayNumber(point.day) }))
    .filter((point) => Number.isFinite(point.n) && point.n >= start && point.n <= endNumber)
    .sort((a, b) => a.n - b.n);
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${xOf(point.n).toFixed(1)},${yOf(point.avgPosition).toFixed(1)}`).join(' ');
  const marks = (events ?? [])
    .map((event) => ({ ...event, n: dayNumber(event.day) }))
    .filter((event) => Number.isFinite(event.n) && event.n >= start && event.n <= endNumber);
  const markColour = (kind) =>
    kind === 'fix' || kind === 'guide' ? 'var(--aw-ok)' : kind === 'note' || kind === 'indexnow' ? 'var(--aw-text2)' : 'var(--aw-warn)';

  return (
    <div className="aw-seo-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Average Google position, last 90 days">
        {[1, 50, 100].map((value) => (
          <g key={value}>
            <line x1={left} x2={width - right} y1={yOf(value)} y2={yOf(value)} stroke="var(--aw-border)" strokeWidth="1" />
            <text x={left - 5} y={yOf(value) + 3} textAnchor="end" fontSize="9" fill="var(--aw-text2)">
              {value}
            </text>
          </g>
        ))}
        {[0, 30, 60, 89].map((offset) => {
          const n = start + offset;
          return (
            <text key={offset} x={xOf(n)} y={height - 6} textAnchor={offset === 0 ? 'start' : offset === 89 ? 'end' : 'middle'} fontSize="9" fill="var(--aw-text2)">
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
        {path ? <path d={path} fill="none" stroke="var(--aw-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /> : null}
        {points.map((point) => (
          <circle key={point.day} cx={xOf(point.n)} cy={yOf(point.avgPosition)} r="2.6" fill="var(--aw-accent)">
            <title>{`${longDay(point.day)}: ${point.avgPosition} average (${point.inTop10} in the top 10, ${point.inTop100} in the top 100)`}</title>
          </circle>
        ))}
      </svg>
      <div className="aw-seo-chart__legend">
        <span>
          <i className="aw-seo-chart__dot aw-seo-chart__dot--accent" /> average position
        </span>
        <span>
          <i className="aw-seo-chart__dot aw-seo-chart__dot--warn" /> core or algorithm update
        </span>
        <span>
          <i className="aw-seo-chart__dot aw-seo-chart__dot--ok" /> our fix
        </span>
      </div>
    </div>
  );
}

/* ——————————————————————— audit: pages + findings ——————————————————————— */

function AuditTab({ api, hosts, tick, openTicket, refresh, notify }) {
  const [view, setView] = useState('pages');
  return (
    <>
      <div className="aw-toolbar">
        <Segmented
          label="Audit view"
          value={view}
          options={[
            { value: 'pages', label: 'Per page' },
            { value: 'findings', label: 'Per finding' },
          ]}
          onChange={setView}
        />
      </div>
      {view === 'pages' ? (
        <PagesTab api={api} hosts={hosts} tick={tick} />
      ) : (
        <FindingsTab api={api} hosts={hosts} tick={tick} openTicket={openTicket} refresh={refresh} notify={notify} />
      )}
    </>
  );
}

const canonicalOk = (page) => {
  if (!page.canonical) return false;
  const expected = `https://${page.host}${page.path}`.replace(/\/$/, '');
  return page.canonical.replace(/\/$/, '') === expected;
};

function PagesTab({ api, hosts, tick }) {
  const [host, setHost] = useState(hosts[0] ?? 'ptechsolutions.net');
  const [day, setDay] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);

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

  const selectedDay = day || data?.day || '';

  return (
    <>
      <div className="aw-toolbar">
        <select
          value={host}
          aria-label="Host"
          onChange={(event) => {
            setHost(event.target.value);
            setDay('');
            setExpanded(null);
          }}
        >
          {hosts.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select value={selectedDay} aria-label="Day" onChange={(event) => setDay(event.target.value)}>
          {(data?.days ?? []).map((value) => (
            <option key={value} value={value}>
              {longDay(value)}
            </option>
          ))}
          {data && !(data.days ?? []).includes(data.day) ? <option value={data.day}>{longDay(data.day)}</option> : null}
        </select>
        <span className="aw-toolbar__fill" />
        {data ? <Badge tone={scoreTone(data.averageScore)}>{data.averageScore} average</Badge> : null}
        {data ? <Badge>{plural(data.pages?.length ?? 0, 'page', 'pages')}</Badge> : null}
      </div>

      {error ? <ErrorNote error={error} onRetry={load} /> : null}
      {!data && !error ? <Loading label="Loading pages…" /> : null}
      {data && !data.pages.length ? (
        <Empty title="No audit for this day" hint="Pick another day, or run an audit from the page header." />
      ) : null}

      {data && data.pages.length ? (
        <Panel>
          <div className="aw-table-wrap">
            <table className="aw-table aw-table--stack aw-seo-pages">
              <thead>
                <tr>
                  <th>Path</th>
                  <th>Score</th>
                  <th>Title</th>
                  <th>Desc</th>
                  <th>Canonical</th>
                  <th>Hreflang</th>
                  <th>JSON-LD</th>
                  <th>H1</th>
                  <th>ms</th>
                  <th>Sitemap</th>
                  <th>llms</th>
                </tr>
              </thead>
              <tbody>
                {data.pages.map((page) => {
                  const open = expanded === page.id;
                  return (
                    <Fragment key={page.id}>
                      <tr onClick={() => setExpanded(open ? null : page.id)} aria-expanded={open} title={open ? 'Hide issues' : 'Show issues'}>
                        <td className="aw-table__title">
                          <a
                            href={`https://${page.host}${page.path}`}
                            target="_blank"
                            rel="noreferrer"
                            className="aw-link"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {page.path}
                          </a>
                          {page.status !== 200 ? <Tag tone="bad">{page.status}</Tag> : null}
                        </td>
                        <td data-label="Score">
                          <Tag tone={scoreTone(page.score)}>{page.score}</Tag>
                        </td>
                        <td data-label="Title" className={page.titleLen > 65 || page.titleLen < 15 ? 'aw-warn' : undefined} title={page.title ?? ''}>
                          {page.titleLen}
                        </td>
                        <td data-label="Desc" className={page.descLen > 160 ? 'aw-warn' : undefined} title={page.description ?? ''}>
                          {page.descLen}
                        </td>
                        <td data-label="Canonical">
                          <Tag tone={canonicalOk(page) ? 'ok' : 'bad'} title={page.canonical ?? 'No canonical link'}>
                            {canonicalOk(page) ? 'ok' : 'no'}
                          </Tag>
                        </td>
                        <td data-label="Hreflang">{page.hreflangCount}</td>
                        <td data-label="JSON-LD" className="aw-seo-types" title={(page.jsonldTypes ?? []).join(', ') || 'none'}>
                          {(page.jsonldTypes ?? []).length ? page.jsonldTypes.join(', ') : 'none'}
                        </td>
                        <td data-label="H1" className={page.h1Count === 1 ? undefined : 'aw-warn'}>
                          {page.h1Count}
                        </td>
                        <td data-label="ms" className={page.ms > 1500 ? 'aw-warn' : undefined}>
                          {page.ms}
                        </td>
                        <td data-label="Sitemap">{page.inSitemap ? 'yes' : 'no'}</td>
                        <td data-label="llms">{page.inLlms ? 'yes' : 'no'}</td>
                      </tr>
                      {open ? (
                        <tr>
                          <td colSpan={11} className="aw-seo-cell--detail">
                            <div className="aw-seo-issues">
                              {(page.issues ?? []).length ? (
                                page.issues.map((issue) => (
                                  <div className="aw-seo-issue" key={issue.code}>
                                    <Tag tone={SEVERITY_TONE[issue.severity] ?? 'dash'}>{issue.severity}</Tag>
                                    <span className="aw-mono">{issue.code}</span>
                                    <span>{issue.detail}</span>
                                  </div>
                                ))
                              ) : (
                                <span className="aw-muted">No issues on this page.</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </>
  );
}

/* ——————————————————————— findings ——————————————————————— */

function FindingsTab({ api, hosts, tick, openTicket, refresh, notify }) {
  const [status, setStatus] = useState('open');
  const [host, setHost] = useState(hosts[0] ?? '');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

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

  const dismiss = async (finding) => {
    setBusy(finding.id);
    try {
      await api('POST', `/admin/seo/findings/${finding.id}/dismiss`);
      await load();
      await refresh();
      notify?.('Finding dismissed.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const counts = data?.counts ?? { high: 0, medium: 0, low: 0, open: 0, resolved: 0 };
  const resolved = status === 'resolved';

  return (
    <>
      <div className="aw-toolbar">
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
          }}
        />
        <select value={host} aria-label="Host" onChange={(event) => setHost(event.target.value)}>
          <option value="">All hosts</option>
          {hosts.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div className="aw-seo-statrow">
        <StatRow
          items={[
            { label: 'high', value: counts.high, tone: counts.high ? 'bad' : undefined },
            { label: 'medium', value: counts.medium, tone: counts.medium ? 'warn' : undefined },
            { label: 'low', value: counts.low },
            { label: 'open', value: counts.open, tone: counts.open ? 'warn' : 'ok' },
            { label: 'resolved', value: counts.resolved },
          ]}
        />
      </div>

      {error ? <ErrorNote error={error} onRetry={load} /> : null}
      {!data && !error ? <Loading label="Loading findings…" /> : null}
      {data && !data.findings.length ? (
        <Empty
          title={resolved ? 'No resolved findings for this filter' : 'No open findings for this filter'}
          hint={resolved ? 'Findings land here once a later audit no longer sees them.' : 'A clean host: the next audit opens new findings as they appear.'}
        />
      ) : null}

      {data && data.findings.length ? (
        <Panel>
          <div className="aw-table-wrap">
            <table className="aw-table aw-table--stack">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Host</th>
                  <th>Path</th>
                  <th>Code</th>
                  <th>Detail</th>
                  <th>First seen</th>
                  {resolved ? <th>Resolved</th> : null}
                  <th>Ticket</th>
                  {!resolved ? <th>Dismiss</th> : null}
                </tr>
              </thead>
              <tbody>
                {(data.findings ?? [])
                  .slice()
                  .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
                  .map((finding) => (
                    <tr key={finding.id}>
                      <td data-label="Severity">
                        <Tag tone={SEVERITY_TONE[finding.severity] ?? 'dash'}>{finding.severity}</Tag>
                      </td>
                      <td data-label="Host" className="aw-muted">
                        {finding.host}
                      </td>
                      <td data-label="Path" className="aw-seo-path" title={finding.path}>
                        <a
                          href={`https://${finding.host}${finding.path}`}
                          target="_blank"
                          rel="noreferrer"
                          className="aw-link"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {finding.path}
                        </a>
                      </td>
                      <td data-label="Code" className="aw-mono">
                        {finding.code}
                      </td>
                      <td data-label="Detail" className="aw-table__title aw-seo-cell--wide">
                        {finding.detail}
                      </td>
                      <td data-label="First seen" className="aw-muted" title={when(finding.firstSeen)}>
                        {ago(finding.firstSeen)} ago
                      </td>
                      {resolved ? (
                        <td data-label="Resolved" className="aw-muted">
                          {finding.resolvedAt ? `${ago(finding.resolvedAt)} ago` : '-'}
                        </td>
                      ) : null}
                      <td data-label="Ticket">
                        <TicketLink id={finding.ticketId} openTicket={openTicket} />
                      </td>
                      {!resolved ? (
                        <td data-label="Dismiss">
                          <Button size="sm" kind="ghost" disabled={busy === finding.id} onClick={() => dismiss(finding)}>
                            {busy === finding.id ? 'Dismissing…' : 'Dismiss'}
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </>
  );
}

/* ——————————————————————— GEO ——————————————————————— */

function GeoTab({ api, tick }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
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

  return (
    <>
      {error ? <ErrorNote error={error} onRetry={() => setAttempt((n) => n + 1)} /> : null}
      {!data && !error ? <Loading label="Loading the probe answers…" /> : null}

      {data ? (
        <>
          {data.engineReady === false ? (
            <div className="aw-banner aw-banner--warn">
              The probe is off: the Worker has no DEEPSEEK_API_KEY. The desk keeps the questions, and the probe runs once the key is set.
            </div>
          ) : null}

          <div className="aw-seo-statrow">
            <StatRow
              items={[
                { label: 'mention rate', value: pct(data.summary.rate), tone: data.summary.rate ? 'ok' : undefined },
                { label: 'mentions', value: data.summary.mentions },
                { label: 'answers', value: data.summary.runs },
                { label: 'questions asked weekly', value: data.questions.length },
              ]}
            />
          </div>

          <Panel title="Last 12 weeks">
            <GeoChart weeks={data.weeks ?? []} />
          </Panel>

          <Panel
            title="Questions"
            subtitle="Each weekly probe asks every question once and keeps whether the answer named us, the URLs it cited and the companies it named instead."
          >
            {data.questions.length ? (
              <div className="aw-tags">
                {data.questions.map((question) => (
                  <Tag key={question} tone="dash" title={question}>
                    {question}
                  </Tag>
                ))}
              </div>
            ) : (
              <Empty title="No questions set" hint="Add buyer questions in Settings and the weekly probe asks them." />
            )}
          </Panel>

          <Panel title="Runs">
            {(data.runs ?? []).length ? (
              <div className="aw-table-wrap">
                <table className="aw-table aw-table--stack">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Question</th>
                      <th>Us</th>
                      <th>Competitors</th>
                      <th>Cited URLs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.runs.map((run) => {
                      const open = expanded === run.id;
                      return (
                        <Fragment key={run.id}>
                          <tr onClick={() => setExpanded(open ? null : run.id)} aria-expanded={open} title={open ? 'Hide the answer' : 'Show the answer'}>
                            <td data-label="Day" className="aw-muted">
                              {shortDay(run.day)}
                            </td>
                            <td data-label="Question" className="aw-table__title aw-seo-cell--wider">
                              {run.question}
                            </td>
                            <td data-label="Us">
                              <Tag tone={run.mentionsUs ? 'ok' : 'bad'}>{run.mentionsUs ? 'yes' : 'no'}</Tag>
                            </td>
                            <td data-label="Competitors" className="aw-seo-types" title={(run.competitors ?? []).join(', ')}>
                              {(run.competitors ?? []).length ? run.competitors.join(', ') : 'none'}
                            </td>
                            <td data-label="Cited URLs" className="aw-seo-types aw-seo-cell--detail">
                              {(run.citedUrls ?? []).length ? (
                                <>
                                  {run.citedUrls.slice(0, 2).map((url) => (
                                    <a key={url} href={url} target="_blank" rel="noreferrer" className="aw-link aw-seo-cited-url" onClick={(event) => event.stopPropagation()}>
                                      {url}
                                    </a>
                                  ))}
                                  {run.citedUrls.length > 2 ? <span className="aw-muted">+{run.citedUrls.length - 2} more</span> : null}
                                </>
                              ) : (
                                <span className="aw-muted">none</span>
                              )}
                            </td>
                          </tr>
                          {open ? (
                            <tr>
                              <td colSpan={5} className="aw-seo-cell--detail">
                                <p className="aw-muted aw-seo-note">{run.engine ?? 'engine'} answer</p>
                                <p className="aw-seo-answer">{run.answerExcerpt || 'No answer kept.'}</p>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No runs yet" hint="Run the GEO probe from the page header; its answers land here." />
            )}
          </Panel>
        </>
      ) : null}
    </>
  );
}

/* ——————————————————————— citations ——————————————————————— */

function CitationsTab({ api, tick, notify }) {
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

  const save = async (citation) => {
    const draft = draftFor(citation);
    setSaving(citation.id);
    try {
      await api('POST', `/admin/seo/citations/${citation.id}`, {
        status: draft.status,
        profile_url: draft.profile_url,
        note: draft.note,
      });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[citation.id];
        return next;
      });
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

  const counts = data?.counts ?? { todo: 0, drafted: 0, live: 0, verified: 0, skipped: 0, total: 0 };

  return (
    <>
      <div className="aw-seo-statrow">
        <StatRow
          items={[
            { label: 'to do', value: counts.todo, tone: counts.todo ? 'warn' : undefined },
            { label: 'drafted', value: counts.drafted },
            { label: 'live', value: counts.live },
            { label: 'verified', value: counts.verified, tone: counts.verified ? 'ok' : undefined },
            { label: 'skipped', value: counts.skipped },
            { label: 'placements', value: counts.total ?? ordered.length },
          ]}
        />
      </div>

      {error ? <ErrorNote error={error} onRetry={load} /> : null}
      {!data && !error ? <Loading label="Loading citations…" /> : null}
      {data && !ordered.length ? <Empty title="No placements seeded" hint="The desk seeds its own profile placements; nothing to show yet." /> : null}

      {ordered.length ? (
        <Panel>
          <div className="aw-table-wrap">
            <table className="aw-table aw-table--stack aw-seo-citations">
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>DR</th>
                  <th>Status</th>
                  <th>Profile URL</th>
                  <th>Link verified</th>
                  <th>Note or draft</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((citation) => {
                  const draft = draftFor(citation);
                  const changed = dirty(citation);
                  return (
                    <tr key={citation.id} className="aw-seo-row">
                      <td className="aw-table__title">
                        {citation.platform}
                        <div className="aw-muted">{citation.domain}</div>
                      </td>
                      <td data-label="DR">{citation.dr ?? '-'}</td>
                      <td data-label="Status">
                        <select value={draft.status} aria-label={`Status for ${citation.platform}`} onChange={(event) => edit(citation, { status: event.target.value })}>
                          {(data.statuses ?? CITATION_STATUSES).map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td data-label="Profile URL" className="aw-seo-cell--url">
                        <input
                          type="url"
                          value={draft.profile_url}
                          placeholder="https://…"
                          aria-label={`Profile URL for ${citation.platform}`}
                          onChange={(event) => edit(citation, { profile_url: event.target.value })}
                        />
                      </td>
                      <td data-label="Link verified" className="aw-muted" title={citation.lastChecked ? `Last checked ${when(citation.lastChecked)}` : 'Not checked yet'}>
                        {citation.linkVerifiedAt ? instantDay(citation.linkVerifiedAt) : '-'}
                      </td>
                      <td data-label="Note or draft" className="aw-seo-cell--note">
                        <textarea
                          rows={3}
                          value={draft.note}
                          placeholder="Draft bio or link text"
                          aria-label={`Note or draft for ${citation.platform}`}
                          onChange={(event) => edit(citation, { note: event.target.value })}
                        />
                      </td>
                      <td data-label="Actions">
                        <div className="aw-inline">
                          <Button size="sm" kind="ghost" onClick={() => copy(draft.note)}>
                            Copy
                          </Button>
                          <Button size="sm" kind={changed ? 'primary' : 'default'} disabled={!changed || saving === citation.id} onClick={() => save(citation)}>
                            {saving === citation.id ? 'Saving…' : 'Save'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="aw-muted aw-seo-note">
            To do and drafted rows come first, then the higher DR. The weekly check reads each profile URL; a page that no longer links back loses its
            verified date, a page that cannot be read keeps it.
          </p>
        </Panel>
      ) : null}
    </>
  );
}

/* ——————————————————————— settings ——————————————————————— */

function SettingsTab({ api, overview, refresh, notify }) {
  const [draft, setDraft] = useState(overview.settings);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
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

  const save = async () => {
    setSaving(true);
    setMessage(null);
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
      setMessage({ tone: 'bad', text: errorText(error) });
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setDraft(overview.settings);
    setTouched(false);
    setMessage(null);
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
      <Panel title="Cycle" subtitle="What the desk does on its own, and when it holds off.">
        <div className="aw-grid2">
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
        </div>
      </Panel>

      <Panel title="Guides" subtitle="One guide per rank keyword and buyer question, filed within the weekly limit.">
        <div className="aw-grid2">
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
            <input inputMode="numeric" min="0" max="7" value={draft.guidesPerWeek ?? 2} onChange={(event) => set('guidesPerWeek', Number(event.target.value))} />
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
        </div>
      </Panel>

      <Panel title="Buyer questions">
        <Field label="Questions for the weekly GEO probe" hint={`One per line, at most 20. ${usedQuestions} used.`}>
          <textarea rows={10} value={questions.join('\n')} onChange={(event) => set('geoQuestions', event.target.value.split('\n').slice(0, 20))} />
        </Field>
      </Panel>

      <Panel
        title="Google ranks"
        actions={<Badge tone={overview.rank?.rankReady ? 'ok' : 'bad'}>{overview.rank?.rankReady ? 'tracking on' : 'no API key'}</Badge>}
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
        <div className="aw-grid2">
          <Field label="Location code" hint="DataForSEO's Google location: 2840 is the United States.">
            <input
              type="number"
              min="1"
              value={location.locationCode ?? 2840}
              onChange={(event) => set('rankLocation', { ...location, locationCode: Number(event.target.value) })}
            />
          </Field>
          <Field label="Language code" hint="The search language, for example en.">
            <input value={location.languageCode ?? 'en'} onChange={(event) => set('rankLocation', { ...location, languageCode: event.target.value })} />
          </Field>
        </div>
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
                <Tag tone={EVENT_TONE[event.kind] ?? 'dash'}>{EVENT_LABEL[event.kind] ?? event.kind}</Tag>
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

      <div className="aw-seo-savebar">
        <span className="aw-seo-savebar__state" role="status">
          {changed ? 'Unsaved changes' : 'All changes saved'}
          {message ? <span className={message.tone === 'bad' ? 'aw-warn' : message.tone === 'warn' ? 'aw-warn' : 'aw-muted'}> · {message.text}</span> : null}
        </span>
        <Button disabled={!changed || saving} onClick={reset}>
          Reset
        </Button>
        <Button kind="primary" disabled={!changed || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </>
  );
}
