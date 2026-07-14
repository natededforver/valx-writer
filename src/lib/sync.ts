import { Note, Folder } from '../types';

// ---------------------------------------------------------------------------
// Naming/identity helpers: one shared, idempotent sanitizer for everything the
// app writes to disk. fileKeys are derived from POST-sanitization on-disk names
// so the key computed at save time always equals the key derived from the next
// directory scan. Keys are extension-less (the format selector is a rendering
// preference, not identity) and case-folded (Windows paths are
// case-insensitive).
// ---------------------------------------------------------------------------

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function sanitizeSegment(seg: string): string {
  let s = String(seg)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/^\.+/, (m) => '_'.repeat(m.length))
    .replace(/[. ]+$/, '');
  if (WINDOWS_RESERVED.test(s)) s = '_' + s;
  return s || '_';
}

export const sanitizePath = (path: string): string =>
  String(path).split('/').filter(Boolean).map(sanitizeSegment).join('/');

export const foldName = (s: string): string => s.normalize('NFC').toLowerCase();

// Recognizes every extension the app opens (prose + code), so code files keep
// their real extension through the filemap/save path. Must stay in sync with
// NOTE_EXT_RE (main.js) and the web reader regex (useFileSystem.ts).
export function splitExt(fileName: string): { base: string; ext: string } {
  const m = fileName.match(/^(.*)(\.(?:md|markdown|mdown|mkd|txt|text|html?|css|js|mjs|cjs|jsx|ts|tsx|py))$/i);
  return m ? { base: m[1], ext: m[2].toLowerCase() } : { base: fileName, ext: '' };
}

// dirPath: '' for root or 'a/b' as returned by readDirectory; fileName incl. ext.
export function fileKeyFromDisk(dirPath: string, fileName: string): string {
  const { base } = splitExt(fileName);
  const segs = String(dirPath).split('/').filter(Boolean).map((s) => foldName(sanitizeSegment(s)));
  segs.push(foldName(sanitizeSegment(base)));
  return segs.join('/');
}

// The prospective key a note would occupy on disk, from its title + folder.
export function fileKeyForNote(note: Note, folderName: string | null): string {
  const dir = folderName ? sanitizePath(folderName) : '';
  return fileKeyFromDisk(dir, sanitizeSegment(note.title || 'Untitled'));
}

export const FOLDER_TOMB_PREFIX = 'folder:';

// Tombstones record deletions locally so an externally-removed file (or a note
// deleted in a prior session) is not resurrected by the next directory scan.
export type TombstoneMap = Record<string, number>;

// Note/Folder state types. The optional fileKey is the extension-less, folded
// key of the disk file a note owns; it is retained on notes derived from disk.
export interface SyncNote extends Note {
  fileKey?: string;
}

export interface SyncFolder extends Folder {
  migratedTo?: string;
}
