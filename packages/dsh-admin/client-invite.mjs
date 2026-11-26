/**
 * What the superagent says back after inviting an address to projects.
 *
 * The portal answers `POST /admin/clients` with the account, every project it
 * now has and whether the mail went out. A failed send still leaves the account
 * and the links in place, so the message says so and points at the resend.
 */

/**
 * @param {{user?: {email?: string, verified_at?: number|null}, projects?: {name: string}[], invite?: {sent?: boolean, expiresAt?: number}}} result
 * @returns {string}
 */
export function inviteMessage(result) {
  const email = result?.user?.email ?? 'The address';
  const projects = (result?.projects ?? []).map((p) => p.name).filter(Boolean);
  const access = projects.length ? `now has ${projects.join(', ')}` : 'is invited';
  const who = result?.user?.verified_at ? 'Existing account' : 'New account, waiting for its first sign-in';
  const days = typeof result?.invite?.expiresAt === 'number'
    ? Math.max(1, Math.round((result.invite.expiresAt - Date.now() / 1000) / 86400))
    : 7;
  const mail = result?.invite?.sent === false
    ? 'The email could not be sent; the access is in place, so resend the invite from the client page.'
    : `The sign-in link was emailed and works for ${days} day${days === 1 ? '' : 's'}.`;
  return `${email} ${access}. ${who}. ${mail}`;
}
