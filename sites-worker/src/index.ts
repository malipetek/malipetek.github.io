/*
 * malipetek-sites — serves the client sites.
 *
 *   <slug>.ptechsolutions.dev            production deploy
 *   <slug>--preview.ptechsolutions.dev   preview deploy (X-Robots-Tag: noindex)
 *
 * malipetek.online, where these lived first, still answers and 301s across.
 *
 * A site is a row in the portal's `sites` table: each channel is a pointer to
 * an immutable deploy. The deploy is a manifest in R2 (path → sha256, size,
 * content type) and the files live as content-addressed blobs, so nothing
 * here does builds or runs code — it resolves a pointer and streams a blob.
 *
 * Deploys are written by ptechsolutions-intercom (which owns uploads) and pointed
 * at by its publish/rollback routes. This Worker only reads.
 */
interface Env {
  SITES: R2Bucket;
  DB: D1Database;
}

/**
 * The domains client sites are served from. The first is canonical and the one
 * every address is built on (worker/src/queue.ts, the `sitesDomain` setting);
 * the rest keep answering so links sent before the move still land, and 301
 * to the same path on the canonical domain.
 */
const DOMAINS = ['ptechsolutions.dev', 'malipetek.online'];
const DOMAIN = DOMAINS[0];
/** Where a site domain's own apex sends people: the client portal. */
const PORTAL = 'https://ptechsolutions.net';
/**
 * The feedback widget on previews: the script lives on the portal (one copy,
 * shared with client-hosted mirrors), the API hop is the portal's Worker.
 */
const FEEDBACK_ORIGIN = 'https://malipetek.dev';
const FEEDBACK_SCRIPT = `${FEEDBACK_ORIGIN}/preview-feedback.js?v=1`;
const FEEDBACK_API = `${FEEDBACK_ORIGIN}/api`;

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
      `default-src 'self'; script-src 'self' 'unsafe-inline' ${FEEDBACK_ORIGIN}; style-src 'self' 'unsafe-inline'; ` +
      "img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self' blob: data:; " +
      `connect-src 'self' ${FEEDBACK_ORIGIN}; ` +
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self' https:",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  };
  if (preview) headers['x-robots-tag'] = 'noindex';
  return headers;
}

/**
 * The preview feedback launcher. A client looking at a preview is the person
 * who notices what is wrong, and making them find the portal first loses the
 * note. The tag carries the site slug and the API base; the token arrives in
 * the preview link's `?mf=`, so it never sits in the HTML or the page source.
 */
function feedbackTag(slug: string): string {
  return `<script src="${FEEDBACK_SCRIPT}" data-slug="${slug}" data-api="${FEEDBACK_API}" data-malipetek-feedback="1" defer></script>`;
}

function injectFeedback(html: string, slug: string): string {
  if (html.includes('data-malipetek-feedback')) return html;
  const tag = feedbackTag(slug);
  const end = html.toLowerCase().lastIndexOf('</body>');
  return end === -1 ? html + tag : html.slice(0, end) + tag + html.slice(end);
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
  const inject = preview && (type.startsWith('text/html') || /\.html?$/i.test(path));
  if (!inject) {
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
  // Preview HTML is revalidated already, so rewriting it here costs nothing
  // and keeps the stored blob (shared by both channels) untouched.
  const html = injectFeedback(await object.text(), slug);
  return new Response(html, {
    status,
    headers: {
      ...baseHeaders(preview),
      'content-type': type.replace(/;\s*charset=.*/i, '') + '; charset=utf-8',
      'content-length': String(new TextEncoder().encode(html).byteLength),
      'cache-control': cacheFor(path, type),
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return text('method not allowed', 405, false);

    const host = (request.headers.get('host') ?? url.hostname).toLowerCase().replace(/:\d+$/, '');
    const domain = DOMAINS.find((d) => host === d || host === `www.${d}` || host.endsWith(`.${d}`));
    if (!domain) return text('not found', 404, false);
    if (host === domain || host === `www.${domain}`) {
      return Response.redirect(`${PORTAL}/portal`, 302);
    }
    // An address on a domain that has been superseded: same path, same query
    // (a preview's feedback token rides in it), on the canonical domain.
    if (domain !== DOMAIN) {
      url.hostname = `${host.slice(0, host.length - domain.length)}${DOMAIN}`;
      return Response.redirect(url.toString(), 301);
    }

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
