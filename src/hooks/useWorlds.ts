import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Note, Folder } from '../types';
import { useFileSystem } from './useFileSystem';
import { workspaceId } from './useNotes';
import {
  WorldDoc, WorldMeta, WorldView, WorldNode, WorldEdge, GroupNode, Command,
  emptyDoc, defaultView, applyCommand, invertCommand, toJsonCanvas, slugify, uniqueSlug, newId,
  noteIdOf, childrenOf, buildWorkspaceImport, WorkspaceSnapshot, ImportScope, buildAddEdge, worldCardTags,
} from '../lib/world';
import { linkHrefForNote, appendNoteLink, removeNoteLink, hasNoteLink, retargetLink, extractNoteLinkHrefs } from '../lib/noteLinks';
import { tagForCard, appendTag, removeTag, hasTag } from '../lib/noteTags';

export interface WorldNoteOps {
  updateNote: (id: string, updates: Partial<Note>) => void;
  moveNotesToFolder: (ids: string[], folderId: string | null) => void;
  addFolder: (name: string) => { id: string; name: string };
  /** World-side deletions (Item 15) reflect as a trash move, not a permanent delete — reversible, matches the app's normal delete idiom. */
  moveNotesToTrash: (ids: string[]) => void;
  /** Undoing a world-side deletion restores the underlying note out of trash. */
  restoreFromTrash: (id: string) => void;
  /** Renaming a world group renames its bound workspace folder on disk (Phase 7).
   *  Refuses (ok:false + reason) when the rename could corrupt files. */
  renameFolder: (oldId: string, newName: string) => { ok: true; id: string } | { ok: false; reason: string };
  folders: Folder[];
  noteExtensions: Record<string, string>;
}

// Resolves linkHref for every note-backed-to-note-backed edge in an 'add'
// command before it's applied — invertCommand('add') carries the same edges
// forward into the 'remove' undo entry, so link-append and link-remove
// (Step 4b) stay symmetric with zero extra bookkeeping.
function enrichAddEdges(docBefore: WorldDoc, cmd: Command, notes: Note[], ops: WorldNoteOps): Command {
  if (cmd.type !== 'add' || cmd.edges.length === 0) return cmd;
  const nodeById = new Map<string, WorldNode>();
  for (const n of docBefore.nodes) nodeById.set(n.id, n);
  for (const n of cmd.nodes) nodeById.set(n.id, n);
  const noteById = new Map(notes.map((n) => [n.id, n]));
  const edges = cmd.edges.map((e) => {
    const fromNode = nodeById.get(e.fromNode);
    const toNode = nodeById.get(e.toNode);
    const fromNoteId = fromNode ? noteIdOf(fromNode) : null;
    const toNoteId = toNode ? noteIdOf(toNode) : null;
    if (fromNoteId && toNoteId) {
      const toNote = noteById.get(toNoteId);
      if (!toNote) return e;
      const ext = ops.noteExtensions[toNoteId] ?? '.md';
      return { ...e, linkHref: linkHrefForNote(toNote.title, ext) };
    }
    // Card <-> note-backed (Phase 5): tag the note-backed side with the card's label.
    if (fromNode?.type === 'text' && toNoteId) {
      const tag = tagForCard(fromNode.text);
      if (tag) return { ...e, tagRef: tag };
    } else if (toNode?.type === 'text' && fromNoteId) {
      const tag = tagForCard(toNode.text);
      if (tag) return { ...e, tagRef: tag };
    }
    return e;
  });
  return { ...cmd, edges };
}

// ---------------------------------------------------------------------------
// Persistence: localStorage is the source of truth (workspace-scoped,
// mirroring useNotes' key discipline) so the whole feature works with no IPC
// and is fully exercisable in the browser preview. Every save is also
// best-effort mirrored to a portable `<slug>.canvas` file so the workspace
// stays inspectable/Obsidian-openable — but nothing reads that file back yet
// (see dev/WORLD_MODE_PLAN.md §1a: the directory readers only surface note
// extensions, so disk read-back needs a Phase-2+ IPC addition + one app
// restart, deliberately out of scope here).
//
// IMPORTANT: `workspaceHandle`/`notesReady` are passed in from the SAME
// useFileSystem instance App uses for notes (via useNotes) — this hook used
// to call its own private useFileSystem() for keying, which raced against the
// real one (different handle settling at a different time) and caused the
// active world's doc/undo/redo to be wiped whenever the user navigated away
// and back. useFileSystem() is still called here, but only for the pure
// saveFile/deleteFile functions (they take the handle as an explicit arg).
// ---------------------------------------------------------------------------

const WORLDS_DIR = '.worlds';

const readJson = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
};
const writeJson = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));

export function useWorlds(notes: Note[], workspaceHandle: any, notesReady: boolean, ops: WorldNoteOps) {
  const { saveFile, deleteFile } = useFileSystem();

  const [worlds, setWorlds] = useState<WorldMeta[]>([]);
  const [activeWorldId, setActiveWorldId] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<WorldDoc | null>(null);
  const [activeView, setActiveView] = useState<WorldView>(defaultView());
  const [undoStack, setUndoStack] = useState<Command[]>([]);
  const [redoStack, setRedoStack] = useState<Command[]>([]);

  const worldsRef = useRef(worlds); worldsRef.current = worlds;
  const activeDocRef = useRef(activeDoc); activeDocRef.current = activeDoc;
  const activeViewRef = useRef(activeView); activeViewRef.current = activeView;
  const activeWorldIdRef = useRef(activeWorldId); activeWorldIdRef.current = activeWorldId;
  const undoStackRef = useRef(undoStack); undoStackRef.current = undoStack;
  const redoStackRef = useRef(redoStack); redoStackRef.current = redoStack;
  // Single source of truth for note mutations lives in useNotes (App owns it);
  // mirrored here (not called independently — see CLAUDE.md rule 2) so command
  // handlers always read the live functions/data without stale closures.
  const notesRef = useRef(notes); notesRef.current = notes;
  const opsRef = useRef(ops); opsRef.current = ops;
  // Mirrored inline (not just at render time) so every callback — even ones
  // memoized with an empty dep array (openWorld, onViewChange, renameWorld) —
  // reads the CURRENT handle instead of whatever it was at first render (null,
  // before Electron's persisted handle restores). Reading the stale prop there
  // split the localStorage key prefix in two (web:default vs el:<path>),
  // silently wiping every world's doc/view/index on reload. Same pattern as
  // useNotes.ts's workspaceRef.
  const workspaceHandleRef = useRef(workspaceHandle); workspaceHandleRef.current = workspaceHandle;

  const wsKey = () => workspaceId(workspaceHandleRef.current);
  const worldsKey = () => `valx-worlds:${wsKey()}`;
  const docKey = (id: string) => `valx-world-doc:${wsKey()}:${id}`;
  const viewKey = (id: string) => `valx-world-view:${wsKey()}:${id}`;
  /** Which world (if any) is currently open — read on startup so a reload lands back
   *  in the same world instead of always at the notes view (Item request: "survive on app reload"). */
  const lastOpenKey = () => `valx-world-last-open:${wsKey()}`;

  const loadWorlds = () => readJson<WorldMeta[]>(worldsKey(), []);
  const saveWorlds = (list: WorldMeta[]) => writeJson(worldsKey(), list);
  const loadDoc = (id: string) => readJson<WorldDoc | null>(docKey(id), null);
  const saveDocLocal = (id: string, doc: WorldDoc) => writeJson(docKey(id), doc);
  const removeDocLocal = (id: string) => localStorage.removeItem(docKey(id));
  const loadView = (id: string): WorldView => readJson<WorldView>(viewKey(id), defaultView());
  const saveViewLocal = (id: string, view: WorldView) => writeJson(viewKey(id), view);
  const removeViewLocal = (id: string) => localStorage.removeItem(viewKey(id));

  // Reload the worlds index once the REAL workspace handle is known, and only
  // reset active state on a genuine later change (picking a different
  // folder) — never on the initial async settle from null to the restored
  // handle, which is what used to wipe an already-open world out from under
  // the user. We simply do nothing until notesReady flips true; the first
  // time it does becomes the baseline, not a "change".
  const prevWsRef = useRef<any>(undefined);
  useEffect(() => {
    if (!notesReady) return;
    if (prevWsRef.current === undefined) {
      prevWsRef.current = workspaceHandle;
      setWorlds(loadWorlds());
      return;
    }
    if (prevWsRef.current === workspaceHandle) return;
    prevWsRef.current = workspaceHandle;
    setWorlds(loadWorlds());
    activeDocRef.current = null; setActiveDoc(null);
    activeWorldIdRef.current = null; setActiveWorldId(null);
    undoStackRef.current = []; setUndoStack([]);
    redoStackRef.current = []; setRedoStack([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceHandle, notesReady]);

  // Workspace -> world reflection. Guarded against a transiently-empty `notes`
  // (mid workspace-scan) so a resident world's note-cards never get silently
  // wiped by a brief [] blip, and persists changes immediately (direct doc
  // replacement + queuePersist, no undo entries — same discipline as the
  // original note-node prune this effect grew from).
  useEffect(() => {
    if (!notesReady || notes.length === 0 || !activeDocRef.current || !activeWorldIdRef.current) return;
    const doc = activeDocRef.current;
    const ops = opsRef.current;
    // Trashed notes count as "gone" here too (Item 15) — a note trashed from the
    // main workspace should drop its world node, same as a permanent delete.
    // A node just trashed FROM the world (runWorkspaceEffects, above) is already
    // gone from doc.nodes by the time this effect runs, so there's no race.
    const liveIds = new Set(notes.filter((n) => !n.isTrash).map((n) => n.id));
    const noteById = new Map(notes.map((n) => [n.id, n]));

    // 1. Drop note-node references to notes that no longer exist (deleted permanently or trashed).
    const prunedNodes = doc.nodes.filter((n) => n.type !== 'note' || liveIds.has(n.noteId));
    const keptIds = new Set(prunedNodes.map((n) => n.id));
    const nodeByIdEarly = new Map(prunedNodes.map((n) => [n.id, n]));

    // 2. Link-rename reflection (Item 14): a destination note's title may have
    // changed elsewhere (main workspace), leaving an edge's `linkHref` and the
    // source note's link text pointing at a stale filename. Recompute the
    // expected href from the note's CURRENT title; if it differs and the old
    // href is still actually present in the source note (i.e. this is a rename,
    // not the user deleting the link), retarget both — otherwise leave it alone
    // so the dangling-edge prune below still catches a real deletion.
    const retargetedContentByNoteId = new Map<string, string>();
    const retargetedEdgeIds = new Set<string>();
    const renamedEdges = doc.edges.map((e) => {
      if (!e.linkHref) return e;
      const fromNode = nodeByIdEarly.get(e.fromNode);
      const toNode = nodeByIdEarly.get(e.toNode);
      const fromNoteId = fromNode ? noteIdOf(fromNode) : null;
      const toNoteId = toNode ? noteIdOf(toNode) : null;
      if (!fromNoteId || !toNoteId) return e;
      const fromNote = noteById.get(fromNoteId);
      const toNote = noteById.get(toNoteId);
      if (!fromNote || !toNote || !hasNoteLink(fromNote.content, e.linkHref)) return e;
      const ext = ops.noteExtensions[toNoteId] ?? '.md';
      const expectedHref = linkHrefForNote(toNote.title, ext);
      if (expectedHref === e.linkHref) return e;
      retargetedEdgeIds.add(e.id);
      const baseContent = retargetedContentByNoteId.get(fromNoteId) ?? fromNote.content;
      retargetedContentByNoteId.set(fromNoteId, retargetLink(baseContent, e.linkHref, toNote.title, expectedHref));
      return { ...e, linkHref: expectedHref };
    });

    // 3+4. Dangling-edge prune, then link/tag reflection: an edge whose source
    // note's content no longer contains the link, or whose note-backed endpoint's
    // note no longer contains the tag (either deleted outside World Mode), loses
    // its wire. Edges retargeted just above are exempt — their old href is what's
    // still in `fromNote.content` this render (the rewrite lands async via
    // ops.updateNote), so the presence check would otherwise misfire as a deletion.
    const prunedEdges = renamedEdges.filter((e) => {
      if (!keptIds.has(e.fromNode) || !keptIds.has(e.toNode)) return false;
      if (e.linkHref && !retargetedEdgeIds.has(e.id)) {
        const fromNode = prunedNodes.find((n) => n.id === e.fromNode);
        const fromNoteId = fromNode ? noteIdOf(fromNode) : null;
        const fromNote = fromNoteId ? noteById.get(fromNoteId) : null;
        if (fromNote && !hasNoteLink(fromNote.content, e.linkHref)) return false;
      }
      if (e.tagRef) {
        const fromNode = prunedNodes.find((n) => n.id === e.fromNode);
        const toNode = prunedNodes.find((n) => n.id === e.toNode);
        const noteId = (fromNode ? noteIdOf(fromNode) : null) || (toNode ? noteIdOf(toNode) : null);
        const note = noteId ? noteById.get(noteId) : null;
        if (note && !hasTag(note.content, e.tagRef)) return false;
      }
      return true;
    });

    // 5. Folder reflection: sync note-backed nodes' parentId to the note's
    // actual folderId, but only against bound groups (folderId set) — a
    // decorative (unbound) group is world-only and left alone.
    const boundGroups = new Map<string, GroupNode>();
    for (const n of prunedNodes) if (n.type === 'group' && n.folderId) boundGroups.set(n.folderId, n as GroupNode);
    const nodeById = new Map(prunedNodes.map((n) => [n.id, n]));
    let placementIdx = 0;
    let folderChanged = false;
    const reflectedNodes = prunedNodes.map((n) => {
      const noteId = noteIdOf(n);
      if (!noteId) return n;
      const note = noteById.get(noteId);
      if (!note) return n;
      const currentParent = n.parentId ? nodeById.get(n.parentId) : undefined;
      if (currentParent?.type === 'group' && !(currentParent as GroupNode).folderId) return n;
      const expectedGroup = note.folderId ? boundGroups.get(note.folderId) : undefined;
      if (n.parentId === expectedGroup?.id) return n;
      folderChanged = true;
      if (!expectedGroup) return { ...n, parentId: undefined };
      const inside = n.x >= expectedGroup.x && n.y >= expectedGroup.y &&
        n.x + n.width <= expectedGroup.x + expectedGroup.width && n.y + n.height <= expectedGroup.y + expectedGroup.height;
      if (inside) return { ...n, parentId: expectedGroup.id };
      const pos = { x: expectedGroup.x + 24, y: expectedGroup.y + 48 + placementIdx * 24 };
      placementIdx += 1;
      return { ...n, parentId: expectedGroup.id, ...pos };
    });

    // 6. Live reverse-link creation (Item 14): if a note's content now contains
    // a markdown link to another note that's ALSO represented in this world and
    // no edge connects them yet, wire it — mirrors what dragging a Link Lasso
    // stroke between them would have produced by hand. `buildAddEdge` already
    // rejects a duplicate pair (either direction), so an existing manual wire
    // between the same two nodes is left alone rather than double-wired.
    const nodeIdByNoteId = new Map<string, string>();
    for (const n of reflectedNodes) { const nid = noteIdOf(n); if (nid) nodeIdByNoteId.set(nid, n.id); }
    let workingEdges = prunedEdges;
    let reverseEdgesAdded = 0;
    for (const n of reflectedNodes) {
      const noteId = noteIdOf(n);
      const note = noteId ? noteById.get(noteId) : undefined;
      if (!note) continue;
      const hrefs = extractNoteLinkHrefs(note.content);
      if (hrefs.length === 0) continue;
      for (const href of hrefs) {
        for (const [otherNoteId, otherNote] of noteById) {
          if (otherNoteId === noteId) continue;
          const otherNodeId = nodeIdByNoteId.get(otherNoteId);
          if (!otherNodeId) continue;
          const ext = ops.noteExtensions[otherNoteId] ?? '.md';
          if (linkHrefForNote(otherNote.title, ext) !== href) continue;
          const cmd = buildAddEdge({ nodes: reflectedNodes, edges: workingEdges }, n.id, otherNodeId, { linkHref: href });
          if (cmd && cmd.type === 'add') {
            workingEdges = [...workingEdges, ...cmd.edges];
            reverseEdgesAdded += cmd.edges.length;
          }
        }
      }
    }

    const changed = reflectedNodes.length !== doc.nodes.length || folderChanged ||
      workingEdges.length !== doc.edges.length || retargetedContentByNoteId.size > 0 || reverseEdgesAdded > 0;
    if (changed) {
      const next = { nodes: reflectedNodes, edges: workingEdges };
      activeDocRef.current = next;
      setActiveDoc(next);
      queuePersist(activeWorldIdRef.current, next);
    }
    for (const [noteId, content] of retargetedContentByNoteId) ops.updateNote(noteId, { content });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, notesReady]);

  // Single-file write chain so overlapping mirror-to-disk calls (rapid edits)
  // can't interleave and corrupt a .canvas write — same discipline as useNotes'
  // serializeDisk, scoped to this hook's own disk writes.
  const diskChain = useRef<Promise<unknown>>(Promise.resolve());
  const mirrorToDisk = useCallback((meta: WorldMeta, doc: WorldDoc) => {
    const handle = workspaceHandleRef.current;
    if (!handle) return;
    const json = toJsonCanvas(doc);
    diskChain.current = diskChain.current
      .then(() => saveFile(handle, [WORLDS_DIR], `${meta.slug}.canvas`, json))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFile]);

  // localStorage write is cheap and happens immediately (this is the auto-save);
  // the disk mirror is debounced (~600ms) so rapid drags/edits don't hammer the filesystem.
  const persistTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const queuePersist = useCallback((id: string, doc: WorldDoc) => {
    saveDocLocal(id, doc);
    const idx = worldsRef.current.findIndex((w) => w.id === id);
    if (idx !== -1) {
      const updated = [...worldsRef.current];
      updated[idx] = { ...updated[idx], updatedAt: Date.now() };
      worldsRef.current = updated;
      setWorlds(updated);
      saveWorlds(updated);
    }
    const meta = worldsRef.current.find((w) => w.id === id);
    if (!meta) return;
    const timers = persistTimers.current;
    const existing = timers.get(id);
    if (existing) clearTimeout(existing);
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      mirrorToDisk(meta, doc);
    }, 600));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mirrorToDisk]);

  // View (pan/zoom/rotation) changes fire on every drag tick, so this is
  // debounced independently of the doc — localStorage-only, no disk mirror.
  const viewTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const onViewChange = useCallback((view: WorldView) => {
    const id = activeWorldIdRef.current;
    if (!id) return;
    activeViewRef.current = view;
    setActiveView(view);
    const timers = viewTimers.current;
    const existing = timers.get(id);
    if (existing) clearTimeout(existing);
    timers.set(id, setTimeout(() => { timers.delete(id); saveViewLocal(id, view); }, 400));
  }, []);

  const flushPersist = useCallback(() => {
    for (const [id, t] of persistTimers.current) {
      clearTimeout(t);
      const meta = worldsRef.current.find((w) => w.id === id);
      const doc = id === activeWorldIdRef.current ? activeDocRef.current : loadDoc(id);
      if (meta && doc) mirrorToDisk(meta, doc);
    }
    persistTimers.current.clear();
    for (const [id, t] of viewTimers.current) {
      clearTimeout(t);
      if (id === activeWorldIdRef.current) saveViewLocal(id, activeViewRef.current);
    }
    viewTimers.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mirrorToDisk]);

  useEffect(() => {
    const flush = () => flushPersist();
    const onHidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [flushPersist]);

  const createWorld = useCallback((name: string): WorldMeta => {
    const trimmed = name.trim() || 'Untitled World';
    const slug = uniqueSlug(worldsRef.current.map((w) => w.slug), slugify(trimmed));
    const meta: WorldMeta = { id: newId(), name: trimmed, slug, updatedAt: Date.now() };
    const next = [...worldsRef.current, meta];
    worldsRef.current = next;
    setWorlds(next);
    saveWorlds(next);
    saveDocLocal(meta.id, emptyDoc());
    mirrorToDisk(meta, emptyDoc());
    return meta;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mirrorToDisk]);

  const renameWorld = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = worldsRef.current.map((w) => (w.id === id ? { ...w, name: trimmed, updatedAt: Date.now() } : w));
    worldsRef.current = next;
    setWorlds(next);
    saveWorlds(next);
  }, []);

  const deleteWorld = useCallback((id: string) => {
    const meta = worldsRef.current.find((w) => w.id === id);
    const next = worldsRef.current.filter((w) => w.id !== id);
    worldsRef.current = next;
    setWorlds(next);
    saveWorlds(next);
    removeDocLocal(id);
    removeViewLocal(id);
    if (activeWorldIdRef.current === id) {
      activeWorldIdRef.current = null; setActiveWorldId(null);
      activeDocRef.current = null; setActiveDoc(null);
      setActiveView(defaultView());
      undoStackRef.current = []; setUndoStack([]);
      redoStackRef.current = []; setRedoStack([]);
    }
    const handle = workspaceHandleRef.current;
    if (meta && handle) deleteFile(handle, [WORLDS_DIR], `${meta.slug}.canvas`).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteFile]);

  // No-ops when the requested world is already resident — this is the fix for
  // "leaving the world to edit a note, then coming back, resets everything":
  // navigating away no longer clears activeDoc/undo/redo (see closeWorld), so
  // re-opening the SAME world just needs to leave that state alone instead of
  // reloading (and resetting undo/redo) from storage.
  const openWorld = useCallback((id: string) => {
    localStorage.setItem(lastOpenKey(), id);
    if (activeWorldIdRef.current === id) return;
    activeWorldIdRef.current = id; setActiveWorldId(id);
    const doc = loadDoc(id) ?? emptyDoc();
    activeDocRef.current = doc; setActiveDoc(doc);
    const view = loadView(id);
    activeViewRef.current = view; setActiveView(view);
    undoStackRef.current = []; setUndoStack([]);
    redoStackRef.current = []; setRedoStack([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Navigating to the note list no longer destroys the active world's state —
  // it just flushes any pending debounced writes. The world stays fully
  // resident in memory (doc, undo/redo, view) so coming back is instant and
  // lossless; App's appView switch is what actually stops rendering it. Also
  // clears the "last open world" marker — the user explicitly left World Mode,
  // so a later reload should land back on the notes view, not back in here.
  const closeWorld = useCallback(() => {
    flushPersist();
    localStorage.removeItem(lastOpenKey());
  }, [flushPersist]);

  // Restore the world that was open at last reload (Item request: World Mode's
  // content should "survive on app reload") — content already does (every
  // command persists to localStorage synchronously via queuePersist below);
  // this restores which VIEW was showing, so the user lands back where they
  // left off instead of having to reopen the world by hand. Runs once, after
  // the worlds index has loaded for real (mirrors the notesReady-gated settle
  // above so it doesn't fire on a transient empty worlds list).
  const restoredOnceRef = useRef(false);
  const [restoredWorldId, setRestoredWorldId] = useState<string | null>(null);
  useEffect(() => {
    if (restoredOnceRef.current || !notesReady || worlds.length === 0) return;
    restoredOnceRef.current = true;
    const lastId = localStorage.getItem(lastOpenKey());
    if (lastId && worlds.some((w) => w.id === lastId)) {
      openWorld(lastId);
      setRestoredWorldId(lastId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesReady, worlds, openWorld]);

  // Directly stamps a field onto one node in the active doc — used for group
  // <-> folder binding, which isn't itself undoable (creating a folder isn't
  // undoable either); the undoable state is the node's parentId patch.
  const stampNodeField = useCallback((nodeId: string, patch: Record<string, unknown>) => {
    if (!activeDocRef.current || !activeWorldIdRef.current) return;
    const next = { ...activeDocRef.current, nodes: activeDocRef.current.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)) };
    activeDocRef.current = next;
    setActiveDoc(next);
    queuePersist(activeWorldIdRef.current, next);
  }, [queuePersist]);

  // Same non-undoable direct-stamp pattern as stampNodeField, for an edge —
  // used to keep a card-tag edge's `tagRef` current after the card is renamed.
  const stampEdgeField = useCallback((edgeId: string, patch: Record<string, unknown>) => {
    if (!activeDocRef.current || !activeWorldIdRef.current) return;
    const next = { ...activeDocRef.current, edges: activeDocRef.current.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)) };
    activeDocRef.current = next;
    setActiveDoc(next);
    queuePersist(activeWorldIdRef.current, next);
  }, [queuePersist]);

  // World -> workspace side effects (Step 4b), run after a command has been
  // applied (from applyWorldCommand, undo, or redo alike — undo/redo just
  // apply the inverted command, so the same effect logic covers all three and
  // stays symmetric for free). `docBefore` is the doc as it stood before `cmd`.
  const runWorkspaceEffects = useCallback(function runEffects(docBefore: WorldDoc, cmd: Command) {
    // A batch is just its sub-commands' effects in order — each sub-command in
    // a detach batch touches a different node, so sharing docBefore is safe.
    if (cmd.type === 'batch') { for (const c of cmd.commands) runEffects(docBefore, c); return; }
    // Clear tool: a worldOnly add/remove is invisible to the workspace — no
    // trash-move, no link/tag rewrites. Its inverse carries the flag too, so
    // undoing a Clear silently restores the nodes without re-appending links.
    if ((cmd.type === 'add' || cmd.type === 'remove') && cmd.worldOnly) return;
    const ops = opsRef.current;
    const notes = notesRef.current;

    if ((cmd.type === 'add' || cmd.type === 'remove') && cmd.edges.length > 0) {
      const nodeById = new Map<string, WorldNode>();
      for (const n of docBefore.nodes) nodeById.set(n.id, n);
      if (cmd.type === 'add') for (const n of cmd.nodes) nodeById.set(n.id, n);
      const noteById = new Map(notes.map((n) => [n.id, n]));
      const byFromNote = new Map<string, WorldEdge[]>();
      for (const e of cmd.edges) {
        if (!e.linkHref) continue;
        const fromNoteId = noteIdOf(nodeById.get(e.fromNode) as WorldNode);
        if (!fromNoteId) continue;
        const list = byFromNote.get(fromNoteId) ?? [];
        list.push(e);
        byFromNote.set(fromNoteId, list);
      }
      for (const [fromNoteId, edges] of byFromNote) {
        const fromNote = noteById.get(fromNoteId);
        if (!fromNote) continue;
        let content = fromNote.content;
        for (const e of edges) {
          const toNoteId = noteIdOf(nodeById.get(e.toNode) as WorldNode);
          const toNote = toNoteId ? noteById.get(toNoteId) : null;
          content = cmd.type === 'add'
            ? appendNoteLink(content, toNote?.title || 'Untitled', e.linkHref!)
            : removeNoteLink(content, e.linkHref!);
        }
        if (content !== fromNote.content) ops.updateNote(fromNoteId, { content });
      }

      // Card <-> note tags (Phase 5): group by the note-backed endpoint (either side).
      const byTaggedNote = new Map<string, WorldEdge[]>();
      for (const e of cmd.edges) {
        if (!e.tagRef) continue;
        const noteId = noteIdOf(nodeById.get(e.fromNode) as WorldNode) || noteIdOf(nodeById.get(e.toNode) as WorldNode);
        if (!noteId) continue;
        const list = byTaggedNote.get(noteId) ?? [];
        list.push(e);
        byTaggedNote.set(noteId, list);
      }
      for (const [noteId, edges] of byTaggedNote) {
        const note = noteById.get(noteId);
        if (!note) continue;
        let content = note.content;
        for (const e of edges) {
          if (cmd.type === 'add') {
            content = appendTag(content, e.tagRef!);
          } else {
            // A duplicate-label card still wired to this note keeps the tag alive.
            const stillAsserted = activeDocRef.current?.edges.some((se) => se.tagRef === e.tagRef &&
              (noteIdOf(nodeById.get(se.fromNode) as WorldNode) === noteId || noteIdOf(nodeById.get(se.toNode) as WorldNode) === noteId));
            if (!stillAsserted) content = removeTag(content, e.tagRef!);
          }
        }
        if (content !== note.content) ops.updateNote(noteId, { content });
      }
    }

    // Item 15: world-side node deletion/undo reflects to the workspace trash
    // (not a permanent delete — reversible, matching the app's normal delete
    // idiom). 'remove' trashes the underlying notes of any removed note/
    // media-with-noteId node; its inverse ('add', via undo) restores them —
    // same effects choke point as everything else here, so undo/redo stay
    // symmetric for free.
    if (cmd.type === 'remove' && cmd.nodes.length > 0) {
      const noteIds = cmd.nodes.map(noteIdOf).filter((id): id is string => !!id);
      if (noteIds.length > 0) ops.moveNotesToTrash(noteIds);
    }
    if (cmd.type === 'add' && cmd.nodes.length > 0) {
      const noteById = new Map(notes.map((n) => [n.id, n]));
      for (const n of cmd.nodes) {
        const noteId = noteIdOf(n);
        const note = noteId ? noteById.get(noteId) : undefined;
        if (note?.isTrash) ops.restoreFromTrash(note.id);
      }
    }

    if (cmd.type === 'patch' && activeDocRef.current) {
      const docAfter = activeDocRef.current;
      const node = docAfter.nodes.find((n) => n.id === cmd.id);
      if (node) {
        const noteId = noteIdOf(node);
        if (noteId && Object.prototype.hasOwnProperty.call(cmd.after, 'parentId')) {
          if (node.parentId) {
            const group = docAfter.nodes.find((n) => n.id === node.parentId && n.type === 'group') as GroupNode | undefined;
            if (group) {
              let folderId = group.folderId;
              if (!folderId || !ops.folders.some((f) => f.id === folderId)) {
                folderId = ops.addFolder(group.label || 'Group').id;
                stampNodeField(group.id, { folderId });
              }
              ops.moveNotesToFolder([noteId], folderId);
            }
          } else {
            ops.moveNotesToFolder([noteId], null);
          }
        }
        if (node.type === 'group' && node.folderId && Object.prototype.hasOwnProperty.call(cmd.after, 'label')) {
          // Phase 7: renaming a bound group renames the workspace folder itself
          // (files move on disk) instead of minting a parallel folder. When the
          // rename could corrupt files (name collision, nested folders) the op
          // refuses and the world just shows why — label stays, folder doesn't.
          const res = ops.renameFolder(node.folderId, node.label || 'Group');
          if (res.ok === true) {
            if (res.id !== node.folderId) stampNodeField(node.id, { folderId: res.id });
          } else {
            window.dispatchEvent(new CustomEvent('valx-world-toast', { detail: `Folder not renamed: ${res.reason}` }));
          }
        }
        // Card rename (Phase 5): retag every note this card is wired to. Matched by
        // "other endpoint is note-backed", not by an existing tagRef — a card wired
        // via Link Lasso while still untitled has no tagRef yet, so gating on
        // e.tagRef would leave it untagged forever even after the card got a name.
        if (node.type === 'text' && Object.prototype.hasOwnProperty.call(cmd.after, 'text')) {
          const nodeByIdAfter = new Map(docAfter.nodes.map((n) => [n.id, n]));
          const cardEdges = docAfter.edges.filter((e) => {
            if (e.fromNode !== node.id && e.toNode !== node.id) return false;
            const otherId = e.fromNode === node.id ? e.toNode : e.fromNode;
            return !!noteIdOf(nodeByIdAfter.get(otherId) as WorldNode);
          });
          if (cardEdges.length > 0) {
            const oldTag = tagForCard(String(cmd.before.text ?? ''));
            const newTag = tagForCard(String(cmd.after.text ?? ''));
            if (oldTag !== newTag) {
              for (const e of cardEdges) {
                const otherId = e.fromNode === node.id ? e.toNode : e.fromNode;
                const otherNoteId = noteIdOf(nodeByIdAfter.get(otherId) as WorldNode);
                if (!otherNoteId) continue;
                const note = notes.find((n) => n.id === otherNoteId);
                if (!note) continue;
                let content = note.content;
                if (oldTag) {
                  const stillAsserted = docAfter.edges.some((se) => se.id !== e.id && se.tagRef === oldTag &&
                    (noteIdOf(nodeByIdAfter.get(se.fromNode) as WorldNode) === otherNoteId || noteIdOf(nodeByIdAfter.get(se.toNode) as WorldNode) === otherNoteId));
                  if (!stillAsserted) content = removeTag(content, oldTag);
                }
                if (newTag) content = appendTag(content, newTag);
                if (content !== note.content) ops.updateNote(otherNoteId, { content });
                stampEdgeField(e.id, { tagRef: newTag ?? undefined });
              }
            }
          }
        }
      }
    }
  }, [stampNodeField, stampEdgeField]);

  // Refs are updated inline (not just at render time) so two onApplyCommand
  // calls fired in the same tick — e.g. a fast double dock-click, before React
  // has re-rendered — stack on top of each other instead of the second one
  // silently clobbering the first by computing off a stale base doc.
  const applyWorldCommand = useCallback((cmd: Command | null) => {
    if (!cmd || !activeDocRef.current || !activeWorldIdRef.current) return;
    const id = activeWorldIdRef.current;
    const docBefore = activeDocRef.current;
    const enriched = enrichAddEdges(docBefore, cmd, notesRef.current, opsRef.current);
    const next = applyCommand(docBefore, enriched);
    activeDocRef.current = next;
    setActiveDoc(next);
    const nextUndo = [...undoStackRef.current, invertCommand(enriched)];
    undoStackRef.current = nextUndo;
    setUndoStack(nextUndo);
    redoStackRef.current = [];
    setRedoStack([]);
    queuePersist(id, next);
    runWorkspaceEffects(docBefore, enriched);
  }, [queuePersist, runWorkspaceEffects]);

  const undo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0 || !activeDocRef.current || !activeWorldIdRef.current) return;
    const inv = stack[stack.length - 1];
    const docBefore = activeDocRef.current;
    const next = applyCommand(docBefore, inv);
    activeDocRef.current = next;
    setActiveDoc(next);
    const nextUndoStack = stack.slice(0, -1);
    undoStackRef.current = nextUndoStack;
    setUndoStack(nextUndoStack);
    const nextRedoStack = [...redoStackRef.current, invertCommand(inv)];
    redoStackRef.current = nextRedoStack;
    setRedoStack(nextRedoStack);
    queuePersist(activeWorldIdRef.current, next);
    runWorkspaceEffects(docBefore, inv);
  }, [queuePersist, runWorkspaceEffects]);

  const redo = useCallback(() => {
    const stack = redoStackRef.current;
    if (stack.length === 0 || !activeDocRef.current || !activeWorldIdRef.current) return;
    const inv = stack[stack.length - 1];
    const docBefore = activeDocRef.current;
    const next = applyCommand(docBefore, inv);
    activeDocRef.current = next;
    setActiveDoc(next);
    const nextRedoStack = stack.slice(0, -1);
    redoStackRef.current = nextRedoStack;
    setRedoStack(nextRedoStack);
    const nextUndoStack = [...undoStackRef.current, invertCommand(inv)];
    undoStackRef.current = nextUndoStack;
    setUndoStack(nextUndoStack);
    queuePersist(activeWorldIdRef.current, next);
    runWorkspaceEffects(docBefore, inv);
  }, [queuePersist, runWorkspaceEffects]);

  // "Import Valx spaces" (Item 13, formerly the one-click "Mirror Workspace"):
  // imports workspace notes not yet represented into the resident world, as one
  // undoable command, scoped to either every note or a chosen set of folders.
  // Effects fire from applyWorldCommand as usual but are idempotent (linkHref/
  // parentId/folderId are all preset on the built command, so appendNoteLink/
  // moveNotesToFolder find nothing to change) — see buildWorkspaceImport's doc comment.
  const importSpaces = useCallback((scope: ImportScope) => {
    if (!activeDocRef.current || !activeWorldIdRef.current) return;
    const ws: WorkspaceSnapshot = {
      notes: notesRef.current.filter((n) => !n.isTrash),
      folders: opsRef.current.folders,
      noteExtensions: opsRef.current.noteExtensions,
    };
    applyWorldCommand(buildWorkspaceImport(activeDocRef.current, ws, scope));
  }, [applyWorldCommand]);

  // Tags declared by text cards across every world — first-class, independent of note
  // wiring (see world.ts's worldCardTags). The active world reads from live state so a
  // freshly-typed card tag shows up immediately; other worlds read their last-persisted
  // doc, which is fine since only the open world can be edited right now.
  const cardTags = useMemo(() => {
    const set = new Set<string>();
    for (const w of worlds) {
      const doc = w.id === activeWorldId ? activeDoc : loadDoc(w.id);
      if (doc) for (const t of worldCardTags(doc)) set.add(t);
    }
    return Array.from(set);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worlds, activeWorldId, activeDoc]);

  return {
    worlds, activeWorldId, activeDoc, activeView, restoredWorldId, cardTags,
    createWorld, renameWorld, deleteWorld, openWorld, closeWorld,
    applyWorldCommand, onViewChange, undo, redo, importSpaces,
    canUndo: undoStack.length > 0, canRedo: redoStack.length > 0,
  };
}
