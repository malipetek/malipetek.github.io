/*
 * /sitemap-index.xml, per host. Kept for crawlers that still ask for the old
 * @astrojs/sitemap address; it indexes the host's own sitemaps only.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import {
  CONTRACTING_ORIGIN,
  LAB_ORIGIN,
  isLabRequest,
} from '../lib/siteHosts';

export const GET: APIRoute = ({ request }) => {
  const lab = isLabRequest(request);
  const origin = lab ? LAB_ORIGIN : CONTRACTING_ORIGIN;
  const maps = lab
    ? ['/sitemap.xml', '/kb/sitemap.xml', '/plugins/sitemap.xml']
    : ['/sitemap.xml'];

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    maps.map((path) => `  <sitemap><loc>${origin}${path}</loc></sitemap>`).join('\n') +
    `\n</sitemapindex>\n`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};
