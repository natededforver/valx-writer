# macOS handoff — ship Valx 1.1.0 for Mac

Written for a model starting **cold** on a Mac. Assume no memory of the Windows
session that produced 1.1.0. Everything needed is here or cited by `file:line`.

Written against tag `1.1.0` (`e615307`). This branch's tip is `cabc879`, which
is tag `1.0.10`. The shipped Windows installer was built from `c806bcc`, one
commit earlier — `e615307` only corrects the two release scripts and the
download page, so the tagged tree still produces the same binary.

> **Every `file:line` below is against `main` at tag `1.1.0`, not against the
> tree you get by checking out this branch.** The files are 34 commits older
> here and the line numbers do not carry across. Do §1 first, then read.

---

## 0. The one thing that is actually broken right now

**`site/download.html` links a DMG that does not exist.**

The Windows installer for 1.1.0 is built, tagged and published. The macOS DMG is
not, and the download page was updated for both platforms in the same pass — so
the "Download for macOS" button currently points at

```
https://github.com/natededforver/valx-writer/releases/download/1.1.0/Valx.Prose.Writer_1.1.0_universal.dmg
```

which 404s. That page is live on GitHub Pages. **Building and attaching that
exact asset (§4) is the job; everything else in this document is verification
around it.**

---

## 1. Sync first — there is no port to do

**`macos-port` contains zero commits that are not already in `main`.**

```bash
git merge-base --is-ancestor origin/macos-port origin/main   # exits 0 → contained
git log --oneline origin/main..origin/macos-port             # prints only this handoff
```

This branch is a stale marker at 1.0.10, not a line of development. Every macOS
capability — native menu bar, traffic-light insets, `tauri.macos.conf.json`,
`Entitlements.plist`, `release.sh` — already lives in `main`.

**So do not cherry-pick and do not rebase.** Sync to `main` and build from it:

```bash
git fetch origin && git checkout main && git pull
```

`release.sh` expects to run from `main`. Nothing below asks you to write macOS
code; it asks you to compile it and look at it.

---

## 2. What changed between 1.0.10 and 1.1.0

34 non-merge commits. Three groups, and only the first two matter here.

| Group | What | macOS relevance |
|---|---|---|
| Android port | `de4a143`, `991938b`, `d315f49`, `dd6263e`, `b029e80`, `92090e9`, `3e50fef` | Restructured shared code and `Cargo.toml`/`lib.rs` around a `desktop`/`mobile` split — §3. `3e50fef` also changes **desktop** merge behaviour — §5.5 |
| Slop-detector recut | `9b778f2` | Pure CSS, needs eyes on a Mac — §5.4 |
| Dependabot + CI | 15 bumps, `2cf7a8c`, `1fa0415` | Three Rust dependency **majors**, checked on Windows only — §3.1 |

`3e50fef` is filed under the Android port and mostly is one — but do not skim
it on that basis. Its last substantive change is desktop-wide, and §5.5 exists
because of it.

`d68fb9e` is the version bump: `package.json`, `src-tauri/Cargo.toml`,
`src-tauri/Cargo.lock` and `src-tauri/tauri.conf.json` all read `1.1.0`.
`package-lock.json`'s root version deliberately still reads `1.0.4` — it has for
six releases, `npm ci` does not check it, leave it alone.

---

## 3. The parts that touch macOS

### 3.1 Three Rust dependency majors that no macOS compiler has ever seen

`src-tauri/Cargo.toml` now carries `sha2 = "0.11"`, `getrandom = "0.4"` and
`base64 = "0.23"`, up from 0.10 / 0.2 / 0.22. All three are used by PKCE and the
Graph calls in `src-tauri/src/onedrive.rs`.

The Build workflow added in `2cf7a8c` gates these — but read
`.github/workflows/build.yml`: the `rust` job is `runs-on: windows-latest`, with
this reasoning in the file, which is correct as far as it goes:

> Checking it on Linux would drag in the GTK/webkit2gtk stack that only exists
> for a platform this app does not build for.

macOS is the gap that argument leaves. **`cargo check` on a Mac is the first
thing to run after syncing**, before any bundling:

```bash
cd src-tauri && cargo check --locked --all-targets
```

`getrandom` 0.2 → 0.4 is the one to watch: `2cf7a8c`'s message records that the
free `getrandom()` function this repo calls in `onedrive.rs` was removed in 0.3
and the call site was adapted. That adaptation compiled on Windows only.

### 3.2 `desktop` / `mobile` split — macOS is `desktop`, so it keeps everything

`src-tauri/src/lib.rs:31-34` now gates the two heavy modules:

```rust
#[cfg(desktop)]
mod onedrive;
#[cfg(desktop)]
mod spellcheck;
```

and `Cargo.toml:51-57` moves `spellbook`, `reqwest`, `url`, `sha2` and
`getrandom` under
`[target."cfg(not(any(target_os = \"android\", target_os = \"ios\")))".dependencies]`.

**macOS satisfies both predicates, so OneDrive sync and the Rust spellchecker
are unchanged on Mac.** Do not "restore" anything here. The invoke handler is
now built as two lists (`lib.rs:211-232`) rather than one with `#[cfg]` rows
inside `generate_handler!`, because that macro is a token list and a cfg
attribute inside it is not applied before expansion. The desktop list is the old
list plus `default_workspace`.

### 3.3 A macOS-only code path was edited on a Windows machine

`lib.rs:251` renamed the `.setup()` closure parameter from `app` to `_app` so it
does not warn on mobile, and updated the two `#[cfg(target_os = "macos")]` uses
inside it — `macos_menu::install(_app.handle())` at `lib.rs:257` and
`_app.get_webview_window("main")` at `lib.rs:269`, the latter being the
`with_webview` / objc2 block that turns off WKWebView's force-click link
preview.

It is correct by inspection, but **no compiler has ever built those two lines**:
Windows CI skips them by cfg, and there is no macOS job. §3.1's `cargo check` is
what proves them. If it fails, it will fail here.

### 3.4 `set_workspace_root` now creates and scopes hidden directories

`lib.rs:144-167`. Setting the workspace root now `create_dir_all`s
`.attachments` and `.trash` under it and adds each to the fs and asset-protocol
scopes. The mechanism, from the comment: the scope is glob-matched and
`<root>/**` does not match a segment beginning with a dot, so attachments and
trash came back `forbidden path … not allowed on the scope for allow-mkdir`
while ordinary notes wrote fine.

This runs on macOS too, and it is new behaviour on a path that touches the
filesystem. Worth an explicit look because `Entitlements.plist` declares
`files.user-selected.read-write` — that entitlement only bites under App
Sandbox, which this build does **not** opt into (the plist says so and explains
why: the asset protocol and an arbitrary workspace root are not
sandbox-compatible). So the writes should just work. Verify anyway on a
workspace inside iCloud Drive / Desktop / Documents, where macOS 13+ adds its
own TCC prompt independent of entitlements.

### 3.5 Things that look platform-relevant and are not — do not re-litigate

- **`default_workspace`** (`lib.rs:178`) is registered for desktop, so it
  exists on macOS. Its only caller is gated: `src/hooks/useFileSystem.ts:67`
  reaches it under `else if (isAndroid)`. macOS still shows the native folder
  picker. Leave it.
- **`spellCheck={isAndroid}`** at `src/components/RichTextEditor.tsx:1641` reads
  like macOS lost spellcheck. It did not — desktop uses the Rust `spellbook`
  checker (§3.2) and always had the webview's own checker off.
- **`viewport-fit=cover`** in `index.html` and `src/lib/insets.ts` are for
  Android's edge-to-edge window. `insets.ts` returns early when
  `window.__valxInsets` is absent, so `--vx-inset-*` is never set off Android
  and `.vx-safe` (`src/index.css:919`) falls back to `env(safe-area-inset-*)`,
  which is 0 in a macOS WKWebView. `.vx-safe` is on the app root
  (`src/App.tsx:360`) — glance at §5.1 to confirm no stray padding, but expect
  none.
- **`isTouchUI`** (`src/lib/platform.ts`) is `isAndroid || (pointer: coarse)`. A
  trackpad Mac is `pointer: fine`, so the touch layout must stay off — §5.2 is
  the check, not a change.

---

## 4. Build and ship the DMG

```bash
git checkout main && git pull
npm ci
./scripts/release.sh          # universal (arm64 + x86_64) .app + .dmg
```

`release.sh` typechecks, cleans, builds, runs `lipo -archs` to prove both slices
made it in, and drops the result into `out/release/` under both names a release
has to carry (§4.1). Signing is optional — set `APPLE_SIGNING_IDENTITY` (and the notarization vars
listed in the script header) if you have them; unsigned works but Gatekeeper
makes the user right-click → Open, which is what the download page already tells
them to do.

### 4.1 Two asset names, and why

The repo links its downloads from two places that want different names, which
went unnoticed until 1.1.0 because nobody checked the README's:

| Name | Linked from | Shape |
|---|---|---|
| `Valx.Prose.Writer_1.1.0_universal.dmg` | `site/download.html` | Tauri's own bundle name, hardcoded per release |
| `valx-prose-writer.dmg` | `README.md:23` | stable, via `/releases/latest/download/` |

Every release from 1.0.7 on carried only the first, so **both README links have
404'd since 1.0.7**. The 1.1.0 Windows release fixed that by uploading the
installer under both names, and `release.sh` now emits both for the same reason
— you do not have to rename anything by hand.

(The dots are not a typo for the spaces `tauri build` writes. GitHub substitutes
them on upload; the scripts just name the local copy the way it will land.)

**Upload, do not create.** The `1.1.0` tag and release already exist — the
Windows side cut them. `release.sh --publish` runs `gh release create`, which
will fail against an existing tag. Use:

```bash
gh release upload 1.1.0 \
  out/release/Valx.Prose.Writer_1.1.0_universal.dmg \
  out/release/valx-prose-writer.dmg
```

Then re-check the macOS button on <https://natededforver.github.io/valx-writer/download.html>
— no page edit needed, the link is already correct and will simply start
resolving.

---

## 5. Verify on the Mac before you upload

Run the app in the native shell — `npm run tauri:dev`, not a browser preview, or
none of the traffic-light or fullscreen checks mean anything. That covers
5.1-5.5; the DMG install is 5.6.

### 5.1 Traffic lights still clear the chrome

The editor chrome was substantially reworked in this span
(`src/components/Editor.tsx`, +681/-…). The two measurements still come from
`src/hooks/useMacTitleBar.ts` — `TITLE_BAR_BAND = 28` vertical for the sidebar,
`TRAFFIC_LIGHT_INSET = 78` horizontal for the editor — but there are **two**
consumers of the inset, and they are easy to check only one of:

- `Editor.tsx:1430`, the chrome row over an open note. Its height is now
  conditional where it was not before:
  ```tsx
  <div className={`${isTouchUI ? 'h-12' : 'h-9'} flex items-center px-1.5 …`}
       style={{ paddingLeft: trafficLightInset || undefined }}>
  ```
- `Editor.tsx:805`, the fixed `h-10` bar shown with **no note open**. Different
  height, same inset, so it needs its own look.

Check both, in both layouts: **sidebar open** (buttons sit over the sidebar,
which takes the 28px band) and **sidebar hidden** (buttons sit over the editor,
which takes the 78px inset). Nothing may overlap the close/minimise/zoom
buttons, and no control may be unclickable underneath them.

### 5.2 The touch layout must not activate

`isTouchUI` gates panel-swipe navigation at `src/App.tsx:285` and
`src/components/Sidebar.tsx:190`, and roughly twenty layout branches in
`Editor.tsx` / `NoteList.tsx`. On a Mac it must be `false`. Concretely: a
two-finger trackpad swipe across the editor must **not** navigate panels, the
menu-bar row must render at `h-9` not `h-12`, and keyboard-shortcut labels must
be visible in menus (`Editor.tsx:510` hides them under `isTouchUI`).

Check in the console: `matchMedia('(pointer: coarse)').matches` → `false`.

### 5.3 ⌘ shortcuts and fullscreen

`src/lib/platform.ts` renders every menu accelerator as a glyph on macOS.
Spot-check that menu labels read `⇧⌘O` / `⌘,` and not `Ctrl Shift O`, and that
the Fullscreen row shows `⌘↩` (`Editor.tsx:599`) and actually toggles — the
window side of that toggle is the effect at `src/App.tsx:335-337`, which calls
`setFullscreen` on the Tauri window. Also confirm the native View ▸ Enter Full
Screen item still works, and that `useMacTitleBar`'s `nativeFullscreen` zeroes
the band and inset once the traffic lights go away.

### 5.4 The slop-detector recut

`9b778f2` replaced one crimson→indigo ramp shared by all provenance types with
three per-provenance ramps sampled off `sd-texture.png` (AI = crimson, web and
clipboard paste = purple, human = indigo), each a closed loop so the
`:nth-of-type` wrap from step 8 back to step 1 is the same size as every other
step. It was verified on Windows by reading `getComputedStyle` off real marks.
On the Mac just confirm it *reads* right: mark text of each provenance, check
that AI never goes purple, that web and paste look identical to each other, and
that the Creators-menu hide toggles still work **in both light and dark mode** —
the commit message flags dark mode specifically, because the old hide rules were
surviving on a specificity tie that the new `[data-slop]` selectors would have
broken.

### 5.5 The merge confirmation — a desktop change hiding in an Android commit

`3e50fef` routed **every** merge path through one confirmation dialog, and the
desktop drop is explicitly named in its message as the path that "never asked".
So this is behaviour a Mac user sees, not phone work.

`src/App.tsx` now holds `pendingMerge` state with `requestMerge` (validates and
opens the dialog) and `runMerge` (does the work), and the editor-drop handler is
`onMergeNotes={(sourceIds) => requestMerge(sourceIds, activeNoteId)}`. The old
inline handler that merged immediately is gone.

On the Mac, with a mouse or trackpad: drag a note onto another note, and drag a
note onto the open editor. Both must raise a confirmation naming the target and
stating that the originals go to the trash, and **nothing may be merged or
trashed until it is accepted**. Cancel must leave both notes intact.

### 5.6 Install from the DMG

Open the DMG, drag to Applications, launch from Applications (not from the
mount). First launch on an unsigned build needs right-click → Open. Then confirm
the window comes up with the splash dismissed, a workspace can be picked through
the native folder panel, and `.attachments` / `.trash` are created inside it
(§3.4).

---

## 6. Worth fixing while you are there


**`.github/workflows/build.yml` has no macOS job.** That is the reason §3.1 and
§3.3 are manual work in this document rather than something CI already proved.
A `macos-latest` copy of the existing `rust` job — same cache block, same
`cargo check --locked --all-targets` — closes the gap permanently and costs one
runner. The frontend job is platform-agnostic and does not need duplicating.

**One asset name instead of two.** §4.1's duplication is a patch over a real
disagreement, not a design. The better end state is the stable name alone, with
`site/download.html` pointing at `/releases/latest/download/valx-prose-writer.dmg`
the way `README.md` already does — then a release never has to touch that page,
and the class of bug where the download button still offers 1.0.7 four releases
later stops existing. It was left alone here because editing a published page is
not something to do from inside a release script, and because the Windows and
macOS halves of 1.1.0 should ship matching pairs of assets.

---

## 7. Definition of done

- [ ] `cargo check --locked --all-targets` passes on macOS
- [ ] `./scripts/release.sh` produces a universal DMG; `lipo -archs` shows both slices
- [ ] §5.1-§5.5 verified in the running app
- [ ] `Valx.Prose.Writer_1.1.0_universal.dmg` **and** `valx-prose-writer.dmg`
      uploaded to the existing release `1.1.0` (§4.1)
- [ ] The macOS button on the live download page resolves, and so does the
      macOS row of the README's download table
- [ ] `macos-port` fast-forwarded to `main`, or deleted — it has never carried
      work of its own and this is the second handoff to have to say so
