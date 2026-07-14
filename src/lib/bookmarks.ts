// Pure helpers for the bookmarked-notes id list (persisted to localStorage by
// useNotes, workspace-scoped). Kept separate from React/localStorage so the
// add/toggle/prune logic can be unit-tested directly.

export function toggleBookmark(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** Drop bookmark ids that no longer correspond to a live note. */
export function pruneBookmarks(ids: string[], liveIds: Set<string>): string[] {
  return ids.filter((id) => liveIds.has(id));
}
