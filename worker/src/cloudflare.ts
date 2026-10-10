/*
 * Non-HTTP Worker handlers. Flue merges this default export into the
 * generated Worker entry next to app.ts's fetch.
 */
import { handleInbound } from './inbound.ts';
import type { Env } from './shared.ts';

export default {
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext) {
    await handleInbound(message, env);
  },
};
