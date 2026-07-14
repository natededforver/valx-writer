// ---------------------------------------------------------------------------
// Per-note version history, stored in IndexedDB (via idb-keyval, already a dep)
// as ONE gzip-compressed blob per note. Snapshots are oldest→newest and capped
// like a cache: at most CAP kept, oldest evicted. gzip (CompressionStream, a
// browser native — no dependency) keeps code/HTML history from bloating the DB.
// ---------------------------------------------------------------------------

import { get, set, del } from 'idb-keyval';

export interface Snapshot { t: number; content: string }

const KEY = (id: string) => `valx-history:${id}`;
const CAP = 50;

/** Append `content` as a snapshot unless it's identical to the latest one
 *  (no point recording a no-op). Returns the SAME array reference when nothing
 *  changed, so callers can skip a redundant write. Oldest entries drop past cap. */
export function pushSnapshot(snaps: Snapshot[], content: string, t: number, cap = CAP): Snapshot[] {
  if (snaps.length && snaps[snaps.length - 1].content === content) return snaps;
  const next = [...snaps, { t, content }];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

// gzip round-trip via the platform's CompressionStream. Exported for the test.
export async function gzipStr(s: string): Promise<Uint8Array> {
  const stream = new Blob([new TextEncoder().encode(s)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function gunzipStr(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function loadHistory(id: string): Promise<Snapshot[]> {
  try {
    const bytes = await get(KEY(id));
    if (!bytes) return [];
    const arr = JSON.parse(await gunzipStr(bytes));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export async function saveHistory(id: string, snaps: Snapshot[]): Promise<void> {
  try { await set(KEY(id), await gzipStr(JSON.stringify(snaps))); } catch { /* quota/idb error — drop */ }
}

/** Drop a note's history entirely (called on permanent delete so it can't
 *  outlive the note). */
export async function dropHistory(id: string): Promise<void> {
  try { await del(KEY(id)); } catch { /* ignore */ }
}
