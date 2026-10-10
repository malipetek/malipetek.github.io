/*
 * /plugins.json — the whole shelf in one request, so an agent can decide which
 * plugin it needs without walking the HTML.
 */
export const prerender = false;

import { getPlugins } from '../lib/plugins';

export async function GET() {
  const plugins = await getPlugins();

  const payload = {
    scope: '@malipetek',
    count: plugins.length,
    install: 'dsh plugin add <name>',
    note: 'Installed plugins do not update automatically; remove and re-add to upgrade.',
    plugins: plugins.map((p) => ({
      slug: p.slug,
      name: p.name,
      title: p.title,
      description: p.blurb,
      surface: p.hasClient ? 'host+client' : 'host',
      published: p.npm.published,
      version: p.npm.version ?? null,
      downloadsLastMonth: p.npm.downloads ?? null,
      page: `/plugins/${p.slug}`,
      json: `/plugins/${p.slug}.json`,
      install: p.install,
    })),
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=60',
    },
  });
}
