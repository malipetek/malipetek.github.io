import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownBlocks, markdownInline } from './markdown.js';

test('paragraphs join soft lines and split on blank lines', () => {
  assert.deepEqual(markdownBlocks('one\ntwo\n\nthree'), [
    { type: 'paragraph', spans: [{ type: 'text', text: 'one two' }] },
    { type: 'paragraph', spans: [{ type: 'text', text: 'three' }] },
  ]);
  assert.deepEqual(markdownBlocks(''), []);
  assert.deepEqual(markdownBlocks(null), []);
});

test('" - " lines become one bullet list, grouped and ordered separately', () => {
  assert.deepEqual(markdownBlocks('- one\n- two\n\ntext\n\n1. first\n2. second'), [
    { type: 'list', ordered: false, items: [
      { spans: [{ type: 'text', text: 'one' }] },
      { spans: [{ type: 'text', text: 'two' }] },
    ] },
    { type: 'paragraph', spans: [{ type: 'text', text: 'text' }] },
    { type: 'list', ordered: true, items: [
      { spans: [{ type: 'text', text: 'first' }] },
      { spans: [{ type: 'text', text: 'second' }] },
    ] },
  ]);
});

test('bold, inline code, emphasis and links become spans, not markup', () => {
  assert.deepEqual(markdownInline('**What I did** - Fetched `https://x.test` and [the fix](https://x.test/b)'), [
    { type: 'strong', spans: [{ type: 'text', text: 'What I did' }] },
    { type: 'text', text: ' - Fetched ' },
    { type: 'code', text: 'https://x.test' },
    { type: 'text', text: ' and ' },
    { type: 'link', href: 'https://x.test/b', spans: [{ type: 'text', text: 'the fix' }] },
  ]);
  assert.deepEqual(markdownInline('*slow* now'), [
    { type: 'em', spans: [{ type: 'text', text: 'slow' }] },
    { type: 'text', text: ' now' },
  ]);
});

test('markers inside inline code stay literal', () => {
  assert.deepEqual(markdownInline('run `a **b** c` now'), [
    { type: 'text', text: 'run ' },
    { type: 'code', text: 'a **b** c' },
    { type: 'text', text: ' now' },
  ]);
});

test('unclosed markers and HTML stay literal text', () => {
  assert.deepEqual(markdownInline('**unclosed'), [{ type: 'text', text: '**unclosed' }]);
  assert.deepEqual(markdownInline('<img src=x onerror=alert(1)>'), [{ type: 'text', text: '<img src=x onerror=alert(1)>' }]);
  assert.deepEqual(markdownInline('a * b * c'), [{ type: 'text', text: 'a * b * c' }]);
});

test('escaped markers are literal and autolinks become text links', () => {
  assert.deepEqual(markdownInline('2 \\* 3'), [{ type: 'text', text: '2 * 3' }]);
  assert.deepEqual(markdownInline('<https://x.test>'), [
    { type: 'link', href: 'https://x.test', spans: [{ type: 'text', text: 'https://x.test' }] },
  ]);
});

test('fenced code and headings are their own blocks', () => {
  assert.deepEqual(markdownBlocks('## Report\n\n```sh\nnpm test\n```'), [
    { type: 'heading', level: 2, spans: [{ type: 'text', text: 'Report' }] },
    { type: 'code', lang: 'sh', text: 'npm test' },
  ]);
});

test('a long realistic report keeps every word reachable', () => {
  const report = [
    '**What I did** - Fetched `https://example.test/api` and pinned the retry.',
    '',
    'Verification: `node --test` passes.',
    '- added the guard',
    '- kept the old path',
  ].join('\n');
  const blocks = markdownBlocks(report);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].type, 'paragraph');
  assert.equal(blocks[1].type, 'paragraph');
  assert.equal(blocks[2].type, 'list');
  assert.equal(blocks[2].items.length, 2);
});
