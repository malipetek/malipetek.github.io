/*
 * Non-HTTP Worker handlers. Flue merges this default export into the
 * generated Worker entry next to app.ts's fetch.
 */
import { handleInbound } from './inbound.ts';
import { runAndNotifyHealth } from './portal.ts';
import { runMarketing, sweepDomains } from './marketing.ts';
import { ensureContentCycle, releaseHeldPosts } from './content.ts';
import { ensureGuideCycle, ensureSeoCycle, runSeo, sweepGuidePrs } from './seo.ts';
import { observeContacts } from './observe.ts';
import { reapExpired } from './queue.ts';
import { sweepFirstPreviews } from './firstPreview.ts';
import { runI18nSync } from './i18nSync.ts';
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
  // A first preview whose run ended (or whose limit ran out) still gets told.
  await sweepFirstPreviews(env);
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext) {
    await handleInbound(message, env);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      Promise.all([
        watchQueue(env),
        watchSites(env),
        runAndNotifyHealth(env),
        runMarketing(env),
        ensureContentCycle(env),
        // The SEO desk: the audit is daily, the probe and the citation check
        // weekly, the cycle files itself when there is something to fix, and
        // the guide cycle writes the pages the targets are owed.
        runSeo(env),
        ensureSeoCycle(env),
        ensureGuideCycle(env),
        // A guide PR whose checks were still running gets retried here.
        sweepGuidePrs(env).catch((error) => console.error('guide_sweep_failed', error)),
        // Drafted posts whose hold ran out schedule themselves.
        releaseHeldPosts(env),
        // Site observations for queued contacts, and the domain MX sweep —
        // both run whether or not outreach is live.
        observeContacts(env),
        sweepDomains(env),
        // The interface catalogs: translated and committed when English changes, or when Ali asks.
        runI18nSync(env).catch((error) => console.error('i18n_sync_failed', error)),
      ]),
    );
  },
};
