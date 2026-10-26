/*
 * Data for the workbench. Everything comes through `api(method, path, body)`,
 * which each host supplies: the web page calls the Worker with the portal
 * session; the Harness routes it through its Host half.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

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
    const get = (path) => api('GET', path);
    inflight.current = Promise.allSettled([
      get('/admin/tickets'),
      get('/admin/projects'),
      get('/admin/clients'),
      get('/admin/nodes'),
      get('/admin/queue'),
      get('/admin/runs'),
      get('/admin/settings'),
    ])
      .then(([tickets, projects, clients, nodes, queue, runs, settings]) => {
        const v = (r, fallback) => (r.status === 'fulfilled' ? r.value : fallback);
        const failed = [tickets, projects].find((r) => r.status === 'rejected');
        setData((prev) => ({
          loaded: true,
          error: failed ? failed.reason : null,
          fetchedAt: Date.now(),
          tickets: v(tickets, { tickets: prev.tickets }).tickets ?? [],
          projects: v(projects, { projects: prev.projects }).projects ?? [],
          clients: v(clients, { clients: prev.clients }).clients ?? [],
          usageTotal: v(clients, { total: prev.usageTotal }).total ?? null,
          nodes: v(nodes, { nodes: prev.nodes }).nodes ?? [],
          queue: v(queue, { queue: prev.queue }).queue ?? [],
          running: v(runs, { running: prev.running }).running ?? [],
          recent: v(runs, { recent: prev.recent }).recent ?? [],
          settings: v(settings, { settings: prev.settings }).settings ?? null,
          catalog: v(settings, { catalog: prev.catalog }).catalog ?? null,
        }));
      })
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
  const [state, setState] = useState({ loading: true, error: null, ticket: null, messages: [], runs: [], land: null });
  const load = useCallback(
    () =>
      api('GET', `/admin/tickets/${id}`)
        .then((d) => setState({ loading: false, error: null, ticket: d.ticket, messages: d.messages ?? [], runs: d.runs ?? [], land: d.land ?? null }))
        .catch((error) => setState((s) => ({ ...s, loading: false, error }))),
    [api, id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const live = state.ticket?.status === 'in_progress' || state.runs.some((r) => r.status === 'running');
  usePoll(load, live ? 5_000 : 20_000, [load, live]);
  return [state, load];
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

  useEffect(() => setSeconds(ticket?.human_seconds ?? 0), [id, ticket?.human_seconds]);

  useEffect(() => {
    if (!id) return undefined;
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
