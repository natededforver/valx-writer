import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
  buildTableHtml, getCellFromSelection, moveCell as tableMoveCell,
  addRow, addColumn, deleteRow, deleteColumn, deleteTable, isTableEmpty,
} from '../lib/tableEditing';
import { Plus, Minus, Trash2 } from 'lucide-react';
import { JumpTarget } from '../types';
import { parseTrailingMdLink } from '../lib/noteLinks';
import { slopWrapText, webReferenceHtml, wordSpans, SlopType } from '../lib/slop';
import { mediaDisplaySrc, mediaDisplayHtml, mediaCanonicalHtml, onNativeMarkAs } from '../lib/desktop';
import { SlashMenu, SlashItem, SlashSyntaxItem, SlashMediaItem } from './SlashMenu';
import { AttachmentItem } from '../hooks/useFileSystem';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  onTextFileDrop?: (files: File[]) => void;
  /** A search-result click asking the editor to select + scroll to one occurrence. */
  jumpTo?: JumpTarget | null;
  /** Clicked link resolved to a workspace note — return true if handled (note opened),
   *  false to fall back to opening it externally. */
  onOpenNoteLink?: (href: string) => boolean;
  /** Workspace media for the '/' menu (attachments imported into any note). */
  listAttachments?: () => Promise<AttachmentItem[]>;
  className?: string;
}

// '/' menu syntax commands — mirrors what the editor already understands:
// real h1–h4 blocks, text-based lists the Enter handler continues, and the
// checkbox markup markdownToHtml round-trips.
const SLASH_SYNTAX: SlashSyntaxItem[] = [
  { type: 'syntax', id: 'h1', label: 'Heading 1', hint: '#' },
  { type: 'syntax', id: 'h2', label: 'Heading 2', hint: '##' },
  { type: 'syntax', id: 'h3', label: 'Heading 3', hint: '###' },
  { type: 'syntax', id: 'h4', label: 'Heading 4', hint: '####' },
  { type: 'syntax', id: 'h5', label: 'Heading 5', hint: '#####' },
  { type: 'syntax', id: 'h6', label: 'Heading 6', hint: '######' },
  { type: 'syntax', id: 'bullet', label: 'Bullet List', hint: '-' },
  { type: 'syntax', id: 'numbered', label: 'Numbered List', hint: '1.' },
  { type: 'syntax', id: 'checked', label: 'Checked List', hint: '[ ]' },
  { type: 'syntax', id: 'quote', label: 'Blockquote', hint: '>' },
  { type: 'syntax', id: 'code', label: 'Code Block', hint: '```' },
  { type: 'syntax', id: 'icode', label: 'Inline Code', hint: '`' },
  { type: 'syntax', id: 'bold', label: 'Bold', hint: '**' },
  { type: 'syntax', id: 'italic', label: 'Italic', hint: '*' },
  { type: 'syntax', id: 'strike', label: 'Strikethrough', hint: '~~' },
  { type: 'syntax', id: 'hr', label: 'Divider', hint: '---' },
  { type: 'syntax', id: 'table', label: 'Table', hint: '' },
];

const CARET_W = 24; // px — fixed I-beam width, font-size-independent
const CARET_H = 36; // px — fixed I-beam height, font-size-independent

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Canonical media markup for a dropped/pasted/imported file — also reused by
 *  World Mode (Phase 4) to wrap solo-imported media in a note with identical
 *  content, so playback controls and the editor's hover-remove tool work unchanged. */
export const buildMediaHtml = (kind: string, src: string, name: string): string => {
  // display: inline-block (explicit, not relying on UA default — WebView2's
  // default for audio/video isn't guaranteed to match Chromium's) so each
  // element sits in the line box and follows the note's text-align setting
  // (left/center/right) instead of ignoring it. A fixed base width on audio
  // replaces the old `width: 100%`, which always filled the row and made
  // alignment invisible no matter what the note was set to.
  if (kind === 'image') {
    return `<br><img src="${src}" alt="${escAttr(name)}" style="display: inline-block; max-width: 100%; max-height: 500px; border-radius: 0.375rem; margin-top: 1rem; margin-bottom: 1rem; object-fit: contain;" /><br>`;
  }
  if (kind === 'audio') {
    return `<br><audio controls src="${src}" style="display: inline-block; width: 320px; max-width: 100%; margin-top: 1rem; margin-bottom: 1rem;"></audio><br>`;
  }
  if (kind === 'video') {
    return `<br><video controls src="${src}" style="display: inline-block; max-width: 100%; max-height: 500px; border-radius: 0.375rem; margin-top: 1rem; margin-bottom: 1rem;"></video><br>`;
  }
  // Generic file: a compact, non-editable chip that opens the real file.
  return `<br><a href="${src}" class="vx-attach" data-name="${escAttr(name)}" contenteditable="false" style="display:inline-flex;align-items:center;gap:8px;max-width:100%;padding:8px 14px;margin:0.35rem 0;border:1px solid rgba(120,120,120,0.28);border-radius:10px;background:rgba(120,120,120,0.06);font-size:0.9rem;text-decoration:none;color:inherit;cursor:pointer;">📎 <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escText(name)}</span></a><br>`;
};

export function RichTextEditor({ value, onChange, disabled, placeholder, onTextFileDrop, jumpTo, onOpenNoteLink, listAttachments, className = '' }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLDivElement>(null);

  // --- '/' command menu -------------------------------------------------------
  // Typing '/' at a line start (or after whitespace) opens the command menu at
  // the caret; further typing filters it; ↑/↓ cycle; Enter/Tab/click insert.
  const [slashPos, setSlashPos] = useState<{ top: number; left: number } | null>(null);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashSel, setSlashSel] = useState(0);
  const [slashMedia, setSlashMedia] = useState<AttachmentItem[]>([]);
  const [clipFile, setClipFile] = useState<File | null>(null);
  const clipThumb = useMemo(() => (clipFile ? URL.createObjectURL(clipFile) : null), [clipFile]);
  const slashAnchorRef = useRef<{ node: Text; offset: number } | null>(null);

  const closeSlash = () => {
    slashAnchorRef.current = null;
    setSlashPos(null);
    setSlashQuery('');
    setSlashSel(0);
  };

  const openSlash = () => {
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !sel.focusNode) return;
    const node = sel.focusNode;
    if (node.nodeType !== Node.TEXT_NODE || !editorRef.current?.contains(node)) return;
    const off = sel.focusOffset;
    const text = node.textContent || '';
    if (text[off - 1] !== '/') return;
    const before = text.slice(0, off - 1);
    if (before && !/[\s ​]$/.test(before)) return; // mid-word '/' is just text
    slashAnchorRef.current = { node: node as Text, offset: off - 1 };
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const wrapper = editorRef.current!.parentElement!.getBoundingClientRect();
    setSlashPos({
      top: rect.bottom - wrapper.top + 8,
      left: Math.max(0, Math.min(rect.left - wrapper.left, wrapper.width - 300)),
    });
    setSlashQuery('');
    setSlashSel(0);
    listAttachments?.().then(setSlashMedia).catch(() => setSlashMedia([]));
    // Clipboard image, if the platform lets us peek (permission denied → no entry).
    setClipFile(null);
    const api = (window as any).electronAPI;
    if (api?.clipboardReadImageFile) {
      api.clipboardReadImageFile().then((file: File | null) => file && setClipFile(file));
    } else {
      (navigator.clipboard as any)?.read?.()
        .then(async (items: any[]) => {
          for (const it of items) {
            const type = (it.types as string[]).find((t) => t.startsWith('image/'));
            if (type) {
              const blob = await it.getType(type);
              setClipFile(new File([blob], `clipboard.${type.split('/')[1] || 'png'}`, { type }));
              return;
            }
          }
        })
        .catch(() => {});
    }
  };

  // Query = text between the '/' and the caret; anything that invalidates the
  // anchor (deleted slash, caret left the node, whitespace typed) closes.
  const trackSlash = () => {
    const a = slashAnchorRef.current;
    if (!a) return;
    const sel = window.getSelection();
    if (
      !a.node.isConnected || (a.node.textContent || '')[a.offset] !== '/' ||
      !sel || !sel.isCollapsed || sel.focusNode !== a.node || sel.focusOffset <= a.offset
    ) {
      closeSlash();
      return;
    }
    const q = (a.node.textContent || '').slice(a.offset + 1, sel.focusOffset);
    if (/[\s ]/.test(q)) { closeSlash(); return; }
    setSlashQuery(q);
    setSlashSel(0);
  };
  const trackSlashRef = useRef(trackSlash);
  trackSlashRef.current = trackSlash;
  // handleInput is a stable useCallback — it reaches the current openSlash
  // through this ref (the established ref-mirroring idiom).
  const openSlashRef = useRef(openSlash);
  openSlashRef.current = openSlash;

  // Click-away closes (menu rows stopPropagation on mousedown, so picking stays alive).
  useEffect(() => {
    if (!slashPos) return;
    const close = () => closeSlash();
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [slashPos]);

  // Custom text caret: the native caret is hidden (caret-color: transparent in
  // index.css) and this overlay draws the asset at the insertion point. Reads
  // only refs + live DOM selection — no React state — so deps stay [] and the
  // listeners register once (per the ref-mirroring rule in CLAUDE.md).
  useEffect(() => {
    const editor = editorRef.current;
    const caret = caretRef.current;
    if (!editor || !caret) return;

    const place = () => {
      const sel = window.getSelection();
      const focused = document.activeElement === editor;
      if (!focused || !sel || sel.rangeCount === 0 || !sel.isCollapsed || !editor.contains(sel.anchorNode)) {
        caret.style.display = 'none';
        return;
      }
      const range = sel.getRangeAt(0);
      let rect = range.getBoundingClientRect();
      if (!rect.height) {
        // ponytail: empty line / empty editor gives a zero-height range —
        // approximate from the line element's rect + line-height (caret sits at
        // line start). Upgrade to a temp-span measure only if that looks off.
        const node = range.startContainer;
        let el: HTMLElement;
        if (node.nodeType === 3) {
          el = node.parentElement as HTMLElement;
        } else {
          // Collapsed between element children (e.g. right after Shift+Enter's
          // <br><br>, where startContainer is the editor/block itself) — the
          // container's own rect is its TOP, not this line. Anchor on the
          // sibling node the caret actually sits next to instead.
          const sibling = (node.childNodes[range.startOffset - 1] || node.childNodes[range.startOffset]) as HTMLElement | undefined;
          el = (sibling && sibling.nodeType !== 3 ? sibling : node) as HTMLElement;
        }
        const r = el.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(el).lineHeight) || r.height || 24;
        rect = { left: r.left, top: r.top, height: lh } as DOMRect;
      }
      const host = editor.parentElement!.getBoundingClientRect();
      // Fixed caret dimensions — never derived from font size or line height.
      caret.style.display = 'block';
      caret.style.height = CARET_H + 'px';
      caret.style.width  = CARET_W + 'px';
      const lineH = rect.height || CARET_H;
      caret.style.left = rect.left - host.left - CARET_W / 2 + 'px';
      caret.style.top  = rect.top  - host.top  + (lineH - CARET_H) / 2 + 'px';
      // Restart the blink so the caret is solid the instant it moves.
      caret.style.animation = 'none';
      void caret.offsetWidth;
      caret.style.animation = '';
    };

    document.addEventListener('selectionchange', place);
    window.addEventListener('scroll', place, true); // capture: catch inner scroll containers
    window.addEventListener('resize', place);
    editor.addEventListener('focus', place);
    editor.addEventListener('blur', place);
    return () => {
      document.removeEventListener('selectionchange', place);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      editor.removeEventListener('focus', place);
      editor.removeEventListener('blur', place);
    };
  }, []);

  // --- Ctrl multi-selection (CSS Custom Highlight API — native, no DOM edits) ---
  // Ctrl+drag accumulates disjoint Ranges; formatting shortcuts and Delete then
  // apply to every stored range at once. Ranges are live DOM Ranges, so they
  // self-adjust as earlier ranges' deletions mutate the document.
  const multiRangesRef = useRef<Range[]>([]);

  // #tag highlighting (same zero-DOM-mutation pattern, below). Mirrors
  // useNotes.parseTags's charset: '#' + [\w-]+ at line start or after
  // whitespace, so "# Heading" (space right after #) never lights up.
  const paintTagHighlights = () => {
    const H = (window as any).Highlight;
    const registry = (CSS as any).highlights;
    const editor = editorRef.current;
    if (!H || !registry || !editor) return;
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = (node as Text).data;
      const re = /(^|[\s​])(#[\w-]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const start = m.index + m[1].length;
        const r = document.createRange();
        r.setStart(node, start);
        r.setEnd(node, start + m[2].length);
        ranges.push(r);
      }
    }
    if (ranges.length) registry.set('vx-tag', new H(...ranges));
    else registry.delete('vx-tag');
  };

  // Checked task items: strike through the line's text (checkbox itself is a
  // real interactive control now — see handleClick). Same zero-DOM-mutation
  // Highlight API pattern as paintTagHighlights above, so typing right after
  // a checkbox never has to fight a wrapper element for the caret. A "line"
  // is everything between the checkbox and the next <br> sibling (or the end
  // of its parent, when nothing follows).
  const paintTaskHighlights = () => {
    const H = (window as any).Highlight;
    const registry = (CSS as any).highlights;
    const editor = editorRef.current;
    if (!H || !registry || !editor) return;
    const ranges: Range[] = [];
    editor.querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => {
      let last: ChildNode | null = null;
      let cur = cb.nextSibling;
      while (cur && cur.nodeName !== 'BR') { last = cur; cur = cur.nextSibling; }
      if (!last) return;
      const r = document.createRange();
      r.setStartAfter(cb);
      r.setEndAfter(last);
      ranges.push(r);
    });
    if (ranges.length) registry.set('vx-task-done', new H(...ranges));
    else registry.delete('vx-task-done');
  };

  const paintMultiHighlight = () => {
    const H = (window as any).Highlight;
    const registry = (CSS as any).highlights;
    if (!H || !registry) return; // ponytail: no fallback rendering — Electron 42 always has the API
    if (multiRangesRef.current.length) registry.set('vx-multi', new H(...multiRangesRef.current));
    else registry.delete('vx-multi');
  };
  const clearMultiSelection = () => {
    if (multiRangesRef.current.length === 0) return;
    multiRangesRef.current = [];
    paintMultiHighlight();
  };
  const handleMouseUp = (e: React.MouseEvent) => {
    if (!(e.ctrlKey || e.metaKey) || disabled) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    if (!editorRef.current?.contains(r.commonAncestorContainer)) return;
    multiRangesRef.current.push(r.cloneRange());
    paintMultiHighlight();
  };
  /** Runs an execCommand over every stored range; true if there was anything to do. */
  const applyToMultiRanges = (fn: () => void): boolean => {
    const ranges = multiRangesRef.current;
    if (ranges.length === 0) return false;
    const sel = window.getSelection();
    for (const r of ranges) {
      sel?.removeAllRanges();
      sel?.addRange(r);
      fn();
    }
    clearMultiSelection();
    return true;
  };

  // --- Slop detector (provenance marks over pasted text) ---
  // Text pasted from OUTSIDE the editor gets per-word <mark class="vx-slop">
  // wrappers (see lib/slop.ts) so the user always sees what they didn't write
  // themselves. Copying within the editor is remembered here so rearranging
  // your own words is never flagged.
  const lastInternalCopyRef = useRef('');
  const handleCopy = () => {
    lastInternalCopyRef.current = window.getSelection()?.toString() ?? '';
  };

  // insertHTML fires 'input' SYNCHRONOUSLY mid-execCommand, while the caret
  // still sits inside the last inserted mark — the edit pass must not treat
  // that as the user editing the word.
  const suppressUnwrapRef = useRef(false);

  // Editing a marked word: the mark is NOT touched while you type, and is never
  // removed by editing — only "Mark as me" unwraps it (see unwrapSlopInRange).
  const slopMarkAtCaret = (): HTMLElement | null => {
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !sel.anchorNode) return null;
    const n = sel.anchorNode;
    const el = n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement;
    const mark = el?.closest('mark.vx-slop') as HTMLElement | null;
    return mark && editorRef.current?.contains(mark) ? mark : null;
  };

  const updateSlopEdit = () => {
    if (suppressUnwrapRef.current) return;
    const mark = slopMarkAtCaret();
    // A word backspaced to nothing leaves an empty mark; drop the stale ones,
    // but never the one holding the caret (removing it would kill the caret).
    editorRef.current?.querySelectorAll('mark.vx-slop:empty').forEach((mk) => { if (mk !== mark) mk.remove(); });
  };

  // Caret moves (click, arrows) trigger the empty-mark cleanup.
  // Refs, not closures: this listener registers once (CLAUDE.md ref-mirroring).
  const updateSlopEditRef = useRef(updateSlopEdit);
  updateSlopEditRef.current = updateSlopEdit;
  useEffect(() => {
    const onSel = () => updateSlopEditRef.current();
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  const unwrapSlopInRange = (range: Range) => {
    editorRef.current?.querySelectorAll('mark.vx-slop').forEach((mk) => {
      if (range.intersectsNode(mk)) mk.replaceWith(...Array.from(mk.childNodes));
    });
  };

  /** Wrap every word the range touches in slop marks (replacing any existing
   *  provenance first). Targets are collected before mutating, then processed
   *  in reverse document order so earlier offsets stay valid. */
  const wrapSlopInRange = (range: Range, type: SlopType) => {
    unwrapSlopInRange(range);
    const targets: { node: Text; start: number; end: number }[] = [];
    const pushTarget = (t: Text) => {
      const start = t === range.startContainer ? range.startOffset : 0;
      const end = t === range.endContainer ? range.endOffset : t.length;
      if (end > start) targets.push({ node: t, start, end });
    };
    const root = range.commonAncestorContainer;
    if (root.nodeType === Node.TEXT_NODE) {
      pushTarget(root as Text);
    } else {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walker.nextNode())) if (range.intersectsNode(n)) pushTarget(n as Text);
    }
    for (const { node, start, end } of targets.reverse()) {
      for (const span of wordSpans(node.data.slice(start, end)).reverse()) {
        const r = document.createRange();
        r.setStart(node, start + span.start);
        r.setEnd(node, start + span.end);
        const mk = document.createElement('mark');
        mk.className = 'vx-slop';
        mk.dataset.slop = type;
        r.surroundContents(mk);
      }
    }
  };

  // Right-click on a selection populates slopRangeRef for the native "Mark as"
  // submenu (native_mark_as.rs); 'web' first collects the source site via a
  // small dialog, then marks + appends a reference line.
  const slopRangeRef = useRef<Range | null>(null);
  const [webDialog, setWebDialog] = useState(false);
  const [webSite, setWebSite] = useState('');
  const [webUrl, setWebUrl] = useState('');

  /** The live selection, if it lies inside this editor. */
  const selectionInEditor = (): Range | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const r = sel.getRangeAt(0);
    return editorRef.current?.contains(r.commonAncestorContainer) ? r : null;
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    const r = selectionInEditor();
    if (disabled || !r) return;
    // Never preventDefault here — the OS/webview owns the native menu
    // (spellcheck suggestions, cut/copy/paste, and the injected "Mark as"
    // submenu from native_mark_as.rs).
    slopRangeRef.current = r.cloneRange();
  };

  const markSelectionAs = (type: 'me' | SlopType, ref?: { site: string; url?: string }) => {
    const range = slopRangeRef.current;
    if (!range || !editorRef.current) return;
    if (type === 'me') unwrapSlopInRange(range);
    else wrapSlopInRange(range, type);
    if (ref?.site) editorRef.current.insertAdjacentHTML('beforeend', webReferenceHtml(ref.site, ref.url));
    handleInput();
  };

  // The native "Mark as" submenu (Windows only, see native_mark_as.rs) reuses
  // slopRangeRef, which handleContextMenu already populated before WebView2
  // raised its ContextMenuRequested event — same range the JS bubble menu
  // would have used. Subscribed once; mark*Ref keeps the handler current
  // without resubscribing to the native event on every render.
  const markSelectionAsRef = useRef(markSelectionAs);
  markSelectionAsRef.current = markSelectionAs;
  useEffect(() => {
    return onNativeMarkAs((kind) => {
      if (kind === 'web') { setWebSite(''); setWebUrl(''); setWebDialog(true); return; }
      markSelectionAsRef.current(kind as 'me' | SlopType);
    });
  }, []);

  // The DOM shows the display form of media URLs (asset protocol under Tauri);
  // `value` stays canonical (/__media/…). The two rewrites round-trip exactly,
  // so this equality check keeps holding while typing (no innerHTML resets).
  useEffect(() => {
    const displayValue = mediaDisplayHtml(value);
    if (editorRef.current && displayValue !== editorRef.current.innerHTML) {
      editorRef.current.innerHTML = displayValue;
      // External replacement (note switch, history revert) disconnects the
      // slash anchor — drop the menu instead of leaving it orphaned.
      closeSlash();
    }
    paintTagHighlights();
    paintTaskHighlights();
  }, [value]);

  // Search-result navigation: select + scroll to the occurrence-th match of
  // jumpTo.query, and pulse an overlay so the hit stays visible even after the
  // native selection is cleared by a later focus change. We select via a Range
  // instead of mutating the DOM (e.g. wrapping in <mark>) so this never dirties
  // innerHTML / fires onChange / triggers a save.
  const [searchHitRect, setSearchHitRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const hitFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !jumpTo || jumpTo.occurrence < 0 || !jumpTo.query) return;
    try {
      const q = jumpTo.query.toLowerCase();
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let matchNode: Text | null = null;
      let matchOffset = -1;
      let count = 0;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent || '';
        const lower = text.toLowerCase();
        let from = 0;
        let idx: number;
        while ((idx = lower.indexOf(q, from)) !== -1) {
          if (count === jumpTo.occurrence) { matchNode = node as Text; matchOffset = idx; break; }
          count += 1;
          from = idx + q.length;
        }
        if (matchNode) break;
      }
      if (!matchNode) return;

      const range = document.createRange();
      range.setStart(matchNode, matchOffset);
      range.setEnd(matchNode, Math.min(matchNode.length, matchOffset + jumpTo.query.length));
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      matchNode.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });

      if (hitFadeTimerRef.current) clearTimeout(hitFadeTimerRef.current);
      // Let the smooth scroll settle before measuring where to draw the pulse.
      const settleTimer = setTimeout(() => {
        const wrapper = editor.parentElement as HTMLElement | null;
        if (!wrapper) return;
        const rect = range.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        setSearchHitRect({
          top: rect.top - wrapperRect.top,
          left: rect.left - wrapperRect.left,
          width: rect.width,
          height: rect.height,
        });
        hitFadeTimerRef.current = setTimeout(() => setSearchHitRect(null), 1400);
      }, 350);
      return () => clearTimeout(settleTimer);
    } catch { /* Range/Selection can throw on a stale node; just skip the pulse */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo?.nonce]);
  useEffect(() => () => { if (hitFadeTimerRef.current) clearTimeout(hitFadeTimerRef.current); }, []);

  // Typing the closing paren of a complete `[label](href)` swaps the literal
  // markdown for a real anchor (styled lime+bold via .rich-editor a). The
  // trailing &nbsp; keeps the caret OUTSIDE the new anchor so further typing
  // doesn't extend the link.
  const maybeConvertMdLink = (): boolean => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
    const node = sel.focusNode;
    if (!node || node.nodeType !== Node.TEXT_NODE || !editorRef.current?.contains(node)) return false;
    if ((node.parentElement as HTMLElement | null)?.closest('a')) return false;
    const before = (node.textContent || '').slice(0, sel.focusOffset);
    const link = parseTrailingMdLink(before);
    if (!link) return false;
    const range = document.createRange();
    range.setStart(node, sel.focusOffset - link.matchLen);
    range.setEnd(node, sel.focusOffset);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertHTML', false, `<a href="${escAttr(link.href)}">${escText(link.label)}</a>&nbsp;`);
    return true;
  };

  // On keyUP, not in handleInput: Chromium refuses a nested execCommand while
  // an 'input' event is still dispatching (insertHTML returns false there).
  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === ')' && !disabled && maybeConvertMdLink()) handleInput();
  };

  const handleInput = useCallback((e?: React.FormEvent) => {
    updateSlopEditRef.current();
    trackSlashRef.current();
    // '/' menu trigger — inspects the caret's own preceding character rather
    // than InputEvent.data: that field's behavior on a trailing '/' is
    // inconsistent across desktop browsers/OSs in contentEditable (some
    // report the whole inserted string, some nothing), so it silently never
    // fired on many setups. Reading the live DOM around the caret (same
    // check openSlash already does internally) works regardless of input
    // method. Only probe when no menu is currently open — trackSlash above
    // already owns updates while one is tracking.
    if (!slashAnchorRef.current) openSlashRef.current();
    if (editorRef.current) {
      let html = editorRef.current.innerHTML;
      
      // Auto-format markdown headers if they are at the start of a line or div.
      // Real h1–h6 tags (styled in index.css) so headings round-trip cleanly
      // to markdown when the note is saved as .md.
      if (html.match(/^(#+)(?:\s|&nbsp;)+(.*?)((?:<br\s*\/?>|<\/div>|<\/p>|$))/)) {
        // Save the caret's absolute offset in the editor's rendered text before
        // mutating — conversion only ever removes the "#…" prefix chars, so the
        // same offset shift (old plain length - new plain length) relocates it
        // correctly afterward, landing the caret INSIDE the new <hN> tag. (A
        // caret left outside the tag was the root cause of Enter continuing the
        // heading failing right after typing "# ".)
        const selection = window.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        let caretOffset: number | null = null;
        if (range && editorRef.current.contains(range.startContainer)) {
          const pre = range.cloneRange();
          pre.selectNodeContents(editorRef.current);
          pre.setEnd(range.startContainer, range.startOffset);
          caretOffset = pre.toString().length;
        }
        const plainLen = (h: string) => {
          const tmp = document.createElement('div');
          tmp.innerHTML = h;
          return (tmp.textContent || '').length;
        };
        const beforeLen = plainLen(html);

        let match;
        while ((match = /^(#+)(?:\s|&nbsp;)+(.*?)((?:<br\s*\/?>|<\/div>|<\/p>|$))/m.exec(html)) !== null) {
           const level = Math.min(match[1].length, 6);
           const replacement = `<h${level}>${match[2]}</h${level}>${match[3]}`;
           html = html.replace(match[0], replacement);
        }

        editorRef.current.innerHTML = html;

        if (caretOffset !== null && selection) {
          const target = Math.max(0, caretOffset - (beforeLen - plainLen(html)));
          const walker = document.createTreeWalker(editorRef.current, NodeFilter.SHOW_TEXT);
          let pos = 0, node: Node | null, placed = false;
          while ((node = walker.nextNode())) {
            const len = (node as Text).length;
            if (target <= pos + len) {
              const r = document.createRange();
              r.setStart(node, target - pos);
              r.collapse(true);
              selection.removeAllRanges();
              selection.addRange(r);
              placed = true;
              break;
            }
            pos += len;
          }
          if (!placed) {
            const r = document.createRange();
            r.selectNodeContents(editorRef.current);
            r.collapse(false);
            selection.removeAllRanges();
            selection.addRange(r);
          }
        }
      }

      onChange(mediaCanonicalHtml(editorRef.current.innerHTML));
      paintTagHighlights();
      paintTaskHighlights();
    }
  }, [onChange]);

  // Read a File as raw base64 (no data: prefix) for the media import IPC.
  const readBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const res = String(r.result);
        const comma = res.indexOf(',');
        resolve(comma >= 0 ? res.slice(comma + 1) : res);
      };
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const readDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const insertHtmlAtCaret = (html: string) => {
    const inserted = document.execCommand('insertHTML', false, html);
    if (inserted) return;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (editorRef.current?.contains(range.commonAncestorContainer)) {
        const el = document.createElement('div');
        el.innerHTML = html;
        const frag = document.createDocumentFragment();
        let node: ChildNode | null, lastNode: ChildNode | null = null;
        while ((node = el.firstChild)) lastNode = frag.appendChild(node);
        range.insertNode(frag);
        if (lastNode) {
          range.setStartAfter(lastNode);
          range.setEndAfter(lastNode);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      } else {
        editorRef.current?.insertAdjacentHTML('beforeend', html);
      }
    } else {
      editorRef.current?.insertAdjacentHTML('beforeend', html);
    }
  };

  // Store a dropped/pasted file by reference: copied into the workspace's
  // .attachments/ (Electron) so the note holds a path, not a base64 blob. In
  // the browser (or before a folder is chosen) it falls back to a data: URL.
  const insertMedia = (file: File) => { void insertFile(file); };
  async function insertFile(file: File) {
    if (!file) return;
    const kind =
      file.type.startsWith('image/') ? 'image'
      : file.type.startsWith('audio/') ? 'audio'
      : file.type.startsWith('video/') ? 'video'
      : 'file';

    editorRef.current?.focus();

    let src: string | null = null;
    const api = (window as any).electronAPI;
    if (api?.importMedia) {
      try {
        const dataBase64 = await readBase64(file);
        src = await api.importMedia({ name: file.name, dataBase64, root: (window as any).__valxRoot });
      } catch { /* fall through to embedding */ }
    }
    if (!src) src = await readDataUrl(file).catch(() => null);
    if (!src) return;

    // The DOM holds the display form; onChange canonicalizes it back.
    insertHtmlAtCaret(buildMediaHtml(kind, mediaDisplaySrc(src), file.name));
    handleInput();
  }

  // --- '/' menu items + execution (needs insertHtmlAtCaret/insertFile above) ---
  const slashItems: SlashItem[] = useMemo(() => {
    if (!slashPos) return [];
    const q = slashQuery.toLowerCase();
    const media: SlashMediaItem[] = [
      ...(clipFile && 'clipboard image'.includes(q)
        ? [{ type: 'media' as const, id: 'clipboard', name: 'Clipboard image', kind: 'image' as const, thumb: clipThumb, badge: clipFile.type.split('/')[1] || 'img' }]
        : []),
      ...slashMedia
        .filter((m) => m.name.toLowerCase().includes(q))
        .map((m) => ({
          type: 'media' as const,
          id: m.name,
          name: m.name,
          kind: m.kind,
          thumb: m.kind === 'image' && m.src ? mediaDisplaySrc(m.src) : null,
          badge: m.name.split('.').pop() || '',
        })),
    ];
    return [...SLASH_SYNTAX.filter((s) => s.label.toLowerCase().includes(q)), ...media];
  }, [slashPos, slashQuery, slashMedia, clipFile, clipThumb]);

  const runSlashItem = (index: number) => {
    const item = slashItems[index];
    if (!item) { closeSlash(); return; }
    // Select the '/query' text and delete it; the command lands at the caret.
    const a = slashAnchorRef.current;
    const sel = window.getSelection();
    if (a && a.node.isConnected && sel) {
      const r = document.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(a.node, Math.min(sel.focusNode === a.node ? sel.focusOffset : a.offset + 1, a.node.length));
      sel.removeAllRanges();
      sel.addRange(r);
      document.execCommand('delete');
    }
    closeSlash();
    editorRef.current?.focus();
    if (item.type === 'syntax') {
      if (item.id[0] === 'h') document.execCommand('formatBlock', false, item.id);
      else if (item.id === 'bullet') document.execCommand('insertText', false, '- ');
      else if (item.id === 'numbered') document.execCommand('insertText', false, '1. ');
      else if (item.id === 'checked') insertHtmlAtCaret('<input type="checkbox">&nbsp;');
      else if (item.id === 'quote') document.execCommand('formatBlock', false, 'blockquote');
      else if (item.id === 'code') document.execCommand('formatBlock', false, 'pre');
      else if (item.id === 'icode') insertHtmlAtCaret('<code>&nbsp;</code>');
      else if (item.id === 'bold') document.execCommand('bold');
      else if (item.id === 'italic') document.execCommand('italic');
      else if (item.id === 'strike') document.execCommand('strikeThrough');
      else if (item.id === 'hr') insertHtmlAtCaret('<hr>');
      else if (item.id === 'table') {
        // insertTable (via the event listener above) already calls handleInput.
        window.dispatchEvent(new CustomEvent('valx-insert-table', { detail: { rows: 3, cols: 3 } }));
        return;
      }
      handleInput();
      return;
    }
    void (async () => {
      if (item.id === 'clipboard' && clipFile) {
        await insertFile(clipFile); // durable import path, same as paste/drop
        return;
      }
      const entry = slashMedia.find((m) => m.name === item.id);
      let src = entry?.src ?? null;
      if (!src && entry?.read) src = await entry.read().catch(() => null);
      if (!src) return;
      insertHtmlAtCaret(buildMediaHtml(item.kind, mediaDisplaySrc(src), item.name));
      handleInput();
    })();
  };

  // Open an attachment in the OS default app instead of navigating the editor
  // away to it. Catches both the styled chip and a plain link to workspace
  // media (a chip degrades to a plain link after a Markdown round-trip).
  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!e.ctrlKey && !e.metaKey) clearMultiSelection();
    // Task checkbox: the native click already flipped `.checked` by the time
    // this handler runs — mirror it onto the `checked` attribute (innerHTML
    // only serializes attributes) so the toggle is saved and the strikethrough
    // in paintTaskHighlights (driven by handleInput below) picks it up.
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      target.toggleAttribute('checked', target.checked);
      handleInput();
      return;
    }
    // Refresh the media remove button for whatever was clicked (clears it when
    // clicking plain text/away from media).
    if (target.closest('img, audio, video, a.vx-attach')) showMediaTool(target);
    else hideMediaTool();
    const anchor = target.closest('a') as HTMLAnchorElement | null;
    if (!anchor) return;
    // The DOM may hold the display (asset-protocol) form of a media href;
    // canonicalize before classifying so attachments never leak to the
    // external-link path below.
    const href = mediaCanonicalHtml(anchor.getAttribute('href') || '');
    e.preventDefault();
    const api = (window as any).electronAPI;
    // Attachments open in the OS default app (chips degrade to plain links
    // after a markdown round-trip, hence the /__media/ check).
    if (anchor.classList.contains('vx-attach') || href.startsWith('/__media/')) {
      if (api?.openMedia) api.openMedia(href);
      else window.open(href, '_blank');
      return;
    }
    // External links go to the browser; anything else is a note link (both
    // hand-typed markdown links and World Mode Link-Lasso links) — App resolves
    // the href to a note and opens it.
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      if (api?.openExternal) api.openExternal(href);
      else window.open(href, '_blank');
      return;
    }
    if (!onOpenNoteLink?.(href)) window.open(href, '_blank');
  };

  // --- Tables (Obsidian-style: real table in the editor, pipe table on disk) ---
  const insertTable = (rows: number, cols: number) => {
    if (!editorRef.current || disabled) return;
    editorRef.current.focus();
    insertHtmlAtCaret(buildTableHtml(rows, cols));
    handleInput();
  };

  // Toolbar (Editor.tsx) asks for a table via a window event so insertion stays
  // in the element that owns the caret.
  useEffect(() => {
    const onInsertTable = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      insertTable(Number(detail.rows), Number(detail.cols));
    };
    window.addEventListener('valx-insert-table', onInsertTable);
    return () => window.removeEventListener('valx-insert-table', onInsertTable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleInput, disabled]);

  // Toolbar (Editor.tsx) formatting buttons — same window-event bridge as tables.
  useEffect(() => {
    const onFormat = (e: Event) => {
      if (disabled) return;
      const cmd = (e as CustomEvent).detail as string;
      editorRef.current?.focus();
      if (cmd === 'checkbox') { insertHtmlAtCaret('<input type="checkbox">&nbsp;'); handleInput(); return; }
      if (!applyToMultiRanges(() => document.execCommand(cmd, false))) document.execCommand(cmd, false);
      handleInput();
    };
    window.addEventListener('valx-format', onFormat);
    return () => window.removeEventListener('valx-format', onFormat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleInput, disabled]);

  // Floating table controls (add/remove row & column, delete table) shown when
  // the caret is inside a table — the reliable way to delete a table that
  // contentEditable otherwise makes very hard to remove.
  const [tableTools, setTableTools] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    const onSel = () => {
      const cell = getCellFromSelection(editorRef.current);
      if (!cell) { setTableTools(null); return; }
      const table = cell.closest('table') as HTMLElement;
      setTableTools({ top: Math.max(0, table.offsetTop - 34), left: table.offsetLeft });
      // Caret moved into a table — drop any lingering media remove button.
      hideMediaTool();
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  const withCell = (fn: (cell: HTMLElement) => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    const cell = getCellFromSelection(editorRef.current);
    if (cell) fn(cell);
  };

  // Floating "remove" button for a clicked media element. Audio/video capture
  // clicks for play/pause and can't be selected+deleted in contentEditable, so
  // without this an imported clip is impossible to remove. Images and file
  // chips get the same affordance for consistency.
  const activeMediaRef = useRef<HTMLElement | null>(null);
  const [mediaTool, setMediaTool] = useState<{ top: number; left: number } | null>(null);
  // SHOW-only: point the remove button at a media element. Driven by hover
  // (mouseover), because a native <audio> is entirely UA-shadow controls that
  // swallow click/mousedown — hover events are the only ones that reliably
  // reach the editor for an audio clip. No-op if we're already on this element.
  const showMediaTool = (target: HTMLElement | null) => {
    const el = target?.closest('img, audio, video, a.vx-attach') as HTMLElement | null;
    if (!el || !editorRef.current?.contains(el)) return;
    if (activeMediaRef.current === el) return;
    activeMediaRef.current = el;
    // Float just above the top-right corner so it never covers a native
    // <audio>/<video> control (volume, kebab menu, scrubber).
    setMediaTool({ top: Math.max(0, el.offsetTop - 30), left: Math.max(0, el.offsetLeft + el.offsetWidth - 30) });
  };
  const hideMediaTool = () => {
    if (!activeMediaRef.current && mediaTool === null) return;
    activeMediaRef.current = null;
    setMediaTool(null);
  };
  const deleteMedia = () => {
    const el = activeMediaRef.current;
    if (!el) return;
    // Drop one adjacent <br> so removing media doesn't leave a blank gap.
    const next = el.nextSibling, prev = el.previousSibling;
    if (next && next.nodeName === 'BR') next.remove();
    else if (prev && prev.nodeName === 'BR') prev.remove();
    el.remove();
    activeMediaRef.current = null;
    setMediaTool(null);
    handleInput();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files) as File[];
      const textFiles = files.filter(f => f.type === 'text/plain' || f.name.endsWith('.md') || f.name.endsWith('.txt'));
      const mediaFiles = files.filter(f => !textFiles.includes(f));
      
      if (textFiles.length > 0 && onTextFileDrop) {
          onTextFileDrop(textFiles); // all of them — Editor.tsx merges/creates from the full drop
      }

      mediaFiles.forEach(insertMedia);
    }
  };

  // Auto-capitalize: when enabled (Settings → on by default), upper-case the
  // first letter typed at the start of the note or after a sentence ending
  // (". "/"! "/"? "). Runs before the character lands so undo history and the
  // caret stay natural (execCommand-based insert).
  const maybeAutoCapitalize = (e: React.KeyboardEvent): boolean => {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (localStorage.getItem('valx-autocap') === 'false') return false;
    const key = e.key;
    // Only cased letters that are currently lowercase (covers accented Latin
    // and other bicameral scripts; skips digits, punctuation, already-caps).
    const isLowercaseLetter = key.length === 1 && key !== key.toUpperCase() && key === key.toLowerCase();
    if (!isLowercaseLetter) return false;

    const editor = editorRef.current;
    const sel = window.getSelection();
    if (!editor || !sel || sel.rangeCount === 0) return false;

    const range = sel.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return false;

    const pre = range.cloneRange();
    pre.selectNodeContents(editor);
    pre.setEnd(range.startContainer, range.startOffset);
    const before = pre.toString();

    let capitalize = false;
    if (!/\S/.test(before)) {
      capitalize = true; // start of the note (nothing but whitespace before)
    } else if (/\s$/.test(before)) {
      const last = before.replace(/\s+$/, '').slice(-1);
      capitalize = last === '.' || last === '!' || last === '?';
    }
    if (!capitalize) return false;

    e.preventDefault();
    document.execCommand('insertText', false, key.toUpperCase());
    return true;
  };

  // Capitalize the standalone pronoun "i" -> "I" once the word is closed by a
  // boundary key (space, apostrophe for "I'm"/"I'll", punctuation, Enter). The
  // "i" is already in the document; we select it and re-insert so undo history
  // and the caret stay natural, then let the boundary char type normally.
  const maybeCapitalizeI = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (localStorage.getItem('valx-autocap') === 'false') return;
    const isBoundary = e.key === 'Enter' || (e.key.length === 1 && !/[a-zA-Z0-9]/.test(e.key));
    if (!isBoundary) return;

    const editor = editorRef.current;
    const sel = window.getSelection() as (Selection & { modify?: (a: string, b: string, c: string) => void }) | null;
    if (!editor || !sel || sel.rangeCount === 0 || !sel.modify) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed || !editor.contains(range.startContainer)) return;

    const pre = range.cloneRange();
    pre.selectNodeContents(editor);
    pre.setEnd(range.startContainer, range.startOffset);
    if (!/(^|\s)i$/.test(pre.toString())) return; // only a lone "i", not "hi"

    // Select the "i" just before the caret and re-insert as "I"; restore the
    // caret if the extend grabbed something unexpected.
    sel.modify('extend', 'backward', 'character');
    if (sel.toString() === 'i') document.execCommand('insertText', false, 'I');
    else sel.collapseToEnd();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Any keyboard activity dismisses the media remove button.
    hideMediaTool();
    // '/' menu owns navigation keys while open.
    if (slashPos) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = slashItems.length || 1;
        setSlashSel((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); runSlashItem(slashSel); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeSlash(); return; }
    }
    // Ctrl multi-selection: Delete/Backspace removes every highlighted range;
    // Escape or plain typing drops the highlights (formatting shortcuts below
    // consume them via applyToMultiRanges).
    if (multiRangesRef.current.length > 0) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        for (const r of multiRangesRef.current) r.deleteContents();
        clearMultiSelection();
        handleInput();
        return;
      }
      if (e.key === 'Escape') { clearMultiSelection(); return; }
      if (!e.ctrlKey && !e.metaKey && e.key.length === 1) clearMultiSelection();
    }
    // Insert a table: Ctrl/Cmd+Shift+T (Obsidian-style keybind).
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      insertTable(3, 3);
      return;
    }
    // Table-aware keys.
    const cell = getCellFromSelection(editorRef.current);
    if (cell) {
      // Tab moves between cells (and grows a new row past the last cell).
      if (e.key === 'Tab') {
        e.preventDefault();
        tableMoveCell(cell, e.shiftKey, handleInput);
        return;
      }
      // Backspace/Delete on an already-empty table removes the whole thing —
      // otherwise an inserted table is nearly impossible to get rid of.
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const table = cell.closest('table') as HTMLTableElement | null;
        if (table && isTableEmpty(table)) {
          e.preventDefault();
          deleteTable(table, editorRef.current, handleInput);
          return;
        }
      }
    }
    if (maybeAutoCapitalize(e)) return;
    maybeCapitalizeI(e);
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      if (!applyToMultiRanges(() => document.execCommand('strikeThrough', false))) document.execCommand('strikeThrough', false);
      else handleInput();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      if (!applyToMultiRanges(() => document.execCommand('bold', false))) document.execCommand('bold', false);
      else handleInput();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
      e.preventDefault();
      if (!applyToMultiRanges(() => document.execCommand('italic', false))) document.execCommand('italic', false);
      else handleInput();
      return;
    }

    if (e.key === 'Enter') {
      // Real block-syntax tags (headings from '#', quotes from '/quote') should
      // continue their own tag on Enter (format survives) and drop out to a
      // plain line on Shift+Enter (format breaks) — list markers below are
      // plain text prefixes and already follow this split on their own.
      const structTag = 'h1,h2,h3,h4,h5,h6,blockquote';
      const structEl = ((): HTMLElement | null => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const node = sel.focusNode;
        const el = (node?.nodeType === Node.TEXT_NODE ? node.parentElement : node) as HTMLElement | null;
        return (el?.closest(structTag) as HTMLElement | null) ?? null;
      })();
      if (structEl) {
        e.preventDefault();
        const sel = window.getSelection()!;
        const caret = sel.getRangeAt(0);
        const split = document.createRange();
        split.setStart(caret.startContainer, caret.startOffset);
        split.setEndAfter(structEl); // partial extract clones structEl's tag around the tail only
        // A collapsed caret at the very end of structEl gives extractContents()
        // nothing to grab (firstChild is null) — build an empty tail ourselves
        // so there's always a next line to land the caret in.
        const tailNode = (split.extractContents().firstChild as HTMLElement | null)
          ?? document.createElement(structEl.tagName);
        if (e.shiftKey) {
          // Break away from formatting: unwrap the tail into a plain div.
          const div = document.createElement('div');
          while (tailNode.firstChild) div.appendChild(tailNode.firstChild);
          // extractContents() can leave a zero-length text-node artifact as the
          // only child, which still passes a `!firstChild` check — test actual
          // content instead so the placeholder always lands when needed.
          if (!div.textContent) { div.textContent = ''; div.appendChild(document.createTextNode('​')); }
          structEl.after(div);
          if (!structEl.textContent) structEl.remove();
          const target = div.firstChild!;
          const off = target.nodeType === Node.TEXT_NODE && target.textContent === '​' ? 1 : 0;
          sel.setBaseAndExtent(target, off, target, off);
        } else {
          // Keep formatting: continue the same tag on the next line.
          if (!tailNode.textContent) { tailNode.textContent = ''; tailNode.appendChild(document.createTextNode('​')); }
          structEl.after(tailNode);
          if (!structEl.textContent) structEl.remove();
          const anchor = tailNode.firstChild!;
          const off = anchor.textContent === '​' ? 1 : 0;
          sel.setBaseAndExtent(anchor, off, anchor, off);
        }
        handleInput();
        return;
      }
      // Shift+Enter: soft line break within the current block (headings, lists, etc.).
      // execCommand('insertLineBreak') is unreliable about where it leaves the caret
      // (sometimes before the <br> it just inserted) — insert the <br> ourselves via
      // Range APIs and place the caret explicitly, same idiom as the slop-mark split below.
      if (e.shiftKey) {
        e.preventDefault();
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const br = document.createElement('br');
          range.insertNode(br);
          // insertNode on a range collapsed at the end of a text node splits off an
          // empty trailing text node — drop it, it confuses the next insertText.
          if (br.nextSibling && br.nextSibling.nodeType === Node.TEXT_NODE && !br.nextSibling.textContent) {
            br.nextSibling.remove();
          }
          // A collapsed Range whose container is an element (or an empty text
          // node) has no layout box — getClientRects() is empty — so Chromium's
          // native caret doesn't visibly move even though selection state did,
          // making shift+Enter look like it needs a second press to "take". A
          // real text node always has a box, so anchor there: reuse the text
          // that already follows the <br>, or — if nothing follows (a lone
          // trailing <br> also doesn't render as an extra visual line) — add a
          // zero-width space to anchor on and to keep the new line visible.
          const caretRange = document.createRange();
          if (br.nextSibling && br.nextSibling.nodeType === Node.TEXT_NODE) {
            caretRange.setStart(br.nextSibling, 0);
          } else {
            const zwsp = document.createTextNode('​');
            br.after(zwsp);
            caretRange.setStart(zwsp, 1);
          }
          caretRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(caretRange);
        }
        handleInput();
        return;
      }
      // Inside a slop mark the native break lands INSIDE the <mark> (Chromium
      // normalizes any between-marks caret back into it), trapping every
      // following line in the mark. Split the mark at the caret and insert the
      // newline between the halves ourselves (the editor is white-space:
      // pre-wrap, so '\n' IS the native line-break representation).
      const slopMark = slopMarkAtCaret();
      if (slopMark) {
        e.preventDefault();
        const sel = window.getSelection()!;
        const caret = sel.getRangeAt(0);
        const split = document.createRange();
        split.setStart(caret.startContainer, caret.startOffset);
        split.setEndAfter(slopMark);
        const tail = split.extractContents().firstChild as HTMLElement | null; // partial extract clones the mark
        const hasTail = !!tail?.textContent;
        // Trailing break with nothing after it needs a second \n to render a line (same placeholder Chromium inserts natively).
        const nl = document.createTextNode(hasTail || slopMark.nextSibling ? '\n' : '\n\n');
        slopMark.after(nl);
        if (hasTail) nl.after(tail!);
        if (!slopMark.textContent) slopMark.remove();
        if (hasTail) sel.setBaseAndExtent(tail!.firstChild!, 0, tail!.firstChild!, 0);
        else sel.setBaseAndExtent(nl, 1, nl, 1);
        handleInput();
        return;
      }
      const selection = window.getSelection();
      if (!selection || !selection.focusNode) return;
      
      let node = selection.focusNode;
      let textBeforeCursor = '';
      
      if (node.nodeType === Node.TEXT_NODE) {
          textBeforeCursor = (node.textContent || '').slice(0, selection.focusOffset);
      } else {
          const child = node.childNodes[selection.focusOffset - 1];
          if (child) {
              textBeforeCursor = child.textContent || '';
          }
      }
      
      const lines = textBeforeCursor.split(/[\r\n]+/);
      const currentLine = lines[lines.length - 1];
      
      // Match list markers: +, -, >, or numbers like 1.
      // Use \s* or &nbsp; representation
      const match = currentLine.replace(/\u00A0/g, ' ').match(/^\s*(\+|-|>|\d+\.)\s+(.*)$/);
      
      // Shift+Enter escapes list-continuation and falls through to the native <br>.
      if (match && !e.shiftKey) {
         if (!match[2].trim()) {
             // Empty list item, end the list
             e.preventDefault();
             document.execCommand('delete'); // delete space
             for(let i=0; i<match[1].length; i++) document.execCommand('delete');
             document.execCommand('insertHTML', false, '<br><br>');
             return;
         }
         
         const symbol = match[1];
         let nextSymbol = symbol;
         if (/^\d+\.$/.test(symbol)) {
             nextSymbol = `${parseInt(symbol) + 1}.`;
         }
         e.preventDefault();
         // Use &nbsp; so the space isn't swallowed by HTML parsing
         document.execCommand('insertHTML', false, `<br>${nextSymbol}&nbsp;`);
         return;
      }
      
      // Default: allow normal Enter key behavior for line breaks
      // Don't prevent default - let the browser handle it naturally
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (disabled) return;
    
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      Array.from(e.clipboardData.files).forEach(insertMedia);
      return;
    }

    // Slop detector: text from outside the editor is inserted with per-word
    // provenance marks. Text last copied INSIDE the editor pastes natively
    // (keeps its formatting, no marks).
    const text = e.clipboardData.getData('text/plain');
    if (!text || text === lastInternalCopyRef.current) return;
    e.preventDefault();
    suppressUnwrapRef.current = true;
    try { insertHtmlAtCaret(slopWrapText(text, 'paste')); }
    finally { suppressUnwrapRef.current = false; }
    // insertHTML can leave the caret INSIDE the last mark — hop it out so the
    // unwrap-on-edit pass in handleInput doesn't strip the final word.
    const sel = window.getSelection();
    const anchor = sel?.anchorNode;
    const el = anchor ? (anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement) : null;
    const mark = el?.closest('mark.vx-slop');
    if (mark && sel) {
      const r = document.createRange();
      r.setStartAfter(mark);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    handleInput();
  };

  const toolBtn = 'flex items-center gap-1 px-1.5 py-1 rounded hover:bg-slate-100 dark:hover:bg-neutral-800 text-slate-600 dark:text-slate-300 transition-colors';

  return (
    <div className="relative" onMouseLeave={hideMediaTool}>
      <div
        ref={editorRef}
        contentEditable={!disabled}
        onInput={handleInput}
        onDrop={handleDrop}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onClick={handleClick}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
        onCopy={handleCopy}
        onCut={handleCopy}
        // Hover shows the media remove button. mouseover is the only pointer
        // event that reliably reaches the editor from a native <audio>'s
        // UA-shadow controls (they swallow click/mousedown), so this is what
        // makes the remove button appear for audio, not just video/images.
        onMouseOver={(e) => showMediaTool(e.target as HTMLElement)}
        onDragOver={e => e.preventDefault()}
        data-placeholder={placeholder}
        spellCheck={!disabled}
        className={`rich-editor w-full min-h-[60vh] text-lg text-slate-700 dark:text-slate-300 leading-relaxed border-none outline-none focus:outline-none bg-transparent empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400 dark:empty:before:text-slate-600 break-words ${disabled ? 'opacity-50 pointer-events-none' : ''} ${className}`}
        style={{ whiteSpace: 'pre-wrap' }}
      />
      <div ref={caretRef} aria-hidden className="vx-caret" style={{ display: 'none' }} />

      {slashPos && !disabled && (
        <SlashMenu
          items={slashItems}
          selected={slashSel}
          position={slashPos}
          onPick={runSlashItem}
          onHover={setSlashSel}
        />
      )}

      {tableTools && !disabled && (
        <div
          className="absolute z-30 flex items-center gap-0.5 rounded-lg bg-white dark:bg-neutral-950 border border-slate-200 dark:border-neutral-800 shadow-lg px-1 py-0.5 text-xs"
          style={{ top: tableTools.top, left: tableTools.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button className={toolBtn} title="Add row below" onMouseDown={withCell((c) => addRow(c, true, handleInput))}><Plus size={13} /> Row</button>
          <button className={toolBtn} title="Add column right" onMouseDown={withCell((c) => addColumn(c, true, handleInput))}><Plus size={13} /> Col</button>
          <button className={toolBtn} title="Delete row" onMouseDown={withCell((c) => deleteRow(c, editorRef.current, handleInput))}><Minus size={13} /> Row</button>
          <button className={toolBtn} title="Delete column" onMouseDown={withCell((c) => deleteColumn(c, editorRef.current, handleInput))}><Minus size={13} /> Col</button>
          <div className="w-px h-4 bg-slate-200 dark:bg-neutral-800 mx-0.5" />
          <button
            className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-red-500 transition-colors"
            title="Delete table"
            onMouseDown={withCell((c) => { const t = c.closest('table') as HTMLTableElement | null; if (t) deleteTable(t, editorRef.current, handleInput); })}
          >
            <Trash2 size={13} /> Table
          </button>
        </div>
      )}

      {mediaTool && !disabled && (
        <button
          className="absolute z-30 flex items-center justify-center w-7 h-7 rounded-md bg-white/95 dark:bg-neutral-950/95 border border-slate-200 dark:border-neutral-800 shadow-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
          style={{ top: mediaTool.top, left: mediaTool.left }}
          title="Remove media"
          onMouseDown={(e) => { e.preventDefault(); deleteMedia(); }}
        >
          <Trash2 size={14} />
        </button>
      )}

      {webDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={() => setWebDialog(false)}>
          <div
            className="vx-pop w-80 rounded-xl bg-white dark:bg-neutral-950 border border-slate-200 dark:border-neutral-800 shadow-xl p-4"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">Where is this content from?</h3>
            <input
              autoFocus
              value={webSite}
              onChange={(e) => setWebSite(e.target.value)}
              placeholder="Website name"
              className="w-full mb-2 px-3 py-1.5 rounded-md text-sm bg-transparent border border-slate-200 dark:border-neutral-800 outline-none focus:border-[#32CD32] text-slate-700 dark:text-slate-200"
            />
            <input
              value={webUrl}
              onChange={(e) => setWebUrl(e.target.value)}
              placeholder="Link (optional)"
              className="w-full mb-3 px-3 py-1.5 rounded-md text-sm bg-transparent border border-slate-200 dark:border-neutral-800 outline-none focus:border-[#32CD32] text-slate-700 dark:text-slate-200"
            />
            <div className="flex justify-end gap-2 text-sm">
              <button className="px-3 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-neutral-800 text-slate-500 dark:text-slate-400" onClick={() => setWebDialog(false)}>Cancel</button>
              <button
                className="px-3 py-1.5 rounded-md bg-[#32CD32]/15 text-[#1f9e1f] dark:text-[#32CD32] hover:bg-[#32CD32]/25 disabled:opacity-40"
                disabled={!webSite.trim()}
                onClick={() => { setWebDialog(false); markSelectionAs('web', { site: webSite.trim(), url: webUrl.trim() || undefined }); }}
              >
                Mark
              </button>
            </div>
          </div>
        </div>
      )}

      {searchHitRect && (
        <div
          className="vx-search-hit absolute z-20 pointer-events-none rounded"
          style={{
            top: searchHitRect.top - 2,
            left: searchHitRect.left - 2,
            width: searchHitRect.width + 4,
            height: searchHitRect.height + 4,
          }}
        />
      )}
    </div>
  );
}
