// ---------------------------------------------------------------------------
// Visual UI harness (npm run dev → /ui-harness.html). Renders the app's chrome
// idioms in a grid: every theme × light/dark, with animation replay buttons.
// Uses the real index.css (theme variable blocks + vx-* animations), so what
// this page shows is exactly what ships. Verify theme/animation edits here
// instead of clicking through the whole app.
// ---------------------------------------------------------------------------
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Heading1, List, Search, Eye, Share2, Check, Image as ImageIcon } from 'lucide-react';
import '../src/index.css';

const THEMES = ['default', 'glass', 'minimal', 'hc-black', 'hc-white'] as const;

function SampleChrome({ replayKey }: { replayKey: number }) {
  const [on, setOn] = useState(true);
  return (
    <div className="bg-white dark:bg-black text-slate-800 dark:text-slate-200 rounded-xl border border-slate-200 dark:border-neutral-800 overflow-hidden">
      {/* toolbar strip */}
      <div className="h-11 flex items-center gap-1 px-3 border-b border-slate-100 dark:border-neutral-900">
        <button className="p-2 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-900 transition-colors"><Search size={16} /></button>
        <button className="p-2 rounded-md bg-[#32CD32]/10 text-[#32CD32]"><Eye size={16} /></button>
        <button className="p-2 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-neutral-900 transition-colors"><Share2 size={16} /></button>
        <div className="flex-1" />
        <button
          role="switch"
          onClick={() => setOn(!on)}
          className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${on ? 'bg-[#32CD32]' : 'bg-slate-200 dark:bg-neutral-700'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-4' : ''}`} />
        </button>
      </div>
      {/* note card */}
      <div className="p-4 border-b border-slate-50 dark:border-neutral-900">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm text-slate-900 dark:text-white">Oxeye daisies</span>
          <span className="text-[10px] font-mono text-[#2eb82e] dark:text-[#32CD32] bg-[#32CD32]/10 px-1.5 py-0.5 rounded-sm">.md</span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
          A perennial wildflower with white ray petals surrounding a yellow center…
        </p>
      </div>
      {/* menu panel — replays vx-menu-pop via key */}
      <div className="p-3">
        <div key={replayKey} className="vx-menu-pop w-full py-1.5 rounded-2xl border border-slate-200/80 dark:border-neutral-800 bg-white/95 dark:bg-neutral-950/95 backdrop-blur-xl shadow-2xl shadow-black/10 dark:shadow-black/50">
          <button className="w-full text-left px-3 py-1.5 flex items-center gap-2.5 text-sm bg-[#32CD32]/12 text-slate-900 dark:text-white">
            <Heading1 size={15} className="text-[#32CD32]" /><span className="flex-1">Heading 1</span>
            <span className="text-[11px] font-mono text-slate-300 dark:text-neutral-600">#</span>
          </button>
          <button className="w-full text-left px-3 py-1.5 flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
            <List size={15} className="text-slate-400" /><span className="flex-1">Bullet List</span>
            <span className="text-[11px] font-mono text-slate-300 dark:text-neutral-600">-</span>
          </button>
          <button className="w-full text-left px-3 py-1.5 flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
            <ImageIcon size={15} className="text-slate-400" /><span className="flex-1">peach-peony</span>
            <span className="text-[10px] font-mono uppercase text-slate-300 dark:text-neutral-600">jpeg</span>
          </button>
        </div>
      </div>
      {/* primary button + saved pill */}
      <div className="p-3 pt-0 flex items-center gap-3">
        <button className="flex-1 bg-[#32CD32] hover:bg-[#2db82d] text-black font-semibold py-2 rounded-lg text-sm transition-colors">Apply changes</button>
        <span key={`pill-${replayKey}`} className="saved-pop flex items-center gap-1.5 bg-white/95 dark:bg-neutral-900/95 border border-[#32CD32]/40 text-[#32CD32] px-3 py-1.5 rounded-full text-xs font-semibold shadow-[0_0_24px_rgba(50,205,50,0.35)]">
          <Check size={12} /> Saved!
        </span>
      </div>
    </div>
  );
}

function Harness() {
  const [mode, setMode] = useState<'light' | 'dark'>('light');
  const [replay, setReplay] = useState(0);
  return (
    <div style={{ fontFamily: "'SF Pro', -apple-system, 'Segoe UI', sans-serif", background: '#0d0d0d', minHeight: '100vh', padding: 20 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, color: '#fff' }}>
        <h1 style={{ fontSize: 15, margin: 0 }}>VALX<span style={{ color: '#32cd32' }}>·</span>UI&nbsp;HARNESS</h1>
        <button onClick={() => setMode(mode === 'light' ? 'dark' : 'light')}
          style={{ font: 'inherit', fontSize: 13, padding: '6px 12px', borderRadius: 8, border: '1px solid #444', background: '#1a1a1a', color: '#fff', cursor: 'pointer' }}>
          mode: {mode}
        </button>
        <button onClick={() => setReplay((n) => n + 1)}
          style={{ font: 'inherit', fontSize: 13, padding: '6px 12px', borderRadius: 8, border: '1px solid #444', background: '#1a1a1a', color: '#fff', cursor: 'pointer' }}>
          ▶ replay animations
        </button>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        {THEMES.map((t) => (
          <div key={t}>
            <div style={{ color: '#9a9a9a', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 6 }}>{t}</div>
            <div
              className={mode === 'dark' ? 'dark' : ''}
              {...(t === 'default' ? {} : { 'data-vx-theme': t })}
              style={{ borderRadius: 14, padding: 12 }}
            >
              <SampleChrome replayKey={replay} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
