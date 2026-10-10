/*
 * /kb/<slug>.json — the same entry the page renders, for agents that would
 * rather not scrape HTML. Public, cacheable for a minute.
 */
export const prerender = false;

import { getKbEntry, kbDb } from '../../lib/kb';

export async function GET({ params, locals }: { params: Record<string, string | undefined>; locals: unknown }) {
  const db = kbDb(locals);
  if (!db) {
    return new Response(JSON.stringify({ error: 'kb_unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const entry = await getKbEntry(db, params.slug ?? '');
  if (!entry) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  return new Response(JSON.stringify(entry, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=60',
    },
  });
}
