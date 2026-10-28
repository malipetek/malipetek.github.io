/*
 * The client's work as the homepage machine: each open request sits at the
 * station it is really at (src/lib/workshop3d.ts initBoard). The scene is the
 * board, not decoration: station captions count and filter, hovering a ticket
 * names it, clicking one opens it, and hovering a row in the list below lights
 * its ticket up on the machine.
 */
import { useEffect, useRef, useState } from 'react';
import { cx } from './ui.jsx';

export const STAGES = [
  { key: 'new', label: 'Waiting for Ali' },
  { key: 'approved', label: 'Approved' },
  { key: 'in_progress', label: 'Being built' },
  { key: 'review', label: 'Being checked' },
  { key: 'done', label: 'Shipped' },
];

const RECENT = 14 * 86400;

/** What rides the machine: everything open, and the few most recently shipped. */
export function boardItems(tickets) {
  const now = Date.now() / 1000;
  const open = tickets.filter((t) => ['new', 'approved', 'in_progress', 'review'].includes(t.status));
  const shipped = tickets.filter((t) => t.status === 'done' && now - t.updated_at < RECENT).slice(0, 3);
  return [...open, ...shipped];
}

export function Board({ tickets, stage, onStage, hovered, onHover, onOpen }) {
  const canvasRef = useRef(null);
  const capRefs = useRef({});
  const tipRef = useRef(null);
  const boardRef = useRef(null);
  const items = boardItems(tickets);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [tip, setTip] = useState(null);
  const [failed, setFailed] = useState(false);
  const handlers = useRef({});
  handlers.current = { onHover, onOpen };

  useEffect(() => {
    let board = null;
    let stopped = false;
    import('../../lib/workshop3d')
      .then(({ initBoard }) => {
        if (stopped || !canvasRef.current) return;
        board = initBoard(canvasRef.current, {
          items: () => itemsRef.current.map((t) => ({ id: t.id, stage: t.status })),
          onHover: (id) => {
            setTip(id);
            handlers.current.onHover?.(id);
          },
          onPick: (id) => {
            // Go in toward the ticket, then open it.
            board.focus(id);
            setTimeout(() => handlers.current.onOpen(id), 380);
          },
          onFrame: (stations, hover) => {
            for (const [key, p] of Object.entries(stations)) {
              const el = capRefs.current[key];
              if (el) el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
            }
            if (tipRef.current) {
              tipRef.current.style.opacity = hover ? '1' : '0';
              if (hover) tipRef.current.style.transform = `translate(${hover.x}px, ${hover.y}px) translate(-50%, calc(-100% - 10px))`;
            }
          },
        });
        boardRef.current = board;
      })
      .catch(() => setFailed(true)); // no WebGL: the legend and list carry it all
    return () => {
      stopped = true;
      board?.stop();
      boardRef.current = null;
    };
  }, []);

  // A row hovered in the list lights its ticket on the machine.
  useEffect(() => {
    boardRef.current?.hover(hovered ?? null);
  }, [hovered]);

  const count = (key) => items.filter((t) => t.status === key).length;
  const tipId = tip ?? hovered;
  const tipTicket = tipId != null ? tickets.find((t) => t.id === tipId) : null;

  return (
    <div className={cx('cp-board', failed && 'is-flat')}>
      <div className="cp-board__stage">
        {!failed ? <canvas ref={canvasRef} className="cp-board__canvas" aria-hidden="true" /> : null}
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
                <b>{count(s.key)}</b> {s.label}
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
        {!items.length ? <p className="cp-board__empty">Your requests ride this line, from your words to shipped.</p> : null}
      </div>
      <div className="cp-board__legend" role="group" aria-label="Show requests at one step">
        {STAGES.map((s, i) => (
          <button key={s.key} type="button" aria-pressed={stage === s.key} onClick={() => onStage(stage === s.key ? null : s.key)}>
            <span className="cp-board__no">{String(i + 1).padStart(2, '0')}</span>
            <span className="cp-board__label">{s.label}</span>
            <b>{count(s.key)}</b>
          </button>
        ))}
      </div>
    </div>
  );
}
