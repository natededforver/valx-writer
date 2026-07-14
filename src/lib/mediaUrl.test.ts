import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayMediaSrc, displayMediaHtml, canonicalMediaHtml } from './mediaUrl';

// Mirrors convertFileSrc on Windows WebView2.
const convert = (p: string) => `http://asset.localhost/${encodeURIComponent(p)}`;
const ROOT = 'E:\\my notes\\workspace';

test('displayMediaSrc rewrites canonical media, leaves everything else', () => {
  const out = displayMediaSrc('/__media/.attachments/pic.png', ROOT, convert);
  assert.equal(out, `http://asset.localhost/${encodeURIComponent('E:/my notes/workspace/.attachments/pic.png')}`);
  assert.equal(displayMediaSrc('data:image/png;base64,AA==', ROOT, convert), 'data:image/png;base64,AA==');
  assert.equal(displayMediaSrc('/__media/.attachments/pic.png', null, convert), '/__media/.attachments/pic.png');
});

test('display -> canonical -> display round-trips byte-for-byte', () => {
  const html = '<img src="/__media/.attachments/a b.png"><audio src="/__media/.attachments/song.mp3"></audio>';
  const displayed = displayMediaHtml(html, ROOT, convert);
  assert.ok(!displayed.includes('/__media/'));
  const canon = canonicalMediaHtml(displayed, ROOT);
  assert.equal(canon, html);
  assert.equal(displayMediaHtml(canon, ROOT, convert), displayed);
});

test('canonicalMediaHtml leaves asset URLs outside the workspace untouched', () => {
  const foreign = `<img src="http://asset.localhost/${encodeURIComponent('C:/other/place.png')}">`;
  assert.equal(canonicalMediaHtml(foreign, ROOT), foreign);
});

test('canonical is case-insensitive on the root (Windows paths)', () => {
  const url = `http://asset.localhost/${encodeURIComponent('e:/MY NOTES/workspace/.attachments/x.png')}`;
  assert.equal(canonicalMediaHtml(`<img src="${url}">`, ROOT), '<img src="/__media/.attachments/x.png">');
});

test('identity in browser mode (no root)', () => {
  const html = '<img src="/__media/.attachments/a.png">';
  assert.equal(displayMediaHtml(html, null, convert), html);
  assert.equal(canonicalMediaHtml(html, null), html);
});
