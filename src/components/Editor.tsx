import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Note, JumpTarget, Folder } from '../types';
import { plainText } from '../lib/search';
import { compareTitles } from '../lib/noteSort';
import { RotateCcw, XCircle, Maximize2, Minimize2, Download, Printer, Search, X, Check, ChevronDown, ChevronUp, Eye, EyeOff, Copy, Send, Table, Smartphone, Monitor, History, ArrowLeft, ArrowRight, Minus, Square, Play, ChevronRight, ChevronLeft, Share, Type, ImagePlus, Plus, Undo2, Redo2, Scissors, ClipboardPaste, ClipboardType, TextSelect, FileUp, FolderOpen, FolderInput, SlidersHorizontal, BookA, SpellCheck, Languages, Ban } from 'lucide-react';
import { BinIcon } from './BinIcon';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '../lib/desktop';
import { accel, isMac, isAndroid, isTouchUI } from '../lib/platform';
import { useMacTitleBar, MENU_BAR_REVEAL } from '../hooks/useMacTitleBar';
import { RichTextEditor } from './RichTextEditor';
import { contentFromDisk, formatKind, htmlToMarkdown, markdownToHtml, wordCount } from '../lib/format';
import { stripTags } from '../lib/htmlText';
import { codeLangFromExt, highlightCode, buildPreviewDoc, PREVIEWABLE } from '../lib/codeHighlight';
import { mediaDisplayHtml, previewMediaBase, readClipboardText } from '../lib/desktop';
import {
  LS_LINE_COUNTER, LINE_COUNTER_EVENT, LS_WORDCOUNT, WORDCOUNT_EVENT,
  LS_AUTOCAP, AUTOCAP_EVENT, LS_TRANSPARENCY, LS_TYPEWRITER, TYPEWRITER_EVENT,
  LS_SPELLCHECK_ON, SPELLCHECK_EVENT,
  HISTORY_INTERVAL_EVENT, historyInterval, wordGoal, prefOn, setPref,
  emitWordCount, applyTransparency,
} from '../lib/prefs';
import { LANGUAGES, spellLang, setSpellLang } from '../lib/spellcheck';
import { Creator, CREATORS_EVENT, creatorMeName, setCreatorMeName, loadCreators, saveCreators, newCreatorId } from '../lib/creators';
import { deriveByline, stripByline, syncByline, bylineIsEmpty } from '../lib/byline';
import { Snapshot, loadHistory, snapshotNote } from '../lib/history';
import html2pdf from 'html2pdf.js';
import { asBlob } from 'html-docx-js-typescript';
import { saveAs } from 'file-saver';
import { SHARE_TARGETS, ShareTarget, openShareUrl, plainTextOfNote, htmlToPlain } from '../lib/share';
import { printHtml, shareText, inlineImages } from '../lib/android';
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
  /** Touch only — back to the note list. The phone has no room for two panes,
   *  so the editor owns the chevron the desktop doesn't need. */
  onBack?: () => void;
  /** File > Open Folder… — swaps the workspace the notes are read from. */
  onOpenFolder?: () => void;
  /** File > Preferences… */
  onOpenPreferences?: () => void;
  /** Folders the open note can be filed into — File > Move to. Dragging a row
   *  onto a folder in the sidebar does the same thing; this is the path that
   *  does not need a drag, which is the only kind a thumb reliably has. */
  folders?: Folder[];
  onMoveNoteToFolder?: (id: string, folderId: string | null) => void;
  className?: string;
}

export function Editor({ note, updateNote, moveToTrash, restoreFromTrash, deleteNotePerm, isFullscreen, toggleFullscreen, onAddNoteWithContent, onMergeNotes, onSaveNow, jumpTo, onOpenNoteLink, noteExt = '', listAttachments, sidebarOpen, onToggleSidebar, onBack, onOpenFolder, onOpenPreferences, folders = [], onMoveNoteToFolder, className = '' }: EditorProps) {
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
  const [lineCounter, setLineCounter] = useState(() => prefOn(LS_LINE_COUNTER));
  useEffect(() => {
    const onChange = (e: any) => setLineCounter(!!e.detail);
    window.addEventListener(LINE_COUNTER_EVENT, onChange);
    return () => window.removeEventListener(LINE_COUNTER_EVENT, onChange);
  }, []);

  // Menu-bar toggles. Each is mirrored in React state (so the menu shows a
  // checkmark) and in localStorage (so the modules that actually read it —
  // RichTextEditor's auto-capitalize, the typewriter synth, the spellchecker —
  // pick it up without being wired through props). setToggle keeps the three
  // steps in one place instead of five near-identical handlers.
  const [autoCap, setAutoCap] = useState(() => prefOn(LS_AUTOCAP));
  const [transparency, setTransparency] = useState(() => prefOn(LS_TRANSPARENCY));
  const [typewriter, setTypewriter] = useState(() => prefOn(LS_TYPEWRITER));
  const [spellOn, setSpellOn] = useState(() => prefOn(LS_SPELLCHECK_ON));
  // Spellcheck language. Not a setToggle case — it's a pick-one, and
  // setSpellLang already persists it and tells open editors to re-check.
  const [lang, setLang] = useState(() => spellLang());
  const setToggle = (
    key: string,
    event: string,
    next: boolean,
    apply: (v: boolean) => void,
    extra?: (v: boolean) => void
  ) => {
    apply(next);
    setPref(key, next, event);
    extra?.(next);
  };

  // Word-count widget (corner pill) + optional goal — live-updated from Preferences.
  const [wcOn, setWcOn] = useState(() => prefOn(LS_WORDCOUNT));
  const [wcGoal, setWcGoal] = useState(() => wordGoal());
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
  const [historyIntervalMin, setHistoryIntervalMin] = useState(() => historyInterval());
  const noteRef = useRef(note);
  noteRef.current = note;
  useEffect(() => {
    const onChange = (e: any) => setHistoryIntervalMin(e.detail);
    window.addEventListener(HISTORY_INTERVAL_EVENT, onChange);
    return () => window.removeEventListener(HISTORY_INTERVAL_EVENT, onChange);
  }, []);
  useEffect(() => {
    if (!note || note.isTrash) return;
    const snap = () => {
      const cur = noteRef.current;
      if (cur && !cur.isTrash) void snapshotNote(cur.id, cur.content);
    };
    // Baseline the moment a note opens. Without it the timer was the ONLY
    // writer, so nothing was ever recorded unless one note stayed open for a
    // full uninterrupted interval — the panel was empty in every real session.
    // Notes persist, so opening also captures whatever the last session left.
    snap();
    const id = setInterval(snap, Math.max(1, historyIntervalMin) * 60_000);
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
    await snapshotNote(cur.id, cur.content);
    updateNote(cur.id, { content: snap.content });
    setHistoryOpen(false);
  };
  const versionLabel = (t: number) =>
    new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const versionPreview = (c: string) =>
    stripTags(c, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 48) || '(empty)';

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
  // File-menu flyout (Export as / Send to / Move to), and the author's own
  // display name.
  const [fileSub, setFileSub] = useState<'export' | 'send' | 'move' | null>(null);
  useEffect(() => { if (openMenu !== 'file') setFileSub(null); }, [openMenu]);
  // Words-menu flyout (Spelling / Language), same contract as fileSub.
  const [wordsSub, setWordsSub] = useState<'spelling' | 'language' | null>(null);
  useEffect(() => { if (openMenu !== 'words') setWordsSub(null); }, [openMenu]);
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

  // The menu panel's open/closed state. The swipe that drives it lives in App
  // (one recogniser for the whole app, so the three panels can't disagree
  // about which gesture belongs to whom) and says so by event rather than by
  // prop, which keeps the state owned by the component that draws the panel.
  //
  // Declared up here, above the `if (!note)` early return below, because a
  // hook after an early return is only called on some renders — React counts
  // them and refuses (error #310) the moment a note is opened.
  useEffect(() => {
    const onSet = (e: Event) => setOpenMenu((e as CustomEvent).detail ? 'sheet' : null);
    window.addEventListener('valx-menu-panel', onSet);
    return () => window.removeEventListener('valx-menu-panel', onSet);
  }, []);

  // Touch has no mouseleave, so the revealed bar would never go away again on
  // a phone — focus mode would be a one-way trip out. It retreats on a timer
  // instead, held open for as long as a menu is down so a slow tap through
  // File > Export doesn't have the bar vanish mid-decision.
  const CHROME_LINGER_MS = 3500;
  useEffect(() => {
    if (!isTouchUI || !isFullscreen || !topHover || anyChromeMenuOpen) return;
    const t = setTimeout(() => setTopHover(false), CHROME_LINGER_MS);
    return () => clearTimeout(t);
  }, [isFullscreen, topHover, anyChromeMenuOpen]);

  // The editor only owes the traffic lights room when it IS the window's left
  // edge — sidebar collapsed, or distraction-free mode where the sidebar is
  // gone entirely. With the sidebar showing, the buttons sit over *it* and the
  // sidebar clears them with a title-bar band instead.
  const { inset: trafficLightInset, nativeFullscreen } = useMacTitleBar(!sidebarOpen || isFullscreen);
  // Room for the auto-hidden system menu bar while it is on screen. Applied
  // only when the chrome is revealed in native fullscreen; zero otherwise, so
  // windowed mode and every non-Mac platform are untouched.
  const macChromeTop = nativeFullscreen && chromeShown ? MENU_BAR_REVEAL : 0;

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

  // Folders offered by File > Move to, in the same numeric-aware order the
  // sidebar's folder rail uses — the two lists name the same folders, so a user
  // reading one and then the other must not have to re-find them.
  //
  // Up here with the other hooks rather than next to the menu it feeds: the menu
  // bodies are built after the `if (!note)` return below, and a useMemo there
  // would run on only some renders.
  const moveTargets = useMemo(
    () => [...folders].sort((a, b) => compareTitles(a.name, b.name)),
    [folders]
  );

  // Shared class strings for the menus.
  //
  // Touch takes the same rows through a different skin. The five dropdowns of
  // a Windows menu bar are the wrong shape for a phone — small targets, hover
  // to open, flyouts that fly off the side of a 360px screen — so on touch
  // every menu is rendered instead into one iOS-style sheet that rises from the
  // bottom: rows at thumb height, indented hairline separators, flyouts that
  // expand in place. Only these strings and the container change; the items
  // themselves are the same JSX on both, which is what keeps the two from
  // drifting apart.
  const menuBtnCls = (id: string) => `px-2.5 flex items-center text-[13px] rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors ${openMenu === id ? 'bg-black/5 dark:bg-white/10 text-slate-900 dark:text-white' : ''}`;
  const menuPopCls = 'vx-menu-pop vx-glass-strong vx-hairline absolute top-8 left-0 z-50 min-w-52 shadow-xl rounded-xl py-1';
  const itemCls = isTouchUI
    ? 'w-full text-left px-4 py-3 text-[15px] active:bg-black/[0.06] dark:active:bg-white/10 flex items-center gap-3.5 text-slate-800 dark:text-slate-100 transition-colors'
    : 'w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-neutral-900 flex items-center gap-2 text-slate-700 dark:text-slate-200 transition-colors';
  // iOS insets a separator past the row's icon rather than running it edge to
  // edge, which is what makes a grouped list read as one card instead of a
  // stack of slabs.
  const dividerCls = isTouchUI
    ? 'ml-[3.4rem] border-t border-black/[0.07] dark:border-white/[0.09]'
    : 'my-1 border-t border-slate-100 dark:border-neutral-800';
  // A flyout hanging off a menu row (Export as, Send to, Spelling, Language).
  // In the sheet it becomes an indented block that pushes the rows below it
  // down — there is no room beside a full-width row to fly out into.
  const subPopCls = isTouchUI
    ? 'pl-4 ml-6 border-l-2 border-[#32CD32]/30 bg-black/[0.02] dark:bg-white/[0.03]'
    : 'vx-menu-pop vx-glass-strong vx-hairline absolute left-full top-0 -mt-1 ml-1 z-50 min-w-44 max-h-72 overflow-auto shadow-xl rounded-xl py-1';
  // No keyboard on a phone, so the accelerator column is dead weight there.
  const shortcutCls = isTouchUI ? 'hidden' : 'ml-auto text-[10px] text-slate-400 dark:text-slate-500 tabular-nums pl-4';

  /**
   * Hover-to-open for a flyout row — on a pointer only.
   *
   * A row that both opens on hover and toggles on click cancels itself out on a
   * touchscreen: for a tap, Chrome dispatches mouseenter *before* click, so the
   * hover opened the flyout and the tap's own toggle closed it again. Every
   * flyout in the mobile sheet — Export as, Send to, Spelling, Language — was
   * unreachable that way, verified on an Android emulator. Handing back
   * undefined leaves the click in sole charge of the flyout on touch.
   */
  const hoverOpen = (fn: () => void) => (isTouchUI ? undefined : fn);

  // ---------------------------------------------------------------------------
  // Menu fragments shared by the two menu bars — the full one over an open note,
  // and the reduced one shown with no note open. Defined here, above the
  // null-note early return, so both branches render the SAME markup instead of
  // two copies that drift apart.
  // ---------------------------------------------------------------------------

  // Format > Text spacing… A global writing-surface setting, not per-note
  // formatting, so it is offered with or without a note open. It used to be two
  // bare sliders inside this dropdown; they are a dialog now (SpacingModal),
  // because "2.4px" tells you nothing about a typographic measure and the note
  // that would have shown you was behind the open menu. The dialog carries a
  // sample paragraph that re-flows as the handle moves.
  const spacingItem = (
    <button
      onClick={() => { setOpenMenu(null); window.dispatchEvent(new CustomEvent('valx-open-spacing')); }}
      className={itemCls}
    >
      <Type size={15} className="opacity-60" /> Text spacing…
    </button>
  );

  // Words menu — spelling, language, dictionary. Every item is a global
  // preference, so this popup is identical in both menu bars.
  // The Words rows on their own, so the mobile sheet can carry the same
  // three groups without the dropdown chrome around them.
  const wordsMenuItems = (
    <>
      <div className="relative" onMouseEnter={hoverOpen(() => setWordsSub('spelling'))}>
        <button onClick={() => setWordsSub((s) => (s === 'spelling' ? null : 'spelling'))} className={`${itemCls} ${wordsSub === 'spelling' ? 'bg-slate-100 dark:bg-neutral-900' : ''}`}><SpellCheck size={15} className="opacity-60" /> Spelling<ChevronRight size={14} className="ml-auto opacity-50" /></button>
        {wordsSub === 'spelling' && (
          <div className={subPopCls}>
            <button onClick={() => setToggle(LS_SPELLCHECK_ON, SPELLCHECK_EVENT, !spellOn, setSpellOn)} className={itemCls}>
              <Check size={14} className={spellOn ? 'text-[#32CD32]' : 'opacity-0'} /> Check spelling while typing
            </button>
            <button onClick={() => setToggle(LS_AUTOCAP, AUTOCAP_EVENT, !autoCap, setAutoCap)} className={itemCls}>
              <Check size={14} className={autoCap ? 'text-[#32CD32]' : 'opacity-0'} /> Auto-capitalize
            </button>
          </div>
        )}
      </div>
      <div className="relative" onMouseEnter={hoverOpen(() => setWordsSub('language'))}>
        <button onClick={() => setWordsSub((s) => (s === 'language' ? null : 'language'))} className={`${itemCls} ${wordsSub === 'language' ? 'bg-slate-100 dark:bg-neutral-900' : ''}`}><Languages size={15} className="opacity-60" /> Language<ChevronRight size={14} className="ml-auto opacity-50" /></button>
        {wordsSub === 'language' && (
          <div className={subPopCls}>
            {Object.entries(LANGUAGES).map(([key, label]) => (
              <button key={key} onClick={() => { setSpellLang(key); setLang(key); }} className={itemCls}>
                <Check size={14} className={lang === key ? 'text-[#32CD32]' : 'opacity-0'} /> {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Dictionary and Forbidden Words are dialogs, not lists — they open
          straight from their row rather than pretending to be flyouts. */}
      <div onMouseEnter={hoverOpen(() => setWordsSub(null))}>
        <button onClick={() => { setOpenMenu(null); window.dispatchEvent(new CustomEvent('valx-open-dictionary')); }} className={itemCls}>
          <BookA size={15} className="opacity-60" /> Dictionary…
        </button>
        <button onClick={() => { setOpenMenu(null); window.dispatchEvent(new CustomEvent('valx-open-forbidden')); }} className={itemCls}>
          <Ban size={15} className="opacity-60" /> Forbidden Words…
        </button>
      </div>
    </>
  );
  const wordsMenuPop = (
    <div className={menuPopCls} onMouseDown={(e) => e.preventDefault()}>
      {wordsMenuItems}
    </div>
  );

  // View items that don't need a note: the window itself, then the global
  // counters and appearance toggles.
  const viewWindowItems = (
    <>
      <button onClick={() => { toggleFullscreen(); setOpenMenu(null); }} className={itemCls}>{isFullscreen ? <Minimize2 size={15} className="opacity-60" /> : <Maximize2 size={15} className="opacity-60" />} {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}<span className={shortcutCls}>{isMac ? '⌘↩' : 'F11'}</span></button>
      {/* No sidebar toggle here — the chrome's own arrow button already owns it. */}
    </>
  );
  const viewToggleItems = (
    <>
      <button onClick={() => setToggle(LS_WORDCOUNT, '', !wcOn, setWcOn, emitWordCount)} className={itemCls}>
        <Check size={14} className={wcOn ? 'text-[#32CD32]' : 'opacity-0'} /> Word count
      </button>
      <button onClick={() => setToggle(LS_LINE_COUNTER, LINE_COUNTER_EVENT, !lineCounter, setLineCounter)} className={itemCls}>
        <Check size={14} className={lineCounter ? 'text-[#32CD32]' : 'opacity-0'} /> Line numbers
      </button>
      {/* Desktop only. Transparency is a property of a window a phone doesn't
          have, and the typewriter synth answers a physical keyboard — neither
          has anything to toggle on Android. */}
      {!isAndroid && (
        <>
          <div className={dividerCls} />
          <button onClick={() => setToggle(LS_TRANSPARENCY, '', !transparency, setTransparency, applyTransparency)} className={itemCls}>
            <Check size={14} className={transparency ? 'text-[#32CD32]' : 'opacity-0'} /> Transparency
          </button>
          <button onClick={() => setToggle(LS_TYPEWRITER, TYPEWRITER_EVENT, !typewriter, setTypewriter)} className={itemCls}>
            <Check size={14} className={typewriter ? 'text-[#32CD32]' : 'opacity-0'} /> Typewriter sounds
          </button>
        </>
      )}
    </>
  );

  // Window controls (Tauri). No-ops in the browser preview (isTauri false).
  // Drawn on Windows/Linux only: macOS keeps its native decorations and gets
  // real traffic lights overlaid on this same bar (titleBarStyle "Overlay" in
  // tauri.macos.conf.json), so a second set of app-drawn buttons on the right
  // would be both redundant and wrong-side.
  const winMinimize = () => { if (isTauri) getCurrentWindow().minimize(); };
  const winMaximize = () => { if (isTauri) getCurrentWindow().toggleMaximize(); };
  const winClose = () => { if (isTauri) getCurrentWindow().close(); };
  // Windows/Linux draw their own caption buttons because the window is
  // decorations:false. Android has no window to minimize, maximize or close —
  // the OS owns all three — so the phone build must not draw them.
  const showCaptionButtons = isTauri && !isMac && !isAndroid;


  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // File > Open File… — pick a text file and land it in a new note. Desktop
  // uses the native dialog through the bridge; the browser falls back to a
  // throwaway <input type=file>, which is the only picker it has.
  const handleOpenFile = async () => {
    const toNote = (name: string, raw: string) =>
      onAddNoteWithContent(name.replace(/\.[^/.]+$/, ''), contentFromDisk(name, raw));
    const api = (window as any).electronAPI;
    if (api?.openTextFile) {
      const picked = await api.openTextFile();
      if (picked) toNote(picked.name, picked.content);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt,.text,.html,.htm,.css,.js,.ts,.tsx,.jsx,.py';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (f) toNote(f.name, await f.text());
    };
    input.click();
  };

  // The global keydown listener registers once, so it must not capture this
  // render's copies: handleOpenFile reaches onAddNoteWithContent, which closes
  // over the active folder filter, and a stale one would drop opened files into
  // whichever folder was selected when the listener was installed. Same
  // ref-mirroring rule the note/creator handlers in this file already follow.
  const openFileRef = useRef<() => void>(() => {});
  const openFolderRef = useRef<(() => void) | undefined>(undefined);
  const pastePlainRef = useRef<() => void>(() => {});

  // Edit menu: the standard clipboard/history commands. document.execCommand is
  // deprecated on paper but is still the only API that drives contentEditable's
  // native undo stack — a hand-rolled history would fight it rather than
  // replace it. onMouseDown={preventDefault} on the menu rows keeps the
  // selection alive, so these act on what was selected before the menu opened.
  const editCmd = (cmd: string) => () => { document.execCommand(cmd); setOpenMenu(null); };
  // Paste is NOT execCommand('paste'): Chromium (and so WebView2) refuses that
  // outside a real paste gesture, which would leave a menu item that does
  // nothing at all. Read the clipboard and insert the text instead. The rich
  // editor's own context menu routes paste through its slop-marking path; here
  // in the menu bar — which also serves the code and markdown surfaces — plain
  // insertion is the behaviour that is correct everywhere.
  const pasteFromClipboard = async () => {
    setOpenMenu(null);
    try {
      const text = await readClipboardText();
      if (text) document.execCommand('insertText', false, text);
    } catch {
      showToast('Clipboard unavailable');
    }
  };
  const pastePlain = pasteFromClipboard;
  openFileRef.current = handleOpenFile;
  openFolderRef.current = onOpenFolder;
  pastePlainRef.current = pastePlain;

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
      // Toggle fullscreen with F11 or Ctrl/Cmd+Enter. F11 keeps working on a
      // Mac keyboard that has it, but ⌘↩ is the binding the menu advertises
      // there — macOS gives F11 to Show Desktop by default.
      if (e.key === 'F11' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
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

      // File menu accelerators. Ctrl+Shift+O is Open Folder, plain Ctrl+O is
      // Open File — checked in that order so the Shift variant isn't swallowed.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        if (e.shiftKey) openFolderRef.current?.();
        else openFileRef.current();
      }

      // Ctrl+Shift+V pastes without carrying the source's formatting.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pastePlainRef.current();
      }

      // Ctrl/Cmd+P for Print
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
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
        {/* Chrome strip so the window stays draggable/closable with no note
            open — and a menu bar, so the settings that aren't about a note
            (open a file, spacing, spelling, the window itself) stay reachable
            before anything is selected. Menus that need a note to act on —
            Edit and Creators, plus File's save/export/print/trash rows — are
            simply absent rather than present-but-dead. */}
        <div className="hidden md:flex absolute top-0 inset-x-0 h-10 items-center px-1.5 gap-0.5 z-40 vx-glass-strong border-b border-black/[0.06] dark:border-white/[0.08]" style={{ paddingLeft: trafficLightInset || undefined }}>
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="p-2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors rounded-md hover:bg-slate-50 dark:hover:bg-neutral-900"
              title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            >
              {sidebarOpen ? <ArrowLeft size={18} /> : <ArrowRight size={18} />}
            </button>
          )}

          {/* FILE — only the rows that don't need a note. */}
          <div className="relative z-50 h-full flex items-center">
            <button onClick={() => setOpenMenu((m) => (m === 'file' ? null : 'file'))} onMouseEnter={() => openMenu && setOpenMenu('file')} className={`${menuBtnCls('file')} h-7`}>File</button>
            {openMenu === 'file' && (
              <div className={menuPopCls}>
                                <button onClick={() => { setOpenMenu(null); handleOpenFile(); }} className={itemCls}><FileUp size={15} className="opacity-60" /> Open File…<span className={shortcutCls}>{accel('Ctrl O')}</span></button>
                {onOpenFolder && <button onClick={() => { setOpenMenu(null); onOpenFolder(); }} className={itemCls}><FolderOpen size={15} className="opacity-60" /> Open Folder…<span className={shortcutCls}>{accel('Ctrl Shift O')}</span></button>}
                {onOpenPreferences && (
                  <>
                    <div className={dividerCls} />
                    <button onClick={() => { setOpenMenu(null); onOpenPreferences(); }} className={itemCls}><SlidersHorizontal size={15} className="opacity-60" /> Preferences…<span className={shortcutCls}>{accel('Ctrl ,')}</span></button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* FORMAT — just the spacing sliders; the rest needs a selection. */}
          <div className="relative z-50 h-full flex items-center">
            <button onClick={() => setOpenMenu((m) => (m === 'format' ? null : 'format'))} onMouseEnter={() => openMenu && setOpenMenu('format')} className={`${menuBtnCls('format')} h-7`}>Format</button>
            {openMenu === 'format' && <div className={menuPopCls}>{spacingItem}</div>}
          </div>

          <div className="relative z-50 h-full flex items-center">
            <button onClick={() => setOpenMenu((m) => (m === 'words' ? null : 'words'))} onMouseEnter={() => openMenu && setOpenMenu('words')} className={`${menuBtnCls('words')} h-7`}>Words</button>
            {openMenu === 'words' && wordsMenuPop}
          </div>

          <div className="relative z-50 h-full flex items-center">
            <button onClick={() => setOpenMenu((m) => (m === 'view' ? null : 'view'))} onMouseEnter={() => openMenu && setOpenMenu('view')} className={`${menuBtnCls('view')} h-7`}>View</button>
            {openMenu === 'view' && (
              <div className={menuPopCls}>
                                {viewWindowItems}
                <div className={dividerCls} />
                {viewToggleItems}
              </div>
            )}
          </div>

          <div data-tauri-drag-region className="flex-1 h-full" />
          {showCaptionButtons && (
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

  const handlePrint = async () => {
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
    // Android's print WebView can't resolve the app's asset URLs, so the
    // pictures have to travel with the document. No-op elsewhere.
    if (isAndroid) await inlineImages(printDiv);
    const printableContent = printDiv.innerHTML;

    const printDoc = `
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
    `;

    // Android's WebView implements no window.print() — it returns silently,
    // which is exactly what "Print doesn't work" looked like. The platform
    // prints through PrintManager, which the Kotlin bridge drives.
    if (printHtml(printDoc, note.title || 'Valx note')) return;

    // Everywhere else: an offscreen iframe, so the printed page carries the
    // note and none of the app chrome or browser headers.
    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.width = '0px';
    iframe.style.height = '0px';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) return;

    doc.open();
    doc.write(printDoc);
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
        // Android chose the destination itself (no save dialog exists there),
        // so it has to say where the file landed.
        showToast(
          isAndroid && result.path
            ? `Saved to ${String(result.path).split('/').slice(-2).join('/')}`
            : `Exported successfully to ${format.toUpperCase()}`
        );
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
    md = stripTags(md).replace(/&nbsp;/g, ' ');
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

  // Android: hand the note to the OS share sheet. No clipboard dance and no
  // URL length budget — the receiving app gets the whole note as an extra.
  const handleNativeShare = () => {
    setIsShareOpen(false);
    if (!shareText(plainTextOfNote(note), note.title || 'Untitled')) {
      showToast('Sharing is not available here');
    }
  };

  const handleDownload = (format: 'txt' | 'html') => {
    const plainText = note.title + '\n\n' + stripTags(note.content.replace(/<br\s*\/?>/gi, '\n').replace(/&nbsp;/g, ' '));
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


  // --- menu bodies -----------------------------------------------------------
  // Defined once and rendered twice: into the desktop dropdowns below, and into
  // the mobile sheet. Extracted rather than duplicated because these ARE the
  // app's commands — two hand-kept copies would drift within a release, and the
  // phone would quietly be the one missing a command.
  const fileMenuItems = (
    <>
      {!note.isTrash ? (
        <>
          <button onClick={() => { setOpenMenu(null); handleOpenFile(); }} className={itemCls}><FileUp size={15} className="opacity-60" /> Open File…<span className={shortcutCls}>{accel('Ctrl O')}</span></button>
          {/* Import media. Everything imported lands in the workspace's
              .attachments folder and is inserted at the caret — an image,
              audio or video element for the kinds a page can play, a paperclip
              chip for the rest (PDFs). The picker itself lives in
              RichTextEditor, next to the function that does the copying. */}
          {!note.isTrash && (
            <button onClick={() => { setOpenMenu(null); window.dispatchEvent(new CustomEvent('valx-import-media')); }} className={itemCls}>
              <ImagePlus size={15} className="opacity-60" /> Import media…
            </button>
          )}
          {onOpenFolder && <button onClick={() => { setOpenMenu(null); onOpenFolder(); }} className={itemCls}><FolderOpen size={15} className="opacity-60" /> Open Folder…<span className={shortcutCls}>{accel('Ctrl Shift O')}</span></button>}
          <div className={dividerCls} />
          <button onClick={() => { onSaveNow?.(note.id); setOpenMenu(null); }} className={itemCls}><Check size={15} className="opacity-60" /> Save<span className={shortcutCls}>{accel('Ctrl S')}</span></button>
          <div className={dividerCls} />
          {/* Export as → flyout */}
          <div className="relative" onMouseEnter={hoverOpen(() => setFileSub('export'))}>
            <button onClick={() => setFileSub((s) => (s === 'export' ? null : 'export'))} className={`${itemCls} ${fileSub === 'export' ? 'bg-slate-100 dark:bg-neutral-900' : ''}`}><Download size={15} className="opacity-60" /> Export as<ChevronRight size={14} className="ml-auto opacity-50" /></button>
            {fileSub === 'export' && (
              <div className={subPopCls}>
                {([['pdf', 'PDF Document'], ['docx', 'Word (DOCX)'], ['odt', 'OpenDocument (ODT)'], ['txt', 'TXT File'], ['md', 'Markdown (MD)'], ['html', 'HTML File']] as const).map(([fmt, label]) => (
                  <button key={fmt} onClick={() => { handlePandocExport(fmt); setOpenMenu(null); }} className={itemCls}><Download size={15} className="opacity-60" /> {label}</button>
                ))}
              </div>
            )}
          </div>
          {/* Send to. On Android the hand-written target list is
              replaced by the system share sheet — the phone already
              knows which apps take a note, its list is the user's
              own, and it needs no clipboard-and-paste workarounds. */}
          {isAndroid ? (
            <button onClick={() => { handleNativeShare(); setOpenMenu(null); }} className={itemCls}><Send size={15} className="opacity-60" /> Share…</button>
          ) : (
          <div className="relative" onMouseEnter={hoverOpen(() => setFileSub('send'))}>
            <button onClick={() => setFileSub((s) => (s === 'send' ? null : 'send'))} className={`${itemCls} ${fileSub === 'send' ? 'bg-slate-100 dark:bg-neutral-900' : ''}`}><Send size={15} className="opacity-60" /> Send to<ChevronRight size={14} className="ml-auto opacity-50" /></button>
            {fileSub === 'send' && (
              <div className={subPopCls}>
                {SHARE_TARGETS.map((target) => (
                  <button key={target.id} onClick={() => { handleSendTo(target); setOpenMenu(null); }} className={itemCls} title={`Send to ${target.label}`}>
                    <TargetIcon target={target} /><span className="truncate">{target.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          )}
          <div className={dividerCls} />
          <button onClick={() => { setOpenMenu(null); handlePrint(); }} className={itemCls}><Printer size={15} className="opacity-60" /> Print<span className={shortcutCls}>{accel('Ctrl P')}</span></button>
          <div className={dividerCls} />
          {onOpenPreferences && <button onClick={() => { setOpenMenu(null); onOpenPreferences(); }} className={itemCls}><SlidersHorizontal size={15} className="opacity-60" /> Preferences…<span className={shortcutCls}>{accel('Ctrl ,')}</span></button>}
          <div className={dividerCls} />
          {/* Move to → flyout. Filing a note was drag-only: pick the row up in
              the sidebar and drop it on a folder. That is a gesture a phone
              barely has, so the same move is a menu row here — and it sits with
              Move to Trash because the two are the same decision about where
              this note should live. */}
          {onMoveNoteToFolder && (
            <div className="relative" onMouseEnter={hoverOpen(() => setFileSub('move'))}>
              <button onClick={() => setFileSub((s) => (s === 'move' ? null : 'move'))} className={`${itemCls} ${fileSub === 'move' ? 'bg-slate-100 dark:bg-neutral-900' : ''}`}><FolderInput size={15} className="opacity-60" /> Move to<ChevronRight size={14} className="ml-auto opacity-50" /></button>
              {fileSub === 'move' && (
                <div className={subPopCls}>
                  {/* No folder at all — the workspace root, which the sidebar
                      calls All Notes. Named the way the sidebar names it, so the
                      row says where the note will turn up. */}
                  <button
                    onClick={() => { onMoveNoteToFolder(note.id, null); setOpenMenu(null); }}
                    className={itemCls}
                  >
                    <Check size={14} className={note.folderId ? 'opacity-0' : 'text-[#32CD32]'} />
                    <span className="truncate">All Notes</span>
                  </button>
                  {moveTargets.length > 0 && <div className={dividerCls} />}
                  {moveTargets.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => { onMoveNoteToFolder(note.id, f.id); setOpenMenu(null); }}
                      className={itemCls}
                      title={f.name}
                    >
                      <Check size={14} className={note.folderId === f.id ? 'text-[#32CD32]' : 'opacity-0'} />
                      <span className="truncate">{f.name}</span>
                    </button>
                  ))}
                  {moveTargets.length === 0 && (
                    <div className="px-4 py-2.5 text-xs text-slate-400 dark:text-slate-500 italic">
                      No folders yet — add one in the sidebar
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <button onClick={() => { moveToTrash(note.id); setOpenMenu(null); }} className={itemCls}><BinIcon size={15} className="opacity-60" /> Move to Trash</button>
        </>
      ) : (
        <>
          <button onClick={() => { restoreFromTrash(note.id); setOpenMenu(null); }} className={itemCls}><RotateCcw size={15} className="opacity-60" /> Restore</button>
          <button onClick={() => { deleteNotePerm(note.id); setOpenMenu(null); }} className={itemCls}><XCircle size={15} className="opacity-60" /> Delete Permanently</button>
        </>
      )}
    </>
  );
  const editMenuItems = (
    <>
                      <button onClick={editCmd('undo')} className={itemCls}><Undo2 size={15} className="opacity-60" /> Undo<span className={shortcutCls}>{accel('Ctrl Z')}</span></button>
      <button onClick={editCmd('redo')} className={itemCls}><Redo2 size={15} className="opacity-60" /> Redo<span className={shortcutCls}>{accel('Ctrl Shift Z')}</span></button>
      <div className={dividerCls} />
      <button onClick={editCmd('cut')} className={itemCls}><Scissors size={15} className="opacity-60" /> Cut<span className={shortcutCls}>{accel('Ctrl X')}</span></button>
      <button onClick={editCmd('copy')} className={itemCls}><Copy size={15} className="opacity-60" /> Copy<span className={shortcutCls}>{accel('Ctrl C')}</span></button>
      <button onClick={pasteFromClipboard} className={itemCls}><ClipboardPaste size={15} className="opacity-60" /> Paste<span className={shortcutCls}>{accel('Ctrl V')}</span></button>
      <button onClick={pastePlain} className={itemCls}><ClipboardType size={15} className="opacity-60" /> Paste as plain text<span className={shortcutCls}>{accel('Ctrl Shift V')}</span></button>
      <div className={dividerCls} />
      <button onClick={editCmd('selectAll')} className={itemCls}><TextSelect size={15} className="opacity-60" /> Select All<span className={shortcutCls}>{accel('Ctrl A')}</span></button>
      <div className={dividerCls} />
      <button onClick={() => { setIsFindVisible(true); setOpenMenu(null); }} className={itemCls}><Search size={15} className="opacity-60" /> Find in note<span className={shortcutCls}>{accel('Ctrl F')}</span></button>
    </>
  );
  const formatMenuItems = (
    <>
                        {/* Code files and markdown source have no rich formatting to
          offer — but the spacing sliders below still apply to them,
          so the menu is never empty. */}
      {!isCodeNote && !mdSource && (
        <>
          {([['bold', 'Bold', 'Ctrl B'], ['italic', 'Italic', 'Ctrl I'], ['strikeThrough', 'Strikethrough', 'Ctrl Shift X'], ['checkbox', 'Insert checkbox', '']] as const).map(([cmd, label, sc]) => (
            <button key={cmd} onMouseDown={(e) => e.preventDefault()} onClick={() => window.dispatchEvent(new CustomEvent('valx-format', { detail: cmd }))} className={itemCls}>{label}{sc && <span className={shortcutCls}>{accel(sc)}</span>}</button>
          ))}
          <div className={dividerCls} />
          {([[undefined, 'Left'], ['center', 'Center'], ['right', 'Right']] as const).map(([val, label]) => {
            const active = (note.align ?? undefined) === val || (val === undefined && !note.align);
            return (
              <button key={label} onMouseDown={(e) => e.preventDefault()} onClick={() => updateNote(note.id, { align: val })} className={itemCls}><Check size={14} className={active ? 'text-[#32CD32]' : 'opacity-0'} /> {label}</button>
            );
          })}
          <div className={dividerCls} />
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => { setTableMenu(true); setTHover({ r: 0, c: 0 }); setOpenMenu(null); }} className={itemCls}><Table size={15} className="opacity-60" /> Insert table…</button>
          <div className={dividerCls} />
        </>
      )}
      {spacingItem}
    </>
  );
  const viewMenuItems = (
    <>
      {viewWindowItems}
      <div className={dividerCls} />
      {/* Markdown source moved here from Format: it swaps what the
          editor SHOWS, it doesn't change the note's formatting. */}
      {isMdNote && !note.isTrash && (
        <button onClick={() => { toggleMdSource(); setOpenMenu(null); }} className={itemCls}>
          <Check size={14} className={mdSource ? 'text-[#32CD32]' : 'opacity-0'} /> Markdown source
        </button>
      )}
      {isCodeNote && <button onClick={() => { setSyntaxViewer((v) => !v); setOpenMenu(null); }} className={itemCls}><Check size={14} className={syntaxViewer ? 'text-[#32CD32]' : 'opacity-0'} /> Syntax highlighting</button>}
      {canPreview && <button onClick={() => { setShowPreview((v) => !v); setOpenMenu(null); }} className={itemCls}><Eye size={15} className="opacity-60" /> {showPreview ? 'Hide preview' : 'Preview'}</button>}
      <div className={dividerCls} />
      {viewToggleItems}
      <div className={dividerCls} />
      {!note.isTrash && <button onClick={() => { openHistory(); setOpenMenu(null); }} className={itemCls}><History size={15} className="opacity-60" /> Version history</button>}
    </>
  );

  // --- the menu panel --------------------------------------------------------
  // Every menu, in one grouped list that slides in from the right — the third
  // of the three panels a swipe moves between (see App's swipe routing).
  //
  // Driven off `openMenu === 'sheet'` rather than a state of its own, which is
  // not a trick but the point: dozens of rows already end in setOpenMenu(null)
  // to dismiss the dropdown they were written for, and going through the same
  // state means each of them closes the panel too, with no second code path to
  // keep in step.
  const panelOpen = openMenu === 'sheet';


  const panelGroup = (label: string, body: React.ReactNode) => (
    <section className="mb-5">
      <h3 className="px-3 pb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">{label}</h3>
      <div className="vx-sheet-card rounded-2xl overflow-hidden">{body}</div>
    </section>
  );
  const menuPanel = panelOpen && (
    <>
      <div className="vx-scrim fixed inset-0 z-[70]" onClick={() => setOpenMenu(null)} />
      <div
        className="vx-menu-panel vx-panel-in vx-sheet fixed inset-y-0 right-0 z-[71] w-[86%] max-w-sm overflow-y-auto px-3.5 shadow-[-16px_0_48px_rgba(0,0,0,0.22)]"
        // The panel spans the screen top to bottom, so it owns both insets:
        // the status bar above and the gesture pill below.
        style={{
          paddingTop: `calc(0.75rem + var(--vx-inset-top, 0px))`,
          paddingBottom: `calc(1rem + var(--vx-inset-bottom, 0px))`,
        }}
        // Opens over a focused editor; letting it take the focus would collapse
        // the selection that Cut/Copy/Bold are about to act on.
        onMouseDown={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2 pb-3">
          <button
            onClick={() => setOpenMenu(null)}
            aria-label="Close menu"
            className="-ml-1 p-1.5 rounded-lg text-[#32CD32] active:opacity-60 transition-opacity"
          >
            <ChevronRight size={22} />
          </button>
          <span className="text-[17px] font-semibold text-slate-900 dark:text-white truncate">
            {note.title || 'Untitled'}
          </span>
        </div>
        {panelGroup('File', fileMenuItems)}
        {panelGroup('Edit', editMenuItems)}
        {!note.isTrash && panelGroup('Format', formatMenuItems)}
        {panelGroup('Words', wordsMenuItems)}
        {panelGroup('View', viewMenuItems)}
      </div>
    </>
  );

  return (
    <div
      // The mouse drops notes here through dataTransfer (handleDrop below); a
      // finger has no such API, so the touch drag finds this pane by attribute
      // instead (lib/touchDrag.ts). Both land on the same merge.
      data-drop-editor={note.isTrash ? undefined : ''}
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

      {/* Focus-mode reveal sensor (windowed chrome is always shown). Hover on a
          pointer; a tap on the top edge where there is none — a finger has no
          hover state, and revealing on any tap would fight the caret. The strip
          is taller on touch because a thumb is not a mouse cursor. */}
      {isFullscreen && !chromeShown && (
        <div
          className={`absolute top-0 inset-x-0 z-40 ${isTouchUI ? 'block h-8' : 'hidden md:block h-2'}`}
          onMouseEnter={() => setTopHover(true)}
          onPointerDown={(e) => { if (e.pointerType !== 'mouse') setTopHover(true); }}
        />
      )}

      {/* iA-Writer-style chrome: title bar + menu bar. Persistent when windowed,
          auto-hides in fullscreen (reveal on top-edge hover / while a menu is open). */}
      <div
        onMouseLeave={() => setTopHover(false)}
        // Bottom hairline only. The bar spans the window, so a border on the
        // other three sides drew a rectangle around it — the outline the
        // chrome is meant not to have.
        className={`absolute top-0 inset-x-0 z-50 vx-glass-strong border-b border-black/[0.06] dark:border-white/[0.08] transition-[transform,opacity] ${chromeFadeCls} ease-[cubic-bezier(0.16,1,0.3,1)] ${chromeShown ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'}`}
        // In native fullscreen the window extends under the system menu bar,
        // which slides down over the top of it on the same top-edge hover that
        // reveals this bar. Without the offset the two land on top of each
        // other and the traffic lights sit over the sidebar toggle. Only while
        // actually revealed — the hidden bar is translated off-screen anyway.
        style={macChromeTop ? { top: macChromeTop } : undefined}
      >
        {/* Title bar. On a pointer it is the top half of a Windows-style menu
            chrome: sidebar toggle · centered doc title (drag region) · caption
            buttons. On touch it becomes the whole chrome — an iOS navigation
            bar, taller for thumbs, with the five menus folded into the ⋯ at
            its trailing edge and the menu-bar row below dropped entirely. */}
        <div className={`${isTouchUI ? 'h-12' : 'h-9'} flex items-center px-1.5 gap-1 text-slate-400 dark:text-slate-500`} style={{ paddingLeft: trafficLightInset || undefined }}>
          {onBack && isTouchUI && (
            <button onClick={onBack} aria-label="Back to notes" className="flex items-center pr-2 py-1.5 rounded-lg text-[#32CD32] active:opacity-60 transition-opacity">
              <ChevronLeft size={26} strokeWidth={2.25} />
              <span className="text-[16px] -ml-0.5">Notes</span>
            </button>
          )}
          {onToggleSidebar && (
            <button onClick={onToggleSidebar} className="hidden md:flex p-1.5 rounded-md hover:text-slate-600 dark:hover:text-slate-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors" title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}>
              {sidebarOpen ? <ArrowLeft size={17} /> : <ArrowRight size={17} />}
            </button>
          )}
          <div data-tauri-drag-region className="flex-1 h-full flex items-center justify-center min-w-0">
            <span className={`truncate px-2 pointer-events-none ${isTouchUI ? 'text-[16px] font-semibold text-slate-900 dark:text-white' : 'text-xs font-medium text-slate-500 dark:text-slate-400'}`}>
              {isTouchUI ? (note.title || 'Untitled') : `${note.title || 'Untitled'} — Valx`}
            </span>
          </div>
          {/* Focus mode's only handle on a phone. Keyboard users have F11/⌘↩
              and the View menu; a finger needs a button, and it has to be on
              the bar that the top-edge tap reveals — otherwise focus mode is a
              room with no door. */}
          {isTouchUI && (
            <>
              <button onClick={toggleFullscreen} aria-label={isFullscreen ? 'Exit focus mode' : 'Focus mode'} className="p-2 shrink-0 rounded-lg text-[#32CD32] active:opacity-60 transition-opacity">
                {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
              </button>
              {/* Share, in the trailing slot iOS keeps for it — the system
                  share sheet, straight from the bar. The five menus used to be
                  here behind a ⋯; they are a swipe left away now (or the
                  drawer handle on the right edge), which leaves this the one
                  action worth a permanent button. */}
              <button onClick={handleNativeShare} aria-label="Share" className="p-2 -mr-0.5 shrink-0 rounded-lg text-[#32CD32] active:opacity-60 transition-opacity">
                <Share size={20} />
              </button>
            </>
          )}
          {showCaptionButtons && (
            <div className="flex items-center -mr-1 shrink-0">
              <button onClick={winMinimize} aria-label="Minimize" className="w-11 h-9 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"><Minus size={15} /></button>
              <button onClick={winMaximize} aria-label="Maximize" className="w-11 h-9 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"><Square size={12} /></button>
              <button onClick={winClose} aria-label="Close" className="w-11 h-9 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-[#e81123] hover:text-white transition-colors"><X size={15} /></button>
            </div>
          )}
        </div>

        {/* Menu bar. Pointer only — on touch these five live in the menu panel. */}
        <div className={`h-8 ${isTouchUI ? 'hidden' : 'flex'} items-stretch px-1 gap-0.5 border-t border-black/5 dark:border-white/10 text-slate-600 dark:text-slate-300 relative`}>
          {openMenu && <div className="fixed inset-0 z-40" onMouseDown={() => setOpenMenu(null)} />}

          {/* FILE */}
          <div className="relative z-50">
            <button onClick={() => setOpenMenu((m) => (m === 'file' ? null : 'file'))} onMouseEnter={() => openMenu && setOpenMenu('file')} className={menuBtnCls('file')}>File</button>
            {openMenu === 'file' && (
              <div className={menuPopCls}>
                {fileMenuItems}
              </div>
            )}
          </div>

          {/* EDIT */}
          <div className="relative z-50">
            <button onClick={() => setOpenMenu((m) => (m === 'edit' ? null : 'edit'))} onMouseEnter={() => openMenu && setOpenMenu('edit')} className={menuBtnCls('edit')}>Edit</button>
            {openMenu === 'edit' && (
              /* onMouseDown={preventDefault} on every row: opening a menu would
                 otherwise blur the editor and collapse the selection, so Cut /
                 Copy / formatting would act on nothing. */
              <div className={menuPopCls} onMouseDown={(e) => e.preventDefault()}>
                {editMenuItems}
              </div>
            )}
          </div>

          {/* FORMAT */}
          {!note.isTrash && (
            <div className="relative z-50">
              <button onClick={() => setOpenMenu((m) => (m === 'format' ? null : 'format'))} onMouseEnter={() => openMenu && setOpenMenu('format')} className={menuBtnCls('format')}>Format</button>
              {openMenu === 'format' && (
                <div className={menuPopCls}>
                  {formatMenuItems}
                </div>
              )}
            </div>
          )}

          {/* WORDS — everything that judges or corrects the prose itself:
              spelling, the dictionary it checks against, and the language.
              These used to trail the Edit menu, which had become a grab bag. */}
          <div className="relative z-50">
            <button onClick={() => setOpenMenu((m) => (m === 'words' ? null : 'words'))} onMouseEnter={() => openMenu && setOpenMenu('words')} className={menuBtnCls('words')}>Words</button>
            {openMenu === 'words' && wordsMenuPop}
          </div>

          {/* VIEW */}
          <div className="relative z-50">
            <button onClick={() => setOpenMenu((m) => (m === 'view' ? null : 'view'))} onMouseEnter={() => openMenu && setOpenMenu('view')} className={menuBtnCls('view')}>View</button>
            {openMenu === 'view' && (
              <div className={menuPopCls}>
                {viewMenuItems}
              </div>
            )}
          </div>

          {/* CREATORS — the primary creator name + extra human authors (each
              becomes a "Mark as" label and a byline credit), plus the
              provenance-highlight toggles.

              Dropped on touch. Not for width alone (though six menus do overflow
              a 360px phone and this is the widest): every label it defines is
              spent through the right-click "Mark as" menu, and a finger has no
              right-click. Configuring authors you could never then apply is
              worse than not offering it. */}
          <div className={`relative z-50 ${isTouchUI ? 'hidden' : ''}`}>
            <button onClick={() => setOpenMenu((m) => (m === 'creators' ? null : 'creators'))} onMouseEnter={() => openMenu && setOpenMenu('creators')} className={menuBtnCls('creators')}>Creators</button>
            {openMenu === 'creators' && (
              <div className={`${menuPopCls} min-w-64`}>
                <div className="px-3 pb-2 pt-1.5">
                  <input
                    value={creatorMe}
                    onChange={(e) => setCreatorMeName(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Your name (replaces “Me”)"
                    className="w-full bg-slate-100 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-md px-2 py-1 text-sm text-slate-900 dark:text-white outline-none focus:border-[#32CD32] transition-colors"
                  />
                </div>
                <div className={dividerCls} />
                <button onClick={(e) => { e.stopPropagation(); addCreator(); }} className={itemCls}><Plus size={15} className="opacity-60" /> Add author</button>
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

      {/* The touch menu panel. A sibling of the chrome, not a child of it, so
          it still presents while the chrome is hidden in focus mode. */}
      {menuPanel}

      {/* Drawer handle for the menu panel. The panel's real gesture is a swipe
          left, but a gesture with no visible affordance is a feature only the
          person who built it knows about — so the edge it comes from carries a
          grip, and the grip is also a button. Hidden while the panel is open
          (it would sit under it) and in focus mode, where the whole point is
          that nothing is on screen but the page. */}
      {isTouchUI && !panelOpen && !isFullscreen && !!note && (
        <button
          onClick={() => setOpenMenu('sheet')}
          aria-label="Open menu"
          className="vx-drawer-grip absolute right-0 top-1/2 -translate-y-1/2 z-30 h-16 w-3.5 flex items-center justify-center rounded-l-lg active:opacity-100"
        >
          <span className="block h-8 w-[3px] rounded-full bg-slate-400/60 dark:bg-slate-500/60" />
        </button>
      )}

      {/* Find panel — opened from Edit menu / Ctrl+F, floats below the chrome. */}
      {isFindVisible && (
        <div className="vx-pop vx-glass-strong vx-hairline absolute top-[72px] right-4 z-[55] shadow-xl rounded-2xl p-2 flex items-center gap-1">
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
          <div className="vx-menu-pop vx-glass-strong vx-hairline absolute top-[72px] right-4 z-[55] w-72 max-h-80 overflow-auto shadow-xl rounded-2xl py-1">
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
          <div className="vx-menu-pop vx-glass-strong vx-hairline absolute top-[72px] left-1/2 -translate-x-1/2 z-[55] shadow-xl rounded-2xl p-3">
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
        <div className={`flex-1 min-h-0 flex flex-col transition-[padding] ${chromeFadeCls} ease-[cubic-bezier(0.16,1,0.3,1)] ${isFullscreen ? 'pt-10' : isTouchUI ? 'pt-[56px]' : 'pt-[76px]'} ${savedFlash !== null ? 'save-glow' : ''}`}>
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
        <div className={`vx-editor-scroll flex-1 min-w-0 overflow-y-auto px-8 sm:px-12 lg:px-24 py-12 print-area transition-[color,padding] ${chromeFadeCls} ease-[cubic-bezier(0.16,1,0.3,1)] ${isFullscreen ? 'pt-12' : isTouchUI ? 'pt-[60px]' : 'pt-[80px]'} ${savedFlash !== null ? 'save-glow' : ''}`}>
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
