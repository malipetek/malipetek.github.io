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
 *
 * Two senders: Cloudflare's MARKETING binding (small volume) and Amazon SES
 * (src/ses.ts, the volume one). Either way every email carries a one-click
 * List-Unsubscribe header, and the cron pauses the desk by itself when the
 * bounce or complaint rate climbs towards what gets an SES account reviewed.
 */
import { Hono, type Context } from 'hono';
import { json, now, primaryAdminEmail, type Env, type HonoEnv } from './shared.ts';
import { mailAli, requireAdmin, requireUser, siteUrl, type PortalEnv } from './portal.ts';
import { cleanPost, ensureContentCycle } from './content.ts';
import { sesConfigured, sesSend } from './ses.ts';

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
  /** Which service sends outreach email: Cloudflare's binding or Amazon SES. */
  provider: 'cloudflare' | 'ses';
  /** Posts the content cycle writes wait as drafts until approved in the desk. */
  postApproval: boolean;
  /** Only first emails Ali reviewed or rewrote go out; follow-ups ride on them. */
  reviewFirst: boolean;
  /** Which emails carry the workshop GIF (EMAIL_IMAGE) above the signature. */
  image: 'off' | 'first' | 'all';
  /** A health pause lifts itself a week later when the numbers have calmed. */
  autoResume: boolean;
  /** Share of observed contacts (id % 100 under this) that try cold_obs. */
  obsShare: number;
  /** Hours a cycle's posts wait as drafts before they schedule themselves; 0 waits for Ali. */
  postHoldHours: number;
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
  provider: 'cloudflare',
  postApproval: true,
  reviewFirst: false,
  image: 'first',
  autoResume: true,
  obsShare: 50,
  postHoldHours: 24,
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
  provider: 'marketing_provider',
  postApproval: 'marketing_post_approval',
  reviewFirst: 'marketing_review_first',
  image: 'marketing_image',
  autoResume: 'marketing_auto_resume',
  obsShare: 'marketing_obs_share',
  postHoldHours: 'marketing_post_hold_hours',
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
  // SES allows 50,000 a day; the cap is ours to raise slowly (see the desk's warm-up hint).
  dailyCap: int(1, 50_000),
  perRun: int(1, 200),
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
  provider: (raw) => (raw === 'cloudflare' || raw === 'ses' ? raw : undefined),
  postApproval: (raw) => (typeof raw === 'boolean' ? raw : undefined),
  reviewFirst: (raw) => (typeof raw === 'boolean' ? raw : undefined),
  image: (raw) => (raw === 'off' || raw === 'first' || raw === 'all' ? raw : undefined),
  autoResume: (raw) => (typeof raw === 'boolean' ? raw : undefined),
  obsShare: int(0, 100),
  postHoldHours: int(0, 168),
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
  return env.MARKETING_FROM_EMAIL || 'hello@ptechsolutions.net';
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

export type SequenceKind = 'cold_a' | 'cold_b' | 'cold_obs' | 'nosite' | 'warm';

interface SequenceStep {
  kind: string;
  /** Days after the previous step was queued, not after it was sent. */
  day: number;
  subject: string;
  body: string;
  /**
   * The same step for a contact with no observation written yet. A step whose
   * body leans on {{gap}} ("I looked at your site and noticed…") must have one:
   * without a real observation that sentence would be untrue.
   */
  plain?: string;
}

/*
 * The copy in marketing/style/voice.md's shape: sorting questions first,
 * numbered steps, the price as a number, one action, literal words. `{{gap}}`
 * is the one true observation; without it a cold email is spam, so a contact
 * that lacks one is held rather than sent.
 */
const COLD_OPT_OUT = 'Not useful? Reply “stop” and I will not write again.';

function coldFollowUps(subject: string): SequenceStep[] {
  return [
    { kind: 'followup_1', day: 4, subject, body: `{{greeting}}

Should I take that fix? A one-line reply is enough. If it is not a fit, tell me and I will stop.

${COLD_OPT_OUT}` },
    { kind: 'followup_2', day: 10, subject, body: `{{greeting}}

Last note from me. If it comes up later, the door is open: ptechsolutions.net/portal. No call, no quote.

Muhammet

${COLD_OPT_OUT}` },
  ];
}

export const SEQUENCES: Record<SequenceKind, SequenceStep[]> = {
  cold_a: [
    { kind: 'first', day: 0, subject: 'saw this on {{site}}', body: `{{greeting}}

{{gap}}

I fix exactly that kind of last-mile thing. The agent does the typing in a sealed copy; I check it and sign off before anything goes live.

The first five pilot jobs came to $2.18–$8.25, no minimum, and you see the price before I start. If it is a five-minute fix, I do it for free.

Want me to fix this one? Reply “yes” and I will tell you what it takes.

Muhammet
ptechsolutions.net

${COLD_OPT_OUT}` },
    ...coldFollowUps('saw this on {{site}}'),
  ],
  cold_b: [
    { kind: 'first', day: 0, subject: '{{business}} — quick one', body: `{{greeting}}

I saw you are updating {{trigger}}.

{{gap}}

I do small last-mile fixes: the agent types, I check and sign off, and you see the price before I start. The first five pilot jobs were $2.18–$8.25, no minimum.

Want me to take this one? Reply with the page and I will tell you what it costs.

Muhammet
ptechsolutions.net

${COLD_OPT_OUT}` },
    ...coldFollowUps('{{business}} — quick one'),
  ],
  cold_obs: [
    {
      kind: 'first',
      day: 0,
      subject: '{{site}}',
      body: `{{greeting}}

{{gap}}

Do you want it fixed?

1. Reply "yes".
2. An AI agent makes the fix. A developer checks it.
3. You check a preview. It goes live when you say yes.

Price: $100 an hour, billed by the second. A one-minute fix costs $1.67. No minimum.

Muhammet
ptechsolutions.net

${COLD_OPT_OUT}`,
    },
    {
      kind: 'followup_1',
      day: 4,
      subject: '{{site}}',
      body: `{{greeting}}

Do you want the fix on {{site}}?
Reply "yes" or "no".

Muhammet

${COLD_OPT_OUT}`,
    },
    {
      kind: 'followup_2',
      day: 10,
      subject: '{{site}}',
      body: `{{greeting}}

This is my last email.

Muhammet

${COLD_OPT_OUT}`,
    },
  ],
  // For a business a mapper recorded with an email and no website
  // (marketing/prospector/osm.mjs → the mail-only CSV). It says where we found
  // them, because that is the honest answer to "how did you get my address".
  nosite: [
    {
      kind: 'first',
      day: 0,
      subject: 'a website for {{business}}?',
      body: `{{greeting}}

{{business}} is on OpenStreetMap with an email address and no website.

Do you want a website?

1. Reply "yes" with one line about the business.
2. We build a preview. The first preview of a new site is free.
3. It goes live only when you say yes.

After that: $100 an hour, billed by the second. No minimum.

Muhammet
ptechsolutions.net

${COLD_OPT_OUT}`,
    },
    {
      kind: 'followup_1',
      day: 4,
      subject: 'a website for {{business}}?',
      body: `{{greeting}}

Do you want a website for {{business}}?
Reply "yes" or "no".

Muhammet

${COLD_OPT_OUT}`,
    },
    {
      kind: 'followup_2',
      day: 10,
      subject: 'a website for {{business}}?',
      body: `{{greeting}}

This is my last email.

Muhammet

${COLD_OPT_OUT}`,
    },
  ],
  warm: [
    {
      kind: 'first',
      day: 0,
      subject: 'a favour?',
      body: `{{greeting}}

I started PTech Solutions. A developer checks what an AI agent builds, and clients pay by the second.

Do you have a website change you want done?
Do you know someone who does?

1. They write it at ptechsolutions.net/portal.
2. A developer approves it. An AI agent does the work.
3. They check a preview. It goes live when they say yes.

$100 an hour, billed by the second. No minimum.

Muhammet
PTech Solutions`,
    },
    {
      kind: 'followup_1',
      day: 4,
      subject: 'a favour?',
      body: `{{greeting}}

Is there one change you want on {{site}}?
Or one person I should write to?

Reply with it.

Muhammet`,
    },
    {
      kind: 'followup_2',
      day: 10,
      subject: 'a favour?',
      body: `{{greeting}}

This is my last email.

If you need a website change later: ptechsolutions.net/portal

Muhammet
PTech Solutions`,
    },
  ],
};

export const SEQUENCE_LABELS: Record<SequenceKind, string> = {
  cold_a: 'Cold A: vibe coding or an agency',
  cold_b: 'Cold B: a change on their site',
  cold_obs: 'Cold: opens on the observation of their site',
  nosite: 'No website: an email on the map, no site',
  warm: 'Warm: past collaborators',
};

export const SEQUENCE_NEEDS_GAP: Record<SequenceKind, boolean> = { cold_a: true, cold_b: true, cold_obs: true, nosite: false, warm: false };

export function isSequenceKind(value: unknown): value is SequenceKind {
  return typeof value === 'string' && Object.hasOwn(SEQUENCES, value);
}

export interface ContactFields {
  name: string | null;
  business: string | null;
  site: string | null;
  gap: string | null;
  trigger?: string | null;
}

/** Fill the copy in. An empty site or gap reads as a neutral phrase, never a dangling em dash. */
/** A site as a person would write it in a sentence: "watercoursefoods.com", not the full URL. */
export function siteLabel(site: string | null | undefined): string {
  const raw = (site ?? '').trim();
  if (!raw) return '';
  const bare = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  // Only the host when the address is a homepage; a deeper path is kept as written.
  return /^[^/]+\/?$/.test(bare) ? bare.replace(/\/$/, '') : bare;
}

export function fillTemplate(text: string, contact: ContactFields): string {
  const first = contact.name?.trim().split(/\s+/)[0] ?? '';
  const site = siteLabel(contact.site);
  const business = contact.business || site || 'your business';
  return text
    .replaceAll('{{greeting}}', first ? `Hi ${first},` : 'Hi,')
    .replaceAll('{{business}}', business)
    .replaceAll('{{site}}', site || 'your site')
    .replaceAll('{{gap}}', () => contact.gap?.trim() || '')
    .replaceAll('{{trigger}}', () => contact.trigger?.trim() || '');
}

/* ——————————————————————— contacts ——————————————————————— */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_CHARS = 254;
// Control characters SES refuses outright ("Local address contains control or
// whitespace"): anything under 0x20 or 0x7f that a paste can smuggle in.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x1f\x7f]/;

/**
 * An address SES will accept: no whitespace or control characters, exactly
 * one @, a non-empty local part, a dotted domain, 254 characters or fewer.
 * cleanEmail trims and lowercases first; this checks what is left.
 */
export function validEmail(addr: string): boolean {
  if (typeof addr !== 'string' || !addr || addr.length > MAX_EMAIL_CHARS) return false;
  if (CONTROL_RE.test(addr) || /\s/.test(addr)) return false;
  const parts = addr.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain || !domain.includes('.')) return false;
  return EMAIL_RE.test(addr);
}

export function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email && validEmail(email) ? email : null;
}

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const out = value.trim();
  return out ? out.slice(0, max) : null;
};

const ROLE_NAMES = new Set('info information hello contact sales support admin administrator office team enquiries inquiries enquiry inquiry mail help helpdesk billing marketing noreply donotreply webmaster postmaster abuse reception service customerservice general accounts careers jobs press media privacy legal'.split(' '));

export function isRoleAccount(email: string): boolean {
  return ROLE_NAMES.has(email.split('@')[0].toLowerCase().split('+')[0].replace(/[._-]/g, ''));
}

/**
 * How long a social post counts as, per network. X charges 23 characters for a
 * link however long it is, so counting the text raw refuses posts X itself
 * accepts. The desk counts this way too; both sides must agree or the editor
 * says a post fits and the save then rejects it.
 */
export function countedPostLength(body: string, channel: string): number {
  const text = String(body ?? '');
  if (channel !== 'x') return text.length;
  return text.replace(/https?:\/\/\S+/g, (url) => 'x'.repeat(Math.min(url.length, 23))).length;
}

/** The limit each network accepts, for the same reason. */
export const POST_MAX: Record<string, number> = { x: 280, linkedin: 3000 };

export function cleanVerifiedAt(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 && value < 253402300800 ? value : null;
  if (typeof value !== 'string') return null;
  const date = value.trim();
  if (/^\d+$/.test(date)) return cleanVerifiedAt(Number(date));
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(date)) return null;
  const ms = Date.parse(date);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date.slice(0, 10) ? cleanVerifiedAt(Math.floor(ms / 1000)) : null;
}

const overrideReason = (body: { force?: unknown; reason?: unknown; forceReason?: unknown } | null) =>
  body?.force === true ? text(body.reason ?? body.forceReason, 500) : null;

function queueReasons(contact: Pick<Contact, 'email' | 'status' | 'opted_out_at' | 'gap' | 'trigger' | 'quality_hold'>, sequence: SequenceKind, reason: string | null): string[] {
  const reasons: string[] = [];
  if (contact.status === 'bounced') reasons.push('bounced');
  if (contact.opted_out_at || contact.status === 'opted_out') reasons.push('suppressed');
  if (contact.status === 'replied') reasons.push('contact_closed');
  if (!reason && isRoleAccount(contact.email)) reasons.push('role_account');
  if (contact.quality_hold && !(contact.quality_hold === 'role_account' && isRoleAccount(contact.email))) reasons.push('quality_hold');
  if (SEQUENCE_NEEDS_GAP[sequence] && !contact.gap?.trim()) reasons.push('gap_required');
  if (SEQUENCE_NEEDS_GAP[sequence] && !contact.trigger?.trim()) reasons.push('trigger_required');
  return reasons;
}

export interface Contact {
  id: number;
  email: string;
  name: string | null;
  business: string | null;
  site: string | null;
  source: string;
  source_url: string | null;
  trigger: string | null;
  trigger_url: string | null;
  verified_at: number | null;
  quality_hold: string | null;
  gap: string | null;
  consent_basis: string;
  status: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
  last_contacted_at: number | null;
  opted_out_at: number | null;
  /** Which list or method found the address (`osm-co-mail-only`, `bulk-tranco`…), for per-source rates. */
  source_kind: string | null;
  /** ISO 3166-1 alpha-2, when known. Gates sending: see CONSENT_COUNTRIES. */
  country: string | null;
}

/**
 * Countries where unsolicited commercial email needs prior consent, business
 * addresses included. A contact here is never mailed cold, whatever the list
 * says; the send is cancelled at claim time with the reason on the row.
 */
export const CONSENT_COUNTRIES = new Set(['DE', 'AT', 'CH', 'IT', 'ES', 'PL', 'DK', 'NO', 'TR']);

export function cleanCountry(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function cleanSourceKind(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const kind = value
    .trim()
    .toLowerCase()
    .replace(/\.csv$/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return kind || null;
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
    trigger: c.trigger,
    triggerUrl: c.trigger_url,
    verifiedAt: c.verified_at,
    qualityHold: c.quality_hold,
    gap: c.gap,
    consentBasis: c.consent_basis,
    status: c.status,
    notes: c.notes,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    lastContactedAt: c.last_contacted_at,
    optedOutAt: c.opted_out_at,
    sourceKind: c.source_kind ?? null,
    country: c.country ?? null,
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

/** The body a step sends: its plain version when the contact has no observation. */
export function stepBody(step: SequenceStep, specificGap: boolean): string {
  return specificGap || !step.plain ? step.body : step.plain;
}

/**
 * Which sequence a queued message belongs to, from its subject: the messages
 * table keeps the step, not the sequence.
 */
export function sequenceOfSubject(subject: string | null): SequenceKind | null {
  const s = subject ?? '';
  // Old subjects stay listed: mail queued under them must still re-render.
  if (s.startsWith('saw this on ')) return 'cold_a';
  if (s.endsWith(' — quick one')) return 'cold_b';
  if (/^(Re: )?(The last mile of |Vibe contracting$)/.test(s)) return 'cold_a';
  if (/^(Re: )?(The smallest thing on |A small fix on |Vibe contracting for )/.test(s)) return 'cold_b';
  if (/^(Re: )?A small experiment/.test(s)) return 'warm';
  if (/^(Re: )?A website for /.test(s)) return 'nosite';
  // The literal-voice subjects: one per sequence, no "Re:" threading.
  if (/^vibe coding or an agency\?$/.test(s)) return 'cold_a';
  if (/^a change on .+\?$/.test(s)) return 'cold_b';
  if (/^a website for .+\?$/.test(s)) return 'nosite';
  if (/^a favour\?$/.test(s)) return 'warm';
  // The observation sequence's subject is the bare domain ("corroof.com",
  // "Re: corroof.com"); no other sequence's subject is only a hostname.
  if (/^(Re: )?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(s)) return 'cold_obs';
  return null;
}

/**
 * Re-render every scheduled email from the current templates, so a wording
 * change reaches mail that is already queued. Keeps each message's slot,
 * recipient and step; a message whose sequence cannot be told is left alone.
 */
export async function rerenderScheduled(
  env: Env,
  move: { from?: SequenceKind; to?: SequenceKind; contactId?: number } = {},
): Promise<{ updated: number; skipped: number; moved: number }> {
  const scoped = move.contactId !== undefined;
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.step, m.subject, m.sequence_kind, c.email, c.name, c.business, c.site, c.gap, c.trigger
       FROM marketing_messages m JOIN marketing_contacts c ON c.id = m.contact_id
      WHERE m.channel = 'email' AND m.status = 'scheduled'
        -- A hand-edited email is Ali's wording; a template change must not overwrite it.
        AND m.edited_at IS NULL${scoped ? ' AND m.contact_id = ?' : ''}`,
  )
    .bind(...(scoped ? [move.contactId as number] : []))
    .all<{ id: number; step: number; subject: string | null; sequence_kind: SequenceKind | null; email: string; name: string | null; business: string | null; site: string | null; gap: string | null; trigger: string | null }>();
  const t = now();
  const updates: D1PreparedStatement[] = [];
  let skipped = 0;
  let moved = 0;
  for (const row of results ?? []) {
    const current = row.sequence_kind ?? sequenceOfSubject(row.subject);
    // Moving a sequence keeps each message's step and slot: the sequences share
    // their step days, so only the words change.
    const kind = current && move.from && move.to && current === move.from ? move.to : current;
    const step = kind ? SEQUENCES[kind][row.step] : undefined;
    if (!step || (kind && SEQUENCE_NEEDS_GAP[kind] && (!row.gap?.trim() || !row.trigger?.trim()))) {
      skipped += 1;
      continue;
    }
    if (kind !== current) moved += 1;
    const fields = row;
    updates.push(
      env.DB.prepare('UPDATE marketing_messages SET subject = ?, body = ?, sequence_kind = ?, updated_at = ? WHERE id = ? AND status = ? AND edited_at IS NULL').bind(
        fillTemplate(step.subject, fields),
        fillTemplate(step.body, fields),
        kind,
        t,
        row.id,
        'scheduled',
      ),
    );
  }
  for (const batch of chunk(updates, 50)) await env.DB.batch(batch);
  return { updated: updates.length, skipped, moved };
}

const PAGE = 200;

const chunk = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/** The three message inserts for one contact. */
function sequenceStatements(
  env: Env,
  contact: Contact,
  kind: SequenceKind,
  campaign: string,
  startAt: number,
  roleReason: string | null,
): D1PreparedStatement[] {
  const fields = contact;
  const t = now();
  return SEQUENCES[kind].map((step, index) =>
    env.DB.prepare(
      `INSERT INTO marketing_messages
         (channel, kind, contact_id, campaign, step, to_email, subject, body, status, scheduled_at, created_at, updated_at, role_override_reason, sequence_kind)
       VALUES ('email', ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?)`,
    ).bind(
      step.kind,
      contact.id,
      campaign,
      index,
      contact.email,
      fillTemplate(step.subject, fields),
      fillTemplate(step.body, fields),
      startAt + step.day * 86400,
      t,
      t,
      isRoleAccount(contact.email) ? roleReason : null,
       kind,
    ),
  );
}

/**
 * Queue many contacts in a few D1 batches. One contact's three inserts and its
 * status update stay together; twenty contacts per batch keeps the statement
 * count well inside D1's limit and avoids a round trip per contact.
 */
async function queueContacts(
  env: Env,
  contacts: Contact[],
  kind: SequenceKind,
  campaign: string,
  startAt: number,
  roleReason: string | null = null,
): Promise<{ contacts: number; messages: number }> {
  let contactsQueued = 0;
  let messages = 0;
  let offset = 0;
  for (const part of chunk(contacts, 20)) {
    const statements: D1PreparedStatement[] = [];
    for (const contact of part) {
      statements.push(...sequenceStatements(env, contact, kind, campaign, startAt + offset * 120, roleReason));
      statements.push(
        env.DB.prepare(
          `UPDATE marketing_contacts SET status = 'queued', updated_at = ?
            WHERE id = ? AND status IN ('new', 'paused')`,
        ).bind(now(), contact.id),
      );
      if (roleReason && isRoleAccount(contact.email)) statements.push(env.DB.prepare(
        `INSERT INTO marketing_events (contact_id, kind, detail, created_at) VALUES (?, 'role_override', ?, ?)`
      ).bind(contact.id, roleReason, now()));
      offset += 1;
    }
    if (statements.length) await env.DB.batch(statements);
    contactsQueued += part.length;
    messages += part.length * SEQUENCES[kind].length;
  }
  return { contacts: contactsQueued, messages };
}

/** Queue a whole sequence for one contact. */
async function queueSequence(
  env: Env,
  contact: Contact,
  kind: SequenceKind,
  campaign: string,
  startAt: number,
  roleReason: string | null,
): Promise<number> {
  const out = await queueContacts(env, [contact], kind, campaign, startAt, roleReason);
  return out.messages;
}

/* —— template sync —— */

/**
 * A fingerprint of everything the queue's wording depends on: the sequences
 * and the footer skeleton (the names inside it are settings, not templates).
 * When it changes, the cron re-renders the queue by itself.
 */
export async function templateHash(): Promise<string> {
  const material = JSON.stringify({
    sequences: SEQUENCES,
    footer: footerFor({ fromName: '{{fromName}}', postalAddress: '{{postalAddress}}' } as MarketingSettings),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function readTextSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  if (!row) return null;
  try {
    const value = JSON.parse(row.value);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

async function writeTextSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, JSON.stringify(value), now())
    .run();
}

/**
 * A scheduled email the re-render cannot save: its subject maps to no
 * sequence, or its body still carries the retired domain. Exported for tests.
 */
export function outdatedEmail(row: { kind?: string | null; subject: string | null; body: string | null }): boolean {
  // A message composed by hand belongs to no sequence; it is never a leftover.
  if (row.kind === 'manual') return false;
  return sequenceOfSubject(row.subject) === null || (row.body ?? '').includes('malipetek.dev');
}

/**
 * Which sequence a contact whose queue was deleted gets back: the mail-only
 * lists (an email on the map, no site) get nosite, the deterministic share of
 * contacts with a written observation gets the challenger, everyone else the
 * control. Mirrors how the desk and the observation writer pick arms.
 */
export function requeueSequence(
  contact: { id: number; site: string | null; gap: string | null; source_kind?: string | null; notes?: string | null; source_url?: string | null },
  obsShare: number,
): SequenceKind {
  const mailOnly = [contact.source_kind, contact.notes, contact.source_url].some((v) => v && /mail-only/i.test(v));
  if (mailOnly && !contact.site?.trim()) return 'nosite';
  if (contact.gap?.trim() && contact.id % 100 < obsShare) return 'cold_obs';
  return 'cold_a';
}

export interface TemplateSyncResult {
  synced: boolean;
  rendered: number;
  deleted: number;
  requeued: number;
  editedLeft: number;
  skipped: number;
}

/**
 * The cron's half of a template change: when the wording fingerprint moves,
 * every scheduled unedited email is re-rendered, leftovers no sequence can
 * claim are deleted, and contacts left with an empty queue are queued again.
 * Hand-edited mail (`edited_at`) is never touched. Idempotent: the stored
 * hash makes a second tick a no-op, and every step is safe to repeat.
 */
export async function syncTemplates(env: Env): Promise<TemplateSyncResult> {
  const empty = { synced: false, rendered: 0, deleted: 0, requeued: 0, editedLeft: 0, skipped: 0 };
  const hash = await templateHash();
  if ((await readTextSetting(env, 'marketing_template_hash')) === hash) return empty;

  const rerendered = await rerenderScheduled(env);

  const { results: scheduled } = await env.DB.prepare(
    `SELECT id, kind, subject, body FROM marketing_messages
      WHERE channel = 'email' AND status = 'scheduled' AND edited_at IS NULL`,
  ).all<{ id: number; subject: string | null; body: string | null }>();
  const doomed = (scheduled ?? []).filter(outdatedEmail).map((row) => row.id);
  for (const part of chunk(doomed, 50)) {
    await env.DB.batch(
      part.map((id) => env.DB.prepare(`DELETE FROM marketing_messages WHERE id = ? AND status = 'scheduled'`).bind(id)),
    );
  }

  // Ali's own wording is left alone even when it still names the old domain.
  const editedLeft = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM marketing_messages
      WHERE channel = 'email' AND status = 'scheduled' AND edited_at IS NOT NULL AND body LIKE '%malipetek.dev%'`,
  ).first<{ n: number }>();

  // The index is pinned: left to itself SQLite walks the (status, scheduled_at)
  // index once per contact, about 3M rows and 1.8s in production.
  const { results: emptied } = await env.DB.prepare(
    `SELECT c.* FROM marketing_contacts c
      WHERE c.status = 'queued'
        AND NOT EXISTS (SELECT 1 FROM marketing_messages m INDEXED BY marketing_messages_contact
                         WHERE m.contact_id = c.id AND m.channel = 'email' AND m.status = 'scheduled')
        AND NOT EXISTS (SELECT 1 FROM marketing_messages m INDEXED BY marketing_messages_contact
                         WHERE m.contact_id = c.id AND m.channel = 'email' AND m.status = 'sent')`,
  ).all<Contact>();
  const settings = await readMarketingSettings(env);
  const groups = new Map<SequenceKind, Contact[]>();
  for (const contact of emptied ?? []) {
    const kind = requeueSequence(contact, settings.obsShare);
    groups.set(kind, [...(groups.get(kind) ?? []), contact]);
  }
  let requeued = 0;
  for (const [kind, contacts] of groups) {
    requeued += (await queueContacts(env, contacts, kind, 'launch', now())).contacts;
  }

  await writeTextSetting(env, 'marketing_template_hash', hash);
  await logEvent(env, {
    kind: 'templates_synced',
    detail: `${rerendered.updated} re-rendered, ${doomed.length} deleted, ${requeued} re-queued, ${editedLeft?.n ?? 0} hand-edited left`,
  });
  return { synced: true, rendered: rerendered.updated, deleted: doomed.length, requeued, editedLeft: editedLeft?.n ?? 0, skipped: rerendered.skipped };
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

/* —— unsubscribe —— */

async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const unsubSecret = (env: Env) => env.SESSION_SECRET || env.MARKETING_TOKEN || '';

/** The signature in a contact's unsubscribe link: stable, so an old email's link still works. */
export async function unsubSig(env: Env, contactId: number): Promise<string> {
  return (await hmacHex(unsubSecret(env), `marketing-unsubscribe:${contactId}`)).slice(0, 24);
}

export async function unsubscribeUrl(env: Env, contactId: number): Promise<string> {
  return `${siteUrl(env)}/api/marketing/u/${contactId}/${await unsubSig(env, contactId)}`;
}

/**
 * The headers mailbox providers ask of bulk senders (RFC 2369 + RFC 8058):
 * Gmail and Yahoo show an "Unsubscribe" button and POST to the URL.
 */
export async function listHeaders(env: Env, contactId: number | null): Promise<Record<string, string>> {
  const mailto = `<mailto:${marketingFrom(env)}?subject=unsubscribe>`;
  if (!contactId || !unsubSecret(env)) return { 'List-Unsubscribe': mailto };
  return {
    'List-Unsubscribe': `<${await unsubscribeUrl(env, contactId)}>, ${mailto}`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/* —— the senders —— */

export type Provider = MarketingSettings['provider'];

/** The provider that will actually send, or why none can. */
export function senderState(env: Env, settings: MarketingSettings): { provider: Provider; ready: boolean; reason?: string } {
  if (settings.provider === 'ses') {
    return sesConfigured(env) ? { provider: 'ses', ready: true } : { provider: 'ses', ready: false, reason: 'ses_unconfigured' };
  }
  return env.MARKETING ? { provider: 'cloudflare', ready: true } : { provider: 'cloudflare', ready: false, reason: 'sender_unbound' };
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  /** The same words as `text`, with the workshop GIF above the signature. */
  html?: string;
  headers: Record<string, string>;
}

/**
 * The homepage workshop as a looping GIF (scripts/email-gif.mjs records it).
 * It is linked, not attached: the email stays a few KB and the site serves it.
 */
export const EMAIL_IMAGE = {
  path: '/email/conveyor.gif',
  width: 560,
  height: 458,
  alt: 'Request, approve, build, ship: how a change moves through malipetek',
};

export function wantsImage(settings: MarketingSettings, step: number | undefined): boolean {
  return settings.image === 'all' || (settings.image === 'first' && (step ?? 0) === 0);
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text as HTML: escaped, links clickable, line breaks kept. */
function textHtml(text: string): string {
  return escapeHtml(text)
    .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}" style="color:#16140f">${url}</a>`)
    .replace(/\n/g, '<br>\n');
}

/** The homepage's "how" diagram (you, your AI, preview, live, and Ali when you ask), for the top of an HTML email. */
export const EMAIL_HEADER = {
  path: '/email/how.png',
  width: 560,
  height: 224,
  alt: 'You and your AI build it, it goes to a preview, then live; I step in when you ask',
};

/** A plain-looking HTML email: the how diagram, the body, the GIF, then the footer. */
export function emailHtml(siteBase: string, body: string, footer: string): string {
  const img = `${siteBase}${EMAIL_IMAGE.path}`;
  const head = `${siteBase}${EMAIL_HEADER.path}`;
  return [
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>',
    '<body style="margin:0;padding:0">',
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#16140f;max-width:${EMAIL_IMAGE.width}px">`,
    `<p style="margin:0 0 16px"><img src="${head}" width="${EMAIL_HEADER.width}" height="${EMAIL_HEADER.height}" alt="${escapeHtml(EMAIL_HEADER.alt)}" style="display:block;width:100%;max-width:${EMAIL_HEADER.width}px;height:auto;border:0"></p>`,
    `<div>${textHtml(body)}</div>`,
    `<p style="margin:20px 0"><a href="${siteBase}/"><img src="${img}" width="${EMAIL_IMAGE.width}" height="${EMAIL_IMAGE.height}" alt="${escapeHtml(EMAIL_IMAGE.alt)}" style="display:block;width:100%;max-width:${EMAIL_IMAGE.width}px;height:auto;border:0"></a></p>`,
    `<div style="color:#6b665d;font-size:13px">${textHtml(footer.replace(/^\n+/, ''))}</div>`,
    '</div></body></html>',
  ].join('\n');
}

/** Exactly what leaves for one message: the stored body plus the footer, and the list headers. */
export async function renderOutgoing(
  env: Env,
  settings: MarketingSettings,
  message: { contact_id: number | null; to_email: string | null; subject: string | null; body: string; status?: string; step?: number },
): Promise<OutgoingEmail> {
  // A sent row already holds the footer it left with.
  const sent = message.status === 'sent';
  const footer = footerFor(settings);
  return {
    to: message.to_email ?? '',
    subject: message.subject || '(no subject)',
    text: sent ? message.body : `${message.body}${footer}`,
    html: !sent && wantsImage(settings, message.step) ? emailHtml(siteUrl(env), message.body, footer) : undefined,
    headers: await listHeaders(env, message.contact_id),
  };
}

/** Hand one email to the chosen provider. Returns the provider's message id when it gives one. */
async function transmit(env: Env, settings: MarketingSettings, mail: OutgoingEmail): Promise<string | null> {
  const from = marketingFrom(env);
  if (settings.provider === 'ses') {
    const display = `"${settings.fromName.replace(/["\\]/g, '')}" <${from}>`;
    return sesSend(env, {
      from: display,
      to: mail.to,
      replyTo: from,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      headers: Object.entries(mail.headers).map(([name, value]) => ({ name, value })),
    });
  }
  if (!env.MARKETING) throw new Error('sender_unbound');
  const result = (await env.MARKETING.send({
    from: { email: from, name: settings.fromName },
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    ...(mail.html ? { html: mail.html } : {}),
    replyTo: from,
    headers: mail.headers,
  })) as { messageId?: string } | undefined;
  return result?.messageId ?? null;
}

interface ClaimedEmail {
  id: number;
  contact_id: number;
  step: number;
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
      RETURNING id, contact_id, step, to_email, subject, body, role_override_reason, sequence_kind`,
  )
    .bind(t, id)
    .first<ClaimedEmail & { role_override_reason: string | null; sequence_kind: SequenceKind | null }>();
  if (!message) return null;

  const [contact] = await loadQueueCandidates(env, [message.contact_id]);
  // Legacy messages predate explicit sequence identity. An unrecognizable
  // subject cannot establish that the message is exempt from cold checks.
  const sequence = message.sequence_kind ?? sequenceOfSubject(message.subject) ?? 'cold_a';
  const blocked = contact ? [...queueReasons(contact, sequence, message.role_override_reason), ...verificationReasons(contact, t, false)][0] ?? null : null;
  if (!contact || !['new', 'queued', 'contacted'].includes(contact.status) || blocked) {
    await env.DB.prepare(
      `UPDATE marketing_messages SET status = 'cancelled', error = ?, updated_at = ?
        WHERE id = ? AND status = 'sending'`,
    )
      .bind(blocked, t, message.id)
      .run();
    if (blocked) await logEvent(env, { messageId: message.id, contactId: message.contact_id, kind: 'blocked', detail: blocked });
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

  const outgoing = await renderOutgoing(env, settings, message);
  let providerId: string | null = null;
  try {
    providerId = await transmit(env, settings, outgoing);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(`UPDATE marketing_messages SET status = 'failed', error = ?, provider = ?, updated_at = ? WHERE id = ?`)
      .bind(reason.slice(0, 500), settings.provider, t, message.id)
      .run();
    await logEvent(env, { messageId: message.id, contactId: message.contact_id, kind: 'failed', detail: reason });
    console.error('marketing_send_failed', message.id, reason);
    return false;
  }

  await env.DB.batch([
    // The row keeps exactly what left, footer included, so the audit trail
    // does not drift when a setting changes later.
    env.DB.prepare(
      `UPDATE marketing_messages
          SET status = 'sent', sent_at = ?, body = ?, error = NULL, provider = ?, external_id = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(t, outgoing.text, settings.provider, providerId, t, message.id),
    env.DB.prepare(
      `UPDATE marketing_contacts
          SET status = CASE WHEN status IN ('new', 'queued') THEN 'contacted' ELSE status END,
              last_contacted_at = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(t, t, message.contact_id),
    env.DB.prepare(
      `INSERT INTO marketing_events (message_id, contact_id, kind, detail, created_at) VALUES (?, ?, 'sent', ?, ?)`,
    ).bind(message.id, message.contact_id, `${message.subject ?? ''}${outgoing.html ? ' (with GIF)' : ''}`, t),
  ]);
  return true;
}

/* —— list health —— */

/** Pause when bounces pass this share of sends: SES reviews an account at 5%. */
export const MAX_BOUNCE_RATE = 0.04;
/** Pause when complaints pass this share: SES reviews at 0.1% and suspends at 0.5%. */
export const MAX_COMPLAINT_RATE = 0.002;
/** Rates are read over this many days of sending… */
const HEALTH_DAYS = 14;
/** …and only once this many emails left, so the first bounce of the day is not a rate. */
const HEALTH_MIN_SENT = 100;

export interface ListHealth {
  sent: number;
  bounces: number;
  complaints: number;
  bounceRate: number;
  complaintRate: number;
  /** Why the cron would pause now, or null. */
  trip: 'bounce_rate' | 'complaint_rate' | null;
}

export function judgeHealth(sent: number, bounces: number, complaints: number): ListHealth {
  const bounceRate = sent ? bounces / sent : 0;
  const complaintRate = sent ? complaints / sent : 0;
  let trip: ListHealth['trip'] = null;
  if (sent >= HEALTH_MIN_SENT && bounceRate > MAX_BOUNCE_RATE) trip = 'bounce_rate';
  // Two complaints, so a single angry reply does not stop a campaign at low volume.
  else if (complaints >= 2 && complaintRate > MAX_COMPLAINT_RATE) trip = 'complaint_rate';
  return { sent, bounces, complaints, bounceRate, complaintRate, trip };
}

export async function listHealth(env: Env, t = now()): Promise<ListHealth> {
  const since = t - HEALTH_DAYS * 86400;
  const [sent, events] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM marketing_messages WHERE channel = 'email' AND status = 'sent' AND sent_at >= ?`)
      .bind(since)
      .first<{ n: number }>(),
    env.DB.prepare(
      `SELECT kind, COUNT(*) AS n FROM marketing_events WHERE kind IN ('bounce', 'complaint') AND created_at >= ? GROUP BY kind`,
    )
      .bind(since)
      .all<{ kind: string; n: number }>(),
  ]);
  const count = (kind: string) => events.results?.find((row) => row.kind === kind)?.n ?? 0;
  return judgeHealth(sent?.n ?? 0, count('bounce'), count('complaint'));
}

/* —— deliverability: is the address's domain real —— */

const MX_CACHE_DAYS = 30;
const MX_TIMEOUT_MS = 5_000;
const MX_PER_TICK = 40;

/**
 * Does the domain accept mail? One DoH lookup, cached for thirty days in
 * marketing_domains. 1 has MX records, 0 provably has none, and null means we
 * could not tell (timeout, SERVFAIL) — never a reason to pause anyone.
 */
export async function domainMx(env: Env, domain: string, t = now()): Promise<number | null> {
  const cached = await env.DB.prepare('SELECT mx, checked_at FROM marketing_domains WHERE domain = ?')
    .bind(domain)
    .first<{ mx: number; checked_at: number }>();
  if (cached && t - cached.checked_at < MX_CACHE_DAYS * 86400) return cached.mx;

  let mx: number | null = null;
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(MX_TIMEOUT_MS),
    });
    if (res.ok) {
      const data = (await res.json()) as { Status?: number; Answer?: { type?: number }[] };
      if (data.Status === 0) mx = (data.Answer ?? []).some((a) => a.type === 15) ? 1 : 0;
      else if (data.Status === 3) mx = 0;
    }
  } catch {
    /* no answer is not an answer */
  }
  if (mx === null) return null;
  await env.DB.prepare(
    `INSERT INTO marketing_domains (domain, mx, checked_at) VALUES (?, ?, ?)
     ON CONFLICT(domain) DO UPDATE SET mx = excluded.mx, checked_at = excluded.checked_at`,
  )
    .bind(domain, mx, t)
    .run();
  return mx;
}

/** The domain part of an address, lowercased, or null when there is none. */
function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  return at > 0 && at < email.length - 1 ? email.slice(at + 1).toLowerCase() : null;
}

/**
 * Pause a contact whose address cannot be delivered to: bad syntax or a
 * domain with no MX. Same shape as the country block — status, a note that
 * says when it was checked, queued mail cancelled, an event for the feed.
 */
async function pauseUndeliverable(env: Env, contact: { id: number; email: string }, reason: string, t: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE marketing_contacts SET status = 'paused', notes = COALESCE(notes || '\n', '') || ?, updated_at = ? WHERE id = ?`,
  )
    .bind(`Undeliverable: ${reason} (checked ${dayLabel(t)})`, t, contact.id)
    .run();
  await cancelScheduled(env, contact.id);
  await logEvent(env, { contactId: contact.id, kind: 'undeliverable', detail: `${contact.email}: ${reason}` });
}

function dayLabel(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

/**
 * The cron's domain sweep: a bounded number of not-yet-checked domains among
 * contacts still waiting to be mailed, whether or not outreach is live. A
 * domain with no MX pauses its contacts here instead of bouncing later.
 */
export async function sweepDomains(env: Env, t = now()): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.email FROM marketing_contacts c
      WHERE c.status IN ('new', 'queued', 'paused')
        AND NOT EXISTS (
          SELECT 1 FROM marketing_domains d
           WHERE d.domain = substr(c.email, instr(c.email, '@') + 1)
             AND d.checked_at >= ?
        )
      ORDER BY c.id LIMIT ?`,
  )
    .bind(t - MX_CACHE_DAYS * 86400, MX_PER_TICK * 4)
    .all<{ id: number; email: string }>();
  if (!results?.length) return 0;

  // One lookup per domain per tick; contacts sharing a domain share the answer.
  const seen = new Map<string, number | null>();
  let paused = 0;
  let checked = 0;
  for (const contact of results) {
    if (checked >= MX_PER_TICK) break;
    if (!validEmail(contact.email)) {
      await pauseUndeliverable(env, contact, 'the address itself is not deliverable', t);
      paused += 1;
      continue;
    }
    const domain = emailDomain(contact.email);
    if (!domain) continue;
    let mx = seen.get(domain);
    if (mx === undefined) {
      mx = await domainMx(env, domain, t);
      seen.set(domain, mx);
      checked += 1;
    }
    if (mx === 0) {
      await pauseUndeliverable(env, contact, `the domain ${domain} has no mail records`, t);
      paused += 1;
    }
  }
  return paused;
}

/* —— coming back from a health pause —— */

/** A week, the time a tripped desk waits before it may try again. */
export const AUTO_RESUME_AFTER = 7 * 86400;
/** The ramp back: twenty a day, growing by twenty each day for two weeks. */
const RAMP_DAYS = 14;
const RAMP_START = 20;

/**
 * The daily cap while a resume is still ramping: twenty sends on the first
 * day back, twenty more each day, the full cap after two weeks.
 */
export function effectiveCap(dailyCap: number, resumedAt: number | null, t: number): number {
  if (!resumedAt || t < resumedAt) return dailyCap;
  const days = Math.floor((t - resumedAt) / 86400);
  if (days >= RAMP_DAYS) return dailyCap;
  return Math.min(dailyCap, RAMP_START * (1 + days));
}

/**
 * Whether a paused desk may switch itself back on: the pause is a week old,
 * the list has been calm (no health trip), and it has not tripped twice in a
 * month — a second trip inside the window means a person should look first.
 */
export function shouldAutoResume(input: {
  enabled: boolean;
  pausedAt: number | null;
  t: number;
  trip: string | null;
  pausesLast30d: number;
}): boolean {
  if (!input.enabled || !input.pausedAt) return false;
  if (input.t - input.pausedAt < AUTO_RESUME_AFTER) return false;
  if (input.trip) return false;
  return input.pausesLast30d <= 1;
}

async function readStamp(env: Env, key: string): Promise<number | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  try {
    const value = Number(JSON.parse(row?.value ?? 'null'));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

async function writeStamp(env: Env, key: string, value: number | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, JSON.stringify(value), now())
    .run();
}

/* —— the run —— */

/** With review on, a first email waits until Ali has read or rewritten it. */
const REVIEWED = 'AND (m.step > 0 OR m.reviewed_at IS NOT NULL OR m.edited_at IS NOT NULL)';

/** Sends in flight at once: SES allows 14 a second on this account. */
const CONCURRENCY = 5;

/**
 * The cron's half: send what is due, if the switch, the window, the sender and
 * the cap all allow it. Returns why it did nothing so a manual run can say.
 */
export async function runMarketing(env: Env): Promise<RunSummary> {
  const settings = await readMarketingSettings(env);
  const t = now();
  const window = sendWindow(settings, t);
  const summary: RunSummary = { live: settings.live, window, sent: 0, failed: 0, reason: null };

  const health = await listHealth(env, t);
  if (!settings.live) {
    // A health pause is not forever: a week of calm numbers and the desk
    // switches itself back on, then ramps the cap up again.
    const [pausedAt, resumedAt, pauses] = await Promise.all([
      readStamp(env, 'marketing_auto_paused_at'),
      readStamp(env, 'marketing_resumed_at'),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM marketing_events WHERE kind = 'auto_paused' AND created_at > ?`)
        .bind(t - 30 * 86400)
        .first<{ n: number }>(),
    ]);
    if (
      shouldAutoResume({
        enabled: settings.autoResume,
        pausedAt,
        t,
        trip: health.trip,
        pausesLast30d: pauses?.n ?? 0,
      })
    ) {
      await saveMarketingSettings(env, { live: true });
      await writeStamp(env, 'marketing_auto_paused_at', null);
      await writeStamp(env, 'marketing_resumed_at', t);
      await logEvent(env, { kind: 'auto_resumed', detail: `paused since ${dayLabel(pausedAt ?? t)}, cap ramps from ${RAMP_START}/day` });
      await mailAli(env, {
        subject: 'Outreach resumed itself',
        text: [
          `The marketing desk switched itself back on: it has been paused since ${dayLabel(pausedAt ?? t)} and the last ${HEALTH_DAYS} days show no bounce or complaint problem.`,
          `It ramps back carefully: about ${RAMP_START} emails a day for the first days, then the full cap of ${settings.dailyCap}/day by day ${RAMP_DAYS}.`,
          'Switch it off in the desk if that is not what you want.',
          `${siteUrl(env)}/portal/admin#marketing`,
        ].join('\n'),
      });
      settings.live = true;
      summary.live = true;
    } else {
      return { ...summary, reason: 'paused' };
    }
  }

  const sender = senderState(env, settings);
  if (!sender.ready) return { ...summary, reason: sender.reason ?? 'sender_unbound' };
  if (!settings.postalAddress) return { ...summary, reason: 'postal_address_unset' };
  if (!window.open) return { ...summary, reason: window.reason ?? 'outside_hours' };

  if (health.trip) {
    const pausedAt = await readStamp(env, 'marketing_auto_paused_at');
    const recent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM marketing_events WHERE kind = 'auto_paused' AND created_at > ?`)
      .bind(t - 30 * 86400)
      .first<{ n: number }>();
    await saveMarketingSettings(env, { live: false });
    await writeStamp(env, 'marketing_auto_paused_at', t);
    const detail = `bounces ${health.bounces}/${health.sent} (${(health.bounceRate * 100).toFixed(1)}%), complaints ${health.complaints} (${(health.complaintRate * 100).toFixed(2)}%) over ${HEALTH_DAYS} days`;
    const trips = (recent?.n ?? 0) + 1;
    await logEvent(env, { kind: 'auto_paused', detail: `${health.trip}: ${detail}` });
    await mailAli(env, {
      subject: `Outreach paused: ${health.trip === 'bounce_rate' ? 'too many bounces' : 'too many complaints'}`,
      text: [
        `The marketing desk paused itself: ${detail}.`,
        `Limits: bounces ${MAX_BOUNCE_RATE * 100}%, complaints ${MAX_COMPLAINT_RATE * 100}%. SES reviews an account at 5% and 0.1%.`,
        '',
        trips > 1
          ? `This is the second health pause in 30 days, so it stays off until you switch it back on.`
          : 'It switches itself back on in 7 days if the numbers stay clean; switch it off sooner in the desk if you disagree.',
        'Look at Sources in the desk to see which list is doing it, pause or drop that list.',
        `${siteUrl(env)}/portal/admin#marketing`,
      ].join('\n'),
    });
    return { ...summary, live: false, reason: health.trip };
  }

  const { dayStart } = localClock(settings.offsetMinutes, t);
  const sentToday = await countSentToday(env, dayStart);
  const resumedAt = await readStamp(env, 'marketing_resumed_at');
  const cap = effectiveCap(settings.dailyCap, resumedAt, t);
  const room = Math.max(0, Math.min(settings.perRun, cap - sentToday));
  if (!room) return { ...summary, reason: 'daily_cap' };

  // A few extra rows so contacts paused as undeliverable do not waste the
  // run's room; the loop below stops once `room` sends have been attempted.
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.contact_id, c.email
       FROM marketing_messages m JOIN marketing_contacts c ON c.id = m.contact_id
      WHERE m.channel = 'email' AND m.status = 'scheduled' AND m.scheduled_at <= ?
        AND c.status IN ('new', 'queued', 'contacted')
        ${settings.reviewFirst ? REVIEWED : ''}
      ORDER BY m.scheduled_at, m.id
      LIMIT ?`,
  )
    .bind(t, room + 12)
    .all<{ id: number; contact_id: number; email: string }>();

  // Domains are looked up once per run, not once per message.
  const mxCache = new Map<string, number | null>();
  // `slots` is reserved synchronously, so a chunk of five can never send more
  // than the room allows; an undeliverable skip hands its slot back.
  let slots = room;
  const send = async (row: { id: number; contact_id: number; email: string }) => {
    if (slots <= 0) return;
    slots -= 1;
    const skip = async (reason: string) => {
      slots += 1;
      await pauseUndeliverable(env, { id: row.contact_id, email: row.email }, reason, t);
    };
    if (!validEmail(row.email)) {
      await skip('the address itself is not deliverable');
      return;
    }
    const domain = emailDomain(row.email);
    if (domain) {
      let mx = mxCache.get(domain);
      if (mx === undefined) {
        mx = await domainMx(env, domain, t);
        mxCache.set(domain, mx);
      }
      if (mx === 0) {
        await skip(`the domain ${domain} has no mail records`);
        return;
      }
    }
    const message = await claimEmail(env, row.id, t);
    if (!message) {
      slots += 1;
      return;
    }
    if (await deliverEmail(env, settings, message)) summary.sent += 1;
    else summary.failed += 1;
  };
  const queue = [...(results ?? [])];
  for (const part of chunk(queue, CONCURRENCY)) await Promise.all(part.map((row) => send(row)));
  return summary;
}

/* ——————————————————————— inbound mail ——————————————————————— */

/** "no" or "unsubscribe" in the body, which stops everything left for that contact. */
export function isOptOut(body: string): boolean {
  const text = body.trim().slice(0, 600);
  if (/^\s*(no|stop|no thanks|no thank you|not interested)\s*[.!]?\s*$/i.test(text)) return true;
  return /\b(unsubscribe|opt[- ]?out|remove me|take me off|stop (emailing|writing)|don'?t (email|contact|write))\b/i.test(text);
}

/**
 * The machine mail that is not a person: DMARC aggregate reports from the big
 * receivers, and anything whose subject says "report domain:". They used to
 * land in the inbox as fake replies and count toward "inbound".
 */
const AUTOMATED_REPORT_FROM = /dmarc/i;
const AUTOMATED_REPORT_SUBJECT = /^(\[preview\]\s*)?report domain:/i;

export function isAutomatedReport(mail: { headerFrom: string; subject: string }): boolean {
  return AUTOMATED_REPORT_FROM.test(mail.headerFrom) || AUTOMATED_REPORT_SUBJECT.test(mail.subject ?? '');
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
  // A DMARC report is a machine writing about our mail, not a reply to it.
  if (isAutomatedReport(mail)) {
    await logEvent(env, { kind: 'dmarc_report', detail: `${mail.headerFrom}: ${mail.subject}`.slice(0, 300) });
    return;
  }
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

  // The List-Unsubscribe mailto arrives with that subject and usually no body.
  if (isOptOut(mail.body) || /^\s*unsubscribe\s*$/i.test(mail.subject)) {
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
  const type = (contentType ?? '').toLowerCase();
  // A DSN says what it is in its content type; SES forwards them from its own
  // envelope address, so the sender alone is not a reliable sign.
  if (type.includes('multipart/report') && type.includes('report-type=delivery-status')) return true;
  if (!/^(mailer-daemon|postmaster|bounces?)@/i.test(from)) return false;
  return type.includes('multipart/report') || type.includes('message/delivery-status');
}

/** An ARF abuse report (RFC 5965): what SES forwards when a recipient presses "spam". */
export function isComplaintReport(contentType: string | null): boolean {
  const type = (contentType ?? '').toLowerCase();
  return type.includes('multipart/report') && type.includes('report-type=feedback-report');
}

/** Who complained: the report's Original-Rcpt-To, else the To of the attached original. */
export function complainedAddresses(raw: string): string[] {
  const found = new Set<string>();
  for (const match of raw.matchAll(/^Original-Rcpt-To:\s*(?:rfc822;\s*)?<?([^\s<>;]+)>?/gim)) {
    const email = cleanEmail(match[1]);
    if (email) found.add(email);
  }
  if (!found.size) {
    const original = raw.slice(Math.max(0, raw.search(/message\/rfc822/i)));
    const to = original.match(/^To:[^\n]*?<?([^\s<>"]+@[^\s<>"]+)>?\s*$/im)?.[1];
    const email = cleanEmail(to);
    if (email) found.add(email);
  }
  return [...found];
}

/**
 * A spam complaint is the strongest "no" there is: opt the contact out,
 * cancel what is left, record a complaint (the rate the cron watches) and
 * tell Ali.
 */
export async function handleComplaintReport(env: Env, raw: string): Promise<number> {
  const t = now();
  const done: string[] = [];
  for (const email of complainedAddresses(raw)) {
    const contact = await env.DB.prepare('SELECT id FROM marketing_contacts WHERE email = ?').bind(email).first<{ id: number }>();
    if (!contact) continue;
    await env.DB.prepare(
      `UPDATE marketing_contacts SET status = 'opted_out', opted_out_at = COALESCE(opted_out_at, ?), updated_at = ? WHERE id = ?`,
    )
      .bind(t, t, contact.id)
      .run();
    await cancelScheduled(env, contact.id);
    await logEvent(env, { contactId: contact.id, kind: 'complaint', detail: email });
    done.push(email);
  }
  if (done.length) {
    await mailAli(env, {
      subject: `Spam complaint: ${done.join(', ')}`,
      text: [
        `${done.join(', ')} marked an outreach email as spam. They are opted out and their queued mail was cancelled.`,
        '',
        `The desk pauses itself if complaints pass ${MAX_COMPLAINT_RATE * 100}% of the last two weeks' sends.`,
        `Marketing desk: ${siteUrl(env)}/portal/admin#marketing`,
      ].join('\n'),
    });
  }
  return done.length;
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
  sequence: SequenceKind | null,
  campaign: string,
  options: { roleReason?: string | null; sourceKind?: string | null } = {},
): Promise<{ added: number; paused: number; queued: number; emails: number; skipped: { email: string; reason: string }[]; held: { email: string; reasons: string[] }[] }> {
  const parsed = parseContactsCsv(csv);
  const skipped = parsed.skipped;
  const t = now();

  type Seed = {
    email: string;
    name: string | null;
    business: string | null;
    site: string | null;
    gap: string | null;
    source_url: string | null;
    trigger: string | null;
    trigger_url: string | null;
    verified_at: number | null;
    quality_hold: string | null;
    notes: string | null;
    consent: string;
    source_kind: string | null;
    country: string | null;
  };
  const seeds: Seed[] = [];
  for (const row of parsed.rows) {
    const email = cleanEmail(row.email);
    if (!email) {
      skipped.push({ email: String(row.email ?? ''), reason: 'bad_email' });
      continue;
    }
    seeds.push({
      email,
      name: text(row.name, 80),
      business: text(row.business, 120),
      site: text(row.site, 200),
      gap: text(row.gap, 300),
      source_url: text(row.sourceUrl, 500),
      trigger: text(row.trigger, 300),
      trigger_url: text(row.triggerUrl, 500),
      verified_at: cleanVerifiedAt(row.verifiedAt),
      quality_hold: text(row.qualityHold, 500) ?? (isRoleAccount(email) && !options.roleReason ? 'role_account' : null),
      notes: text(row.notes, 1000),
      consent: ['consent', 'existing_relationship', 'legitimate_interest'].includes(String(row.consentBasis))
        ? String(row.consentBasis)
        : 'legitimate_interest',
      // A column in the file wins over the label chosen for the whole import.
      source_kind: cleanSourceKind(row.sourceKind) ?? cleanSourceKind(options.sourceKind),
      country: cleanCountry(row.country),
    });
  }

  // Insert in batches, then read the batch's rows back. `meta.changes` says
  // which addresses were new; the select gives us their ids without a query
  // per contact.
  const inserted: Contact[] = [];
  for (const part of chunk(seeds, 50)) {
    const results = await env.DB.batch(
      part.map((seed) =>
        env.DB.prepare(
          `INSERT INTO marketing_contacts
             (email, name, business, site, source, source_url, gap, consent_basis, status, notes, source_kind, country, created_at, updated_at, trigger, trigger_url, verified_at, quality_hold)
           VALUES (?, ?, ?, ?, 'csv', ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(email) DO NOTHING`,
        ).bind(
          seed.email,
          seed.name,
          seed.business,
          seed.site,
          seed.source_url,
          seed.gap,
          seed.consent,
          seed.notes,
          seed.source_kind,
          seed.country,
          t,
          t,
          seed.trigger,
          seed.trigger_url,
          seed.verified_at,
          seed.quality_hold,
        ),
      ),
    );
    const fresh: string[] = [];
    results.forEach((result, index) => {
      const changes = (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
      if (changes > 0) fresh.push(part[index].email);
      else skipped.push({ email: part[index].email, reason: 'already_in_list' });
    });
    if (!fresh.length) continue;
    const { results: rows } = await env.DB.prepare(
      `SELECT * FROM marketing_contacts WHERE email IN (${fresh.map(() => '?').join(',')})`,
    )
      .bind(...fresh)
      .all<Contact>();
    const byEmail = new Map((rows ?? []).map((row) => [row.email, row]));
    for (const email of fresh) {
      const row = byEmail.get(email);
      if (row) inserted.push(row);
    }
  }

  const roleReason = options.roleReason ?? null;
  const candidates = new Map<number, QueueCandidate>();
  if (sequence) {
    for (const part of chunk(inserted, 100)) {
      for (const contact of await loadQueueCandidates(env, part.map(({ id }) => id))) candidates.set(contact.id, contact);
    }
  }
  const hold = inserted.flatMap((contact) => {
    const candidate = candidates.get(contact.id);
    const reasons = sequence ? [...queueReasons(contact, sequence, roleReason), ...(candidate ? verificationReasons(candidate, t) : ['unverified'])]
      : contact.quality_hold ? [contact.quality_hold === 'role_account' ? 'role_account' : 'quality_hold'] : [];
    return reasons.length ? [{ contact, reasons }] : [];
  });
  for (const part of chunk(hold, 50)) {
    await env.DB.batch(part.flatMap(({ contact, reasons }) => [
      env.DB.prepare(`UPDATE marketing_contacts SET status = 'paused', updated_at = ? WHERE id = ?`).bind(t, contact.id),
      env.DB.prepare(`INSERT INTO marketing_events (contact_id, kind, detail, created_at) VALUES (?, 'paused', ?, ?)`)
        .bind(contact.id, reasons.join(', '), t),
    ]));
  }
  if (!sequence && roleReason) {
    for (const part of chunk(inserted.filter((contact) => isRoleAccount(contact.email)), 50)) {
      await env.DB.batch(part.map((contact) => env.DB.prepare(
        `INSERT INTO marketing_events (contact_id, kind, detail, created_at) VALUES (?, 'role_import_override', ?, ?)`
      ).bind(contact.id, roleReason, t)));
    }
  }
  const heldIds = new Set(hold.map(({ contact }) => contact.id));
  const queued = sequence ? await queueContacts(env, inserted.filter((contact) => !heldIds.has(contact.id)), sequence, campaign, t, roleReason)
    : { contacts: 0, messages: 0 };
  return {
    added: inserted.length,
    paused: hold.length,
    queued: queued.contacts,
    emails: queued.messages,
    skipped,
    held: hold.map(({ contact, reasons }) => ({ email: contact.email, reasons })),
  };
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
  trigger: string;
  triggerUrl: string;
  verifiedAt: string;
  qualityHold: string;
  notes: string;
  consentBasis: string;
  sourceKind: string;
  country: string;
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
  email_source_url: 'sourceUrl',
  trigger: 'trigger',
  trigger_url: 'triggerUrl',
  triggerurl: 'triggerUrl',
  verified_at: 'verifiedAt',
  verified_on: 'verifiedAt',
  verifiedat: 'verifiedAt',
  quality_hold: 'qualityHold',
  qualityhold: 'qualityHold',
  notes: 'notes',
  note: 'notes',
  'consent basis': 'consentBasis',
  consent_basis: 'consentBasis',
  consentbasis: 'consentBasis',
  'source kind': 'sourceKind',
  source_kind: 'sourceKind',
  sourcekind: 'sourceKind',
  country: 'country',
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
    if (rows.length + skipped.length >= 5000) {
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
      trigger: '',
      triggerUrl: '',
      verifiedAt: '',
      qualityHold: '',
      notes: '',
      consentBasis: '',
      sourceKind: '',
      country: '',
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

interface SequenceStats {
  sent: number;
  replies: number;
  optedOut: number;
  bounced: number;
}

/**
 * Per-sequence outcomes for the desk: infer the sequence from the subject
 * only for legacy mail; a contact's
 * reply, opt-out or bounce lands on the sequence their latest send belonged to.
 */
async function sequenceStats(env: Env): Promise<Record<SequenceKind, SequenceStats>> {
  const out = Object.fromEntries(
    (Object.keys(SEQUENCE_LABELS) as SequenceKind[]).map((kind) => [kind, { sent: 0, replies: 0, optedOut: 0, bounced: 0 }]),
  ) as Record<SequenceKind, SequenceStats>;
  const [sent, contacts] = await Promise.all([
    env.DB.prepare(`SELECT contact_id, subject, sequence_kind FROM marketing_messages WHERE channel = 'email' AND status = 'sent' ORDER BY sent_at, id`).all<{
      contact_id: number;
      subject: string | null;
      sequence_kind: SequenceKind | null;
    }>(),
    env.DB.prepare(`SELECT id, status FROM marketing_contacts WHERE status IN ('replied', 'opted_out', 'bounced')`).all<{
      id: number;
      status: string;
    }>(),
  ]);
  const latest = new Map<number, SequenceKind>();
  for (const row of sent.results ?? []) {
    const kind = row.sequence_kind ?? sequenceOfSubject(row.subject);
    if (!kind) continue;
    out[kind].sent += 1;
    latest.set(row.contact_id, kind);
  }
  for (const contact of contacts.results ?? []) {
    const kind = latest.get(contact.id);
    if (!kind) continue;
    if (contact.status === 'replied') out[kind].replies += 1;
    else if (contact.status === 'opted_out') out[kind].optedOut += 1;
    else if (contact.status === 'bounced') out[kind].bounced += 1;
  }
  return out;
}

/** The desk's autopilot rows: newest and next stamps per loop, a few cheap aggregates. */
async function pulseStats(env: Env, t: number) {
  const [email, postSent, postNext, postCounts, observed] = await Promise.all([
    env.DB.prepare(
      `SELECT MAX(sent_at) AS last_sent,
              MIN(CASE WHEN status = 'scheduled' AND scheduled_at > ? THEN scheduled_at END) AS next_at
         FROM marketing_messages WHERE channel = 'email'`,
    )
      .bind(t)
      .first<{ last_sent: number | null; next_at: number | null }>(),
    env.DB.prepare(
      `SELECT sent_at, channel FROM marketing_messages
        WHERE channel IN ('x', 'linkedin') AND status = 'sent' ORDER BY sent_at DESC LIMIT 1`,
    ).first<{ sent_at: number; channel: string }>(),
    env.DB.prepare(
      `SELECT scheduled_at, channel FROM marketing_messages
        WHERE channel IN ('x', 'linkedin') AND status = 'scheduled' AND scheduled_at > ?
        ORDER BY scheduled_at LIMIT 1`,
    )
      .bind(t)
      .first<{ scheduled_at: number; channel: string }>(),
    env.DB.prepare(
      `SELECT SUM(status = 'scheduled') AS queued, SUM(status = 'failed') AS failed
         FROM marketing_messages WHERE channel IN ('x', 'linkedin')`,
    ).first<{ queued: number | null; failed: number | null }>(),
    env.DB.prepare('SELECT MAX(observed_at) AS at FROM marketing_contacts').first<{ at: number | null }>(),
  ]);
  return {
    lastSentAt: email?.last_sent ?? null,
    nextEmailAt: email?.next_at ?? null,
    lastPublishedAt: postSent?.sent_at ?? null,
    lastPublishedChannel: postSent?.channel ?? null,
    nextPostAt: postNext?.scheduled_at ?? null,
    nextPostChannel: postNext?.channel ?? null,
    postsQueued: postCounts?.queued ?? 0,
    postsFailed: postCounts?.failed ?? 0,
    lastObservedAt: observed?.at ?? null,
  };
}

marketing.get('/admin/marketing', async (c) => {
  const env = c.env;
  const settings = await readMarketingSettings(env);
  const t = now();
  const { dayStart } = localClock(settings.offsetMinutes, t);

  const [contacts, messages, today, due, next, events, health, awaiting] = await Promise.all([
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
    listHealth(env, t),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM marketing_messages WHERE channel IN ('x', 'linkedin') AND status = 'draft'`).first<{ n: number }>(),
  ]);

  const counts = (rows: { status: string; n: number }[] | null, keys: readonly string[]) =>
    Object.fromEntries(keys.map((key) => [key, rows?.find((row) => row.status === key)?.n ?? 0]));

  const dueCounts = Object.fromEntries(['email', 'x', 'linkedin'].map((channel) => [channel, due.results?.find((r) => r.channel === channel)?.n ?? 0]));

  const unavailable: string[] = [];
  async function optional<T>(section: string, promise: Promise<T>): Promise<T | null> {
    try {
      return await promise;
    } catch (err) {
      console.error(`Marketing overview: ${section} unavailable`, err);
      unavailable.push(section);
      return null;
    }
  }
  const [autoPausedAt, resumedAt, observe, observeKinds, domains, seqStats, pulse] = await Promise.all([
    readStamp(env, 'marketing_auto_paused_at'),
    readStamp(env, 'marketing_resumed_at'),
    optional('observe', env.DB.prepare(
      `SELECT SUM(gap IS NOT NULL AND gap != '') AS with_gap,
              SUM(observed_at IS NOT NULL) AS observed,
              SUM(status IN ('new', 'queued') AND site IS NOT NULL AND site != '' AND (gap IS NULL OR gap = '') AND observed_at IS NULL) AS pending
         FROM marketing_contacts`,
    ).first<{ with_gap: number | null; observed: number | null; pending: number | null }>()),
    optional('observeKinds', env.DB.prepare(
      `SELECT COALESCE(gap_kind, '(none)') AS kind, COUNT(*) AS n FROM marketing_contacts
        WHERE observed_at IS NOT NULL GROUP BY COALESCE(gap_kind, '(none)')`,
    ).all<{ kind: string; n: number }>()),
    optional('domains', env.DB.prepare('SELECT COUNT(*) AS checked, SUM(mx = 0) AS undeliverable FROM marketing_domains').first<{
      checked: number | null;
      undeliverable: number | null;
    }>()),
    optional('sequenceStats', sequenceStats(env)),
    pulseStats(env, t),
  ]);

  return out(c, {
    settings,
    unavailable: unavailable.sort(),
    sender: marketingFrom(env),
    inbox: marketingInbox(env),
    bound: senderState(env, settings).ready,
    senderState: senderState(env, settings),
    providers: { cloudflare: Boolean(env.MARKETING), ses: sesConfigured(env) },
    health: { ...health, maxBounceRate: MAX_BOUNCE_RATE, maxComplaintRate: MAX_COMPLAINT_RATE },
    postsAwaiting: awaiting?.n ?? 0,
    pulse,
    window: sendWindow(settings, t),
    today,
    autoResume: {
      enabled: settings.autoResume,
      autoPausedAt,
      resumesAfter: autoPausedAt ? autoPausedAt + AUTO_RESUME_AFTER : null,
      resumedAt,
      cap: effectiveCap(settings.dailyCap, resumedAt, t),
    },
    observe: {
      pending: observe?.pending ?? 0,
      observed: observe?.observed ?? 0,
      withGap: observe?.with_gap ?? 0,
      byKind: Object.fromEntries((observeKinds?.results ?? []).map((row) => [row.kind, row.n])),
    },
    domains: { checked: domains?.checked ?? 0, undeliverable: domains?.undeliverable ?? 0 },
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
    sequences: Object.entries(SEQUENCE_LABELS).map(([key, label]) => ({
      key,
      label,
      needsGap: SEQUENCE_NEEDS_GAP[key as SequenceKind],
      stats: seqStats?.[key as SequenceKind] ?? { sent: 0, replies: 0, optedOut: 0, bounced: 0 },
    })),
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
  const source = c.req.query('source') ?? '';
  if (source === '(none)') where.push('c.source_kind IS NULL');
  else if (cleanSourceKind(source)) {
    where.push('c.source_kind = ?');
    binds.push(cleanSourceKind(source));
  }
  if (q) {
    where.push('(c.email LIKE ? OR c.name LIKE ? OR c.business LIKE ? OR c.site LIKE ?)');
    const like = `%${q}%`;
    binds.push(like, like, like, like);
  }
  const offset = Math.max(0, Math.min(1_000_000, Number(c.req.query('offset')) || 0));
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ results }, total] = await Promise.all([
    // The page is chosen first, then counted. Counting in the outer select ran
    // both subqueries for every contact before the sort, and SQLite answered
    // MIN(scheduled_at) from the (status, scheduled_at) index: every scheduled
    // message, once per contact. In production that was 3M rows and 2.6s for one
    // page, enough to overload D1 for every other route in the same window.
    // INDEXED BY pins the per-contact index so the plan cannot drift back.
    c.env.DB.prepare(
      `WITH page AS (
         SELECT * FROM marketing_contacts c
          ${filter}
          ORDER BY c.updated_at DESC, c.id DESC LIMIT ${PAGE} OFFSET ?
       )
       SELECT page.*,
              (SELECT COUNT(*) FROM marketing_messages m INDEXED BY marketing_messages_contact
                WHERE m.contact_id = page.id AND m.status = 'sent') AS sent_count,
              (SELECT MIN(m.scheduled_at) FROM marketing_messages m INDEXED BY marketing_messages_contact
                WHERE m.contact_id = page.id AND m.status = 'scheduled') AS next_at
         FROM page
        ORDER BY page.updated_at DESC, page.id DESC`,
    )
      .bind(...binds, offset)
      .all<Contact & { sent_count: number; next_at: number | null }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM marketing_contacts c ${filter}`)
      .bind(...binds)
      .first<{ n: number }>(),
  ]);
  return out(c, { contacts: (results ?? []).map(contactView), total: total?.n ?? 0, offset, page: PAGE });
});

/** One contact and everything that happened to them: messages in order, then events. */
marketing.get('/admin/marketing/contacts/:id', async (c) => {
  const env = c.env;
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return out(c, { error: 'bad_id' }, 400);
  const contact = await getContact(env, id);
  if (!contact) return out(c, { error: 'not_found' }, 404);
  const [messages, events] = await Promise.all([
    env.DB.prepare('SELECT * FROM marketing_messages WHERE contact_id = ? ORDER BY COALESCE(scheduled_at, created_at), id').bind(id).all<Message>(),
    env.DB.prepare('SELECT id, message_id, kind, detail, created_at FROM marketing_events WHERE contact_id = ? ORDER BY id DESC LIMIT 100')
      .bind(id)
      .all<{ id: number; message_id: number | null; kind: string; detail: string | null; created_at: number }>(),
  ]);
  return out(c, {
    contact: contactView(contact),
    messages: (messages.results ?? []).map(messageView),
    events: (events.results ?? []).map((e) => ({ id: e.id, messageId: e.message_id, kind: e.kind, detail: e.detail, createdAt: e.created_at })),
  });
});

/**
 * One action on many contacts. Opting out and pausing cancel what is queued,
 * like the same action on one contact; nothing here sends or deletes.
 */
marketing.post('/admin/marketing/contacts/bulk', async (c) => {
  const env = c.env;
  const body = await jsonBody(c);
  const action = body?.action;
  if (action !== 'opt_out' && action !== 'pause') return out(c, { error: 'bad_action' }, 400);
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 1000) : [];
  if (!ids.length) return out(c, { error: 'no_ids' }, 400);
  const t = now();
  let changed = 0;
  for (const part of chunk(ids, 50)) {
    const marks = part.map(() => '?').join(',');
    const closed = action === 'opt_out' ? "('opted_out')" : "('opted_out', 'bounced', 'replied', 'paused')";
    const [update] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE marketing_contacts SET status = ?, ${action === 'opt_out' ? 'opted_out_at = COALESCE(opted_out_at, ?),' : ''} updated_at = ?
          WHERE id IN (${marks}) AND status NOT IN ${closed}`,
      ).bind(...(action === 'opt_out' ? ['opted_out', t, t] : ['paused', t]), ...part),
      env.DB.prepare(
        `UPDATE marketing_messages SET status = 'cancelled', updated_at = ? WHERE contact_id IN (${marks}) AND status = 'scheduled'`,
      ).bind(t, ...part),
    ]);
    changed += update.meta.changes ?? 0;
  }
  await logEvent(env, { kind: action === 'opt_out' ? 'bulk_opt_out' : 'bulk_pause', detail: `${changed} of ${ids.length} contacts` });
  return out(c, { ok: true, changed, asked: ids.length });
});

marketing.post('/admin/marketing/contacts', async (c) => {
  const env = c.env;
  const body = await jsonBody(c);
  const email = cleanEmail(body?.email);
  if (!email) return out(c, { error: 'bad_email' }, 400);

  const sequence = isSequenceKind(body?.sequence) ? body.sequence : null;
  const gap = text(body?.gap, 300);
  const trigger = text(body?.trigger, 300);
  const roleReason = overrideReason(body);
  if (body?.force === true && !roleReason) return out(c, { error: 'force_reason_required' }, 400);
  const qualityHold = text(body?.qualityHold, 500) ?? (isRoleAccount(email) && !roleReason ? 'role_account' : null);
  if (sequence) {
    const [error] = queueReasons({ email, gap, trigger, quality_hold: qualityHold, status: 'new', opted_out_at: null }, sequence, roleReason);
    if (error) return out(c, { error }, 400);
  }

  const t = now();
  const contact = await env.DB.prepare(
    `INSERT INTO marketing_contacts
       (email, name, business, site, source, source_url, gap, consent_basis, status, notes, source_kind, country, created_at, updated_at, trigger, trigger_url, verified_at, quality_hold)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      qualityHold ? 'paused' : 'new',
      text(body?.notes, 1000),
      cleanSourceKind(body?.sourceKind) ?? 'manual',
      cleanCountry(body?.country),
      t,
      t,
      trigger,
      text(body?.triggerUrl, 500),
      cleanVerifiedAt(body?.verifiedAt),
      qualityHold,
    )
    .first<Contact>();
  if (!contact) return out(c, { error: 'already_in_list' }, 409);

  let reasons: string[] = [];
  if (sequence) {
    const [candidate] = await loadQueueCandidates(env, [contact.id]);
    reasons = candidate ? verificationReasons(candidate, t) : ['unverified'];
    if (!reasons.length) await queueSequence(env, contact, sequence, text(body?.campaign, 40) ?? 'launch', t, roleReason);
    else await logEvent(env, { contactId: contact.id, kind: 'blocked', detail: reasons.join(', ') });
  }
  const fresh = (await getContact(env, contact.id)) ?? contact;
  return out(c, { contact: contactView(fresh), reasons }, 201);
});

marketing.post('/admin/marketing/contacts/import', async (c) => {
  const env = c.env;
  const body = await jsonBody(c);
  const csv = typeof body?.csv === 'string' ? body.csv : '';
  if (!csv.trim()) return out(c, { error: 'empty' }, 400);
  if (csv.length > 2_000_000) return out(c, { error: 'too_large' }, 413);

  const sequence = isSequenceKind(body?.sequence) ? body.sequence : null;
  if (sequence && parseContactsCsv(csv).rows.length > MAX_QUEUE_BATCH) return out(c, { error: 'import_only_required', max: MAX_QUEUE_BATCH }, 400);
  const campaign = text(body?.campaign, 40) ?? 'launch';
  const roleReason = overrideReason(body);
  if (body?.force === true && !roleReason) return out(c, { error: 'force_reason_required' }, 400);
  const result = await importContacts(env, csv, sequence, campaign, { roleReason, sourceKind: text(body?.sourceKind, 80) });
  return out(c, { ...result, sequence: sequence ?? 'none' });
});

const MAX_QUEUE_BATCH = 100;

type QueueCandidate = Contact & { mx: number | null; checked_at: number | null; active: number; prior_bounce: number; prior_opt_out: number };

async function loadQueueCandidates(env: Env, ids: number[]): Promise<QueueCandidate[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.*, d.mx, d.checked_at,
            EXISTS(SELECT 1 FROM marketing_messages m WHERE m.contact_id = c.id AND m.status IN ('scheduled', 'sending')) AS active,
            EXISTS(SELECT 1 FROM marketing_events e WHERE e.contact_id = c.id AND e.kind IN ('bounce', 'complaint')) AS prior_bounce,
            EXISTS(SELECT 1 FROM marketing_events e WHERE e.contact_id = c.id AND e.kind = 'opt_out') AS prior_opt_out
       FROM marketing_contacts c LEFT JOIN marketing_domains d ON d.domain = substr(c.email, instr(c.email, '@') + 1)
      WHERE c.id IN (${ids.map(() => '?').join(',')})
      ORDER BY c.id`,
  ).bind(...ids).all<QueueCandidate>();
  return results ?? [];
}

function verificationReasons(contact: QueueCandidate, t: number, checkMx = true): string[] {
  const reasons = [];
  if (contact.prior_bounce) reasons.push('bounced');
  if (contact.prior_opt_out) reasons.push('suppressed');
  if (checkMx) {
    if (contact.mx === 0) reasons.push('no_mx');
    else if (contact.mx !== 1 || !contact.checked_at || contact.checked_at <= t - MX_CACHE_DAYS * 86400 || !contact.verified_at || contact.verified_at > t) reasons.push('unverified');
  }
  if (contact.country && CONSENT_COUNTRIES.has(contact.country)) reasons.push('country_requires_consent');
  return reasons;
}

/** Queue a named batch. Only use cached MX results: this admin request does no DNS. */
marketing.post('/admin/marketing/contacts/queue', async (c) => {
  const env = c.env;
  const body = await jsonBody(c);
  const sequence = isSequenceKind(body?.sequence) ? body.sequence : 'cold_a';
  const batch = text(body?.batch ?? body?.campaign, 40);
  if (!batch) return out(c, { error: 'batch_name_required' }, 400);
  const roleReason = overrideReason(body);
  if (body?.force === true && !roleReason) return out(c, { error: 'force_reason_required' }, 400);
  const rawIds = body?.ids;
  if (!Array.isArray(rawIds) || rawIds.length < 1 || rawIds.length > MAX_QUEUE_BATCH ||
    rawIds.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)) {
    return out(c, { error: 'invalid_batch_ids', max: MAX_QUEUE_BATCH }, 400);
  }
  const ids = [...new Set<number>(rawIds)];
  const t = now();
  const contacts = await loadQueueCandidates(env, ids);
  const queueable: Contact[] = [];
  const excluded: { id: number; email: string | null; reasons: string[] }[] = [];
  for (const contact of contacts) {
    const reasons = new Set([...queueReasons(contact, sequence, roleReason), ...verificationReasons(contact, t)]);
    if (contact.active) reasons.add('already_queued');
    else if (!['new', 'paused'].includes(contact.status) && !reasons.size) reasons.add('contact_closed');
    if (reasons.size) excluded.push({ id: contact.id, email: contact.email, reasons: [...reasons] });
    else queueable.push(contact);
  }
  const found = new Set(contacts.map(({ id }) => id));
  for (const id of ids) if (!found.has(id)) excluded.push({ id, email: null, reasons: ['not_found'] });
  const queued = await queueContacts(env, queueable, sequence, batch, t, roleReason);
  return out(c, {
    ok: true,
    batch,
    queued: queued.contacts,
    emails: queued.messages,
    included: queueable.map(({ id, email }) => ({ id, email })),
    excluded,
    skippedNoGap: excluded.filter(({ reasons }) => reasons.includes('gap_required')).length,
    total: contacts.length,
    sequence,
  });
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
  if (body.sourceUrl !== undefined) set('source_url', text(body.sourceUrl, 500));
  if (body.trigger !== undefined) set('trigger', text(body.trigger, 300));
  if (body.triggerUrl !== undefined) set('trigger_url', text(body.triggerUrl, 500));
  if (body.verifiedAt !== undefined) set('verified_at', cleanVerifiedAt(body.verifiedAt));
  if (body.qualityHold !== undefined) set('quality_hold', text(body.qualityHold, 500));
  if (body.notes !== undefined) set('notes', text(body.notes, 1000));
  if (body.country !== undefined) set('country', cleanCountry(body.country));
  if (body.sourceKind !== undefined) set('source_kind', cleanSourceKind(body.sourceKind));

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
  const [contact] = await loadQueueCandidates(env, [id]);
  if (!contact) return out(c, { error: 'not_found' }, 404);
  const sequence = isSequenceKind(body?.sequence) ? body.sequence : 'cold_a';
  const roleReason = overrideReason(body);
  if (body?.force === true && !roleReason) return out(c, { error: 'force_reason_required' }, 400);
  const reasons = [...new Set([...queueReasons(contact, sequence, roleReason), ...verificationReasons(contact, now())])];
  if (reasons.length) return out(c, { error: reasons[0], reasons }, 400);

  if (contact.active) return out(c, { error: 'already_queued' }, 409);
  if (!['new', 'paused'].includes(contact.status)) return out(c, { error: 'contact_closed' }, 400);

  const queued = await queueSequence(env, contact, sequence, text(body?.campaign, 40) ?? 'launch', now(), roleReason);
  return out(c, { ok: true, queued });
});

/* —— messages —— */

interface Message {
  role_override_reason?: string | null;
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
  edited_at?: number | null;
  reviewed_at?: number | null;
  provider?: string | null;
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
    editedAt: m.edited_at ?? null,
    reviewedAt: m.reviewed_at ?? null,
    provider: m.provider ?? null,
    roleOverrideReason: m.role_override_reason ?? null,
  };
}

marketing.get('/admin/marketing/messages', async (c) => {
  const status = c.req.query('status') ?? '';
  const channel = c.req.query('channel') ?? '';
  const campaign = c.req.query('campaign') ?? '';
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
  // The desk's own campaigns can be thousands of rows; the queue view asks for
  // 'auto' so its posts are never pushed out of the 200-row window.
  if (/^[a-z0-9_-]{1,40}$/.test(campaign)) {
    where.push('m.campaign = ?');
    binds.push(campaign);
  }
  // `order=next` is the send order: what goes out first, at the top.
  const next = c.req.query('order') === 'next';
  const { results } = await c.env.DB.prepare(
    `SELECT m.*, c.email AS contact_email
       FROM marketing_messages m LEFT JOIN marketing_contacts c ON c.id = m.contact_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${next ? 'COALESCE(m.scheduled_at, m.created_at) ASC, m.id ASC' : 'COALESCE(m.scheduled_at, m.created_at) DESC, m.id DESC'} LIMIT 200`,
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
 * Rewrite a post or an email before it goes out. A post's text is the whole
 * message, so it must fit the channel. An edited email is marked, so
 * "Re-render scheduled" leaves Ali's wording alone. Anything already claimed
 * or sent is the record and is not edited.
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
  if (!['draft', 'scheduled', 'failed'].includes(message.status)) return out(c, { error: 'not_editable' }, 409);

  if (message.channel === 'email') {
    const subject = typeof body?.subject === 'string' ? body.subject.replace(/\s+/g, ' ').trim() : '';
    const textBody = typeof body?.body === 'string' ? body.body.replace(/\r\n?/g, '\n').trim() : '';
    if (!subject || !textBody) return out(c, { error: 'empty' }, 400);
    if (subject.length > 200 || textBody.length > 20_000) return out(c, { error: 'too_long' }, 400);
    const updated = await env.DB.prepare(
      `UPDATE marketing_messages SET subject = ?, body = ?, edited_at = ?, reviewed_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('draft', 'scheduled', 'failed') RETURNING *`,
    )
      .bind(subject, textBody, now(), now(), now(), id)
      .first<Message>();
    if (!updated) return out(c, { error: 'not_editable' }, 409);
    return out(c, { message: messageView(updated) });
  }

  const text = (typeof body?.body === 'string' ? body.body : '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return out(c, { error: 'empty' }, 400);
  const max = POST_MAX[message.channel] ?? 3_000;
  const length = countedPostLength(text, message.channel);
  if (length > max) return out(c, { error: 'too_long', max, length }, 400);

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
  const sender = senderState(env, settings);
  if (!sender.ready) return out(c, { error: sender.reason }, 503);
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

/** One message, and exactly what would leave: headers, subject, body with the footer. */
marketing.get('/admin/marketing/messages/:id', async (c) => {
  const env = c.env;
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return out(c, { error: 'bad_id' }, 400);
  const message = await env.DB.prepare(
    `SELECT m.*, c.email AS contact_email FROM marketing_messages m LEFT JOIN marketing_contacts c ON c.id = m.contact_id WHERE m.id = ?`,
  )
    .bind(id)
    .first<Message & { contact_email: string | null }>();
  if (!message) return out(c, { error: 'not_found' }, 404);
  const [contact, events] = await Promise.all([
    message.contact_id ? getContact(env, message.contact_id) : Promise.resolve(null),
    env.DB.prepare('SELECT id, kind, detail, created_at FROM marketing_events WHERE message_id = ? ORDER BY id DESC LIMIT 20')
      .bind(id)
      .all<{ id: number; kind: string; detail: string | null; created_at: number }>(),
  ]);
  let preview = null;
  if (message.channel === 'email') {
    const settings = await readMarketingSettings(env);
    const outgoing = await renderOutgoing(env, settings, message);
    preview = {
      from: `${settings.fromName} <${marketingFrom(env)}>`,
      replyTo: marketingFrom(env),
      to: outgoing.to,
      subject: outgoing.subject,
      text: outgoing.text,
      image: outgoing.html ? `${siteUrl(env)}${EMAIL_IMAGE.path}` : null,
      headers: outgoing.headers,
      provider: message.provider ?? settings.provider,
    };
  } else {
    const verdict = cleanPost(message.body, message.channel);
    preview = {
      checks: verdict.ok ? null : verdict.reason,
      length: countedPostLength(message.body, message.channel),
      max: POST_MAX[message.channel] ?? 3_000,
    };
  }
  return out(c, {
    message: messageView(message),
    contact: contact ? contactView(contact) : null,
    preview,
    events: (events.results ?? []).map((e) => ({ id: e.id, kind: e.kind, detail: e.detail, createdAt: e.created_at })),
  });
});

/**
 * Send one email to Ali as the recipient would get it, through the provider
 * in use, so it can be read in a real inbox. The message itself is untouched.
 */
marketing.post('/admin/marketing/messages/:id/test', async (c) => {
  const env = c.env;
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return out(c, { error: 'bad_id' }, 400);
  const message = await env.DB.prepare('SELECT * FROM marketing_messages WHERE id = ?').bind(id).first<Message>();
  if (!message || message.channel !== 'email') return out(c, { error: 'not_found' }, 404);
  const settings = await readMarketingSettings(env);
  const sender = senderState(env, settings);
  if (!sender.ready) return out(c, { error: sender.reason }, 503);
  // The primary admin (ADMIN_EMAIL, else the first ADMIN_EMAILS entry) reads
  // the test; a desk with several admins still sends one message per press.
  const to = cleanEmail(primaryAdminEmail(env) ?? '');
  if (!to) return out(c, { error: 'admin_email_unset' }, 400);
  const outgoing = await renderOutgoing(env, settings, message);
  try {
    // No list headers: an unsubscribe pressed on a test must not opt the real contact out.
    await transmit(env, settings, { ...outgoing, to, subject: `[test] ${outgoing.subject}`, headers: {} });
  } catch (error) {
    return out(c, { error: 'send_failed', detail: error instanceof Error ? error.message : String(error) }, 502);
  }
  await logEvent(env, { messageId: id, contactId: message.contact_id, kind: 'test', detail: `to ${to} via ${settings.provider}` });
  return out(c, { ok: true, to, provider: settings.provider });
});

/**
 * The review queue: first emails due next that nobody has read yet, in send
 * order, with how many of the next day's are done.
 */
marketing.get('/admin/marketing/review', async (c) => {
  const env = c.env;
  const limit = Math.max(1, Math.min(100, Number(c.req.query('limit')) || 50));
  const t = now();
  const [list, day] = await Promise.all([
    env.DB.prepare(
      `SELECT m.*, c.email AS contact_email FROM marketing_messages m JOIN marketing_contacts c ON c.id = m.contact_id
        WHERE m.channel = 'email' AND m.status = 'scheduled' AND m.step = 0
          AND m.reviewed_at IS NULL AND m.edited_at IS NULL
          AND c.status IN ('new', 'queued', 'contacted')
        ORDER BY m.scheduled_at, m.id LIMIT ?`,
    )
      .bind(limit)
      .all<Message & { contact_email: string | null }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total, SUM(reviewed_at IS NOT NULL OR edited_at IS NOT NULL) AS done
         FROM marketing_messages WHERE channel = 'email' AND status = 'scheduled' AND step = 0 AND scheduled_at <= ?`,
    )
      .bind(t + 86400)
      .first<{ total: number; done: number | null }>(),
  ]);
  return out(c, {
    messages: (list.results ?? []).map(messageView),
    nextDay: { total: day?.total ?? 0, reviewed: day?.done ?? 0 },
  });
});

/** Ali read it and lets it go as it is. */
marketing.post('/admin/marketing/messages/:id/review', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return out(c, { error: 'bad_id' }, 400);
  const message = await c.env.DB.prepare(
    `UPDATE marketing_messages SET reviewed_at = ?, updated_at = ? WHERE id = ? AND channel = 'email' AND status IN ('draft', 'scheduled', 'failed') RETURNING *`,
  )
    .bind(now(), now(), id)
    .first<Message>();
  if (!message) return out(c, { error: 'not_reviewable' }, 409);
  return out(c, { message: messageView(message) });
});

/** Everyone who wrote back, newest first, with what they said. */
marketing.get('/admin/marketing/replies', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.kind, e.detail, e.created_at, c.id AS contact_id, c.email, c.name, c.business, c.site, c.status
       FROM marketing_events e JOIN marketing_contacts c ON c.id = e.contact_id
      WHERE e.kind IN ('reply', 'opt_out', 'complaint')
      ORDER BY e.id DESC LIMIT 100`,
  ).all<{ id: number; kind: string; detail: string | null; created_at: number; contact_id: number; email: string; name: string | null; business: string | null; site: string | null; status: string }>();
  return out(c, {
    replies: (results ?? []).map((r) => ({
      id: r.id,
      kind: r.kind,
      text: r.detail,
      at: r.created_at,
      contact: { id: r.contact_id, email: r.email, name: r.name, business: r.business, site: r.site, status: r.status },
    })),
  });
});

/** Per local day: what left and what came back. */
marketing.get('/admin/marketing/stats', async (c) => {
  const env = c.env;
  const settings = await readMarketingSettings(env);
  const days = Math.max(1, Math.min(60, Number(c.req.query('days')) || 14));
  const t = now();
  const { dayStart } = localClock(settings.offsetMinutes, t);
  const since = dayStart - (days - 1) * 86400;
  const dayOf = `CAST((%s - ${since}) / 86400 AS INTEGER)`;
  const [sent, events] = await Promise.all([
    env.DB.prepare(
      `SELECT ${dayOf.replace('%s', 'sent_at')} AS d, COUNT(*) AS n FROM marketing_messages
        WHERE channel = 'email' AND status = 'sent' AND sent_at >= ? GROUP BY d`,
    )
      .bind(since)
      .all<{ d: number; n: number }>(),
    env.DB.prepare(
      `SELECT ${dayOf.replace('%s', 'created_at')} AS d, kind, COUNT(*) AS n FROM marketing_events
        WHERE created_at >= ? AND kind IN ('reply', 'bounce', 'opt_out', 'complaint', 'published') GROUP BY d, kind`,
    )
      .bind(since)
      .all<{ d: number; kind: string; n: number }>(),
  ]);
  const rows = Array.from({ length: days }, (_, d) => ({ day: since + d * 86400, sent: 0, reply: 0, bounce: 0, opt_out: 0, complaint: 0, published: 0 }));
  for (const r of sent.results ?? []) if (rows[r.d]) rows[r.d].sent = r.n;
  for (const r of events.results ?? []) if (rows[r.d]) (rows[r.d] as Record<string, number>)[r.kind] = r.n;
  return out(c, { days: rows.reverse(), offsetMinutes: settings.offsetMinutes });
});

/** A drafted post goes into its slot, or out now if the slot has passed. */
marketing.post('/admin/marketing/messages/:id/approve', async (c) => {
  const env = c.env;
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return out(c, { error: 'bad_id' }, 400);
  const t = now();
  const message = await env.DB.prepare(
    `UPDATE marketing_messages SET status = 'scheduled', scheduled_at = MAX(COALESCE(scheduled_at, ?), ?), updated_at = ?
      WHERE id = ? AND status = 'draft' AND channel IN ('x', 'linkedin') RETURNING *`,
  )
    .bind(t, t, t, id)
    .first<Message>();
  if (!message) return out(c, { error: 'not_a_draft' }, 409);
  await logEvent(env, { messageId: id, kind: 'approved', detail: `${message.channel}: ${message.body.slice(0, 120)}` });
  return out(c, { message: messageView(message) });
});

/**
 * Every step of a sequence as one contact would get it, both versions where a
 * step has a plain one. Without a contact id, a queued contact stands in, so
 * the preview shows real names and sites.
 */
marketing.get('/admin/marketing/sequences/preview', async (c) => {
  const env = c.env;
  const kind = c.req.query('sequence') ?? 'cold_a';
  if (!isSequenceKind(kind)) return out(c, { error: 'bad_sequence' }, 400);
  const id = Number(c.req.query('contactId'));
  const contact = Number.isInteger(id) && id > 0
    ? await getContact(env, id)
    : await env.DB.prepare(
        `SELECT * FROM marketing_contacts WHERE status IN ('new', 'queued', 'paused') AND business IS NOT NULL
          ORDER BY RANDOM() LIMIT 1`,
      ).first<Contact>();
  const sample: ContactFields = contact ?? { name: 'Jordan Lee', business: 'Lee Plumbing', site: 'leeplumbing.com', gap: null };
  const settings = await readMarketingSettings(env);
  const specific = Boolean(sample.gap?.trim());
  const fields = sample;
  return out(c, {
    sequence: kind,
    label: SEQUENCE_LABELS[kind],
    contact: contact ? contactView(contact) : null,
    footer: footerFor(settings),
    steps: SEQUENCES[kind].map((step) => ({
      kind: step.kind,
      day: step.day,
      subject: fillTemplate(step.subject, fields),
      body: fillTemplate(stepBody(step, specific), fields),
      // What a contact without an observation gets, when the step has a version for that.
      plain: !specific || !step.plain ? null : fillTemplate(step.plain, fields),
      usesPlain: !specific && Boolean(step.plain),
    })),
  });
});

/**
 * How each list is doing. A source is the label an import carried; the rates
 * are what decide which kind of list deserves the next hour of sourcing.
 */
marketing.get('/admin/marketing/sources', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT COALESCE(c.source_kind, '(none)') AS source,
            COUNT(*) AS contacts,
            SUM(c.status = 'queued') AS queued,
            SUM(EXISTS (SELECT 1 FROM marketing_messages m WHERE m.contact_id = c.id AND m.status = 'sent')) AS reached,
            SUM(c.status = 'replied') AS replied,
            SUM(c.status = 'bounced') AS bounced,
            SUM(c.status = 'opted_out') AS opted_out,
            SUM(EXISTS (SELECT 1 FROM marketing_events e WHERE e.contact_id = c.id AND e.kind = 'complaint')) AS complaints,
            MIN(c.created_at) AS first_at
       FROM marketing_contacts c
      GROUP BY COALESCE(c.source_kind, '(none)')
      ORDER BY first_at DESC`,
  ).all<{
    source: string;
    contacts: number;
    queued: number;
    reached: number;
    replied: number;
    bounced: number;
    opted_out: number;
    complaints: number;
    first_at: number;
  }>();
  return out(c, {
    sources: (results ?? []).map((row) => ({
      source: row.source,
      contacts: row.contacts,
      queued: row.queued ?? 0,
      reached: row.reached ?? 0,
      replied: row.replied ?? 0,
      bounced: row.bounced ?? 0,
      optedOut: row.opted_out ?? 0,
      complaints: row.complaints ?? 0,
      firstAt: row.first_at,
    })),
  });
});

/* —— settings and a manual run —— */

marketing.put('/admin/marketing/settings', async (c) => {
  const body = await jsonBody(c);
  if (!body) return out(c, { error: 'bad_json' }, 400);
  const rejected = await saveMarketingSettings(c.env, body);
  // A person's pause is never undone by the cron: touching `live` by hand
  // clears the stamp the auto-resume reads.
  if ('live' in body && !rejected.includes('live')) {
    await writeStamp(c.env, 'marketing_auto_paused_at', null);
  }
  return out(c, { settings: await readMarketingSettings(c.env), rejected });
});

/** Templates changed: bring the scheduled emails in line with them. */
marketing.post('/admin/marketing/messages/rerender', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { from?: unknown; to?: unknown };
  const isKind = (v: unknown): v is SequenceKind => typeof v === 'string' && v in SEQUENCES;
  if ((body.from !== undefined || body.to !== undefined) && !(isKind(body.from) && isKind(body.to))) {
    return out(c, { error: 'bad_sequence' }, 400);
  }
  if (isKind(body.from) && isKind(body.to) && SEQUENCES[body.from].some((step, i) => SEQUENCES[body.to as SequenceKind][i]?.day !== step.day)) {
    return out(c, { error: 'sequences_differ' }, 400);
  }
  const done = await rerenderScheduled(c.env, isKind(body.from) && isKind(body.to) ? { from: body.from, to: body.to } : {});
  await logEvent(c.env, {
    kind: 'rerendered',
    detail: `${done.updated} scheduled emails re-rendered${done.moved ? `, ${done.moved} moved from ${body.from} to ${body.to}` : ''}, ${done.skipped} left alone`,
  });
  return out(c, done);
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

export function postMail(
  env: Env,
  post: { id: number; channel: string; body: string },
  ok: boolean,
  url: string | null,
  error: string,
): { subject: string; text: string } {
  const where = post.channel === 'x' ? 'X' : 'LinkedIn';
  const first = post.body.split('\n')[0].slice(0, 60);
  return ok
    ? {
        subject: `Posted on ${where}: ${first}`,
        text: [`This went out on ${where}${url ? `:\n${url}` : '.'}`, '', post.body, '', `Desk: ${siteUrl(env)}/portal/admin#marketing`].join('\n'),
      }
    : {
        subject: `${where} post failed: ${first}`,
        text: [
          `The publisher could not post this on ${where}: ${error}`,
          '',
          post.body,
          '',
          `Retry or edit it in the desk: ${siteUrl(env)}/portal/admin#marketing`,
        ].join('\n'),
      };
}

/* —— router: the unsubscribe link, public and signed —— */

export const unsubscribe = new Hono<HonoEnv>();

const page = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#222">${body}</body>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );

async function unsubContact(env: Env, idParam: string, sig: string): Promise<Contact | null> {
  const id = Number(idParam);
  if (!Number.isInteger(id) || !unsubSecret(env) || !sameText(sig, await unsubSig(env, id))) return null;
  return getContact(env, id);
}

// A GET only asks: link scanners open every URL in a message, and must not opt anyone out.
unsubscribe.get('/marketing/u/:id/:sig', async (c) => {
  const contact = await unsubContact(c.env, c.req.param('id'), c.req.param('sig'));
  if (!contact) return page('Link not valid', '<p>This unsubscribe link is not valid. Reply "no" to the email and I will stop writing.</p>', 404);
  if (contact.status === 'opted_out') return page('Unsubscribed', `<p>${contact.email} is unsubscribed. Nothing more will be sent.</p>`);
  return page(
    'Unsubscribe',
    `<p>Stop emails from ptechsolutions.net to <b>${contact.email.replace(/[<>&"]/g, '')}</b>?</p>` +
      `<form method="post"><button style="font:inherit;padding:.5rem 1rem">Unsubscribe</button></form>`,
  );
});

// The button above, and the one-click POST mail clients send (RFC 8058).
unsubscribe.post('/marketing/u/:id/:sig', async (c) => {
  const env = c.env;
  const contact = await unsubContact(env, c.req.param('id'), c.req.param('sig'));
  if (!contact) return page('Link not valid', '<p>This unsubscribe link is not valid.</p>', 404);
  if (contact.status !== 'opted_out') {
    const t = now();
    await env.DB.prepare(`UPDATE marketing_contacts SET status = 'opted_out', opted_out_at = ?, updated_at = ? WHERE id = ?`)
      .bind(t, t, contact.id)
      .run();
    const cancelled = await cancelScheduled(env, contact.id);
    await logEvent(env, { contactId: contact.id, kind: 'opt_out', detail: `unsubscribe link, ${cancelled} cancelled` });
  }
  return page('Unsubscribed', `<p>Done. ${contact.email.replace(/[<>&"]/g, '')} will not get another email from me.</p>`);
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
      WHERE id = ? AND status = 'sending' RETURNING id, contact_id, channel, body`,
  )
    .bind(ok ? 'sent' : 'failed', ok ? t : null, url, ok ? null : error, t, id)
    .first<{ id: number; contact_id: number | null; channel: string; body: string }>();
  if (!message) return out(c, { error: 'not_claimed' }, 409);

  await logEvent(env, {
    messageId: message.id,
    contactId: message.contact_id,
    kind: ok ? 'published' : 'failed',
    detail: ok ? url : error,
  });
  // Every post that goes out in our name is mailed to Ali, word for word.
  await mailAli(env, postMail(env, message, ok, url, error));
  return out(c, { ok: true });
});
