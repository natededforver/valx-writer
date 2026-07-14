# World Mode — Phase 4 Plan: Workspace Correspondence (bidirectional sync)

Handoff-ready. Execute top to bottom. Standing constraints for every step:
**tests but no builds** (`npm run lint` + `node --import tsx --test src/lib/*.test.ts` + browser preview only — never packaging/electron builds), **no `main.cjs`/`preload.cjs` edits**, **keep UI/UX consistent** (black+lime, no purple, existing `vx-*` idioms, reuse existing markup/helpers instead of inventing new ones).

## Intent (user's words, distilled)

World Mode is a graphical big-picture of the workspace: **groups = folders**, note cards = notes, media = files. Every action inside a world must correspond to the real workspace, live, in both directions:

1. **Link Lasso wires between note-backed nodes = markdown links appended at the end of the source note.** Cutting the wire (scissor, delete, undo) removes the link. Deleting the link from the note (editing outside) removes the wire.
2. **Groups are folders.** Attaching a note-backed node to a group moves the note into that group's folder (creating the folder if needed). Detaching moves it back to root. Moving a note between folders outside World Mode re-parents its node inside the resident world.
3. **Media imported solo gets a note of its own** — a new note whose content is the same `<video controls>`/`<audio controls>`/`<img>`/attachment-chip HTML the editor produces, so playback works everywhere. The media node records that note's id (making it "note-backed" for rules 1–2).
4. **Double-clicking a note or media node detaches it from its group** (which, per rule 2, also moves the note out of the folder).

## Current-state citations (why each change is where it is)

- `useWorlds.ts:36` — `useWorlds(notes, workspaceHandle, notesReady)` already receives live `notes`; it has **no access to note mutations** (`updateNote`, `moveNotesToFolder`, `addFolder`, `addNoteWithContent`) or `folders`/`noteExtensions`. Those live in `useNotes` and are returned to `App.tsx:20`. → Thread them into `useWorlds` as one `ops` param (same single-source-of-truth discipline that fixed the Phase-2 critical bug; do NOT call `useNotes()` inside `useWorlds`).
- `useWorlds.ts:258` `applyWorldCommand` — the single choke point every world mutation, undo (`:272`), and redo (`:288`) routes through. → All world→workspace side effects hook here, once, so undo/redo trigger symmetric effects for free (undo of "add edge" applies a "remove edge" command → link removal fires).
- `useWorlds.ts:95-106` — the existing notes-watcher effect (prunes note nodes whose note died, direct doc replacement + `queuePersist`, **no undo entry**). → The workspace→world reflection (folder membership, deleted links, dangling edges) extends this exact pattern.
- `world.ts:30-43` — `NoteNode.noteId` exists; `MediaNode` and `GroupNode` have no workspace linkage; `WorldEdge` (`:46`) has no link record. → Add `GroupNode.folderId?`, `MediaNode.noteId?`, `WorldEdge.linkHref?`.
- `world.ts:547-588` — `toJsonCanvas`/`fromJsonCanvas` round-trip Valx-only fields via `x-valx`. → New fields must round-trip (`folderId`, media `noteId`; `linkHref` straight on the edge object — Obsidian ignores unknown edge props).
- `WorldCanvas.tsx:466-479` `handleFilesImported` — creates bare media nodes only. → Wrap each import in a note (rule 3).
- `WorldCanvas.tsx:753-775` (note node) and `:778-799` (media node) — **no `onDoubleClick` handler** (text cards at `:718` and groups at `:682` use double-click for editing — don't touch those). → Add detach-on-double-click here.
- `WorldCanvas.tsx:543-545` `detachFromGroup` — already builds the right patch; double-click just calls it.
- `RichTextEditor.tsx:150-163` `buildMediaHtml(kind, src, name)` (+ its `escAttr`/`escText` helpers) — the canonical media markup, currently component-local. → Hoist to module scope and export; the wrapped-media note must use *identical* markup so the editor's hover-remove tool, chip click-through, and md round-trip all work unchanged. Do not duplicate this markup anywhere.
- `useNotes.ts:518` `addFolder(name)` — creates folder + clears tombstone, returns `SyncFolder` (id = sanitized path). `useNotes.ts:610` `moveNotesToFolder(ids, folderId|null)`. `useNotes.ts:581` `addNoteWithContent(title, content, folderId?)`. `useNotes.ts:783` `noteExtensions` (id → ext *with* leading dot, falling back to workspace format). All already exported from the hook — nothing new needed in `useNotes`.
- `lib/sync.ts` exports `sanitizePath` (used by `addFolder` internally — group labels go through `addFolder` as-is, it sanitizes).

## Build order

### Step 1 — `src/lib/world.ts`: model fields + serialization (+ tests)

- `GroupNode` gains `folderId?: string`.
- `MediaNode` gains `noteId?: string`.
- `WorldEdge` gains `linkHref?: string`.
- `toJsonCanvas`: group `x-valx` gains `folderId`; media `x-valx` gains `noteId`; edge objects gain `linkHref` (top-level, alongside `label`).
- `fromJsonCanvas`: restore all three.
- New pure helper (used by useWorlds and the watcher):
  ```ts
  /** noteId a node is backed by: note nodes always, media nodes when wrapped. */
  export function noteIdOf(node: WorldNode): string | null
  ```
- Tests in `world.test.ts`: JSON Canvas round-trip preserves `folderId`/media `noteId`/`linkHref`; `noteIdOf` for all four node types.

### Step 2 — new `src/lib/noteLinks.ts` (+ `noteLinks.test.ts`)

Pure string helpers over note HTML content. Exact signatures:

```ts
/** Href for a markdown link to a note file, e.g. "My%20Note.md". ext includes the dot. */
export function linkHrefForNote(title: string, ext: string): string   // encodeURI(`${title || 'Untitled'}${ext}`)

/** True if content already contains an <a> with this exact href. */
export function hasNoteLink(content: string, href: string): boolean

/** Append `<p><a href="{href}">{title}</a></p>` at the end; no-op if hasNoteLink. */
export function appendNoteLink(content: string, title: string, href: string): string

/** Remove the trailing link paragraph(s)/anchor(s) with this exact href. */
export function removeNoteLink(content: string, href: string): string
```

Implementation notes:
- `removeNoteLink`: regex-escape the href; strip `<p><a href="HREF"[^>]*>...</a></p>` first, then any bare `<a href="HREF"[^>]*>...</a>` (a link degrades to a bare anchor after an md round-trip — `contentFromDisk` re-parses `[Title](href)` to `<a href>` but paragraph wrapping may differ). Escape the title with the same entity-escaping approach as `escText` in RichTextEditor.
- Tests: append is idempotent; remove after append restores original; remove matches both `<p>`-wrapped and bare anchors; href with spaces/parens; **round-trip test per the format.ts contract**: `appendNoteLink` output → `htmlToMarkdown` → `contentFromDisk` still satisfies `hasNoteLink` (import those two from `../lib/format`).

### Step 3 — `src/components/RichTextEditor.tsx`: hoist media markup

Move `escAttr`, `escText`, and `buildMediaHtml` from inside the component to module scope; `export { buildMediaHtml }`. Zero behavior change — verify the component still compiles and uses them identically. (This is the only edit to this file.)

### Step 4 — `src/hooks/useWorlds.ts`: ops param, command enrichment, side effects, watcher

**Signature** (update the call in `App.tsx:24` in the same commit):
```ts
export interface WorldNoteOps {
  updateNote: (id: string, updates: Partial<Note>) => void;
  moveNotesToFolder: (ids: string[], folderId: string | null) => void;
  addFolder: (name: string) => { id: string; name: string };
  folders: Folder[];
  noteExtensions: Record<string, string>;
}
export function useWorlds(notes: Note[], workspaceHandle: any, notesReady: boolean, ops: WorldNoteOps)
```
Mirror `notes` and `ops` into refs the same render-time way the file already mirrors state (`useWorlds.ts:46-51`) — `applyWorldCommand` is invoked from WorldCanvas's window-level handlers (architecture rule 1).

**4a. Edge enrichment (before apply).** In `applyWorldCommand`, if `cmd.type === 'add'` and it has edges, map each edge: resolve `noteIdOf` for both endpoint nodes (look up in `activeDocRef.current` merged with `cmd.nodes` — a command can add node+edge together); if both are note-backed, set `linkHref = linkHrefForNote(toNote.title, opsRef.current.noteExtensions[toNote.id] ?? '.md')`. Apply and push the **enriched** command onto the undo stack so undo/redo carry `linkHref`.

**4b. Side effects (after apply).** One function, called with the applied (enriched) command from `applyWorldCommand`, `undo`, and `redo`:

```ts
const runWorkspaceEffects = (docBefore: WorldDoc, cmd: Command) => { ... }
```
- `add` with edges: group new edges by from-note; for each from-note, fold `appendNoteLink(content, toTitle, edge.linkHref)` over its edges **locally, then one `updateNote(fromId, { content })` call** (multiple `updateNote`s in one tick would each read a stale base). Skip edges without `linkHref`.
- `remove` with edges: symmetric — group by from-note, fold `removeNoteLink`, one `updateNote` each. (This automatically covers scissor cuts, node deletion via `buildDeleteSelection`, and undo of a lasso.)
- `patch` whose `after` contains `parentId` on a node with `noteIdOf(node) !== null`:
  - `parentId` set → resolve the group in the post-apply doc. If `group.folderId` is unset or names a folder no longer in `ops.folders`: `const f = ops.addFolder(group.label || 'Group')`, then **directly** stamp `folderId: f.id` onto the group in `activeDocRef.current` (setActiveDoc + `queuePersist`; deliberately not undoable — a folder creation isn't undoable either). Then `moveNotesToFolder([noteId], group.folderId)`.
  - `parentId` cleared → `moveNotesToFolder([noteId], null)`.
  - Undo symmetry falls out: undoing an attach applies the inverse patch (parentId cleared) → note moves back to root.
- `patch` whose `after` contains `label` on a group with `folderId`: re-bind — `const f = ops.addFolder(newLabel)`; `moveNotesToFolder(memberNoteIds, f.id)` where members = `childrenOf(doc, group.id)` mapped through `noteIdOf`; stamp new `folderId` directly (as above). Leave the old folder in place, possibly empty — never delete folders from world actions (data-safety).

**4c. Workspace→world watcher.** Extend the effect at `useWorlds.ts:95` (same guards: `notesReady`, non-empty `notes`, resident doc; direct doc replacement + `queuePersist`, no undo entries). After the existing prune, compute in order:
1. **Dangling-edge prune**: drop edges whose `fromNode`/`toNode` no longer exist in `nodes` (today they linger invisibly after the note-node prune).
2. **Link reflection**: for each remaining edge with `linkHref` whose from-node is note-backed and whose from-note exists: if `!hasNoteLink(fromNote.content, edge.linkHref)` → drop the edge. (Idempotent with 4b: after a world-side append the link exists, so nothing fires.)
3. **Folder reflection**: build `folderId → group` from bound groups. For each note-backed node: `expected = note.folderId ? boundGroups.get(note.folderId)?.id : undefined`. Skip nodes whose current parent is an **unbound** (decorative) group — those are world-only. If `node.parentId !== expected` on the bound axis:
   - newly attached (expected set): set `parentId = expected`; if the node's center isn't inside the group's bounds, move it to `{ x: group.x + 24, y: group.y + 48 + k*24 }` (k = index among nodes being placed this pass) so it lands visibly inside.
   - detached (expected undefined, current parent bound): clear `parentId`; nudge to `x = group.x + group.width + 24` if still inside the bounds.
   
Apply all three as **one** new doc object; only call `setActiveDoc`/`queuePersist` if anything changed. This loop must be idempotent (it is: every write converges to the expected state) because world→workspace effects re-trigger it via `notes`.

### Step 5 — `src/components/WorldCanvas.tsx`

- **Props**: add `onCreateMediaNote: (m: { name: string; src: string; kind: 'image'|'audio'|'video'|'file' }) => string` (returns new note id).
- **`handleFilesImported` (`:466`)**: after building `valid`, for each media call `onCreateMediaNote` and put the returned id on the node: `{ ...media node fields, noteId }`. Everything else (sizing, layout, popIds) unchanged.
- **Double-click detach**: on the note-node div (`:758`) and media-node div (`:781`) add
  ```tsx
  onDoubleClick={(e) => { e.stopPropagation(); if (!armed && n.parentId) detachFromGroup(n); }}
  ```
  Do not touch the text-card/group double-click (those edit).

### Step 6 — `src/App.tsx`

- Pass the ops object to `useWorlds`: `useWorlds(notes, workspaceHandle, isWorkspaceRestored, { updateNote, moveNotesToFolder, addFolder, folders, noteExtensions })`.
- Implement and pass `onCreateMediaNote` to `WorldCanvas`:
  ```tsx
  onCreateMediaNote={({ name, src, kind }) => {
    const title = name.replace(/\.[^.]+$/, '') || 'Media';
    const note = addNoteWithContent(title, buildMediaHtml(kind, src, name));
    return note.id;
  }}
  ```
  (import `buildMediaHtml` from `./components/RichTextEditor`.)

### Step 7 — Tests + typecheck

- `node --import tsx --test src/lib/*.test.ts` — all pass (existing 50 + new world.ts + noteLinks.ts tests).
- `npm run lint` (tsc) clean.

### Step 8 — Browser preview verification (preview_snapshot + preview_eval state diffs — no screenshots)

Before/after diffs on localStorage JSON (`valx-world-doc:*`, note content in app state) and DOM. Split trigger and read into separate `preview_eval` calls (React flush race). Known harness quirks in `memory/valx-world-mode.md` apply.

1. **Lasso → link**: two note cards; lasso A→B; read note A content → contains `<a href="B.md">B</a>` at end. Scissor the wire → link gone from A. Undo the cut → wire and link back. Undo the lasso → both gone.
2. **Multi-hit lasso**: stroke A→B→C in one drag → A gains link to B, B gains link to C, one link each (no stale-base clobber).
3. **Group = folder**: drag note card into a fresh group labeled "Research" → folder `Research` exists (sidebar), note's `folderId` set. Double-click the card → detached, `folderId` null. Undo → re-attached + folder restored.
4. **Outside → world**: with the world resident, navigate to notes, move a note (whose card is in the world) into the bound folder via the note list; return → its card sits inside the group. Move it out → card re-parented out.
5. **Solo media wrap**: drop an mp4 → a new note titled after the file exists with `<video controls src=…>` content (open it in the editor — controls render); the media node carries its `noteId`; lasso from the media node to a note card appends a link to the media note.
6. **Link edited away outside**: delete the appended link paragraph in the editor; return to world → wire gone.
7. **Full persistence round-trip** (the definitive test): build all of the above → navigate to notes → edit an unrelated note → return → nodes, parentIds, folderIds, wires, links, undo/redo history all intact → full reload → doc + view persist.

## Out of scope (do not build; note in report if asked)

- **Auto-populating a world from the whole directory** (a "mirror workspace" bootstrap button). This phase makes manually-built worlds correspond live; a one-click importer is Phase 5.
- Deleting folders or notes from world-side deletions (deleting a group/media node never deletes its folder/note).
- Link refactoring on note rename (an appended link's href goes stale exactly like a hand-written md link would; the edge's stored `linkHref` stays consistent with the note content, so no false wire-drops).
- Reverse link creation (typing a markdown link in a note does not create a wire).
- Rotation-aware hit-testing, `.canvas` disk read-back, packaging/builds, `main.cjs`/`preload.cjs`.

## Reporting expectations

Lead with outcome; distinguish "fixed and verified" vs "fixed but unverified" vs "harness artifact"; cite before/after evidence for every checklist item; list anything skipped.
