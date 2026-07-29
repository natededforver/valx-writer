import React, { useEffect, useState } from 'react';
import { X, Type, RotateCcw } from 'lucide-react';
import {
  LS_LETTER_SPACING, LS_WORD_SPACING,
  LETTER_SPACING_RANGE, WORD_SPACING_RANGE,
  letterSpacing, wordSpacing, setSpacing,
} from '../lib/prefs';

// ---------------------------------------------------------------------------
// Letter and word spacing, with the thing the sliders were missing: something
// to look at.
//
// They used to sit inside the Format dropdown as two bare tracks and a number.
// A number is not a legible way to choose a typographic measure — 2.4px means
// nothing until you see what it does to a line of prose — and the note itself
// was the only preview, usually hidden behind the open menu. So the sliders
// moved into a dialog with a sample paragraph that re-renders as the handle
// moves, set in the writing surface's own typeface at its own size.
//
// The preview reads the live values from React state rather than the CSS
// variables the editor uses, so it updates on the same frame as the drag —
// but the variables are still written on every move (setSpacing does it), so
// the note behind the dialog changes at the same time. Cancel is deliberately
// absent: the changes are applied, visible, and one tap from Reset.
// ---------------------------------------------------------------------------

const SAMPLE =
  'The lighthouse keeper wrote nothing for eleven days. On the twelfth he ' +
  'wrote one sentence, and then he wrote another.';

export function SpacingModal() {
  const [open, setOpen] = useState(false);
  const [letter, setLetter] = useState(0);
  const [word, setWord] = useState(0);

  useEffect(() => {
    const onOpen = () => {
      // Re-read on every open: the values can have changed since the last one
      // (another window, a reset, a restored preference).
      setLetter(letterSpacing());
      setWord(wordSpacing());
      setOpen(true);
    };
    window.addEventListener('valx-open-spacing', onOpen);
    return () => window.removeEventListener('valx-open-spacing', onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const rows = [
    { label: 'Letter spacing', key: LS_LETTER_SPACING, range: LETTER_SPACING_RANGE, value: letter, set: setLetter },
    { label: 'Word spacing', key: LS_WORD_SPACING, range: WORD_SPACING_RANGE, value: word, set: setWord },
  ];

  const reset = () => {
    setLetter(setSpacing(LS_LETTER_SPACING, 0));
    setWord(setSpacing(LS_WORD_SPACING, 0));
  };

  return (
    <div
      className="vx-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onMouseDown={() => setOpen(false)}
    >
      <div
        className="vx-dialog-in vx-glass-strong vx-hairline w-[26rem] max-w-full flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
            <Type size={17} className="text-[#32CD32]" /> Text spacing
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-900 active:scale-90 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* The sample. Same face and size as the writing surface (.rich-editor
            in index.css owns both), so what you tune here is what you get in
            the note — a preview in the UI typeface would be a different
            measurement of a different font. */}
        <div className="mx-4 mb-4 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] px-4 py-3.5">
          <p
            className="vx-spacing-sample text-[15px] leading-relaxed text-slate-800 dark:text-slate-200"
            style={{ letterSpacing: `${letter}px`, wordSpacing: `${word}px` }}
          >
            {SAMPLE}
          </p>
        </div>

        <div className="px-4 pb-4 space-y-4">
          {rows.map(({ label, key, range, value, set }) => (
            <label key={key} className="block select-none">
              <span className="flex items-center justify-between text-[12px] text-slate-500 dark:text-slate-400 mb-1.5">
                <span>{label}</span>
                <span className="tabular-nums font-medium text-slate-700 dark:text-slate-300">{value.toFixed(1)}px</span>
              </span>
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={range.step}
                value={value}
                // onInput, not onChange: a drag has to repaint the sample
                // continuously, and React's onChange for a range fires on the
                // same events but the explicit name is what stops someone
                // "fixing" this into an on-release update later.
                onInput={(e) => set(setSpacing(key, parseFloat((e.target as HTMLInputElement).value)))}
                onChange={(e) => set(setSpacing(key, parseFloat(e.target.value)))}
                className="w-full accent-[#32CD32] cursor-pointer"
              />
            </label>
          ))}
        </div>

        <div className="flex items-center justify-between px-4 py-2.5 border-t border-black/[0.06] dark:border-white/[0.08]">
          <span className="text-[11px] text-slate-400 dark:text-slate-500">Applies to every note.</span>
          <button
            onClick={reset}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-slate-500 dark:text-slate-400 hover:text-[#32CD32] hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all"
          >
            <RotateCcw size={13} /> Reset
          </button>
        </div>
      </div>
    </div>
  );
}
