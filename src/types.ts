export interface Folder {
  id: string;
  name: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  updatedAt: number;
  /** When the note first existed — the file's birth time on disk for imported
   *  notes, Date.now() for ones made in-app. Optional: notes from before this
   *  was tracked (and the web backend, which exposes no birth time) have none,
   *  and sort by updatedAt instead. */
  createdAt?: number;
  isTrash: boolean;
  folderId?: string | null;
  /** Per-note body text alignment; undefined = left (the default). */
  align?: 'left' | 'center' | 'right';
}

export type FilterState =
  | { type: 'all' }
  | { type: 'trash' }
  | { type: 'folder'; folderId: string }
  | { type: 'tag'; tag: string };

/** A "jump to this word" request from a search result click, threaded
 *  App -> Editor -> RichTextEditor. `nonce` makes repeat clicks on the same
 *  occurrence re-trigger the effect. */
export interface JumpTarget {
  noteId: string;
  query: string;
  occurrence: number;
  nonce: number;
}
