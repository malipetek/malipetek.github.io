import assert from 'node:assert/strict';
import test from 'node:test';
import { allowed, emailsIn, parseRobots, robotsFor, titleOf, urlsFrom } from './extract.mjs';

const rules = (text, agent = 'MalipetekProspector') => robotsFor(parseRobots(text), agent);

test('robots: the group naming us wins over the wildcard', () => {
  const robots = rules(`
User-agent: *
Disallow: /

User-agent: MalipetekProspector
Disallow: /admin
`);
  assert.equal(allowed(robots, '/contact'), true);
  assert.equal(allowed(robots, '/admin/panel'), false);
});

test('robots: the longest matching rule decides, and Allow wins a tie', () => {
  const robots = rules(`
User-agent: *
Disallow: /shop
Allow: /shop/contact
Disallow: /shop/contact/private
`);
  assert.equal(allowed(robots, '/shop/cart'), false);
  assert.equal(allowed(robots, '/shop/contact'), true);
  assert.equal(allowed(robots, '/shop/contact/private/1'), false);
  assert.equal(allowed(robots, '/about'), true);
});

test('robots: wildcards and the end anchor', () => {
  const robots = rules(`
User-agent: *
Disallow: /*.pdf$
Disallow: /search?
`);
  assert.equal(allowed(robots, '/menu.pdf'), false);
  assert.equal(allowed(robots, '/menu.pdf.html'), true);
  assert.equal(allowed(robots, '/search?q=x'), false);
});

test('robots: no robots.txt means no rules, not no access', () => {
  assert.equal(allowed(rules('', 'x'), '/anything'), true);
});

test('robots: crawl-delay is kept from the applicable group', () => {
  const robots = rules('User-agent: *\nCrawl-delay: 4\nDisallow: /x\n');
  assert.equal(robots.delay, 4);
});

test('emails: the business domain wins over the agency that built the site', () => {
  const html = `
    <p>Write to <a href="mailto:info@acme-bakery.com">info@acme-bakery.com</a></p>
    <p>Site by <a href="mailto:hello@studio.dev">hello@studio.dev</a></p>`;
  assert.deepEqual(
    emailsIn(html, 'https://www.acme-bakery.com/contact').map((e) => e.email),
    ['info@acme-bakery.com'],
  );
});

test('emails: obfuscated entities, percent-encoding and trailing punctuation', () => {
  const html = '<a href="mailto:orders&#64;rosas.co.uk?subject=Hi">mail</a> <p>Or orders@rosas.co.uk.</p>';
  const found = emailsIn(html, 'https://rosas.co.uk/');
  assert.deepEqual(found.map((e) => e.email), ['orders@rosas.co.uk']);
});

test('emails: role and asset addresses are dropped', () => {
  const html = `
    <img src="/logo@2x.png" alt="logo@2x.png">
    <a href="mailto:no-reply@acme.com">no reply</a>
    <a href="mailto:hello@sentry.io">sentry</a>
    <a href="mailto:team@acme.com">team</a>`;
  assert.deepEqual(emailsIn(html, 'https://acme.com/').map((e) => e.email), ['team@acme.com']);
});

test('emails: the same address twice is one contact', () => {
  const html = '<a href="mailto:info@acme.com">info@acme.com</a><p>info@acme.com</p>';
  assert.equal(emailsIn(html, 'https://acme.com/').length, 1);
});

test('emails: a directory page can ask for every address instead of its own', () => {
  const html = '<p>info@directory.example</p><p>hello@acme.example</p>';
  const page = 'https://directory.example/members/acme';
  assert.deepEqual(emailsIn(html, page).map((e) => e.email), ['info@directory.example']);
  assert.deepEqual(emailsIn(html, page, { preferOwn: false }).map((e) => e.email), [
    'info@directory.example',
    'hello@acme.example',
  ]);
});

test('title: og:site_name, else the first part of the title', () => {
  assert.equal(titleOf('<meta property="og:site_name" content="Rosa Florist"><title>Rosa — Home</title>'), 'Rosa Florist');
  assert.equal(titleOf('<title>Rosa Florist | Flowers in Leeds</title>'), 'Rosa Florist');
  assert.equal(titleOf('<title>Rosa Florist</title>'), 'Rosa Florist');
  assert.equal(titleOf('<title>Ed Oddy &#124; Studio</title>'), 'Ed Oddy');
  assert.equal(titleOf('<title>Hoblyn &amp; White &#8211; Garden Design</title>'), 'Hoblyn & White');
});

test('urls: comments and blanks go, a missing scheme is added', () => {
  assert.deepEqual(urlsFrom('# bakery sites\nacme.com/contact\n\nhttps://rosas.co.uk\nacme.com/contact # again'), [
    'https://acme.com/contact',
    'https://rosas.co.uk',
  ]);
});
