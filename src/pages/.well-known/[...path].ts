/*
 * The OAuth discovery documents an MCP client reads before signing in
 * (RFC 9728 protected-resource and RFC 8414 server metadata). Anything else
 * under /.well-known is not ours to answer.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { proxyToWorker } from '../../lib/workerProxy';

const OURS = /^(oauth-protected-resource|oauth-authorization-server|openid-configuration)(\/mcp)?$/;

/* OpenAI plugin submission domain-verification token, served as plain text. */
const OPENAI_APPS_CHALLENGE = 'i3X5N8HypVMvRgKt5Nxz2PaNde9EC7bmKk_3qV10Gbk';

export const ALL: APIRoute = ({ request, params }) => {
  const path = params.path ?? '';
  if (path === 'openai-apps-challenge') {
    return new Response(OPENAI_APPS_CHALLENGE, { headers: { 'content-type': 'text/plain' } });
  }
  if (!OURS.test(path)) return new Response('Not found', { status: 404 });
  return proxyToWorker(request, `/.well-known/${path}`);
};
