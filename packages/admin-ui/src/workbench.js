export function projectCreationRequest(input, access) {
  const { name, slug, kind, code, repo, brief, ownerUserId } = input;
  if (access?.superAdmin) return { path: '/admin/projects', body: { name, slug, kind, code, repo, ...(ownerUserId ? { ownerUserId } : {}) } };
  return { path: '/portal/projects', body: { name, kind, brief, repoMode: code === 'folder' ? 'none' : code, ...(code === 'repo' ? { repo } : {}) } };
}

/* Submission gates are synchronous: React state alone cannot stop same-turn input. */
export function createTaskSubmission(send) {
  let busy = false;
  return async (input) => {
    const title = input.title?.trim();
    const brief = input.brief?.trim();
    if (busy || !title || !brief || !input.projectId) return null;
    busy = true;
    try { return await send({ ...input, title, brief, approve: input.approve === true }); }
    finally { busy = false; }
  };
}

export function createProjectSubmission(create, setup = async () => {}, { requireSlug = true } = {}) {
  let busy = false;
  const submit = async (input) => {
    if (busy || !input.name?.trim() || (requireSlug && (typeof input.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.slug))) || (input.code === 'repo' && !input.repo?.trim())) return null;
    busy = true;
    try {
      // Keep the successful receipt before starting local setup: retries reuse it.
      if (!submit.project) submit.project = await create({ ...input, name: input.name.trim() });
      await setup(submit.project, input);
      return submit.project;
    } finally { busy = false; }
  };
  submit.project = null;
  return submit;
}

export function destinationFromHash(hash) {
  const query = new URLSearchParams(hash.replace(/^#/, ''));
  const id = Number(query.get('ticket'));
  if (Number.isInteger(id) && id > 0) return `t:${id}`;
  if (query.get('project')) return `p:${query.get('project')}`;
  if (query.get('client')) return `c:${query.get('client')}`;
  return null;
}

export function workbenchAllowed(key, access) {
  if (access?.superAdmin) return true;
  return ['inbox', 'board', 'list'].includes(key) || key.startsWith('p:') || key.startsWith('t:');
}
