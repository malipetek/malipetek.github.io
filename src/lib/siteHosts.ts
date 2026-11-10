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

/** Contracting paths. The localized pages are handled separately. */
const CONTRACTING_ROOTS = ['/portal', '/api'];
const CONTRACTING_EXACT = [
  '/agents',
  '/agents.md',
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

/** The pages the contracting site has once per locale. */
const LOCALE_PAGES = new Set(['/', '/contact', '/agents']);

/**
 * The locale-independent path of a `/<code>/…` URL, or null when it is not a
 * localized page: `/tr`, `/tr/`, `/tr/contact` and `/de-DE/agents` match,
 * `/tr/portal` and `/kb` do not.
 */
function localizedPagePath(path: string): string | null {
  if (path === '/') return null;
  const [code, ...rest] = path.slice(1).split('/');
  if (!LOCALES.some((locale) => locale.code === code)) return null;
  const page = rest.length ? `/${rest.join('/')}` : '/';
  return LOCALE_PAGES.has(page) ? page : null;
}

/** The host the request arrived on, lower-cased and without the port. */
export function requestHostname(request: Request): string {
  return new URL(request.url).hostname.toLowerCase();
}

/**
 * Branch previews and local dev have one host for both sites, and a
 * workers.dev preview cannot take a `lab.` prefix. There `?site=lab` shows the
 * lab's version of the host-decided pages (`/`, the 404, llms.txt…) and
 * `?site=dev` the contracting one; the choice is kept in a cookie so the
 * relative nav links stay on the same site.
 */
const PREVIEW_SITE_COOKIE = 'preview_site';

function isPreviewHost(host: string): boolean {
  return host.endsWith('.workers.dev') || host === 'localhost' || host === '127.0.0.1';
}

function previewSiteAsked(request: Request): 'lab' | 'dev' | null {
  const asked = new URL(request.url).searchParams.get('site');
  return asked === 'lab' || asked === 'dev' ? asked : null;
}

export function isLabRequest(request: Request): boolean {
  const host = requestHostname(request);
  if (host === LAB_HOST) return true;
  if (!isPreviewHost(host)) return false;
  const asked = previewSiteAsked(request);
  if (asked) return asked === 'lab';
  const cookie = request.headers.get('cookie') ?? '';
  return new RegExp(`(?:^|;\\s*)${PREVIEW_SITE_COOKIE}=lab(?:;|$)`).test(cookie);
}

/** The Set-Cookie that keeps a preview's `?site=` choice, or null. */
export function previewSiteCookie(request: Request): string | null {
  if (!isPreviewHost(requestHostname(request))) return null;
  const asked = previewSiteAsked(request);
  if (!asked) return null;
  return `${PREVIEW_SITE_COOKIE}=${asked}; Path=/; Max-Age=2592000; SameSite=Lax`;
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
 * Pages that moved into the portal app, old path → new address on the same
 * host. The new address can carry the app's hash route; old links in emails
 * and bookmarks keep working.
 */
const MOVED: Record<string, string> = {
  // The intake box is the portal's own page now (Intake.jsx).
  '/portal/start': '/portal#/new',
};

/** A 301 from a page that moved, or null. Runs on every host. */
export function movedPage(request: Request): Response | null {
  const url = new URL(request.url);
  const to = MOVED[normalize(url.pathname)];
  if (!to) return null;
  return new Response(null, { status: 301, headers: { location: new URL(to, url.origin).href } });
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
    const page = localizedPagePath(path);
    if (page) {
      // English lives at "/" on the contracting site, not at /en-US, so the
      // prefix comes off: /en-US/contact → /contact.
      const english = path === `/${SOURCE_LOCALE}` || path.startsWith(`/${SOURCE_LOCALE}/`);
      return redirect(request, CONTRACTING_ORIGIN, english ? page : undefined);
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
