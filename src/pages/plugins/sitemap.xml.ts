/*
 * /plugins/sitemap.xml — every plugin page.
 *
 * The main sitemap is built at build time and only knows /plugins itself; each
 * detail page is server-rendered because it carries live npm numbers, so it
 * needs its own sitemap. Same reason /kb has one.
 */
export const prerender = false;

import { getPlugins } from '../../lib/plugins';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET() {
  const plugins = await getPlugins();

  const urls = plugins.map((plugin) => {
    const lastmod = plugin.npm.modified ? plugin.npm.modified.slice(0, 10) : '';
    return (
      `  <url><loc>https://malipetek.dev/plugins/${escapeXml(plugin.slug)}</loc>` +
      (lastmod ? `<lastmod>${lastmod}</lastmod>` : '') +
      `</url>`
    );
  });

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <url><loc>https://malipetek.dev/plugins</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>\n` +
    `${urls.join('\n')}\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
