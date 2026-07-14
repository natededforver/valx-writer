// ---------------------------------------------------------------------------
// Media URL display/canonical rewrites for the Tauri desktop backend.
//
// Notes always STORE the app-relative form (/__media/.attachments/x.png) — it
// is origin-independent and survives workspace moves. Under Tauri the webview
// cannot serve that path (there is no localhost server anymore), so media is
// rewritten to the asset-protocol URL (convertFileSrc) at DISPLAY time, and
// rewritten back to the canonical form on the way out (editor onChange).
//
// Pure string logic, `convert` injected, so this is testable without Tauri.
// In the browser (no root) every function is an identity.
//
// Round-trip contract (guards the editor's value===innerHTML sync): for any
// URL produced by displayMediaHtml, canonicalMediaHtml followed by
// displayMediaHtml must reproduce it byte-for-byte.
// ---------------------------------------------------------------------------
import { MEDIA_URL_PREFIX } from './format';

export type ConvertSrc = (absPath: string) => string;

const normRoot = (root: string) => root.replace(/\\/g, '/').replace(/\/+$/, '');

/** One canonical src (/__media/…) -> displayable asset URL. */
export function displayMediaSrc(src: string, root: string | null, convert: ConvertSrc): string {
  if (!root || !src || !src.startsWith(MEDIA_URL_PREFIX)) return src;
  return convert(`${normRoot(root)}/${src.slice(MEDIA_URL_PREFIX.length)}`);
}

/** Every /__media/… occurrence in an HTML string -> asset URL. */
export function displayMediaHtml(html: string, root: string | null, convert: ConvertSrc): string {
  if (!root || !html) return html;
  return html.replace(/\/__media\/([^"')\s]+)/g, (_m, rel) => convert(`${normRoot(root)}/${rel}`));
}

// convertFileSrc yields http(s)://asset.localhost/<encoded path> on
// Windows/Android and asset://localhost/<encoded path> elsewhere. Invert by
// decoding the path and stripping the workspace root (case-insensitively:
// Windows paths). URLs outside the workspace are left untouched.
const ASSET_URL_RE = /(?:https?:\/\/asset\.localhost|asset:\/\/localhost)\/([^"')\s]+)/g;

export function canonicalMediaHtml(html: string, root: string | null): string {
  if (!root || !html) return html;
  const rootN = normRoot(root).toLowerCase();
  return html.replace(ASSET_URL_RE, (m, enc) => {
    let p: string;
    try {
      p = decodeURIComponent(enc);
    } catch {
      return m;
    }
    p = p.replace(/\\/g, '/');
    if (!p.toLowerCase().startsWith(`${rootN}/`)) return m;
    return `${MEDIA_URL_PREFIX}${p.slice(rootN.length + 1)}`;
  });
}
