// ---------------------------------------------------------------------------
// Disk format conversion. The editor holds HTML; .md files on disk hold real
// markdown. Audio/video have no markdown syntax, so those tags ride through
// .md files verbatim as inline HTML (valid markdown) and round-trip unchanged.
// Files written by pre-conversion builds contain raw HTML inside .md — those
// are detected on load and passed through untouched.
// ---------------------------------------------------------------------------

import { SLOP_MARK_RE } from './slop';
import { BYLINE_RE } from './byline';
import { stripTags, decodeHtmlEntities } from './htmlText';

export type MediaKind = 'image' | 'audio' | 'video' | 'file';
export interface MediaAttachment {
  kind: MediaKind;
  src: string;
  /** file name — set for generic (non image/audio/video) attachments */
  name?: string;
}

// Editable storage formats — notes saved as these round-trip back into the
// editor. .docx round-trips too (desktop only — see contentFromDisk/
// contentForDisk), read via mammoth and written via exportDocs' generateDocx.
// Other targets (custom extensions) stay one-way exports via the Format
// converter's "Export a copy" path, not stored as note files.
export type FileFormat = '.md' | '.txt' | '.html' | '.docx';
export const FILE_FORMATS: FileFormat[] = ['.md', '.txt', '.html', '.docx'];

// ---------------------------------------------------------------------------
// Path-referenced media.
//
// Dropped images/audio/video/files are copied into a hidden `.attachments/`
// folder in the workspace and the note stores a *path* to them, not a giant
// base64 blob — so the .md/.html files stay small and portable, and the media
// resolves when the file is opened outside Valx.
//
// In the editor the src is an app URL (`/__media/.attachments/x.png`), which
// the Electron static server maps back to the workspace file. On disk it is a
// path relative to the note file (`.attachments/x.png`, or `../.attachments/…`
// for notes inside folders). Legacy data: URLs are left untouched.
// ---------------------------------------------------------------------------
export const MEDIA_URL_PREFIX = '/__media/';
export const ATTACH_DIR = '.attachments';

/** App URL (/__media/.attachments/x) -> disk path relative to a note `depth`
 *  folders deep. */
export function rewriteMediaToDisk(text: string, depth = 0): string {
  if (!text) return text;
  const up = '../'.repeat(Math.max(0, depth));
  return text.replace(/\/__media\/(\.?attachments\/[^"')\s]+)/g, (_m, rel) => `${up}${rel}`);
}

/** Disk relative media path (as stored in a saved file) -> app URL for the
 *  editor. The leading `"`, `'` or `(` delimiter anchors the match so external
 *  URLs that merely contain "attachments/" are never rewritten. */
export function rewriteMediaFromDisk(text: string): string {
  if (!text) return text;
  return text.replace(
    /(["'(])((?:\.\.\/)*)(\.?attachments\/[^"')\s]+)/g,
    (_m, delim, _up, rel) => `${delim}${MEDIA_URL_PREFIX}${rel.replace(/^attachments\//, `${ATTACH_DIR}/`)}`
  );
}

/** How many folders deep a note's disk path sits (for relative media paths). */
export const folderDepth = (dir: string): number => (dir ? dir.split('/').filter(Boolean).length : 0);

// Media kind from a file name — used by the slash menu when only a directory
// listing (no mime type) is available.
const MEDIA_EXT_KIND: Record<string, MediaKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  svg: 'image', bmp: 'image', avif: 'image', ico: 'image',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio',
  mp4: 'video', webm: 'video', mov: 'video', mkv: 'video', avi: 'video', ogv: 'video',
};
export const mediaKindFromName = (name: string): MediaKind =>
  MEDIA_EXT_KIND[(name.split('.').pop() || '').toLowerCase()] ?? 'file';

// Matches the style RichTextEditor applies when media is dropped in.
const IMG_STYLE =
  'max-width: 100%; max-height: 500px; border-radius: 0.375rem; margin-top: 1rem; margin-bottom: 1rem; object-fit: contain;';

// Stash sentinels for content lifted out before transforms run. The token is
// re-randomized per call, so note text can never collide with a live token.
const makeStash = () => {
  const key = `VX${Math.random().toString(36).slice(2, 10)}`;
  const items: string[] = [];
  return {
    put(tag: string, value: string): string {
      items.push(value);
      return `@@${key}:${tag}${items.length - 1}@@`;
    },
    restore(text: string, tag: string, render: (value: string, i: number) => string): string {
      return text.replace(new RegExp(`@@${key}:${tag}(\\d+)@@`, 'g'), (_m, i) =>
        render(items[Number(i)], Number(i))
      );
    },
  };
};

// audio/video elements (paired or self-closing) that must survive verbatim
const mediaTagRe = () => /<(audio|video)[^>]*>[\s\S]*?<\/\1>|<(?:audio|video)[^>]*\/?>/gi;

// Any other HTML tag inside a .md file marks it as a legacy raw-HTML note.
const LEGACY_HTML_RE = /<\s*(br|div|p|span|img|h[1-6]|b|strong|i|em|u|s|del|strike|ul|ol|li|a|blockquote|code|pre)\b[^>]*\/?>/i;

// &lt; and &gt; deliberately stay entity-encoded in .md files: decoding them
// would make a note that merely *mentions* "<div>" look like a legacy raw-HTML
// file on the next load. markdownToHtml's &-escape has a matching lookahead
// so these entities pass through unmangled.
const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const escapeText = (s: string): string =>
  s.replace(/&(?!(?:lt|gt|amp|quot|nbsp|#\d+);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// End-of-tag-name guard for the hand-rolled tag matchers below.
//
// `<(b|strong)[^>]*>` reads as "a <b> tag", and is not: [^>]* happily eats the
// rest of a LONGER name, so it matches <br>, <blockquote> and <body> as well —
// and since the pair rule then hunts for the next </b>, a single <br> anywhere
// above a bold word swallowed everything between them. That is what turned a
// saved note into `**` on one line and `Some bold**` on the next, one restart
// after it was written. Every tag name here is followed by this: a name ends at
// whitespace, `/` or `>`, never mid-word.
const NAME_END = '(?=[\\s/>])';

// ---------------------------------------------------------------------------
// Tables. The editor holds real <table> elements; on disk they become GitHub /
// Obsidian-style pipe tables so they stay portable and readable in other apps.
// ---------------------------------------------------------------------------
// A cell's text with the two characters that mean something to the pipe-table
// syntax escaped. The backslash goes first, and must: escaping only `|` leaves
// `\` and `\|` spelling the same thing on disk, so a cell ending in a backslash
// silently ate the column boundary next to it. splitRow undoes exactly this
// pair, and nothing else — see the note there about files written before it.
const cellToText = (h: string): string =>
  decodeEntities(stripTags(h.replace(/<br\s*\/?>/gi, ' '), '').replace(/\s+/g, ' ').trim())
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|');

/** A single editor <table> element -> a markdown pipe table. */
export function tableHtmlToMarkdown(tableHtml: string): string {
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
    [...r[1].matchAll(/<(t[hd])[^>]*>([\s\S]*?)<\/\1>/gi)].map((c) => cellToText(c[2]))
  ).filter((r) => r.length);
  if (!rows.length) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => { const a = r.slice(); while (a.length < cols) a.push(''); return a; };
  const line = (cells: string[]) => `| ${pad(cells).join(' | ')} |`;
  const sep = `| ${Array(cols).fill('---').join(' | ')} |`;
  return [line(rows[0]), sep, ...rows.slice(1).map(line)].join('\n');
}

const isTableSeparator = (line: string | undefined): boolean =>
  !!line && /-/.test(line) && /\|/.test(line) && /^[\s|:\-]+$/.test(line);

// The inverse of cellToText's escaping. Scanned character by character rather
// than split by regex: a lookbehind for one backslash cannot tell `\|` (an
// escaped pipe) from `\\|` (a literal backslash, then a real column boundary).
//
// Only `\|` and `\\` are treated as escapes. Any other backslash is literal, so
// a cell holding a Windows path in a table written by an older build — which
// escaped nothing but `|` — still reads back as `C:\temp`, not `C:temp`.
const splitRow = (line: string): string[] => {
  const s = line.trim();
  const cells: string[] = [];
  let cur = '';
  let endedOnBoundary = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && (s[i + 1] === '|' || s[i + 1] === '\\')) {
      cur += s[i + 1];
      i++;
      endedOnBoundary = false;
    } else if (ch === '|') {
      cells.push(cur);
      cur = '';
      endedOnBoundary = true;
    } else {
      cur += ch;
      endedOnBoundary = false;
    }
  }
  cells.push(cur);
  // `| a | b |` borders show up as empty cells at both ends; drop those, but
  // keep a genuinely empty trailing cell in `| a | |`.
  if (cells.length > 1 && s.startsWith('|')) cells.shift();
  if (cells.length > 1 && endedOnBoundary) cells.pop();
  return cells.map((c) => c.trim());
};

/** A markdown pipe table block -> editor <table> HTML (cells escaped). */
function markdownTableToHtml(block: string): string {
  const lines = block.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return block;
  const header = splitRow(lines[0]);
  const cols = header.length;
  const body = lines.slice(2).map(splitRow);
  const th = header.map((c) => `<th>${escapeText(c)}</th>`).join('');
  const trs = body
    .map((r) => `<tr>${Array.from({ length: cols }, (_, k) => `<td>${escapeText(r[k] || '')}</td>`).join('')}</tr>`)
    .join('');
  return `<table class="vx-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

/** Editor HTML -> markdown text for .md files on disk. */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  const stash = makeStash();
  let md = html.replace(mediaTagRe(), (m) => stash.put('P', m));
  // Slop provenance marks ride through .md verbatim as inline HTML (like the
  // media tags above), but restore INLINE ('S') — the 'P' restore's newline
  // padding would put every marked word on its own line.
  md = md.replace(SLOP_MARK_RE, (m) => stash.put('S', m));
  // The byline <aside> rides through verbatim as a block (like media tags) so
  // its markup — including the source <a> links inside — survives the .md
  // round-trip untouched, ready for stripByline/rebuild on the next load.
  md = md.replace(BYLINE_RE, (m) => stash.put('P', m));
  // Code blocks first — their content must ride through every transform below
  // untouched (a fence documenting `**x**` or a pipe table must stay literal).
  md = md.replace(/<pre[^>]*>\s*(?:<code[^>]*>)?([\s\S]*?)(?:<\/code>)?\s*<\/pre>/gi, (_m, body) =>
    stash.put('P', '```\n' + stripTags(body.replace(/<br\s*\/?>/gi, '\n')) + '\n```'));
  // Tables convert to pipe-table markdown up front, then ride through the rest
  // of the pipeline as an opaque stash token.
  md = md.replace(/<table[\s\S]*?<\/table>/gi, (m) => stash.put('P', tableHtmlToMarkdown(m)));
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, body) => '`' + stripTags(body) + '`');
  md = md.replace(/<input[^>]*type=["']checkbox["'][^>]*\/?>[ \t]?/gi, (m) => (/\schecked\b/i.test(m) ? '- [x] ' : '- [ ] '));
  md = md.replace(/<hr[^>]*\/?>/gi, '\n---\n');
  md = md.replace(/<img[^>]*src=["']([^"']+)["'][^>]*\/?>/gi, (m, src) => {
    const alt = (/alt=["']([^"']*)["']/i.exec(m)?.[1] || 'image').replace(/[[\]]/g, '');
    return `![${alt}](${src})`;
  });
  md = md.replace(new RegExp(`<a${NAME_END}[^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>`, 'gi'), (_m, href, inner) => {
    const label = stripTags(inner).trim() || href;
    return `[${label.replace(/[[\]]/g, '')}](${href})`;
  });
  md = md.replace(new RegExp(`<(b|strong)${NAME_END}[^>]*>([\\s\\S]*?)<\\/\\1>`, 'gi'), '**$2**');
  md = md.replace(new RegExp(`<(i|em)${NAME_END}[^>]*>([\\s\\S]*?)<\\/\\1>`, 'gi'), '*$2*');
  md = md.replace(new RegExp(`<(s|del|strike)${NAME_END}[^>]*>([\\s\\S]*?)<\\/\\1>`, 'gi'), '~~$2~~');
  // Headings come AFTER the inline rules, not before: the body is flattened to
  // plain text here, so a heading converted first would take its own bold, its
  // own links and its own emphasis to the grave with the tags. By this point
  // whatever was inside is already markdown, and the strip only clears tags
  // that have no markdown spelling.
  md = md.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, text) => {
    return `${'#'.repeat(Number(level))} ${stripTags(text).trim()}\n`;
  });
  // Blockquotes — after inline formatting so the inner text is already
  // markdown; each rendered line gets its own `> ` prefix.
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner) => {
    const lines = stripTags(inner.replace(/<br\s*\/?>/gi, '\n')).split('\n');
    return '\n' + lines.map((l: string) => `> ${l.trim()}`).join('\n') + '\n';
  });
  md = md.replace(/<br\s*\/?>/gi, '\n');
  // Chromium contentEditable wraps every Enter-created line in its own <div>
  // (the first line stays bare), so it's the OPENING block tag that marks a
  // line break. <li> becomes a markdown bullet.
  md = md.replace(new RegExp(`<li${NAME_END}[^>]*>`, 'gi'), '\n- ');
  md = md.replace(new RegExp(`<(?:div|p|ul|ol|blockquote)${NAME_END}[^>]*>`, 'gi'), '\n');
  md = md.replace(/<\/(?:p|div|li|ul|ol|blockquote)>/gi, '');
  md = stripTags(md);
  md = decodeEntities(md);
  md = md.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  md = stash.restore(md, 'S', (tag) => tag);
  md = stash.restore(md, 'P', (tag) => `\n${tag}\n`);
  return md;
}

/** Markdown text from a .md file -> editor HTML. Legacy raw-HTML files pass through. */
export function markdownToHtml(raw: string): string {
  if (!raw) return '';
  const stash = makeStash();
  let text = raw.replace(mediaTagRe(), (m) => stash.put('P', m));
  // Fenced code blocks stash BEFORE the legacy sniff — a fence documenting
  // "<div>" is markdown quoting HTML, not a legacy raw-HTML file.
  text = text.replace(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/gm, (_m, body) =>
    stash.put('P', `<pre><code>${escapeText(body.replace(/\n$/, ''))}</code></pre>`));
  // Slop marks stash before the escape/transform passes and restore verbatim —
  // their inner text is already entity-encoded editor HTML.
  text = text.replace(SLOP_MARK_RE, (m) => stash.put('P', m));
  // Byline <aside> stashed BEFORE the legacy sniff — its <span>/<a> children
  // would otherwise look like a raw-HTML note and short-circuit the whole parse.
  text = text.replace(BYLINE_RE, (m) => stash.put('P', m));
  // With media stashed away, any remaining tag means this file predates the
  // markdown conversion and already holds editor HTML.
  if (LEGACY_HTML_RE.test(text)) return raw;

  // Pipe tables -> <table>, stashed so the escaping / line-break passes skip
  // them. Detected as a row line followed by a --- separator line.
  {
    const lines = text.split('\n');
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('|') && isTableSeparator(lines[i + 1])) {
        let j = i + 2;
        const block = [lines[i], lines[i + 1]];
        while (j < lines.length && lines[j].includes('|') && lines[j].trim() !== '') { block.push(lines[j]); j++; }
        out.push(stash.put('P', markdownTableToHtml(block.join('\n'))));
        i = j - 1;
      } else {
        out.push(lines[i]);
      }
    }
    text = out.join('\n');
  }

  // Inline code stashes before link/image parsing so `[x](y)` inside backticks
  // stays literal; restored (escaped) after every other transform has run.
  text = text.replace(/`([^`\n]+)`/g, (_m, body) => stash.put('C', body));

  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) =>
    stash.put('I', JSON.stringify({ alt, src }))
  );
  text = text.replace(/(^|[^!])\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, pre, label, src) =>
    `${pre}${stash.put('L', JSON.stringify({ label, src }))}`
  );
  text = escapeText(text);
  text = text.replace(/^(#{1,6})[ \t]+(.+)$/gm, (_m, hashes, body) => {
    const level = hashes.length;
    return `<h${level}>${body.trim()}</h${level}>`;
  });
  text = text.replace(/^(?:---+|\*\*\*+|___+)[ \t]*$/gm, '<hr>');
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>');
  text = text.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  // Task lists (Obsidian style). Interactive: clicking the box toggles it
  // (see RichTextEditor's handleClick), which is why there's no `disabled`.
  text = text.replace(/^- \[([ xX])\][ \t]+(.*)$/gm, (_m, mark, body) =>
    `<input type="checkbox"${mark.trim() ? ' checked' : ''}> ${body}`);
  // Blockquote runs (consecutive `> ` lines, already &gt;-escaped) fold into
  // one <blockquote> with <br> line breaks inside.
  text = text.replace(/^&gt;[ \t]?.*(?:\n&gt;[ \t]?.*)*/gm, (block) =>
    `<blockquote>${block.split('\n').map((l) => l.replace(/^&gt;[ \t]?/, '')).join('<br>')}</blockquote>`);
  text = text.replace(/\n/g, '<br>');
  // Headings are block-level already; the line break that ended the heading
  // line must not double up as an extra blank line. Same for the other blocks.
  text = text.replace(/<\/h([1-6])><br>/g, '</h$1>');
  text = text.replace(/<\/blockquote><br>/g, '</blockquote>');
  text = text.replace(/<hr><br>/g, '<hr>');
  text = stash.restore(text, 'C', (body) => `<code>${escapeText(body)}</code>`);
  text = stash.restore(text, 'I', (value) => {
    const img = JSON.parse(value) as { alt: string; src: string };
    return `<img src="${img.src}" alt="${escapeAttr(img.alt)}" style="${IMG_STYLE}" />`;
  });
  text = stash.restore(text, 'L', (value) => {
    const link = JSON.parse(value) as { label: string; src: string };
    return `<a href="${escapeAttr(link.src)}">${escapeText(link.label)}</a>`;
  });
  text = stash.restore(text, 'P', (tag) => tag);
  // Block tables/code fences shouldn't carry the <br> the surrounding blank lines left.
  text = text.replace(/<br>\s*(<table)/gi, '$1').replace(/(<\/table>)\s*<br>/gi, '$1');
  text = text.replace(/(<\/pre>)\s*<br>/gi, '$1');
  return text;
}

const MARKDOWN_EXT_RE = /\.(md|markdown|mdown|mkd)$/i;

// Characters that occupy no space and spell no word: the zero-width space the
// editor parks a caret on after shift+Enter (RichTextEditor's soft-break
// handling), its ZWNJ/ZWJ relatives, and a stray BOM. None of them match \s, so
// without this each one counts as a whole word of its own.
const INVISIBLE_RE = /[\u200B-\u200D\uFEFF]/g;

/** Word count of a note's HTML content (tags stripped). Shared by the editor's
 *  toolbar count and the note-list row so both agree.
 *
 *  Everything that isn't prose comes out first, because an empty note has to
 *  count zero and each of these made it count more:
 *   • the byline block — stored inside the note (byline.ts) but chrome, not
 *     writing, so "By Nate · Source: …" was reading as words the user never
 *     typed. A fresh note with a creator name set said "2 words".
 *   • &nbsp; and friends — an entity is one token to a split on whitespace, so
 *     a note holding only "&nbsp;" counted as a word and "a&nbsp;b" as one.
 *   • zero-width characters — see INVISIBLE_RE. One shift+Enter was +1 word. */
export function wordCount(html: string): number {
  const body = (html || '').replace(BYLINE_RE, ' ');
  const text = decodeHtmlEntities(stripTags(body, ' ')).replace(INVISIBLE_RE, '');
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

/** Which on-disk serialization an extension implies. */
export function formatKind(ext: string): 'md' | 'txt' | 'html' | 'docx' {
  const e = ext.toLowerCase();
  if (/\.(md|markdown|mdown|mkd)$/.test(e)) return 'md';
  if (/\.(txt|text)$/.test(e)) return 'txt';
  if (/\.docx$/.test(e)) return 'docx';
  return 'html';
}

/** Raw disk content -> editor HTML, based on the file's extension. Media paths
 *  stored on disk are mapped back to the app's `/__media/…` URLs. .docx is
 *  NOT handled here — it needs an async mammoth conversion, done by the
 *  caller (useNotes.ts's loadWorkspaceContents) before this would ever run. */
export function contentFromDisk(fileName: string, raw: string): string {
  const withMedia = rewriteMediaFromDisk(raw);
  return MARKDOWN_EXT_RE.test(fileName) ? markdownToHtml(withMedia) : withMedia;
}

/** First embedded media in a note's HTML (or markdown) content, if any. */
export function extractFirstMedia(content: string): MediaAttachment | null {
  if (!content) return null;
  const tag = /<(img|audio|video)[^>]*?src=["']([^"']+)["']/i.exec(content);
  if (tag) {
    const name = tag[1].toLowerCase();
    return { kind: name === 'img' ? 'image' : (name as MediaKind), src: tag[2] };
  }
  // Generic file attachment chip.
  const attach = /<a[^>]*class=["'][^"']*vx-attach[^"']*["'][^>]*>/i.exec(content);
  if (attach) {
    const src = /href=["']([^"']+)["']/i.exec(attach[0])?.[1] || '';
    const name = /data-name=["']([^"']*)["']/i.exec(attach[0])?.[1] || 'file';
    return { kind: 'file', src, name };
  }
  const mdImg = /!\[[^\]]*\]\(([^)\s]+)\)/.exec(content);
  if (mdImg) return { kind: 'image', src: mdImg[1] };
  return null;
}

export const hasEmbeddedMedia = (content: string): boolean => extractFirstMedia(content) !== null;
