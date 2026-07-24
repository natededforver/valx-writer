// ---------------------------------------------------------------------------
// Tauri desktop bridge. Installs a window.electronAPI-compatible object over
// the Tauri plugins, so every existing call site (useFileSystem, media import,
// share, exports, format converter) keeps working unchanged — the 'electron'
// handle kind now simply means "desktop backend". In the plain browser this
// module is inert and the Web File System Access fallbacks take over.
//
// Deliberately NOT provided (Electron/Chromium-only): the spellcheck APIs.
// SettingsModal already degrades when those are absent; the OS webview's
// native context menu (which carries spelling suggestions on Windows) takes
// over. "Mark as" rides alongside it instead of replacing it — see
// onNativeMarkAs below and src-tauri/src/native_mark_as.rs.
// ---------------------------------------------------------------------------
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { exists, mkdir, readDir, remove, writeFile, writeTextFile, readFile } from '@tauri-apps/plugin-fs';
import { openPath, openUrl } from '@tauri-apps/plugin-opener';
import { writeText as clipboardWriteText, readImage as clipboardReadImage } from '@tauri-apps/plugin-clipboard-manager';
import { ATTACH_DIR, MEDIA_URL_PREFIX } from './format';
import { canonicalMediaHtml, displayMediaHtml, displayMediaSrc } from './mediaUrl';
import { KNOWN_EXT, serializeNote } from './exports';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Current workspace root, mirrored here synchronously so the media display
// rewrites (called during render) never wait on an IPC round trip.
let workspaceRoot: string | null = null;
const currentRoot = (): string | null =>
  workspaceRoot || ((typeof window !== 'undefined' && (window as any).__valxRoot) || null);

const sanitizeName = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
const sanitizeRelPath = (relPath: string) => String(relPath).split('/').filter(Boolean).map(sanitizeName);
const joinPath = (root: string, segs: string[]) => [root.replace(/[\\/]+$/, ''), ...segs].join('/');

// --- media display/canonical helpers (identity outside Tauri) ---------------
export const mediaDisplaySrc = (src: string): string =>
  isTauri ? displayMediaSrc(src, currentRoot(), convertFileSrc) : src;
export const mediaDisplayHtml = (html: string): string =>
  isTauri ? displayMediaHtml(html, currentRoot(), convertFileSrc) : html;
export const mediaCanonicalHtml = (html: string): string =>
  isTauri ? canonicalMediaHtml(html, currentRoot()) : html;
/** Origin prefix buildPreviewDoc needs for /__media/ in the sandboxed preview
 *  (under Tauri the content is pre-rewritten with mediaDisplayHtml instead). */
export const previewMediaBase = (): string => (isTauri ? '' : location.origin);

/** Fires when the user picks a "Mark as" item from the *native* Windows
 *  context menu (native_mark_as.rs). No-op outside Tauri — the JS-drawn
 *  bubble menu is the only path there. Returns an unsubscribe function. */
export function onNativeMarkAs(cb: (kind: string) => void): () => void {
  if (!isTauri) return () => {};
  let unlisten: (() => void) | undefined;
  let cancelled = false;
  listen<string>('mark-as', (e) => cb(e.payload)).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/** Push the ordered "Mark as" menu items (label, kind) to the native Windows
 *  context menu (native_mark_as.rs). No-op outside Tauri. */
export function pushMarkAsItems(items: [string, string][]): void {
  if (!isTauri) return;
  invoke('set_mark_as_items', { items }).catch(() => {});
}

// --- backend implementation --------------------------------------------------

async function setWorkspaceRoot(root: string): Promise<void> {
  workspaceRoot = root ? String(root) : null;
  if (workspaceRoot) await invoke('set_workspace_root', { root: workspaceRoot });
}

async function selectDirectory(): Promise<string | null> {
  const dir = await openDialog({ directory: true });
  if (typeof dir !== 'string' || !dir) return null;
  await setWorkspaceRoot(dir);
  return dir;
}

// Same contract as Electron's fs:readDirectory (see src-tauri/src/lib.rs):
// missing root comes back as data; scan errors reject.
const readDirectory = (root: string) => invoke('read_directory', { root });

async function createFolder(root: string, name: string): Promise<void> {
  await mkdir(joinPath(root, sanitizeRelPath(name)), { recursive: true });
}

async function deleteFolder(root: string, name: string): Promise<void> {
  const p = joinPath(root, sanitizeRelPath(name));
  if (await exists(p)) await remove(p, { recursive: true });
}

async function saveFile(root: string, pathArr: string[], filename: string, content: string): Promise<void> {
  const segs = pathArr.flatMap(sanitizeRelPath);
  const dir = joinPath(root, segs);
  await mkdir(dir, { recursive: true });
  const dest = joinPath(dir, [sanitizeName(filename)]);
  // .docx is a zip package — `content` arrives as base64 (see useNotes.ts's
  // contentForDisk) and must be written as bytes, not text.
  if (filename.toLowerCase().endsWith('.docx')) await writeFile(dest, base64ToBytes(content));
  else await writeTextFile(dest, content);
}

async function deleteFile(root: string, pathArr: string[], filename: string): Promise<void> {
  const p = joinPath(root, [...pathArr.flatMap(sanitizeRelPath), sanitizeName(filename)]);
  // Files never written to disk are a no-op, like the Electron ENOENT swallow.
  if (await exists(p)) await remove(p);
}

// Persist a dropped file into <root>/.attachments and return the canonical
// /__media/… app URL (display rewriting happens at render time).
async function importMedia(payload: { name?: string; dataBase64?: string; root?: string }): Promise<string | null> {
  const root = (payload?.root && String(payload.root)) || currentRoot();
  if (!root || !payload?.dataBase64) return null;
  if (root !== workspaceRoot) await setWorkspaceRoot(root); // keep scope + display rewrites live
  const dir = joinPath(root, [ATTACH_DIR]);
  await mkdir(dir, { recursive: true });
  const safe = (payload.name || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '') || 'file';
  const dot = safe.lastIndexOf('.');
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : '';
  let stamp = Math.random().toString(36).slice(2, 8);
  let fileName = `${base}-${stamp}${ext}`;
  for (let i = 0; i < 5 && (await exists(joinPath(dir, [fileName]))); i++) {
    stamp = Math.random().toString(36).slice(2, 8);
    fileName = `${base}-${stamp}${ext}`;
  }
  const bin = atob(payload.dataBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  await writeFile(joinPath(dir, [fileName]), bytes);
  return `${MEDIA_URL_PREFIX}${ATTACH_DIR}/${fileName}`;
}

// Everything ever imported into the workspace lives flat in .attachments —
// the slash menu lists it as insertable media. Canonical srcs; display
// rewriting happens at render time.
async function listAttachments(root?: string): Promise<{ name: string; src: string }[]> {
  const base = (root && String(root)) || currentRoot();
  if (!base) return [];
  const dir = joinPath(base, [ATTACH_DIR]);
  try {
    if (!(await exists(dir))) return [];
    const entries = await readDir(dir);
    return entries
      .filter((e: any) => e.isFile !== false && !String(e.name).startsWith('.'))
      .map((e: any) => ({ name: String(e.name), src: `${MEDIA_URL_PREFIX}${ATTACH_DIR}/${e.name}` }));
  } catch {
    return [];
  }
}

// Open an attachment in the OS default app. Accepts the canonical app URL, a
// display (asset-protocol) URL, or a disk-relative path; never resolves
// outside the workspace.
async function openMedia(src: string): Promise<{ success: boolean; error?: string }> {
  const root = currentRoot();
  if (!root || !src) return { success: false };
  let rel = canonicalMediaHtml(String(src), root);
  if (rel.startsWith(MEDIA_URL_PREFIX)) rel = rel.slice(MEDIA_URL_PREFIX.length);
  rel = rel.replace(/^(\.\.\/)+/, '');
  if (rel.split('/').includes('..')) return { success: false };
  try {
    await openPath(joinPath(root, rel.split('/').filter(Boolean)));
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

// "Send to others": only exact, known destinations — note content rides in URL
// params through this call. Mirrors the allowlist the Electron main enforced.
const SHARE_HOSTS = new Set([
  'mail.google.com', 'docs.new', 'keep.new', 'substack.com', 'wa.me',
  'twitter.com', 'x.com', 'www.reddit.com', 'reddit.com', 'notion.new',
  'wordpress.com', 'medium.com', 'bsky.app',
]);

async function openExternal(url: string): Promise<{ success: boolean; error?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(String(url));
  } catch {
    return { success: false, error: 'Invalid URL' };
  }
  const allowed =
    parsed.protocol === 'mailto:' ||
    (parsed.protocol === 'https:' && SHARE_HOSTS.has(parsed.hostname));
  if (!allowed) return { success: false, error: 'URL not allowed' };
  await openUrl(parsed.href);
  return { success: true };
}

// --- exports (dialog + serialize + write) ------------------------------------

// ponytail: third ext<->mime table in the codebase (useNotes MIME_EXT,
// exportDocs MIME_EXTENSIONS) — consolidate into format.ts if they drift again.
const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
  ico: 'image/x-icon', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', mp4: 'video/mp4',
  webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', ogv: 'video/ogg', pdf: 'application/pdf',
};

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Exports must be self-contained: resolve path-referenced media back into
// data: URLs from the workspace before serializing. The stored note keeps the
// lightweight path reference; only the exported copy carries the bytes.
// Exported for reuse by .docx saves (useNotes.ts) — a docx package embeds
// real image bytes, same as an export, not a path reference.
export async function inlineMediaAsDataUrls(html: string): Promise<string> {
  const root = currentRoot();
  if (!html || !root) return html;
  const rels = new Set([...html.matchAll(/\/__media\/([^"')\s]+)/g)].map((m) => m[1]));
  let out = html;
  for (const rel of rels) {
    if (rel.split('/').includes('..')) continue;
    try {
      const bytes = await readFile(joinPath(root, rel.split('/').filter(Boolean)));
      const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase();
      const mime = EXT_MIME[ext] || 'application/octet-stream';
      out = out.split(`${MEDIA_URL_PREFIX}${rel}`).join(`data:${mime};base64,${bytesToBase64(bytes)}`);
    } catch {
      /* missing media: leave the reference */
    }
  }
  return out;
}

const writeExport = (path: string, data: Uint8Array | string) =>
  typeof data === 'string' ? writeTextFile(path, data) : writeFile(path, data);

async function exportWithPandoc(htmlContent: string, format: string, defaultTitle: string) {
  const ext = KNOWN_EXT[format] || format;
  const filePath = await saveDialog({
    defaultPath: `${sanitizeName(defaultTitle || 'Note')}.${ext}`,
    filters: [{ name: String(format).toUpperCase(), extensions: [ext] }],
  });
  if (!filePath) return { success: false, canceled: true };
  try {
    const html = await inlineMediaAsDataUrls(htmlContent);
    await writeExport(filePath, await serializeNote(format, defaultTitle, html));
    return { success: true, path: filePath };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

// "Other format": any extension, saved as a portable text copy.
async function exportCustom(htmlContent: string, rawExt: string, defaultTitle: string) {
  const ext = String(rawExt || '').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'txt';
  const filePath = await saveDialog({
    defaultPath: `${sanitizeName(defaultTitle || 'Note')}.${ext}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'All Files', extensions: ['*'] }],
  });
  if (!filePath) return { success: false, canceled: true };
  try {
    const html = await inlineMediaAsDataUrls(htmlContent);
    const fmt = KNOWN_EXT[ext] ? ext : 'md';
    await writeExport(filePath, await serializeNote(fmt, defaultTitle, html));
    return { success: true, path: filePath };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

// Batch export every note into a folder the user picks. notes: [{title, html}].
async function exportBatch(notes: { title?: string; html?: string }[], format: string, rawExt?: string) {
  if (!Array.isArray(notes) || notes.length === 0) return { success: false, error: 'No notes' };
  const dir = await openDialog({ directory: true });
  if (typeof dir !== 'string' || !dir) return { success: false, canceled: true };
  const custom = format === 'custom';
  const ext = custom
    ? (String(rawExt || '').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'txt')
    : (KNOWN_EXT[format] || format);
  const fmt = custom ? (KNOWN_EXT[ext] ? ext : 'md') : format;
  const used = new Set<string>();
  let count = 0;
  try {
    for (const note of notes) {
      const html = await inlineMediaAsDataUrls(note.html || '');
      const base = sanitizeName(note.title || 'Untitled') || 'Untitled';
      let name = `${base}.${ext}`;
      for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} (${i}).${ext}`;
      used.add(name.toLowerCase());
      await writeExport(joinPath(dir, [name]), await serializeNote(fmt, note.title || 'Untitled', html));
      count++;
    }
    return { success: true, count, dir };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err), count };
  }
}

// Raw RGBA -> PNG File via canvas (the clipboard plugin hands back decoded
// pixels, not encoded image bytes) so callers get the same File shape a file
// picker would produce.
async function clipboardReadImageFile(): Promise<File | null> {
  try {
    const img = await clipboardReadImage();
    const { width, height } = await img.size();
    const rgba = await img.rgba();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? new File([blob], 'clipboard.png', { type: 'image/png' }) : null;
  } catch {
    return null; // nothing image-shaped on the clipboard
  }
}

// --- install ------------------------------------------------------------------

/** Under Tauri, expose the desktop backend at window.electronAPI (the name the
 *  whole renderer already checks for). No-op in the browser. */
export function installDesktopBridge(): void {
  if (!isTauri || (window as any).electronAPI) return;
  (window as any).electronAPI = {
    selectDirectory,
    readDirectory,
    createFolder,
    deleteFolder,
    saveFile,
    deleteFile,
    exportWithPandoc,
    exportCustom,
    exportBatch,
    setWorkspaceRoot,
    importMedia,
    openMedia,
    openExternal,
    listAttachments,
    clipboardWriteText,
    clipboardReadImageFile,
  };
}
