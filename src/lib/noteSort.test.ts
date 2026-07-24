import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortNotes, normalizeSort, compareTitles } from './noteSort';
import { Note } from '../types';

const n = (title: string, updatedAt = 0, createdAt?: number): Note => ({
  id: title, title, content: '', tags: [], updatedAt, createdAt, isTrash: false,
});
const titles = (ns: Note[]) => ns.map((x) => x.title);

test('numbered titles sort by value, not digit-by-digit', () => {
  const notes = [n('10. Ten'), n('2. Bleah'), n('1. blah'), n('9. Nine')];
  assert.deepEqual(titles(sortNotes(notes, 'title-asc')), ['1. blah', '2. Bleah', '9. Nine', '10. Ten']);
  assert.deepEqual(titles(sortNotes(notes, 'title-desc')), ['10. Ten', '9. Nine', '2. Bleah', '1. blah']);
});

test('title order ignores case', () => {
  assert.deepEqual(titles(sortNotes([n('beta'), n('Alpha')], 'title-asc')), ['Alpha', 'beta']);
});

test('modified sorts both directions', () => {
  const notes = [n('mid', 200), n('new', 300), n('old', 100)];
  assert.deepEqual(titles(sortNotes(notes, 'modified-desc')), ['new', 'mid', 'old']);
  assert.deepEqual(titles(sortNotes(notes, 'modified-asc')), ['old', 'mid', 'new']);
});

test('created sorts by createdAt, not updatedAt', () => {
  // Edited in the reverse order they were made.
  const notes = [n('first', 900, 100), n('second', 800, 200), n('third', 700, 300)];
  assert.deepEqual(titles(sortNotes(notes, 'created-asc')), ['first', 'second', 'third']);
  assert.deepEqual(titles(sortNotes(notes, 'created-desc')), ['third', 'second', 'first']);
});

test('a note with no createdAt falls back to updatedAt', () => {
  const notes = [n('legacy', 500), n('made-later', 400, 600)];
  assert.deepEqual(titles(sortNotes(notes, 'created-desc')), ['made-later', 'legacy']);
});

test('ties break deterministically instead of leaving input order', () => {
  const a = [n('b', 5), n('a', 5)];
  const b = [n('a', 5), n('b', 5)];
  assert.deepEqual(titles(sortNotes(a, 'modified-desc')), titles(sortNotes(b, 'modified-desc')));
});

test('sortNotes does not mutate its input', () => {
  const notes = [n('b', 1), n('a', 2)];
  sortNotes(notes, 'title-asc');
  assert.deepEqual(titles(notes), ['b', 'a']);
});

test('normalizeSort migrates the old three-option values', () => {
  assert.equal(normalizeSort('oldest'), 'modified-asc');
  assert.equal(normalizeSort('title'), 'title-asc');
  assert.equal(normalizeSort('modified'), 'modified-desc');
  assert.equal(normalizeSort(null), 'modified-desc');
  assert.equal(normalizeSort('title-desc'), 'title-desc');
});

test('compareTitles is usable for folder names too', () => {
  assert.deepEqual(['10. z', '2. y', '1. x'].sort(compareTitles), ['1. x', '2. y', '10. z']);
});
