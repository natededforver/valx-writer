import JSZip from 'jszip';

// DOCX/ODT generation. Ran in the Electron main process before the Tauri
// migration; now runs in the renderer (JSZip is isomorphic) and returns
// Uint8Array ready for @tauri-apps/plugin-fs writeFile.
// Minimal mime -> file extension map covering media types the editor can embed.
const MIME_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/tiff': 'tiff',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/webm': 'weba',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/x-msvideo': 'avi',
};

function extensionForMime(mimeType) {
  return MIME_EXTENSIONS[mimeType.toLowerCase()] || 'bin';
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MEDIA_REGEX = /<(img|audio|video)[^>]+src=["']data:([^;]+);base64,([^"']+)["'][^>]*>/gi;

// --- image sizing (aspect-ratio-safe export) --------------------------------
// EMU = English Metric Units (DOCX's length unit): 914400 per inch, so at the
// standard 96dpi web pixel grid that's 9525 EMU/px.
const EMU_PER_PX = 9525;
const MAX_WIDTH_EMU = 5943600; // 6.5in — Letter minus 1in margins each side
const MAX_HEIGHT_EMU = 9144000; // 10in
const CM_PER_PX = 2.54 / 96;
const MAX_WIDTH_CM = 17; // A4 minus 2cm margins each side
const MAX_HEIGHT_CM = 24;

function parseExplicitPx(tagHtml, attr) {
  const attrMatch = new RegExp(`\\b${attr}=["']?(\\d+)(?:px)?["']?`, 'i').exec(tagHtml);
  if (attrMatch) return parseInt(attrMatch[1], 10);
  const styleMatch = new RegExp(`${attr}\\s*:\\s*(\\d+)px`, 'i').exec(tagHtml);
  if (styleMatch) return parseInt(styleMatch[1], 10);
  return null;
}

async function intrinsicPx(mimeType, base64Data) {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bin = atob(base64Data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
    const dims = { w: bitmap.width, h: bitmap.height };
    bitmap.close?.();
    return dims;
  } catch {
    return null; // format createImageBitmap can't decode (rare) — caller falls back
  }
}

// Explicit width/height from the source markup win (either or both); missing
// ones are filled in from the image's own decoded aspect ratio, so nothing
// stretches away from its real shape.
async function resolveTargetPx(tagHtml, mimeType, base64Data) {
  const explicitW = parseExplicitPx(tagHtml, 'width');
  const explicitH = parseExplicitPx(tagHtml, 'height');
  const intrinsic = await intrinsicPx(mimeType, base64Data);

  if (explicitW && explicitH) return { w: explicitW, h: explicitH };
  if (intrinsic && intrinsic.w && intrinsic.h) {
    const ratio = intrinsic.h / intrinsic.w;
    if (explicitW) return { w: explicitW, h: Math.round(explicitW * ratio) };
    if (explicitH) return { w: Math.round(explicitH / ratio), h: explicitH };
    return intrinsic;
  }
  if (explicitW || explicitH) {
    // No decodable intrinsic size and only one explicit dimension — assume a
    // 4:3 box rather than guessing a square.
    return explicitW
      ? { w: explicitW, h: Math.round(explicitW * 0.75) }
      : { w: Math.round(explicitH / 0.75), h: explicitH };
  }
  return { w: 480, h: 360 }; // no size info at all — old fixed default, still 4:3
}

// Scales a pixel box into document units, shrinking (never enlarging) to fit
// the page bounds while preserving aspect ratio.
function fitBox(wPx, hPx, pxPerUnit, maxW, maxH) {
  const w = wPx * pxPerUnit;
  const h = hPx * pxPerUnit;
  const scale = Math.min(1, maxW / w, maxH / h);
  return { w: w * scale, h: h * scale }; // caller rounds to its own unit's precision
}

const splitBlocks = (htmlContent) =>
  htmlContent.split(/(?:<br\s*\/?>|<\/?p[^>]*>|<\/?div[^>]*>)/i).map((b) => b.trim()).filter(Boolean);

export async function generateDocx(title, htmlContent) {
  const zip = new JSZip();

  const contentTypeDefaults = new Map([
    ['rels', 'application/vnd.openxmlformats-package.relationships+xml'],
    ['xml', 'application/xml'],
  ]);

  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  const rels = [];
  let mediaCounter = 1;
  let relCounter = 1;

  let documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:rPr><w:b/><w:sz w:val="48"/></w:rPr><w:t>${escapeXml(title || 'Untitled')}</w:t></w:r>
    </w:p>`;

  const appendTextRun = (text) => {
    const clean = text.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
    if (clean) {
      documentXml += `<w:r><w:t xml:space="preserve">${escapeXml(clean)}</w:t></w:r>`;
    }
  };

  for (const block of splitBlocks(htmlContent)) {
    documentXml += `<w:p>`;

    let match;
    let lastIndex = 0;
    const mediaRx = new RegExp(MEDIA_REGEX.source, MEDIA_REGEX.flags); // own lastIndex — the await below can't race a shared one

    while ((match = mediaRx.exec(block)) !== null) {
      const tagType = match[1].toLowerCase();
      const mimeType = match[2];
      const base64Data = match[3];
      const ext = extensionForMime(mimeType);

      if (!contentTypeDefaults.has(ext)) {
        contentTypeDefaults.set(ext, mimeType);
      }

      const mediaFileName = `media${mediaCounter}.${ext}`;
      zip.file(`word/media/${mediaFileName}`, base64Data, { base64: true });

      appendTextRun(block.substring(lastIndex, match.index));

      if (tagType === 'img') {
        const { w: wPx, h: hPx } = await resolveTargetPx(match[0], mimeType, base64Data);
        const fitted = fitBox(wPx, hPx, EMU_PER_PX, MAX_WIDTH_EMU, MAX_HEIGHT_EMU);
        const cx = Math.round(fitted.w), cy = Math.round(fitted.h);
        const relId = `rId${100 + relCounter}`; // offset to avoid clashing with rId1 of .rels convention
        rels.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaFileName}"/>`);
        // Complete, spec-valid inline drawing (Word rejects documents missing nvPicPr/extent/docPr)
        documentXml += `<w:r><w:drawing>
          <wp:inline distT="0" distB="0" distL="0" distR="0">
            <wp:extent cx="${cx}" cy="${cy}"/>
            <wp:docPr id="${relCounter}" name="media${mediaCounter}"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic>
                  <pic:nvPicPr>
                    <pic:cNvPr id="${relCounter}" name="media${mediaCounter}"/>
                    <pic:cNvPicPr/>
                  </pic:nvPicPr>
                  <pic:blipFill>
                    <a:blip r:embed="${relId}"/>
                    <a:stretch><a:fillRect/></a:stretch>
                  </pic:blipFill>
                  <pic:spPr>
                    <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
                    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                  </pic:spPr>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing></w:r>`;
        relCounter++;
      } else {
        // Word has no portable inline player; the media file is still bundled
        // under word/media/ so the recipient can extract it from the archive.
        documentXml += `<w:r><w:t xml:space="preserve">[Attached ${tagType}: ${mediaFileName}]</w:t></w:r>`;
      }

      mediaCounter++;
      lastIndex = mediaRx.lastIndex;
    }

    appendTextRun(block.substring(lastIndex));
    documentXml += `</w:p>`;
  }

  documentXml += `
    <w:sectPr/>
  </w:body>
</w:document>`;

  let contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
`;
  for (const [ext, type] of contentTypeDefaults) {
    contentTypes += `  <Default Extension="${ext}" ContentType="${type}"/>\n`;
  }
  contentTypes += `  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  zip.file('[Content_Types].xml', contentTypes);

  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rels.join('\n')}
</Relationships>`);

  zip.file('word/document.xml', documentXml);

  return await zip.generateAsync({ type: 'uint8array' });
}

export async function generateOdt(title, htmlContent) {
  const zip = new JSZip();

  // Per ODF spec the mimetype entry must be first and uncompressed
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });

  let manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
`;

  let contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
  office:version="1.2">
  <office:body>
    <office:text>
      <text:h text:outline-level="1">${escapeXml(title || 'Untitled')}</text:h>`;

  let mediaCounter = 1;

  const appendText = (text) => {
    const clean = text.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
    if (clean) contentXml += escapeXml(clean);
  };

  for (const block of splitBlocks(htmlContent)) {
    contentXml += `<text:p>`;

    let match;
    let lastIndex = 0;
    const mediaRx = new RegExp(MEDIA_REGEX.source, MEDIA_REGEX.flags); // own lastIndex — the await below can't race a shared one

    while ((match = mediaRx.exec(block)) !== null) {
      const tagType = match[1].toLowerCase();
      const mimeType = match[2];
      const base64Data = match[3];
      const ext = extensionForMime(mimeType);

      const mediaFileName = `Pictures/media${mediaCounter}.${ext}`;
      zip.file(mediaFileName, base64Data, { base64: true });
      manifest += `  <manifest:file-entry manifest:full-path="${mediaFileName}" manifest:media-type="${mimeType}"/>\n`;

      appendText(block.substring(lastIndex, match.index));

      if (tagType === 'img') {
        const { w: wPx, h: hPx } = await resolveTargetPx(match[0], mimeType, base64Data);
        const { w: wCm, h: hCm } = fitBox(wPx, hPx, CM_PER_PX, MAX_WIDTH_CM, MAX_HEIGHT_CM);
        contentXml += `<draw:frame draw:name="media${mediaCounter}" text:anchor-type="as-char" svg:width="${wCm.toFixed(2)}cm" svg:height="${hCm.toFixed(2)}cm">` +
          `<draw:image xlink:href="${mediaFileName}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>` +
          `</draw:frame>`;
      } else {
        contentXml += escapeXml(`[Attached ${tagType}: ${mediaFileName}]`);
      }

      mediaCounter++;
      lastIndex = mediaRx.lastIndex;
    }

    appendText(block.substring(lastIndex));
    contentXml += `</text:p>`;
  }

  contentXml += `
    </office:text>
  </office:body>
</office:document-content>`;

  manifest += `</manifest:manifest>`;

  zip.file('META-INF/manifest.xml', manifest);
  zip.file('content.xml', contentXml);

  return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
// (the old htmlToMarkdown here was dropped — src/lib/format.ts owns markdown
// conversion and is strictly more capable)
