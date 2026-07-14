import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleBookmark, pruneBookmarks } from './bookmarks';

test('toggleBookmark adds an id that is not present', () => {
  assert.deepEqual(toggleBookmark([], 'a'), ['a']);
  assert.deepEqual(toggleBookmark(['a'], 'b'), ['a', 'b']);
});

test('toggleBookmark removes an id that is present', () => {
  assert.deepEqual(toggleBookmark(['a', 'b'], 'a'), ['b']);
});

test('toggleBookmark twice is a no-op', () => {
  const once = toggleBookmark([], 'a');
  const twice = toggleBookmark(once, 'a');
  assert.deepEqual(twice, []);
});

test('pruneBookmarks drops ids that are no longer live', () => {
  const live = new Set(['a', 'c']);
  assert.deepEqual(pruneBookmarks(['a', 'b', 'c'], live), ['a', 'c']);
});

test('pruneBookmarks keeps the list unchanged when all ids are live', () => {
  const live = new Set(['a', 'b']);
  assert.deepEqual(pruneBookmarks(['a', 'b'], live), ['a', 'b']);
});
