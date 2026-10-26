/*
 * The offer, said once. The homepage, the intercom persona
 * (worker/scripts/build-persona.mjs) and any email copy read from here, so
 * the wording can't drift between them.
 *
 * Rules for editing: every line must be true of the pipeline as it runs
 * today. Prices come from ./pricing.js, never typed by hand here. No model
 * names (they go stale), no "AI-powered".
 */
import { HOURLY_USD } from './pricing.js';

/** Hero headline, subject lines. */
export const SHORT = 'Human-approved, agent-built.';

/** The one sentence. */
export const ONE_LINE =
  'A one-person dev shop with an agent on the tools. You send a request, I approve it, the work gets built, and I check it before you see it.';

/** What it is, in three words, for eyebrows and footers. */
export const KIND = 'Self-serve software contracting';

/** The pipeline. Also what the hero scene draws, in this order. */
export const STEPS = [
  {
    key: 'request',
    title: 'You ask',
    body: 'Sign in with your email and write what you need: in the portal, by email, or in the chat below. No call to get started.',
  },
  {
    key: 'approve',
    title: 'I approve',
    body: 'I read every request myself. Nothing starts until I say so, and I tell you if it is the wrong thing to build.',
  },
  {
    key: 'build',
    title: 'An agent builds',
    body: 'An AI agent does the typing in a sealed copy of your project. It cannot publish, deploy, or touch anything live.',
  },
  {
    key: 'ship',
    title: 'I check, then ship',
    body: 'I check the result before it goes anywhere. How closely is your call: a quick check that it runs, or every changed line. You follow it all in one thread.',
  },
];

/*
 * Price. The arithmetic and the attention levels live in ./pricing.js (the
 * Worker bills with the same file); these are the sentences around them.
 */
export const PRICE_RULE =
  'You pay for the time I actually spend, billed by the second, plus what the AI run cost, with no markup. No packages, no minimum.';

/** One glanceable line: hero, footers, email signatures. */
export const PRICE_NOTE = `$${HOURLY_USD} an hour of my time, by the second. The AI at cost.`;

export const PRICE_WHY =
  'The less of me a job needs, the less it costs. A change the agent finishes on its own is a minute or two of my time. You choose how closely I look, and you can set a budget I will not pass without asking.';

/** The infrastructure claim, in owner language. */
export const SERVERLESS = {
  title: 'Nothing to babysit',
  body: 'What I build runs serverless. There is no server to patch or resize, and a traffic spike is not a migration project.',
};

export const WHO = 'For business owners who need software work done, not a development team to manage.';
