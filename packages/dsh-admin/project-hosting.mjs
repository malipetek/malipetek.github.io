/**
 * What the superagent says about a project's client-connected Cloudflare.
 *
 * The portal reads the account with the client's stored token and answers
 * `{connected, accountId, pages, workers, target}`; each listing is either
 * `{ok: true, items}` or `{ok: false, error, permission}`.
 */

function section(label, listing, line) {
  if (!listing) return `${label}: not read.`;
  if (!listing.ok) return `${label}: ${listing.error}${listing.permission ? ` The token needs ${listing.permission}.` : ''}`;
  if (!listing.items.length) return `${label}: none.`;
  return `${label}:\n${listing.items.map((item) => `  - ${line(item)}`).join('\n')}`;
}

/**
 * @param {{name: string, slug?: string}} project
 * @param {object} result - the portal's answer.
 * @returns {string}
 */
export function hostingMessage(project, result) {
  const target = result?.target
    ? `Deploy target: Cloudflare ${result.target.kind === 'pages' ? 'Pages project' : 'Worker'} ${result.target.name}, production from ${result.target.productionBranch}.`
    : 'Deploy target: not set.';
  if (!result?.connected) {
    return `${project.name} has no Cloudflare connected: the client has not stored an account id and API token on the project. ${target}`;
  }
  return [
    `${project.name} — client Cloudflare account ${result.accountId}.`,
    section('Pages projects', result.pages, (p) => `${p.name}${p.productionBranch ? ` (production branch ${p.productionBranch})` : ''}${p.domains?.length ? ` · ${p.domains.join(', ')}` : ''}`),
    section('Worker scripts', result.workers, (w) => `${w.name}${w.modifiedOn ? ` (changed ${w.modifiedOn.slice(0, 10)})` : ''}`),
    target,
  ].join('\n');
}
