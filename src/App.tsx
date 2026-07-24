import React, { useState, useEffect, useRef } from 'react';
import { useNotes } from './hooks/useNotes';
import { useOneDrive } from './hooks/useOneDrive';
import { isTauri, pushMarkAsItems } from './lib/desktop';
import { dismissSplash } from './lib/splash';
import { markAsItems, CREATORS_EVENT } from './lib/creators';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { FormatConverter } from './components/FormatConverter';
import { SettingsModal } from './components/SettingsModal';
import { DictionaryModal } from './components/DictionaryModal';
import { LS_TRANSPARENCY, applyTransparency, prefOn } from './lib/prefs';
import { FilterState, JumpTarget } from './types';
import { SearchHit } from './lib/search';
import { linkHrefForNote } from './lib/noteLinks';
import { ChevronLeft } from 'lucide-react';

// NoteList used to be its own rail; it now lives inside the Sidebar (merge of
// the two panes). Only two mobile states remain — 'list' (sidebar visible) and
// 'editor' (sidebar hidden, editor full-screen) — since the sidebar IS the list.
type ViewState = 'list' | 'editor';

export default function App() {
  const { notes, folders, addNote, addNoteWithContent, updateNote, moveToTrash, restoreFromTrash, deleteNotePerm, tags, addFolder, deleteFolder, renameFolder, moveNotesToFolder, moveNotesToTrash, workspaceHandle, isWorkspaceRestored, selectWorkspace, fileFormat, saveNoteNow, convertWorkspaceFormat, convertNoteFormat, noteExtensions, bookmarkedIds, toggleBookmark, listAttachments, serializeDisk, rescanWorkspace } = useNotes();
  const oneDrive = useOneDrive(workspaceHandle, serializeDisk, rescanWorkspace);
  // Sync toast: auto-dismisses a few seconds after each result/error.
  const [syncToast, setSyncToast] = useState<string | null>(null);
  useEffect(() => {
    if (!oneDrive.lastResult) return;
    const { pulled, pushed, conflicts } = oneDrive.lastResult;
    setSyncToast(
      conflicts.length > 0
        ? `Synced — ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} resolved by newest edit`
        : pulled.length === 0 && pushed.length === 0
        ? 'Already up to date'
        : `Synced — ${pulled.length} pulled, ${pushed.length} pushed`
    );
  }, [oneDrive.lastResult]);
  useEffect(() => {
    if (oneDrive.error) setSyncToast(oneDrive.error);
  }, [oneDrive.error]);
  useEffect(() => {
    if (!syncToast) return;
    const t = setTimeout(() => setSyncToast(null), 3000);
    return () => clearTimeout(t);
  }, [syncToast]);
  const allTags = React.useMemo(() => [...tags].sort(), [tags]);
  const [filter, setFilter] = useState<FilterState>({ type: 'all' });
  // NoteList used to be a separate rail with its own show/hide toggle. After
  // the merge it lives inside the Sidebar, so its visibility is bound to
  // showSidebar — no independent showNoteList flag.
  // Desktop sidebar collapse — toggled by the burger next to the logo (and a
  // floating burger to reopen). Mobile keeps its own mobileView-driven sidebar.
  const [showSidebar, setShowSidebar] = useState(true);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [jumpTo, setJumpTo] = useState<JumpTarget | null>(null);
  const jumpNonceRef = useRef(0);
  const [mobileView, setMobileView] = useState<ViewState>('list');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isFormatOpen, setIsFormatOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Sidebar's OneDrive button, when not connected, opens Settings scrolled
  // to and highlighting the OneDrive section instead of connecting directly
  // — connect/disconnect both live in Settings now.
  const [highlightOneDriveSettings, setHighlightOneDriveSettings] = useState(false);
  const goToOneDriveSettings = () => { setHighlightOneDriveSettings(true); setIsSettingsOpen(true); };
  // Light is the default look — dark is opt-in, remembered once chosen.
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('bear-theme-dark') === 'true');

  // The desktop window is created hidden behind the logo splash. Reveal it
  // once React has committed the first frame, so the app never appears blank.
  useEffect(() => { void dismissSplash(); }, []);

  // Resizable sidebar. NoteList is no longer a separate rail (it lives inside
  // the sidebar), so there's only one resize handle now.
  const [sidebarW, setSidebarW] = useState(() => Number(localStorage.getItem('valx-sidebar-w')) || 260);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ which: 'sidebar'; startX: number; startW: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const w = Math.max(220, Math.min(600, d.startW + e.clientX - d.startX));
      setSidebarW(w);
    };
    const onUp = () => { if (dragRef.current) { dragRef.current = null; setDragging(false); } };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);
  // Responsive collapse. Rails are shrink-0, so once they no longer leave the
  // editor a usable column they have to fold away rather than push it off-screen.
  // The user's showSidebar preference is kept intact — this only overrides it
  // while the window is too narrow, and restores on widen.
  const [winW, setWinW] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const EDITOR_MIN = 420;
  const showSidebarEff = showSidebar && winW >= sidebarW + EDITOR_MIN;

  useEffect(() => { localStorage.setItem('valx-sidebar-w', String(sidebarW)); }, [sidebarW]);
  const startDrag = (which: 'sidebar', startW: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { which, startX: e.clientX, startW };
    setDragging(true);
  };
  const ResizeHandle = ({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) => (
    <div className="hidden md:block relative w-0 shrink-0 z-30">
      <div
        onMouseDown={onMouseDown}
        className="absolute inset-y-0 -left-[3px] w-[6px] cursor-col-resize hover:bg-[#32CD32]/50 transition-colors"
      />
    </div>
  );
  // While dragging, width transitions would lag the pointer.
  const railTransition = dragging ? '' : 'transition-[width,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]';

  useEffect(() => {
    localStorage.setItem('bear-theme-dark', String(isDarkMode));
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Keep the native "Mark as" menu's author list in sync with the Creators
  // settings (label + kind pairs), on launch and whenever creators change.
  useEffect(() => {
    const push = () => pushMarkAsItems(markAsItems());
    push();
    window.addEventListener(CREATORS_EVENT, push);
    return () => window.removeEventListener(CREATORS_EVENT, push);
  }, []);

  // Re-apply saved appearance preferences on launch. Transparency ships off,
  // so an unset key means opaque (prefOn handles the ship-defaults).
  useEffect(() => {
    applyTransparency(prefOn(LS_TRANSPARENCY));
  }, []);

  // Sync active note logic
  const activeNoteId = selectedNoteIds.length === 1 ? selectedNoteIds[0] : null;
  const activeNote = notes.find(n => n.id === activeNoteId) || null;

  // Handle mobile view transitions automatically when selecting notes
  useEffect(() => {
    if (activeNoteId) {
      setMobileView('editor');
    } else if (selectedNoteIds.length === 0) {
      setMobileView('list');
      setIsFullscreen(false);
    }
  }, [activeNoteId, selectedNoteIds.length]);

  const handleAddNote = () => {
    const currentFolderId = filter.type === 'folder' ? filter.folderId : null;
    const newNote = addNote(currentFolderId);
    setSelectedNoteIds([newNote.id]);
  };

  // The single top arrow both hides the sidebar and drops into distraction-free
  // fullscreen writing — the two states are coupled (iA-Writer style). Hiding
  // with no note open would strand the user on the empty editor (no chrome in
  // fullscreen), so a blank note is created first. Revealing the sidebar exits
  // fullscreen.
  const handleToggleSidebar = () => {
    if (showSidebar) {
      if (!activeNoteId) handleAddNote();
      setShowSidebar(false);
      setIsFullscreen(true);
    } else {
      setShowSidebar(true);
      setIsFullscreen(false);
    }
  };

  const handleSearchNavigate = (hit: SearchHit, query: string) => {
    jumpNonceRef.current += 1;
    setSelectedNoteIds([hit.noteId]);
    setJumpTo({ noteId: hit.noteId, query, occurrence: hit.occurrence, nonce: jumpNonceRef.current });
  };

  const filterEquals = (a: FilterState, b: FilterState): boolean => {
    if (a.type !== b.type) return false;
    if (a.type === 'folder' && b.type === 'folder') return a.folderId === b.folderId;
    if (a.type === 'tag' && b.type === 'tag') return a.tag === b.tag;
    return true;
  };

  const handleSetFilter = (f: FilterState) => {
    setFilter(f);
    setSelectedNoteIds([]);
    setMobileView('list');
    setIsFullscreen(false);
  };

  // Fullscreen unmounts the sidebar (which now contains the note list too),
  // so the editor is the only pane left — it has to show regardless of
  // `mobileView`. That flag only updates when the *selection* changes, so
  // re-opening the already-selected note while `mobileView === 'list'` used
  // to hide every pane: the blank screen.
  const editorVisible = mobileView === 'editor' || isFullscreen;

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  // Ctrl/Cmd+, opens Settings from anywhere — the sidebar's Settings button is
  // unreachable while the sidebar is hidden/collapsed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setIsSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`relative flex h-full w-full overflow-hidden text-slate-800 dark:text-slate-200 font-sans ${isDarkMode ? 'dark' : ''} ${dragging ? 'select-none cursor-col-resize' : ''}`}>
      {/* Mobile Header (visible only on small screens). The sidebar and the
          note list are the same panel now, so the only switch is between the
          sidebar/list view and the editor view. The 'list' view shows the
          nav + notes + footer; the 'editor' view is the editor full-screen
          with a back chevron. */}
      {!isFullscreen && (
        <div className="md:hidden absolute top-0 w-full h-14 bg-white dark:bg-black border-b border-slate-100 dark:border-neutral-900 flex items-center px-4 justify-between z-20 shadow-sm">
          {mobileView === 'editor' && (
            <button onClick={() => setMobileView('list')} className="p-2 -ml-2 text-[#32CD32] flex items-center">
              <ChevronLeft size={24} />
              <span className="font-medium">Notes</span>
            </button>
          )}
          <div className="font-bold text-slate-900 dark:text-white absolute left-1/2 -translate-x-1/2">
            {mobileView === 'list' ? 'Notes' : ''}
          </div>
          <div className="w-10"></div> {/* spacer */}
        </div>
      )}

      {/* Sidebar — the wrapper animates width; the inner sidebar keeps a fixed
          width so contents don't reflow mid-animation. With the merge, this
          one panel is both the nav and the note list (the old second rail +
          second resize handle are gone). */}
      {!isFullscreen && (
        <div
          style={{ ['--rw' as any]: `min(${sidebarW}px, 40vw)` }}
          className={`shrink-0 overflow-hidden ${railTransition} ${mobileView === 'list' ? 'w-full' : 'w-0'} ${showSidebarEff ? 'md:w-[var(--rw)] opacity-100' : 'md:w-0 md:opacity-0'}`}
        >
        <Sidebar
          filter={filter}
          setFilter={handleSetFilter}
          tags={allTags}
          folders={folders}
          onAddFolder={addFolder}
          onDeleteFolder={deleteFolder}
          onMoveNotesToFolder={moveNotesToFolder}
          onMoveNotesToTrash={moveNotesToTrash}
          isDarkMode={isDarkMode}
          setIsDarkMode={setIsDarkMode}
          workspaceHandle={workspaceHandle}
          selectWorkspace={selectWorkspace}
          fileFormat={fileFormat}
          onOpenFormatConverter={() => setIsFormatOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          // NoteList props — used to belong to a separate rail that lived to
          // the right of this sidebar; now they all go through the sidebar.
          notes={notes}
          selectedNoteIds={selectedNoteIds}
          onSelectNotes={setSelectedNoteIds}
          onAddNote={handleAddNote}
          noteExtensions={noteExtensions}
          bookmarkedIds={bookmarkedIds}
          onToggleBookmark={toggleBookmark}
          onSearchNavigate={handleSearchNavigate}
          onOpenNote={(id) => { setSelectedNoteIds([id]); setMobileView('editor'); }}
          oneDriveConnected={oneDrive.connected}
          oneDriveSyncing={oneDrive.isSyncing}
          onGoToOneDriveSettings={isTauri ? goToOneDriveSettings : undefined}
          onSyncOneDrive={isTauri ? oneDrive.sync : undefined}
          className={`${mobileView === 'list' ? 'flex' : 'hidden'} md:flex w-full md:w-[var(--rw)] pt-14 md:pt-0 shrink-0`}
        />
        </div>
      )}
      {!isFullscreen && showSidebarEff && <ResizeHandle onMouseDown={startDrag('sidebar', sidebarW)} />}

      <Editor
            note={activeNote}
            updateNote={updateNote}
            moveToTrash={moveToTrash}
            restoreFromTrash={restoreFromTrash}
            deleteNotePerm={(id) => {
              // Permanently deleting the open note leaves activeNote null —
              // Editor's null-state has no fullscreen toolbar, so a stale
              // selection would strand the user with no visible way back
              // (the Sidebar — which now holds the note list too — stays
              // hidden while isFullscreen is true). Clearing the selection
              // here lets the existing selectedNoteIds-driven effect drop
              // fullscreen automatically.
              deleteNotePerm(id);
              if (id === activeNoteId) setSelectedNoteIds([]);
            }}
            isFullscreen={isFullscreen}
            toggleFullscreen={toggleFullscreen}
            onSaveNow={saveNoteNow}
            jumpTo={jumpTo?.noteId === activeNoteId ? jumpTo : null}
            onOpenNoteLink={(href) => {
              // Same href<->note matching rule useWorlds' reflection uses, so
              // hand-typed links and Link-Lasso links resolve identically.
              const target = notes.find(n => !n.isTrash && linkHrefForNote(n.title, noteExtensions[n.id] ?? '.md') === href);
              if (!target) return false;
              setSelectedNoteIds([target.id]);
              return true;
            }}
            onMergeNotes={(sourceIds) => {
               if (activeNoteId && activeNote) {
                  const notesToMerge = notes.filter(n => sourceIds.includes(n.id) && n.id !== activeNoteId);
                  if (notesToMerge.length > 0) {
                     const mergedContent = notesToMerge.map(n => `<h1>${n.title}</h1>\n${n.content}`).join('\n\n');
                     updateNote(activeNoteId, { content: activeNote.content + '\n\n' + mergedContent });
                     moveNotesToTrash(notesToMerge.map(n => n.id)); // move merged to trash
                  }
               } else {
                  // Merge into a new note
                  const notesToMerge = notes.filter(n => sourceIds.includes(n.id));
                  if (notesToMerge.length > 0) {
                     const mergedContent = notesToMerge.map(n => `<h1>${n.title}</h1>\n${n.content}`).join('\n\n');
                     const title = notesToMerge[0].title ? `Merged: ${notesToMerge[0].title}` : 'Merged Notes';
                     const currentFolderId = filter.type === 'folder' ? filter.folderId : null;
                     const newNote = addNoteWithContent(title, mergedContent, currentFolderId);
                     moveNotesToTrash(notesToMerge.map(n => n.id)); // move merged to trash
                     setSelectedNoteIds([newNote.id]);
                  }
               }
            }}
            onAddNoteWithContent={(title, content) => {
              const currentFolderId = filter.type === 'folder' ? filter.folderId : null;
              const note = addNoteWithContent(title, content, currentFolderId);
              setSelectedNoteIds([note.id]);
            }}
          noteExt={activeNote ? (noteExtensions[activeNote.id] ?? '') : ''}
          listAttachments={listAttachments}
          sidebarOpen={showSidebarEff}
          onToggleSidebar={handleToggleSidebar}
          onOpenFolder={selectWorkspace}
          onOpenPreferences={() => setIsSettingsOpen(true)}
          className={`${editorVisible ? 'flex' : 'hidden'} md:flex w-full md:flex-1 min-w-0 pt-14 md:pt-0`}
        />

      {/* Smart file-format converter */}
      <FormatConverter
        isOpen={isFormatOpen}
        onClose={() => setIsFormatOpen(false)}
        notes={notes}
        fileFormat={fileFormat}
        hasWorkspace={!!workspaceHandle}
        activeNote={activeNote}
        noteExtensions={noteExtensions}
        onConvert={convertWorkspaceFormat}
        onConvertNote={convertNoteFormat}
      />

      {/* Settings — spellcheck language + auto-capitalize */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => { setIsSettingsOpen(false); setHighlightOneDriveSettings(false); }}
        oneDriveConnected={oneDrive.connected}
        oneDriveAccount={oneDrive.account}
        onConnectOneDrive={isTauri ? oneDrive.connect : undefined}
        onDisconnectOneDrive={isTauri ? oneDrive.disconnect : undefined}
        highlightOneDrive={highlightOneDriveSettings}
      />

      {/* User dictionary manager — opens on the 'valx-open-dictionary' event
          the Edit menu fires, so nothing has to thread state down to it. */}
      <DictionaryModal />

      {syncToast && <div className="vx-toast">{syncToast}</div>}
    </div>
  );
}
