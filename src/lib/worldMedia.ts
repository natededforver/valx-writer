// World Mode media import — mirrors the same import path RichTextEditor uses
// (electronAPI.importMedia copies into .attachments/ and returns a durable
// /__media/… app URL; the browser-preview / web fallback embeds base64
// directly since there's no filesystem to copy into there).

import { mediaDisplaySrc } from './desktop';

export type MediaKind = 'image' | 'audio' | 'video' | 'file';

export const kindFromMime = (mime: string): MediaKind =>
  mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : 'file';

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

/** Natural pixel size of an image file, read via a throwaway <img>; resolves 0x0 for non-images or load failures. */
export const probeImageSize = (src: string, kind: MediaKind): Promise<{ width: number; height: number }> =>
  new Promise((resolve) => {
    if (kind !== 'image') { resolve({ width: 0, height: 0 }); return; }
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });

export interface ImportedMedia {
  src: string;
  kind: MediaKind;
  name: string;
  naturalWidth: number;
  naturalHeight: number;
}

/** Persists a dropped OS file into the workspace (Electron) or as a base64 data URL (web fallback), and probes its natural size if it's an image. */
export async function importDroppedFile(file: File): Promise<ImportedMedia> {
  const kind = kindFromMime(file.type);
  const api = (window as any).electronAPI;
  let src: string | null = null;
  if (api?.importMedia) {
    try {
      const dataBase64 = await readBase64(file);
      src = await api.importMedia({ name: file.name, dataBase64, root: (window as any).__valxRoot });
    } catch { /* fall through to embedding */ }
  }
  if (!src) src = await readDataUrl(file).catch(() => null);
  if (!src) throw new Error('Failed to read dropped file');
  // The stored src stays canonical; probing needs the resolvable display URL.
  const { width, height } = await probeImageSize(mediaDisplaySrc(src), kind);
  return { src, kind, name: file.name, naturalWidth: width, naturalHeight: height };
}
