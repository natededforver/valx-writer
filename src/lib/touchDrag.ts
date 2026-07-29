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
//   release                        -> the drop fires; release elsewhere cancels
//
// Targets and sources are declared in the markup with data attributes rather
// than registered through a context, so a row only has to say what it is and
// the existing desktop handlers keep working untouched beside it:
//
//   data-drag-note="<id>"      a note that can be picked up
//   data-drop-folder="<id>"    a folder that accepts notes ('all' = no folder)
//   data-drop-trash            the bin
//
// The hit test is elementFromPoint on every move, not a cached list of target
// rectangles: the sidebar scrolls, folders expand, and a cached rectangle would
// silently start pointing at the wrong row.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';

/** Hold before a press becomes a drag. Long enough not to fire while the user
 *  is starting a scroll, short enough not to feel broken. */
const HOLD_MS = 380;
/** Movement during the hold that cancels it — that finger is scrolling. */
const HOLD_SLOP = 12;

export interface TouchDropTarget {
  kind: 'folder' | 'trash';
  /** Folder id, 'all' for the no-folder root, or '' for the bin. */
  id: string;
}

export interface TouchDragState {
  /** Note ids being dragged, or null when nothing is in flight. */
  ids: string[] | null;
  /** Where the finger is now, for drawing the ghost. */
  x: number;
  y: number;
  /** The target currently under the finger. */
  over: TouchDropTarget | null;
}

const IDLE: TouchDragState = { ids: null, x: 0, y: 0, over: null };

function targetAt(x: number, y: number): TouchDropTarget | null {
  const el = document.elementFromPoint(x, y);
  if (!(el instanceof Element)) return null;
  if (el.closest('[data-drop-trash]')) return { kind: 'trash', id: '' };
  const folder = el.closest('[data-drop-folder]');
  if (folder) return { kind: 'folder', id: folder.getAttribute('data-drop-folder') || '' };
  return null;
}

export interface TouchDragOptions {
  /** Notes to drag when the press lands on `id` — the whole selection when the
   *  pressed note is part of it, so a multi-select moves as one. */
  resolveIds: (id: string) => string[];
  onDropOnFolder: (ids: string[], folderId: string | null) => void;
  onDropOnTrash: (ids: string[]) => void;
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
  { resolveIds, onDropOnFolder, onDropOnTrash, enabled = true }: TouchDragOptions
): TouchDragState {
  const [state, setState] = useState<TouchDragState>(IDLE);
  // The callbacks are read through a ref so the listeners are attached once:
  // re-attaching them whenever a parent re-renders would drop an in-flight
  // drag, which is exactly when re-renders happen (selection changes).
  const opts = useRef({ resolveIds, onDropOnFolder, onDropOnTrash });
  opts.current = { resolveIds, onDropOnFolder, onDropOnTrash };

  useEffect(() => {
    const el = container.current;
    if (!el || !enabled) return;

    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let pending: { id: string; x: number; y: number } | null = null;
    let dragging: string[] | null = null;

    const clearHold = () => {
      if (holdTimer) clearTimeout(holdTimer);
      holdTimer = null;
      pending = null;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { clearHold(); return; }
      const t = e.touches[0];
      const row = (e.target instanceof Element) ? e.target.closest('[data-drag-note]') : null;
      if (!row) return;
      const id = row.getAttribute('data-drag-note');
      if (!id) return;
      pending = { id, x: t.clientX, y: t.clientY };
      holdTimer = setTimeout(() => {
        if (!pending) return;
        dragging = opts.current.resolveIds(pending.id);
        setState({ ids: dragging, x: pending.x, y: pending.y, over: targetAt(pending.x, pending.y) });
        // The press has become a drag, so tell the phone — otherwise the lift
        // is silent and reads as the app having missed the gesture.
        navigator.vibrate?.(12);
      }, HOLD_MS);
    };

    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (pending && !dragging) {
        // Still deciding. A finger that has travelled is scrolling, not lifting.
        if (Math.hypot(t.clientX - pending.x, t.clientY - pending.y) > HOLD_SLOP) clearHold();
        return;
      }
      if (!dragging) return;
      // Only once a drag is actually up: preventDefault here stops the list
      // scrolling out from under the finger. Doing it any earlier would break
      // ordinary scrolling, which is why this listener is non-passive but the
      // guard comes first.
      e.preventDefault();
      setState({ ids: dragging, x: t.clientX, y: t.clientY, over: targetAt(t.clientX, t.clientY) });
    };

    const onEnd = (e: TouchEvent) => {
      const ids = dragging;
      clearHold();
      dragging = null;
      if (!ids) return;
      // A touch sequence still produces a click when it ends, and the element
      // under it is the row the drag started on — so dropping a note into a
      // folder would also *open* that note. preventDefault on touchend is what
      // suppresses the synthesised click, and it is why this listener is not
      // passive. Only reached once a drag was actually in flight, so an
      // ordinary tap is untouched.
      e.preventDefault();
      const t = e.changedTouches[0];
      const over = t ? targetAt(t.clientX, t.clientY) : null;
      setState(IDLE);
      if (!over) return;                                   // released on nothing
      if (over.kind === 'trash') opts.current.onDropOnTrash(ids);
      else opts.current.onDropOnFolder(ids, over.id === 'all' ? null : over.id);
    };

    const onCancel = () => { clearHold(); dragging = null; setState(IDLE); };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: false });
    el.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      clearHold();
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    };
  }, [container, enabled]);

  return state;
}
