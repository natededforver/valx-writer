import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainText, searchNotes } from './search';

test('plainText strips tags and collapses whitespace', () => {
  const html = '<div>Hello   <b>world</b><br>this   is\n\na  <img src="x"> test</div>';
  assert.equal(plainText(html), 'Hello world this is a test');
});

test('searchNotes ignores queries shorter than 2 characters', () => {
  const notes = [{ id: '1', title: 'Cats', content: 'cats are great' }];
  assert.deepEqual(searchNotes(notes, 'c'), []);
  assert.deepEqual(searchNotes(notes, ''), []);
});

test('searchNotes matches case-insensitively across title and body', () => {
  const notes = [
    { id: '1', title: 'Recipe Notes', content: 'Add two cups of Flour and mix.' },
    { id: '2', title: 'Unrelated', content: 'Nothing here.' },
  ];
  const hits = searchNotes(notes, 'flour');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].noteId, '1');
  assert.equal(hits[0].inTitle, false);
  assert.equal(hits[0].snippet.match, 'Flour');
});

test('searchNotes returns title hits ahead of body hits', () => {
  const notes = [{ id: '1', title: 'contains apple', content: 'no match here for the fruit' }];
  const hits = searchNotes(notes, 'apple');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].inTitle, true);
  assert.equal(hits[0].occurrence, -1);
});

test('searchNotes assigns increasing occurrence ordinals for repeated matches', () => {
  const notes = [{ id: '1', title: 'Untitled', content: 'apple apple banana apple' }];
  const hits = searchNotes(notes, 'apple');
  assert.equal(hits.length, 3);
  assert.deepEqual(hits.map(h => h.occurrence), [0, 1, 2]);
});

test('searchNotes builds a centered, truncated snippet', () => {
  const long = 'x'.repeat(60) + 'NEEDLE' + 'y'.repeat(60);
  const notes = [{ id: '1', title: 'Untitled', content: long }];
  const hits = searchNotes(notes, 'needle');
  assert.equal(hits.length, 1);
  const { before, match, after } = hits[0].snippet;
  assert.equal(match, 'NEEDLE');
  assert.ok(before.startsWith('…'));
  assert.ok(after.endsWith('…'));
  assert.ok(before.length <= 41);
  assert.ok(after.length <= 41);
});
