import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage for the node runner (creators.ts reads the creator name).
(globalThis as any).localStorage = {
  s: {} as Record<string, string>,
  getItem(k: string) { return k in this.s ? this.s[k] : null; },
  setItem(k: string, v: string) { this.s[k] = String(v); },
  removeItem(k: string) { delete this.s[k]; },
  clear() { this.s = {}; },
};

import { stripByline, scanProvenance, buildByline, syncByline, deriveByline, BYLINE_RE } from './byline';
import { htmlToMarkdown, markdownToHtml } from './format';

// No creator name set / no marks → no byline at all (a fresh note stays clean).
test('empty context produces no byline', () => {
  localStorage.clear();
  assert.equal(syncByline('<div>hello</div>'), '<div>hello</div>');
});

test('scanProvenance reads ai, human authors and web sources from marks', () => {
  const body =
    '<mark class="vx-slop" data-slop="ai">x</mark>' +
    '<mark class="vx-slop" data-slop="human" data-author="a1">y</mark>' +
    '<mark class="vx-slop" data-slop="human" data-author="a1">z</mark>' +
    `<mark class="vx-slop" data-slop="web" data-src-site="${encodeURIComponent('Wiki')}" data-src-url="${encodeURIComponent('https://w/x')}">q</mark>`;
  const p = scanProvenance(body);
  assert.equal(p.ai, true);
  assert.deepEqual(p.authorIds, ['a1']); // de-duplicated
  assert.deepEqual(p.sources, [{ site: 'Wiki', url: 'https://w/x' }]);
});

test('syncByline is idempotent and never duplicates the block', () => {
  localStorage.clear();
  localStorage.setItem('valx-author-me', 'Alice');
  const body = '<div>chapter one</div>';
  const once = syncByline(body);
  const twice = syncByline(once);
  assert.equal(once, twice);
  assert.match(once, /data-vx-byline="1"/);
  assert.equal((once.match(BYLINE_RE) ? 1 : 0), 1);
  assert.match(once, /By Alice/);
  // stripping recovers exactly the original body
  assert.equal(stripByline(once), body);
});

test('byline survives an htmlToMarkdown → markdownToHtml round-trip', () => {
  localStorage.clear();
  localStorage.setItem('valx-author-me', 'Bo');
  const stored = syncByline('<div>the body</div>');
  const md = htmlToMarkdown(stored);
  const back = markdownToHtml(md);
  // The managed block is still present, still the only one, still credits Bo.
  assert.equal(back.match(new RegExp(BYLINE_RE.source, 'gi'))?.length, 1);
  assert.match(back, /By Bo/);
  // The <br> noise the round-trip glues on renormalises to a single tidy block,
  // and syncing is stable from there (no duplication, no drift).
  const normal = syncByline(back);
  assert.doesNotMatch(normal, /^<br/); // no leading blank line before the byline
  assert.equal(syncByline(normal), normal);
  assert.equal(normal.match(new RegExp(BYLINE_RE.source, 'gi'))?.length, 1);
});

test('deriveByline resolves human ids to creator names', () => {
  localStorage.clear();
  localStorage.setItem('valx-author-me', 'Me Myself');
  localStorage.setItem('valx-creators', JSON.stringify([{ id: 'a1', name: 'Ada' }]));
  const ctx = deriveByline('<mark class="vx-slop" data-slop="human" data-author="a1">w</mark>');
  assert.equal(ctx.by, 'Me Myself');
  assert.deepEqual(ctx.authors, ['Ada']);
  assert.match(buildByline(ctx), /with Ada/);
});
