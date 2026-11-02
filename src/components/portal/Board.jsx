/*
 * The client's work as the homepage machine: each open request sits at the
 * station it is really at (src/lib/workshop3d.ts initBoard). The scene is the
 * board, not decoration: station captions count and filter, hovering a ticket
 * names it, clicking one opens it, and hovering a row in the list below lights
 * its ticket up on the machine. Picking a step moves the camera in on it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from './ui.jsx';
import { useT } from './store.js';

export const STAGES = [
  { key: 'new', label: 'Waiting for Ali' },
  { key: 'approved', label: 'Approved' },
  { key: 'in_progress', label: 'Being built' },
  { key: 'review', label: 'Being checked' },
  { key: 'done', label: 'Shipped' },
];

/** A stage's label in the reader's language; the English `label` above is the fallback. */
export function stageText(t, s) {
  const key = `board.stage.${s.key}`;
  const v = t(key);
  return v !== key ? v : s.label;
}

const RECENT = 14 * 86400;

// Projects get a tint so a belt, its pylon and its label read as one thing.
const LANE_TINTS = [0xff5a1f, 0x95bf47, 0x3b82f6, 0xa855f7, 0xeab308, 0xec4899];
const GREY_TINT = 0x8a857b;
const tintHex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/** What rides the machine: everything open, and the few most recently shipped. */
export function boardItems(tickets) {
  const now = Date.now() / 1000;
  const open = tickets.filter((t) => ['new', 'approved', 'in_progress', 'review'].includes(t.status));
  const shipped = tickets.filter((t) => t.status === 'done' && now - t.updated_at < RECENT).slice(0, 3);
  return [...open, ...shipped];
}

export function Board({
  tickets,
  lanes = [],
  stage,
  onStage,
  hovered,
  onHover,
  onOpen,
  project = null,
  onProject,
  onOpenProject,
}) {
  const t = useT();
  const canvasRef = useRef(null);
  const capRefs = useRef({});
  const tipRef = useRef(null);
  const boardRef = useRef(null);
  const items = boardItems(tickets);

  // Each project gets a belt; requests with no project (or every request, when
  // there is no project yet) get the "getting set up" lane at the end.
  const sceneLanes = useMemo(() => {
    const list = lanes.map((lane, i) => {
      const color = LANE_TINTS[i % LANE_TINTS.length];
      return { ...lane, sites: lane.sites ?? [], lane: i, color, tint: tintHex(color) };
    });
    const loose = items.some((x) => !x.project_id) || !list.length || project === 'none';
    if (loose) {
      list.push({
        id: -1,
        name: t('board.gettingSetUp'),
        sites: [],
        unassigned: true,
        lane: list.length,
        color: GREY_TINT,
        tint: tintHex(GREY_TINT),
      });
    }
    return list;
  }, [lanes, items, project, t]);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const sceneLanesRef = useRef(sceneLanes);
  sceneLanesRef.current = sceneLanes;
  const projectRef = useRef(project);
  projectRef.current = project;
  const stageRef = useRef(stage);
  stageRef.current = stage;

  const laneOf = (projectId) => {
    const list = sceneLanesRef.current;
    if (!projectId) {
      const at = list.findIndex((l) => l.unassigned);
      return at >= 0 ? at : 0;
    }
    const at = list.findIndex((l) => !l.unassigned && l.id === projectId);
    return at >= 0 ? at : 0;
  };

  // The labels are DOM, one per project pylon and site pod. Their positions
  // are written straight to the elements every frame; React only rebuilds the
  // set when projects or sites change.
  const nodeDefs = useMemo(() => {
    const defs = [];
    for (const lane of sceneLanes) {
      const count = items.filter((x) => (lane.unassigned ? !x.project_id : x.project_id === lane.id)).length;
      defs.push({ key: `p:${lane.id}`, kind: 'project', lane, count });
      if (lane.unassigned) continue;
      if (lane.sites.length) {
        for (const site of lane.sites) defs.push({ key: `s:${lane.id}:${site.id}`, kind: 'site', lane, site });
      } else {
        defs.push({ key: `s:${lane.id}:0`, kind: 'site', lane, site: null });
      }
    }
    return defs;
  }, [sceneLanes, items]);

  const nodeRefs = useRef(new Map());
  const setNodeRef = (key) => (el) => {
    if (el) nodeRefs.current.set(key, el);
    else nodeRefs.current.delete(key);
  };
  const [tip, setTip] = useState(null);
  const [failed, setFailed] = useState(false);

  const pickProject = (id) => {
    if (!onProject) return;
    const value = id === -1 ? 'none' : id;
    onProject(project === value ? null : value);
  };

  const handlers = useRef({});
  handlers.current = {
    onHover,
    onOpen,
    onNode: (node) => {
      if (node.kind === 'project') pickProject(node.projectId);
      else if (node.projectId != null) onOpenProject?.(node.projectId);
    },
  };

  useEffect(() => {
    let board = null;
    let stopped = false;
    import('../../lib/workshop3d')
      .then(({ initBoard }) => {
        if (stopped || !canvasRef.current) return;
        board = initBoard(canvasRef.current, {
          items: () => itemsRef.current.map((x) => ({ id: x.id, stage: x.status, lane: laneOf(x.project_id) })),
          lanes: () => sceneLanesRef.current,
          onHover: (id) => {
            setTip(id);
            handlers.current.onHover?.(id);
          },
          onPick: (id) => {
            // Go in toward the ticket, then open it.
            board.focus(id);
            setTimeout(() => handlers.current.onOpen(id), 380);
          },
          onPickNode: (node) => handlers.current.onNode(node),
          onFrame: (stations, hover, nodes) => {
            for (const [key, p] of Object.entries(stations)) {
              const el = capRefs.current[key];
              if (el) el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
            }
            if (tipRef.current) {
              tipRef.current.style.opacity = hover ? '1' : '0';
              if (hover) tipRef.current.style.transform = `translate(${hover.x}px, ${hover.y}px) translate(-50%, calc(-100% - 10px))`;
            }
            // Project and site labels: move them; hide any the scene no longer has.
            const seen = new Set();
            for (const n of nodes ?? []) {
              const el = nodeRefs.current.get(n.key);
              if (!el) continue;
              seen.add(n.key);
              el.style.transform = `translate(${n.x}px, ${n.y}px) translate(-50%, -100%)`;
              el.style.opacity = n.visible === false ? '0' : '1';
            }
            for (const [key, el] of nodeRefs.current) {
              if (!seen.has(key)) el.style.opacity = '0';
            }
          },
        });
        board.zoom(stageRef.current ?? null);
        const p = projectRef.current;
        board.lane(p === null ? null : p === 'none' ? -1 : p);
        boardRef.current = board;
      })
      .catch(() => setFailed(true)); // no WebGL: the legend and list carry it all
    return () => {
      stopped = true;
      board?.stop();
      boardRef.current = null;
    };
  }, []);

  // A step picked in the legend or a caption: the camera moves in on that station.
  useEffect(() => {
    boardRef.current?.zoom(stage ?? null);
  }, [stage]);

  // A project picked in the HUD, on its pylon or on a label: lean in on its belt.
  useEffect(() => {
    boardRef.current?.lane(project === null ? null : project === 'none' ? -1 : project);
  }, [project]);

  // A row hovered in the list lights its ticket on the machine.
  useEffect(() => {
    boardRef.current?.hover(hovered ?? null);
  }, [hovered]);

  const count = (key) => items.filter((t) => t.status === key).length;
  const tipId = tip ?? hovered;
  const tipTicket = tipId != null ? tickets.find((t) => t.id === tipId) : null;
  const loose = sceneLanes.some((l) => l.unassigned);

  return (
    <div className={cx('cp-board', failed && 'is-flat')}>
      <div className="cp-board__stage">
        {!failed ? <canvas ref={canvasRef} className="cp-board__canvas" aria-hidden="true" /> : null}
        {!failed ? (
          <div className="cp-board__nodes">
            {nodeDefs.map((n) =>
              n.kind === 'project' ? (
                <button
                  key={n.key}
                  type="button"
                  ref={setNodeRef(n.key)}
                  className={cx('cp-board__node', 'cp-board__node--project', project === (n.lane.id === -1 ? 'none' : n.lane.id) && 'is-on')}
                  style={{ borderLeftColor: n.lane.tint }}
                  onClick={() => pickProject(n.lane.id)}
                  title={t('board.showOnly', { name: n.lane.name })}
                >
                  <span className="cp-board__node-idx" style={{ color: n.lane.tint }}>
                    {n.lane.unassigned ? '—' : String(n.lane.lane + 1).padStart(2, '0')}
                  </span>
                  <span className="cp-board__node-name">{n.lane.name}</span>
                  <span className="cp-board__node-count" style={{ background: n.lane.tint }}>
                    {n.count}
                  </span>
                </button>
              ) : (
                <button
                  key={n.key}
                  type="button"
                  ref={setNodeRef(n.key)}
                  className={cx('cp-board__node', 'cp-board__node--site', !n.site && 'is-ghost', n.site?.live && 'is-live')}
                  onClick={() => onOpenProject?.(n.lane.id)}
                  title={t('board.openProject', { name: n.site?.name ?? n.lane.name })}
                >
                  <span className={cx('cp-board__node-dot', n.site?.live && 'is-live', n.site && !n.site.live && 'is-preview')} />
                  <span className="cp-board__node-name">{n.site ? n.site.name : t('board.noSite')}</span>
                  {n.site ? <span className="cp-board__node-state">{n.site.live ? t('board.live') : t('board.preview')}</span> : null}
                </button>
              ),
            )}
          </div>
        ) : null}
        {!failed
          ? STAGES.map((s) => (
              <button
                key={s.key}
                type="button"
                ref={(el) => (capRefs.current[s.key] = el)}
                className={cx('cp-board__cap', !count(s.key) && 'is-empty', stage === s.key && 'is-on')}
                onClick={() => onStage(stage === s.key ? null : s.key)}
                tabIndex={-1}
                aria-hidden="true"
              >
                <b>{count(s.key)}</b> {stageText(t, s)}
              </button>
            ))
          : null}
        <div ref={tipRef} className="cp-board__tip" aria-hidden="true">
          {tipTicket ? (
            <>
              <span>#{tipTicket.id}</span> {tipTicket.title}
            </>
          ) : null}
        </div>
        {!items.length ? <p className="cp-board__empty">{t('board.empty')}</p> : null}
      </div>
      <div className="cp-board__lanes" aria-label={t('board.lanes')}>
        <span className="cp-label">{t('board.lanes')}</span>
        <button
          type="button"
          className={cx('cp-board__lane', project === null && 'is-on')}
          aria-pressed={project === null}
          onClick={() => onProject?.(null)}
        >
          {t('board.allProjects')}
        </button>
        {sceneLanes.filter((lane) => !lane.unassigned).map((lane) => {
          const n = items.filter((x) => x.project_id === lane.id).length;
          const on = project === lane.id;
          return (
            <button
              key={lane.id}
              type="button"
              className={cx('cp-board__lane', on && 'is-on')}
              aria-pressed={on}
              onClick={() => onProject?.(on ? null : lane.id)}
            >
              <span className="cp-board__lane-dot" style={{ background: lane.tint }} />
              {lane.name}
              <em>{n}</em>
              <small>{t('views.sites.count', { n: lane.sites.length })}</small>
            </button>
          );
        })}
        {loose ? (
          <button
            type="button"
            className={cx('cp-board__lane', 'cp-board__lane--none', project === 'none' && 'is-on')}
            aria-pressed={project === 'none'}
            onClick={() => onProject?.(project === 'none' ? null : 'none')}
          >
            {t('board.gettingSetUp')}
            <em>{items.filter((x) => !x.project_id).length}</em>
          </button>
        ) : null}
        <span className="cp-board__hint">{t('board.hint')}</span>
      </div>
      <div className="cp-board__legend" role="group" aria-label={t('board.legend')}>
        {STAGES.map((s, i) => (
          <button key={s.key} type="button" aria-pressed={stage === s.key} onClick={() => onStage(stage === s.key ? null : s.key)}>
            <span className="cp-board__no">{String(i + 1).padStart(2, '0')}</span>
            <span className="cp-board__label">{stageText(t, s)}</span>
            <b>{count(s.key)}</b>
          </button>
        ))}
      </div>
    </div>
  );
}
