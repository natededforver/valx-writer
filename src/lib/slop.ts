// Slop detector — provenance marks for text the user didn't write themselves.
// A slop mark is `<mark class="vx-slop" data-slop="paste|ai|web">` wrapping ONE
// word. Marks ride through .md files verbatim as inline HTML (same precedent
// as audio/video tags in format.ts), so provenance survives reloads with no
// side-channel storage. Marks persist through any amount of editing — the
// only way to remove one is the "Mark as me" unwrap in the editor.
// ponytail: ~40 bytes of markup per marked word on disk; compact token syntax
// only if huge pastes make file size a real complaint.

export type SlopType = 'paste' | 'ai' | 'web';

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Matches one slop mark (marks never nest). Shared by format.ts stashing.
 *  Tolerates extra classes (e.g. mid-edit state) after "vx-slop" so a stray
 *  class never breaks the stash and gets the mark stripped by autosave. */
export const SLOP_MARK_RE = /<mark class="vx-slop[^"]*"[^>]*>[\s\S]*?<\/mark>/gi;

/** Non-whitespace token spans within text, as [start, end) offsets. */
export function wordSpans(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

export const slopMarkHtml = (type: SlopType, word: string): string =>
  `<mark class="vx-slop" data-slop="${type}">${escText(word)}</mark>`;

/** Plain clipboard text -> HTML with every word wrapped in a slop mark;
 *  newlines become <br>, spaces after words included in mark for visual continuity. */
export function slopWrapText(text: string, type: SlopType): string {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/\S+\s*/g, (w) => slopMarkHtml(type, w)))
    .join('<br>');
}

/** Reference line appended below the note for 'Other Websites' provenance —
 *  a markdown link after the round-trip when a URL was given, plain text otherwise. */
export function webReferenceHtml(site: string, url?: string): string {
  return url
    ? `<p>Source: <a href="${escAttr(url)}">${escText(site)}</a></p>`
    : `<p>Source: ${escText(site)}</p>`;
}
