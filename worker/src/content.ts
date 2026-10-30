/*
 * The content cycle: a fleet agent writes the week's X and LinkedIn posts.
 *
 * A cycle ticket is filed on a node like any approved system ticket, with a
 * brief instead of a request. The agent reads the launch kit in the worktree
 * and the recent posts the brief lists, then answers with a small block at the
 * end of its summary:
 *
 *   <<<OUTBOX
 *   {"posts":[{"channel":"x","text":"…"}, …]}
 *   OUTBOX>>>
 *
 * The outbox is the only thing this module trusts, and it trusts it only as
 * far as `cleanPost` says: right channel, right length, no model names, no
 * invented claims. Whatever passes is scheduled on the next Tuesday, Thursday
 * and Saturday, and shows up in the marketing desk like a hand-written post.
 *
 * The posts in the store are the memory. Every brief lists the last dozen, so
 * the agent does not repeat an angle it cannot see; nothing lives in a file
 * the agent writes, because each run starts from a fresh worktree.
 */
import { now, type Env } from './shared.ts';

const DAY = 86_400;
const MINUTE = 60;

/** The repo whose worktree the agent works in. */
export const CYCLE_PROJECT = 'malipetek-dev-site';
/** How many posts one cycle writes. */
export const CYCLE_POSTS = 3;
/** A cycle ticket younger than this is not joined by another. */
const RETRY_AFTER = DAY;
/** A cycle that queued posts is not repeated for a week. */
const WEEKLY = 6 * DAY + 12 * 3600;
/** Scheduled posts that already fill the next week mean there is work left to do. */
const STOCK = 3;

/** Local publishing slots, one per post, in the order they are handed out. */
export const CONTENT_SLOTS = [
  { weekday: 2, hour: 9, minute: 30 }, // Tuesday
  { weekday: 4, hour: 9, minute: 30 }, // Thursday
  { weekday: 6, hour: 10, minute: 0 }, // Saturday
] as const;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Unix seconds → a short local label such as `Tue 3 Nov 09:30`. */
export function slotLabel(at: number, offsetMinutes: number): string {
  const local = at + offsetMinutes * MINUTE;
  const day = Math.floor(local / DAY);
  const rem = local - day * DAY;
  const hour = String(Math.floor(rem / 3600)).padStart(2, '0');
  const minute = String(Math.floor((rem % 3600) / 60)).padStart(2, '0');
  return `${WEEKDAYS[((day + 4) % 7 + 7) % 7]} ${dayLabel(at, offsetMinutes)} ${hour}:${minute}`;
}

/** `3 Nov`, for titles and lists. */
export function dayLabel(at: number, offsetMinutes: number): string {
  const date = new Date(Math.floor((at + offsetMinutes * MINUTE) / DAY) * DAY * 1000);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** The next local slots after `from` that nothing is scheduled in, oldest first. */
export function nextSlots(
  from: number,
  count: number,
  offsetMinutes: number,
  taken: ReadonlySet<number> = new Set(),
): number[] {
  const out: number[] = [];
  const day = Math.floor((from + offsetMinutes * MINUTE) / DAY);
  for (let offset = 0; out.length < count && offset <= 7 * (count + 1); offset += 1) {
    const index = day + offset;
    const weekday = ((index + 4) % 7 + 7) % 7;
    for (const slot of CONTENT_SLOTS) {
      if (slot.weekday !== weekday) continue;
      const at = index * DAY + slot.hour * 3600 + slot.minute * MINUTE - offsetMinutes * MINUTE;
      if (at > from && !taken.has(at)) out.push(at);
      if (out.length === count) break;
    }
  }
  return out;
}

export interface OutboxPost {
  channel: 'x' | 'linkedin';
  text: string;
}

export type CleanPost = { ok: true; text: string } | { ok: false; reason: string };

const BANNED = [
  { pattern: /\bai[- ]powered\b/i, reason: 'says “AI-powered”' },
  { pattern: /\b(chatgpt|openai|anthropic|claude|gemini|copilot)\b/i, reason: 'names a model or provider' },
  { pattern: /\bgpt-?\d/i, reason: 'names a model or provider' },
  { pattern: /\b(guarantee[ds]?|risk[- ]free)\b/i, reason: 'makes a guarantee' },
  { pattern: /\b(10x|100x)\b/i, reason: 'claims a multiplier' },
];

/** One post, or the reason it cannot go out as written. */
export function cleanPost(raw: unknown, channel: 'x' | 'linkedin'): CleanPost {
  if (typeof raw !== 'string') return { ok: false, reason: 'not text' };
  const text = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (text.includes('<<<OUTBOX') || text.includes('OUTBOX>>>')) return { ok: false, reason: 'contains the outbox marker' };
  const limit = channel === 'x' ? 280 : 3_000;
  if (text.length > limit) return { ok: false, reason: `${text.length} characters, ${channel} allows ${limit}` };
  for (const rule of BANNED) if (rule.pattern.test(text)) return { ok: false, reason: rule.reason };
  const hashtags = text.match(/#[A-Za-z0-9_]+/g) ?? [];
  if (hashtags.length > 2) return { ok: false, reason: `${hashtags.length} hashtags` };
  return { ok: true, text };
}

/** The posts in an agent's summary, or null when the block is missing or unreadable. */
export function parseOutbox(summary: string): OutboxPost[] | null {
  const start = summary.lastIndexOf('<<<OUTBOX');
  if (start < 0) return null;
  const end = summary.indexOf('OUTBOX>>>', start + 9);
  if (end < 0) return null;
  const raw = summary
    .slice(start + 9, end)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const posts = (parsed as { posts?: unknown })?.posts;
  if (!Array.isArray(posts)) return null;
  return posts.filter(
    (post): post is OutboxPost =>
      Boolean(post) &&
      (post.channel === 'x' || post.channel === 'linkedin') &&
      typeof post.text === 'string',
  );
}

interface RecentPost {
  channel: string;
  body: string;
  status: string;
  at: number;
}

/**
 * The desk's UTC offset, read here so this module does not import the router
 * (the router imports it). Same default and bounds as the marketing settings.
 */
async function readOffset(env: Env): Promise<number> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'marketing_utc_offset'`)
    .first<{ value: string }>();
  try {
    const value = Number(JSON.parse(row?.value ?? '180'));
    return Number.isInteger(value) && value >= -720 && value <= 840 ? value : 180;
  } catch {
    return 180;
  }
}

/** The desk's voice notes, read the same way and for the same reason as the offset. */
async function readVoiceNotes(env: Env): Promise<string> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'marketing_voice_notes'`)
    .first<{ value: string }>();
  try {
    const raw: unknown = JSON.parse(row?.value ?? '""');
    return typeof raw === 'string' ? raw.trim().slice(0, 800) : '';
  } catch {
    return '';
  }
}

/** The audit trail row the desk's recent-events list reads. */
async function event(env: Env, kind: string, detail: string): Promise<void> {
  await env.DB.prepare('INSERT INTO marketing_events (message_id, contact_id, kind, detail, created_at) VALUES (NULL, NULL, ?, ?, ?)')
    .bind(kind, detail.slice(0, 2000), now())
    .run();
}

/** The last dozen social posts, oldest first — what the agent must not repeat. */
async function recentPosts(env: Env): Promise<RecentPost[]> {
  const { results } = await env.DB.prepare(
    `SELECT channel, body, status, COALESCE(sent_at, scheduled_at, created_at) AS at
       FROM marketing_messages WHERE channel IN ('x', 'linkedin')
      ORDER BY at DESC, id DESC LIMIT 12`,
  ).all<RecentPost>();
  return (results ?? []).reverse();
}

function history(posts: RecentPost[], offsetMinutes: number): string {
  if (!posts.length) return 'Nothing has gone out yet. These are the first posts.';
  return posts
    .map((post, index) => {
      const label = `${post.channel === 'x' ? 'X' : 'LinkedIn'}, ${post.status === 'sent' ? 'published' : post.status} ${dayLabel(post.at, offsetMinutes)}`;
      return `${index + 1}. [${label}]\n${post.body.split('\n').map((line) => `   ${line}`).join('\n')}`;
    })
    .join('\n\n');
}

function brief(posts: RecentPost[], offsetMinutes: number, voice: string): string {
  return [
    "Write next week's X and LinkedIn posts — two for X, one for LinkedIn.",
    '',
    'Read these first, in this folder:',
    '- marketing/launch/social.md — voice, cadence and the ideas already used',
    '- marketing/launch/proof.md — the only numbers you may use',
    '- marketing/kit.md — what the product is, if you need the framing',
    ...(voice ? ['', 'The desk adds this about voice; follow it over the kit where they disagree:', voice] : []),
    '',
    'Recent posts, oldest first. Do not repeat an angle that is already here:',
    '',
    history(posts, offsetMinutes),
    '',
    'Write:',
    '- two posts for X, each 280 characters or fewer including line breaks',
    '- one post for LinkedIn, 3,000 characters or fewer',
    '',
    'Rules:',
    '- Write for someone who has never heard of this. Introduce it plainly in the',
    '  first line: what it is, and who it is for.',
    '- Pricing is not the subject. At most one plain sentence, not on every post,',
    '  and never as the opening line.',
    '- Dry voice, first person, the same as the launch kit. No “AI-powered”, no model or',
    '  provider names, no more than two hashtags, no invented results.',
    '- Every number must appear in proof.md. If a post needs a number that is not',
    '  there, write a different post.',
    '- Each post stands alone months from now: no “this week”, no thread references,',
    '  no numbering.',
    '- Text only. Do not change or commit any files.',
    '',
    'End your reply with this block, and nothing after it:',
    '',
    '<<<OUTBOX',
    '{"posts":[{"channel":"x","text":"..."},{"channel":"x","text":"..."},{"channel":"linkedin","text":"..."}]}',
    'OUTBOX>>>',
    '',
    'Keep the prose before it to a few lines: the report keeps the first 8,000',
    'characters, and a block cut in half is a week without posts.',
    'The Worker schedules whatever parses there and ignores the rest of your reply.',
  ].join('\n');
}

export interface CycleResult {
  filed: boolean;
  id?: number;
  reason?: string;
}

/**
 * File one cycle ticket if the queue needs posts. Runs every five minutes and
 * is idempotent: one open cycle at a time, one attempt a day, one success a
 * week, and never while the next week is already stocked.
 */
export async function ensureContentCycle(env: Env, t = now(), options: { force?: boolean } = {}): Promise<CycleResult> {
  const project = await env.DB.prepare('SELECT id FROM projects WHERE slug = ?').bind(CYCLE_PROJECT).first<{ id: string }>();
  if (!project) return { filed: false, reason: 'no_project' };

  const open = await env.DB.prepare(
    `SELECT id FROM tickets WHERE marketing_cycle = 1 AND status IN ('approved', 'in_progress') LIMIT 1`,
  ).first<{ id: number }>();
  if (open) return { filed: false, reason: 'open_cycle', id: open.id };

  if (!options.force) {
    const recent = await env.DB.prepare(
      `SELECT id FROM tickets WHERE marketing_cycle > 0 AND created_at > ? ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(t - RETRY_AFTER)
      .first<{ id: number }>();
    if (recent) return { filed: false, reason: 'recent_cycle', id: recent.id };

    const queued = await env.DB.prepare(
      `SELECT id FROM tickets WHERE marketing_cycle = 2 AND created_at > ? ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(t - WEEKLY)
      .first<{ id: number }>();
    if (queued) return { filed: false, reason: 'weekly_cycle', id: queued.id };

    const stock = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM marketing_messages
        WHERE channel IN ('x', 'linkedin') AND status = 'scheduled' AND scheduled_at > ?`,
    )
      .bind(t)
      .first<{ n: number }>();
    if ((stock?.n ?? 0) >= STOCK) return { filed: false, reason: 'stocked' };
  }

  const admin = await env.DB.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`).first<{ id: string }>();
  if (!admin) return { filed: false, reason: 'no_admin' };

  const offset = await readOffset(env);
  const voice = await readVoiceNotes(env);
  const posts = await recentPosts(env);
  const first = nextSlots(t, 1, offset)[0] ?? t;
  const title = `Social posts for the week of ${dayLabel(first, offset)}`;

  const ticket = await env.DB.prepare(
    `INSERT INTO tickets (user_id, project_id, title, status, kind, source, priority, requires, executor, attention, marketing_cycle, created_at, updated_at)
     VALUES (?, ?, ?, 'approved', 'system', 'dsh', 0, '[]', NULL, 'auto', 1, ?, ?) RETURNING id`,
  )
    .bind(admin.id, project.id, title, t, t)
    .first<{ id: number }>();
  if (!ticket) return { filed: false, reason: 'insert_failed' };

  await env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'ali', ?, 1, ?)`)
    .bind(ticket.id, brief(posts, offset, voice), t)
    .run();
  return { filed: true, id: ticket.id };
}

export interface CycleFinish {
  handled: boolean;
  queued: number;
  slots: number[];
  reason?: string;
}

/** Note something on the cycle ticket, then leave it where finishRun put it. */
async function note(env: Env, ticketId: number, body: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 1, ?)`)
    .bind(ticketId, body, now())
    .run();
}

/**
 * Turn a cycle run's summary into scheduled posts. Called after finishRun has
 * closed the run, so the ticket already reads “In review”; a cycle that queued
 * its posts moves to done, one that did not stays there for Ali to see.
 */
export async function finishContentCycle(env: Env, ticketId: number, summary: string, ok: boolean): Promise<CycleFinish> {
  const ticket = await env.DB.prepare('SELECT id, marketing_cycle FROM tickets WHERE id = ?')
    .bind(ticketId)
    .first<{ id: number; marketing_cycle: number }>();
  if (!ticket || ticket.marketing_cycle !== 1) return { handled: false, queued: 0, slots: [] };

  if (!ok) {
    await note(env, ticketId, 'The run failed, so no posts were queued. The cycle tries again tomorrow.');
    await event(env, 'cycle_failed', `#${ticketId}: run failed`);
    return { handled: true, queued: 0, slots: [], reason: 'run_failed' };
  }

  const posts = parseOutbox(summary);
  if (!posts) {
    await note(env, ticketId, 'The reply had no readable outbox block, so no posts were queued. The cycle tries again tomorrow.');
    await event(env, 'cycle_failed', `#${ticketId}: no outbox`);
    return { handled: true, queued: 0, slots: [], reason: 'no_outbox' };
  }

  const valid: OutboxPost[] = [];
  const skipped: string[] = [];
  for (const post of posts) {
    const clean = cleanPost(post.text, post.channel);
    if (clean.ok) valid.push({ channel: post.channel, text: clean.text });
    else skipped.push(`${post.channel}: ${clean.reason}`);
  }
  if (valid.length > CYCLE_POSTS) valid.length = CYCLE_POSTS;

  if (!valid.length) {
    await note(
      env,
      ticketId,
      `No post in the outbox passed the checks, so nothing was queued.${skipped.length ? `\n\n- ${skipped.join('\n- ')}` : ''}\n\nThe cycle tries again tomorrow.`,
    );
    await event(env, 'cycle_failed', `#${ticketId}: nothing usable`);
    return { handled: true, queued: 0, slots: [], reason: 'no_valid_posts' };
  }

  const offset = await readOffset(env);
  const t = now();
  // Two cycles can finish before a post goes out; a second cycle must not
  // stack its posts on slots the first one already booked.
  const booked = await env.DB.prepare(
    `SELECT scheduled_at FROM marketing_messages
      WHERE channel IN ('x', 'linkedin') AND status = 'scheduled' AND scheduled_at > ?`,
  )
    .bind(t)
    .all<{ scheduled_at: number }>();
  const taken = new Set(booked.results.map((row) => row.scheduled_at));
  const slots = nextSlots(t, valid.length, offset, taken);
  await env.DB.batch(
    valid.map((post, index) =>
      env.DB.prepare(
        `INSERT INTO marketing_messages
           (channel, kind, contact_id, campaign, step, to_email, subject, body, status, scheduled_at, created_at, updated_at)
         VALUES (?, 'auto', NULL, 'auto', ?, NULL, NULL, ?, 'scheduled', ?, ?, ?)`,
      ).bind(post.channel, index, post.text, slots[index] ?? t, t, t),
    ),
  );

  const plan = valid
    .map((post, index) => `${post.channel === 'x' ? 'X' : 'LinkedIn'} — ${slotLabel(slots[index] ?? t, offset)}`)
    .join('\n');
  await env.DB.batch([
    env.DB.prepare(`UPDATE tickets SET status = 'done', marketing_cycle = 2, updated_at = ? WHERE id = ?`).bind(t, ticketId),
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 1, ?)`).bind(
      ticketId,
      [
        `Queued ${valid.length} post${valid.length === 1 ? '' : 's'}:`,
        plan,
        '',
        'They are in Admin → Marketing, Queue tab, and the publisher picks them up at their time.',
        ...(skipped.length ? ['', `Left out:\n- ${skipped.join('\n- ')}`] : []),
      ].join('\n'),
      t,
    ),
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, 'system', ?, ?)`).bind(
      ticketId,
      'Status changed to “Done”.',
      t,
    ),
  ]);
  await event(env, 'cycle', `#${ticketId}: ${valid.length} post(s) queued`);
  return { handled: true, queued: valid.length, slots };
}
