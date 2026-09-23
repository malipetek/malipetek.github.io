/*
 * The intercom agent. One Durable Object conversation per visitor session —
 * the conversation history lives in the DO, so /chat only forwards the new
 * message and polls the snapshot for the settled reply.
 */
'use agent';
import { setProvider, useModel, useTool } from '@flue/runtime';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import type { Model } from '@earendil-works/pi-ai';
import { requestHandoff } from '../tools/request-handoff.ts';
import persona from '../persona.md?raw';

// Pi's bundled OpenRouter catalog predates the `:free` tier of this model.
// Clone the paid entry's metadata under the free id and re-register the
// provider — registration in an agent module applies inside the Durable
// Object isolate where the agent runs.
const openrouter = openrouterProvider();
const paidEntry = openrouter.getModels().find((m) => m.id === 'qwen/qwen3.8-27b');
const freeEntry = {
  api: 'openai-completions',
  baseUrl: 'https://openrouter.ai/api/v1',
  provider: 'openrouter',
  reasoning: false,
  input: ['text'],
  contextWindow: 131072,
  maxTokens: 8192,
  compat: {},
  ...paidEntry,
  id: 'qwen/qwen3.8-27b:free',
  name: 'Qwen 3.8 27B (free)',
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as unknown as Model<'openai-completions'>;

// pi-ai's auth resolver dereferences ctx.signal, but flue's call path doesn't
// always pass one — wrap resolve with a never-aborted signal fallback.
const baseAuth = openrouter.auth.apiKey!;

// The `:free` tier is served only by ModelRun, which folds tool schemas into
// a grammar and rejects constraint keywords it can't express. Strip them —
// the structural parts (type/properties/required/items/enum) stay intact.
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  'minLength', 'maxLength', 'pattern', 'format',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minItems', 'maxItems', 'uniqueItems', 'contains', 'minContains', 'maxContains',
  'minProperties', 'maxProperties', 'propertyNames',
  'dependentRequired', 'dependentSchemas', 'if', 'then', 'else', 'not',
  'examples', 'default',
]);

function sanitizeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeSchema);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (!UNSUPPORTED_SCHEMA_KEYS.has(k)) out[k] = sanitizeSchema(v);
  }
  return out;
}

function sanitizeContext(context: { tools?: unknown[] }): typeof context {
  if (!context.tools) return context;
  return {
    ...context,
    tools: context.tools.map((t) => {
      const tool = t as { parameters?: unknown };
      return tool.parameters ? { ...tool, parameters: sanitizeSchema(tool.parameters) } : tool;
    }),
  };
}

setProvider({
  ...openrouter,
  auth: {
    ...openrouter.auth,
    apiKey: {
      ...baseAuth,
      resolve: (ctx: unknown) =>
        baseAuth.resolve({ signal: new AbortController().signal, ...(ctx as object) } as never),
    } as typeof baseAuth,
  },
  getModels: () => [...openrouter.getModels(), freeEntry],
  stream: (model, context, options) =>
    openrouter.stream(model as never, sanitizeContext(context) as never, options as never),
  streamSimple: (model, context, options) =>
    openrouter.streamSimple(model as never, sanitizeContext(context) as never, options as never),
});

export function Intercom() {
  // Qwen via OpenRouter — authenticates with the OPENROUTER_API_KEY worker
  // secret, no key in source. thinkingLevel 'off' keeps chat latency sane on
  // a reasoning-capable model.
  useModel('openrouter/qwen/qwen3.8-27b:free', { thinkingLevel: 'off' });
  useTool(requestHandoff);
  return `${persona}

Current availability: limited — notes are read but new contracts are not being taken right now.`;
}
