import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Note, JumpTarget } from '../types';
import { plainText } from '../lib/search';
import { Trash2, RotateCcw, XCircle, Maximize2, Minimize2, Share2, Download, Printer, Search, X, Check, ChevronDown, ChevronUp, Eye, EyeOff, Copy, Send, Table, Smartphone, Monitor, History, CodeXml, ArrowLeft, ArrowRight, AlignLeft, AlignCenter, AlignRight, Bold, Italic, Strikethrough, CheckSquare, Type, MoreHorizontal, Minus, Square, Play, ChevronRight, Plus } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '../lib/desktop';
import { RichTextEditor } from './RichTextEditor';
import { formatKind, htmlToMarkdown, markdownToHtml, wordCount } from '../lib/format';
import { codeLangFromExt, highlightCode, buildPreviewDoc, PREVIEWABLE } from '../lib/codeHighlight';
import { mediaDisplayHtml, previewMediaBase } from '../lib/desktop';
import { LS_LINE_COUNTER, LINE_COUNTER_EVENT, LS_HISTORY_INTERVAL, HISTORY_INTERVAL_EVENT, DEFAULT_HISTORY_INTERVAL, LS_WORDCOUNT, LS_WORDCOUNT_GOAL, WORDCOUNT_EVENT } from './SettingsModal';
import { Creator, CREATORS_EVENT, creatorMeName, setCreatorMeName, loadCreators, saveCreators, newCreatorId } from '../lib/creators';
import { deriveByline, stripByline, syncByline, bylineIsEmpty } from '../lib/byline';
import { Snapshot, pushSnapshot, loadHistory, saveHistory } from '../lib/history';
import html2pdf from 'html2pdf.js';
import { asBlob } from 'html-docx-js-typescript';
import { saveAs } from 'file-saver';
import { SHARE_TARGETS, ShareTarget, openShareUrl, plainTextOfNote, htmlToPlain } from '../lib/share';
import { Mail } from 'lucide-react';

// Real app icon for a share target, fetched from Google's favicon service.
// Offline or blocked, it degrades to the target's brand-color swatch.
function TargetIcon({ target }: { target: ShareTarget }) {
  const [failed, setFailed] = useState(false);
  if (target.id === 'email') {
    return <Mail size={15} className="text-slate-500 dark:text-slate-400 shrink-0" />;
  }
  if (!target.domain || failed) {
    return (
      <span
        className="w-3.5 h-3.5 rounded-full shrink-0 ring-1 ring-black/10 dark:ring-white/20"
        style={{ backgroundColor: target.color }}
      />
    );
  }
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${target.domain}&sz=32`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="w-4 h-4 shrink-0 rounded-[3px]"
    />
  );
}

interface EditorProps {
  note: Note | null;
  updateNote: (id: string, updates: Partial<Note>) => void;
  moveToTrash: (id: string) => void;
  restoreFromTrash: (id: string) => void;
  deleteNotePerm: (id: string) => void;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  onAddNoteWithContent: (title: string, content: string) => void;
  onMergeNotes?: (ids: string[]) => void;
  onSaveNow?: (id: string) => Promise<void>;
  jumpTo?: JumpTarget | null;
  /** Clicked in-note link resolved to a workspace note — true if handled. */
  onOpenNoteLink?: (href: string) => boolean;
  /** Extension the note's file is saved with (e.g. ".html") */
  noteExt?: string;
  /** Workspace media for the '/' menu (attachments imported into any note). */
  listAttachments?: () => Promise<any[]>;
  /** Desktop sidebar visibility — drives the single toggle arrow in the toolbar. */
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  className?: string;
}

export function Editor({ note, updateNote, moveToTrash, restoreFromTrash, deleteNotePerm, isFullscreen, toggleFullscreen, onAddNoteWithContent, onMergeNotes, onSaveNow, jumpTo, onOpenNoteLink, noteExt = '', listAttachments, sidebarOpen, onToggleSidebar, className = '' }: EditorProps) {
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [droppedTextFiles, setDroppedTextFiles] = useState<globalThis.File[] | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  
  const [isFindVisible, setIsFindVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [tableMenu, setTableMenu] = useState(false);
  const [formatMenu, setFormatMenu] = useState(false);
  const [tHover, setTHover] = useState({ r: 0, c: 0 });

  // Code notes (html/css/js/ts/py) edit as raw source with syntax colors and an
  // optional line-number gutter; prose notes use the rich editor. Only
  // html/css/js can be previewed (the others have no standalone render).
  const codeLang = codeLangFromExt(noteExt);
  const isCodeNote = codeLang !== null;
  const canPreview = codeLang !== null && PREVIEWABLE.has(codeLang);

  // Line counter: a per-app toggle in Settings. Read once, then kept live via
  // the event Settings fires on apply (no reload needed).
  const [lineCounter, setLineCounter] = useState(() => localStorage.getItem(LS_LINE_COUNTER) === 'true');
  useEffect(() => {
    const onChange = (e: any) => setLineCounter(!!e.detail);
    window.addEventListener(LINE_COUNTER_EVENT, onChange);
    return () => window.removeEventListener(LINE_COUNTER_EVENT, onChange);
  }, []);

  // Word-count widget (corner pill) + optional goal — live-updated from Settings.
  const [wcOn, setWcOn] = useState(() => localStorage.getItem(LS_WORDCOUNT) !== 'false');
  const [wcGoal, setWcGoal] = useState(() => parseInt(localStorage.getItem(LS_WORDCOUNT_GOAL) || '0', 10) || 0);
  useEffect(() => {
    const onChange = (e: any) => { setWcOn(!!e.detail?.enabled); setWcGoal(e.detail?.goal || 0); };
    window.addEventListener(WORDCOUNT_EVENT, onChange);
    return () => window.removeEventListener(WORDCOUNT_EVENT, onChange);
  }, []);

  // Word-count pill visibility: fades out while actively typing so it never
  // competes with the words; reappears the moment the pointer moves (to peek at
  // progress) and once typing pauses. Two independent timers — "typing" and
  // "pointer active" — and the pill is hidden only when typing AND the pointer
  // is idle.
  const [wcTyping, setWcTyping] = useState(false);
  const [wcHover, setWcHover] = useState(false);
  const wcTypeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wcHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!note) return;
    setWcTyping(true);
    if (wcTypeTimer.current) clearTimeout(wcTypeTimer.current);
    wcTypeTimer.current = setTimeout(() => setWcTyping(false), 1500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.content]);
  const bumpWcHover = () => {
    setWcHover(true);
    if (wcHoverTimer.current) clearTimeout(wcHoverTimer.current);
    wcHoverTimer.current = setTimeout(() => setWcHover(false), 1800);
  };
  useEffect(() => () => {
    if (wcTypeTimer.current) clearTimeout(wcTypeTimer.current);
    if (wcHoverTimer.current) clearTimeout(wcHoverTimer.current);
  }, []);

  // Goal reached: when the live count first crosses the goal (by typing, not by
  // opening an already-finished note), flash a gentle "You've written enough."
  // and surface the pill again for a moment.
  const wcCount = note ? wordCount(note.content) : 0;
  const goalReached = wcGoal > 0 && wcCount >= wcGoal;
  const [goalCheer, setGoalCheer] = useState(false);
  const goalStateRef = useRef<{ id: string | null; reached: boolean }>({ id: null, reached: false });
  const goalCheerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!note) return;
    const st = goalStateRef.current;
    if (st.id !== note.id) { goalStateRef.current = { id: note.id, reached: goalReached }; return; }
    if (goalReached && !st.reached) {
      setGoalCheer(true);
      if (goalCheerTimer.current) clearTimeout(goalCheerTimer.current);
      goalCheerTimer.current = setTimeout(() => setGoalCheer(false), 3500);
    }
    goalStateRef.current = { id: note.id, reached: goalReached };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, goalReached]);
  useEffect(() => () => { if (goalCheerTimer.current) clearTimeout(goalCheerTimer.current); }, []);

  // Creators — the primary creator name (replaces "Me") and any extra human
  // authors, both global. Kept live via CREATORS_EVENT so the menu, byline and
  // native "Mark as" list all move together. creatorsVersion just forces the
  // byline to re-derive when a name changes (the marks themselves didn't).
  const [creatorMe, setCreatorMe] = useState(() => creatorMeName());
  const [creators, setCreators] = useState<Creator[]>(() => loadCreators());
  const [creatorsVersion, setCreatorsVersion] = useState(0);
  useEffect(() => {
    const onChange = () => { setCreatorMe(creatorMeName()); setCreators(loadCreators()); setCreatorsVersion((v) => v + 1); };
    window.addEventListener(CREATORS_EVENT, onChange);
    return () => window.removeEventListener(CREATORS_EVENT, onChange);
  }, []);
  const addCreator = () => saveCreators([...loadCreators(), { id: newCreatorId(), name: '' }]);
  const updateCreatorName = (id: string, name: string) => saveCreators(loadCreators().map((c) => (c.id === id ? { ...c, name } : c)));
  const removeCreator = (id: string) => saveCreators(loadCreators().filter((c) => c.id !== id));

  // Keep the managed byline block current inside the STORED note content (so it
  // exports/prints with the file). syncByline is idempotent, so once the stored
  // content matches this no-ops — it only writes when the creator name or the
  // note's provenance marks actually changed. Byline is prose-only (md/html);
  // code, txt and docx notes are left untouched.
  const bylineFormat = (ext: string) => { const k = formatKind(ext || '.md'); return k === 'md' || k === 'html'; };
  useEffect(() => {
    if (!note || note.isTrash || isCodeNote || !bylineFormat(noteExt)) return;
    const desired = syncByline(note.content);
    if (desired !== note.content) updateNote(note.id, { content: desired });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, note?.content, noteExt, isCodeNote, creatorsVersion]);

  // In-app preview: a sandboxed iframe rendered over the editor. srcDoc is
  // debounced so typing doesn't reload the frame every keystroke. sandbox has
  // NO allow-same-origin, so the preview (which runs the note's own scripts)
  // sits on an opaque origin and can't reach the app's electronAPI; media still
  // loads because buildPreviewDoc rewrites /__media/ to the app origin (a
  // cross-origin subresource, which the sandbox permits).
  const [showPreview, setShowPreview] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  // null = not built yet; the iframe only mounts once the doc exists. Mounting
  // with srcDoc="" and setting the real content a tick later races the initial
  // empty document's commit in Chromium and the navigation is swallowed — that
  // was the blank-preview bug (and the rebuilt string was identical, so React
  // never re-set the attribute to recover). One debounced build also stops the
  // frame reloading on every keystroke.
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  useEffect(() => { if (!canPreview) setShowPreview(false); }, [canPreview, note?.id]);
  useEffect(() => {
    if (!showPreview || !note || !codeLang) { setPreviewSrc(null); return; }
    const id = setTimeout(
      () => setPreviewSrc(buildPreviewDoc(mediaDisplayHtml(note.content), codeLang, previewMediaBase())),
      150
    );
    return () => clearTimeout(id);
  }, [showPreview, note?.content, codeLang]);

  // Markdown source view: a toggle for .md notes that swaps the rich editor
  // for a highlighted raw-markdown surface (syntax marks faded via .tok-mdsyn).
  // The note still stores editor HTML — source edits go through the tested
  // markdownToHtml round trip on every change, exactly like a disk load.
  const isMdNote = !isCodeNote && formatKind(noteExt || '.md') === 'md';
  const [mdSource, setMdSource] = useState(false);
  const [syntaxViewer, setSyntaxViewer] = useState(true);
  const [mdText, setMdText] = useState('');
  // The last HTML this surface committed — external content changes (history
  // revert, workspace rescan) are anything different, and re-derive the text.
  const lastMdCommitRef = useRef<string | null>(null);
  useEffect(() => { setMdSource(false); lastMdCommitRef.current = null; }, [note?.id]);
  useEffect(() => {
    if (!mdSource || !note) return;
    if (lastMdCommitRef.current !== null && note.content === lastMdCommitRef.current) return;
    // Byline is a managed block, not something the user hand-edits — keep it out
    // of the raw markdown surface; syncByline re-adds it when edits commit.
    setMdText(htmlToMarkdown(stripByline(note.content)));
    lastMdCommitRef.current = note.content;
  }, [mdSource, note?.content]);
  const handleMdChange = (text: string) => {
    if (!note) return;
    setMdText(text);
    const stored = syncByline(markdownToHtml(text));
    lastMdCommitRef.current = stored;
    updateNote(note.id, { content: stored });
  };
  const toggleMdSource = () => {
    if (!mdSource && note) {
      setMdText(htmlToMarkdown(stripByline(note.content)));
      lastMdCommitRef.current = note.content;
    }
    setMdSource((v) => !v);
  };
  const mdHl = useMemo(() => (mdSource ? highlightCode(mdText, 'md') : ''), [mdSource, mdText]);

  // Code editor overlay: the highlighted <pre> and the gutter track the
  // textarea's scroll via transform (see .vx-code in index.css).
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const hlRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const syncCodeScroll = () => {
    const ta = codeRef.current;
    if (!ta) return;
    if (hlRef.current) hlRef.current.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-ta.scrollTop}px)`;
  };
  const lineCount = isCodeNote ? (note?.content.split('\n').length || 1) : 0;
  // Memoized: re-tokenizing the whole document belongs to text changes only,
  // not to every cosmetic re-render (save flash, menu toggles, preview timer).
  const codeHl = useMemo(
    () => (isCodeNote && note && syntaxViewer ? highlightCode(note.content, codeLang!) : ''),
    [isCodeNote, note?.content, codeLang, syntaxViewer]
  );

  // Version history: snapshot the open note every `historyIntervalMin` minutes
  // (Settings). The interval reads the live content through a ref so it never
  // captures a stale closure. Reverting first snapshots the current content,
  // then applies the chosen version — nothing is lost, and every state
  // (including the one you just left) stays reachable from the list.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<Snapshot[]>([]);
  const [historyIntervalMin, setHistoryIntervalMin] = useState(() => {
    const v = parseInt(localStorage.getItem(LS_HISTORY_INTERVAL) || '', 10);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_HISTORY_INTERVAL;
  });
  const noteRef = useRef(note);
  noteRef.current = note;
  useEffect(() => {
    const onChange = (e: any) => setHistoryIntervalMin(e.detail);
    window.addEventListener(HISTORY_INTERVAL_EVENT, onChange);
    return () => window.removeEventListener(HISTORY_INTERVAL_EVENT, onChange);
  }, []);
  useEffect(() => {
    if (!note || note.isTrash) return;
    const id = setInterval(async () => {
      const cur = noteRef.current;
      if (!cur || cur.isTrash) return;
      const prev = await loadHistory(cur.id);
      const next = pushSnapshot(prev, cur.content, Date.now());
      if (next !== prev) await saveHistory(cur.id, next);
    }, Math.max(1, historyIntervalMin) * 60_000);
    return () => clearInterval(id);
  }, [note?.id, note?.isTrash, historyIntervalMin]);
  useEffect(() => { setHistoryOpen(false); }, [note?.id]);
  const openHistory = async () => {
    const willOpen = !historyOpen;
    setHistoryOpen(willOpen);
    if (willOpen && note) setVersions((await loadHistory(note.id)).slice().reverse());
  };
  const revertTo = async (snap: Snapshot) => {
    const cur = noteRef.current;
    if (!cur) return;
    await saveHistory(cur.id, pushSnapshot(await loadHistory(cur.id), cur.content, Date.now()));
    updateNote(cur.id, { content: snap.content });
    setHistoryOpen(false);
  };
  const versionLabel = (t: number) =>
    new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const versionPreview = (c: string) =>
    c.replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 48) || '(empty)';

  // Find in note — reuses the RichTextEditor `jumpTo` channel that workspace
  // search already drives (select + scroll to the Nth occurrence), so there is
  // no second match-locating implementation. Match count is derived the same
  // way lib/search derives occurrence ordinals, keeping the two in step.
  const [findIdx, setFindIdx] = useState(0);
  const [findJump, setFindJump] = useState<JumpTarget | null>(null);
  const findNonce = useRef(0);
  const lastFound = useRef('');
  const matchCount = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || !note) return 0;
    const body = plainText(note.content).toLowerCase();
    let n = 0;
    for (let i = body.indexOf(q); i !== -1; i = body.indexOf(q, i + q.length)) n += 1;
    return n;
  }, [searchQuery, note?.content]);

  const gotoMatch = (i: number) => {
    if (!note || !matchCount) return;
    const n = ((i % matchCount) + matchCount) % matchCount;
    setFindIdx(n);
    findNonce.current += 1;
    setFindJump({ noteId: note.id, query: searchQuery.trim(), occurrence: n, nonce: findNonce.current });
  };
  // Enter lands on the first hit for a fresh query, then walks forward.
  const findEnter = () => {
    const q = searchQuery.trim();
    if (!q) return;
    if (q !== lastFound.current) { lastFound.current = q; gotoMatch(0); }
    else gotoMatch(findIdx + 1);
  };
  useEffect(() => { setFindJump(null); lastFound.current = ''; setFindIdx(0); }, [note?.id]);

  // The window-chrome strip (window controls + Menu/Style dropdowns) is nested
  // in the editor and hidden by default — the writing surface stays clean.
  // It reveals only when the pointer reaches the top edge, when the sidebar is
  // open, or while one of its own menus/panels is open. No timer, no reveal on
  // typing (deliberately — the user asked for hover/sidebar only).
  const [topHover, setTopHover] = useState(false);
  // Which top menu (File/Edit/Format/View/Authors) is open, if any.
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // File-menu flyout (Export as / Send to), and the author's own display name.
  const [fileSub, setFileSub] = useState<'export' | 'send' | null>(null);
  useEffect(() => { if (openMenu !== 'file') setFileSub(null); }, [openMenu]);
  // Provenance highlighting — which marks are dimmed (hidden). Your own writing
  // is never marked; paste/ai/web/human are the toggleable kinds.
  const [hiddenAuthors, setHiddenAuthors] = useState<Set<'paste' | 'ai' | 'web' | 'human'>>(new Set());
  const toggleAuthor = (a: 'paste' | 'ai' | 'web' | 'human') =>
    setHiddenAuthors((prev) => { const n = new Set(prev); n.has(a) ? n.delete(a) : n.add(a); return n; });
  const anyChromeMenuOpen = tableMenu || openMenu !== null || historyOpen || isFindVisible || showPreview;
  // Windowed: the iA-Writer chrome is persistent. Fullscreen: it auto-hides for
  // distraction-free writing, revealing on top-edge hover or while a menu is open.
  const chromeVisible = topHover || anyChromeMenuOpen;
  const chromeShown = !isFullscreen || chromeVisible;

  // Toggling the sidebar off drops straight into fullscreen. Snapping the
  // chrome away in the usual 300ms reads as a glitch, so the entry into
  // fullscreen (and only that) gets a long fade — the bar dissolves instead of
  // leaving. Reverts to the snappy timing afterwards, so hover reveal/hide
  // stays responsive.
  const SLOW_FADE_MS = 1600;
  const [slowFade, setSlowFade] = useState(false);
  useEffect(() => {
    if (!isFullscreen) { setSlowFade(false); return; }
    setSlowFade(true);
    const t = setTimeout(() => setSlowFade(false), SLOW_FADE_MS);
    return () => clearTimeout(t);
  }, [isFullscreen]);
  // Applied to the chrome and to the writing surface's top padding, so the
  // text rises at the same rate the bar fades instead of jumping under it.
  const chromeFadeCls = slowFade ? 'duration-[1600ms]' : 'duration-300';

  // Shared class strings for the menu bar dropdowns.
  const menuBtnCls = (id: string) => `px-2.5 flex items-center text-[13px] rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors ${openMenu === id ? 'bg-black/5 dark:bg-white/10 text-slate-900 dark:text-white' : ''}`;
  const menuPopCls = 'vx-menu-pop absolute top-8 left-0 z-50 min-w-52 bg-white dark:bg-neutral-950 border border-slate-100 dark:border-neutral-800 shadow-xl rounded-lg py-1';
  const itemCls = 'w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-neutral-900 flex items-center gap-2 text-slate-700 dark:text-slate-200 transition-colors';
  const sectionCls = 'px-3 pt-1.5 pb-0.5 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest';
  const dividerCls = 'my-1 border-t border-slate-100 dark:border-neutral-800';
  const shortcutCls = 'ml-auto text-[10px] text-slate-400 dark:text-slate-500 tabular-nums pl-4';

  // Window controls (Tauri). No-ops in the browser preview (isTauri false).
  const winMinimize = () => { if (isTauri) getCurrentWindow().minimize(); };
  const winMaximize = () => { if (isTauri) getCurrentWindow().toggleMaximize(); };
  const winClose = () => { if (isTauri) getCurrentWindow().close(); };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Ctrl+S: flush the note to disk and play the save feedback (lime border
  // glow + centered "Saved!" pill). Keyed by timestamp so a rapid second
  // Ctrl+S restarts the animation instead of being swallowed.
  const [savedFlash, setSavedFlash] = useState<number | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const handleSaveKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!note || note.isTrash) return;
        onSaveNow?.(note.id).catch(console.error);
        setSavedFlash(Date.now());
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSavedFlash(null), 1600);
      }
    };
    window.addEventListener('keydown', handleSaveKey);
    return () => window.removeEventListener('keydown', handleSaveKey);
  }, [note, onSaveNow]);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  // Global keybind for fullscreen toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle fullscreen with F11 or Ctrl+Enter
      if (e.key === 'F11' || (e.ctrlKey && e.key === 'Enter')) {
        e.preventDefault();
        toggleFullscreen();
      }
      
      // Exit fullscreen on Escape
      if (e.key === 'Escape' && isFullscreen) {
        e.preventDefault();
        toggleFullscreen();
      }

      // Ctrl+F toggles Find at the header icon
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsFindVisible((v) => !v);
      }

      // Ctrl+P for Print
      if (e.ctrlKey && e.key === 'p') {
        // Let native print dialog handle it
      }

      // Close Find on Escape
      if (e.key === 'Escape' && isFindVisible) {
        setIsFindVisible(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, toggleFullscreen, isFindVisible]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const isNotesDrag = e.dataTransfer.types.includes('application/x-bear-notes');
    if (isNotesDrag && !note?.isTrash) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    setIsDragOver(false);
    if (note?.isTrash) return;

    try {
      const data = e.dataTransfer.getData('application/x-bear-notes');
      if (data && onMergeNotes) {
        e.preventDefault();
        const noteIds = JSON.parse(data) as string[];
        onMergeNotes(noteIds);
      }
    } catch (err) {
      console.error('Invalid drop data', err);
    }
  };

  if (!note) {
    return (
      <div 
        className={`flex-1 bg-white dark:bg-black vx-editor-opaque flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 relative ${className}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Slim chrome strip so the window stays draggable/closable with no note open. */}
        <div className="hidden md:flex absolute top-0 inset-x-0 h-10 items-center px-3 z-40 vx-glass-strong">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="p-2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors rounded-md hover:bg-slate-50 dark:hover:bg-neutral-900"
              title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            >
              {sidebarOpen ? <ArrowLeft size={18} /> : <ArrowRight size={18} />}
            </button>
          )}
          <div data-tauri-drag-region className="flex-1 h-full" />
          {isTauri && (
            <div className="flex items-center -mr-2 shrink-0">
              <button onClick={winMinimize} aria-label="Minimize" className="w-10 h-10 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"><Minus size={15} /></button>
              <button onClick={winMaximize} aria-label="Maximize" className="w-10 h-10 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"><Square size={12} /></button>
              <button onClick={winClose} aria-label="Close" className="w-10 h-10 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-[#e81123] hover:text-white transition-colors"><X size={15} /></button>
            </div>
          )}
        </div>
        Select or create a note to start writing.
        {isDragOver && (
          <div className="absolute inset-0 bg-[#32CD32]/10 border-4 border-dashed border-[#32CD32] z-50 flex items-center justify-center pointer-events-none transition-all">
            <div className="bg-white dark:bg-neutral-900 px-6 py-3 rounded-full font-bold text-[#32CD32] shadow-xl flex items-center gap-2">
              <Copy size={20} />
              Merge Notes Here
            </div>
          </div>
        )}
      </div>
    );
  }

  // Per-note body alignment (not a global setting) — center is the default;
  // set from the Format menu's Left/Center/Right controls.
  // Left is the default now (undefined === left), matching the iA-Writer look.
  const align = note.align ?? 'left';
  const alignClass = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';

  // Byline (prose md/html only): a read-only "By … · with … · Source:" line
  // under the title. It's rendered from the note body (byline stripped so it
  // isn't shown twice) plus the global creator name; the same data is what the
  // sync effect stores into the file. creatorMe/creatorsVersion are in the dep
  // path via state so a name change re-derives it. The editor is fed the
  // stripped body so the managed block never lands inside the editable surface.
  const bylineEligible = !isCodeNote && !note.isTrash && bylineFormat(noteExt);
  const editorBody = bylineEligible ? stripByline(note.content) : note.content;
  const bctx = bylineEligible ? deriveByline(editorBody) : null;
  void creatorMe; // re-derive byline on primary-name change
  const showByline = !!bctx && !bylineIsEmpty(bctx);

  const handlePrint = () => {
    setIsShareOpen(false);

    // note.content stores the canonical /__media/… form (see desktop.ts) —
    // without mediaDisplayHtml's rewrite to the real asset:// URL, images
    // never had a resolvable src in the print iframe at all. <audio>/<video>
    // have no print-time visual representation (a native player just draws
    // blank or clipped controls), so they're swapped for a plain text badge
    // instead of shipping a broken player to the page.
    const printDiv = document.createElement('div');
    printDiv.innerHTML = mediaDisplayHtml(note.content);
    const badgeFor = (kind: string, src: string) => {
      const name = decodeURIComponent((src.split('/').pop() || '').split('?')[0]) || `${kind} file`;
      const badge = document.createElement('div');
      badge.className = 'vx-print-media-badge';
      badge.textContent = `${kind === 'audio' ? '\u{1F50A}' : '\u{1F3AC}'} ${kind === 'audio' ? 'Audio' : 'Video'} file: ${name}`;
      return badge;
    };
    printDiv.querySelectorAll('audio').forEach((el) => el.replaceWith(badgeFor('audio', el.getAttribute('src') || '')));
    printDiv.querySelectorAll('video').forEach((el) => el.replaceWith(badgeFor('video', el.getAttribute('src') || '')));
    const printableContent = printDiv.innerHTML;

    // Create an iframe to print only the note content without app chrome or browser metadata
    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.width = '0px';
    iframe.style.height = '0px';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);
    
    const doc = iframe.contentWindow?.document;
    if (!doc) return;
    
    doc.open();
    doc.write(`
      <html>
        <head>
          <title>${note.title || 'Note'}</title>
          <style>
            @page {
              size: auto;
              margin: 0mm; /* This removes the header and footer metadata */
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              padding: 20mm;
              line-height: 1.6;
              color: #000;
            }
            h1 {
              font-size: 2.5em;
              margin-bottom: 0.5em;
              font-weight: 700;
              letter-spacing: -0.02em;
            }
            .content {
              font-size: 1.1em;
            }
            /* Preserve spacing */
            br {
              display: block;
              margin-top: 0.5em;
            }
            img {
              max-width: 100%;
              height: auto;
              object-fit: contain;
            }
            ul {
              margin-top: 0.5em;
              margin-bottom: 0.5em;
            }
            .vx-print-media-badge {
              display: block;
              margin: 0.75em 0;
              padding: 0.5em 0.9em;
              border: 1px solid #999;
              border-radius: 6px;
              font-style: italic;
              color: #444;
              width: fit-content;
            }
          </style>
        </head>
        <body>
          <h1>${note.title || 'Untitled'}</h1>
          <div class="content">${printableContent}</div>
        </body>
      </html>
    `);
    doc.close();
    
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      
      // Cleanup after a delay to ensure printing dialog is opened
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 500);
    };
  };

  const handlePandocExport = async (format: 'pdf' | 'docx' | 'odt' | 'txt' | 'md' | 'html') => {
    // @ts-ignore
    if (window.electronAPI && window.electronAPI.exportWithPandoc) {
      let content = `<h1>${note.title}</h1>\n${note.content}`;
      // @ts-ignore
      const result = await window.electronAPI.exportWithPandoc(content, format, note.title || 'Note');
      if (result && result.success) {
        showToast(`Exported successfully to ${format.toUpperCase()}`);
      } else if (result && result.error) {
        showToast(`Export failed: ${result.error}`);
      }
      setIsShareOpen(false);
    } else {
      if (format === 'pdf') handleDownloadPdf();
      else if (format === 'docx' || format === 'odt') handleDownloadDocx();
      else if (format === 'txt' || format === 'html') handleDownload(format);
      else if (format === 'md') handleDownloadMd();
    }
  };

  const handleDownloadMd = () => {
    let md = note.content.replace(/<br\s*\/?>/gi, '\n');
    md = md.replace(/<(b|strong)>(.*?)<\/\1>/gi, '**$2**');
    md = md.replace(/<(i|em)>(.*?)<\/\1>/gi, '*$2*');
    md = md.replace(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi, '![image]($1)');
    md = md.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
    const content = `# ${note.title || 'Untitled'}\n\n${md}`;
    const blob = new Blob([content], { type: 'text/markdown' });
    saveAs(blob, `${note.title || 'Note'}.md`);
    setIsShareOpen(false);
  };

  // Send the note to another app. The full plain text is always copied to the
  // clipboard first (the target window steals focus and prefill URLs are length
  // capped), then the destination opens in the system browser / mail client.
  const handleSendTo = async (target: ShareTarget) => {
    setIsShareOpen(false);
    const title = note.title || 'Untitled';
    const body = htmlToPlain(note.content);
    try {
      const api = (window as any).electronAPI;
      if (api?.clipboardWriteText) await api.clipboardWriteText(plainTextOfNote(note));
      else await navigator.clipboard.writeText(plainTextOfNote(note));
    } catch {
      /* clipboard may be blocked; prefill targets still carry the note */
    }
    const built = target.buildUrl(title, body);
    showToast(target.hint(built.truncated));
    openShareUrl(built.url);
  };

  const handleDownload = (format: 'txt' | 'html') => {
    const plainText = note.title + '\n\n' + note.content.replace(/<br\s*\/?>/gi, '\n').replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '');
    let content = format === 'txt' ? plainText : `<h1>${note.title}</h1>\n${note.content}`;
    let mimeType = format === 'txt' ? 'text/plain' : 'text/html';
    let extension = format === 'txt' ? '.txt' : '.html';
    
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (note.title || 'Note') + extension;
    a.click();
    URL.revokeObjectURL(url);
    setIsShareOpen(false);
  };

  const handleDownloadPdf = () => {
    const element = document.createElement('div');
    element.innerHTML = `<h1>${note.title}</h1><br/>${note.content}`;
    element.style.padding = '40px';
    element.style.fontFamily = 'sans-serif';
    element.style.color = 'black'; // ensure black text

    const opt = {
      margin:       1,
      filename:     `${note.title || 'Note'}.pdf`,
      image:        { type: 'jpeg' as const, quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' as const }
    };

    html2pdf().set(opt).from(element).save();
    setIsShareOpen(false);
  };

  const handleDownloadDocx = async () => {
    const htmlString = `<!DOCTYPE html><html><head><title>${note.title}</title></head><body><h1>${note.title}</h1>${note.content}</body></html>`;
    const blob = await asBlob(htmlString);
    saveAs(blob as Blob, `${note.title || 'Note'}.docx`);
    setIsShareOpen(false);
  };

  const handleCopyToClipboard = async () => {
      const plainText = note.title + '\n\n' + note.content.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
      try {
          const api = (window as any).electronAPI;
          if (api?.clipboardWriteText) await api.clipboardWriteText(plainText);
          else await navigator.clipboard.writeText(plainText);
          showToast("Copied to clipboard!");
      } catch(err) {
          showToast("Failed to copy to clipboard.");
      }
      setIsShareOpen(false);
  };

  // Each file's text -> HTML, joined in drop order with a blank line between
  // files so a multi-file drop reads as one continuous document, not a wall
  // of run-together text.
  const mergedHtmlFromFiles = async (files: globalThis.File[]): Promise<string> => {
    const htmlParts = await Promise.all(files.map(async (f) => (await f.text()).replace(/\n/g, '<br>')));
    return htmlParts.join('<br><br>');
  };

  const handleMergeTextFile = async () => {
    if (!droppedTextFiles?.length) return;
    const htmlText = await mergedHtmlFromFiles(droppedTextFiles);
    updateNote(note.id, { content: note.content + (note.content ? '<br><br>' : '') + htmlText });
    setDroppedTextFiles(null);
  };

  const handleOpenNewWindow = async () => {
    if (!droppedTextFiles?.length) return;
    const htmlText = await mergedHtmlFromFiles(droppedTextFiles);
    const title = droppedTextFiles.length === 1
      ? droppedTextFiles[0].name.replace(/\.[^/.]+$/, '')
      : `${droppedTextFiles[0].name.replace(/\.[^/.]+$/, '')} + ${droppedTextFiles.length - 1} more`;
    onAddNoteWithContent(title, htmlText);
    setDroppedTextFiles(null);
  };



  return (
    <div
      className={`flex-1 bg-white dark:bg-black vx-editor-opaque flex flex-col h-full overflow-hidden relative ${[...hiddenAuthors].map((a) => 'vx-hide-' + a).join(' ')} ${className}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onMouseMove={bumpWcHover}
    >
      
      {/* Toast */}
      {toastMessage && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-4 py-2 rounded-full shadow-lg z-50 text-sm font-medium animate-in fade-in slide-in-from-top-4">
          {toastMessage}
        </div>
      )}

      {isDragOver && (
        <div className="absolute inset-0 bg-[#32CD32]/10 border-4 border-dashed border-[#32CD32] z-50 flex items-center justify-center pointer-events-none transition-all">
          <div className="bg-white dark:bg-neutral-900 px-6 py-3 rounded-full font-bold text-[#32CD32] shadow-xl flex items-center gap-2">
            <Copy size={20} />
            Merge Notes Here
          </div>
        </div>
      )}

      {/* Fullscreen reveal sensor (windowed chrome is always shown). */}
      {isFullscreen && !chromeShown && (
        <div className="hidden md:block absolute top-0 inset-x-0 h-2 z-40" onMouseEnter={() => setTopHover(true)} />
      )}

      {/* iA-Writer-style chrome: title bar + menu bar. Persistent when windowed,
          auto-hides in fullscreen (reveal on top-edge hover / while a menu is open). */}
      <div
        onMouseLeave={() => setTopHover(false)}
        className={`absolute top-0 inset-x-0 z-50 vx-glass-strong transition-[transform,opacity] ${chromeFadeCls} ease-[cubic-bezier(0.16,1,0.3,1)] ${chromeShown ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'}`}
      >
        {/* Title bar — sidebar toggle · centered doc title (drag region) · window controls */}
        <div className="h-9 flex items-center px-1.5 gap-1 text-slate-400 dark:text-slate-500">
          {onToggleSidebar && (
            <button onClick={onToggleSidebar} className="hidden md:flex p-1.5 rounded-md hover:text-slate-600 dark:hover:text-slate-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors" title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}>
              {sidebarOpen ? <ArrowLeft size={17} /> : <ArrowRight size={17} />}
            </button>
          )}
          <div data-tauri-drag-region className="flex-1 h-full flex items-center justify-center min-w-0">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate px-2 pointer-events-none">
              {(note.title || 'Untitled')} — Valx
            </span>
          </div>
          {isTauri && (
            <div className="flex items-center -mr-1 shrink-0">
              <button onClick={winMinimize} aria-label="Minimize" className="w-11 h-9 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"><Minus size={15} /></button>
              <button onClick={winMaximize} aria-label="Maximize" className="w-11 h-9 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"><Square size={12} /></button>
              <button onClick={winClose} aria-label="Close" className="w-11 h-9 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-[#e81123] hover:text-white transition-colors"><X size={15} /></button>
            </div>
          )}
        </div>

        {/* Menu bar */}
        <div className="h-8 flex items-stretch px-1 gap-0.5 border-t border-black/5 dark:border-white/10 text-slate-600 dark:text-slate-300 relative">
          {openMenu && <div className="fixed inset-0 z-40" onMouseDown={() => setOpenMenu(null)} />}

          {/* FILE */}
          <div className="relative z-50">
            <button onClick={() => setOpenMenu((m) => (m === 'file' ? null : 'file'))} onMouseEnter={() => openMenu && setOpenMenu('file')} className={menuBtnCls('file')}>File</button>
            {openMenu === 'file' && (
              <div className={menuPopCls}>
                {!note.isTrash ? (
                  <>
                    <button onClick={() => { onSaveNow?.(note.id); setOpenMenu(null); }} className={itemCls}><Check size={15} className="opacity-60" /> Save<span className={shortcutCls}>Ctrl S</span></button>
                    <div className={dividerCls} />
                    {/* Export as → flyout */}
                    <div className="relative" onMouseEnter={() => setFileSub('export')}>
                      <button onClick={() => setFileSub((s) => (s === 'export' ? null : 'export'))} className={`${itemCls} ${fileSub === 'export' ? 'bg-slate-100 dark:bg-neutral-900' : ''}`}><Download size={15} className="opacity-60" /> Export as<ChevronRight size={14} className="ml-auto opacity-50" /></button>
                      {fileSub === 'export' && (
                        <div className="vx-menu-pop absolute left-full top-0 -mt-1 ml-1 z-50 min-w-44 bg-white dark:bg-neutral-950 border border-slate-100 dark:border-neutral-800 shadow-xl rounded-lg py-1">
                          {([['pdf', 'PDF Document'], ['docx', 'Word (DOCX)'], ['odt', 'OpenDocument (ODT)'], ['txt', 'TXT File'], ['md', 'Markdown (MD)'], ['html', 'HTML File']] as const).map(([fmt, label]) => (
                            <button key={fmt} onClick={() => { handlePandocExport(fmt); setOpenMenu(null); }} className={itemCls}><Download size={15} className="opacity-60" /> {label}</button>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Send to → flyout */}
                    <div className="relative" onMouseEnter={() => setFileSub('send')}>
                      <button onClick={() => setFileSub((s) => (s === 'send' ? null : 'send'))} className={`${itemCls} ${fileSub === 'send' ? 'bg-slate-100 dark:bg-neutral-900' : ''}`}><Send size={15} className="opacity-60" /> Send to<ChevronRight size={14} className="ml-auto opacity-50" /></button>
                      {fileSub === 'send' && (
                        <div className="vx-menu-pop absolute left-full top-0 -mt-1 ml-1 z-50 min-w-44 max-h-72 overflow-auto bg-white dark:bg-neutral-950 border border-slate-100 dark:border-neutral-800 shadow-xl rounded-lg py-1">
                          {SHARE_TARGETS.map((target) => (
                            <button key={target.id} onClick={() => { handleSendTo(target); setOpenMenu(null); }} className={itemCls} title={`Send to ${target.label}`}>
                              <TargetIcon target={target} /><span className="truncate">{target.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className={dividerCls} />
                    <button onClick={() => { handleCopyToClipboard(); setOpenMenu(null); }} className={itemCls}><Copy size={15} className="opacity-60" /> Copy all text</button>
                    <button onClick={() => { setOpenMenu(null); handlePrint(); }} className={itemCls}><Printer size={15} className="opacity-60" /> Print<span className={shortcutCls}>Ctrl P</span></button>
                    <div className={dividerCls} />
                    <button onClick={() => { moveToTrash(note.id); setOpenMenu(null); }} className={itemCls}><Trash2 size={15} className="opacity-60" /> Move to Trash</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => { restoreFromTrash(note.id); setOpenMenu(null); }} className={itemCls}><RotateCcw size={15} className="opacity-60" /> Restore</button>
                    <button onClick={() => { deleteNotePerm(note.id); setOpenMenu(null); }} className={itemCls}><XCircle size={15} className="opacity-60" /> Delete Permanently</button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* EDIT */}
          <div className="relative z-50">
            <button onClick={() => setOpenMenu((m) => (m === 'edit' ? null : 'edit'))} onMouseEnter={() => openMenu && setOpenMenu('edit')} className={menuBtnCls('edit')}>Edit</button>
            {openMenu === 'edit' && (
              <div className={menuPopCls}>
                <button onClick={() => { setIsFindVisible(true); setOpenMenu(null); }} className={itemCls}><Search size={15} className="opacity-60" /> Find in note<span className={shortcutCls}>Ctrl F</span></button>
                <button onClick={() => { handleCopyToClipboard(); setOpenMenu(null); }} className={itemCls}><Copy size={15} className="opacity-60" /> Copy all text</button>
              </div>
            )}
          </div>

          {/* FORMAT */}
          {!note.isTrash && (
            <div className="relative z-50">
              <button onClick={() => setOpenMenu((m) => (m === 'format' ? null : 'format'))} onMouseEnter={() => openMenu && setOpenMenu('format')} className={menuBtnCls('format')}>Format</button>
              {openMenu === 'format' && (
                <div className={menuPopCls}>
                  {isCodeNote ? (
                    <button onClick={() => { setSyntaxViewer((v) => !v); setOpenMenu(null); }} className={itemCls}><CodeXml size={15} className="opacity-60" /> Syntax highlighting <span className="ml-auto text-[10px] text-slate-400">{syntaxViewer ? 'On' : 'Off'}</span></button>
                  ) : (
                    <>
                      {!mdSource && (
                        <>
                          {([['bold', 'Bold', 'Ctrl B'], ['italic', 'Italic', 'Ctrl I'], ['strikeThrough', 'Strikethrough', 'Ctrl Shift X'], ['checkbox', 'Insert checkbox', '']] as const).map(([cmd, label, sc]) => (
                            <button key={cmd} onMouseDown={(e) => e.preventDefault()} onClick={() => window.dispatchEvent(new CustomEvent('valx-format', { detail: cmd }))} className={itemCls}>{label}{sc && <span className={shortcutCls}>{sc}</span>}</button>
                          ))}
                          <div className={dividerCls} />
                          <div className={sectionCls}>Alignment</div>
                          {([[undefined, 'Left'], ['center', 'Center'], ['right', 'Right']] as const).map(([val, label]) => {
                            const active = (note.align ?? undefined) === val || (val === undefined && !note.align);
                            return (
                              <button key={label} onMouseDown={(e) => e.preventDefault()} onClick={() => updateNote(note.id, { align: val })} className={itemCls}><Check size={14} className={active ? 'text-[#32CD32]' : 'opacity-0'} /> {label}</button>
                            );
                          })}
                          <div className={dividerCls} />
                          <button onMouseDown={(e) => e.preventDefault()} onClick={() => { setTableMenu(true); setTHover({ r: 0, c: 0 }); setOpenMenu(null); }} className={itemCls}><Table size={15} className="opacity-60" /> Insert table…</button>
                        </>
                      )}
                      {isMdNote && (
                        <button onClick={() => { toggleMdSource(); setOpenMenu(null); }} className={itemCls}><CodeXml size={15} className="opacity-60" /> {mdSource ? 'Rich text view' : 'Markdown source'}</button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* VIEW */}
          <div className="relative z-50">
            <button onClick={() => setOpenMenu((m) => (m === 'view' ? null : 'view'))} onMouseEnter={() => openMenu && setOpenMenu('view')} className={menuBtnCls('view')}>View</button>
            {openMenu === 'view' && (
              <div className={menuPopCls}>
                <button onClick={() => { toggleFullscreen(); setOpenMenu(null); }} className={itemCls}>{isFullscreen ? <Minimize2 size={15} className="opacity-60" /> : <Maximize2 size={15} className="opacity-60" />} {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}<span className={shortcutCls}>F11</span></button>
                {canPreview && <button onClick={() => { setShowPreview((v) => !v); setOpenMenu(null); }} className={itemCls}><Eye size={15} className="opacity-60" /> {showPreview ? 'Hide preview' : 'Preview'}</button>}
                {!note.isTrash && <button onClick={() => { openHistory(); setOpenMenu(null); }} className={itemCls}><History size={15} className="opacity-60" /> Version history</button>}
                {onToggleSidebar && <button onClick={() => { onToggleSidebar(); setOpenMenu(null); }} className={itemCls}><ArrowLeft size={15} className="opacity-60" /> {sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}</button>}
              </div>
            )}
          </div>

          {/* CREATORS — the primary creator name + extra human authors (each
              becomes a "Mark as" label and a byline credit), plus the
              provenance-highlight toggles. */}
          <div className="relative z-50">
            <button onClick={() => setOpenMenu((m) => (m === 'creators' ? null : 'creators'))} onMouseEnter={() => openMenu && setOpenMenu('creators')} className={menuBtnCls('creators')}>Creators</button>
            {openMenu === 'creators' && (
              <div className={`${menuPopCls} min-w-64`}>
                <div className={sectionCls}>Creator</div>
                <div className="px-3 pb-2 pt-0.5">
                  <input
                    value={creatorMe}
                    onChange={(e) => setCreatorMeName(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Your name (replaces “Me”)"
                    className="w-full bg-slate-100 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-md px-2 py-1 text-sm text-slate-900 dark:text-white outline-none focus:border-[#32CD32] transition-colors"
                  />
                </div>
                <div className={dividerCls} />
                <div className={`${sectionCls} flex items-center justify-between`}>
                  <span>Human authors</span>
                  <button onClick={(e) => { e.stopPropagation(); addCreator(); }} title="Add author" className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-neutral-800 text-slate-400 hover:text-[#32CD32] transition-colors"><Plus size={14} /></button>
                </div>
                {creators.length === 0 ? (
                  <div className="px-3 pb-1.5 pt-0.5 text-[11px] text-slate-400 dark:text-slate-500 leading-snug">Add co-authors to credit them and mark their words.</div>
                ) : (
                  creators.map((c) => (
                    <div key={c.id} className="px-3 pb-1.5 pt-0.5 flex items-center gap-1.5">
                      <input
                        value={c.name}
                        onChange={(e) => updateCreatorName(c.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        placeholder="Author name"
                        className="flex-1 min-w-0 bg-slate-100 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-md px-2 py-1 text-sm text-slate-900 dark:text-white outline-none focus:border-[#32CD32] transition-colors"
                      />
                      <button onClick={(e) => { e.stopPropagation(); removeCreator(c.id); }} title="Remove author" className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-400 hover:text-red-500 transition-colors shrink-0"><X size={14} /></button>
                    </div>
                  ))
                )}
                <div className={dividerCls} />
                <div className={sectionCls}>Highlight by source</div>
                {([['human', 'Human authors'], ['ai', 'AI'], ['web', 'Reference'], ['paste', 'Pasted']] as const).map(([a, label]) => (
                  <button key={a} onClick={() => toggleAuthor(a)} className={itemCls}><Check size={14} className={!hiddenAuthors.has(a) ? 'text-[#32CD32]' : 'opacity-0'} /> {label}</button>
                ))}
                <div className={dividerCls} />
                <div className="px-3 py-1 text-[11px] text-slate-400 dark:text-slate-500 leading-snug max-w-64">Your own writing is never marked. Select text and use “Mark as” (right-click) to credit an author, AI, or a website.</div>
              </div>
            )}
          </div>

          <div data-tauri-drag-region className="flex-1 h-full" />

          {canPreview && (
            <button onClick={() => setShowPreview((v) => !v)} title={showPreview ? 'Hide preview' : 'Preview'} className={`px-2.5 flex items-center rounded transition-colors ${showPreview ? 'text-[#32CD32]' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}>
              {showPreview ? <EyeOff size={16} /> : <Play size={16} />}
            </button>
          )}
        </div>
      </div>

      {/* Find panel — opened from Edit menu / Ctrl+F, floats below the chrome. */}
      {isFindVisible && (
        <div className="vx-pop absolute top-[72px] right-4 z-[55] bg-white dark:bg-neutral-950 border border-slate-100 dark:border-neutral-800 shadow-xl rounded-lg p-2 flex items-center gap-1">
          <Search size={15} className="text-[#32CD32] shrink-0 ml-1" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); lastFound.current = ''; }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); findEnter(); }
              else if (e.key === 'ArrowDown') { e.preventDefault(); gotoMatch(findIdx + 1); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); gotoMatch(findIdx - 1); }
              else if (e.key === 'Escape') { e.preventDefault(); setIsFindVisible(false); }
            }}
            placeholder="Find in note…"
            spellCheck={false}
            className="border-none outline-none text-sm px-2 py-1 bg-transparent text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-neutral-700 w-52"
            autoFocus
          />
          <span className="text-[11px] font-medium tabular-nums text-slate-400 dark:text-slate-500 w-14 text-right shrink-0">
            {searchQuery.trim() ? (matchCount ? `${findIdx + 1}/${matchCount}` : 'none') : ''}
          </span>
          <div className="flex items-center border-l border-slate-100 dark:border-neutral-800 pl-1 ml-1">
            <button onClick={() => gotoMatch(findIdx - 1)} title="Previous (↑)" className="p-1 rounded hover:bg-slate-100 dark:hover:bg-neutral-900 text-slate-500 dark:text-slate-400 hover:text-[#32CD32]"><ChevronUp size={16} /></button>
            <button onClick={() => gotoMatch(findIdx + 1)} title="Next (↓)" className="p-1 rounded hover:bg-slate-100 dark:hover:bg-neutral-900 text-slate-500 dark:text-slate-400 hover:text-[#32CD32]"><ChevronDown size={16} /></button>
            <button onClick={() => setIsFindVisible(false)} title="Close (Esc)" className="p-1 rounded hover:bg-slate-100 dark:hover:bg-neutral-900 text-slate-500 dark:text-slate-400 hover:text-[#32CD32] ml-0.5"><X size={16} /></button>
          </div>
        </div>
      )}

      {/* Version history panel */}
      {historyOpen && (
        <>
          <div className="fixed inset-0 z-[54]" onMouseDown={() => setHistoryOpen(false)} />
          <div className="vx-menu-pop absolute top-[72px] right-4 z-[55] w-72 max-h-80 overflow-auto bg-white dark:bg-neutral-950 border border-slate-100 dark:border-neutral-800 shadow-xl rounded-lg py-1">
            <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Version history</div>
            {versions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500 leading-relaxed">No earlier versions yet — one is saved every {historyIntervalMin} min while you edit.</div>
            ) : (
              versions.map((v) => (
                <button key={v.t} onClick={() => revertTo(v)} className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-neutral-900 transition-colors flex flex-col gap-0.5" title="Restore this version (current is saved first)">
                  <span className="text-sm text-slate-700 dark:text-slate-200">{versionLabel(v.t)}</span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{versionPreview(v.content)}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}

      {/* Table size picker */}
      {tableMenu && (
        <>
          <div className="fixed inset-0 z-[54]" onMouseDown={() => setTableMenu(false)} />
          <div className="vx-menu-pop absolute top-[72px] left-1/2 -translate-x-1/2 z-[55] bg-white dark:bg-neutral-950 border border-slate-100 dark:border-neutral-800 shadow-xl rounded-lg p-3">
            <div className="grid" style={{ gridTemplateColumns: 'repeat(6, 18px)', gap: '4px' }}>
              {Array.from({ length: 6 * 8 }).map((_, i) => {
                const c = (i % 6) + 1;
                const r = Math.floor(i / 6) + 1;
                const active = r <= tHover.r && c <= tHover.c;
                return (
                  <button
                    key={i}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setTHover({ r, c })}
                    onClick={() => { window.dispatchEvent(new CustomEvent('valx-insert-table', { detail: { rows: r, cols: c } })); setTableMenu(false); }}
                    className={`w-[18px] h-[18px] rounded-sm border transition-colors ${active ? 'bg-[#32CD32] border-[#32CD32]' : 'border-slate-200 dark:border-neutral-700 hover:border-slate-300'}`}
                  />
                );
              })}
            </div>
            <div className="text-xs text-center mt-2 text-slate-500 dark:text-slate-400 font-medium">{tHover.r > 0 ? `${tHover.r} × ${tHover.c} table` : 'Pick a size'}</div>
          </div>
        </>
      )}

      {/* Saved! feedback (Ctrl+S) */}
      {savedFlash !== null && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center pointer-events-none">
          <div
            key={savedFlash}
            className="saved-pop flex items-center gap-2 bg-white/95 dark:bg-neutral-900/95 border border-[#32CD32]/40 text-[#32CD32] px-4 py-2 rounded-full shadow-[0_0_24px_rgba(50,205,50,0.35)] text-sm font-semibold"
          >
            <Check size={16} /> Saved!
          </div>
        </div>
      )}

      {/* Editor Area — code notes get a full-width source editor; prose notes
          keep the centered rich-text column. */}
      {isCodeNote ? (
        <div className={`flex-1 min-h-0 flex flex-col transition-[padding] ${chromeFadeCls} ease-[cubic-bezier(0.16,1,0.3,1)] ${isFullscreen ? 'pt-10' : 'pt-[76px]'} ${savedFlash !== null ? 'save-glow' : ''}`}>
          <div className="px-6 pt-4 pb-2 flex-shrink-0">
            <textarea
              rows={1}
              value={note.title}
              onChange={e => updateNote(note.id, { title: e.target.value.replace(/\n/g, '') })}
              onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
              placeholder="filename"
              disabled={note.isTrash}
              spellCheck={false}
              style={{ fieldSizing: 'content' } as any}
              className="w-full text-left text-xl font-semibold font-mono leading-tight resize-none overflow-hidden border-none outline-none placeholder-slate-400 dark:placeholder-neutral-800 bg-transparent disabled:opacity-50 text-slate-900 dark:text-white"
            />
          </div>
          <div className="flex-1 min-h-0 flex">
            {lineCounter && (
              <div className="vx-code-gutter" style={{ width: `${String(lineCount).length + 2}ch` }}>
                <div ref={gutterRef}>
                  <pre className="vx-code" style={{ textAlign: 'right' }}>
                    {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
                  </pre>
                </div>
              </div>
            )}
            <div className="relative flex-1 min-w-0">
              <div className="vx-code-hlwrap">
                {syntaxViewer && (
                  <pre ref={hlRef} aria-hidden className="vx-code vx-code-hl"
                    dangerouslySetInnerHTML={{ __html: codeHl + '\n' }} />
                )}
              </div>
              <textarea
                ref={codeRef}
                value={note.content}
                onChange={e => updateNote(note.id, { content: e.target.value })}
                onScroll={syncCodeScroll}
                placeholder="Write code here — press the eye button to preview"
                disabled={note.isTrash}
                spellCheck={false}
                wrap="off"
                className={`vx-code vx-code-input placeholder-slate-400 dark:placeholder-neutral-700 disabled:opacity-50 ${syntaxViewer ? 'text-transparent' : 'text-slate-900 dark:text-slate-100'}`}
                style={!syntaxViewer ? { color: 'inherit', caretColor: 'auto' } : undefined}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className={`vx-editor-scroll flex-1 min-w-0 overflow-y-auto px-8 sm:px-12 lg:px-24 py-12 print-area transition-[color,padding] ${chromeFadeCls} ease-[cubic-bezier(0.16,1,0.3,1)] ${isFullscreen ? 'pt-12' : 'pt-[80px]'} ${savedFlash !== null ? 'save-glow' : ''}`}>
          {/* iA-Writer breathing room: the title starts well down the page so a
              fresh note feels like paper rolled into a typewriter. It's plain
              top padding on the scroll content, so it only shows at the very
              start — scrolling into the body reclaims it. */}
          <div className={`mx-auto w-full max-w-3xl pt-[12vh] transition-all duration-300`}>
            {/* Textarea (not input) so a long file name wraps and the field grows
                to show it in full. field-sizing:content does the growing natively. */}
            <textarea
              rows={1}
              value={note.title}
              onChange={e => updateNote(note.id, { title: e.target.value.replace(/\n/g, '') })}
              onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
              placeholder="Title"
              disabled={note.isTrash}
              spellCheck
              style={{ fieldSizing: 'content' } as any}
              className={`w-full ${alignClass} text-4xl font-bold leading-tight resize-none overflow-hidden border-none outline-none ${showByline ? 'mb-2' : 'mb-6'} placeholder-slate-400 dark:placeholder-neutral-800 bg-transparent disabled:opacity-50 text-slate-900 dark:text-white`}
            />
            {showByline && bctx && (
              <div className={`vx-byline-view ${alignClass} mb-7 text-sm text-slate-400 dark:text-slate-500 flex flex-wrap items-center gap-x-1.5 gap-y-1 ${align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : ''}`}>
                {bctx.by && <span>By&nbsp;<span className="font-medium text-slate-500 dark:text-slate-300">{bctx.by}</span></span>}
                {bctx.authors.length > 0 && (<><span className="opacity-50">·</span><span>with {bctx.authors.join(', ')}</span></>)}
                {bctx.ai && (<><span className="opacity-50">·</span><span>AI-assisted</span></>)}
                {bctx.sources.length > 0 && (
                  <><span className="opacity-50">·</span><span>Source:&nbsp;{bctx.sources.map((s, i) => (
                    <span key={i} title={s.url || undefined}>{i > 0 ? ', ' : ''}{s.site}</span>
                  ))}</span></>
                )}
              </div>
            )}
            {isMdNote && mdSource ? (
              <div className="relative vx-mdsrc">
                <pre
                  aria-hidden
                  className="vx-code vx-code--wrap vx-mdsrc-hl"
                  dangerouslySetInnerHTML={{ __html: mdHl + '\n' }}
                />
                <textarea
                  value={mdText}
                  onChange={(e) => handleMdChange(e.target.value)}
                  disabled={note.isTrash}
                  spellCheck={false}
                  placeholder="Write markdown…"
                  className="vx-code vx-code-input vx-code--wrap placeholder-slate-400 dark:placeholder-neutral-700 disabled:opacity-50"
                />
              </div>
            ) : (
              <RichTextEditor
                className={alignClass}
                value={editorBody}
                onChange={content => updateNote(note.id, { content: bylineEligible ? syncByline(content) : content })}
                onTextFileDrop={setDroppedTextFiles}
                placeholder="Start writing... (Drag & drop text, images, audio, video here)"
                disabled={note.isTrash}
                jumpTo={findJump ?? jumpTo}
                onOpenNoteLink={onOpenNoteLink}
                listAttachments={listAttachments}
              />
            )}
          </div>
        </div>
      )}

      {/* In-app HTML/CSS/JS preview — sandboxed iframe over the editor, with a
          device-size toggle so the page can be checked at phone and desktop widths. */}
      {showPreview && canPreview && (
        <div className="absolute inset-0 z-40 flex flex-col bg-white dark:bg-black">
          <div className="h-11 flex items-center justify-between px-4 border-b border-slate-100 dark:border-neutral-900 flex-shrink-0 bg-slate-50/60 dark:bg-neutral-950">
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Preview</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPreviewDevice('desktop')}
                className={`p-1.5 rounded-md transition-colors ${previewDevice === 'desktop' ? 'bg-[#32CD32]/10 text-[#32CD32]' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                title="Desktop"
              >
                <Monitor size={17} />
              </button>
              <button
                onClick={() => setPreviewDevice('mobile')}
                className={`p-1.5 rounded-md transition-colors ${previewDevice === 'mobile' ? 'bg-[#32CD32]/10 text-[#32CD32]' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                title="Mobile"
              >
                <Smartphone size={17} />
              </button>
              <div className="w-px h-5 bg-slate-200 dark:bg-neutral-800 mx-1" />
              <button
                onClick={() => setShowPreview(false)}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                title="Close preview"
              >
                <X size={17} />
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto flex justify-center bg-slate-100 dark:bg-neutral-900 p-0 sm:p-4">
            {previewSrc !== null && (
              <iframe
                title="Preview"
                sandbox="allow-scripts allow-popups allow-forms allow-modals"
                srcDoc={previewSrc}
                className="bg-white shadow-sm h-full border-0"
                style={previewDevice === 'mobile' ? { width: 390, maxWidth: '100%' } : { width: '100%' }}
              />
            )}
          </div>
        </div>
      )}

      {/* Word-count widget — corner pill, current / goal (goal optional). Fades
          while typing; peeks back on pointer move / when the goal is reached. */}
      {wcOn && !showPreview && (
        <div className={`absolute bottom-3 right-4 z-30 px-2.5 py-1 rounded-md bg-slate-100/85 dark:bg-neutral-900/85 backdrop-blur-sm text-[11px] font-medium tabular-nums select-none pointer-events-none shadow-sm transition-opacity duration-500 ${(!wcTyping || wcHover || goalCheer) ? 'opacity-100' : 'opacity-0'} ${goalReached ? 'text-[#32CD32]' : 'text-slate-500 dark:text-slate-400'}`}>
          {wcCount.toLocaleString()}{wcGoal > 0 ? ` / ${wcGoal.toLocaleString()}` : ''} Words
        </div>
      )}
      {/* Goal reached: a brief, quiet cheer at the bottom. */}
      {wcOn && goalCheer && !showPreview && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-full bg-[#32CD32]/15 text-[#1f9e1f] dark:text-[#32CD32] text-xs font-semibold shadow-sm select-none pointer-events-none animate-in fade-in slide-in-from-bottom-2">
          You've written enough.
        </div>
      )}

      {/* Drop Modal */}
      {droppedTextFiles && droppedTextFiles.length > 0 && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="vx-pop bg-white dark:bg-black p-6 rounded-xl shadow-xl max-w-sm w-full border border-slate-100 dark:border-neutral-900">
             <h3 className="text-lg font-bold mb-2 text-slate-900 dark:text-white">
               {droppedTextFiles.length === 1 ? 'Text File Dropped' : `${droppedTextFiles.length} Text Files Dropped`}
             </h3>
             <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
               {droppedTextFiles.length === 1
                 ? <>How would you like to open "<span className="font-semibold text-slate-700 dark:text-slate-300">{droppedTextFiles[0].name}</span>"?</>
                 : <>How would you like to merge "<span className="font-semibold text-slate-700 dark:text-slate-300">{droppedTextFiles.map((f) => f.name).join('", "')}</span>"?</>}
             </p>
             <div className="flex flex-col gap-2">
                <button className="bg-slate-100 dark:bg-neutral-900 hover:bg-slate-200 dark:hover:bg-neutral-800 text-slate-800 dark:text-slate-200 px-4 py-2.5 rounded-lg font-medium transition-colors" onClick={handleMergeTextFile}>Merge with current note</button>
                <button className="bg-[#32CD32] hover:bg-[#2eb82e] text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-sm" onClick={handleOpenNewWindow}>{droppedTextFiles.length === 1 ? 'Open in new window' : 'Merge into new note'}</button>
                <button className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-4 py-2 mt-2 font-medium" onClick={() => setDroppedTextFiles(null)}>Cancel</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
