// Round-trip tests for the Phase 7 markdown additions (code, fences,
// blockquotes, rules, checklists) plus regressions for what already worked.
// Contract: md -> html -> md must reproduce the markdown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToMarkdown, markdownToHtml, wordCount } from './format';

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
  assert.match(html, /<input type="checkbox"> open item/);
  assert.match(html, /<input type="checkbox" checked> done item/);
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

test('slop mark round-trips byte-identical through md -> html -> md', () => {
  const md = 'mine <mark class="vx-slop" data-slop="ai">pasted</mark> text';
  assert.equal(roundTrip(md), md);
});

test('regression: entities stay encoded through the round-trip', () => {
  const md = 'mentions &lt;div&gt; safely';
  assert.equal(roundTrip(md), md);
});

// --- tag matching by name, not by prefix -----------------------------------
//
// The inline rules used to spell a tag `<(b|strong)[^>]*>`, which also matches
// <br>, <blockquote> and <body> — and because the pair rule then hunts for the
// next </b>, one <br> above a bold word swallowed the whole span between them.
// A note written with a blank line and a bold word came back from disk with a
// stray `**` on the blank line and the bold gone. Same shape for <i> vs <img>
// and <s> vs <span>/<strong>. These are the exact fragments the editor emits.

test('a blank line above a bold word does not eat the bold', () => {
  const html = '<div><br></div><div>Some <b>bold</b> here</div>';
  assert.equal(htmlToMarkdown(html), 'Some **bold** here');
});

test('real editor output survives the disk round-trip unchanged', () => {
  // Captured from a browser: Chromium wraps each Enter-created line in a <div>,
  // and an empty line is <div><br></div>.
  const html =
    'Intro paragraph here.<div>- first bullet</div><div>- second bullet</div><div><br></div>' +
    '<div>Some <b>bold</b> and <i>slanted</i> words.</div>';
  const md = htmlToMarkdown(html);
  assert.equal(md, 'Intro paragraph here.\n- first bullet\n- second bullet\n\nSome **bold** and *slanted* words.');
  // …and a second trip through changes nothing further.
  assert.equal(htmlToMarkdown(markdownToHtml(md)), md);
});

test('<span> is not read as strikethrough, <img> is not read as italic', () => {
  assert.equal(htmlToMarkdown('<div><span style="color:red">red</span> and <s>gone</s></div>'), 'red and ~~gone~~');
  assert.equal(htmlToMarkdown('<div><img src="a.png" alt="p"> and <i>it</i></div>'), '![p](a.png) and *it*');
});

test('a blockquote above a bold word does not eat the bold', () => {
  assert.equal(
    htmlToMarkdown('<blockquote>quoted</blockquote><div>then <b>bold</b></div>'),
    '> quoted\n\nthen **bold**'
  );
});

test('formatting inside a heading survives — headings convert after inline', () => {
  assert.equal(htmlToMarkdown('<h1>A <b>bold</b> title</h1>'), '# A **bold** title\n');
  assert.equal(htmlToMarkdown('<h2>See <a href="http://x">this</a></h2>'), '## See [this](http://x)\n');
});

// --- word count -------------------------------------------------------------

test('the byline is not counted — an empty note reads zero words', () => {
  const byline =
    '<aside class="vx-byline" data-vx-byline="1" contenteditable="false">' +
    '<span class="vx-byline-by">By Nate</span></aside>';
  // What an untouched note with a creator name set actually holds on disk.
  assert.equal(wordCount(byline), 0);
  assert.equal(wordCount(''), 0);
  // …and the prose under one still counts as itself.
  assert.equal(wordCount(byline + '<div>three words here</div>'), 3);
});

test('word count ignores tags and every part of a full byline', () => {
  const byline =
    '<aside data-vx-byline="1"><span>By Nate</span><span>with Ada · AI-assisted</span>' +
    '<span>Source: <a href="http://x">example.com</a></span></aside>';
  assert.equal(wordCount(byline), 0);
  assert.equal(wordCount('<p>one <b>two</b><i>three</i></p>'), 3);
});

test('nothing invisible counts as a word', () => {
  // The zero-width space shift+Enter leaves behind to anchor the caret.
  assert.equal(wordCount('​'), 0);
  assert.equal(wordCount('one<br>​'), 1);
  // Entities are decoded first, so a non-breaking space separates rather than
  // reading as a word of its own.
  assert.equal(wordCount('&nbsp;'), 0);
  assert.equal(wordCount('<p>a&nbsp;b</p>'), 2);
});
