# World Mode — Phase 2 Plan (interactivity, theming, media/note import, scissor)

Handoff plan for Sonnet. Executes on top of the Phase 1 build already in the repo
(`src/lib/world.ts`, `src/hooks/useWorlds.ts`, `src/components/WorldCanvas.tsx`,
Sidebar Worlds section, App `appView` switch). **Constraints (verbatim, standing):
"keep the UI / UX consistent across the app", "do tests but no builds".**

No `main.cjs` / `preload.cjs` changes are required — every IPC we need already
exists (`importMedia`, `saveFile`, `/__media` static server). Do **not** run
`npm run electron` / packaging. Allowed: `node --import tsx --test src/lib/*.test.ts`
and `npm run lint` (`tsc --noEmit`), plus browser-preview verification.

---

## 0. What the user asked for (checklist — every item must land)

1. Link-Lasso connectors are **flexible** and always anchored to node/media/group
   windows, and follow them live while dragging.
2. **Black + lime-green in dark mode, white + lime-green in light mode. NO purple**
   anywhere in World Mode. Canvas must follow the app light/dark toggle (today it
   is hard-dark).
3. **Groups renamable.**
4. **Every** node (text, note, media, group) has a **colour picker** that overlays
   the chosen colour onto that node's window, plus **size-adjuster handles**, both
   revealed **on hover**.
5. **Ctrl+Drag = rectangle marquee** (freely sized, not freehand). On release it
   **auto-opens the add-context-menu** asking what to place.
6. **Wire up every button** — nothing is a placeholder toast anymore.
7. **Remove the Settings gear** inside World Mode.
8. **Add Note** reveals the 2nd-column note list and supports **drag-and-drop
   (multi-select) into the canvas**, with a **pop animation** on spawn.
9. **Auto-size** imported windows so large notes aren't huge — fit-to-screen by
   default; user can resize bigger.
10. **Media (and notes)** can be dragged/dropped from any file or note into the canvas.
11. The **2nd-column note list toggles** (click folder/All Notes to show, click again
    to hide) with a **sliding animation**, giving space back to the canvas.
12. When **Link Lasso is armed**, it draws on top of everything — node interaction is
    suppressed while armed and restored when disarmed.
13. Link-Lasso wires are **lime by default, but inherit a connected node's/group's
    colour** if it has one.
14. **Group attach/detach** is easy — drop a node inside to attach, drag it out to
    detach — **links stay connected** through it.
15. Spawned/imported nodes appear **on top** and are **stacked in a line down the
    right** by default (no overlap).
16. New **Scissor tool** in the dock next to Link Lasso — cuts wires only, with a
    **breaking-off animation** before the wire fades.
17. **Linked windows glow** like the wire; **unlinked windows shudder once and stop
    glowing** (fires when a cut leaves a node with no edges).

---

## 1. Design decisions (lock these before coding)

### 1a. Theming — kill purple, follow app theme
- Add `isDarkMode: boolean` to `WorldCanvasProps`; App already owns `isDarkMode`
  (`src/App.tsx:38`). Pass it: `<WorldCanvas isDarkMode={isDarkMode} … />`.
- Canvas surface: `bg-black` (dark) / `bg-white` (light) instead of `bg-neutral-950`.
  Dot-grid uses `rgba(255,255,255,0.08)` (dark) / `rgba(0,0,0,0.06)` (light).
- Node cards: dark → `bg-neutral-900 border-neutral-700 text-slate-100`; light →
  `bg-white border-slate-200 text-slate-800`. Centralise via a small
  `themeClasses(isDark)` helper object at the top of the component so every node
  branch reads from it (avoid scattering ternaries).
- **Replace every purple token** in WorldCanvas.tsx:
  - `border-violet-500` / `ring-violet-500` (selection, resize handle) → `#32CD32`
    (`border-[#32CD32] ring-[#32CD32]`).
  - lasso fill/stroke `#8b5cf6` / `rgba(139,92,246,…)` → lime (`#32CD32`,
    `rgba(50,205,50,0.12)`).
  - empty-state `text-violet-300` → `text-[#32CD32]`.
- The app accent everywhere else is `#32CD32` (lime) — reuse it verbatim for
  consistency (matches Sidebar/NoteList/Editor).

### 1b. Node colour palette (`world.ts`)
Keep the existing `NodeColor = 'default'|'1'..'6'` enum (JSON-Canvas compatible) and
add a pure resolver + palette (no purple):

```ts
// world.ts — pure, unit-tested
export interface ColorSwatch { key: NodeColor; label: string; hex: string; }
export const WORLD_PALETTE: ColorSwatch[] = [
  { key: 'default', label: 'Lime',   hex: '#32CD32' },
  { key: '1',       label: 'Red',    hex: '#ef4444' },
  { key: '2',       label: 'Orange', hex: '#f59e0b' },
  { key: '3',       label: 'Yellow', hex: '#eab308' },
  { key: '4',       label: 'Green',  hex: '#22c55e' },
  { key: '5',       label: 'Cyan',   hex: '#06b6d4' },
  { key: '6',       label: 'Pink',   hex: '#ec4899' }, // was purple in JSON Canvas — swapped out
];
export const colorHex = (c?: NodeColor): string =>
  (WORLD_PALETTE.find(s => s.key === (c ?? 'default'))?.hex) ?? '#32CD32';
```
"Overlay the colour on the window" = tint border + a translucent wash + glow using
that hex (border at full, background at ~10–14% alpha). Node body stays
theme-black/white; only the accent (border/glow/left-strip) takes the colour.

### 1c. Wire colour resolution (`world.ts`, pure)
```ts
// lime default; else inherit from an endpoint that has a non-default colour.
export function edgeColor(doc: WorldDoc, edge: WorldEdge): string {
  if (edge.color && edge.color !== 'default') return colorHex(edge.color);
  const from = doc.nodes.find(n => n.id === edge.fromNode);
  const to   = doc.nodes.find(n => n.id === edge.toNode);
  const c = (from?.color && from.color !== 'default' && from.color)
         || (to?.color   && to.color   !== 'default' && to.color);
  return c ? colorHex(c) : '#32CD32';
}
```

### 1d. Persistence & no-build media path
- Node `color`, group `label`, note `noteId`, media `src`/`kind`/`name` are all
  already in the model and already serialised by `toJsonCanvas`/`fromJsonCanvas`.
  **No schema change needed** except: extend `fromJsonCanvas` to also restore the
  optional `subtext` you already write (already handled) — verify nothing else.
- Media import: reuse the shipped pipeline. In Electron,
  `window.electronAPI.importMedia({ name, dataBase64 })` copies into
  `.attachments/` and returns a `/__media/.attachments/…` app URL that the static
  server serves — durable across reloads, **no build**. In the browser-preview /
  web fallback (no `electronAPI`), fall back to a base64 data URL (the app already
  tolerates base64 media; heavy but fine for Phase-2 web). Centralise as an async
  `importDroppedFile(file): Promise<{src, kind, name}>` helper in a new
  `src/lib/worldMedia.ts` (thin, DOM-free except FileReader; kind inferred from
  MIME → `'image'|'audio'|'video'|'file'`).

---

## 2. `src/lib/world.ts` — pure additions (all unit-tested in `world.test.ts`)

Add and export:

1. `WORLD_PALETTE`, `colorHex`, `edgeColor` (§1b/§1c).
2. **Rectangle marquee**
   ```ts
   export function rectFromPoints(a: Point, b: Point): Rect; // normalised (min/size)
   export function nodesInRect(doc: WorldDoc, r: Rect): string[]; // bounds-intersect, any overlap
   ```
   Use intersection (not center-in), the standard marquee behaviour.
3. **Scissor geometry**
   ```ts
   export function segmentsIntersect(p1,p2,p3,p4: Point): boolean; // orientation test
   // Samples the bezier (reuse control-point math from bezierPath, ~16 samples)
   // into a polyline and tests it against the scissor stroke's segments.
   export function edgeCutByStroke(from: Rect, to: Rect, fromSide, toSide, stroke: Point[]): boolean;
   export function edgesCutByStroke(doc: WorldDoc, stroke: Point[]): string[]; // edge ids
   ```
   NOTE: `bezierPath` currently lives in WorldCanvas.tsx. **Move the pure bezier
   sampling** (`offsetForSide`, control-point derivation) into `world.ts` as
   `bezierPoints(a,b,fromSide,toSide): Point[]` and have both WorldCanvas's path
   string builder and the scissor test consume it. Keep `bezierPath` as a thin
   wrapper (`M…C…`) in the component or re-export from world.ts.
4. **Linked-node detection & spawn layout**
   ```ts
   export function linkedNodeIds(doc: WorldDoc): Set<string>;   // nodes with ≥1 edge
   export function nextImportOrigin(doc: WorldDoc): Point;      // top-right of content bounds + gap
   export function layoutImportColumn(origin: Point, sizes: {w,h}[], gap=24): Point[];
   ```
   `nextImportOrigin` = `{ x: bounds.maxX + 80, y: bounds.minY }` (or viewport-ish
   default when empty). `layoutImportColumn` stacks positions straight down with
   `gap`. Used for both multi-note drop and dock spawns so imports never overlap.
5. **Auto-size**
   ```ts
   export const NOTE_DEFAULT = { width: 240, height: 168 };
   export const MEDIA_MAX = 320;
   export function fitMediaSize(natW: number, natH: number, max=MEDIA_MAX): {width,height};
   ```
6. **Group membership already exists** (`nodesInGroup`) — no change; attach/detach is
   purely geometric (see §6).

**Tests to add to `world.test.ts`** (keep the `node --test` style; ~12 new checks):
- `nodesInRect` selects overlapping, excludes disjoint; `rectFromPoints` normalises
  a bottom-right→top-left drag.
- `segmentsIntersect` true/false canonical cases; `edgeCutByStroke` true when a
  stroke crosses the wire between two boxes, false when it misses.
- `edgeColor`: default lime; inherits `from` colour; edge colour wins over node.
- `colorHex` maps 'default'→lime and unknown→lime.
- `linkedNodeIds` returns exactly the endpoints of existing edges.
- `nextImportOrigin`/`layoutImportColumn`: N sizes → N non-overlapping stacked points
  to the right of content.
- `fitMediaSize`: wide image clamps width to MEDIA_MAX and scales height by aspect;
  small image is returned unchanged.

---

## 3. WorldCanvas — interaction model changes

### 3a. Ctrl+Drag → rectangle marquee (replaces freehand lasso)
- `Interaction` union: replace `{ kind:'lasso'; points }` with
  `{ kind:'marquee'; start: Point; current: Point }`. Keep `linklasso` as-is but
  see §4 (it becomes stroke-based still).
- `onCanvasMouseDown`: on Ctrl/Meta+left, if `linkLassoArmed` → linklasso;
  else if `scissorArmed` → scissor stroke; else → `marquee` (start=current=pt).
- Move handler updates `current`; render a lime dashed rect
  (`rectFromPoints(start,current)` in canvas space, inside the transformed layer).
- Mouse-up: `setSelectedIds(nodesInRect(doc, rect))`, then **open the add
  context-menu** at the release screen point (`setContextMenu({screenX, screenY,
  canvasPt: current})`). Requirement #5: marquee always surfaces the add menu.
  (If the rect is a tiny click-sized box, still open it — that's the "what do you
  want to add here" affordance.)

### 3b. Flexible connectors that follow live drags (#1)
- Build a live-offset map each render:
  ```ts
  const liveOffset = (id) => (interactionRef.current?.kind==='move'
    && interactionRef.current.ids.includes(id)) ? dragOffset : {dx:0,dy:0};
  const livePos = (n) => ({ ...n, x:n.x+liveOffset(n.id).dx, y:n.y+liveOffset(n.id).dy });
  ```
- Edge layer: compute anchors from `livePos(from)` / `livePos(to)` (and live resize
  delta for a resizing endpoint) so wires bend/stretch smoothly during drag/resize
  instead of snapping at drop. This is the whole of "flexible".

### 3c. Colour picker + size handles on hover (#4)
- Track `hoveredId` (`onMouseEnter/Leave` per node). Show, when
  `hoveredId===n.id || selected`:
  - a small **palette popover** button (top-right of the node): clicking opens a row
    of `WORLD_PALETTE` swatches; picking one → `onApplyCommand(buildPatchNode(doc,
    n.id, { color: key }))`. Applies to text/note/media/group uniformly.
  - the **resize handle** (bottom-right) — currently gated on `selected && !editing`;
    change to `(hovered || selected) && !editing`. Add a second handle affordance is
    optional; one bottom-right nwse handle is enough and matches the screenshots.
- Overlay colour: node style reads `colorHex(n.color)` → set `borderColor`, a
  `boxShadow` glow, and a subtle background wash (`${hex}22`). Keep text legible on
  black/white body.

### 3d. Glow / shudder (#17)
- `const linked = linkedNodeIds(doc)` each render. A node in `linked` gets the
  `vx-node-glow` class (glow colour = `edge/own colour`, via inline `--glow` CSS var).
- Shudder: when an apply/undo removes an edge and a node that *was* linked is now
  unlinked, play a one-shot `vx-shudder`. Implement by diffing linked-sets across
  renders in a `useEffect([doc.edges])`: keep `prevLinkedRef`; for ids in `prev` not
  in `next`, add their id to a transient `shudderIds` state, clear after 500ms. Node
  gets `vx-shudder` while in that set. Glow turns off naturally (no longer in `linked`).

### 3e. Spawn/import placement & pop (#8/#15)
- All spawns (dock click, context-menu add, note drop, media drop) place via
  `nextImportOrigin(doc)` + `layoutImportColumn`. New nodes get a transient
  `vx-pop` class (scale-in) via a `poppingIds` state cleared after 320ms.
- Ensure new nodes render **last** in `doc.nodes` (they already do — `add` appends),
  so they're on top (later = higher in the DOM/hit-test order).

---

## 4. Link Lasso upgrades (#12/#13/#1)

- Add `scissorArmed` state alongside `linkLassoArmed`; **mutually exclusive** (arming
  one disarms the other).
- **Draw-on-top / suppress node interaction while armed** (#12): when
  `linkLassoArmed || scissorArmed`, add `pointer-events-none` to every node wrapper
  (or set it on the nodes layer container) so the Ctrl-free drag starts a stroke
  even when it begins over a card. Restore on disarm. Also: while armed, a plain
  left-drag (no Ctrl needed) should draw the stroke — update `onCanvasMouseDown` so
  that if `linkLassoArmed`/`scissorArmed`, a left mousedown starts the stroke
  directly (Ctrl optional). Keep Space/middle for pan.
- **Wire colour** (#13): edge render stroke = `edgeColor(doc, edge)`; the live
  link-lasso preview stroke stays lime.
- Connectors already re-anchor to windows every render (§3b makes them follow live).

## 5. Scissor tool (#16)

- Dock: add a `Scissors` button (lucide `Scissors` — verify export before use) right
  after the Link-Lasso `Waypoints` button; same armed styling.
- Interaction: `{ kind:'scissor'; points: Point[] }`. On up, `edgesCutByStroke(doc,
  points)` → ids. For each cut edge: play the **break animation** then remove.
  - Break animation: before applying the remove command, stash the cut edges in a
    `breakingEdges` state and render them with a `vx-wire-break` class (dash-offset
    animate + fade) for ~360ms; after the timeout call
    `onApplyCommand({type:'remove', nodes:[], edges: cutEdges})` and clear
    `breakingEdges`. (Single remove command = single undo step; undo restores wires.)
  - The removal will drop some nodes out of `linkedNodeIds` → §3d shudder fires
    automatically. Good — the two requirements interlock.
- Scissor only ever touches edges — never nodes.

## 6. Group attach / detach (#14)

- Membership is geometric already (`nodesInGroup`), and dragging a group already
  carries its contents (`beginNodeDrag` extra-ids). Requirement is UX polish:
  - **Attach affordance**: while dragging a non-group node, if its live bounds fall
    inside a group, highlight that group (`vx-group-hot` ring in lime/its colour).
    Nothing is stored — on drop it's "in" the group because geometry says so.
  - **Detach**: dragging a node out of the group's bounds just works (geometry).
    Confirm the group-drag extra-ids are computed at `mousedown` (snapshot), so a
    node dragged *out* isn't yanked back.
  - **Links stay connected**: edges reference node ids, independent of group
    membership — verify nothing prunes edges on attach/detach (it doesn't). Add a
    test asserting `nodesInGroup` changes as a node moves in/out while `doc.edges`
    is untouched.

## 7. Button wiring & chrome (#3/#6/#7)

- **Remove** the Settings `ToolbarButton` (WorldCanvas.tsx:475) entirely, plus the
  now-unused `Settings` import.
- **Group rename** (#3): double-click the group label → inline `contentEditable`
  (mirror the text-card edit pattern incl. the `onBlurCapture` editingId fix from
  Phase 1); commit via `buildPatchNode(doc, id, { label })`.
- **Dock buttons**: `Add note` and `Add media` are no longer toasts —
  - `Add note` → calls `onRequestNoteList()` (new prop) to reveal the 2nd column for
    drag-drop, AND still supports being dragged itself (dragging the dock button
    spawns an empty note-picker? No — keep dock `note`/`media` as drag sources that,
    on drop, trigger the picker). Simplest wiring: dock `Add note` click →
    `onRequestNoteList()`; dock `Add media` click → open a hidden `<input
    type=file>` file dialog, import via §1d, spawn media node.
- Context-menu "Add note"/"Add media" get the same real handlers (open note list /
  file dialog), not toasts.

## 8. Cross-canvas drag-and-drop (#8/#10) — the App + NoteList + Canvas wiring

### 8a. Note list column toggle (#11)
- In `App.tsx`: add `showNoteList` state (default `true`). Sidebar filter click
  (`handleSetFilter`) **toggles** it when the same filter is re-selected (clicking
  All Notes / a folder again hides; clicking hides→shows). In world mode,
  `onRequestNoteList` from the canvas forces `showNoteList=true`.
- Render: wrap `<NoteList>` so that when `!showNoteList` it slides out
  (`-translate-x-full`, `w-0`/`overflow-hidden`) with `transition-[width,transform]
  duration-300`, giving width back to the canvas. Keep it mounted (so drag source is
  available instantly) — animate width/translate, don't unmount.
- This applies in **both** notes view and world view: in world view the NoteList
  renders as a left rail beside `<WorldCanvas>` when `showNoteList`.

### 8b. Dragging notes from NoteList → canvas
- NoteList already sets `application/x-bear-notes` = `JSON.stringify(ids)` on
  drag (`NoteList.tsx:85`). **Reuse it** — no NoteList change needed for notes.
- WorldCanvas `handleDrop` (rename/extend `handleDockDrop`): read
  `application/x-bear-notes`; if present, parse ids, `layoutImportColumn` from
  `nextImportOrigin`, build one `add` command with a `note` node per id (size
  `NOTE_DEFAULT`), apply, mark them popping. Multi-select drop → multiple nodes in a
  right-side column. (#8 pop + #9 auto-size + #15 placement all satisfied here.)

### 8c. Dragging media from a note / OS file → canvas
- WorldCanvas drop handler also inspects `e.dataTransfer.files`: for each dropped OS
  file, `await importDroppedFile(file)` (§1d) → media node sized via `fitMediaSize`
  (images: probe natural size via an `Image()` load before sizing; audio/video/file:
  fixed default box). Apply as `add`, pop.
- Dragging media *out of a note*: the note preview media in NoteList isn't currently
  draggable as media. Minimal approach that honours "from any note": allow dropping a
  **note** (8b) — the note node shows its first media inline. A dedicated
  "drag just the image out of a note" is optional; if included, add `draggable` to the
  note-row media thumbnail setting `application/x-valx-media` =
  `JSON.stringify({src, kind, name})` and have the canvas consume it. Keep this last;
  it's the lowest-value sub-item.

---

## 9. `src/index.css` — animations (mirror existing `save-glow`/`vx-search-hit` style)

Add keyframes + classes (lime-forward, colour via `--glow` CSS var so coloured nodes
glow in their colour):
- `.vx-node-glow { box-shadow: 0 0 0 1px var(--glow), 0 0 12px -2px var(--glow); }`
- `@keyframes vx-shudder` (±2–3px translateX wobble, ~450ms) → `.vx-shudder`.
- `@keyframes vx-pop` (scale .8→1, opacity 0→1, ~300ms) → `.vx-pop`.
- `@keyframes vx-wire-break` (stroke-dashoffset march + opacity→0, ~360ms) →
  `.vx-wire-break` (applied to the cut `<path>`).
- `.vx-group-hot` (lime ring) for the attach affordance.
Keep them theme-agnostic (colour comes from the var / lime literal).

---

## 10. Files touched (summary)

| File | Change |
|---|---|
| `src/lib/world.ts` | palette+`colorHex`+`edgeColor`, `rectFromPoints`/`nodesInRect`, scissor geometry (`segmentsIntersect`/`bezierPoints`/`edgeCutByStroke`/`edgesCutByStroke`), `linkedNodeIds`, `nextImportOrigin`/`layoutImportColumn`, `fitMediaSize`, `NOTE_DEFAULT`/`MEDIA_MAX` |
| `src/lib/world.test.ts` | ~12 new pure tests (§2) |
| `src/lib/worldMedia.ts` (new) | `importDroppedFile(file)` (electron `importMedia` → app URL, web → base64), MIME→kind |
| `src/components/WorldCanvas.tsx` | theming/`isDarkMode`, marquee, flexible edges, hover palette+resize, glow/shudder/pop, scissor tool+anim, group rename, remove Settings, real dock/menu handlers, note/media drop, `onRequestNoteList` prop |
| `src/App.tsx` | pass `isDarkMode`, `showNoteList` toggle + slide, `onRequestNoteList`, render NoteList as rail in world view |
| `src/components/Sidebar.tsx` | filter re-click toggles `showNoteList` (via `handleSetFilter` in App; Sidebar may just call `setFilter` with same value — App detects sameness) |
| `src/hooks/useWorlds.ts` | expose `renameWorld` already returned; add nothing unless group rename needs it (it doesn't — group label is a node patch) |
| `src/index.css` | glow/shudder/pop/wire-break/group-hot keyframes |

`useWorlds.ts` already returns `renameWorld` (unused by App today) — Sidebar world
rename is out of scope here unless trivially added.

---

## 11. Build order (do in this sequence; keep tsc green between steps)

1. `world.ts` pure additions + `world.test.ts` → run `node --import tsx --test
   src/lib/world.test.ts` until green. (Foundation; everything else imports these.)
2. `worldMedia.ts` + `index.css` animations (no behaviour yet).
3. WorldCanvas theming pass (`isDarkMode`, purge purple) + App passes `isDarkMode`.
   Visual-only; verify light & dark in preview.
4. Flexible edges (§3b) + wire colour (§1c/§4).
5. Marquee (§3a) replacing freehand lasso.
6. Hover palette + resize-on-hover + colour overlay + glow (§3c/§3d).
7. Scissor tool + break anim + shudder-on-cut (§5).
8. Group rename + attach/detach affordance + remove Settings (§6/§7).
9. Note-list toggle + slide (App/§8a) and canvas note/media drop + pop + placement
   (§8b/§8c). This is the biggest cross-file step — do last.
10. Full `world.test.ts` + `npm run lint`, then browser-preview verification (§12).

## 12. Verification (browser preview, per Phase-1 gotchas in memory)

Remember the harness quirks (from `valx-world-mode` memory): `document.hasFocus()`
is false → simulate blur with `dispatchEvent(new FocusEvent('focusout',{bubbles:true,
relatedTarget:document.body}))`; prefer `preview_eval` `.click()` over coordinate
`preview_click` for dock/toolbar. Verify:
- Light & dark: no purple anywhere; lime accents; canvas bg flips with app theme.
- Marquee selects overlapping nodes and pops the add-menu on release.
- Drag a card → its wires flex live and stay attached at drop.
- Hover a node → palette + resize handle appear; pick a colour → node tints, its
  wires recolour to match.
- Link-lasso armed → can draw over cards (nodes non-interactive); disarm restores.
- Scissor armed → stroke across a wire plays break anim then removes it; the orphaned
  node shudders and stops glowing; undo restores wire+glow.
- Drag 2+ notes from the (revealed) note list → they spawn in a right-side column,
  pop in, sized reasonably; drop an image file → media node fits.
- Click All Notes/folder again → note list slides away, canvas widens; click →
  slides back.
- Reload → colours, wires, group labels, positions all persist (localStorage).
- Re-run `node --import tsx --test src/lib/*.test.ts` (all green) + `npm run lint`.

## 13. Explicitly OUT of scope (do not do)
- No `main.cjs`/`preload.cjs` edits, no packaging/electron builds.
- No disk read-back of `.canvas` (Phase-1 note: still localStorage-authoritative).
- No mobile-specific canvas gestures; no world `.trash`; no per-world settings panel
  (the gear is being removed, not rebuilt).
