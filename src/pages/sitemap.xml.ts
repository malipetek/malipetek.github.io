/*
 * /sitemap.xml, per host.
 *
 * The same Worker answers malipetek.dev and lab.malipetek.dev, so a build-time
 * sitemap would list both sites at once. This one is written per request and
 * lists only the host it was asked on. The knowledgebase entries and the
 * plugin pages change between deploys and have their own sitemaps
 * (/kb/sitemap.xml and /plugins/sitemap.xml, lab only).
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getPosts } from '../lib/posts.js';
import { LOCALES } from '../lib/locales.js';
import {
  CONTRACTING_ORIGIN,
  LAB_ORIGIN,
  isLabRequest,
} from '../lib/siteHosts';

type Entry = {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
};

function xml(entries: Entry[]): string {
  const urls = entries.map((entry) => {
    const parts = [`<loc>${entry.loc}</loc>`];
    if (entry.lastmod) parts.push(`<lastmod>${entry.lastmod}</lastmod>`);
    if (entry.changefreq) parts.push(`<changefreq>${entry.changefreq}</changefreq>`);
    if (entry.priority) parts.push(`<priority>${entry.priority}</priority>`);
    return `  <url>${parts.join('')}</url>`;
  });

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${urls.join('\n')}\n</urlset>\n`
  );
}

async function contractingSitemap(): Promise<Entry[]> {
  return [
    { loc: `${CONTRACTING_ORIGIN}/`, changefreq: 'weekly', priority: '1.0' },
    ...LOCALES.filter((locale) => locale.code !== 'en-US').map((locale) => ({
      loc: `${CONTRACTING_ORIGIN}/${locale.code}/`,
      changefreq: 'monthly',
      priority: '0.6',
    })),
    { loc: `${CONTRACTING_ORIGIN}/agents`, changefreq: 'monthly', priority: '0.8' },
    { loc: `${CONTRACTING_ORIGIN}/contact`, changefreq: 'yearly', priority: '0.4' },
    { loc: `${CONTRACTING_ORIGIN}/privacy-policy`, changefreq: 'yearly', priority: '0.2' },
    { loc: `${CONTRACTING_ORIGIN}/terms-of-service`, changefreq: 'yearly', priority: '0.2' },
  ];
}

async function labSitemap(): Promise<Entry[]> {
  const posts = await getPosts();
  const projects = await getCollection('projects');

  return [
    { loc: `${LAB_ORIGIN}/`, changefreq: 'weekly', priority: '1.0' },
    { loc: `${LAB_ORIGIN}/kb`, changefreq: 'daily', priority: '0.9' },
    { loc: `${LAB_ORIGIN}/kb/agents`, changefreq: 'monthly', priority: '0.6' },
    { loc: `${LAB_ORIGIN}/plugins`, changefreq: 'weekly', priority: '0.8' },
    { loc: `${LAB_ORIGIN}/blog`, changefreq: 'weekly', priority: '0.8' },
    ...posts.map((post) => ({
      loc: `${LAB_ORIGIN}/blog/${post.id}`,
      lastmod: post.data.date.toISOString().slice(0, 10),
      changefreq: 'yearly',
      priority: '0.7',
    })),
    { loc: `${LAB_ORIGIN}/experience`, changefreq: 'monthly', priority: '0.6' },
    { loc: `${LAB_ORIGIN}/experience/truth`, changefreq: 'yearly', priority: '0.4' },
    { loc: `${LAB_ORIGIN}/experience/agent-experience`, changefreq: 'yearly', priority: '0.4' },
    ...projects.map((project) => ({
      loc: `${LAB_ORIGIN}/projects/${project.id}`,
      changefreq: 'yearly',
      priority: '0.5',
    })),
    { loc: `${LAB_ORIGIN}/pdfextractor/privacy-policy`, changefreq: 'yearly', priority: '0.2' },
    { loc: `${LAB_ORIGIN}/pdfextractor/terms-of-service`, changefreq: 'yearly', priority: '0.2' },
  ];
}

export const GET: APIRoute = async ({ request }) => {
  const lab = isLabRequest(request);
  const entries = lab ? await labSitemap() : await contractingSitemap();

  return new Response(xml(entries), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};
