/*
 * Non-HTTP Worker handlers. Flue merges this default export into the
 * generated Worker entry next to app.ts's fetch.
 */
import { handleInbound } from './inbound.ts';
import { mailAli, siteUrl } from './portal.ts';
import { reapExpired, takeNewOutages, takeNewStalls } from './queue.ts';
import type { Env } from './shared.ts';
import { advanceSites, takeNewSiteFailures } from './sites.ts';

/** Provisioning's half of the cron: sites nobody is watching still move, and a stop is said once. */
async function watchSites(env: Env) {
  await advanceSites(env);
  const failed = await takeNewSiteFailures(env);
  if (!failed.length) return;
  await mailAli(env, {
    subject: `Site setup stopped: ${failed.map((f) => f.name).join(', ')}`,
    text: [
      ...failed.map((f) => `${f.name} [${f.slug}]: ${f.error ?? 'no reason given'}`),
      '',
      'The platform\'s last answer is in the admin views (Directory → the project). Retry from there.',
      `Admin: ${siteUrl(env)}/portal/admin`,
    ].join('\n'),
  });
}

/**
 * The queue's watchdog, every five minutes: close runs whose node went quiet,
 * tell Ali — once per outage — about watched nodes that went offline, and —
 * once per item — about approved work no live node can take.
 * Claims and admin reads reap too; this is what reaps when nobody is looking.
 */
async function watchQueue(env: Env) {
  await reapExpired(env);
  const outages = await takeNewOutages(env);
  if (outages.length) {
    await mailAli(env, {
      subject: `Node offline: ${outages.map((o) => o.id).join(', ')}`,
      text: [
        ...outages.map((o) => `${o.id} has not heartbeated for ${Math.round(o.offlineSeconds / 60)} minutes.`),
        '',
        'Its last health report is in the Admin panel (Fleet → the node). The node',
        'process, its machine, or the network may be down.',
        `Fleet: ${siteUrl(env)}/portal/admin#fleet`,
      ].join('\n'),
    });
  }
  const stalled = await takeNewStalls(env);
  if (!stalled.length) return;
  await mailAli(env, {
    subject: `${stalled.length} approved item${stalled.length === 1 ? '' : 's'} waiting for a node`,
    text: [
      ...stalled.map(
        (item) => `#${item.id} ${item.title} [${item.slug ?? 'no project'}] — waiting ${Math.round(item.waitingSeconds / 60)}m\n  ${item.reason}`,
      ),
      '',
      `Queue: ${siteUrl(env)}/portal/admin — or the Admin panel in the Harness.`,
    ].join('\n'),
  });
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext) {
    await handleInbound(message, env);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([watchQueue(env), watchSites(env)]));
  },
};
