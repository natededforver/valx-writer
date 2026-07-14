import React, { useState, useEffect, useRef } from 'react';
import { useNotes } from './hooks/useNotes';
import { useWorlds } from './hooks/useWorlds';
import { useOneDrive } from './hooks/useOneDrive';
import { isTauri } from './lib/desktop';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { WorldCanvas } from './components/WorldCanvas';
import { buildMediaHtml } from './components/RichTextEditor';
import { FormatConverter } from './components/FormatConverter';
import { SettingsModal, LS_SPELL_LANG, LS_FONT, applyFont } from './components/SettingsModal';
import { OnboardingSlideshow } from './components/OnboardingSlideshow';
import { WindowControls } from './components/WindowControls';
import { FilterState, JumpTarget } from './types';
import { SearchHit } from './lib/search';
import { linkHrefForNote } from './lib/noteLinks';
import { ChevronLeft } from 'lucide-react';

// NoteList used to be its own rail; it now lives inside the Sidebar (merge of
// the two panes). Only two mobile states remain — 'list' (sidebar visible) and
// 'editor' (sidebar hidden, editor full-screen) — since the sidebar IS the list.
type ViewState = 'list' | 'editor';
type AppView = { type: 'notes' } | { type: 'world'; worldId: string };

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
  const {
    worlds, activeWorldId, activeDoc, activeView, restoredWorldId, cardTags, createWorld, deleteWorld, openWorld, closeWorld,
    applyWorldCommand, onViewChange, undo: undoWorld, redo: redoWorld, canUndo: canUndoWorld, canRedo: canRedoWorld,
    importSpaces,
  } = useWorlds(notes, workspaceHandle, isWorkspaceRestored, { updateNote, moveNotesToFolder, addFolder, renameFolder, folders, noteExtensions, moveNotesToTrash, restoreFromTrash });
  // World Mode tag cards are first-class tags, not just note-content mirrors — merge
  // them with the note-derived list so the sidebar shows a tag as soon as it's created.
  const allTags = React.useMemo(
    () => Array.from(new Set([...tags, ...cardTags])).sort(),
    [tags, cardTags]
  );
  const [appView, setAppView] = useState<AppView>({ type: 'notes' });
  // Restores the world that was open at last reload (useWorlds re-opens it internally;
  // this just switches the view to match once it does).
  useEffect(() => {
    if (restoredWorldId) setAppView({ type: 'world', worldId: restoredWorldId });
  }, [restoredWorldId]);
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
  // First-ever launch shows the one-time feature tour.
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return localStorage.getItem('valx-onboarding-done') !== 'true';
  });
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const stored = localStorage.getItem('bear-theme-dark');
    return stored === null ? true : stored === 'true';
  });

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

  const closeOnboarding = () => {
    localStorage.setItem('valx-onboarding-done', 'true');
    setShowOnboarding(false);
  };

  useEffect(() => {
    localStorage.setItem('bear-theme-dark', String(isDarkMode));
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Re-apply the saved spellcheck/dictionary language on launch so the desktop
  // app honours the user's Settings choice over the OS-locale auto-pick.
  useEffect(() => {
    const api = (window as any).electronAPI;
    const saved = localStorage.getItem(LS_SPELL_LANG);
    if (saved && api?.setSpellCheckerLanguages) {
      api.setSpellCheckerLanguages([saved]);
    }
    applyFont(localStorage.getItem(LS_FONT) || '');
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
    const wasWorld = appView.type === 'world';
    if (wasWorld) { closeWorld(); setAppView({ type: 'notes' }); }
    setFilter(f);
    setSelectedNoteIds([]);
    setMobileView('list');
    setIsFullscreen(false);
  };

  const handleOpenWorld = (id: string) => {
    openWorld(id);
    setAppView({ type: 'world', worldId: id });
    setSelectedNoteIds([]);
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

  // World Mode fullscreen (Item 9): F11 hides the sidebar (which now contains
  // the note list), keeping only the world canvas (its own header, with the
  // back button, stays visible). Reuses the same `isFullscreen` flag the
  // Editor's F11 binding drives — that listener only exists while Editor is
  // mounted (i.e. appView.type === 'notes'), so the two never fire at once.
  // Same F11 press exits.
  useEffect(() => {
    if (appView.type !== 'world') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        setIsFullscreen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [appView.type]);

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
    <div className={`relative flex h-screen w-full overflow-hidden pt-8 text-slate-800 dark:text-slate-200 font-sans ${isDarkMode ? 'dark' : ''} ${dragging ? 'select-none cursor-col-resize' : ''}`}>
      <WindowControls />
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
          worlds={worlds}
          activeWorldId={activeWorldId}
          inWorldMode={appView.type === 'world'}
          onOpenWorld={handleOpenWorld}
          onAddWorld={(name) => { const w = createWorld(name); handleOpenWorld(w.id); }}
          onDeleteWorld={(id) => {
            if (appView.type === 'world' && appView.worldId === id) { closeWorld(); setAppView({ type: 'notes' }); }
            deleteWorld(id);
          }}
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

      {appView.type === 'world' ? (
        <WorldCanvas
          key={activeWorldId}
          doc={activeDoc}
          notes={notes}
          folders={folders}
          worldName={worlds.find(w => w.id === activeWorldId)?.name || 'World'}
          isDarkMode={isDarkMode}
          initialView={activeView}
          onViewChange={onViewChange}
          onApplyCommand={applyWorldCommand}
          onUndo={undoWorld}
          onRedo={redoWorld}
          canUndo={canUndoWorld}
          canRedo={canRedoWorld}
          onBackToNotes={() => { closeWorld(); setAppView({ type: 'notes' }); }}
          onRequestNoteList={() => setMobileView('list')}
          onCreateMediaNote={({ name, src, kind }) => {
            const title = name.replace(/\.[^.]+$/, '') || 'Media';
            const note = addNoteWithContent(title, buildMediaHtml(kind, src, name));
            return note.id;
          }}
          onImportSpaces={importSpaces}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
          className="flex w-full flex-1 pt-14 md:pt-0"
        />
      ) : (
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
          onToggleSidebar={() => setShowSidebar((v) => !v)}
          className={`${editorVisible ? 'flex' : 'hidden'} md:flex w-full md:flex-1 min-w-0 pt-14 md:pt-0`}
        />
      )}

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

      {/* One-time tour for freshly created accounts */}
      {showOnboarding && <OnboardingSlideshow onClose={closeOnboarding} />}

      {syncToast && <div className="vx-toast">{syncToast}</div>}
    </div>
  );
}
