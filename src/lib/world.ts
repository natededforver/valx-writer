// World Mode (canvas) — pure data model, no DOM/React. Documents round-trip
// to JSON Canvas (https://jsoncanvas.org) so a world also opens in Obsidian;
// Valx-only fields (subtext, note-id refs, media kind) live under a per-node
// "x-valx" object that Obsidian ignores and we restore on read.

import { extractFirstMedia } from './format';
import { linkHrefForNote, hasNoteLink } from './noteLinks';
import { tagForCard } from './noteTags';

// Legacy keyed swatches ('default'..'6') stay for back-compat with persisted docs; any other string is
// treated as a literal '#rrggbb' (custom picker + the expanded preset grid, which self-keys by hex).
export type NodeColor = 'default' | '1' | '2' | '3' | '4' | '5' | '6' | string;
export type Side = 'top' | 'right' | 'bottom' | 'left';

interface WorldNodeBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: NodeColor;
  /** Explicit group membership — set on attach, cleared on detach. Independent
   *  of geometry so a child overhanging its group's bounds still belongs to it. */
  parentId?: string;
  /** Degrees, clockwise. Rotation is a visual/positional flourish only —
   *  hit-testing/marquee/scissor geometry stays axis-aligned against the
   *  unrotated bounds (see WORLD_MODE_PHASE3_PLAN.md §7). */
  rotation?: number;
}

export interface TextNode extends WorldNodeBase {
  type: 'text';
  text: string;
  subtext?: string;
}
export interface NoteNode extends WorldNodeBase {
  type: 'note';
  noteId: string;
}
export interface MediaNode extends WorldNodeBase {
  type: 'media';
  src: string;
  kind: 'image' | 'audio' | 'video' | 'file';
  name?: string;
  /** Note this media was wrapped in on import (Phase 4) — makes it note-backed for link/folder correspondence. */
  noteId?: string;
}
export interface GroupNode extends WorldNodeBase {
  type: 'group';
  label?: string;
  /** Bound workspace folder this group corresponds to (Phase 4). Unset = a purely decorative group. */
  folderId?: string;
}
export type WorldNode = TextNode | NoteNode | MediaNode | GroupNode;

export interface WorldEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: Side;
  toSide?: Side;
  label?: string;
  color?: NodeColor;
  /** Set when both endpoints are note-backed (Phase 4): the markdown link this
   *  edge corresponds to, appended at the end of the source note's content. */
  linkHref?: string;
  /** Set when a text-card endpoint is wired to a note-backed endpoint (Phase 5):
   *  the '#tag' this edge asserts on the note-backed endpoint's note. */
  tagRef?: string;
}

/** The note a node is backed by — note nodes always, media nodes once wrapped in a note (Phase 4). Null for text/group. */
export function noteIdOf(node: WorldNode): string | null {
  if (node.type === 'note') return node.noteId;
  if (node.type === 'media' && node.noteId) return node.noteId;
  return null;
}

export interface WorldDoc {
  nodes: WorldNode[];
  edges: WorldEdge[];
}

export interface WorldMeta {
  id: string;
  name: string;
  slug: string;
  updatedAt: number;
}

/** Per-world camera state — persisted separately from the doc so pan/zoom/rotation survive navigation and reload.
 *  `fisheye` is optional so views persisted before Phase 5 (which lack the key) are treated as on at the read site. */
export interface WorldView { pan: Point; zoom: number; rotation: number; fisheye?: boolean }
export const defaultView = (): WorldView => ({ pan: { x: 0, y: 0 }, zoom: 1, rotation: 0, fisheye: true });

export const newId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch { /* fall through */ }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
};

export const emptyDoc = (): WorldDoc => ({ nodes: [], edges: [] });

/** Every tag a world doc declares — one per text card with non-empty text, independent of
 *  whether that card is wired to a note yet. World Mode tags are first-class: they exist
 *  the moment a card is created, and notes attach to them later. Returned without the
 *  leading '#', lowercased, matching useNotes.parseTags' stored form. */
export function worldCardTags(doc: WorldDoc): string[] {
  const set = new Set<string>();
  for (const n of doc.nodes) {
    if (n.type !== 'text') continue;
    const tag = tagForCard(n.text);
    if (tag) set.add(tag.slice(1));
  }
  return Array.from(set);
}

// ---------------------------------------------------------------------------
// Commands: every mutation is a small invertible object so undo/redo is just
// applyCommand(doc, invertCommand(lastCommand)). 'add'/'remove' share a
// payload shape (node + edge snapshots) so inverting one just flips its type.
// ---------------------------------------------------------------------------

export type Command =
  /** `worldOnly` (Clear tool): apply/undo normally but skip every workspace side
   *  effect (trash-move, link/tag removal) — the world forgets the node, the files stay. */
  | { type: 'add'; nodes: WorldNode[]; edges: WorldEdge[]; worldOnly?: boolean }
  | { type: 'remove'; nodes: WorldNode[]; edges: WorldEdge[]; worldOnly?: boolean }
  | { type: 'move'; ids: string[]; dx: number; dy: number }
  | { type: 'resize'; id: string; before: { width: number; height: number }; after: { width: number; height: number } }
  | { type: 'patch'; id: string; before: Record<string, unknown>; after: Record<string, unknown> }
  | { type: 'patchEdge'; id: string; before: Record<string, unknown>; after: Record<string, unknown> }
  /** Several sub-commands applied (and undone) as one step — e.g. detaching every member of a group at once. */
  | { type: 'batch'; commands: Command[] };

// Merges a patch onto an object, deleting any key the patch sets to `undefined`
// instead of leaving an explicit `undefined` value — keeps a patched-then-
// inverted doc identical to the original (and matches JSON.stringify, which
// drops undefined values anyway).
function mergeDropUndefined<T extends object>(obj: T, patch: Record<string, unknown>): T {
  const merged: Record<string, unknown> = { ...obj, ...patch };
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete merged[k];
  return merged as T;
}

export function applyCommand(doc: WorldDoc, cmd: Command): WorldDoc {
  switch (cmd.type) {
    case 'add': {
      const nodeIds = new Set(doc.nodes.map((n) => n.id));
      const edgeIds = new Set(doc.edges.map((e) => e.id));
      return {
        nodes: [...doc.nodes, ...cmd.nodes.filter((n) => !nodeIds.has(n.id))],
        edges: [...doc.edges, ...cmd.edges.filter((e) => !edgeIds.has(e.id))],
      };
    }
    case 'remove': {
      const nodeIds = new Set(cmd.nodes.map((n) => n.id));
      const edgeIds = new Set(cmd.edges.map((e) => e.id));
      return {
        nodes: doc.nodes.filter((n) => !nodeIds.has(n.id)),
        edges: doc.edges.filter((e) => !edgeIds.has(e.id)),
      };
    }
    case 'move': {
      const idSet = new Set(cmd.ids);
      return { ...doc, nodes: doc.nodes.map((n) => (idSet.has(n.id) ? { ...n, x: n.x + cmd.dx, y: n.y + cmd.dy } : n)) };
    }
    case 'resize':
      return { ...doc, nodes: doc.nodes.map((n) => (n.id === cmd.id ? { ...n, width: cmd.after.width, height: cmd.after.height } : n)) };
    case 'patch':
      return { ...doc, nodes: doc.nodes.map((n) => (n.id === cmd.id ? mergeDropUndefined(n, cmd.after) : n)) };
    case 'patchEdge':
      return { ...doc, edges: doc.edges.map((e) => (e.id === cmd.id ? mergeDropUndefined(e, cmd.after) : e)) };
    case 'batch':
      return cmd.commands.reduce(applyCommand, doc);
  }
}

export function invertCommand(cmd: Command): Command {
  switch (cmd.type) {
    case 'add': return { type: 'remove', nodes: cmd.nodes, edges: cmd.edges, worldOnly: cmd.worldOnly };
    case 'remove': return { type: 'add', nodes: cmd.nodes, edges: cmd.edges, worldOnly: cmd.worldOnly };
    case 'move': return { type: 'move', ids: cmd.ids, dx: -cmd.dx, dy: -cmd.dy };
    case 'resize': return { type: 'resize', id: cmd.id, before: cmd.after, after: cmd.before };
    case 'patch': return { type: 'patch', id: cmd.id, before: cmd.after, after: cmd.before };
    case 'patchEdge': return { type: 'patchEdge', id: cmd.id, before: cmd.after, after: cmd.before };
    case 'batch': return { type: 'batch', commands: [...cmd.commands].reverse().map(invertCommand) };
  }
}

// --- Command builders (need doc for snapshotting; return null if a no-op) ---

export const buildAddNode = (node: WorldNode): Command => ({ type: 'add', nodes: [node], edges: [] });

export function buildDeleteNodes(doc: WorldDoc, ids: string[]): Command | null {
  const idSet = new Set(ids);
  const nodes = doc.nodes.filter((n) => idSet.has(n.id));
  if (nodes.length === 0) return null;
  const edges = doc.edges.filter((e) => idSet.has(e.fromNode) || idSet.has(e.toNode));
  return { type: 'remove', nodes, edges };
}

export const buildMoveNodes = (ids: string[], dx: number, dy: number): Command | null =>
  ids.length === 0 || (dx === 0 && dy === 0) ? null : { type: 'move', ids, dx, dy };

export function buildResizeNode(doc: WorldDoc, id: string, width: number, height: number): Command | null {
  const node = doc.nodes.find((n) => n.id === id);
  if (!node) return null;
  return { type: 'resize', id, before: { width: node.width, height: node.height }, after: { width, height } };
}

export function buildPatchNode(doc: WorldDoc, id: string, patch: Record<string, unknown>): Command | null {
  const node = doc.nodes.find((n) => n.id === id);
  if (!node) return null;
  const before: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) before[k] = (node as unknown as Record<string, unknown>)[k];
  return { type: 'patch', id, before, after: patch };
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Rejects self-edges and an existing edge between the same two nodes (either direction). */
export function buildAddEdge(doc: WorldDoc, fromNode: string, toNode: string, opts: Partial<Pick<WorldEdge, 'label' | 'color' | 'fromSide' | 'toSide' | 'linkHref' | 'tagRef'>> = {}): Command | null {
  if (fromNode === toNode) return null;
  const dup = doc.edges.some((e) => pairKey(e.fromNode, e.toNode) === pairKey(fromNode, toNode));
  if (dup) return null;
  const edge: WorldEdge = { id: newId(), fromNode, toNode, ...opts };
  return { type: 'add', nodes: [], edges: [edge] };
}

export function buildDeleteEdge(doc: WorldDoc, id: string): Command | null {
  const edge = doc.edges.find((e) => e.id === id);
  if (!edge) return null;
  return { type: 'remove', nodes: [], edges: [edge] };
}

export function buildPatchEdge(doc: WorldDoc, id: string, patch: Record<string, unknown>): Command | null {
  const edge = doc.edges.find((e) => e.id === id);
  if (!edge) return null;
  const before: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) before[k] = (edge as unknown as Record<string, unknown>)[k];
  return { type: 'patchEdge', id, before, after: patch };
}

export const buildCreateGroup = (bounds: { x: number; y: number; width: number; height: number }, label?: string): Command => ({
  type: 'add',
  nodes: [{ id: newId(), type: 'group', ...bounds, label }],
  edges: [],
});

/** Non-group nodes fully contained by a group's bounds — membership is computed on demand, never stored.
 *  Superseded by explicit `parentId`/`childrenOf` for drag/attach behavior; kept for geometric queries. */
export function nodesInGroup(doc: WorldDoc, groupId: string): WorldNode[] {
  const group = doc.nodes.find((n) => n.id === groupId && n.type === 'group');
  if (!group) return [];
  return doc.nodes.filter(
    (n) =>
      n.id !== groupId &&
      n.type !== 'group' &&
      n.x >= group.x &&
      n.y >= group.y &&
      n.x + n.width <= group.x + group.width &&
      n.y + n.height <= group.y + group.height
  );
}

/** Explicit group members by `parentId` — independent of geometry, so a child overhanging the group's bounds still belongs to it. */
export function childrenOf(doc: WorldDoc, groupId: string): WorldNode[] {
  return doc.nodes.filter((n) => n.parentId === groupId);
}

/** Detach every explicit member of a group (parentId cleared, positions untouched) as ONE undoable step. */
export function buildDetachChildren(doc: WorldDoc, groupId: string): Command | null {
  const kids = childrenOf(doc, groupId);
  if (kids.length === 0) return null;
  return {
    type: 'batch',
    commands: kids.map((k) => ({ type: 'patch', id: k.id, before: { parentId: k.parentId }, after: { parentId: undefined } })),
  };
}

/** Topmost group (other than `excludeId`) whose bounds contain a point — used to detect the attach target while dragging. Rotation-aware. */
export function groupAt(doc: WorldDoc, pt: Point, excludeId?: string): GroupNode | null {
  for (let i = doc.nodes.length - 1; i >= 0; i--) {
    const n = doc.nodes[i];
    if (n.type === 'group' && n.id !== excludeId && pointInNode(pt, n)) {
      return n as GroupNode;
    }
  }
  return null;
}

/** Attach (groupId set) or detach (groupId undefined) a node to a group as one undoable patch, alongside its dropped position. */
export function buildAttachToGroup(doc: WorldDoc, id: string, groupId: string | undefined, x: number, y: number): Command | null {
  const node = doc.nodes.find((n) => n.id === id);
  if (!node) return null;
  const before: Record<string, unknown> = { x: node.x, y: node.y, parentId: node.parentId };
  const after: Record<string, unknown> = { x, y, parentId: groupId };
  return { type: 'patch', id, before, after };
}

// ---------------------------------------------------------------------------
// Colour — no purple anywhere in World Mode; lime is the default accent to
// match the rest of the app. A wire uses its own explicit colour if set,
// otherwise inherits from whichever endpoint node has a non-default colour.
// ---------------------------------------------------------------------------

export interface ColorSwatch { key: NodeColor; label: string; hex: string; }

// HSL -> hex, used only to generate the expanded preset grid below (item 11) — keeps ~40 swatches
// as a short generator instead of 40 hand-typed hex literals.
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Hue sweep for the expanded picker grid — deliberately skips 260-300 (purple/violet), per the
// "no purple anywhere in World Mode" theme rule.
const PRESET_HUE_NAMES: [number, string][] = [
  [0, 'Red'], [20, 'Red-Orange'], [40, 'Orange'], [60, 'Yellow'], [80, 'Yellow-Green'],
  [100, 'Green'], [120, 'Emerald'], [140, 'Teal-Green'], [160, 'Teal'], [180, 'Cyan'],
  [200, 'Sky'], [220, 'Blue'], [240, 'Indigo'], [320, 'Pink'], [340, 'Rose'],
];
const generatedSwatches: ColorSwatch[] = [];
for (const [h, name] of PRESET_HUE_NAMES) {
  const vivid = hslToHex(h, 0.75, 0.5);
  generatedSwatches.push({ key: vivid, label: name, hex: vivid });
}
for (const [h, name] of PRESET_HUE_NAMES) {
  const pastel = hslToHex(h, 0.6, 0.78);
  generatedSwatches.push({ key: pastel, label: `${name} (pastel)`, hex: pastel });
}
for (const l of [0.15, 0.32, 0.5, 0.68, 0.85]) {
  const gray = hslToHex(0, 0, l);
  generatedSwatches.push({ key: gray, label: 'Gray', hex: gray });
}

export const WORLD_PALETTE: ColorSwatch[] = [
  { key: 'default', label: 'Lime', hex: '#32CD32' },
  { key: '1', label: 'Red', hex: '#ef4444' },
  { key: '2', label: 'Orange', hex: '#f59e0b' },
  { key: '3', label: 'Yellow', hex: '#eab308' },
  { key: '4', label: 'Green', hex: '#22c55e' },
  { key: '5', label: 'Cyan', hex: '#06b6d4' },
  { key: '6', label: 'Pink', hex: '#ec4899' },
  ...generatedSwatches,
];

/** Resolves a node/edge color to its hex — legacy keys look up WORLD_PALETTE, any '#rrggbb' string
 *  (custom picker or a preset swatch, which self-keys by its own hex) passes straight through. */
export const colorHex = (c?: NodeColor): string => {
  if (c && c.startsWith('#')) return c;
  return WORLD_PALETTE.find((s) => s.key === (c ?? 'default'))?.hex ?? '#32CD32';
};

export function edgeColor(doc: WorldDoc, edge: WorldEdge): string {
  if (edge.color && edge.color !== 'default') return colorHex(edge.color);
  const from = doc.nodes.find((n) => n.id === edge.fromNode);
  const to = doc.nodes.find((n) => n.id === edge.toNode);
  const inherited = (from?.color && from.color !== 'default' && from.color) || (to?.color && to.color !== 'default' && to.color);
  return inherited ? colorHex(inherited) : '#32CD32';
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

export function nodeBounds(doc: WorldDoc): Rect | null {
  if (doc.nodes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of doc.nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Rotates a point around a center by `deg` clockwise degrees. */
export function rotatePoint(pt: Point, center: Point, deg: number): Point {
  if (!deg) return pt;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = pt.x - center.x, dy = pt.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

/** True if `pt` (canvas space) falls inside `n`'s rotated bounds — inverse-rotates the point into
 *  the node's local (unrotated) frame about its center, then does the plain axis-aligned check. */
function pointInNode(pt: Point, n: WorldNode): boolean {
  const local = n.rotation ? rotatePoint(pt, { x: n.x + n.width / 2, y: n.y + n.height / 2 }, -n.rotation) : pt;
  return local.x >= n.x && local.x <= n.x + n.width && local.y >= n.y && local.y <= n.y + n.height;
}

/** The 4 corners of a node's rect, rotated about its center per its `rotation`. */
function rotatedCorners(n: WorldNode): Point[] {
  const corners = [
    { x: n.x, y: n.y }, { x: n.x + n.width, y: n.y },
    { x: n.x + n.width, y: n.y + n.height }, { x: n.x, y: n.y + n.height },
  ];
  if (!n.rotation) return corners;
  const center = { x: n.x + n.width / 2, y: n.y + n.height / 2 };
  return corners.map((c) => rotatePoint(c, center, n.rotation!));
}

/** Axis-aligned bounding box of a node's rotated corners — identical to its own rect when unrotated. */
function rotatedBounds(n: WorldNode): Rect {
  const corners = rotatedCorners(n);
  const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Topmost node under a point (later nodes render on top, so search in reverse). Rotation-aware. */
export function hitTestNode(doc: WorldDoc, pt: Point): WorldNode | null {
  for (let i = doc.nodes.length - 1; i >= 0; i--) {
    const n = doc.nodes[i];
    if (pointInNode(pt, n)) return n;
  }
  return null;
}

export function edgeAnchor(node: Rect, side: Side): Point {
  switch (side) {
    case 'top': return { x: node.x + node.width / 2, y: node.y };
    case 'bottom': return { x: node.x + node.width / 2, y: node.y + node.height };
    case 'left': return { x: node.x, y: node.y + node.height / 2 };
    case 'right': return { x: node.x + node.width, y: node.y + node.height / 2 };
  }
}

/** Which two sides face each other when no explicit anchor is stored — picks the axis with the larger gap. */
export function defaultSides(a: Rect, b: Rect): { fromSide: Side; toSide: Side } {
  const acx = a.x + a.width / 2, acy = a.y + a.height / 2;
  const bcx = b.x + b.width / 2, bcy = b.y + b.height / 2;
  const dx = bcx - acx, dy = bcy - acy;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' };
  return dy >= 0 ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' };
}

export function offsetForSide(p: Point, side: Side, d: number): Point {
  switch (side) {
    case 'right': return { x: p.x + d, y: p.y };
    case 'left': return { x: p.x - d, y: p.y };
    case 'top': return { x: p.x, y: p.y - d };
    case 'bottom': return { x: p.x, y: p.y + d };
  }
}

/** Signed degrees swept from vector (center->a) to vector (center->b) — the rotate tool's live delta between the drag's start and current pointer. */
export function angleBetween(center: Point, a: Point, b: Point): number {
  const angleA = Math.atan2(a.y - center.y, a.x - center.x);
  const angleB = Math.atan2(b.y - center.y, b.x - center.x);
  return (angleB - angleA) * (180 / Math.PI);
}

/** Visual-only fisheye (Phase 5): nodes near `focus` render up to `strength` larger, tapering to 1 at
 *  `radius` (quadratic falloff, bulge concentrated near the focus). Hit-testing/marquee/scissor/edge
 *  anchors deliberately ignore this — same accepted axis-aligned-approximation doctrine as rotation. */
export function fisheyeScale(nodeCenter: Point, focus: Point, radius: number, strength = 0.15): number {
  if (radius <= 0) return 1;
  const d = Math.hypot(nodeCenter.x - focus.x, nodeCenter.y - focus.y);
  const t = Math.min(1, d / radius);
  return 1 + strength * (1 - t) * (1 - t);
}

/** Samples the same cubic bezier used for edge rendering into a polyline, so scissor-cut hit testing matches what's drawn on screen exactly. */
export function bezierPoints(a: Point, b: Point, fromSide: Side, toSide: Side, samples = 16): Point[] {
  const d = Math.max(Math.abs(b.x - a.x) * 0.5, Math.abs(b.y - a.y) * 0.5, 40);
  const c1 = offsetForSide(a, fromSide, d);
  const c2 = offsetForSide(b, toSide, d);
  const pts: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const mt = 1 - t;
    const x = mt * mt * mt * a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * b.x;
    const y = mt * mt * mt * a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * b.y;
    pts.push({ x, y });
  }
  return pts;
}

export function bezierPath(a: Point, b: Point, fromSide: Side, toSide: Side): string {
  const d = Math.max(Math.abs(b.x - a.x) * 0.5, Math.abs(b.y - a.y) * 0.5, 40);
  const c1 = offsetForSide(a, fromSide, d);
  const c2 = offsetForSide(b, toSide, d);
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
}

/** Ray-casting point-in-polygon test, used by the Ctrl+drag freehand lasso. */
export function pointInPolygon(pt: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Ids of nodes whose center falls inside a freehand lasso polygon. */
export function nodesInLasso(doc: WorldDoc, polygon: Point[]): string[] {
  if (polygon.length < 3) return [];
  return doc.nodes
    .filter((n) => pointInPolygon({ x: n.x + n.width / 2, y: n.y + n.height / 2 }, polygon))
    .map((n) => n.id);
}

/** Normalizes two dragged corner points into a top-left/width/height rect regardless of drag direction. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** Ids of nodes whose bounds intersect (any overlap with) a marquee rect. Rotation-aware — a rotated
 *  node's rotated-corner bounding box is used in place of its raw rect. */
export function nodesInRect(doc: WorldDoc, r: Rect): string[] {
  return doc.nodes
    .filter((n) => {
      const b = n.rotation ? rotatedBounds(n) : n;
      return b.x < r.x + r.width && b.x + b.width > r.x && b.y < r.y + r.height && b.y + b.height > r.y;
    })
    .map((n) => n.id);
}

/** Nodes touched by a drawn stroke (groups included, so Link Lasso can wire group-to-group as a
 *  purely visual association), in the order first touched, collapsing immediate repeats. */
export function nodesAlongStroke(doc: WorldDoc, points: Point[]): WorldNode[] {
  const hits: WorldNode[] = [];
  let lastId: string | null = null;
  for (const p of points) {
    const n = hitTestNode(doc, p);
    if (n) {
      if (n.id !== lastId) hits.push(n);
      lastId = n.id;
    } else {
      lastId = null;
    }
  }
  return hits;
}

/** Link Lasso: connects every node the stroke crosses, in stroke order (A->B->C...), skipping self/duplicate pairs. */
export function buildLinkLassoEdges(doc: WorldDoc, points: Point[]): Command | null {
  const hits = nodesAlongStroke(doc, points);
  if (hits.length < 2) return null;
  const seen = new Set(doc.edges.map((e) => pairKey(e.fromNode, e.toNode)));
  const newEdges: WorldEdge[] = [];
  for (let i = 0; i < hits.length - 1; i++) {
    const a = hits[i].id, b = hits[i + 1].id;
    if (a === b) continue;
    const key = pairKey(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    newEdges.push({ id: newId(), fromNode: a, toNode: b });
  }
  return newEdges.length === 0 ? null : { type: 'add', nodes: [], edges: newEdges };
}

// ---------------------------------------------------------------------------
// Scissor geometry — cuts wires (never nodes) by testing a drawn stroke
// against the exact bezier polyline each edge renders as.
// ---------------------------------------------------------------------------

function orientation(a: Point, b: Point, c: Point): number {
  const val = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (val === 0) return 0;
  return val > 0 ? 1 : 2;
}
function onSegment(a: Point, b: Point, c: Point): boolean {
  return b.x <= Math.max(a.x, c.x) && b.x >= Math.min(a.x, c.x) && b.y <= Math.max(a.y, c.y) && b.y >= Math.min(a.y, c.y);
}

/** Standard orientation-based segment intersection test (handles the collinear-overlap edge case). */
export function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p3, p2)) return true;
  if (o2 === 0 && onSegment(p1, p4, p2)) return true;
  if (o3 === 0 && onSegment(p3, p1, p4)) return true;
  if (o4 === 0 && onSegment(p3, p2, p4)) return true;
  return false;
}

export function edgeCutByStroke(from: Rect, to: Rect, fromSide: Side, toSide: Side, stroke: Point[]): boolean {
  if (stroke.length < 2) return false;
  const wire = bezierPoints(edgeAnchor(from, fromSide), edgeAnchor(to, toSide), fromSide, toSide);
  for (let i = 0; i < stroke.length - 1; i++) {
    for (let j = 0; j < wire.length - 1; j++) {
      if (segmentsIntersect(stroke[i], stroke[i + 1], wire[j], wire[j + 1])) return true;
    }
  }
  return false;
}

/** Ids of every edge whose rendered wire the stroke crosses. */
export function edgesCutByStroke(doc: WorldDoc, stroke: Point[]): string[] {
  const cut: string[] = [];
  for (const e of doc.edges) {
    const from = doc.nodes.find((n) => n.id === e.fromNode);
    const to = doc.nodes.find((n) => n.id === e.toNode);
    if (!from || !to) continue;
    const sides = e.fromSide && e.toSide ? { fromSide: e.fromSide, toSide: e.toSide } : defaultSides(from, to);
    if (edgeCutByStroke(from, to, sides.fromSide, sides.toSide, stroke)) cut.push(e.id);
  }
  return cut;
}

// ---------------------------------------------------------------------------
// Linked-state, spawn placement & auto-sizing
// ---------------------------------------------------------------------------

/** Ids of every node that has at least one incident edge — drives the glow/shudder visuals. */
export function linkedNodeIds(doc: WorldDoc): Set<string> {
  const ids = new Set<string>();
  for (const e of doc.edges) { ids.add(e.fromNode); ids.add(e.toNode); }
  return ids;
}

/** Top-right of current content, with a gap — where the next spawned/imported node(s) should start. */
export function nextImportOrigin(doc: WorldDoc): Point {
  const bounds = nodeBounds(doc);
  if (!bounds) return { x: 80, y: 80 };
  return { x: bounds.x + bounds.width + 80, y: bounds.y };
}

/** Stacks a run of node sizes straight down from an origin so imports never overlap. */
export function layoutImportColumn(origin: Point, sizes: { width: number; height: number }[], gap = 24): Point[] {
  const points: Point[] = [];
  let y = origin.y;
  for (const s of sizes) {
    points.push({ x: origin.x, y });
    y += s.height + gap;
  }
  return points;
}

/** Places a run of node sizes alternating along the four arms (N/E/S/W) of a cross centered on `origin`,
 *  each arm growing outward ring by ring so imports never overlap. Item i goes on arm `i % 4`, ring `i / 4`. */
export function layoutImportCross(origin: Point, sizes: { width: number; height: number }[], gap = 24): Point[] {
  const points: Point[] = [];
  const arms: Point[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]; // N, E, S, W
  const armOffset = [0, 0, 0, 0]; // running distance from origin along each arm
  sizes.forEach((s, i) => {
    const armIdx = i % 4;
    const dir = arms[armIdx];
    const extent = dir.y !== 0 ? s.height : s.width;
    const dist = armOffset[armIdx] + extent / 2;
    armOffset[armIdx] += extent + gap;
    const cx = origin.x + dir.x * dist, cy = origin.y + dir.y * dist;
    points.push({ x: cx - s.width / 2, y: cy - s.height / 2 });
  });
  return points;
}

export const NOTE_DEFAULT = { width: 240, height: 168 };
export const MEDIA_MAX = 320;
export const MEDIA_MIN = 160;
/** Fallback box for media with no probeable natural size (audio, or a failed image probe). */
export const MEDIA_FALLBACK = { width: 260, height: 160 };

/** Scales a media size to fit within [MEDIA_MIN, MEDIA_MAX] on its longer side — clamps oversized images down
 *  and undersized ones up (so audio/video controls stay usable and nothing renders as a near-invisible speck). */
export function fitMediaSize(natW: number, natH: number, max = MEDIA_MAX, min = MEDIA_MIN): { width: number; height: number } {
  if (!natW || !natH) return { ...MEDIA_FALLBACK };
  const longest = Math.max(natW, natH);
  if (longest > max) {
    const scale = max / longest;
    return { width: Math.round(natW * scale), height: Math.round(natH * scale) };
  }
  if (longest < min) {
    const scale = min / longest;
    return { width: Math.round(natW * scale), height: Math.round(natH * scale) };
  }
  return { width: natW, height: natH };
}

/** Title/body caption font size, scaled to the node's current box (so a resize live-scales its text) and clamped to a sane range. */
export function captionFontSize(width: number, height: number, kind: 'title' | 'body' = 'title'): number {
  const base = Math.min(width / 12, height / 6);
  const scaled = kind === 'title' ? base : base * 0.6;
  const [min, max] = kind === 'title' ? [15, 28] : [10, 16];
  return Math.round(Math.min(max, Math.max(min, scaled)));
}

/** Positions+sizes a spawned node to fill a marquee/context-menu rect, never smaller than `min`. */
export function sizeNodeToRect(rect: Rect, min = { width: 80, height: 50 }): Rect {
  return { x: rect.x, y: rect.y, width: Math.max(min.width, rect.width), height: Math.max(min.height, rect.height) };
}

// ---------------------------------------------------------------------------
// JSON Canvas serialization
// ---------------------------------------------------------------------------

export function toJsonCanvas(doc: WorldDoc): string {
  const nodes = doc.nodes.map((n) => {
    const base = { id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, color: n.color };
    const common = { parentId: n.parentId, rotation: n.rotation };
    if (n.type === 'text') return { ...base, type: 'text', text: n.text, 'x-valx': { kind: 'text', subtext: n.subtext, ...common } };
    if (n.type === 'note') return { ...base, type: 'text', text: '[[note]]', 'x-valx': { kind: 'note', noteId: n.noteId, ...common } };
    if (n.type === 'media') return { ...base, type: 'file', file: n.src, 'x-valx': { kind: 'media', mediaKind: n.kind, name: n.name, noteId: n.noteId, ...common } };
    return { ...base, type: 'group', label: n.label, 'x-valx': { kind: 'group', folderId: n.folderId, ...common } };
  });
  const edges = doc.edges.map((e) => ({
    id: e.id, fromNode: e.fromNode, toNode: e.toNode,
    fromSide: e.fromSide, toSide: e.toSide, color: e.color, label: e.label, linkHref: e.linkHref, tagRef: e.tagRef,
  }));
  return JSON.stringify({ nodes, edges }, null, 2);
}

/** Unknown node types (e.g. Obsidian's web-embed "link") are silently dropped — Valx has no web-embed node. */
export function fromJsonCanvas(raw: string): WorldDoc {
  const parsed = JSON.parse(raw);
  const nodes: WorldNode[] = [];
  for (const n of parsed.nodes ?? []) {
    const xv = n['x-valx'] || {};
    const base = { id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, color: n.color, parentId: xv.parentId, rotation: xv.rotation };
    if (xv.kind === 'note' && typeof xv.noteId === 'string') {
      nodes.push({ ...base, type: 'note', noteId: xv.noteId });
    } else if (xv.kind === 'media') {
      nodes.push({ ...base, type: 'media', src: n.file ?? '', kind: xv.mediaKind ?? 'file', name: xv.name, noteId: xv.noteId });
    } else if (n.type === 'text') {
      nodes.push({ ...base, type: 'text', text: n.text ?? '', subtext: xv.subtext });
    } else if (n.type === 'file') {
      nodes.push({ ...base, type: 'media', src: n.file ?? '', kind: 'file', name: xv.name });
    } else if (n.type === 'group') {
      nodes.push({ ...base, type: 'group', label: n.label, folderId: xv.folderId });
    }
    // else: unknown type (e.g. 'link') — dropped
  }
  const edges: WorldEdge[] = (parsed.edges ?? []).map((e: any) => ({
    id: e.id, fromNode: e.fromNode, toNode: e.toNode,
    fromSide: e.fromSide, toSide: e.toSide, color: e.color, label: e.label, linkHref: e.linkHref, tagRef: e.tagRef,
  }));
  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Mirror Workspace (Phase 5) — one-click bootstrap that imports every note not
// yet represented in the doc, grouping folder members under a bound group
// (reusing one if the folder is already bound) and wiring edges for markdown
// links that already exist between notes present after the import.
// ---------------------------------------------------------------------------

export interface WorkspaceSnapshot {
  notes: { id: string; title: string; content: string; folderId?: string | null }[];
  folders: { id: string; name: string }[];
  noteExtensions: Record<string, string>;
}

const MIRROR_GROUP_MIN = { width: 420, height: 320 };
const MIRROR_COLS = 3;
const MIRROR_GROUP_GAP = 48;
const MIRROR_ROOT_GAP = 80;

/** Presets `parentId`/`folderId` on new nodes so the workspace-reflection watcher (useWorlds.ts)
 *  finds membership already consistent and does nothing, and presets `linkHref` on new edges so
 *  `runWorkspaceEffects`'s `appendNoteLink` is a no-op (the link already exists in the note —
 *  `hasNoteLink` short-circuits it). Returns null when every note already has a node. */
/** Which notes an import pulls in — 'all' (the old Mirror Workspace behavior), only notes inside
 *  specific folders (Item 13's "Import Valx spaces" dialog), or a hand-picked set of individual
 *  notes (the "Add note" dock button's file-explorer-style picker). */
export type ImportScope = { kind: 'all' } | { kind: 'folders'; folderIds: string[] } | { kind: 'notes'; noteIds: string[] };

export function buildWorkspaceImport(doc: WorldDoc, ws: WorkspaceSnapshot, scope: ImportScope = { kind: 'all' }): Command | null {
  const presentNoteIds = new Set<string>();
  for (const n of doc.nodes) {
    const id = noteIdOf(n);
    if (id) presentNoteIds.add(id);
  }
  const scopedNotes = scope.kind === 'all' ? ws.notes
    : scope.kind === 'notes' ? ws.notes.filter((n) => scope.noteIds.includes(n.id))
    : ws.notes.filter((n) => n.folderId && scope.folderIds.includes(n.folderId));
  const toImport = scopedNotes.filter((n) => !presentNoteIds.has(n.id));
  if (toImport.length === 0) return null;

  const existingBoundGroups = new Map<string, GroupNode>();
  for (const n of doc.nodes) if (n.type === 'group' && n.folderId) existingBoundGroups.set(n.folderId, n as GroupNode);

  const byFolder = new Map<string, typeof toImport>();
  const rootNotes: typeof toImport = [];
  for (const n of toImport) {
    if (n.folderId) {
      const list = byFolder.get(n.folderId) ?? [];
      list.push(n);
      byFolder.set(n.folderId, list);
    } else {
      rootNotes.push(n);
    }
  }

  const nodeForNote = (n: { id: string; title: string; content: string }, x: number, y: number, parentId?: string): WorldNode => {
    const media = extractFirstMedia(n.content);
    const isMediaOnly = media !== null && n.content.replace(/<[^>]*>?/gm, ' ').trim() === '';
    if (isMediaOnly && media) {
      return { id: newId(), type: 'media', x, y, ...MEDIA_FALLBACK, src: media.src, kind: media.kind, name: media.name, noteId: n.id, parentId };
    }
    return { id: newId(), type: 'note', x, y, ...NOTE_DEFAULT, noteId: n.id, parentId };
  };

  const newNodes: WorldNode[] = [];
  const origin = nextImportOrigin(doc);
  let groupY = origin.y;
  for (const [folderId, folderNotes] of byFolder) {
    const folder = ws.folders.find((f) => f.id === folderId);
    const existing = existingBoundGroups.get(folderId);
    let group: GroupNode;
    let startIdx = 0;
    if (existing) {
      group = existing;
      startIdx = childrenOf(doc, existing.id).length;
    } else {
      const totalRows = Math.ceil((startIdx + folderNotes.length) / MIRROR_COLS);
      const width = Math.max(MIRROR_GROUP_MIN.width, MIRROR_COLS * (NOTE_DEFAULT.width + 24) + 24);
      const height = Math.max(MIRROR_GROUP_MIN.height, 48 + totalRows * (NOTE_DEFAULT.height + 24) + 24);
      group = { id: newId(), type: 'group', x: origin.x, y: groupY, width, height, label: folder?.name || folderId, folderId };
      newNodes.push(group);
      groupY += height + MIRROR_GROUP_GAP;
    }
    folderNotes.forEach((n, i) => {
      const idx = startIdx + i;
      const col = idx % MIRROR_COLS, row = Math.floor(idx / MIRROR_COLS);
      const x = group.x + 24 + col * (NOTE_DEFAULT.width + 24);
      const y = group.y + 48 + row * (NOTE_DEFAULT.height + 24);
      newNodes.push(nodeForNote(n, x, y, group.id));
    });
  }

  if (rootNotes.length > 0) {
    const rootOrigin = { x: origin.x + MIRROR_GROUP_MIN.width + MIRROR_ROOT_GAP, y: origin.y };
    const points = layoutImportCross(rootOrigin, rootNotes.map(() => NOTE_DEFAULT));
    rootNotes.forEach((n, i) => newNodes.push(nodeForNote(n, points[i].x, points[i].y)));
  }

  // Every note in ws.notes now has a node: either it already did (presentNoteIds)
  // or it's in toImport/newNodes — so edges can scan ws.notes directly.
  const idByNoteId = new Map<string, string>();
  for (const n of doc.nodes) { const nid = noteIdOf(n); if (nid) idByNoteId.set(nid, n.id); }
  for (const n of newNodes) { const nid = noteIdOf(n); if (nid) idByNoteId.set(nid, n.id); }

  const seenPairs = new Set(doc.edges.map((e) => pairKey(e.fromNode, e.toNode)));
  const newEdges: WorldEdge[] = [];
  for (const from of ws.notes) {
    for (const to of ws.notes) {
      if (from.id === to.id) continue;
      const fromNodeId = idByNoteId.get(from.id), toNodeId = idByNoteId.get(to.id);
      if (!fromNodeId || !toNodeId) continue;
      const key = pairKey(fromNodeId, toNodeId);
      if (seenPairs.has(key)) continue;
      const ext = ws.noteExtensions[to.id] ?? '.md';
      const href = linkHrefForNote(to.title, ext);
      if (!hasNoteLink(from.content, href)) continue;
      seenPairs.add(key);
      newEdges.push({ id: newId(), fromNode: fromNodeId, toNode: toNodeId, linkHref: href });
    }
  }

  return { type: 'add', nodes: newNodes, edges: newEdges };
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

export function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'world';
}

export function uniqueSlug(existing: string[], wanted: string): string {
  const taken = new Set(existing);
  let slug = wanted;
  for (let i = 2; taken.has(slug); i++) slug = `${wanted}-${i}`;
  return slug;
}
