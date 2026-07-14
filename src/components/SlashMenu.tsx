import React, { useEffect, useRef } from 'react';
import {
  Heading1, Heading2, Heading3, Heading4, Heading5, Heading6,
  List, ListOrdered, ListChecks,
  Quote, Code, CodeXml, Bold, Italic, Strikethrough, Minus, Table,
  Music, Film, Paperclip, ClipboardPaste, Image as ImageIcon,
} from 'lucide-react';
import { MediaKind } from '../lib/format';

// ---------------------------------------------------------------------------
// The '/' command menu (presentational). RichTextEditor owns the state machine
// (trigger, query, selection, insertion); this renders the rounded macOS-style
// panel at the caret: syntax commands with their markdown hint on the right,
// then workspace media with thumbnail + extension badge.
// ---------------------------------------------------------------------------

export interface SlashSyntaxItem {
  type: 'syntax';
  id: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
    | 'bullet' | 'numbered' | 'checked'
    | 'quote' | 'code' | 'icode'
    | 'bold' | 'italic' | 'strike'
    | 'hr' | 'table';
  label: string;
  hint: string;
}

export interface SlashMediaItem {
  type: 'media';
  id: string;
  name: string;
  kind: MediaKind;
  /** resolvable URL for an <img> thumbnail (images on desktop / clipboard) */
  thumb?: string | null;
  /** right-aligned badge, e.g. the file extension */
  badge?: string;
}

export type SlashItem = SlashSyntaxItem | SlashMediaItem;

const SYNTAX_ICONS: Record<SlashSyntaxItem['id'], React.ComponentType<{ size?: number; className?: string }>> = {
  h1: Heading1, h2: Heading2, h3: Heading3, h4: Heading4, h5: Heading5, h6: Heading6,
  bullet: List, numbered: ListOrdered, checked: ListChecks,
  quote: Quote, code: Code, icode: CodeXml,
  bold: Bold, italic: Italic, strike: Strikethrough,
  hr: Minus, table: Table,
};

const KIND_ICONS: Record<MediaKind, React.ComponentType<{ size?: number; className?: string }>> = {
  image: ImageIcon, audio: Music, video: Film, file: Paperclip,
};

function MediaThumb({ item }: { item: SlashMediaItem }) {
  const Icon = item.id === 'clipboard' ? ClipboardPaste : KIND_ICONS[item.kind];
  if (item.thumb) {
    return <img src={item.thumb} alt="" className="w-7 h-7 rounded-md object-cover shrink-0 border border-black/5 dark:border-white/10" />;
  }
  return (
    <span className="w-7 h-7 rounded-md shrink-0 flex items-center justify-center bg-slate-100 dark:bg-neutral-800 text-slate-400 dark:text-slate-500">
      <Icon size={14} />
    </span>
  );
}

interface SlashMenuProps {
  items: SlashItem[];
  selected: number;
  position: { top: number; left: number };
  onPick: (index: number) => void;
  onHover: (index: number) => void;
}

export function SlashMenu({ items, selected, position, onPick, onHover }: SlashMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the keyboard selection visible while cycling.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-slash-index="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const firstMedia = items.findIndex((i) => i.type === 'media');

  const row = (item: SlashItem, index: number) => {
    const showPreview = item.type === 'media' && index === selected;

    return (
      <button
        key={item.type === 'media' ? `m-${item.id}` : `s-${item.id}`}
        data-slash-index={index}
        onMouseDown={(e) => e.preventDefault() /* keep the editor caret */}
        onClick={() => onPick(index)}
        onMouseEnter={() => onHover(index)}
        className={`w-full text-left px-3 py-2 rounded-xl flex items-center gap-2.5 text-sm transition-colors relative ${
          index === selected
            ? 'bg-[#32CD32]/12 text-slate-900 dark:text-white'
            : 'text-slate-700 dark:text-slate-300 hover:bg-white/30 dark:hover:bg-white/5'
        }`}
      >
        {item.type === 'syntax' ? (
          <>
            {React.createElement(SYNTAX_ICONS[item.id], { size: 16, className: index === selected ? 'text-[#32CD32]' : 'text-slate-400 dark:text-slate-500' })}
            <span className="flex-1 truncate">{item.label}</span>
            <span className="text-[11px] font-mono text-slate-400 dark:text-neutral-600">{item.hint}</span>
          </>
        ) : (
          <>
            <MediaThumb item={item} />
            <span className="flex-1 truncate">{item.name.replace(/\.[^.]+$/, '')}</span>
            {item.badge && (
              <span className="text-[10px] font-mono uppercase text-slate-400 dark:text-neutral-600">{item.badge}</span>
            )}
          </>
        )}
        
        {/* Media preview popout */}
        {showPreview && item.type === 'media' && (
          <div className="absolute -right-32 top-1/2 -translate-y-1/2 w-28 h-28 rounded-xl overflow-hidden pointer-events-none shadow-lg vx-menu-bulge flex items-center justify-center">
            {item.thumb ? (
              <img
                src={item.thumb}
                alt={item.name}
                className="w-full h-full object-cover"
              />
            ) : (
              React.createElement(item.id === 'clipboard' ? ClipboardPaste : KIND_ICONS[item.kind], { size: 32, className: 'text-slate-400 dark:text-slate-500' })
            )}
          </div>
        )}
      </button>
    );
  };

  return (
    <div
      ref={listRef}
      className="vx-menu-pop absolute z-50 w-72 max-h-80 overflow-y-auto py-1.5 px-1 rounded-2xl vx-menu-bulge shadow-2xl shadow-black/10 dark:shadow-black/50 select-none"
      style={{ top: position.top, left: position.left }}
      // preventDefault keeps the editor caret; stopPropagation keeps the
      // document-level click-away closer from firing before row clicks land.
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      {items.length === 0 && (
        <div className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500">No matches</div>
      )}
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i === firstMedia && firstMedia > 0 && (
            <div className="border-t border-slate-100/50 dark:border-neutral-800/50 my-1 mx-2" />
          )}
          {row(item, i)}
        </React.Fragment>
      ))}
    </div>
  );
}
