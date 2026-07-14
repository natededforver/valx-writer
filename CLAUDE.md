# Valx Prose Writer — Engineering Rules

Tauri 2 + React 19 + Vite 6 + TypeScript (strict OFF) + Tailwind CSS v4 + lucide-react. Local-first writing app, fully free — no Firebase/Paddle/auth (removed 2026-07); sync is a user-chosen cloud-mirrored folder. (Migrated from Electron 2026-07: the desktop backend is `src-tauri/` + the `window.electronAPI`-compatible bridge in `src/lib/desktop.ts` — the 'electron' handle kind now just means "desktop backend"; do NOT rename it, filemap/localStorage keys embed it.)

## Commands
- Typecheck: `npm run lint` (this is `tsc --noEmit` — there is no eslint).
- Tests: `node --import tsx --test src/lib/*.test.ts` (no test runner installed; only pure logic in `src/lib/*` is tested).
- Dev server for verification: `preview_start` / the Vite dev server (the whole renderer runs in the browser via the Web File System Access fallback). **Never run `tauri build`/`tauri dev` or any packaging unless explicitly asked** — they need the Rust toolchain and compile for minutes.
- Desktop dev/build (needs Rust installed): `npm run tauri:dev` / `npm run tauri:build`.
- Media URLs: notes STORE `/__media/…`; the DOM shows the display form (`mediaDisplaySrc/Html` ↔ `mediaCanonicalHtml` in `src/lib/desktop.ts`). New media render sites must wrap srcs in `mediaDisplaySrc`.

## Architecture rules that prevent known bug classes
1. **Ref-mirroring in long-lived event handlers.** Any value read inside a window-level mouse/keyboard handler registered in a `useEffect` MUST be mirrored into a ref that is updated *inline* at the moment of change — not only at render time. Reading closure state there reads a stale value when events land in the same tick. This exact bug shipped three times (`useWorlds.activeDocRef`, `WorldCanvas.nodeRotatePreviewRef`, `WorldCanvas.resizeDeltaRef`). Follow the existing `dragOffsetRef` pattern in `WorldCanvas.tsx`. Keep such effects' dependency arrays minimal — per-tick state in deps causes per-tick resubscription.
2. **One `useFileSystem()` source of truth.** Hooks that key persistence off the workspace handle must receive `workspaceHandle` (and a readiness flag) as parameters from App, never instantiate their own `useFileSystem()` — independent instances settle async at different times and cause key mismatches / spurious resets (the "world resets on navigate" critical bug).
3. **Disk writes go through the `serializeDisk` mutex** in `useNotes.ts`. Bypassing it duplicates files during title edits.
4. **Command pattern for World Mode.** All world mutations are invertible `Command` objects applied via `applyWorldCommand` so undo/redo stays correct. Pure geometry/model logic lives in `src/lib/world.ts` with tests; `WorldCanvas.tsx` is interaction/render only.
5. **format.ts round-trip contract**: HTML entities stay encoded through md conversion; preserve legacy-detection order and stash-token handling. Add a round-trip test for any change.

## UI/UX consistency
- World Mode dark theme is black + lime green (light mode inverted). **No purple/violet anywhere.**
- Reuse existing idioms: armed-tool button styling (lime highlight, mutually exclusive tools), `vx-*` animation classes in `src/index.css` (`vx-pop`, `vx-shudder`, `vx-node-glow`, `vx-wire-break`), Tailwind v4 arbitrary values, `cubic-bezier(0.16,1,0.3,1)` easing for slides.
- Captions/content scale with node size via `captionFontSize()` in `world.ts` — don't hardcode font sizes in world nodes.

## Testing & verification expectations
- Every new pure function in `src/lib/*` gets tests in the sibling `*.test.ts`.
- UI changes are verified in browser preview with before/after state diffs (localStorage JSON, DOM rects) — `preview_snapshot` + `preview_eval`, not screenshots (they time out in this harness).
- For anything touching world persistence, run the round-trip test: build state → navigate to notes → edit a note → return to world → confirm nodes, labels, media, and undo/redo history all intact.

## Out of scope by default (need explicit request)
Packaging/`tauri build`; `src-tauri/` Rust edits; rotation-aware hit-testing (axis-aligned approximation is the accepted design); `.canvas` disk read-back (localStorage is authoritative for World Mode Phase 1–3).
