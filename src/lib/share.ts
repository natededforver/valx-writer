import { Note } from '../types';

// ---------------------------------------------------------------------------
// "Send to Others" targets. Every send copies the FULL plain text to the
// clipboard first (the browser will steal focus, and mailto/wa.me/intent URLs
// have hard length budgets), then opens the target. Two kinds of target:
//   - prefill:   the note rides in the URL (WhatsApp, Gmail, Email, X, Reddit)
//   - clipboard: the site can't be prefilled, so we open a blank new document
//                and the user pastes (Google Docs/Keep, Notion, Word, Substack)
// Budgets are enforced on the final ENCODED URL: encodeURIComponent inflates
// non-ASCII text ~3x, and Windows mailto handlers cap the whole URL near 2,083.
// ---------------------------------------------------------------------------

export const htmlToPlain = (html: string): string =>
  (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

export const plainTextOfNote = (note: Pick<Note, 'title' | 'content'>): string =>
  (note.title || 'Untitled') + '\n\n' + htmlToPlain(note.content);

const TRUNCATION_NOTE = '\n… (full note copied to clipboard)';

// Trim `body` until build(body) fits maxLen; marks truncation inside the body.
function fitUrl(build: (body: string) => string, body: string, maxLen: number): { url: string; truncated: boolean } {
  let url = build(body);
  if (url.length <= maxLen) return { url, truncated: false };
  let lo = 0;
  let hi = body.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (build(body.slice(0, mid) + TRUNCATION_NOTE).length <= maxLen) lo = mid;
    else hi = mid - 1;
  }
  return { url: build(body.slice(0, lo) + TRUNCATION_NOTE), truncated: true };
}

export type SendKind = 'prefill' | 'clipboard';

export interface ShareTarget {
  id: string;
  label: string;
  /** brand color, used as the fallback swatch when the icon can't load */
  color: string;
  /** domain whose favicon is shown as the menu icon (offline -> color swatch) */
  domain?: string;
  kind: SendKind;
  /** builds the destination URL from the note's title + plain-text body */
  buildUrl: (title: string, body: string) => { url: string; truncated: boolean };
  /** instruction toast shown as the target opens */
  hint: (truncated: boolean) => string;
}

const enc = encodeURIComponent;

export const SHARE_TARGETS: ShareTarget[] = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    color: '#25D366',
    domain: 'whatsapp.com',
    kind: 'prefill',
    buildUrl: (title, body) =>
      fitUrl((b) => `https://wa.me/?text=${enc(b)}`, `${title}\n\n${body}`, 2048),
    hint: (t) =>
      t ? 'Opening WhatsApp — note was long, full text is on your clipboard' : 'Opening WhatsApp…',
  },
  {
    id: 'gmail',
    label: 'Gmail',
    color: '#EA4335',
    domain: 'mail.google.com',
    kind: 'prefill',
    buildUrl: (title, body) =>
      fitUrl(
        (b) => `https://mail.google.com/mail/?view=cm&su=${enc(title)}&body=${enc(b)}`,
        body,
        2000
      ),
    hint: (t) => (t ? 'Opening Gmail — full text is on your clipboard' : 'Opening Gmail…'),
  },
  {
    id: 'email',
    label: 'Any Email app',
    color: '#64748b',
    kind: 'prefill',
    buildUrl: (title, body) =>
      fitUrl((b) => `mailto:?subject=${enc(title)}&body=${enc(b)}`, body, 1800),
    hint: (t) => (t ? 'Opening your email app — full text is on your clipboard' : 'Opening your email app…'),
  },
  {
    id: 'x',
    label: 'X (Twitter)',
    color: '#0f172a',
    domain: 'x.com',
    kind: 'prefill',
    // X caps posts near 280 chars; fitUrl trims to a short encoded budget and
    // the full note is on the clipboard regardless.
    buildUrl: (title, body) =>
      fitUrl((b) => `https://twitter.com/intent/tweet?text=${enc(b)}`, `${title}\n\n${body}`, 560),
    hint: (t) =>
      t ? 'Opening X — posts are short, full text is on your clipboard' : 'Opening X…',
  },
  {
    id: 'reddit',
    label: 'Reddit',
    color: '#FF4500',
    domain: 'reddit.com',
    kind: 'prefill',
    buildUrl: (title, body) =>
      fitUrl(
        (b) => `https://www.reddit.com/submit?title=${enc(title)}&text=${enc(b)}`,
        body,
        2000
      ),
    hint: (t) => (t ? 'Opening Reddit — full text is on your clipboard' : 'Opening Reddit…'),
  },
  {
    id: 'bluesky',
    label: 'Bluesky',
    color: '#1185FE',
    domain: 'bsky.app',
    kind: 'prefill',
    // Bluesky posts cap at 300 characters; the intent composer prefills text.
    buildUrl: (title, body) =>
      fitUrl((b) => `https://bsky.app/intent/compose?text=${enc(b)}`, `${title}\n\n${body}`, 700),
    hint: (t) =>
      t ? 'Opening Bluesky — posts are short, full text is on your clipboard' : 'Opening Bluesky…',
  },
  {
    id: 'docs',
    label: 'Google Docs',
    color: '#4285F4',
    domain: 'docs.google.com',
    kind: 'clipboard',
    buildUrl: () => ({ url: 'https://docs.new', truncated: false }),
    hint: () => 'Note copied — press Ctrl+V in the new Google Doc',
  },
  {
    id: 'keep',
    label: 'Google Keep',
    color: '#FBBC04',
    domain: 'keep.google.com',
    kind: 'clipboard',
    buildUrl: () => ({ url: 'https://keep.new', truncated: false }),
    hint: () => 'Note copied — press Ctrl+V in the new Keep note',
  },
  {
    id: 'notion',
    label: 'Notion',
    color: '#0f172a',
    domain: 'notion.so',
    kind: 'clipboard',
    // notion.new opens a fresh Notion page (requires being signed in).
    buildUrl: () => ({ url: 'https://notion.new', truncated: false }),
    hint: () => 'Note copied — press Ctrl+V in the new Notion page',
  },
  {
    id: 'wordpress',
    label: 'WordPress',
    color: '#21759B',
    domain: 'wordpress.com',
    kind: 'clipboard',
    // Press-This prefill is unreliable across WP plans; the dashboard's
    // new-post flow works for every wordpress.com account.
    buildUrl: () => ({ url: 'https://wordpress.com/post', truncated: false }),
    hint: () => 'Note copied — press Ctrl+V in the new WordPress post',
  },
  {
    id: 'medium',
    label: 'Medium',
    color: '#0f172a',
    domain: 'medium.com',
    kind: 'clipboard',
    buildUrl: () => ({ url: 'https://medium.com/new-story', truncated: false }),
    hint: () => 'Note copied — press Ctrl+V in the new Medium story',
  },
  {
    id: 'substack',
    label: 'Substack',
    color: '#FF6719',
    domain: 'substack.com',
    kind: 'clipboard',
    // substack.com/new and /new-post are 404s; /home is the writer dashboard.
    buildUrl: () => ({ url: 'https://substack.com/home', truncated: false }),
    hint: () => 'Note copied — click "New post" on Substack, then paste',
  },
];

export function openShareUrl(url: string): void {
  const api = (window as any).electronAPI;
  if (api?.openExternal) {
    api.openExternal(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}
