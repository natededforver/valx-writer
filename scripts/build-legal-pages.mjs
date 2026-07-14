// Generates site/terms.html, site/privacy.html and site/refund.html from
// src/lib/legal.ts so the website and the in-app Legal notices can never
// drift apart. Run: node scripts/build-legal-pages.mjs
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(path.join(tmpdir(), 'valx-legal-'));
const bundle = path.join(tmp, 'legal.mjs');

execSync(`npx esbuild "${path.join(root, 'src', 'lib', 'legal.ts')}" --bundle --format=esm --outfile="${bundle}"`, {
  stdio: 'inherit',
  cwd: root,
});

const { LEGAL_DOCS } = await import(pathToFileURL(bundle).href);

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const FILES = { terms: 'terms.html', privacy: 'privacy.html', refund: 'refund.html' };

const page = (doc) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(doc.title)} — Valx Writer</title>
  <link rel="icon" type="image/png" href="logo.png" />
  <link rel="stylesheet" href="styles.css" />
</head>
<body>

  <header class="nav">
    <div class="wrap">
      <a class="brand" href="index.html"><img class="brand-logo" src="logo.png" alt="Valx Writer" /></a>
      <nav>
        <a href="index.html#features">Features</a>
        <a href="index.html#pricing">Pricing</a>
        <a href="terms.html">Legal</a>
        <a class="cta" href="download.html">Download</a>
      </nav>
    </div>
  </header>

  <main>
    <div class="wrap">
      <div class="legal">
        <span class="label">"THE FINE PRINT" — LEGAL</span>
        <h1 style="margin-top:22px;">${esc(doc.title)}</h1>
        <p class="label effective">EFFECTIVE — ${esc(doc.effectiveDate)}</p>

        <div class="legal-tabs">
          ${LEGAL_DOCS.map(
            (d) =>
              `<a href="${FILES[d.id]}"${d.id === doc.id ? ' class="active"' : ''}>${esc(d.title)}</a>`
          ).join('\n          ')}
        </div>

        ${doc.sections
          .map(
            (s) => `<section>
          <h2>${esc(s.heading)}</h2>
          ${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('\n          ')}
        </section>`
          )
          .join('\n\n        ')}
      </div>
    </div>
  </main>

  <footer>
    <div class="wrap">
      <span class="label">VALX WRITER — c/o 2026 — MADE IN INDIA</span>
      <div class="links">
        <a href="download.html">Download</a>
        <a href="terms.html">Terms of Service</a>
        <a href="privacy.html">Privacy Policy</a>
        <a href="refund.html">Refund Policy</a>
        <a href="https://github.com/natededforver" target="_blank" rel="noopener">GitHub</a>
      </div>
    </div>
  </footer>

</body>
</html>
`;

for (const doc of LEGAL_DOCS) {
  const out = path.join(root, 'site', FILES[doc.id]);
  writeFileSync(out, page(doc));
  console.log('wrote', out);
}

rmSync(tmp, { recursive: true, force: true });
