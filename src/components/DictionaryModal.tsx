import React, { useEffect, useState } from 'react';
import { X, BookA, Trash2, Plus } from 'lucide-react';
import { userWords, addWord, removeWord, DICTIONARY_EVENT } from '../lib/spellcheck';

// ---------------------------------------------------------------------------
// The user dictionary, as a list you can edit. Words land here from the
// editor's right-click "Add to Dictionary"; this is where they can be taken
// back out again — without it, a word added by a mis-click would be accepted
// forever with no way to reach it. Opened from Edit > Dictionary…
// ---------------------------------------------------------------------------

export function DictionaryModal() {
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('valx-open-dictionary', onOpen);
    return () => window.removeEventListener('valx-open-dictionary', onOpen);
  }, []);

  // Reload on open and whenever the dictionary changes elsewhere (the editor's
  // context menu adds words too, and this list must not go stale behind it).
  useEffect(() => {
    if (!open) return;
    const load = () => { void userWords().then(setWords); };
    load();
    window.addEventListener(DICTIONARY_EVENT, load);
    return () => window.removeEventListener(DICTIONARY_EVENT, load);
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    const word = draft.trim();
    if (!word) return;
    setDraft('');
    await addWord(word);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
      <div
        className="vx-pop w-96 max-h-[70vh] flex flex-col rounded-xl bg-white dark:bg-neutral-950 border border-slate-200 dark:border-neutral-800 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-100 dark:border-neutral-900">
          <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
            <BookA size={17} className="text-[#32CD32]" /> Dictionary
          </div>
          <button onClick={() => setOpen(false)} className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-neutral-900 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-slate-100 dark:border-neutral-900 flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
            placeholder="Add a word…"
            spellCheck={false}
            className="flex-1 min-w-0 bg-slate-100 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-md px-2.5 py-1.5 text-sm text-slate-900 dark:text-white outline-none focus:border-[#32CD32] transition-colors"
          />
          <button onClick={submit} title="Add" className="p-2 rounded-md text-slate-400 hover:text-[#32CD32] hover:bg-slate-100 dark:hover:bg-neutral-900 transition-colors">
            <Plus size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {words.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
              No words yet. Right-click a word the spellchecker flags and choose
              “Add to Dictionary”, or type one above.
            </p>
          ) : (
            words.map((w) => (
              <div key={w} className="group flex items-center gap-2 px-4 py-1.5 hover:bg-slate-50 dark:hover:bg-neutral-900 transition-colors">
                <span className="flex-1 min-w-0 truncate text-sm text-slate-700 dark:text-slate-200">{w}</span>
                <button
                  onClick={() => void removeWord(w)}
                  title={`Remove “${w}”`}
                  className="p-1 rounded text-slate-300 dark:text-neutral-700 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-slate-100 dark:border-neutral-900 text-[11px] text-slate-400 dark:text-slate-500">
          {words.length} word{words.length === 1 ? '' : 's'} — never flagged as misspelled.
        </div>
      </div>
    </div>
  );
}
