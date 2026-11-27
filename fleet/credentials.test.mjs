import test from 'node:test';
import assert from 'node:assert/strict';
import { credentialSection, deploySection } from './prompt.mjs';
import { runEnv } from './executors.mjs';
import { passEnvNames } from '../packages/dsh-external-agents/index.js';

const integrations = [{ id: 'aws', label: 'Amazon Web Services', names: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] }];

test('the prompt names the client accounts and the rules, never values', () => {
  const text = credentialSection(integrations);
  assert.match(text, /Amazon Web Services: \$AWS_ACCESS_KEY_ID, \$AWS_SECRET_ACCESS_KEY/);
  assert.match(text, /Never print, echo, log or commit them/);
  assert.match(text, /explicitly approves/);
  assert.doesNotMatch(text, /super-secret/);
  assert.equal(credentialSection([]), '');
});

test('credentials go into the child environment only, named for the Harness', () => {
  const before = { ...process.env };
  const env = runEnv({ AWS_SECRET_ACCESS_KEY: 'super-secret', AWS_ACCESS_KEY_ID: 'AKIA' });
  assert.equal(env.AWS_SECRET_ACCESS_KEY, 'super-secret');
  assert.equal(env.DSH_PASS_ENV, 'AWS_SECRET_ACCESS_KEY,AWS_ACCESS_KEY_ID');
  assert.equal(process.env.AWS_SECRET_ACCESS_KEY, before.AWS_SECRET_ACCESS_KEY);
  assert.equal(process.env.DSH_PASS_ENV, before.DSH_PASS_ENV);
  assert.equal(runEnv(undefined).DSH_PASS_ENV, process.env.DSH_PASS_ENV);
});

test('the external-agents pass list takes plain names and never routing keys', () => {
  assert.deepEqual(passEnvNames('AWS_ACCESS_KEY_ID, bad-name ,ANTHROPIC_BASE_URL,AWS_ACCESS_KEY_ID'), ['AWS_ACCESS_KEY_ID']);
  assert.deepEqual(passEnvNames(undefined), []);
});

test('a chosen Cloudflare target tells the agent where previews and production go', () => {
  const env = { CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a', PTECH_DEPLOY_KIND: 'pages', PTECH_DEPLOY_NAME: 'petekkoleji', PTECH_DEPLOY_PRODUCTION_BRANCH: 'main' };
  const text = deploySection(env);
  assert.match(text, /Pages project `petekkoleji`/);
  assert.match(text, /--project-name petekkoleji --branch <this ticket's branch>/);
  assert.match(text, /--branch main` only when the ticket says to publish/);
  assert.equal(deploySection({ PTECH_DEPLOY_NAME: 'x' }), '');
  assert.equal(deploySection({}), '');
});

test('a provider-built target tells the agent to push the branch, never to run wrangler', () => {
  // No CLOUDFLARE_API_TOKEN in the env: the provider builds the repo itself.
  const env = { PTECH_DEPLOY_KIND: 'pages', PTECH_DEPLOY_NAME: 'petekkoleji', PTECH_DEPLOY_PRODUCTION_BRANCH: 'main', PTECH_DEPLOY_BUILDS: 'provider' };
  const text = deploySection(env);
  assert.match(text, /Pages project `petekkoleji`.*builds itself from the connected Git repository/);
  assert.match(text, /push it to origin/);
  assert.match(text, /<branch-slug>\.petekkoleji\.pages\.dev/);
  assert.match(text, /Do not merge into or push to main yourself unless the ticket says to publish/);
  assert.match(text, /Do not run wrangler/);
  assert.doesNotMatch(text, /wrangler pages deploy|wrangler deploy|CLOUDFLARE_API_TOKEN/);
  // A Workers target has no pages.dev preview URL to name.
  const worker = deploySection({ PTECH_DEPLOY_KIND: 'workers', PTECH_DEPLOY_NAME: 'mailer', PTECH_DEPLOY_BUILDS: 'provider' });
  assert.match(worker, /Cloudflare Worker `mailer`.*builds itself from the connected Git repository/);
  assert.doesNotMatch(worker, /pages\.dev/);
  // A stray token must not pull a provider target back to wrangler either.
  const withToken = deploySection({ ...env, CLOUDFLARE_API_TOKEN: 't' });
  assert.match(withToken, /Do not run wrangler/);
});
