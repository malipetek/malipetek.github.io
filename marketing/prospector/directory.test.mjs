import assert from 'node:assert/strict';
import test from 'node:test';
import { addressOnHost, businessSite, crawl, isBusinessLink, linksIn, wanted } from './directory.mjs';

const page = (links, body = '') => `<html><body>${body}${links.map((href) => `<a href="${href}">x</a>`).join('')}</body></html>`;

test('linksIn keeps relative links, drops fragments and non-web schemes', () => {
  const html = page([
    '/members/acme',
    'members/bez/',
    '../about',
    '/search?q=plumber&amp;page=2',
    '#top',
    'mailto:info@acme.example',
    'tel:+441234567890',
    'javascript:void(0)',
    '/members/acme',
  ]);
  assert.deepEqual(linksIn(html, 'https://dir.example/list/'), [
    'https://dir.example/members/acme',
    'https://dir.example/list/members/bez/',
    'https://dir.example/about',
    'https://dir.example/search?q=plumber&page=2',
  ]);
});

test('wanted stays on the start host unless told otherwise', () => {
  const origins = new Set(['https://dir.example']);
  assert.equal(wanted('https://dir.example/members/acme', { origins }), true);
  assert.equal(wanted('https://acme.example/', { origins }), false);
  assert.equal(wanted('https://acme.example/', { origins, anyHost: true }), true);
});

test('wanted skips accounts, carts, files and social hosts', () => {
  const origins = new Set(['https://dir.example']);
  for (const href of [
    'https://dir.example/login',
    'https://dir.example/cart?item=1',
    'https://dir.example/wp-admin/',
    'https://dir.example/terms.pdf',
    'https://dir.example/logo.png',
    'https://dir.example/feed/',
    'https://dir.example/privacy-policy/',
    'https://dir.example/terms-and-conditions',
  ]) {
    assert.equal(wanted(href, { origins, anyHost: true }), false, href);
  }
  assert.equal(wanted('https://facebook.com/acme', { origins, anyHost: true }), false);
});

test('wanted obeys include and exclude', () => {
  const origins = new Set(['https://dir.example']);
  const include = /\/members\//;
  const exclude = /\/members\/advert/;
  assert.equal(wanted('https://dir.example/members/acme', { origins, include, exclude }), true);
  assert.equal(wanted('https://dir.example/about', { origins, include, exclude }), false);
  assert.equal(wanted('https://dir.example/members/advert', { origins, include, exclude }), false);
});

test('pagination query strings survive filtering', () => {
  const origins = new Set(['https://dir.example']);
  assert.equal(wanted('https://dir.example/members?page=4', { origins }), true);
  assert.equal(wanted('https://dir.example/members?replytocom=9', { origins }), false);
});

test('isBusinessLink rejects the directory, socials and maps', () => {
  const pageUrl = 'https://dir.example/members/acme';
  assert.equal(isBusinessLink('https://dir.example/members/bez', pageUrl), false);
  assert.equal(isBusinessLink('https://www.dir.example/', pageUrl), false);
  assert.equal(isBusinessLink('https://facebook.com/acme', pageUrl), false);
  assert.equal(isBusinessLink('https://business.facebook.com/acme', pageUrl), false);
  assert.equal(isBusinessLink('https://maps.google.co.uk/?q=acme', pageUrl), false);
  assert.equal(isBusinessLink('https://www.etsy.com/shop/acme', pageUrl), false);
  assert.equal(isBusinessLink('http://www.instagram', pageUrl), false);
  assert.equal(isBusinessLink('https://acme.file.force.com/doc', pageUrl), false);
  assert.equal(isBusinessLink('https://acme.example/contact', pageUrl), true);
});

test('links without a real domain are never business sites', () => {
  const pageUrl = 'https://dir.example/members/acme';
  assert.equal(isBusinessLink('http://directory/?keyword=x', pageUrl), false);
  assert.equal(wanted('http://directory/?keyword=x', { origins: new Set(['https://dir.example']), anyHost: true }), false);
});

test('businessSite takes the first real external site and falls back to the page', () => {
  const pageUrl = 'https://dir.example/members/acme';
  const links = ['https://dir.example/members/bez', 'https://instagram.com/acme', 'https://acme.example/contact'];
  assert.equal(businessSite(links, pageUrl), 'https://acme.example');
  assert.equal(businessSite(['https://instagram.com/acme'], pageUrl), 'https://dir.example');
});

test('crawl follows pagination to profile pages, then stops at the depth limit', async () => {
  const graph = {
    'https://dir.example/': page([
      '/members?page=2',
      '/members/acme',
      '/members/bez',
      '/login',
      'https://facebook.com/acme',
    ]),
    'https://dir.example/members?page=2': page(['/members/cy']),
    'https://dir.example/members/acme': page(
      ['https://acme.example/contact', 'https://acme.example/about', 'https://www.houzz.co.uk/pro/acme', '/members/acme/team'],
      '<p>info@acme.example</p>',
    ),
    'https://dir.example/members/bez': page(['https://bez.example'], '<p>Call us on 0123 456 7890.</p>'),
    'https://dir.example/members/cy': page(['https://cy.example'], '<p>hello@cy.example and info@acme.example</p>'),
    'https://dir.example/members/acme/team': page([]),
  };
  const visited = [];
  const read = async (url) => {
    visited.push(url);
    return { html: graph[url], url, title: 'Acme', skipped: null };
  };

  const result = await crawl(['https://dir.example/'], { read, maxDepth: 2, maxPages: 20 });

  assert.deepEqual(visited, [
    'https://dir.example/',
    'https://dir.example/members?page=2',
    'https://dir.example/members/acme',
    'https://dir.example/members/bez',
    'https://dir.example/members/cy',
    'https://dir.example/members/acme/team',
  ]);
  assert.equal(result.visited, 6);
  assert.deepEqual(
    result.rows.map((row) => row[0]),
    ['info@acme.example', 'hello@cy.example'],
  );
  assert.equal(result.rows[0][3], 'https://acme.example');
  assert.equal(result.rows[1][3], 'https://cy.example');
  assert.deepEqual([...result.sites].sort(), ['https://acme.example', 'https://bez.example', 'https://cy.example']);
  assert.equal(result.capped, false);
});

test('a shallow crawl does not leave the pages it started from', async () => {
  const graph = {
    'https://dir.example/': page(['/members?page=2']),
    'https://dir.example/members?page=2': page(['/members/cy']),
  };
  const read = async (url) => ({ html: graph[url], url, skipped: null });
  const result = await crawl(['https://dir.example/'], { read, maxDepth: 1 });
  assert.equal(result.visited, 2);
  assert.equal(result.rows.length, 0);
});

test('crawl drops the directory’s own inbox and keeps the member’s', async () => {
  const graph = {
    'https://dir.example/members/acme': page([], '<p>Questions? info@dir.example</p><p>Acme: hello@acme.example</p>'),
  };
  const read = async (url) => ({ html: graph[url], url, skipped: null });
  const result = await crawl(['https://dir.example/members/acme'], { read, maxDepth: 0 });
  assert.deepEqual(
    result.rows.map((row) => row[0]),
    ['hello@acme.example'],
  );
});

test('a redirected start host is still the directory', async () => {
  const read = async (url) => ({
    html: '<p>info@dir.example</p>',
    url: 'https://dir.example/members/acme',
    skipped: null,
  });
  const result = await crawl(['https://www.dir.example/members/acme'], { read, maxDepth: 0 });
  assert.equal(result.rows.length, 0);
});

test('addressOnHost matches the host and its subdomains only', () => {
  assert.equal(addressOnHost('info@dir.example', 'dir.example'), true);
  assert.equal(addressOnHost('info@mail.dir.example', 'dir.example'), true);
  assert.equal(addressOnHost('info@notdir.example', 'dir.example'), false);
  assert.equal(addressOnHost('info@dir.example.co.uk', 'dir.example'), false);
});

test('crawl records a robots refusal and does not follow that page', async () => {
  const read = async (url) =>
    url.endsWith('/blocked') ? { skipped: 'robots_disallowed' } : { html: page(['/blocked', '/ok']), url, skipped: null };
  const result = await crawl(['https://dir.example/'], { read, maxDepth: 2 });
  assert.equal(result.rows.length, 0);
  assert.equal(result.skips.get('robots_disallowed'), 1);
  assert.equal(result.visited, 3);
});

test('crawl stops at the page budget and says the queue was not empty', async () => {
  const read = async (url) => ({ html: page(['/members/1', '/members/2', '/members/3']), url, skipped: null });
  const result = await crawl(['https://dir.example/'], { read, maxDepth: 2, maxPages: 2 });
  assert.equal(result.visited, 2);
  assert.equal(result.capped, true);
});

test('crawl can cross onto member sites when allowed', async () => {
  const graph = {
    'https://dir.example/': page(['/members/acme']),
    'https://dir.example/members/acme': page(['https://acme.example/']),
    'https://acme.example/': page(['/contact'], '<p>shop@acme.example</p>'),
  };
  const read = async (url) => ({ html: graph[url], url, skipped: null });
  const result = await crawl(['https://dir.example/'], { read, anyHost: true, maxDepth: 2 });
  assert.equal(result.visited, 3);
  assert.deepEqual(
    result.rows.map((row) => row[0]),
    ['shop@acme.example'],
  );
});
