/*
 * https://malipetek.dev/mcp — the canonical MCP URL for this site. The tools
 * live in the intercom Worker; this keeps one origin for everything an agent
 * needs (see src/lib/workerProxy.ts).
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { proxyToWorker } from '../lib/workerProxy';

export const ALL: APIRoute = ({ request }) => proxyToWorker(request, '/mcp');
