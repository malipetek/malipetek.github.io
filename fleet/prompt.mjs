/*
 * The prompt a node gives an agent for one run. Kept apart from node.mjs so
 * it can be tested without starting a node.
 */

/**
 * The prompt for one run. A ticket is a conversation, and a run is usually a
 * follow-up: what matters is the newest instruction, read against what was
 * asked before and what earlier runs already did. So the thread is split at
 * the last run — everything before it is background, everything after it is
 * what to do now — and earlier runs are summarised in between. Flattening it
 * all into one block (as this did before) made "now change the logo" read as
 * one more line of the original task, and every run redid the first one.
 */
/** The dollars a run may spend on AI, as the claim knows it. */
const usd = (value) => `$${Number(value).toFixed(2)}`;

/**
 * What the run may spend, and what a first preview is. The node caps the
 * executor too (maxBudgetUsd); saying it in the prompt is what makes the agent
 * aim at the ceiling instead of being cut off by it.
 */
function budgetLines(ticket) {
  const lines = [];
  if (typeof ticket.budget_usd_left === 'number') {
    lines.push(
      `## Budget\n\nThis run has ${usd(ticket.budget_usd_left)} of AI to spend. Work to it: do the job in the fewest steps that do it well, and stop when it is spent rather than starting something new.`,
    );
  }
  if (ticket.first_preview === 1) {
    lines.push(
      "## First preview\n\nThis is the account's free first preview: build a rough first version that shows the shape of the thing, on the preview only. Nothing is published. Placeholders are fine where the client has not decided yet, and Ali checks the work before anything goes live.",
    );
  }
  return lines;
}

export function buildPrompt(ticket, messages, previousRuns = [], checkout = {}) {
  const guard = (text) => text.replaceAll('</client_request>', '<\\/client_request>');
  const isClient = ticket.kind === 'client';
  const lastRunAt = previousRuns.reduce((t, r) => Math.max(t, r.finished_at ?? 0), 0);
  const before = messages.filter((m) => (m.created_at ?? 0) <= lastRunAt);
  const now = messages.filter((m) => (m.created_at ?? 0) > lastRunAt);
  const who = (m) => (m.author === 'client' ? 'client' : 'Ali');
  // Files sent with a message are in the checkout (fleet/node.mjs ATTACH_DIR).
  const files = (m) => (m.attachedPaths?.length ? `\n(Attached, readable in this checkout: ${m.attachedPaths.join(', ')})` : '');
  const line = (m) => `[${who(m)}]\n${m.author === 'client' ? guard(m.body + files(m)) : m.body + files(m)}`;
  // Client words always sit inside <client_request>, the marker the system
  // prompt tells the agent to treat as untrusted. Ali's words never do.
  const block = (list) =>
    isClient ? `<client_request>\n${list.map(line).join('\n\n')}\n</client_request>` : list.map(line).join('\n\n');

  const parts = [`${isClient ? 'Ticket' : 'Task'} #${ticket.id}: ${ticket.title}`];
  if (previousRuns.length) {
    if (before.length) parts.push(`## Background: what was asked before\n\n${block(before)}`);
    parts.push(
      `## What earlier runs did (summaries written by the agent)\n\n` +
        previousRuns
          .map((r) => `- Run ${r.id} (${r.executor}${r.node_id ? ` on ${r.node_id}` : ''}, ${r.status}${r.branch ? `, branch ${r.branch}` : ''}):\n  ${(r.summary || 'no summary').trim().replace(/\n+/g, '\n  ')}`)
          .join('\n'),
    );
    parts.push(
      checkout.continuedFrom
        ? `This checkout continues from ${checkout.continuedFrom}: the earlier work is already in these files. Build on it; do not redo it.`
        : checkout.elsewhere
          ? `The earlier work is on another machine (${checkout.elsewhere}) and is NOT in this checkout. Do only what is asked now, unless it depends on that work — then say so instead of redoing it.`
          : 'This checkout starts from the base branch; earlier runs\' changes are not in it.',
    );
    parts.push(
      now.length
        ? `## Do this now\n\nThe newest instruction. It is a follow-up: do what it asks, using the background only for context. Do not redo earlier work unless it says to.\n\n${block(now)}`
        : '## Do this now\n\nNothing new was written since the last run. Finish the task, picking up where the last run left off: fix what it reported as failed or unfinished.',
    );
  } else {
    parts.push(block(messages));
  }
  parts.push(...budgetLines(ticket));
  parts.push(isClient ? 'Work in this repository, following the rules in your system prompt.' : 'Do the task in this repository.');
  return parts.join('\n\n');
}

/**
 * The next turn when a rerun continues its ticket's own conversation
 * (fleet/node.mjs `resumableSession`): the thread already holds the request,
 * the background and every earlier answer, so this says only what is new and
 * where the checkout stands.
 */
export function buildFollowUp(ticket, messages, previousRuns = [], checkout = {}) {
  const guard = (text) => text.replaceAll('</client_request>', '<\\/client_request>');
  const isClient = ticket.kind === 'client';
  const lastRunAt = previousRuns.reduce((t, r) => Math.max(t, r.finished_at ?? 0), 0);
  const now = messages.filter((m) => (m.created_at ?? 0) > lastRunAt);
  const who = (m) => (m.author === 'client' ? 'client' : 'Ali');
  const files = (m) => (m.attachedPaths?.length ? `\n(Attached, readable in this checkout: ${m.attachedPaths.join(', ')})` : '');
  const line = (m) => `[${who(m)}]\n${m.author === 'client' ? guard(m.body + files(m)) : m.body + files(m)}`;
  const block = (list) =>
    isClient ? `<client_request>\n${list.map(line).join('\n\n')}\n</client_request>` : list.map(line).join('\n\n');

  const parts = [`${isClient ? 'Ticket' : 'Task'} #${ticket.id} is running again, in a fresh checkout.`];
  parts.push(
    checkout.continuedFrom
      ? `It continues from ${checkout.continuedFrom}: your earlier work is already in these files. Build on it; do not redo it.`
      : checkout.elsewhere
        ? `Your earlier work is on another machine (${checkout.elsewhere}) and is NOT in this checkout. Do only what is asked now, unless it depends on that work — then say so instead of redoing it.`
        : 'It starts from the base branch: your earlier changes are not in it.',
  );
  parts.push(
    now.length
      ? `New since your last answer:\n\n${block(now)}\n\nDo what it asks. Do not redo earlier work unless it says to.`
      : 'Nothing new was written since your last answer. Finish the task: fix what you reported as failed or unfinished.',
  );
  parts.push(...budgetLines(ticket));
  parts.push('The same rules apply as before: stay in this checkout, commit when your work is ready, and end with a short summary.');
  return parts.join('\n\n');
}

/**
 * The client accounts this run can use (fleet/node.mjs `fetchCredentials`):
 * names only, never values, with the rules for using them.
 * @param integrations - [{ id, label, names }] from /node/runs/:id/credentials.
 * @returns a prompt section, or '' when there are none.
 */
/**
 * Where this project's work goes live, when the admin chose a Cloudflare
 * target: previews from the ticket branch, production only from the
 * production branch. The target arrives in the run environment beside the
 * client's Cloudflare credential.
 * @param {Record<string,string>} env - the run's credential environment.
 * @returns {string} a prompt section, or '' with no target.
 */
export function deploySection(env = {}) {
  const name = env.PTECH_DEPLOY_NAME;
  if (!name) return '';
  const production = env.PTECH_DEPLOY_PRODUCTION_BRANCH || 'main';
  const pages = env.PTECH_DEPLOY_KIND !== 'workers';
  // The provider builds the connected Git repo itself: a run gets the target's
  // env but no deploy token, and a branch push is the deploy.
  if (env.PTECH_DEPLOY_BUILDS === 'provider') {
    return [
      '## Where this project goes live',
      `The site is the ${pages ? 'Cloudflare Pages project' : 'Cloudflare Worker'} \`${name}\`, which the provider builds itself from the connected Git repository — no deploy token is provided and none is needed.`,
      `- Preview: commit your work on this ticket's branch and push it to origin. The provider builds a preview for the branch automatically${pages ? ` — it appears at \`<branch-slug>.${name}.pages.dev\`` : ''}. Put the preview URL in your result.`,
      `- Production: the work goes live when it lands on \`${production}\`. Do not merge into or push to ${production} yourself unless the ticket says to publish.`,
      '- Do not run wrangler or any other deploy command: pushing the branch is the deploy.',
    ].join('\n');
  }
  if (!env.CLOUDFLARE_API_TOKEN) return '';
  return [
    '## Where this project goes live',
    pages
      ? `The site is the Cloudflare Pages project \`${name}\` in the client's account ($CLOUDFLARE_ACCOUNT_ID, token $CLOUDFLARE_API_TOKEN).`
      : `The site is the Cloudflare Worker \`${name}\` in the client's account ($CLOUDFLARE_ACCOUNT_ID, token $CLOUDFLARE_API_TOKEN).`,
    pages
      ? `- Preview: build, then \`npx wrangler pages deploy <build output> --project-name ${name} --branch <this ticket's branch>\`, and put the preview URL wrangler prints in your result.`
      : `- Preview: \`npx wrangler versions upload --name ${name}\` and put the preview URL it prints in your result.`,
    pages
      ? `- Production: deploy with \`--branch ${production}\` only when the ticket says to publish or the work lands on ${production}.`
      : `- Production: \`npx wrangler deploy --name ${name}\` only when the ticket says to publish or the work lands on ${production}.`,
    '- If a deploy is refused for a permission, say which one the client token needs; do not try another account or token.',
  ].join('\n');
}

export function credentialSection(integrations = []) {
  if (!integrations.length) return '';
  const list = integrations.map((i) => `- ${i.label}: ${i.names.map((n) => `$${n}`).join(', ')}`).join('\n');
  return [
    '## Client accounts connected for this project',
    'These environment variables hold credentials the client connected. Read them from the environment when a tool needs them:',
    list,
    'Rules:',
    "- Use them only for this ticket's project.",
    '- Never print, echo, log or commit them, and never write them into files in this repository (not even .env). Pass them to tools through the environment.',
    '- Prefer read-only actions unless the ticket asks for a change.',
    '- AWS, Google Cloud and servers: do not delete resources, scale up, buy anything or change billing unless the ticket explicitly approves it. Describe such steps in your result instead.',
    '- App Store and Google Play: submit a build for review only when the ticket says to submit.',
  ].join('\n');
}
