import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordSpans, slopWrapText, webReferenceHtml, SLOP_MARK_RE } from './slop';

test('SLOP_MARK_RE matches a mark carrying extra classes (autosave mid-edit)', () => {
  const html = '<mark class="vx-slop vx-slop-edit" data-slop="paste">word </mark>';
  assert.equal(html.match(SLOP_MARK_RE)?.length, 1);
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
  // A mark spans `word + trailing space`, so deleting a marked word takes its
  // spacing with it.
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
