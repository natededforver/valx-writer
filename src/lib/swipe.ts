// ---------------------------------------------------------------------------
// Horizontal swipe navigation for the touch build (iA Writer for Android's
// gesture, which is the whole reason the phone port doesn't need a tab bar).
//
// The hard part is that the swipe surface IS a contenteditable. A one-finger
// horizontal drag over prose is how Android moves the caret and drags a
// selection handle, so claiming it for navigation would make the editor feel
// broken — text you meant to select would flip you to another note. Hence:
//
//   • two fingers, anywhere (prose included)  -> always a swipe
//   • one finger, but NOT starting on editable text (the note list, the
//     page margins, the title bar)            -> also a swipe
//
// So the list view gets the plain one-finger swipe a list should have, the
// editor gets a two-finger gesture that no text interaction claims, and caret
// dragging is never taken away.
//
// Screen-edge swipes are deliberately NOT used, natural as they'd feel: on
// Android 10+ gesture navigation the edges are the system Back gesture and the
// touch never reaches the webview at all.
//
// Recognition is strict: a swipe has to travel THRESHOLD px horizontally while
// staying under SLOPE times that much vertically, so a diagonal flick during a
// scroll doesn't register.
// ---------------------------------------------------------------------------
import { useEffect } from 'react';

const THRESHOLD = 60;   // px of horizontal travel before a swipe counts
const SLOPE = 0.6;      // max |dy| as a fraction of |dx| — keeps scrolls out

/** True for a touch that landed on text the user can put a caret in. */
const onEditableText = (target: EventTarget | null): boolean =>
  target instanceof Element && !!target.closest('[contenteditable="true"], input, textarea');

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

    // Null between gestures and for any touch that didn't qualify at start —
    // the qualification test runs once, on touchstart, so a gesture can't
    // become a swipe halfway through by lifting a finger.
    let start: { x: number; y: number } | null = null;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      // A second finger landing mid-drag upgrades a one-finger drag that was
      // rejected for being over prose — hence re-qualifying on every
      // touchstart, and re-anchoring to where the two-finger gesture began.
      const qualifies = e.touches.length === 2 || !onEditableText(e.target);
      start = qualifies ? { x: t.clientX, y: t.clientY } : null;
    };

    const onEnd = (e: TouchEvent) => {
      const s = start;
      start = null;
      if (!s) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < THRESHOLD || Math.abs(dy) > Math.abs(dx) * SLOPE) return;
      (dx < 0 ? onLeft : onRight)?.();
    };

    const onCancel = () => { start = null; };

    // Passive: the handlers never preventDefault (a swipe that also scrolled a
    // little is still a swipe), and a non-passive touchmove listener on the
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
