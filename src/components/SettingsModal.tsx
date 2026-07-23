import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Settings as SettingsIcon, SpellCheck, Type, Check, Info, Hash, History, Cloud, Layers, Target } from 'lucide-react';

// ---------------------------------------------------------------------------
// Settings dialog (opened from the sidebar gear). Two knobs today:
//  1. Spellcheck / dictionary language — only wired up when window.electronAPI
//     exposes getSpellCheckerInfo (the old Electron shell did; the Tauri
//     bridge in desktop.ts deliberately doesn't, since its OS webview handles
//     spellcheck natively). Everywhere else this section just explains that.
//  2. Auto-capitalize — toggles the RichTextEditor behaviour that upper-cases
//     the first letter of a sentence (start of note, and after ". "). On by
//     default; the editor reads the flag straight from localStorage.
// ---------------------------------------------------------------------------

export const LS_SPELL_LANG = 'valx-spellcheck-lang';
export const LS_AUTOCAP = 'valx-autocap';
export const LS_FONT = 'valx-font';
export const DEFAULT_FONT = 'SF Pro';
export const LS_LINE_COUNTER = 'valx-line-counter';
// Fired on toggle so the open editor updates its gutter without a reload.
export const LINE_COUNTER_EVENT = 'valx-line-counter-changed';
// Word-count widget (corner pill) + optional writing goal. On by default.
export const LS_WORDCOUNT = 'valx-wordcount-widget';
export const LS_WORDCOUNT_GOAL = 'valx-wordcount-goal';
export const WORDCOUNT_EVENT = 'valx-wordcount-changed';
export const LS_HISTORY_INTERVAL = 'valx-history-interval';
export const HISTORY_INTERVAL_EVENT = 'valx-history-interval-changed';
export const DEFAULT_HISTORY_INTERVAL = 10;
export const LS_TRANSPARENCY = 'valx-transparency';

/** Toggles the .vx-opaque class (index.css) that flattens the sidebar and
 *  window titlebar's glass effect to a solid background. Exported so App.tsx
 *  re-applies the saved choice on boot. */
export function applyTransparency(enabled: boolean) {
  document.documentElement.classList.toggle('vx-opaque', !enabled);
}


/** Sets the app-wide font (index.css: body reads --vx-font). Exported so
 *  App.tsx re-applies the saved choice on boot. */
export function applyFont(family: string) {
  if (family && family !== DEFAULT_FONT) document.documentElement.style.setProperty('--vx-font', `'${family.replace(/'/g, '')}'`);
  else document.documentElement.style.removeProperty('--vx-font');
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  oneDriveConnected?: boolean;
  oneDriveAccount?: string | null;
  onConnectOneDrive?: () => void;
  onDisconnectOneDrive?: () => void;
  /** Scroll the OneDrive section into view and pulse it — set when the
   *  sidebar's sync button redirects here because nothing's connected yet. */
  highlightOneDrive?: boolean;
}

// "regomusic293@gmail.com" -> "re*******3@gmail.com" — enough to recognize
// the account, not enough to shoulder-surf.
function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain || user.length <= 2) return email;
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, user.length - 3))}${user.slice(-1)}@${domain}`;
}

// Friendly display name for a BCP-47 code like "en-US" → "American English".
function languageLabel(code: string): string {
  try {
    const dn = new (Intl as any).DisplayNames([navigator.language || 'en'], { type: 'language' });
    const name = dn.of(code);
    if (name && name !== code) {
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  } catch {
    /* Intl.DisplayNames unsupported — fall through to the raw code */
  }
  return code;
}

export function SettingsModal({ isOpen, onClose, oneDriveConnected, oneDriveAccount, onConnectOneDrive, onDisconnectOneDrive, highlightOneDrive }: SettingsModalProps) {
  const api = (window as any).electronAPI;
  const oneDriveSectionRef = useRef<HTMLElement>(null);

  // Mount the (heavy) panel body only while open — plus a 300ms grace window so
  // the slide-out animation still plays. A closed Settings then costs no DOM.
  const [mounted, setMounted] = useState(isOpen);
  useEffect(() => {
    if (isOpen) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), 300);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !highlightOneDrive) return;
    // Next tick — the panel's own slide-in transition needs a frame before
    // scrollIntoView has a stable layout to target.
    const t = setTimeout(() => oneDriveSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    return () => clearTimeout(t);
  }, [isOpen, highlightOneDrive]);
  const [available, setAvailable] = useState<string[]>([]);
  const [lang, setLang] = useState<string>(() => localStorage.getItem(LS_SPELL_LANG) || '');
  const [autoCap, setAutoCap] = useState<boolean>(() => localStorage.getItem(LS_AUTOCAP) !== 'false');
  const [lineCounter, setLineCounter] = useState<boolean>(() => localStorage.getItem(LS_LINE_COUNTER) === 'true');
  const [wordCountOn, setWordCountOn] = useState<boolean>(() => localStorage.getItem(LS_WORDCOUNT) !== 'false');
  const [wordGoal, setWordGoal] = useState<number>(() => parseInt(localStorage.getItem(LS_WORDCOUNT_GOAL) || '0', 10) || 0);
  const [transparency, setTransparency] = useState<boolean>(() => localStorage.getItem(LS_TRANSPARENCY) !== 'false');
  const [historyInterval, setHistoryInterval] = useState<number>(() => {
    const v = parseInt(localStorage.getItem(LS_HISTORY_INTERVAL) || '', 10);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_HISTORY_INTERVAL;
  });

  const [font, setFont] = useState<string>(() => localStorage.getItem(LS_FONT) || DEFAULT_FONT);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  // The combobox's text IS the query; it shows the active font when not being edited.
  const [fontQuery, setFontQuery] = useState(font);
  const fontOptions = useMemo(
    () => [DEFAULT_FONT, ...systemFonts.filter((f) => f !== DEFAULT_FONT)],
    [systemFonts]
  );

  // System font list via the Local Font Access API (Chromium — always present
  // in the Electron shell; in a plain browser it may need a permission or be
  // absent, in which case only the bundled default is offered).
  useEffect(() => {
    if (!isOpen) return;
    setFontQuery(font);
    let cancelled = false;
    (window as any).queryLocalFonts?.()
      .then((fonts: { family: string }[]) => {
        if (cancelled) return;
        setSystemFonts([...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => { /* permission denied — bundled default only */ });
    return () => { cancelled = true; };
  }, [isOpen]);

  // Pull the list of dictionaries Chromium can offer, plus the one currently active.
  useEffect(() => {
    if (!isOpen || !api?.getSpellCheckerInfo) return;
    let cancelled = false;
    api.getSpellCheckerInfo().then((info: { available: string[]; current: string[] }) => {
      if (cancelled || !info) return;
      setAvailable(info.available || []);
      const saved = localStorage.getItem(LS_SPELL_LANG);
      setLang(saved || info.current?.[0] || info.available?.[0] || '');
    }).catch(() => { /* stay with whatever we have */ });
    return () => { cancelled = true; };
  }, [isOpen]);

  const options = useMemo(
    () => [...available]
      .map((code) => ({ code, label: languageLabel(code) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [available]
  );

  const handleLangChange = (code: string) => {
    setLang(code);
    localStorage.setItem(LS_SPELL_LANG, code);
    api?.setSpellCheckerLanguages?.([code]);
  };

  const handleFontChange = (family: string) => {
    setFont(family);
    localStorage.setItem(LS_FONT, family);
    applyFont(family);
  };



  const toggleAutoCap = () => {
    const next = !autoCap;
    setAutoCap(next);
    localStorage.setItem(LS_AUTOCAP, String(next));
  };

  const toggleTransparency = () => {
    const next = !transparency;
    setTransparency(next);
    localStorage.setItem(LS_TRANSPARENCY, String(next));
    applyTransparency(next);
  };

  const toggleLineCounter = () => {
    const next = !lineCounter;
    setLineCounter(next);
    localStorage.setItem(LS_LINE_COUNTER, String(next));
    window.dispatchEvent(new CustomEvent(LINE_COUNTER_EVENT, { detail: next }));
  };

  const emitWordCount = (on: boolean, goal: number) =>
    window.dispatchEvent(new CustomEvent(WORDCOUNT_EVENT, { detail: { enabled: on, goal } }));
  const toggleWordCount = () => {
    const next = !wordCountOn;
    setWordCountOn(next);
    localStorage.setItem(LS_WORDCOUNT, String(next));
    emitWordCount(next, wordGoal);
  };
  const changeWordGoal = (g: number) => {
    const v = Math.max(0, Math.round(g) || 0);
    setWordGoal(v);
    localStorage.setItem(LS_WORDCOUNT_GOAL, String(v));
    emitWordCount(wordCountOn, v);
  };

  const changeHistoryInterval = (mins: number) => {
    const clamped = Math.min(120, Math.max(1, Math.round(mins) || DEFAULT_HISTORY_INTERVAL));
    setHistoryInterval(clamped);
    localStorage.setItem(LS_HISTORY_INTERVAL, String(clamped));
    window.dispatchEvent(new CustomEvent(HISTORY_INTERVAL_EVENT, { detail: clamped }));
  };

  const spellSupported = !!api?.getSpellCheckerInfo;

  if (!mounted) return null;

  return (
    <div className={`fixed inset-0 z-[60] ${isOpen ? '' : 'pointer-events-none'}`} aria-hidden={!isOpen}>
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
        style={{ perspective: '1200px' }}
      />
      <div
        className={`absolute left-0 top-0 bottom-0 w-full max-w-md vx-glass rounded-r-3xl shadow-2xl flex flex-col transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${isOpen ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-full'}`}
        style={isOpen ? { animation: 'vx-slide-in 0.3s cubic-bezier(0.16,1,0.3,1) both' } : undefined}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100/50 dark:border-neutral-800/50 flex-shrink-0">
          <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold">
            <SettingsIcon size={18} className="text-[#32CD32]" />
            Settings
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-neutral-900 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-7 overflow-y-auto">
          {/* Spellcheck + dictionary language */}
          <section>
            <div className="flex items-center gap-2 mb-1.5">
              <SpellCheck size={15} className="text-[#32CD32]" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Spellcheck &amp; dictionary</h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 leading-relaxed">
              Choose the language used for spellchecking and the right-click dictionary suggestions.
            </p>

            {spellSupported ? (
              options.length > 0 ? (
                <select
                  value={lang}
                  onChange={(e) => handleLangChange(e.target.value)}
                  className="w-full bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-[#32CD32] transition-colors"
                >
                  {options.map((o) => (
                    <option key={o.code} value={o.code}>{o.label} ({o.code})</option>
                  ))}
                </select>
              ) : (
                <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500 px-1">
                  <Info size={13} /> Loading available languages…
                </div>
              )
            ) : (
              <div className="flex items-start gap-2 text-xs text-slate-400 dark:text-slate-500 px-1 leading-relaxed">
                <Info size={13} className="mt-0.5 flex-shrink-0" />
                <span>Not available in this build — spellchecking uses your operating system's dictionary and language settings instead.</span>
              </div>
            )}
          </section>



          {/* App font */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Type size={15} className="text-[#32CD32]" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Font</h3>
            </div>
            {/* One control, not two: a <datalist> combobox filters its own list as
                you type. A search box next to a <select> looked broken — the
                closed select keeps showing the current pick, so nothing moves. */}
            <input
              list="vx-font-list"
              value={fontQuery}
              onChange={(e) => {
                setFontQuery(e.target.value);
                const pick = fontOptions.find((f) => f.toLowerCase() === e.target.value.trim().toLowerCase());
                if (pick) handleFontChange(pick);
              }}
              onFocus={(e) => e.target.select()}
              onBlur={() => setFontQuery(font)}
              placeholder="Search fonts…"
              style={{ fontFamily: `'${font}'` }}
              className="w-full bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-[#32CD32] transition-colors"
            />
            <datalist id="vx-font-list">
              {fontOptions.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </section>

          {/* Auto-capitalize */}
          <section>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <Type size={15} className="text-[#32CD32]" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Auto-capitalize</h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Capitalize the first letter of each sentence — at the start of a note and after a period — and the standalone pronoun “I”.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={autoCap}
                onClick={toggleAutoCap}
                className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${autoCap ? 'bg-[#32CD32]' : 'bg-slate-200 dark:bg-neutral-700'}`}
                title={autoCap ? 'On' : 'Off'}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform flex items-center justify-center ${autoCap ? 'translate-x-5' : 'translate-x-0'}`}
                >
                  {autoCap && <Check size={12} className="text-[#32CD32]" />}
                </span>
              </button>
            </div>
          </section>

          {/* Transparency (sidebar + window titlebar glass effect) */}
          <section>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <Layers size={15} className="text-[#32CD32]" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Transparency</h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Frosted-glass sidebar and window titlebar. Turn off for a solid background.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={transparency}
                onClick={toggleTransparency}
                className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${transparency ? 'bg-[#32CD32]' : 'bg-slate-200 dark:bg-neutral-700'}`}
                title={transparency ? 'On' : 'Off'}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform flex items-center justify-center ${transparency ? 'translate-x-5' : 'translate-x-0'}`}
                >
                  {transparency && <Check size={12} className="text-[#32CD32]" />}
                </span>
              </button>
            </div>
          </section>

          {/* Line counter (code files) */}
          <section>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <Hash size={15} className="text-[#32CD32]" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Line counter</h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Show line numbers along the right edge when editing code files (HTML, CSS, JavaScript, TypeScript, Python).
                </p>
              </div>
              <button
                role="switch"
                aria-checked={lineCounter}
                onClick={toggleLineCounter}
                className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${lineCounter ? 'bg-[#32CD32]' : 'bg-slate-200 dark:bg-neutral-700'}`}
                title={lineCounter ? 'On' : 'Off'}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform flex items-center justify-center ${lineCounter ? 'translate-x-5' : 'translate-x-0'}`}
                >
                  {lineCounter && <Check size={12} className="text-[#32CD32]" />}
                </span>
              </button>
            </div>
          </section>

          {/* Word count widget + goal */}
          <section>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <Target size={15} className="text-[#32CD32]" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Word count</h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Show a live word-count widget in the corner of the editor. Set a goal to track progress toward a target.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={wordCountOn}
                onClick={toggleWordCount}
                className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${wordCountOn ? 'bg-[#32CD32]' : 'bg-slate-200 dark:bg-neutral-700'}`}
                title={wordCountOn ? 'On' : 'Off'}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform flex items-center justify-center ${wordCountOn ? 'translate-x-5' : 'translate-x-0'}`}>
                  {wordCountOn && <Check size={12} className="text-[#32CD32]" />}
                </span>
              </button>
            </div>
            {wordCountOn && (
              <div className="flex items-center gap-2 mt-3">
                <span className="text-xs text-slate-500 dark:text-slate-400">Goal</span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={wordGoal || ''}
                  placeholder="0"
                  onChange={(e) => changeWordGoal(parseInt(e.target.value, 10) || 0)}
                  className="w-24 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-lg px-2 py-1.5 text-sm text-center text-slate-900 dark:text-white outline-none focus:border-[#32CD32] transition-colors"
                />
                <span className="text-xs text-slate-500 dark:text-slate-400">words (0 = no goal)</span>
              </div>
            )}
          </section>

          {/* Version history */}
          <section>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <History size={15} className="text-[#32CD32]" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Version history</h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Automatically save a restorable version of the note you're editing on this interval.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={historyInterval}
                  onChange={(e) => setHistoryInterval(parseInt(e.target.value, 10) || 0)}
                  onBlur={(e) => changeHistoryInterval(parseInt(e.target.value, 10))}
                  className="w-16 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-lg px-2 py-1.5 text-sm text-center text-slate-900 dark:text-white outline-none focus:border-[#32CD32] transition-colors"
                />
                <span className="text-xs text-slate-500 dark:text-slate-400">min</span>
              </div>
            </div>
          </section>

          {/* OneDrive account — connect/disconnect both live here; the
              sidebar's button only syncs (or redirects here when not
              connected yet) so there's a single place users manage the
              connection, matching how other apps handle account settings. */}
          {(onConnectOneDrive || onDisconnectOneDrive) && (
            <section
              ref={oneDriveSectionRef}
              className={`rounded-lg transition-shadow duration-500 ${highlightOneDrive ? 'ring-2 ring-[#32CD32] ring-offset-2 ring-offset-white dark:ring-offset-black animate-pulse' : ''}`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <Cloud size={15} className="text-[#32CD32]" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">OneDrive</h3>
              </div>
              {oneDriveConnected ? (
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    Connected as {oneDriveAccount ? maskEmail(oneDriveAccount) : 'unknown account'}
                  </p>
                  <button
                    onClick={onDisconnectOneDrive}
                    className="shrink-0 text-xs font-semibold text-red-500 hover:text-red-600 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Sync your notes with a OneDrive folder — sign in with your Microsoft account.
                  </p>
                  <button
                    onClick={onConnectOneDrive}
                    className="shrink-0 text-xs font-semibold text-[#2eb82e] dark:text-[#32CD32] hover:text-[#2db82d] transition-colors"
                  >
                    Connect
                  </button>
                </div>
              )}
            </section>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 dark:border-neutral-900 flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full bg-[#32CD32] hover:bg-[#2db82d] text-black font-semibold py-2.5 rounded-lg transition-colors"
          >
            Apply changes
          </button>
        </div>
      </div>
    </div>
  );
}
