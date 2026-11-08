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

/* The old ticket address (/portal/ticket#id=12), the one in earlier emails,
   becomes #/ticket/12 before the first route is read — otherwise the app would
   show the overview for it. */
if (window.location.pathname.replace(/\/$/, '') === '/portal/ticket') {
  const id = new URLSearchParams(window.location.hash.slice(1)).get('id');
  window.history.replaceState(null, '', `/portal${id ? `#/ticket/${id}` : ''}`);
}

/* The route last shown, so a page can know where it was navigated from. */
let lastRoute = parse();

/* How deep a page sits, so a move in or out of it can be read as one. The
   overview is the room; a list or a project is one door in; a request is the
   leaf you open from either. */
const DEPTH = { overview: 0, requests: 1, billing: 1, connections: 1, project: 1, ticket: 2 };
const direction = (from, to) => {
  const fromDepth = DEPTH[from.name] ?? 0;
  const toDepth = DEPTH[to.name] ?? 0;
  return toDepth > fromDepth ? 'in' : toDepth < fromDepth ? 'out' : 'side';
};

/* Where the reader was in each page, kept for the session. Going back to a page
   returns to the line they left, instead of the top of a long list. */
const scrollMemory = new Map();
const routeKey = (route) => `${route.name}${route.id ? `/${route.id}` : ''}`;
const mainEl = () => document.querySelector('.cp-main');
/* Set the offset instantly: the route change must not animate the page under
   the snapshot the transition is about to take. */
const jump = (main, top) => {
  const previous = main.style.scrollBehavior;
  main.style.scrollBehavior = 'auto';
  main.scrollTop = top;
  main.style.scrollBehavior = previous;
};

/* Newer navigation wins: a fast second click must not clear the direction the
   running transition is still using. */
let navSeq = 0;

export function useRoute() {
  const [route, setRoute] = useState(lastRoute);
  useEffect(() => {
    const on = () => {
      const next = parse();
      const dir = direction(lastRoute, next);
      const scroller = mainEl();
      if (scroller) scrollMemory.set(routeKey(lastRoute), scroller.scrollTop);
      boardReturn.from = lastRoute;
      lastRoute = next;
      const apply = () => {
        setRoute(next);
        const main = mainEl();
        if (!main) return;
        // Back returns to where that page was read; a step in starts at its top.
        jump(main, (dir === 'out' ? scrollMemory.get(routeKey(next)) : 0) ?? 0);
      };
      // The page change rides the View Transitions API when it can: the chrome
      // and the room stay put, the content moves in the direction of travel,
      // and named elements (the board's peek card) morph into place.
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!document.startViewTransition || reduced) {
        apply();
        return;
      }
      const root = document.documentElement;
      const seq = ++navSeq;
      // A card that morphs into the page carries the move by itself; the rest
      // of the content only fades in behind it.
      const morph = boardReturn.peek !== null || boardReturn.sheet !== null;
      root.dataset.cpNav = morph ? 'morph' : dir;
      const settle = () => {
        if (seq === navSeq) delete root.dataset.cpNav;
      };
      try {
        document.startViewTransition(() => flushSync(apply)).finished.then(settle, settle);
      } catch {
        settle();
        apply();
      }
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

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
 * - sheet: the project whose sheet was opened, so the sheet can morph into
 *   the project page under a view transition. Consumed once.
 */
export const boardReturn = { ticket: null, from: null, peek: null, sheet: null };

export const signedIn = () => Boolean(session.get());
