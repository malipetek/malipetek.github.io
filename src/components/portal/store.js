/*
 * The client portal's data and routing. One fetch of /portal/me and
 * /portal/tickets feeds every view; mutations call `reload` afterwards.
 * Routes live in the hash (#/ticket/12), so the page stays one static shell.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { api, session } from '../../lib/portal';
import { englishT } from '../../i18n/index.js';

export const PortalContext = createContext(null);
export const usePortal = () => useContext(PortalContext);
/** The reader's t(key, vars): their language, English until it has loaded. */
export const useT = () => useContext(PortalContext)?.t ?? englishT;

const OPEN = new Set(['new', 'approved', 'in_progress', 'review']);
export const isOpen = (t) => OPEN.has(t.status);
/** Moving through the machine right now: worth checking on more often. */
const MOVING = new Set(['approved', 'in_progress', 'review']);

const EMPTY = { loaded: false, user: null, projects: [], lanes: [], tickets: [], usage: null, canPublish: false, error: null };

export function usePortalData(enabled) {
  const [data, setData] = useState(EMPTY);
  const busy = useRef(false);

  const reload = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const [me, { tickets }] = await Promise.all([api('/portal/me'), api('/portal/tickets')]);
      setData({ loaded: true, user: me.user, projects: me.projects, lanes: me.lanes ?? [], usage: me.usage, canPublish: me.canPublish, tickets, error: null });
    } catch (error) {
      setData((d) => ({ ...d, loaded: true, error }));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  // Every 10s while something is moving or a site is being made, 30s otherwise.
  const moving = data.tickets.some((t) => MOVING.has(t.status));
  const making = data.projects.filter((p) => p.site && p.site.state !== 'ready' && p.site.state !== 'failed');
  useEffect(() => {
    if (!enabled || !data.loaded || data.error) return undefined;
    const every = moving || making.length ? 10_000 : 30_000;
    const id = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      // Asking about a site that is on its way moves it forward.
      await Promise.all(making.map((p) => api(`/portal/projects/${p.id}/site`).catch(() => null)));
      void reload();
    }, every);
    return () => clearInterval(id);
  }, [enabled, data.loaded, data.error, moving, making.map((p) => p.id).join(), reload]);

  return [data, reload];
}

/** The route from the hash: { name, id, query }. */
function parse() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const [name = '', id = ''] = path.split('/');
  return { name: name || 'overview', id: decodeURIComponent(id), query: new URLSearchParams(qs ?? '') };
}

/* The route last shown, so a page can know where it was navigated from. */
let lastRoute = parse();

export function useRoute() {
  const [route, setRoute] = useState(lastRoute);
  useEffect(() => {
    const on = () => {
      const next = parse();
      const prev = lastRoute;
      boardReturn.from = prev;
      lastRoute = next;
      const apply = () => {
        setRoute(next);
        document.querySelector('.cp-main')?.scrollTo({ top: 0 });
      };
      // The page change rides the View Transitions API when it can: a cross-fade
      // everywhere, and named elements (the board's peek card) morph into place.
      if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const zoom = zoomFor(prev, next);
        const root = document.documentElement;
        // Nothing an earlier zoom left may survive into this one, whether it
        // ended or was replaced half way.
        clearZoom(root);
        // A second change while one is running replaces it; only the newest
        // may clear the state the other is still animating with.
        const mine = ++generation;
        // Opening a request from its board card moves the page like a camera
        // into the card while the card grows into the request's head; going
        // back to the board moves it out again, into the reopened card. The
        // head is measured on whichever side has it: now on the way out, after
        // the update on the way in.
        // Into or out of the small window: the room morphs between the whole
        // window and the box (client-portal.css, "cp-room").
        const from = roomModeOf(prev);
        const to = roomModeOf(next);
        if (from !== to && (from === 'mini' || to === 'mini')) root.dataset.roomMorph = '';
        if (zoom) {
          root.dataset.cpNav = `zoom-${zoom.way}`;
          if (zoom.way === 'out') setCamera(root, zoom.card, headBox(zoom.head));
        }
        // The zoom in, for the board that stays behind the request as its
        // backdrop (Board.jsx): it ends on the frame the page zoom ends on.
        boardReturn.zoomCam = null;
        const update = () => {
          flushSync(apply);
          if (zoom?.way === 'in' && mine === generation) {
            boardReturn.zoomCam = setCamera(root, zoom.card, headBox(zoom.head));
            boardReturn.onZoomCam?.(boardReturn.zoomCam);
          }
        };
        let ride;
        try {
          ride = document.startViewTransition(update);
        } catch {
          // A browser that will not start one (busy, or a document that is
          // going away) must still get the page it asked for.
          clearZoom(root);
          current = null;
          apply();
          return;
        }
        const settle = () => {
          if (mine !== generation) return;
          current = null;
          clearZoom(root);
        };
        const slow = slowFactor();
        current = { finished: ride.finished, slow };
        // Chrome abandons a transition it replaces, and an abandoned one does
        // not always settle: the page must not keep the zoom state, or a view
        // waiting to act after it, for a transition that will never report back.
        const guard = setTimeout(settle, WATCHDOG * slow);
        ride.finished.then(
          () => {
            clearTimeout(guard);
            settle();
          },
          () => {
            clearTimeout(guard);
            settle();
          },
        );
        // Expected when one change replaces another; nothing awaits either.
        ride.ready?.catch(() => {});
        ride.updateCallbackDone?.catch(() => {});
      } else {
        apply();
      }
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/* The camera a zoom moves along (client-portal.css, "cp-zoom-*"): the
   card's and the head's top-left corners in window (v) and content (m)
   coordinates, the move between them and the scale. Cleared with the
   attribute that uses them. */
const ZOOM_PROPS = [
  '--cp-zoom-vx', '--cp-zoom-vy', '--cp-zoom-mx', '--cp-zoom-my',
  '--cp-zoom-hvx', '--cp-zoom-hvy', '--cp-zoom-hmx', '--cp-zoom-hmy',
  '--cp-zoom-dx', '--cp-zoom-dy', '--cp-zoom-s', '--cp-zoom-is',
];
/** The camera's scale stays in this range, whatever the two boxes measure. */
const ZOOM_SCALE = [1.2, 3];

/** The page head's box, the card's other end (a request's or a project's). */
const headBox = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null;

/**
 * The move that carries the card's box onto the head's: the whole page and
 * the room ride it, so they travel with the card as one piece instead of
 * scaling in place around it. Without a head it is a plain push into the card.
 * Returns the same move in window pixels ({ cx, cy, hx, hy, s }).
 */
function setCamera(root, card, head) {
  const main = document.querySelector('.cp-main')?.getBoundingClientRect();
  const ml = main?.left ?? 0;
  const mt = main?.top ?? 0;
  const [lo, hi] = ZOOM_SCALE;
  const s = head ? Math.min(hi, Math.max(lo, head.width / card.width)) : 1.6;
  const h = head ?? card;
  const px = (name, value) => root.style.setProperty(name, `${value}px`);
  px('--cp-zoom-vx', card.left);
  px('--cp-zoom-vy', card.top);
  px('--cp-zoom-mx', card.left - ml);
  px('--cp-zoom-my', card.top - mt);
  px('--cp-zoom-hvx', h.left);
  px('--cp-zoom-hvy', h.top);
  px('--cp-zoom-hmx', h.left - ml);
  px('--cp-zoom-hmy', h.top - mt);
  px('--cp-zoom-dx', h.left - card.left);
  px('--cp-zoom-dy', h.top - card.top);
  root.style.setProperty('--cp-zoom-s', String(s));
  root.style.setProperty('--cp-zoom-is', String(1 / s));
  return { cx: card.left, cy: card.top, hx: h.left, hy: h.top, s };
}
/** How long a transition may take to report back, at --vt-slow 1 (ms). */
const WATCHDOG = 2200;

const clearZoom = (root) => {
  delete root.dataset.cpNav;
  delete root.dataset.roomMorph;
  for (const name of ZOOM_PROPS) root.style.removeProperty(name);
};

/** The slow-motion factor the transition durations use (base.css). */
const slowFactor = () => {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vt-slow'));
  return Number.isFinite(value) && value > 0 ? value : 1;
};

const once = (fn) => {
  let run = false;
  return () => {
    if (run) return;
    run = true;
    fn();
  };
};

/* The route change being animated, so a view can act once it has ended. A
   newer one bumps `generation`: the older run is then only a fallback. */
let current = null;
let generation = 0;

/**
 * Run `fn` when the route change in flight has ended, or when its watchdog
 * says it never will. Calls before any transition run at once.
 */
export const afterTransition = (fn) => {
  if (!current) return fn();
  const run = once(fn);
  const guard = setTimeout(run, WATCHDOG * current.slow);
  current.finished.then(
    () => {
      clearTimeout(guard);
      run();
    },
    () => {
      clearTimeout(guard);
      run();
    },
  );
};

/**
 * A zoom between the board and a request: in, when the request is opened
 * from its peek card; out, when the board is reached back from a request that
 * was opened that way (the board reopens the card, see Board.jsx).
 */
function zoomFor(prev, next) {
  if (next.name === 'ticket' && boardReturn.peek !== null && String(boardReturn.peek) === next.id && boardReturn.peekAt) {
    return { way: 'in', card: boardReturn.peekAt.box, head: '.cp-ticket__head' };
  }
  // A project opened from its sheet: the sheet is the card, the project
  // page's head the other end (views.jsx names both cp-project).
  if (next.name === 'project' && boardReturn.sheet !== null && String(boardReturn.sheet) === next.id) {
    const r = document.querySelector('.cp-modal')?.getBoundingClientRect();
    if (r) return { way: 'in', card: { left: r.left, top: r.top, width: r.width }, head: '.cp-main .cp-head' };
  }
  const r = boardReturn.reopen;
  if (next.name === 'overview' && prev.name === 'ticket' && r && String(r.id) === prev.id) {
    return { way: 'out', card: r.box, head: '.cp-ticket__head' };
  }
  return null;
}

/**
 * What the 3D room is on a page (room.js): the board itself on the overview,
 * the backdrop behind a request or a project, a small window anywhere else.
 */
export const roomModeOf = (route) =>
  route.name === 'overview' ? 'board' : route.name === 'ticket' || route.name === 'project' ? 'backdrop' : 'mini';

export const go = (path) => {
  window.location.hash = `#/${path}`;
};
export const href = (path) => `#/${path}`;

/**
 * Navigation memory shared across views:
 * - ticket: the request being read right now; the board starts the camera on
 *   it and glides back out when the overview is next shown. Consumed once.
 * - from: the route the current page was navigated from, for its back button.
 * - peek: the request whose board card was opened, so the card can morph into
 *   the request page under a view transition. Consumed once.
 * - peekAt: where that card was on screen ({ transform, box }), so the
 *   page can zoom into it and the board can put it back.
 * - reopen: the request opened from its card ({ id, transform, box }); the
 *   board reopens the card when it is reached back from that request, so the
 *   head can shrink back into it.
 * - sheet: the project whose sheet was opened, so the sheet can morph into
 *   the project page under a view transition. Consumed once.
 * - zoomCam: the zoom into a request, in window pixels, once it is measured;
 *   onZoomCam, if set, is called with it (the board kept as the backdrop).
 */
export const boardReturn = { ticket: null, from: null, peek: null, peekAt: null, reopen: null, sheet: null, zoomCam: null, onZoomCam: null };

export const signedIn = () => Boolean(session.get());
