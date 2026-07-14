import React, { useState } from 'react';
import { Feather, Hash, FolderOpen, Repeat, Image as ImageIcon, Cloud, ChevronLeft, ChevronRight } from 'lucide-react';

// ---------------------------------------------------------------------------
// One-time feature tour shown on first launch. Dismissing it in any way marks
// it done for good.
// ---------------------------------------------------------------------------

interface OnboardingSlideshowProps {
  onClose: () => void;
}

const SLIDES = [
  {
    icon: Feather,
    title: 'Welcome to Valx Writer',
    body: 'A minimalist space for your prose. Everything you write is saved automatically as you type — no save buttons required.',
  },
  {
    icon: Hash,
    title: 'Write in Markdown',
    body: 'Type # for headings, **bold**, *italic* and - lists right in the page. Ctrl+B and Ctrl+I work too. Right-click any word for spelling suggestions.',
  },
  {
    icon: FolderOpen,
    title: 'Your words live on your disk',
    body: 'Pick a local folder and every note becomes a real file you own.',
  },
  {
    icon: Repeat,
    title: 'Switch formats in one click',
    body: 'The Format option in the sidebar converts your whole workspace between .md, .txt and .html — and warns you before anything would be lost.',
  },
  {
    icon: ImageIcon,
    title: 'Media, export & share',
    body: 'Drag images, audio or video straight into a note. Export to PDF, DOCX, ODT and more, or send notes to your favorite apps.',
  },
  {
    icon: Cloud,
    title: 'Sync it yourself',
    body: 'Keep your workspace in a Google Drive, OneDrive, Dropbox or Mega folder and your notes back up and sync across devices automatically — no account, no sign-in.',
  },
];

export function OnboardingSlideshow({ onClose }: OnboardingSlideshowProps) {
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index];
  const Icon = slide.icon;
  const isLast = index === SLIDES.length - 1;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-black border border-slate-200 dark:border-neutral-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        <div className="flex justify-end p-3 pb-0">
          <button
            onClick={onClose}
            className="text-xs font-medium text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors px-2 py-1"
          >
            Skip
          </button>
        </div>

        <div key={index} className="slide-in px-8 pt-4 pb-6 text-center min-h-[220px] flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-[#32CD32]/10 text-[#32CD32] flex items-center justify-center mb-5 shadow-[0_0_24px_rgba(50,205,50,0.15)]">
            <Icon size={28} />
          </div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{slide.title}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{slide.body}</p>
        </div>

        <div className="flex items-center justify-center gap-2 pb-5">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              aria-label={`Slide ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? 'w-6 bg-[#32CD32]' : 'w-1.5 bg-slate-200 dark:bg-neutral-800 hover:bg-slate-300 dark:hover:bg-neutral-700'
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between px-5 pb-5">
          <button
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              index === 0
                ? 'text-slate-300 dark:text-neutral-700 cursor-default'
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-neutral-900'
            }`}
          >
            <ChevronLeft size={16} /> Back
          </button>
          <button
            onClick={() => (isLast ? onClose() : setIndex((i) => i + 1))}
            className="flex items-center gap-1 px-5 py-2 rounded-lg text-sm font-semibold bg-[#32CD32] hover:bg-[#2eb82e] text-white transition-colors shadow-sm"
          >
            {isLast ? 'Start writing' : 'Next'} {!isLast && <ChevronRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
