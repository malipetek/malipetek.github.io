/**
 * What the superagent says about a project's client-connected Cloudflare.
 *
 * The portal reads the account with the client's OAuth grant (or a token
 * stored on the project) and answers
 * `{connected, via, connectionId, accountId, connections, pages, workers, target, lapsed}`;
 * each listing is either `{ok: true, items}` or `{ok: false, error, permission}`.
 */

function section(label, listing, line) {
  if (!listing.ok) return `${label}: ${listing.error}${listing.permission ? ` It needs ${listing.permission}.` : ''}`;
  if (!listing.items.length) return `${label}: none.`;
  return `${label}:\n${listing.items.map((item) => `  - ${line(item)}`).join('\n')}`;
}

function grants(connections = [], chosen) {
  if (!connections.length) return 'Client Cloudflare connections: none.';
  return `Client Cloudflare connections:\n${connections
    .map((c) => `  - #${c.id} ${c.email}${c.onProject ? ' (on this project)' : ''}: ${c.accounts.map((a) => `${a.name} ${a.id}`).join(', ')}${c.id === chosen ? ' ← used' : ''}`)
    .join('\n')}`;
}

/**
 * @param {{name: string, slug?: string}} project
 * @param {object} result - the portal's answer.
 * @returns {string}
 */
export function hostingMessage(project, result) {
  const target = result?.target
    ? `Deploy target: Cloudflare ${result.target.kind === 'pages' ? 'Pages project' : 'Worker'} ${result.target.name}, production from ${result.target.productionBranch}${result.target.connectionId ? `, through connection #${result.target.connectionId}` : ''}.`
    : 'Deploy target: not set.';
  const list = grants(result?.connections, result?.connectionId);
  if (!result?.connected) {
    const why = result?.lapsed
      ? `the Cloudflare connection #${result.connectionId} has lapsed; the client reconnects it on the portal's Connections page`
      : 'no client Cloudflare connection fits it (none of its clients connected one, and none is named after it); pass connection with one of the ids below';
    return [`${project.name}: ${why}.`, list, target].join('\n');
  }
  const grant = (result.connections ?? []).find((c) => c.id === result.connectionId);
  return [
    result.via === 'oauth'
      ? `${project.name}: read through ${grant?.email ?? 'a client'}'s Cloudflare connection #${result.connectionId}, account ${result.accountId}${grant && !grant.onProject ? ' (that client is not on this project)' : ''}.`
      : `${project.name}: read with the Cloudflare token stored on the project, account ${result.accountId}.`,
    result.workers ? section('Worker scripts', result.workers, (w) => `${w.name}${w.modifiedOn ? ` (changed ${w.modifiedOn.slice(0, 10)})` : ''}`) : null,
    result.pages ? section('Pages projects', result.pages, (p) => `${p.name}${p.productionBranch ? ` (production branch ${p.productionBranch})` : ''}${p.domains?.length ? ` · ${p.domains.join(', ')}` : ''}`) : null,
    result.domains ? section('What serves each domain', result.domains, (d) => `${d.host}: ${d.kind === 'workers' ? `Worker ${d.name}` : d.kind === 'pages' ? `Pages project ${d.name}` : d.name} (${d.via})`) : null,
    list,
    target,
  ].filter(Boolean).join('\n');
}
