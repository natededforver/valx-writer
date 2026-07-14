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
  isTrash: boolean;
  folderId?: string | null;
  /** Per-note body text alignment; undefined = center (the default). */
  align?: 'left' | 'right';
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
