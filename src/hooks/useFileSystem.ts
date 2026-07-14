import { useState, useEffect, useCallback } from 'react';
import { get, set } from 'idb-keyval';
import { FileFormat, FILE_FORMATS, ATTACH_DIR, MediaKind, mediaKindFromName } from '../lib/format';

/** One insertable media file from the workspace's .attachments folder.
 *  `src` is the canonical app URL on desktop; on the web there is no durable
 *  URL, so `src` is null and `read()` produces a data: URL on demand. */
export interface AttachmentItem {
  name: string;
  kind: MediaKind;
  src: string | null;
  read?: () => Promise<string>;
}

export interface DiskFile {
  name: string;
  path: string;
  content: string;
  /** last-modified time in ms — the freshness signal for externally edited files */
  mtime?: number;
  /** true when `content` is base64, not text — currently only .docx (Tauri only; the web reader never sets this) */
  binary?: boolean;
}

export function useFileSystem() {
  const [workspaceHandle, setWorkspaceHandle] = useState<any>(null);
  // False until the persisted handle has been restored or found absent —
  // consumers must not scan/merge before that.
  const [isWorkspaceRestored, setIsWorkspaceRestored] = useState(false);
  const [fileFormat, setFileFormatState] = useState<FileFormat>(() => {
    const saved = localStorage.getItem('valx-file-format');
    return FILE_FORMATS.includes(saved as FileFormat) ? (saved as FileFormat) : '.md';
  });
  const setFileFormat = useCallback((format: FileFormat) => {
    setFileFormatState(format);
    localStorage.setItem('valx-file-format', format);
  }, []);

  // Keep the main process pointed at the current workspace root so it can serve
  // and store attached media (/__media + .attachments). Runs on every change,
  // which is more reliable than only setting it inline at select/restore time.
  // `__valxRoot` is also passed with each media import so the copy never falls
  // back to base64 just because the setWorkspaceRoot IPC hadn't landed yet.
  useEffect(() => {
    if (workspaceHandle?.kind === 'electron' && workspaceHandle.path) {
      (window as any).__valxRoot = workspaceHandle.path;
      (window as any).electronAPI?.setWorkspaceRoot?.(workspaceHandle.path);
    }
  }, [workspaceHandle]);

  // Load the persisted workspace handle on startup
  useEffect(() => {
    async function loadPersistedHandle() {
      try {
        if ('electronAPI' in window) {
          const saved = localStorage.getItem('valx-electron-workspace');
          if (saved) {
            const handle = JSON.parse(saved);
            setWorkspaceHandle(handle);
            // Tell main where the workspace is so it can serve attached media.
            (window as any).__valxRoot = handle.path;
            (window as any).electronAPI.setWorkspaceRoot?.(handle.path);
          }
        } else {
          const handle = await get('valx-web-workspace');
          if (handle) {
            const hasPerm = await verifyPermission(handle, true);
            if (hasPerm) {
              setWorkspaceHandle(handle);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load persisted workspace handle', err);
      } finally {
        setIsWorkspaceRestored(true);
      }
    }
    loadPersistedHandle();
  }, []);

  async function verifyPermission(fileHandle: any, readWrite: boolean) {
    const options: any = {};
    if (readWrite) {
      options.mode = 'readwrite';
    }
    if ((await fileHandle.queryPermission(options)) === 'granted') {
      return true;
    }
    if ((await fileHandle.requestPermission(options)) === 'granted') {
      return true;
    }
    return false;
  }

  const selectWorkspace = async () => {
    try {
      // Desktop backend first (Tauri bridge installs window.electronAPI; the
      // 'electron' kind string is a legacy identity key — see CLAUDE.md).
      if ('electronAPI' in window) {
        const path = await (window as any).electronAPI.selectDirectory();
        if (path) {
          const handle = { kind: 'electron', path };
          setWorkspaceHandle(handle);
          localStorage.setItem('valx-electron-workspace', JSON.stringify(handle));
          (window as any).__valxRoot = path;
          (window as any).electronAPI.setWorkspaceRoot?.(path);
          return handle;
        }
        return null;
      }

      // Fallback to Web File System Access API
      if (!('showDirectoryPicker' in window)) {
        console.warn('File System Access API is not supported in this environment.');
        alert('Your current browser does not support the File System Access API. If testing locally, please use Google Chrome or Microsoft Edge — or run the Valx desktop app.');
        return null;
      }
      const handle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
      });
      setWorkspaceHandle(handle);
      await set('valx-web-workspace', handle);
      return handle;
    } catch (err) {
      console.error('User aborted or error:', err);
      return null;
    }
  };

  const sanitize = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');

  const createFolder = async (handle: any, name: string) => {
    try {
      if (handle.kind === 'electron') {
        await (window as any).electronAPI.createFolder(handle.path, name);
        return;
      }
      const parts = name.split('/');
      let current = handle;
      for (const part of parts) {
        current = await current.getDirectoryHandle(sanitize(part), { create: true });
      }
    } catch (err) {
      console.error('Error creating folder', err);
    }
  };

  const deleteFolder = async (handle: any, name: string) => {
    try {
      if (handle.kind === 'electron') {
        await (window as any).electronAPI.deleteFolder(handle.path, name);
        return;
      }
      const parts = name.split('/');
      const last = parts.pop();
      let current = handle;
      for (const part of parts) {
        current = await current.getDirectoryHandle(sanitize(part), { create: false });
      }
      if (last) await current.removeEntry(sanitize(last), { recursive: true });
    } catch (err) {
      console.error('Error deleting folder', err);
    }
  };

  async function readWebDirectory(dirHandle: any): Promise<{ files: DiskFile[]; folders: string[] }> {
    const files: DiskFile[] = [];
    const folders: string[] = [];

    async function readHandle(dh: FileSystemDirectoryHandle, basePath = '') {
      for await (const entry of (dh as any).values()) {
        if (entry.name.startsWith('.')) continue;
        const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
        if (entry.kind === 'directory') {
          folders.push(relativePath);
          await readHandle(entry as FileSystemDirectoryHandle, relativePath);
        } else if (entry.kind === 'file' && /\.(md|markdown|mdown|mkd|txt|text|html|htm|css|js|mjs|cjs|jsx|ts|tsx|py)$/i.test(entry.name)) {
          const file = await entry.getFile();
          const content = await file.text();
          files.push({ name: entry.name, path: basePath, content, mtime: file.lastModified });
        }
      }
    }

    await readHandle(dirHandle);
    return { files, folders };
  }

  // Errors propagate: callers must be able to tell "empty directory" from
  // "read failed" — treating a failed scan as empty would tombstone
  // everything the filemap knows about.
  // Main reports a nonexistent root as `missing` data instead of rejecting the
  // IPC (a rejected invoke logs ENOENT noise in the main process for the
  // routine .trash probe). Re-throw here so callers keep the contract above.
  const readElectronDirectory = async (dirPath: string): Promise<{ files: DiskFile[]; folders: string[] }> => {
    const res = await (window as any).electronAPI.readDirectory(dirPath);
    if (res?.missing) throw new Error(`Directory not found: ${dirPath}`);
    return res;
  };

  const readDirectory = async (handle: any): Promise<{ files: DiskFile[]; folders: string[] }> => {
    if (handle.kind === 'electron') {
      return await readElectronDirectory(handle.path);
    }
    return await readWebDirectory(handle);
  };

  // Reads a direct subdirectory (e.g. '.trash'). Throws if it doesn't exist.
  const readSubDirectory = async (handle: any, sub: string): Promise<{ files: DiskFile[]; folders: string[] }> => {
    if (handle.kind === 'electron') {
      return await readElectronDirectory(`${handle.path}/${sub}`);
    }
    const dirHandle = await handle.getDirectoryHandle(sub, { create: false });
    return await readWebDirectory(dirHandle);
  };

  const saveFile = async (handle: any, path: string[], filename: string, content: string) => {
    if (handle.kind === 'electron') {
      await (window as any).electronAPI.saveFile(handle.path, path, filename, content);
      return;
    }
    let currentHandle = handle;
    for (const dir of path) {
      currentHandle = await currentHandle.getDirectoryHandle(sanitize(dir), { create: true });
    }
    const fileHandle = await currentHandle.getFileHandle(sanitize(filename), { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  };

  // Media the slash menu can insert: everything in <workspace>/.attachments.
  const listAttachments = async (handle: any): Promise<AttachmentItem[]> => {
    if (!handle) return [];
    try {
      if (handle.kind === 'electron') {
        const files = (await (window as any).electronAPI.listAttachments?.(handle.path)) ?? [];
        return files.map((f: { name: string; src: string }) => ({
          name: f.name, kind: mediaKindFromName(f.name), src: f.src,
        }));
      }
      const dir = await handle.getDirectoryHandle(ATTACH_DIR, { create: false });
      const out: AttachmentItem[] = [];
      for await (const entry of (dir as any).values()) {
        if (entry.kind !== 'file' || entry.name.startsWith('.')) continue;
        out.push({
          name: entry.name,
          kind: mediaKindFromName(entry.name),
          src: null,
          // Data URL on demand — the web build has no server for /__media/.
          read: async () => {
            const file = await entry.getFile();
            return await new Promise<string>((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(String(r.result));
              r.onerror = reject;
              r.readAsDataURL(file);
            });
          },
        });
      }
      return out;
    } catch {
      return [];
    }
  };

  const deleteFile = async (handle: any, path: string[], filename: string) => {
    if (handle.kind === 'electron') {
      await (window as any).electronAPI.deleteFile(handle.path, path, filename);
      return;
    }
    let currentHandle = handle;
    for (const dir of path) {
      currentHandle = await currentHandle.getDirectoryHandle(sanitize(dir), { create: false });
    }
    await currentHandle.removeEntry(sanitize(filename));
  };

  return {
    workspaceHandle,
    setWorkspaceHandle,
    isWorkspaceRestored,
    fileFormat,
    setFileFormat,
    selectWorkspace,
    createFolder,
    deleteFolder,
    readDirectory,
    readSubDirectory,
    saveFile,
    deleteFile,
    listAttachments,
  };
}
