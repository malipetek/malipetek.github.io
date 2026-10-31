/*
 * The translation bridge: a client writes and reads in their own language,
 * Ali and the fleet agents read and write English.
 *
 *   client message → stored as written, translated to en-US for Ali and the brief
 *   Ali / system   → stored as written, translated to the client's locale for them
 *
 * Originals in ticket_messages are never changed; every translation is cached
 * in message_translations (one per message and locale). Nothing is translated
 * for a client whose locale is English or whose translation setting is 'off',
 * and private notes are never translated toward the client.
 *
 * Engines: DeepSeek (cheap, context-aware, detects the source language), then
 * Workers AI m2m100 when DeepSeek fails or the client chose 'cloudflare'.
 * Code, URLs, emails, file paths and #refs are masked before either sees the
 * text and must all come back unchanged, or the translation is thrown away.
 * A failed translation never blocks a message: the original goes through.
 */
import { isEnglish, localeInfo, SOURCE_LOCALE, closestLocale, type TranslationEngine } from '../../src/lib/locales.js';
import { now, type Env } from './shared.ts';

export type Engine = 'deepseek' | 'm2m100';

/* ——————————————————————— masking ——————————————————————— */

/*
 * One alternation, so overlapping matches cannot both be taken; order matters
 * (a fence before the inline code inside it, a URL before the path in it).
 */
const PROTECTED = new RegExp(
  [
    '```[\\s\\S]*?```', // fenced code
    '`[^`\\n]+`', // inline code
    'https?:\\/\\/[^\\s<>()"\']+', // URLs
    '[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+', // email addresses
    '(?:\\.{0,2}\\/)?(?:[\\w.-]+\\/)+[\\w.-]+\\.\\w{1,8}\\b', // file paths with an extension
    '#\\d+\\b', // ticket and run refs
  ].join('|'),
  'g',
);

const token = (i: number) => `⟦${i}⟧`;

/** Replace every protected span with ⟦n⟧; `pieces[n]` is what it stood for. */
export function mask(text: string): { masked: string; pieces: string[] } {
  const pieces: string[] = [];
  const masked = text.replace(PROTECTED, (match) => {
    pieces.push(match);
    return token(pieces.length - 1);
  });
  return { masked, pieces };
}

/**
 * Put the protected spans back. null when the translator lost, duplicated or
 * invented a token: the translation cannot be trusted with the code in it.
 */
export function unmask(text: string, pieces: string[]): string | null {
  const seen: string[] = text.match(/⟦\d+⟧/g) ?? [];
  if (seen.length !== pieces.length) return null;
  for (let i = 0; i < pieces.length; i++) if (!seen.includes(token(i))) return null;
  return text.replace(/⟦(\d+)⟧/g, (_, n: string) => pieces[Number(n)]);
}

/* ——————————————————————— languages ——————————————————————— */

/** Same language for translation purposes: tr = tr-TR, but zh-Hans ≠ zh-Hant. */
export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ca = closestLocale(a);
  const cb = closestLocale(b);
  if (ca && cb) {
    if (ca === cb) return true;
    if (ca.startsWith('zh') || cb.startsWith('zh')) return false;
    return ca.split('-')[0] === cb.split('-')[0];
  }
  return a.toLowerCase().split('-')[0] === b.toLowerCase().split('-')[0];
}

const languageName = (code: string) => {
  const info = localeInfo(code);
  return info ? `${info.english} (${info.code})` : code;
};

/* ——————————————————————— engines ——————————————————————— */

/*
 * Kept short: the glossary is what makes the same word come out the same way
 * in every message, and the rules are what keep the masked tokens intact.
 */
export function translationPrompt(target: string): string {
  return [
    'You translate messages in a support thread between a client and a web development contractor (Ali, malipetek.dev).',
    `Translate the user's text into ${languageName(target)}.`,
    'Reply with JSON only: {"source": "<BCP-47 code of the language the text is written in>", "text": "<the translation>"}.',
    'Rules:',
    '- Tokens like ⟦0⟧ stand for code, links and file names. Copy every token exactly, once each, where it belongs in the sentence.',
    '- Keep names as they are: malipetek.dev, malipetek.online, Ali, GitHub, Cloudflare, Shopify, product and company names.',
    '- "ticket" or "request" is a support request; "preview" is a test version of a website; "deploy" and "publish" mean putting a site live.',
    '- Keep the tone, line breaks, lists and Markdown. Do not add, explain or summarise anything.',
    '- If the text is already in the target language, return it unchanged.',
  ].join('\n');
}

/** Parse a DeepSeek reply: {source, text}, or null when it is not that shape. */
export function parseTranslation(content: string): { source: string; text: string } | null {
  try {
    const data = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) as { source?: unknown; text?: unknown };
    if (typeof data.text !== 'string' || !data.text) return null;
    return { source: typeof data.source === 'string' ? data.source.trim() : '', text: data.text };
  } catch {
    return null;
  }
}

async function deepseek(env: Env, masked: string, target: string): Promise<{ source: string; text: string } | null> {
  if (!env.DEEPSEEK_API_KEY) return null;
  const base = (env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL || 'deepseek-chat',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: translationPrompt(target) },
          { role: 'user', content: masked },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      console.warn('deepseek_failed', res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return parseTranslation(data.choices?.[0]?.message?.content ?? '');
  } catch (error) {
    console.warn('deepseek_failed', String(error));
    return null;
  }
}

async function m2m100(env: Env, masked: string, from: string, to: string): Promise<string | null> {
  const source = localeInfo(closestLocale(from) ?? '')?.m2m;
  const target = localeInfo(to)?.m2m;
  if (!env.AI || !source || !target) return null;
  try {
    const out = (await env.AI.run('@cf/meta/m2m100-1.2b', { text: masked, source_lang: source, target_lang: target })) as {
      translated_text?: string;
    };
    return out.translated_text || null;
  } catch (error) {
    console.warn('m2m100_failed', String(error));
    return null;
  }
}

export interface Translation {
  text: string;
  /** The detected (DeepSeek) or assumed (m2m100) source language. */
  source: string;
  engine: Engine;
  /** The text was already in the target language: `text` is the original. */
  same: boolean;
}

/**
 * Translate one text into `to`. `sourceHint` is the language the text is most
 * likely in (m2m100 needs one; DeepSeek detects it). null when nothing could
 * translate it faithfully.
 */
export async function translateText(
  env: Env,
  text: string,
  to: string,
  options: { engine: TranslationEngine; sourceHint: string },
): Promise<Translation | null> {
  if (options.engine === 'off' || !text.trim()) return null;
  const { masked, pieces } = mask(text);
  // Nothing but code and links: nothing to translate.
  if (!masked.replace(/⟦\d+⟧/g, '').trim()) return { text, source: options.sourceHint, engine: 'deepseek', same: true };

  if (options.engine === 'deepseek') {
    for (let attempt = 0; attempt < 2; attempt++) {
      const out = await deepseek(env, masked, to);
      if (!out) break; // an API failure will not fix itself on a retry; fall back
      if (out.source && sameLanguage(out.source, to)) return { text, source: out.source, engine: 'deepseek', same: true };
      const restored = unmask(out.text, pieces);
      if (restored !== null) return { text: restored, source: out.source || options.sourceHint, engine: 'deepseek', same: false };
    }
  }

  if (sameLanguage(options.sourceHint, to)) return null;
  const out = await m2m100(env, masked, options.sourceHint, to);
  const restored = out === null ? null : unmask(out, pieces);
  return restored === null ? null : { text: restored, source: options.sourceHint, engine: 'm2m100', same: false };
}

/* ——————————————————————— the bridge ——————————————————————— */

export interface Owner {
  locale: string;
  translation: TranslationEngine;
}

/** The ticket's client: their language and what may translate for them. */
export async function ticketOwner(env: Env, ticketId: number): Promise<Owner | null> {
  return env.DB.prepare(
    `SELECT u.locale, u.translation FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
  )
    .bind(ticketId)
    .first<Owner>();
}

/** Does this client's thread go through the bridge at all? */
export const bridged = (owner: Owner | null): owner is Owner =>
  !!owner && owner.translation !== 'off' && !isEnglish(owner.locale);

async function store(env: Env, messageId: number, locale: string, out: Translation) {
  const writes = [env.DB.prepare('UPDATE ticket_messages SET lang = ? WHERE id = ?').bind(closestLocale(out.source) ?? out.source, messageId)];
  if (!out.same) {
    writes.push(
      env.DB.prepare(
        `INSERT INTO message_translations (message_id, locale, body, engine, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (message_id, locale) DO UPDATE SET body = excluded.body, engine = excluded.engine, created_at = excluded.created_at`,
      ).bind(messageId, locale, out.text, out.engine, now()),
    );
  }
  await env.DB.batch(writes);
}

export interface Bridged {
  /** What Ali, his email and the agents read. */
  english: string;
  /** What the client and their email read. */
  forClient: string;
  /** The language the original was in, when a translator saw it. */
  lang: string | null;
}

/**
 * Translate a new message across the bridge and cache the result. Never
 * throws: on any failure both sides get the original.
 */
export async function bridgeMessage(
  env: Env,
  m: { id: number; ticketId: number; author: string; text: string; internal: boolean },
  owner?: Owner | null,
): Promise<Bridged> {
  const plain: Bridged = { english: m.text, forClient: m.text, lang: null };
  try {
    const who = owner === undefined ? await ticketOwner(env, m.ticketId) : owner;
    if (!bridged(who) || !m.text.trim()) return plain;
    if (m.author === 'client') {
      const out = await translateText(env, m.text, SOURCE_LOCALE, { engine: who.translation, sourceHint: who.locale });
      if (!out) return plain;
      await store(env, m.id, SOURCE_LOCALE, out);
      return { english: out.text, forClient: m.text, lang: out.source };
    }
    // System lines are fixed templates the portal translates from its own
    // catalog; private notes never go to the client.
    if (m.author !== 'ali' || m.internal) return plain;
    const out = await translateText(env, m.text, who.locale, { engine: who.translation, sourceHint: SOURCE_LOCALE });
    if (!out) return plain;
    await store(env, m.id, who.locale, out);
    return { english: m.text, forClient: out.text, lang: out.source };
  } catch (error) {
    console.error('bridge_failed', m.id, String(error));
    return plain;
  }
}

/** The English title of a ticket filed in another language (tickets.title_en). */
export async function bridgeTitle(env: Env, ticketId: number, title: string, owner?: Owner | null): Promise<string> {
  try {
    const who = owner === undefined ? await ticketOwner(env, ticketId) : owner;
    if (!bridged(who)) return title;
    const out = await translateText(env, title, SOURCE_LOCALE, { engine: who.translation, sourceHint: who.locale });
    if (!out || out.same) return title;
    await env.DB.prepare('UPDATE tickets SET title_en = ? WHERE id = ?').bind(out.text, ticketId).run();
    return out.text;
  } catch (error) {
    console.error('bridge_title_failed', ticketId, String(error));
    return title;
  }
}

/** Ali's copy of a client message: the English, then the original under it. */
export function forAli(b: Bridged, original: string): string {
  if (b.english === original) return original;
  return `${b.english}\n\n— Original${b.lang ? ` (${languageName(b.lang)})` : ''}, machine-translated above —\n${original}`;
}

/** Text of a client-bound message with a short "translated" note under it. */
export function forClientMail(b: Bridged, original: string, note: string): string {
  return b.forClient === original ? original : `${b.forClient}\n\n(${note})`;
}

type ThreadMessage = { id: number; author: string; body: string; internal: number; lang?: string | null };

/**
 * A thread as one side reads it. `side` 'client': Ali's replies in the
 * client's locale; 'ali': the client's messages in English. Each
 * translated message gets `body` = the translation and `original` = what was
 * written. Cached translations are used; missing ones are made within
 * `budgetMs`, and the rest finish in the background (`defer`) for next time.
 */
export async function threadFor<M extends ThreadMessage>(
  env: Env,
  ticketId: number,
  messages: M[],
  side: 'client' | 'ali',
  defer: (p: Promise<unknown>) => void,
  budgetMs = 6000,
): Promise<(M & { original?: string; translatedFrom?: string | null })[]> {
  const owner = await ticketOwner(env, ticketId).catch(() => null);
  if (!bridged(owner)) return messages;
  const locale = side === 'client' ? owner.locale : SOURCE_LOCALE;
  const wanted = (m: M) =>
    (side === 'client' ? m.author === 'ali' && !m.internal : m.author === 'client') && !sameLanguage(m.lang, locale);
  const { results } = await env.DB.prepare(
    `SELECT x.message_id, x.body FROM message_translations x JOIN ticket_messages m ON m.id = x.message_id
      WHERE m.ticket_id = ? AND x.locale = ?`,
  )
    .bind(ticketId, locale)
    .all<{ message_id: number; body: string }>();
  const cached = new Map((results ?? []).map((r) => [r.message_id, r.body]));

  // Only messages a translator has never seen (lang IS NULL) are tried again:
  // a seen one without a cached row was already in the reader's language.
  const missing = messages.filter((m) => wanted(m) && !cached.has(m.id) && !m.lang);
  if (missing.length) {
    const work = missing.slice(0, 20).map((m) =>
      bridgeMessage(env, { id: m.id, ticketId, author: m.author, text: m.body, internal: !!m.internal }, owner).then((b) => {
        const text = side === 'client' ? b.forClient : b.english;
        if (text !== m.body) cached.set(m.id, text);
      }),
    );
    const all = Promise.all(work);
    defer(all);
    await Promise.race([all, new Promise((r) => setTimeout(r, budgetMs))]);
  }

  return messages.map((m) => {
    const body = wanted(m) ? cached.get(m.id) : undefined;
    return body === undefined ? m : { ...m, body, original: m.body, translatedFrom: m.lang ?? null };
  });
}
