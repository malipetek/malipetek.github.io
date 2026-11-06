/*
 * The Cloudflare Worker entry.
 *
 * Astro's middleware cannot redirect a prerendered page: the adapter answers
 * it from the ASSETS binding before `app.render` runs, so middleware never
 * sees the request. That is true even with `assets.run_worker_first` — the
 * adapter's handler still short-circuits to ASSETS.
 *
 * So the host redirect runs here, one step earlier, for the prerendered paths
 * listed in `run_worker_first` in wrangler.jsonc (/portal*, /blog/*,
 * /projects/*). Everything else is a server route and is handled by
 * src/middleware.ts. Both use the same rules in src/lib/siteHosts.ts.
 *
 * This is the adapter's documented `workerEntryPoint` contract: export
 * `createExports(manifest)` and get the default fetch handler.
 */
import type { SSRManifest } from 'astro';
import { App } from 'astro/app';
import { handle } from '@astrojs/cloudflare/handler';
import { hostRedirect } from './lib/siteHosts';

type Env = Record<string, unknown> & {
  ASSETS: { fetch: (request: Request | string) => Promise<Response> };
};

type WorkerContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

export function createExports(manifest: SSRManifest) {
  const app = new App(manifest);

  return {
    default: {
      async fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
        const redirect = hostRedirect(request);
        if (redirect) return redirect;
        return handle(
          manifest,
          app,
          request,
          env as Parameters<typeof handle>[3],
          ctx as Parameters<typeof handle>[4],
        );
      },
    },
  };
}
