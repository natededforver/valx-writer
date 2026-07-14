// Workspace-wide note search for the NoteList search box. Pure text logic —
// no DOM — so it can run against notes from any folder/tag filter and be
// unit-tested without a browser.

export interface SearchHit {
  noteId: string;
  title: string;
  /** 0-based ordinal of this match within the note's body plain text; -1 for a title-only hit. */
  occurrence: number;
  snippet: { before: string; match: string; after: string };
  inTitle: boolean;
}

interface SearchableNote {
  id: string;
  title: string;
  content: string;
}

const MAX_HITS = 200;
const SNIPPET_RADIUS = 40;

/** Same normalization NoteList uses for its body preview text. */
export function plainText(html: string): string {
  return (html || '').replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
}

const buildSnippet = (text: string, index: number, len: number) => {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + len + SNIPPET_RADIUS);
  return {
    before: (start > 0 ? '…' : '') + text.slice(start, index),
    match: text.slice(index, index + len),
    after: text.slice(index + len, end) + (end < text.length ? '…' : ''),
  };
};

/** Case-insensitive search across every note's title and body. Title hits are
 *  listed first; body hits carry the ordinal of the match within that note's
 *  plain-text body so the editor can jump to the exact occurrence. */
export function searchNotes(notes: SearchableNote[], query: string): SearchHit[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const qLower = q.toLowerCase();

  const titleHits: SearchHit[] = [];
  const bodyHits: SearchHit[] = [];

  for (const note of notes) {
    const title = note.title || 'Untitled Note';
    const titleLower = title.toLowerCase();
    const titleIdx = titleLower.indexOf(qLower);
    if (titleIdx !== -1) {
      titleHits.push({
        noteId: note.id,
        title,
        occurrence: -1,
        inTitle: true,
        snippet: buildSnippet(title, titleIdx, q.length),
      });
    }

    const body = plainText(note.content);
    const bodyLower = body.toLowerCase();
    let from = 0;
    let occurrence = 0;
    for (;;) {
      const idx = bodyLower.indexOf(qLower, from);
      if (idx === -1) break;
      bodyHits.push({
        noteId: note.id,
        title,
        occurrence,
        inTitle: false,
        snippet: buildSnippet(body, idx, q.length),
      });
      occurrence += 1;
      from = idx + q.length;
      if (titleHits.length + bodyHits.length >= MAX_HITS) break;
    }
    if (titleHits.length + bodyHits.length >= MAX_HITS) break;
  }

  return [...titleHits, ...bodyHits].slice(0, MAX_HITS);
}
