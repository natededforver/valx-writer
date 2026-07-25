import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordTokens, forbiddenPhrases, forbiddenSpans, normalizeWord } from './forbidden';

const spans = (text: string, entries: string[]) =>
  forbiddenSpans(text, forbiddenPhrases(entries)).map(({ start, end }) => text.slice(start, end));

test('wordTokens skips punctuation and symbols entirely', () => {
  assert.deepEqual(wordTokens('hi, there!').map((t) => t.norm), ['hi', 'there']);
  assert.deepEqual(wordTokens('!!! — ??').map((t) => t.norm), []);
});

test('wordTokens keeps apostrophes and hyphens inside a word', () => {
  assert.deepEqual(wordTokens("don't stop").map((t) => t.norm), ["don't", 'stop']);
  assert.deepEqual(wordTokens('state-of-the-art').map((t) => t.norm), ['state-of-the-art']);
});

test('a match covers the word only, not the punctuation around it', () => {
  assert.deepEqual(spans('Well, damn, that worked.', ['damn']), ['damn']);
  assert.deepEqual(spans('(very)', ['very']), ['very']);
});

test('matching is case-insensitive both ways', () => {
  assert.deepEqual(spans('Very VERY very', ['vErY']), ['Very', 'VERY', 'very']);
  assert.equal(normalizeWord('DAMN'), 'damn');
});

test('only whole words match — no matching inside a longer word', () => {
  assert.deepEqual(spans('a damning verdict', ['damn']), []);
  assert.deepEqual(spans('undamn damns', ['damn']), []);
});

test('a phrase matches consecutive words across the punctuation between them', () => {
  assert.deepEqual(spans('it was very unique', ['very unique']), ['very unique']);
  assert.deepEqual(spans('very, unique', ['very unique']), ['very, unique']);
});

test('the longest entry wins at a given position', () => {
  assert.deepEqual(spans('very unique thing', ['very', 'very unique']), ['very unique']);
});

test('matches do not overlap — scanning resumes after each one', () => {
  assert.deepEqual(spans('very very very', ['very very']), ['very very']);
});

test('entries with no word content are dropped rather than matching everything', () => {
  assert.deepEqual(forbiddenPhrases(['!!!', '   ', 'ok']), [['ok']]);
  assert.deepEqual(spans('anything at all', ['!!!']), []);
});

test('an empty list matches nothing', () => {
  assert.deepEqual(spans('some words here', []), []);
});

test('symbols in an entry are ignored, so "damn!" still matches "damn"', () => {
  assert.deepEqual(spans('oh damn', ['damn!']), ['damn']);
});
