/*
 * The OAuth discovery documents an MCP client reads before signing in
 * (RFC 9728 protected-resource and RFC 8414 server metadata), plus the
 * portal's own MCP discovery document. Anything else under /.well-known is not
 * ours to answer.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { proxyToWorker } from '../../lib/workerProxy';
import mcpManifest from '../../data/mcp-server.json';

const OURS = /^(oauth-protected-resource|oauth-authorization-server|openid-configuration)(\/mcp)?$/;

/* OpenAI plugin submission domain-verification token, served as plain text. */
const OPENAI_APPS_CHALLENGE = 'i3X5N8HypVMvRgKt5Nxz2PaNde9EC7bmKk_3qV10Gbk';

export const ALL: APIRoute = (context) => {
  const path = context.params.path ?? '';
  if (path === 'openai-apps-challenge') {
    return new Response(OPENAI_APPS_CHALLENGE, { headers: { 'content-type': 'text/plain' } });
  }
  // The portal's discovery document. Served here rather than from public/ so
  // the lab host can 301 it, and so it can only ever describe the portal.
  if (path === 'mcp-server.json') {
    return new Response(JSON.stringify(mcpManifest, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  if (!OURS.test(path)) return new Response('Not found', { status: 404 });
  return proxyToWorker(context, `/.well-known/${path}`);
};
