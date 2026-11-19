/*
 * Data for the workbench. Everything comes through `api(method, path, body)`,
 * which each host supplies: the web page calls the Worker with the portal
 * session; the Harness routes it through its Host half.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createTicketRequest, emptyTicket, workbenchRequests } from './request-state.js';

export const AdminContext = createContext(null);
export const useAdmin = () => useContext(AdminContext);

const EMPTY = {
  loaded: false,
  error: null,
  fetchedAt: 0,
  tickets: [],
  projects: [],
  clients: [],
  usageTotal: null,
  nodes: [],
  queue: [],
  running: [],
  recent: [],
  settings: null,
  catalog: null,
};

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

/** Re-run `fn` every `ms` while the page is visible. */
export function usePoll(fn, ms, deps = []) {
  useEffect(() => {
    const id = setInterval(() => visible() && fn(), ms);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** The whole board: tickets, directory, fleet and settings, kept fresh. */
export function useAdminData(api) {
  const [data, setData] = useState(EMPTY);
  const inflight = useRef(null);

  const load = useCallback(() => {
    if (inflight.current) return inflight.current;
    inflight.current = workbenchRequests(api)
      .then(({access, identity, results}) => {
        const get = path => results[path];
        const v = (path, fallback) => get(path)?.status === 'fulfilled' ? get(path).value : fallback;
        const failed = Object.values(results).find(r => r.status === 'rejected');
        setData(previous => {
          // Cached project data belongs to the resolved principal and scope only.
          const scope = value => JSON.stringify([value?.user?.id, value?.access?.superAdmin, [...(value?.access?.developerProjectIds ?? [])].sort()]);
          const prev = scope(previous.identity) === scope(identity) ? previous : EMPTY;
          return ({
          ...EMPTY, loaded: true, access, identity, user: identity.user, error: failed?.reason ?? null,
          fetchedAt: failed ? prev.fetchedAt : Date.now(),
          tickets: v('/admin/tickets', {tickets:prev.tickets}).tickets ?? [],
          projects: v('/admin/projects', {projects:prev.projects}).projects ?? [],
          running: v('/admin/runs', {running:prev.running}).running ?? [],
          recent: v('/admin/runs', {recent:prev.recent}).recent ?? [],
          ...(access.superAdmin ? {
            clients: v('/admin/clients', {clients:prev.clients}).clients ?? [],
            usageTotal: v('/admin/clients', {total:prev.usageTotal}).total ?? null,
            nodes: v('/admin/nodes', {nodes:prev.nodes}).nodes ?? [],
            queue: v('/admin/queue', {queue:prev.queue}).queue ?? [],
            settings: v('/admin/settings', {settings:prev.settings}).settings ?? null,
            catalog: v('/admin/settings', {catalog:prev.catalog}).catalog ?? null,
          } : {}),
          });
        });
      })
      .catch(error => setData({...EMPTY, loaded:true, error, access:{superAdmin:false,canUseWorkbench:false,developerProjectIds:[]}}))
      .finally(() => {
        inflight.current = null;
      });
    return inflight.current;
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);
  usePoll(load, 15_000, [load]);
  return [data, load];
}

/** One ticket with its thread and runs; refreshed while an agent works on it. */
export function useTicket(api, id) {
  const [state, setState] = useState(() => ({...emptyTicket(id), source:api}));
  const request = useMemo(() => createTicketRequest(api, next => setState({...next,source:api})), [api]);
  const load = useCallback(() => request.load(id), [request, id]);
  useEffect(() => {
    void load();
    return () => request.invalidate();
  }, [load, request]);
  // Hide the old identity during render, before the navigation effect runs.
  const current = state.source === api && String(state.id) === String(id) ? state : emptyTicket(id);
  const live = current.ticket?.status === 'in_progress' || current.runs.some(r => r.status === 'running');
  usePoll(load, live ? 5_000 : 20_000, [load, live]);
  return [current, load];
}

/*
 * The time meter. Price is Ali's time by the second, so a second counts only
 * while this ticket is the active tab, the page is visible and focused, and
 * something was touched in the last minute. Seconds are sent every 20s.
 */
const IDLE_AFTER_MS = 60_000;
let lastInput = Date.now();
if (typeof window !== 'undefined') {
  for (const type of ['pointermove', 'keydown', 'scroll', 'pointerdown']) {
    window.addEventListener(type, () => (lastInput = Date.now()), { passive: true, capture: true });
  }
}

export function useMeter(api, ticket, active) {
  const open = Boolean(ticket) && ticket.status !== 'done' && ticket.status !== 'declined';
  const [seconds, setSeconds] = useState(ticket?.human_seconds ?? 0);
  const [running, setRunning] = useState(false);
  const pending = useRef(0);
  const id = ticket?.id;
  const conversationMeter = api.conversationMeter === true;

  useEffect(() => setSeconds(ticket?.human_seconds ?? 0), [id, ticket?.human_seconds]);

  useEffect(() => {
    // The desktop header has the only writer lease. Keep Workbench read-only.
    if (!id || conversationMeter) return undefined;
    const flush = () => {
      const n = pending.current;
      if (n <= 0) return;
      pending.current = 0;
      api('POST', `/admin/tickets/${id}/time`, { seconds: n }).catch(() => (pending.current += n));
    };
    const tick = setInterval(() => {
      const on = open && active && visible() && document.hasFocus() && Date.now() - lastInput < IDLE_AFTER_MS;
      setRunning(on);
      if (!on) return;
      pending.current += 1;
      setSeconds((s) => s + 1);
      if (pending.current >= 20) flush();
    }, 1000);
    return () => {
      clearInterval(tick);
      flush();
    };
  }, [api, id, open, active]);

  return { seconds, running, open };
}
