import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitExt } from './sync';

test('splitExt keeps real extensions for code and prose files', () => {
  assert.deepEqual(splitExt('styles.css'), { base: 'styles', ext: '.css' });
  assert.deepEqual(splitExt('app.min.js'), { base: 'app.min', ext: '.js' });
  assert.deepEqual(splitExt('main.py'), { base: 'main', ext: '.py' });
  assert.deepEqual(splitExt('Component.TSX'), { base: 'Component', ext: '.tsx' });
  assert.deepEqual(splitExt('note.md'), { base: 'note', ext: '.md' });
  assert.deepEqual(splitExt('page.htm'), { base: 'page', ext: '.htm' });
});

test('splitExt leaves unknown/absent extensions on the base', () => {
  assert.deepEqual(splitExt('my.notes'), { base: 'my.notes', ext: '' });
  assert.deepEqual(splitExt('README'), { base: 'README', ext: '' });
});
