/*
 * /llms.txt, per host.
 *
 * malipetek.dev describes the client portal only: who it is for, how the work
 * runs, what it costs, and the MCP tools a client's assistant gets.
 *
 * lab.malipetek.dev describes the lab: the knowledgebase, its own MCP server,
 * the plugins, writing and work. The two summaries must not borrow from each
 * other; assistants that read one should not describe the other.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import {
  CONTRACTING_ORIGIN,
  LAB_ORIGIN,
  isLabRequest,
} from '../lib/siteHosts';
import {
  ATTENTION,
  HOURLY_USD,
  money,
  timeCents,
} from '../lib/pricing.js';
import {
  DEFINITION,
  PRICE_HOOK,
  PRICE_NOTE,
  PRICE_RULE,
  PRICE_WHY,
  STEPS,
  WHO,
} from '../lib/offer.js';

const contracting = `# malipetek.dev: vibe contracting

> Self-serve software contracting from M. Ali Petek. You describe a website
> change in plain words, Ali approves it, an AI agent builds it in a sealed
> copy of the project, Ali checks the result, and it ships. Billed by the
> minute, with no quote and no minimum.

${DEFINITION}

## Who it is for

${WHO}

## How it works

${STEPS.map((step, i) => `${i + 1}. ${step.title}: ${step.body}`).join('\n')}

## What it costs

${PRICE_HOOK}
${PRICE_NOTE}
${PRICE_RULE}
${PRICE_WHY}

Three levels of attention, chosen per request:

${ATTENTION.map((a) => `- ${a.name}: ${a.what}${a.typicalSeconds ? ` Typical example: ${money(timeCents(a.typicalSeconds))}.` : ''}`).join('\n')}

## Client portal

- Portal: ${CONTRACTING_ORIGIN}/portal
- Sign in with an email link, file a request, reply, set a budget, and follow
  the work in one thread.

## MCP (the client's assistant)

- Endpoint: ${CONTRACTING_ORIGIN}/mcp (streamable HTTP, protocol 2025-06-18)
- Discovery: ${CONTRACTING_ORIGIN}/.well-known/mcp-server.json
- Setup guide: ${CONTRACTING_ORIGIN}/agents
- Auth: a client's own agent key (Bearer cat_…, minted in the portal) or the
  OAuth flow. It sees exactly that client's account.

Tools: portal_projects, portal_requests, portal_request, portal_file_request,
portal_reply, portal_set_budget, portal_withdraw. An assistant can also read
the project's source, send a change on the request's branch, and build it to a
preview (project_context, workspace_files, workspace_read, submit_change,
preview_build). Every request still waits for Ali before work starts, and he
checks the result before it ships.

A client who already pays for ChatGPT or Claude can connect it and let it make
the change itself. They pay only for the review minutes.

## Notes

The coding agents and internal tools used to do the work are not part of what clients use or need to know about.

Ali's knowledgebase, open-source plugins and writing are a separate site: https://lab.malipetek.dev (not part of this service).

## Contact

- malipetek@gmail.com
- https://github.com/malipetek
`;

const lab = `# lab.malipetek.dev: M. Ali Petek's lab

> The developer side of malipetek.dev: an agentic coding knowledgebase from
> real sessions, DeepSeek Harness plugins Ali builds for himself, writing, work
> history and projects.

## Knowledgebase

- HTML: ${LAB_ORIGIN}/kb
- One entry as JSON: ${LAB_ORIGIN}/kb/<slug>.json
- REST list: ${LAB_ORIGIN}/kb/entries
- Search: ${LAB_ORIGIN}/kb?q=<terms>
- MCP: ${LAB_ORIGIN}/mcp (streamable HTTP, protocol 2025-06-18)
- Agent setup: ${LAB_ORIGIN}/kb/agents

Entries are problem and solution pairs from real sessions. Status is one of
solved, workaround or unsolvable (a dead end documented with evidence).
Reading is open to everyone. Writing needs an ack_ key the site owner mints;
there is no self-serve key route. Search uses SQLite FTS5 with quoted prefix
tokens, and raw FTS syntax in a query is sanitised.

## MCP tools

Public (no auth):

- search_knowledge(query, status?, tag?, language?, limit?): full-text search
- get_knowledge(id_or_slug): one entry, full markdown
- list_knowledge(limit?): newest entries, no bodies

Author (Authorization: Bearer ack_…):

- create_knowledge(title, problem, solution, status, language?, framework?, tags?, author_agent)
- update_knowledge(id, …): only for entries that key authored

The endpoint also serves every entry as a resource at kb://entry/<slug>, and
one prompt, record_learning. This server has no client portal tools.

## DeepSeek Harness plugins

- HTML: ${LAB_ORIGIN}/plugins
- JSON list: ${LAB_ORIGIN}/plugins.json
- One plugin as JSON: ${LAB_ORIGIN}/plugins/<slug>.json

Plugins are Cordis packages for DeepSeek Harness, published to npm under the
@malipetek scope. Install inside the harness with dsh plugin add
@malipetek/dsh-<name>, or use "Add plugin" in the plugin manager. Installed
plugins do not update automatically: remove the old version and add the new
one. A package with no registry entry yet is shown as unpublished.

## Writing, work and projects

- Writing: ${LAB_ORIGIN}/blog
- Work history: ${LAB_ORIGIN}/experience
- Projects: ${LAB_ORIGIN}/projects

## Not the client portal

The client portal for website work is a separate site: ${CONTRACTING_ORIGIN}.
Its MCP endpoint is ${CONTRACTING_ORIGIN}/mcp and has portal tools only.
Clients do not need the knowledgebase, the plugins or anything on this lab.

## Contact

- malipetek@gmail.com
- https://github.com/malipetek
- Hire: ${CONTRACTING_ORIGIN}
`;

export const GET: APIRoute = ({ request }) =>
  new Response(isLabRequest(request) ? lab : contracting, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
