import React, { useEffect, useState } from 'react';
import { X, Ban, Plus } from 'lucide-react';
import { BinIcon } from './BinIcon';
import { loadForbidden, addForbidden, removeForbidden, FORBIDDEN_EVENT } from '../lib/forbidden';

// ---------------------------------------------------------------------------
// Forbidden words — the writer's own list of words to stop reaching for.
// Matches are greyed out in the editor rather than removed or flagged: the word
// stays exactly where it was typed, it just stops carrying any weight on the
// page. Opened from Words > Forbidden Words…
//
// Deliberately the same shape as DictionaryModal: both are a global word list
// with an add field and a hover-to-delete row, and two lists that behave the
// same should look the same.
// ---------------------------------------------------------------------------

export function ForbiddenModal() {
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('valx-open-forbidden', onOpen);
    return () => window.removeEventListener('valx-open-forbidden', onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const load = () => setWords(loadForbidden());
    load();
    window.addEventListener(FORBIDDEN_EVENT, load);
    return () => window.removeEventListener(FORBIDDEN_EVENT, load);
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const entry = draft.trim();
    if (!entry) return;
    // Rejected when the entry is nothing but symbols — it has no word in it, so
    // it could never match. Say so instead of silently storing a dud row.
    if (!addForbidden(entry)) { setRejected(true); return; }
    setRejected(false);
    setDraft('');
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
      <div
        className="vx-pop vx-glass-strong vx-hairline w-96 max-w-[92vw] max-h-[70vh] flex flex-col rounded-2xl shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-100 dark:border-neutral-900">
          <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
            <Ban size={17} className="text-[#32CD32]" /> Forbidden Words
          </div>
          <button onClick={() => setOpen(false)} className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-900 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-slate-100 dark:border-neutral-900">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setRejected(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
              placeholder="Add a word or phrase…"
              spellCheck={false}
              className="flex-1 min-w-0 bg-slate-100 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-md px-2.5 py-1.5 text-sm text-slate-900 dark:text-white outline-none focus:border-[#32CD32] transition-colors"
            />
            <button onClick={submit} title="Add" className="p-2 rounded-md text-slate-400 hover:text-[#32CD32] hover:bg-slate-100 dark:hover:bg-neutral-900 transition-colors">
              <Plus size={16} />
            </button>
          </div>
          {rejected && (
            <p className="mt-2 text-[11px] text-red-500">
              That has no word in it — punctuation and symbols are never matched.
            </p>
          )}
        </div>

        <div className="vx-list-scroll flex-1 min-h-0 max-h-56 overflow-y-auto py-1">
          {words.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
              No forbidden words yet. Add one above and every use of it in your
              writing goes grey.
            </p>
          ) : (
            words.map((w) => (
              <div key={w} className="group flex items-center gap-2 px-4 py-1.5 hover:bg-slate-50 dark:hover:bg-neutral-900 transition-colors">
                <span className="flex-1 min-w-0 truncate text-sm text-slate-700 dark:text-slate-200">{w}</span>
                <button
                  onClick={() => removeForbidden(w)}
                  title={`Remove “${w}”`}
                  className="p-1 rounded text-slate-300 dark:text-neutral-700 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <BinIcon size={14} />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-slate-100 dark:border-neutral-900 text-[11px] text-slate-400 dark:text-slate-500">
          {words.length} word{words.length === 1 ? '' : 's'} — greyed out where they appear, never changed or removed.
        </div>
      </div>
    </div>
  );
}
