/*
 * The 3D room across the portal's pages. On the overview it is the board
 * itself (Board.jsx). Leaving the overview, the board is not stopped: it
 * becomes the room, and the route says what the room does (roomModeOf):
 * - a request or a project: the backdrop, faded behind the page, dived in on
 *   that request or that project's line (client-portal.css, "is-backdrop").
 *   Opened from its card or sheet, it ends on the zoom's own frame.
 * - any other page: a small window at the top of it (Shell's room box), the
 *   whole board, which leads back to the overview. The way in and out morphs
 *   between the full room and the box (client-portal.css, "cp-room").
 * Back on the overview the new board takes over and the room goes. A page
 * reached directly (a link, a reload) starts a room of its own.
 */
import { afterTransition, boardReturn, roomModeOf } from './store.js';
import { boardItems, sceneItem, sceneLanesFor } from './Board.jsx';

/** The room: { board, canvas, key, scene } — scene feeds a room started here. */
let room = null;
/** What a room started here draws: the client's requests and projects. */
let scene = null;
let starting = false;

export const hasRoom = () => Boolean(room);

/** The overview's board, as it unmounts: it carries on as the room. */
export function adoptRoom(board, canvas) {
  dropRoom();
  room = { board, canvas, key: null, own: false };
}

export function dropRoom() {
  if (!room) return;
  unplace();
  room.board.stop();
  room.canvas.remove();
  room = null;
}

/** The latest requests and projects, for a room started here. */
export function roomData({ tickets, lanes, label }) {
  const items = boardItems(tickets);
  const list = sceneLanesFor(lanes ?? [], items, null, label);
  scene = { items: items.map(sceneItem(list)), lanes: list };
}

// The zoom into a request or project ends on a frame store.js measures
// during the change; the room behind the page ends on the same one.
boardReturn.onZoomCam = (cam) => {
  if (room && cam) room.board.zoomView(cam);
};

/** Put the room in the role `route` gives it (called as each page commits). */
export function syncRoom(route) {
  const mode = roomModeOf(route);
  if (mode === 'board') {
    if (room) toBoard();
    return;
  }
  if (room) apply(route, mode);
  else start();
}

function apply(route, mode) {
  const { board, canvas } = room;
  const key = `${route.name}/${route.id}`;
  // A zoom's frame belongs to the page it zoomed into.
  if (room.key !== key) board.zoomView(null);
  room.key = key;
  if (mode === 'mini') {
    canvas.classList.remove('is-backdrop');
    canvas.classList.add('is-mini');
    board.focus(null);
    board.focusNode(null);
    board.lane(null);
    board.reframe(null);
    place();
    return;
  }
  unplace();
  canvas.classList.remove('is-mini');
  // Under the zoom the live room is hidden until the end, and must be at
  // the backdrop's level by then; otherwise it eases there.
  if (document.documentElement.dataset.cpNav === 'zoom-in' && !canvas.classList.contains('is-backdrop')) {
    canvas.style.transition = 'none';
    canvas.classList.add('is-backdrop');
    void canvas.offsetWidth;
    canvas.style.removeProperty('transition');
  } else canvas.classList.add('is-backdrop');
  if (route.name === 'ticket') {
    board.focusNode(null);
    board.lane(null);
    board.focus(Number(route.id));
  } else {
    board.focus(null);
    // Project ids are the API's own (strings), as the board's lanes carry them.
    board.lane(route.id);
    board.focusNode(`p:${route.id}`);
  }
}

/** Back to the overview: the room frames the board as the board will. */
function toBoard() {
  const { board, canvas } = room;
  unplace();
  canvas.classList.remove('is-mini', 'is-backdrop');
  room.key = null;
  board.zoomView(null);
  board.focus(null);
  board.focusNode(null);
  board.lane(null);
  board.reframe(document.querySelector('.cp-board__stage'));
}

/** A page reached directly: start a room behind it. */
function start() {
  if (starting) return;
  starting = true;
  import('../../lib/workshop3d')
    .then(({ initBoard }) => {
      starting = false;
      const host = document.querySelector('.cp-scene');
      const route = currentRoute();
      if (room || !host || roomModeOf(route) === 'board') return;
      const canvas = document.createElement('canvas');
      canvas.className = 'cp-board__canvas cp-room is-arriving';
      canvas.setAttribute('aria-hidden', 'true');
      host.appendChild(canvas);
      const board = initBoard(canvas, {
        fitBase: 2.8,
        items: () => scene?.items ?? [],
        lanes: () => scene?.lanes ?? [],
      });
      room = { board, canvas, key: null, own: true };
      apply(route, roomModeOf(route));
      // Fades in rather than appearing.
      requestAnimationFrame(() => requestAnimationFrame(() => canvas.classList.remove('is-arriving')));
    })
    .catch(() => {
      starting = false; // no WebGL: the pages stand on their own
    });
}

function currentRoute() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path] = raw.split('?');
  const [name = '', id = ''] = path.split('/');
  return { name: name || 'overview', id: decodeURIComponent(id) };
}

/* The small window: the canvas sits over the page's room box (behind the
   page, which leaves the box clear), and follows it as the page scrolls. */
let placed = null;

function place() {
  const box = document.querySelector('[data-room-box]');
  if (!room || !box) return;
  const fit = () => {
    if (!room) return;
    const r = box.getBoundingClientRect();
    Object.assign(room.canvas.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
  fit();
  if (placed?.box === box) return;
  unplace();
  let frame = 0;
  const later = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fit);
  };
  window.addEventListener('scroll', later, true);
  window.addEventListener('resize', later);
  placed = { box, later };
  fit();
}

function unplace() {
  if (placed) {
    window.removeEventListener('scroll', placed.later, true);
    window.removeEventListener('resize', placed.later);
    placed = null;
  }
  if (room) for (const k of ['left', 'top', 'width', 'height']) room.canvas.style.removeProperty(k);
}
