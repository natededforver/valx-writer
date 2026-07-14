# World Mode — Phase 5 Plan: Mirror Workspace, Fish-eye, Cards-as-Tags

Handoff-ready. Execute top to bottom. Standing constraints for every step:
**tests but no builds** (`npm run lint` + `node --import tsx --test src/lib/*.test.ts` + browser preview only — never packaging/electron builds), **no `main.cjs`/`preload.cjs` edits**, **keep UI/UX consistent** (black+lime, no purple, existing `vx-*` idioms, armed-tool button styling, reuse existing helpers instead of inventing new ones).

## Scope decision (read first)

The user's Phase 5 message pasted the Phase 4 out-of-scope list plus two new features. Scope resolution:

**IN scope (build these three):**
1. **Mirror Workspace** — one-click bootstrap that populates the current world from the whole directory (the item whose own text says "is Phase 5").
2. **Fish-eye effect** — the canvas is not fully flat; nodes near the viewport focus render subtly larger, selling the "world" feel.
3. **Cards = tags** — a text card is a `#label`; wiring a card to a note-backed node appends that `#tag` to the note's file, cutting the wire removes it, renaming the card renames the tag everywhere it's wired.

**STILL out of scope (the other pasted bullets are restated design constraints, phrased as permanent negatives — do not build):** world-side deletions deleting folders/notes (data safety), link-href refactoring on note rename, live reverse link creation (typing a markdown link in a note does not create a wire — only the one-shot Mirror scan below reads existing links), rotation-aware hit-testing, `.canvas` disk read-back, packaging/builds, `main.cjs`/`preload.cjs`. If the user actually wanted any of these built, they must say so explicitly — note this in the final report.

## Current-state citations (post-Phase-4 code; anchor by symbol, lines have shifted)

- `src/lib/world.ts` — `WorldEdge` now carries `linkHref?` (Phase 4); `noteIdOf(node)` returns the backing note id for note nodes and wrapped media. `toJsonCanvas`/`fromJsonCanvas` round-trip `folderId`/media `noteId`/`linkHref`. `nextImportOrigin`/`layoutImportColumn`/`NOTE_DEFAULT`/`newId` are the placement primitives to reuse. `nodeStyle`-relevant rendering constants live in `WorldCanvas.tsx`.
- `src/hooks/useWorlds.ts` — `enrichAddEdges(docBefore, cmd, notes, ops)` (module-level, above the hook) resolves `linkHref` on 'add' edges when both endpoints are note-backed; **extend it** for `tagRef`. `runWorkspaceEffects(docBefore, cmd)` (inside the hook, above `applyWorldCommand`) handles add/remove-edge link append/removal and `patch` folder binding; **extend it** for tags. `stampNodeField(nodeId, patch)` stamps a non-undoable field directly onto the doc — clone this pattern for edges. The workspace→world watcher effect (keyed `[notes, notesReady]`, guarded by `notes.length === 0`) does dangling-edge prune → link reflection → folder reflection; **extend it** with tag reflection. `WorldNoteOps` provides `updateNote`, `moveNotesToFolder`, `addFolder`, `folders`, `noteExtensions`.
- `src/lib/noteLinks.ts` — `linkHrefForNote`/`hasNoteLink`/`appendNoteLink`/`removeNoteLink` with the `hrefPattern` entity-escape trick. The tag helpers mirror this file's shape.
- `src/lib/format.ts` — `extractFirstMedia(content)` returns the first `<img|audio|video>` or `vx-attach` chip `{kind, src, name}`; use it to decide media-node vs note-card during Mirror.
- `src/hooks/useNotes.ts` — `parseTags(title, content)` strips tags first (`content.replace(/<[^>]*>?/gm, ' ')`) then matches `(^|\s)#[\w-]+` and **lowercases**. So `<p>#my-tag</p>` in content is parsed as tag `my-tag` — appended tags surface in the sidebar TAGS section with zero useNotes changes.
- `src/components/WorldCanvas.tsx` — right toolbar block (Rotate / Reset view / Fit / Undo / Redo buttons using `ToolbarButton`, armed styling `bg-[#32CD32]/20 text-[#32CD32]`); `nodeStyle(n)` composes `rotate(...)` transform; text-card render branch (`n.type === 'text'`) shows `n.text` in a contentEditable div; `onViewChange({pan, zoom, rotation})` effect fires on camera change; `initialView` prop seeds pan/zoom/rotation. `WorldView` type in `world.ts` = `{ pan, zoom, rotation }`.
- `src/App.tsx` — `useWorlds(notes, workspaceHandle, isWorkspaceRestored, ops)` call site; `WorldCanvas` prop block (Phase 4 added `onCreateMediaNote` here).

## Build order

### Step 1 — `src/lib/world.ts`: model + fisheye + mirror builder (+ tests)

**1a. Model fields.**
- `WorldEdge` gains `tagRef?: string` — the `#tag` (with leading `#`, lowercase) a card-to-note wire applied. Serialize on the edge object in `toJsonCanvas`/`fromJsonCanvas` exactly like `linkHref`.
- `WorldView` gains `fisheye?: boolean`; `defaultView()` returns `fisheye: true`. (Old persisted views lack the key — treat `undefined` as `true` at the read site.)

**1b. Fish-eye ramp** — pure, visual-only (hit-testing/marquee/scissor/edge anchors deliberately ignore it, same accepted-approximation doctrine as rotation):
```ts
/** Visual-only fisheye: nodes near the focus render up to `strength` larger, tapering to 1 at `radius`. */
export function fisheyeScale(nodeCenter: Point, focus: Point, radius: number, strength = 0.07): number {
  if (radius <= 0) return 1;
  const d = Math.hypot(nodeCenter.x - focus.x, nodeCenter.y - focus.y);
  const t = Math.min(1, d / radius);
  return 1 + strength * (1 - t) * (1 - t); // quadratic falloff — bulge concentrates at the focus
}
```

**1c. Mirror Workspace builder** — pure, returns one Command (one undo step):
```ts
import { extractFirstMedia } from './format';

export interface WorkspaceSnapshot {
  notes: { id: string; title: string; content: string; folderId?: string | null }[]; // pre-filtered: no trash
  folders: { id: string; name: string }[];
  noteExtensions: Record<string, string>; // ext includes leading dot
}

/** One-click "mirror workspace": a bound group per folder that has notes, a node per note
 *  not already in the doc (media node when the note is media-wrapped, note card otherwise),
 *  and edges for markdown links that already exist between imported/present notes.
 *  Returns null when nothing new to add. */
export function buildWorkspaceImport(doc: WorldDoc, ws: WorkspaceSnapshot): Command | null
```
Implementation contract:
- **Skip existing**: collect `noteIdOf(n)` over `doc.nodes`; any note whose id is already represented is skipped (button is idempotent).
- **Groups**: only for folders that will receive ≥1 new node. Reuse an existing bound group (`group.folderId === folder.id`) instead of creating a second one. New groups get `folderId` preset and `label = folder.name`.
- **Nodes**: media-wrapped note (`extractFirstMedia(content)` non-null AND `content.replace(/<[^>]*>?/gm,' ').trim() === ''`) → `MediaNode` with `noteId`, `src`/`kind`/`name` from the extraction, `MEDIA_FALLBACK` size; otherwise `NoteNode` with `NOTE_DEFAULT` size. Nodes destined for a group get `parentId` preset **at build time** (so the Phase-4 folder-reflection watcher finds membership already consistent and does nothing).
- **Layout**: deterministic, no randomness. Origin = `nextImportOrigin(doc)`. Groups stack vertically (gap 48), each sized to fit its children in columns of 3 (`24px` padding, `48px` label headroom, children placed on a grid inside). Root notes stack in a column to the right of the groups column (reuse `layoutImportColumn`).
- **Edges**: for each ordered pair (from, to) of notes that will be present in the doc after import (new + already-present note-backed nodes), if `hasNoteLink(from.content, linkHrefForNote(to.title, ws.noteExtensions[to.id] ?? '.md'))` → edge with that `linkHref` preset, skipping pairs that already have an edge (reuse the `pairKey` dedup). O(n²) over notes — fine at workspace scale; do NOT add caps silently.
- Preset `linkHref` means the post-apply `runWorkspaceEffects` 'add' branch will call `appendNoteLink` — which is **idempotent** (`hasNoteLink` no-op) because the link is already in the note. State this in a comment; it is the reason Mirror needs no effects bypass.

**1d. Tests (`world.test.ts`)**: `tagRef`/`fisheye` round-trip; `fisheyeScale` (focus → max, ≥radius → 1, monotonic decreasing); `buildWorkspaceImport` — creates group+members+root note, presets `parentId`/`folderId`, skips already-present notes (idempotence: second call on post-apply doc returns null), media-wrapped note becomes a media node with `noteId`, existing A→B link produces an edge with `linkHref`, reuses an existing bound group.

### Step 2 — new `src/lib/noteTags.ts` (+ `noteTags.test.ts`)

Mirror `noteLinks.ts`'s shape. Exact signatures:
```ts
/** Card text -> canonical tag ('#my-label'), matching useNotes.parseTags ([\w-], lowercased). Null for empty/symbol-only text. */
export function tagForCard(text: string): string | null

/** True if content contains this exact tag (word-boundary safe: '#tag' must not match inside '#tag2'). */
export function hasTag(content: string, tag: string): boolean

/** Append `<p>#tag</p>` at the end; no-op if hasTag. */
export function appendTag(content: string, tag: string): string

/** Remove the tag paragraph(s)/bare occurrences of this exact tag. */
export function removeTag(content: string, tag: string): string
```
Implementation notes:
- `tagForCard`: `text.trim().toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '')` → prepend `#`; null if the slug is empty. (parseTags lowercases, so the sidebar tag and the card slug must agree.)
- Boundary matching: tag chars are `[\w-]`, so `\b` misbehaves after `-` — use a negative lookahead `(?![\w-])` after the escaped tag in `hasTag`/`removeTag`.
- `removeTag`: strip `<p>#tag</p>` wrappers first, then bare `(?:<br\s*/?>)?#tag(?![\w-])` occurrences — same two-form strategy as `removeNoteLink` (a `<p>` degrades after an md round-trip).
- parseTags works on tag-stripped text, so `<p>#tag</p>` → `' #tag '` → parsed. Add a test importing `parseTags`? It's not exported from useNotes — instead test the invariant directly: `appendTag` output run through `htmlToMarkdown` → `contentFromDisk` still satisfies `hasTag`, and the raw md contains `#tag` preceded by whitespace/newline.
- Tests: idempotent append; remove-after-append restores original; `#tag` vs `#tag2` isolation; round-trip per above; `tagForCard('Research Idea!') === '#research-idea'`, `tagForCard('  ') === null`.

### Step 3 — `src/hooks/useWorlds.ts`: tag wiring + mirror action

**3a. Enrichment.** In `enrichAddEdges`, after the both-note-backed `linkHref` branch: if exactly one endpoint is a `text` node with `tagForCard(text)` non-null and the other endpoint is note-backed → set `tagRef` on the edge. (An edge carries `linkHref` XOR `tagRef` XOR neither.)

**3b. `stampEdgeField(edgeId, patch)`** — clone `stampNodeField` for `doc.edges` (direct, non-undoable; used only to keep `tagRef` current after a card rename).

**3c. `runWorkspaceEffects` extensions.**
- **'add' with `tagRef` edges**: group by target note (the note-backed endpoint); fold `appendTag` per note, one `updateNote` per note (same one-updateNote-per-note discipline as links — parallel updates in one tick read stale bases).
- **'remove' with `tagRef` edges**: before removing a tag from a note, check the **post-apply** doc (`activeDocRef.current`) for any surviving edge with the same `tagRef` whose note-backed endpoint is the same note — if one exists, skip the removal (two cards with the same label wired to one note: cutting one wire must not strip the tag the other still asserts).
- **'patch' on a text node whose `after` contains `text`** and the card has ≥1 edge to a note-backed node: `oldTag = tagForCard(String(cmd.before.text ?? ''))`, `newTag = tagForCard(String(cmd.after.text ?? ''))`. If they differ: per connected note, `content = appendTag(removeTag(content, oldTag), newTag)` (skip the respective half when old/new is null), one `updateNote` each; then `stampEdgeField` the new `tagRef` (or delete it when newTag is null) onto each of those edges. Undo of the text patch swaps before/after and re-fires this branch symmetrically — no extra bookkeeping.
- Apply the same skip-if-duplicate guard when oldTag removal races another card with the same tag.

**3d. Watcher tag reflection.** In the workspace→world effect, alongside link reflection: an edge with `tagRef` whose note-backed endpoint's note exists but `!hasTag(note.content, edge.tagRef)` → drop the edge (the user deleted the `#tag` in the editor). Same keep-when-unverifiable rule as links.

**3e. `mirrorWorkspace()`** exported from the hook:
```ts
const mirrorWorkspace = useCallback(() => {
  if (!activeDocRef.current || !activeWorldIdRef.current) return;
  const ws = {
    notes: notesRef.current.filter((n) => !n.isTrash),
    folders: opsRef.current.folders,
    noteExtensions: opsRef.current.noteExtensions,
  };
  applyWorldCommand(buildWorkspaceImport(activeDocRef.current, ws));
}, [applyWorldCommand]);
```
One command → one undo step; effects run but are idempotent (see 1c). Return it from the hook.

### Step 4 — `src/components/WorldCanvas.tsx`

**4a. Fish-eye rendering.**
- State `fisheyeOn` initialized from `initialView.fisheye ?? true`; include it in the `onViewChange({ pan, zoom, rotation, fisheye: fisheyeOn })` effect (add to its dep array).
- In `nodeStyle(n)`: when on, compute `focus = screenToCanvas(viewport center)` once per render (hoist above the nodes `.map`, not per node) and `radius =` half the viewport diagonal in canvas units (`Math.hypot(rect.width, rect.height) / (2 * zoom)`); compose `scale(${fisheyeScale(center(r), focus, radius)})` after the rotate in the transform, `transformOrigin: 'center'`. Groups are excluded (scaling a group visually detaches its children) — apply to text/note/media only.
- Toggle button in the right toolbar, above Reset view: lucide `Aperture` icon, title "Fish-eye — depth effect (visual only)", armed styling `bg-[#32CD32]/20 text-[#32CD32]` when on, `ToolbarButton`-consistent otherwise.
- Optional flourish (cheap, do it): a `pointer-events-none` overlay div inside the canvas container with a subtle radial vignette (`background: radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.18) 100%)` dark / `rgba(0,0,0,0.06)` light), rendered only when `fisheyeOn`.

**4b. Mirror button.** New prop `onMirrorWorkspace: () => void`. Button in the right toolbar (lucide `Map` icon, title "Mirror workspace — import all folders & notes"), followed by `showToast('Workspace mirrored — undo to revert.')`. Disabled styling not needed (idempotent no-op when nothing new).

**4c. Card `#` affordance.** In the text-card render branch, when `n.text` is non-empty and not editing, prefix the title with a lime hash: `<span className="text-[#32CD32] mr-0.5">#</span>` before the text (display only — never stored into `n.text`). This reads as "cards are labels" without changing the data model.

### Step 5 — `src/App.tsx`

Destructure `mirrorWorkspace` from `useWorlds(...)` and pass `onMirrorWorkspace={mirrorWorkspace}` to `WorldCanvas`.

### Step 6 — Tests + typecheck

- `node --import tsx --test src/lib/*.test.ts` — all pass (59 existing + new world.ts + noteTags.ts tests).
- `npm run lint` (tsc) clean.

### Step 7 — Browser preview verification (preview_snapshot + preview_eval state diffs — no screenshots)

Harness rules from `memory/valx-world-mode.md` apply, especially: **split trigger and read into separate `preview_eval` calls** (same-call reads see pre-render state — this bit twice in Phase 4), armed-state checks via a second call, reuse one `DataTransfer` across drag dispatches. Note-content persistence across a full reload cannot be proven in the browser harness (no real workspace folder) — verify doc-side persistence and note the limitation.

1. **Mirror**: create 2 notes in a folder (drag notes onto the sidebar folder or use moveNotesToFolder via UI) + 1 root note, one note containing a link to another → open world → Mirror button → bound group labeled after the folder with both cards inside (`parentId`/`folderId` set in the localStorage doc JSON), root note outside, wire present with `linkHref`. Click Mirror again → node/edge counts unchanged (idempotent). Undo → everything from the mirror gone in one step; the folder and notes untouched.
2. **Fish-eye**: with several nodes spread out, read two nodes' computed `transform` — the one nearer the viewport center has the larger scale. Toggle off → both scale-free. Navigate to notes and back → toggle state persisted. Confirm hit-testing unaffected (drag a scaled node; it moves normally).
3. **Card tag append**: card "Research Idea" → lasso card→note Alpha → Alpha's content gains `<p>#research-idea</p>`; sidebar TAGS shows `research-idea`. Scissor the wire → tag gone from content and sidebar. Undo → both back.
4. **Card rename retag**: with card wired to Alpha, double-click card, change text to "Key Source", blur → Alpha loses `#research-idea`, gains `#key-source`; edge's stored `tagRef` updated in the doc JSON.
5. **Duplicate-tag guard**: two cards both labeled "shared" wired to the same note → cut one wire → `#shared` still in the note; cut the second → removed.
6. **Tag deleted outside**: remove the `#tag` paragraph in the editor → return to world → that wire is gone; unrelated wires intact.
7. **Persistence**: after 1–6, navigate away, edit an unrelated note, return → nodes, groups, wires, `tagRef`s, fisheye toggle, undo/redo all intact; full reload → doc structure and view (including `fisheye`) persist (note-content side needs Electron, report as known harness limitation).

## Out of scope (do not build; restate in report)

World-side deletions deleting folders/notes; link-href refactoring on note rename; live reverse link creation (Mirror's one-shot scan is the only place links are read into wires); fisheye-aware hit-testing (visual-only, same doctrine as rotation); rotation-aware hit-testing; `.canvas` disk read-back; packaging/builds; `main.cjs`/`preload.cjs`.

## Reporting expectations

Lead with outcome; distinguish "fixed and verified" vs "fixed but unverified" vs "harness artifact"; cite before/after evidence for every checklist item; list anything skipped; flag the scope decision above so the user can override it if the intent was different.
