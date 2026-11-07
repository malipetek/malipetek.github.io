/*
 * Forward a request to the intercom Worker, which owns the KB, portal and
 * OAuth bindings. The site's own origin stays the public address an agent
 * starts from: /mcp and the OAuth discovery documents (/.well-known/oauth-*).
 * The token endpoint is the Worker's own origin (see worker/src/oauth.ts). The body is buffered rather than
 * streamed: these are small JSON requests, and buffering avoids duplex-stream
 * edge cases.
 *
 * In production this goes through the INTERCOM service binding, not fetch().
 * A same-zone fetch from a Worker is not routed to another Worker's route —
 * Cloudflare answers it from the zone origin, which for this domain is the old
 * GitHub Pages site (404 on GET, 405 on POST). The binding is the supported
 * path between Workers, and it never leaves the account. LOCAL dev has no
 * bindings, so PUBLIC_CHAT_ENDPOINT stays as the fallback.
 */
import { proxyOrigin } from './previewOrigin.js';

const ENDPOINT = String(import.meta.env?.PUBLIC_CHAT_ENDPOINT || '').replace(/\/+$/, '');

/** The pieces of an Astro context this needs; a route handler passes itself. */
export interface ProxyContext {
  request: Request;
  locals?: unknown;
}

type Intercom = { fetch: (request: Request) => Promise<Response> };

/** `locals.runtime.env.INTERCOM` — the binding, or null in dev. */
function intercom(locals: unknown): Intercom | null {
  const env = (locals as { runtime?: { env?: Record<string, unknown> } })?.runtime?.env;
  const binding = env?.INTERCOM as Intercom | undefined;
  return binding && typeof binding.fetch === 'function' ? binding : null;
}

export async function proxyToWorker(context: ProxyContext, path: string): Promise<Response> {
  const { request } = context;
  const worker = intercom(context.locals);
  if (!worker && !ENDPOINT) {
    return new Response(JSON.stringify({ error: 'worker_unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  const incoming = new URL(request.url);
  const headers = new Headers(request.headers);
  // The Worker must see its own host, and length is recomputed after buffering.
  headers.delete('host');
  headers.delete('content-length');
  const origin = proxyOrigin(request, path, Boolean(worker));
  if (origin !== null) headers.set('Origin', origin);
  const init: RequestInit = { method: request.method, headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();
  try {
    // The binding ignores the host but needs a valid absolute URL to build one.
    const response = worker
      ? await worker.fetch(new Request(`https://intercom${path}${incoming.search}`, init))
      : await fetch(`${ENDPOINT}${path}${incoming.search}`, init);
    // Verbatim, including Mcp-Session-Id and content-type, so the transport
    // contract survives the hop.
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch {
    return new Response(JSON.stringify({ error: 'worker_unreachable' }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
}
