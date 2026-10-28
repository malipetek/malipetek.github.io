/*
 * Inbound mail (Cloudflare Email Routing → this Worker).
 *
 * Three doors:
 *   reply+<ticket>.<c|a>.<sig>@…  a reply to a ticket email. The sig must match
 *                                 (HMAC, see portal.ts) AND the envelope sender
 *                                 must be the ticket's client (c) or ADMIN_EMAIL
 *                                 (a). Posts into the thread and notifies the
 *                                 other side, exactly like the portal UI does.
 *   new@…                         a new ticket from a registered client. The
 *                                 receiving server must vouch for the From
 *                                 address (DMARC or aligned DKIM, mailauth.ts):
 *                                 the envelope sender alone is forgeable.
 *                                 Unknown senders are bounced to /portal.
 *   hello@…                       outreach. A reply or an opt-out stops that
 *                                 contact's sequence; bounces are recorded;
 *                                 everything else is forwarded to Ali.
 *
 * Nothing here can approve or run anything — inbound mail only adds messages,
 * `new` tickets and marketing events. Auto-replies are dropped so two robots
 * can't ping-pong (delivery reports are read before that rule).
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
  WAITING_SQL,
  postMessage,
  withAttachmentLine,
} from './portal.ts';
import { checkUploads, fileCount, FILE_LIMITS, type Upload } from './files.ts';
import { handleBounceReport, handleMarketingMail, isBounceMessage, marketingInbox } from './marketing.ts';
import type { Env } from './shared.ts';
import { verifySender } from './mailauth.ts';

/** Room for a few phone screenshots; base64 makes attachments a third larger. */
const MAX_RAW_BYTES = 15 * 1024 * 1024;

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

/** An attachment's bytes as a plain ArrayBuffer, whatever the parser handed back. */
function toArrayBuffer(content: ArrayBufferLike | Uint8Array | string): ArrayBuffer {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content instanceof Uint8Array ? content : new Uint8Array(content);
  return bytes.slice().buffer as ArrayBuffer;
}

async function readBody(message: ForwardableEmailMessage) {
  const parsed = await PostalMime.parse(message.raw);
  const text = parsed.text ?? (parsed.html ? htmlToText(parsed.html) : '');
  // Real attachments only: an image the HTML shows inline is a signature logo
  // or a tracking pixel far more often than it is the point of the email.
  const files = (parsed.attachments ?? [])
    .filter((a) => a.filename && !a.related && a.disposition !== 'inline')
    .map((a) => ({ name: a.filename as string, data: toArrayBuffer(a.content) }));
  return {
    files,
    subject: parsed.subject ?? '',
    body: stripQuoted(text).slice(0, MAX_BODY_CHARS),
    // In message order: the first Authentication-Results is the receiver's own.
    headers: (parsed.headers ?? []).map((h) => ({ key: h.key, value: h.value })),
    headerFrom: bare(parsed.from?.address ?? ''),
  };
}

/**
 * The attachments a ticket can keep, one by one: a file of the wrong type or
 * size is left out rather than bouncing the whole email, and said so.
 */
async function keepFiles(env: Env, ticketId: number, files: { name: string; data: ArrayBuffer }[]) {
  const uploads: Upload[] = [];
  const skipped: string[] = [];
  if (!files.length) return { uploads, skipped };
  if (!env.FILES) return { uploads, skipped: files.map((f) => `${f.name} (attachments are not set up)`) };
  let room = Math.min(FILE_LIMITS.perMessage, FILE_LIMITS.perTicket - (await fileCount(env, ticketId)));
  const why: Record<string, string> = { file_type: 'type not accepted', file_too_large: 'over 10 MB', bad_file: 'empty or unnamed' };
  for (const file of files) {
    const one = checkUploads([file], 0);
    if (!one.ok) skipped.push(`${file.name} (${why[one.error] ?? one.error})`);
    else if (room <= 0) skipped.push(`${file.name} (too many files)`);
    else {
      uploads.push(one.uploads[0]);
      room -= 1;
    }
  }
  return { uploads, skipped };
}

/** Say in the thread what an email brought that was not kept — for Ali only. */
async function noteSkipped(env: Env, ticketId: number, skipped: string[], t: number) {
  if (!skipped.length) return;
  await env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 1, ?)`)
    .bind(ticketId, `Not kept from the email: ${skipped.join(', ')}.`, t)
    .run();
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

  // A delivery failure is generated by a mail server, not a person, and often
  // carries Auto-Submitted — so it has to be read before the auto-reply rule.
  if (isBounceMessage(from, message.headers.get('content-type'))) {
    const raw = await new Response(message.raw).text();
    const bounced = await handleBounceReport(env, raw).catch((error) => {
      console.error('bounce_parse_failed', error);
      return 0;
    });
    console.log('inbound_bounce', JSON.stringify({ to, from, bounced }));
    return drop(bounced ? 'bounce recorded' : 'unmatched bounce');
  }

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

    const { body, files } = await readBody(message);
    if (!body && !files.length) {
      return reject(
        `That reply had no text above the quoted history, so there was nothing to add. ` +
          `Write your message at the top and send again, or use ${siteUrl(env)}/portal.`,
      );
    }

    const t = now();
    const kept = await keepFiles(env, ticket.id, files);
    if (!body && !kept.uploads.length) {
      return reject(`None of the attached files could be kept (${kept.skipped.join(', ')}). Images, PDF, text, CSV, JSON, zip, Word and Excel up to 10 MB are accepted.`);
    }
    const stored = await postMessage(env, ticket.id, role === 'c' ? 'client' : 'ali', body, false, kept.uploads, t);
    await (role === 'c'
      ? env.DB.prepare(WAITING_SQL).bind(t, t, ticket.id)
      : env.DB.prepare('UPDATE tickets SET updated_at = ?, client_waiting_since = NULL WHERE id = ?').bind(t, ticket.id)
    ).run();
    await noteSkipped(env, ticket.id, kept.skipped, t);
    const text = withAttachmentLine(body, stored);
    if (role === 'c') await notifyAliOfClientMessage(env, ticket, text, false);
    else await notifyClientOfReply(env, ticket, text);
    console.log('inbound_accepted', JSON.stringify({ ticket: ticket.id, role, chars: body.length, files: stored.length, skipped: kept.skipped.length }));
    return;
  }

  /* —— new@ —— */
  if (local === 'new') {
    const { subject, body, headers, headerFrom, files } = await readBody(message);
    // The From a human sees, and only once the receiving server vouched for it.
    const verdict = verifySender(headers, headerFrom);
    console.log('inbound_sender', JSON.stringify({ headerFrom, envelope: from, ...verdict }));
    if (!verdict.ok) {
      return reject(
        `We could not confirm this email really came from ${headerFrom || 'its sender'}, so it was not filed. ` +
          `Use ${siteUrl(env)}/portal instead.`,
      );
    }
    const user = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?')
      .bind(headerFrom)
      .first<{ id: string; email: string }>();
    if (!user) {
      return reject(
        `New requests by email are for existing clients. Sign up at ${siteUrl(env)}/portal first — it takes a minute.`,
      );
    }
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
    const kept = await keepFiles(env, ticket.id, files);
    const stored = await postMessage(env, ticket.id, 'client', body, false, kept.uploads, t);
    await noteSkipped(env, ticket.id, kept.skipped, t);

    const ref = { id: ticket.id, title, client_email: user.email };
    await Promise.all([notifyAliOfClientMessage(env, ref, withAttachmentLine(body, stored), true), confirmTicketToClient(env, ref)]);
    console.log('inbound_accepted', JSON.stringify({ ticket: ticket.id, role: 'new', chars: body.length, files: stored.length }));
    return;
  }

  /* —— hello@ — outreach replies land here —— */
  if (local === marketingInbox(env)) {
    const { subject, body, headers, headerFrom } = await readBody(message);
    const verdict = verifySender(headers, headerFrom);
    await handleMarketingMail(env, { headerFrom, envelopeFrom: from, verified: verdict.ok, subject, body });
    console.log('inbound_marketing', JSON.stringify({ headerFrom, verified: verdict.ok, chars: body.length, subject: subject.slice(0, 80) }));
    return;
  }

  return reject('Unknown recipient.');
}
