import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITY_CATALOG } from '../src/queue.ts';
import {
  SOLUTION_CATALOG, INTEGRATION_CATALOG, parseSolutions, cleanSolutions,
  requiresFor, integrationsFor, integrationStatus, fieldBelongs,
} from '../src/solutions.ts';
import * as ui from '../../packages/admin-ui/src/solutions.js';

test('solutions and integrations match the UI catalog and refer to known capabilities', () => {
  assert.deepEqual(SOLUTION_CATALOG, ui.SOLUTION_CATALOG);
  assert.deepEqual(INTEGRATION_CATALOG, ui.INTEGRATION_CATALOG);
  const capabilityIds = new Set(CAPABILITY_CATALOG.map(c => c.id));
  const integrationIds = new Set(INTEGRATION_CATALOG.map(i => i.id));
  assert.equal(SOLUTION_CATALOG.length, 10);
  assert.equal(integrationIds.size, 9);
  for (const solution of SOLUTION_CATALOG) {
    assert.ok(solution.requires.every(id => capabilityIds.has(id)));
    assert.ok(solution.integrations.every(i => integrationIds.has(i.id)));
    assert.ok(solution.questions.length >= 3 && solution.questions.length <= 5);
  }
});

test('stored solutions accept only known, distinct IDs, in input order', () => {
  assert.deepEqual(cleanSolutions(['web', false, 'unknown', 'shopify', 'web', 'constructor']), ['web', 'shopify']);
  assert.deepEqual(cleanSolutions('web'), []);
  assert.deepEqual(parseSolutions('["server","web","server"]'), ['server', 'web']);
  for (const input of [null, undefined, '{', 'null', '"web"', '{}']) assert.deepEqual(parseSolutions(input), []);
  assert.equal(cleanSolutions(SOLUTION_CATALOG.map(s => s.id).concat('web')).length, 10);
});

test('solution requirements and integrations are unions; required takes precedence', () => {
  assert.deepEqual(requiresFor(['mobile-ios', 'app-release', 'mobile-android', 'server']), ['os:macos', 'xcode', 'android', 'docker']);
  for (const input of [['mobile-cross', 'app-release'], ['app-release', 'mobile-cross']]) {
    const result = new Map(integrationsFor(input).map(i => [i.id, i.optional]));
    assert.equal(result.size, 3);
    assert.equal(result.get('expo'), true);
    assert.equal(result.get('app-store-connect'), false);
    assert.equal(result.get('google-play'), false);
  }
});

test('integration status lists only missing required names', () => {
  const integration = INTEGRATION_CATALOG.find(i => i.id === 'shopify')!;
  assert.deepEqual(integrationStatus(integration, new Set(['SHOPIFY_STORE_DOMAIN'])), {
    connected: false, missing: ['SHOPIFY_ADMIN_TOKEN'],
  });
  assert.deepEqual(integrationStatus(integration, ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_TOKEN']), {
    connected: true, missing: [],
  });
  assert.equal(fieldBelongs('shopify', 'SHOPIFY_STOREFRONT_TOKEN'), true);
  assert.equal(fieldBelongs('shopify', 'ASC_KEY_ID'), false);
  assert.equal(fieldBelongs('shopify', '__proto__'), false);
  assert.equal(fieldBelongs('fake', 'SHOPIFY_ADMIN_TOKEN'), false);
});
