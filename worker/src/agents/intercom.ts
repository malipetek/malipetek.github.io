/*
 * The intercom agent. One Durable Object conversation per visitor session —
 * the conversation history lives in the DO, so /chat only forwards the new
 * message and polls the snapshot for the settled reply.
 */
'use agent';
import { setProvider, useModel, useTool } from '@flue/runtime';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { requestHandoff } from '../tools/request-handoff.ts';
import persona from '../persona.md?raw';

/*
 * DeepSeek V4 Flash, through DeepSeek's own API: the same cheap, fast model the
 * ticket bridge translates with, so one DEEPSEEK_API_KEY covers both and the
 * chat no longer depends on a free tier of somebody else's catalogue (which
 * is how it broke twice before: a withdrawn free model answers 404, and the
 * paid slug answers 403 once the key's monthly limit is spent).
 *
 * The provider reads DEEPSEEK_API_KEY from the Worker's environment.
 */
setProvider(deepseekProvider());

export function Intercom() {
  // thinkingLevel 'off' keeps chat latency sane: this is a shop window, not a
  // reasoning benchmark.
  useModel('deepseek/deepseek-v4-flash', { thinkingLevel: 'off' });
  useTool(requestHandoff);
  return `${persona}

Current availability: limited — notes are read but new contracts are not being taken right now.`;
}
