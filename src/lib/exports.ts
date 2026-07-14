// ---------------------------------------------------------------------------
// Export serialization (was the Electron main process's job; now renderer-side
// so the Tauri desktop bridge can write exports via plugin-fs). One note in,
// one Uint8Array or string out, ready to write to the path the user picked.
// ---------------------------------------------------------------------------
import html2pdf from 'html2pdf.js';
import { generateDocx, generateOdt } from './exportDocs.js';
import { htmlToMarkdown } from './format';
import { htmlToPlain } from './share';

export const KNOWN_EXT: Record<string, string> = {
  pdf: 'pdf', docx: 'docx', odt: 'odt', txt: 'txt', md: 'md', html: 'html',
};

const htmlDocument = (title: string, htmlContent: string) =>
  `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${(title || 'Note').replace(/</g, '&lt;')}</title>
  </head>
  <body>
${htmlContent}
  </body>
</html>`;

// ponytail: html2pdf (html2canvas) instead of Chromium's print engine — the
// print-quality path died with Electron. Revisit via Tauri's print API if
// export fidelity complaints show up.
async function renderPdfBytes(html: string): Promise<Uint8Array> {
  const el = document.createElement('div');
  el.innerHTML = html;
  el.style.padding = '40px';
  el.style.fontFamily = 'sans-serif';
  el.style.color = 'black';
  const buf: ArrayBuffer = await html2pdf()
    .set({
      margin: 1,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' as const },
    })
    .from(el)
    .outputPdf('arraybuffer');
  return new Uint8Array(buf);
}

/** Serialize one note into the requested format. `html` should already have
 *  its media inlined as data: URLs (exports must be self-contained). */
export async function serializeNote(format: string, title: string, html: string): Promise<Uint8Array | string> {
  if (format === 'docx') return await generateDocx(title, html);
  if (format === 'odt') return await generateOdt(title, html);
  if (format === 'pdf') return await renderPdfBytes(html);
  if (format === 'html') return htmlDocument(title, html);
  if (format === 'txt') return htmlToPlain(html);
  // md and any custom text extension fall back to portable markdown.
  return htmlToMarkdown(html);
}
