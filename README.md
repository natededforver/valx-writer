<div align="center">
  <img src="site/logo.png" alt="Valx Prose Writer logo" width="120" />

  # Valx Prose Writer

  **A minimalist, local-first writing app. Your words, your disk.**

  No accounts. No subscriptions. Every note is a real
  file, in a folder you choose, on your machine.

  [Download for Windows](#download) · [Features](#features) · [Building from source](#building-from-source)
</div>

<!-- SCREENSHOT: hero shot of the editor in dark mode -->
<!-- <img src="docs/screenshots/editor-hero.png" alt="Valx editor" width="800" /> -->

---

## Download

Grab the latest build from [**GitHub Releases**](https://github.com/natededforver/valx-writer/releases/latest):

| Build | What it is |
|---|---|
| `Valx Prose Writer_x.x.x_x64-setup.exe` | NSIS installer — installs to your user profile, adds a Start Menu entry, clean uninstall. |
| `valx-prose-writer-portable-windows.zip` | Portable — unzip and run `valx-prose-writer.exe` anywhere, no install, no admin rights. |

Windows only for now (built with [Tauri](https://tauri.app/) — a Rust/WebView2 shell, not Electron, so the app is a few MB, not a few hundred).

<!-- VIDEO: 30-second install + first-run walkthrough -->
<!-- <video src="docs/screenshots/install-demo.mp4" controls width="800"></video> -->

## Features

### Writing
- **Live markdown** — type `#` for headings, `**bold**`, `*italic*`, `~~strike~~`, lists, tables, code blocks; renders as you type, saved to disk as clean markdown (or `.txt`/`.html`, your choice).
- **Slash menu** (`/`) — quick-insert headings, lists, tables, dividers, and media without leaving the keyboard.
- **Full markdown source mode** — drop into raw markdown when you want it.
- **Rich media** — drag images, audio, and video straight into a note; files are referenced from disk, not bloated into the note itself.
- **Word count**, spellcheck (native OS spellcheck via the system webview), and a slash-anchored formatting toolbar.

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
Select any text and mark it as written by **you**, by **AI**, or sourced from **another website** (with an auto-appended reference line) — so a note can honestly show what's yours and what isn't. On Windows this lives right inside the native right-click menu, next to spellcheck suggestions.

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

```
npm install
npm run tauri:dev     # run the desktop app in dev mode
```

Other useful commands:

- `npm run dev` — Vite dev server only, in a regular browser tab (uses the Web File System Access API instead of the desktop bridge — handy for quick UI iteration).
- `npm run lint` — TypeScript type check.
- `node --import tsx --test src/lib/*.test.ts` — unit tests for the pure logic modules.
- `npm run tauri:build` — full production build: NSIS installer + portable `.exe` in `src-tauri/target/release/`.

Tagged pushes (`vX.Y.Z`) trigger [`.github/workflows/release.yml`](.github/workflows/release.yml), which builds both artifacts and publishes them to GitHub Releases automatically.

## Website

The landing site (landing page + download page) lives in [site/](site/) as plain static HTML/CSS.

## License

Polyform Noncommercial 1.0.0. See [LICENSE](LICENSE).
