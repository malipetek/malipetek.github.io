/*
 * The client's work as the homepage machine: each open request sits at the
 * station it is really at (src/lib/workshop3d.ts initBoard). The scene is the
 * board, not decoration: station captions count and filter, hovering a ticket
 * names it, clicking one opens it, and hovering a row in the list below lights
 * its ticket up on the machine. Picking a step moves the camera in on it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { money } from '../../lib/pricing.js';
import { Button, MiniTrack, StatusPill, ago, cx, totalOf } from './ui.jsx';
import { afterTransition, boardReturn, useT } from './store.js';
import { arrivingBox, placeScene, slowFactor, whenLanded } from './sceneHandover.js';

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

/** What a dragged row or site label carries; the project labels accept it. */
export const DRAG_TICKET = 'application/x-malipetek-ticket';
export const DRAG_SITE = 'application/x-malipetek-site';

/** What rides the machine: everything open, and the few most recently shipped. */
export function boardItems(tickets) {
  const now = Date.now() / 1000;
  const open = tickets.filter((t) => ['new', 'approved', 'in_progress', 'review'].includes(t.status));
  const shipped = tickets.filter((t) => t.status === 'done' && now - t.updated_at < RECENT).slice(0, 3);
  return [...open, ...shipped];
}

/* The camera the last mounted board left behind. The overview unmounts on hash
   navigation, so this lives at module level: coming back starts there and the
   camera glides out of the request that was being read, instead of resetting. */
let lastBoardView = null;

/* A request opened from its card keeps the board running behind it, dived
   in on that request and faded (client-portal.css, "is-backdrop"): the room
   the zoom went into stays. Dropped when the next board takes over, or when
   the page goes anywhere but that request or back to the board. */
let backdrop = null;

const dropBackdrop = () => {
  if (!backdrop) return;
  window.removeEventListener('hashchange', backdrop.watch);
  backdrop.board.stop();
  backdrop.canvas.remove();
  backdrop = null;
};

function keepAsBackdrop(board, canvas, id) {
  dropBackdrop();
  canvas.classList.add('is-backdrop');
  board.focus(id);
  // Back to the board: the board that mounts drops it once it has taken
  // over. Anywhere else: it goes once that page's transition has ended.
  const watch = () => {
    const path = window.location.hash.replace(/^#\/?/, '').split('?')[0];
    if (path === `ticket/${id}` || path === '' || path === 'overview') return;
    afterTransition(dropBackdrop);
  };
  window.addEventListener('hashchange', watch);
  backdrop = { board, canvas, watch };
}

/* Arriving from the homepage: how long the camera takes to fly from the
   homepage's machine to the board (ms, at --vt-slow 1). */
const ARRIVAL_FLIGHT = 1000;

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
  onMoveTicket,
  onMoveSite,
}) {
  const t = useT();
  const stageElRef = useRef(null);
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
      // All projects: one yard label each. One project picked: its sites, as
      // they are the only ones that matter then.
      if (project === null) {
        defs.push({ key: `y:${lane.id}`, kind: 'yard', lane, count: lane.sites.length });
      } else if (project === lane.id) {
        if (lane.sites.length) {
          for (const site of lane.sites) defs.push({ key: `s:${lane.id}:${site.id}`, kind: 'site', lane, site });
        } else {
          defs.push({ key: `s:${lane.id}:0`, kind: 'site', lane, site: null });
        }
      }
    }
    return defs;
  }, [sceneLanes, items, project]);

  const nodeRefs = useRef(new Map());
  const setNodeRef = (key) => (el) => {
    if (el) nodeRefs.current.set(key, el);
    else nodeRefs.current.delete(key);
  };
  const [tip, setTip] = useState(null);
  const [failed, setFailed] = useState(false);
  const [dropKey, setDropKey] = useState(null);
  // Back from a request that was opened from its card: the card is open again
  // where it was, so the request's head can shrink back into it. Only when
  // this board is reached from that request; a stale one is dropped.
  const [reopen] = useState(() => {
    const r = boardReturn.reopen;
    boardReturn.reopen = null;
    const from = boardReturn.from;
    return r && from?.name === 'ticket' && from.id === String(r.id) ? r : null;
  });
  const [named, setNamed] = useState(Boolean(reopen));
  useEffect(() => {
    if (reopen) afterTransition(() => setNamed(false));
  }, [reopen]);
  // A picked request opens its peek card instead of leaving the board; the
  // camera dives to it, and the card rides its screen point in onFrame.
  const [peek, setPeek] = useState(reopen?.id ?? null);
  const peekEl = useRef(null);
  const closePeek = useCallback(() => {
    setPeek(null);
    boardRef.current?.focus(null);
  }, []);

  // A project label, a site label or a chip is a drop target: dropping a row
  // moves that request (and optionally onto a site), dropping a site label
  // moves that site. The unassigned lane accepts nothing.
  const dropProps = (lane, siteId = null) => {
    const key = siteId ? `s:${lane.id}:${siteId}` : `p:${lane.id}`;
    return {
      onDragOver: (e) => {
        if (lane.unassigned) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dropKey !== key) setDropKey(key);
      },
      onDragLeave: () => setDropKey((k) => (k === key ? null : k)),
      onDrop: (e) => {
        if (lane.unassigned) return;
        e.preventDefault();
        setDropKey(null);
        const ticket = e.dataTransfer.getData(DRAG_TICKET);
        const site = e.dataTransfer.getData(DRAG_SITE);
        if (ticket) onMoveTicket?.(Number(ticket), lane.id, siteId);
        else if (site) onMoveSite?.(site, lane.id);
      },
    };
  };

  const pickProject = (id) => {
    if (!onProject) return;
    const value = id === -1 ? 'none' : id;
    closePeek();
    onProject(project === value ? null : value);
  };
  // Any view change — a step, a lane, a project — closes the card: the camera
  // could not move while it was still dived into the request.
  const pickStage = (key) => {
    closePeek();
    onStage?.(key);
  };
  const openProject = (id, siteId) => {
    closePeek();
    onOpenProject?.(id, siteId);
  };
  const pickLane = (value) => {
    closePeek();
    onProject?.(value);
  };

  const handlers = useRef({});
  handlers.current = {
    onHover,
    onOpen,
    onNode: (node) => {
      if (node.kind === 'project') pickProject(node.projectId);
      else if (node.projectId != null) onOpenProject?.(node.projectId, node.siteId ?? null);
    },
  };

  useEffect(() => {
    let board = null;
    let view = null;
    let stopped = false;
    // Reached by the hop from the homepage: the homepage's own workshop takes
    // the flying machine first, at the very frame it left on, then gives way
    // to the board (handOver below).
    const left = arrivingBox();
    let room = null;
    let unwatch = () => {};
    let settle = null;
    import('../../lib/workshop3d')
      .then(({ initBoard, initWorkshop }) => {
        const host = document.querySelector('.cp-scene');
        if (stopped || !host || !stageElRef.current) return;
        if (left) {
          const canvas = document.createElement('canvas');
          canvas.className = 'cp-workshop';
          canvas.setAttribute('aria-hidden', 'true');
          host.appendChild(canvas);
          let placed = false;
          const stop = initWorkshop(canvas, {
            start: { mouse: left.mouse, time: left.time },
            onFrame: (box) => {
              if (!placed) placed = placeScene(box);
            },
          });
          room = { canvas, stop };
        }
        // The renderer lives in the page shell, behind the portal; the stage is
        // only the transparent input surface and the labels.
        const canvas = document.createElement('canvas');
        canvas.className = 'cp-board__canvas';
        canvas.setAttribute('aria-hidden', 'true');
        host.appendChild(canvas);
        view = canvas;
        // Back from a request opened from its card: its backdrop stood in for
        // the board until now, and goes once the way back has ended.
        if (backdrop) afterTransition(dropBackdrop);
        // Out of sight, labels and all, until the workshop gives way. The
        // board's camera holds on its own copy of the homepage's machine
        // meanwhile, drawing the same frame as the workshop.
        const stage = stageElRef.current;
        if (room) for (const el of [canvas, stage]) el.style.opacity = '0';
        board = initBoard(canvas, {
          arrival: room ? { time: left.time, mouse: left.mouse } : undefined,
          input: stageElRef.current,
          frame: stageElRef.current,
          fitBase: 2.8,
          items: () =>
            itemsRef.current.map((x) => ({
              id: x.id,
              stage: x.status,
              lane: laneOf(x.project_id),
              stuck: Boolean(x.stuck),
            })),
          lanes: () => sceneLanesRef.current,
          onHover: (id) => {
            setTip(id);
            handlers.current.onHover?.(id);
          },
          onPick: (id) => {
            // Dive toward the ticket and open its peek card; the page does not
            // move until the card's Open goes to the request itself.
            board.focus(id);
            setPeek(id);
          },
          onPickNode: (node) => {
            closePeek();
            handlers.current.onNode(node);
          },
          onPickEmpty: () => closePeek(),
          onFrame: (stations, hover, nodes, focus) => {
            for (const [key, p] of Object.entries(stations)) {
              const el = capRefs.current[key];
              if (el) el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
            }
            if (tipRef.current) {
              // While a request is dived into, its card carries the same text.
              tipRef.current.style.opacity = hover && !focus ? '1' : '0';
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
            // The peek card sits under the dived ticket, flipped above it and
            // nudged inward when the ticket is close to the stage's edges.
            const el = peekEl.current;
            if (el) {
              if (focus) {
                const stageEl = stageElRef.current;
                const w = el.offsetWidth;
                const h = el.offsetHeight;
                const sw = stageEl?.clientWidth ?? 0;
                const sh = stageEl?.clientHeight ?? 0;
                const x = Math.max(8, Math.min(Math.max(8, sw - w - 8), focus.x - w / 2));
                const y = focus.y + 30 + h <= sh - 8 ? focus.y + 30 : Math.max(8, focus.y - h - 30);
                el.style.transform = `translate(${x}px, ${y}px)`;
                el.style.opacity = '1';
              } else {
                el.style.opacity = '0';
              }
            }
          },
        });
        board.zoom(stageRef.current ?? null);
        const p = projectRef.current;
        board.lane(p === null ? null : p === 'none' ? -1 : p);
        // The view the last board left behind: same zoom and pan, and a glide
        // out of the request being read — saved on unmount, or set by the
        // ticket page so coming back from a row link zooms out too.
        const seen = boardReturn.ticket;
        boardReturn.ticket = null;
        board.restore(lastBoardView ? { ...lastBoardView, focus: lastBoardView.focus ?? seen } : { zoom: 1, pan: { x: 0, y: 0 }, focus: seen });
        // A reopened card keeps the camera on its request instead of gliding out.
        if (reopen) board.focus(reopen.id);
        boardRef.current = board;
        if (room) {
          // Once the machine has landed on the workshop, the board's canvas,
          // already drawing the same frame, takes its place, and the camera
          // flies through the one world from the homepage's machine to the
          // board. The labels come in on the way.
          unwatch = whenLanded(() => {
            const flight = ARRIVAL_FLIGHT * slowFactor();
            canvas.style.removeProperty('opacity');
            room.stop();
            room.canvas.remove();
            room = null;
            board.arrive(flight);
            stage.style.transition = `opacity ${flight * 0.4}ms ease ${flight * 0.6}ms`;
            stage.style.opacity = '1';
            settle = setTimeout(() => {
              stage.style.removeProperty('transition');
              stage.style.removeProperty('opacity');
            }, flight + 50);
          });
        }
      })
      .catch(() => {
        // No WebGL: the legend and list carry it all. Nor is the homepage's
        // workshop left standing in for a board that never came.
        room?.stop();
        room?.canvas.remove();
        room = null;
        setFailed(true);
      });
    return () => {
      stopped = true;
      unwatch();
      clearTimeout(settle);
      room?.stop();
      room?.canvas.remove();
      if (board) lastBoardView = board.view();
      boardRef.current = null;
      // Into a request from its card (TicketView set reopen as it mounted):
      // the board stays behind it as the backdrop instead of stopping.
      const into = boardReturn.reopen;
      if (board && view && into) keepAsBackdrop(board, view, into.id);
      else {
        board?.stop();
        view?.remove();
      }
    };
  }, []);

  // Esc closes the card; opening it focuses its action so Enter continues in.
  useEffect(() => {
    if (peek === null) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closePeek();
    };
    window.addEventListener('keydown', onKey);
    peekEl.current?.querySelector('.cp-peek__go .cp-btn')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [peek, closePeek]);

  // The request left the board (it shipped or filtered out): its card goes too.
  useEffect(() => {
    if (peek !== null && !items.some((x) => x.id === peek)) closePeek();
  }, [items, peek, closePeek]);

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
  const peekTicket = peek === null ? null : (items.find((x) => x.id === peek) ?? null);
  const loose = sceneLanes.some((l) => l.unassigned);

  return (
    <div className={cx('cp-board', failed && 'is-flat')}>
      <div
        ref={stageElRef}
        className="cp-board__stage"
        aria-hidden={failed ? 'true' : undefined}
      >
        {!failed ? (
          <div className="cp-board__nodes">
            {nodeDefs.map((n) =>
              n.kind === 'project' ? (
                <button
                  key={n.key}
                  type="button"
                  ref={setNodeRef(n.key)}
                  {...dropProps(n.lane)}
                  className={cx(
                    'cp-board__node',
                    'cp-board__node--project',
                    project === (n.lane.id === -1 ? 'none' : n.lane.id) && 'is-on',
                    dropKey === `p:${n.lane.id}` && 'is-drop',
                  )}
                  style={{ borderLeftColor: n.lane.tint }}
                  aria-pressed={project === (n.lane.id === -1 ? 'none' : n.lane.id)}
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
              ) : n.kind === 'yard' ? (
                <button
                  key={n.key}
                  type="button"
                  ref={setNodeRef(n.key)}
                  {...dropProps(n.lane)}
                  className={cx('cp-board__node', 'cp-board__node--yard', dropKey === `p:${n.lane.id}` && 'is-drop')}
                  onClick={() => openProject(n.lane.id, null)}
                  title={t('views.entity.openProject')}
                >
                  <span className="cp-board__node-dot" style={{ background: n.lane.tint }} />
                  <span className="cp-board__node-name">{n.lane.name}</span>
                  <span className="cp-board__node-state">{t('views.sites.count', { n: n.count })}</span>
                </button>
              ) : (
                <button
                  key={n.key}
                  type="button"
                  ref={setNodeRef(n.key)}
                  {...dropProps(n.lane, n.site?.id ?? null)}
                  className={cx(
                    'cp-board__node',
                    'cp-board__node--site',
                    !n.site && 'is-ghost',
                    n.site?.live && 'is-live',
                    dropKey === `s:${n.lane.id}:${n.site?.id ?? 0}` && 'is-drop',
                  )}
                  draggable={Boolean(n.site)}
                  onDragStart={(e) => {
                    if (!n.site) return;
                    e.dataTransfer.setData(DRAG_SITE, String(n.site.id));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => openProject(n.lane.id, n.site?.id ?? null)}
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
                onClick={() => pickStage(stage === s.key ? null : s.key)}
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
              {tipTicket.waitingReason ? <em className="cp-board__tipnote">{tipTicket.waitingReason}</em> : null}
            </>
          ) : null}
        </div>
        {peekTicket ? (
          <div
            ref={peekEl}
            className="cp-peek"
            role="dialog"
            aria-label={peekTicket.title}
            // Reopened: in place from the first frame, before the 3D board
            // has loaded and starts placing it.
            style={
              reopen?.id === peekTicket.id
                ? { transform: reopen.transform, opacity: 1, ...(named ? { viewTransitionName: 'cp-peek' } : {}) }
                : undefined
            }
          >
            <div className="cp-peek__top">
              <span className="cp-peek__id">#{peekTicket.id}</span>
              <MiniTrack status={peekTicket.status} />
              <StatusPill status={peekTicket.status} />
              <button type="button" className="cp-peek__x" onClick={closePeek} aria-label={t('ui.close')}>
                ✕
              </button>
            </div>
            <p className="cp-peek__title" style={named && reopen?.id === peekTicket.id ? { viewTransitionName: 'cp-peek-title' } : undefined}>
              {peekTicket.title}
            </p>
            <p className="cp-peek__meta">
              <span>{peekTicket.project_name ?? t('board.gettingSetUp')}</span>
              <span>{ago(peekTicket.updated_at)}</span>
              {totalOf(peekTicket) ? <span>{money(totalOf(peekTicket))}</span> : null}
            </p>
            {peekTicket.waitingReason ? <p className="cp-peek__note">{peekTicket.waitingReason}</p> : null}
            <div className="cp-peek__go">
              <Button
                kind="primary"
                onClick={() => {
                  // Named for the view transition: the card morphs into the
                  // request page's head instead of the whole page cross-fading.
                  const el = peekEl.current;
                  if (el) {
                    el.style.viewTransitionName = 'cp-peek';
                    el.querySelector('.cp-peek__title')?.style.setProperty('view-transition-name', 'cp-peek-title');
                    // Where it is: the page zooms into it, and the board puts
                    // it back here on the way back.
                    const r = el.getBoundingClientRect();
                    boardReturn.peekAt = { transform: el.style.transform, box: { left: r.left, top: r.top, width: r.width } };
                  }
                  boardReturn.peek = peekTicket.id;
                  handlers.current.onOpen(peekTicket.id);
                }}
              >
                {t('board.peek.open')}
              </Button>
            </div>
          </div>
        ) : null}
        {!items.length ? <p className="cp-board__empty">{t('board.empty')}</p> : null}
        {!failed ? (
          <div className="cp-board__controls">
            <button type="button" onClick={() => boardRef.current?.zoomBy(0.82)} title={t('board.zoomIn')} aria-label={t('board.zoomIn')}>
              +
            </button>
            <button type="button" onClick={() => boardRef.current?.zoomBy(1.22)} title={t('board.zoomOut')} aria-label={t('board.zoomOut')}>
              −
            </button>
            <button type="button" onClick={() => boardRef.current?.reset()} title={t('board.reset')} aria-label={t('board.reset')}>
              ⟲
            </button>
          </div>
        ) : null}
      </div>
      <div className="cp-board__lanes" aria-label={t('board.lanes')}>
        <span className="cp-label">{t('board.lanes')}</span>
        <button
          type="button"
          className={cx('cp-board__lane', project === null && 'is-on')}
          aria-pressed={project === null}
          onClick={() => pickLane(null)}
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
              {...dropProps(lane)}
              className={cx('cp-board__lane', on && 'is-on', dropKey === `p:${lane.id}` && 'is-drop')}
              aria-pressed={on}
              onClick={() => pickLane(on ? null : lane.id)}
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
            onClick={() => pickLane(project === 'none' ? null : 'none')}
          >
            {t('board.gettingSetUp')}
            <em>{items.filter((x) => !x.project_id).length}</em>
          </button>
        ) : null}
        <span className="cp-board__hint">{t('board.hint')}</span>
      </div>
      <div className="cp-board__legend" role="group" aria-label={t('board.legend')}>
        {STAGES.map((s, i) => (
          <button key={s.key} type="button" aria-pressed={stage === s.key} onClick={() => pickStage(stage === s.key ? null : s.key)}>
            <span className="cp-board__no">{String(i + 1).padStart(2, '0')}</span>
            <span className="cp-board__label">{stageText(t, s)}</span>
            <b>{count(s.key)}</b>
          </button>
        ))}
      </div>
    </div>
  );
}
