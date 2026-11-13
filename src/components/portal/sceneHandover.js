/*
 * The machine arriving from the homepage (Base.astro, "the machine arrives").
 * The page that receives it draws the homepage's own workshop at the very
 * frame the homepage left on (initWorkshop's `start`), lands the flying
 * snapshot on it, and then does what it likes with its own canvas: the
 * signed-out room keeps the workshop (Guest.jsx), the signed-in board hands
 * over to its own scene (Board.jsx), a page with no board of its own takes it
 * into the room's window (room.js).
 */

/**
 * What the homepage measured as the hop left: the machine's box, the pointer
 * and the clock. Null when the page was not reached by the hop.
 *
 * Read once and spent: one page load carries one machine. The portal's routes
 * remount (the overview unmounts on every hash change), so a value left in
 * sessionStorage would fly the camera in from the homepage every time the
 * board came back. The first page to ask takes it; the rest get null.
 */
let arrival;
export function arrivingBox() {
  if (arrival === undefined) {
    arrival = null;
    try {
      arrival = JSON.parse(sessionStorage.getItem('scene-box') || 'null');
    } catch {
      /* an unreadable measurement is no measurement */
    }
    sessionStorage.removeItem('scene-box');
  }
  const box = arrival;
  arrival = null;
  return box;
}

/** The slow-motion factor the transition durations use (base.css --vt-slow). */
export const slowFactor = () => {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vt-slow'));
  return Number.isFinite(value) && value > 0 ? value : 1;
};

/** The narrowest the machine can be drawn and still be a real frame (px). */
const MIN_LANDING_WIDTH = 40;

/**
 * The page has its own machine at the very pixels the hop's picture holds
 * (the board's own copy of the workshop, the room behind a page): the picture
 * goes at once and the live one takes over, so neither is seen twice.
 */
export function sceneInPlace() {
  const root = document.documentElement;
  if (root.dataset.vtScene !== 'in') return false;
  root.dataset.vtSceneReady = 'same';
  return true;
}

/** One scale-and-translate for the flying machine, and the hop's landing. */
function land(s, tx, ty) {
  const root = document.documentElement;
  root.style.setProperty('--vt-scene-s', String(s));
  root.style.setProperty('--vt-scene-tx', `${tx}px`);
  root.style.setProperty('--vt-scene-ty', `${ty}px`);
  root.dataset.vtSceneReady = '1';
}

/**
 * Land the machine coming from the site on this page's: one scale-and-
 * translate mapping the box the homepage measured onto the box this page's
 * workshop measures. Both are the same scene with the same camera, pointer and
 * clock, so at the same window size the move is nothing at all; it only does
 * work when the window changed on the way. Returns true once there is nothing
 * left to do.
 */
export function placeScene(box, from) {
  const root = document.documentElement;
  if (root.dataset.vtScene !== 'in') return true;
  if (!from) return false;
  // A frame before the canvas has a size projects the machine into a pixel;
  // landing on that shrinks the site's machine to nothing.
  if (!(from.width > 0) || !(box.width >= MIN_LANDING_WIDTH)) return false;
  const s = box.width / from.width;
  const tx = box.x - from.x * s;
  const ty = box.y - from.y * s;
  // Nothing to move (same window): this page's own machine takes over at
  // once. The flying snapshot is a layer above the whole new page, cards
  // included, because the cards mount after the page was captured; the live
  // canvas sits behind them, where the room belongs (base.css).
  const still = Math.abs(s - 1) < 0.01 && Math.abs(tx) < 1 && Math.abs(ty) < 1;
  if (still) return sceneInPlace();
  land(s, tx, ty);
  return true;
}

/**
 * Land the machine in a small window of the arriving page instead of on
 * another machine of its own (the room's box, room.js). The picture is the
 * canvas, which is the whole window, so it goes to the frame the room draws
 * there: the whole picture fitted inside `rect`, its middle in the middle.
 * That is the same lens the room clips to (boxLens), so the live canvas takes
 * over on the very frame the picture ends on.
 */
export function landInWindow(rect) {
  const root = document.documentElement;
  if (root.dataset.vtScene !== 'in') return false;
  if (!(rect?.width >= MIN_LANDING_WIDTH) || !(rect.height > 0)) return false;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const s = Math.min(rect.width / vw, rect.height / vh);
  land(s, rect.left + rect.width / 2 - (vw / 2) * s, rect.top + rect.height / 2 - (vh / 2) * s);
  return true;
}

/**
 * Run `fn` once the flying machine is out of the way: landed in place (this
 * page's canvas has taken over), or the hop over. Returns a cancel function.
 */
export function whenLanded(fn) {
  const root = document.documentElement;
  const landed = () => root.dataset.vtScene !== 'in' || root.dataset.vtSceneReady === 'same';
  if (landed()) {
    fn();
    return () => {};
  }
  const watch = new MutationObserver(() => {
    if (!landed()) return;
    watch.disconnect();
    fn();
  });
  watch.observe(root, { attributes: true, attributeFilter: ['data-vt-scene', 'data-vt-scene-ready'] });
  return () => watch.disconnect();
}
