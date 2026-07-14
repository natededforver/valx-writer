import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushSnapshot, gzipStr, gunzipStr } from './history';

test('pushSnapshot appends a changed version, newest last', () => {
  let h = [];
  h = pushSnapshot(h, 'a', 1);
  h = pushSnapshot(h, 'b', 2);
  assert.deepEqual(h, [{ t: 1, content: 'a' }, { t: 2, content: 'b' }]);
});

test('pushSnapshot dedups identical latest content (same ref back)', () => {
  const h = [{ t: 1, content: 'a' }];
  assert.equal(pushSnapshot(h, 'a', 2), h, 'unchanged → same array reference');
});

test('pushSnapshot caps history, dropping oldest', () => {
  let h = [];
  for (let i = 0; i < 5; i++) h = pushSnapshot(h, String(i), i, 3);
  assert.deepEqual(h.map((s) => s.content), ['2', '3', '4']);
});

test('gzip round-trips and actually shrinks repetitive content', { skip: typeof CompressionStream === 'undefined' }, async () => {
  const s = JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ t: i, content: 'const x = 1;\n'.repeat(20) })));
  const gz = await gzipStr(s);
  assert.equal(await gunzipStr(gz), s);
  assert.ok(gz.length < s.length / 3, 'compressed well under a third of the original');
});
