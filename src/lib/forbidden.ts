// Forbidden words — a personal list of words the writer is trying not to use.
// Managed from Words > Forbidden Words…; matches are greyed out in the editor
// so they read as struck from the page without being removed from it.
//
// Global (localStorage), like the dictionary and the creators list: the list is
// about how you write, not about one note. Changes fire FORBIDDEN_EVENT so the
// open editor repaints without a reload.
//
// Nothing here touches the note's HTML. The greying is painted with the CSS
// Custom Highlight API (see paintForbidden in RichTextEditor), so a forbidden
// word leaves no markup behind, never reaches the .md on disk, and stops being
// grey the moment it comes off this list.

export const LS_FORBIDDEN = 'valx-forbidden-words';
export const FORBIDDEN_EVENT = 'valx-forbidden-changed';

const emit = () => window.dispatchEvent(new Event(FORBIDDEN_EVENT));

/** One word: letters and digits, optionally joined by an apostrophe or hyphen
 *  ("don't", "state-of-the-art"). Symbols and punctuation are never part of a
 *  word, which is what keeps a bare "!" or "—" from ever being matched, and
 *  what makes "damn," match the entry "damn". */
const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

/** Case-folded form used on both sides of a comparison. */
export const normalizeWord = (s: string): string => s.toLowerCase();

export interface WordToken { start: number; end: number; norm: string }

/** Word tokens of `text`, as [start, end) offsets plus the folded form.
 *  Everything between tokens — spaces, punctuation, symbols — is skipped. */
export function wordTokens(text: string): WordToken[] {
  const out: WordToken[] = [];
  const re = new RegExp(WORD_RE.source, WORD_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ start: m.index, end: m.index + m[0].length, norm: normalizeWord(m[0]) });
  }
  return out;
}

export function loadForbidden(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_FORBIDDEN) || '[]');
    return Array.isArray(v) ? v.filter((w): w is string => typeof w === 'string' && !!w.trim()) : [];
  } catch {
    return [];
  }
}

export function saveForbidden(list: string[]): void {
  localStorage.setItem(LS_FORBIDDEN, JSON.stringify(list));
  emit();
}

/** Add an entry, keeping the list case-insensitively unique and sorted.
 *  Returns false when the entry has no word content at all ("!!!", "  "), which
 *  is the one input that could never match anything. */
export function addForbidden(entry: string): boolean {
  const trimmed = entry.trim();
  if (!trimmed || wordTokens(trimmed).length === 0) return false;
  const list = loadForbidden();
  if (list.some((w) => normalizeWord(w) === normalizeWord(trimmed))) return true;
  saveForbidden([...list, trimmed].sort((a, b) => a.localeCompare(b)));
  return true;
}

export function removeForbidden(entry: string): void {
  saveForbidden(loadForbidden().filter((w) => normalizeWord(w) !== normalizeWord(entry)));
}

/** Entries reduced to their word tokens, longest first.
 *  An entry may be a phrase ("very unique"); it is matched as consecutive
 *  words, so the punctuation a writer happens to put between them does not
 *  break the match. Longest-first ordering means "very unique" wins over a
 *  bare "very" at the same position. */
export function forbiddenPhrases(entries: string[]): string[][] {
  return entries
    .map((e) => wordTokens(e).map((t) => t.norm))
    .filter((p) => p.length > 0)
    .sort((a, b) => b.length - a.length);
}

/** Spans of `text` covered by a forbidden entry, as [start, end) offsets.
 *  Non-overlapping: once a match is taken, scanning resumes after it. */
export function forbiddenSpans(text: string, phrases: string[][]): { start: number; end: number }[] {
  if (phrases.length === 0) return [];
  const toks = wordTokens(text);
  const out: { start: number; end: number }[] = [];
  let i = 0;
  while (i < toks.length) {
    let hit = 0;
    for (const p of phrases) {
      if (i + p.length > toks.length) continue;
      let ok = true;
      for (let k = 0; k < p.length; k++) {
        if (toks[i + k].norm !== p[k]) { ok = false; break; }
      }
      if (ok) { hit = p.length; break; }
    }
    if (hit) {
      out.push({ start: toks[i].start, end: toks[i + hit - 1].end });
      i += hit;
    } else {
      i++;
    }
  }
  return out;
}
