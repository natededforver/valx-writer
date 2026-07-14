import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordSpans, slopWrapText, webReferenceHtml, survivingSpans, SLOP_MARK_RE } from './slop';

test('survivingSpans shrinks to the untouched original characters', () => {
  assert.deepEqual(survivingSpans('world', 'world'), [{ start: 0, end: 5 }]); // untouched
  assert.deepEqual(survivingSpans('world', 'wxrld'), [{ start: 0, end: 1 }, { start: 2, end: 5 }]);
  assert.deepEqual(survivingSpans('world', 'wor'), [{ start: 0, end: 3 }]); // backspaced
  assert.deepEqual(survivingSpans('world', 'worldly'), [{ start: 0, end: 5 }]); // appended
  assert.deepEqual(survivingSpans('a', 'ba'), [{ start: 1, end: 2 }]); // prepended
  assert.deepEqual(survivingSpans('aa', 'a'), [{ start: 0, end: 1 }]); // no double-count
  assert.deepEqual(survivingSpans('world', 'hello'), []); // spent -> unmark
  assert.deepEqual(survivingSpans('world', ''), []);
  assert.deepEqual(survivingSpans('world ', 'planet '), []); // surviving space alone is spent
});

test('wordSpans finds non-whitespace tokens with offsets', () => {
  assert.deepEqual(wordSpans('ab  cd'), [
    { start: 0, end: 2 },
    { start: 4, end: 6 },
  ]);
  assert.deepEqual(wordSpans('   '), []);
});

test('slopWrapText wraps each word, keeps spacing, escapes HTML, <br>s newlines', () => {
  const html = slopWrapText('a <b>\nc', 'paste');
  // A mark spans `word + trailing space` (see survivingSpans in slop.ts) so
  // deleting a marked word takes its spacing with it.
  assert.equal(
    html,
    '<mark class="vx-slop" data-slop="paste">a </mark><mark class="vx-slop" data-slop="paste">&lt;b&gt;</mark><br><mark class="vx-slop" data-slop="paste">c</mark>'
  );
  // Every produced mark matches the shared regex format.ts stashes on.
  assert.equal(html.match(SLOP_MARK_RE)?.length, 3);
});

test('webReferenceHtml: link when url given, plain text otherwise', () => {
  assert.equal(
    webReferenceHtml('Wikipedia', 'https://en.wikipedia.org/wiki/X'),
    '<p>Source: <a href="https://en.wikipedia.org/wiki/X">Wikipedia</a></p>'
  );
  assert.equal(webReferenceHtml('Some <site>'), '<p>Source: Some &lt;site&gt;</p>');
});
