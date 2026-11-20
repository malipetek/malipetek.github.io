import test from 'node:test';
import assert from 'node:assert/strict';
import { credentialSection } from './prompt.mjs';
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
