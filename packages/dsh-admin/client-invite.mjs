/**
 * The invite flow's two shapes: the body the superagent's invite action sends,
 * and what it says back after the portal answers.
 *
 * The portal answers `POST /admin/clients` with the account, every project it
 * now has and whether the mail went out. A failed send still leaves the account
 * and the links in place, so the message says so and points at the resend.
 */

/**
 * The body the admin_directory invite action sends to `POST /admin/clients`.
 *
 * The portal only turns mail copies on when `copy === true`, and the UI's
 * add-people flow defaults them on (docs/product/RULES.md rule 5: same
 * endpoint, same defaults), so the tool sends `copy` explicitly: true unless
 * the caller refused it. Name, locale and note stay optional exactly as the
 * UI sends them.
 *
 * @param {{email?: string, clientName?: string, locale?: string, note?: string, copy?: boolean}} args
 * @param {string[]} projectIds - resolved portal project ids.
 * @returns {{email: string, projectIds: string[], copy: boolean}}
 */
export function inviteRequestBody(args, projectIds) {
  const name = typeof args?.clientName === 'string' ? args.clientName.trim() : '';
  const locale = typeof args?.locale === 'string' ? args.locale.trim() : '';
  const note = typeof args?.note === 'string' ? args.note.trim() : '';
  return {
    email: String(args?.email ?? '').trim(),
    projectIds,
    copy: args?.copy !== false,
    ...(name ? { name } : {}),
    ...(locale ? { locale } : {}),
    ...(note ? { note } : {}),
  };
}

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
