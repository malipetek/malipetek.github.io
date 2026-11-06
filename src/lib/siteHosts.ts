/*
 * Two sites, one Worker.
 *
 * malipetek.dev is the client portal for vibe contracting: the offer, the
 * portal, the assistant connection and the legal pages. lab.malipetek.dev is
 * Ali's developer lab: the agentic coding knowledgebase, the DeepSeek Harness
 * plugins, writing, work and projects.
 *
 * The split is by Host, not by path, so the same paths exist on both hosts and
 * each host owns its half:
 *
 *   malipetek.dev/kb        → 301 → lab.malipetek.dev/kb
 *   lab.malipetek.dev/portal → 301 → malipetek.dev/portal
 *
 * One canonical address per page, so a summary of either site never mixes the
 * two products up. The redirects live here because they run in two places:
 * `src/middleware.ts` for server-rendered routes, and `src/worker.ts` before
 * the Cloudflare adapter serves a prerendered page from the assets binding.
 */
import { LOCALES, SOURCE_LOCALE } from './locales.js';

export const CONTRACTING_ORIGIN = 'https://malipetek.dev';
export const LAB_ORIGIN = 'https://lab.malipetek.dev';

const LAB_HOST = 'lab.malipetek.dev';
const CONTRACTING_HOSTS = new Set(['malipetek.dev', 'www.malipetek.dev']);

/** Lab paths, as prefixes: the page itself and everything under it. */
const LAB_ROOTS = ['/kb', '/plugins', '/blog', '/experience', '/projects', '/pdfextractor'];
const LAB_EXACT = ['/plugins.json'];

/** Contracting paths. The locale homepages are handled separately. */
const CONTRACTING_ROOTS = ['/portal', '/api'];
const CONTRACTING_EXACT = [
  '/agents',
  '/contact',
  '/privacy-policy',
  '/terms-of-service',
  '/chat',
  // Owner-only: it signs in with the portal session, which lives in
  // malipetek.dev's localStorage, so it only works on that host.
  '/kb/new',
];

/** `/foo/` and `/foo` are the same page for this decision. */
function normalize(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function under(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/** Every locale except English gets its own contracting homepage at /<code>/. */
function isLocaleHome(path: string): boolean {
  if (path === '/') return false;
  const code = path.slice(1);
  return LOCALES.some((locale) => locale.code === code);
}

/** The host the request arrived on, lower-cased and without the port. */
export function requestHostname(request: Request): string {
  return new URL(request.url).hostname.toLowerCase();
}

export function isLabRequest(request: Request): boolean {
  return requestHostname(request) === LAB_HOST;
}

function redirect(request: Request, origin: string, pathname?: string): Response {
  const url = new URL(request.url);
  const target = new URL(pathname ?? url.pathname, origin);
  if (pathname === undefined) target.search = url.search;
  return new Response(null, {
    status: 301,
    headers: { location: target.href },
  });
}

/**
 * A 301 across the split, or null when this host already owns the path.
 *
 * Unknown hosts (localhost, workers.dev previews) get null, so local dev
 * behaves like the contracting site.
 */
export function hostRedirect(request: Request): Response | null {
  const host = requestHostname(request);
  const path = normalize(new URL(request.url).pathname);

  if (host === LAB_HOST) {
    // The lab's MCP server has no OAuth. Following a redirect to the portal's
    // discovery documents would make a client sign in to the portal for the
    // knowledgebase, the very mix-up this split removes.
    if (under(path, '/.well-known')) return new Response('Not found', { status: 404 });
    if (CONTRACTING_ROOTS.some((root) => under(path, root))) {
      return redirect(request, CONTRACTING_ORIGIN);
    }
    if (CONTRACTING_EXACT.includes(path)) {
      return redirect(request, CONTRACTING_ORIGIN);
    }
    if (isLocaleHome(path)) {
      // English lives at "/" on the contracting site, not at /en-US.
      return path === `/${SOURCE_LOCALE}`
        ? redirect(request, CONTRACTING_ORIGIN, '/')
        : redirect(request, CONTRACTING_ORIGIN);
    }
    return null;
  }

  if (CONTRACTING_HOSTS.has(host)) {
    if (CONTRACTING_EXACT.includes(path)) return null;
    if (LAB_ROOTS.some((root) => under(path, root)) || LAB_EXACT.includes(path)) {
      return redirect(request, LAB_ORIGIN);
    }
    return null;
  }

  return null;
}
