/*
 * Forward a request to the intercom Worker, which owns the KB, portal and
 * OAuth bindings. The site's own origin stays the public address an agent
 * starts from: /mcp and the OAuth discovery documents (/.well-known/oauth-*).
 * The token endpoint is the Worker's own origin (see worker/src/oauth.ts). The body is buffered rather than
 * streamed: these are small JSON requests, and buffering avoids duplex-stream
 * edge cases.
 */
const ENDPOINT = String(import.meta.env.PUBLIC_CHAT_ENDPOINT || '').replace(/\/+$/, '');

export async function proxyToWorker(request: Request, path: string): Promise<Response> {
  if (!ENDPOINT) {
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
  const init: RequestInit = { method: request.method, headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();
  try {
    const response = await fetch(`${ENDPOINT}${path}${incoming.search}`, init);
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
