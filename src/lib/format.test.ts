// Round-trip tests for the Phase 7 markdown additions (code, fences,
// blockquotes, rules, checklists) plus regressions for what already worked.
// Contract (CLAUDE.md): md -> html -> md must reproduce the markdown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToMarkdown, markdownToHtml } from './format';

const roundTrip = (md: string) => htmlToMarkdown(markdownToHtml(md));

test('inline code round-trips and stays literal', () => {
  const md = 'use `**not bold**` here';
  const html = markdownToHtml(md);
  assert.match(html, /<code>\*\*not bold\*\*<\/code>/);
  assert.equal(roundTrip(md), md);
});

test('fenced code block round-trips, content untransformed', () => {
  const md = '```\nconst a = 1 | 2;\n**still literal**\n```';
  const html = markdownToHtml(md);
  assert.match(html, /<pre><code>/);
  assert.match(html, /\*\*still literal\*\*/);
  assert.equal(roundTrip(md).trim(), md);
});

test('fence quoting HTML is not mistaken for a legacy raw-HTML file', () => {
  const md = '```\n<div>hi</div>\n```';
  const html = markdownToHtml(md);
  assert.match(html, /<pre><code>&lt;div&gt;hi&lt;\/div&gt;<\/code><\/pre>/);
});

test('blockquote run folds to one blockquote and round-trips', () => {
  const md = '> first line\n> second line';
  const html = markdownToHtml(md);
  assert.equal((html.match(/<blockquote>/g) || []).length, 1);
  assert.match(html, /first line<br>second line/);
  assert.equal(roundTrip(md).trim(), md);
});

test('horizontal rule round-trips', () => {
  const md = 'above\n\n---\n\nbelow';
  const html = markdownToHtml(md);
  assert.match(html, /<hr>/);
  const back = roundTrip(md);
  assert.match(back, /above[\s\S]*---[\s\S]*below/);
});

test('table separator line is not eaten by the hr rule', () => {
  const md = '| a | b |\n| --- | --- |\n| 1 | 2 |';
  const html = markdownToHtml(md);
  assert.match(html, /<table/);
  assert.doesNotMatch(html, /<hr>/);
});

test('task list round-trips checked and unchecked', () => {
  const md = '- [ ] open item\n- [x] done item';
  const html = markdownToHtml(md);
  assert.match(html, /<input type="checkbox" disabled> open item/);
  assert.match(html, /<input type="checkbox" checked disabled> done item/);
  assert.equal(roundTrip(md).trim(), md);
});

test('regression: heading + bold + link still round-trip', () => {
  const md = '# Title\nsome **bold** and a [link](Note.md)';
  assert.equal(roundTrip(md).trim(), md);
});

test('slop provenance marks ride through the round-trip verbatim', () => {
  const html =
    'mine <mark class="vx-slop" data-slop="ai">pasted</mark> <mark class="vx-slop" data-slop="web">&lt;words&gt;</mark> and **md**';
  const md = htmlToMarkdown(html);
  assert.match(md, /<mark class="vx-slop" data-slop="ai">pasted<\/mark>/);
  // Entity-encoded inner text stays encoded on disk (round-trip contract).
  assert.match(md, /&lt;words&gt;/);
  const back = markdownToHtml(md);
  assert.match(back, /<mark class="vx-slop" data-slop="ai">pasted<\/mark>/);
  assert.match(back, /<mark class="vx-slop" data-slop="web">&lt;words&gt;<\/mark>/);
  // The mark tag itself is never escaped, and the file is NOT treated as
  // legacy raw HTML — markdown around the marks still converts.
  assert.doesNotMatch(back, /&lt;mark/);
  assert.match(back, /<b>md<\/b>/);
});

test('regression: entities stay encoded through the round-trip', () => {
  const md = 'mentions &lt;div&gt; safely';
  assert.equal(roundTrip(md), md);
});
