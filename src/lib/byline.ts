// Byline — the "By … · with … · Source: …" line under a note's title. It is a
// managed <aside data-vx-byline> block stored at the TOP of the note body, so
// it exports, prints and persists with the file. But it is fully DERIVED from
// data that already lives elsewhere:
//   • the creator name   → global (creators.ts)
//   • contributors / AI  → the provenance marks in the note body
//   • web sources        → the data-src-* attributes on `web` marks
// so syncByline() can strip the old block and rebuild an identical one every
// time — it never duplicates (single block, always stripped first) and never
// gets lost on reload (regenerated from the marks, which round-trip in .md).

import { creatorMeName, authorName } from './creators';

export interface Source { site: string; url?: string; }
export interface BylineCtx { by: string; ai: boolean; authors: string[]; sources: Source[]; }

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// One byline block; non-greedy so it can never swallow following content. There
// is only ever one, so a non-global match is enough. BYLINE_RE matches the bare
// <aside> (format.ts stashes exactly this); the strip variant also eats the
// <br> noise the .md round-trip glues around a top-of-document block, so the
// recovered body is clean and syncByline renormalises to a single tidy block.
export const BYLINE_RE = /<aside\b[^>]*\bdata-vx-byline="1"[^>]*>[\s\S]*?<\/aside>/i;
const BYLINE_STRIP_RE = /(?:<br\s*\/?>\s*)*<aside\b[^>]*\bdata-vx-byline="1"[^>]*>[\s\S]*?<\/aside>(?:\s*<br\s*\/?>)*/i;

export const stripByline = (html: string): string => (html || '').replace(BYLINE_STRIP_RE, '');

/** Read provenance out of a note BODY (byline already stripped). */
export function scanProvenance(body: string): { ai: boolean; authorIds: string[]; sources: Source[] } {
  let ai = false;
  const authorIds: string[] = [];
  const sources: Source[] = [];
  for (const tag of body.match(/<mark\b[^>]*>/gi) || []) {
    if (/data-slop="ai"/i.test(tag)) ai = true;
    if (/data-slop="human"/i.test(tag)) {
      const a = /data-author="([^"]*)"/i.exec(tag);
      if (a && a[1] && !authorIds.includes(a[1])) authorIds.push(a[1]);
    }
    if (/data-slop="web"/i.test(tag)) {
      const site = /data-src-site="([^"]*)"/i.exec(tag)?.[1];
      if (site) {
        const url = /data-src-url="([^"]*)"/i.exec(tag)?.[1] || undefined;
        const s = decodeURIComponent(site);
        const u = url ? decodeURIComponent(url) : undefined;
        if (!sources.some((x) => x.site === s && x.url === u)) sources.push({ site: s, url: u });
      }
    }
  }
  return { ai, authorIds, sources };
}

/** Everything the byline shows, from a note body + global creator name. */
export function deriveByline(body: string): BylineCtx {
  const { ai, authorIds, sources } = scanProvenance(body);
  const authors = authorIds.map(authorName).filter((n, i, a) => n && a.indexOf(n) === i);
  return { by: creatorMeName(), ai, authors, sources };
}

/** Nothing to attribute → no byline (a fresh note stays clean). */
export const bylineIsEmpty = (c: BylineCtx): boolean =>
  !c.by && !c.ai && c.authors.length === 0 && c.sources.length === 0;

/** The stored <aside> markup for a context, or '' when empty. */
export function buildByline(c: BylineCtx): string {
  if (bylineIsEmpty(c)) return '';
  const sep = '<span class="vx-byline-sep">·</span>';
  const parts: string[] = [];
  if (c.by) parts.push(`<span class="vx-byline-by">By ${escText(c.by)}</span>`);
  const prov: string[] = [];
  if (c.authors.length) prov.push('with ' + c.authors.map(escText).join(', '));
  if (c.ai) prov.push('AI-assisted');
  if (prov.length) parts.push(`<span class="vx-byline-prov">${escText(prov.join(' · '))}</span>`);
  if (c.sources.length) {
    const list = c.sources
      .map((s) => (s.url ? `<a href="${escAttr(s.url)}">${escText(s.site)}</a>` : escText(s.site)))
      .join(', ');
    parts.push(`<span class="vx-byline-src">Source: ${list}</span>`);
  }
  return `<aside class="vx-byline" data-vx-byline="1" contenteditable="false">${parts.join(sep)}</aside>`;
}

/** Rebuild the byline at the top of `content` (idempotent). */
export function syncByline(content: string): string {
  const body = stripByline(content);
  const aside = buildByline(deriveByline(body));
  return aside ? aside + body : body;
}
