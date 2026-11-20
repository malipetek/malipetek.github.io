import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ISO_TILE,
  PARK_FILTERS,
  countsSummary,
  filterCounts,
  iso,
  parkPlots,
  plotAriaLabel,
  plotHeadline,
  plotMatches,
  plotTickets,
  plotWaitLabel,
  runTrail,
  fleetTicker,
  shortAge,
} from './project-park.mjs';

/** One line: runs going now (ticking), and tickets waiting on a person. */
function FleetTicker({ running, recent, tickets, onOpenTicket }) {
  const [now, setNow] = useState(() => Date.now());
  const ticker = fleetTicker({ running, recent, tickets, now });
  const live = ticker.running.length > 0;
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, [live]);
  if (!live && !ticker.attention.length && !ticker.idle) return null;
  const open = (item) => onOpenTicket?.({ id: item.ticketId, title: item.title });
  return (
    <div className="pta-park__ticker" role="status" aria-label="Fleet now">
      {live ? (
        ticker.running.map((item) => (
          <button key={`r${item.ticketId}`} type="button" className="pta-park__chip is-running" onClick={() => open(item)} title="Open the ticket's conversation">
            <i className="pta-park__run is-running" aria-hidden="true" />
            #{item.ticketId} {item.title} · {shortAge(item.seconds)}
          </button>
        ))
      ) : (
        <span className="pta-park__ticker-idle">0 running{ticker.attention.length ? '' : ' · fleet clear'}{ticker.idle ? ` · ${ticker.idle}` : ''}</span>
      )}
      {ticker.attention.map((item) => (
        <button key={`a${item.ticketId}`} type="button" className={`pta-park__chip is-${item.reason}`} onClick={() => open(item)} title="Open the ticket's conversation">
          <i className={`pta-park__run is-${item.reason === 'failed' ? 'failed' : 'ok'}`} aria-hidden="true" />
          {item.reason === 'failed' ? 'Failed' : 'Review'} #{item.ticketId} {item.title} · {shortAge(item.seconds)}
        </button>
      ))}
      {ticker.attentionTotal > ticker.attention.length ? (
        <span className="pta-park__ticker-idle">+{ticker.attentionTotal - ticker.attention.length} more</span>
      ) : null}
    </div>
  );
}

/** A ticket's runs as small segments (oldest left), with a one-line summary. */
function RunBand({ trail }) {
  if (!trail) return null;
  return (
    <span className="pta-park__runs" title={trail.summary}>
      <span className="pta-park__runband" aria-hidden="true">
        {trail.runs.map((run, i) => (
          <i key={String(run.id ?? i)} className={`pta-park__run is-${run.kind}`} />
        ))}
      </span>
      <span className="pta-park__runs-text">{trail.summary}</span>
    </span>
  );
}

const KIND_LABEL = { stalled: 'Stalled', needsYou: 'Needs you', running: 'Running', open: 'Open' };

const STROKE_INK = 1.2;

function round1(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}

function pointsAttr(pts) {
  return pts.map((p) => `${round1(p.x)},${round1(p.y)}`).join(' ');
}

/**
 * Compute the 3 visible faces (top, left, right) of an axis-aligned 3D box
 * in isometric coordinates using the shared `iso()` projection.
 */
function isoBoxFaces(x0, y0, z0, wx, wy, h, opts) {
  const b10 = iso(x0 + wx, y0, z0, opts);
  const b11 = iso(x0 + wx, y0 + wy, z0, opts);
  const b01 = iso(x0, y0 + wy, z0, opts);
  const t00 = iso(x0, y0, z0 + h, opts);
  const t10 = iso(x0 + wx, y0, z0 + h, opts);
  const t11 = iso(x0 + wx, y0 + wy, z0 + h, opts);
  const t01 = iso(x0, y0 + wy, z0 + h, opts);
  return {
    top: pointsAttr([t00, t10, t11, t01]),
    left: pointsAttr([t01, t11, b11, b01]),
    right: pointsAttr([t11, t10, b10, b11]),
    corners: { b10, b11, b01, t00, t10, t11, t01 },
  };
}

function shortName(name, max = 12) {
  const clean = String(name ?? '').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function beaconsFor(counts) {
  const list = [];
  if (counts.failing > 0) list.push({ kind: 'failing', value: counts.failing });
  if (counts.stalled > 0) list.push({ kind: 'stalled', value: counts.stalled });
  if (counts.needsYou > 0) list.push({ kind: 'needsYou', value: counts.needsYou });
  if (counts.running > 0) list.push({ kind: 'running', value: counts.running });
  return list;
}

function IsoBox({ faces, topFill, leftFill, rightFill, strokeClass = 'pta-park__ink', strokeWidth = STROKE_INK }) {
  return (
    <>
      <polygon points={faces.left} fill={leftFill} className={strokeClass} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <polygon points={faces.right} fill={rightFill} className={strokeClass} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <polygon points={faces.top} fill={topFill} className={strokeClass} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </>
  );
}

function BeaconPin({ x, y, stemBottomY, kind, value }) {
  const text = value > 99 ? '99+' : String(value);
  const rx = round1(x);
  const ry = round1(y);
  const sb = round1(stemBottomY);
  const w = text.length > 2 ? 20 : text.length > 1 ? 16 : 14;
  const hw = w / 2;

  return (
    <g className={`pta-park__beacon pta-park__beacon--${kind}`}>
      {kind === 'running' ? (
        <circle cx={rx} cy={ry} r="9" className="pta-park__pulse" fill="none" strokeWidth="1.2" />
      ) : null}
      <line x1={rx} y1={ry + 5} x2={rx} y2={sb} className="pta-park__ink" strokeWidth={STROKE_INK} strokeLinecap="round" />
      <circle cx={rx} cy={sb} r="1.6" className="pta-park__pin-foot" />
      {kind === 'failing' ? (
        <>
          {/* 3D diamond pin: extruded underside + flat cap */}
          <polygon
            points={pointsAttr([
              { x: rx, y: ry - 6.5 },
              { x: rx + hw + 1.5, y: ry + 2 },
              { x: rx, y: ry + 9.5 },
              { x: rx - hw - 1.5, y: ry + 2 },
            ])}
            className="pta-park__beacon-side pta-park__ink"
            strokeWidth={STROKE_INK}
            strokeLinejoin="round"
          />
          <polygon
            points={pointsAttr([
              { x: rx, y: ry - 8.5 },
              { x: rx + hw + 1.5, y: ry },
              { x: rx, y: ry + 7.5 },
              { x: rx - hw - 1.5, y: ry },
            ])}
            className="pta-park__beacon-cap pta-park__ink"
            strokeWidth={STROKE_INK}
            strokeLinejoin="round"
          />
        </>
      ) : kind === 'stalled' ? (
        <>
          {/* 3D square pin: extruded underside + crisp square badge */}
          <rect
            x={round1(rx - hw)}
            y={round1(ry - 5)}
            width={w}
            height="13"
            rx="2.5"
            className="pta-park__beacon-side pta-park__ink"
            strokeWidth={STROKE_INK}
          />
          <rect
            x={round1(rx - hw)}
            y={round1(ry - 7)}
            width={w}
            height="13"
            rx="2.5"
            className="pta-park__beacon-cap pta-park__ink"
            strokeWidth={STROKE_INK}
          />
        </>
      ) : (
        <>
          {/* 3D rounded/cylinder pin for needsYou (amber) and running (accent) */}
          <rect
            x={round1(rx - hw)}
            y={round1(ry - 5)}
            width={w}
            height="13"
            rx="6.5"
            className="pta-park__beacon-side pta-park__ink"
            strokeWidth={STROKE_INK}
          />
          <rect
            x={round1(rx - hw)}
            y={round1(ry - 7)}
            width={w}
            height="13"
            rx="6.5"
            className="pta-park__beacon-cap pta-park__ink"
            strokeWidth={STROKE_INK}
          />
        </>
      )}
      <text x={rx} y={round1(ry + 2.5)} textAnchor="middle" className="pta-park__beacon-num">
        {text}
      </text>
    </g>
  );
}

function PlotTile({ plot, opts, active, dimmed = false, picked = false, onActivate, onDeactivate, onSelect, onStep }) {
  const { x, y, state, counts, name } = plot;
  const center = iso(x, y, 0, opts);

  // 1. Plot base slab (raised isometric pad)
  const pad = isoBoxFaces(x - 0.42, y - 0.42, 0, 0.84, 0.84, 4, opts);
  // Selection / focus diamond halo slightly outside the pad top
  const halo = [
    iso(x - 0.45, y - 0.45, 4, opts),
    iso(x + 0.45, y - 0.45, 4, opts),
    iso(x + 0.45, y + 0.45, 4, opts),
    iso(x - 0.45, y + 0.45, 4, opts),
  ];

  // 2. Small building (the site), sitting back-left on the pad
  const bHeight = state === 'calm' ? 16 : 19;
  const building = isoBoxFaces(x - 0.31, y - 0.31, 4, 0.36, 0.34, bHeight, opts);
  const roofCap = isoBoxFaces(x - 0.27, y - 0.27, 4 + bHeight, 0.28, 0.26, 3, opts);

  // Subtle architectural window strokes on the building's left & right facades
  const winL1a = iso(x - 0.23, y + 0.03, 4 + bHeight - 5, opts);
  const winL1b = iso(x - 0.03, y + 0.03, 4 + bHeight - 5, opts);
  const winL2a = iso(x - 0.23, y + 0.03, 4 + bHeight - 10, opts);
  const winL2b = iso(x - 0.03, y + 0.03, 4 + bHeight - 10, opts);
  const winR1a = iso(x + 0.05, y - 0.23, 4 + bHeight - 5, opts);
  const winR1b = iso(x + 0.05, y - 0.04, 4 + bHeight - 5, opts);
  const winR2a = iso(x + 0.05, y - 0.23, 4 + bHeight - 10, opts);
  const winR2b = iso(x + 0.05, y - 0.04, 4 + bHeight - 10, opts);

  // 3. Little belt / desk sitting beside the building on the right/front of the pad
  const desk = isoBoxFaces(x + 0.12, y - 0.16, 4, 0.21, 0.44, 5.5, opts);
  // Belt roller ticks across top of desk
  const ticks = [-0.05, 0.06, 0.17].map((dy) => ({
    a: iso(x + 0.15, y + dy, 9.5, opts),
    b: iso(x + 0.30, y + dy, 9.5, opts),
  }));
  // Tiny parcel cube on the belt when an agent is actively running
  const parcel = counts.running > 0 ? isoBoxFaces(x + 0.17, y + 0.01, 9.5, 0.11, 0.11, 5.5, opts) : null;

  // 4. Operator beacons/pins
  const beacons = beaconsFor(counts);
  const anchorTop = iso(x - 0.10, y - 0.10, 4 + bHeight + 3, opts);
  const beaconY = anchorTop.y - 10;

  // 5. Compact front nameplate pill
  const label = shortName(name, 11);
  const pillW = Math.min(76, Math.max(34, label.length * 5.6 + 10));
  const pillX = round1(center.x - pillW / 2);
  const pillY = round1(center.y + 10);

  const ariaLabel = plotAriaLabel(plot);
  const open = () => onSelect?.(plot);

  return (
    <g
      className={`pta-park__plot${active ? ' is-active' : ''}${dimmed ? ' is-dimmed' : ''}${picked ? ' is-picked' : ''}`}
      data-state={state}
      data-plot-id={String(plot.id)}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-expanded={picked}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        } else if (['j', 'k', 'ArrowRight', 'ArrowLeft'].includes(event.key)) {
          event.preventDefault();
          onStep?.(plot.id, event.key === 'j' || event.key === 'ArrowRight' ? 1 : -1);
        }
      }}
      onMouseEnter={() => onActivate(plot.id)}
      onMouseLeave={() => onDeactivate(plot.id)}
      onFocus={() => onActivate(plot.id)}
      onBlur={() => onDeactivate(plot.id)}
    >
      <title>{ariaLabel}</title>

      <g className="pta-park__lift">
        {/* Base plot slab */}
        <IsoBox
          faces={pad}
          topFill="var(--park-pad-top)"
          leftFill="var(--park-pad-left)"
          rightFill="var(--park-pad-right)"
          strokeClass="pta-park__pad-edge"
          strokeWidth={STROKE_INK}
        />

        {/* Hover / keyboard focus outline around the pad */}
        <polygon points={pointsAttr(halo)} fill="none" className="pta-park__halo" strokeWidth="1.6" strokeLinejoin="round" />

        {/* Little belt / desk */}
        <IsoBox
          faces={desk}
          topFill="var(--park-desk-top)"
          leftFill="var(--park-desk-left)"
          rightFill="var(--park-desk-right)"
        />
        {ticks.map((tick, idx) => (
          <line
            key={idx}
            x1={round1(tick.a.x)}
            y1={round1(tick.a.y)}
            x2={round1(tick.b.x)}
            y2={round1(tick.b.y)}
            className="pta-park__detail"
            strokeWidth="1"
            strokeLinecap="round"
          />
        ))}
        {parcel ? (
          <IsoBox
            faces={parcel}
            topFill="var(--park-parcel-top)"
            leftFill="var(--park-parcel-left)"
            rightFill="var(--park-parcel-right)"
          />
        ) : null}

        {/* Small site building */}
        <IsoBox
          faces={building}
          topFill="var(--park-top)"
          leftFill="var(--park-left)"
          rightFill="var(--park-right)"
        />
        <line x1={round1(winL1a.x)} y1={round1(winL1a.y)} x2={round1(winL1b.x)} y2={round1(winL1b.y)} className="pta-park__detail" strokeWidth="1.1" strokeLinecap="round" />
        <line x1={round1(winL2a.x)} y1={round1(winL2a.y)} x2={round1(winL2b.x)} y2={round1(winL2b.y)} className="pta-park__detail" strokeWidth="1.1" strokeLinecap="round" />
        <line x1={round1(winR1a.x)} y1={round1(winR1a.y)} x2={round1(winR1b.x)} y2={round1(winR1b.y)} className="pta-park__detail" strokeWidth="1.1" strokeLinecap="round" />
        <line x1={round1(winR2a.x)} y1={round1(winR2a.y)} x2={round1(winR2b.x)} y2={round1(winR2b.y)} className="pta-park__detail" strokeWidth="1.1" strokeLinecap="round" />
        <IsoBox
          faces={roofCap}
          topFill="var(--park-top)"
          leftFill="var(--park-left)"
          rightFill="var(--park-right)"
        />

        {/* 3D operator beacons/pins with count */}
        {beacons.map((beacon, idx) => {
          const offset = (idx - (beacons.length - 1) / 2) * 18;
          return (
            <BeaconPin
              key={beacon.kind}
              x={anchorTop.x + offset}
              y={beaconY}
              stemBottomY={anchorTop.y}
              kind={beacon.kind}
              value={beacon.value}
            />
          );
        })}
      </g>

      {/* Compact nameplate */}
      <g className="pta-park__tag">
        <rect x={pillX} y={pillY} width={round1(pillW)} height="13" rx="3" className="pta-park__tag-bg" strokeWidth="1" />
        <text x={round1(center.x)} y={round1(pillY + 9.4)} textAnchor="middle" className="pta-park__tag-text">
          {label}
        </text>
      </g>
    </g>
  );
}

/**
 * Compact isometric "Project park" overview for the top of NeedsYouPage.
 */
export function ProjectPark({ projects = [], tickets = [], runs = [], recentRuns = [], now = Date.now(), onSelect, onOpenTicket }) {
  const [activeId, setActiveId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [pickedId, setPickedId] = useState(null);
  const rootRef = useRef(null);

  const plots = useMemo(
    () => parkPlots({ projects, tickets, runs, now }),
    [projects, tickets, runs, now],
  );
  const counts = useMemo(() => filterCounts(plots), [plots]);

  // Escape or a click outside the park closes the ticket strip.
  useEffect(() => {
    if (pickedId === null) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setPickedId(null);
    };
    const onDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setPickedId(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [pickedId]);

  /** J/K or arrows: move focus to the next plot in urgency order, within the filter. */
  const step = (id, delta) => {
    const order = plots.filter((plot) => plotMatches(plot, filter));
    if (order.length === 0) return;
    const at = order.findIndex((plot) => plot.id === id);
    const next = order[(at + delta + order.length) % order.length];
    const el = rootRef.current?.querySelector(`[data-plot-id="${CSS.escape(String(next.id))}"]`);
    el?.focus();
  };

  // Paint back-to-front so front buildings/beacons layer cleanly over rear pads.
  const painted = useMemo(
    () => [...plots].sort((a, b) => (a.x + a.y) - (b.x + b.y) || (a.x - a.y) - (b.x - b.y)),
    [plots],
  );

  const layout = useMemo(() => {
    if (plots.length === 0) return null;
    const rawPts = plots.map((plot) => iso(plot.x, plot.y, 0));
    const minX = Math.min(...rawPts.map((pt) => pt.x));
    const maxX = Math.max(...rawPts.map((pt) => pt.x));
    const minY = Math.min(...rawPts.map((pt) => pt.y));
    const maxY = Math.max(...rawPts.map((pt) => pt.y));
    const padLeft = 64;
    const padRight = 64;
    const padTop = 60;
    const padBottom = 30;
    const width = Math.max(240, Math.round(maxX - minX + padLeft + padRight));
    const height = Math.round(maxY - minY + padTop + padBottom);
    return {
      width,
      height,
      opts: {
        tileW: ISO_TILE.width,
        tileH: ISO_TILE.height,
        originX: padLeft - minX,
        originY: padTop - minY,
      },
    };
  }, [plots]);

  if (!layout || plots.length === 0) return null;

  const activePlot = activeId !== null ? plots.find((plot) => plot.id === activeId) ?? null : null;
  const activeHeadline = activePlot
    ? [plotWaitLabel(activePlot, tickets, runs, now, recentRuns), plotHeadline(activePlot, tickets, runs, now)].filter(Boolean).join(' · ') || null
    : null;
  const pickedPlot = pickedId !== null ? plots.find((plot) => plot.id === pickedId) ?? null : null;
  const pickedRows = pickedPlot ? plotTickets(pickedPlot, tickets, runs, now, recentRuns).slice(0, 4) : [];
  const pickedProject = pickedPlot ? projects.find((p) => String(p?.id) === String(pickedPlot.id)) : null;
  const pickedSite = pickedProject ? (Array.isArray(pickedProject.sites) ? pickedProject.sites[0] : pickedProject.site) : null;
  const pickedUrl = pickedSite?.customDomain
    ? `https://${String(pickedSite.customDomain).replace(/^https?:\/\//, '')}`
    : pickedSite?.productionUrl ?? null;
  const pick = (plot) => setPickedId((prev) => (prev === plot.id ? null : plot.id));

  const activate = (id) => setActiveId(id);
  const deactivate = (id) => setActiveId((prev) => (prev === id ? null : prev));

  return (
    <section className="pta-park" aria-label="Project park" ref={rootRef}>
      <div className="pta-park__head">
        <div className="pta-park__title">
          <span className="pta-park__label">Project park</span>
          <span className="pta-count">{plots.length}</span>
        </div>
        {activePlot ? (
          <div className="pta-park__tip" role="status">
            <strong>{activePlot.name}</strong>
            {activePlot.client ? <span className="pta-park__tip-client">· {activePlot.client}</span> : null}
            <span className="pta-park__tip-counts">{activeHeadline ?? countsSummary(activePlot.counts)}</span>
          </div>
        ) : (
          <div className="pta-park__filters" role="group" aria-label="Filter projects">
            {PARK_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`pta-park__filter pta-park__filter--${f.key}`}
                aria-pressed={filter === f.key}
                disabled={f.key !== 'all' && counts[f.key] === 0}
                onClick={() => setFilter((prev) => (prev === f.key ? 'all' : f.key))}
              >
                {f.key !== 'all' ? <i className="pta-park__swatch" aria-hidden="true" /> : null}
                {f.label}
                <span className="pta-park__filter-n">{counts[f.key]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <FleetTicker running={runs} recent={recentRuns} tickets={tickets} onOpenTicket={onOpenTicket} />

      <div className="pta-park__scroll">
        <svg
          className="pta-park__svg"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label={`Project park with ${plots.length} ${plots.length === 1 ? 'project' : 'projects'}, sorted most urgent front-left`}
        >
          <defs>
            <pattern id="pta-park-dots" width="20" height="10" patternUnits="userSpaceOnUse">
              <circle cx="5" cy="2.5" r="0.9" className="pta-park__dot" />
              <circle cx="15" cy="7.5" r="0.9" className="pta-park__dot" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={layout.width} height={layout.height} fill="url(#pta-park-dots)" />
          {painted.map((plot) => (
            <PlotTile
              key={String(plot.id)}
              plot={plot}
              opts={layout.opts}
              active={activeId === plot.id}
              dimmed={!plotMatches(plot, filter)}
              picked={pickedId === plot.id}
              onActivate={activate}
              onDeactivate={deactivate}
              onSelect={pick}
              onStep={step}
            />
          ))}
        </svg>
      </div>

      {pickedPlot ? (
        <div className="pta-park__strip" role="region" aria-label={`${pickedPlot.name}: open work`}>
          <div className="pta-park__strip-head">
            <strong>{pickedPlot.name}</strong>
            {pickedPlot.client ? <span className="pta-park__strip-client">{pickedPlot.client}</span> : null}
            <span className="pta-park__strip-actions">
              {pickedUrl ? (
                <a href={pickedUrl} target="_blank" rel="noreferrer" className="pta-park__strip-link">Site ↗</a>
              ) : null}
              <button type="button" className="pta-park__strip-link" onClick={() => onSelect?.(pickedPlot)}>Open project</button>
              <button type="button" className="pta-park__strip-close" aria-label="Close" onClick={() => setPickedId(null)}>×</button>
            </span>
          </div>
          {pickedRows.length ? (
            <ul className="pta-park__strip-list">
              {pickedRows.map((row) => (
                <li key={String(row.id)}>
                  <button
                    type="button"
                    className={`pta-park__strip-row is-${row.kind}`}
                    title="Open the ticket's conversation"
                    onClick={() => onOpenTicket?.({ id: row.id, title: row.title })}
                  >
                    <span className="pta-park__strip-kind">{KIND_LABEL[row.kind]}</span>
                    <span className="pta-park__strip-title">#{row.id} {row.title}</span>
                    {row.via ? <span className="pta-park__strip-via">via {row.via}</span> : null}
                    <RunBand trail={runTrail(row.id, runs, recentRuns, now)} />
                    {row.wait ? (
                      <span className="pta-park__strip-age is-wait" title={row.wait.text}>{row.wait.text}</span>
                    ) : row.age ? (
                      <span className="pta-park__strip-age">{row.age}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pta-park__strip-empty">Nothing open on this project.</p>
          )}
        </div>
      ) : null}

      <ul className="pta-sr" aria-label="Projects by urgency">
        {plots.map((plot) => (
          <li key={String(plot.id)}>{plotAriaLabel(plot)}</li>
        ))}
      </ul>
    </section>
  );
}

/** Styles injected alongside NATIVE_STYLES in client.jsx; theme-aware for light & dark. */
export const PROJECT_PARK_STYLES = `
  .pta-park{position:relative;margin:0 0 14px;padding:7px 10px 6px;border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.24));border-radius:10px;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.05));overflow:hidden}
  .pta-park__head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:20px;margin:0 0 4px}
  .pta-park__title{display:inline-flex;align-items:center;gap:2px;flex:0 0 auto}
  .pta-park__label{font-size:11px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,inherit);opacity:.82}
  .pta-park__legend{display:inline-flex;align-items:center;gap:9px;flex-wrap:wrap;font-size:10.5px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.85))}
  .pta-park__leg{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
  .pta-park__swatch{display:inline-block;width:7px;height:7px;border-radius:2px;border:1px solid rgba(20,24,30,.45)}
  .pta-park__swatch--bad{background:var(--dsw-alias-state-danger-primary,#e5534b)}
  .pta-park__swatch--attention{background:var(--dsw-alias-state-warning-primary,#d18f2e)}
  .pta-park__swatch--active{background:var(--dsw-alias-state-business-primary,#4c8dff)}
  .pta-park__swatch--calm{background:var(--dsw-alias-label-tertiary,#8a9099)}
  .pta-park__tip{display:inline-flex;align-items:baseline;gap:6px;min-width:0;max-width:75%;padding:1px 8px;border:1px solid var(--dsw-alias-border-primary,rgba(127,127,127,.35));border-radius:6px;background:rgba(128,134,142,.16);font-size:11px;line-height:18px;color:var(--dsw-alias-label-primary,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pta-park__tip strong{font-weight:600;flex:0 0 auto}
  .pta-park__tip-client{color:var(--dsw-alias-label-secondary,inherit);opacity:.78;overflow:hidden;text-overflow:ellipsis}
  .pta-park__tip-counts{color:var(--dsw-alias-label-secondary,inherit);margin-left:2px;overflow:hidden;text-overflow:ellipsis}
  .pta-park__scroll{overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;max-height:150px;scrollbar-width:thin}
  .pta-park__svg{display:block;user-select:none}
  .pta-park__dot{fill:var(--dsw-alias-border-primary,rgba(127,127,127,.42));opacity:.65}
  .pta-park__ink{stroke:var(--pta-park-ink,#1c2128)}
  .pta-park__pad-edge{stroke:var(--dsw-alias-border-primary,rgba(127,127,127,.58))}
  .pta-park__detail{stroke:var(--pta-park-ink,#1c2128);opacity:.5}
  .pta-park__pin-foot{fill:var(--pta-park-ink,#1c2128)}
  .pta-park__plot{cursor:pointer;outline:none;--park-desk-top:#dfe3e8;--park-desk-left:#b9c0ca;--park-desk-right:#8f98a6;--park-parcel-top:#a8c7ff;--park-parcel-left:#5d98ff;--park-parcel-right:#366bc9}
  .pta-park__plot[data-state="calm"]{--park-top:#dde1e7;--park-left:#b8c0cb;--park-right:#8d96a4;--park-pad-top:rgba(138,144,153,.18);--park-pad-left:rgba(138,144,153,.28);--park-pad-right:rgba(138,144,153,.38);--park-halo:var(--dsw-alias-label-secondary,#8a9099)}
  .pta-park__plot[data-state="active"]{--park-top:#9bc0ff;--park-left:#5895ff;--park-right:#3468c7;--park-top:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4c8dff) 46%,#fff);--park-left:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4c8dff) 84%,#fff);--park-right:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4c8dff) 76%,#000);--park-pad-top:rgba(76,141,255,.18);--park-pad-left:rgba(76,141,255,.28);--park-pad-right:rgba(76,141,255,.38);--park-halo:var(--dsw-alias-state-business-primary,#4c8dff)}
  .pta-park__plot[data-state="attention"]{--park-top:#f3cf90;--park-left:#dfa13e;--park-right:#a86f1c;--park-top:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d18f2e) 46%,#fff);--park-left:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d18f2e) 86%,#fff);--park-right:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d18f2e) 76%,#000);--park-pad-top:rgba(209,143,46,.18);--park-pad-left:rgba(209,143,46,.28);--park-pad-right:rgba(209,143,46,.38);--park-halo:var(--dsw-alias-state-warning-primary,#d18f2e)}
  .pta-park__plot[data-state="bad"]{--park-top:#f59e99;--park-left:#e55a52;--park-right:#ad352e;--park-top:color-mix(in srgb,var(--dsw-alias-state-danger-primary,#e5534b) 48%,#fff);--park-left:color-mix(in srgb,var(--dsw-alias-state-danger-primary,#e5534b) 86%,#fff);--park-right:color-mix(in srgb,var(--dsw-alias-state-danger-primary,#e5534b) 74%,#000);--park-pad-top:rgba(229,83,75,.18);--park-pad-left:rgba(229,83,75,.28);--park-pad-right:rgba(229,83,75,.38);--park-halo:var(--dsw-alias-state-danger-primary,#e5534b)}
  .pta-park__lift{transition:transform .14s ease-out}
  .pta-park__plot:hover .pta-park__lift,.pta-park__plot:focus-visible .pta-park__lift{transform:translateY(-2px)}
  .pta-park__halo{stroke:var(--park-halo,var(--dsw-alias-brand-primary,#ff5a1f));opacity:0;transition:opacity .12s ease-out}
  .pta-park__plot:hover .pta-park__halo{opacity:.75}
  .pta-park__plot:focus-visible .pta-park__halo{opacity:1;stroke-width:2}
  .pta-park__beacon--failing .pta-park__beacon-cap{fill:var(--dsw-alias-state-danger-primary,#e5534b)}
  .pta-park__beacon--failing .pta-park__beacon-side{fill:#a83029}
  .pta-park__beacon--stalled .pta-park__beacon-cap{fill:#d9483b}
  .pta-park__beacon--stalled .pta-park__beacon-side{fill:#962920}
  .pta-park__beacon--needsYou .pta-park__beacon-cap{fill:var(--dsw-alias-state-warning-primary,#d18f2e)}
  .pta-park__beacon--needsYou .pta-park__beacon-side{fill:#996418}
  .pta-park__beacon--running .pta-park__beacon-cap{fill:var(--dsw-alias-state-business-primary,#4c8dff)}
  .pta-park__beacon--running .pta-park__beacon-side{fill:#2d5db5}
  .pta-park__beacon-num{font-size:8.5px;font-weight:700;fill:#fff;font-variant-numeric:tabular-nums;pointer-events:none}
  .pta-park__beacon--needsYou .pta-park__beacon-num{fill:#1c2128}
  .pta-park__pulse{stroke:var(--dsw-alias-state-business-primary,#4c8dff);opacity:.65;transform-box:fill-box;transform-origin:center;animation:pta-park-pulse 2s ease-out infinite}
  @keyframes pta-park-pulse{0%{transform:scale(.85);opacity:.75}70%{transform:scale(1.45);opacity:0}100%{transform:scale(1.45);opacity:0}}
  .pta-park__tag-bg{fill:rgba(128,134,142,.24);stroke:var(--dsw-alias-border-secondary,rgba(127,127,127,.42))}
  .pta-park__tag-text{font-size:9px;font-weight:550;fill:var(--dsw-alias-label-primary,currentColor);pointer-events:none}
  @media (prefers-reduced-motion:reduce){.pta-park__pulse{animation:none;opacity:.45}.pta-park__lift,.pta-park__halo{transition:none}}
  .pta-park__filters{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap;justify-content:flex-end}
  .pta-park__filter{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.3));border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:10.5px;line-height:17px;cursor:pointer}
  .pta-park__filter:hover:not(:disabled){background:rgba(128,134,142,.16)}
  .pta-park__filter[aria-pressed="true"]{background:rgba(128,134,142,.24);color:var(--dsw-alias-label-primary,inherit);border-color:var(--dsw-alias-border-primary,rgba(127,127,127,.5))}
  .pta-park__filter:disabled{opacity:.4;cursor:default}
  .pta-park__filter-n{font-variant-numeric:tabular-nums;opacity:.75}
  .pta-park__filter--needsYou .pta-park__swatch{background:var(--dsw-alias-state-warning-primary,#d18f2e)}
  .pta-park__filter--failing .pta-park__swatch{background:var(--dsw-alias-state-danger-primary,#e5534b)}
  .pta-park__filter--stalled .pta-park__swatch{background:#d9483b}
  .pta-park__filter--running .pta-park__swatch{background:var(--dsw-alias-state-business-primary,#4c8dff)}
  .pta-park__plot.is-dimmed{opacity:.25}
  .pta-park__plot.is-picked .pta-park__halo{opacity:1;stroke-width:2}
  .pta-park__strip{margin:4px 0 2px;padding:6px 8px;border-radius:8px;background:rgba(128,134,142,.12);font-size:11.5px;color:var(--dsw-alias-label-primary,inherit)}
  .pta-park__strip-head{display:flex;align-items:baseline;gap:8px;margin:0 0 4px}
  .pta-park__strip-client{color:var(--dsw-alias-label-secondary,inherit);opacity:.8}
  .pta-park__strip-actions{margin-left:auto;display:inline-flex;align-items:center;gap:8px}
  .pta-park__strip-link{background:none;border:0;padding:0;font:inherit;font-size:11px;color:var(--dsw-alias-label-secondary,inherit);text-decoration:underline;cursor:pointer}
  .pta-park__strip-close{background:none;border:0;padding:0 2px;font-size:14px;line-height:1;color:var(--dsw-alias-label-secondary,inherit);cursor:pointer}
  .pta-park__strip-list{list-style:none;margin:0;padding:0;display:grid;gap:2px}
  .pta-park__strip-row{display:flex;align-items:baseline;gap:8px;width:100%;padding:3px 6px;border:0;border-radius:6px;background:transparent;font:inherit;color:inherit;text-align:left;cursor:pointer}
  .pta-park__strip-row:hover,.pta-park__strip-row:focus-visible{background:rgba(128,134,142,.18);outline:none}
  .pta-park__strip-kind{flex:0 0 64px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;opacity:.8}
  .pta-park__strip-row.is-stalled .pta-park__strip-kind{color:#d9483b;opacity:1}
  .pta-park__strip-row.is-needsYou .pta-park__strip-kind{color:var(--dsw-alias-state-warning-primary,#d18f2e);opacity:1}
  .pta-park__strip-row.is-running .pta-park__strip-kind{color:var(--dsw-alias-state-business-primary,#4c8dff);opacity:1}
  .pta-park__strip-title{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pta-park__strip-via{flex:0 0 auto;padding:0 5px;border-radius:4px;background:rgba(128,134,142,.2);font-size:10px}
  .pta-park__strip-age{flex:0 0 auto;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,inherit)}
  .pta-park__strip-age.is-wait{color:var(--dsw-alias-state-warning-primary,#d18f2e)}
  .pta-park__ticker{display:flex;align-items:center;gap:5px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin:0 0 4px;font-size:10.5px;color:var(--dsw-alias-label-secondary,inherit)}
  .pta-park__chip{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;max-width:260px;padding:1px 8px;border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.3));border-radius:999px;background:rgba(128,134,142,.12);color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:10.5px;line-height:17px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pta-park__chip:hover,.pta-park__chip:focus-visible{background:rgba(128,134,142,.24);outline:none}
  .pta-park__chip.is-failed{border-color:color-mix(in srgb,var(--dsw-alias-state-danger-primary,#e5534b) 55%,transparent)}
  .pta-park__ticker-idle{flex:0 0 auto;white-space:nowrap;opacity:.85}
  .pta-park__runs{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;font-size:10px;color:var(--dsw-alias-label-secondary,inherit);white-space:nowrap}
  .pta-park__runband{display:inline-flex;gap:2px}
  .pta-park__run{display:inline-block;width:8px;height:8px;border-radius:2px;background:rgba(128,134,142,.45)}
  .pta-park__run.is-ok{background:var(--dsw-alias-state-success-primary,#35c07a)}
  .pta-park__run.is-failed{background:var(--dsw-alias-state-danger-primary,#e5534b)}
  .pta-park__run.is-running{background:var(--dsw-alias-state-business-primary,#4c8dff);animation:pta-park-run 1.6s ease-in-out infinite}
  @keyframes pta-park-run{50%{opacity:.35}}
  @media (prefers-reduced-motion:reduce){.pta-park__run.is-running{animation:none}}
  .pta-park__strip-empty{margin:0;color:var(--dsw-alias-label-secondary,inherit)}
`;
