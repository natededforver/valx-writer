import React, { useEffect, useMemo, useState } from 'react';
import { Note } from '../types';
import { FileFormat, extractFirstMedia } from '../lib/format';
import { X, Repeat, FileText, Type, Code2, Check, TriangleAlert, Info, Loader2, Download, FileType2, Files, File as FileIcon } from 'lucide-react';

// ---------------------------------------------------------------------------
// The smart Format converter.
//  • Scope: convert every note, or just the one you have open — so you can keep
//    specific files in a different format without changing everything.
//  • Editable formats (.md/.txt/.html) change the note's on-disk file in place.
//  • "Export a copy" (DOCX, or Other… — any custom extension via a Save dialog)
//    writes a standalone copy without touching the editable note.
// ---------------------------------------------------------------------------

type Target = FileFormat | 'docx' | 'other';
const EDITABLE: Target[] = ['.md', '.txt', '.html', '.docx'];
const isEditable = (t: Target): t is FileFormat => (EDITABLE as string[]).includes(t);

interface FormatConverterProps {
  isOpen: boolean;
  onClose: () => void;
  notes: Note[];
  fileFormat: string;
  hasWorkspace: boolean;
  activeNote?: Note | null;
  noteExtensions?: Record<string, string>;
  onConvert: (format: FileFormat) => Promise<number>;
  onConvertNote: (id: string, format: FileFormat) => Promise<boolean>;
}

const FORMAT_META: { format: FileFormat; label: string; icon: React.ReactNode; description: string; tag?: string }[] = [
  {
    format: '.md',
    label: 'Markdown',
    icon: <FileText size={18} />,
    description: 'Portable plain text — # headings, **bold**, lists. Media stays linked by path.',
    tag: 'Recommended',
  },
  {
    format: '.txt',
    label: 'Plain Text',
    icon: <Type size={18} />,
    description: 'Just the words. Formatting and embedded media are stripped when saving.',
  },
  {
    format: '.html',
    label: 'HTML',
    icon: <Code2 size={18} />,
    description: 'Full fidelity — keeps rich formatting and links to your media exactly.',
  },
  {
    format: '.docx',
    label: 'Word (editable)',
    icon: <FileType2 size={18} />,
    description: 'The note itself becomes a real .docx file, overwritten in place on every save. Desktop app only.',
    tag: 'Desktop',
  },
];

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const noteExportHtml = (n: Note) => `<h1>${escapeHtml(n.title || 'Untitled')}</h1>\n${n.content}`;

type RunResult =
  | { mode: 'convert-all'; count: number; fmt: string }
  | { mode: 'convert-note'; fmt: string }
  | { mode: 'export-all'; count: number }
  | { mode: 'export-note' }
  | { mode: 'error'; text: string };

export function FormatConverter({ isOpen, onClose, notes, fileFormat, hasWorkspace, activeNote, noteExtensions = {}, onConvert, onConvertNote }: FormatConverterProps) {
  const [scope, setScope] = useState<'all' | 'note'>('all');
  const [selected, setSelected] = useState<Target>((fileFormat as FileFormat) || '.md');
  const [customExt, setCustomExt] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  const hasElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

  useEffect(() => {
    if (isOpen) {
      setSelected((fileFormat as FileFormat) || '.md');
      setScope(activeNote ? 'note' : 'all');
      setCustomExt('');
      setResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const { activeCount, mediaCount } = useMemo(() => {
    const active = notes.filter((n) => !n.isTrash);
    return {
      activeCount: active.length,
      mediaCount: active.filter((n) => extractFirstMedia(n.content) !== null).length,
    };
  }, [notes]);

  if (!isOpen) return null;

  const activeNotes = notes.filter((n) => !n.isTrash);
  const noteExt = activeNote ? (noteExtensions[activeNote.id] || fileFormat) : fileFormat;
  const exporting = !isEditable(selected);

  // "Already saving as" only blocks in-place editable conversions.
  const isCurrent = isEditable(selected) && (scope === 'note' ? noteExt === selected : fileFormat === selected && scope === 'all');
  const customInvalid = selected === 'other' && !/^[a-z0-9]+$/i.test(customExt.trim());
  const docxNeedsDesktop = selected === '.docx' && !hasElectron;
  const runnable =
    !busy && result === null && !isCurrent && !(exporting && !hasElectron) && !docxNeedsDesktop && !(selected === 'other' && customInvalid);

  const handleRun = async () => {
    if (scope === 'note' && !activeNote) return;
    setBusy(true);
    setResult(null);
    try {
      if (isEditable(selected)) {
        if (scope === 'all') {
          const count = await onConvert(selected);
          setResult({ mode: 'convert-all', count, fmt: selected });
        } else if (activeNote) {
          await onConvertNote(activeNote.id, selected);
          setResult({ mode: 'convert-note', fmt: selected });
        }
      } else {
        const api = (window as any).electronAPI;
        const ext = selected === 'other' ? customExt.trim().toLowerCase() : 'docx';
        if (scope === 'all') {
          const payload = activeNotes.map((n) => ({ title: n.title || 'Untitled', html: noteExportHtml(n) }));
          const r = await api.exportBatch(payload, selected === 'docx' ? 'docx' : 'custom', ext);
          if (r?.success) setResult({ mode: 'export-all', count: r.count });
          else if (r?.canceled) setResult(null);
          else setResult({ mode: 'error', text: r?.error || 'Export failed' });
        } else if (activeNote) {
          const html = noteExportHtml(activeNote);
          const r = selected === 'docx'
            ? await api.exportWithPandoc(html, 'docx', activeNote.title || 'Note')
            : await api.exportCustom(html, ext, activeNote.title || 'Note');
          if (r?.success) setResult({ mode: 'export-note' });
          else if (r?.canceled) setResult(null);
          else setResult({ mode: 'error', text: r?.error || 'Export failed' });
        }
      }
    } catch (err: any) {
      setResult({ mode: 'error', text: err?.message || 'Something went wrong' });
    } finally {
      setBusy(false);
    }
  };

  const warning =
    isEditable(selected) && selected === '.txt' && mediaCount > 0
      ? { tone: 'warn' as const, text: `${mediaCount} ${mediaCount === 1 ? 'note has' : 'notes have'} media that will be dropped from .txt files. Use .md or .html to keep it linked.` }
      : null;

  const scopeCount = scope === 'note' ? 1 : activeCount;
  const scopeWord = scopeCount === 1 ? 'note' : 'notes';

  const runLabel = () => {
    if (result?.mode === 'convert-all') return <><Check size={16} /> {hasWorkspace ? `Converted ${result.count} ${result.count === 1 ? 'note' : 'notes'} to ${result.fmt}` : `Default set to ${result.fmt}`}</>;
    if (result?.mode === 'convert-note') return <><Check size={16} /> This note is now {result.fmt}</>;
    if (result?.mode === 'export-all') return <><Check size={16} /> Exported {result.count} {result.count === 1 ? 'note' : 'notes'}</>;
    if (result?.mode === 'export-note') return <><Check size={16} /> Exported</>;
    if (result?.mode === 'error') return <><TriangleAlert size={16} /> {result.text}</>;
    if (busy) return <><Loader2 size={16} className="animate-spin" /> {exporting ? 'Exporting…' : 'Converting…'}</>;
    if (isCurrent) return `Already saving as ${selected}`;
    if (exporting) {
      const label = selected === 'docx' ? 'DOCX' : (customExt.trim() ? `.${customExt.trim().toLowerCase()}` : 'custom format');
      return <><Download size={16} /> Export {scopeCount} {scopeWord} as {label}</>;
    }
    if (scope === 'all' && !hasWorkspace) return `Set ${selected} as default`;
    return <><Repeat size={16} /> Convert {scopeCount} {scopeWord} to {selected}</>;
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="vx-pop bg-white dark:bg-black border border-slate-200 dark:border-neutral-800 rounded-xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-neutral-900">
          <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold">
            <Repeat size={18} className="text-[#32CD32]" />
            File Format
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-neutral-900 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          {/* Scope */}
          <div className="mb-4">
            <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Apply to</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setScope('all'); setResult(null); }}
                className={`flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-all ${scope === 'all' ? 'border-[#32CD32] bg-[#32CD32]/5 text-slate-900 dark:text-white' : 'border-slate-200 dark:border-neutral-800 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-neutral-700'}`}
              >
                <Files size={15} className={scope === 'all' ? 'text-[#32CD32]' : ''} /> All notes
              </button>
              <button
                onClick={() => { if (activeNote) { setScope('note'); setResult(null); } }}
                disabled={!activeNote}
                title={activeNote ? undefined : 'Open a note to convert just that one'}
                className={`flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-all ${!activeNote ? 'border-slate-100 dark:border-neutral-900 text-slate-300 dark:text-neutral-700 cursor-not-allowed' : scope === 'note' ? 'border-[#32CD32] bg-[#32CD32]/5 text-slate-900 dark:text-white' : 'border-slate-200 dark:border-neutral-800 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-neutral-700'}`}
              >
                <FileIcon size={15} className={scope === 'note' ? 'text-[#32CD32]' : ''} /> This note
              </button>
            </div>
            {scope === 'note' && activeNote && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                “<span className="font-medium text-slate-700 dark:text-slate-200">{activeNote.title || 'Untitled'}</span>” is currently <span className="font-mono text-[#2eb82e] dark:text-[#32CD32]">{noteExt}</span>.
              </p>
            )}
          </div>

          {/* Editable formats */}
          <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Save as (editable)</div>
          <div className="space-y-2">
            {FORMAT_META.map((meta) => {
              const sel = selected === meta.format;
              const current = scope === 'note' ? noteExt === meta.format : fileFormat === meta.format;
              return (
                <button
                  key={meta.format}
                  onClick={() => { setSelected(meta.format); setResult(null); }}
                  className={`w-full text-left p-3 rounded-lg border transition-all flex items-start gap-3 ${sel ? 'border-[#32CD32] bg-[#32CD32]/5 shadow-[0_0_12px_rgba(50,205,50,0.12)]' : 'border-slate-200 dark:border-neutral-800 hover:border-slate-300 dark:hover:border-neutral-700'}`}
                >
                  <span className={`mt-0.5 ${sel ? 'text-[#32CD32]' : 'text-slate-400 dark:text-slate-500'}`}>{meta.icon}</span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-slate-900 dark:text-white">{meta.label}</span>
                      <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{meta.format}</span>
                      {current && <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-slate-100 dark:bg-neutral-900 text-slate-500 dark:text-slate-400">Current</span>}
                      {meta.tag && !current && <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-[#32CD32]/10 text-[#2eb82e] dark:text-[#32CD32] font-medium">{meta.tag}</span>}
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{meta.description}</span>
                  </span>
                  {sel && <Check size={16} className="text-[#32CD32] mt-0.5 shrink-0" />}
                </button>
              );
            })}
          </div>

          {/* Export a copy */}
          <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mt-5 mb-2">Export a copy</div>
          <div className="space-y-2">
            <button
              onClick={() => { setSelected('docx'); setResult(null); }}
              className={`w-full text-left p-3 rounded-lg border transition-all flex items-start gap-3 ${selected === 'docx' ? 'border-[#32CD32] bg-[#32CD32]/5 shadow-[0_0_12px_rgba(50,205,50,0.12)]' : 'border-slate-200 dark:border-neutral-800 hover:border-slate-300 dark:hover:border-neutral-700'}`}
            >
              <span className={`mt-0.5 ${selected === 'docx' ? 'text-[#32CD32]' : 'text-slate-400 dark:text-slate-500'}`}><FileType2 size={18} /></span>
              <span className="flex-1 min-w-0">
                <span className="font-semibold text-sm text-slate-900 dark:text-white">Word (DOCX)</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">A standalone .docx copy with media embedded. The editable note is left as-is.</span>
              </span>
              {selected === 'docx' && <Check size={16} className="text-[#32CD32] mt-0.5 shrink-0" />}
            </button>

            <button
              onClick={() => { setSelected('other'); setResult(null); }}
              className={`w-full text-left p-3 rounded-lg border transition-all flex items-start gap-3 ${selected === 'other' ? 'border-[#32CD32] bg-[#32CD32]/5 shadow-[0_0_12px_rgba(50,205,50,0.12)]' : 'border-slate-200 dark:border-neutral-800 hover:border-slate-300 dark:hover:border-neutral-700'}`}
            >
              <span className={`mt-0.5 ${selected === 'other' ? 'text-[#32CD32]' : 'text-slate-400 dark:text-slate-500'}`}><Download size={18} /></span>
              <span className="flex-1 min-w-0">
                <span className="font-semibold text-sm text-slate-900 dark:text-white">Other format…</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">Pick your own extension and location. Saved as portable text.</span>
                {selected === 'other' && (
                  <span className="mt-2 flex items-center gap-2">
                    <span className="text-sm text-slate-400 dark:text-slate-500 font-mono">.</span>
                    <input
                      value={customExt}
                      onChange={(e) => { setCustomExt(e.target.value.replace(/[^a-z0-9]/gi, '')); setResult(null); }}
                      placeholder="rtf, tex, org…"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      className="w-32 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded px-2 py-1 text-sm font-mono text-slate-900 dark:text-white outline-none focus:border-[#32CD32]"
                    />
                  </span>
                )}
              </span>
              {selected === 'other' && <Check size={16} className="text-[#32CD32] mt-0.5 shrink-0" />}
            </button>
          </div>

          {warning && (
            <div className="mt-4 p-3 rounded-lg text-xs flex items-start gap-2 leading-relaxed bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900">
              <TriangleAlert size={14} className="shrink-0 mt-0.5" /> {warning.text}
            </div>
          )}

          {exporting && !hasElectron && (
            <div className="mt-4 p-3 rounded-lg text-xs flex items-start gap-2 leading-relaxed bg-slate-50 dark:bg-neutral-900 text-slate-500 dark:text-slate-400 border border-slate-100 dark:border-neutral-800">
              <Info size={14} className="shrink-0 mt-0.5" /> Exporting to DOCX and custom formats is available in the Valx desktop app.
            </div>
          )}
          {docxNeedsDesktop && (
            <div className="mt-4 p-3 rounded-lg text-xs flex items-start gap-2 leading-relaxed bg-slate-50 dark:bg-neutral-900 text-slate-500 dark:text-slate-400 border border-slate-100 dark:border-neutral-800">
              <Info size={14} className="shrink-0 mt-0.5" /> Editing notes as .docx is available in the Valx desktop app.
            </div>
          )}

          <button
            onClick={handleRun}
            disabled={!runnable}
            className={`w-full mt-5 py-2.5 px-4 rounded-lg font-medium transition-colors shadow-sm flex items-center justify-center gap-2 ${
              result && result.mode !== 'error'
                ? 'bg-[#32CD32]/15 text-[#2eb82e] dark:text-[#32CD32]'
                : result?.mode === 'error'
                  ? 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400'
                  : !runnable
                    ? 'bg-slate-100 dark:bg-neutral-900 text-slate-400 dark:text-slate-600 cursor-default'
                    : 'bg-[#32CD32] hover:bg-[#2eb82e] text-white'
            }`}
          >
            {runLabel()}
          </button>
        </div>
      </div>
    </div>
  );
}
