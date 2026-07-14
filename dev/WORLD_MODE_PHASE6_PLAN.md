# World Mode Phase 6 — Consistency & Smoothness — Implementation Plan

Standalone handoff document. Executor needs no prior conversation context. Read
CLAUDE.md first — every architecture rule there applies to every step below.

**Standing constraints (apply to EVERY step):**
- Tests for every new/changed pure function in `src/lib/*` (sibling `*.test.ts`, run with `node --import tsx --test src/lib/*.test.ts`). Typecheck with `npm run lint`.
- **No packaging / electron builds.** Verification is tests + browser preview only.
- UI/UX consistent with the rest of the app: black+lime dark theme (inverted light), no purple, armed-tool lime highlight, `vx-*` animations, `cubic-bezier(0.16,1,0.3,1)` easing, `captionFontSize()` for world-node text.
- All world mutations remain invertible `Command`s through `applyWorldCommand` (src/hooks/useWorlds.ts:506). Pure logic in `src/lib/world.ts`, interaction/render in `WorldCanvas.tsx`.
- Do ALL items. Nothing on this list is optional or re-interpretable as out of scope.

---

## Item 1 (P0, do first): Worlds don't survive app reload — auto-save fix

### Root cause (confirmed by code trace)
`src/hooks/useWorlds.ts:103` — `const wsKey = () => workspaceId(workspaceHandle);`
reads the `workspaceHandle` **prop from the render closure where each consuming
`useCallback` was memoized**:

- `openWorld` (line 340, deps `[]`) → `loadDoc`/`loadView` captured at **first render**, when the handle is still `null` → reads keys prefixed `web:default` forever.
- `onViewChange` (line 255, deps `[]`) → saves views under `web:default` forever.
- `renameWorld` (line 307, deps `[]`) → saves the worlds index under `web:default`.
- Meanwhile `queuePersist`/`createWorld`/`mirrorToDisk` (deps include `workspaceHandle` transitively) always use the **current** key, `el:<path>` in Electron.

Net effect in Electron: doc writes land under `valx-world-doc:el:<path>:<id>`,
but the reload-then-open path (`openWorld` → `loadDoc`) reads
`valx-world-doc:web:default:<id>` → `null` → `emptyDoc()` → world looks wiped.
The worlds *index* loads fine (the effect at line 124 uses a fresh closure), so
worlds still appear in the sidebar — but open empty.

**Why Phase 5 verification missed it:** browser preview never selects a
workspace, so `workspaceHandle` stays `null` everywhere and *all* closures agree
on `web:default`. The bug only manifests when the handle is non-null, i.e. in
Electron or a browser session with a picked folder. It is NOT a disk-mirror
problem — localStorage itself is split-brained.

This is the stale-closure class from CLAUDE.md rule 1, in its fourth incarnation.

### Fix (one change fixes every consumer)
In `useWorlds.ts`, mirror the prop into an inline-updated ref and key off the ref
— identical to `useNotes.ts:77`'s `workspaceRef` precedent:

```ts
const workspaceHandleRef = useRef(workspaceHandle); workspaceHandleRef.current = workspaceHandle;
const wsKey = () => workspaceId(workspaceHandleRef.current);
```

Also update `mirrorToDisk` (line 218) and `deleteWorld` (line 331) to read
`workspaceHandleRef.current` instead of the prop, and drop `workspaceHandle`
from their dep arrays (per CLAUDE.md rule 1: keep dep arrays minimal). The
workspace-change reset effect (line 124) keeps using the prop — it *wants* to
run on change.

### Grep for latent copies of the class (CLAUDE.md discipline)
Search `useWorlds.ts` for every function referencing `wsKey`, `loadDoc`,
`loadView`, `saveWorlds`, `saveDocLocal`, `saveViewLocal` and confirm each now
routes through the ref. Also re-check `WorldCanvas.tsx` window-level handlers
for any prop read that isn't ref-mirrored (the known ones are already fixed).

### Verification
1. New test not possible (hook code), so browser-preview state-diff: in preview, run `localStorage` snapshot → create world, add nodes → snapshot again → confirm doc under `valx-world-doc:web:default:<id>`; then `window.location.reload()` → reopen world → nodes present.
2. Simulate the Electron split-brain in preview: before creating the world, monkey-patch is NOT possible (handle is real state) — instead add a temporary assertion test in `src/lib` is overkill. The decisive check: after the fix, `openWorld`'s `loadDoc` and `queuePersist`'s `saveDocLocal` must produce/consume the SAME key. Verify by instrumenting via console in preview: write a doc, read `Object.keys(localStorage).filter(k => k.startsWith('valx-world-doc'))` — exactly one key per world, before and after reload.
3. State plainly in the report: fixed and verified in browser; Electron runtime confirmation deferred to the user (no builds allowed).

---

## Item 2: Imported notes appear in a cross-like pattern

`buildWorkspaceImport` (src/lib/world.ts) currently lays imports out via
`layoutImportColumn`. Add a pure `layoutImportCross(origin, sizes): Point[]` to
`world.ts`: places items alternating along the four arms of a cross centered on
`origin` (N, E, S, W, N, …), each arm growing outward with a fixed gap (reuse
the column gap constant). Use it in `buildWorkspaceImport` for root-note
placement (and for group placement grid if applicable — groups on arms, their
members inside as today). Tests: `world.test.ts` — 1 item at center-adjacent
arm, 5 items cover all 4 arms + second ring, no overlaps for uniform sizes.

## Item 3: Consistent naming — 'Group', 'Tags', 'Notes', 'Media'

Text cards ARE tags (Phase 5). Rename every user-facing string accordingly:
- `WorldCanvas.tsx` dock: "Add card" → "Add tag" (line 845, 909), title tooltips, toasts.
- Status pill (line 839): `X tags · Y notes · Z media · W groups`.
- Sidebar / any other surfaces: grep `-i "card"` across `src/` and rename user-visible occurrences (variable names may stay).
- Grep `-i "group|tag|note|media"` in UI strings for casing/pluralization consistency: singular in tooltips ("Create group", "Add tag", "Add note", "Add media"), the four names exactly as: Group, Tags, Notes, Media where listed as categories.
Code identifiers (`type: 'text'`, `counts.cards`) stay — display strings only.

## Item 4: Fish-eye always on — no button, more bulge, stronger vignette

- Remove the Aperture toolbar button (`WorldCanvas.tsx:882-888`) and the `fisheyeOn` state (line 102) — fisheye is unconditionally on. Keep `WorldView.fisheye` field in the type for stored-data compat but stop reading/writing it (or ignore on load).
- More center bulge: increase the strength in `fisheyeScale` (src/lib/world.ts) — bump the max scale from ~1.07 to ~1.15 (tune constant; keep quadratic falloff). Update its tests' expected values.
- Vignette (line 630-639): strengthen — dark mode `transparent 55% → rgba(0,0,0,0.35) 100%`, light `rgba(0,0,0,0.12)`. Render unconditionally.

## Item 5: Ctrl+Click detaches a note/media from its group

Problem: notes/media absorbed by a group are hard to pull out (drag re-attaches;
double-click detach exists but user wants explicit modifier).
In `beginNodeDrag` (`WorldCanvas.tsx:352`): if `e.ctrlKey || e.metaKey` and
`node.parentId` and node is not a group → call `detachFromGroup(node)` (line
551) and return (no drag start). Note: ctrl+mousedown on empty canvas still
starts marquee (item 6) — the node handler stops propagation, so no conflict.
Additionally, while dragging a detached-intent node out, the existing
`groupAt`-based re-attach on drop stays as-is.

## Item 6: Toolbar/interaction audit — remove right-click menu, keep & fix Ctrl+Drag select

- **Remove the canvas right-click context menu entirely**: delete `onContextMenuCanvas` usage (line 626, 420-424), the `contextMenu` state + JSX block (lines 902-915). Keep `e.preventDefault()` on contextmenu so the app-level menu doesn't pop over the canvas. The menu's four actions already exist in the bottom dock.
- **Marquee no longer opens a context menu on release** (`onUp` marquee branch, line 296-302): just select; drop the `setContextMenu` call.
- **Ctrl+Drag select must work when starting over a node**: `beginNodeDrag` currently swallows ctrl+drag (except item 5's detach case). Rule: ctrl+mousedown on a node with NO `parentId` → treat as marquee start (forward to the canvas marquee path) rather than node drag. (Ctrl+click on a grouped child = detach per item 5; document this precedence in a comment.)
- **Audit every right-toolbar button in preview** and fix or remove any that don't act: Mirror (replaced in item 13), Rotate (armed tool), Reset view, Fit to content, Undo/Redo. Known suspect: none crash, but verify each visibly works post-changes; remove anything that ends up redundant.

## Item 7: Note nodes — adaptive text + wheel scrolling, no clipping mid-sentence

`WorldCanvas.tsx:784-808` note rendering uses `line-clamp-3`. Replace:
- Body div: remove `line-clamp-3`; make the card `flex flex-col`, body `flex-1 overflow-y-auto` with scrollbar hidden (`[scrollbar-width:none]` + `[&::-webkit-scrollbar]:hidden` Tailwind arbitrary variants) — mousewheel scrolls it.
- Wheel handling: on the body div, `onWheel={(e) => { if (el.scrollHeight > el.clientHeight && !e.ctrlKey) e.stopPropagation(); }}` so scrolling a long note doesn't pan/zoom the canvas; ctrl+wheel still zooms.
- Text still sizes via `captionFontSize()`; do NOT auto-grow the node to full content (explicitly rejected by user).
- Same treatment for text-card (tag) subtext if it can overflow.

## Item 8: Fit-to-content icon rework

Swap `Maximize` (line 890) for a clearer lucide icon: use `Focus` (or `Scan`).
One-line import + usage change.

## Item 9: World fullscreen via F11

- App already has `isFullscreen` state (`App.tsx:34`) that hides Sidebar + NoteList — reuse it (rung 2: existing pattern).
- Add a keydown listener (in `App.tsx`, active only when `appView.type === 'world'`): `F11` → `e.preventDefault(); setIsFullscreen(v => !v)`. Exiting is the same F11 press. Escape should NOT exit (WorldCanvas already uses Escape for tool disarm).
- When entering world fullscreen also hide the WorldCanvas header row? No — keep the header (has back button); only sidebar/notelist collapse, per "only keeps the world, no sidebar".
- Ensure leaving world mode (`handleBackToNotes`) resets `isFullscreen` false.

## Item 10: Space+Drag pan fix

Mechanism of the bug: `onCanvasMouseDown` (line 376) handles space-pan, but
`beginNodeDrag` (line 352) calls `stopPropagation` and starts a node move —
so Space+Drag fails whenever the cursor is over a node, which in a populated
world is most of the time.
Fix: first line of `beginNodeDrag`: `if (spaceHeldRef.current) { beginPan(e.clientX, e.clientY); e.stopPropagation(); return; }`.
Also guard: don't set `spaceHeldRef` when typing (`document.activeElement` is
input/contentEditable) so space in a label edit doesn't arm panning.

## Item 11: Color picker — massive palette + custom picker

`NodeOverlay` popover (`WorldCanvas.tsx:975-982`) currently maps the small
`WORLD_PALETTE`. Replace popover contents with:
- A grid (~8×5) of preset swatches: extend `WORLD_PALETTE` in `world.ts` to ~40 entries (hue sweep × 2-3 lightness rows; include grays; NO purple/violet per theme rule — skip the 260-300° hue band).
- A "custom" swatch that opens a native `<input type="color">` (rung 4 — no picker library). On change, apply the hex.
- `NodeColor` in `world.ts` currently a keyed union — extend to accept arbitrary `#rrggbb` strings: `colorHex()` passes through values starting with `#`. Update `colorHex`/`edgeColor` tests for the pass-through.
- Persisted `.canvas` `x-valx` color field carries the raw value — round-trip test in `world.test.ts` (`toJsonCanvas` with a custom hex).

## Item 12: Markdown links always at the bottom of the note

`appendNoteLink` (src/lib/noteLinks.ts:26) already appends at end, but a link
that ALREADY exists mid-note is left where it is (`hasNoteLink` early-return) —
that's the "random spot". Change `appendNoteLink` to **normalize**: if the link
exists anywhere, `removeNoteLink` it first, then append at the end. Tests in
`noteLinks.test.ts`: mid-content link gets relocated to bottom; already-at-bottom
is a no-op (idempotent — important for Mirror/import idempotence); round-trip
escaped-href variant still matches.

## Item 13: Replace "Mirror workspace" with "Import Valx spaces" dialog

- Pure side: change `buildWorkspaceImport(doc, ws)` (world.ts) to accept a filter: `buildWorkspaceImport(doc, ws, scope: { kind: 'all' } | { kind: 'folders'; folderIds: string[] })`. `folders` scope imports only notes in those folders (+ their bound groups). Tests: folder-scoped import excludes other notes; idempotence preserved.
- UI: replace the MapIcon toolbar button (line 867-873) with one that opens a modal (styled like `SettingsModal` — reuse its container idiom): title "Import Valx spaces", a checkbox list of workspace folders (multi-select) plus an "All notes" option (mutually exclusive with folder selection), Import + Cancel buttons, lime accent.
- `useWorlds.mirrorWorkspace` → `importSpaces(scope)` passing the scope through. Keep one undo step.
- Cross layout from item 2 applies to placement.

## Item 14: Worlds adapt in real time to the connected workspace

The reflection effect (`useWorlds.ts:146-212`) already prunes deleted notes,
dead links/tags, and folder moves on every `notes` change. Extend it:
- **Link-href refactor on note rename**: for each edge with `linkHref`, recompute `linkHrefForNote(currentTitle, ext)` for the destination note; if different (note renamed), (a) stamp the edge's `linkHref` to the new href, (b) rewrite the source note's content: `removeNoteLink(old)` + `appendNoteLink(new)` via `ops.updateNote`. Pure helper `retargetLink(content, oldHref, newTitle, newHref)` in `noteLinks.ts` + tests.
- **Live reverse link creation**: when a note's content gains a markdown link to another note that is ALSO represented in the world and no matching edge exists, add the edge (direct doc replacement + `queuePersist`, no undo entry — same discipline as the rest of this effect). Pure helper in `noteLinks.ts`: `extractNoteLinkHrefs(content): string[]` + tests. Match hrefs to notes via `linkHrefForNote(title, ext)` equality.
- This effect now does more work per notes-change; it already bails on transient empty `notes` — keep that guard, and make each sub-pass no-op cheaply when nothing changed (compare before setState, as today).

## Item 15: World-side deletions reflect in the main workspace

When a `remove` command deletes note-backed nodes, move the underlying notes to
trash (NOT permanent delete — reversible, matches app idiom). Implementation in
`runWorkspaceEffects` (`useWorlds.ts:385`): on `cmd.type === 'remove'`, collect
`noteIdOf` for removed note/media-with-noteId nodes and call a new op
`ops.moveNotesToTrash(ids)` (App already has `moveNotesToTrash` — add it to
`WorldNoteOps` and pass from `App.tsx:26`). Undo (an `add` command) must restore:
on `cmd.type === 'add'`, for any node whose `noteId` refers to a trashed note,
call `ops.restoreFromTrash(id)` (also add to ops). This keeps undo/redo
symmetric through the existing single effects choke point.
Guard: the reflection effect (item 14) prunes nodes for notes that no longer
exist — trashed notes: check how `notes` array flags trash (`isTrash`); the
prune at line 153 checks `liveIds` from the full notes list, so a trashed note's
node… decide: a world node whose note was trashed FROM THE WORLD was just
removed anyway; a note trashed from the workspace side should drop its world
node (extend prune to exclude `isTrash` notes). Verify undo path re-adds node
first, restores note second, and the prune doesn't race it (prune runs on the
next `notes` change, when the note is restored → node survives).

## Item 16: Rotation-aware hit testing (now in scope by explicit request)

The axis-aligned approximation is rescinded. In `world.ts`:
- Add `rotatePoint(pt, center, deg)` and make hit tests respect a node's `rotation`: `nodeAt`/`groupAt`-style point tests transform the point into the node's local frame (inverse-rotate about node center) then do the axis-aligned check.
- `nodesInRect` (marquee): test the node's 4 rotated corners — inside if all 4 corners are within the rect (keep current containment semantics).
- `edgesCutByStroke` and edge anchors: edges anchor to the UNrotated rect today (`liveRectFor` excludes rotation) — keep edge geometry axis-aligned (edges visually connect to the unrotated frame; changing that is a rabbit hole). Only point-in-node and marquee become rotation-aware.
- Canvas-level rotation is already handled by `screenToCanvas` (WorldCanvas.tsx:157) — node rotation is the missing half.
- Tests: point inside a 45°-rotated node's corner region that the AABB would miss/hit wrongly; marquee over rotated node corners.

---

## Build order

1. **Item 1** (P0 persistence fix) — everything else is worthless if worlds vanish.
2. Item 16 (world.ts hit-testing) + Item 2 (cross layout) + Item 12 (noteLinks normalize) — pure-lib groundwork, all tested.
3. Item 11 palette (world.ts NodeColor widening) — pure part, then UI.
4. Items 5, 6, 10 (interaction: detach, marquee/menu removal, space-pan) — one `WorldCanvas.tsx` pass, they touch the same handlers.
5. Items 4, 7, 8 (fisheye/vignette, note scroll, icon) — render-only pass.
6. Item 3 (naming sweep) — after UI churn settles so strings aren't renamed twice.
7. Item 13 (Import Valx spaces) — builds on items 2 + 12.
8. Items 14, 15 (live reflection, deletions, reverse links) — builds on item 12's helpers.
9. Item 9 (F11 fullscreen) — isolated, anytime.
10. Full verification pass (below).

## Verification checklist (browser preview, state-diffs not screenshots)

- [ ] `npm run lint` clean; `node --import tsx --test src/lib/*.test.ts` all green (expect new tests for: cross layout, fisheye constant, palette pass-through + canvas round-trip, appendNoteLink normalize, retargetLink, extractNoteLinkHrefs, scoped import, rotated hit tests).
- [ ] Persistence: create world → add nodes → snapshot `localStorage` keys → `location.reload()` → reopen → doc intact; exactly one `valx-world-doc:*` key per world.
- [ ] World round-trip rule (CLAUDE.md): build state → notes view → edit a note → back → nodes/labels/media/undo/redo intact.
- [ ] Ctrl+click grouped note → detaches; ctrl+drag on empty canvas AND starting over an ungrouped node → marquee; right-click → no canvas menu.
- [ ] Space+drag over a node → pans, node doesn't move.
- [ ] Long note card: wheel scrolls its text, canvas doesn't pan; no mid-sentence clip at rest.
- [ ] Fisheye: no toggle button; center nodes visibly larger (~1.15); vignette present both themes.
- [ ] Import Valx spaces: folder-scoped import brings only that folder; "All notes" ≙ old mirror; re-import is a no-op (idempotent); layout is a cross.
- [ ] Rename a note in workspace → world edge survives, source note's link href/text updated, link sits at note bottom.
- [ ] Type a link to a represented note inside another represented note → edge appears without touching the world.
- [ ] Delete a note node in world → note lands in workspace trash; undo → node back AND note restored.
- [ ] Rotate a node 45° → click its true corner selects it; marquee honors rotated bounds.
- [ ] F11 in world mode → sidebar+notelist gone; F11 again restores; back-to-notes resets.
- [ ] Naming: UI shows Group / Tags / Notes / Media consistently (grep for stray "card").
- [ ] Report distinguishes per item: fixed-and-verified vs fixed-but-unverified (Electron-only aspects of item 1) vs not-a-bug.

## Explicitly out of scope (everything else stays out unless the user asks)

- Packaging / electron builds; `main.cjs` / `preload.cjs` edits.
- `.canvas` disk read-back (localStorage remains authoritative).
- Rotation-aware EDGE anchoring (edges keep axis-aligned anchors; only hit-testing/marquee become rotation-aware).
- Auto-growing note cards to full content size (rejected by user — scroll instead).
- Any purple/violet in the palette.
