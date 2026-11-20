/*
 * Interactive isometric "project world" map for the Admin project overview.
 * Shows each project the way the client sees it, plus operator ticket signals
 * (needs-you / stalled counts) on the agent and request stations.
 *
 * Origin: ported from ptechsolutions-site
 *   - src/components/portal/ProjectWorld.jsx
 *   - src/components/portal/project-world-model.js
 *   - src/components/portal/project-world.css
 *
 * Admin differences:
 *   - No browser HTTPS reachability probe (must not ping client sites).
 *   - Styles use `.aw-world` prefix and admin theme tokens in `styles.js`.
 *   - Compact ~260px map height with caption card to the right (stacks <720px).
 *   - Operator extras (needs-you / stalled) in agent/request caption cards.
 */
import { useMemo, useState } from 'react';
import {
  FLOOR_BOUNDS,
  STATION_POSITIONS,
  VISITOR_POS,
  cablesFor,
  defaultJourneyTicket,
  floorDots,
  iso,
  isoBox,
  isoPoints,
  journeyFor,
  journeyPillTickets,
  stationsFor,
  tx,
  unshippedPreview,
} from './project-world-model.mjs';

const VIEW_WIDTH = 760;
const VIEW_HEIGHT = 440;

const STATE_LABEL = {
  ok: ['world.state.ok', 'Live'],
  active: ['world.state.active', 'Working'],
  warn: ['world.state.warn', 'Pending'],
  bad: ['world.state.bad', 'Needs attention'],
  off: ['world.state.off', 'Idle'],
  unknown: ['world.state.unknown', 'Unknown'],
};

const LABEL_OFFSETS = {
  hosting: { dx: 0, dy: -108 },
  https: { dx: -56, dy: -34 },
  domain: { dx: -62, dy: -28 },
  preview: { dx: 24, dy: -74 },
  deploy: { dx: 30, dy: -70 },
  code: { dx: 62, dy: -22 },
  request: { dx: -46, dy: 40 },
  agent: { dx: 10, dy: 46 },
};

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

/** Small arrow triangle along a cable from p1 -> p2, placed at fraction `u`. */
function CableArrow({ p1, p2, u = 0.52, active }) {
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

/** Floating circular count badge for active tickets / open requests. */
function CountBadge({ x, y, z, count }) {
  if (!count) return null;
  const p = iso(x, y, z);
  const text = count > 99 ? '99+' : String(count);
  const rx = text.length > 2 ? 14 : 10.5;
  return (
    <g aria-hidden="true">
      <rect
        className="aw-world__badge-bg"
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

/* ————— Individual isometric station illustrations ————— */

function HostingObject({ station }) {
  const { x, y, state, meta } = station;
  const x0 = x - 0.62;
  const y0 = y - 0.58;
  const w = 1.24;
  const d = 1.16;
  const h = 1.22;
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
    [x + 0.19, y0 + d, 0.54],
    [x - 0.19, y0 + d, 0.54],
  ]);

  const winL = isoPoints([
    [x0 + 0.18, y0 + d, 0.72],
    [x0 + 0.52, y0 + d, 0.72],
    [x0 + 0.52, y0 + d, 1.02],
    [x0 + 0.18, y0 + d, 1.02],
  ]);
  const winR = isoPoints([
    [x0 + 0.72, y0 + d, 0.72],
    [x0 + 1.06, y0 + d, 0.72],
    [x0 + 1.06, y0 + d, 1.02],
    [x0 + 0.72, y0 + d, 1.02],
  ]);

  const vents = [0.3, 0.56, 0.82, 1.04].map((vz) => {
    const a = iso(x0 + w, y0 + 0.2, vz);
    const b = iso(x0 + w, y0 + d - 0.2, vz);
    return { vz, a, b };
  });

  const mastBase = iso(x + 0.25, y - 0.15, h + 0.24);
  const mastTop = iso(x + 0.25, y - 0.15, h + 0.62);
  const hostPlatePt = iso(x, y, h + 0.1);

  return (
    <g className="aw-world__object">
      <IsoBox x={x0 - 0.08} y={y0 - 0.08} z={0} dx={w + 0.16} dy={d + 0.16} dz={0.1} />
      <IsoBox x={x0} y={y0} z={0.1} dx={w} dy={d} dz={h - 0.1} />
      <IsoBox x={x0 - 0.04} y={y0 - 0.04} z={h} dx={w + 0.08} dy={d + 0.08} dz={0.1} tone={roofTone} />
      <IsoBox x={x0 + 0.16} y={y0 + 0.18} z={h + 0.1} dx={0.46} dy={0.42} dz={0.22} />
      <line className="aw-world__ink-line" x1={mastBase.x} y1={mastBase.y} x2={mastTop.x} y2={mastTop.y} />
      <circle className={`aw-world__beacon aw-world__beacon--${state}`} cx={mastTop.x} cy={mastTop.y} r={4.5} />
      <polygon
        className={state === 'ok' ? 'aw-world__face-ok' : state === 'bad' ? 'aw-world__face-bad' : 'aw-world__window'}
        points={doorPts}
      />
      <polygon className={winCls} points={winL} />
      <polygon className={winCls} points={winR} />
      {vents.map((v) => (
        <line key={v.vz} className="aw-world__detail-line" x1={v.a.x} y1={v.a.y} x2={v.b.x} y2={v.b.y} />
      ))}
      {meta?.hostKind ? (
        <text className="aw-world__micro" x={hostPlatePt.x} y={hostPlatePt.y + 2}>
          {meta.hostKind === 'cloudflare' ? 'CF' : 'PT'}
        </text>
      ) : null}
    </g>
  );
}

function HttpsObject({ station }) {
  const { x, y, state } = station;
  const verified = state === 'ok';
  const tone = verified ? 'ok' : state === 'warn' ? 'warn' : 'base';

  const archH = 0.88;
  const lockCenter = iso(x, y, archH + 0.34);

  const shackleL = iso(x - 0.11, y, archH + 0.32);
  const shackleR = iso(x + 0.11, y, archH + 0.32);
  const shackleTop = iso(x, y, archH + 0.58);
  const shacklePath = verified
    ? `M ${shackleL.x} ${shackleL.y} C ${shackleL.x} ${shackleTop.y - 4}, ${shackleR.x} ${shackleTop.y - 4}, ${shackleR.x} ${shackleR.y}`
    : `M ${shackleL.x} ${shackleL.y} C ${shackleL.x} ${shackleTop.y - 4}, ${shackleR.x} ${shackleTop.y - 4}, ${shackleR.x + 2} ${shackleR.y - 7}`;

  return (
    <g className="aw-world__object">
      <IsoBox x={x - 0.44} y={y - 0.1} z={0} dx={0.18} dy={0.2} dz={archH} />
      <IsoBox x={x + 0.26} y={y - 0.1} z={0} dx={0.18} dy={0.2} dz={archH} />
      <IsoBox x={x - 0.48} y={y - 0.12} z={archH} dx={0.96} dy={0.24} dz={0.14} tone={tone} />
      <path className="aw-world__ink-line" d={shacklePath} />
      <IsoBox x={x - 0.19} y={y - 0.12} z={archH + 0.08} dx={0.38} dy={0.24} dz={0.28} tone={tone} />
      {verified ? (
        <circle className="aw-world__beacon aw-world__beacon--ok" cx={lockCenter.x} cy={lockCenter.y + 8} r={2.3} />
      ) : state === 'warn' ? (
        <circle className="aw-world__beacon aw-world__beacon--warn" cx={lockCenter.x} cy={lockCenter.y + 8} r={2.6} />
      ) : (
        <text className="aw-world__micro" x={lockCenter.x} y={lockCenter.y + 11}>
          ?
        </text>
      )}
    </g>
  );
}

function DomainObject({ station }) {
  const { x, y, state, meta } = station;
  const boardTone = state === 'active' ? 'accent' : state === 'bad' ? 'bad' : state === 'warn' ? 'warn' : 'base';

  const l1a = iso(x - 0.34, y + 0.08, 0.96);
  const l1b = iso(x + 0.32, y + 0.08, 0.96);
  const l2a = iso(x - 0.34, y + 0.08, 0.82);
  const l2b = iso(x + 0.14, y + 0.08, 0.82);
  const cap = iso(x, y, 1.24);
  const shortHost = meta?.hostname
    ? meta.hostname.length > 18
      ? `${meta.hostname.slice(0, 16)}…`
      : meta.hostname
    : null;
  const hostPt = iso(x + 0.62, y + 0.05, 0);

  return (
    <g className="aw-world__object">
      <IsoBox x={x - 0.24} y={y - 0.22} z={0} dx={0.48} dy={0.44} dz={0.12} />
      <IsoBox x={x - 0.07} y={y - 0.07} z={0.12} dx={0.14} dy={0.14} dz={1.06} />
      <IsoBox x={x - 0.44} y={y - 0.08} z={0.68} dx={0.88} dy={0.16} dz={0.42} tone={boardTone} />
      <line className="aw-world__ink-line" x1={l1a.x} y1={l1a.y} x2={l1b.x} y2={l1b.y} />
      <line className="aw-world__detail-line" x1={l2a.x} y1={l2a.y} x2={l2b.x} y2={l2b.y} />
      <circle className={`aw-world__beacon aw-world__beacon--${state}`} cx={cap.x} cy={cap.y} r={4} />
      {shortHost ? (
        <text className="aw-world__micro" x={hostPt.x + 4} y={hostPt.y + 4}>
          {shortHost}
        </text>
      ) : null}
    </g>
  );
}

/** Glass-cloche mini shop representing the private Preview environment. */
function PreviewObject({ station }) {
  const { x, y, state } = station;
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
  const rx = 28;
  const ry = 14.5;
  const domeH = 44;
  const backRim = `M ${c.x - rx} ${c.y} A ${rx} ${ry} 0 0 1 ${c.x + rx} ${c.y}`;
  const domeShell = [
    `M ${c.x - rx} ${c.y}`,
    `C ${c.x - rx} ${c.y - domeH}, ${c.x + rx} ${c.y - domeH}, ${c.x + rx} ${c.y}`,
    `A ${rx} ${ry} 0 0 1 ${c.x - rx} ${c.y}`,
    'Z',
  ].join(' ');
  const shineArc = `M ${c.x - rx + 6} ${c.y - 9} C ${c.x - rx + 7} ${c.y - 24}, ${c.x - 10} ${c.y - 31}, ${c.x - 4} ${c.y - 32}`;
  const apexY = c.y - 36.5;

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
    </g>
  );
}

function CodeObject({ station }) {
  const { x, y, state } = station;
  const x0 = x - 0.42;
  const y0 = y - 0.4;
  const w = 0.84;
  const d = 0.8;
  const h = 1.24;
  const topTone = state === 'bad' ? 'bad' : state === 'warn' ? 'warn' : state === 'active' ? 'accent' : 'base';

  const drawerTops = [0.42, 0.82];
  const handles = [0.22, 0.62, 1.02];
  const beaconPt = iso(x0 + w - 0.14, y0 + 0.14, h + 0.04);

  return (
    <g className="aw-world__object">
      <IsoBox x={x0} y={y0} z={0} dx={w} dy={d} dz={h} tone={topTone} />
      {drawerTops.map((dz) => {
        const a = iso(x0 + 0.05, y0 + d, dz);
        const b = iso(x0 + w - 0.05, y0 + d, dz);
        return <line key={dz} className="aw-world__ink-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
      })}
      <IsoBox x={x0 + 0.08} y={y0 + d} z={0.44} dx={w - 0.16} dy={0.22} dz={0.34} />
      <IsoBox
        x={x0 + 0.16}
        y={y0 + d + 0.04}
        z={0.78}
        dx={0.26}
        dy={0.08}
        dz={0.12}
        tone={state === 'ok' ? 'ok' : state === 'bad' ? 'bad' : state === 'warn' ? 'warn' : 'base'}
      />
      <IsoBox x={x0 + 0.45} y={y0 + d + 0.06} z={0.78} dx={0.24} dy={0.08} dz={0.09} />
      {handles.map((hz) => {
        const yFace = hz === 0.62 ? y0 + d + 0.22 : y0 + d;
        const a = iso(x - 0.13, yFace, hz);
        const b = iso(x + 0.13, yFace, hz);
        return <line key={hz} className="aw-world__ink-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
      })}
      <circle className={`aw-world__beacon aw-world__beacon--${state}`} cx={beaconPt.x} cy={beaconPt.y} r={4} />
    </g>
  );
}

function DeployObject({ station }) {
  const { x, y, state } = station;
  const bedX = x - 0.64;
  const bedY = y - 0.32;
  const bedW = 1.28;
  const bedD = 0.64;
  const bedH = 0.22;

  const crateTone =
    state === 'active' ? 'accent' : state === 'ok' ? 'ok' : state === 'warn' ? 'warn' : state === 'bad' ? 'bad' : 'base';

  const rollers = [-0.46, -0.22, 0.02, 0.26, 0.48].map((rx) => {
    const a = iso(x + rx, bedY + 0.08, bedH);
    const b = iso(x + rx, bedY + bedD - 0.08, bedH);
    return { rx, a, b };
  });

  const hookTop = iso(x - 0.04, y, 0.98);
  const hookBot = iso(x - 0.04, y, 0.62);
  const beaconPt = iso(x + 0.32, y - 0.32, 1.14);

  return (
    <g className="aw-world__object">
      <IsoBox x={bedX} y={bedY} z={0} dx={bedW} dy={bedD} dz={bedH} />
      {rollers.map((r) => (
        <line key={r.rx} className="aw-world__detail-line" x1={r.a.x} y1={r.a.y} x2={r.b.x} y2={r.b.y} />
      ))}
      <IsoBox x={x - 0.08} y={bedY - 0.08} z={0} dx={0.16} dy={0.14} dz={1.04} />
      <IsoBox x={x - 0.24} y={y - 0.18} z={bedH} dx={0.42} dy={0.36} dz={0.38} tone={crateTone} />
      <IsoBox x={x - 0.08} y={bedY + bedD - 0.06} z={0} dx={0.16} dy={0.14} dz={1.04} />
      <IsoBox
        x={x - 0.12}
        y={bedY - 0.12}
        z={0.98}
        dx={0.24}
        dy={bedD + 0.24}
        dz={0.14}
        tone={state === 'active' ? 'accent' : 'base'}
      />
      <line className="aw-world__ink-line" x1={hookTop.x} y1={hookTop.y} x2={hookBot.x} y2={hookBot.y} />
      <circle className={`aw-world__beacon aw-world__beacon--${state}`} cx={beaconPt.x} cy={beaconPt.y} r={3.8} />
    </g>
  );
}

function AgentObject({ station }) {
  const { x, y, state, meta } = station;
  const x0 = x - 0.56;
  const y0 = y - 0.42;
  const w = 1.12;
  const d = 0.84;
  const deskZ = 0.52;
  const working = state === 'active';

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
        tone={working ? 'accent' : 'base'}
      />
      <polygon className={working ? 'aw-world__window aw-world__window--lit' : 'aw-world__window'} points={screenPts} />
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
      <CountBadge x={x + 0.38} y={y - 0.22} z={deskZ + 0.68} count={meta?.count ?? 0} />
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
            tone={i === sheets - 1 && state === 'active' ? 'accent' : 'base'}
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
    case 'https':
      return <HttpsObject station={station} />;
    case 'domain':
      return <DomainObject station={station} />;
    case 'preview':
      return <PreviewObject station={station} />;
    case 'code':
      return <CodeObject station={station} />;
    case 'deploy':
      return <DeployObject station={station} />;
    case 'agent':
      return <AgentObject station={station} />;
    case 'request':
      return <RequestObject station={station} />;
    default:
      return null;
  }
}

/** Setup check details mapped onto a station (label, detail, Who, optional Checked time). */
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
function OperatorExtras({ station }) {
  if (station.key !== 'agent' && station.key !== 'request') return null;
  const needsYou = station.meta?.needsYou;
  const stalled = station.meta?.stalled;
  if (needsYou == null && stalled == null) return null;

  return (
    <div className="aw-world__ops">
      <span className="aw-world__status-label">Operator</span>
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
                <button type="button" className="aw-world__drift-item" onClick={() => onPick?.(item.ticketId)}>{item.title}</button>
              ) : (
                <span className="aw-world__drift-item">{item.title}</span>
              )}
              {item.age ? <span className="aw-world__drift-age">{tx(t, 'world.drift.onPreview', 'On preview {age}', { age: item.age })}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Interactive isometric "project world" map for the admin project overview.
 * No browser HTTPS probe is performed.
 */
export function ProjectWorld({
  project,
  sites = [],
  tickets = null,
  deploys = null,
  t = (k) => k,
  now,
  initialStation = 'hosting',
  onSelect,
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

  const cables = useMemo(() => cablesFor(stations), [stations]);
  const drift = useMemo(
    () => unshippedPreview({ project, sites, deploys, tickets: tickets ?? [], t, now }),
    [project, sites, deploys, tickets, t, now],
  );
  const dots = useMemo(() => floorDots(stations, 0.42), [stations]);

  const [selectedKey, setSelectedKey] = useState(initialStation);

  // A request's journey across the map: the same story the client sees.
  // undefined = follow the default (most recent open request); null = all stations.
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

  const activateStation = (key, emit) => {
    setSelectedKey(key);
    if (emit) onSelect?.(key);
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
  const visitorNext = iso(STATION_POSITIONS.domain.x, STATION_POSITIONS.domain.y, 0);
  const visitorsZonePt = iso(2.55, 5.25, 0);
  const workshopZonePt = iso(6.6, 5.2, 0);

  const [stateKey, stateDefault] = STATE_LABEL[activeStation.state] ?? STATE_LABEL.off;
  const stateBadgeText = tx(t, stateKey, stateDefault);

  return (
    <div className="aw-world-wrap">
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
              {tk.title ?? `#${tk.id}`}
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
      <figure className="aw-world">
        <div className="aw-world__stage">
          <svg
            className="aw-world__svg"
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={tx(t, 'world.mapLabel', 'Interactive map showing how your website works')}
          >
            {/* Dot-matrix isometric floor */}
            <polygon className="aw-world__floor-plate" points={floorPlate} />
            <g aria-hidden="true">
              {dots.map((d) => (
                <circle
                  key={d.id}
                  className={d.active ? 'aw-world__dot aw-world__dot--active' : 'aw-world__dot'}
                  cx={d.x}
                  cy={d.y}
                  r={d.active ? 2 : 1.25}
                />
              ))}
            </g>

            {/* Subtle floor zone captions */}
            <text className="aw-world__zone-label" x={visitorsZonePt.x} y={visitorsZonePt.y} textAnchor="middle">
              {tx(t, 'world.zone.visitors', 'Visitors')}
            </text>
            <text className="aw-world__zone-label" x={workshopZonePt.x} y={workshopZonePt.y} textAnchor="middle">
              {tx(t, 'world.zone.workshop', 'Workshop')}
            </text>

            {/* Isometric connecting cables / roads */}
            <g aria-hidden="true">
              {cables.map((c) => {
                const p1 = iso(c.points[0][0], c.points[0][1], 0);
                const p2 = iso(c.points[1][0], c.points[1][1], 0);
                const dPath = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
                return (
                  <g key={c.id}>
                    <path
                      className={c.connected ? 'aw-world__cable-base is-connected' : 'aw-world__cable-base'}
                      d={dPath}
                    />
                    {(journey && c.flow === 'build' ? journey.activeCableIds.includes(c.id) : c.active) ? (
                      <path className="aw-world__cable-flow" d={dPath} />
                    ) : null}
                    <CableArrow
                      p1={p1}
                      p2={p2}
                      u={0.5}
                      active={journey && c.flow === 'build' ? journey.activeCableIds.includes(c.id) : c.active}
                    />
                  </g>
                );
              })}
            </g>

            {/* Visitor entry floor cue */}
            <g aria-hidden="true">
              <circle className="aw-world__face-top" cx={visitorPt.x} cy={visitorPt.y} r={7.5} />
              <CableArrow p1={visitorPt} p2={visitorNext} u={0.14} active={false} />
              <text className="aw-world__micro" x={visitorPt.x - 24} y={visitorPt.y + 18}>
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

              const center = iso(station.x, station.y, 0);
              const off = LABEL_OFFSETS[station.key] ?? { dx: 0, dy: 42 };
              const lx = center.x + off.dx;
              const ly = center.y + off.dy;
              const labelW = Math.max(66, station.shortLabel.length * 6.5 + 22);

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
                  className={cls}
                  role="button"
                  tabIndex={0}
                  aria-label={`${station.title}: ${station.stateText}`}
                  aria-pressed={isSelected}
                  onMouseEnter={() => activateStation(station.key, false)}
                  onFocus={() => activateStation(station.key, false)}
                  onClick={() => activateStation(station.key, true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      activateStation(station.key, true);
                    }
                  }}
                >
                  <polygon className="aw-world__hit" points={hitPts} />
                  <polygon className="aw-world__pad" points={padPts} />
                  <StationGeometry station={station} />
                  {/* Compact station tag */}
                  <g aria-hidden="true">
                    <rect
                      className="aw-world__tag-bg"
                      x={lx - labelW / 2}
                      y={ly - 10}
                      width={labelW}
                      height={20}
                      rx={10}
                    />
                    <circle
                      className={`aw-world__beacon aw-world__beacon--${station.state}`}
                      cx={lx - labelW / 2 + 10}
                      cy={ly}
                      r={3.2}
                    />
                    <text className="aw-world__tag-text" x={lx + 5} y={ly + 0.5}>
                      {station.shortLabel}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>
        </div>

        <figcaption className="aw-world__caption" aria-live="polite">
          <div className="aw-world__eyebrow">
            <span>{tx(t, 'world.eyebrow', 'Project world')}</span>
            {project?.name ? <span className="aw-world__project-name">{project.name}</span> : null}
          </div>

          {journey ? (
            <div className="aw-world__journey">
              <span className="aw-world__status-label">
                #{followed.id} {followed.title ?? ''}
              </span>
              <p className="aw-world__journey-sentence">{journey.sentence}</p>
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
          ) : null}

          <div className="aw-world__card">
            <div className="aw-world__card-top">
              <span className={`aw-world__pill aw-world__pill--${activeStation.state}`}>
                <span className="aw-world__pill-dot" aria-hidden="true" />
                {stateBadgeText}
              </span>
            </div>
            <h3 className="aw-world__title">{activeStation.title}</h3>
            <p className="aw-world__explain">{activeStation.explain}</p>
            <div className="aw-world__status-box">
              <span className="aw-world__status-label">{tx(t, 'world.currentStatus', 'Current status')}</span>
              <p className="aw-world__status-value">{activeStation.stateText}</p>
            </div>
            <OperatorExtras station={activeStation} />
            <ChecksList checks={activeStation.checks} t={t} />
          </div>

          <div className="aw-world__nav" role="group" aria-label={tx(t, 'world.stationsNav', 'Map stations')}>
            {stations.map((s) => (
              <button
                key={s.key}
                type="button"
                className="aw-world__chip"
                aria-pressed={activeStation.key === s.key}
                onClick={() => activateStation(s.key, true)}
              >
                <span className={`aw-world__chip-dot aw-world__chip-dot--${s.state}`} aria-hidden="true" />
                {s.shortLabel}
              </button>
            ))}
          </div>
        </figcaption>

        {/* Full text summary of every station and its state for screen readers */}
        <ul className="aw-world__sr-only" aria-label={tx(t, 'world.summaryLabel', 'Website map station status')}>
          {stations.map((s) => (
            <li key={s.key}>
              {s.title}: {s.stateText}. {s.explain}
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
    </div>
  );
}

export default ProjectWorld;
