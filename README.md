<div align="center">
  <img src="site/logo.png" alt="Valx Prose Writer logo" width="120" />

  # Valx Prose Writer

  **A minimalist, local-first writing app. Your words, your disk.**

  No accounts. No subscriptions. Every note is a real
  file, in a folder you choose, on your machine.

  [Download](#download) · [Features](#features) · [Building from source](#building-from-source)
</div>

<!-- SCREENSHOT: hero shot of the editor in dark mode -->
<!-- <img src="docs/screenshots/editor-hero.png" alt="Valx editor" width="800" /> -->

---

## Download

Grab the latest build from [**GitHub Releases**](https://github.com/natededforver/valx-writer/releases/latest):

| Build | What it is |
|---|---|
| `Valx Prose Writer_x.x.x_x64-setup.exe` | **Windows** — NSIS installer, installs to your user profile, adds a Start Menu entry, clean uninstall. |
| `valx-prose-writer-portable-windows.zip` | **Windows** — portable; unzip and run `valx-prose-writer.exe` anywhere, no install, no admin rights. |
| `valx-prose-writer.dmg` | **macOS 11+** — universal (Apple Silicon + Intel); drag to Applications. |
| `valx-prose-writer-mac.zip` | **macOS 11+** — the same `.app`, zipped, for anyone who'd rather not mount a disk image. |

Built with [Tauri](https://tauri.app/) — a Rust shell over the OS's own webview (WebView2 on Windows, WKWebView on macOS), not Electron, so the app is a few MB, not a few hundred.

If the macOS build isn't notarized yet, Gatekeeper will refuse the first launch;
right-click the app and choose **Open** once to get past it.

<!-- VIDEO: 30-second install + first-run walkthrough -->
<!-- <video src="docs/screenshots/install-demo.mp4" controls width="800"></video> -->

## Features

### Writing
- **Live markdown** — type `#` for headings, `**bold**`, `*italic*`, `~~strike~~`, lists, tables, code blocks; renders as you type, saved to disk as clean markdown (or `.txt`/`.html`, your choice).
- **Slash menu** (`/`) — quick-insert headings, lists, tables, dividers, and media without leaving the keyboard.
- **Full markdown source mode** — drop into raw markdown when you want it.
- **Rich media** — drag images, audio, and video straight into a note; files are referenced from disk, not bloated into the note itself.
- **Word count**, spellcheck (the app's own Hunspell-compatible checker with bundled en/fr/de/it/es dictionaries — identical on every platform, not whatever the OS webview happens to ship), and a slash-anchored formatting toolbar.

<!-- SCREENSHOT: slash menu open in a note -->

### Organization
- **Folders (Groups)**, **tags**, **search** (jump straight to the matching word in a note), and **bookmarks** for quick access.
- **Trash** with confirmation before permanent delete.
- Multi-select notes for bulk move/delete.
- Resizable, collapsible sidebar and preview rail; double-click a rail to snap it fullscreen.

<!-- SCREENSHOT: sidebar with folders, tags, bookmarks expanded -->

### World Mode
A visual canvas for planning: drag out nodes, connect them, arrange your story/project spatially instead of linearly. Every mutation is undo/redo-safe.

<!-- SCREENSHOT: World Mode canvas with a few connected nodes -->

### Slop detector ("Mark as")
Select any text and mark it as written by **you**, by **AI**, or sourced from **another website** (with an auto-appended reference line) — so a note can honestly show what's yours and what isn't. It lives in the editor's right-click menu, alongside the spelling suggestions and Add to Dictionary — same menu, same place, on Windows and macOS.

<!-- SCREENSHOT: native context menu showing the Mark as submenu -->

### Format freedom
- Convert your whole workspace (or just the note you have open) between `.md`, `.txt`, `.html`, and `.docx` in one click.
- Export any note to PDF, DOCX, or ODT.
- Obsidian-style tables and file-chip attachments read and write correctly round-trip.

### Themes & appearance
- Dark mode by default, full light mode by toggle.
- Frameless, custom title bar with native-feeling window controls.

<!-- SCREENSHOT: settings panel / theme picker -->

### Sync, your way
Point your workspace folder at Google Drive, Dropbox, or Mega, and syncing happens automatically through that service's own desktop client — no account with Valx, ever. Or stay fully offline.

For OneDrive specifically, Valx can sync directly: sign in with your Microsoft account in Settings and Valx pulls and pushes your workspace on demand, resolving conflicts by newest edit — no OneDrive desktop client required.

### Free, forever
No subscriptions, no paywalls, no telemetry.

## Building from source

Prerequisites: [Node.js](https://nodejs.org/) 20+, npm, and the [Rust toolchain](https://www.rust-lang.org/tools/install) (for the desktop shell).
On macOS the **Command Line Tools** are enough (`xcode-select --install`) — full
Xcode is not required, since Tauri assembles the `.app` and `.dmg` itself rather
than driving `xcodebuild`. Notarizing needs `xcrun notarytool`, which recent
Command Line Tools ship; if your `xcrun` can't find it, install Xcode.

```
npm install
npm run tauri:dev     # run the desktop app in dev mode
```

Other useful commands:

- `npm run dev` — Vite dev server only, in a regular browser tab (uses the Web File System Access API instead of the desktop bridge — handy for quick UI iteration).
- `npm run lint` — TypeScript type check.
- `node --import tsx --test src/lib/*.test.ts` — unit tests for the pure logic modules.
- `npm run tauri:build` — full production build for the host platform: NSIS installer + portable `.exe` on Windows, `.app` + `.dmg` on macOS, under `src-tauri/target/release/bundle/`.
- `npm run mac:release` — macOS release build ([`scripts/release.sh`](scripts/release.sh)): typecheck, universal `.app` + `.dmg`, stable asset names in `out/release/`. Pass `--publish` to push them to GitHub Releases. The Windows counterpart is [`scripts/release.ps1`](scripts/release.ps1).

Platform differences live in [`src-tauri/tauri.macos.conf.json`](src-tauri/tauri.macos.conf.json),
which Tauri merges over `tauri.conf.json` automatically when the host is macOS —
the base config stays the Windows one, so a Windows build is byte-for-byte
unaffected by anything in the macOS overlay.

Tagged pushes (`vX.Y.Z`) trigger [`.github/workflows/release.yml`](.github/workflows/release.yml), which builds both artifacts and publishes them to GitHub Releases automatically.

## Website

The landing site (landing page + download page) lives in [site/](site/) as plain static HTML/CSS.

## License

Polyform Noncommercial 1.0.0. See [LICENSE](LICENSE).
