import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';

// Windows-style titlebar: a full-width drag strip with min/max/close at the
// right (Windows convention, unlike macOS's left-side traffic lights).
export function WindowControls() {
  const handleMinimize = () => getCurrentWindow().minimize();
  const handleMaximize = () => getCurrentWindow().toggleMaximize();
  const handleClose = () => getCurrentWindow().close();

  return (
    // z-[80]: above every full-screen modal (Settings/Onboarding/FormatConverter
    // are z-[60]/z-[70], World Mode's delete-confirm/import dialogs are z-[60]) —
    // minimize/maximize/close must stay reachable no matter what's open.
    <div className="fixed top-0 left-0 right-0 h-8 z-[80] flex items-center vx-glass-strong select-none">
      <div data-tauri-drag-region className="flex-1 h-full flex items-center gap-1.5 px-2 pointer-events-auto">
        <img src="/main.ico" alt="" className="w-4 h-4 shrink-0" />
        <span
          className="text-[11px] font-medium text-slate-600 dark:text-slate-300 tracking-wide"
          style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}
        >
          Valx prose writer
        </span>
      </div>
      <div className="flex h-full pointer-events-auto">
        <button
          onClick={handleMinimize}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Minimize"
          className="w-11 h-8 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={handleMaximize}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Maximize"
          className="w-11 h-8 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
        >
          <Square size={12} />
        </button>
        <button
          onClick={handleClose}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Close"
          className="w-11 h-8 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-[#e81123] hover:text-white transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
