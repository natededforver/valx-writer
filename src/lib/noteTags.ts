// World Mode Phase 5 — a text card wired to a note-backed node asserts a
// '#tag' on that note's content. Pure string helpers, mirroring noteLinks.ts's
// shape and the same htmlToMarkdown/markdownToHtml round-trip discipline.
// Tag matching mirrors useNotes.parseTags: '#' + [\w-]+, lowercased.

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Card text -> canonical tag ('#my-label'), matching useNotes.parseTags's charset/lowercasing. Null for an empty/symbol-only slug. */
export function tagForCard(text: string): string | null {
  const slug = text.trim().toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? `#${slug}` : null;
}

// Tag chars are [\w-], so `\b` misbehaves right after a trailing '-' — a
// negative lookahead for another tag char is the reliable boundary.
const tagPattern = (tag: string) => `${escapeRegex(tag)}(?![\\w-])`;

/** True if content contains this tag, case-insensitively (not a prefix of a longer tag) —
 *  matches useNotes.parseTags treating '#Tag' and '#tag' as the same tag. */
export function hasTag(content: string, tag: string): boolean {
  return new RegExp(tagPattern(tag), 'i').test(content);
}

/** Appends `<p>{tag}</p>` at the end of content; no-op if the tag already exists. */
export function appendTag(content: string, tag: string): string {
  if (hasTag(content, tag)) return content;
  return `${content}<p>${tag}</p>`;
}

/** Removes any occurrence of this exact tag — both the `<p>`-wrapped form we write and the bare-text
 *  form a tag degrades to after an htmlToMarkdown/markdownToHtml round-trip. */
export function removeTag(content: string, tag: string): string {
  const pattern = tagPattern(tag);
  let out = content.replace(new RegExp(`<p[^>]*>\\s*${pattern}\\s*<\\/p>`, 'gi'), '');
  out = out.replace(new RegExp(`(?:<br\\s*/?>)?${pattern}`, 'gi'), '');
  return out;
}
