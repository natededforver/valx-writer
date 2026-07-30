// ---------------------------------------------------------------------------
// One touch, one gesture.
//
// Two listeners sit on the same touch: the sidebar's long-press drag
// (lib/touchDrag.ts) and the app root's panel swipe (lib/swipe.ts). They are on
// different elements, so the browser hands the sequence to both, and each used
// to decide on its own whether the gesture was theirs. When they both said yes
// — a note carried sideways onto a folder is also 64px of horizontal travel —
// the note was filed *and* the app navigated to the editor, which reads as the
// drag having been interrupted by the note opening.
//
// `defaultPrevented` on touchend covers the ordinary case (the drag calls
// preventDefault there), but not a drag Android cancels out from under us: a
// touchcancel has no default to prevent, and the swipe would still be holding a
// live start point. So the claim is explicit and outlives the event that sets
// it — released a tick later, after the same sequence's listeners have all run.
//
// Deliberately not React state: this is read inside a touch handler, in the
// same dispatch as the one that sets it, and a re-render is both too slow and
// entirely beside the point.
// ---------------------------------------------------------------------------

let claimed = false;
let release = 0;

/** Take the current touch sequence. Nothing else may act on it. */
export function claimTouchGesture(): void {
  if (release) { clearTimeout(release); release = 0; }
  claimed = true;
}

/**
 * Give it back once this sequence's listeners have finished.
 *
 * The timeout is what makes this work: the claimant's own listener is on a
 * descendant, so it runs *before* the ones that have to see the claim. Clearing
 * synchronously would clear it before anybody read it.
 */
export function releaseTouchGesture(): void {
  if (!claimed || release) return;
  release = window.setTimeout(() => { claimed = false; release = 0; }, 0);
}

/** True while another gesture owns the touch in flight. */
export const touchGestureClaimed = (): boolean => claimed;
