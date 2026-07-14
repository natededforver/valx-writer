import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagForCard, hasTag, appendTag, removeTag } from './noteTags';
import { htmlToMarkdown, markdownToHtml } from './format';

test('tagForCard slugifies card text into a canonical tag', () => {
  assert.equal(tagForCard('Research Idea!'), '#research-idea');
  assert.equal(tagForCard('  '), null);
  assert.equal(tagForCard('$$$'), null);
  assert.equal(tagForCard('Key_Source'), '#key_source');
});

test('appendTag appends a tag paragraph and is idempotent', () => {
  const once = appendTag('<p>Hello</p>', '#research-idea');
  assert.ok(hasTag(once, '#research-idea'));
  const twice = appendTag(once, '#research-idea');
  assert.equal(twice, once);
});

test('removeTag undoes appendTag, restoring the original content', () => {
  const original = '<p>Hello</p>';
  const appended = appendTag(original, '#research-idea');
  assert.equal(removeTag(appended, '#research-idea'), original);
});

test('removeTag also matches a bare tag (post-round-trip degraded form)', () => {
  const bare = '<p>Hello</p><br>#research-idea';
  assert.equal(removeTag(bare, '#research-idea'), '<p>Hello</p>');
});

test('hasTag/removeTag treat #tag and #tag2 as distinct (no prefix collision)', () => {
  let content = appendTag('<p>Hi</p>', '#tag');
  content = appendTag(content, '#tag2');
  const removed = removeTag(content, '#tag');
  assert.equal(hasTag(removed, '#tag'), false);
  assert.ok(hasTag(removed, '#tag2'));
});

test('hasTag/appendTag/removeTag are case-insensitive, matching useNotes.parseTags', () => {
  const content = '<p>Hello</p><p>#WorldTag</p>';
  assert.ok(hasTag(content, '#worldtag'));
  // appendTag must not duplicate a tag that already exists in a different case
  assert.equal(appendTag(content, '#worldtag'), content);
  assert.equal(hasTag(removeTag(content, '#worldtag'), '#worldtag'), false);
});

test('appended tag survives an htmlToMarkdown -> markdownToHtml round-trip', () => {
  const content = appendTag('<p>Some text</p>', '#research-idea');
  const md = htmlToMarkdown(content);
  assert.match(md, /(^|\s)#research-idea(?![\w-])/);
  const restored = markdownToHtml(md);
  assert.ok(hasTag(restored, '#research-idea'));
  assert.equal(hasTag(removeTag(restored, '#research-idea'), '#research-idea'), false);
});
