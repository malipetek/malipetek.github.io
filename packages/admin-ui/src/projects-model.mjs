/**
 * The portal's projects as one list, each with the clients who can file
 * against it. A project with no client is a row like any other, so a project
 * made before anyone was invited is still in reach.
 */

/**
 * @param {{id: string, name?: string, slug?: string}[]} projects
 * @param {{id: string, name?: string|null, email?: string, projectIds?: string[], pending?: boolean}[]} clients
 * @param {{query?: string, scope?: 'all'|'clients'|'none'}} [filter]
 * @returns {{project: object, clients: object[]}[]} sorted by project name.
 */
export function projectRows(projects, clients, { query = '', scope = 'all' } = {}) {
  const byProject = new Map();
  for (const client of clients ?? []) {
    for (const id of client.projectIds ?? []) {
      if (!byProject.has(id)) byProject.set(id, []);
      byProject.get(id).push(client);
    }
  }
  const q = query.trim().toLowerCase();
  return (projects ?? [])
    .map((project) => ({ project, clients: byProject.get(project.id) ?? [] }))
    .filter(({ clients: who }) => (scope === 'clients' ? who.length > 0 : scope === 'none' ? who.length === 0 : true))
    .filter(({ project, clients: who }) => {
      if (!q) return true;
      const text = [project.name, project.slug, ...who.flatMap((c) => [c.name, c.email])].filter(Boolean).join(' ').toLowerCase();
      return text.includes(q);
    })
    .sort((a, b) => String(a.project.name ?? a.project.slug ?? '').localeCompare(String(b.project.name ?? b.project.slug ?? '')));
}

/** `Lena Novak`, `Lena Novak +1`, or `No client` — one cell's worth. */
export function clientsLabel(clients) {
  if (!clients?.length) return 'No client';
  const first = clients[0].name || clients[0].email || 'Client';
  return clients.length === 1 ? first : `${first} +${clients.length - 1}`;
}
