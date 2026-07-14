import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Note, Folder } from '../types';
import {
  WorldDoc, WorldNode, WorldEdge, Command, Point, Rect, NodeColor, WorldView, ImportScope,
  newId, nodeBounds, edgeAnchor, defaultSides, bezierPath,
  buildLinkLassoEdges, rectFromPoints, nodesInRect, edgesCutByStroke,
  colorHex, edgeColor, linkedNodeIds, nextImportOrigin, layoutImportColumn, noteIdOf,
  fitMediaSize, NOTE_DEFAULT, MEDIA_FALLBACK, captionFontSize,
  WORLD_PALETTE, fisheyeScale,
  buildAddNode, buildMoveNodes, buildResizeNode, buildPatchNode, buildCreateGroup,
  childrenOf, groupAt, buildAttachToGroup, buildDetachChildren,
} from '../lib/world';
import { importDroppedFile } from '../lib/worldMedia';
import { mediaDisplaySrc } from '../lib/desktop';
import {
  ChevronLeft, Group, File, FileText, FileImage, Waypoints, Scissors, Paintbrush, Palette, Unlink,
  Undo2, Redo2, Focus, Music, Paperclip, Sprout, X, Check,
  Maximize2, Minimize2,
} from 'lucide-react';

interface WorldCanvasProps {
  doc: WorldDoc | null;
  notes: Note[];
  folders: Folder[];
  worldName: string;
  isDarkMode: boolean;
  initialView: WorldView;
  onViewChange: (view: WorldView) => void;
  onApplyCommand: (cmd: Command | null) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onBackToNotes: () => void;
  onRequestNoteList: () => void;
  /** Wraps a solo-imported media file in a new note (Phase 4) and returns its id. */
  onCreateMediaNote: (m: { name: string; src: string; kind: 'image' | 'audio' | 'video' | 'file' }) => string;
  /** Imports workspace notes not yet represented into this world (Item 13), scoped to all-or-chosen-folders, as one undo step. */
  onImportSpaces: (scope: ImportScope) => void;
  /** Same flag/toggle the app's F11 binding drives — surfaced as a toolbar button. */
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  className?: string;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
// Cleaning-brush mouse cursor for the armed Clear tool (lucide Paintbrush
// outline, lime, as a data URI — CSS custom cursors can't reference components).
const BRUSH_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%2332CD32' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m14.622 17.897-10.68-2.913'/%3E%3Cpath d='M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z'/%3E%3Cpath d='M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15'/%3E%3C/svg%3E") 4 20, crosshair`;
const DEFAULT_TEXT_SIZE = { width: 220, height: 120 };
const DEFAULT_GROUP_SIZE = { width: 420, height: 320 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type DockKind = 'group' | 'text' | 'note' | 'media';

/** Delete every selected node (and its incident edges) plus any separately-selected edges, as one command. */
function buildDeleteSelection(doc: WorldDoc, nodeIds: string[], edgeIds: string[]): Command | null {
  const idSet = new Set(nodeIds);
  const nodes = doc.nodes.filter((n) => idSet.has(n.id));
  const incident = doc.edges.filter((e) => idSet.has(e.fromNode) || idSet.has(e.toNode));
  const edgeIdSet = new Set([...incident.map((e) => e.id), ...edgeIds]);
  const edges = doc.edges.filter((e) => edgeIdSet.has(e.id));
  if (nodes.length === 0 && edges.length === 0) return null;
  return { type: 'remove', nodes, edges };
}

/** Strip a single leading `#` from a text node's stored value before display.
 *  The visual green `#` prefix is always rendered by the JSX — this prevents
 *  double-`#` when the user typed the hash themselves (e.g. `#hello` → `#hello`,
 *  not `##hello`). Edit mode renders `n.text` as-is, so no strip happens there. */
function displayText(raw: string): string {
  return raw.startsWith('#') ? raw.slice(1) : raw;
}

/** Clear tool: remove nodes (groups take their children along) and incident
 *  edges from the WORLD only — `worldOnly` makes runWorkspaceEffects skip the
 *  trash-move/link-removal side effects, so the underlying files are untouched. */
function buildClearNodes(doc: WorldDoc, ids: string[]): Command | null {
  const idSet = new Set(ids);
  for (const id of ids) {
    const n = doc.nodes.find((x) => x.id === id);
    if (n?.type === 'group') for (const c of childrenOf(doc, id)) idSet.add(c.id);
  }
  const nodes = doc.nodes.filter((n) => idSet.has(n.id));
  const edges = doc.edges.filter((e) => idSet.has(e.fromNode) || idSet.has(e.toNode));
  if (nodes.length === 0) return null;
  return { type: 'remove', nodes, edges, worldOnly: true };
}

type Interaction =
  | { kind: 'pan'; startClientX: number; startClientY: number; startPan: Point }
  | { kind: 'move'; ids: string[]; startClientX: number; startClientY: number }
  | { kind: 'resize'; id: string; startClientX: number; startClientY: number; startW: number; startH: number }
  | { kind: 'marquee'; start: Point; current: Point; clear?: boolean }
  | { kind: 'linklasso'; points: Point[] }
  | { kind: 'scissor'; points: Point[] }
  | null;

// Theme tokens — World Mode is black+lime in dark mode, white+lime in light
// mode, following the app's normal toggle. No purple anywhere.
function themeTokens(isDark: boolean) {
  return {
    canvasBg: isDark ? 'bg-black' : 'bg-white',
    dot: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    headerBorder: isDark ? 'border-neutral-900' : 'border-slate-100',
    headerText: isDark ? 'text-slate-300' : 'text-slate-600',
    nodeBg: isDark ? 'bg-neutral-900' : 'bg-white',
    nodeBorder: isDark ? 'border-neutral-700' : 'border-slate-200',
    nodeText: isDark ? 'text-slate-100' : 'text-slate-800',
    subText: isDark ? 'text-slate-500' : 'text-slate-400',
    groupBorder: isDark ? 'border-neutral-700' : 'border-slate-300',
    groupBg: isDark ? 'bg-white/[0.03]' : 'bg-black/[0.02]',
    groupLabel: isDark ? 'text-slate-400' : 'text-slate-500',
    chromeBg: isDark ? 'bg-neutral-900/95 border-neutral-800' : 'bg-white/95 border-slate-200',
    chromeIcon: isDark ? 'text-slate-400 hover:text-slate-200 hover:bg-neutral-800' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100',
    statusPill: isDark ? 'bg-neutral-900/80 border-neutral-800 text-slate-400' : 'bg-white/80 border-slate-200 text-slate-500',
    emptyCardBg: isDark ? 'bg-neutral-900/70 border-neutral-700' : 'bg-slate-50/90 border-slate-200',
    emptyCardText: isDark ? 'text-slate-400' : 'text-slate-500',
    toast: isDark ? 'bg-neutral-800 text-slate-200' : 'bg-white text-slate-700 border border-slate-200 shadow-lg',
    popoverBg: isDark ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-slate-200',
  };
}

export function WorldCanvas({ doc, notes, folders, worldName, isDarkMode, initialView, onViewChange, onApplyCommand, onUndo, onRedo, canUndo, canRedo, onBackToNotes, onRequestNoteList, onCreateMediaNote, onImportSpaces, isFullscreen, onToggleFullscreen, className = '' }: WorldCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pan, setPan] = useState<Point>(initialView.pan);
  const [zoom, setZoom] = useState(initialView.zoom);
  // Read-only since the Rotate tool was removed — saved views may still carry a
  // non-zero rotation, which keeps rendering (and inverse hit-testing) as before.
  const [rotation] = useState(initialView.rotation);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [linkLassoArmed, setLinkLassoArmed] = useState(false);
  const [scissorArmed, setScissorArmed] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ dx: 0, dy: 0 });
  const [resizeDelta, setResizeDelta] = useState({ dw: 0, dh: 0 });
  const [marqueePreview, setMarqueePreview] = useState<{ start: Point; current: Point } | null>(null);
  const [linkLassoPreview, setLinkLassoPreview] = useState<Point[]>([]);
  const [scissorPreview, setScissorPreview] = useState<Point[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);
  const [hotGroupId, setHotGroupId] = useState<string | null>(null);
  const [poppingIds, setPoppingIds] = useState<Set<string>>(new Set());
  // Delete/Backspace on note-backed nodes or groups is destructive (moves the
  // underlying notes to the workspace trash), so it waits on this confirmation.
  const [confirmDelete, setConfirmDelete] = useState<{ cmd: Command; count: number } | null>(null);
  const [shudderIds, setShudderIds] = useState<Set<string>>(new Set());
  const [breakingEdges, setBreakingEdges] = useState<WorldEdge[]>([]);

  const panRef = useRef(pan); panRef.current = pan;
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const rotationRef = useRef(rotation); rotationRef.current = rotation;
  const docRef = useRef(doc); docRef.current = doc;
  const interactionRef = useRef<Interaction>(null);
  const textInputRefs = useRef<Record<string, string>>({});
  const dragOffsetRef = useRef(dragOffset);
  const resizeDeltaRef = useRef(resizeDelta);
  const spaceHeldRef = useRef(false);
  const prevLinkedRef = useRef<Set<string>>(new Set());
  const pendingImportOriginRef = useRef<Point | null>(null);

  const t = themeTokens(isDarkMode);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  // Out-of-band warnings from useWorlds' workspace effects (e.g. a refused
  // folder rename) surface through the same toast — window event, same idiom
  // as the editor's 'valx-insert-table'.
  useEffect(() => {
    const onToast = (e: Event) => showToast(String((e as CustomEvent).detail ?? ''));
    window.addEventListener('valx-world-toast', onToast);
    return () => window.removeEventListener('valx-world-toast', onToast);
  }, []);

  const popIds = (ids: string[]) => {
    if (ids.length === 0) return;
    setPoppingIds((s) => new Set([...s, ...ids]));
    setTimeout(() => {
      setPoppingIds((s) => { const copy = new Set(s); ids.forEach((id) => copy.delete(id)); return copy; });
    }, 320);
  };

  // Undoes the outer canvas-rotation transform (about the viewport center)
  // before the existing pan/zoom inverse — geometry elsewhere (hit-test,
  // marquee, scissor) stays axis-aligned per design, but a raw mouse click
  // needs this to land in the right spot while the canvas is rotated.
  const screenToCanvas = useCallback((clientX: number, clientY: number): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const rad = (-rotationRef.current * Math.PI) / 180;
    const dx = clientX - cx, dy = clientY - cy;
    const rx = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
    const ry = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
    return { x: (rx - rect.left - panRef.current.x) / zoomRef.current, y: (ry - rect.top - panRef.current.y) / zoomRef.current };
  }, []);

  const clearSelection = () => { setSelectedIds([]); setSelectedEdgeIds([]); };

  // Auto-save the camera (pan/zoom/rotation) — useWorlds debounces the actual
  // write, so this can fire on every change without extra bookkeeping here.
  // `fisheye` is always true now (item 4: no toggle) — kept in the persisted
  // shape only for back-compat with docs saved before this change.
  useEffect(() => {
    onViewChange({ pan, zoom, rotation, fisheye: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pan.x, pan.y, zoom, rotation]);

  // Shudder: when a change drops a node out of linkedNodeIds (its last wire was
  // cut), give it one shudder pulse then let the glow simply not re-apply.
  useEffect(() => {
    if (!doc) return;
    const next = linkedNodeIds(doc);
    const prev = prevLinkedRef.current;
    const newlyUnlinked = [...prev].filter((id) => !next.has(id));
    if (newlyUnlinked.length > 0) {
      setShudderIds((s) => new Set([...s, ...newlyUnlinked]));
      setTimeout(() => {
        setShudderIds((s) => { const copy = new Set(s); newlyUnlinked.forEach((id) => copy.delete(id)); return copy; });
      }, 500);
    }
    prevLinkedRef.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.edges]);

  // Space-hold tracked globally so a canvas mousedown can tell "pan" from "select".
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      // Ignore while typing (label/card editing) so a literal space doesn't arm panning.
      const typing = document.activeElement?.tagName === 'INPUT' || (document.activeElement as HTMLElement | null)?.isContentEditable;
      if (e.code === 'Space' && !typing) spaceHeldRef.current = true;
      if (e.key === 'Escape') {
        clearSelection(); setEditingId(null); setLinkLassoArmed(false); setScissorArmed(false); setClearArmed(false);
        setColorPickerId(null); setHoveredId(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && editingId === null && document.activeElement?.tagName !== 'INPUT') {
        const d = docRef.current;
        if (!d) return;
        const cmd = buildDeleteSelection(d, selectedIds, selectedEdgeIds);
        if (!cmd) return;
        // Note-backed nodes and groups touch real workspace files — confirm
        // first (and point at the Clear tool for the non-destructive path).
        // Pure text-card / edge deletions stay instant.
        const destructive = cmd.type === 'remove' ? cmd.nodes.filter((n) => n.type === 'group' || noteIdOf(n)).length : 0;
        if (destructive > 0) setConfirmDelete({ cmd, count: destructive });
        else { onApplyCommand(cmd); clearSelection(); }
      }
    };
    const ku = (e: KeyboardEvent) => { if (e.code === 'Space') spaceHeldRef.current = false; };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, selectedEdgeIds, editingId, onApplyCommand]);

  // Single window-level pointer tracker for pan / node-move / resize / marquee / link-lasso / scissor / rotate.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const it = interactionRef.current;
      if (!it) return;
      if (it.kind === 'pan') {
        setPan({ x: it.startPan.x + (e.clientX - it.startClientX), y: it.startPan.y + (e.clientY - it.startClientY) });
      } else if (it.kind === 'move') {
        const dx = (e.clientX - it.startClientX) / zoomRef.current;
        const dy = (e.clientY - it.startClientY) / zoomRef.current;
        dragOffsetRef.current = { dx, dy };
        setDragOffset({ dx, dy });
        // Attach affordance: highlight the group a single dragged non-group node now sits inside.
        const d = docRef.current;
        if (d && it.ids.length === 1) {
          const node = d.nodes.find((n) => n.id === it.ids[0]);
          if (node && node.type !== 'group') {
            const centerPt = { x: node.x + dx + node.width / 2, y: node.y + dy + node.height / 2 };
            const hot = groupAt(d, centerPt, node.id);
            setHotGroupId(hot ? hot.id : null);
          } else {
            setHotGroupId(null);
          }
        }
      } else if (it.kind === 'resize') {
        const dw = (e.clientX - it.startClientX) / zoomRef.current;
        const dh = (e.clientY - it.startClientY) / zoomRef.current;
        resizeDeltaRef.current = { dw, dh };
        setResizeDelta({ dw, dh });
      } else if (it.kind === 'marquee') {
        const current = screenToCanvas(e.clientX, e.clientY);
        it.current = current;
        setMarqueePreview({ start: it.start, current });
      } else if (it.kind === 'linklasso') {
        it.points.push(screenToCanvas(e.clientX, e.clientY));
        setLinkLassoPreview([...it.points]);
      } else if (it.kind === 'scissor') {
        it.points.push(screenToCanvas(e.clientX, e.clientY));
        setScissorPreview([...it.points]);
      }
    };
    const onUp = (e: MouseEvent) => {
      const it = interactionRef.current;
      if (!it) return;
      const d = docRef.current;
      if (it.kind === 'move' && d) {
        const { dx, dy } = dragOffsetRef.current;
        if (dx !== 0 || dy !== 0) {
          const node = it.ids.length === 1 ? d.nodes.find((n) => n.id === it.ids[0]) : undefined;
          if (node && node.type !== 'group') {
            const newX = node.x + dx, newY = node.y + dy;
            const centerPt = { x: newX + node.width / 2, y: newY + node.height / 2 };
            const hotGroup = groupAt(d, centerPt, node.id);
            const targetParent = hotGroup ? hotGroup.id : undefined;
            if (targetParent !== node.parentId) onApplyCommand(buildAttachToGroup(d, node.id, targetParent, newX, newY));
            else onApplyCommand(buildMoveNodes(it.ids, dx, dy));
          } else {
            onApplyCommand(buildMoveNodes(it.ids, dx, dy));
          }
        }
        setDragOffset({ dx: 0, dy: 0 });
        dragOffsetRef.current = { dx: 0, dy: 0 };
        setHotGroupId(null);
      } else if (it.kind === 'resize' && d) {
        const node = d.nodes.find((n) => n.id === it.id);
        if (node) {
          const w = Math.max(80, it.startW + resizeDeltaRef.current.dw);
          const h = Math.max(50, it.startH + resizeDeltaRef.current.dh);
          onApplyCommand(buildResizeNode(d, it.id, w, h));
        }
        resizeDeltaRef.current = { dw: 0, dh: 0 };
        setResizeDelta({ dw: 0, dh: 0 });
      } else if (it.kind === 'marquee' && d) {
        const rect = rectFromPoints(it.start, it.current);
        if (it.clear) {
          const cmd = buildClearNodes(d, nodesInRect(d, rect));
          if (cmd) { onApplyCommand(cmd); showToast('Cleared from world — files kept.'); }
        } else {
          setSelectedIds(nodesInRect(d, rect));
          setSelectedEdgeIds([]);
        }
        setMarqueePreview(null);
      } else if (it.kind === 'linklasso' && d) {
        onApplyCommand(buildLinkLassoEdges(d, it.points));
        setLinkLassoPreview([]);
      } else if (it.kind === 'scissor' && d) {
        const cutIds = edgesCutByStroke(d, it.points);
        if (cutIds.length > 0) {
          const cutEdges = d.edges.filter((edge) => cutIds.includes(edge.id));
          setBreakingEdges((prev) => [...prev, ...cutEdges]);
          setTimeout(() => {
            onApplyCommand({ type: 'remove', nodes: [], edges: cutEdges });
            setBreakingEdges((prev) => prev.filter((edge) => !cutEdges.some((c) => c.id === edge.id)));
          }, 360);
        }
        setScissorPreview([]);
      }
      interactionRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onApplyCommand, screenToCanvas]);

  if (!doc) return <div className={`flex items-center justify-center ${t.canvasBg} ${t.emptyCardText} ${className}`}>Loading world…</div>;

  const strokeArmed = linkLassoArmed || scissorArmed;
  const armed = strokeArmed || clearArmed;

  const beginPan = (clientX: number, clientY: number) => {
    interactionRef.current = { kind: 'pan', startClientX: clientX, startClientY: clientY, startPan: panRef.current };
  };

  const clearNodes = (ids: string[]) => {
    const cmd = buildClearNodes(doc, ids);
    if (cmd) { onApplyCommand(cmd); showToast('Cleared from world — files kept.'); }
  };

  const beginNodeDrag = (node: WorldNode, e: React.MouseEvent) => {
    // Space+drag pans even when the cursor lands on a node — without this check
    // first, stopPropagation below would swallow the mousedown and only empty
    // canvas could ever be panned this way.
    if (spaceHeldRef.current) { e.stopPropagation(); beginPan(e.clientX, e.clientY); return; }
    if (strokeArmed) return; // let the canvas start a link-lasso/scissor stroke instead
    if (clearArmed) { e.stopPropagation(); clearNodes([node.id]); return; }
    // Ctrl/Cmd+hold on a (non-group) node: detach it from its group — a no-op
    // if it's already top-level — then fall straight into a normal move drag
    // so it follows the cursor right away. Plain drag is the marquee gesture
    // now (see onCanvasMouseDown), so Ctrl on a node means exactly one thing.
    if ((e.ctrlKey || e.metaKey) && node.type !== 'group') {
      e.stopPropagation();
      if (node.parentId) detachFromGroup(node);
      setSelectedIds([node.id]);
      setSelectedEdgeIds([]);
      setColorPickerId(null);
      interactionRef.current = { kind: 'move', ids: [node.id], startClientX: e.clientX, startClientY: e.clientY };
      return;
    }
    e.stopPropagation();
    if (editingId === node.id) return;
    let ids = selectedIds;
    if (e.shiftKey) ids = selectedIds.includes(node.id) ? selectedIds : [...selectedIds, node.id];
    else if (!selectedIds.includes(node.id)) ids = [node.id];
    setSelectedIds(ids);
    setSelectedEdgeIds([]);
    setColorPickerId(null);
    // Dragging a group also drags its explicit children (by parentId, not geometry — an overhanging child still travels with it).
    const extra = node.type === 'group' ? childrenOf(doc, node.id).map((n) => n.id) : [];
    const allIds = Array.from(new Set([...ids, ...extra]));
    interactionRef.current = { kind: 'move', ids: allIds, startClientX: e.clientX, startClientY: e.clientY };
  };

  const beginResize = (node: WorldNode, e: React.MouseEvent) => {
    if (armed) return;
    e.stopPropagation();
    interactionRef.current = { kind: 'resize', id: node.id, startClientX: e.clientX, startClientY: e.clientY, startW: node.width, startH: node.height };
  };

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && spaceHeldRef.current)) {
      e.preventDefault();
      beginPan(e.clientX, e.clientY);
      return;
    }
    if (e.button === 0 && strokeArmed) {
      const pt = screenToCanvas(e.clientX, e.clientY);
      interactionRef.current = linkLassoArmed ? { kind: 'linklasso', points: [pt] } : { kind: 'scissor', points: [pt] };
      return;
    }
    // Plain left-drag on empty canvas is the marquee gesture (Ctrl is reserved
    // for detaching a node from its group — see beginNodeDrag). A drag that
    // never moves resolves to an empty rect on mouseup, so a plain click still
    // clears the selection for free without a separate branch here. With the
    // Clear tool armed the same marquee sweeps nodes out of the world instead.
    if (e.button === 0) {
      setEditingId(null);
      setColorPickerId(null);
      const pt = screenToCanvas(e.clientX, e.clientY);
      interactionRef.current = { kind: 'marquee', start: pt, current: pt, clear: clearArmed };
      setMarqueePreview({ start: pt, current: pt });
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      const worldX = (cx - pan.x) / zoom, worldY = (cy - pan.y) / zoom;
      const factor = Math.exp(-e.deltaY * 0.001);
      const nextZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
      setZoom(nextZoom);
      setPan({ x: cx - worldX * nextZoom, y: cy - worldY * nextZoom });
    } else {
      setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
  };

  const spawnTextCard = (pt: Point, mode: 'center' | 'topleft' = 'center') => {
    const box = mode === 'center'
      ? { x: pt.x - DEFAULT_TEXT_SIZE.width / 2, y: pt.y - DEFAULT_TEXT_SIZE.height / 2, ...DEFAULT_TEXT_SIZE }
      : { x: pt.x, y: pt.y, ...DEFAULT_TEXT_SIZE };
    const node: WorldNode = { id: newId(), type: 'text', x: box.x, y: box.y, width: box.width, height: box.height, text: '' };
    onApplyCommand(buildAddNode(node));
    setSelectedIds([node.id]);
    setEditingId(node.id);
    popIds([node.id]);
  };

  const spawnGroup = (pt: Point, mode: 'center' | 'topleft' = 'center') => {
    const box = mode === 'center'
      ? { x: pt.x - DEFAULT_GROUP_SIZE.width / 2, y: pt.y - DEFAULT_GROUP_SIZE.height / 2, ...DEFAULT_GROUP_SIZE }
      : { x: pt.x, y: pt.y, ...DEFAULT_GROUP_SIZE };
    const cmd = buildCreateGroup(box, 'New Group');
    onApplyCommand(cmd);
    if (cmd.type === 'add') popIds([cmd.nodes[0].id]);
  };

  const viewportCenter = (): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return screenToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const triggerMediaPicker = (originCenterHint: Point) => {
    pendingImportOriginRef.current = { x: originCenterHint.x - 120, y: originCenterHint.y - 80 };
    fileInputRef.current?.click();
  };

  const handleDockClick = (kind: DockKind) => {
    if (kind === 'text') spawnTextCard(viewportCenter(), 'center');
    else if (kind === 'group') spawnGroup(viewportCenter(), 'center');
    else if (kind === 'note') { onRequestNoteList(); showToast('Expand All Notes or a group in the sidebar, then drag notes onto the canvas.'); }
    else triggerMediaPicker(viewportCenter());
  };

  const handleFilesImported = async (files: FileList | File[], origin?: Point) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const imported = await Promise.all(list.map((f) => importDroppedFile(f).catch(() => null)));
    const valid = imported.filter((m): m is NonNullable<typeof m> => m !== null);
    if (valid.length === 0) { showToast('Could not import that file.'); return; }
    const sizes = valid.map((m) => (m.kind === 'image' && m.naturalWidth && m.naturalHeight) ? fitMediaSize(m.naturalWidth, m.naturalHeight) : { ...MEDIA_FALLBACK });
    const baseOrigin = origin ?? nextImportOrigin(doc);
    const points = layoutImportColumn(baseOrigin, sizes);
    const nodes: WorldNode[] = valid.map((m, i) => {
      const noteId = onCreateMediaNote({ name: m.name, src: m.src, kind: m.kind });
      return { id: newId(), type: 'media', x: points[i].x, y: points[i].y, width: sizes[i].width, height: sizes[i].height, src: m.src, kind: m.kind, name: m.name, noteId };
    });
    onApplyCommand({ type: 'add', nodes, edges: [] });
    popIds(nodes.map((n) => n.id));
  };

  const onFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    const origin = pendingImportOriginRef.current ?? viewportCenter();
    pendingImportOriginRef.current = null;
    e.target.value = '';
    if (files && files.length > 0) await handleFilesImported(files, origin);
  };

  const handleCanvasDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const pt = screenToCanvas(e.clientX, e.clientY);

    const kind = e.dataTransfer.getData('application/x-valx-node-kind') as DockKind | '';
    if (kind === 'text') { spawnTextCard(pt, 'center'); return; }
    if (kind === 'group') { spawnGroup(pt, 'center'); return; }

    const notesData = e.dataTransfer.getData('application/x-bear-notes');
    if (notesData) {
      try {
        const ids = JSON.parse(notesData) as string[];
        if (ids.length > 0) {
          const sizes = ids.map(() => NOTE_DEFAULT);
          const points = layoutImportColumn(pt, sizes);
          const nodes: WorldNode[] = ids.map((id, i) => ({ id: newId(), type: 'note', x: points[i].x, y: points[i].y, width: sizes[i].width, height: sizes[i].height, noteId: id }));
          onApplyCommand({ type: 'add', nodes, edges: [] });
          popIds(nodes.map((n) => n.id));
        }
      } catch { /* ignore malformed payload */ }
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleFilesImported(e.dataTransfer.files, pt);
    }
  };

  const fitToContent = () => {
    const bounds = nodeBounds(doc);
    const rect = containerRef.current?.getBoundingClientRect();
    if (!bounds || !rect) { setPan({ x: 0, y: 0 }); setZoom(1); return; }
    const pad = 80;
    const z = clamp(Math.min(rect.width / (bounds.width + pad * 2), rect.height / (bounds.height + pad * 2)), MIN_ZOOM, MAX_ZOOM);
    setZoom(z);
    setPan({ x: rect.width / 2 - (bounds.x + bounds.width / 2) * z, y: rect.height / 2 - (bounds.y + bounds.height / 2) * z });
  };

  const commitText = (node: WorldNode, field: 'text' | 'subtext', el: HTMLElement) => {
    const key = `${node.id}-${field}`;
    const value = textInputRefs.current[key] !== undefined ? textInputRefs.current[key] : (el.textContent ?? '');
    onApplyCommand(buildPatchNode(doc, node.id, { [field]: value }));
    delete textInputRefs.current[key];
  };

  const commitLabel = (node: WorldNode, el: HTMLElement) => {
    const key = `${node.id}-label`;
    const value = textInputRefs.current[key] !== undefined ? textInputRefs.current[key] : (el.textContent ?? '');
    onApplyCommand(buildPatchNode(doc, node.id, { label: value }));
    delete textInputRefs.current[key];
  };

  const detachFromGroup = (node: WorldNode) => {
    onApplyCommand(buildAttachToGroup(doc, node.id, undefined, node.x + 24, node.y + 24));
  };

  const selectGroupMembers = (groupId: string) => {
    const ids = childrenOf(doc, groupId).map((c) => c.id);
    if (ids.length === 0) { showToast('Group has no members.'); return; }
    setSelectedIds(ids);
    setSelectedEdgeIds([]);
  };

  const detachAllFromGroup = (groupId: string) => {
    const cmd = buildDetachChildren(doc, groupId);
    if (!cmd) { showToast('Group has no members.'); return; }
    onApplyCommand(cmd);
    showToast('Members detached — they now live in All Notes.');
  };

  const counts = {
    notes: doc.nodes.filter((n) => n.type === 'note').length,
    media: doc.nodes.filter((n) => n.type === 'media').length,
    groups: doc.nodes.filter((n) => n.type === 'group').length,
    cards: doc.nodes.filter((n) => n.type === 'text').length,
  };

  // Live rect reflecting any in-flight move/resize, so both node rendering and
  // edge anchoring read the same position — this is what makes wires flexible.
  // Rotation is intentionally excluded (stays axis-aligned per design).
  const liveRectFor = (n: WorldNode) => {
    const it = interactionRef.current;
    const dx = it?.kind === 'move' && it.ids.includes(n.id) ? dragOffset.dx : 0;
    const dy = it?.kind === 'move' && it.ids.includes(n.id) ? dragOffset.dy : 0;
    const isResizing = it?.kind === 'resize' && it.id === n.id;
    const width = isResizing ? Math.max(80, n.width + resizeDelta.dw) : n.width;
    const height = isResizing ? Math.max(50, n.height + resizeDelta.dh) : n.height;
    return { x: n.x + dx, y: n.y + dy, width, height };
  };

  const linked = linkedNodeIds(doc);

  // Fisheye focus/radius (Phase 5, always on since item 4) — computed once per
  // render, not per node. Groups are excluded from the effect itself (nodeStyle
  // skips them below): scaling a group visually detaches its children, which stay unscaled.
  const fisheyeContainerRect = containerRef.current?.getBoundingClientRect();
  const fisheyeFocus = fisheyeContainerRect ? screenToCanvas(fisheyeContainerRect.left + fisheyeContainerRect.width / 2, fisheyeContainerRect.top + fisheyeContainerRect.height / 2) : null;
  const fisheyeRadius = fisheyeContainerRect ? Math.hypot(fisheyeContainerRect.width, fisheyeContainerRect.height) / (2 * zoom) : 0;

  const nodeStyle = (n: WorldNode): React.CSSProperties => {
    const r = liveRectFor(n);
    const accentHex = n.color && n.color !== 'default' ? colorHex(n.color) : null;
    const raised = hoveredId === n.id || colorPickerId === n.id || selectedIds.includes(n.id);
    const rotationDeg = n.rotation || 0;
    const scaleMul = fisheyeFocus && n.type !== 'group'
      ? fisheyeScale({ x: r.x + r.width / 2, y: r.y + r.height / 2 }, fisheyeFocus, fisheyeRadius)
      : 1;
    const transforms = [rotationDeg ? `rotate(${rotationDeg}deg)` : '', scaleMul !== 1 ? `scale(${scaleMul})` : ''].filter(Boolean);
    return {
      position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height,
      transform: transforms.length ? transforms.join(' ') : undefined,
      transformOrigin: 'center',
      zIndex: raised ? 30 : undefined,
      ...(accentHex ? { borderColor: accentHex, backgroundColor: `${accentHex}1f` } : {}),
      ...(linked.has(n.id) ? ({ ['--glow' as any]: accentHex ?? '#32CD32' }) : {}),
    };
  };

  return (
    <div className={`relative flex flex-col ${t.canvasBg} ${className}`}>
      {/* Header: back-to-notes + world name, kept in the app's normal chrome style. */}
      <div className={`h-14 flex items-center gap-2 px-4 border-b shrink-0 ${t.headerBorder} ${t.headerText}`}>
        <button onClick={onBackToNotes} className="p-2 -ml-2 hover:text-[#32CD32] transition-colors rounded-md hover:bg-[#32CD32]/10" title="Back to notes">
          <ChevronLeft size={20} />
        </button>
        <span className={`font-bold truncate ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{worldName}</span>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*,audio/*,video/*,application/pdf" multiple className="hidden" onChange={onFileInputChange} />

      <div
        ref={containerRef}
        className={`relative flex-1 overflow-hidden ${strokeArmed ? 'cursor-crosshair' : 'cursor-default'}`}
        style={{
          ...(clearArmed ? { cursor: BRUSH_CURSOR } : {}),
          backgroundImage: `radial-gradient(circle, ${t.dot} 1px, transparent 1px)`,
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
        onWheel={onWheel}
        onMouseDown={onCanvasMouseDown}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleCanvasDrop}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: isDarkMode
              ? 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.35) 100%)'
              : 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.12) 100%)',
          }}
        />

        {doc.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className={`border rounded-xl px-8 py-6 text-center max-w-sm ${t.emptyCardBg}`}>
              <p className="text-[#32CD32] font-medium">Drag and Drop</p>
              <p className={`text-sm mt-2 ${t.emptyCardText}`}>Space + Drag to pan</p>
              <p className={`text-sm ${t.emptyCardText}`}>Ctrl + Scroll to zoom</p>
              <p className={`text-sm ${t.emptyCardText}`}>Drag to select</p>
              <p className={`text-sm ${t.emptyCardText}`}>Ctrl + Hold a note to pull it out of a group</p>
            </div>
          </div>
        )}

        {/* Rotation wrapper — spins the canvas content around the true viewport
            center; the pan/zoom layer inside is untouched by it (own transform-origin 0 0). */}
        <div style={{ position: 'absolute', inset: 0, transform: `rotate(${rotation}deg)`, transformOrigin: '50% 50%' }}>
          <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', position: 'absolute', inset: 0 }}>
            <svg width={1} height={1} style={{ overflow: 'visible', position: 'absolute', left: 0, top: 0 }}>
              {doc.edges.map((edge) => {
                const from = doc.nodes.find((n) => n.id === edge.fromNode);
                const to = doc.nodes.find((n) => n.id === edge.toNode);
                if (!from || !to) return null;
                const fromRect = liveRectFor(from);
                const toRect = liveRectFor(to);
                const sides = edge.fromSide && edge.toSide ? { fromSide: edge.fromSide, toSide: edge.toSide } : defaultSides(fromRect, toRect);
                const a = edgeAnchor(fromRect, sides.fromSide);
                const b = edgeAnchor(toRect, sides.toSide);
                const selected = selectedEdgeIds.includes(edge.id);
                const breaking = breakingEdges.some((be) => be.id === edge.id);
                const stroke = edgeColor(doc, edge);
                return (
                  <g key={edge.id} style={{ cursor: armed ? 'inherit' : 'pointer', pointerEvents: armed ? 'none' : 'stroke' } as React.CSSProperties}
                    onMouseDown={(e) => { if (armed) return; e.stopPropagation(); setSelectedEdgeIds([edge.id]); setSelectedIds([]); }}>
                    <path d={bezierPath(a, b, sides.fromSide, sides.toSide)} fill="none" stroke={stroke}
                      strokeWidth={selected ? 3 : 2} opacity={breaking ? 0.9 : selected ? 1 : 0.85}
                      strokeDasharray={breaking ? '6 4' : undefined}
                      className={breaking ? 'vx-wire-break' : undefined}
                      style={{ filter: `drop-shadow(0 0 3px ${stroke}aa)` }} />
                    {edge.label && (
                      <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6} fill={stroke} fontSize={12} textAnchor="middle">{edge.label}</text>
                    )}
                  </g>
                );
              })}
              {linkLassoPreview.length > 1 && (
                <path d={`M ${linkLassoPreview.map((p) => `${p.x} ${p.y}`).join(' L ')}`} fill="none" stroke="#32CD32" strokeWidth={2} strokeDasharray="4 4" opacity={0.9} />
              )}
              {scissorPreview.length > 1 && (
                <path d={`M ${scissorPreview.map((p) => `${p.x} ${p.y}`).join(' L ')}`} fill="none" stroke="#f97316" strokeWidth={2} strokeDasharray="2 4" opacity={0.9} />
              )}
              {marqueePreview && (() => {
                const r = rectFromPoints(marqueePreview.start, marqueePreview.current);
                return <rect x={r.x} y={r.y} width={r.width} height={r.height} fill="rgba(50,205,50,0.10)" stroke="#32CD32" strokeWidth={1.5} strokeDasharray="4 4" />;
              })()}
            </svg>

            {/* Groups always render (and hit-test) below every other node, regardless of
                doc.nodes order — otherwise a group created/moved after a member note sits on
                top of it in the DOM and blocks clicks/drags on that note entirely (the user
                previously had to resize the group so the note poked out from under it). */}
            {[...doc.nodes].sort((a, b) => (a.type === 'group' ? 0 : 1) - (b.type === 'group' ? 0 : 1)).map((n) => {
              const selected = selectedIds.includes(n.id);
              const isShuddering = shudderIds.has(n.id);
              const isLinked = linked.has(n.id);
              const isPopping = poppingIds.has(n.id);
              const visualClass = `${isLinked ? 'vx-node-glow' : ''} ${isShuddering ? 'vx-shudder' : ''} ${isPopping ? 'vx-pop' : ''}`;
              const r = liveRectFor(n);

              if (n.type === 'group') {
                const editingLabel = editingId === n.id;
                const hot = hotGroupId === n.id;
                const labelFontSize = captionFontSize(r.width, r.height, 'title');
                return (
                  <div key={n.id} style={nodeStyle(n)}
                    className={`rounded-xl border-2 border-dashed overflow-hidden ${selected ? 'border-[#32CD32]' : t.groupBorder} ${t.groupBg} ${hot ? 'vx-group-hot' : ''} ${visualClass}`}
                    onMouseEnter={() => setHoveredId(n.id)}
                    onMouseLeave={() => setHoveredId((h) => (h === n.id ? null : h))}
                    onMouseDown={(e) => beginNodeDrag(n, e)}
                    onDoubleClick={(e) => { e.stopPropagation(); if (!armed) setEditingId(n.id); }}
                    onBlurCapture={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                        setEditingId((id) => (id === n.id ? null : id));
                      }
                    }}
                  >
                    <div
                      contentEditable={editingLabel}
                      suppressContentEditableWarning
                      onMouseDown={(e) => { if (editingLabel) e.stopPropagation(); }}
                      onInput={(e) => { textInputRefs.current[`${n.id}-label`] = e.currentTarget.textContent ?? ''; }}
                      onBlur={(e) => commitLabel(n, e.currentTarget)}
                      style={{ fontSize: labelFontSize }}
                      className={`px-3 py-2 font-bold truncate outline-none ${t.groupLabel}`}
                    >{n.label || 'Group'}</div>
                    {/* Group tools: select every member / detach them all (one undo step). */}
                    {!armed && !editingLabel && (hoveredId === n.id || selected) && (
                      <div className="absolute top-1.5 right-8 flex items-center gap-1 z-10">
                        <button
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); selectGroupMembers(n.id); }}
                          title="Select every node in this group"
                          className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-neutral-800 border border-neutral-700 text-slate-300 hover:text-[#32CD32] shadow"
                        >Select</button>
                        <button
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); detachAllFromGroup(n.id); }}
                          title="Detach every node from this group (moves their notes back to All Notes)"
                          className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-neutral-800 border border-neutral-700 text-slate-300 hover:text-[#32CD32] shadow"
                        >Detach</button>
                      </div>
                    )}
                    <NodeOverlay
                      node={n} hovered={hoveredId === n.id} selected={selected} editing={editingLabel} armed={armed}
                      colorPickerId={colorPickerId} popoverBg={t.popoverBg}
                      onTogglePicker={() => setColorPickerId((id) => (id === n.id ? null : n.id))}
                      onPickColor={(key) => { onApplyCommand(buildPatchNode(doc, n.id, { color: key })); setColorPickerId(null); }}
                      onBeginResize={(e) => beginResize(n, e)}
                    />
                  </div>
                );
              }

              if (n.type === 'text') {
                const editing = editingId === n.id;
                const titleSize = captionFontSize(r.width, r.height, 'title');
                const bodySize = captionFontSize(r.width, r.height, 'body');
                return (
                  <div key={n.id} style={nodeStyle(n)}
                    className={`rounded-lg ${t.nodeBg} border overflow-hidden ${selected ? 'border-[#32CD32] ring-1 ring-[#32CD32]' : t.nodeBorder} shadow-lg flex flex-col p-3 gap-1 ${visualClass}`}
                    onMouseEnter={() => setHoveredId(n.id)}
                    onMouseLeave={() => setHoveredId((h) => (h === n.id ? null : h))}
                    onMouseDown={(e) => beginNodeDrag(n, e)}
                    onDoubleClick={(e) => { e.stopPropagation(); if (!armed) setEditingId(n.id); }}
                    onBlurCapture={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                        setEditingId((id) => (id === n.id ? null : id));
                      }
                    }}
                  >
                    <div
                      contentEditable={editing}
                      suppressContentEditableWarning
                      onMouseDown={(e) => { if (editing) e.stopPropagation(); }}
                      onInput={(e) => { textInputRefs.current[`${n.id}-text`] = e.currentTarget.textContent ?? ''; }}
                      onBlur={(e) => commitText(n, 'text', e.currentTarget)}
                      onWheel={(e) => { const el = e.currentTarget; if (el.scrollHeight > el.clientHeight && !e.ctrlKey && !e.metaKey) e.stopPropagation(); }}
                      style={{ fontSize: titleSize }}
                      className={`font-semibold outline-none flex-1 min-h-0 overflow-y-auto vx-no-scrollbar ${t.nodeText}`}
                    >{!editing && n.text
                      ? <><span className="text-[#32CD32] mr-0.5">#</span>{displayText(n.text)}</>
                      : n.text
                    }</div>
                    <div
                      contentEditable={editing}
                      suppressContentEditableWarning
                      onMouseDown={(e) => { if (editing) e.stopPropagation(); }}
                      onInput={(e) => { textInputRefs.current[`${n.id}-subtext`] = e.currentTarget.textContent ?? ''; }}
                      onBlur={(e) => commitText(n, 'subtext', e.currentTarget)}
                      onWheel={(e) => { const el = e.currentTarget; if (el.scrollHeight > el.clientHeight && !e.ctrlKey && !e.metaKey) e.stopPropagation(); }}
                      style={{ fontSize: bodySize }}
                      className={`outline-none max-h-16 overflow-y-auto shrink-0 vx-no-scrollbar ${t.subText}`}
                    >{n.subtext || (editing ? '' : '')}</div>
                    <NodeOverlay
                      node={n} hovered={hoveredId === n.id} selected={selected} editing={editing} armed={armed}
                      colorPickerId={colorPickerId} popoverBg={t.popoverBg}
                      onTogglePicker={() => setColorPickerId((id) => (id === n.id ? null : n.id))}
                      onPickColor={(key) => { onApplyCommand(buildPatchNode(doc, n.id, { color: key })); setColorPickerId(null); }}
                      onBeginResize={(e) => beginResize(n, e)}
                      onDetach={n.parentId ? () => detachFromGroup(n) : undefined}
                    />
                  </div>
                );
              }

              if (n.type === 'note') {
                // `notes` is a live prop from App — re-evaluated on every render.
                // Do NOT wrap this in useMemo or useRef; doing so would break real-time
                // sync when the note's title or content changes in the editor.
                const note = notes.find((x) => x.id === n.noteId);
                const titleSize = captionFontSize(r.width, r.height, 'title');
                const bodySize = captionFontSize(r.width, r.height, 'body');
                return (
                  <div key={n.id} style={nodeStyle(n)}
                    className={`rounded-lg ${t.nodeBg} border overflow-hidden ${selected ? 'border-[#32CD32] ring-1 ring-[#32CD32]' : t.nodeBorder} shadow-lg p-3 flex flex-col ${visualClass}`}
                    onMouseEnter={() => setHoveredId(n.id)}
                    onMouseLeave={() => setHoveredId((h) => (h === n.id ? null : h))}
                    onMouseDown={(e) => beginNodeDrag(n, e)}
                    onDoubleClick={(e) => { e.stopPropagation(); if (!armed && n.parentId) detachFromGroup(n); }}
                  >
                    <div style={{ fontSize: titleSize }} className={`font-bold truncate shrink-0 ${t.nodeText}`}>{note?.title || 'Untitled Note'}</div>
                    <div
                      style={{ fontSize: bodySize }}
                      onWheel={(e) => { const el = e.currentTarget; if (el.scrollHeight > el.clientHeight && !e.ctrlKey && !e.metaKey) e.stopPropagation(); }}
                      className={`mt-1 flex-1 min-h-0 overflow-y-auto vx-no-scrollbar ${t.subText}`}
                    >{/* Inline HTML-strip runs each render — intentional for live sync. */}
                    {(note?.content || '').replace(/<[^>]*>?/gm, ' ').trim() || 'No additional text'}</div>
                    <NodeOverlay
                      node={n} hovered={hoveredId === n.id} selected={selected} editing={false} armed={armed}
                      colorPickerId={colorPickerId} popoverBg={t.popoverBg}
                      onTogglePicker={() => setColorPickerId((id) => (id === n.id ? null : n.id))}
                      onPickColor={(key) => { onApplyCommand(buildPatchNode(doc, n.id, { color: key })); setColorPickerId(null); }}
                      onBeginResize={(e) => beginResize(n, e)}
                      onDetach={n.parentId ? () => detachFromGroup(n) : undefined}
                    />
                  </div>
                );
              }

              // media
              const nameSize = captionFontSize(r.width, r.height, 'body');
              return (
                <div key={n.id} style={nodeStyle(n)}
                  className={`rounded-lg ${t.nodeBg} border overflow-hidden ${selected ? 'border-[#32CD32] ring-1 ring-[#32CD32]' : t.nodeBorder} shadow-lg flex items-center justify-center ${t.subText} ${visualClass}`}
                  onMouseEnter={() => setHoveredId(n.id)}
                  onMouseLeave={() => setHoveredId((h) => (h === n.id ? null : h))}
                  onMouseDown={(e) => beginNodeDrag(n, e)}
                  onDoubleClick={(e) => { e.stopPropagation(); if (!armed && n.parentId) detachFromGroup(n); }}
                >
                  <div className="w-full h-full overflow-hidden rounded-lg flex items-center justify-center" style={{ fontSize: nameSize }}>
                    <MediaContent n={n} />
                  </div>
                  <NodeOverlay
                    node={n} hovered={hoveredId === n.id} selected={selected} editing={false} armed={armed}
                    colorPickerId={colorPickerId} popoverBg={t.popoverBg}
                    onTogglePicker={() => setColorPickerId((id) => (id === n.id ? null : n.id))}
                    onPickColor={(key) => { onApplyCommand(buildPatchNode(doc, n.id, { color: key })); setColorPickerId(null); }}
                    onBeginResize={(e) => beginResize(n, e)}
                    onDetach={n.parentId ? () => detachFromGroup(n) : undefined}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom-left status pill — compact and non-interactive so it never
            collides with (or steals clicks from) the bottom dock on narrow widths. */}
        <div className={`absolute left-3 bottom-3 border rounded-full px-2 py-0.5 text-[10px] leading-4 whitespace-nowrap pointer-events-none ${t.statusPill}`}>
          {counts.cards} tags · {counts.notes} notes · {counts.media} media · {counts.groups} groups
        </div>

        {/* Bottom dock: drag to place, or click to place. */}
        <div className={`absolute left-1/2 -translate-x-1/2 bottom-4 flex items-center gap-1 border rounded-xl shadow-xl px-1.5 py-1.5 ${t.chromeBg}`}>
          <DockButton icon={Group} title="Create group" onClick={() => handleDockClick('group')} onDragKind="group" iconClass={t.chromeIcon} />
          <DockButton icon={File} title="Add tag" onClick={() => handleDockClick('text')} onDragKind="text" iconClass={t.chromeIcon} />
          <DockButton icon={FileText} title="Add note" onClick={() => handleDockClick('note')} iconClass={t.chromeIcon} />
          <DockButton icon={FileImage} title="Add media" onClick={() => handleDockClick('media')} iconClass={t.chromeIcon} />
          <div className={`w-px h-6 mx-1 ${isDarkMode ? 'bg-neutral-800' : 'bg-slate-200'}`} />
          <button
            onClick={() => { setLinkLassoArmed((v) => !v); setScissorArmed(false); setClearArmed(false); }}
            title="Link Lasso — drag a stroke to connect every node it crosses"
            className={`p-2 rounded-lg transition-colors ${linkLassoArmed ? 'bg-[#32CD32]/20 text-[#32CD32]' : t.chromeIcon}`}
          >
            <Waypoints size={18} />
          </button>
          <button
            onClick={() => { setScissorArmed((v) => !v); setLinkLassoArmed(false); setClearArmed(false); }}
            title="Scissor — drag a stroke across wires to cut them"
            className={`p-2 rounded-lg transition-colors ${scissorArmed ? 'bg-[#32CD32]/20 text-[#32CD32]' : t.chromeIcon}`}
          >
            <Scissors size={18} />
          </button>
          <button
            onClick={() => { setClearArmed((v) => !v); setLinkLassoArmed(false); setScissorArmed(false); }}
            title="Clear — click or drag over nodes to remove them from the world without deleting their files"
            className={`p-2 rounded-lg transition-colors ${clearArmed ? 'bg-[#32CD32]/20 text-[#32CD32]' : t.chromeIcon}`}
          >
            <Paintbrush size={18} />
          </button>
        </div>

        {/* Right toolbar */}
        <div className={`absolute right-4 top-4 flex flex-col items-center gap-1 border rounded-xl shadow-xl p-1.5 ${t.chromeBg}`}>
          <button
            onClick={() => setImportDialogOpen(true)}
            title="Import Valx spaces — bring in notes from the workspace"
            className={`p-2 rounded-lg transition-colors ${t.chromeIcon}`}
          >
            <Sprout size={18} />
          </button>
          <div className={`w-6 h-px my-1 ${isDarkMode ? 'bg-neutral-800' : 'bg-slate-200'}`} />
          <ToolbarButton icon={Focus} title="Fit to content" onClick={fitToContent} iconClass={t.chromeIcon} />
          <ToolbarButton icon={isFullscreen ? Minimize2 : Maximize2} title={isFullscreen ? 'Exit fullscreen (F11)' : 'Fullscreen — hide sidebar and note list (F11)'} onClick={onToggleFullscreen} iconClass={t.chromeIcon} />
          <div className={`w-6 h-px my-1 ${isDarkMode ? 'bg-neutral-800' : 'bg-slate-200'}`} />
          <ToolbarButton icon={Undo2} title="Undo" onClick={onUndo} disabled={!canUndo} iconClass={t.chromeIcon} />
          <ToolbarButton icon={Redo2} title="Redo" onClick={onRedo} disabled={!canRedo} iconClass={t.chromeIcon} />
        </div>

        {toast && (
          <div className={`absolute top-4 left-1/2 -translate-x-1/2 text-sm px-4 py-2 rounded-full ${t.toast}`}>
            {toast}
          </div>
        )}

      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-black border border-slate-200 dark:border-neutral-800 rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-5">
              <div className="text-slate-900 dark:text-white font-bold mb-2">Delete from workspace?</div>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                This moves {confirmDelete.count === 1 ? 'the underlying note' : `${confirmDelete.count} underlying notes`} to
                the workspace trash. To remove things from this world <em>without</em> touching your files, use the Clear (brush) tool instead.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-100 dark:border-neutral-900">
              <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 text-sm rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-neutral-900 transition-colors">
                Cancel
              </button>
              <button
                onClick={() => { onApplyCommand(confirmDelete.cmd); clearSelection(); setConfirmDelete(null); }}
                className="px-3 py-1.5 text-sm rounded-lg bg-red-600 text-white font-medium hover:bg-red-500 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {importDialogOpen && (
        <ImportSpacesModal
          folders={folders}
          onClose={() => setImportDialogOpen(false)}
          onImport={(scope) => {
            onImportSpaces(scope);
            setImportDialogOpen(false);
            showToast('Spaces imported — undo to revert.');
          }}
        />
      )}
    </div>
  );
}

// "Import Valx spaces" (item 13) — replaces the old one-click Mirror Workspace
// button with a choice: bring in every workspace note, or only notes inside
// specific folders. Styled after SettingsModal's dialog idiom for consistency.
function ImportSpacesModal({ folders, onClose, onImport }: { folders: Folder[]; onClose: () => void; onImport: (scope: ImportScope) => void }) {
  const [mode, setMode] = useState<'all' | 'folders'>('all');
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);

  const toggleFolder = (id: string) => {
    setMode('folders');
    setSelectedFolderIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  const canImport = mode === 'all' || selectedFolderIds.length > 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-black border border-slate-200 dark:border-neutral-800 rounded-xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-neutral-900">
          <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold">
            <Sprout size={18} className="text-[#32CD32]" />
            Import Valx spaces
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-neutral-900 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-3 max-h-96 overflow-y-auto">
          <button
            onClick={() => { setMode('all'); setSelectedFolderIds([]); }}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-sm text-left transition-colors ${mode === 'all' ? 'border-[#32CD32] bg-[#32CD32]/10 text-slate-900 dark:text-white' : 'border-slate-200 dark:border-neutral-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-neutral-900'}`}
          >
            <span className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${mode === 'all' ? 'border-[#32CD32]' : 'border-slate-300 dark:border-neutral-700'}`}>
              {mode === 'all' && <span className="w-2 h-2 rounded-full bg-[#32CD32]" />}
            </span>
            All notes
          </button>

          {folders.length > 0 && (
            <div className="space-y-1 pt-1">
              <div className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1">Or choose groups</div>
              {folders.map((f) => {
                const checked = mode === 'folders' && selectedFolderIds.includes(f.id);
                return (
                  <button
                    key={f.id}
                    onClick={() => toggleFolder(f.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-sm text-left transition-colors ${checked ? 'border-[#32CD32] bg-[#32CD32]/10 text-slate-900 dark:text-white' : 'border-slate-200 dark:border-neutral-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-neutral-900'}`}
                  >
                    <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${checked ? 'border-[#32CD32] bg-[#32CD32]' : 'border-slate-300 dark:border-neutral-700'}`}>
                      {checked && <Check size={11} className="text-white" />}
                    </span>
                    {f.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-100 dark:border-neutral-900">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-neutral-900 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onImport(mode === 'all' ? { kind: 'all' } : { kind: 'folders', folderIds: selectedFolderIds })}
            disabled={!canImport}
            className="px-3 py-1.5 text-sm rounded-lg bg-[#32CD32] text-black font-medium disabled:opacity-40 transition-colors"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}

function MediaContent({ n }: { n: Extract<WorldNode, { type: 'media' }> }) {
  // Stored srcs are canonical /__media/… — resolve to the desktop display URL.
  if (n.kind === 'image') return <img src={mediaDisplaySrc(n.src)} alt={n.name || ''} className="w-full h-full object-cover pointer-events-none" />;
  if (n.kind === 'video') {
    return (
      <video src={mediaDisplaySrc(n.src)} controls preload="metadata" className="w-full h-full object-cover"
        onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} />
    );
  }
  if (n.kind === 'audio') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-3">
        <Music size={20} className="opacity-60" />
        <span className="truncate w-full text-center">{n.name || 'Audio'}</span>
        <audio src={mediaDisplaySrc(n.src)} controls className="w-full" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} />
      </div>
    );
  }
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1 px-2">
      <Paperclip size={20} className="opacity-60" />
      <span className="truncate">{n.name || 'File'}</span>
    </div>
  );
}

function NodeOverlay({
  node, hovered, selected, editing, armed, colorPickerId, popoverBg, onTogglePicker, onPickColor, onBeginResize, onDetach,
}: {
  node: WorldNode; hovered: boolean; selected: boolean; editing: boolean; armed: boolean;
  colorPickerId: string | null; popoverBg: string;
  onTogglePicker: () => void; onPickColor: (key: NodeColor) => void; onBeginResize: (e: React.MouseEvent) => void;
  onDetach?: () => void;
}) {
  if (armed || editing || !(hovered || selected)) return null;
  return (
    <>
      {onDetach && (
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDetach(); }}
          className="absolute top-1 left-1 p-1 rounded-full bg-neutral-800 border border-neutral-700 text-slate-300 hover:text-[#32CD32] shadow z-10"
          title="Detach from group"
        >
          <Unlink size={11} />
        </button>
      )}
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onTogglePicker(); }}
        className="absolute top-1 right-1 p-1 rounded-full bg-neutral-800 border border-neutral-700 text-slate-300 hover:text-[#32CD32] shadow z-10"
        title="Colour"
      >
        <Palette size={11} />
      </button>
      {colorPickerId === node.id && <ColorPopover popoverBg={popoverBg} onPickColor={onPickColor} />}
      <div onMouseDown={onBeginResize} className="absolute right-0.5 bottom-0.5 w-3 h-3 cursor-nwse-resize border-r-2 border-b-2 border-[#32CD32]" />
    </>
  );
}

// Colour palette popover — opens to the RIGHT of the node's frame (not inside
// it) so it never covers the node being coloured. The custom picker is
// two-step: the native input only stages `pending` (live-previewed on the
// swatch); Apply commits it, Cancel discards — no more one-click-and-gone.
function ColorPopover({ popoverBg, onPickColor }: { popoverBg: string; onPickColor: (key: NodeColor) => void }) {
  const [pending, setPending] = useState<string | null>(null);
  return (
    <div onMouseDown={(e) => e.stopPropagation()} className={`absolute top-0 left-full ml-2 z-20 border rounded-lg p-2 shadow-lg w-56 ${popoverBg}`}>
      <div className="grid grid-cols-8 gap-1.5 max-h-40 overflow-y-auto">
        {WORLD_PALETTE.map((sw) => (
          <button key={sw.key} onClick={(e) => { e.stopPropagation(); onPickColor(sw.key); }} title={sw.label}
            className="w-4 h-4 rounded-full ring-1 ring-black/20 shrink-0" style={{ background: sw.hex }} />
        ))}
        <label
          title="Custom colour"
          className="relative w-4 h-4 rounded-full ring-1 ring-black/20 shrink-0 cursor-pointer overflow-hidden"
          style={{ background: pending ?? 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
        >
          <input
            type="color"
            value={pending ?? '#32CD32'}
            onChange={(e) => setPending(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </label>
      </div>
      {pending && (
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-neutral-700/40">
          <span className="w-4 h-4 rounded-full ring-1 ring-black/20 shrink-0" style={{ background: pending }} />
          <span className="text-[10px] font-mono opacity-70 flex-1">{pending}</span>
          <button onClick={() => setPending(null)} className="px-1.5 py-0.5 text-[10px] rounded text-slate-400 hover:text-slate-200 transition-colors">Cancel</button>
          <button onClick={() => onPickColor(pending)} className="px-1.5 py-0.5 text-[10px] rounded bg-[#32CD32] text-black font-medium">Apply</button>
        </div>
      )}
    </div>
  );
}

function DockButton({ icon: Icon, title, onClick, onDragKind, iconClass }: { icon: React.ComponentType<{ size?: number }>; title: string; onClick: () => void; onDragKind?: DockKind; iconClass: string }) {
  return (
    <button
      draggable={!!onDragKind}
      onDragStart={onDragKind ? (e) => e.dataTransfer.setData('application/x-valx-node-kind', onDragKind) : undefined}
      onClick={onClick}
      title={title}
      className={`p-2 rounded-lg transition-colors ${iconClass}`}
    >
      <Icon size={18} />
    </button>
  );
}

function ToolbarButton({ icon: Icon, title, onClick, disabled, iconClass }: { icon: React.ComponentType<{ size?: number }>; title: string; onClick: () => void; disabled?: boolean; iconClass: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-2 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent ${iconClass}`}
    >
      <Icon size={18} />
    </button>
  );
}
