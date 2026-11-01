/*
 * /api/* is the intercom Worker's public surface (POST /chat, /handoff, the
 * portal, the fleet node API). The site Worker owns malipetek.dev/*, so
 * without this route those requests are answered by Astro — a 404 page — and
 * the talk section never reaches the assistant.
 */
import type { APIRoute } from 'astro';
import { proxyToWorker } from '../../lib/workerProxy';

export const prerender = false;

export const ALL: APIRoute = (context) => {
  const rest = context.params.path ?? '';
  return proxyToWorker(context, `/api${rest ? `/${rest}` : ''}`);
};
