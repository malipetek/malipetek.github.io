/*
 * The SEO desk: how our own two hosts look to search engines and to
 * assistants, what is wrong with them, and what we did about it.
 *
 * Everything here reads worker/src/seo.ts through api(method, path, body).
 * Days are UTC calendar days ('YYYY-MM-DD'); times are unix seconds.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useAdmin, usePoll } from './store.js';
import { ago, when } from './format.js';
import { Button, Field, Segmented, Tag, cx } from './ui.jsx';

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
const EVENT_TONE = { core_update: 'warn', algorithm_update: 'warn', fix: 'ok', note: 'dash' };
const EVENT_LABEL = { core_update: 'core update', algorithm_update: 'algorithm update', fix: 'fix', note: 'note' };
const CYCLE_REASON = {
  auto_off: 'automatic cycles are off',
  open_cycle: 'a cycle ticket is already open',
  no_findings: 'there are no open findings at medium or above',
  recent_cycle: 'a cycle was filed in the last day',
  no_project: 'the malipetek-dev-site project is missing',
  no_admin: 'there is no admin account to file it for',
  insert_failed: 'the ticket could not be written',
};
const RUN_LABEL = { audit: 'Run audit', geo: 'Run GEO probe', citations: 'Check citations', ranks: 'Check rankings now', cycle: 'Run cycle now' };

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** Our own hosts: the lab and the PTech portal. */
const OUR_DOMAINS = ['malipetek.dev', 'ptechsolutions.net'];
/** True for one of our own hosts or a subdomain of one. */
const isOurDomain = (domain) => OUR_DOMAINS.some((host) => domain === host || domain.endsWith(`.${host}`));

const pct = (rate) => `${Math.round((rate ?? 0) * 100)}%`;
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
const errorText = (error) => error?.message ?? error?.code ?? 'Something went wrong.';

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
  const { api, openTicket, notify } = useAdmin();
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('overview');
  const [tick, setTick] = useState(0);

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

  if (error && !overview) return <p className="aw-empty">Could not load the SEO desk: {errorText(error)}</p>;
  if (!overview) return <p className="aw-empty">Loading…</p>;

  const hosts = overview.hostsAvailable ?? overview.hosts.map((h) => h.host);

  return (
    <div className="aw-view aw-seo">
      <header className="aw-hero">
        <h2>SEO</h2>
        <p className="aw-muted">
          Our own two hosts, checked daily. Scores, open fixes, the questions buyers ask assistants, and the profiles that link back.
        </p>
        <p className="aw-muted">
          Last audit {overview.state?.lastAuditAt ? `${ago(overview.state.lastAuditAt)} ago` : 'not yet'} · last GEO probe{' '}
          {overview.state?.lastGeoAt ? `${ago(overview.state.lastGeoAt)} ago` : 'not yet'} · last citation check{' '}
          {overview.state?.lastCitationsAt ? `${ago(overview.state.lastCitationsAt)} ago` : 'not yet'} · last rank check{' '}
          {overview.state?.lastRanksAt ? `${ago(overview.state.lastRanksAt)} ago` : 'not yet'}
        </p>
      </header>

      {error && overview ? <div className="aw-banner aw-banner--bad">Could not refresh: {errorText(error)}</div> : null}

      <div className="aw-toolbar">
        <Segmented
          value={tab}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'pages', label: 'Pages' },
            { value: 'findings', label: `Findings (${overview.hosts.reduce((sum, h) => sum + h.findings.open, 0)})` },
            { value: 'geo', label: 'GEO' },
            { value: 'ranks', label: 'Rankings' },
            { value: 'citations', label: 'Citations' },
            { value: 'settings', label: 'Settings' },
          ]}
          onChange={setTab}
        />
      </div>

      {tab === 'overview' ? (
        <OverviewTab overview={overview} api={api} refresh={refresh} openTicket={openTicket} />
      ) : null}
      {tab === 'pages' ? <PagesTab api={api} hosts={hosts} tick={tick} /> : null}
      {tab === 'findings' ? <FindingsTab api={api} hosts={hosts} tick={tick} openTicket={openTicket} refresh={refresh} /> : null}
      {tab === 'geo' ? <GeoTab api={api} tick={tick} /> : null}
      {tab === 'ranks' ? <RankingsTab api={api} overview={overview} refresh={refresh} tick={tick} /> : null}
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

function OverviewTab({ overview, api, refresh, openTicket }) {
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const held = overview.cycle?.held;

  const run = async (what) => {
    setBusy(what);
    setResult(null);
    try {
      const out = await api('POST', '/admin/seo/run', { what });
      setResult({ ok: true, text: runText(out) });
      await refresh();
    } catch (error) {
      setResult({ ok: false, text: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {held?.held ? (
        <div className="aw-banner aw-banner--warn">
          Google core update in progress: content rewrites paused until {longDay(held.until)}.
          {held.since ? <span className="aw-muted"> Started {longDay(held.since)}.</span> : null}
        </div>
      ) : null}

      <div className="aw-toolbar">
        {['audit', 'geo', 'citations', 'cycle'].map((what) => (
          <Button key={what} kind={what === 'audit' ? 'primary' : 'default'} disabled={Boolean(busy)} onClick={() => run(what)}>
            {busy === what ? 'Running…' : RUN_LABEL[what]}
          </Button>
        ))}
        <span className="aw-toolbar__fill" />
        <Tag tone={overview.settings?.autoCycle ? 'ok' : 'dash'}>auto cycle {overview.settings?.autoCycle ? 'on' : 'off'}</Tag>
        <Tag tone={held?.held ? 'warn' : 'dash'}>{held?.held ? 'held' : 'not held'}</Tag>
      </div>

      {result ? (
        <div className={cx('aw-banner', result.ok ? 'aw-banner--ok' : 'aw-banner--bad')} role="status">
          {result.text}
        </div>
      ) : null}

      <div className="aw-grid2">
        {overview.hosts.map((host) => (
          <section className="aw-panel" key={host.host}>
            <header>
              <h3 style={{ margin: 0 }}>{host.host}</h3>
              <Tag tone={scoreTone(host.averageScore)}>{host.averageScore} average</Tag>
              <Tag tone="dash">{plural(host.pages, 'page', 'pages')}</Tag>
              <span className="aw-toolbar__fill" />
              <span className="aw-muted">{host.day ? shortDay(host.day) : 'no audit yet'}</span>
            </header>
            <ScoreChart series={host.series ?? []} events={overview.events ?? []} today={overview.day} />
            <div className="aw-tags" style={{ marginTop: 8 }}>
              <Tag tone={host.findings.high ? 'bad' : 'dash'}>{host.findings.high} high</Tag>
              <Tag tone={host.findings.medium ? 'warn' : 'dash'}>{host.findings.medium} medium</Tag>
              <Tag tone="dash">{host.findings.low} low</Tag>
              <Tag tone={host.findings.open ? 'warn' : 'ok'}>{host.findings.open} open</Tag>
            </div>
          </section>
        ))}
      </div>

      <div className="aw-grid2">
        <section className="aw-panel">
          <header>
            <h3 style={{ margin: 0 }}>Assistant mentions</h3>
            <Tag tone={overview.geo.rate ? 'ok' : 'dash'}>{pct(overview.geo.rate)} overall</Tag>
            <span className="aw-toolbar__fill" />
            <span className="aw-muted">
              {plural(overview.geo.mentions, 'mention', 'mentions')} in {plural(overview.geo.runs, 'answer', 'answers')}
            </span>
          </header>
          <GeoChart weeks={overview.geo.weeks ?? []} />
        </section>

        <section className="aw-panel">
          <h3>Citations</h3>
          <div className="aw-tags">
            <Tag tone={overview.citations.todo ? 'warn' : 'dash'}>{overview.citations.todo} to do</Tag>
            <Tag tone="dash">{overview.citations.drafted} drafted</Tag>
            <Tag tone="dash">{overview.citations.live} live</Tag>
            <Tag tone={overview.citations.verified ? 'ok' : 'dash'}>{overview.citations.verified} verified</Tag>
            <Tag tone="dash">{overview.citations.skipped} skipped</Tag>
          </div>
          <p className="aw-muted">
            Profile and directory placements that can link back. A weekly check keeps the verified ones honest.
          </p>
        </section>
      </div>

      <section className="aw-panel">
        <header>
          <h3 style={{ margin: 0 }}>Google rankings</h3>
          <Tag tone={overview.rank?.rankReady ? 'ok' : 'bad'}>{overview.rank?.rankReady ? 'tracking on' : 'no API key'}</Tag>
          <span className="aw-toolbar__fill" />
          <span className="aw-muted">{overview.rank?.latestDay ? `checked ${shortDay(overview.rank.latestDay)}` : 'not checked yet'}</span>
        </header>
        <div className="aw-tags">
          <Tag tone={overview.rank?.avgPosition === null || overview.rank?.avgPosition === undefined ? 'dash' : overview.rank.avgPosition <= 20 ? 'ok' : 'warn'}>
            {overview.rank?.avgPosition === null || overview.rank?.avgPosition === undefined
              ? 'no average yet'
              : `${overview.rank.avgPosition} average position`}
          </Tag>
          <Tag tone={overview.rank?.inTop10 ? 'ok' : 'dash'}>{overview.rank?.inTop10 ?? 0} in the top 10</Tag>
          <Tag tone={overview.rank?.inTop100 ? 'dash' : 'warn'}>{overview.rank?.inTop100 ?? 0} in the top 100</Tag>
          <Tag tone={swingTone(overview.rank?.swing)}>{swingText(overview.rank?.swing)}</Tag>
          <Tag tone="dash">{plural(overview.rank?.keywords ?? 0, 'keyword', 'keywords')}</Tag>
          {overview.rank?.pending ? <Tag tone="warn">{plural(overview.rank.pending, 'task', 'tasks')} queued</Tag> : null}
        </div>
        <p className="aw-muted" style={{ marginBottom: 0 }}>
          {overview.rank?.rankReady
            ? 'Weekly Google positions for the keywords we sell against, read against core updates.'
            : 'Add the DATAFORSEO_API_KEY secret to the intercom Worker to turn rank tracking on.'}
        </p>
      </section>

      <section className="aw-panel">
        <h3>Fix cycle</h3>
        <div className="aw-tags">
          <Tag tone={overview.cycle.auto ? 'ok' : 'dash'}>auto {overview.cycle.auto ? 'on' : 'off'}</Tag>
          <Tag tone={overview.cycle.openFindings ? 'warn' : 'ok'}>{plural(overview.cycle.openFindings, 'open finding', 'open findings')} at medium or above</Tag>
          <Tag tone={overview.cycle.wouldFile ? 'warn' : 'dash'}>{overview.cycle.wouldFile ? 'a cycle would file now' : 'no cycle due'}</Tag>
        </div>
        <p>
          Open ticket:{' '}
          {overview.cycle.openTicketId ? (
            <TicketLink id={overview.cycle.openTicketId} openTicket={openTicket} />
          ) : (
            <span className="aw-muted">none</span>
          )}
          {held?.held ? <span className="aw-muted"> · rewrites pause until {longDay(held.until)}</span> : null}
        </p>
      </section>
    </>
  );
}

/* ——————————————————————— charts ——————————————————————— */

function ScoreChart({ series, events, today }) {
  const end = today ?? series.at(-1)?.day;
  const endNumber = dayNumber(end);
  if (!series.length || !Number.isFinite(endNumber)) return <p className="aw-muted">No audit series yet.</p>;

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
  const markColour = (kind) => (kind === 'fix' ? 'var(--aw-ok)' : kind === 'note' ? 'var(--aw-text2)' : 'var(--aw-warn)');

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
          <i className="aw-seo-chart__dot" style={{ background: 'var(--aw-accent)' }} /> score
        </span>
        <span>
          <i className="aw-seo-chart__dot" style={{ background: 'var(--aw-warn)' }} /> core or algorithm update
        </span>
        <span>
          <i className="aw-seo-chart__dot" style={{ background: 'var(--aw-ok)' }} /> our fix
        </span>
      </div>
    </div>
  );
}

function GeoChart({ weeks }) {
  if (!weeks.length) return <p className="aw-muted">No probe answers yet. Run the GEO probe after the next audit.</p>;
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

function RankingsTab({ api, overview, refresh, tick }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
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

  const check = async () => {
    setBusy(true);
    setResult(null);
    try {
      const out = await api('POST', '/admin/seo/run', { what: 'ranks' });
      setResult({ ok: true, text: runText(out) });
      await load();
      await refresh();
    } catch (err) {
      setResult({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <p className="aw-empty">Could not load rankings: {errorText(error)}</p>;
  if (!data) return <p className="aw-empty">Loading rankings…</p>;

  const rows = data.rows ?? [];
  const location = data.location ?? { locationCode: 2840, languageCode: 'en' };

  return (
    <>
      {!data.rankReady ? (
        <div className="aw-banner aw-banner--warn">
          Rank tracking is off. Add the DATAFORSEO_API_KEY secret to the intercom Worker (
          <span className="aw-mono">npx wrangler secret put DATAFORSEO_API_KEY</span>, run in <span className="aw-mono">worker/</span>) and the
          weekly check starts on the next cron tick.
        </div>
      ) : null}

      <div className="aw-toolbar">
        <Tag tone={data.avgPosition === null ? 'dash' : data.avgPosition <= 20 ? 'ok' : 'warn'}>
          {data.avgPosition === null ? 'no average yet' : `${data.avgPosition} average position`}
        </Tag>
        <Tag tone={data.inTop10 ? 'ok' : 'dash'}>{data.inTop10 ?? 0} in the top 10</Tag>
        <Tag tone={data.inTop100 ? 'dash' : 'warn'}>{data.inTop100 ?? 0} in the top 100</Tag>
        <Tag tone={swingTone(data.swing)}>{swingText(data.swing)}</Tag>
        <Tag tone="dash">
          {plural((data.keywords ?? []).length, 'keyword', 'keywords')} · location {location.locationCode}/{location.languageCode}
        </Tag>
        {data.pending ? <Tag tone="warn">{plural(data.pending, 'task', 'tasks')} queued</Tag> : null}
        <span className="aw-toolbar__fill" />
        <span className="aw-muted">{data.latestDay ? `checked ${longDay(data.latestDay)}` : 'not checked yet'}</span>
        <Button kind="primary" disabled={busy} onClick={check}>
          {busy ? 'Checking…' : 'Check rankings now'}
        </Button>
      </div>

      {result ? (
        <div className={cx('aw-banner', result.ok ? 'aw-banner--ok' : 'aw-banner--bad')} role="status">
          {result.text}
        </div>
      ) : null}
      {error ? <div className="aw-banner aw-banner--bad">{errorText(error)}</div> : null}

      <section className="aw-panel">
        <header>
          <h3 style={{ margin: 0 }}>Average position</h3>
          <Tag tone={swingTone(data.swing)}>{swingText(data.swing)}</Tag>
          <span className="aw-toolbar__fill" />
          <span className="aw-muted">last 90 days, lower is better</span>
        </header>
        <RankChart series={data.series ?? []} events={overview.events ?? []} today={overview.day} />
      </section>

      {!rows.length ? (
        <p className="aw-empty">
          No rank check yet. {data.rankReady ? 'Press "Check rankings now" or wait for the weekly cron.' : 'Add the secret first.'}
        </p>
      ) : (
        <section className="aw-panel">
          <div className="aw-tablewrap">
            <table className="aw-table aw-seo-ranks">
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
                        <td>
                          {row.position === null ? (
                            <Tag tone="dash" title="Not in the top 100">
                              not in top 100
                            </Tag>
                          ) : (
                            <Tag tone={positionTone(row.position)}>#{row.position}</Tag>
                          )}
                        </td>
                        <td title={row.prevPosition === null ? 'No check last week' : `Was #${row.prevPosition} last week`}>
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
                        <td className="aw-seo-ranks__url">
                          {row.url ? (
                            <a href={row.url} target="_blank" rel="noreferrer" className="aw-link" onClick={(event) => event.stopPropagation()}>
                              {row.url}
                            </a>
                          ) : (
                            <span className="aw-muted">—</span>
                          )}
                        </td>
                        <td className="aw-seo-types" title={top.join(', ') || 'no organic results'}>
                          {top.length ? `${top.slice(0, 3).join(', ')}${top.length > 3 ? ` +${top.length - 3}` : ''}` : '—'}
                        </td>
                      </tr>
                      {open ? (
                        <tr>
                          <td colSpan={5} style={{ whiteSpace: 'normal' }}>
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
          <p className="aw-muted" style={{ marginBottom: 0 }}>
            The weekly check asks Google Organic for every tracked keyword (United States, English, top 100). A keyword we are not in the top 100 for
            is kept as a row with no position, so the swing stays honest.
          </p>
        </section>
      )}
    </>
  );
}

function RankChart({ series, events, today }) {
  const end = today ?? series.at(-1)?.day;
  const endNumber = dayNumber(end);
  if (!series.length || !Number.isFinite(endNumber)) return <p className="aw-muted">No rank checks yet.</p>;

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
  const markColour = (kind) => (kind === 'fix' ? 'var(--aw-ok)' : kind === 'note' ? 'var(--aw-text2)' : 'var(--aw-warn)');

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
          <i className="aw-seo-chart__dot" style={{ background: 'var(--aw-accent)' }} /> average position
        </span>
        <span>
          <i className="aw-seo-chart__dot" style={{ background: 'var(--aw-warn)' }} /> core or algorithm update
        </span>
        <span>
          <i className="aw-seo-chart__dot" style={{ background: 'var(--aw-ok)' }} /> our fix
        </span>
      </div>
    </div>
  );
}

/* ——————————————————————— pages ——————————————————————— */

const canonicalOk = (page) => {
  if (!page.canonical) return false;
  const expected = `https://${page.host}${page.path}`.replace(/\/$/, '');
  return page.canonical.replace(/\/$/, '') === expected;
};

function PagesTab({ api, hosts, tick }) {
  const [host, setHost] = useState(hosts[0] ?? 'malipetek.dev');
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
        {data ? <Tag tone={scoreTone(data.averageScore)}>{data.averageScore} average</Tag> : null}
        {data ? <Tag tone="dash">{plural(data.pages?.length ?? 0, 'page', 'pages')}</Tag> : null}
      </div>

      {error ? <div className="aw-banner aw-banner--bad">{errorText(error)}</div> : null}
      {!data && !error ? <p className="aw-empty">Loading pages…</p> : null}
      {data && !data.pages.length ? <p className="aw-empty">No audit for this host on this day. Pick another day or run an audit.</p> : null}

      {data && data.pages.length ? (
        <section className="aw-panel">
          <div className="aw-tablewrap">
            <table className="aw-table aw-seo-pages">
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
                        <td>
                          <Tag tone={scoreTone(page.score)}>{page.score}</Tag>
                        </td>
                        <td className={page.titleLen > 65 || page.titleLen < 15 ? 'aw-warn' : undefined} title={page.title ?? ''}>
                          {page.titleLen}
                        </td>
                        <td className={page.descLen > 160 ? 'aw-warn' : undefined} title={page.description ?? ''}>
                          {page.descLen}
                        </td>
                        <td>
                          <Tag tone={canonicalOk(page) ? 'ok' : 'bad'} title={page.canonical ?? 'No canonical link'}>
                            {canonicalOk(page) ? 'ok' : 'no'}
                          </Tag>
                        </td>
                        <td>{page.hreflangCount}</td>
                        <td className="aw-seo-types" title={(page.jsonldTypes ?? []).join(', ') || 'none'}>
                          {(page.jsonldTypes ?? []).length ? page.jsonldTypes.join(', ') : 'none'}
                        </td>
                        <td className={page.h1Count === 1 ? undefined : 'aw-warn'}>{page.h1Count}</td>
                        <td className={page.ms > 1500 ? 'aw-warn' : undefined}>{page.ms}</td>
                        <td>{page.inSitemap ? 'yes' : 'no'}</td>
                        <td>{page.inLlms ? 'yes' : 'no'}</td>
                      </tr>
                      {open ? (
                        <tr>
                          <td colSpan={11} style={{ whiteSpace: 'normal' }}>
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
        </section>
      ) : null}
    </>
  );
}

/* ——————————————————————— findings ——————————————————————— */

function FindingsTab({ api, hosts, tick, openTicket, refresh }) {
  const [status, setStatus] = useState('open');
  const [host, setHost] = useState('');
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
          <option value="">Both hosts</option>
          {hosts.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <span className="aw-toolbar__fill" />
        <Tag tone={counts.high ? 'bad' : 'dash'}>{counts.high} high</Tag>
        <Tag tone={counts.medium ? 'warn' : 'dash'}>{counts.medium} medium</Tag>
        <Tag tone="dash">{counts.low} low</Tag>
        <Tag tone={counts.open ? 'warn' : 'ok'}>{counts.open} open</Tag>
        <Tag tone="dash">{counts.resolved} resolved</Tag>
      </div>

      {error ? <div className="aw-banner aw-banner--bad">{errorText(error)}</div> : null}
      {!data && !error ? <p className="aw-empty">Loading findings…</p> : null}
      {data && !data.findings.length ? <p className="aw-empty">No {resolved ? 'resolved' : 'open'} findings for this filter.</p> : null}

      {data && data.findings.length ? (
        <section className="aw-panel">
          <div className="aw-tablewrap">
            <table className="aw-table">
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
                  {!resolved ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {(data.findings ?? [])
                  .slice()
                  .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
                  .map((finding) => (
                    <tr key={finding.id}>
                      <td>
                        <Tag tone={SEVERITY_TONE[finding.severity] ?? 'dash'}>{finding.severity}</Tag>
                      </td>
                      <td className="aw-muted">{finding.host}</td>
                      <td className="aw-seo-path" title={finding.path}>
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
                      <td className="aw-mono">{finding.code}</td>
                      <td className="aw-table__title" style={{ minWidth: 200 }}>
                        {finding.detail}
                      </td>
                      <td className="aw-muted" title={when(finding.firstSeen)}>
                        {ago(finding.firstSeen)} ago
                      </td>
                      {resolved ? <td className="aw-muted">{finding.resolvedAt ? `${ago(finding.resolvedAt)} ago` : '-'}</td> : null}
                      <td>
                        <TicketLink id={finding.ticketId} openTicket={openTicket} />
                      </td>
                      {!resolved ? (
                        <td>
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
        </section>
      ) : null}
    </>
  );
}

/* ——————————————————————— GEO ——————————————————————— */

function GeoTab({ api, tick }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);

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
  }, [api, tick]);

  return (
    <>
      {error ? <div className="aw-banner aw-banner--bad">{errorText(error)}</div> : null}
      {!data && !error ? <p className="aw-empty">Loading the probe answers…</p> : null}

      {data ? (
        <>
          {data.engineReady === false ? (
            <div className="aw-banner aw-banner--warn">
              The probe is off: the Worker has no DEEPSEEK_API_KEY. The desk keeps the questions, and the probe runs once the key is set.
            </div>
          ) : null}

          <div className="aw-tags" style={{ marginBottom: 12 }}>
            <Tag tone={data.summary.rate ? 'ok' : 'dash'}>{pct(data.summary.rate)} mention rate</Tag>
            <Tag tone="dash">{plural(data.summary.mentions, 'mention', 'mentions')}</Tag>
            <Tag tone="dash">{plural(data.summary.runs, 'answer', 'answers')}</Tag>
            <Tag tone="dash">{plural(data.questions.length, 'question', 'questions')} asked weekly</Tag>
          </div>

          <section className="aw-panel">
            <h3>Last 12 weeks</h3>
            <GeoChart weeks={data.weeks ?? []} />
          </section>

          <section className="aw-panel">
            <h3>Questions</h3>
            {data.questions.length ? (
              <div className="aw-tags">
                {data.questions.map((question) => (
                  <Tag key={question} tone="dash" title={question}>
                    {question}
                  </Tag>
                ))}
              </div>
            ) : (
              <p className="aw-muted">No questions set. Add them in Settings.</p>
            )}
            <p className="aw-muted" style={{ marginBottom: 0 }}>
              Each weekly probe asks every question once and keeps whether the answer named us, the URLs it cited and the companies it named instead.
            </p>
          </section>

          <section className="aw-panel">
            <h3>Runs</h3>
            {(data.runs ?? []).length ? (
              <div className="aw-tablewrap">
                <table className="aw-table">
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
                            <td className="aw-muted">{shortDay(run.day)}</td>
                            <td className="aw-table__title" style={{ minWidth: 240 }}>
                              {run.question}
                            </td>
                            <td>
                              <Tag tone={run.mentionsUs ? 'ok' : 'bad'}>{run.mentionsUs ? 'yes' : 'no'}</Tag>
                            </td>
                            <td className="aw-seo-types" title={(run.competitors ?? []).join(', ')}>
                              {(run.competitors ?? []).length ? run.competitors.join(', ') : 'none'}
                            </td>
                            <td className="aw-seo-types" style={{ whiteSpace: 'normal' }}>
                              {(run.citedUrls ?? []).length ? (
                                <>
                                  {run.citedUrls.slice(0, 2).map((url) => (
                                    <a key={url} href={url} target="_blank" rel="noreferrer" className="aw-link" onClick={(event) => event.stopPropagation()} style={{ display: 'block' }}>
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
                              <td colSpan={5} style={{ whiteSpace: 'normal' }}>
                                <p className="aw-muted" style={{ margin: 0 }}>
                                  {run.engine ?? 'engine'} answer
                                </p>
                                <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{run.answerExcerpt || 'No answer kept.'}</p>
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
              <p className="aw-muted">No runs yet. Run the GEO probe from the Overview.</p>
            )}
          </section>
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
      <div className="aw-toolbar">
        <Tag tone={counts.todo ? 'warn' : 'dash'}>{counts.todo} to do</Tag>
        <Tag tone="dash">{counts.drafted} drafted</Tag>
        <Tag tone="dash">{counts.live} live</Tag>
        <Tag tone={counts.verified ? 'ok' : 'dash'}>{counts.verified} verified</Tag>
        <Tag tone="dash">{counts.skipped} skipped</Tag>
        <span className="aw-toolbar__fill" />
        <span className="aw-muted">{plural(counts.total ?? ordered.length, 'placement', 'placements')}</span>
      </div>

      {error ? <div className="aw-banner aw-banner--bad">{errorText(error)}</div> : null}
      {!data && !error ? <p className="aw-empty">Loading citations…</p> : null}
      {data && !ordered.length ? <p className="aw-empty">No placements seeded.</p> : null}

      {ordered.length ? (
        <section className="aw-panel">
          <div className="aw-tablewrap">
            <table className="aw-table aw-seo-citations">
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>DR</th>
                  <th>Status</th>
                  <th>Profile URL</th>
                  <th>Link verified</th>
                  <th>Note or draft</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ordered.map((citation) => {
                  const draft = draftFor(citation);
                  const changed = dirty(citation);
                  return (
                    <tr key={citation.id} style={{ cursor: 'default' }}>
                      <td className="aw-table__title">
                        {citation.platform}
                        <div className="aw-muted">{citation.domain}</div>
                      </td>
                      <td>{citation.dr ?? '-'}</td>
                      <td>
                        <select value={draft.status} aria-label={`Status for ${citation.platform}`} onChange={(event) => edit(citation, { status: event.target.value })}>
                          {(data.statuses ?? CITATION_STATUSES).map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ minWidth: 220 }}>
                        <input
                          type="url"
                          value={draft.profile_url}
                          placeholder="https://…"
                          aria-label={`Profile URL for ${citation.platform}`}
                          onChange={(event) => edit(citation, { profile_url: event.target.value })}
                        />
                      </td>
                      <td className="aw-muted" title={citation.lastChecked ? `Last checked ${when(citation.lastChecked)}` : 'Not checked yet'}>
                        {citation.linkVerifiedAt ? instantDay(citation.linkVerifiedAt) : '-'}
                      </td>
                      <td style={{ minWidth: 280, whiteSpace: 'normal' }}>
                        <textarea
                          rows={3}
                          value={draft.note}
                          placeholder="Draft bio or link text"
                          aria-label={`Note or draft for ${citation.platform}`}
                          onChange={(event) => edit(citation, { note: event.target.value })}
                        />
                      </td>
                      <td>
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
          <p className="aw-muted" style={{ marginBottom: 0 }}>
            To do and drafted rows come first, then the higher DR. The weekly check reads each profile URL; a page that no longer links back loses its
            verified date, a page that cannot be read keeps it.
          </p>
        </section>
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
        geoQuestions: draft.geoQuestions,
        rankKeywords: draft.rankKeywords,
        rankLocation: draft.rankLocation,
      });
      setDraft(out.settings);
      setTouched(false);
      if (out.rejected?.length) setMessage({ tone: 'warn', text: `Saved, but these fields were rejected: ${out.rejected.join(', ')}.` });
      else setMessage({ tone: 'ok', text: 'Settings saved.' });
      await refresh();
      notify?.('SEO settings saved.');
    } catch (error) {
      setMessage({ tone: 'bad', text: errorText(error) });
    } finally {
      setSaving(false);
    }
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
      <section className="aw-panel">
        <h3>Cycle</h3>
        <div className="aw-grid2">
          <Field label="Automatic cycles" hint="On: the desk files a ticket for the worst open findings when none is open.">
            <Segmented
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
              value={Boolean(draft.volatilityHold)}
              options={[
                { value: true, label: 'On' },
                { value: false, label: 'Off' },
              ]}
              onChange={(value) => set('volatilityHold', value)}
            />
          </Field>
        </div>
      </section>

      <section className="aw-panel">
        <h3>Buyer questions</h3>
        <Field label="Questions for the weekly GEO probe" hint={`One per line, at most 20. ${usedQuestions} used.`}>
          <textarea
            rows={10}
            value={questions.join('\n')}
            onChange={(event) => set('geoQuestions', event.target.value.split('\n').slice(0, 20))}
          />
        </Field>
        <div className="aw-inline">
          <span className="aw-toolbar__fill" />
          <Button
            disabled={!changed || saving}
            onClick={() => {
              setDraft(overview.settings);
              setTouched(false);
              setMessage(null);
            }}
          >
            Reset
          </Button>
          <Button kind="primary" disabled={!changed || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
        {message ? (
          <div className={cx('aw-banner', message.tone === 'bad' ? 'aw-banner--bad' : message.tone === 'ok' ? 'aw-banner--ok' : 'aw-banner--warn')}>
            {message.text}
          </div>
        ) : null}
      </section>

      <section className="aw-panel">
        <header>
          <h3 style={{ margin: 0 }}>Google ranks</h3>
          <Tag tone={overview.rank?.rankReady ? 'ok' : 'bad'}>{overview.rank?.rankReady ? 'tracking on' : 'no API key'}</Tag>
        </header>
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
          <textarea
            rows={10}
            value={keywords.join('\n')}
            onChange={(event) => set('rankKeywords', event.target.value.split('\n').slice(0, 25))}
          />
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
            <input
              value={location.languageCode ?? 'en'}
              onChange={(event) => set('rankLocation', { ...location, languageCode: event.target.value })}
            />
          </Field>
        </div>
        <div className="aw-inline">
          <span className="aw-toolbar__fill" />
          <Button
            disabled={!changed || saving}
            onClick={() => {
              setDraft(overview.settings);
              setTouched(false);
              setMessage(null);
            }}
          >
            Reset
          </Button>
          <Button kind="primary" disabled={!changed || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </section>

      <section className="aw-panel">
        <h3>Events</h3>
        <p className="aw-muted">
          Core updates, algorithm updates, fixes and notes. The score line marks them, and a core update in the last 14 days holds content rewrites.
        </p>
        <div className="aw-inline" style={{ marginBottom: 10 }}>
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
              <li key={event.id} className="aw-row" style={{ cursor: 'default' }}>
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
          <p className="aw-muted">No events yet.</p>
        )}
      </section>
    </>
  );
}
