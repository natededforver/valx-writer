import React, { useState, useEffect, useRef } from 'react';
import { useNotes } from './hooks/useNotes';
import { useOneDrive } from './hooks/useOneDrive';
import { isTauri, onOpenPreferences } from './lib/desktop';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isMac, isAndroid, isTouchUI } from './lib/platform';
import { useHorizontalSwipe } from './lib/swipe';
import { dismissSplash } from './lib/splash';
import { filterNotesForContainer } from './components/NoteList';
import { normalizeSort } from './lib/noteSort';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { FormatConverter } from './components/FormatConverter';
import { SettingsModal } from './components/SettingsModal';
import { DictionaryModal } from './components/DictionaryModal';
import { ForbiddenModal } from './components/ForbiddenModal';
import { SpacingModal } from './components/SpacingModal';
import { LS_TRANSPARENCY, applyTransparency, applySpacing, prefOn } from './lib/prefs';
import { FilterState, JumpTarget } from './types';
import { SearchHit } from './lib/search';
import { linkHrefForNote } from './lib/noteLinks';

// OneDrive sync is desktop-only: the OAuth redirect is a loopback listener on
// 127.0.0.1, which an Android browser hand-off never returns to, and the
// backend module isn't even compiled into the phone build (see Cargo.toml).
// Every entry point is gated on this so the phone shows no button that could
// only fail.
const desktopSync = isTauri && !isAndroid;

// NoteList used to be its own rail; it now lives inside the Sidebar (merge of
// the two panes). Only two mobile states remain — 'list' (sidebar visible) and
// 'editor' (sidebar hidden, editor full-screen) — since the sidebar IS the list.
type ViewState = 'list' | 'editor';

export default function App() {
  const { notes, folders, addNote, addNoteWithContent, updateNote, moveToTrash, restoreFromTrash, deleteNotePerm, emptyTrash, tags, addFolder, deleteFolder, renameFolder, moveNotesToFolder, moveNotesToTrash, workspaceHandle, isWorkspaceRestored, selectWorkspace, fileFormat, saveNoteNow, convertWorkspaceFormat, convertNoteFormat, noteExtensions, bookmarkedIds, toggleBookmark, listAttachments, serializeDisk, rescanWorkspace } = useNotes();
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

  // Re-apply saved appearance preferences on launch: transparency (ships off,
  // so an unset key means opaque — prefOn handles the ship-defaults) and the
  // writing-surface spacing, both before the first paint.
  useEffect(() => {
    applyTransparency(prefOn(LS_TRANSPARENCY));
    applySpacing();
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

  // A workspace switch invalidates the open note: its id belongs to the folder
  // that was just left, so it resolves to nothing in the new one. The selection
  // stays non-empty, which meant the effect above kept the phone on the editor
  // — showing "Select or create a note" with no chrome and no way back but a
  // swipe. Clearing the selection lets that same effect drop to the list.
  //
  // Keyed on the path rather than the handle object: the handle is rebuilt on
  // every restore, and re-running this on each one would clear a selection the
  // user still has.
  useEffect(() => {
    setSelectedNoteIds([]);
  }, [workspaceHandle?.path]);

  const handleAddNote = () => {
    const currentFolderId = filter.type === 'folder' ? filter.folderId : null;
    const newNote = addNote(currentFolderId);
    setSelectedNoteIds([newNote.id]);
  };

  // --- merging notes ---------------------------------------------------------
  //
  // A merge appends whole notes into another one and throws the originals in
  // the bin. On the desktop that only ever happened at the end of a deliberate
  // mouse drag onto the editor; on a phone it is now also a gesture — two
  // fingers carrying a note, or one note dropped on top of another — and a
  // gesture is something a thumb can produce by accident. So nothing is written
  // until the dialog at the bottom of this file is answered. Every path in
  // (Editor drop, note-on-note, the merge strip) goes through requestMerge, so
  // there is exactly one place where a merge can be agreed to.
  const [pendingMerge, setPendingMerge] = useState<{ ids: string[]; targetId: string | null } | null>(null);

  const requestMerge = (sourceIds: string[], targetId: string | null) => {
    // A note is never merged into itself, and a trashed note is not a source:
    // it is already gone as far as the lists are concerned.
    const ids = sourceIds.filter(id => id !== targetId && notes.some(n => n.id === id && !n.isTrash));
    if (ids.length === 0) return;
    setPendingMerge({ ids, targetId });
  };

  const runMerge = ({ ids, targetId }: { ids: string[]; targetId: string | null }) => {
    setPendingMerge(null);
    const sources = notes.filter(n => ids.includes(n.id));
    if (sources.length === 0) return;
    const body = sources.map(n => `<h1>${n.title}</h1>\n${n.content}`).join('\n\n');
    const target = targetId ? notes.find(n => n.id === targetId) : null;
    if (target) {
      updateNote(target.id, { content: target.content + '\n\n' + body });
      moveNotesToTrash(sources.map(n => n.id));
      // Deliberately no selection change: the merge happened where the user was
      // looking (the list, on a phone), and jumping them into the editor would
      // be a second, unasked-for thing done by one drop.
    } else {
      const title = sources[0].title ? `Merged: ${sources[0].title}` : 'Merged Notes';
      const currentFolderId = filter.type === 'folder' ? filter.folderId : null;
      const newNote = addNoteWithContent(title, body, currentFolderId);
      moveNotesToTrash(sources.map(n => n.id));
      setSelectedNoteIds([newNote.id]);   // nothing else would show it exists
    }
  };

  const mergeTargetTitle = pendingMerge?.targetId
    ? (notes.find(n => n.id === pendingMerge.targetId)?.title || 'Untitled Note')
    : null;

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

  // --- touch: three panels, moved between by swiping -------------------------
  //
  //     NOTE LIST  ◀──────  EDITOR  ──────▶  MENU PANEL
  //                swipe →          swipe ←
  //
  // Each panel enters from the side it lives on, so the gesture matches where
  // the thing is. Swiping left on the list opens the selected note (the first
  // one if nothing is selected — a swipe that did nothing because of an empty
  // selection would read as the gesture being broken).
  const rootRef = useRef<HTMLDivElement>(null);

  // Whether the editor's menu panel is on screen. Read from the DOM rather than
  // mirrored into state: the panel is the Editor's to own (it is built from the
  // Editor's own menu fragments), it covers the screen when open, and a boolean
  // copied up here through an event would be a second source of truth that can
  // disagree with the one that matters — which is what is actually drawn.
  const menuPanelOpen = () => !!document.querySelector('.vx-menu-panel');
  const setMenuPanel = (open: boolean) =>
    window.dispatchEvent(new CustomEvent('valx-menu-panel', { detail: open }));

  const openSelectedNote = React.useCallback(() => {
    if (activeNoteId) { setMobileView('editor'); return; }
    // The list order has to be the one on screen or the gesture lies about
    // where it is taking you, so this reuses the sidebar's own filter+sort
    // rather than ordering `notes` again. The sort key is read at gesture time,
    // not at render: it lives in localStorage under the Sidebar's own state,
    // and a snapshot taken on mount would go stale the moment the user re-sorts.
    const ordered = filterNotesForContainer(notes, filter, {
      sort: normalizeSort(localStorage.getItem('valx-note-sort')),
    });
    if (ordered.length === 0) return;
    setSelectedNoteIds([ordered[0].id]);
    setMobileView('editor');
  }, [notes, filter, activeNoteId]);

  const onSwipeLeft = React.useCallback(() => {
    if (menuPanelOpen()) return;                       // already at the far right
    if (mobileView === 'list') { openSelectedNote(); return; }
    if (activeNoteId) setMenuPanel(true);
  }, [mobileView, activeNoteId, openSelectedNote]);

  const onSwipeRight = React.useCallback(() => {
    if (menuPanelOpen()) { setMenuPanel(false); return; }
    if (mobileView === 'editor') { setMobileView('list'); setIsFullscreen(false); }
  }, [mobileView]);

  useHorizontalSwipe(rootRef, { enabled: isTouchUI, onLeft: onSwipeLeft, onRight: onSwipeRight });

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

  // macOS: distraction-free mode drives the window into *native* fullscreen, so
  // AppKit takes the traffic lights away with the rest of the chrome — and
  // slides them back in beside the system menu bar when the pointer reaches the
  // top edge, which is the same gesture that reveals the app's own bar. Doing
  // it this way rather than hiding the buttons ourselves is the whole point:
  // the alternatives are dropping decorations (losing the rounded corners and
  // shadow that made native decorations worth having) or reaching into
  // NSWindow's standard buttons, and neither would reveal on hover.
  //
  // Mirrors app state onto the window, not the reverse: leaving native
  // fullscreen by the green button or ⌃⌘F does not pull the sidebar back. The
  // next toggle re-syncs, and two-way binding here would fight the user over
  // which of the two states is authoritative.
  //
  // Lives in an effect rather than in toggleFullscreen because several paths
  // set isFullscreen — the sidebar arrow, F11/⌘↩, picking a filter — and every
  // one of them has to take the window with it.
  useEffect(() => {
    if (!isTauri || !isMac) return;
    void getCurrentWindow().setFullscreen(isFullscreen).catch(() => {});
  }, [isFullscreen]);

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

  // …and so does the macOS menu bar's App > Preferences… (macos_menu.rs). It
  // is a separate path from the keydown above rather than a synthetic key
  // event: AppKit dispatches the menu item without the webview ever seeing a
  // keystroke, so there is nothing for that listener to catch.
  useEffect(() => onOpenPreferences(() => setIsSettingsOpen(true)), []);

  return (
    <div ref={rootRef} className={`vx-safe relative flex h-full w-full overflow-hidden text-slate-800 dark:text-slate-200 font-sans ${isDarkMode ? 'dark' : ''} ${dragging ? 'select-none cursor-col-resize' : ''}`}>
      {/* The mobile header used to live here: a 56px bar carrying a "Notes"
          back chevron over the editor and the word "Notes" over the list. It is
          gone. In the list view the Sidebar already names itself, and over the
          editor it stacked a second bar on top of the editor's own — 100px of
          chrome on a 360px screen, and the back chevron is now the first thing
          in the editor's title bar (Editor's onBack, touch only). */}

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
          onRestoreFromTrash={restoreFromTrash}
          // Deleting from the sidebar can take out the note the editor is
          // showing, same as deleting from its menu — clear the selection so
          // the editor drops to its null state instead of holding a dead id.
          onDeleteNotePerm={(id) => {
            deleteNotePerm(id);
            if (id === activeNoteId) setSelectedNoteIds([]);
          }}
          onEmptyTrash={() => {
            emptyTrash();
            if (activeNote?.isTrash) setSelectedNoteIds([]);
          }}
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
          onMergeNotes={requestMerge}
          activeNoteId={activeNoteId}
          oneDriveConnected={oneDrive.connected}
          oneDriveSyncing={oneDrive.isSyncing}
          onGoToOneDriveSettings={desktopSync ? goToOneDriveSettings : undefined}
          onSyncOneDrive={desktopSync ? oneDrive.sync : undefined}
          className={`${mobileView === 'list' ? 'flex' : 'hidden'} md:flex w-full md:w-[var(--rw)] shrink-0`}
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
            // Dropped on the editor: merge into the open note, or into a new
            // one when there isn't one. Asks first — see requestMerge.
            onMergeNotes={(sourceIds) => requestMerge(sourceIds, activeNoteId)}
            onAddNoteWithContent={(title, content) => {
              const currentFolderId = filter.type === 'folder' ? filter.folderId : null;
              const note = addNoteWithContent(title, content, currentFolderId);
              setSelectedNoteIds([note.id]);
            }}
          noteExt={activeNote ? (noteExtensions[activeNote.id] ?? '') : ''}
          listAttachments={listAttachments}
          sidebarOpen={showSidebarEff}
          onToggleSidebar={handleToggleSidebar}
          onBack={() => setMobileView('list')}
          onOpenFolder={selectWorkspace}
          onOpenPreferences={() => setIsSettingsOpen(true)}
          // File > Move to — the same move the sidebar's drag-and-drop performs,
          // reachable without a drag.
          folders={folders}
          onMoveNoteToFolder={(id, folderId) => moveNotesToFolder([id], folderId)}
          className={`${editorVisible ? 'flex' : 'hidden'} md:flex w-full md:flex-1 min-w-0`}
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
        onConnectOneDrive={desktopSync ? oneDrive.connect : undefined}
        onDisconnectOneDrive={desktopSync ? oneDrive.disconnect : undefined}
        highlightOneDrive={highlightOneDriveSettings}
      />

      {/* User dictionary manager — opens on the 'valx-open-dictionary' event
          the Edit menu fires, so nothing has to thread state down to it. */}
      <DictionaryModal />

      {/* Forbidden words — same event-driven pattern, fired by Words >
          Forbidden Words…. Both lists are global, so neither needs a note. */}
      <ForbiddenModal />

      {/* Letter/word spacing, with a live sample. Same event-driven mount:
          Format > Text spacing… fires 'valx-open-spacing'. */}
      <SpacingModal />

      {/* Merge confirmation. The one thing standing between a two-finger drag
          — or a note dropped a row off target — and two notes being rewritten
          with a third thrown away. It names both sides and says where the
          originals go, because "Merge" on its own does not tell you that. */}
      {pendingMerge && (
        <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="vx-pop bg-white dark:bg-black p-6 rounded-xl shadow-xl max-w-sm w-full border border-slate-100 dark:border-neutral-900">
            <h3 className="text-lg font-bold mb-2 text-slate-900 dark:text-white">
              {pendingMerge.ids.length === 1 ? 'Merge this note?' : `Merge ${pendingMerge.ids.length} notes?`}
            </h3>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-1">
              {mergeTargetTitle
                ? <>{pendingMerge.ids.length === 1 ? 'Its' : 'Their'} contents are appended to <span className="font-semibold text-slate-700 dark:text-slate-300">“{mergeTargetTitle}”</span>.</>
                : <>{pendingMerge.ids.length === 1 ? 'Its contents are moved into' : 'Their contents are combined into'} one new note.</>}
            </p>
            <p className="text-slate-400 dark:text-slate-500 text-xs mb-5">
              {pendingMerge.ids.length === 1 ? 'The note you merged moves to Trash.' : 'The notes you merged move to Trash.'}
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="bg-[#32CD32] hover:bg-[#2eb82e] text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-sm"
                onClick={() => runMerge(pendingMerge)}
              >
                Merge
              </button>
              <button
                className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-4 py-2 font-medium"
                onClick={() => setPendingMerge(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {syncToast && <div className="vx-toast">{syncToast}</div>}
    </div>
  );
}
