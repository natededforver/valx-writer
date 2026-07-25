import React from 'react';

// ---------------------------------------------------------------------------
// The bin, as macOS draws it. Every "delete" control in the UI renders this
// rather than a stroked glyph, so throwing away a note, a folder, a table, a
// dictionary word or a forbidden word all read as the same action.
//
// One component rather than the emoji inline at each call site: it is the only
// way six separate buttons stay the same size and stay in step later.
//
// aria-hidden — the emoji carries no useful accessible name of its own (screen
// readers say "wastebasket"), and every call site already has a title or a
// visible label that says what is being deleted.
// ---------------------------------------------------------------------------

export function BinIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`leading-none shrink-0 ${className}`}
      // Emoji scale with font-size, so the numbers here line up with the `size`
      // the lucide icons next to them were using.
      style={{ fontSize: `${size}px` }}
    >
      🗑️
    </span>
  );
}
