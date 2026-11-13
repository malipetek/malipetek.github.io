/*
 * The 3D room across the portal's pages. On the overview it is the board
 * itself (Board.jsx). Leaving the overview, the board is not stopped: it
 * becomes the room, and the route says what the room does (roomModeOf):
 * - a request or a project: the backdrop, faded behind the page, dived in on
 *   that request or that project's line (client-portal.css, "is-backdrop").
 *   Opened from its card or sheet, it ends on the zoom's own frame.
 * - any other page: a small window at the top of it (Shell's room box), the
 *   whole board, which leads back to the overview.
 * Back on the overview the new board takes over and the room goes. A page
 * reached directly (a link, a reload) starts a room of its own.
 *
 * The canvas always covers the whole window. The small window is a clip of
 * it plus a 2D zoom of its picture (Board.zoomView) that carries the board's
 * area into the box, and moving between the two is animated live, so the
 * board itself shrinks into the box and grows back out of it, aligned all the
 * way. The page transition leaves the canvas alone meanwhile (client-portal
 * css, "cp-room").
 *
 * A page reached from the homepage (sceneHandover.js) takes the hop's picture
 * too: it lands in the box, on the frame this canvas is drawing there, so the
 * machine moves into the window instead of hanging in front of the page and
 * then appearing at the top.
 */
import { afterTransition, boardReturn, roomModeOf } from './store.js';
import { boardItems, sceneItem, sceneLanesFor } from './Board.jsx';
import { arrivingBox, landInWindow, sceneInPlace, slowFactor } from './sceneHandover.js';

/** The room: { board, canvas, key, own } — `own` when started here. */
let room = null;
/** What a room started here draws: the client's requests and projects. */
let scene = null;
let starting = false;

/** How long the room takes between the whole window and the box (ms, at --vt-slow 1). */
const MORPH = 420;
const BOX_RADIUS = 14;

export const hasRoom = () => Boolean(room);

/**
 * The overview's new board calls this to take over: `fn` runs once the room
 * has opened back out to the board's framing (now, if it is not moving), and
 * after the page's own transition.
 */
export function handOver(fn) {
  if (!room?.opening) return afterTransition(fn);
  room.opening.push(() => afterTransition(fn));
}

/** The overview's board, as it unmounts: it carries on as the room. */
export function adoptRoom(board, canvas) {
  dropRoom();
  room = { board, canvas, key: null, own: false, lens: { ...IDENTITY } };
}

export function dropRoom() {
  if (!room) return;
  stopFollowing();
  cancelAnimationFrame(room.anim ?? 0);
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
  if (!room || !cam) return;
  setLens({ s: cam.s, x: cam.hx - cam.s * cam.cx, y: cam.hy - cam.s * cam.cy, clip: null });
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

/* ————— the lens: a 2D zoom of the picture (p → s·p + (x, y)) and a clip ————— */

const IDENTITY = { s: 1, x: 0, y: 0, clip: null };

function setLens(lens) {
  if (!room) return;
  room.lens = lens;
  const { board, canvas } = room;
  board.zoomView(lens.s === 1 && !lens.x && !lens.y ? null : { cx: 0, cy: 0, hx: lens.x, hy: lens.y, s: lens.s });
  if (lens.clip) {
    const [t, r, b, l, round] = lens.clip;
    canvas.style.clipPath = `inset(${t}px ${r}px ${b}px ${l}px round ${round}px)`;
  } else canvas.style.removeProperty('clip-path');
}

/** The full window's clip, as a box clip with nothing cut, so the two can be eased between. */
const OPEN = () => [0, 0, 0, 0, 0];

/** Ease the lens from where it is to `to` over the morph's duration. */
function moveLens(to, done) {
  if (!room) return;
  cancelAnimationFrame(room.anim ?? 0);
  const from = room.lens;
  const ms = MORPH * slowFactor();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || ms <= 0) {
    room.anim = 0;
    setLens(to);
    done?.();
    return;
  }
  const a = from.clip ?? OPEN();
  const b = to.clip ?? OPEN();
  const t0 = performance.now();
  const step = () => {
    if (!room) return;
    const k = Math.min(1, (performance.now() - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    const mix = (p, q) => p + (q - p) * e;
    setLens({
      s: mix(from.s, to.s),
      x: mix(from.x, to.x),
      y: mix(from.y, to.y),
      clip: k < 1 || to.clip ? a.map((v, i) => mix(v, b[i])) : null,
    });
    if (k < 1) room.anim = requestAnimationFrame(step);
    else {
      room.anim = 0;
      setLens(to);
      done?.();
    }
  };
  room.anim = requestAnimationFrame(step);
}

/** The lens that shows the board's area inside the page's room box. */
function boxLens() {
  const box = document.querySelector('[data-room-box]')?.getBoundingClientRect();
  if (!room || !box || !box.width) return null;
  const f = room.board.frameRect();
  const s = Math.min(box.width / f.width, box.height / f.height);
  const W = window.innerWidth;
  const H = window.innerHeight;
  return {
    s,
    x: box.left + box.width / 2 - s * (f.left + f.width / 2),
    y: box.top + box.height / 2 - s * (f.top + f.height / 2),
    clip: [box.top, W - box.right, H - box.bottom, box.left, BOX_RADIUS],
  };
}

/* ————— roles ————— */

function apply(route, mode) {
  const { board, canvas } = room;
  const key = `${route.name}/${route.id}`;
  const fresh = room.key !== key;
  room.key = key;
  if (mode === 'mini') {
    canvas.classList.remove('is-backdrop');
    canvas.classList.add('is-mini');
    board.focus(null);
    board.focusNode(null);
    board.lane(null);
    const lens = boxLens();
    if (lens) moveLens(lens);
    follow();
    return;
  }
  stopFollowing();
  canvas.classList.remove('is-mini');
  // Under the zoom the live room is hidden until the end, and must be at
  // the backdrop's level by then; otherwise it eases there.
  if (document.documentElement.dataset.cpNav === 'zoom-in' && !canvas.classList.contains('is-backdrop')) {
    canvas.style.transition = 'none';
    canvas.classList.add('is-backdrop');
    void canvas.offsetWidth;
    canvas.style.removeProperty('transition');
  } else canvas.classList.add('is-backdrop');
  // A zoom's frame belongs to the page it zoomed into; out of the box, the
  // room opens back up to the whole window.
  if (room.lens.clip) moveLens(IDENTITY);
  else if (fresh) setLens(IDENTITY);
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

/** Back to the overview: the room opens out to the board's own framing. */
function toBoard() {
  const { board, canvas } = room;
  stopFollowing();
  canvas.classList.remove('is-mini', 'is-backdrop');
  room.key = null;
  board.focus(null);
  board.focusNode(null);
  board.lane(null);
  // Centre on the overview's board window. From the box: keep what the box
  // shows the same (the picture moves with the frame; the lens moves it
  // back), then open out, and the new board takes over once it has. From a
  // backdrop: the page's own zoom moves the room, so its lens just resets.
  const wasBox = Boolean(room.lens.clip);
  board.reframe(document.querySelector('.cp-board__stage'));
  if (!wasBox) {
    setLens(IDENTITY);
    return;
  }
  setLens(boxLens() ?? room.lens);
  const waiting = [];
  room.opening = waiting;
  moveLens(IDENTITY, () => {
    if (room) room.opening = null;
    for (const fn of waiting) fn();
  });
}

/* While in the box, the box moves with the page; the lens follows it. */
let following = null;

function follow() {
  if (following) return;
  let frame = 0;
  const later = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (room && !room.anim) {
        const lens = boxLens();
        if (lens) setLens(lens);
      }
    });
  };
  window.addEventListener('scroll', later, true);
  window.addEventListener('resize', later);
  following = later;
}

function stopFollowing() {
  if (!following) return;
  window.removeEventListener('scroll', following, true);
  window.removeEventListener('resize', following);
  following = null;
}

/** A page reached directly: start a room behind it. */
function start() {
  if (starting) return;
  starting = true;
  // The machine the site sent over, if this load came from the homepage: this
  // page has no board of its own, so the hop's picture has to be taken
  // somewhere, or it would stand in front of the page until the guard gives up
  // (Base.astro) and then vanish, the room appearing at the top out of nothing.
  const left = arrivingBox();
  const boxRect = () => document.querySelector('[data-room-box]')?.getBoundingClientRect() ?? null;
  import('../../lib/workshop3d')
    .then(({ initBoard }) => {
      starting = false;
      const host = document.querySelector('.cp-scene');
      const route = currentRoute();
      if (room || !host || roomModeOf(route) === 'board') return;
      const canvas = document.createElement('canvas');
      // A page reached by the hop's picture hands over to a canvas that is
      // already at full strength: the hop keeps it hidden until the picture has
      // landed, and a fade there would blink the window empty.
      canvas.className = `cp-board__canvas cp-room${left ? '' : ' is-arriving'}`;
      canvas.setAttribute('aria-hidden', 'true');
      host.appendChild(canvas);
      const board = initBoard(canvas, {
        fitBase: 2.8,
        items: () => scene?.items ?? [],
        lanes: () => scene?.lanes ?? [],
      });
      room = { board, canvas, key: null, own: true, lens: { ...IDENTITY } };
      const mode = roomModeOf(route);
      apply(route, mode);
      // Straight into place, then fade in rather than appearing.
      if (mode === 'mini') {
        cancelAnimationFrame(room.anim ?? 0);
        room.anim = 0;
        const lens = boxLens();
        if (lens) setLens(lens);
        // The picture from the site flies into this window and ends on the
        // frame this canvas draws there (landInWindow), so the room takes over
        // from the same pixels instead of the machine jumping to the top.
        if (left) landInWindow(boxRect());
      } else if (left) {
        // The room behind the page is the whole window, where the picture
        // already is: it goes and this one shows.
        sceneInPlace();
      }
      if (!left) requestAnimationFrame(() => requestAnimationFrame(() => canvas.classList.remove('is-arriving')));
    })
    .catch(() => {
      starting = false; // no WebGL: the pages stand on their own
      // The picture from the site is still the machine: it still goes into the
      // window when the page has one, and out of the way at once when it was
      // only to stand behind the page.
      if (left && !landInWindow(boxRect())) sceneInPlace();
    });
}

function currentRoute() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path] = raw.split('?');
  const [name = '', id = ''] = path.split('/');
  return { name: name || 'overview', id: decodeURIComponent(id) };
}
