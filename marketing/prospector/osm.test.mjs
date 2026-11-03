import assert from 'node:assert/strict';
import test from 'node:test';
import { CATEGORIES, categoryOf, oplTags, queryFor, sitesFrom, sitesFromOpl } from './osm.mjs';

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

test('opl: tags come out of one export line, percent-decoded', () => {
  assert.deepEqual(
    oplTags('n123 v2 dV c1 t2020-01-01T00:00:00Z Tname=Rosa%20%Florist,shop=florist,website=https://rosas.co.uk'),
    { name: 'Rosa Florist', shop: 'florist', website: 'https://rosas.co.uk' },
  );
  assert.equal(oplTags('n1 v2 dV c1'), null);
});

test('opl: escaped bytes arrive wrapped in percent signs, not as URI escapes', () => {
  const line = 'n1 v1 dV c0 t i0 u Tname=King%20%Soopers%2c%%20%Inc,shop=supermarket,addr:street=Table%20%Mesa%20%Drive,name:en=100%25%';
  assert.deepEqual(oplTags(line), {
    name: 'King Soopers, Inc',
    shop: 'supermarket',
    'addr:street': 'Table Mesa Drive',
    'name:en': '100%',
  });
});

test('opl: only the wanted categories, and only the ones with a site', () => {
  const text = [
    'n1 v2 dV Tcraft=plumber,website=https://acmeplumbing.com',
    'n2 v2 dV Tshop=florist,contact:website=rosas.co.uk',
    'n3 v2 dV Tshop=clothes,website=https://notours.example',
    'n4 v2 dV Tcraft=plumber',
    '',
  ].join('\n');
  assert.deepEqual(
    sitesFromOpl(text).map((site) => [site.host, site.category]),
    [
      ['acmeplumbing.com', 'plumber'],
      ['rosas.co.uk', 'florist'],
    ],
  );
  assert.deepEqual(sitesFromOpl(text, ['plumber']).map((site) => site.host), ['acmeplumbing.com']);
});

test('category: the first known key/value wins, unknown trades are ignored', () => {
  assert.equal(categoryOf({ craft: 'plumber', name: 'X' }), 'plumber');
  assert.equal(categoryOf({ shop: 'clothes' }), null);
  assert.equal(categoryOf({}), null);
});
