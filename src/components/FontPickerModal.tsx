import React, { useState, useEffect, useMemo } from 'react';
import { Search, Check, X } from 'lucide-react';
import { editorFont, setEditorFont } from '../lib/prefs';

const FALLBACK_FONTS = [
  'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Cambria Math', 'Candara',
  'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Ebrima', 'Franklin Gothic Medium',
  'Gabriola', 'Gadugi', 'Georgia', 'HoloLens MDL2 Assets', 'Impact', 'Ink Free', 'Javanese Text',
  'Leelawadee UI', 'Lucida Console', 'Lucida Sans Unicode', 'Malgun Gothic', 'Marlett', 'Microsoft Himalaya',
  'Microsoft JhengHei', 'Microsoft New Tai Lue', 'Microsoft PhagsPa', 'Microsoft Sans Serif',
  'Microsoft Tai Le', 'Microsoft YaHei', 'Microsoft Yi Baiti', 'MingLiU-ExtB', 'Mongolian Baiti',
  'MS Gothic', 'MV Boli', 'Myanmar Text', 'Nirmala UI', 'Palatino Linotype', 'Segoe Print', 'Segoe Script',
  'Segoe UI', 'Segoe UI Historic', 'Segoe UI Symbol', 'SimSun', 'Sitka', 'Sylfaen', 'Symbol', 'Tahoma',
  'Times New Roman', 'Trebuchet MS', 'Verdana', 'Webdings', 'Wingdings', 'Yu Gothic',
  // Mac standard fonts
  'San Francisco', 'Helvetica Neue', 'Helvetica', 'Menlo', 'Monaco', 'Courier', 'Optima', 'Didot',
  'Copperplate', 'Papyrus', 'Brush Script MT', 'Bradley Hand', 'Luminari', 'Baskerville', 'Futura',
  'Gill Sans', 'American Typewriter', 'Andale Mono', 'Arial Narrow', 'Arial Rounded MT Bold',
  'Avenir', 'Avenir Next', 'Big Caslon', 'Chalkboard', 'Chalkboard SE', 'Chalkduster', 'Cochin',
  'Geneva', 'Herculanum', 'Hoefler Text', 'Marker Felt', 'Noteworthy', 'Palatino'
];

interface FontPickerModalProps {
  onClose: () => void;
}

export function FontPickerModal({ onClose }: FontPickerModalProps) {
  const [fonts, setFonts] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  
  const currentFont = editorFont() || 'Valuex';

  useEffect(() => {
    async function loadFonts() {
      try {
        if ('queryLocalFonts' in window) {
          // @ts-ignore
          const localFonts = await window.queryLocalFonts();
          const uniqueFonts = Array.from(new Set(localFonts.map((f: any) => f.family))) as string[];
          setFonts(uniqueFonts.sort());
        } else {
          // Fallback check
          const available = [];
          // Use document.fonts.check to see if a font is available to be rendered
          if ('fonts' in document && document.fonts.check) {
            for (const f of FALLBACK_FONTS) {
              if (document.fonts.check(`12px "${f}"`)) {
                available.push(f);
              }
            }
          } else {
            available.push(...FALLBACK_FONTS);
          }
          setFonts(Array.from(new Set(['Valuex', ...available])).sort());
        }
      } catch (err) {
        console.warn('Failed to load local fonts', err);
        // Fallback on error
        setFonts(['Valuex', ...FALLBACK_FONTS].sort());
      } finally {
        setLoading(false);
      }
    }
    loadFonts();
  }, []);

  const filteredFonts = useMemo(() => {
    // Valuex is always first when not searching
    let sortedFonts = fonts;
    if (fonts.includes('Valuex')) {
      sortedFonts = ['Valuex', ...fonts.filter(f => f !== 'Valuex')];
    } else {
      sortedFonts = ['Valuex', ...fonts];
    }
    
    if (!query.trim()) return sortedFonts;
    
    const q = query.toLowerCase();
    return sortedFonts.filter(f => f.toLowerCase().includes(q));
  }, [fonts, query]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onMouseDown={onClose}>
      <div 
        className="vx-solid w-full max-w-md h-[70vh] flex flex-col rounded-xl shadow-2xl border border-black/10 dark:border-white/10 overflow-hidden text-slate-800 dark:text-slate-200"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b border-black/5 dark:border-white/10 shrink-0">
          <h2 className="font-semibold text-sm">Editor Font</h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
            <X size={16} />
          </button>
        </div>
        
        <div className="p-3 shrink-0 relative">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search fonts..."
              className="w-full pl-9 pr-3 py-2 bg-slate-100 dark:bg-neutral-900 border-none rounded-lg text-sm outline-none focus:ring-1 focus:ring-[#32CD32] transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-2">
          {loading ? (
            <div className="p-4 text-center text-sm text-slate-500">Loading fonts...</div>
          ) : filteredFonts.length === 0 ? (
            <div className="p-4 text-center text-sm text-slate-500">No fonts found for "{query}"</div>
          ) : (
            filteredFonts.map(f => {
              const isActive = (f === 'Valuex' && currentFont === 'Valuex') || f === currentFont;
              return (
                <button
                  key={f}
                  onClick={() => {
                    setEditorFont(f === 'Valuex' ? '' : f);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-3 rounded-lg text-left transition-colors mb-0.5 ${
                    isActive
                      ? 'bg-[#32CD32]/10 text-[#32CD32]'
                      : 'hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  <span className="text-[17px] truncate" style={{ fontFamily: `"${f}"` }}>{f}</span>
                  {isActive && <Check size={16} />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
