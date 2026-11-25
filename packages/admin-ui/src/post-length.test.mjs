import assert from 'node:assert/strict';
import test from 'node:test';

import { POST_MAX, SITE_LINK, hasLink, postLength, postMax, withSiteLink } from './post-length.js';

test('plain text counts as its own length on every channel', () => {
  assert.equal(postLength('Hello there', 'x'), 11);
  assert.equal(postLength('Hello there', 'linkedin'), 11);
  assert.equal(postLength(null, 'x'), 0);
});

test('X counts a long link as 23, not as its address', () => {
  const long = 'Read this https://ptechsolutions.net/guides/a-very-long-path-that-runs-on';
  assert.equal(postLength(long, 'x'), 'Read this '.length + 23);
  assert.equal(postLength(long, 'linkedin'), long.length);
});

test('a link shorter than 23 counts as itself', () => {
  assert.equal(postLength('https://a.co', 'x'), 12);
});

test('the limits are the networks own', () => {
  assert.deepEqual(POST_MAX, { x: 280, linkedin: 3000 });
});

test('the limit comes from one table, with LinkedIn as the fallback',()=>{
  assert.equal(postMax('x'), 280);
  assert.equal(postMax('linkedin'), 3000);
  assert.equal(postMax('threads'), 3000);
});

test('a post without a link gets the site link on its own line', () => {
  assert.equal(hasLink('Vibe contracting for business owners.'), false);
  assert.equal(withSiteLink('Vibe contracting for business owners.  ', 'x'), `Vibe contracting for business owners.\n\n${SITE_LINK}`);
  assert.equal(hasLink(withSiteLink('x', 'linkedin')), true);
});

test('a post that already links is left alone', () => {
  const body = 'Read how we work: https://ptechsolutions.net/how-we-work';
  assert.equal(withSiteLink(body, 'x'), body);
});

test('the link is only added when it still fits, counted the way X counts', () => {
  const near = 'a'.repeat(255); // 255 + 2 newlines + 23 for the link = 280
  assert.equal(postLength(withSiteLink(near, 'x'), 'x'), 280);
  assert.equal(withSiteLink('a'.repeat(256), 'x'), null);
});
