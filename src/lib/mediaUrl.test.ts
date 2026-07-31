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
  // The space is %20 in the canonical form, not a literal: a literal one ends
  // the match (`[^"')\s]+`) and the URL silently loses everything after it —
  // which the old spelling of this test hid, because the leftover tail
  // round-tripped just as faithfully as the truncated head.
  const html = '<img src="/__media/.attachments/a%20b.png"><audio src="/__media/.attachments/song.mp3"></audio>';
  const displayed = displayMediaHtml(html, ROOT, convert);
  assert.ok(!displayed.includes('/__media/'));
  assert.ok(displayed.includes(encodeURIComponent('E:/my notes/workspace/.attachments/a b.png')));
  const canon = canonicalMediaHtml(displayed, ROOT);
  assert.equal(canon, html);
  assert.equal(displayMediaHtml(canon, ROOT, convert), displayed);
});

// --- the workspace-name bug -------------------------------------------------

const PAREN_ROOT = 'E:\\Backup (writing)';

test('a workspace path with parens round-trips (the reported break)', () => {
  const html = '<img src="/__media/.attachments/image-e4mseh.png">';
  const displayed = displayMediaHtml(html, PAREN_ROOT, convert);
  // Nothing in the display URL can end it early: no bare parens, no apostrophe.
  assert.ok(!/[()']/.test(displayed.slice(displayed.indexOf('asset.localhost'))));
  assert.equal(canonicalMediaHtml(displayed, PAREN_ROOT), html);
  assert.equal(displayMediaHtml(html, PAREN_ROOT, convert), displayed);
});

test("an apostrophe in the workspace name can't close the src attribute", () => {
  const displayed = displayMediaSrc('/__media/.attachments/x.png', "D:\\Nate's notes", convert);
  assert.ok(!displayed.includes("'"));
  assert.equal(canonicalMediaHtml(`<img src='${displayed}'>`, "D:\\Nate's notes"), `<img src='/__media/.attachments/x.png'>`);
});

test('asset URLs written by the broken build are repaired, not left absolute', () => {
  // What is sitting in users' notes right now: encodeURIComponent left the
  // parens bare, so the old canonical pass matched half a URL and gave up.
  const broken = `<img src="http://asset.localhost/${encodeURIComponent('E:/Backup (writing)/.attachments/image-e4mseh.png')}">`;
  assert.ok(broken.includes('(writing)'));
  assert.equal(canonicalMediaHtml(broken, PAREN_ROOT), '<img src="/__media/.attachments/image-e4mseh.png">');
});

test('a trailing `)` that closes markdown, not the URL, stays outside the src', () => {
  const md = `![x](http://asset.localhost/${encodeURIComponent('E:/Backup (writing)/.attachments/a.png')})`;
  assert.equal(canonicalMediaHtml(md, PAREN_ROOT), '![x](/__media/.attachments/a.png)');
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
