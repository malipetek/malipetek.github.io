/*
 * The MCP endpoint for whichever host this request arrived on.
 *
 *   https://malipetek.dev/mcp  → the client portal's MCP server (/mcp on the
 *                                 intercom Worker): portal_* tools, the
 *                                 assistant a client connects to file and
 *                                 follow requests.
 *   https://lab.malipetek.dev/mcp → the knowledgebase server (/kb-mcp on the
 *                                 intercom Worker): search and read entries,
 *                                 write them with an ack_ key.
 *
 * The tools live in the intercom Worker; this keeps one origin per site (see
 * src/lib/workerProxy.ts).
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { proxyToWorker } from '../lib/workerProxy';
import { isLabRequest } from '../lib/siteHosts';

export const ALL: APIRoute = (context) =>
  proxyToWorker(context, isLabRequest(context.request) ? '/kb-mcp' : '/mcp');
