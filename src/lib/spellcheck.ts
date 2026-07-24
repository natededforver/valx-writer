// ---------------------------------------------------------------------------
// Spellchecking, front end. The OS webview's own checker is switched off (the
// editor carries spellcheck="false") because it exposes no way to choose a
// language, read its suggestions, or add a word to its dictionary — which is
// what "Add to Dictionary" needs. src-tauri/src/spellcheck.rs does the checking
// instead; this module tokenizes, batches, caches and paints.
//
// Outside Tauri (browser preview) every call degrades to "everything is spelled
// correctly" rather than throwing, so the editor behaves normally there.
// ---------------------------------------------------------------------------
import { isTauri } from './desktop';
import { LS_SPELLCHECK_ON, prefOn } from './prefs';

/** Fired when the user dictionary changes, so open editors re-check. */
export const DICTIONARY_EVENT = 'valx-dictionary-changed';

// Words already judged, so re-checking a document the user is typing into only
// asks the backend about words it has not seen. Cleared when the user
// dictionary changes (an added word must stop being reported).
const verdicts = new Map<string, boolean>();

async function call<T>(cmd: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  if (!isTauri) return fallback;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke(cmd, args)) as T;
  } catch {
    return fallback;
  }
}

// A "word" for spelling purposes: letters plus the apostrophes and hyphens that
// sit *inside* a word ("don't", "well-known"), never at its edges. Unicode-aware
// so accented prose isn't split into fragments and reported wholesale.
const WORD_RE = /\p{L}[\p{L}\p{M}'’-]*/gu;

export interface WordHit {
  word: string;
  node: Text;
  start: number;
  end: number;
}

/** Every word in `root`, with the text node and offsets needed to build a Range. */
export function scanWords(root: Node): WordHit[] {
  const hits: WordHit[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    // Skip anything inside a code block or a link — neither is prose, and
    // underlining identifiers and URLs is pure noise.
    if ((text.parentElement as HTMLElement | null)?.closest('code, pre, a')) continue;
    for (const m of text.data.matchAll(WORD_RE)) {
      const word = m[0].replace(/^['’-]+|['’-]+$/g, '');
      if (word.length < 2) continue; // single letters are never misspellings
      hits.push({ word, node: text, start: m.index!, end: m.index! + m[0].length });
    }
  }
  return hits;
}

/** Misspelled words out of `words`, consulting the cache before the backend. */
export async function checkWords(words: string[]): Promise<Set<string>> {
  const unknown = [...new Set(words)].filter((w) => !verdicts.has(w));
  if (unknown.length) {
    const bad = new Set(await call<string[]>('spell_check', { words: unknown }, []));
    for (const w of unknown) verdicts.set(w, !bad.has(w));
  }
  return new Set(words.filter((w) => verdicts.get(w) === false));
}

/** Correction candidates for one word, best first. */
export const suggest = (word: string): Promise<string[]> =>
  call<string[]>('spell_suggest', { word }, []);

/** Add to the user dictionary; the word stops being reported everywhere. */
export async function addWord(word: string): Promise<void> {
  await call<boolean>('spell_add_word', { word }, false);
  verdicts.clear();
  window.dispatchEvent(new CustomEvent(DICTIONARY_EVENT));
}

export async function removeWord(word: string): Promise<void> {
  await call<boolean>('spell_remove_word', { word }, false);
  verdicts.clear();
  window.dispatchEvent(new CustomEvent(DICTIONARY_EVENT));
}

export const userWords = (): Promise<string[]> => call<string[]>('spell_user_words', {}, []);

/** Ignore a word for this session only — cached as correct, never persisted. */
export function ignoreWord(word: string): void {
  verdicts.set(word, true);
  window.dispatchEvent(new CustomEvent(DICTIONARY_EVENT));
}

/**
 * Underline the misspellings in `root` using the CSS Custom Highlight API —
 * the same zero-DOM-mutation approach the #tag and done-task highlighting
 * already use here. Painting with Ranges rather than wrapping words in <span>s
 * is what keeps the editor's HTML (and therefore the saved file, the undo stack
 * and the caret) untouched by spellchecking.
 */
export async function paintMisspellings(root: HTMLElement): Promise<void> {
  const H = (window as any).Highlight;
  const registry = (CSS as any).highlights;
  if (!H || !registry) return;
  if (!prefOn(LS_SPELLCHECK_ON)) {
    registry.delete('vx-misspelled');
    return;
  }
  const hits = scanWords(root);
  const bad = await checkWords(hits.map((h) => h.word));
  if (!bad.size) {
    registry.delete('vx-misspelled');
    return;
  }
  const ranges: Range[] = [];
  for (const h of hits) {
    if (!bad.has(h.word)) continue;
    // The node can have been replaced while the check was in flight (the user
    // kept typing) — a stale node would throw on setStart.
    if (!root.contains(h.node) || h.end > h.node.data.length) continue;
    const r = document.createRange();
    r.setStart(h.node, h.start);
    r.setEnd(h.node, h.end);
    ranges.push(r);
  }
  if (ranges.length) registry.set('vx-misspelled', new H(...ranges));
  else registry.delete('vx-misspelled');
}

/** The misspelled word under a point, if any — drives the right-click menu. */
export async function wordAtPoint(
  root: HTMLElement,
  x: number,
  y: number
): Promise<{ word: string; range: Range } | null> {
  const pos = (document as any).caretRangeFromPoint?.(x, y) as Range | null;
  if (!pos || !root.contains(pos.startContainer) || pos.startContainer.nodeType !== 3) return null;
  const text = pos.startContainer as Text;
  const offset = pos.startOffset;
  for (const m of text.data.matchAll(WORD_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (offset < start || offset > end) continue;
    const word = m[0].replace(/^['’-]+|['’-]+$/g, '');
    if (word.length < 2) return null;
    const bad = await checkWords([word]);
    if (!bad.has(word)) return null;
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, end);
    return { word, range };
  }
  return null;
}
