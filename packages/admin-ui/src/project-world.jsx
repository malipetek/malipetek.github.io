/*
 * Interactive functional-isometric ProjectMap for Project → Overview.
 *
 * Contract (docs/admin-ui-refresh/06-design-system.md §7.3):
 *   - 5 functional stations only: request → agent → code → preview → hosting.
 *   - Three-tone isometric faces & crisp ink lines preserved.
 *   - Two-line label plates (name + real status) legible at 100% with zero
 *     truncation and zero overlapping geometry; all text ≥11px.
 *   - Hover lifts without hijacking selection; click selects into the shared
 *     Inspector; roving tabIndex + arrows + Home/End + Enter; right-click /
 *     Shift+F10 opens the shared Menu.
 *   - No idle animation; pulse strictly when state === 'active'; all motion
 *     disabled under prefers-reduced-motion.
 *   - Collapsible via PipelineStrip summary; ≤900px (or narrow container)
 *     replaced by a vertical route list with the same statuses and actions.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Inspector, Menu, StateIndicator, UiStyles } from './ui/index.js';
import {
  FLOOR_BOUNDS,
  STATION_ORDER,
  STATION_POSITIONS,
  VISITOR_POS,
  cablesFor,
  defaultJourneyTicket,
  iso,
  isoBox,
  isoPoints,
  journeyFor,
  journeyPillTickets,
  plateLayout,
  plateWidth,
  stationsFor,
  tx,
  unshippedPreview,
} from './project-world-model.mjs';

const STATE_SPEC = {
  ok: { state: 'ok', tone: 'ok', key: 'world.state.ok', fallback: 'Healthy', live: false },
  active: { state: 'running', tone: 'info', key: 'world.state.active', fallback: 'Running', live: true },
  warn: { state: 'check', tone: 'warn', key: 'world.state.warn', fallback: 'Needs review', live: false },
  bad: { state: 'failed', tone: 'bad', key: 'world.state.bad', fallback: 'Needs attention', live: false },
  off: { state: 'queued', tone: 'neutral', key: 'world.state.off', fallback: 'Idle', live: false },
  unknown: { state: 'unknown', tone: 'neutral', key: 'world.state.unknown', fallback: 'Unknown', live: false },
};

function StationStateIndicator({ state, t, dotOnly = false }) {
  const spec = STATE_SPEC[state] ?? STATE_SPEC.off;
  return (
    <StateIndicator
      state={spec.state}
      tone={spec.tone}
      label={tx(t, spec.key, spec.fallback)}
      live={spec.live}
      dotOnly={dotOnly}
    />
  );
}

/** Reusable 3-tone isometric box with top / front-left / front-right faces. */
function IsoBox({ x, y, z, dx, dy, dz, tone = 'base', className = '' }) {
  const b = isoBox(x, y, z, dx, dy, dz);
  const topCls =
    tone === 'accent'
      ? 'aw-world__face-accent-top'
      : tone === 'ok'
        ? 'aw-world__face-ok'
        : tone === 'bad'
          ? 'aw-world__face-bad'
          : tone === 'warn'
            ? 'aw-world__face-warn'
            : 'aw-world__face-top';
  const leftCls = tone === 'accent' ? 'aw-world__face-accent-left' : 'aw-world__face-left';
  const rightCls = tone === 'accent' ? 'aw-world__face-accent-right' : 'aw-world__face-right';
  return (
    <g className={className || undefined}>
      <polygon className={leftCls} points={b.left} />
      <polygon className={rightCls} points={b.right} />
      <polygon className={topCls} points={b.top} />
    </g>
  );
}

/** Small directional arrow along a cable from p1 -> p2, placed at fraction `u`. */
function CableArrow({ p1, p2, u = 0.5, active }) {
  const mx = p1.x + (p2.x - p1.x) * u;
  const my = p1.y + (p2.y - p1.y) * u;
  const angle = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
  return (
    <polygon
      className={active ? 'aw-world__cable-arrow is-active' : 'aw-world__cable-arrow'}
      points="4.5,0 -3.5,-3 -2,0 -3.5,3"
      transform={`translate(${mx.toFixed(1)}, ${my.toFixed(1)}) rotate(${angle.toFixed(1)})`}
    />
  );
}

/** Floating circular count badge for open requests / active builds. */
function CountBadge({ x, y, z, count, tone = 'accent' }) {
  if (!count) return null;
  const p = iso(x, y, z);
  const text = count > 99 ? '99+' : String(count);
  const rx = text.length > 2 ? 14 : 10.5;
  return (
    <g aria-hidden="true">
      <rect
        className={tone === 'bad' ? 'aw-world__badge-bg aw-world__badge-bg--bad' : 'aw-world__badge-bg'}
        x={p.x - rx}
        y={p.y - 10.5}
        width={rx * 2}
        height={21}
        rx={10.5}
      />
      <text className="aw-world__badge-text" x={p.x} y={p.y + 0.5}>
        {text}
      </text>
    </g>
  );
}

/* ————— Individual isometric station illustrations (5 functional stations) ————— */

function HostingObject({ station }) {
  const { x, y, state, meta } = station;
  const x0 = x - 0.62;
  const y0 = y - 0.58;
  const w = 1.24;
  const d = 1.16;
  const h = 1.18;
  const roofTone = state === 'active' ? 'accent' : state === 'bad' ? 'bad' : state === 'warn' ? 'warn' : 'base';
  const winCls =
    state === 'ok'
      ? 'aw-world__window aw-world__window--ok'
      : state === 'active'
        ? 'aw-world__window aw-world__window--lit'
        : 'aw-world__window';

  const doorPts = isoPoints([
    [x - 0.19, y0 + d, 0.04],
    [x + 0.19, y0 + d, 0.04],
    [x + 0.19, y0 + d, 0.52],
    [x - 0.19, y0 + d, 0.52],
  ]);
  const winL = isoPoints([
    [x0 + 0.18, y0 + d, 0.7],
    [x0 + 0.52, y0 + d, 0.7],
    [x0 + 0.52, y0 + d, 0.98],
    [x0 + 0.18, y0 + d, 0.98],
  ]);
  const winR = isoPoints([
    [x0 + 0.72, y0 + d, 0.7],
    [x0 + 1.06, y0 + d, 0.7],
    [x0 + 1.06, y0 + d, 0.98],
    [x0 + 0.72, y0 + d, 0.98],
  ]);

  const vents = [0.3, 0.56, 0.82, 1.02].map((vz) => {
    const a = iso(x0 + w, y0 + 0.2, vz);
    const b = iso(x0 + w, y0 + d - 0.2, vz);
    return { vz, a, b };
  });

  const mastBase = iso(x + 0.24, y - 0.16, h + 0.22);
  const mastTop = iso(x + 0.24, y - 0.16, h + 0.56);
  const lockPt = iso(x - 0.28, y + 0.18, h + 0.28);

  return (
    <g className="aw-world__object">
      <IsoBox x={x0 - 0.08} y={y0 - 0.08} z={0} dx={w + 0.16} dy={d + 0.16} dz={0.1} />
      <IsoBox x={x0} y={y0} z={0.1} dx={w} dy={d} dz={h - 0.1} />
      <IsoBox x={x0 - 0.04} y={y0 - 0.04} z={h} dx={w + 0.08} dy={d + 0.08} dz={0.1} tone={roofTone} />
      <IsoBox x={x0 + 0.16} y={y0 + 0.18} z={h + 0.1} dx={0.44} dy={0.4} dz={0.2} />
      <line className="aw-world__ink-line" x1={mastBase.x} y1={mastBase.y} x2={mastTop.x} y2={mastTop.y} />
      <circle className={`aw-world__beacon aw-world__beacon--${state}`} cx={mastTop.x} cy={mastTop.y} r={4.5} />
      {meta?.httpsVerified ? (
        <circle className="aw-world__beacon aw-world__beacon--ok" cx={lockPt.x} cy={lockPt.y} r={3} />
      ) : null}
      <polygon
        className={state === 'ok' ? 'aw-world__face-ok' : state === 'bad' ? 'aw-world__face-bad' : 'aw-world__window'}
        points={doorPts}
      />
      <polygon className={winCls} points={winL} />
      <polygon className={winCls} points={winR} />
      {vents.map((v) => (
        <line key={v.vz} className="aw-world__detail-line" x1={v.a.x} y1={v.a.y} x2={v.b.x} y2={v.b.y} />
      ))}
    </g>
  );
}

/** Glass-cloche mini shop representing Preview & publish. */
function PreviewObject({ station }) {
  const { x, y, state, meta } = station;
  const roofTone =
    state === 'active'
      ? 'accent'
      : state === 'ok'
        ? 'ok'
        : state === 'warn'
          ? 'warn'
          : state === 'bad'
            ? 'bad'
            : 'base';
  const winCls =
    state === 'ok'
      ? 'aw-world__window aw-world__window--ok'
      : state === 'active'
        ? 'aw-world__window aw-world__window--lit'
        : 'aw-world__window';

  const doorPts = isoPoints([
    [x - 0.1, y + 0.25, 0.15],
    [x + 0.09, y + 0.25, 0.15],
    [x + 0.09, y + 0.25, 0.39],
    [x - 0.1, y + 0.25, 0.39],
  ]);
  const winPts = isoPoints([
    [x + 0.28, y - 0.12, 0.25],
    [x + 0.28, y + 0.13, 0.25],
    [x + 0.28, y + 0.13, 0.44],
    [x + 0.28, y - 0.12, 0.44],
  ]);

  const c = iso(x, y, 0.15);
  const rx = 30;
  const ry = 15.5;
  const domeH = 46;
  const backRim = `M ${c.x - rx} ${c.y} A ${rx} ${ry} 0 0 1 ${c.x + rx} ${c.y}`;
  const domeShell = [
    `M ${c.x - rx} ${c.y}`,
    `C ${c.x - rx} ${c.y - domeH}, ${c.x + rx} ${c.y - domeH}, ${c.x + rx} ${c.y}`,
    `A ${rx} ${ry} 0 0 1 ${c.x - rx} ${c.y}`,
    'Z',
  ].join(' ');
  const shineArc = `M ${c.x - rx + 6} ${c.y - 9} C ${c.x - rx + 7} ${c.y - 25}, ${c.x - 10} ${c.y - 33}, ${c.x - 4} ${c.y - 34}`;
  const apexY = c.y - 38;

  return (
    <g className="aw-world__object">
      <IsoBox x={x - 0.52} y={y - 0.48} z={0} dx={1.04} dy={0.96} dz={0.14} />
      <path className="aw-world__cloche-rim-back" d={backRim} />
      <IsoBox x={x - 0.28} y={y - 0.25} z={0.14} dx={0.56} dy={0.5} dz={0.4} />
      <IsoBox x={x - 0.31} y={y - 0.28} z={0.54} dx={0.62} dy={0.56} dz={0.07} tone={roofTone} />
      <polygon
        className={
          state === 'ok'
            ? 'aw-world__face-ok'
            : state === 'active'
              ? 'aw-world__face-accent-top'
              : state === 'warn'
                ? 'aw-world__face-warn'
                : 'aw-world__window'
        }
        points={doorPts}
      />
      <polygon className={winCls} points={winPts} />
      <path
        className={
          state === 'active'
            ? 'aw-world__cloche-glass aw-world__cloche-glass--active'
            : state === 'warn'
              ? 'aw-world__cloche-glass aw-world__cloche-glass--warn'
              : 'aw-world__cloche-glass'
        }
        d={domeShell}
      />
      <path className="aw-world__cloche-shine" d={shineArc} />
      <circle className={`aw-world__beacon aw-world__beacon--${state}`} cx={c.x} cy={apexY} r={4} />
      <CountBadge x={x + 0.38} y={y - 0.22} z={0.92} count={meta?.driftCount ?? 0} />
    </g>
  );
}

function CodeObject({ station }) {
  const { x, y, state } = station;
  const x0 = x - 0.42;
  const y0 = y - 0.4;
  const w = 0.84;
  const d = 0.8;
  const h = 1.18;
  const topTone = state === 'bad' ? 'bad' : state === 'warn' ? 'warn' : state === 'active' ? 'accent' : 'base';

  const drawerTops = [0.4, 0.78];
  const handles = [0.21, 0.59, 0.97];
  const beaconPt = iso(x0 + w - 0.14, y0 + 0.14, h + 0.04);

  return (
    <g className="aw-world__object">
      <IsoBox x={x0} y={y0} z={0} dx={w} dy={d} dz={h} tone={topTone} />
      {drawerTops.map((dz) => {
        const a = iso(x0 + 0.05, y0 + d, dz);
        const b = iso(x0 + w - 0.05, y0 + d, dz);
        return <line key={dz} className="aw-world__ink-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
      })}
      <IsoBox x={x0 + 0.08} y={y0 + d} z={0.42} dx={w - 0.16} dy={0.22} dz={0.32} />
      <IsoBox
        x={x0 + 0.16}
        y={y0 + d + 0.04}
        z={0.74}
        dx={0.26}
        dy={0.08}
        dz={0.12}
        tone={state === 'ok' ? 'ok' : state === 'bad' ? 'bad' : state === 'warn' ? 'warn' : 'base'}
      />
      <IsoBox x={x0 + 0.45} y={y0 + d + 0.06} z={0.74} dx={0.24} dy={0.08} dz={0.09} />
      {handles.map((hz) => {
        const yFace = hz === 0.59 ? y0 + d + 0.22 : y0 + d;
        const a = iso(x - 0.13, yFace, hz);
        const b = iso(x + 0.13, yFace, hz);
        return <line key={hz} className="aw-world__ink-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
      })}
      <circle className={`aw-world__beacon aw-world__beacon--${state}`} cx={beaconPt.x} cy={beaconPt.y} r={4} />
    </g>
  );
}

function AgentObject({ station }) {
  const { x, y, state, meta } = station;
  const x0 = x - 0.56;
  const y0 = y - 0.42;
  const w = 1.12;
  const d = 0.84;
  const deskZ = 0.5;
  const working = state === 'active';
  const stalled = state === 'bad';

  const screenPts = isoPoints([
    [x - 0.22, y0 + 0.28, deskZ + 0.2],
    [x + 0.24, y0 + 0.28, deskZ + 0.2],
    [x + 0.24, y0 + 0.28, deskZ + 0.54],
    [x - 0.22, y0 + 0.28, deskZ + 0.54],
  ]);

  const c1a = iso(x0 + 0.14, y0 + 0.56, deskZ + 0.12);
  const c1b = iso(x0 + 0.34, y0 + 0.56, deskZ + 0.12);

  return (
    <g className="aw-world__object">
      <IsoBox x={x0 + 0.06} y={y0 + 0.06} z={0} dx={0.24} dy={d - 0.12} dz={deskZ} />
      <IsoBox x={x0 + w - 0.3} y={y0 + 0.06} z={0} dx={0.24} dy={d - 0.12} dz={deskZ} />
      <IsoBox x={x0} y={y0} z={deskZ} dx={w} dy={d} dz={0.09} />
      <IsoBox x={x - 0.07} y={y0 + 0.15} z={deskZ + 0.09} dx={0.14} dy={0.12} dz={0.1} />
      <IsoBox
        x={x - 0.28}
        y={y0 + 0.14}
        z={deskZ + 0.16}
        dx={0.58}
        dy={0.14}
        dz={0.44}
        tone={stalled ? 'bad' : working ? 'accent' : state === 'warn' ? 'warn' : 'base'}
      />
      <polygon
        className={stalled ? 'aw-world__face-bad' : working ? 'aw-world__window aw-world__window--lit' : 'aw-world__window'}
        points={screenPts}
      />
      <IsoBox x={x - 0.14} y={y0 + 0.44} z={deskZ + 0.09} dx={0.42} dy={0.2} dz={0.04} />
      <IsoBox
        x={x0 + 0.1}
        y={y0 + 0.44}
        z={deskZ + 0.09}
        dx={0.28}
        dy={0.26}
        dz={0.03}
        tone={working ? 'accent' : 'base'}
      />
      <line className="aw-world__detail-line" x1={c1a.x} y1={c1a.y} x2={c1b.x} y2={c1b.y} />
      <CountBadge x={x + 0.38} y={y - 0.22} z={deskZ + 0.68} count={meta?.count ?? 0} tone={stalled ? 'bad' : 'accent'} />
    </g>
  );
}

function RequestObject({ station }) {
  const { x, y, state, meta } = station;
  const x0 = x - 0.46;
  const y0 = y - 0.4;
  const w = 0.92;
  const d = 0.8;
  const openCount = meta?.count ?? 0;
  const sheets = openCount > 0 ? Math.min(3, openCount) : 0;

  return (
    <g className="aw-world__object">
      <IsoBox x={x0 + 0.08} y={y0 + 0.08} z={0} dx={w - 0.16} dy={d - 0.16} dz={0.16} />
      <IsoBox x={x0} y={y0} z={0.16} dx={w} dy={d} dz={0.1} />
      <IsoBox x={x0} y={y0} z={0.26} dx={w} dy={0.08} dz={0.22} />
      <IsoBox x={x0} y={y0 + 0.08} z={0.26} dx={0.08} dy={d - 0.08} dz={0.22} />
      {sheets === 0 ? (
        <IsoBox x={x0 + 0.16} y={y0 + 0.16} z={0.26} dx={w - 0.32} dy={d - 0.32} dz={0.04} />
      ) : (
        Array.from({ length: sheets }).map((_, i) => (
          <IsoBox
            key={i}
            x={x0 + 0.15 + i * 0.03}
            y={y0 + 0.15 + i * 0.02}
            z={0.26 + i * 0.1}
            dx={w - 0.34}
            dy={d - 0.32}
            dz={0.08}
            tone={i === sheets - 1 && state === 'warn' ? 'warn' : i === sheets - 1 && state === 'active' ? 'accent' : 'base'}
          />
        ))
      )}
      <IsoBox x={x0 + w - 0.08} y={y0 + 0.08} z={0.26} dx={0.08} dy={d - 0.08} dz={0.16} />
      <IsoBox x={x0 + 0.08} y={y0 + d - 0.08} z={0.26} dx={w - 0.16} dy={0.08} dz={0.14} />
      <CountBadge x={x + 0.34} y={y - 0.24} z={0.78} count={openCount} />
    </g>
  );
}

function StationGeometry({ station }) {
  switch (station.key) {
    case 'hosting':
      return <HostingObject station={station} />;
    case 'preview':
      return <PreviewObject station={station} />;
    case 'code':
      return <CodeObject station={station} />;
    case 'agent':
      return <AgentObject station={station} />;
    case 'request':
      return <RequestObject station={station} />;
    default:
      return null;
  }
}

/** Real operator actions per station. Every station offers at least one real next step. */
function actionsForStation(station, onAction) {
  const items = [];
  if (station.key === 'request') {
    if (onAction) {
      items.push({ id: 'open-work', label: 'Open work', primary: true, run: () => onAction('work', station) });
      items.push({ id: 'add-work', label: 'Add work', run: () => onAction('add_work', station) });
    }
  } else if (station.key === 'agent') {
    if (onAction) {
      items.push({ id: 'open-activity', label: 'Inspect activity', primary: true, run: () => onAction('activity', station) });
    }
  } else if (station.key === 'code') {
    if (station.meta?.repoUrl) {
      items.push({ id: 'open-repo', label: 'Open repository', href: station.meta.repoUrl, primary: true });
    }
    if (onAction) {
      items.push({
        id: 'manage-repo',
        label: station.meta?.repoSlug ? 'Manage repository' : 'Link repository',
        primary: !station.meta?.repoUrl,
        run: () => onAction(station.meta?.repoSlug ? 'repo' : 'link_repo', station),
      });
    }
  } else if (station.key === 'preview') {
    if (station.meta?.previewUrl) {
      items.push({ id: 'open-preview', label: 'Open preview', href: station.meta.previewUrl, primary: true });
    }
    if (onAction) {
      items.push({
        id: 'manage-preview',
        label: station.meta?.ahead ? 'Publish & hosting' : 'Manage hosting',
        primary: !station.meta?.previewUrl,
        run: () => onAction('hosting', station),
      });
    }
  } else if (station.key === 'hosting') {
    if (station.meta?.liveUrl && station.state !== 'off') {
      items.push({ id: 'open-live', label: 'Open live site', href: station.meta.liveUrl, primary: true });
    }
    if (onAction) {
      items.push({
        id: 'manage-hosting',
        label: station.state === 'off' ? 'Set up hosting' : 'Hosting & rollback',
        primary: !(station.meta?.liveUrl && station.state !== 'off'),
        run: () => onAction('hosting', station),
      });
    }
  }
  return items;
}

function StationActions({ station, onAction, compact = false }) {
  const actions = actionsForStation(station, onAction);
  if (!actions.length) return null;
  return (
    <div className={compact ? 'aw-world__actions aw-world__actions--compact' : 'aw-world__actions'}>
      {actions.map((act) =>
        act.href ? (
          <a
            key={act.id}
            className={act.primary ? 'aw-btn aw-btn--sm aw-world__action-link' : 'aw-btn aw-btn--sm aw-btn--ghost aw-world__action-link'}
            href={act.href}
            target="_blank"
            rel="noreferrer"
          >
            {act.label} ↗
          </a>
        ) : (
          <Button key={act.id} size="sm" kind={act.primary ? 'default' : 'ghost'} onClick={act.run}>
            {act.label}
          </Button>
        ),
      )}
    </div>
  );
}

/** Setup check details mapped onto a station. */
function ChecksList({ checks, t }) {
  if (!Array.isArray(checks) || checks.length === 0) return null;
  return (
    <div className="aw-world__checks">
      <span className="aw-world__status-label">{tx(t, 'world.check.section', 'Setup checks')}</span>
      <ul className="aw-world__check-list">
        {checks.map((c) => {
          const mark = c.state === 'ready' ? '✓' : c.state === 'pending' ? '…' : '○';
          return (
            <li key={c.key} className={`aw-world__check-item is-${c.state}`}>
              <span className="aw-world__check-mark" aria-hidden="true">
                {mark}
              </span>
              <div className="aw-world__check-body">
                <strong className="aw-world__check-label">{c.label}</strong>
                {c.detail ? <p className="aw-world__check-detail">{c.detail}</p> : null}
                {c.whoText || c.checkedText ? (
                  <div className="aw-world__check-meta">
                    {c.whoText ? <span className="aw-world__check-who">{c.whoText}</span> : null}
                    {c.checkedText ? <span className="aw-world__check-time">{c.checkedText}</span> : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Operator-only ticket attention counts shown on agent and request station cards. */
function OperatorExtras({ station, inline = false }) {
  if (station.key !== 'agent' && station.key !== 'request') return null;
  const needsYou = station.meta?.needsYou;
  const stalled = station.meta?.stalled;
  if (needsYou == null && stalled == null) return null;

  return (
    <div className={inline ? 'aw-world__ops aw-world__ops--inline' : 'aw-world__ops'}>
      {!inline ? <span className="aw-world__status-label">Operator</span> : null}
      <div className="aw-world__op-chips">
        {needsYou != null ? (
          <span className={needsYou > 0 ? 'aw-world__op-chip aw-world__op-chip--warn' : 'aw-world__op-chip'}>
            Needs you: <strong>{needsYou}</strong>
          </span>
        ) : null}
        {stalled != null ? (
          <span className={stalled > 0 ? 'aw-world__op-chip aw-world__op-chip--bad' : 'aw-world__op-chip'}>
            Stalled (&gt;45m): <strong>{stalled}</strong>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Hosting-specific HTTPS and last-publish detail rows (absorbed from https + domain + deploy). */
function HostingDetails({ station }) {
  if (station.key !== 'hosting') return null;
  const { httpsText, httpsVerified, deployTime } = station.meta ?? {};
  if (!httpsText && !deployTime) return null;
  return (
    <dl className="aw-world__meta">
      {httpsText ? (
        <>
          <dt>HTTPS</dt>
          <dd className={httpsVerified ? 'aw-world__meta-ok' : undefined}>{httpsText}</dd>
        </>
      ) : null}
      {deployTime ? (
        <>
          <dt>Last published</dt>
          <dd>{deployTime}</dd>
        </>
      ) : null}
    </dl>
  );
}

function operatorSummaryText(station) {
  if (station.key !== 'agent' && station.key !== 'request') return '';
  const parts = [];
  if (station.meta?.needsYou != null) parts.push(`Needs you: ${station.meta.needsYou}`);
  if (station.meta?.stalled != null) parts.push(`Stalled: ${station.meta.stalled}`);
  return parts.length ? ` Operator: ${parts.join(', ')}.` : '';
}

/** Changes on the preview that production does not have yet; the list opens on demand. */
function DriftLine({ drift, onPick, t }) {
  const [open, setOpen] = useState(false);
  if (!drift) return null;
  return (
    <div className="aw-world__drift" role="status">
      <button type="button" className="aw-world__drift-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="aw-world__drift-dot" aria-hidden="true" />
        {drift.text} {open ? '▴' : '▾'}
      </button>
      {open ? (
        <ul className="aw-world__drift-list">
          {drift.items.map((item) => (
            <li key={item.key}>
              {item.ticketId !== null ? (
                <button type="button" className="aw-world__drift-item" onClick={() => onPick?.(item.ticketId)}>
                  {item.title}
                </button>
              ) : (
                <span className="aw-world__drift-item">{item.title}</span>
              )}
              {item.age ? (
                <span className="aw-world__drift-age">{tx(t, 'world.drift.onPreview', 'On preview {age}', { age: item.age })}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Compact 5-station pipeline summary shown when ProjectMap is collapsed.
 * Clicking any station expands the map focused on that station.
 */
export function PipelineStrip({
  project,
  sites = [],
  tickets = null,
  deploys = null,
  t = (k) => k,
  now,
  onSelectStation,
}) {
  const stations = useMemo(
    () => stationsFor({ project, sites, tickets, deploys, t, now }),
    [project, sites, tickets, deploys, t, now],
  );
  const ordered = useMemo(
    () => STATION_ORDER.map((k) => stations.find((s) => s.key === k)).filter(Boolean),
    [stations],
  );
  return (
    <div className="aw-world-strip-wrap ui">
      <UiStyles />
      <ol className="aw-world-strip" aria-label={tx(t, 'world.stripLabel', 'Project pipeline')}>
        {ordered.map((s) => (
          <li key={s.key} className="aw-world-strip__item" data-station={s.key} data-state={s.state}>
            <button
              type="button"
              className="aw-world-strip__btn"
              onClick={() => onSelectStation?.(s.key)}
              title={`${s.title}: ${s.stateText}`}
            >
              <StationStateIndicator state={s.state} t={t} dotOnly />
              <span className="aw-world-strip__name">{s.shortLabel}</span>
              <span className="aw-world-strip__status">{s.shortStatus || s.stateText}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Interactive functional-isometric ProjectMap for Project → Overview.
 */
export function ProjectMap({
  project,
  sites = [],
  tickets = null,
  deploys = null,
  t = (k) => k,
  now,
  initialStation = 'hosting',
  onSelect,
  onAction,
}) {
  const stations = useMemo(
    () => stationsFor({ project, sites, tickets, deploys, t, now }),
    [project, sites, tickets, deploys, t, now],
  );

  // Sort back-to-front by isometric depth (x + y) for correct painter's order.
  const paintedStations = useMemo(
    () => [...stations].sort((a, b) => a.x + a.y - (b.x + b.y)),
    [stations],
  );

  // Pipeline order for arrow keys and narrow vertical route list.
  const orderedStations = useMemo(
    () => STATION_ORDER.map((k) => stations.find((s) => s.key === k)).filter(Boolean),
    [stations],
  );

  const cables = useMemo(() => cablesFor(stations), [stations]);
  const drift = useMemo(
    () => unshippedPreview({ project, sites, deploys, tickets: tickets ?? [], t, now }),
    [project, sites, deploys, tickets, t, now],
  );

  const resolvedInitial = STATION_ORDER.includes(initialStation) ? initialStation : 'hosting';
  const [selectedKey, setSelectedKey] = useState(resolvedInitial);
  const [contextMenu, setContextMenu] = useState(null);
  const [measuredWidths, setMeasuredWidths] = useState({});
  const stationRefs = useRef({});
  const textRefs = useRef({});

  useEffect(() => {
    if (STATION_ORDER.includes(initialStation)) setSelectedKey(initialStation);
  }, [initialStation]);

  // Measure rendered SVG text lengths so station plates fit without clipping or truncation.
  useEffect(() => {
    const next = {};
    let changed = false;
    for (const s of stations) {
      const refs = textRefs.current[s.key];
      if (!refs?.name || !refs?.status) continue;
      if (typeof refs.name.getComputedTextLength !== 'function') continue;
      const nw = refs.name.getComputedTextLength();
      const sw = refs.status.getComputedTextLength();
      if (nw > 0 || sw > 0) {
        const w = plateWidth(nw, sw);
        next[s.key] = w;
        if (Math.abs((measuredWidths[s.key] ?? 0) - w) > 0.5) changed = true;
      }
    }
    if (changed) setMeasuredWidths((prev) => ({ ...prev, ...next }));
  }, [stations]);

  const layout = useMemo(() => plateLayout(stations, measuredWidths), [stations, measuredWidths]);

  // Request journey trace: undefined = follow default open request; null = all stations.
  const [journeyId, setJourneyId] = useState(undefined);
  const defaultTicket = useMemo(() => defaultJourneyTicket(project, tickets ?? []), [project, tickets]);
  const pillTickets = useMemo(
    () => journeyPillTickets(project, tickets ?? [], { limit: 5, ensure: defaultTicket }),
    [project, tickets, defaultTicket],
  );
  const followed =
    journeyId === null
      ? null
      : journeyId === undefined
        ? defaultTicket
        : (tickets ?? []).find((tk) => String(tk?.id) === String(journeyId)) ?? null;
  const journey = useMemo(() => (followed ? journeyFor(followed, { sites, t, now }) : null), [followed, sites, t, now]);
  const activeStation = stations.find((s) => s.key === selectedKey) ?? stations[0];

  const selectStation = (key, emit = true) => {
    setSelectedKey(key);
    if (emit) onSelect?.(key);
  };

  const triggerPrimaryAction = (station) => {
    const actions = actionsForStation(station, onAction);
    const first = actions[0];
    if (!first) {
      onSelect?.(station.key);
      return;
    }
    if (first.href && typeof window !== 'undefined') {
      window.open(first.href, '_blank', 'noopener,noreferrer');
    } else if (first.run) {
      first.run();
    }
  };

  const openContextMenuAt = (x, y, station) => {
    const actions = actionsForStation(station, onAction);
    if (!actions.length) return;
    selectStation(station.key, false);
    const items = [
      { heading: station.title },
      ...actions.map((act) => ({
        label: act.href ? `${act.label} ↗` : act.label,
        run: () => {
          if (act.href && typeof window !== 'undefined') {
            window.open(act.href, '_blank', 'noopener,noreferrer');
          } else {
            act.run?.();
          }
        },
      })),
    ];
    setContextMenu({ station, items, x, y });
  };

  const openContextMenu = (e, station) => {
    const actions = actionsForStation(station, onAction);
    if (!actions.length) return;
    e.preventDefault();
    e.stopPropagation();
    openContextMenuAt(e.clientX, e.clientY, station);
  };

  const onStationKeyDown = (e, station) => {
    const idx = orderedStations.findIndex((s) => s.key === station.key);
    if (idx === -1) return;
    let nextIdx = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIdx = (idx + 1) % orderedStations.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIdx = (idx - 1 + orderedStations.length) % orderedStations.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = orderedStations.length - 1;

    if (nextIdx !== null) {
      e.preventDefault();
      const target = orderedStations[nextIdx];
      selectStation(target.key, false);
      stationRefs.current[target.key]?.focus();
      return;
    }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      openContextMenuAt(rect.left + rect.width / 2, rect.top + rect.height / 2, station);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectStation(station.key, true);
      triggerPrimaryAction(station);
    }
  };

  const floorPlate = useMemo(
    () =>
      isoPoints([
        [FLOOR_BOUNDS.minX, FLOOR_BOUNDS.minY, 0],
        [FLOOR_BOUNDS.maxX, FLOOR_BOUNDS.minY, 0],
        [FLOOR_BOUNDS.maxX, FLOOR_BOUNDS.maxY, 0],
        [FLOOR_BOUNDS.minX, FLOOR_BOUNDS.maxY, 0],
      ]),
    [],
  );

  const visitorPt = iso(VISITOR_POS.x, VISITOR_POS.y, 0);
  const visitorNext = iso(STATION_POSITIONS.hosting.x, STATION_POSITIONS.hosting.y, 0);
  const vb = layout.viewBox;

  return (
    <div className="aw-world-wrap ui">
      <UiStyles />
      {pillTickets.length || drift ? (
        <div className="aw-world__bar">
          {pillTickets.length ? (
            <div className="aw-world__journeys" role="group" aria-label={tx(t, 'world.journey.pills', 'Follow a request')}>
              {pillTickets.map((tk) => (
                <button
                  key={String(tk.id)}
                  type="button"
                  className={`aw-world__journey-pill is-${tk.status}`}
                  aria-pressed={followed ? String(followed.id) === String(tk.id) : false}
                  onClick={() => setJourneyId(tk.id)}
                  title={`#${tk.id} ${tk.title ?? ''}`}
                >
                  <span className="aw-world__journey-dot" aria-hidden="true" />
                  <span className="aw-world__journey-label">{tk.title ?? `#${tk.id}`}</span>
                </button>
              ))}
              <button
                type="button"
                className="aw-world__journey-pill is-all"
                aria-pressed={!followed}
                onClick={() => setJourneyId(null)}
              >
                {tx(t, 'world.journey.all', 'All stations')}
              </button>
            </div>
          ) : null}
          <DriftLine drift={drift} onPick={(id) => setJourneyId(id)} t={t} />
        </div>
      ) : null}

      {/* Wide view: functional isometric map + shared Inspector */}
      <figure className="aw-world">
        <div className="aw-world__stage">
          <svg
            className="aw-world__svg"
            viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
            preserveAspectRatio="xMidYMid meet"
            role="group"
            aria-label={tx(t, 'world.mapLabel', 'Project map: requests, builder, code, preview and live site')}
          >
            {/* Clean isometric floor plate */}
            <polygon className="aw-world__floor-plate" points={floorPlate} />

            {/* Relationship lines — static, no idle motion */}
            <g aria-hidden="true">
              {cables.map((c) => {
                const p1 = iso(c.points[0][0], c.points[0][1], 0);
                const p2 = iso(c.points[1][0], c.points[1][1], 0);
                const dPath = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
                const lit = journey && c.flow === 'build' ? journey.activeCableIds.includes(c.id) : c.active;
                return (
                  <g key={c.id}>
                    <path
                      className={
                        lit
                          ? 'aw-world__cable-base is-lit'
                          : c.connected
                            ? 'aw-world__cable-base is-connected'
                            : 'aw-world__cable-base'
                      }
                      d={dPath}
                    />
                    <CableArrow p1={p1} p2={p2} u={0.5} active={lit} />
                  </g>
                );
              })}
            </g>

            {/* Quiet visitor entry cue into Live site */}
            <g aria-hidden="true">
              <circle className="aw-world__face-top" cx={visitorPt.x} cy={visitorPt.y} r={6.5} />
              <CableArrow p1={visitorPt} p2={visitorNext} u={0.2} active={false} />
              <text className="aw-world__micro" x={visitorPt.x - 28} y={visitorPt.y + 18}>
                {tx(t, 'world.visitor', 'Visitor')}
              </text>
            </g>

            {/* Interactive isometric stations (painted back-to-front) */}
            {paintedStations.map((station) => {
              const pos = STATION_POSITIONS[station.key];
              const r = pos?.padHalf ?? 0.7;
              const padPts = isoPoints([
                [station.x - r, station.y - r, 0],
                [station.x + r, station.y - r, 0],
                [station.x + r, station.y + r, 0],
                [station.x - r, station.y + r, 0],
              ]);
              const hitR = r + 0.16;
              const hitPts = isoPoints([
                [station.x - hitR, station.y - hitR, 0],
                [station.x + hitR, station.y - hitR, 0],
                [station.x + hitR, station.y + hitR, 0],
                [station.x - hitR, station.y + hitR, 0],
              ]);

              const plate = layout.plates[station.key];
              const stationActions = actionsForStation(station, onAction);
              const isSelected = activeStation.key === station.key;
              const cls = [
                'aw-world__station',
                `aw-world__station--${station.key}`,
                `is-${station.state}`,
                isSelected ? 'is-selected' : '',
                journey?.stations?.[station.key] ? `is-journey-${journey.stations[station.key]}` : '',
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <g
                  key={station.key}
                  ref={(el) => {
                    stationRefs.current[station.key] = el;
                  }}
                  className={cls}
                  data-station={station.key}
                  data-state={station.state}
                  data-station-actions={stationActions.length}
                  role="button"
                  tabIndex={isSelected ? 0 : -1}
                  aria-label={`${station.title}: ${station.stateText}`}
                  aria-pressed={isSelected}
                  onClick={() => selectStation(station.key, true)}
                  onContextMenu={(e) => openContextMenu(e, station)}
                  onKeyDown={(e) => onStationKeyDown(e, station)}
                >
                  <polygon className="aw-world__hit" points={hitPts} />
                  <polygon className="aw-world__pad" points={padPts} />
                  {plate ? (
                    <line
                      className="aw-world__leader"
                      aria-hidden="true"
                      x1={plate.leader.x1}
                      y1={plate.leader.y1}
                      x2={plate.leader.x2}
                      y2={plate.leader.y2}
                    />
                  ) : null}
                  <g className="aw-world__lift">
                    <StationGeometry station={station} />
                  </g>
                  {/* Readable-at-rest two-line label plate (name + full 1-line status) */}
                  {plate ? (
                    <g className="aw-world__label" aria-hidden="true">
                      <rect className="aw-world__tag-bg" x={plate.x} y={plate.y} width={plate.w} height={plate.h} rx={6} />
                      <circle
                        className={`aw-world__beacon aw-world__beacon--${station.state}`}
                        cx={plate.x + 13}
                        cy={plate.y + 15}
                        r={3.5}
                      />
                      <text
                        ref={(el) => {
                          textRefs.current[station.key] = { ...(textRefs.current[station.key] ?? {}), name: el };
                        }}
                        className="aw-world__tag-name"
                        x={plate.x + 23}
                        y={plate.y + 15.5}
                      >
                        {station.shortLabel}
                      </text>
                      <text
                        ref={(el) => {
                          textRefs.current[station.key] = { ...(textRefs.current[station.key] ?? {}), status: el };
                        }}
                        className="aw-world__tag-status"
                        x={plate.x + 10}
                        y={plate.y + 31.5}
                      >
                        {station.shortStatus || station.stateText}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Shared v2 Inspector beside the map */}
        <Inspector
          className="aw-world__caption"
          title={<span className="aw-world__title">{activeStation.title}</span>}
          actions={<StationStateIndicator state={activeStation.state} t={t} />}
          label={`${activeStation.title} inspector`}
          storageKey="ui.projectmap.inspector"
          defaultWidth={320}
          minWidth={280}
          maxWidth={440}
        >
          <div className="aw-world__inspector" aria-live="polite">
            {journey ? (
              <div className="aw-world__journey">
                <span className="aw-world__status-label">
                  #{followed.id} {followed.title ?? ''}
                </span>
                <p className="aw-world__journey-sentence">{journey.sentence}</p>
                <div className="aw-world__journey-links">
                  {journey.status === 'review' && journey.previewUrl ? (
                    <a className="aw-world__journey-chip" href={journey.previewUrl} target="_blank" rel="noreferrer">
                      {tx(t, 'world.journey.openPreview', 'Open preview')} ↗
                    </a>
                  ) : null}
                  {journey.status === 'done' && journey.siteUrl ? (
                    <a className="aw-world__journey-chip" href={journey.siteUrl} target="_blank" rel="noreferrer">
                      {tx(t, 'world.journey.openSite', 'Open site')} ↗
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}

            <p className="aw-world__explain">{activeStation.explain}</p>
            <div className="aw-world__status-box">
              <span className="aw-world__status-label">{tx(t, 'world.currentStatus', 'Current status')}</span>
              <p className="aw-world__status-value">{activeStation.stateText}</p>
            </div>
            <HostingDetails station={activeStation} />
            <OperatorExtras station={activeStation} />
            <ChecksList checks={activeStation.checks} t={t} />
            <StationActions station={activeStation} onAction={onAction} />
            <p className="aw-world__kbd-hint">Click or use arrow keys to inspect · Enter opens</p>
          </div>
        </Inspector>

        {/* Full text summary of every station and its state for screen readers */}
        <ul className="aw-world__sr-only" aria-label={tx(t, 'world.summaryLabel', 'Project health station status')}>
          {orderedStations.map((s) => (
            <li key={s.key}>
              {s.title}: {s.stateText}. {s.explain}
              {s.key === 'hosting' && s.meta?.httpsText ? ` HTTPS: ${s.meta.httpsText}.` : ''}
              {operatorSummaryText(s)}
              {s.checks?.length
                ? ` ${s.checks
                    .map((c) => [c.label, c.detail, c.whoText, c.checkedText].filter(Boolean).join(' — '))
                    .join('; ')}`
                : ''}
            </li>
          ))}
        </ul>
      </figure>

      {/* Narrow fallback (≤900px viewport or narrow container): vertical route list */}
      <ol className="aw-world__route" aria-label={tx(t, 'world.routeLabel', 'Project route')}>
        {orderedStations.map((s) => {
          const isCurrent = journey?.currentKey === s.key;
          const readyChecks = (s.checks ?? []).filter((c) => c.state === 'ready').length;
          const stationActions = actionsForStation(s, onAction);
          return (
            <li
              key={s.key}
              className={`aw-world__route-item is-${s.state}${isCurrent ? ' is-journey-current' : ''}`}
              data-station={s.key}
              data-state={s.state}
              data-station-actions={stationActions.length}
            >
              <div className="aw-world__route-head">
                <span className={`aw-world__route-dot aw-world__route-dot--${s.state}`} aria-hidden="true" />
                <strong className="aw-world__route-name">{s.title}</strong>
                <StationStateIndicator state={s.state} t={t} />
              </div>
              <p className="aw-world__route-status">{s.stateText}</p>
              {s.key === 'hosting' && s.meta?.httpsText ? (
                <p className="aw-world__route-sub">HTTPS: {s.meta.httpsText}</p>
              ) : null}
              <OperatorExtras station={s} inline />
              {s.checks?.length ? (
                <details className="aw-world__route-checks">
                  <summary>
                    {tx(t, 'world.check.section', 'Setup checks')} ({readyChecks}/{s.checks.length} ok)
                  </summary>
                  <ChecksList checks={s.checks} t={t} />
                </details>
              ) : null}
              <StationActions station={s} onAction={onAction} compact />
            </li>
          );
        })}
      </ol>

      {/* Shared station context menu (right-click or Shift+F10 / ContextMenu key) */}
      {contextMenu ? (
        <Menu
          items={contextMenu.items}
          at={{ x: contextMenu.x, y: contextMenu.y }}
          label={`${contextMenu.station.title} actions`}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </div>
  );
}

export const ProjectWorld = ProjectMap;
export default ProjectMap;
