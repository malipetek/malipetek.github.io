/*
 * Host split: see src/lib/siteHosts.ts. This covers every server-rendered
 * route. A prerendered page is served from the assets binding before Astro
 * runs (even with `run_worker_first`, the adapter answers it from ASSETS), so
 * those requests are redirected in src/worker.ts instead, before the adapter
 * gets the request. Both call the same rule set.
 */
import { defineMiddleware } from 'astro:middleware';
import { hostRedirect, previewSiteCookie } from './lib/siteHosts';

export const onRequest = defineMiddleware(async (context, next) => {
  // Astro runs the middleware while it renders a prerendered page too, with
  // Astro.site as the host. Without this, building the lab's static pages
  // would redirect them to the lab (they are rendered as malipetek.dev).
  // Those pages are static and the redirect is checked again at request time
  // by src/worker.ts.
  if (context.isPrerendered) return next();

  const redirect = hostRedirect(context.request);
  if (redirect) return redirect;

  const cookie = previewSiteCookie(context.request);
  if (!cookie) return next();
  const response = await next();
  const kept = new Response(response.body, response);
  kept.headers.append('set-cookie', cookie);
  return kept;
});
