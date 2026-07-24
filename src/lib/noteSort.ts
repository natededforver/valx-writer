import { Note } from '../types';

export type NoteSort =
  | 'modified-desc'
  | 'modified-asc'
  | 'created-desc'
  | 'created-asc'
  | 'title-asc'
  | 'title-desc';

/** Menu order. */
export const NOTE_SORTS: NoteSort[] = [
  'modified-desc',
  'modified-asc',
  'created-desc',
  'created-asc',
  'title-asc',
  'title-desc',
];

export const SORT_LABELS: Record<NoteSort, string> = {
  'modified-desc': 'Date modified — newest',
  'modified-asc': 'Date modified — oldest',
  'created-desc': 'Date created — newest',
  'created-asc': 'Date created — oldest',
  'title-asc': 'Title A–Z',
  'title-desc': 'Title Z–A',
};

/** Sorts that order by a date rather than by title — the menu divides on this. */
export const IS_DATE_SORT = (s: NoteSort) => s.startsWith('modified') || s.startsWith('created');

// Numeric collation, so "2. Draft" comes before "10. Draft". A plain
// localeCompare compares digit-by-digit and puts "10." first, which is what
// made numbered workspaces look shuffled. 'base' sensitivity keeps the order
// case- and accent-insensitive ("2. bleah" sorts with "2. Bleah", not after
// every capitalised title).
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const compareTitles = (a: string, b: string): number => collator.compare(a, b);

const titleOf = (n: Note) => n.title || 'Untitled Note';
/** Notes that predate createdAt (or came from the web backend, which has no
 *  birth time) fall back to their last edit so they still sort sensibly. */
const createdOf = (n: Note) => n.createdAt ?? n.updatedAt;

/** Map values persisted by the three-option menu this replaced. */
export function normalizeSort(stored: string | null | undefined): NoteSort {
  if (stored && (NOTE_SORTS as string[]).includes(stored)) return stored as NoteSort;
  if (stored === 'oldest') return 'modified-asc';
  if (stored === 'title') return 'title-asc';
  return 'modified-desc';
}

/** Returns a new array; every comparator is total, so the order is stable
 *  across renders even when the primary key ties. */
export function sortNotes(notes: Note[], sort: NoteSort = 'modified-desc'): Note[] {
  const byTitle = (a: Note, b: Note) => compareTitles(titleOf(a), titleOf(b));
  const byNewest = (a: Note, b: Note) => b.updatedAt - a.updatedAt;
  const out = [...notes];
  switch (sort) {
    case 'title-asc':
      out.sort((a, b) => byTitle(a, b) || byNewest(a, b));
      break;
    case 'title-desc':
      out.sort((a, b) => byTitle(b, a) || byNewest(a, b));
      break;
    case 'created-asc':
      out.sort((a, b) => createdOf(a) - createdOf(b) || byTitle(a, b));
      break;
    case 'created-desc':
      out.sort((a, b) => createdOf(b) - createdOf(a) || byTitle(a, b));
      break;
    case 'modified-asc':
      out.sort((a, b) => a.updatedAt - b.updatedAt || byTitle(a, b));
      break;
    default:
      out.sort((a, b) => b.updatedAt - a.updatedAt || byTitle(a, b));
      break;
  }
  return out;
}
