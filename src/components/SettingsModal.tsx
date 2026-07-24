import React, { useEffect, useRef, useState } from 'react';
import { X, SlidersHorizontal, History, Cloud, Target } from 'lucide-react';
import {
  historyInterval,
  setHistoryInterval,
  wordGoal,
  setWordGoal,
} from '../lib/prefs';

// ---------------------------------------------------------------------------
// Preferences. Everything that is a simple on/off now lives in the menu bar
// (View, Edit, Format) where it sits next to what it affects — this dialog
// keeps only the three preferences that need a value typed in rather than a
// switch flipped: the OneDrive account, how often a version snapshot is taken,
// and the word-count goal. Opened from File > Preferences or Ctrl+,.
// ---------------------------------------------------------------------------

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

export function SettingsModal({
  isOpen,
  onClose,
  oneDriveConnected,
  oneDriveAccount,
  onConnectOneDrive,
  onDisconnectOneDrive,
  highlightOneDrive,
}: SettingsModalProps) {
  const oneDriveSectionRef = useRef<HTMLElement>(null);

  // Mount the panel body only while open — plus a 300ms grace window so the
  // slide-out animation still plays. A closed Preferences then costs no DOM.
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

  const [interval, setIntervalState] = useState<number>(() => historyInterval());
  const [goal, setGoalState] = useState<number>(() => wordGoal());

  const changeGoal = (g: number) => { setGoalState(g); setWordGoal(g); };

  const numberCls =
    'bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-lg px-2 py-1.5 text-sm text-center text-slate-900 dark:text-white outline-none focus:border-[#32CD32] transition-colors';

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
            <SlidersHorizontal size={18} className="text-[#32CD32]" />
            Preferences
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-neutral-900 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-7 overflow-y-auto">
          <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
            Everything else lives in the menu bar — spelling and auto-capitalize under
            Edit, word count, line numbers and appearance under View.
          </p>

          {/* Word-count goal */}
          <section>
            <div className="flex items-center gap-2 mb-1.5">
              <Target size={15} className="text-[#32CD32]" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Writing goal</h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 leading-relaxed">
              Target for the word-count widget. 0 turns the goal off and just shows the count.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={100}
                value={goal || ''}
                placeholder="0"
                onChange={(e) => changeGoal(parseInt(e.target.value, 10) || 0)}
                className={`w-28 ${numberCls}`}
              />
              <span className="text-xs text-slate-500 dark:text-slate-400">words</span>
            </div>
          </section>

          {/* Version history interval */}
          <section>
            <div className="flex items-center gap-2 mb-1.5">
              <History size={15} className="text-[#32CD32]" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Version history</h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 leading-relaxed">
              Automatically save a restorable version of the note you're editing on this interval.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={120}
                value={interval}
                onChange={(e) => setIntervalState(parseInt(e.target.value, 10) || 0)}
                onBlur={(e) => setIntervalState(setHistoryInterval(parseInt(e.target.value, 10)))}
                className={`w-20 ${numberCls}`}
              />
              <span className="text-xs text-slate-500 dark:text-slate-400">minutes</span>
            </div>
          </section>

          {/* OneDrive account — connect/disconnect both live here; the sidebar's
              button only syncs (or redirects here when nothing's connected yet)
              so there's a single place users manage the connection. */}
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
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
