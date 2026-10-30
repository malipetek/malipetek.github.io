/*
 * Marketing, unattended.
 *
 * Three streams, one store:
 *   email    — a contact is imported, a three-step sequence is queued, and the
 *              five-minute cron sends what is due inside the send window, up
 *              to a daily cap. Replies and "no" cancel whatever is left.
 *   x        — a post is composed in the admin views. The local publisher
 *   linkedin   (marketing/publisher) polls over a bearer token, opens the
 *              composer in Ali's own browser profile, and reports the result.
 *
 * Nothing here invents an address. A contact only exists because Ali added it
 * or imported a list he built; an inbound stranger is forwarded to him, not
 * added to the list. Every send starts from a contact row, so the opt-out,
 * the bounce and the reason we may write are all in one place.
 *
 * Sending is off until `live` is on and a postal address is set: the first is
 * the kill switch, the second is what anti-spam law asks of every commercial
 * email. Once both are on, queued mail goes without per-item approval.
 */
import { Hono, type Context } from 'hono';
import { json, now, type Env, type HonoEnv } from './shared.ts';
import { mailAli, requireAdmin, requireUser, siteUrl, type PortalEnv } from './portal.ts';
import { ensureContentCycle } from './content.ts';

/* ——————————————————————— settings ——————————————————————— */

export interface MarketingSettings {
  /** The kill switch. Off means nothing is sent, whatever is queued. */
  live: boolean;
  dailyCap: number;
  /** Emails per cron run, so an import of forty does not leave in one burst. */
  perRun: number;
  startHour: number;
  endHour: number;
  /** Local clock used for the window and the daily count. */
  offsetMinutes: number;
  weekdaysOnly: boolean;
  postalAddress: string;
  fromName: string;
  /** Added to every content-cycle brief, after the launch kit. */
  voiceNotes: string;
}

const SETTING_DEFAULTS: MarketingSettings = {
  live: false,
  dailyCap: 20,
  perRun: 5,
  startHour: 8,
  endHour: 17,
  offsetMinutes: 180,
  weekdaysOnly: true,
  postalAddress: '',
  fromName: 'Ali Petek',
  voiceNotes: '',
};

const SETTING_KEYS: Record<keyof MarketingSettings, string> = {
  live: 'marketing_live',
  dailyCap: 'marketing_daily_cap',
  perRun: 'marketing_per_run',
  startHour: 'marketing_start_hour',
  endHour: 'marketing_end_hour',
  offsetMinutes: 'marketing_utc_offset',
  weekdaysOnly: 'marketing_weekdays_only',
  postalAddress: 'marketing_postal_address',
  fromName: 'marketing_from_name',
  voiceNotes: 'marketing_voice_notes',
};

const FIELD_OF_KEY = Object.fromEntries(Object.entries(SETTING_KEYS).map(([field, key]) => [key, field])) as Record<
  string,
  keyof MarketingSettings
>;

const int = (min: number, max: number) => (raw: unknown) => {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
};

const RULES: Record<keyof MarketingSettings, (raw: unknown) => unknown> = {
  live: (raw) => (typeof raw === 'boolean' ? raw : raw === 'on' ? true : raw === 'off' ? false : undefined),
  dailyCap: int(1, 200),
  perRun: int(1, 50),
  startHour: int(0, 23),
  endHour: int(1, 24),
  offsetMinutes: int(-720, 840),
  weekdaysOnly: (raw) => (typeof raw === 'boolean' ? raw : undefined),
  postalAddress: (raw) => {
    if (typeof raw !== 'string') return undefined;
    const value = raw.trim();
    return value.length <= 200 ? value : undefined;
  },
  fromName: (raw) => {
    if (typeof raw !== 'string') return undefined;
    const value = raw.trim();
    return value && value.length <= 80 ? value : undefined;
  },
  voiceNotes: (raw) => {
    if (typeof raw !== 'string') return undefined;
    const value = raw.trim();
    return value.length <= 800 ? value : undefined;
  },
};

export async function readMarketingSettings(env: Env): Promise<MarketingSettings> {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'marketing\\_%' ESCAPE '\\'").all<{
    key: string;
    value: string;
  }>();
  const out: MarketingSettings = { ...SETTING_DEFAULTS };
  for (const row of results ?? []) {
    const field = FIELD_OF_KEY[row.key];
    if (!field) continue;
    try {
      const value = RULES[field](JSON.parse(row.value));
      if (value !== undefined) (out as unknown as Record<string, unknown>)[field] = value;
    } catch {
      /* a bad row reads as the default */
    }
  }
  return out;
}

/** Save what passes its rule; return the field names rejected. */
export async function saveMarketingSettings(env: Env, patch: Record<string, unknown>): Promise<string[]> {
  const rejected: string[] = [];
  const statements: D1PreparedStatement[] = [];
  for (const [field, raw] of Object.entries(patch)) {
    const key = SETTING_KEYS[field as keyof MarketingSettings];
    const rule = RULES[field as keyof MarketingSettings];
    const value = key && rule ? rule(raw) : undefined;
    if (value === undefined) {
      rejected.push(field);
      continue;
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(key, JSON.stringify(value), now()),
    );
  }
  if (statements.length) await env.DB.batch(statements);
  return rejected;
}

export function marketingFrom(env: Env): string {
  return env.MARKETING_FROM_EMAIL || 'hello@malipetek.dev';
}

/** Local part of the outreach address, for the inbound router. */
export function marketingInbox(env: Env): string {
  return marketingFrom(env).split('@')[0].toLowerCase();
}

/* ——————————————————————— clock ——————————————————————— */

export interface WindowState {
  open: boolean;
  reason?: string;
}

/** Where the local clock stands: hour, weekday (0 = Sunday) and the local day's start. */
export function localClock(offsetMinutes: number, t: number): { hour: number; weekday: number; dayStart: number } {
  const local = t + offsetMinutes * 60;
  const day = Math.floor(local / 86400);
  return {
    hour: Math.floor((local % 86400) / 3600),
    weekday: (day + 4) % 7, // 1970-01-01 was a Thursday
    dayStart: day * 86400 - offsetMinutes * 60,
  };
}

export function sendWindow(settings: MarketingSettings, t: number): WindowState {
  const { hour, weekday } = localClock(settings.offsetMinutes, t);
  if (settings.weekdaysOnly && (weekday === 0 || weekday === 6)) return { open: false, reason: 'weekend' };
  if (settings.startHour === settings.endHour) return { open: true };
  const open =
    settings.startHour < settings.endHour
      ? hour >= settings.startHour && hour < settings.endHour
      : hour >= settings.startHour || hour < settings.endHour;
  return open ? { open: true } : { open: false, reason: 'outside_hours' };
}

/* ——————————————————————— sequences ——————————————————————— */

export type SequenceKind = 'cold_a' | 'cold_b' | 'warm';

interface SequenceStep {
  kind: string;
  /** Days after the previous step was queued, not after it was sent. */
  day: number;
  subject: string;
  body: string;
}

/*
 * The copy from marketing/launch/outreach.md, with placeholders. `{{gap}}` is
 * the one true observation; without it a cold email is spam, so a contact that
 * lacks one is held rather than sent.
 */
export const SEQUENCES: Record<SequenceKind, SequenceStep[]> = {
  cold_a: [
    {
      kind: 'first',
      day: 0,
      subject: 'The last mile of {{business}}',
      body: `{{greeting}}

I looked at {{site}} — {{gap}}. That is usually the last mile: it works until it does not.

I run a one-person dev shop with an AI agent on the tools. You send a request, I approve it, the agent builds it on a sealed copy of your project, and I check it before you see it. You pay for my minutes, billed by the second: a one-minute fix is $1.67. No quote, no minimum.

If that is on your list, send it and I will tell you whether it fits.

Ali — malipetek.dev`,
    },
    {
      kind: 'followup_1',
      day: 4,
      subject: 'Re: The last mile of {{business}}',
      body: `{{greeting}}

One thing only: is that something you want fixed, or is it not worth the trouble? Either answer is useful.

Ali`,
    },
    {
      kind: 'followup_2',
      day: 10,
      subject: 'Re: The last mile of {{business}}',
      body: `{{greeting}}

Last note from me. If it becomes worth fixing, it is $1.67 a minute of my time and no quote to wait for: malipetek.dev/portal.

Ali`,
    },
  ],
  cold_b: [
    {
      kind: 'first',
      day: 0,
      subject: 'The smallest thing on {{business}}',
      body: `{{greeting}}

{{gap}} — the kind of small thing that never gets to the top of the list because it is too small to hire for.

That is what I do. One-person dev shop; an AI agent does the typing on a copy of your project; I approve the job and check the result before it goes live. You pay for my minutes, by the second: a one-minute fix is $1.67. No quote, no call, no minimum.

What is the smallest thing on {{site}} you have been meaning to fix? Reply with it and I will tell you if it fits.

Ali — malipetek.dev`,
    },
    {
      kind: 'followup_1',
      day: 4,
      subject: 'Re: The smallest thing on {{business}}',
      body: `{{greeting}}

One question: what is the smallest thing on {{site}} you have been meaning to fix? Small is where this is cheapest — you pay for my minutes, not the hours it would have taken.

Ali`,
    },
    {
      kind: 'followup_2',
      day: 10,
      subject: 'Re: The smallest thing on {{business}}',
      body: `{{greeting}}

I will leave it here. If a small fix ever gets annoying enough, the portal is open: malipetek.dev/portal. No call, no quote.

Ali`,
    },
  ],
  warm: [
    {
      kind: 'first',
      day: 0,
      subject: 'A small experiment (and a favour)',
      body: `{{greeting}}

I have turned the contracting work into a self-serve portal. You write what you need, I approve it, an AI agent builds it on a sealed copy of the project, and I check it before it ships. You pay for my minutes, billed by the second — a one-minute fix is $1.67. No quote, no minimum.

I am looking for the first few real jobs to put through it. Is there a small thing on {{site}} you have been putting off? I would rather it were yours than a stranger's.

No pressure if not — and if you know someone with a small fix, I would take the introduction.

Ali`,
    },
    {
      kind: 'followup_1',
      day: 4,
      subject: 'Re: A small experiment (and a favour)',
      body: `{{greeting}}

One question: what is the smallest thing on {{site}} you have been meaning to fix? Small is where this is cheapest — you pay for my minutes, not the hours it would have taken.

Ali`,
    },
    {
      kind: 'followup_2',
      day: 10,
      subject: 'Re: A small experiment (and a favour)',
      body: `{{greeting}}

I will stop filling your inbox. If something small comes up, the door is open: malipetek.dev/portal.

Ali`,
    },
  ],
};

export const SEQUENCE_LABELS: Record<SequenceKind, string> = {
  cold_a: 'Cold A — someone who built it with AI',
  cold_b: 'Cold B — a business owner with a small list',
  warm: 'Warm — past collaborators',
};

export const SEQUENCE_NEEDS_GAP: Record<SequenceKind, boolean> = { cold_a: true, cold_b: true, warm: false };

export function isSequenceKind(value: unknown): value is SequenceKind {
  return typeof value === 'string' && value in SEQUENCES;
}

export interface ContactFields {
  name: string | null;
  business: string | null;
  site: string | null;
  gap: string | null;
}

/** Fill the copy in. An empty site or gap reads as a neutral phrase, never a dangling em dash. */
export function fillTemplate(text: string, contact: ContactFields): string {
  const first = contact.name?.trim().split(/\s+/)[0] ?? '';
  const business = contact.business || contact.site || 'your business';
  return text
    .replaceAll('{{greeting}}', first ? `Hi ${first},` : 'Hi,')
    .replaceAll('{{business}}', business)
    .replaceAll('{{site}}', contact.site || 'your site')
    .replaceAll('{{gap}}', contact.gap?.trim() || '');
}

/* ——————————————————————— contacts ——————————————————————— */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_CHARS = 254;

export function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email && email.length <= MAX_EMAIL_CHARS && EMAIL_RE.test(email) ? email : null;
}

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const out = value.trim();
  return out ? out.slice(0, max) : null;
};

export interface Contact {
  id: number;
  email: string;
  name: string | null;
  business: string | null;
  site: string | null;
  source: string;
  source_url: string | null;
  gap: string | null;
  consent_basis: string;
  status: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
  last_contacted_at: number | null;
  opted_out_at: number | null;
}

const CONTACT_STATUSES = ['new', 'queued', 'contacted', 'replied', 'opted_out', 'bounced', 'paused'] as const;
const CONTACT_SOURCES = ['manual', 'warm', 'csv', 'site', 'inbound'];

export function contactView(c: Contact & { sent_count?: number; next_at?: number | null }) {
  return {
    id: c.id,
    email: c.email,
    name: c.name,
    business: c.business,
    site: c.site,
    source: c.source,
    sourceUrl: c.source_url,
    gap: c.gap,
    consentBasis: c.consent_basis,
    status: c.status,
    notes: c.notes,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    lastContactedAt: c.last_contacted_at,
    optedOutAt: c.opted_out_at,
    sentCount: c.sent_count ?? 0,
    nextAt: c.next_at ?? null,
  };
}

async function getContact(env: Env, id: number): Promise<Contact | null> {
  return env.DB.prepare('SELECT * FROM marketing_contacts WHERE id = ?').bind(id).first<Contact>();
}

export async function cancelScheduled(env: Env, contactId: number): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE marketing_messages SET status = 'cancelled', updated_at = ?
      WHERE contact_id = ? AND status = 'scheduled'`,
  )
    .bind(now(), contactId)
    .run();
  return result.meta.changes ?? 0;
}

async function logEvent(
  env: Env,
  event: { messageId?: number | null; contactId?: number | null; kind: string; detail?: string | null },
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO marketing_events (message_id, contact_id, kind, detail, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(event.messageId ?? null, event.contactId ?? null, event.kind, event.detail?.slice(0, 2000) ?? null, now())
    .run();
}

/** Queue a whole sequence for a contact. Caller decides whether the copy can be filled. */
async function queueSequence(
  env: Env,
  contact: Contact,
  kind: SequenceKind,
  campaign: string,
  startAt: number,
): Promise<number> {
  const t = now();
  const statements = SEQUENCES[kind].map((step, index) =>
    env.DB.prepare(
      `INSERT INTO marketing_messages
         (channel, kind, contact_id, campaign, step, to_email, subject, body, status, scheduled_at, created_at, updated_at)
       VALUES ('email', ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`,
    ).bind(
      step.kind,
      contact.id,
      campaign,
      index,
      contact.email,
      fillTemplate(step.subject, contact),
      fillTemplate(step.body, contact),
      startAt + step.day * 86400,
      t,
      t,
    ),
  );
  if (statements.length) await env.DB.batch(statements);
  await env.DB.prepare(
    `UPDATE marketing_contacts SET status = 'queued', updated_at = ?
      WHERE id = ? AND status IN ('new', 'paused')`,
  )
    .bind(t, contact.id)
    .run();
  return statements.length;
}

/* ——————————————————————— sending ——————————————————————— */

export interface RunSummary {
  live: boolean;
  window: WindowState;
  sent: number;
  failed: number;
  reason: string | null;
}

async function countSentToday(env: Env, dayStart: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM marketing_messages
      WHERE channel = 'email' AND status = 'sent' AND sent_at >= ?`,
  )
    .bind(dayStart)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

const footerFor = (settings: MarketingSettings) =>
  `\n\n--\n${settings.fromName}\n${settings.postalAddress}\n\nReply "no" and I will not write again.`;

interface ClaimedEmail {
  id: number;
  contact_id: number;
  to_email: string | null;
  subject: string | null;
  body: string;
}

/**
 * Claim one due email. A claim is a single conditional UPDATE, so two cron
 * runs can never send the same row; the contact is re-checked after claiming
 * because a reply may have landed between the query and the claim.
 */
async function claimEmail(env: Env, id: number, t: number): Promise<ClaimedEmail | null> {
  const message = await env.DB.prepare(
    `UPDATE marketing_messages SET status = 'sending', updated_at = ?
      WHERE id = ? AND status = 'scheduled'
      RETURNING id, contact_id, to_email, subject, body`,
  )
    .bind(t, id)
    .first<ClaimedEmail>();
  if (!message) return null;

  const contact = await env.DB.prepare('SELECT id, status FROM marketing_contacts WHERE id = ?')
    .bind(message.contact_id)
    .first<{ id: number; status: string }>();
  if (!contact || !['new', 'queued', 'contacted'].includes(contact.status)) {
    await env.DB.prepare(
      `UPDATE marketing_messages SET status = 'cancelled', updated_at = ?
        WHERE id = ? AND status = 'sending'`,
    )
      .bind(t, message.id)
      .run();
    return null;
  }
  return message;
}

async function deliverEmail(env: Env, settings: MarketingSettings, message: ClaimedEmail): Promise<boolean> {
  const t = now();
  const to = message.to_email;
  if (!to) {
    await env.DB.prepare(`UPDATE marketing_messages SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`)
      .bind('no_recipient', t, message.id)
      .run();
    await logEvent(env, { messageId: message.id, contactId: message.contact_id, kind: 'failed', detail: 'no_recipient' });
    return false;
  }

  const sentText = `${message.body}${footerFor(settings)}`;
  try {
    if (!env.MARKETING) throw new Error('sender_unbound');
    await env.MARKETING.send({
      from: { email: marketingFrom(env), name: settings.fromName },
      to,
      subject: message.subject || '(no subject)',
      text: sentText,
      replyTo: marketingFrom(env),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(`UPDATE marketing_messages SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`)
      .bind(reason.slice(0, 500), t, message.id)
      .run();
    await logEvent(env, { messageId: message.id, contactId: message.contact_id, kind: 'failed', detail: reason });
    console.error('marketing_send_failed', message.id, reason);
    return false;
  }

  await env.DB.batch([
    // The row keeps exactly what left, footer included, so the audit trail
    // does not drift when a setting changes later.
    env.DB.prepare(
      `UPDATE marketing_messages SET status = 'sent', sent_at = ?, body = ?, error = NULL, updated_at = ? WHERE id = ?`,
    ).bind(t, sentText, t, message.id),
    env.DB.prepare(
      `UPDATE marketing_contacts
          SET status = CASE WHEN status IN ('new', 'queued') THEN 'contacted' ELSE status END,
              last_contacted_at = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(t, t, message.contact_id),
    env.DB.prepare(
      `INSERT INTO marketing_events (message_id, contact_id, kind, detail, created_at) VALUES (?, ?, 'sent', ?, ?)`,
    ).bind(message.id, message.contact_id, message.subject ?? '', t),
  ]);
  return true;
}

/**
 * The cron's half: send what is due, if the switch, the window, the sender and
 * the cap all allow it. Returns why it did nothing so a manual run can say.
 */
export async function runMarketing(env: Env): Promise<RunSummary> {
  const settings = await readMarketingSettings(env);
  const t = now();
  const window = sendWindow(settings, t);
  const summary: RunSummary = { live: settings.live, window, sent: 0, failed: 0, reason: null };

  if (!settings.live) return { ...summary, reason: 'paused' };
  if (!env.MARKETING) return { ...summary, reason: 'sender_unbound' };
  if (!settings.postalAddress) return { ...summary, reason: 'postal_address_unset' };
  if (!window.open) return { ...summary, reason: window.reason ?? 'outside_hours' };

  const { dayStart } = localClock(settings.offsetMinutes, t);
  const sentToday = await countSentToday(env, dayStart);
  const room = Math.max(0, Math.min(settings.perRun, settings.dailyCap - sentToday));
  if (!room) return { ...summary, reason: 'daily_cap' };

  const { results } = await env.DB.prepare(
    `SELECT m.id
       FROM marketing_messages m JOIN marketing_contacts c ON c.id = m.contact_id
      WHERE m.channel = 'email' AND m.status = 'scheduled' AND m.scheduled_at <= ?
        AND c.status IN ('new', 'queued', 'contacted')
      ORDER BY m.scheduled_at, m.id
      LIMIT ?`,
  )
    .bind(t, room)
    .all<{ id: number }>();

  for (const row of results ?? []) {
    const message = await claimEmail(env, row.id, t);
    if (!message) continue;
    if (await deliverEmail(env, settings, message)) summary.sent += 1;
    else summary.failed += 1;
  }
  return summary;
}

/* ——————————————————————— inbound mail ——————————————————————— */

/** "no" or "unsubscribe" in the body, which stops everything left for that contact. */
export function isOptOut(body: string): boolean {
  const text = body.trim().slice(0, 600);
  if (/^\s*(no|stop|no thanks|no thank you|not interested)\s*[.!]?\s*$/i.test(text)) return true;
  return /\b(unsubscribe|opt[- ]?out|remove me|take me off|stop (emailing|writing)|don'?t (email|contact|write))\b/i.test(text);
}

const excerpt = (body: string, max: number) => (body.length > max ? `${body.slice(0, max)}…` : body);

export interface InboundMarketingMail {
  headerFrom: string;
  envelopeFrom: string;
  /** The receiving server vouched for headerFrom (mailauth.ts). */
  verified: boolean;
  subject: string;
  body: string;
}

/**
 * Mail addressed to the outreach inbox. A known contact who replies is marked
 * and their remaining sequence cancelled; everyone else is forwarded to Ali,
 * never added to the list. No auto-reply — two robots must not ping-pong.
 */
export async function handleMarketingMail(env: Env, mail: InboundMarketingMail): Promise<void> {
  const t = now();
  const contact = mail.verified
    ? await env.DB.prepare('SELECT * FROM marketing_contacts WHERE email = ?')
        .bind(mail.headerFrom)
        .first<Contact>()
    : null;

  if (!mail.verified) {
    await logEvent(env, { kind: 'inbound_unverified', detail: `${mail.headerFrom}: ${mail.subject}` });
    await mailAli(env, {
      subject: `Unverified mail to ${marketingFrom(env)} from ${mail.headerFrom || mail.envelopeFrom}`,
      text: [
        `A message arrived at ${marketingFrom(env)} but the receiving server could not`,
        `confirm it came from ${mail.headerFrom || mail.envelopeFrom}. Nothing was changed.`,
        '',
        `From: ${mail.headerFrom} (envelope ${mail.envelopeFrom})`,
        `Subject: ${mail.subject}`,
        '',
        excerpt(mail.body, 4000),
      ].join('\n'),
    });
    return;
  }

  if (!contact) {
    await logEvent(env, { kind: 'inbound', detail: `${mail.headerFrom}: ${mail.subject}` });
    await mailAli(env, {
      subject: `Mail to ${marketingFrom(env)} from ${mail.headerFrom}`,
      text: [
        `Not a contact, so it was not filed or answered automatically.`,
        '',
        `Subject: ${mail.subject}`,
        '',
        excerpt(mail.body, 4000),
        '',
        `If this is a lead, add them in the Marketing desk: ${siteUrl(env)}/portal/admin#marketing`,
      ].join('\n'),
    });
    return;
  }

  if (isOptOut(mail.body)) {
    await env.DB.prepare(
      `UPDATE marketing_contacts SET status = 'opted_out', opted_out_at = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(t, t, contact.id)
      .run();
    const cancelled = await cancelScheduled(env, contact.id);
    await logEvent(env, { contactId: contact.id, kind: 'opt_out', detail: excerpt(mail.body, 300) });
    await mailAli(env, {
      subject: `${contact.email} opted out`,
      text: [
        `${contact.email} replied "no". They are marked opted out and ${cancelled} queued`,
        `email${cancelled === 1 ? '' : 's'} were cancelled. Nothing else will be sent to them.`,
        '',
        excerpt(mail.body, 1500),
      ].join('\n'),
    });
    return;
  }

  await env.DB.prepare(`UPDATE marketing_contacts SET status = 'replied', updated_at = ? WHERE id = ?`)
    .bind(t, contact.id)
    .run();
  const cancelled = await cancelScheduled(env, contact.id);
  await logEvent(env, { contactId: contact.id, kind: 'reply', detail: excerpt(mail.body, 500) });
  await mailAli(env, {
    subject: `${contact.email} replied: ${mail.subject || '(no subject)'}`,
    text: [
      `${contact.email}${contact.business ? ` (${contact.business})` : ''} replied to outreach.`,
      `Their remaining sequence was cancelled (${cancelled} message${cancelled === 1 ? '' : 's'}).`,
      '',
      excerpt(mail.body, 4000),
      '',
      `Answer from your inbox to ${contact.email} — this address only files replies.`,
      `Marketing desk: ${siteUrl(env)}/portal/admin#marketing`,
    ].join('\n'),
  });
}

export function isBounceMessage(from: string, contentType: string | null): boolean {
  if (!/^(mailer-daemon|postmaster|bounces?)@/i.test(from)) return false;
  const type = (contentType ?? '').toLowerCase();
  return type.includes('multipart/report') || type.includes('message/delivery-status');
}

/**
 * Delivery failures come back as DSNs, not as a nice API error. Read the
 * failed recipients out of the report and take those contacts out of the list.
 */
export async function handleBounceReport(env: Env, raw: string): Promise<number> {
  const addresses = new Set<string>();
  for (const match of raw.matchAll(/(?:Final|Original)-Recipient:\s*rfc822;\s*([^\s;<>]+)/gi)) {
    const email = cleanEmail(match[1]);
    if (email) addresses.add(email);
  }
  if (!addresses.size) return 0;

  const t = now();
  const bounced: string[] = [];
  for (const email of addresses) {
    const contact = await env.DB.prepare('SELECT id FROM marketing_contacts WHERE email = ?')
      .bind(email)
      .first<{ id: number }>();
    if (!contact) continue;
    await env.DB.prepare(`UPDATE marketing_contacts SET status = 'bounced', updated_at = ? WHERE id = ?`)
      .bind(t, contact.id)
      .run();
    await cancelScheduled(env, contact.id);
    await logEvent(env, { contactId: contact.id, kind: 'bounce', detail: email });
    bounced.push(email);
  }
  if (bounced.length) {
    await mailAli(env, {
      subject: `Bounced: ${bounced.join(', ')}`,
      text: [
        `Delivery failed for ${bounced.length} contact${bounced.length === 1 ? '' : 's'}:`,
        ...bounced.map((email) => `  ${email}`),
        '',
        'They are marked bounced and their queued mail was cancelled.',
        `Marketing desk: ${siteUrl(env)}/portal/admin#marketing`,
      ].join('\n'),
    });
  }
  return bounced.length;
}

/* ——————————————————————— HTTP ——————————————————————— */

type PortalCtx = Context<PortalEnv>;
type PublisherCtx = Context<HonoEnv>;

const out = (c: PortalCtx | PublisherCtx, data: unknown, status = 200) =>
  json(data, status, c.req.header('Origin') ?? null);

async function jsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const value = (await c.req.json()) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const sameText = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/* —— contacts —— */

export async function importContacts(
  env: Env,
  csv: string,
  sequence: SequenceKind,
  campaign: string,
): Promise<{ added: number; paused: number; skipped: { email: string; reason: string }[] }> {
  const parsed = parseContactsCsv(csv);
  const skipped = parsed.skipped;
  let added = 0;
  let paused = 0;
  const t = now();

  for (const row of parsed.rows) {
    const email = cleanEmail(row.email);
    if (!email) {
      skipped.push({ email: String(row.email ?? ''), reason: 'bad_email' });
      continue;
    }
    const gap = text(row.gap, 300);
    const contact = {
      email,
      name: text(row.name, 80),
      business: text(row.business, 120),
      site: text(row.site, 200),
      gap,
      source_url: text(row.sourceUrl, 500),
      notes: text(row.notes, 1000),
      consent: ['consent', 'existing_relationship', 'legitimate_interest'].includes(String(row.consentBasis))
        ? String(row.consentBasis)
        : 'legitimate_interest',
    };

    const inserted = await env.DB.prepare(
      `INSERT INTO marketing_contacts
         (email, name, business, site, source, source_url, gap, consent_basis, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'csv', ?, ?, ?, 'new', ?, ?, ?)
       ON CONFLICT(email) DO NOTHING
       RETURNING *`,
    )
      .bind(
        contact.email,
        contact.name,
        contact.business,
        contact.site,
        contact.source_url,
        contact.gap,
        contact.consent,
        contact.notes,
        t,
        t,
      )
      .first<Contact>();
    if (!inserted) {
      skipped.push({ email, reason: 'already_in_list' });
      continue;
    }
    added += 1;

    if (SEQUENCE_NEEDS_GAP[sequence] && !contact.gap) {
      await env.DB.prepare('UPDATE marketing_contacts SET status = ?, updated_at = ? WHERE id = ?')
        .bind('paused', t, inserted.id)
        .run();
      await logEvent(env, { contactId: inserted.id, kind: 'paused', detail: 'missing gap' });
      paused += 1;
      continue;
    }

    // Stagger the start so an import does not leave in one burst; the cron
    // then sends a handful per run.
    await queueSequence(env, inserted, sequence, campaign, t + added * 120);
  }

  return { added, paused, skipped };
}

/** Split CSV text into records; quoted commas and newlines survive. */
export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (quoted) {
      if (char === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((value) => value.trim()));
}

export interface ImportRow {
  email: string;
  name: string;
  business: string;
  site: string;
  gap: string;
  sourceUrl: string;
  notes: string;
  consentBasis: string;
}

const COLUMN_ALIASES: Record<string, string> = {
  email: 'email',
  'e-mail': 'email',
  name: 'name',
  'first name': 'name',
  business: 'business',
  company: 'business',
  site: 'site',
  website: 'site',
  url: 'site',
  gap: 'gap',
  observation: 'gap',
  'source url': 'sourceUrl',
  source_url: 'sourceUrl',
  sourceurl: 'sourceUrl',
  notes: 'notes',
  note: 'notes',
  'consent basis': 'consentBasis',
  consent_basis: 'consentBasis',
  consentbasis: 'consentBasis',
};

/** Header + rows. Unknown columns are ignored; `email` is the only required one. */
export function parseContactsCsv(csv: string): { rows: ImportRow[]; skipped: { email: string; reason: string }[] } {
  const skipped: { email: string; reason: string }[] = [];
  const records = parseCsv(csv.replace(/^\uFEFF/, ''));
  if (records.length < 2) return { rows: [], skipped: [{ email: '', reason: 'empty' }] };

  const header = records[0].map((cell) => cell.trim().toLowerCase().replace(/\s+/g, ' '));
  const fields = header.map((cell) => COLUMN_ALIASES[cell] ?? '');
  if (!fields.includes('email')) return { rows: [], skipped: [{ email: '', reason: 'no_email_column' }] };

  const rows: ImportRow[] = [];
  for (const record of records.slice(1)) {
    if (rows.length + skipped.length >= 1000) {
      skipped.push({ email: '', reason: 'too_many_rows' });
      break;
    }
    const row: Record<string, string> = {
      email: '',
      name: '',
      business: '',
      site: '',
      gap: '',
      sourceUrl: '',
      notes: '',
      consentBasis: '',
    };
    fields.forEach((field, index) => {
      if (field && !row[field]) row[field] = (record[index] ?? '').trim();
    });
    rows.push(row as unknown as ImportRow);
  }
  return { rows, skipped };
}

/* —— router: admin views, behind the portal session —— */

export const marketing = new Hono<PortalEnv>();

marketing.use('/admin/marketing/*', requireUser, requireAdmin);

marketing.get('/admin/marketing', async (c) => {
  const env = c.env;
  const settings = await readMarketingSettings(env);
  const t = now();
  const { dayStart } = localClock(settings.offsetMinutes, t);

  const [contacts, messages, today, due, next, events] = await Promise.all([
    env.DB.prepare('SELECT status, COUNT(*) AS n FROM marketing_contacts GROUP BY status').all<{ status: string; n: number }>(),
    env.DB.prepare('SELECT status, COUNT(*) AS n FROM marketing_messages GROUP BY status').all<{ status: string; n: number }>(),
    countSentToday(env, dayStart),
    env.DB.prepare(
      `SELECT channel, COUNT(*) AS n FROM marketing_messages
        WHERE status = 'scheduled' AND scheduled_at <= ? GROUP BY channel`,
    )
      .bind(t)
      .all<{ channel: string; n: number }>(),
    env.DB.prepare(`SELECT MIN(scheduled_at) AS at FROM marketing_messages WHERE status = 'scheduled'`)
      .first<{ at: number | null }>(),
    env.DB.prepare(
      `SELECT e.id, e.kind, e.detail, e.created_at, c.email AS contact_email
         FROM marketing_events e LEFT JOIN marketing_contacts c ON c.id = e.contact_id
        ORDER BY e.id DESC LIMIT 40`,
    ).all<{ id: number; kind: string; detail: string | null; created_at: number; contact_email: string | null }>(),
  ]);

  const counts = (rows: { status: string; n: number }[] | null, keys: readonly string[]) =>
    Object.fromEntries(keys.map((key) => [key, rows?.find((row) => row.status === key)?.n ?? 0]));

  const dueCounts = Object.fromEntries(['email', 'x', 'linkedin'].map((channel) => [channel, due.results?.find((r) => r.channel === channel)?.n ?? 0]));

  return out(c, {
    settings,
    sender: marketingFrom(env),
    inbox: marketingInbox(env),
    bound: Boolean(env.MARKETING),
    window: sendWindow(settings, t),
    today,
    counts: {
      contacts: counts(contacts.results, CONTACT_STATUSES),
      messages: counts(messages.results, ['draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled']),
    },
    due: dueCounts,
    nextAt: next?.at ?? null,
    events: (events.results ?? []).map((e) => ({
      id: e.id,
      kind: e.kind,
      detail: e.detail,
      email: e.contact_email,
      createdAt: e.created_at,
    })),
    sequences: Object.entries(SEQUENCE_LABELS).map(([key, label]) => ({ key, label, needsGap: SEQUENCE_NEEDS_GAP[key as SequenceKind] })),
  });
});

marketing.get('/admin/marketing/contacts', async (c) => {
  const status = c.req.query('status') ?? '';
  const q = (c.req.query('q') ?? '').trim().slice(0, 80);
  const where: string[] = [];
  const binds: unknown[] = [];
  if (status && (CONTACT_STATUSES as readonly string[]).includes(status)) {
    where.push('c.status = ?');
    binds.push(status);
  }
  if (q) {
    where.push('(c.email LIKE ? OR c.name LIKE ? OR c.business LIKE ? OR c.site LIKE ?)');
    const like = `%${q}%`;
    binds.push(like, like, like, like);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT c.*,
            (SELECT COUNT(*) FROM marketing_messages m WHERE m.contact_id = c.id AND m.status = 'sent') AS sent_count,
            (SELECT MIN(m.scheduled_at) FROM marketing_messages m WHERE m.contact_id = c.id AND m.status = 'scheduled') AS next_at
       FROM marketing_contacts c
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY c.updated_at DESC LIMIT 200`,
  )
    .bind(...binds)
    .all<Contact & { sent_count: number; next_at: number | null }>();
  return out(c, { contacts: (results ?? []).map(contactView) });
});

marketing.post('/admin/marketing/contacts', async (c) => {
  const env = c.env;
  const body = await jsonBody(c);
  const email = cleanEmail(body?.email);
  if (!email) return out(c, { error: 'bad_email' }, 400);

  const sequence = isSequenceKind(body?.sequence) ? body.sequence : null;
  const gap = text(body?.gap, 300);
  if (sequence && SEQUENCE_NEEDS_GAP[sequence] && !gap) return out(c, { error: 'gap_required' }, 400);

  const t = now();
  const contact = await env.DB.prepare(
    `INSERT INTO marketing_contacts
       (email, name, business, site, source, source_url, gap, consent_basis, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)
     ON CONFLICT(email) DO NOTHING
     RETURNING *`,
  )
    .bind(
      email,
      text(body?.name, 80),
      text(body?.business, 120),
      text(body?.site, 200),
      CONTACT_SOURCES.includes(String(body?.source)) ? String(body?.source) : 'manual',
      text(body?.sourceUrl, 500),
      gap,
      ['consent', 'existing_relationship', 'legitimate_interest'].includes(String(body?.consentBasis))
        ? String(body?.consentBasis)
        : 'legitimate_interest',
      text(body?.notes, 1000),
      t,
      t,
    )
    .first<Contact>();
  if (!contact) return out(c, { error: 'already_in_list' }, 409);

  if (sequence) await queueSequence(env, contact, sequence, text(body?.campaign, 40) ?? 'launch', t);
  const fresh = (await getContact(env, contact.id)) ?? contact;
  return out(c, { contact: contactView(fresh) }, 201);
});

marketing.post('/admin/marketing/contacts/import', async (c) => {
  const env = c.env;
  const body = await jsonBody(c);
  const csv = typeof body?.csv === 'string' ? body.csv : '';
  if (!csv.trim()) return out(c, { error: 'empty' }, 400);
  if (csv.length > 400_000) return out(c, { error: 'too_large' }, 413);

  const sequence = isSequenceKind(body?.sequence) ? body.sequence : 'cold_a';
  const campaign = text(body?.campaign, 40) ?? 'launch';
  const result = await importContacts(env, csv, sequence, campaign);
  return out(c, { ...result, sequence });
});

marketing.patch('/admin/marketing/contacts/:id', async (c) => {
  const env = c.env;
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return out(c, { error: 'bad_id' }, 400);
  const body = await jsonBody(c);
  if (!body) return out(c, { error: 'bad_json' }, 400);

  const updates: string[] = [];
  const binds: unknown[] = [];
  const set = (column: string, value: unknown) => {
    updates.push(`${column} = ?`);
    binds.push(value);
  };
  if (body.name !== undefined) set('name', text(body.name, 80));
  if (body.business !== undefined) set('business', text(body.business, 120));
  if (body.site !== undefined) set('site', text(body.site, 200));
  if (body.gap !== undefined) set('gap', text(body.gap, 300));
  if (body.notes !== undefined) set('notes', text(body.notes, 1000));

  let cancel = false;
  if (body.status !== undefined) {
    if (!['new', 'paused', 'opted_out'].includes(String(body.status))) return out(c, { error: 'bad_status' }, 400);
    set('status', String(body.status));
    if (body.status === 'opted_out') {
      set('opted_out_at', now());
      cancel = true;
    }
    if (body.status === 'paused') cancel = true;
  }
  if (!updates.length) return out(c, { error: 'nothing_to_update' }, 400);

  set('updated_at', now());
  const contact = await env.DB.prepare(
    `UPDATE marketing_contacts SET ${updates.join(', ')} WHERE id = ? RETURNING *`,
  )
    .bind(...binds, id)
    .first<Contact>();
  if (!contact) return out(c, { error: 'not_found' }, 404);
  if (cancel) await cancelScheduled(env, id);
  return out(c, { contact: contactView(contact) });
});

marketing.post('/admin/marketing/contacts/:id/queue', async (c) => {
  const env = c.env;
  const id = Number(c.req.param('id'));
  const body = await jsonBody(c);
  if (!Number.isInteger(id)) return out(c, { error: 'bad_id' }, 400);
  const contact = await getContact(env, id);
  if (!contact) return out(c, { error: 'not_found' }, 404);
  if (['opted_out', 'bounced', 'replied'].includes(contact.status)) return out(c, { error: 'contact_closed' }, 409);

  const sequence = isSequenceKind(body?.sequence) ? body.sequence : 'cold_a';
  if (SEQUENCE_NEEDS_GAP[sequence] && !contact.gap) return out(c, { error: 'gap_required' }, 400);

  const existing = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM marketing_messages WHERE contact_id = ? AND status = 'scheduled'`,
  )
    .bind(id)
    .first<{ n: number }>();
  if (existing?.n) return out(c, { error: 'already_queued' }, 409);

  const queued = await queueSequence(env, contact, sequence, text(body?.campaign, 40) ?? 'launch', now());
  return out(c, { ok: true, queued });
});

/* —— messages —— */

interface Message {
  id: number;
  channel: 'email' | 'x' | 'linkedin';
  kind: string;
  contact_id: number | null;
  campaign: string;
  step: number;
  to_email: string | null;
  subject: string | null;
  body: string;
  status: string;
  scheduled_at: number | null;
  sent_at: number | null;
  external_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export function messageView(m: Message & { contact_email?: string | null }) {
  return {
    id: m.id,
    channel: m.channel,
    kind: m.kind,
    contactId: m.contact_id,
    contactEmail: m.contact_email ?? m.to_email,
    campaign: m.campaign,
    step: m.step,
    subject: m.subject,
    body: m.body,
    status: m.status,
    scheduledAt: m.scheduled_at,
    sentAt: m.sent_at,
    url: m.external_id,
    error: m.error,
    createdAt: m.created_at,
  };
}

marketing.get('/admin/marketing/messages', async (c) => {
  const status = c.req.query('status') ?? '';
  const channel = c.req.query('channel') ?? '';
  const where: string[] = [];
  const binds: unknown[] = [];
  if (status) {
    where.push('m.status = ?');
    binds.push(status);
  }
  if (['email', 'x', 'linkedin'].includes(channel)) {
    where.push('m.channel = ?');
    binds.push(channel);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT m.*, c.email AS contact_email
       FROM marketing_messages m LEFT JOIN marketing_contacts c ON c.id = m.contact_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY COALESCE(m.scheduled_at, m.created_at) DESC, m.id DESC LIMIT 200`,
  )
    .bind(...binds)
    .all<Message & { contact_email: string | null }>();
  return out(c, { messages: (results ?? []).map(messageView) });
});

marketing.post('/admin/marketing/messages', async (c) => {
  const env = c.env;
  const body = await jsonBody(c);
  const channel = body?.channel;
  if (channel !== 'email' && channel !== 'x' && channel !== 'linkedin') return out(c, { error: 'bad_channel' }, 400);

  const textBody = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!textBody) return out(c, { error: 'empty' }, 400);
  if (textBody.length > 20_000) return out(c, { error: 'too_long' }, 413);

  const contactId = Number(body?.contactId);
  const contact = channel === 'email' ? await getContact(env, contactId) : null;
  if (channel === 'email' && !contact) return out(c, { error: 'contact_required' }, 400);
  if (contact && ['opted_out', 'bounced'].includes(contact.status)) return out(c, { error: 'contact_closed' }, 409);

  const scheduledAt = Number(body?.scheduledAt);
  const when = Number.isFinite(scheduledAt) && scheduledAt > 0 ? scheduledAt : null;
  const t = now();
  const message = await env.DB.prepare(
    `INSERT INTO marketing_messages
       (channel, kind, contact_id, campaign, step, to_email, subject, body, status, scheduled_at, created_at, updated_at)
     VALUES (?, 'manual', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  )
    .bind(
      channel,
      contact?.id ?? null,
      text(body?.campaign, 40) ?? 'launch',
      contact?.email ?? null,
      channel === 'email' ? text(body?.subject, 200) : null,
      textBody,
      when ? 'scheduled' : 'draft',
      when,
      t,
      t,
    )
    .first<Message>();
  if (!message) return out(c, { error: 'insert_failed' }, 500);
  return out(c, { message: messageView(message) }, 201);
});

/**
 * Rewrite a social post before it goes out. The text is the whole message, so
 * it must fit the channel; a post already claimed by the publisher, or sent,
 * is the record and is not edited.
 */
marketing.patch('/admin/marketing/messages/:id', async (c) => {
  const env = c.env;
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return out(c, { error: 'bad_id' }, 400);
  const body = await jsonBody(c);

  const message = await env.DB.prepare('SELECT id, channel, status FROM marketing_messages WHERE id = ?')
    .bind(id)
    .first<{ id: number; channel: string; status: string }>();
  if (!message) return out(c, { error: 'not_found' }, 404);
  if (message.channel === 'email') return out(c, { error: 'not_a_post' }, 400);
  if (!['draft', 'scheduled', 'failed'].includes(message.status)) return out(c, { error: 'not_editable' }, 409);

  const text = (typeof body?.body === 'string' ? body.body : '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return out(c, { error: 'empty' }, 400);
  const max = message.channel === 'x' ? 280 : 3_000;
  if (text.length > max) return out(c, { error: 'too_long', max, length: text.length }, 400);

  const updated = await env.DB.prepare(
    `UPDATE marketing_messages SET body = ?, updated_at = ?
      WHERE id = ? AND status IN ('draft', 'scheduled', 'failed') RETURNING *`,
  )
    .bind(text, now(), id)
    .first<Message>();
  if (!updated) return out(c, { error: 'not_editable' }, 409);
  return out(c, { message: messageView(updated) });
});

marketing.post('/admin/marketing/messages/:id/schedule', async (c) => {
  const env = c.env;
  const id = Number(c.req.param('id'));
  const body = await jsonBody(c);
  if (!Number.isInteger(id)) return out(c, { error: 'bad_id' }, 400);
  const at = Number(body?.at);
  const when = Number.isFinite(at) && at > 0 ? Math.floor(at) : now();
  const message = await env.DB.prepare(
    `UPDATE marketing_messages SET status = 'scheduled', scheduled_at = ?, updated_at = ?
      WHERE id = ? AND status IN ('draft', 'failed') RETURNING *`,
  )
    .bind(when, now(), id)
    .first<Message>();
  if (!message) return out(c, { error: 'not_schedulable' }, 409);
  return out(c, { message: messageView(message) });
});

marketing.post('/admin/marketing/messages/:id/cancel', async (c) => {
  const env = c.env;
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return out(c, { error: 'bad_id' }, 400);
  const message = await env.DB.prepare(
    `UPDATE marketing_messages SET status = 'cancelled', updated_at = ?
      WHERE id = ? AND status IN ('draft', 'scheduled', 'failed') RETURNING *`,
  )
    .bind(now(), id)
    .first<Message>();
  if (!message) return out(c, { error: 'not_cancellable' }, 409);
  return out(c, { message: messageView(message) });
});

/** Send one email now, from the admin view. Still needs the sender and a postal address. */
marketing.post('/admin/marketing/messages/:id/send', async (c) => {
  const env = c.env;
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return out(c, { error: 'bad_id' }, 400);

  const message = await env.DB.prepare(
    `SELECT m.*, c.status AS contact_status FROM marketing_messages m
       LEFT JOIN marketing_contacts c ON c.id = m.contact_id
      WHERE m.id = ?`,
  )
    .bind(id)
    .first<Message & { contact_status: string | null }>();
  if (!message) return out(c, { error: 'not_found' }, 404);
  if (message.channel !== 'email') {
    const scheduled = await env.DB.prepare(
      `UPDATE marketing_messages SET status = 'scheduled', scheduled_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('draft', 'scheduled', 'failed') RETURNING *`,
    )
      .bind(now(), now(), id)
      .first<Message>();
    if (!scheduled) return out(c, { error: 'not_sendable' }, 409);
    return out(c, { ok: true, scheduled: true, message: messageView(scheduled) });
  }

  if (!['draft', 'scheduled', 'failed'].includes(message.status)) return out(c, { error: 'not_sendable' }, 409);
  if (message.contact_status && ['opted_out', 'bounced', 'replied'].includes(message.contact_status)) {
    return out(c, { error: 'contact_closed' }, 409);
  }
  const settings = await readMarketingSettings(env);
  if (!env.MARKETING) return out(c, { error: 'sender_unbound' }, 503);
  if (!settings.postalAddress) return out(c, { error: 'postal_address_unset' }, 400);

  const claimed = await env.DB.prepare(
    `UPDATE marketing_messages SET status = 'sending', updated_at = ?
      WHERE id = ? AND status IN ('draft', 'scheduled', 'failed') RETURNING id, contact_id, to_email, subject, body`,
  )
    .bind(now(), id)
    .first<ClaimedEmail>();
  if (!claimed) return out(c, { error: 'not_sendable' }, 409);

  const ok = await deliverEmail(env, settings, claimed);
  if (!ok) return out(c, { error: 'send_failed' }, 502);
  const fresh = await env.DB.prepare('SELECT * FROM marketing_messages WHERE id = ?').bind(id).first<Message>();
  return out(c, { ok: true, message: fresh ? messageView(fresh) : null });
});

marketing.post('/admin/marketing/messages/:id/retry', async (c) => {
  const env = c.env;
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return out(c, { error: 'bad_id' }, 400);
  const message = await env.DB.prepare(
    `UPDATE marketing_messages SET status = 'scheduled', scheduled_at = ?, error = NULL, updated_at = ?
      WHERE id = ? AND status = 'failed' RETURNING *`,
  )
    .bind(now(), now(), id)
    .first<Message>();
  if (!message) return out(c, { error: 'not_failed' }, 409);
  return out(c, { message: messageView(message) });
});

/* —— settings and a manual run —— */

marketing.put('/admin/marketing/settings', async (c) => {
  const body = await jsonBody(c);
  if (!body) return out(c, { error: 'bad_json' }, 400);
  const rejected = await saveMarketingSettings(c.env, body);
  return out(c, { settings: await readMarketingSettings(c.env), rejected });
});

marketing.post('/admin/marketing/run', async (c) => {
  const summary = await runMarketing(c.env);
  return out(c, summary);
});

/** File a content cycle now, past the daily and weekly gates (never past an open one). */
marketing.post('/admin/marketing/cycle', async (c) => {
  const result = await ensureContentCycle(c.env, now(), { force: c.req.query('force') === '1' });
  return out(c, result, result.filed ? 201 : 200);
});

/* —— router: the local publisher, machine-auth only —— */

export const publisher = new Hono<HonoEnv>();

publisher.use('/marketing/publisher/*', async (c, next) => {
  const secret = c.env.MARKETING_TOKEN;
  if (!secret) return out(c, { error: 'not_found' }, 404);
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !sameText(token, secret)) return out(c, { error: 'unauthorized' }, 401);
  return next();
});

/**
 * Hand the publisher what is due. A post is claimed here (status `sending`),
 * so a second run cannot post it again; a claim older than half an hour is
 * handed back, because a crashed browser must not strand a post forever.
 */
publisher.get('/marketing/publisher/posts', async (c) => {
  const env = c.env;
  const channel = c.req.query('channel') ?? '';
  if (channel !== 'x' && channel !== 'linkedin') return out(c, { error: 'bad_channel' }, 400);
  const t = now();
  // A dry run shows what would go out without claiming it.
  const dry = c.req.query('dry') === '1';
  if (dry) {
    const { results } = await env.DB.prepare(
      `SELECT id, body, created_at FROM marketing_messages
        WHERE channel = ? AND status = 'scheduled' AND scheduled_at <= ?
        ORDER BY scheduled_at LIMIT 5`,
    )
      .bind(channel, t)
      .all<{ id: number; body: string; created_at: number }>();
    return out(c, {
      posts: (results ?? []).map((row) => ({ id: row.id, channel, text: row.body, createdAt: row.created_at })),
      dry: true,
    });
  }

  await env.DB.prepare(
    `UPDATE marketing_messages SET status = 'scheduled', updated_at = ?
      WHERE channel = ? AND status = 'sending' AND updated_at < ?`,
  )
    .bind(t, channel, t - 1800)
    .run();

  const { results } = await env.DB.prepare(
    `SELECT id FROM marketing_messages
      WHERE channel = ? AND status = 'scheduled' AND scheduled_at <= ?
      ORDER BY scheduled_at LIMIT 5`,
  )
    .bind(channel, t)
    .all<{ id: number }>();

  const posts: { id: number; channel: string; text: string; createdAt: number }[] = [];
  for (const row of results ?? []) {
    const claimed = await env.DB.prepare(
      `UPDATE marketing_messages SET status = 'sending', updated_at = ?
        WHERE id = ? AND status = 'scheduled'
        RETURNING id, channel, body, created_at`,
    )
      .bind(t, row.id)
      .first<{ id: number; channel: string; body: string; created_at: number }>();
    if (claimed) posts.push({ id: claimed.id, channel: claimed.channel, text: claimed.body, createdAt: claimed.created_at });
  }
  return out(c, { posts });
});

publisher.post('/marketing/publisher/posts/:id/result', async (c) => {
  const env = c.env;
  const id = Number(c.req.param('id'));
  const body = await jsonBody(c);
  if (!Number.isInteger(id)) return out(c, { error: 'bad_id' }, 400);

  const ok = body?.ok === true;
  const url = typeof body?.url === 'string' ? body.url.trim().slice(0, 500) : null;
  const error = typeof body?.error === 'string' ? body.error.trim().slice(0, 500) : 'unknown';
  const t = now();

  const message = await env.DB.prepare(
    `UPDATE marketing_messages SET status = ?, sent_at = ?, external_id = ?, error = ?, updated_at = ?
      WHERE id = ? AND status = 'sending' RETURNING id, contact_id`,
  )
    .bind(ok ? 'sent' : 'failed', ok ? t : null, url, ok ? null : error, t, id)
    .first<{ id: number; contact_id: number | null }>();
  if (!message) return out(c, { error: 'not_claimed' }, 409);

  await logEvent(env, {
    messageId: message.id,
    contactId: message.contact_id,
    kind: ok ? 'published' : 'failed',
    detail: ok ? url : error,
  });
  return out(c, { ok: true });
});
