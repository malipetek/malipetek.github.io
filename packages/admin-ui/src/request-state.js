import { mergeSteps } from './run-evidence.js';

export function createStepRequest(api, runId, publish) {
  let state = {steps:null,error:null}, after = 0, generation = 0, inflight = null;
  return {
    invalidate() { generation++; inflight = null; },
    pull() {
      if (inflight) return inflight;
      const token = ++generation;
      inflight = (async () => {
        try {
          const data = await api('GET', `/admin/runs/${runId}/steps?after=${after}`);
          if (token !== generation) return;
          state = {steps:mergeSteps(state.steps ?? [], data?.steps ?? []), error:null};
          after = Math.max(after, ...state.steps.map(step => step.seq));
          publish(state);
          return data;
        } catch (error) {
          if (token === generation) { state = {...state,error}; publish(state); }
        } finally { if (token === generation) inflight = null; }
      })();
      return inflight;
    },
  };
}

export const emptyTicket = (id = null) => ({ id, loading: true, refreshing: false, stale: false, fetchedAt: 0, error: null, ticket: null, messages: [], runs: [], review: null, screenshots: [], land: null });

/** Latest requested identity wins, including two refreshes of the same ticket. */
export function createTicketRequest(api, publish) {
  let state = emptyTicket(), generation = 0;
  const update = (next) => { state = next; publish(next); };
  return {
    invalidate() { generation++; },
    async load(id) {
      const token = ++generation;
      const same = String(state.id) === String(id);
      update({ ...(same ? state : emptyTicket(id)), loading: !same || !state.ticket, refreshing: true });
      try {
        const data = await api('GET', `/admin/tickets/${id}`);
        if (token !== generation) return;
        update({ ...emptyTicket(id), ...data, id, loading: false, refreshing: false, stale: false, fetchedAt: Date.now(), error: null });
      } catch (error) {
        if (token === generation) update({ ...state, loading: false, refreshing: false, stale: Boolean(state.ticket), error });
      }
    },
  };
}

/** Resolve authority before any global request is issued. Identity failure fails closed. */
export async function workbenchRequests(api) {
  const identity = await api('GET', '/portal/me');
  const legacyAdmin = identity?.user?.role === 'admin';
  const access = identity?.access ?? { superAdmin: legacyAdmin, canUseWorkbench: legacyAdmin, developerProjectIds: [] };
  if (!access.canUseWorkbench && !access.superAdmin) throw new Error('Workbench access is unavailable.');
  // Runs are project-scoped for a trusted developer; fleet and directory data are not.
  const paths = ['/admin/tickets', '/admin/projects', '/admin/runs'];
  if (access.superAdmin) paths.push('/admin/clients', '/admin/nodes', '/admin/queue', '/admin/settings');
  const results = await Promise.allSettled(paths.map(path => api('GET', path)));
  return { access, identity, results: Object.fromEntries(paths.map((path, i) => [path, results[i]])) };
}
