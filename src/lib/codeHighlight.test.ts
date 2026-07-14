import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlightCode, codeLangFromExt, buildPreviewDoc, PREVIEWABLE } from './codeHighlight';

test('highlightCode escapes HTML so notes cannot inject markup', () => {
  const out = highlightCode('<script>alert(1)</script>', 'html');
  assert.ok(!/<script>/.test(out), 'raw <script> must not survive');
  assert.ok(out.includes('&lt;'), 'angle brackets are escaped');
});

test('highlightCode marks keywords and strings', () => {
  const js = highlightCode('const x = "hi"', 'js');
  assert.ok(js.includes('tok-keyword'), 'const is a keyword');
  assert.ok(js.includes('tok-string'), 'string literal marked');
  const py = highlightCode('def f(): return None', 'python');
  assert.ok(py.includes('tok-keyword'));
});

test('highlightCode terminates and preserves length of plain text', () => {
  const plain = 'just words here';
  const out = highlightCode(plain, 'js').replace(/<[^>]+>/g, '');
  assert.equal(out, plain);
});

test('codeLangFromExt maps known code extensions', () => {
  assert.equal(codeLangFromExt('.py'), 'python');
  assert.equal(codeLangFromExt('.TS'), 'ts');
  assert.equal(codeLangFromExt('.mjs'), 'js');
  assert.equal(codeLangFromExt('.md'), null);
});

test('preview is gated to html/css/js', () => {
  assert.ok(PREVIEWABLE.has('html') && PREVIEWABLE.has('css') && PREVIEWABLE.has('js'));
  assert.ok(!PREVIEWABLE.has('python') && !PREVIEWABLE.has('ts'));
});

test('buildPreviewDoc rewrites media to the app origin', () => {
  const doc = buildPreviewDoc('<img src="/__media/.attachments/x.png">', 'html', 'http://127.0.0.1:38917');
  assert.ok(doc.includes('http://127.0.0.1:38917/__media/.attachments/x.png'));
});

test('md highlight fades syntax marks and keeps content meaningful', () => {
  const out = highlightCode('## Title\n**bold** and *it* and `code`\n- item\n[label](https://x.y)', 'md');
  assert.ok(out.includes('<span class="tok-mdsyn">## </span>'), 'heading hashes faded');
  assert.ok(out.includes('<span class="tok-mdhead">Title</span>'), 'heading text marked');
  assert.ok(out.includes('<b>bold</b>') && out.includes('<i>it</i>'), 'bold/italic content styled');
  assert.ok(out.includes('<span class="tok-mdcode">code</span>'), 'inline code content marked');
  assert.ok(out.includes('<span class="tok-mdlink">label</span>'), 'link label marked');
  assert.ok(out.includes('<span class="tok-mdurl">https://x.y</span>'), 'url faded separately');
  // list marker faded
  assert.ok(out.includes('<span class="tok-mdsyn">- </span>'), 'list marker faded');
});

test('md highlight escapes HTML and preserves text', () => {
  const src = '# <script>alert(1)</script>\nplain **line**';
  const out = highlightCode(src, 'md');
  assert.ok(!/<script>/.test(out), 'no raw script tags');
  assert.equal(
    out.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
    src,
    'stripping spans yields the original source'
  );
});
