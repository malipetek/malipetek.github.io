/*
 * The observation writer: the one human step the email desk used to need.
 *
 * Every cold sequence that leans on {{gap}} needs a true, specific observation
 * of the prospect's site, and 2,529 contacts sat queued with none because
 * writing it was a person's job. observeContacts is the cron's half: it reads
 * a handful of sites per tick, writes the gap it finds (or records that the
 * page was clean or unreachable), and the marketing desk re-renders or
 * re-sequences whatever was waiting on it.
 *
 * observeSite is pure so the rules are testable without a fetch: the first
 * problem found in priority order becomes the gap, written as a finished
 * sentence with the bare host already substituted.
 */
import { now, type Env } from './shared.ts';
import { rerenderScheduled, sequenceOfSubject } from './marketing.ts';

const OBSERVE_TIMEOUT_MS = 8_000;
/** A homepage bigger than this is read only this far; the checks live in the head. */
const OBSERVE_BODY_CAP = 1_500_000;
const OBSERVE_UA = 'ptech-seo-audit/1.0 (+https://ptechsolutions.net)';
const OBSERVE_PER_TICK = 12;
/** A contact's id decides its arm: under the share it tries the observation sequence. */
const DEFAULT_OBS_SHARE = 50;

export type ObserveKind = 'no_https' | 'no_viewport' | 'old_copyright' | 'pdf_menu' | 'slow' | 'no_description';

export interface Observation {
  kind: ObserveKind;
  gap: string;
}

/** The bare host a sentence would use: "corroof.com", never "www." or a scheme. */
function bareHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    const match = /^(?:https?:\/\/)?(?:www\.)?([^/?#\s]+)/i.exec(url.trim());
    return (match?.[1] ?? 'the site').toLowerCase();
  }
}

const phrase = (kind: ObserveKind, site: string, year?: number, seconds?: number): string => {
  switch (kind) {
    case 'no_https':
      return `{{site}} still opens over plain http, so browsers mark it "Not secure" next to the address.`;
    case 'no_viewport':
      return `On a phone, {{site}} shows the desktop page shrunk down, because the page has no mobile layout tag.`;
    case 'old_copyright':
      return `The footer on {{site}} still says © ${year}.`;
    case 'pdf_menu':
      return `Your menu on {{site}} is a PDF, which is hard to read on a phone and Google can't show it in search.`;
    case 'slow':
      return `{{site}} took about ${seconds} seconds to load when I opened it.`;
    case 'no_description':
      return `{{site}} has no description set, so Google picks a random bit of the page to show under your name.`;
  }
};

/** First problem in priority order, as a finished sentence; null when the page is clean. */
export function observeSite(input: {
  html: string;
  requestedUrl: string;
  finalUrl: string;
  ms: number;
  now: number;
}): Observation | null {
  const { html, requestedUrl, finalUrl, ms, now: at } = input;
  const site = bareHost(finalUrl || requestedUrl);
  const say = (kind: ObserveKind, extra?: { year?: number; seconds?: number }): Observation => ({
    kind,
    gap: phrase(kind, site, extra?.year, extra?.seconds).replaceAll('{{site}}', site),
  });

  // a. Plain http is the loudest problem: the browser itself warns the visitor.
  if ((finalUrl || requestedUrl).startsWith('http:')) return say('no_https');

  // b. No viewport tag: the phone gets the desktop page shrunk to fit.
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) return say('no_viewport');

  // c. A footer copyright stuck three or more years behind.
  const currentYear = new Date(at * 1000).getUTCFullYear();
  for (const marker of html.matchAll(/(?:©|&copy;|copyright)/gi)) {
    const start = marker.index ?? 0;
    const window = html.slice(start, start + marker[0].length + 40);
    const years = [...window.matchAll(/\b(19\d{2}|20\d{2})\b/g)]
      .map((m) => Number(m[1]))
      .filter((y) => y >= 1995 && y <= currentYear);
    const latest = years.length ? Math.max(...years) : null;
    if (latest !== null && latest <= currentYear - 3) return say('old_copyright', { year: latest });
  }

  // d. A menu that is a PDF: unreadable on a phone, invisible to search.
  for (const anchor of html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const tag = anchor[0];
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1] ?? '';
    const path = href.split(/[?#]/)[0].toLowerCase();
    if (path.endsWith('.pdf') && /menu/i.test(`${href} ${tag.replace(/<[^>]+>/g, ' ')}`)) return say('pdf_menu');
  }

  // e. A page slow enough that a visitor notices.
  if (ms > 4500) return say('slow', { seconds: Math.round(ms / 1000) });

  // f. No description: Google writes the snippet itself.
  const description = /<meta[^>]+name=["']description["'][^>]*>/i.exec(html);
  if (!description || !/content=["'][^"']+\S[^"']*["']/i.test(description[0])) return say('no_description');

  return null;
}

interface ObserveRow {
  id: number;
  site: string;
}

/** The share of observed contacts that try the observation sequence, 0-100. */
async function readObsShare(env: Env): Promise<number> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'marketing_obs_share'`).first<{ value: string }>();
  try {
    const parsed = JSON.parse(row?.value ?? String(DEFAULT_OBS_SHARE));
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100 ? parsed : DEFAULT_OBS_SHARE;
  } catch {
    return DEFAULT_OBS_SHARE;
  }
}

/**
 * The cron's half: up to twelve unobserved contacts per tick. A written gap
 * re-renders their queued mail — or, for the deterministic share of cold
 * contacts, moves the unsent steps onto the observation sequence with the
 * same mechanism the desk's re-render endpoint uses. A clean page and an
 * unreachable one are both recorded so the same site is never fetched twice.
 */
export async function observeContacts(env: Env, t = now()): Promise<{ observed: number; gaps: number }> {
  const { results } = await env.DB.prepare(
    `SELECT id, site FROM marketing_contacts
      WHERE status IN ('new', 'queued') AND site IS NOT NULL AND site != ''
        AND (gap IS NULL OR gap = '') AND observed_at IS NULL
      ORDER BY id LIMIT ?`,
  )
    .bind(OBSERVE_PER_TICK)
    .all<ObserveRow>();
  if (!results?.length) return { observed: 0, gaps: 0 };

  const share = await readObsShare(env);
  let observed = 0;
  let gaps = 0;
  for (const contact of results) {
    const started = Date.now();
    let html: string | null = null;
    let finalUrl = contact.site;
    try {
      const res = await fetch(contact.site, {
        headers: { 'user-agent': OBSERVE_UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
        redirect: 'follow',
        signal: AbortSignal.timeout(OBSERVE_TIMEOUT_MS),
      });
      finalUrl = res.url || contact.site;
      const buffer = await res.arrayBuffer();
      html = new TextDecoder().decode(buffer.slice(0, OBSERVE_BODY_CAP));
    } catch (error) {
      console.warn('observe_fetch_failed', contact.site, String(error));
    }
    const ms = Date.now() - started;

    const observation = html === null ? null : observeSite({ html, requestedUrl: contact.site, finalUrl, ms, now: t });
    const gap = observation?.gap ?? null;
    const kind = html === null ? 'unreachable' : observation ? observation.kind : 'none';
    await env.DB.prepare('UPDATE marketing_contacts SET gap = ?, gap_kind = ?, observed_at = ?, updated_at = ? WHERE id = ?')
      .bind(gap, kind, t, t, contact.id)
      .run();
    observed += 1;
    if (gap) gaps += 1;

    if (!gap) continue;
    // The arm is decided by the contact id alone, so a re-render never moves
    // a contact between the control and the challenger.
    if (contact.id % 100 < share) {
      // Which cold sequence the unsent mail belongs to, from its subject.
      const first = await env.DB.prepare(
        `SELECT subject FROM marketing_messages
          WHERE contact_id = ? AND channel = 'email' AND status = 'scheduled' AND edited_at IS NULL
          ORDER BY step LIMIT 1`,
      )
        .bind(contact.id)
        .first<{ subject: string | null }>();
      const current = sequenceOfSubject(first?.subject ?? null);
      if (current === 'cold_a' || current === 'cold_b') {
        await rerenderScheduled(env, { from: current, to: 'cold_obs', contactId: contact.id });
        continue;
      }
    }
    // Everyone else just gets their queued mail re-rendered, so the gap the
    // observation wrote is the one that goes out.
    await rerenderScheduled(env, { contactId: contact.id });
  }
  return { observed, gaps };
}
