/*
 * The project picker's list: projects grouped under the client they belong
 * to, the ticket's own client first, projects with no client last, narrowed
 * by a search over project name, slug and client. A project shared by several
 * clients is listed once, under the first group it falls in, with a hint
 * naming how many other clients share it. Pure, so it is tested on its own.
 */

const norm = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const clientLabel = (client) => client?.name || client?.email || 'Unnamed client';

/**
 * @param projects - `{ id, name, slug, clients: [{ id, email, name }] }[]`
 * @param options - `{ query, clientEmail }`: the search text, and the ticket's client
 * @returns `[{ key, label, own, items: [{ id, name, slug, hint }] }]`
 */
export function groupProjects(projects = [], { query = '', clientEmail = null } = {}) {
  const q = norm(query);
  const own = norm(clientEmail);
  const groups = new Map();
  const add = (key, label, isOwn) => {
    if (!groups.has(key)) groups.set(key, { key, label, own: isOwn, items: [] });
    return groups.get(key);
  };
  const ordered = [...projects].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
  for (const project of ordered) {
    const clients = Array.isArray(project.clients) ? project.clients.filter(Boolean) : [];
    const haystack = [project.name, project.slug, ...clients.flatMap((c) => [c.email, c.name])].map(norm).join(' ');
    if (q && !q.split(/\s+/).every((word) => haystack.includes(word))) continue;
    const mine = clients.find((c) => own && norm(c.email) === own);
    const first = mine ?? [...clients].sort((a, b) => clientLabel(a).localeCompare(clientLabel(b)))[0];
    const others = clients.length - (first ? 1 : 0);
    const item = { id: project.id, name: project.name || project.slug || 'Untitled project', slug: project.slug ?? null, hint: others > 0 ? `+${others} client${others === 1 ? '' : 's'}` : null };
    if (!first) add('none', 'No client', false).items.push(item);
    else add(`c:${norm(first.email) || first.id}`, clientLabel(first), Boolean(mine)).items.push(item);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.own !== b.own) return a.own ? -1 : 1;
    if ((a.key === 'none') !== (b.key === 'none')) return a.key === 'none' ? 1 : -1;
    return a.label.localeCompare(b.label);
  });
}

/** The groups' items in display order, for keyboard movement. */
export const flatItems = (groups) => groups.flatMap((g) => g.items);
