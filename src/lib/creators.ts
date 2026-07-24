// Creators — the humans (and machines) a note's words can be attributed to.
// The primary creator is "you": a display name that replaces the default "Me"
// once set. Additional human authors each get a stable id, a name, a label in
// the native "Mark as" menu, and a colour in the byline below the title.
//
// All global (localStorage) — provenance is per-note (the marks live in the
// note body), but WHO the authors are is a workspace-wide list. Changes fire
// CREATORS_EVENT so the open editor's menu, byline and the native menu refresh
// without a reload.

export interface Creator { id: string; name: string; }

export const LS_CREATOR_ME = 'valx-author-me'; // primary creator's display name
export const LS_CREATORS = 'valx-creators';    // JSON Creator[] — extra humans
export const CREATORS_EVENT = 'valx-creators-changed';

const emit = () => window.dispatchEvent(new Event(CREATORS_EVENT));

export function loadCreators(): Creator[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_CREATORS) || '[]');
    return Array.isArray(v) ? v.filter((c) => c && typeof c.id === 'string') : [];
  } catch {
    return [];
  }
}
export function saveCreators(list: Creator[]): void {
  localStorage.setItem(LS_CREATORS, JSON.stringify(list));
  emit();
}

export const creatorMeName = (): string => (localStorage.getItem(LS_CREATOR_ME) || '').trim();
export function setCreatorMeName(name: string): void {
  localStorage.setItem(LS_CREATOR_ME, name);
  emit();
}

/** Menu/label form of the primary creator — the typed name, or "Me". */
export const creatorLabel = (): string => creatorMeName() || 'Me';

/** Resolve a human-author id to its name (empty string if it was removed). */
export const authorName = (id: string): string => loadCreators().find((c) => c.id === id)?.name.trim() || '';

export const newCreatorId = (): string => 'a' + Math.random().toString(36).slice(2, 9);

/** Ordered (label, kind) pairs for the native "Mark as" menu: the creator, then
 *  each human author, then AI and Other Website. Kinds: me · author:<id> · ai · web. */
export function markAsItems(): [string, string][] {
  return [
    [creatorLabel(), 'me'],
    ...loadCreators().map((c) => [c.name.trim() || 'Author', `author:${c.id}`] as [string, string]),
    ['AI', 'ai'],
    ['Other Website…', 'web'],
  ];
}
