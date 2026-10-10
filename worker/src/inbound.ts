/*
 * Inbound mail (Cloudflare Email Routing → this Worker).
 *
 * Two doors:
 *   reply+<ticket>.<c|a>.<sig>@…  a reply to a ticket email. The sig must match
 *                                 (HMAC, see portal.ts) AND the envelope sender
 *                                 must be the ticket's client (c) or ADMIN_EMAIL
 *                                 (a). Posts into the thread and notifies the
 *                                 other side, exactly like the portal UI does.
 *   new@…                         a new ticket from a registered client.
 *                                 Unknown senders are bounced to /portal.
 *
 * Nothing here can approve or run anything — inbound mail only adds messages
 * and `new` tickets. Auto-replies are dropped so two robots can't ping-pong.
 */
import PostalMime from 'postal-mime';
import {
  MAX_BODY_CHARS,
  MAX_TITLE_CHARS,
  REPLY_MARKER,
  confirmTicketToClient,
  notifyAliOfClientMessage,
  notifyClientOfReply,
  now,
  replyDomain,
  replySig,
  siteUrl,
  type ReplyRole,
} from './portal.ts';
import type { Env } from './shared.ts';

const MAX_RAW_BYTES = 2 * 1024 * 1024;

/** Keep only what the sender typed: cut the quoted history and trailing noise. */
export function stripQuoted(text: string): string {
  let lines = text.replace(/\r\n?/g, '\n').split('\n');

  // Our marker is the most reliable cut: it sits at the top of every email we send.
  const marker = lines.findIndex((l) => l.includes(REPLY_MARKER));
  if (marker !== -1) lines = lines.slice(0, marker);

  // Fallbacks for clients that drop the marker: classic quote openers.
  const opener = lines.findIndex(
    (l) =>
      /^-{2,}\s*Original Message\s*-{2,}/i.test(l) ||
      /^_{5,}$/.test(l) || // Outlook separator
      /^From:\s.+/.test(l) ||
      /^>/.test(l),
  );
  if (opener !== -1) lines = lines.slice(0, opener);

  // Drop the "On <date>, <name> wrote:" attribution. Gmail can wrap it over
  // two lines; the first half is only removed when the second half was, so a
  // real closing line like "On it tomorrow." survives.
  const trimBlank = () => {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  };
  trimBlank();
  if (lines.length && /wrote:\s*$/.test(lines[lines.length - 1])) {
    const wrote = lines.pop()!.trim();
    if (!/^On\s/.test(wrote) && lines.length && /^On\s.*\d/.test(lines[lines.length - 1].trim())) lines.pop();
  }
  trimBlank();
  return lines.join('\n').trim();
}

function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function isAutoReply(headers: Headers): boolean {
  const auto = headers.get('auto-submitted');
  if (auto && auto.toLowerCase() !== 'no') return true;
  const precedence = (headers.get('precedence') ?? '').toLowerCase();
  return ['bulk', 'junk', 'list', 'auto_reply'].includes(precedence) || headers.has('x-autoreply');
}

/** Constant-time compare for the hex reply signature. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const bare = (address: string) => address.trim().toLowerCase();

async function readBody(message: ForwardableEmailMessage) {
  const parsed = await PostalMime.parse(message.raw);
  const text = parsed.text ?? (parsed.html ? htmlToText(parsed.html) : '');
  return { subject: parsed.subject ?? '', body: stripQuoted(text).slice(0, MAX_BODY_CHARS) };
}

export async function handleInbound(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const to = bare(message.to);
  const from = bare(message.from);
  const [local, domain] = to.split('@');

  // Inbound mail is otherwise invisible: a rejected message leaves no trace and
  // a dropped one looks identical to a delivery that never happened. One line
  // per message makes "did it arrive, and what did we decide?" answerable.
  //
  // `from` is the envelope sender (MAIL FROM), which is what authorisation uses
  // and which senders such as relays and our own sending binding rewrite to a
  // bounce address. The header From is what the human sees; it is logged for
  // comparison, never trusted, and the auth fields say whether the receiving
  // infrastructure vouched for it.
  console.log(
    'inbound_mail',
    JSON.stringify({
      to,
      from,
      headerFrom: message.headers.get('from')?.slice(0, 120) ?? null,
      authResults: message.headers.get('authentication-results')?.slice(0, 160) ?? null,
      receivedSpf: message.headers.get('received-spf')?.slice(0, 120) ?? null,
      autoReply: isAutoReply(message.headers),
      bytes: message.rawSize,
      subject: message.headers.get('subject')?.slice(0, 80) ?? null,
    }),
  );

  // Every message gets exactly one decision line, so "it arrived but nothing
  // happened" is never the end of the story.
  const reject = (reason: string) => {
    console.log('inbound_rejected', JSON.stringify({ to, from, reason }));
    return message.setReject(reason);
  };
  const drop = (reason: string) => {
    console.log('inbound_dropped', JSON.stringify({ to, from, reason }));
  };

  if (domain !== replyDomain(env)) return reject('Unknown recipient.');
  if (message.rawSize > MAX_RAW_BYTES) return reject('Message too large. Use the portal for attachments.');
  if (isAutoReply(message.headers)) return drop('auto-reply');

  /* —— reply+<ticket>.<role>.<sig> —— */
  const tag = local.match(/^[^+]+\+(\d{1,9})\.([ca])\.([0-9a-f]{20})$/);
  if (tag) {
    const ticketId = Number(tag[1]);
    const role = tag[2] as ReplyRole;
    if (!sameHex(tag[3], await replySig(env, ticketId, role))) {
      return reject('This reply address is not valid.');
    }
    const ticket = await env.DB.prepare(
      `SELECT t.id, t.title, u.email AS client_email
         FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
    )
      .bind(ticketId)
      .first<{ id: number; title: string; client_email: string }>();
    if (!ticket) return reject('That ticket no longer exists.');

    const expected = role === 'c' ? ticket.client_email : bare(env.ADMIN_EMAIL || '');
    if (!expected || from !== expected) {
      return reject(
        `Replies to this ticket are only accepted from the address it was sent to. ` +
          `Use ${siteUrl(env)}/portal instead.`,
      );
    }

    const { body } = await readBody(message);
    if (!body) {
      return reject(
        `That reply had no text above the quoted history, so there was nothing to add. ` +
          `Write your message at the top and send again, or use ${siteUrl(env)}/portal.`,
      );
    }

    const t = now();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, ?, ?, ?)`)
        .bind(ticket.id, role === 'c' ? 'client' : 'ali', body, t),
      env.DB.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').bind(t, ticket.id),
    ]);
    if (role === 'c') await notifyAliOfClientMessage(env, ticket, body, false);
    else await notifyClientOfReply(env, ticket, body);
    console.log('inbound_accepted', JSON.stringify({ ticket: ticket.id, role, chars: body.length }));
    return;
  }

  /* —— new@ —— */
  if (local === 'new') {
    const user = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?')
      .bind(from)
      .first<{ id: string; email: string }>();
    if (!user) {
      return reject(
        `New requests by email are for existing clients. Sign up at ${siteUrl(env)}/portal first — it takes a minute.`,
      );
    }
    const { subject, body } = await readBody(message);
    const title = (subject.replace(/^\s*((re|fwd?|aw|sv)\s*:\s*)+/i, '').trim() || 'Request by email').slice(0, MAX_TITLE_CHARS);
    if (!body) return reject('The email was empty. Write what you need in the body.');

    const t = now();
    const ticket = await env.DB.prepare(
      `INSERT INTO tickets (user_id, project_id, title, status, created_at, updated_at)
       VALUES (?, NULL, ?, 'new', ?, ?) RETURNING id`,
    )
      .bind(user.id, title, t, t)
      .first<{ id: number }>();
    if (!ticket) throw new Error('ticket insert failed'); // temporary failure → sender's server retries
    await env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, 'client', ?, ?)`)
      .bind(ticket.id, body, t)
      .run();

    const ref = { id: ticket.id, title, client_email: user.email };
    await Promise.all([notifyAliOfClientMessage(env, ref, body, true), confirmTicketToClient(env, ref)]);
    console.log('inbound_accepted', JSON.stringify({ ticket: ticket.id, role: 'new', chars: body.length }));
    return;
  }

  return reject('Unknown recipient.');
}
