/*
 * /robots.txt, per host.
 *
 * One robots file per site: each lists only its own sitemaps, so a crawler
 * never discovers the other host from this one.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import {
  CONTRACTING_ORIGIN,
  LAB_ORIGIN,
  isLabRequest,
} from '../lib/siteHosts';

const SIGNALS = `# As a condition of accessing this website, you agree to abide by the following
# content signals:

# (a)  If a content-signal = yes, you may collect content for the corresponding
#      use.
# (b)  If a content-signal = no, you may not collect content for the corresponding
#      use.
# (c)  If the website operator does not include a content signal for a
#      corresponding use, the website operator neither grants nor restricts
#      permission via content signal with respect to the corresponding use.

# The content signals and their meanings are:

# search:   building a search index and providing search results (e.g., returning
#           hyperlinks and short excerpts from your website's contents). Search does not
#           include providing AI-generated search summaries.
# ai-input: inputting content into one or more AI models (e.g., retrieval
#           augmented generation, grounding, or other real-time taking of content for
#           generative AI search answers).
# ai-train: training or fine-tuning AI models.

# ANY RESTRICTIONS EXPRESSED VIA CONTENT SIGNALS ARE EXPRESS RESERVATIONS OF
# RIGHTS UNDER ARTICLE 4 OF THE EUROPEAN UNION DIRECTIVE 2019/790 ON COPYRIGHT
# AND RELATED RIGHTS IN THE DIGITAL SINGLE MARKET.

# No content signal is declared above, so the site neither grants nor restricts
# those uses.`;

const contracting = `${SIGNALS}

User-agent: *
Allow: /

Sitemap: ${CONTRACTING_ORIGIN}/sitemap.xml
`;

const lab = `${SIGNALS}
# The knowledgebase is written to be read by people and by agents. It is also
# served over MCP at ${LAB_ORIGIN}/mcp.

User-agent: *
Allow: /

Sitemap: ${LAB_ORIGIN}/sitemap.xml
Sitemap: ${LAB_ORIGIN}/kb/sitemap.xml
Sitemap: ${LAB_ORIGIN}/plugins/sitemap.xml
`;

export const GET: APIRoute = ({ request }) =>
  new Response(isLabRequest(request) ? lab : contracting, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
