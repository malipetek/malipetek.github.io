/*
 * Non-HTTP Worker handlers. Flue merges this default export into the
 * generated Worker entry next to app.ts's fetch.
 */
import { handleInbound } from './inbound.ts';
import { runAndNotifyHealth } from './portal.ts';
import { runMarketing } from './marketing.ts';
import { ensureContentCycle } from './content.ts';
import { reapExpired } from './queue.ts';
import type { Env } from './shared.ts';
import { advanceSites, pruneDeploys } from './sites.ts';

/**
 * The five-minute watchdog.
 *
 * Health owns every alert now: a node offline, work no node can take, a repo
 * that will not clone, a site setup that stopped and a deploy that is not
 * master. It mails once per failure and once on recovery, so the separate
 * per-item mails are gone — one page, one mail.
 */
async function watchSites(env: Env) {
  await advanceSites(env);
  await pruneDeploys(env);
}

async function watchQueue(env: Env) {
  await reapExpired(env);
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext) {
    await handleInbound(message, env);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      Promise.all([watchQueue(env), watchSites(env), runAndNotifyHealth(env), runMarketing(env), ensureContentCycle(env)]),
    );
  },
};
