/*
 * WebMCP — this site's own capabilities, exposed to browser-integrated agents.
 *
 * This is the client-side counterpart to /mcp. A backend MCP server is reached
 * by the agent's platform; WebMCP tools are registered by the *page*, reuse the
 * page's own code, and keep the visible UI in sync with what the agent did.
 *
 * Everything here is feature-detected: browsers without `document.modelContext`
 * load this module, find nothing, and do nothing. Nothing is polyfilled.
 *
 * Three tools, deliberately. The spec's own guidance is that every registered
 * tool costs context window and invites tool confusion, and that tools should be
 * registered for the state the page is actually in — hence `open_intercom`
 * appearing only on pages that have an intercom.
 */

const ENDPOINT = String(import.meta.env.PUBLIC_CHAT_ENDPOINT || '').replace(/\/+$/, '');

/** `document.modelContext` is the specified home; older polyfills used navigator. */
function modelContext() {
  if (typeof document === 'undefined') return null;
  const ctx =
    document.modelContext ??
    (typeof navigator !== 'undefined' ? navigator.modelContext : undefined);
  return ctx && typeof ctx.registerTool === 'function' ? ctx : null;
}

const text = (value) => ({ content: [{ type: 'text', text: value }] });

/**
 * The spec says the execute callback receives parsed arguments, but the shipped
 * Chromium implementation serialises them: `executeTool(tool, '{"query":"x"}')`
 * parses and the callback still gets an object, while calling it with a plain
 * object throws "Failed to parse input arguments". Accept both, so the tools do
 * not depend on which side of that the implementation lands.
 */
function argsOf(raw) {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw || '{}') ?? {};
    } catch {
      return {};
    }
  }
  return raw ?? {};
}

async function searchEntries(query, status) {
  if (!ENDPOINT) throw new Error('The knowledgebase API is not configured on this build.');
  const url = new URL(`${ENDPOINT}/kb/entries`);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '5');
  if (status) url.searchParams.set('status', status);

  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`The knowledgebase returned ${response.status}.`);
  const body = await response.json();
  return body.entries ?? [];
}

function render(entries, query) {
  if (!entries.length) {
    return `No entry matches "${query}". The knowledgebase only covers problems Ali's agents have actually hit.`;
  }
  return entries
    .map(
      (entry) =>
        `- ${entry.title} [${entry.status}]${entry.language ? ` · ${entry.language}` : ''}\n  https://malipetek.dev/kb/${entry.slug}`,
    )
    .join('\n');
}

/**
 * Register the tools this page can actually honour. Safe to call on every page:
 * it returns false when the browser has no WebMCP implementation.
 */
export function registerSiteTools() {
  const ctx = modelContext();
  if (!ctx) return false;

  const tools = [
    {
      name: 'search_knowledge',
      description:
        "Search Ali's public knowledgebase of real fixes from agentic coding sessions. Returns matching entries. On the knowledgebase page the visible results update to match.",
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search terms, e.g. "cloudflare email routing" or "fts5 user input".',
          },
          status: {
            type: 'string',
            enum: ['solved', 'workaround', 'unsolvable'],
            description: 'Optional filter: solved, workaround, or a dead end ruled out with evidence.',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      async execute(raw) {
        const { query, status } = argsOf(raw);
        const entries = await searchEntries(query, status);
        // Shared state, per the spec's "synchronize visual UI state": if the
        // visitor is looking at the knowledgebase, show them the same results.
        const form = document.querySelector('form.kb-search');
        const input = form?.querySelector('input[name="q"]');
        if (form instanceof HTMLFormElement && input instanceof HTMLInputElement) {
          input.value = query;
          form.requestSubmit();
        }
        return text(render(entries, query));
      },
    },
    {
      name: 'open_knowledge_entry',
      description:
        'Open a knowledgebase entry in the browser so the visitor can read it. Use the slug returned by search_knowledge.',
      inputSchema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Entry slug, e.g. "fts5-match-on-raw-user-input-turns-a-search-box-into-a-500".' },
        },
        required: ['slug'],
        additionalProperties: false,
      },
      async execute(raw) {
        const { slug } = argsOf(raw);
        const path = `/kb/${encodeURIComponent(slug)}`;
        location.assign(path);
        return text(`Opened ${path}`);
      },
    },
  ];

  // Only where there is an intercom to bring the visitor to.
  const intercom = document.querySelector('#talk');
  if (intercom) {
    tools.push({
      name: 'open_intercom',
      description:
        'Bring the visitor to the intercom on this page so they can talk to Ali directly. Use when the visitor wants to ask something the site cannot answer.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      async execute() {
        intercom.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const bell = intercom.querySelector('.bell');
        if (bell instanceof HTMLElement) bell.focus({ preventScroll: true });
        return text('Scrolled to the intercom and focused the bell.');
      },
    });
  }

  // One bad tool must not take the rest down; a browser may reject a schema it
  // dislikes, and registration failures are not fatal.
  for (const tool of tools) {
    try {
      Promise.resolve(ctx.registerTool(tool)).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  return true;
}
