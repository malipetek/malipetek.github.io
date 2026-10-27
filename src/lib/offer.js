/*
 * The offer, said once. The homepage, the intercom persona
 * (worker/scripts/build-persona.mjs) and any email copy read from here, so
 * the wording can't drift between them.
 *
 * Rules for editing: every line must be true of the pipeline as it runs
 * today. Prices come from ./pricing.js, never typed by hand here. No model
 * names (they go stale), no "AI-powered".
 */
import { ATTENTION, HOURLY_USD, money, timeCents } from './pricing.js';

/** What the quickest kind of job costs in time, from the Autopilot example. */
const QUICK_FIX = money(timeCents(ATTENTION.find((a) => a.key === 'auto')?.typicalSeconds ?? 60));

/** The descriptor: page titles, the persona, subject lines. */
export const SHORT = 'Human-approved, agent-built.';

/**
 * The primary hook is the price. The headline, in two beats so it can break
 * between them; then the fact that makes it concrete.
 */
export const HEADLINE = ['Software help,', 'by the minute.'];
export const PRICE_HOOK = `A one-minute fix is ${QUICK_FIX}. No quote, no minimum.`;

/**
 * The secondary hook: who it is for right now. People build most of a thing
 * themselves with AI and stall on the part that needs a developer.
 */
export const LAST_MILE =
  'You can vibe code most of it. The last mile is where you need a developer: the bug it keeps bringing back, the deploy, the payments, the thing that only breaks for real customers. Get that help at a fraction of the price, billed by the second, not by a quote.';

/** How it is done, in two beats: supports the hooks, never leads. */
export const PUNCHLINE = ['The agent types.', 'I sign off.'];

/** The one sentence. */
export const ONE_LINE =
  'A one-person dev shop with an AI agent on the tools. You send a request, I approve it, the agent builds it, and I check it before you see it. You pay for the minutes I spend, not the hours it would have taken.';

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
export const PRICE_NOTE = `$${HOURLY_USD} an hour of my time, billed by the second; the AI at cost, no markup.`;

export const PRICE_WHY =
  'The less of me a job needs, the less it costs. A change the agent finishes on its own is a minute or two of my time. You choose how closely I look, and you can set a budget I will not pass without asking.';

/** The infrastructure claim, in owner language. */
export const SERVERLESS = {
  title: 'Nothing to babysit',
  body: 'What I build runs serverless. There is no server to patch or resize, and a traffic spike is not a migration project.',
};

export const WHO = 'For business owners who need software work done, not a development team to manage.';

/*
 * The buyer's case: the alternatives a business owner is really weighing, and
 * the honest difference. Each line must stay true of the service as it runs.
 */
export const WHY_NOT = [
  {
    instead: 'vibe coding it yourself',
    answer: `Do — most of it. When it stalls at the last mile, send me that part. A one-minute fix is ${QUICK_FIX} of my time, and you never wait for a quote.`,
  },
  {
    instead: 'a ChatGPT subscription',
    answer:
      'It writes code. It does not put it in your project, run it, or answer for it. Here the agent does the typing and a developer approves the job before it starts and checks it before you see it.',
  },
  {
    instead: 'a freelancer or an agency',
    answer: `No quote, no call, no minimum invoice. A small fix does not wait until it is worth someone's afternoon: it is ${QUICK_FIX} of my time.`,
  },
  {
    instead: 'the cheapest developer you can find',
    answer: 'On small jobs this is cheaper, because the agent does the hours and you pay for my minutes. And the person who signs off is the one you write to.',
  },
];

/** What keeps it safe, in owner language: each line is something the system enforces. */
export const SAFEGUARDS = [
  'Nothing starts until I approve the request.',
  'The agent works on a sealed copy of your project. It cannot publish, deploy, or touch anything live.',
  'Set a budget and I will not pass it without asking.',
  'If a machine stops mid-job, the job goes back in the queue instead of stalling.',
  'Every message, change and decision is in one thread you can read.',
];
