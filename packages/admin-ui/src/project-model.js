/* Pure project state. No host, browser or secret reads happen on import. */
export function briefPayload(raw = {}, kind = 'existing') {
  const answer = value => typeof value === 'string' ? value.trim() : '';
  const what = answer(raw.what), goal = answer(raw.goal);
  const key = kind === 'new' ? 'manual' : 'where';
  const optional = answer(raw[key]);
  if (!what || !goal || [what, goal, optional].some(value => value.length > 1200)) return null;
  return {what, goal, ...(optional ? {[key]: optional} : {})};
}

/** Only credential-free HTTP destinations become browser links. */
export function resourceUrl(value) {
  if (typeof value !== 'string') return null;
  const ssh = /^git@([^:]+):(.+)$/.exec(value);
  const normalized = ssh ? `https://${ssh[1]}/${ssh[2]}` : value;
  try {
    const url = new URL(normalized);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href.replace(/\.git\/?$/, '');
  } catch { return null; }
}

export function projectTopology(project = {}, local, git) {
  const exists = local?.exists ?? local?.found;
  const isGit = local?.isGit ?? git?.isGit ?? (git ? Boolean(git.head || git.branch) : null);
  return {
    local: !local ? 'Not inspected on this device' : !local.path ? 'Not connected on this device' : !exists ? `Folder not found: ${local.path}` : `${local.path}${isGit === false ? ' · not a Git checkout' : ''}`,
    repoUrl: resourceUrl(project.repo),
    branch: git?.head || git?.branch ? [git.branch || 'Detached HEAD', git.head?.slice(0, 8), git.dirty ? 'uncommitted changes' : 'clean'].filter(Boolean).join(' · ') : 'Not inspected',
    sites: (project.sites ?? (project.site ? [project.site] : [])).map(site => ({
      ...site,
      previewUrl: resourceUrl(site.previewUrl),
      productionUrl: resourceUrl(site.productionUrl),
      deployment: !site.previewDeploy || !site.productionDeploy ? 'Deployment state unknown' : site.previewDeploy === 'placeholder' ? 'Preview is a placeholder' : site.previewDeploy === site.productionDeploy ? 'Production matches preview' : 'Preview differs from production',
    })),
  };
}

/**
 * The one ticket selector every list uses. `includeSystem` keeps the
 * operator's own system work (content, SEO, guide cycles) in — only the
 * world map counts it; the work lists never show it.
 */
export function projectTickets(tickets = [], projectId, { includeSystem = false } = {}) {
  if (projectId === null || projectId === undefined) return [];
  return tickets.filter(ticket =>
    ticket && ticket.project_id != null
    && String(ticket.project_id) === String(projectId)
    && (includeSystem || ticket.kind !== 'system'));
}

export function projectWork(tickets = [], projectId, options) {
  const closed = ticket => ['done', 'declined'].includes(ticket.status);
  return projectTickets(tickets, projectId, options)
    .sort((a, b) => closed(a) - closed(b) || (b.updated_at ?? 0) - (a.updated_at ?? 0));
}

/** Latest response wins; cached same-project data survives a failed refresh. */
export function createProjectResource(load, publish) {
  let generation = 0, disposed = false;
  let state = {value:null, loading:true, refreshing:false, error:null, fetchedAt:null};
  return {
    async refresh() {
      const request = ++generation;
      state = {...state, loading:state.value === null, refreshing:true, error:null};
      publish(state);
      try {
        const value = await load();
        if (disposed || request !== generation) return;
        state = {value, loading:false, refreshing:false, error:null, fetchedAt:Date.now()};
      } catch (error) {
        if (disposed || request !== generation) return;
        state = {...state, loading:false, refreshing:false, error};
      }
      publish(state);
    },
    dispose() { disposed = true; ++generation; },
  };
}

/** Lock before the first await, including keyboard and double-click submissions. */
export function singleFlight(fn) {
  let pending = null;
  return (...args) => {
    if (pending) return pending;
    // Invoke synchronously so its first side effect is covered by the same lock.
    let resolve, reject;
    pending = new Promise((yes, no) => {resolve = yes; reject = no;});
    const result = pending;
    try { Promise.resolve(fn(...args)).then(resolve, reject); } catch(error) { reject(error); }
    result.then(() => {pending = null;}, () => {pending = null;});
    return result;
  };
}
