# macOS handoff — ship Valx 1.0.6 for Mac

Written for a model starting **cold** on a Mac. Assume no memory of the Windows
session. Everything needed is here or cited by `file:line`.

---

## 0. The headline: there is no port to do

**`macos-port` contains zero commits that are not already in `main`.**

```bash
git merge-base --is-ancestor origin/macos-port origin/main   # exits 0 → contained
git log --oneline origin/main..origin/macos-port             # prints nothing
```

`macos-port` is a stale feature branch. Its work was merged into `main` twice
already (PRs #1 `a2ba014` and #2 `9952d28`). Every macOS capability — native
menu bar, traffic-light insets, `tauri.macos.conf.json`, `release.sh` — lives in
`main` today.

**So do not cherry-pick, do not rebase, do not port anything.** The four new
commits are plain CSS/TSX with no platform branching. The job is: sync, build,
verify how they *render* on macOS, ship the DMG.

If you want `macos-port` to stop being misleading, fast-forward it (§5) — but
building from `main` is the supported path and what `release.sh` expects.

---

## 1. What changed (the four commits on top of `9952d28`)

| SHA | Change |
|---|---|
| `f35a2e6` | Valuex writing font, new logo everywhere, split-glow greeting |
| `2e99172` | Drop the root `Valuex-Regular.ttf` duplicate |
| `e7c1bf9` | **Superseded — see warning below** |
| `96e6df2` | SF Pro for UI + note titles, bin emoji in the trash |

> **Do not read `e7c1bf9` as current intent.** It briefly pointed `--font-sans`
> at Valuex (UI in the house font). That was wrong and `96e6df2` replaced it
> with the SF Pro stack. Only the *net* state of `main` is correct. If you are
> reasoning from `git log -p`, read `96e6df2` last.

### 1.1 Fonts — two faces, strictly separated

`src/index.css:65` — UI chrome **and** the note title:

```css
--font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display',
             'SF Pro', system-ui, 'Segoe UI', 'Valx Helvetica', Helvetica, Arial,
             Roboto, sans-serif;
```

`src/index.css:68` — the writing surface **only**:

```css
--vx-editor-font: 'Valuex', 'Valx Mono', 'Lucida Console', Consolas, monospace;
```

Valuex is bundled and declared at `src/index.css:41-48`
(`src/assets/fonts/Valuex-Regular.ttf`, Regular only — there is no bold cut).

**The intent, stated plainly so you don't re-litigate it:** the note title is a
sans and the UI must match that sans. Valuex is for the editor body and nothing
else. The title element (`src/components/Editor.tsx:1357`, the
`placeholder="Title"` textarea) has no font of its own — it *inherits*
`--font-sans`. That inheritance is the mechanism; don't "fix" it by setting a
font on the title directly.

> `.vx-editor-title` at `src/index.css:211` is **dead CSS** — the class is
> declared but applied to nothing. Leave it or delete it, but do not assume it
> styles the title.

### 1.2 SF Pro will look different on your machine — that is correct

Apple's licence forbids redistributing the SF Pro files, so nothing is bundled.
The stack resolves per-platform:

- **macOS (you):** `-apple-system` → **genuine SF Pro**. This is the reference
  rendering the user asked for.
- **Windows:** falls through to **Segoe UI**, then bundled Helvetica.

The two platforms will *not* be pixel-identical in the chrome, by design. Do not
bundle an SF Pro `.ttf` to force parity — that is a licence violation. If the
user later wants true parity they must supply the files deliberately.

### 1.3 Trash

- `src/components/Sidebar.tsx:522` — section icon is the **lucide `Trash2`
  outline**, deliberately not an emoji.
- `src/components/Sidebar.tsx:537` — Empty-bin button, **🗑️ emoji**. Rendered
  only when `trashedNotes.length > 0`.
- `src/components/NoteList.tsx:171` — per-note permanent delete, **🗑️ emoji**;
  restore beside it stays the lucide `RotateCcw`.
- `src/components/NoteList.tsx:155` — the trash row actions no longer wait for
  hover (the `opacity-0 group-hover:opacity-100` was dropped).

**The one-emoji rule:** the Trash header row must show **exactly one** emoji
(the Empty-bin button). An earlier revision had the section icon as an emoji
too and the user rejected two side-by-side as cluttered. If you touch that row,
preserve the count.

On macOS 🗑️ renders as **Apple's wastebasket** — that was the actual request
("macOS bin emoji"). It will look different from the Windows/Segoe glyph. Correct.

### 1.4 Greeting

`src/index.css:312` (light) and `:321` (dark). Layered `text-shadow`: a pink
ghost offset `1.5px` to the right sitting behind the glyphs, plus a soft yellow
outer glow blended over it. Tuned twice by the user — **do not restyle it**.
Verify it survives WebKit; only touch it if WebKit visibly breaks it (§4.4).

### 1.5 Icon

Regenerated from `valx new logo.png` via `npx tauri icon`, covering
`src-tauri/icons/` (incl. `icon.icns`), `public/main.ico`,
`public/valx-splash.png`, `src/assets/images/main.png`. **Already committed —
do not re-run `tauri icon`.** Re-running rewrites 50+ binaries for no gain and
makes a noisy diff.

### 1.6 Menus

Category/section headers were removed from every in-app menu (Alignment,
Counters, Appearance, Creator, Human authors, Highlight by source); dividers do
the grouping now. The `sectionCls` constant is gone from
`src/components/Editor.tsx`.

**The native macOS menu bar (`src-tauri/src/macos_menu.rs`) needs no change** —
it is built from `PredefinedMenuItem`s and `Submenu`s and never had text
category headers. Verified by inspection; do not go looking for labels to strip.

---

## 2. Preconditions

```bash
node --version    # 20+
cargo --version   # rustup.rs
xcrun --show-sdk-path   # Command Line Tools: xcode-select --install
```

Full Xcode is **not** required — Tauri assembles `.app`/`.dmg` with
`hdiutil`/`codesign` from the base system. `release.sh` deliberately does not
check for `xcodebuild`.

Signing is optional. Unsigned builds work; Gatekeeper forces right-click → Open
on first launch. To sign, export before running:

```
APPLE_SIGNING_IDENTITY="Developer ID Application: Name (TEAMID)"
APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID          # app-specific password
# or APPLE_API_KEY / APPLE_API_ISSUER / APPLE_API_KEY_PATH
```

Tauri reads these itself; `release.sh` only reports which mode it is in.

---

## 3. Build order

```bash
git fetch origin
git checkout main
git pull --ff-only origin main       # expect 96e6df2 or later
npm ci
npm run lint                         # tsc --noEmit — must be clean
```

Then, before packaging, **verify in the running app** (§4) — packaging a
universal binary is slow and there is no point doing it twice:

```bash
npm run tauri:dev
```

When §4 passes:

```bash
npm run mac:release      # scripts/release.sh — universal .app + .dmg
```

Output: `out/release/valx-prose-writer.dmg`.

The bundle targets resolve correctly on their own: base
`src-tauri/tauri.conf.json:52` says `["nsis"]` (Windows), and
`src-tauri/tauri.macos.conf.json` overrides to `["app","dmg"]`. Tauri merges the
macOS overlay only on a Darwin host. **Do not "fix" the nsis line** — editing it
breaks the Windows build.

Publishing is a separate, explicit step — `release.sh --publish` calls
`gh release create`. **Do not publish unless the user asks.** The download page
and README already point at
`releases/latest/download/valx-prose-writer.dmg`, so no site edit is needed for
a new version.

---

## 4. Verification checklist

Run the app (`npm run tauri:dev`) and confirm each. Report actual observed
values, not "should work".

**4.1 Fonts (the highest-risk item).** In the webview inspector:

```js
const title = document.querySelector('textarea[placeholder="Title"]');
const sidebar = [...document.querySelectorAll('span')]
  .find(s => s.textContent.trim() === 'All Notes');
const body = document.querySelector('.rich-editor');
({
  title:   getComputedStyle(title).fontFamily,
  sidebar: getComputedStyle(sidebar).fontFamily,
  editor:  getComputedStyle(body).fontFamily,
});
```

Pass = `title` and `sidebar` are **identical** and start with `-apple-system`;
`editor` starts with `Valuex`. Then confirm *visually* that the chrome is really
SF Pro (not Helvetica) — a computed-style match alone doesn't prove the face
resolved.

**4.2 Trash.** Trash a note. Confirm: exactly **one** 🗑️ in the Trash header
row; it is Apple's bin glyph; per-note **restore + 🗑️ delete** are visible
**without hovering**.

**4.3 Empty bin — expect it to WORK here.**

> Known trap, already investigated: in a **browser** preview this appears
> broken. `confirmDestructive` (`src/lib/desktop.ts:60-67`) falls back to
> `window.confirm` off-Tauri, and automated preview panes auto-dismiss it
> (returns `false` in ~3ms), so the action silently cancels. **Not an app bug** —
> confirmed by state diff: with the confirm forced true, trash count went
> `1 → 0`. In the Tauri app it uses the native dialog. If it fails *in the
> native app*, that is new and real — investigate `emptyTrash`
> (`src/hooks/useNotes.ts:780`) and `onEmptyTrash` (`src/App.tsx:293`).

Click 🗑️ → native warning dialog → confirm → trash empties, button disappears.

**4.4 Greeting.** Sidebar header shows the pink ghost offset right + yellow
glow. WebKit renders multi-layer `text-shadow` slightly differently from
Chromium; pass = the layering reads as intended, not pixel-equality with Windows.

**4.5 Icon.** New logo in Dock, `.app` icon in Finder, and the splash window.
If Finder shows a stale icon that is Finder's cache, not the build — verify from
the freshly-mounted DMG.

**4.6 macOS regressions from the merge** (these predate the new commits but the
DMG ships them): traffic lights + inset behaviour, native menu bar, Cmd+Q /
Cmd+W / Cmd+M, Preferences from the App menu.

**4.7 Universal binary.** `release.sh` runs `lipo -archs` — confirm both
`x86_64` and `arm64` appear. A silently single-arch build is the exact failure
that check exists for.

---

## 5. Optional: retire the stale branch

Only if the user asks. `macos-port` is strictly behind `main`, so it is a clean
fast-forward with nothing to merge:

```bash
git push origin origin/main:macos-port
```

---

## 6. Out of scope — do not do these

- **Do not port, cherry-pick, or rebase** anything between the branches (§0).
- **Do not bundle SF Pro** or otherwise force Windows/macOS font parity (§1.2).
- **Do not re-run `npx tauri icon`** — icons are committed (§1.5).
- **Do not restyle the greeting** — user-tuned twice (§1.4).
- **Do not add a second emoji** to the Trash header (§1.3).
- **Do not edit `bundle.targets` in the base `tauri.conf.json`** (§3).
- **Do not publish a GitHub release** unless asked (§3).
- **Do not bump the version.** It is 1.0.6 in all three files
  (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`); the
  Windows 1.0.6 installer is already built from this exact source, and the Mac
  DMG must match it.
- **Do not touch Windows paths** — `scripts/release.ps1`, the NSIS block,
  `public/main.ico`.
- **Do not add a Claude co-author trailer** to any commit in this repo.

---

## 7. If verification fails

Root-cause before editing: find the line that produces the symptom and state
the mechanism. Ideal outcome is **zero code changes** — these commits are
platform-neutral and the Windows build of the same source is verified. A macOS
failure most likely means a WebKit-vs-Chromium rendering difference (fonts,
`text-shadow`, emoji metrics), not broken logic. Fix it in a way that keeps
Windows rendering unchanged, and say plainly what you changed and why.
