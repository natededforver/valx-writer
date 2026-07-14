import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkHrefForNote, hasNoteLink, appendNoteLink, removeNoteLink, retargetLink, extractNoteLinkHrefs, parseTrailingMdLink } from './noteLinks';
import { htmlToMarkdown, markdownToHtml } from './format';

test('linkHrefForNote URI-encodes the title and appends the extension', () => {
  assert.equal(linkHrefForNote('My Note', '.md'), 'My%20Note.md');
  assert.equal(linkHrefForNote('', '.md'), 'Untitled.md');
});

test('appendNoteLink appends a link paragraph and is idempotent', () => {
  const href = linkHrefForNote('Other', '.md');
  const once = appendNoteLink('<p>Hello</p>', 'Other', href);
  assert.ok(hasNoteLink(once, href));
  const twice = appendNoteLink(once, 'Other', href);
  assert.equal(twice, once);
});

test('removeNoteLink undoes appendNoteLink, restoring the original content', () => {
  const href = linkHrefForNote('Other', '.md');
  const original = '<p>Hello</p>';
  const appended = appendNoteLink(original, 'Other', href);
  assert.equal(removeNoteLink(appended, href), original);
});

test('removeNoteLink also matches a bare anchor (post-round-trip degraded form)', () => {
  const href = linkHrefForNote('Other', '.md');
  const bare = `<p>Hello</p><br><a href="${href}">Other</a>`;
  assert.equal(removeNoteLink(bare, href), '<p>Hello</p>');
});

test('removeNoteLink only removes the matching href, leaving other links intact', () => {
  const hrefA = linkHrefForNote('A', '.md');
  const hrefB = linkHrefForNote('B', '.md');
  let content = appendNoteLink('<p>Hi</p>', 'A', hrefA);
  content = appendNoteLink(content, 'B', hrefB);
  const removed = removeNoteLink(content, hrefA);
  assert.equal(hasNoteLink(removed, hrefA), false);
  assert.ok(hasNoteLink(removed, hrefB));
});

test('appended link survives an htmlToMarkdown -> markdownToHtml round-trip', () => {
  const href = linkHrefForNote('My Other Note', '.md');
  const content = appendNoteLink('<p>Some text</p>', 'My Other Note', href);
  const md = htmlToMarkdown(content);
  const restored = markdownToHtml(md);
  assert.ok(hasNoteLink(restored, href));
  // removeNoteLink must still find it in its post-round-trip (possibly bare-anchor) shape.
  assert.equal(hasNoteLink(removeNoteLink(restored, href), href), false);
});

test('hasNoteLink does not false-positive on an unrelated href', () => {
  const href = linkHrefForNote('Note', '.md');
  assert.equal(hasNoteLink('<p><a href="Other.md">Other</a></p>', href), false);
});

test('retargetLink moves the link to a new href/title, at the bottom', () => {
  const oldHref = linkHrefForNote('Old Title', '.md');
  const newHref = linkHrefForNote('New Title', '.md');
  const content = appendNoteLink('<p>Some text</p>', 'Old Title', oldHref);
  const retargeted = retargetLink(content, oldHref, 'New Title', newHref);
  assert.equal(hasNoteLink(retargeted, oldHref), false);
  assert.ok(hasNoteLink(retargeted, newHref));
  assert.ok(retargeted.includes('New Title'));
});

test('extractNoteLinkHrefs finds every link href and decodes entity-escaped ampersands', () => {
  const hrefA = linkHrefForNote('A', '.md');
  const hrefB = linkHrefForNote('B & C', '.md'); // '&' round-trips as '&amp;' in stored HTML
  let content = appendNoteLink('<p>Hi</p>', 'A', hrefA);
  content = appendNoteLink(content, 'B & C', hrefB);
  assert.deepEqual(extractNoteLinkHrefs(content).sort(), [hrefA, hrefB].sort());
});

test('extractNoteLinkHrefs returns an empty array for content with no links', () => {
  assert.deepEqual(extractNoteLinkHrefs('<p>Just text</p>'), []);
});

test('appendNoteLink relocates an existing mid-content link to the bottom', () => {
  const href = linkHrefForNote('Other', '.md');
  const midContent = `<p><a href="${href}">Other</a></p><p>more text after the link</p>`;
  const normalized = appendNoteLink(midContent, 'Other', href);
  assert.equal(normalized, '<p>more text after the link</p><p><a href="Other.md">Other</a></p>');
});

test('appendNoteLink is idempotent when the link is already at the bottom', () => {
  const href = linkHrefForNote('Other', '.md');
  const atBottom = appendNoteLink('<p>Hello</p>', 'Other', href);
  assert.equal(appendNoteLink(atBottom, 'Other', href), atBottom);
});

test('parseTrailingMdLink matches a completed link at the end of the text', () => {
  const hit = parseTrailingMdLink('see [My Note](My%20Note.md)');
  assert.deepEqual(hit, { label: 'My Note', href: 'My%20Note.md', matchLen: '[My Note](My%20Note.md)'.length });
});

test('parseTrailingMdLink returns null for incomplete or non-trailing links', () => {
  assert.equal(parseTrailingMdLink('see [My Note](My%20Note.md'), null);
  assert.equal(parseTrailingMdLink('[x](y.md) trailing text'), null);
  assert.equal(parseTrailingMdLink('no link here'), null);
  assert.equal(parseTrailingMdLink('empty []()'), null);
});
