import React, { useMemo, useState } from 'react';
import { Note, FilterState, Folder } from '../types';
import { WorldMeta } from '../lib/world';
import { FileText, Trash2, Hash, Moon, Sun, Plus, Folder as FolderIcon, Cloud, RefreshCw, Repeat, Settings, Globe, Search, X, ChevronDown, ChevronRight } from 'lucide-react';
import { sessionGreeting } from '../lib/greeting';
import { filterNotesForContainer, NoteDropdownList, BookmarkedNotesPanel } from './NoteList';
import { searchNotes, SearchHit } from '../lib/search';

interface SidebarProps {
  filter: FilterState;
  setFilter: (f: FilterState) => void;
  tags: string[];
  folders: Folder[];
  onAddFolder: (name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveNotesToFolder: (ids: string[], folderId: string | null) => void;
  onMoveNotesToTrash: (ids: string[]) => void;
  isDarkMode: boolean;
  setIsDarkMode: (b: boolean) => void;
  workspaceHandle?: any;
  selectWorkspace?: () => Promise<any>;
  fileFormat?: string;
  onOpenFormatConverter?: () => void;
  onOpenSettings?: () => void;
  worlds?: WorldMeta[];
  activeWorldId?: string | null;
  inWorldMode?: boolean;
  onOpenWorld?: (id: string) => void;
  onAddWorld?: (name: string) => void;
  onDeleteWorld?: (id: string) => void;
  notes: Note[];
  selectedNoteIds: string[];
  onSelectNotes: (ids: string[]) => void;
  onAddNote: () => void;
  noteExtensions?: Record<string, string>;
  bookmarkedIds?: string[];
  onToggleBookmark?: (id: string) => void;
  onSearchNavigate?: (hit: SearchHit, query: string) => void;
  onOpenNote?: (id: string) => void;
  oneDriveConnected?: boolean;
  oneDriveSyncing?: boolean;
  /** Not connected — clicking the button should open Settings to the OneDrive
   *  section (connect/disconnect both live there now, not in the sidebar). */
  onGoToOneDriveSettings?: () => void;
  onSyncOneDrive?: () => void;
  className?: string;
}

function expandKeyForFilter(filter: FilterState): string {
  if (filter.type === 'all') return 'all';
  if (filter.type === 'trash') return 'trash';
  if (filter.type === 'folder') return `folder:${filter.folderId}`;
  return `tag:${filter.tag}`;
}

export function Sidebar({
  filter, setFilter, tags, folders, onAddFolder, onDeleteFolder, onMoveNotesToFolder, onMoveNotesToTrash,
  isDarkMode, setIsDarkMode, workspaceHandle, selectWorkspace, fileFormat, onOpenFormatConverter, onOpenSettings,
  worlds = [], activeWorldId = null, inWorldMode = false, onOpenWorld, onAddWorld, onDeleteWorld,
  notes, selectedNoteIds, onSelectNotes, onAddNote, noteExtensions = {}, bookmarkedIds = [], onToggleBookmark, onSearchNavigate, onOpenNote,
  oneDriveConnected = false, oneDriveSyncing = false, onGoToOneDriveSettings, onSyncOneDrive,
  className = '',
}: SidebarProps) {
  const isTrash = filter.type === 'trash' && !inWorldMode;
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isAddingWorld, setIsAddingWorld] = useState(false);
  const [newWorldName, setNewWorldName] = useState('');
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOverTrash, setDragOverTrash] = useState(false);
  const [query, setQuery] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set(['all', 'bookmarks']));

  const searchQuery = query.trim();
  const isSearching = searchQuery.length >= 2;
  const searchResults = useMemo(() => {
    if (!isSearching) return [];
    return searchNotes(notes.filter(n => !n.isTrash), searchQuery);
  }, [notes, searchQuery, isSearching]);

  const toggleExpanded = (key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectContainer = (nextFilter: FilterState) => {
    setFilter(nextFilter);
    const key = expandKeyForFilter(nextFilter);
    setExpandedKeys(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  const handleContainerClick = (nextFilter: FilterState) => {
    const key = expandKeyForFilter(nextFilter);
    // In World Mode, setFilter also exits World Mode (App.handleSetFilter) — but
    // the whole point of clicking "All Notes"/a group here is to expand it and
    // drag a note onto the canvas, so just toggle the list open instead.
    if (!inWorldMode) setFilter(nextFilter);
    toggleExpanded(key);
  };

  const handleAddWorldSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newWorldName.trim() && onAddWorld) {
      onAddWorld(newWorldName.trim());
      setNewWorldName('');
      setIsAddingWorld(false);
    }
  };

  const handleAddFolderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newFolderName.trim()) {
      onAddFolder(newFolderName.trim());
      setNewFolderName('');
      setIsAddingFolder(false);
    }
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (targetId === 'trash') {
      setDragOverTrash(true);
    } else {
      setDragOverFolderId(targetId);
    }
  };

  const handleDragLeave = (_e: React.DragEvent, targetId: string) => {
    if (targetId === 'trash') {
      setDragOverTrash(false);
    } else {
      setDragOverFolderId(null);
    }
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (targetId === 'trash') {
      setDragOverTrash(false);
    } else {
      setDragOverFolderId(null);
    }

    try {
      const data = e.dataTransfer.getData('application/x-bear-notes');
      if (data) {
        const noteIds = JSON.parse(data) as string[];
        if (targetId === 'trash') {
          onMoveNotesToTrash(noteIds);
        } else {
          onMoveNotesToFolder(noteIds, targetId === 'all' ? null : targetId);
        }
      }
    } catch (err) {
      console.error('Invalid drop data', err);
    }
  };

  const [greet] = useState(() => sessionGreeting());

  const allNotes = useMemo(() => filterNotesForContainer(notes, { type: 'all' }), [notes]);
  const sortedFolders = useMemo(() => [...folders].sort((a, b) => a.name.localeCompare(b.name)), [folders]);

  const renderSearchResult = (hit: SearchHit, i: number) => (
    <button
      key={`${hit.noteId}-${hit.inTitle ? 't' : 'b'}-${hit.occurrence}-${i}`}
      onClick={() => onSearchNavigate?.(hit, searchQuery)}
      className="w-full text-left px-3 py-2 hover:bg-slate-900/5 dark:hover:bg-white/5 transition-colors"
    >
      <div className="font-medium text-sm text-slate-900 dark:text-white truncate">{hit.title}</div>
      <p className="text-xs text-slate-500 dark:text-slate-300 leading-relaxed break-words line-clamp-2 mt-0.5">
        {hit.snippet.before}
        <mark className="bg-[#32CD32]/25 text-inherit rounded px-0.5">{hit.snippet.match}</mark>
        {hit.snippet.after}
      </p>
    </button>
  );

  const Chevron = ({ expanded }: { expanded: boolean }) =>
    expanded
      ? <ChevronDown size={14} className="text-slate-400 shrink-0" />
      : <ChevronRight size={14} className="text-slate-400 shrink-0" />;

  return (
    <div className={`vx-glass-strong text-slate-700 dark:text-slate-200 flex flex-col h-full min-h-0 ${className}`}>
      <div className="vx-editor-scroll flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-2">
        <div className="flex items-center mb-4">
          <span className="text-lg font-medium tracking-wide text-slate-900 dark:text-white flex-1 truncate">{greet}</span>
        </div>

        <div className="mb-4">
          <div className="flex items-center gap-2 bg-slate-900/5 dark:bg-white/5 border border-slate-900/5 dark:border-white/5 rounded-lg px-2.5 py-1.5">
            <Search size={14} className="text-slate-500 dark:text-slate-300 shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              className="w-full bg-transparent border-none outline-none text-sm text-slate-800 dark:text-slate-200 placeholder-slate-500 dark:placeholder-slate-400"
            />
            {query && (
              <button onClick={() => setQuery('')} className="p-0.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 shrink-0">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {isSearching ? (
          <div className="mb-4">
            <div className="px-3 py-1 text-[10px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-widest">
              {searchResults.length} {searchResults.length === 1 ? 'result' : 'results'}
            </div>
            {searchResults.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-400 dark:text-slate-400 text-center">No matches found.</div>
            ) : (
              searchResults.map((hit, i) => renderSearchResult(hit, i))
            )}
          </div>
        ) : (
          <>
            {/* All Notes — expandable dropdown */}
            <div className="mb-1">
              <div
                className={`flex items-center transition-colors ${dragOverFolderId === 'all' ? 'bg-slate-200 dark:bg-neutral-800' : ''}`}
                onDragOver={(e) => handleDragOver(e, 'all')}
                onDragLeave={(e) => handleDragLeave(e, 'all')}
                onDrop={(e) => handleDrop(e, 'all')}
              >
                <button
                  onClick={() => handleContainerClick({ type: 'all' })}
                  className={`flex-1 flex items-center gap-2 px-3 py-2 text-sm transition-colors ${filter.type === 'all' && !inWorldMode ? 'bg-slate-900/8 dark:bg-white/8 text-slate-900 dark:text-white font-medium' : 'text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-slate-100 font-medium hover:bg-slate-900/5 dark:hover:bg-white/5'}`}
                >
                  <Chevron expanded={expandedKeys.has('all')} />
                  <FileText size={16} className={filter.type === 'all' && !inWorldMode ? 'text-slate-900 dark:text-white' : ''} />
                  <span className="flex-1 text-left">All Notes</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-400 tabular-nums">{allNotes.length}</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    // selectContainer's setFilter also exits World Mode (App.handleSetFilter) — a
                    // quick "new note" click here shouldn't yank the user off their canvas, so skip
                    // the filter change (and just expand All Notes) while a world is open.
                    if (inWorldMode) setExpandedKeys((prev) => new Set(prev).add('all'));
                    else selectContainer({ type: 'all' });
                    onAddNote();
                  }}
                  className="p-1.5 mr-1 text-slate-400 hover:text-[#32CD32] transition-colors hover:bg-slate-50 dark:hover:bg-neutral-900"
                  title="New note"
                >
                  <Plus size={14} />
                </button>
              </div>
              {expandedKeys.has('all') && (
                <div className="ml-4 border-l border-slate-100 dark:border-neutral-800 pl-1">
                  <NoteDropdownList
                    notes={allNotes}
                    selectedNoteIds={selectedNoteIds}
                    onSelectNotes={onSelectNotes}
                    noteExtensions={noteExtensions}
                    bookmarkedIds={bookmarkedIds}
                    onToggleBookmark={onToggleBookmark}
                    onOpenNote={onOpenNote}
                    emptyLabel="No notes yet"
                  />
                </div>
              )}
            </div>

            {onToggleBookmark && (
              <BookmarkedNotesPanel
                notes={notes}
                bookmarkedIds={bookmarkedIds}
                selectedNoteIds={selectedNoteIds}
                onSelectNotes={onSelectNotes}
                noteExtensions={noteExtensions}
                onToggleBookmark={onToggleBookmark}
                onOpenNote={onOpenNote}
                expanded={expandedKeys.has('bookmarks')}
                onToggleExpanded={() => toggleExpanded('bookmarks')}
              />
            )}

            {/* Groups — each folder is its own expandable dropdown */}
            <div className="mt-5">
              <div className="flex items-center justify-between px-3 text-xs font-bold text-slate-500 dark:text-slate-300 uppercase tracking-widest mb-2">
                <span>Groups</span>
                <button
                  onClick={() => setIsAddingFolder(true)}
                  className="hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                >
                  <Plus size={14} />
                </button>
              </div>

              <div className="space-y-0.5">
                {sortedFolders.map(folder => {
                  const folderKey = `folder:${folder.id}`;
                  const isSelected = filter.type === 'folder' && filter.folderId === folder.id;
                  const isExpanded = expandedKeys.has(folderKey);
                  const isDragOver = dragOverFolderId === folder.id;
                  const depth = (folder.name.match(/\//g) || []).length;
                  const baseName = folder.name.split('/').pop();
                  const folderNotes = filterNotesForContainer(notes, { type: 'folder', folderId: folder.id });

                  return (
                    <div key={folder.id}>
                      <div
                        className={`group flex items-center transition-colors ${isDragOver ? 'bg-slate-200 dark:bg-neutral-800' : ''}`}
                        onDragOver={(e) => handleDragOver(e, folder.id)}
                        onDragLeave={(e) => handleDragLeave(e, folder.id)}
                        onDrop={(e) => handleDrop(e, folder.id)}
                        style={{ paddingLeft: `${depth * 12}px` }}
                      >
                        <button
                          onClick={() => handleContainerClick({ type: 'folder', folderId: folder.id })}
                          className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 text-sm transition-colors ${isSelected ? 'bg-slate-900/8 dark:bg-white/8 text-slate-900 dark:text-white font-medium' : 'text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-900/5 dark:hover:bg-white/5'}`}
                        >
                          <Chevron expanded={isExpanded} />
                          <FolderIcon size={16} className={isSelected ? 'text-[#32CD32]' : 'text-slate-400'} />
                          <span className="flex-1 min-w-0 text-left truncate">{baseName}</span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-400 tabular-nums">{folderNotes.length}</span>
                        </button>
                        <button
                          onClick={() => onDeleteFolder(folder.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 mr-1 text-slate-400 hover:text-[#32CD32] transition-all"
                          title="Delete group"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="border-l border-slate-100 dark:border-neutral-800 pl-1" style={{ marginLeft: `${12 + depth * 12}px` }}>
                          <NoteDropdownList
                            notes={folderNotes}
                            selectedNoteIds={selectedNoteIds}
                            onSelectNotes={onSelectNotes}
                            noteExtensions={noteExtensions}
                            bookmarkedIds={bookmarkedIds}
                            onToggleBookmark={onToggleBookmark}
                            onOpenNote={onOpenNote}
                            emptyLabel="No notes in this group"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}

                {isAddingFolder && (
                  <form onSubmit={handleAddFolderSubmit} className="px-3 py-1.5">
                    <input
                      type="text"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="Group name"
                      className="w-full bg-white dark:bg-neutral-900 border-b border-slate-200 dark:border-neutral-800 px-2 py-1 text-sm text-slate-900 dark:text-white outline-none focus:border-[#32CD32]"
                      autoFocus
                      onBlur={() => {
                        if (!newFolderName.trim()) setIsAddingFolder(false);
                      }}
                    />
                  </form>
                )}
              </div>
            </div>

            {onOpenWorld && (
              <div className="mt-5">
                <div className="flex items-center justify-between px-3 text-xs font-bold text-slate-500 dark:text-slate-300 uppercase tracking-widest mb-2">
                  <span>Worlds</span>
                  <button
                    onClick={() => setIsAddingWorld(true)}
                    className="hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                </div>

                <div className="space-y-0.5">
                  {worlds.map(world => {
                    const isSelected = inWorldMode && activeWorldId === world.id;
                    return (
                      <div
                        key={world.id}
                        className="group flex items-center justify-between pr-2 transition-colors"
                      >
                        <button
                          onClick={() => onOpenWorld(world.id)}
                          className={`flex-1 min-w-0 flex items-center gap-3 px-3 py-1.5 text-sm transition-colors ${isSelected ? 'bg-slate-900/8 dark:bg-white/8 text-slate-900 dark:text-white font-medium' : 'text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-900/5 dark:hover:bg-white/5'}`}
                        >
                          <Globe size={16} className={isSelected ? 'text-[#32CD32]' : 'text-slate-400'} />
                          <span className="truncate min-w-0">{world.name}</span>
                        </button>
                        {onDeleteWorld && (
                          <button
                            onClick={() => onDeleteWorld(world.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-[#32CD32] transition-all"
                            title="Delete world"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    );
                  })}

                  {isAddingWorld && (
                    <form onSubmit={handleAddWorldSubmit} className="px-3 py-1.5">
                      <input
                        type="text"
                        value={newWorldName}
                        onChange={(e) => setNewWorldName(e.target.value)}
                        placeholder="World name"
                        className="w-full bg-white dark:bg-neutral-900 border-b border-slate-200 dark:border-neutral-800 px-2 py-1 text-sm text-slate-900 dark:text-white outline-none focus:border-[#32CD32]"
                        autoFocus
                        onBlur={() => {
                          if (!newWorldName.trim()) setIsAddingWorld(false);
                        }}
                      />
                    </form>
                  )}
                </div>
              </div>
            )}

            <div className="mt-5">
                <div className="flex items-center justify-between px-3 text-xs font-bold text-slate-500 dark:text-slate-300 uppercase tracking-widest mb-2">
                  <span>Tags</span>
                </div>
                <div className="space-y-0.5">
                  {tags.length === 0 && (
                    <div className="px-3 py-1.5 text-xs text-slate-400 dark:text-slate-500">No tags yet</div>
                  )}
                  {tags.map(tag => {
                    const tagKey = `tag:${tag}`;
                    const isSelected = filter.type === 'tag' && filter.tag === tag;
                    const isExpanded = expandedKeys.has(tagKey);
                    const tagNotes = filterNotesForContainer(notes, { type: 'tag', tag });

                    return (
                      <div key={tag}>
                        {/* Expands the note dropdown in-place; setFilter is skipped in World Mode
                            so clicking a tag never exits the canvas. */}
                        <button
                          onClick={() => handleContainerClick({ type: 'tag', tag })}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors ${isSelected ? 'bg-slate-900/8 dark:bg-white/8 text-slate-900 dark:text-white font-medium' : 'text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-900/5 dark:hover:bg-white/5'}`}
                        >
                          <Chevron expanded={isExpanded} />
                          <Hash size={16} className="text-[#32CD32]" />
                          <span className="flex-1 text-left">{tag}</span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-400 tabular-nums">{tagNotes.length}</span>
                        </button>
                        {isExpanded && (
                          <div className="ml-4 border-l border-slate-100 dark:border-neutral-800 pl-1">
                            <NoteDropdownList
                              notes={tagNotes}
                              selectedNoteIds={selectedNoteIds}
                              onSelectNotes={onSelectNotes}
                              noteExtensions={noteExtensions}
                              bookmarkedIds={bookmarkedIds}
                              onToggleBookmark={onToggleBookmark}
                              onOpenNote={onOpenNote}
                              emptyLabel="No notes with this tag"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

            {/* Trash — expandable dropdown */}
            <div className="mt-5 mb-2">
              <div
                className={`flex items-center transition-colors ${dragOverTrash ? 'bg-red-100 dark:bg-red-900/30' : ''}`}
                onDragOver={(e) => handleDragOver(e, 'trash')}
                onDragLeave={(e) => handleDragLeave(e, 'trash')}
                onDrop={(e) => handleDrop(e, 'trash')}
              >
                <button
                  onClick={() => handleContainerClick({ type: 'trash' })}
                  className={`flex-1 flex items-center gap-2 px-3 py-2 text-sm transition-colors ${isTrash ? 'bg-slate-900/8 dark:bg-white/8 text-slate-900 dark:text-white font-medium' : dragOverTrash ? 'text-red-600' : 'text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-slate-100 font-medium hover:bg-slate-900/5 dark:hover:bg-white/5'}`}
                >
                  <Chevron expanded={expandedKeys.has('trash')} />
                  <Trash2 size={16} className={isTrash ? 'text-slate-900 dark:text-white' : ''} />
                  <span className="flex-1 text-left">Trash</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-400 tabular-nums">
                    {filterNotesForContainer(notes, { type: 'trash' }).length}
                  </span>
                </button>
              </div>
              {expandedKeys.has('trash') && (
                <div className="ml-4 border-l border-slate-100 dark:border-neutral-800 pl-1">
                  <NoteDropdownList
                    notes={filterNotesForContainer(notes, { type: 'trash' })}
                    selectedNoteIds={selectedNoteIds}
                    onSelectNotes={onSelectNotes}
                    noteExtensions={noteExtensions}
                    bookmarkedIds={bookmarkedIds}
                    onToggleBookmark={onToggleBookmark}
                    onOpenNote={onOpenNote}
                    emptyLabel="Trash is empty"
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="px-3 py-2 flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          {selectWorkspace && (
            <>
              {workspaceHandle ? (
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    onDoubleClick={selectWorkspace}
                    className="text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none truncate"
                    title="Double click to change directory"
                  >
                    Local Directory
                  </span>
                  {onOpenFormatConverter && (
                    <button
                      onClick={onOpenFormatConverter}
                      className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-300 hover:text-[#32CD32] transition-colors shrink-0"
                      title="Convert file format"
                    >
                      <Repeat size={10} />
                      <span className="font-mono">{fileFormat}</span>
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={selectWorkspace}
                  title="Tip: pick a folder inside Google Drive, OneDrive, Dropbox or Mega and your notes sync through that service automatically — no account needed."
                  className="flex items-center gap-2 min-w-0 flex-1 text-xs text-[#32CD32] font-medium truncate"
                >
                  <FolderIcon size={14} className="shrink-0" />
                  <span className="truncate">Open directory</span>
                </button>
              )}
            </>
          )}

          <div className="flex items-center shrink-0">
            {onGoToOneDriveSettings && (
              oneDriveConnected ? (
                <button
                  onClick={onSyncOneDrive}
                  disabled={oneDriveSyncing}
                  className="p-1.5 text-slate-500 dark:text-slate-300 hover:text-[#32CD32] transition-colors disabled:opacity-60"
                  title={oneDriveSyncing ? 'Syncing with OneDrive…' : 'Sync with OneDrive'}
                >
                  <RefreshCw size={14} className={oneDriveSyncing ? 'animate-spin' : ''} />
                </button>
              ) : (
                <button
                  onClick={onGoToOneDriveSettings}
                  className="p-1.5 text-slate-500 dark:text-slate-300 hover:text-[#32CD32] transition-colors"
                  title="Connect OneDrive (in Settings)"
                >
                  <Cloud size={14} />
                </button>
              )
            )}

            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-1.5 text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              title={isDarkMode ? 'Light Mode' : 'Dark Mode'}
            >
              {isDarkMode ? <Sun size={14} /> : <Moon size={14} />}
            </button>

            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="p-1.5 text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                title="Settings"
              >
                <Settings size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
