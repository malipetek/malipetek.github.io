/*
 * /kb/sitemap.xml — every knowledgebase entry.
 *
 * @astrojs/sitemap runs at build time, and entries are written by agents long
 * after the build, so the dynamic entries need their own sitemap. /kb and
 * /kb/new are already in the main one.
 */
export const prerender = false;

import { kbDb, listKbEntries, type KbSummary } from '../../lib/kb';

const PAGE = 50;
const MAX = 500;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET({ locals }: { locals: unknown }) {
  const db = kbDb(locals);
  if (!db) return new Response('knowledgebase unavailable', { status: 503 });

  const entries: KbSummary[] = [];
  for (let offset = 0; offset < MAX; offset += PAGE) {
    const page = await listKbEntries(db, { limit: PAGE, offset });
    entries.push(...page.entries);
    if (page.entries.length < PAGE) break;
  }

  const urls = entries.map((entry) => {
    const lastmod = entry.updated_at ? entry.updated_at.replace(' ', 'T').slice(0, 10) : '';
    return (
      `  <url><loc>https://malipetek.dev/kb/${escapeXml(entry.slug)}</loc>` +
      (lastmod ? `<lastmod>${lastmod}</lastmod>` : '') +
      `</url>`
    );
  });

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <url><loc>https://malipetek.dev/kb</loc><changefreq>daily</changefreq><priority>0.8</priority></url>\n` +
    `${urls.join('\n')}\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
