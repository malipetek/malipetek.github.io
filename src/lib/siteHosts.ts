/*
 * One site, one Worker — plus the portal's home on a third host.
 *
 * lab.malipetek.dev is Ali's developer lab: the agentic coding knowledgebase,
 * the DeepSeek Harness plugins, writing, work and projects. malipetek.dev is
 * the lab's front door now: every path that is not the lab's or the portal's
 * surface 301s there. ptechsolutions.net serves the PTech homepage and
 * proxies the portal paths (/portal*, /api/*, /mcp, /.well-known/*, /_astro/*,
 * /fonts/*) to this Worker, so /portal and its backing API live there;
 * malipetek.dev/portal* 301s to it. The old contracting pages (the offer,
 * contact, agents, legal, localized homepages) 301 to the company homepage —
 * the portal they fed is the only piece that moved with its code.
 *
 * The split is by Host, not by path, so the same paths exist on both hosts and
 * each host owns its half:
 *
 *   malipetek.dev/kb        → 301 → lab.malipetek.dev/kb
 *   lab.malipetek.dev/portal → 301 → ptechsolutions.net/portal
 *   malipetek.dev/contact   → 301 → ptechsolutions.net/
 *
 * One canonical address per page, so a summary of either site never mixes the
 * two products up. The redirects live here because they run in two places:
 * `src/middleware.ts` for server-rendered routes, and `src/worker.ts` before
 * the Cloudflare adapter serves a prerendered page from the assets binding.
 */
import { LOCALES } from './locales.js';

export const CONTRACTING_ORIGIN = 'https://malipetek.dev';
export const LAB_ORIGIN = 'https://lab.malipetek.dev';
/**
 * The client portal's public home. ptechsolutions.net serves the PTech
 * homepage at /; its Worker (a separate project) proxies the portal paths
 * (/portal*, /api/*, /mcp, /.well-known/*, /_astro/*, /fonts/*) here, so the
 * portal system lives on that host while the offer, contact, legal and
 * localized pages stay on malipetek.dev.
 */
export const PORTAL_ORIGIN = 'https://ptechsolutions.net';

const LAB_HOST = 'lab.malipetek.dev';
const CONTRACTING_HOSTS = new Set(['malipetek.dev', 'www.malipetek.dev']);
const PORTAL_HOSTS = new Set(['ptechsolutions.net', 'www.ptechsolutions.net']);

/** Lab paths, as prefixes: the page itself and everything under it. */
const LAB_ROOTS = ['/kb', '/plugins', '/blog', '/experience', '/projects', '/pdfextractor'];
const LAB_EXACT = ['/plugins.json'];

/** The portal app moved to ptechsolutions.net; the rest of the old site is gone. */
const PORTAL_ROOTS = ['/portal'];
/**
 * Pages of the retired contracting site. They all 301 to the company
 * homepage — /kb/new is not here on purpose: it lives under /kb, which is
 * the lab's, and its portal-session sign-in no longer works on this host.
 */
const CONTRACTING_EXACT = [
  '/agents',
  '/agents.md',
  '/contact',
  '/privacy-policy',
  '/terms-of-service',
  '/chat',
];

/** `/foo/` and `/foo` are the same page for this decision. */
function normalize(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function under(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/** The pages the retired contracting site had once per locale. */
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
 * 301 to the portal's new home. The query string always survives: magic
 * links (/portal/verify?token=…) and ticket deep links carry their state
 * there.
 */
function redirectToPortal(request: Request): Response {
  const url = new URL(request.url);
  const target = new URL(url.pathname, PORTAL_ORIGIN);
  target.search = url.search;
  return new Response(null, { status: 301, headers: { location: target.href } });
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
 * A path that only the retired contracting site ever served: a localized
 * page (/tr, /de-DE/contact, …) or one of the old exact paths. These 301 to
 * the company homepage on ptechsolutions.net.
 */
function isContractingPath(path: string): boolean {
  return localizedPagePath(path) !== null || CONTRACTING_EXACT.includes(path);
}

/** The portal's page surface and its OAuth discovery documents. */
function isPortalSurface(path: string): boolean {
  return PORTAL_ROOTS.some((root) => under(path, root)) || under(path, '/.well-known');
}

/**
 * A 301 across the split, or null when this host already owns the path.
 *
 * Unknown hosts (localhost, workers.dev previews) get null, so local dev
 * behaves like the lab.
 */
export function hostRedirect(request: Request): Response | null {
  const host = requestHostname(request);
  const path = normalize(new URL(request.url).pathname);

  // ptechsolutions.net is the portal's home. Its Worker only sends the portal
  // paths here, so this host gets the lab's answer; www folds to the apex in
  // case a request ever arrives on it directly.
  if (host === 'www.ptechsolutions.net') {
    return redirect(request, PORTAL_ORIGIN);
  }
  if (PORTAL_HOSTS.has(host)) return null;

  if (host === LAB_HOST) {
    // The lab's MCP server has no OAuth. Following a redirect to the portal's
    // discovery documents would make a client sign in to the portal for the
    // knowledgebase, the very mix-up this split removes.
    if (under(path, '/.well-known')) return new Response('Not found', { status: 404 });
    // The portal app answers on ptechsolutions.net now; send it straight there
    // instead of bouncing through malipetek.dev first. /mcp stays: on this
    // host it is the knowledgebase MCP (src/pages/mcp.ts), not the portal's.
    if (isPortalSurface(path)) {
      return redirectToPortal(request);
    }
    // The contracting site's pages are gone; its old addresses land on the
    // company homepage. /kb/new is lab content and falls through to null.
    if (isContractingPath(path)) {
      return redirect(request, PORTAL_ORIGIN, '/');
    }
    return null;
  }

  if (CONTRACTING_HOSTS.has(host)) {
    // /api/* is the intercom backend proxied by this Worker — never a page,
    // never redirected (OAuth callbacks and portal calls live here).
    if (under(path, '/api')) return null;
    // The portal moved to ptechsolutions.net; old links (emails, bookmarks,
    // MCP clients' discovery) land here first and are forwarded with their
    // query intact. /mcp joins them: on this host it was the portal's MCP.
    if (isPortalSurface(path) || path === '/mcp') {
      return redirectToPortal(request);
    }
    if (LAB_ROOTS.some((root) => under(path, root)) || LAB_EXACT.includes(path)) {
      return redirect(request, LAB_ORIGIN);
    }
    // The retired contracting pages go to the company homepage.
    if (isContractingPath(path)) {
      return redirect(request, PORTAL_ORIGIN, '/');
    }
    // Everything else — the old homepage and any unknown path — is the lab's
    // now: malipetek.dev is the lab's front door.
    return redirect(request, LAB_ORIGIN);
  }

  return null;
}
