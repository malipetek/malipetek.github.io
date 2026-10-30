import assert from 'node:assert/strict';
import test from 'node:test';
import { CATEGORIES, queryFor, sitesFrom } from './osm.mjs';

test('query: scoped to the area, only elements that carry a site or an address', () => {
  const query = queryFor(['craft', 'plumber'], { area: 'US', limit: 500 });
  assert.match(query, /area\["ISO3166-1"="US"\]->\.a;/);
  assert.match(query, /nwr\(area\.a\)\["craft"="plumber"\]\["website"\]/);
  assert.match(query, /\["contact:website"\]/);
  assert.match(query, /\["contact:email"\]/);
  assert.match(query, /out tags 500;/);
});

test('query: a bounding box replaces the area lookup', () => {
  const query = queryFor(['shop', 'florist'], { bbox: '39.6,-105.1,39.8,-104.8' });
  assert.doesNotMatch(query, /ISO3166/);
  assert.match(query, /nwr\(39\.6,-105\.1,39\.8,-104\.8\)\["shop"="florist"\]/);
});

test('sites: the tagged website, its host, and the address a mapper recorded', () => {
  const elements = [
    { tags: { name: 'Rosa Florist', website: 'https://rosas.co.uk', email: 'Orders@Rosas.co.uk', 'addr:city': 'Leeds' } },
    { tags: { name: 'Acme Plumbing', 'contact:website': 'acmeplumbing.com' } },
    { tags: { name: 'No site' } },
  ];
  assert.deepEqual(sitesFrom(elements, 'florist'), [
    { name: 'Rosa Florist', category: 'florist', site: 'https://rosas.co.uk/', host: 'rosas.co.uk', email: 'orders@rosas.co.uk', city: 'Leeds' },
    { name: 'Acme Plumbing', category: 'florist', site: 'https://acmeplumbing.com/', host: 'acmeplumbing.com', email: '', city: '' },
  ]);
});

test('sites: socials and site builders are dropped, because they are not the business', () => {
  const elements = [
    { tags: { website: 'https://www.facebook.com/rosasflorist' } },
    { tags: { website: 'https://rosasflorist.wixsite.com/home' } },
    { tags: { website: 'https://rosasflorist.square.site/' } },
    { tags: { website: 'not a url at all' } },
    { tags: { website: 'https://rosasflorist.wixsite.com/home' } },
  ];
  assert.deepEqual(sitesFrom(elements, 'florist'), []);
});

test('categories: every one is an OSM key/value pair of a local business', () => {
  for (const [name, pair] of Object.entries(CATEGORIES)) {
    assert.equal(pair.length, 2, name);
    assert.ok(pair.every((part) => /^[a-z:_]+$/.test(part)), name);
  }
  assert.deepEqual(CATEGORIES.plumber, ['craft', 'plumber']);
});
