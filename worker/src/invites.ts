/*
 * Invitations: Ali adds a client to one or more existing projects before that
 * person has ever signed in. The token is an ordinary login token with
 * purpose 'invite' and a week to live; the mail is the only place the raw
 * token appears, and the copy lives with every other mail string.
 */
import { tFor } from '../../src/i18n/eager.js';

/** An invite link works once, for a week. A sign-in link lasts 15 minutes. */
export const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** "Acme" / "Acme and Beta" / "Acme, Beta and Gamma": how mail names projects. */
export function joinProjectNames(names: readonly string[]): string {
  const list = names.map((name) => String(name ?? '').trim()).filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

export interface InviteMailInput {
  /** The admin's name, as the client knows him. */
  name: string;
  /** The project or projects, already joined for the sentence. */
  project: string;
  link: string;
  /** An account that has signed in before: "you've been added to …". */
  added: boolean;
  /** Ali's own words, if he wrote any. Never translated. */
  note?: string | null;
}

/** The invite email in the language the account reads. Plain, short, no em dashes. */
export function inviteMail(locale: string | null | undefined, input: InviteMailInput): { subject: string; text: string } {
  const tr = tFor(locale);
  const key = input.added ? 'mail.invite.added' : 'mail.invite';
  const variables = { name: input.name, project: input.project, link: input.link };
  const note = input.note?.trim();
  return {
    subject: tr(`${key}.subject`, variables),
    text: note ? `${tr(`${key}.body`, variables)}\n\n${note}` : tr(`${key}.body`, variables),
  };
}
