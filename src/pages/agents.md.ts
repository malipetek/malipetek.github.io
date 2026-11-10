/*
 * The agent instructions as a plain document, for the links on /agents that
 * open them in another assistant (src/lib/agentInstructions.js holds the
 * text). Contracting only; the lab host redirects here (siteHosts.ts).
 */
import type { APIRoute } from 'astro';
import { AGENT_INSTRUCTIONS } from '../lib/agentInstructions.js';

export const prerender = false;

export const GET: APIRoute = () =>
  new Response(AGENT_INSTRUCTIONS, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
