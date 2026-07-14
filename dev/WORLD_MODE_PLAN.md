# World Mode (Canvas) — Implementation Plan for Sonnet

> Handoff doc. Build in the phase order below. Standing rules: **keep UI/UX consistent** (accent `#32CD32`, light `slate-*` / dark `neutral-*`, `lucide-react` icons, hand-rolled Tailwind — no new deps, no component libraries). **Write tests, run no builds.** Pure logic in `src/lib/*` tested with `node --import tsx --test`; `npm run lint` = `tsc --noEmit` must stay green. Do **not** run `npm run build`, `start`, `package`, or installer makes.

---

## 0. What this is

A new top-level **mode** (not a filter) in Valx: an infinite pan/zoom **canvas** where the user places cards, attaches existing notes and media, groups them, and draws labeled links to map how things relate. Users create unlimited **Worlds**, managed in the sidebar like folders. Opening a World replaces the NoteList + Editor columns with the canvas; the Sidebar stays.

Node types are exactly four: **text card** (with a subtext line), **note** (reference to a workspace note), **media/file**, **group**. No web-page nodes.

---

## 1. Architecture decisions (already made — do not relitigate)

- **On-disk format:** [JSON Canvas](https://jsoncanvas.org) `.canvas` files, one per world, under `<workspace>/.worlds/`. Dot-prefixed dir → already excluded from note/folder scans. Valx-specific fields (subtext, note-id refs, media kind) go under a per-node `"x-valx"` object so the file still opens in Obsidian. We emit node types `text | file | group` only (spec's `link`/web type is unused).
- **Rendering:** hand-rolled. One transformed surface (`transform: translate(panX,panY) scale(zoom)`); nodes are absolutely-positioned HTML divs (text cards reuse `contentEditable`; media nodes reuse `<img>/<video>/<audio>` on existing `/__media/` range-served URLs); edges are **one** SVG layer beneath the nodes drawing cubic beziers. No react-flow/tldraw.
- **Node references by id, not path:** note nodes store the note's opaque `id` (stable across rename/move/format-convert) and read live from `notes` state. Media nodes store the `/__media/…` app URL like the editor does.
- **State hook:** new `useWorlds` mirroring `useNotes` discipline (localStorage maps keyed by `wsKey()`, debounced saves, `serializeDisk`-style single-file write mutex, `beforeunload`/`visibilitychange` flush).
- **Undo/redo:** in-memory **command stack**, separate from the note undo path. `src/lib/world.ts` mutations are modeled as invertible command objects from day one so Phase 2 just wires the stack to the toolbar.

### 1a. Persistence strategy — READ THIS, it's the main trap

The existing directory readers (`fs:readDirectory` in [main.js](../main.js), `readWebDirectory` in [useFileSystem.ts](../src/hooks/useFileSystem.ts)) **filter to note extensions** (`NOTE_EXT_RE`) and there is **no generic read-file IPC**. Consequences:

- **Writing** `.canvas` works today: `saveFile(handle, ['.worlds'], '<slug>.canvas', json)` and `deleteFile(handle, ['.worlds'], '<slug>.canvas')` are generic — reuse as-is.
- **Reading `.canvas` back does not work** without new native plumbing, and `main.cjs` is esbuild-bundled and **not hot-reloaded** (any main.js/preload edit needs a full `npm start` restart — which collides with "no builds" during Sonnet's own iteration).

**Therefore, split persistence across phases:**

- **Phase 1 — localStorage is the source of truth.** Store the worlds index and each world document in localStorage (`valx-worlds:${wsKey()}` → `WorldMeta[]`; `valx-world-doc:${wsKey()}:${worldId}` → serialized doc). Simultaneously **mirror** each save to disk best-effort via the existing `saveFile` (writes the portable `.canvas`; never read back yet). This path is 100% renderer-side, needs no IPC, no build, and is verifiable in the browser preview.
- **Phase 2 — add disk read-back** so a restarted app / another device rehydrates from the `.canvas` files (and Obsidian-authored canvases appear). This is the *one* unavoidable native change, isolated to a single discrete step:
  - [main.js](../main.js): add `ipcMain.handle('fs:readWorlds', …)` → reads `<root>/.worlds`, returns `[{ name, content, mtime }]` for `*.canvas` (mkdir-safe; returns `[]` if the dir is absent).
  - [preload.cjs](../preload.cjs): expose `readWorlds: (root) => ipcRenderer.invoke('fs:readWorlds', root)`.
  - [useFileSystem.ts](../src/hooks/useFileSystem.ts): add `readWorlds(handle)` — electron → the IPC; web → open `.worlds` dir handle, iterate `.values()`, read each `*.canvas` via `getFile().text()`.
  - On load, reconcile disk vs localStorage: newer `mtime` wins per world; disk-only files import; localStorage-only worlds re-mirror to disk. **Flag clearly in the PR that this step requires the user to `npm start` once** (main not hot-reloaded).

Keep the world document **small**: media stays path-referenced (no base64), so a world is just geometry + short text + refs — localStorage-safe.

---

## 2. Data model — `src/lib/world.ts` (pure, no DOM/React, the testable core)

```ts
export type NodeColor = 'default' | '1' | '2' | '3' | '4' | '5' | '6'; // JSON Canvas palette; 'default' -> #32CD32 accent

export interface WorldNodeBase { id: string; x: number; y: number; width: number; height: number; color?: NodeColor; }
export interface TextNode  extends WorldNodeBase { type: 'text'; text: string; subtext?: string; }      // x-valx.subtext on disk
export interface NoteNode  extends WorldNodeBase { type: 'note'; noteId: string; }                        // x-valx.noteId
export interface MediaNode extends WorldNodeBase { type: 'media'; src: string; kind: 'image'|'audio'|'video'|'file'; name?: string; } // -> JSON Canvas "file"
export interface GroupNode extends WorldNodeBase { type: 'group'; label?: string; }
export type WorldNode = TextNode | NoteNode | MediaNode | GroupNode;

export interface WorldEdge {
  id: string; fromNode: string; toNode: string;
  fromSide?: 'top'|'right'|'bottom'|'left'; toSide?: 'top'|'right'|'bottom'|'left';
  label?: string; color?: NodeColor;
}

export interface WorldDoc { nodes: WorldNode[]; edges: WorldEdge[]; }
export interface WorldMeta { id: string; name: string; slug: string; updatedAt: number; }
```

**Pure functions to implement + test:**
- Node CRUD: `addNode(doc, node)`, `updateNode(doc, id, patch)`, `moveNodes(doc, ids, dx, dy)`, `deleteNodes(doc, ids)` (also drops incident edges), `resizeNode`.
- Edges: `addEdge(doc, from, to)`, `updateEdge`, `deleteEdge`. Reject self-edges and exact duplicates.
- Groups: `createGroup(doc, bounds|childIds)`; moving a group moves enclosed nodes (compute membership by geometric containment at drag start).
- Serialization: `toJsonCanvas(doc): string` / `fromJsonCanvas(raw): WorldDoc` — round-trip stable; unknown node types (e.g. a `link` from Obsidian) are preserved or safely dropped (decide + test); `x-valx` fields survive.
- Geometry: `nodeBounds(doc)` (for fit-to-content), `hitTestNode(doc, pt)`, `edgeAnchor(node, side)` (bezier endpoints), `pointInPolygon(pt, polygon)` for the freehand lasso.
- **Commands:** `type Command = {...}` with `apply(doc): WorldDoc` and `invert(): Command`. Provide `runCommand(doc, cmd)` and helpers to build each mutation as a command. Undo/redo stacks live in `useWorlds`, but the invert logic is here and unit-tested.

`slugify(name)` for filenames (reuse `sanitize` semantics; collision-suffix like notes' `assignFileName`).

---

## 3. State — `src/hooks/useWorlds.ts`

Mirror `useNotes`:
- `worlds: WorldMeta[]`, `activeWorldId`, `activeDoc: WorldDoc | null`.
- CRUD: `createWorld(name)`, `renameWorld(id, name)`, `deleteWorld(id)` (confirm; optional `.trash` parity — Phase 3), `openWorld(id)`, `closeWorld()`.
- `applyCommand(cmd)` → updates `activeDoc`, pushes to undo stack, clears redo, **debounced persist** (~500–700ms) + immediate flush on close/unmount/`beforeunload`.
- `undo()` / `redo()`.
- Persist: localStorage (Phase 1 authoritative) + best-effort `.canvas` mirror via `saveFile`. Load: localStorage now; disk reconcile in Phase 2.
- Prune world docs whose meta was deleted; prune note-nodes whose `noteId` no longer exists in `notes` (pass `notes` in, like the bookmark prune).

Expose the bundle to `App`.

---

## 4. Shell wiring — `src/App.tsx`

- Add `const [appView, setAppView] = useState<{type:'notes'} | {type:'world'; worldId:string}>({type:'notes'})`.
- Pull `useWorlds()` (or nest it; it needs `workspaceHandle` + `notes`, so instantiate alongside `useNotes` and pass `notes` in).
- When `appView.type === 'world'`: render `<WorldCanvas .../>` in the flex area **in place of** `<NoteList>` + `<Editor>` (Sidebar stays). When `'notes'`: current layout.
- Opening a world from the sidebar sets `appView` + `openWorld(id)`; a "← Notes" affordance (or clicking All Notes/a folder/tag) returns to notes mode.
- Thread world props + handlers into `<Sidebar>`.
- Mobile: Phase 3. For now, world mode targets the desktop 3-pane; on mobile it can occupy the main column with the existing drawer for the sidebar.

---

## 5. Sidebar — `src/components/Sidebar.tsx`

Clone the **Folders** section (lines ~103–162: header with `Plus`, rows with hover-reveal `Trash2`) into a new **Worlds** section (place it directly under Folders). Icon: `Globe` (or `Network`). Each row: click → open world (highlight active like folders do when `appView.type==='world' && activeWorldId===w.id`); hover `Trash2` → delete (confirm). `Plus` → inline name input (reuse the `isAddingFolder` pattern). New props: `worlds`, `activeWorldId`, `inWorldMode`, `onOpenWorld`, `onAddWorld`, `onDeleteWorld`.

---

## 6. Canvas UI — `src/components/WorldCanvas.tsx` (+ small subcomponents)

**Component tree:**
```
WorldCanvas (owns pan/zoom + selection + interaction mode)
├─ <svg> edge layer (beziers via edgeAnchor; labels as <text>/foreignObject)
├─ node layer (absolutely-positioned) → NodeView per node (text | note | media | group)
├─ EmptyStateCard  (shown when doc.nodes.length === 0)
├─ BottomDock      (group | add card | add note | add media | link-lasso) — drag-out sources
├─ RightToolbar    (settings gear, reset view, fit-to-content, undo, redo)
├─ CanvasContextMenu (right-click empty: Add card / Add note / Add media / Create group)
└─ StatusCounter   (bottom-left pill: "N notes · N media · N groups")
```

**Interaction contract (from the reconciled screenshots):**

| Input | Action |
|---|---|
| Space + drag (or middle-drag) | Pan |
| Plain scroll | Vertical pan |
| Ctrl + scroll | Zoom to cursor |
| Click node | Select (shift-click = add; Esc = clear) |
| **Ctrl + left-drag** | **Freehand lasso** select (draw region → `pointInPolygon` picks enclosed nodes; purple selection border) |
| Drag node | Move (group drag moves members) |
| Drag dock icon → canvas | Spawn that node type at drop point |
| **Link Lasso** tool active, drag node→node | Create one labeled edge |
| Double-click edge / node label | Inline edit label / text |
| Double-click text card | Edit body (single-click = select/drag; keep these modes distinct so contentEditable stays usable) |
| Drop external file(s) | `importMedia` → media node at drop point |
| Right-click empty canvas | Context menu (add card / note / media / group) |
| Delete/Backspace (node selected, not editing) | Delete selected nodes/edges |

**Removed per red annotations — do NOT build:** double-click-empty to create; zoom +/− buttons; help "?" button; the mid-toolbar pencil/lock toggle (no read-only mode); any bottom-right help/branding chip; "Add web page" menu item / web-embed node.

**Gotchas:**
- `getBoundingClientRect`, caret math, and pointer coords all sit under CSS `scale` — convert screen↔canvas coords through the pan/zoom transform in one helper (`screenToCanvas(pt)`); use it everywhere.
- Keep all edges in the single SVG (not one SVG per edge) for perf.
- Node previews (note nodes) read from live `notes` by id — free reactivity, no snapshotting.
- Reuse existing render patterns: NoteList's note-preview markup for note nodes; RichTextEditor/NoteList media rendering (image thumb, `#t=0.1` video poster, audio icon, `📎` file chip) for media nodes.

**Styling:** near-black canvas (`bg-neutral-950`/`#0a0a0a`) with a dotted grid (radial-gradient background), matching the screenshots. Dock/toolbar/menus = same floating-panel look already used by the editor's table toolbar and share menu (`bg-white dark:bg-neutral-950`, `border-slate-200 dark:border-neutral-800`, `shadow-lg`, `rounded-lg`). Selection border + `default` node color = `#32CD32`.

**CSS:** add canvas grid + any node/edge classes to [src/index.css](../src/index.css) alongside existing animations.

---

## 7. Phasing (build in this order)

| Phase | Deliverable | Files |
|---|---|---|
| **1** | `world.ts` (data model + command mutations + serialize + geometry) **+ tests**; `useWorlds` (localStorage authoritative + best-effort `.canvas` mirror); Sidebar Worlds section; `appView` switch in App; canvas surface (Space-pan, plain-scroll pan, Ctrl-zoom, dotted bg, empty-state card); **bottom dock**; **text cards + subtext**; **groups**; **Link Lasso edges**; right toolbar (reset, fit); context menu (add card / create group); persistence | new: `src/lib/world.ts`, `src/lib/world.test.ts`, `src/hooks/useWorlds.ts`, `src/components/WorldCanvas.tsx`; edit: `App.tsx`, `Sidebar.tsx`, `index.css` |
| **2** | Add-note & add-media (pickers reusing NoteList row + this session's search; OS/file-dialog + `importMedia`; external drop); **undo/redo** wired to toolbar; **Ctrl freehand lasso**; bottom-left counter; edge labels; node colors; **disk read-back IPC** (`fs:readWorlds` + preload + `useFileSystem.readWorlds` + load-time reconcile) | edit: `main.js`, `preload.cjs`, `useFileSystem.ts`, `useWorlds.ts`, `WorldCanvas.tsx`; new: a note/media picker modal |
| **3** | Settings-gear panel (grid/snap toggle, rename world), world `.trash` parity, export world as image, mobile layout, edge styles/curvature | scoped later |

---

## 8. Tests (`node --import tsx --test`, no builds)

`src/lib/world.test.ts` — cover:
1. Node CRUD invariants; `deleteNodes` also removes incident edges.
2. `addEdge` rejects self-edges and duplicates.
3. Command `invert()` round-trips: `runCommand` then apply of `invert()` returns the original doc (add/move/delete/edge/group).
4. `toJsonCanvas`/`fromJsonCanvas` round-trip preserves geometry, text, **subtext**, note-id refs, media kind (`x-valx` survives); unknown/`link` nodes handled per decided rule.
5. `pointInPolygon` for the lasso (inside/outside/edge cases).
6. `nodeBounds`/fit math; `edgeAnchor` side geometry.
7. `slugify` collision suffixing.

Also add a tiny `bookmarks`-style pure test for the `useWorlds` reconcile rule if you extract it (newer-mtime-wins) into `world.ts`.

Then `npm run lint` clean.

---

## 9. Verification (what's actually testable without a build)

- **Preview (web mode):** the whole Phase-1 canvas is verifiable in the browser preview because `useWorlds` is localStorage-authoritative and needs no IPC. Drive it with `preview_*` tools: create a world from the sidebar, spawn cards/groups via the dock, draw a link, pan/zoom, reload → world persists (localStorage). The preview iframe historically can't obtain a File System Access workspace handle, so the disk `.canvas` mirror can't be exercised there — that's expected; the localStorage path proves the UX.
- **Phase 2 disk read-back** (`fs:readWorlds`) touches the non-hot-reloaded main process → **requires the user to `npm start` once**; call this out explicitly in the PR and do not attempt a build yourself.

---

## 10. Open defaults (Opus/Sonnet may proceed with these; flag if wrong)

1. No read-only mode (the scribbled mid-toolbar toggle is treated as removed).
2. **Link Lasso** = drag a stroke from source node to target node → one edge (matches the two-boxes-with-arrow icon), rather than "connect everything the stroke crosses."
3. Counter = quiet bottom-left pill, format `12 notes · 4 media · 2 groups` (groups/cards countable too — include what's cheap).
4. Worlds section sits directly under Folders in the sidebar; icon `Globe`.
5. JSON Canvas on disk (Obsidian-interoperable) rather than a Valx-private schema.
