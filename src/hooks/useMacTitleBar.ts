// ---------------------------------------------------------------------------
// Space the macOS traffic lights need from the app's own chrome.
//
// The window is decorated on macOS (titleBarStyle "Overlay", see
// tauri.macos.conf.json), so AppKit draws the close/minimise/zoom buttons over
// the top-left of the *window* — which is whichever pane happens to be leftmost,
// not the editor. With the sidebar open that is the sidebar, so the clearance
// has to follow the layout rather than live on one component.
//
// Two measurements, because the two panes clear the buttons differently:
//
//   band  – vertical. The sidebar's content is a full-width column (greeting,
//           search, note list); insetting it horizontally would leave a ragged
//           notch. Instead everything shifts down by one title-bar height and
//           the buttons get their own empty strip, which is what every Mac app
//           with a source list does.
//   inset – horizontal. The editor's title bar is a single row of controls, so
//           when the editor IS leftmost (sidebar hidden) it just starts further
//           in, next to the buttons rather than under them.
//
// Both collapse to 0 off macOS, and in native fullscreen where AppKit takes the
// traffic lights away entirely.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '../lib/desktop';
import { isMac } from '../lib/platform';

/** Standard macOS title-bar height. The traffic lights are vertically centred
 *  in this band, so matching it is what makes the strip read as a title bar
 *  rather than as padding that happens to be about the right size. */
export const TITLE_BAR_BAND = 28;

/** Horizontal room for three 12px buttons at a 20px inset with 8px gaps, plus
 *  a little air before whatever the app draws next. */
export const TRAFFIC_LIGHT_INSET = 78;

/** Height the auto-hidden system menu bar occupies while revealed in native
 *  fullscreen. 24pt is the standard bar; displays with a notch reserve more, so
 *  on those the app's chrome sits a few points higher than the bar's underside.
 *  Cosmetic and only during the hover reveal — worth far less than the layout
 *  thrash of measuring it live. */
export const MENU_BAR_REVEAL = 24;

export interface MacTitleBar {
  /** Height of the drag strip to put above a leftmost pane's content. */
  band: number;
  /** Left padding for a leftmost pane that lays its controls out in a row. */
  inset: number;
  /** True while the window is in native (green-button) fullscreen. */
  nativeFullscreen: boolean;
}

/**
 * @param leftmost whether the calling pane is currently the left edge of the
 *   window. A pane that isn't gets zeroes — the buttons are somebody else's
 *   problem.
 */
export function useMacTitleBar(leftmost: boolean): MacTitleBar {
  // Tauri has no fullscreen-changed event, but the transition always resizes
  // the window, so onResized is the signal. Subscribed once per caller; the
  // listener is cheap and this keeps the hook self-contained.
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  useEffect(() => {
    if (!isTauri || !isMac) return;
    const win = getCurrentWindow();
    const sync = () => { void win.isFullscreen().then(setNativeFullscreen).catch(() => {}); };
    sync();
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    win.onResized(sync).then((fn) => { if (cancelled) fn(); else unlisten = fn; }).catch(() => {});
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  const active = isTauri && isMac && leftmost && !nativeFullscreen;
  return {
    band: active ? TITLE_BAR_BAND : 0,
    inset: active ? TRAFFIC_LIGHT_INSET : 0,
    nativeFullscreen,
  };
}
