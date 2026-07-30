// ---------------------------------------------------------------------------
// Long-press drag and drop for touch.
//
// The sidebar's existing organisation gestures are HTML5 drag and drop —
// draggable rows, dataTransfer, onDragOver/onDrop. None of those events are
// ever produced by a touchscreen: dragging a finger scrolls, and the drag API
// simply never starts. So on a phone the whole of "put this note in that
// folder" and "drag it to the bin" was unreachable, with the UI still drawn as
// if it were not.
//
// This is the same interaction rebuilt on touch events:
//
//   press and hold on a source     -> the row lifts (a ghost follows the finger)
//   move over a drop target        -> that target highlights
//   hold near the panel's edge     -> the list scrolls, bringing targets up
//   release                        -> the drop fires; release elsewhere cancels
//
// Two things had to be taken away from the browser for that to hold together.
// A long press is also how Android begins a text selection, and the browser
// claiming the gesture fires touchcancel — which killed the drag a fraction of
// a second after the row lifted; the rows carry `.vx-drag-source` (index.css)
// so there is no text to select, and the callout menu and selectstart are both
// preventDefaulted here. And a drag that travels sideways looks exactly like the
// panel-navigation swipe on the app root, so the drop's own preventDefault is
// what tells that listener to stand down (lib/swipe.ts reads defaultPrevented).
//
// None of that makes the cancel impossible — Android still takes a touch it
// decides is its own — so a cancel mid-drag completes the drop rather than
// discarding it (see onCancel). Losing the drag there was worse than it sounds:
// it also un-suppressed the click, so a note carried onto a folder *opened*.
//
// The gesture's two thresholds were measured on a phone, not guessed, and both
// were wrong in the first cut: see HOLD_SLOP (the press cancelled itself before
// it could become a drag) and DROP_TOLERANCE (a thumb cannot hit a 32dp row).
//
//
// ONE TOUCH, ONE OUTCOME
//
// A press on a note row used to be able to produce three things at once: the
// drag, the row's own click (which selects, and selecting is what opens the
// note on a phone — App.tsx drives mobileView off the selection), and the app
// root's panel swipe. Nothing arbitrated between them; they each read the same
// touch and answered independently, so which one you got came down to whether
// the hold timer beat your thumb. Holding a note and dragging it "frequently
// gets interrupted by the note opening" is exactly that race, seen from the
// outside.
//
// So the sequence is partitioned here, once, by two thresholds that tile the
// whole space with no overlap and no gap:
//
//   released under HOLD_MS, travelled <= TAP_SLOP   -> a tap: open the note
//   held past HOLD_MS,      travelled <= HOLD_SLOP  -> a drag: file/bin/merge
//   travelled past HOLD_SLOP before the hold fired  -> not ours: scroll or swipe
//
// The first two are settled here and *nowhere else*: the tap is reported
// through onTap and the synthesised click is suppressed, so a row's onClick can
// no longer open a note behind the drag's back, and a lifted drag claims the
// touch outright (lib/gestureClaim.ts) so the swipe cannot navigate off the
// list mid-drag. The third case is released untouched — that is the one gesture
// this hook does not want.
//
//
// TWO MODES
//
// The number of fingers picks what the drag means, and the two sets of targets
// are disjoint so neither can be reached by accident from the other:
//
//   one finger    move   -> a folder, or the bin
//   two or more   merge  -> another note, or the editor
//
// Dropping a note *onto another note* merges either way — that is what putting
// one on top of another looks like it should do — and every merge is confirmed
// by a dialog before anything is written, because a merge trashes its sources.
//
// Targets and sources are declared in the markup with data attributes rather
// than registered through a context, so a row only has to say what it is and
// the existing desktop handlers keep working untouched beside it:
//
//   data-drag-note="<id>"      a note that can be picked up
//   data-drop-folder="<id>"    a folder that accepts notes ('all' = no folder)
//   data-drop-trash            the bin
//   data-drop-note="<id>"      a note that accepts notes (merge)
//   data-drop-editor           the open note / the editor (merge)
//
// The hit test is elementFromPoint on every move, not a cached list of target
// rectangles: the sidebar scrolls, folders expand, and a cached rectangle would
// silently start pointing at the wrong row.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import { claimTouchGesture, releaseTouchGesture } from './gestureClaim';

/** Hold before a press becomes a drag. Long enough not to fire while the user
 *  is starting a scroll, short enough not to feel broken — and short of the
 *  ~500ms at which Chrome's own long press would otherwise fire. */
const HOLD_MS = 300;
/**
 * Movement during the hold that cancels it — that finger is scrolling.
 *
 * In CSS px, which on a phone is a dp: 1080 device px / 2.75 dpr = 393 CSS px
 * across, and the viewport is 393dp wide. So this is a physical distance, and
 * the old value of 12 was about 1.9mm at 440dpi — tighter than a thumb can hold
 * still for a third of a second. Measured on the emulator, the lift survived 8
 * CSS px of wander and died at 12, which is why the gesture read as broken: the
 * press cancelled itself before it ever became a drag.
 *
 * 22 is roughly 3.5mm, past a resting thumb's wobble and still well short of
 * the deliberate travel that means "I am scrolling this list".
 */
const HOLD_SLOP = 22;
/**
 * Travel a quick press may have and still count as a tap.
 *
 * Tighter than HOLD_SLOP on purpose. The gap between them is a press that
 * wandered too far to be a tap but not far enough to have been a scroll, and
 * that press now does nothing at all — which is the right answer: those are the
 * flicks that used to open a note the user was only scrolling past. Roughly
 * where a browser's own click slop sits, so a tap still feels native.
 */
const TAP_SLOP = 14;
/**
 * How far from a drop target a release still counts as landing on it.
 *
 * A folder row is 32dp tall; a thumb's contact patch is bigger than that, and
 * the point Android reports is its centroid rather than where the user thinks
 * they are pointing. Releasing "on" a folder therefore lands in the gap between
 * rows a good part of the time, and an exact hit test answers "nothing here" —
 * a drop that silently does nothing, which is indistinguishable from the whole
 * feature being broken. So a miss looks for the nearest target within this many
 * px vertically before giving up.
 */
const DROP_TOLERANCE = 26;
/** Distance from a scroller's edge at which a held note starts scrolling it. */
const EDGE = 56;
/** Fastest edge scroll, px per frame, reached at the very edge. */
const EDGE_SPEED = 14;

/** What the drag will do when it lands. Fixed by the number of fingers. */
export type TouchDragMode = 'move' | 'merge';

export interface TouchDropTarget {
  kind: 'folder' | 'trash' | 'note' | 'editor';
  /** Folder or note id, 'all' for the no-folder root, '' for bin and editor. */
  id: string;
}

export interface TouchDragState {
  /** Note ids being dragged, or null when nothing is in flight. */
  ids: string[] | null;
  /** Whether the drop will file these notes or merge them. */
  mode: TouchDragMode;
  /** Where the finger is now, for drawing the ghost. */
  x: number;
  y: number;
  /** The target currently under the finger. */
  over: TouchDropTarget | null;
}

const IDLE: TouchDragState = { ids: null, mode: 'move', x: 0, y: 0, over: null };

/** Every target a mode will accept, for the nearest-miss search. */
const SELECTOR: Record<TouchDragMode, string> = {
  move: '[data-drop-folder],[data-drop-trash],[data-drop-note],[data-drop-editor]',
  merge: '[data-drop-note],[data-drop-editor]',
};

/**
 * The target an element belongs to, if any.
 *
 * Merge targets are tested first and are the only ones a merge drag can see:
 * two fingers mean "combine these", and a folder or the bin appearing under
 * that gesture would be an entirely different, destructive answer to it.
 * `ids` are the notes in flight — a note is never a target for itself.
 */
function targetOf(el: Element | null, mode: TouchDragMode, ids: string[]): TouchDropTarget | null {
  if (!el) return null;
  const note = el.closest('[data-drop-note]');
  if (note) {
    const id = note.getAttribute('data-drop-note') || '';
    return id && !ids.includes(id) ? { kind: 'note', id } : null;
  }
  if (el.closest('[data-drop-editor]')) return { kind: 'editor', id: '' };
  if (mode === 'merge') return null;
  if (el.closest('[data-drop-trash]')) return { kind: 'trash', id: '' };
  const folder = el.closest('[data-drop-folder]');
  if (folder) return { kind: 'folder', id: folder.getAttribute('data-drop-folder') || '' };
  return null;
}

/**
 * The nearest target to a point that the point itself missed.
 *
 * Only vertical distance is measured: these rows span the panel, so a release
 * that is off is off up or down, and the horizontal position carries no
 * information about which row was meant. Returns null past DROP_TOLERANCE
 * rather than snapping to whatever is closest — dropping a note into a folder
 * the user was nowhere near is worse than the drop not registering.
 */
function nearestTarget(x: number, y: number, mode: TouchDragMode, ids: string[]): TouchDropTarget | null {
  let best: TouchDropTarget | null = null;
  let bestGap = DROP_TOLERANCE;
  for (const el of document.querySelectorAll(SELECTOR[mode])) {
    const r = el.getBoundingClientRect();
    if (r.height === 0 || x < r.left || x > r.right) continue;   // hidden, or a different column
    const gap = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (gap >= bestGap) continue;
    const hit = targetOf(el, mode, ids);
    if (!hit) continue;                                          // a note in flight — not its own target
    bestGap = gap;
    best = hit;
  }
  return best;
}

function targetAt(x: number, y: number, mode: TouchDragMode, ids: string[]): TouchDropTarget | null {
  const el = document.elementFromPoint(x, y);
  const node = el instanceof Element ? el : null;
  // Sitting exactly on one of the notes in flight is a deliberate nothing.
  // Note rows are contiguous, so falling through to the nearest-miss search
  // here would snap to the row next door — and a drag lifted and released
  // without moving would offer to merge the note with its neighbour.
  const self = node?.closest('[data-drop-note]');
  if (self && ids.includes(self.getAttribute('data-drop-note') || '')) return null;
  return targetOf(node, mode, ids) ?? nearestTarget(x, y, mode, ids);
}

const sameTarget = (a: TouchDropTarget | null, b: TouchDropTarget | null): boolean =>
  a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);

/** Nearest ancestor that actually scrolls — the panel the targets live in. */
function scrollerFor(node: Element | null): HTMLElement | null {
  for (let el = node; el instanceof HTMLElement; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') return el;
    }
  }
  return null;
}

export interface TouchDragOptions {
  /** Notes to drag when the press lands on `id` — the whole selection when the
   *  pressed note is part of it, so a multi-select moves as one. */
  resolveIds: (id: string) => string[];
  onDropOnFolder: (ids: string[], folderId: string | null) => void;
  onDropOnTrash: (ids: string[]) => void;
  /** Dropped on another note — merge into it. Confirmed by the caller. */
  onDropOnNote: (ids: string[], targetId: string) => void;
  /** Dropped on the editor — merge into the open note. Confirmed by the caller. */
  onDropOnEditor: (ids: string[]) => void;
  /**
   * A plain tap on a row. Reported here rather than left to the row's onClick:
   * the click is synthesised from the same touch the drag is reading, and
   * whichever handler happened to win decided whether you got a drag or an
   * opened note. Now only one of them can fire.
   */
  onTap: (id: string) => void;
  enabled?: boolean;
}

/**
 * Wire long-press dragging inside `container`.
 *
 * Returns the live state so the caller can draw the ghost and highlight the
 * target — this hook moves data, it does not draw.
 */
export function useTouchDrag(
  container: React.RefObject<HTMLElement | null>,
  { resolveIds, onDropOnFolder, onDropOnTrash, onDropOnNote, onDropOnEditor, onTap, enabled = true }: TouchDragOptions
): TouchDragState {
  const [state, setState] = useState<TouchDragState>(IDLE);
  // The callbacks are read through a ref so the listeners are attached once:
  // re-attaching them whenever a parent re-renders would drop an in-flight
  // drag, which is exactly when re-renders happen (selection changes).
  const opts = useRef({ resolveIds, onDropOnFolder, onDropOnTrash, onDropOnNote, onDropOnEditor, onTap });
  opts.current = { resolveIds, onDropOnFolder, onDropOnTrash, onDropOnNote, onDropOnEditor, onTap };

  useEffect(() => {
    const el = container.current;
    if (!el || !enabled) return;

    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    // The press being considered: where it began, how far it has strayed, and
    // how many fingers it has picked up (which is what chooses the mode).
    let pending: { id: string; x: number; y: number; moved: number; fingers: number } | null = null;
    // The sequence began on a note row, and therefore belongs to this hook for
    // its whole length — unlike `pending`, which the slop check throws away the
    // moment the press stops being a candidate for a drag. That distinction is
    // the bug: a press that travelled 40px in 200ms cleared `pending`, so
    // touchend did nothing, so the browser synthesised its click on the row —
    // and a click on a row is what opens a note on a phone. Holding a note and
    // dragging it "gets interrupted by the note opening" is that click.
    let owned = false;
    let dragging: string[] | null = null;
    let mode: TouchDragMode = 'move';
    // The panel being dragged over, and where the finger is on it. Both are
    // needed by the edge-scroll frame loop, which runs between touchmoves.
    let scroller: HTMLElement | null = null;
    let at = { x: 0, y: 0 };
    let frame = 0;
    let lastOver: TouchDropTarget | null = null;

    const stopEdgeScroll = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };

    const clearHold = () => {
      if (holdTimer) clearTimeout(holdTimer);
      holdTimer = null;
      pending = null;
    };

    const reset = () => {
      clearHold();
      stopEdgeScroll();
      owned = false;
      dragging = null;
      mode = 'move';
      scroller = null;
      lastOver = null;
    };

    /**
     * Scroll the panel while the finger rests near its top or bottom edge.
     *
     * Without this the reachable drop targets are only the ones already on
     * screen, which on a phone is a fraction of the list — the finger is busy
     * holding the note, so there is no second gesture available to scroll with,
     * and a folder below the fold simply could not be dropped into.
     *
     * The target is recomputed every frame, not just on touchmove: the list is
     * what moves here, so the row under a perfectly still finger changes.
     */
    const edgeScroll = () => {
      frame = 0;
      if (!dragging || !scroller) return;
      const r = scroller.getBoundingClientRect();
      const above = at.y - r.top;
      const below = r.bottom - at.y;
      let dy = 0;
      if (above < EDGE) dy = -EDGE_SPEED * Math.min(1, (EDGE - above) / EDGE);
      else if (below < EDGE) dy = EDGE_SPEED * Math.min(1, (EDGE - below) / EDGE);
      if (dy) {
        const before = scroller.scrollTop;
        scroller.scrollTop = before + dy;
        // Re-render only when the row under the (stationary) finger actually
        // changes. Pushing state every frame would re-render the whole note
        // list sixty times a second to move a highlight that mostly stays put.
        const over = targetAt(at.x, at.y, mode, dragging);
        if (scroller.scrollTop !== before && !sameTarget(over, lastOver)) {
          lastOver = over;
          setState({ ids: dragging, mode, x: at.x, y: at.y, over });
        }
      }
      frame = requestAnimationFrame(edgeScroll);
    };

    const onStart = (e: TouchEvent) => {
      // A second finger does not restart anything: it re-aims the gesture that
      // is already running at the merge targets. That is the whole of how merge
      // is asked for — one finger files, two combine.
      if (dragging) {
        if (e.touches.length > 1 && mode === 'move') {
          mode = 'merge';
          lastOver = targetAt(at.x, at.y, mode, dragging);
          setState({ ids: dragging, mode, x: at.x, y: at.y, over: lastOver });
          navigator.vibrate?.(8);
        }
        return;
      }
      if (pending) {
        pending.fingers = Math.max(pending.fingers, e.touches.length);
        return;
      }
      const t = e.touches[0];
      if (!t || !(e.target instanceof Element)) return;
      // Row actions (bookmark, bin, restore) are buttons inside the row. They
      // are taps in their own right and keep the browser's own click — pressing
      // one must not lift the note it sits on, and this listener must not go on
      // to suppress the click that button is waiting for.
      if (e.target.closest('button')) return;
      const row = e.target.closest('[data-drag-note]');
      if (!row) return;
      const id = row.getAttribute('data-drag-note');
      if (!id) return;
      owned = true;
      pending = { id, x: t.clientX, y: t.clientY, moved: 0, fingers: e.touches.length };
      holdTimer = setTimeout(() => {
        if (!pending) return;
        dragging = opts.current.resolveIds(pending.id);
        mode = pending.fingers > 1 ? 'merge' : 'move';
        scroller = scrollerFor(row);
        at = { x: pending.x, y: pending.y };
        lastOver = targetAt(at.x, at.y, mode, dragging);
        setState({ ids: dragging, mode, x: at.x, y: at.y, over: lastOver });
        // The touch is now this drag's, and nobody else's — in particular the
        // app root's panel swipe, which would otherwise read the sideways
        // travel of a note being carried to a folder as "go to the editor" and
        // navigate away from the list mid-drag.
        claimTouchGesture();
        // The press has become a drag, so tell the phone — otherwise the lift
        // is silent and reads as the app having missed the gesture.
        navigator.vibrate?.(12);
        frame = requestAnimationFrame(edgeScroll);
      }, HOLD_MS);
    };

    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (pending && !dragging) {
        // Still deciding. A finger that has travelled is scrolling, not lifting.
        const d = Math.hypot(t.clientX - pending.x, t.clientY - pending.y);
        pending.moved = Math.max(pending.moved, d);
        if (d > HOLD_SLOP) clearHold();
        return;
      }
      if (!dragging) return;
      // Only once a drag is actually up: preventDefault here stops the list
      // scrolling out from under the finger. Doing it any earlier would break
      // ordinary scrolling, which is why this listener is non-passive but the
      // guard comes first.
      e.preventDefault();
      at = { x: t.clientX, y: t.clientY };
      lastOver = targetAt(at.x, at.y, mode, dragging);
      setState({ ids: dragging, mode, x: at.x, y: at.y, over: lastOver });
    };

    // A long press is also how Android starts a text selection, and the browser
    // taking that gesture cancels the touch sequence out from under the drag —
    // the row would lift, buzz, and die about 100ms later. `.vx-drag-source`
    // (index.css) turns selection off on the rows so it never begins; these
    // cover the two separate decisions the browser makes on top of that — the
    // callout menu, and starting a selection at all. `-webkit-touch-callout`
    // does nothing in Chrome, so this listener is the mechanism, not the CSS.
    const onContextMenu = (e: Event) => {
      if (pending || dragging) e.preventDefault();
    };
    const onSelectStart = (e: Event) => {
      if (pending || dragging) e.preventDefault();
    };

    /** Hand `ids` to whichever target the finger was last over. */
    const commit = (ids: string[], over: TouchDropTarget | null) => {
      setState(IDLE);
      if (!over) return;                                   // released on nothing
      const o = opts.current;
      if (over.kind === 'trash') o.onDropOnTrash(ids);
      else if (over.kind === 'folder') o.onDropOnFolder(ids, over.id === 'all' ? null : over.id);
      else if (over.kind === 'note') o.onDropOnNote(ids, over.id);
      else o.onDropOnEditor(ids);
    };

    const onEnd = (e: TouchEvent) => {
      const ids = dragging;
      const press = pending;
      const wasOurs = owned;
      reset();

      if (!ids) {
        if (!wasOurs) return;
        // No drag lifted, but the sequence still started on a row — so the
        // click the browser is about to synthesise is ours to answer for, and
        // the answer is always no. Opening a note is reported here instead,
        // and only for a press that stayed still and short enough to have
        // meant it. Everything in between — the flicks and the aborted holds —
        // now does nothing rather than opening whatever it was dragged from.
        e.preventDefault();
        if (press && press.fingers === 1 && press.moved <= TAP_SLOP) opts.current.onTap(press.id);
        return;
      }

      // A touch sequence still produces a click when it ends, and the element
      // under it is the row the drag started on — so dropping a note into a
      // folder would also *open* that note. preventDefault on touchend is what
      // suppresses the synthesised click, and it is why this listener is not
      // passive.
      e.preventDefault();
      releaseTouchGesture();
      const t = e.changedTouches[0];
      commit(ids, t ? targetAt(t.clientX, t.clientY, mode, ids) : null);
    };

    /**
     * The browser took the gesture away mid-drag.
     *
     * Android does this to a touch it decides belongs to it — a long press it
     * wants for text selection, a system gesture starting at the edge — and it
     * happens intermittently *after* the row has already lifted. Throwing the
     * drag away here was the worst of the failure modes seen on the phone: the
     * row lifted, the note was carried onto a folder, the WebView cancelled,
     * and because `dragging` was then null the touchend below no longer
     * suppressed the click — so instead of being filed, the note *opened*. A
     * drag that visibly worked did the one thing the user did not ask for.
     *
     * A cancel is not the user changing their mind: the finger is still where it
     * was, over a target the highlight has been promising to accept. So the drop
     * is completed at the last tracked position, and only truly discarded when
     * the finger was over nothing.
     */
    const onCancel = () => {
      const ids = dragging;
      const over = lastOver;
      reset();
      releaseTouchGesture();
      if (ids) commit(ids, over);
      else setState(IDLE);
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: false });
    el.addEventListener('touchcancel', onCancel, { passive: true });
    el.addEventListener('contextmenu', onContextMenu);
    el.addEventListener('selectstart', onSelectStart);
    return () => {
      reset();
      releaseTouchGesture();
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
      el.removeEventListener('contextmenu', onContextMenu);
      el.removeEventListener('selectstart', onSelectStart);
    };
  }, [container, enabled]);

  return state;
}
