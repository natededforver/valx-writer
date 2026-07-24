import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Note, Folder } from '../types';
import { useFileSystem } from './useFileSystem';
import {
  sanitizeSegment,
  sanitizePath,
  splitExt,
  fileKeyFromDisk,
  FOLDER_TOMB_PREFIX,
  SyncNote,
  SyncFolder,
  TombstoneMap,
} from '../lib/sync';
import { htmlToMarkdown, contentFromDisk, formatKind, rewriteMediaToDisk, folderDepth, FileFormat } from '../lib/format';
import { toggleBookmark as toggleBookmarkId, pruneBookmarks } from '../lib/bookmarks';
import { dropHistory } from '../lib/history';
import mammoth from 'mammoth';
import { generateDocx } from '../lib/exportDocs.js';
import { inlineMediaAsDataUrls } from '../lib/desktop';

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

// .docx is a binary zip package (unlike md/txt/html): reading needs mammoth's
// async decode instead of contentFromDisk's sync text transforms. Only ever
// hit on desktop — the web File System Access reader never marks a file
// `binary`, so this stays a no-op there. Falls back to an empty note body on
// a corrupt/unreadable package rather than failing the whole workspace scan.
async function decodeDiskContent(fileName: string, raw: string, binary?: boolean): Promise<string> {
  if (!binary) return contentFromDisk(fileName, raw);
  try {
    const { value } = await mammoth.convertToHtml({ arrayBuffer: base64ToArrayBuffer(raw) });
    return value;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Identity model
// - A note's id is opaque and permanent. New notes mint a random id; ids
//   inherited from older versions of the app (timestamp or path-style) are
//   kept as-is so existing cloud docs, metadata and tombstones keep matching.
// - The filemap (per workspace) records which disk file each note owns:
//   id -> { key (extension-less folded fileKey), dir, file }. It is what keeps
//   ids stable across restarts — the old code re-derived ids from paths on
//   every launch, which is what duplicated notes against the cloud.
// - Trashed notes live under .trash/ (invisible to directory scans), so a
//   rescan or another device can never resurrect them as active notes.
// ---------------------------------------------------------------------------

interface FilemapEntry { key: string; dir: string; file: string }
type Filemap = Record<string, FilemapEntry>;
type TrashMap = Record<string, string>; // fileName in .trash -> note id
interface NoteMeta { updatedAt: number; createdAt?: number; isTrash: boolean; align?: 'left' | 'center' | 'right' }
type MetaMap = Record<string, NoteMeta>;

const META_KEY = 'valx-notes-metadata';
const TOMB_KEY = 'valx-deleted-notes';
const TRASH_DIR = '.trash';
const EXTERNAL_EDIT_EPSILON_MS = 5000;
const WELCOME_PURGED_KEY = 'valx-welcome-purged';
const WELCOME_TITLE_RE = /^\s*welcome to valx( writer| prose writer)?\s*!?\s*$/i;

const readJson = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
};
const writeJson = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);

const parseTags = (title: string, content: string): string[] => {
  const plain = (content || '').replace(/<[^>]*>?/gm, ' ');
  const matches = `${title} ${plain}`.match(/(^|[\s​])#[\w-]+/g);
  return matches ? Array.from(new Set(matches.map((t) => t.replace(/^[\s​]*#/, '').toLowerCase()))) : [];
};

export const workspaceId = (handle: any): string =>
  handle?.kind === 'electron' ? `el:${handle.path}` : `web:${handle?.name ?? 'default'}`;

export function useNotes() {
  const [notes, setNotes] = useState<SyncNote[]>([]);
  const [folders, setFolders] = useState<SyncFolder[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [bookmarkedIds, setBookmarkedIds] = useState<string[]>([]);
  const {
    workspaceHandle, isWorkspaceRestored, fileFormat, setFileFormat, selectWorkspace,
    createFolder: fsCreateFolder, deleteFolder: fsDeleteFolder,
    saveFile: fsSaveFile, deleteFile: fsDeleteFile,
    readDirectory, readSubDirectory, listAttachments: fsListAttachments,
  } = useFileSystem();

  // Refs mirror live state for async readers (merge runs across awaits).
  const notesRef = useRef(notes); notesRef.current = notes;
  const foldersRef = useRef(folders); foldersRef.current = folders;
  const workspaceRef = useRef(workspaceHandle); workspaceRef.current = workspaceHandle;
  const fileFormatRef = useRef(fileFormat); fileFormatRef.current = fileFormat;
  const isLoadedRef = useRef(false);

  const wsKey = () => workspaceId(workspaceRef.current);
  const loadFilemap = (): Filemap => readJson(`valx-notes-filemap:${wsKey()}`, {});
  const saveFilemap = (m: Filemap) => writeJson(`valx-notes-filemap:${wsKey()}`, m);
  const loadTrashMap = (): TrashMap => readJson(`valx-trash-map:${wsKey()}`, {});
  const saveTrashMap = (m: TrashMap) => writeJson(`valx-trash-map:${wsKey()}`, m);
  const loadMeta = (): MetaMap => readJson(META_KEY, {});
  const saveMeta = (m: MetaMap) => writeJson(META_KEY, m);
  const loadTombs = (): TombstoneMap => readJson(TOMB_KEY, {});
  const saveTombs = (t: TombstoneMap) => writeJson(TOMB_KEY, t);
  const loadBookmarks = (): string[] => readJson(`valx-bookmarks:${wsKey()}`, []);
  const saveBookmarks = (ids: string[]) => writeJson(`valx-bookmarks:${wsKey()}`, ids);

  const rememberMeta = (n: Note) => {
    const meta = loadMeta();
    meta[n.id] = { updatedAt: n.updatedAt, createdAt: n.createdAt, isTrash: n.isTrash, align: n.align };
    saveMeta(meta);
  };

  // Every disk mutation below does a read-modify-write of the filemap around
  // async fs calls. Left concurrent (updateNote fires on every keystroke), two
  // runs read the same filemap, each renames from a stale `prev`, and one of
  // the intermediate files is orphaned on disk — reappearing as a duplicate
  // note on the next scan. Chaining them so each sees the prior write's filemap
  // is what makes a title edit overwrite its own file instead of duplicating.
  const diskChain = useRef<Promise<unknown>>(Promise.resolve());
  const serializeDisk = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const next = diskChain.current.then(fn, fn);
    diskChain.current = next.catch(() => {});
    return next;
  }, []);

  // -------------------------------------------------------------------------
  // Disk file operations, all filemap-aware.
  // -------------------------------------------------------------------------

  // Serialize a note for the extension its file uses (per-note formats are
  // allowed), then rewrite in-app media URLs to disk-relative paths so the file
  // references its `.attachments/…` media instead of embedding base64.
  const contentForDisk = async (note: Note, ext: string, depth: number): Promise<string> => {
    const kind = formatKind(ext);
    if (kind === 'docx') {
      // A docx package embeds real image bytes, like an export — not the
      // lightweight .attachments/ path reference the other formats store.
      const html = await inlineMediaAsDataUrls(note.content);
      return bytesToBase64(await generateDocx(note.title || 'Untitled', html));
    }
    let out: string;
    if (kind === 'md') out = htmlToMarkdown(note.content);
    else if (kind === 'txt') {
      const stash: string[] = [];
      let temp = note.content.replace(/<mark class="vx-slop[^"]*"[^>]*>[\s\S]*?<\/mark>/gi, (m) => {
        stash.push(m);
        return `@@VXSLOP${stash.length - 1}@@`;
      });
      temp = temp
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>?/gm, '')
        .replace(/&nbsp;/g, ' ');
      out = temp.replace(/@@VXSLOP(\d+)@@/g, (_, i) => stash[Number(i)]);
    } else out = note.content;
    return rewriteMediaToDisk(out, depth);
  };

  // Picks a collision-free base name for a note in dir, honoring an existing claim.
  const assignFileName = (filemap: Filemap, id: string, dir: string, wantedBase: string): string => {
    const taken = new Set(
      Object.entries(filemap)
        .filter(([otherId]) => otherId !== id)
        .map(([, e]) => e.key)
    );
    let base = wantedBase;
    for (let i = 2; taken.has(fileKeyFromDisk(dir, base)); i++) base = `${wantedBase} (${i})`;
    return base;
  };

  // formatOverride forces a new extension (used by the format converter);
  // otherwise a note keeps whatever extension its file already has, defaulting
  // to the workspace format for notes not yet written to disk.
  const saveNoteFile = (note: Note, foldersState: SyncFolder[], formatOverride?: string) =>
    serializeDisk(async () => {
      const handle = workspaceRef.current;
      if (!handle) return;
      const filemap = loadFilemap();
      const folder = note.folderId ? foldersState.find((f) => f.id === note.folderId) : null;
      const dir = folder ? sanitizePath(folder.name) : '';
      const wantedBase = sanitizeSegment(note.title || 'Untitled');
      const prev = filemap[note.id];
      let base: string;
      if (prev && splitExt(prev.file).base.replace(/ \(\d+\)$/, '') === wantedBase && prev.dir === dir) {
        base = splitExt(prev.file).base; // unchanged slot: keep any collision suffix stable
      } else {
        base = assignFileName(filemap, note.id, dir, wantedBase);
      }
      const ext = formatOverride || (prev ? splitExt(prev.file).ext : '') || fileFormatRef.current;
      const file = `${base}${ext}`;
      if (prev && (prev.dir !== dir || prev.file !== file)) {
        await fsDeleteFile(handle, prev.dir.split('/').filter(Boolean), prev.file).catch(() => {});
      }
      await fsSaveFile(handle, dir.split('/').filter(Boolean), file, await contentForDisk(note, ext, folderDepth(dir)));
      filemap[note.id] = { key: fileKeyFromDisk(dir, file), dir, file };
      saveFilemap(filemap);
    });

  const uniqueTrashName = (trashMap: TrashMap, base: string, ext: string, id: string): string => {
    const suffix = sanitizeSegment(id).replace(/_/g, '').slice(-12) || 'x';
    let name = `${base}__${suffix}${ext}`;
    for (let i = 2; name in trashMap; i++) name = `${base}__${suffix}-${i}${ext}`;
    return name;
  };

  const trashNoteFile = (note: Note) =>
    serializeDisk(async () => {
      const handle = workspaceRef.current;
      if (!handle) return;
      const filemap = loadFilemap();
      const entry = filemap[note.id];
      const trashMap = loadTrashMap();
      const base = entry ? splitExt(entry.file).base : sanitizeSegment(note.title || 'Untitled');
      const ext = entry ? splitExt(entry.file).ext || fileFormatRef.current : fileFormatRef.current;
      const trashName = uniqueTrashName(trashMap, base, ext, note.id);
      // .trash sits one folder deep, so media paths get a single `../` prefix.
      await fsSaveFile(handle, [TRASH_DIR], trashName, await contentForDisk(note, ext, 1));
      if (entry) {
        await fsDeleteFile(handle, entry.dir.split('/').filter(Boolean), entry.file).catch(() => {});
        delete filemap[note.id];
        saveFilemap(filemap);
      }
      trashMap[trashName] = note.id;
      saveTrashMap(trashMap);
    });

  // Inner (unserialized) so permDeleteFiles can reuse it while already holding
  // the disk chain — re-entering serializeDisk from within it would deadlock.
  const removeTrashFileInner = async (id: string) => {
    const handle = workspaceRef.current;
    if (!handle) return;
    const trashMap = loadTrashMap();
    const name = Object.keys(trashMap).find((k) => trashMap[k] === id);
    if (name) {
      await fsDeleteFile(handle, [TRASH_DIR], name).catch(() => {});
      delete trashMap[name];
      saveTrashMap(trashMap);
    }
  };
  const removeTrashFile = (id: string) => serializeDisk(() => removeTrashFileInner(id));

  const permDeleteFiles = (note: Note) =>
    serializeDisk(async () => {
      const handle = workspaceRef.current;
      if (!handle) return;
      const filemap = loadFilemap();
      const entry = filemap[note.id];
      if (entry) {
        await fsDeleteFile(handle, entry.dir.split('/').filter(Boolean), entry.file).catch(() => {});
        delete filemap[note.id];
        saveFilemap(filemap);
      }
      await removeTrashFileInner(note.id);
    });

  // Title edits fire on every keystroke; debounce the disk write so the rename
  // happens once the title settles instead of once per character. Trash / move
  // / delete cancel any pending save first so it can't recreate a stale file.
  const diskTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const cancelDiskSave = (id: string) => {
    const t = diskTimers.current.get(id);
    if (t) { clearTimeout(t); diskTimers.current.delete(id); }
  };
  const queueDiskSave = (note: Note) => {
    const timers = diskTimers.current;
    const existing = timers.get(note.id);
    if (existing) clearTimeout(existing);
    timers.set(note.id, setTimeout(() => {
      timers.delete(note.id);
      const latest = notesRef.current.find((n) => n.id === note.id);
      if (latest && !latest.isTrash) saveNoteFile(latest, foldersRef.current).catch(console.error);
    }, 700));
  };
  const flushDiskSaves = () => {
    for (const [id, timer] of diskTimers.current) {
      clearTimeout(timer);
      const latest = notesRef.current.find((n) => n.id === id);
      if (latest && !latest.isTrash) saveNoteFile(latest, foldersRef.current).catch(console.error);
    }
    diskTimers.current.clear();
  };

  // -------------------------------------------------------------------------
  // Persist any pending debounced title rename before the window goes away.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const flush = () => flushDiskSaves();
    const onHidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Workspace load: derive notes from disk, preserving ids via the filemap
  // (seeded from the legacy `${path}/${name}` scheme on first run so existing
  // users keep their cloud identities). Never a wholesale state replace:
  // cloud-adopted notes with no disk backing survive.
  // -------------------------------------------------------------------------

  // `replace` = the user switched from one real workspace to another: state is
  // rebuilt from the new directory alone. Merging with prev is only for
  // adopting in-app notes when a first workspace is chosen (or a rescan).
  const loadWorkspaceContents = async (handle: any, replace = false) => {
    const { files, folders: fsFolders } = await readDirectory(handle);
    const trashFiles = await readSubDirectory(handle, TRASH_DIR).catch(() => ({ files: [] as any[] }));

    const filemap = loadFilemap();
    const trashMap = loadTrashMap();
    const meta = loadMeta();
    const tombs = loadTombs();
    const now = Date.now();

    const byExact = new Map<string, string>();
    const byKey = new Map<string, string>();
    for (const [id, e] of Object.entries(filemap)) {
      byExact.set(`${e.dir}|${e.file}`, id);
      if (!byKey.has(e.key)) byKey.set(e.key, id);
    }

    // Group directory files by extension-less key to resolve siblings left by
    // format switches; then build exactly one note per key.
    const groups = new Map<string, any[]>();
    for (const f of files) {
      const key = fileKeyFromDisk(f.path, f.name);
      const arr = groups.get(key) ?? [];
      arr.push(f);
      groups.set(key, arr);
    }

    const diskNotes: SyncNote[] = [];
    const seenIds = new Set<string>();
    const extraTrashNotes: SyncNote[] = [];

    for (const [key, group] of groups) {
      let preferred = group[0];
      if (group.length > 1) {
        const claimedId = byKey.get(key);
        const claimed = claimedId && filemap[claimedId];
        preferred =
          (claimed && group.find((f) => f.path === claimed.dir && f.name === claimed.file)) ||
          [...group].sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))[0];
      }
      const legacyId = `${preferred.path}/${preferred.name}`;
      const id =
        byExact.get(`${preferred.path}|${preferred.name}`) ??
        byKey.get(key) ??
        (meta[legacyId] ? legacyId : newId());
      seenIds.add(id);

      const m = meta[id];
      const mtime: number | undefined = preferred.mtime;
      let updatedAt: number;
      if (m) updatedAt = mtime && mtime > m.updatedAt + EXTERNAL_EDIT_EPSILON_MS ? mtime : m.updatedAt;
      else updatedAt = mtime ?? now;

      // Birth time is the honest "date created", but a file copied or synced
      // into the workspace gets a fresh one — so a createdAt we already
      // recorded wins over whatever the filesystem reports today.
      const createdAt = m?.createdAt ?? preferred.btime ?? updatedAt;

      const htmlContent = await decodeDiskContent(preferred.name, preferred.content, preferred.binary);
      const note: SyncNote = {
        id,
        title: splitExt(preferred.name).base,
        content: htmlContent,
        tags: parseTags(splitExt(preferred.name).base, htmlContent),
        updatedAt,
        createdAt,
        isTrash: m?.isTrash || false,
        folderId: preferred.path ? preferred.path : null,
        fileKey: key,
        align: m?.align,
      };
      filemap[id] = { key, dir: preferred.path, file: preferred.name };
      diskNotes.push(note);

      // Sibling files for the same key: identical content is stale residue
      // from a format switch — remove it; divergent content is preserved.
      for (const other of group) {
        if (other === preferred) continue;
        const same = other.content.replace(/\s+/g, ' ').trim() === preferred.content.replace(/\s+/g, ' ').trim();
        const segs = other.path.split('/').filter(Boolean);
        if (same) {
          await fsDeleteFile(handle, segs, other.name).catch(() => {});
        } else {
          const sibId = newId();
          const { base, ext } = splitExt(other.name);
          const trashName = uniqueTrashName(trashMap, base, ext || fileFormatRef.current, sibId);
          await fsSaveFile(handle, [TRASH_DIR], trashName, other.content).catch(() => {});
          await fsDeleteFile(handle, segs, other.name).catch(() => {});
          trashMap[trashName] = sibId;
          const sibHtml = await decodeDiskContent(other.name, other.content, other.binary);
          extraTrashNotes.push({
            id: sibId, title: base, content: sibHtml,
            tags: parseTags(base, sibHtml),
            updatedAt: other.mtime ?? now, createdAt: other.btime ?? other.mtime ?? now,
            isTrash: true, folderId: null,
          });
        }
      }
    }

    // Persist the maps built so far: the trash migration below re-reads them.
    saveFilemap(filemap);
    saveTrashMap(trashMap);

    // Pre-rework trashed notes still sit in the normal tree with only local
    // metadata marking them: migrate their files into .trash now.
    for (const n of diskNotes) {
      if (n.isTrash) {
        await trashNoteFile(n).catch(() => {});
        n.folderId = null;
      }
    }
    const activeDiskNotes = diskNotes.filter((n) => !n.isTrash);
    const migratedTrash = diskNotes.filter((n) => n.isTrash);

    // trashNoteFile persisted its own map changes — pick them back up.
    const filemapNow = loadFilemap();
    const trashMapNow = loadTrashMap();

    // Notes in .trash/
    const trashNotes: SyncNote[] = [];
    for (const f of trashFiles.files ?? []) {
      if (f.path) continue; // only the top level of .trash
      const id = trashMapNow[f.name] ?? newId();
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      trashMapNow[f.name] = id;
      const { base } = splitExt(f.name);
      const title = base.replace(/__[^_]{1,14}(-\d+)?$/, '');
      const m = meta[id];
      const trashHtml = contentFromDisk(f.name, f.content);
      trashNotes.push({
        id, title, content: trashHtml,
        tags: parseTags(title, trashHtml),
        updatedAt: m?.updatedAt ?? f.mtime ?? now,
        createdAt: m?.createdAt ?? f.btime ?? f.mtime ?? now,
        isTrash: true, folderId: null,
        align: m?.align,
      });
    }

    // Files deleted outside the app: their filemap claim is gone from disk.
    // Tombstone them so the deletion propagates instead of resurrecting.
    for (const id of Object.keys(filemapNow)) {
      if (!seenIds.has(id)) {
        tombs[id] = now;
        delete filemapNow[id];
      }
    }

    saveFilemap(filemapNow);
    saveTrashMap(trashMapNow);
    saveTombs(tombs);

    const diskFolderSet: SyncFolder[] = fsFolders
      .filter((p: string) => !p.split('/').some((s: string) => s.startsWith('.')))
      .map((p: string) => ({ id: p, name: p }));

    setFolders((prev) => {
      if (replace) return diskFolderSet;
      const merged = new Map<string, SyncFolder>();
      for (const f of diskFolderSet) merged.set(f.id, f);
      for (const f of prev) if (!merged.has(f.id) && !(tombs[FOLDER_TOMB_PREFIX + f.id] > 0)) merged.set(f.id, f);
      return [...merged.values()];
    });

    setNotes((prev) => {
      const next = [...activeDiskNotes, ...migratedTrash, ...trashNotes, ...extraTrashNotes];
      if (replace) return next;
      const claimed = new Set(next.map((n) => n.id));
      for (const p of prev) {
        if (claimed.has(p.id)) continue;
        if ((tombs[p.id] ?? -1) > p.updatedAt) continue;
        if (filemap[p.id]) continue; // was disk-backed; absence handled above
        next.push(p); // cloud-adopted / unsaved notes survive a rescan
      }
      return next;
    });
  };

  // Key of the workspace whose contents were last loaded — lets the effect
  // below tell "first workspace / rescan" (merge) from "switched directories"
  // (replace).
  const loadedWsRef = useRef<string | null>(null);

  useEffect(() => {
    // Wait until the persisted workspace handle has been restored (or found
    // absent) before loading disk contents.
    if (!isWorkspaceRestored) return;
    let cancelled = false;
    if (workspaceHandle) {
      const key = workspaceId(workspaceHandle);
      const replace = loadedWsRef.current !== null && loadedWsRef.current !== key;
      loadedWsRef.current = key;
      if (replace) {
        // Debounced title renames aimed at the old workspace must not fire
        // into the new one (their save reads workspaceRef at run time).
        for (const t of diskTimers.current.values()) clearTimeout(t);
        diskTimers.current.clear();
      }
      loadWorkspaceContents(workspaceHandle, replace)
        .catch((e) => console.error('Failed to load workspace contents', e))
        .finally(() => {
          if (!cancelled) {
            setIsLoaded(true);
            isLoadedRef.current = true;
            purgeLegacyWelcome(true);
          }
        });
    } else {
      setIsLoaded(true);
      isLoadedRef.current = true;
      purgeLegacyWelcome(true);
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceHandle, isWorkspaceRestored]);

  // (Cloud sync removed: Valx is local-first. To sync, keep your workspace in a
  // folder your OS already mirrors to a cloud service — Google Drive, OneDrive,
  // Dropbox, Mega — and that service handles it.)

  // Persist per-note metadata (updatedAt / isTrash survive restarts; pruned to
  // live ids so the map cannot grow without bound).
  useEffect(() => {
    if (!isLoaded) return;
    const meta = loadMeta();
    const live = new Set(notes.map((n) => n.id));
    for (const n of notes) meta[n.id] = { updatedAt: n.updatedAt, createdAt: n.createdAt, isTrash: n.isTrash, align: n.align };
    for (const key of Object.keys(meta)) if (!live.has(key)) delete meta[key];
    saveMeta(meta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, isLoaded]);

  // Bookmarks: workspace-scoped id list, loaded whenever the workspace changes.
  useEffect(() => {
    setBookmarkedIds(loadBookmarks());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceHandle]);

  // Prune bookmark ids that no longer correspond to a live note (deleted
  // permanently, or from a workspace rescan that dropped them).
  useEffect(() => {
    if (!isLoaded) return;
    setBookmarkedIds((prev) => {
      const live = new Set(notes.map((n) => n.id));
      const pruned = pruneBookmarks(prev, live);
      if (pruned.length === prev.length) return prev;
      saveBookmarks(pruned);
      return pruned;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, isLoaded]);

  const toggleBookmark = useCallback((id: string) => {
    setBookmarkedIds((prev) => {
      const next = toggleBookmarkId(prev, id);
      saveBookmarks(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  const addFolder = (name: string) => {
    const canonical = sanitizePath(name);
    const existing = foldersRef.current.find((f) => f.id === canonical);
    if (existing) return existing;
    const newFolder: SyncFolder = { id: canonical, name: canonical };
    setFolders((prev) => [...prev, newFolder]);
    if (workspaceRef.current) fsCreateFolder(workspaceRef.current, canonical);

    const tombs = loadTombs();
    if (tombs[FOLDER_TOMB_PREFIX + canonical]) {
      delete tombs[FOLDER_TOMB_PREFIX + canonical];
      saveTombs(tombs);
    }
    return newFolder;
  };

  // Rename a folder on disk: every direct member note's file moves to the new
  // directory (saveNoteFile's normal rename path), then the old directory is
  // removed. Refuses the cases that could corrupt files instead of guessing:
  // a collision with an existing folder (silent merge) or nested subfolders
  // (their paths embed the old name and would be orphaned).
  const renameFolder = (oldId: string, newName: string): { ok: true; id: string } | { ok: false; reason: string } => {
    const canonical = sanitizePath(newName);
    if (!canonical) return { ok: false, reason: 'empty name' };
    if (canonical === oldId) return { ok: true, id: oldId };
    const existing = foldersRef.current.find((f) => f.id === oldId);
    if (!existing) return { ok: false, reason: 'folder no longer exists' };
    if (foldersRef.current.some((f) => f.id === canonical))
      return { ok: false, reason: `a folder named "${canonical}" already exists` };
    if (foldersRef.current.some((f) => f.id.startsWith(`${oldId}/`)))
      return { ok: false, reason: 'folder contains subfolders — rename it in your file manager' };

    addFolder(canonical);
    const memberIds = notesRef.current.filter((n) => !n.isTrash && n.folderId === oldId).map((n) => n.id);
    if (memberIds.length > 0) moveNotesToFolder(memberIds, canonical);
    setFolders((prev) => prev.filter((f) => f.id !== oldId));
    const tombs = loadTombs();
    tombs[FOLDER_TOMB_PREFIX + oldId] = Date.now();
    saveTombs(tombs);
    // File moves above are queued through serializeDisk; chain the directory
    // removal behind them so the old dir is only deleted once it's empty.
    if (workspaceRef.current) {
      const handle = workspaceRef.current;
      serializeDisk(() => fsDeleteFolder(handle, existing.name).catch(() => {}));
    }
    return { ok: true, id: canonical };
  };

  const deleteFolder = (id: string) => {
    const doomed = foldersRef.current.filter((f) => f.id === id || f.id.startsWith(`${id}/`));
    if (doomed.length === 0) return;
    const doomedIds = new Set(doomed.map((f) => f.id));
    const now = Date.now();

    const affected = notesRef.current.filter((n) => n.folderId && doomedIds.has(n.folderId));
    setNotes((prev) =>
      prev.map((n) => (n.folderId && doomedIds.has(n.folderId) ? { ...n, isTrash: true, folderId: null, updatedAt: now } : n))
    );
    setFolders((prev) => prev.filter((f) => !doomedIds.has(f.id)));

    const tombs = loadTombs();
    for (const fid of doomedIds) tombs[FOLDER_TOMB_PREFIX + fid] = now;
    saveTombs(tombs);

    (async () => {
      // Preserve note contents in .trash before the directory is removed.
      for (const n of affected) {
        const trashed = { ...n, isTrash: true, folderId: null, updatedAt: now };
        await trashNoteFile(trashed).catch(() => {});
        rememberMeta(trashed);
      }
      if (workspaceRef.current) {
        const root = doomed.find((f) => f.id === id) ?? { name: id };
        await fsDeleteFolder(workspaceRef.current, root.name).catch(() => {});
      }
    })();
  };

  const createNote = (title: string, content: string, folderId?: string | null): SyncNote => {
    const now = Date.now();
    const note: SyncNote = {
      id: newId(),
      title,
      content,
      tags: parseTags(title, content),
      updatedAt: now,
      createdAt: now,
      isTrash: false,
      folderId: folderId || null,
    };
    setNotes((prev) => [note, ...prev]);
    saveNoteFile(note, foldersRef.current).catch(console.error);
    rememberMeta(note);
    return note;
  };

  const addNote = (folderId?: string | null) => createNote('', '', folderId);
  const addNoteWithContent = (title: string, content: string, folderId?: string | null) =>
    createNote(title, content, folderId);

  const updateNote = (id: string, updates: Partial<Note>) => {
    setNotes((prev) =>
      prev.map((n) => {
        if (n.id !== id) return n;
        const updated: SyncNote = { ...n, ...updates, updatedAt: Date.now() };
        if (updates.content !== undefined || updates.title !== undefined) {
          updated.tags = parseTags(updated.title, updated.content);
        }
        if (updated.isTrash) {
          // restoring is handled by restoreFromTrash; a trashed note's file stays in .trash
          cancelDiskSave(id);
          removeTrashFile(id).then(() => trashNoteFile(updated)).catch(() => {});
        } else if (updates.title !== undefined) {
          // Title changed: debounce so the file is renamed once, not per keystroke.
          queueDiskSave(updated);
        } else {
          // Content-only edit: overwrite the existing file immediately.
          cancelDiskSave(id);
          saveNoteFile(updated, foldersRef.current).catch(console.error);
        }
        rememberMeta(updated);
        return updated;
      })
    );
  };

  const moveNotesToFolder = (ids: string[], folderId: string | null) => {
    const now = Date.now();
    setNotes((prev) =>
      prev.map((n) => {
        if (!ids.includes(n.id)) return n;
        const updated: SyncNote = { ...n, folderId, updatedAt: now };
        cancelDiskSave(n.id);
        saveNoteFile(updated, foldersRef.current).catch(console.error);
        rememberMeta(updated);
        return updated;
      })
    );
  };

  const moveNotesToTrash = (ids: string[]) => {
    const now = Date.now();
    setNotes((prev) =>
      prev.map((n) => {
        if (!ids.includes(n.id)) return n;
        const updated: SyncNote = { ...n, isTrash: true, updatedAt: now };
        cancelDiskSave(n.id);
        trashNoteFile(updated).catch(console.error);
        rememberMeta(updated);
        return updated;
      })
    );
  };

  const moveToTrash = (id: string) => moveNotesToTrash([id]);

  const restoreFromTrash = (id: string) => {
    setNotes((prev) =>
      prev.map((n) => {
        if (n.id !== id) return n;
        const updated: SyncNote = { ...n, isTrash: false, updatedAt: Date.now() };
        cancelDiskSave(id);
        (async () => {
          await removeTrashFile(id);
          await saveNoteFile(updated, foldersRef.current);
        })().catch(console.error);
        rememberMeta(updated);
        return updated;
      })
    );
  };

  const deleteNotePerm = (id: string) => {
    const target = notesRef.current.find((n) => n.id === id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
    const now = Date.now();
    const tombs = loadTombs();
    tombs[id] = now;
    saveTombs(tombs);
    cancelDiskSave(id);
    if (target) permDeleteFiles(target).catch(console.error);
    dropHistory(id).catch(() => {});
  };

  // ---------------------------------------------------------------------------
  // Legacy cleanup: old builds seeded a "Welcome to Valx" starter note that can
  // still live on in workspace files, metadata or cloud docs even though no
  // seeding code remains. Purge it everywhere once — the flag keeps notes the
  // user deliberately titles that way afterwards safe.
  // ---------------------------------------------------------------------------
  const purgeLegacyWelcome = useCallback((markDone: boolean) => {
    if (localStorage.getItem(WELCOME_PURGED_KEY) === 'true') return;
    const doomed = notesRef.current.filter((n) => WELCOME_TITLE_RE.test(n.title || ''));
    for (const n of doomed) deleteNotePerm(n.id);
    if (doomed.length > 0 || markDone) localStorage.setItem(WELCOME_PURGED_KEY, 'true');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Media migration: pull any inline base64 (data:) media out of a note into
  // real files under .attachments/ and replace it with a path reference — so a
  // note's .md/.html file stays small and readable in other apps (Obsidian
  // style). New drops already go through importMedia; this rescues notes that
  // already hold base64 (older files, web-mode notes, HTML-pasted images).
  // -------------------------------------------------------------------------
  const MIME_EXT: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/avif': 'avif',
    'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'application/pdf': 'pdf',
  };
  const mimeToExt = (mime: string): string =>
    MIME_EXT[mime.toLowerCase()] || (mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '') || 'bin';

  const importDataUrls = async (html: string): Promise<string> => {
    const api = (window as any).electronAPI;
    if (!api?.importMedia || !html.includes('base64,')) return html;
    const re = /data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)/g;
    const seen = new Map<string, string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const full = m[0];
      if (seen.has(full)) continue;
      const url = await api.importMedia({ name: `media-${Math.random().toString(36).slice(2, 8)}.${mimeToExt(m[1])}`, dataBase64: m[2], root: (window as any).__valxRoot });
      if (url) seen.set(full, url);
    }
    let out = html;
    for (const [full, url] of seen) out = out.split(full).join(url);
    return out;
  };

  const migratingRef = useRef(false);
  const migrateInlineMedia = useCallback(async () => {
    const api = (window as any).electronAPI;
    if (!api?.importMedia || migratingRef.current) return;
    migratingRef.current = true;
    try {
      const targets = notesRef.current.filter((n) => !n.isTrash && n.content.includes('base64,'));
      for (const n of targets) {
        const newContent = await importDataUrls(n.content);
        if (newContent === n.content) continue;
        setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, content: newContent } : x)));
        await saveNoteFile({ ...n, content: newContent }, foldersRef.current).catch(console.error);
      }
    } finally {
      migratingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After a workspace loads, sweep existing notes for inline base64 and convert
  // it to attachment files (one-time per note; skipped once none remain).
  useEffect(() => {
    if (!isLoaded || !workspaceHandle) return;
    void migrateInlineMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, workspaceHandle]);

  // Ctrl+S: flush this note to disk and cloud immediately, bypassing debounces.
  const saveNoteNow = useCallback((id: string): Promise<void> => {
    const latest = notesRef.current.find((n) => n.id === id);
    if (!latest || latest.isTrash) return Promise.resolve();
    cancelDiskSave(id);
    return saveNoteFile(latest, foldersRef.current).then(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Format converter: set the new default and rewrite every active note's file.
  // saveNoteFile deletes the previous file when its name (extension) changes,
  // so this converts the workspace in place.
  const convertWorkspaceFormat = useCallback(async (format: FileFormat): Promise<number> => {
    setFileFormat(format);
    fileFormatRef.current = format; // effective before the rewrites below
    if (!workspaceRef.current) return 0;
    const active = notesRef.current.filter((n) => !n.isTrash);
    for (const n of active) {
      cancelDiskSave(n.id);
      await saveNoteFile(n, foldersRef.current, format).catch(console.error);
    }
    // The filemap changed on disk; nudge state so extension badges re-derive.
    setNotes((prev) => [...prev]);
    return active.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Convert a single note's on-disk format (badge and file extension) without
  // touching the rest of the workspace. Rewrites the file under the new
  // extension and deletes the old one (saveNoteFile handles the rename).
  const convertNoteFormat = useCallback(async (id: string, format: FileFormat): Promise<boolean> => {
    const note = notesRef.current.find((n) => n.id === id && !n.isTrash);
    if (!note || !workspaceRef.current) return false;
    cancelDiskSave(id);
    await saveNoteFile(note, foldersRef.current, format).catch(console.error);
    setNotes((prev) => [...prev]); // re-derive the extension badge
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Actual on-disk extension per note (falls back to the workspace default for
  // notes that haven't been written yet, e.g. cloud-only notes).
  const noteExtensions = useMemo(() => {
    const filemap = loadFilemap();
    const map: Record<string, string> = {};
    for (const n of notes) {
      const entry = filemap[n.id];
      map[n.id] = entry ? splitExt(entry.file).ext || fileFormat : fileFormat;
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, fileFormat, workspaceHandle]);

  // Tags are derived from `notes` (file-backed) only.
  // Canvas text nodes (WorldDoc) are a separate state atom managed by
  // useWorlds and intentionally excluded here — they are not note files.
  const tags = useMemo(() => {
    const allTags = new Set<string>();
    notes.forEach((n) => {
      if (!n.isTrash) n.tags.forEach((t) => allTags.add(t));
    });
    return Array.from(allTags).sort();
  }, [notes]);

  // Slash-menu media: attachments of the CURRENT workspace (ref, not state —
  // callable from leaf components without re-threading on workspace switches).
  const listAttachments = useCallback(() => fsListAttachments(workspaceRef.current), []);

  // Re-reads the workspace directory and merges any new/changed files into
  // state — used after a OneDrive pull writes files behind the app's back.
  const rescanWorkspace = useCallback(() => {
    if (!workspaceRef.current) return Promise.resolve();
    return loadWorkspaceContents(workspaceRef.current, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    notes, folders, addNote, addNoteWithContent, updateNote, moveToTrash,
    restoreFromTrash, deleteNotePerm, tags, addFolder, deleteFolder, renameFolder,
    moveNotesToFolder, moveNotesToTrash, workspaceHandle, isWorkspaceRestored,
    selectWorkspace, fileFormat, setFileFormat,
    saveNoteNow, convertWorkspaceFormat, convertNoteFormat, noteExtensions,
    bookmarkedIds, toggleBookmark, listAttachments, serializeDisk, rescanWorkspace,
  };
}
