// ---------------------------------------------------------------------------
// Host-platform detection and shortcut rendering.
//
// The app's chrome is drawn by the renderer on every platform, so the renderer
// is where the platform differences land: Windows gets the caption buttons it
// draws itself (decorations:false), macOS gets native traffic lights floating
// over an inset title bar (titleBarStyle "Overlay", see tauri.macos.conf.json)
// and ⌘-glyph shortcut labels.
//
// Detection is by user-agent rather than @tauri-apps/plugin-os so this stays
// synchronous — the menus render shortcut labels during the first paint, and an
// async platform() would make every label flicker from Ctrl to ⌘. WKWebView
// always reports "Macintosh; Intel Mac OS X" (Apple Silicon included), so the
// substring test is stable. Also true in a Mac browser running `npm run dev`,
// which is what we want: the preview should look like the host it runs on.
// ---------------------------------------------------------------------------

export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

// The traffic-light measurements live in hooks/useMacTitleBar.ts, next to the
// fullscreen state they depend on — this module stays React-free so non-UI
// callers (share.ts) can import it.

// Modifier token -> macOS glyph. Order below (control, option, shift, command)
// is the order Apple renders them in, and menu labels are expected to match.
const GLYPH: Record<string, string> = {
  ctrl: '⌘', // the app's Ctrl bindings all accept Meta too — see the keydown
  cmd: '⌘',  // handlers, which test (e.ctrlKey || e.metaKey)
  shift: '⇧',
  alt: '⌥',
  option: '⌥',
};
const ORDER = ['⌃', '⌥', '⇧', '⌘'];

/**
 * Render a shortcut for the host platform.
 *   accel('Ctrl Shift O') -> 'Ctrl Shift O' on Windows/Linux, '⇧⌘O' on macOS
 *   accel('F11')          -> 'F11' everywhere (no modifiers to translate)
 * Unknown tokens pass through as the key, so 'Ctrl ,' renders '⌘,'.
 */
export function accel(spec: string): string {
  if (!isMac || !spec) return spec;
  const mods: string[] = [];
  const keys: string[] = [];
  for (const token of spec.split(/\s+/).filter(Boolean)) {
    const glyph = GLYPH[token.toLowerCase()];
    if (glyph) mods.push(glyph);
    else keys.push(token.length === 1 ? token.toUpperCase() : token);
  }
  mods.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return mods.join('') + keys.join('');
}

/** Inline "press ⌘V" / "press Ctrl+V" fragment for prose (share hints). */
export const pasteChord = isMac ? '⌘V' : 'Ctrl+V';
