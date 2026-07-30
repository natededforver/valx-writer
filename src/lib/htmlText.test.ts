import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripTags, decodeHtmlEntities, htmlToPlainText } from './htmlText';

test('stripTags removes ordinary editor markup', () => {
  assert.equal(stripTags('<p>hello <b>world</b></p>'), 'hello world');
  assert.equal(stripTags('<div class="x">a</div>'), 'a');
  assert.equal(stripTags('<br>'), '');
  assert.equal(stripTags('<img src="x.png" />'), '');
});

test('stripTags handles a > inside an attribute value', () => {
  // The old /<[^>]+>/ stopped at the first '>' and left `b">` as text.
  assert.equal(stripTags('<a title="a > b">link</a>'), 'link');
  assert.equal(stripTags("<span data-q='x>y'>t</span>"), 't');
});

test('stripTags is idempotent — one pass cannot leave a fresh tag behind', () => {
  // Removing the inner tag splices "<scr" onto "ipt>" and spells a new one. A
  // single pass of the old /<[^>]+>/g returned "ipt>alert(1)" here, with the
  // reconstructed tag left in the output; repeating until stable removes it.
  assert.equal(stripTags('<scr<span>ipt>alert(1)</scr<span>ipt>'), 'alert(1)');
  assert.equal(stripTags('<<b>script>x'), 'x');
});

test('stripTags removes comments and unterminated trailing tags', () => {
  assert.equal(stripTags('a<!-- c > d -->b'), 'ab');
  assert.equal(stripTags('text<div'), 'text');
  assert.equal(stripTags('<!doctype html>x'), 'x');
});

test('stripTags keeps text that merely looks like markup', () => {
  assert.equal(stripTags('5 < 6 and 7 > 4'), '5 < 6 and 7 > 4');
  assert.equal(stripTags('a <- b'), 'a <- b');
});

test('stripTags honors the replacement string', () => {
  assert.equal(stripTags('<p>a</p><p>b</p>', ' '), ' a  b ');
});

test('decodeHtmlEntities decodes in one pass, never its own output', () => {
  assert.equal(decodeHtmlEntities('&lt;div&gt;'), '<div>');
  assert.equal(decodeHtmlEntities('a&amp;b'), 'a&b');
  // The whole point: this text SAYS "&lt;", it does not say "<".
  assert.equal(decodeHtmlEntities('&amp;lt;'), '&lt;');
  assert.equal(decodeHtmlEntities('&amp;amp;'), '&amp;');
  assert.equal(decodeHtmlEntities('&amp;#39;'), '&#39;');
});

test('decodeHtmlEntities handles numeric and hex forms', () => {
  assert.equal(decodeHtmlEntities('&#39;'), "'");
  assert.equal(decodeHtmlEntities('&#x27;'), "'");
  assert.equal(decodeHtmlEntities('&#8212;'), '—');
});

test('decodeHtmlEntities leaves unknown entities alone', () => {
  assert.equal(decodeHtmlEntities('&bogus;'), '&bogus;');
  assert.equal(decodeHtmlEntities('&#999999999;'), '&#999999999;');
  assert.equal(decodeHtmlEntities('bare & ampersand'), 'bare & ampersand');
});

test('htmlToPlainText flattens a note to one line', () => {
  assert.equal(htmlToPlainText('<h1>Title</h1><p>a&nbsp;b</p>'), 'Title a b');
});
