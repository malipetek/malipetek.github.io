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
import { localizedPath } from '../lib/site.js';
import { LOCALES, SOURCE_LOCALE } from '../lib/locales.js';
import {
  CONTRACTING_ORIGIN,
  LAB_ORIGIN,
  isLabRequest,
} from '../lib/siteHosts';

/** Another language's URL for the same page, for a sitemap `<xhtml:link>`. */
type Alternate = { hreflang: string; href: string };

type Entry = {
  loc: string;
  alternates?: Alternate[];
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
    for (const alt of entry.alternates ?? []) {
      parts.push(`<xhtml:link rel="alternate" hreflang="${alt.hreflang}" href="${alt.href}"/>`);
    }
    return `  <url>${parts.join('')}</url>`;
  });

  // The lab's sitemap has no alternates, so it keeps the exact document it had.
  const xhtml = entries.some((entry) => entry.alternates?.length)
    ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"'
    : '';

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${xhtml}>\n` +
    `${urls.join('\n')}\n</urlset>\n`
  );
}

/** A contracting page's URL in a language: /contact, /tr/contact, /tr/ … */
const localeUrl = (code: string, path: string) =>
  `${CONTRACTING_ORIGIN}${localizedPath(code, path)}`;

/** The pages that exist once per language, with their per-language weight. */
const CONTRACTING_PAGES = [
  {
    path: '/',
    weight: (code: string) =>
      code === SOURCE_LOCALE
        ? { changefreq: 'weekly', priority: '1.0' }
        : { changefreq: 'monthly', priority: '0.6' },
  },
  { path: '/contact', weight: () => ({ changefreq: 'yearly', priority: '0.4' }) },
  { path: '/agents', weight: () => ({ changefreq: 'monthly', priority: '0.8' }) },
];

async function contractingSitemap(): Promise<Entry[]> {
  const entries: Entry[] = [];

  for (const page of CONTRACTING_PAGES) {
    // Each language of the page lists every language, itself included, plus
    // x-default for the English URL, as Google's multilingual guidelines ask.
    const alternates: Alternate[] = [
      ...LOCALES.map((locale) => ({
        hreflang: locale.code,
        href: localeUrl(locale.code, page.path),
      })),
      { hreflang: 'x-default', href: localeUrl(SOURCE_LOCALE, page.path) },
    ];

    for (const locale of LOCALES) {
      entries.push({
        loc: localeUrl(locale.code, page.path),
        alternates,
        ...page.weight(locale.code),
      });
    }
  }

  // The legal pages exist once, in English only: one entry each, no alternates.
  entries.push(
    { loc: `${CONTRACTING_ORIGIN}/privacy-policy`, changefreq: 'yearly', priority: '0.2' },
    { loc: `${CONTRACTING_ORIGIN}/terms-of-service`, changefreq: 'yearly', priority: '0.2' },
  );

  return entries;
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
