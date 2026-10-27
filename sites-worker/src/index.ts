/*
 * malipetek-sites — serves the client sites.
 *
 *   <slug>.malipetek.online            production deploy
 *   <slug>--preview.malipetek.online   preview deploy (X-Robots-Tag: noindex)
 *
 * A site is a row in the portal's `sites` table: each channel is a pointer to
 * an immutable deploy. The deploy is a manifest in R2 (path → sha256, size,
 * content type) and the files live as content-addressed blobs, so nothing
 * here does builds or runs code — it resolves a pointer and streams a blob.
 *
 * Deploys are written by malipetek-intercom (which owns uploads) and pointed
 * at by its publish/rollback routes. This Worker only reads.
 */
interface Env {
  SITES: R2Bucket;
  DB: D1Database;
}

const DOMAIN = 'malipetek.online';
const PORTAL = 'https://malipetek.dev';

interface ManifestFile {
  sha: string;
  size: number;
  type?: string;
}
interface Manifest {
  files: Record<string, ManifestFile>;
}

const manifestKey = (slug: string, deploy: string) => `sites/${slug}/deploys/${deploy}/manifest.json`;
const blobKey = (slug: string, sha: string) => `sites/${slug}/blobs/${sha}`;

/** Every response gets these; the caller may add more. */
function baseHeaders(preview: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'content-security-policy':
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; " +
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self' https:",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  };
  if (preview) headers['x-robots-tag'] = 'noindex';
  return headers;
}

/** Hashed build output is immutable; HTML is always revalidated; the rest sits between. */
function cacheFor(path: string, type: string): string {
  if (/^(_astro|assets|static)\//.test(path) || /\.[0-9a-f]{8,}\./.test(path)) {
    return 'public, max-age=31536000, immutable';
  }
  if (type === 'text/html' || path === 'manifest.json') return 'no-cache';
  return 'public, max-age=3600';
}

function text(body: string, status: number, preview: boolean): Response {
  return new Response(body, {
    status,
    headers: { ...baseHeaders(preview), 'content-type': 'text/plain; charset=utf-8' },
  });
}

/**
 * The manifest path for a URL path: index.html for directories, decoded,
 * with any `..` segment refused. Null when the path is not safe.
 */
function filePath(urlPath: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (!path.startsWith('/')) return null;
  const clean = path
    .split('/')
    .filter((s) => s && s !== '.')
    .join('/');
  if (clean.split('/').includes('..')) return null;
  if (clean === '') return 'index.html';
  return clean.endsWith('/') ? `${clean}index.html` : clean;
}

async function loadManifest(env: Env, slug: string, deploy: string): Promise<Manifest | null> {
  const object = await env.SITES.get(manifestKey(slug, deploy));
  if (!object) return null;
  try {
    return (await object.json()) as Manifest;
  } catch {
    return null;
  }
}

async function serve(
  env: Env,
  slug: string,
  manifest: Manifest,
  path: string,
  preview: boolean,
  status = 200,
): Promise<Response | null> {
  const entry = manifest.files[path];
  if (!entry) return null;
  const object = await env.SITES.get(blobKey(slug, entry.sha));
  if (!object) return null;
  const type = entry.type ?? 'application/octet-stream';
  return new Response(object.body, {
    status,
    headers: {
      ...baseHeaders(preview),
      'content-type': type,
      'content-length': String(entry.size),
      'cache-control': cacheFor(path, type),
      etag: object.httpEtag,
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return text('method not allowed', 405, false);

    const host = (request.headers.get('host') ?? url.hostname).toLowerCase().replace(/:\d+$/, '');
    if (host === DOMAIN || host === `www.${DOMAIN}`) {
      return Response.redirect(`${PORTAL}/portal`, 302);
    }
    if (!host.endsWith(`.${DOMAIN}`)) return text('not found', 404, false);

    const sub = host.slice(0, -(DOMAIN.length + 1));
    const preview = sub.endsWith('--preview');
    const slug = preview ? sub.slice(0, -'--preview'.length) : sub;
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) return text('not found', 404, preview);

    const site = await env.DB.prepare('SELECT preview_deploy, production_deploy, spa, state FROM sites WHERE slug = ?')
      .bind(slug)
      .first<{ preview_deploy: string | null; production_deploy: string | null; spa: number; state: string }>();
    const deploy = preview ? site?.preview_deploy : site?.production_deploy;
    if (!site || site.state !== 'ready' || !deploy) return text('This site is not up yet.', 404, preview);

    const manifest = await loadManifest(env, slug, deploy);
    if (!manifest) return text('This deploy is not available.', 502, preview);

    const path = filePath(url.pathname);
    if (!path) return text('bad request', 400, preview);

    const hit = await serve(env, slug, manifest, path, preview);
    if (hit) return hit;

    // SPA mode: unknown paths route to the app's index.
    if (site.spa === 1) {
      const spa = await serve(env, slug, manifest, 'index.html', preview);
      if (spa) return spa;
    }
    const notFound = await serve(env, slug, manifest, '404.html', preview, 404);
    return notFound ?? text('not found', 404, preview);
  },
};
