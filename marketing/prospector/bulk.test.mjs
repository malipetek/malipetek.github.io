import assert from 'node:assert/strict';
import test from 'node:test';
import {
  askJev,
  businessName,
  collectOne,
  contactUrlIn,
  descriptionOf,
  domainsIn,
  headingsIn,
  keep,
  pick,
  rowFor,
} from './bulk.mjs';

test('domains: Tranco ranks, plain lines, FDNS JSONL and comments', () => {
  const text = [
    '# rank,domain',
    '1,google.com',
    '312345,www.acmeplumbing.com',
    '15,google.com',
    '{"name":"rosas.co.uk","type":"mx"}',
    '{"name":"bad domain","type":"a"}',
    '',
    'not a domain',
    'singleword',
    'https://fallback.example.com/contact',
  ].join('\n');
  assert.deepEqual(domainsIn(text), [
    { rank: 1, domain: 'google.com' },
    { rank: 312345, domain: 'acmeplumbing.com' },
    { rank: null, domain: 'rosas.co.uk' },
    { rank: null, domain: 'fallback.example.com' },
  ]);
});

test('pick: rank window, TLD filter and limit', () => {
  const rows = [
    { rank: 10, domain: 'a.com' },
    { rank: 200, domain: 'b.co.uk' },
    { rank: 300, domain: 'c.us' },
    { rank: 400, domain: 'd.net' },
  ];
  assert.deepEqual(pick(rows, { rankFrom: 200, rankTo: 399 }).map((r) => r.domain), ['b.co.uk', 'c.us']);
  assert.deepEqual(pick(rows, { tlds: new Set(['com', 'us']) }).map((r) => r.domain), ['a.com', 'c.us']);
  assert.equal(pick(rows, { limit: 2 }).length, 2);
});

test('business name: og:site_name wins, a generic first segment is skipped', () => {
  assert.equal(businessName('<meta property="og:site_name" content="Rosa Florist"><title>Rosa — Home</title>'), 'Rosa Florist');
  assert.equal(businessName('<title>Home | Acme Plumbing</title>'), 'Acme Plumbing');
  assert.equal(businessName('<title>Acme Plumbing | Denver, CO</title>'), 'Acme Plumbing');
});

test('description and headings are read as plain text', () => {
  assert.equal(
    descriptionOf('<meta name="description" content="Plumbing &amp; heating in Denver">'),
    'Plumbing & heating in Denver',
  );
  assert.equal(
    headingsIn('<h1>Emergency plumbing</h1><h2>Same-day repairs</h2><h1>Emergency plumbing</h1>'),
    'Emergency plumbing · Same-day repairs',
  );
});

test('contact link: first same-host contact page, never mailto or another host', () => {
  const html = `
    <a href="mailto:hi@acme.com">Mail</a>
    <a href="https://facebook.com/acme/contact">Facebook</a>
    <a href="/about">About</a>
    <a href="/contact-us#form">Contact</a>
    <a href="/get-in-touch">Reach us</a>`;
  assert.equal(contactUrlIn(html, 'https://acme.com/'), 'https://acme.com/contact-us');
  assert.equal(contactUrlIn('<a href="/about">About</a>', 'https://acme.com/'), null);
});

const page = (url, html) => async (asked) =>
  asked === url ? { html, url, title: businessName(html), skipped: null } : { skipped: 'http_404' };

test('collect: an address on the homepage needs no second request', async () => {
  const read = page('https://acme.com/', '<title>Acme Plumbing</title><p>Email office@acme.com</p>');
  const record = await collectOne('acme.com', { read });
  assert.equal(record.skipped, null);
  assert.equal(record.emails[0].email, 'office@acme.com');
  assert.equal(record.email_page, 'https://acme.com/');
  assert.equal(record.business, 'Acme Plumbing');
});

test('collect: no homepage address falls through to the contact page', async () => {
  const asked = [];
  const read = async (url) => {
    asked.push(url);
    if (url === 'https://acme.com/') {
      return { html: '<title>Home | Acme Plumbing</title><a href="/contact">Contact</a>', url, skipped: null };
    }
    return { html: '<p>dispatch@acme.com</p>', url, skipped: null };
  };
  const record = await collectOne('acme.com', { read });
  assert.deepEqual(asked, ['https://acme.com/', 'https://acme.com/contact']);
  assert.equal(record.emails[0].email, 'dispatch@acme.com');
  assert.equal(record.email_page, 'https://acme.com/contact');
});

test('collect: parked pages and empty pages are dropped', async () => {
  const parked = await collectOne('acme.com', {
    read: page('https://acme.com/', '<title>acme.com</title><p>This domain is for sale. hello@acme.com</p>'),
  });
  assert.equal(parked.skipped, 'parked');

  const empty = await collectOne('acme.com', { read: page('https://acme.com/', '<title>Acme</title><p>No address here</p>') });
  assert.equal(empty.skipped, 'no_email');

  const gone = await collectOne('acme.com', { read: async () => ({ skipped: 'http_404' }) });
  assert.equal(gone.skipped, 'http_404');
});

const jevReply = {
  model: 'jev-1.14.0',
  answers: {
    small_business: { type: 'noul', noul: 0.92 },
    us_based: { type: 'noul', noul: 0.81 },
    sector: { type: 'choice', choice: 'home_services', confidence: 0.7 },
  },
  usage: { input_tokens: 400, output_tokens: 6 },
};

const okReply = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });

test('jev: one request, three questions, answers read back under their ids', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return okReply(jevReply);
  };
  const record = {
    domain: 'acme.com',
    business: 'Acme Plumbing',
    description: 'Plumber in Denver',
    headings: 'Emergency plumbing',
    text: 'Same-day repairs across Denver.',
  };
  const verdict = await askJev(record, { apiKey: 'k', fetchImpl });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(calls[0].init.headers.authorization, 'Bearer k');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'jev-latest');
  assert.deepEqual(Object.keys(body.questions), ['small_business', 'us_based', 'sector']);
  assert.equal(body.state.title, 'Acme Plumbing');

  assert.equal(verdict.smallBusiness, 0.92);
  assert.equal(verdict.usBased, 0.81);
  assert.equal(verdict.sector, 'home_services');
});

test('jev: 429 backs off and retries, a hard error throws', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1 ? { ok: false, status: 429, text: async () => 'slow down' } : okReply(jevReply);
  };
  const verdict = await askJev({ domain: 'a.com' }, { apiKey: 'k', fetchImpl, backoffMs: 0 });
  assert.equal(calls, 2);
  assert.equal(verdict.smallBusiness, 0.92);

  await assert.rejects(
    askJev({ domain: 'a.com' }, { apiKey: 'bad', fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'no key' }) }),
    /typesafe 401/,
  );
});

test('jev: control characters and lone surrogates are cleaned out of the state', async () => {
  let sent;
  const fetchImpl = async (_url, init) => {
    sent = JSON.parse(init.body);
    return okReply(jevReply);
  };
  await askJev(
    { domain: 'a.com', business: 'Acme\u0007', description: 'bad \ud800 pair', headings: '', text: 'line\u0000one' },
    { apiKey: 'k', fetchImpl },
  );
  assert.equal(sent.state.title, 'Acme');
  assert.equal(sent.state.description, 'bad \uFFFD pair');
  assert.equal(sent.state.text, 'line one');
});

test('keep: both thresholds and a real sector', () => {
  const gate = { minSmall: 0.7, minUs: 0.6 };
  assert.equal(keep({ smallBusiness: 0.7, usBased: 0.6, sector: 'retail' }, gate), true);
  assert.equal(keep({ smallBusiness: 0.69, usBased: 0.9, sector: 'retail' }, gate), false);
  assert.equal(keep({ smallBusiness: 0.9, usBased: 0.2, sector: 'retail' }, gate), false);
  assert.equal(keep({ smallBusiness: 0.9, usBased: 0.9, sector: 'not_a_business' }, gate), false);
});

test('row: desk column order, the address page as evidence, no gap', () => {
  const record = {
    domain: 'acme.com',
    url: 'https://www.acme.com/',
    business: 'Acme Plumbing',
    emails: [{ email: 'office@acme.com', how: 'mailto' }],
    email_page: 'https://www.acme.com/contact',
  };
  const row = rowFor(record, { smallBusiness: 0.92, usBased: 0.81, sector: 'home_services' }, 312345);
  assert.equal(row.length, 8);
  assert.deepEqual(row.slice(0, 7), ['office@acme.com', '', 'Acme Plumbing', 'https://www.acme.com', 'https://www.acme.com/contact', '', 'legitimate_interest']);
  assert.match(row[7], /rank 312345/);
  assert.match(row[7], /home_services/);
});
