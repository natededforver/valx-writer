# Phase 7 — Links, Markdown, Clear Tool, Chrome Cleanup — Implementation Plan

Standalone handoff document. Read CLAUDE.md first — every architecture rule
applies to every step. Standing constraints (apply to EVERY step):
- Tests for every new/changed pure function in `src/lib/*` (`node --import tsx --test src/lib/*.test.ts`); typecheck `npm run lint`. **No packaging/electron builds.**
- UI consistent: black+lime dark (inverted light), no purple, armed-tool lime highlight, `vx-*` animations, `cubic-bezier(0.16,1,0.3,1)`.
- World mutations stay invertible Commands through `applyWorldCommand`; pure logic in `src/lib/world.ts`.

## Item 1: Remove Rotate + Reset View from World Mode (removal — do first)

`WorldCanvas.tsx`: delete the Rotate armed-tool button (~line 915-921) and the
Reset View `ToolbarButton` (line 922). Rotate was the ONLY entry into
`beginRotate` / the `rotate` interaction / `nodeRotatePreview(+Ref)` /
`rotateArmed` — delete all of them, plus `resetView`, plus the now-unused
`angleBetween`, `RotateCcw`, `RotateCw` imports. KEEP: `rotation` view state,
the rotation wrapper div, `screenToCanvas`'s rotation inverse, and rendering of
`n.rotation` in `nodeStyle` — saved docs/views may carry non-zero rotations.
`armed` becomes `strokeArmed || clearArmed` (item 6).

## Item 2: Scrollbars — hidden everywhere, minimal in the editor

`src/index.css`: global `* { scrollbar-width: none } *::-webkit-scrollbar { display: none }`.
Then re-enable for the editor scroll container only (`Editor.tsx:572` — add class
`vx-editor-scroll`): Claude-app style = ~8px wide, transparent track, rounded
`rgba` thumb visible on hover/scroll, no buttons. Both themes (thumb
`rgba(120,120,120,0.35)`).

## Item 3: Colour palette to the right of the node frame + custom Apply/Cancel

`WorldCanvas.tsx` `NodeOverlay` popover (line 1085): position `top-0 left-full ml-2`
(opens to the right of the node's frame) instead of `top-1 right-8`.
Custom swatch: replace the instant-apply `<input type="color">` with local state —
clicking the conic swatch reveals a row: native color input (updates `pending`,
live-previewed on the swatch) + **Apply** (calls `onPickColor(pending)`, closes)
+ **Cancel** (closes, no change). The picker panel must NOT close on the input's
change event — that was the one-click frustration.

## Item 4: Links — lime green + bold, click opens note; typed markdown links

- `index.css`: `.rich-editor a:not(.vx-attach) { color:#32CD32; font-weight:700; cursor:pointer; text-decoration:underline; }`
  (covers Link-Lasso-generated links and hand-typed ones alike).
- `RichTextEditor.tsx` `handleClick`: extend the anchor branch — after the
  attachment check, if href is http(s), `api.openExternal(href)` (preload line 16)
  else `window.open`. Otherwise treat as a note link: new prop
  `onOpenNoteLink?: (href: string) => boolean`; App resolves href → note via
  `linkHrefForNote(title, noteExtensions[id])` equality (same matching as
  useWorlds item 14) and selects the note. `e.preventDefault()` always.
- Typed markdown: in `handleKeyDown`, when the user completes `[label](href)`
  (on typing `)`), replace the literal text before the caret with a real
  `<a href>` via Range surgery + `insertHTML`, caret after the anchor. Pure
  helper `parseTrailingMdLink(text): { label, href, matchLen } | null` in
  `src/lib/noteLinks.ts` + tests.

## Item 5: Full markdown render (format.ts)

Extend `markdownToHtml` / `htmlToMarkdown` (Obsidian core syntaxes not yet
covered): inline code `` `x` `` ⟷ `<code>`, fenced code blocks ⟷ `<pre><code>`,
blockquote `> ` ⟷ `<blockquote>`, horizontal rule `---` ⟷ `<hr>`, task lists
`- [ ]` / `- [x]` ⟷ checkbox inputs (`disabled` so contentEditable doesn't
fight them… actually clickable, `onChange` handled as content edit — keep
`disabled` for v1), unordered `- ` already partially handled. Preserve the
round-trip contract: entities stay encoded, legacy-detection order intact,
stash tokens for code blocks (their content must skip md transforms).
New `src/lib/format.test.ts`: round-trip test per syntax + the existing-content
regression (heading/bold/table survive unchanged).
`index.css`: styles for `.rich-editor code/pre/blockquote/hr` (lime accents,
both themes).

## Item 6: Clear tool (remove from world, keep files)

- `world.ts`: `worldOnly?: boolean` on `add`/`remove` Command variants;
  `invertCommand` carries it through both directions. Test: invert twice
  preserves the flag.
- `useWorlds.runWorkspaceEffects`: first line —
  `if ((cmd.type === 'add' || cmd.type === 'remove') && cmd.worldOnly) return;`
  (skips trash-move, link/tag removal; undo/redo symmetric for free).
- `WorldCanvas.tsx`: `clearArmed` state + dock button after Scissor (lucide
  `Paintbrush`), mutually exclusive with lasso/scissor. Armed:
  - container cursor: inline SVG brush data-URI cursor.
  - mousedown on a node → worldOnly-remove it (+ `childrenOf` if group) +
    incident edges, one command.
  - drag on canvas → marquee (reuse marquee interaction with a `clear` flag);
    on mouseup worldOnly-remove `nodesInRect` result (+ group children).
  - Escape disarms (existing handler — add clearArmed to it).

## Item 7: Delete confirmation dialogs

`WorldCanvas.tsx`: Delete/Backspace path (and only it) — if the selection
contains note-backed nodes (note / media-with-noteId) or groups, show a confirm
modal (SettingsModal container idiom, like ImportSpacesModal): title "Delete
from workspace?", body "This moves N note(s) to the workspace trash. To remove
them from this world without touching your files, use the Clear (brush) tool
instead." Buttons Cancel / Delete (red). Pure text-cards/edges-only selections
delete without asking. Group deletion is currently node-only (children stay) —
message still applies because the group's folder binding isn't deleted; keep
behavior, just gate it.

## Item 8: Group rename persists to the workspace folder

- `useNotes.ts`: new `renameFolder(oldId, newName): { ok: true; id: string } | { ok: false; reason: string }`:
  - canonical = `sanitizePath(newName)`; no-op if === oldId.
  - REFUSE (`ok:false`) when: another folder with that id exists (merge risk) or
    the folder has child folders (`f.id.startsWith(oldId + '/')`) — the
    "could corrupt files" warning cases.
  - Else: `addFolder(canonical)`, `moveNotesToFolder(direct member ids, canonical)`
    (saveNoteFile moves each file on disk via the existing rename path),
    `fsDeleteFolder(old)`, drop old folder from state + tombstone it.
- `useWorlds.runWorkspaceEffects` group-label patch branch: replace the
  `addFolder`+move block with `ops.renameFolder(node.folderId, node.label)`;
  on `ok` stamp the group's `folderId` to the new id; on `!ok` surface the
  reason (add `onEffectWarning?: (msg: string) => void` to WorldNoteOps → toast
  in WorldCanvas via App). Add `renameFolder` to `WorldNoteOps` + App wiring.

## Item 9: Ctrl multi-selection in the editor

CSS Custom Highlight API (native, Chromium 105+/Electron 42 — rung 4).
`RichTextEditor.tsx`: ref `multiRangesRef: Range[]`. On mouseup with
Ctrl/Cmd held and a non-collapsed selection inside the editor: push
`range.cloneRange()`, rebuild `CSS.highlights.set('vx-multi', new Highlight(...ranges))`.
Style in index.css: `::highlight(vx-multi) { background: rgba(50,205,50,0.30); }`.
While ranges exist: Ctrl+B / Ctrl+I / Ctrl+Shift+X apply the execCommand to
every stored range (select each, exec, restore), then clear; Delete/Backspace
`range.deleteContents()` per range then `handleInput()`; Escape or any plain
click/keypress clears the set. Guard `typeof Highlight !== 'undefined'`.

## Build order
1 (removals) → 2 (CSS) → 3 (palette) → 4 (links) → 6 (clear: lib flag first) →
7 (confirm dialog) → 8 (renameFolder) → 9 (multi-select) → 5 (format.ts last —
biggest test surface). Lint + full test run + browser-preview verification pass.

## Verification checklist
- [ ] `npm run lint` clean; all `src/lib` tests green (new: format round-trips, parseTrailingMdLink, worldOnly invert).
- [ ] World: no Rotate/Reset buttons; saved rotated docs still render rotated.
- [ ] Scrollbars: none visible app-wide; editor shows minimal thumb; wheel-scroll everywhere unaffected.
- [ ] Palette opens right of frame; custom picker needs Apply; Cancel restores.
- [ ] Typed `[x](Note.md)` becomes a lime bold link; clicking it opens the note; external links open in browser; lasso-generated links identical.
- [ ] Clear tool: brush cursor, single-click and marquee clearing, files untouched (NoteList unchanged), undo restores nodes without touching notes.
- [ ] Delete key on a note node asks confirmation naming the Clear tool; text-card delete doesn't ask.
- [ ] Rename world group → folder renamed on disk (file moved), sidebar updates; rename to an existing folder's name → warning, nothing renamed.
- [ ] Ctrl+drag-select two separate words → both highlighted; Ctrl+B bolds both.
- [ ] Round-trip: note with code fence + blockquote + hr + checklist saves to .md and reloads identically.

## Explicitly out of scope
Packaging/builds; `main.cjs`/`preload.cjs` edits; Sidebar-side folder rename UI;
nested-folder rename (refused with warning instead); clickable checkboxes
toggling markdown state; multi-range copy/paste semantics; purple.
