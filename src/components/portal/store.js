/*
 * The client portal's data and routing. One fetch of /portal/me and
 * /portal/tickets feeds every view; mutations call `reload` afterwards.
 * Routes live in the hash (#/ticket/12), so the page stays one static shell.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, session } from '../../lib/portal';

export const PortalContext = createContext(null);
export const usePortal = () => useContext(PortalContext);

const OPEN = new Set(['new', 'approved', 'in_progress', 'review']);
export const isOpen = (t) => OPEN.has(t.status);
/** Moving through the machine right now: worth checking on more often. */
const MOVING = new Set(['approved', 'in_progress', 'review']);

const EMPTY = { loaded: false, user: null, projects: [], tickets: [], usage: null, canPublish: false, error: null };

export function usePortalData(enabled) {
  const [data, setData] = useState(EMPTY);
  const busy = useRef(false);

  const reload = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const [me, { tickets }] = await Promise.all([api('/portal/me'), api('/portal/tickets')]);
      setData({ loaded: true, user: me.user, projects: me.projects, usage: me.usage, canPublish: me.canPublish, tickets, error: null });
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

export function useRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => {
      setRoute(parse());
      document.querySelector('.cp-main')?.scrollTo({ top: 0 });
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

export const signedIn = () => Boolean(session.get());
