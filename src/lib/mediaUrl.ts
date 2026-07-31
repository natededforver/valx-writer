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
//
// Both forms are kept free of any character that can END a URL in the places
// they land — an HTML attribute (`"` `'`) and a markdown link destination
// (`)`, whitespace). See encodeDelims below for what happens when they aren't.
// ---------------------------------------------------------------------------
import { MEDIA_URL_PREFIX } from './format';

export type ConvertSrc = (absPath: string) => string;

const normRoot = (root: string) => root.replace(/\\/g, '/').replace(/\/+$/, '');

// convertFileSrc builds its URL with encodeURIComponent, which by design leaves
// `!'()*~` unescaped. Two of those terminate a URL where these end up: `'`
// closes an HTML attribute, `)` closes a markdown link destination. So a
// workspace folder named `Backup (writing)` produced display URLs that
// canonicalMediaHtml matched only half of — the note then kept the absolute
// asset URL, the .md writer handed it to a first-`)`-wins parser, and every
// attachment in that workspace was truncated on the next load and stayed
// truncated (the broken form re-serializes to the same bytes, so it never
// self-corrects). Percent-encoding them here is what stops that at the source.
const DELIMS = /['()]/g;
const encodeDelims = (s: string) =>
  s.replace(DELIMS, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Encode one relative media path for the canonical /__media/ form: URL-safe
 *  per segment, with the delimiter characters encodeURIComponent spares taken
 *  out too. Idempotent for the sanitized names importMedia writes. */
export const encodeMediaRel = (rel: string): string =>
  rel.split('/').map((seg) => encodeDelims(encodeURIComponent(seg))).join('/');

/** The inverse: a canonical /__media/ path back to real file-path segments. A
 *  segment that isn't valid percent-encoding is a literal name from a note an
 *  older build wrote, and passes through untouched. */
export const decodeMediaRel = (rel: string): string =>
  rel
    .split('/')
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })
    .join('/');

/** One canonical src (/__media/…) -> displayable asset URL. */
export function displayMediaSrc(src: string, root: string | null, convert: ConvertSrc): string {
  if (!root || !src || !src.startsWith(MEDIA_URL_PREFIX)) return src;
  return encodeDelims(convert(`${normRoot(root)}/${decodeMediaRel(src.slice(MEDIA_URL_PREFIX.length))}`));
}

/** Every /__media/… occurrence in an HTML string -> asset URL. */
export function displayMediaHtml(html: string, root: string | null, convert: ConvertSrc): string {
  if (!root || !html) return html;
  return html.replace(/\/__media\/([^"')\s]+)/g, (_m, rel) =>
    encodeDelims(convert(`${normRoot(root)}/${decodeMediaRel(rel)}`))
  );
}

// convertFileSrc yields http(s)://asset.localhost/<encoded path> on
// Windows/Android and asset://localhost/<encoded path> elsewhere. Invert by
// decoding the path and stripping the workspace root (case-insensitively:
// Windows paths). URLs outside the workspace are left untouched.
//
// The class excludes only the quote characters, NOT `)` — notes written by the
// build that shipped this bug hold asset URLs with real parens in them, and
// this is what turns those back into canonical form (see balancedPrefix).
const ASSET_URL_RE = /(?:https?:\/\/asset\.localhost|asset:\/\/localhost)\/([^"'\s]+)/g;

/** The leading run whose parens balance. A `)` with no `(` before it belongs to
 *  whatever wraps the URL — markdown's `](…)` — not to the URL. */
function balancedPrefix(s: string): string {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && depth-- === 0) return s.slice(0, i);
  }
  return s;
}

export function canonicalMediaHtml(html: string, root: string | null): string {
  if (!root || !html) return html;
  const rootN = normRoot(root).toLowerCase();
  return html.replace(ASSET_URL_RE, (m, raw) => {
    const enc = balancedPrefix(raw);
    const tail = raw.slice(enc.length); // whatever closed the URL, put back verbatim
    let p: string;
    try {
      p = decodeURIComponent(enc);
    } catch {
      return m;
    }
    p = p.replace(/\\/g, '/');
    if (!p.toLowerCase().startsWith(`${rootN}/`)) return m;
    return `${MEDIA_URL_PREFIX}${encodeMediaRel(p.slice(rootN.length + 1))}${tail}`;
  });
}
