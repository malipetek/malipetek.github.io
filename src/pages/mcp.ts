/*
 * https://malipetek.dev/mcp — the canonical MCP URL for this site.
 *
 * The tools live in the intercom Worker, which owns the KB and portal
 * bindings; this endpoint makes the address pretty and keeps one origin for
 * everything an agent needs. The body is buffered rather than streamed: MCP
 * requests are small JSON, and buffering avoids duplex-stream edge cases.
 */
export const prerender = false;

import type { APIRoute } from 'astro';

const ENDPOINT = String(import.meta.env.PUBLIC_CHAT_ENDPOINT || '').replace(/\/+$/, '');

export const ALL: APIRoute = async ({ request }) => {
  if (!ENDPOINT) {
    return new Response(JSON.stringify({ error: 'mcp_unavailable' }), {
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
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  try {
    const response = await fetch(`${ENDPOINT}/mcp${incoming.search}`, init);
    // Return the Worker's response verbatim, including Mcp-Session-Id and
    // content-type, so the transport contract survives the hop.
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch {
    return new Response(JSON.stringify({ error: 'mcp_unreachable' }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
};
