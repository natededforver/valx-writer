// World Mode Phase 4 — markdown links a Link Lasso wire adds to the end of its
// source note's content. Pure string helpers over note HTML (mirrors format.ts's
// entity-escaping so appended links survive the htmlToMarkdown/markdownToHtml
// round-trip the same way hand-written note links do).

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A round-trip through htmlToMarkdown -> markdownToHtml re-escapes '&' in the
// href (escapeAttr), so a literal '&' in the original href must also match its
// escaped form when searching already-persisted content.
const hrefPattern = (href: string) => escapeRegex(href).replace(/&/g, '(?:&(?:amp;)?)');

/** Href for a markdown link to a note file — e.g. "My Note.md" -> "My%20Note.md". */
export function linkHrefForNote(title: string, ext: string): string {
  return encodeURI(`${title || 'Untitled'}${ext}`);
}

/** True if content already contains an <a> whose href matches exactly (either raw or entity-escaped). */
export function hasNoteLink(content: string, href: string): boolean {
  return new RegExp(`<a\\b[^>]*\\shref=["']${hrefPattern(href)}["']`, 'i').test(content);
}

/** Appends `<p><a href="{href}">{title}</a></p>` at the end of content — always at the bottom,
 *  relocating it there if it already exists elsewhere (idempotent when already-last). */
export function appendNoteLink(content: string, title: string, href: string): string {
  const base = hasNoteLink(content, href) ? removeNoteLink(content, href) : content;
  return `${base}<p><a href="${escAttr(href)}">${escText(title || 'Untitled')}</a></p>`;
}

/** Removes any anchor matching this href — both the `<p>`-wrapped form we write and the bare-anchor
 *  form a link degrades to after an htmlToMarkdown/markdownToHtml round-trip. */
export function removeNoteLink(content: string, href: string): string {
  const pattern = hrefPattern(href);
  let out = content.replace(new RegExp(`<p[^>]*>\\s*<a\\b[^>]*\\shref=["']${pattern}["'][^>]*>[\\s\\S]*?<\\/a>\\s*<\\/p>`, 'gi'), '');
  out = out.replace(new RegExp(`(?:<br\\s*/?>)?<a\\b[^>]*\\shref=["']${pattern}["'][^>]*>[\\s\\S]*?<\\/a>`, 'gi'), '');
  return out;
}

/** Swaps a link's target (used when the destination note is renamed elsewhere): drops the old
 *  href's anchor and re-appends a fresh one at the bottom under the note's current title. */
export function retargetLink(content: string, oldHref: string, newTitle: string, newHref: string): string {
  return appendNoteLink(removeNoteLink(content, oldHref), newTitle, newHref);
}

/** A completed markdown link `[label](href)` sitting at the very end of `text`
 *  (i.e. the user just typed the closing paren) — the editor swaps it for a real
 *  anchor. Returns null when the tail isn't a complete link. */
export function parseTrailingMdLink(text: string): { label: string; href: string; matchLen: number } | null {
  const m = /\[([^[\]]+)\]\(([^()\s]+)\)$/.exec(text);
  return m ? { label: m[1], href: m[2], matchLen: m[0].length } : null;
}

/** Every note-link href referenced in content, decoded back from its entity-escaped (round-tripped)
 *  form so it compares equal to a freshly computed `linkHrefForNote(...)` value. */
export function extractNoteLinkHrefs(content: string): string[] {
  const hrefs: string[] = [];
  const re = /<a\b[^>]*\shref=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    hrefs.push(m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  }
  return hrefs;
}
