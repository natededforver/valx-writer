// ---------------------------------------------------------------------------
// Horizontal swipe navigation for the touch build — the gesture that lets the
// phone drop the tab bar iA Writer for Android never had either.
//
// Three panels sit side by side, and a swipe moves between them in the
// direction they lie:
//
//     NOTE LIST  ◀──────  EDITOR  ──────▶  MENU PANEL
//                swipe →          swipe ←
//
// An earlier version only accepted two-finger drags, plus one-finger drags
// that started off editable text, on the theory that claiming a one-finger
// horizontal drag over prose would break caret and selection dragging. In
// practice it broke the gesture instead: the editor is nearly all editable
// text, so in the one view where swiping matters most there was almost nowhere
// left to start one, and two fingers is not a gesture anybody discovers.
//
// A plain horizontal drag over text does nothing in an Android WebView — the
// caret moves on tap, and selection dragging starts from the native handles,
// which are drawn outside the page. So a one-finger swipe is free to take, and
// it is taken here anywhere in the app.
//
// The guard that remains is on the shape of the gesture, not where it starts:
// THRESHOLD px of horizontal travel with vertical drift under SLOPE times that.
// A scroll that wanders sideways is not a swipe, and neither is a tap.
// ---------------------------------------------------------------------------
import { useEffect } from 'react';
import { touchGestureClaimed } from './gestureClaim';

const THRESHOLD = 64;   // px of horizontal travel before a swipe counts
const SLOPE = 0.55;     // max |dy| as a fraction of |dx| — keeps scrolls out

/** Elements that own their own horizontal dragging and must keep it. */
const CLAIMS_HORIZONTAL = 'input[type="range"], .vx-no-swipe';

export interface SwipeHandlers {
  /** Swipe right-to-left (finger moves left) — "forward". */
  onLeft?: () => void;
  /** Swipe left-to-right (finger moves right) — "back". */
  onRight?: () => void;
  /** Set false to detach without changing the call site's hook order. */
  enabled?: boolean;
}

export function useHorizontalSwipe(
  target: React.RefObject<HTMLElement | null>,
  { onLeft, onRight, enabled = true }: SwipeHandlers
): void {
  useEffect(() => {
    const el = target.current;
    if (!el || !enabled) return;

    // Null between gestures, and for any touch that started somewhere a swipe
    // must not begin. Multi-touch is dropped outright: a second finger means a
    // pinch or a scroll-with-two, not navigation.
    let start: { x: number; y: number } | null = null;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1) { start = null; return; }
      const target = e.target;
      if (target instanceof Element && target.closest(CLAIMS_HORIZONTAL)) { start = null; return; }
      start = { x: t.clientX, y: t.clientY };
    };

    const onEnd = (e: TouchEvent) => {
      const s = start;
      start = null;
      if (!s) return;
      // Somebody nearer the touch already claimed this gesture — today that is
      // the sidebar's long-press drag (lib/touchDrag.ts). A note carried
      // sideways into a folder is also 64px of horizontal travel, and it must
      // not ALSO navigate to the next panel.
      //
      // This used to read `e.defaultPrevented`, on the strength of the drag
      // preventDefaulting its touchend. That is no longer the right signal in
      // either direction: the drag now preventDefaults *every* sequence that
      // begins on a note row (to stop the browser synthesising a click that
      // would open the note behind the gesture's back), while a drag Android
      // cancels mid-flight has no touchend to prevent at all. The claim says
      // what defaultPrevented only used to imply — a drag actually lifted, so
      // this touch is spoken for — and a press on a row that never became one
      // is still free to swipe, which is how you leave the list.
      if (touchGestureClaimed()) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < THRESHOLD || Math.abs(dy) > Math.abs(dx) * SLOPE) return;
      (dx < 0 ? onLeft : onRight)?.();
    };

    const onCancel = () => { start = null; };

    // Passive: the handlers never preventDefault (a swipe that also scrolled a
    // little is still a swipe), and a non-passive touch listener over the
    // editor would cost scroll smoothness on a low-end phone for nothing.
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    };
  }, [target, onLeft, onRight, enabled]);
}
