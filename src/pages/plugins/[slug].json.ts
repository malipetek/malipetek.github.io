/*
 * /plugins/<slug>.json — the same facts the page renders, for agents that would
 * rather not scrape HTML. Public, cacheable for a minute.
 */
export const prerender = false;

import { getPlugin } from '../../lib/plugins';

export async function GET({ params }: { params: Record<string, string | undefined> }) {
  const plugin = await getPlugin(params.slug ?? '');
  if (!plugin) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const payload = {
    slug: plugin.slug,
    name: plugin.name,
    title: plugin.title,
    description: plugin.blurb,
    install: plugin.install,
    surface: plugin.hasClient ? 'host+client' : 'host',
    clientInject: plugin.clientInject,
    keywords: plugin.keywords,
    urls: { npm: plugin.npmUrl, source: plugin.repoUrl, page: `/plugins/${plugin.slug}` },
    npm: {
      published: plugin.npm.published,
      registryReachable: plugin.npm.checked,
      version: plugin.npm.version ?? null,
      manifestVersion: plugin.manifestVersion,
      publishedAt: plugin.npm.modified ?? null,
      license: plugin.npm.license ?? null,
      unpackedSize: plugin.npm.unpackedSize ?? null,
      downloadsLastMonth: plugin.npm.downloads ?? null,
    },
    readme: plugin.readme,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=60',
    },
  });
}
