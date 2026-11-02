#!/usr/bin/env node
/*
 * Refuse a deploy from a laptop.
 *
 * master deploys in .github/workflows/deploy.yml. This hook exists so the
 * documented commands (`pnpm deploy`, `pnpm --dir worker deploy`) cannot
 * quietly ship a dirty working folder or another agent's half-done branch.
 *
 * CI sets CI=true. A genuine emergency can opt out with ALLOW_LOCAL_DEPLOY=1,
 * which should be rare enough to be memorable.
 */
const allowed = process.env.CI === 'true' || process.env.ALLOW_LOCAL_DEPLOY === '1';
if (allowed) process.exit(0);

console.error(`
Deploys run from git, not from this folder.

  1. Commit your work on a branch and push it.
  2. Merge (or open a PR) into master.
  3. GitHub Actions runs the tests, applies migrations, and deploys
     the intercom Worker, the site Worker and malipetek-sites with BUILD_SHA.

Nothing is deployed from a laptop. If you truly must break glass:
  ALLOW_LOCAL_DEPLOY=1 pnpm deploy
`);
process.exit(1);
