<div align="center">
  <img src="site/logo.png" alt="Valx Prose Writer logo" width="100" />

  # Valx Prose Writer

  **A minimalist, local-first writing app. Your words, your disk.**

  No accounts. No subscriptions. No telemetry.<br />
  Every note is a real file, in a folder you choose, on your machine.

  [Download](#download) · [Features](#features) · [Build from source](#build-from-source)
</div>

---

## Download

| Platform | Download |
|---|---|
| **Windows** 10 / 11, 64-bit | [`valx-prose-writer-setup.exe`](https://github.com/natededforver/valx-writer/releases/latest/download/valx-prose-writer-setup.exe) |
| **macOS** 11 Big Sur and up | [`valx-prose-writer.dmg`](https://github.com/natededforver/valx-writer/releases/latest/download/valx-prose-writer.dmg) — universal, Apple Silicon & Intel |

Every version lives on the [releases page](https://github.com/natededforver/valx-writer/releases).

Built with [Tauri](https://tauri.app/): a Rust shell over the OS's own webview —
WebView2 on Windows, WKWebView on macOS. A few MB, not a few hundred.

> **First launch.** Windows may ask you to confirm an app from a new publisher —
> choose *More info → Run anyway*. On macOS, right-click Valx in Applications and
> choose *Open* once. Both go away once the builds are signed.

## Features

**Writing.** Live markdown — type `#`, `**bold**`, `*italic*`, `~~strike~~`, lists,
tables, code blocks and watch them render as you type, saved to disk as clean
markdown (or `.txt` / `.html`, your choice). A slash menu (`/`) inserts headings,
lists, tables, dividers and media without leaving the keyboard, and you can drop
into raw markdown source whenever you want it.

**Media.** Drag images, audio and video straight into a note. Files are referenced
from disk, never bloated into the note itself.

**Spellcheck.** The app's own Hunspell-compatible checker with English, French,
German, Italian and Spanish bundled — identical on every platform rather than
whatever the OS webview happens to ship. Add to Dictionary included.

**Organization.** Folders, tags, search that jumps to the matching word, bookmarks,
multi-select for bulk moves, and a trash that asks before deleting for good.

**Provenance ("Mark as").** Select any text and mark it as written by you, by AI,
or sourced from another website — with a reference line appended automatically —
so a note can honestly show what's yours and what isn't. It sits in the editor's
right-click menu next to the spelling suggestions, the same on both platforms.

**Format freedom.** Convert a whole workspace, or one note, between `.md`, `.txt`,
`.html` and `.docx` in a click. Export to PDF, DOCX or ODT. Tables and file-chip
attachments survive the round trip.

**Sync, your way.** Point your workspace at a Google Drive, Dropbox or Mega folder
and their own client handles it — no Valx account, ever. For OneDrive, sign in
under Settings and Valx syncs directly, resolving conflicts by newest edit, with
no OneDrive client required. Or stay entirely offline.

## Platform differences

The app is the same on both; the window it lives in is not.

| | Windows | macOS |
|---|---|---|
| Window | Frameless, app-drawn caption buttons | Native decorations and traffic lights |
| Menus | In-window menu bar | In-window menu bar plus the system menu bar |
| Shortcuts | `Ctrl` | `⌘`, shown with proper glyphs |
| Closing | Closing the window quits | `⌘W` hides, `⌘Q` quits, Dock icon restores |
| Distraction-free | Chrome fades away | Chrome and traffic lights fade; hover the top edge |

Everything that differs lives in
[`src-tauri/tauri.macos.conf.json`](src-tauri/tauri.macos.conf.json), which Tauri
merges over the base config only when the host is macOS. The base config stays the
Windows one, so a Windows build is unaffected by anything in the macOS overlay.

## Build from source

You'll need [Node.js](https://nodejs.org/) 20+ and the
[Rust toolchain](https://www.rust-lang.org/tools/install). On macOS the Command
Line Tools are enough (`xcode-select --install`) — full Xcode is **not** required,
since Tauri assembles the `.app` and `.dmg` itself instead of driving `xcodebuild`.

```bash
npm install
npm run tauri:dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite only, in a browser tab — uses the Web File System Access API instead of the desktop bridge. Quick UI iteration. |
| `npm run lint` | TypeScript type check. |
| `node --import tsx --test src/lib/*.test.ts` | Unit tests for the pure logic modules. |
| `npm run tauri:build` | Production build for the host platform, under `src-tauri/target/release/bundle/`. |
| `npm run mac:release` | macOS release: universal `.app` + `.dmg` with stable asset names in `out/release/`. See [`scripts/release.sh`](scripts/release.sh); the Windows counterpart is [`scripts/release.ps1`](scripts/release.ps1). |

## Website

The landing and download pages live in [site/](site/) as plain static HTML and CSS.

## License

Polyform Noncommercial 1.0.0 — see [LICENSE](LICENSE).
