# World Mode — Phase 3 Plan (persistence fixes, group membership, media, rotate, content-fit)

Handoff plan for Sonnet. Builds on the Phase-1/2 code already in the repo. **Standing
constraints (verbatim): "keep the UI / UX consistent across the app", "do tests but no
builds".** No `main.cjs`/`preload.cjs` edits, no packaging/electron builds. Allowed:
`node --import tsx --test src/lib/*.test.ts`, `npm run lint` (`tsc --noEmit`), and
browser-preview verification.

This phase is **bug-fix-heavy** — several items are root-caused below with code
evidence. Read the root cause before touching each one; don't re-derive.

---

## 0. The user's list → what each one actually is

| # | Ask | Kind | Root cause (see section) |
|---|-----|------|--------------------------|
| 1 | Clear way to attach/detach notes & media into groups | Feature | §3 explicit `parentId` membership |
| 2 | "Create group works 1 time only" | **Bug** | §1a off-screen spawn placement |
| 3 | Group rename title should be large | Style | §5 caption sizing |
| 4 | Notes/groups fit the window frame; content scales when resized | Feature | §4 content-fit / caption scaling |
| 5 | Video & audio imports don't play, show filename only | **Bug** | §2a media render only handles `image` |
| 6 | Some dock icons don't work (esp. media = drag-drop only) | **Bug** | §2b dock click placement + §1a |
| 7 | All window titles/captions large font | Style | §5 |
| 8 | Note-list slide-toggle is too rigid | **Bug** | §6 double-animated width+translate |
| 9 | Rotate tool (cursor→hand, rotate screen or note, save position) | Feature | §7 |
| 10 | Right-click / marquee menu should build the window in the selected area | Feature | §8 rect-aware spawns |
| 11 | Auto-save all changes immediately | Fix | §1 persistence |
| 12 | Clicking off the world "resets everything" (CRITICAL) | **Bug** | §1b shared-fs race + close nuking state |

---

## 1. CRITICAL — persistence & the "reset everything" bug (§11, §12, part of §2)

### 1b. Root cause of the reset
`useWorlds` calls its **own** `useFileSystem()` (`src/hooks/useWorlds.ts:29`). That
instance restores the workspace handle **asynchronously and independently** from the
`useNotes` instance App actually uses. Consequences:

1. `wsKey()` (`useWorlds.ts:43`) — which keys **every** localStorage read/write
   (`valx-worlds:${wsKey}`, `valx-world-doc:${wsKey}:${id}`) — is derived from that
   private handle. If a world is saved while the handle is `X` but read back while the
   handle is still `null` (async not settled) or vice-versa, **`loadDoc(id)` returns
   null → `openWorld` falls back to `emptyDoc()` → the world looks wiped.**
2. The `[workspaceHandle]` effect (`useWorlds.ts:54-61`) resets `activeWorldId`,
   `activeDoc`, undo, redo to empty **every time that private handle settles** — which
   in the real Electron app happens ~once shortly after mount, and can land right after
   the user has opened a world.
3. `closeWorld()` (`useWorlds.ts:180-186`) deliberately nulls `activeDoc`/undo/redo, and
   `handleSetFilter` calls it whenever the user clicks a folder/All-Notes from world
   mode (`App.tsx:102`). The doc is in localStorage, but combined with (1) the reload
   can miss.

### 1a. Root cause of "create group / cards work once" and media-dock
`handleDockClick` places dock spawns via `nextImportOrigin(doc)` = `bounds.maxX + 80`
(`WorldCanvas.tsx` dock handler + `world.ts`). Each new node extends the bounds, so the
next dock spawn lands **progressively further right, off-screen** — it works every time,
you just can't see it after the first. Same for cards and media.

### The fix (do all of this)

**F1 — one workspace source of truth.** Change the signature to
`useWorlds(notes: Note[], workspaceHandle: any, notesReady: boolean)` and delete the
internal `useFileSystem()` **for handle/keying**. Keep calling `useFileSystem()` only to
grab the pure `saveFile`/`deleteFile` functions (they take the handle as their first
arg — pass the **App-provided** `workspaceHandle`, never a private one). App already
destructures `workspaceHandle` from `useNotes` (`App.tsx:20`); pass it plus a readiness
flag:
```tsx
// App.tsx — expose isWorkspaceRestored from useNotes (add to its return) or derive.
const { …, workspaceHandle, isWorkspaceRestored } = useNotes();
const { … } = useWorlds(notes, workspaceHandle, isWorkspaceRestored);
```
`useNotes` already holds `isWorkspaceRestored` via its own `useFileSystem`; re-export it
from `useNotes`'s return object (one-line change). Now `wsKey()` uses the same handle for
save and load — the race is gone.

**F2 — don't destroy world state on navigation.** Keep the active world **resident** in
`useWorlds` across note-list navigation. Split the two concerns:
- `closeWorld()` should **flush persist only** and NOT null `activeDoc`/`activeWorldId`/
  undo/redo. Rename it `suspendWorld()` (or keep the name) but drop the four `setState`
  resets. The world stays loaded; App's `appView` switch decides what's rendered.
- Truly reset (null everything) only in: `deleteWorld` (already does), and the
  `[workspaceHandle]` effect — but that effect must **only** fire on a *real* workspace
  change, not the initial null→handle settle. Guard it: skip the reset on the first run
  and when `!notesReady`:
  ```ts
  const prevWsRef = useRef<any>(undefined);
  useEffect(() => {
    if (prevWsRef.current === undefined) { prevWsRef.current = workspaceHandle; setWorlds(loadWorlds()); return; }
    if (prevWsRef.current === workspaceHandle) return;
    prevWsRef.current = workspaceHandle;
    setWorlds(loadWorlds()); setActiveWorldId(null); setActiveDoc(null); setUndoStack([]); setRedoStack([]);
  }, [workspaceHandle]);
  ```
- `openWorld(id)` should **no-op if `id === activeWorldIdRef.current`** (already
  resident) so re-opening the same world from the sidebar doesn't reload-and-reset it.
  Undo/redo therefore survive navigation (satisfies "undo and redo should work
  perfectly").

**F3 — persist the prune, and don't prune on transient-empty.** The `[notes]` prune
effect (`useWorlds.ts:64-70`) calls `setActiveDoc` without persisting, and nukes all
note-nodes if `notes` is briefly `[]` during a workspace scan. Fix:
```ts
useEffect(() => {
  if (!activeDocRef.current || !notesReady || notes.length === 0) return; // never prune on unloaded/empty
  const liveIds = new Set(notes.map((n) => n.id));
  const pruned = activeDocRef.current.nodes.filter((n) => n.type !== 'note' || liveIds.has(n.noteId));
  if (pruned.length !== activeDocRef.current.nodes.length && activeWorldIdRef.current) {
    const next = { ...activeDocRef.current, nodes: pruned };
    activeDocRef.current = next; setActiveDoc(next);
    queuePersist(activeWorldIdRef.current, next);   // <-- was missing
  }
}, [notes, notesReady]);
```

**F4 — persist the per-world view (pan/zoom/rotation).** Today pan/zoom live in
WorldCanvas local state and vanish when it unmounts (part of the "resets" feeling).
Store a per-world view blob in localStorage `valx-world-view:${wsKey}:${id}` =
`{pan, zoom, rotation}`, debounced-written from WorldCanvas via a new
`onViewChange(view)` prop, and hydrated when the world opens (pass `initialView` into
WorldCanvas keyed by `activeWorldId` so it re-inits on world switch). This makes rotate
(§7) and scroll position "save in that position" per the ask.

**F5 — auto-save is already immediate to localStorage** (`saveDocLocal` runs
synchronously inside `queuePersist`); the disk `.canvas` mirror stays debounced. After
F1–F4, confirm every mutation path (command/undo/redo/prune/view) calls its persist.
Nothing else needed for §11 — but add the belt-and-suspenders `flushPersist()` on
`handleBackToNotes`/`handleSetFilter` too (App already calls `closeWorld` which flushes).

---

## 2. Media (§5 video/audio, §6 dock)

### 2a. Render real media elements
`WorldCanvas.tsx` media branch currently renders `n.kind === 'image' ? <img> : (n.name||n.kind)`.
Replace with a `MediaContent` that handles every kind, filling the node frame:
```tsx
function MediaContent({ n }: { n: MediaNode }) {
  if (n.kind === 'image') return <img src={n.src} alt={n.name||''} className="w-full h-full object-cover pointer-events-none" />;
  if (n.kind === 'video') return <video src={n.src} controls preload="metadata" className="w-full h-full object-cover"
    onMouseDown={(e)=>e.stopPropagation()} />;
  if (n.kind === 'audio') return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-2">
      <span className="text-xs truncate w-full text-center">{n.name||'Audio'}</span>
      <audio src={n.src} controls className="w-full" onMouseDown={(e)=>e.stopPropagation()} />
    </div>);
  // file / pdf → chip
  return <div className="w-full h-full flex items-center justify-center gap-2 text-xs"><FileIcon/> {n.name||'File'}</div>;
}
```
Key points: `onMouseDown stopPropagation` on `<video>/<audio>` so clicking the transport
controls doesn't start a node-drag; `controls` so they actually play. Give video/audio a
sensible default node size (see §2b) so the controls are usable.

### 2b. Dock media click + placement
- `triggerMediaPicker` already opens the hidden `<input type=file>`; the reason it
  "only works on drag-drop" is (i) images imported at `viewportCenter()` are fine but
  tiny test files looked invisible, and (ii) the §1a off-screen bug affects the media
  origin too when it falls back to `nextImportOrigin`. Fix by placing **all dock
  spawns at the viewport center** (visible), not `nextImportOrigin`:
  - `handleDockClick`: `text → spawnTextCard(viewportCenter(),'center')`,
    `group → spawnGroup(viewportCenter(),'center')`, `media → triggerMediaPicker(viewportCenter())`.
    Keep multi-import stacking (`layoutImportColumn`) starting **from the viewport
    center** so a 5-file drop still fans downward but on-screen.
- Enforce a **minimum media size** so audio/video controls are usable and images aren't
  1px: `fitMediaSize` should clamp to a floor too — add `MEDIA_MIN = 160` and return at
  least that on the longer side (audio gets a fixed `{width: 260, height: 90}` since it
  has no natural pixel size; video without known dimensions gets `{width: 320, height: 200}`).
- Verify the dock "Add card"/"Create group"/"Add media" all spawn something visible on
  the **second and third** click (regression guard for §2/§6).

---

## 3. Attach / detach notes & media into groups (§1) — explicit membership

Phase 2 membership was purely geometric (`nodesInGroup`), which is fragile (a node
sticking one pixel out "leaves" the group). Make it **explicit and visible**.

**Data:** add optional `parentId?: string` to `WorldNodeBase` in `world.ts` (serialized
under `x-valx.parentId` in `toJsonCanvas`/`fromJsonCanvas` — round-trip test required).

**Attach (clear + automatic):** while dragging a single non-group node, if it is
released with its center inside a group's bounds → set `parentId` to that group
(`buildPatchNode(doc, id, {parentId: groupId})`). Keep the existing `vx-group-hot`
highlight during the hover so it's visible *before* release. Combine the move + parent
patch into the drop so it's one undo step (a small `{type:'add'|'remove'|...}` isn't
enough — issue the move command, then a patch; or add a compound builder
`buildAttachToGroup(doc, id, groupId, dx, dy)` returning a single `patch` that sets
`{x,y,parentId}` — simplest, one undo).

**Detach (clear + manual):** a child node shows a small **eject/unlink button**
(lucide `Unlink` — verify export) in its hover overlay (next to the palette button).
Clicking it clears `parentId` (`buildPatchNode(doc,id,{parentId: undefined})` — relies
on `mergeDropUndefined`, already handles undefined-deletes) and nudges the node
`+24,+24` so it visibly pops out. Dragging a child fully out of the group bounds also
auto-detaches on drop (inverse of attach).

**Group drag moves children by `parentId`, not geometry:** in `beginNodeDrag`, replace
`const extra = node.type === 'group' ? nodesInGroup(doc, node.id)…` with
`childrenOf(doc, node.id)` (new pure helper: nodes whose `parentId === groupId`). Now a
child that overhangs the group still travels with it, and links stay attached (edges are
id-referenced, untouched).

**Pure helpers to add + test in `world.ts`/`world.test.ts`:**
- `childrenOf(doc, groupId): WorldNode[]` (by parentId).
- `groupAt(doc, centerPt, excludeId): GroupNode | null` (topmost group whose bounds
  contain the point; for attach-on-drop detection).
- `buildAttachToGroup` / detach via existing `buildPatchNode`.
- JSON Canvas round-trip preserves `parentId`.

---

## 4. Content fits the frame & scales on resize (§4)

Nodes must never overflow their frame, and their content should scale with node size.

- Every node root already has fixed `width/height` from `nodeStyle`. Add
  `overflow-hidden` to **all** node roots (text/note/media/group) so nothing spills.
- **Scale text with the node.** Use a pure `captionFontSize(width, height)` helper in
  `world.ts` (testable) mapping node size → px, e.g.
  `clamp(Math.round(Math.min(width/12, height/6)), 11, 28)` for titles and a smaller
  ramp for body/preview. Apply as inline `style={{ fontSize }}` on the caption/title and
  a proportional one on body text. This makes a big note's title big and a small card's
  text shrink to fit — "content scales up dynamically when resized" (nodeStyle already
  reflects live `resizeDelta`, so the font tracks the drag in real time).
- Note-node body: keep `line-clamp` but base the clamp/ő font on the helper so it fills
  without overflowing. Group label: same helper (this also satisfies §3-rename-large and
  §7-caption-large — one code path).
- Media nodes: `object-cover` (images/video) already fills; ensure the wrapper is
  `w-full h-full overflow-hidden`.

---

## 5. Large captions everywhere (§3, §7)

Driven by §4's `captionFontSize`, but explicitly:
- **Card text** (first contentEditable): title ramp (min ~15px, up to ~28px).
- **Note title**: title ramp; preview stays a smaller ramp.
- **Group label** (view + edit): title ramp, and `font-bold`. The editable label must
  use the **same large font** as the static one (today it's `text-xs`), so renaming
  doesn't visually shrink — set the fontSize inline on both the display and the
  `contentEditable`, and widen the label's hit area.
- **Media name**: small ramp (it's a caption, not a title).

---

## 6. Note-list slide is "too rigid" (§8)

Current App markup double-animates: an outer wrapper animates `width` (`md:w-80`↔`md:w-0`)
**and** the inner `NoteList` animates `translate-x`. The width reflow of the flex
sibling (editor/canvas) fights the translate, giving a stuttery/rigid feel.

**Fix — single, smooth transform-driven collapse.** Drop the inner translate; animate the
wrapper only, and animate a GPU-friendly property set. Recommended recipe:
```tsx
<div className={`shrink-0 overflow-hidden ease-in-out
  transition-[width,opacity] duration-300 ${showNoteList ? 'md:w-80 opacity-100' : 'md:w-0 opacity-0'}`}>
  <div className="w-full md:w-80 h-full">{/* NoteList, fixed 320 so it doesn't squish */}</div>
</div>
```
- Inner keeps a fixed `md:w-80` so its contents never reflow/squish while the wrapper
  width animates — it just slides under `overflow-hidden`.
- Add `opacity` to the transition so it fades as it collapses (reads far less "rigid").
- Use `ease-in-out` (or a cubic-bezier matching the app's `slide-in`
  `cubic-bezier(0.16,1,0.3,1)`) for consistency with existing animations.
- Remove the `md:transition-transform`/`md:-translate-x-full` classes from the inner
  `NoteList` className in App.
- Verify the editor/canvas sibling reflows smoothly (it's `flex-1`, so it grows as the
  wrapper shrinks — that's inherent; the fixed-width inner + opacity fade masks it).

---

## 7. Rotate tool (§9)

New **right-toolbar** button (lucide `RotateCw` or `Compass` — verify export), armed like
Link-Lasso/Scissor and **mutually exclusive** with them. When armed, canvas cursor →
`grab`/`grabbing`.

**Behaviour (matches "rotate the screen or note and save it in that position"):**
- **A node is selected** → dragging rotates *that node* around its center. Compute angle
  from the vector (nodeCenter → pointer) delta between mousedown and move; commit on
  mouseup as `buildPatchNode(doc, id, {rotation: deg})` (undoable). Node renders with an
  extra `rotate(${n.rotation||0}deg)` appended to its transform (nodes sit inside the
  scaled layer, so a per-node CSS rotate composes cleanly; add it in `nodeStyle`).
- **Nothing selected** → dragging rotates the *whole canvas*: a `rotation` field in the
  per-world view state (§F4), applied to the transformed layer as
  `translate(pan) scale(zoom) rotate(rotation)` about the viewport center
  (`transform-origin` set to the container center). Persisted via `onViewChange`.
- Interaction: add `{ kind:'rotate'; id: string|null; cx:number; cy:number; startAngle:number; startRotation:number }`
  to the `Interaction` union; the window mousemove handler updates a live rotation preview
  (same live-state pattern as `dragOffset`/`resizeDelta`), mouseup commits.

**Data:** add `rotation?: number` (degrees) to `WorldNodeBase`, serialized under
`x-valx.rotation` (round-trip test). Default/omitted = 0.

**Scope caveat (document in code + memory):** geometry helpers (`hitTestNode`,
`nodesInRect`, `edgesCutByStroke`, `groupAt`) stay **axis-aligned** — they ignore
per-node rotation. That's acceptable for Phase 3 (rotation is a visual/positional flourish);
selecting/cutting a heavily-rotated node uses its unrotated bounding box. Note it; don't
try to make all geometry rotation-aware this phase.

**Pure helper + test:** `angleBetween(center, a, b): number` (degrees) in `world.ts`.

---

## 8. Right-click / marquee menu builds in the selected area (§10)

Today the context menu carries only `canvasPt` (a point); spawns use default sizes at
that point. Make spawns **fill the marquee rect** when one exists.

- Extend `contextMenu` state to `{ screenX, screenY, canvasPt, rect?: Rect }`. On the
  marquee mouseup, set `rect: rectFromPoints(start, current)` (only if it has real area —
  say `width>8 && height>8`; a plain right-click leaves `rect` undefined).
- Spawn functions take an optional target rect:
  - `spawnTextCard(rect ?? pointDefault)` → card positioned/sized to the rect.
  - `spawnGroup(rect ?? default)` → group fills the rect.
  - `Add media` → `triggerMediaPicker(rect)` then the imported node is sized to the rect
    (respect min size; if the image's aspect differs, `object-cover` inside the rect).
  - `Add note` → still reveals the note list for drag-in, but if a rect exists, remember
    it (`pendingDropRectRef`) so the **next** note dropped lands sized to that rect. (If
    that's too much, at minimum size dropped notes to `NOTE_DEFAULT` at the rect's
    top-left — keep it simple, note the limitation.)
- Add a pure `sizeNodeToRect(rect, min)` helper (clamps to min size, returns `{x,y,width,height}`)
  — testable.

---

## 9. Files touched

| File | Change |
|---|---|
| `src/lib/world.ts` | `parentId`/`rotation` on `WorldNodeBase` + JSON-Canvas round-trip; `childrenOf`, `groupAt`, `captionFontSize`, `sizeNodeToRect`, `angleBetween`, `MEDIA_MIN`; `fitMediaSize` min-clamp |
| `src/lib/world.test.ts` | round-trip parentId+rotation; childrenOf; groupAt; captionFontSize ramp+clamp; sizeNodeToRect; angleBetween; fitMediaSize min |
| `src/hooks/useWorlds.ts` | **F1** take `(notes, workspaceHandle, notesReady)`, drop private-handle keying; **F2** stop nuking state on close, guard workspace effect, no-op re-open; **F3** prune persists + guarded; **F4** per-world view persist (`onViewChange`/`initialView` plumbing); expose `renameWorld` (already) |
| `src/hooks/useNotes.ts` | re-export `isWorkspaceRestored` from its return object |
| `src/components/WorldCanvas.tsx` | media `MediaContent` (video/audio/file); dock spawns at viewport center; rotate tool + interaction; rect-aware context menu + spawns; content-fit font scaling + `overflow-hidden`; group attach/detach (parentId, eject button, childrenOf drag); large captions; `initialView`/`onViewChange` props |
| `src/App.tsx` | pass `workspaceHandle`+`isWorkspaceRestored` to `useWorlds`; wire per-world view persist; §6 note-list slide markup |
| `src/index.css` | rotate cursor helpers if needed; keep existing `vx-*` anims |

---

## 10. Build order (keep tsc green between steps)

1. `world.ts` additions + tests → green (`node --import tsx --test src/lib/world.test.ts`).
2. **§1 persistence refactor** (useWorlds signature, useNotes re-export, App wiring) —
   this is the critical fix; verify a world survives note-list navigation **and** a
   reload before moving on.
3. §2 media render + dock placement.
4. §4/§5 content-fit + large captions.
5. §3 group attach/detach (parentId).
6. §8 rect-aware spawns.
7. §7 rotate tool (biggest new interaction — do after the rest is stable).
8. §6 note-list slide polish.
9. Full test + `npm run lint` + preview verification (§11).

## 11. Verification (browser preview; Phase-1/2 harness gotchas apply)

From memory: `preview_screenshot` may be unusable — use `preview_snapshot` +
`preview_eval` (query computed styles / `localStorage` / doc JSON). `document.hasFocus()`
is false → commit contentEditable with a synthetic
`dispatchEvent(new FocusEvent('focusout',{bubbles:true,relatedTarget:document.body}))`.
Disable CSS transitions (`*{transition:none!important}` + force reflow) before reading
layout widths. Split "trigger" and "read result" into separate `preview_eval` calls
(React flush). Recover a collapsed `window.innerWidth:0` viewport with `preview_resize`.
Verify:
- **CRITICAL**: build a scene, click a folder/All-Notes (leave world), edit a note,
  reopen the world → **everything still there**, undo/redo history intact; then full
  reload → still there. (This is §12, the headline fix.)
- Dock "Create group" / "Add card" clicked 3× → 3 visible nodes near viewport center.
- Dock "Add media" click opens the file dialog and spawns a visible, min-sized node;
  drop a video and an audio file → both render playable `<video>/<audio>` controls that
  play without starting a node-drag.
- Resize a note/card → title + body font scale with it; nothing overflows the frame.
- Drag a note onto a group → group highlights, drops as a child; drag the group → child
  follows even if overhanging; click the child's eject button → it detaches and pops out;
  the wire between it and another node stays connected throughout.
- Group rename → large bold label, same size in edit and display.
- Note-list toggle (click active filter twice) → smooth fade+slide, not a jerky snap.
- Rotate tool: select a node, drag → it rotates; deselect, drag → whole canvas rotates;
  reload → rotations restored from the per-world view + node data.
- Marquee a region, pick "Add card" from the auto-menu → the card fills the marquee rect.
- `node --import tsx --test src/lib/*.test.ts` all green + `npm run lint` clean.

## 12. Out of scope
- No `main.cjs`/`preload.cjs` edits, no builds. Media import continues to use the
  existing `importMedia` IPC (desktop) / base64 (web).
- Rotation-aware geometry (hit-test/marquee/scissor on rotated nodes) — axis-aligned
  approximation only this phase (§7 caveat).
- No `.canvas` disk read-back (still localStorage-authoritative).
