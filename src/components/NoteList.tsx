import React, { useMemo, useState } from 'react';
import { Note, FilterState } from '../types';
import { Bookmark, ChevronDown, ChevronRight } from 'lucide-react';
import { wordCount } from '../lib/format';
import { NoteSort, sortNotes } from '../lib/noteSort';

export interface NoteListOpts {
  sort?: NoteSort;
  bookmarkedOnly?: boolean;
  bookmarkedIds?: string[];
}

/** Filter + sort notes for a sidebar container (All Notes, folder, tag, trash). */
export function filterNotesForContainer(notes: Note[], filter: FilterState, opts: NoteListOpts = {}): Note[] {
  let filtered = notes;
  if (filter.type === 'trash') {
    filtered = notes.filter(n => n.isTrash);
  } else {
    filtered = notes.filter(n => !n.isTrash);
    if (filter.type === 'all') {
      filtered = filtered.filter(n => !n.folderId);
    // Tag filter intentionally spans all folders — not restricted to current folder.
    } else if (filter.type === 'tag') {
      filtered = filtered.filter(n => n.tags.includes(filter.tag));
    } else if (filter.type === 'folder') {
      filtered = filtered.filter(
        n => n.folderId === filter.folderId || (n.folderId && n.folderId.startsWith(filter.folderId + '/'))
      );
    }
  }
  if (opts.bookmarkedOnly) {
    const set = new Set(opts.bookmarkedIds ?? []);
    filtered = filtered.filter(n => set.has(n.id));
  }
  return sortNotes(filtered, opts.sort);
}

interface NoteDropdownListProps {
  notes: Note[];
  selectedNoteIds: string[];
  onSelectNotes: (ids: string[]) => void;
  noteExtensions?: Record<string, string>;
  bookmarkedIds?: string[];
  onToggleBookmark?: (id: string) => void;
  onOpenNote?: (id: string) => void;
  emptyLabel?: string;
  /** Active sort — a row shows the created date while sorting by it, so the
   *  order the list is in is the order of the dates you can see. */
  sort?: NoteSort;
}

/** Compact note rows rendered inside an expanded All Notes / group dropdown. */
export function NoteDropdownList({
  notes,
  selectedNoteIds,
  onSelectNotes,
  noteExtensions = {},
  bookmarkedIds = [],
  onToggleBookmark,
  onOpenNote,
  emptyLabel = 'No notes',
  sort = 'modified-desc',
}: NoteDropdownListProps) {
  const showCreated = sort.startsWith('created');
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const bookmarkedSet = useMemo(() => new Set(bookmarkedIds), [bookmarkedIds]);

  const handleNoteClick = (e: React.MouseEvent | React.KeyboardEvent, id: string) => {
    if ('ctrlKey' in e && (e.ctrlKey || e.metaKey)) {
      const newSelection = selectedNoteIds.includes(id)
        ? selectedNoteIds.filter(selectedId => selectedId !== id)
        : [...selectedNoteIds, id];
      onSelectNotes(newSelection);
      setLastSelectedId(id);
    } else if ('shiftKey' in e && e.shiftKey && lastSelectedId) {
      const currentIndex = notes.findIndex(n => n.id === id);
      const lastIndex = notes.findIndex(n => n.id === lastSelectedId);
      if (currentIndex !== -1 && lastIndex !== -1) {
        const start = Math.min(currentIndex, lastIndex);
        const end = Math.max(currentIndex, lastIndex);
        const rangeIds = notes.slice(start, end + 1).map(n => n.id);
        onSelectNotes(Array.from(new Set([...selectedNoteIds, ...rangeIds])));
      }
    } else {
      onSelectNotes([id]);
      setLastSelectedId(id);
    }
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    let dragIds = selectedNoteIds;
    if (!selectedNoteIds.includes(id)) {
      onSelectNotes([id]);
      setLastSelectedId(id);
      dragIds = [id];
    }
    e.dataTransfer.setData('application/x-bear-notes', JSON.stringify(dragIds));
    e.dataTransfer.effectAllowed = 'move';
  };

  const formatDate = (ts: number) => {
    const date = new Date(ts);
    const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${dateStr}, ${timeStr}`;
  };

  if (notes.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500 italic">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="py-0.5">
      {notes.map(note => {
        const isSelected = selectedNoteIds.includes(note.id);
        const isBookmarked = bookmarkedSet.has(note.id);
        const ext = noteExtensions[note.id];
        return (
          <div
            key={note.id}
            role="button"
            tabIndex={0}
            onClick={(e) => handleNoteClick(e, note.id)}
            onDoubleClick={() => onOpenNote?.(note.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNoteClick(e, note.id); } }}
            draggable
            onDragStart={(e) => handleDragStart(e, note.id)}
            className={`group relative w-full text-left pl-3 pr-2 py-2 transition-colors cursor-pointer outline-none ${isSelected ? 'bg-slate-900/8 dark:bg-white/8' : 'hover:bg-slate-900/5 dark:hover:bg-white/5'}`}
          >
            {onToggleBookmark && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleBookmark(note.id); }}
                title={isBookmarked ? 'Remove bookmark' : 'Bookmark this note'}
                className={`absolute top-1.5 right-1.5 p-0.5 rounded transition-opacity ${isBookmarked ? 'opacity-100 text-[#32CD32]' : 'opacity-0 group-hover:opacity-100 focus:opacity-100 text-slate-400 hover:text-[#32CD32]'}`}
              >
                <Bookmark size={12} fill={isBookmarked ? 'currentColor' : 'none'} />
              </button>
            )}
            <div className="font-medium text-sm text-slate-900 dark:text-white truncate pr-5">
              {note.title || 'Untitled Note'}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className="text-[10px] text-slate-400 dark:text-slate-500"
                title={showCreated ? 'Created' : 'Last edited'}
              >
                {formatDate(showCreated ? note.createdAt ?? note.updatedAt : note.updatedAt)}
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {wordCount(note.content)} words
              </span>
              {ext && (
                <span className="text-[9px] font-mono text-[#2eb82e] dark:text-[#32CD32] bg-[#32CD32]/10 px-1 py-px rounded-sm">
                  {ext}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface BookmarkedNotesPanelProps {
  notes: Note[];
  bookmarkedIds: string[];
  selectedNoteIds: string[];
  onSelectNotes: (ids: string[]) => void;
  noteExtensions?: Record<string, string>;
  onToggleBookmark?: (id: string) => void;
  onOpenNote?: (id: string) => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  sort?: NoteSort;
}

/** Foldable bookmark rail in the sidebar. */
export function BookmarkedNotesPanel({
  notes,
  bookmarkedIds,
  selectedNoteIds,
  onSelectNotes,
  noteExtensions,
  onToggleBookmark,
  onOpenNote,
  expanded = true,
  onToggleExpanded,
  sort = 'modified-desc',
}: BookmarkedNotesPanelProps) {
  const bookmarkedSet = useMemo(() => new Set(bookmarkedIds), [bookmarkedIds]);
  // Bookmarks used to be pinned to recently-edited regardless of the sidebar's
  // sort; they follow the same order as every other list now.
  const bookmarkedNotes = useMemo(
    () => sortNotes(notes.filter(n => !n.isTrash && bookmarkedSet.has(n.id)), sort),
    [notes, bookmarkedSet, sort]
  );

  return (
    <div className="mb-1">
      <button
        onClick={onToggleExpanded}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-900/5 dark:hover:bg-white/5"
      >
        {expanded ? <ChevronDown size={14} className="text-slate-400 shrink-0" /> : <ChevronRight size={14} className="text-slate-400 shrink-0" />}
        <Bookmark size={16} className="text-[#32CD32]" fill={expanded ? 'currentColor' : 'none'} />
        <span className="flex-1 text-left font-medium">Bookmarks</span>
        <span className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">{bookmarkedNotes.length}</span>
      </button>
      {expanded && (
        <div className="ml-4 border-l border-slate-100 dark:border-neutral-800 pl-1">
          <NoteDropdownList
            notes={bookmarkedNotes}
            selectedNoteIds={selectedNoteIds}
            onSelectNotes={onSelectNotes}
            noteExtensions={noteExtensions}
            bookmarkedIds={bookmarkedIds}
            onToggleBookmark={onToggleBookmark}
            onOpenNote={onOpenNote}
            emptyLabel="No bookmarks yet"
            sort={sort}
          />
        </div>
      )}
    </div>
  );
}