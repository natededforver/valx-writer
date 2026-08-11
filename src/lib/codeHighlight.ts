// ---------------------------------------------------------------------------
// Tiny regex syntax highlighter for the code editor (HTML/CSS/JS/TS/Python).
// ponytail: hand-rolled scanner, not highlight.js — 5 languages don't justify a
// dependency + its themes. Bump to a real grammar lib if we add many languages
// or need semantic (scope-aware) coloring.
//
// Output is injected via dangerouslySetInnerHTML, so every source chunk MUST be
// HTML-escaped — a note containing `<script>` can never execute in the app UI.
// (covered by codeHighlight.test.ts)
// ---------------------------------------------------------------------------

export type CodeLang = 'html' | 'css' | 'js' | 'ts' | 'python' | 'md';

/** Extensions that open as raw source (highlighted) instead of prose.
 *  '.md' deliberately maps to null: markdown notes stay in the rich editor and
 *  get source view via the Editor's markdown-source toggle instead. */
export function codeLangFromExt(ext: string): CodeLang | null {
  switch (ext.toLowerCase()) {
    case '.html': case '.htm': return 'html';
    case '.css': return 'css';
    case '.js': case '.mjs': case '.cjs': case '.jsx': return 'js';
    case '.ts': case '.tsx': return 'ts';
    case '.py': return 'python';
    default: return null;
  }
}

/** Languages the in-app preview can render. */
export const PREVIEWABLE: ReadonlySet<CodeLang> = new Set<CodeLang>(['html', 'css', 'js']);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A rule either names a token class (whole match wrapped in one span) or
// renders the match itself — markdown needs the split (faded syntax marks
// around normally-colored content). Render functions must esc() every chunk.
type Rule = [RegExp, string | ((m: RegExpExecArray) => string)];

const syn = (s: string) => `<span class="tok-mdsyn">${esc(s)}</span>`;

const JS_KW = /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|this|import|export|from|default|async|await|yield|try|catch|finally|throw|typeof|instanceof|in|of|delete|void|null|undefined|true|false|interface|type|enum|implements|public|private|protected|readonly|as|namespace|static|get|set)\b/g;

const RULES: Record<CodeLang, Rule[]> = {
  html: [
    [/<!--[\s\S]*?-->/g, 'comment'],
    [/"[^"]*"|'[^']*'/g, 'string'],
    [/<\/?[a-zA-Z][\w:-]*|\/?>/g, 'tag'],
    [/[a-zA-Z_:][\w:-]*(?=\s*=)/g, 'attr'],
    [/&[a-zA-Z#0-9]+;/g, 'entity'],
  ],
  css: [
    [/\/\*[\s\S]*?\*\//g, 'comment'],
    [/"[^"]*"|'[^']*'/g, 'string'],
    [/@[\w-]+/g, 'keyword'],
    [/#[0-9a-fA-F]{3,8}\b/g, 'number'],
    [/[.#][\w-]+/g, 'tag'],
    [/[\w-]+(?=\s*:)/g, 'attr'],
    [/\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr|pt|ch|ex)?\b/g, 'number'],
  ],
  js: [
    [/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, 'comment'],
    [/`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, 'string'],
    [JS_KW, 'keyword'],
    [/\b\d+(?:\.\d+)?\b/g, 'number'],
    [/[A-Za-z_$][\w$]*(?=\s*\()/g, 'fn'],
  ],
  ts: [
    [/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, 'comment'],
    [/`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, 'string'],
    [JS_KW, 'keyword'],
    [/\b\d+(?:\.\d+)?\b/g, 'number'],
    [/[A-Za-z_$][\w$]*(?=\s*\()/g, 'fn'],
  ],
  python: [
    [/#[^\n]*/g, 'comment'],
    [/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, 'string'],
    [/@[\w.]+/g, 'attr'],
    [/\b(def|class|return|if|elif|else|for|while|import|from|as|with|try|except|finally|raise|pass|break|continue|lambda|yield|global|nonlocal|assert|del|in|is|not|and|or|None|True|False|async|await|self)\b/g, 'keyword'],
    [/\b\d+(?:\.\d+)?\b/g, 'number'],
    [/[A-Za-z_][\w]*(?=\s*\()/g, 'fn'],
  ],
  // Markdown source view: syntax marks render faded (.tok-mdsyn), content
  // keeps its meaning (bold text bold, links lime). Same glyph metrics as the
  // base font — only color/weight/style change, so the transparent-textarea
  // caret stays aligned. ponytail: truly *smaller* marks need per-font
  // letter-spacing compensation (or a real editor widget) — fade-only for now.
  md: [
    [/^`{3,}[^\n]*/gm, 'mdsyn'],
    [/^(#{1,6}[ \t]+)(.*)$/gm, (m) => syn(m[1]) + `<span class="tok-mdhead">${esc(m[2])}</span>`],
    [/^[ \t]*[-+*][ \t]+\[[ xX]\]/gm, 'mdsyn'],
    [/^[ \t]*(?:[-+*]|\d+\.)[ \t]+/gm, 'mdsyn'],
    [/^[ \t]*>[ \t]?/gm, 'mdsyn'],
    [/^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, 'mdsyn'],
    [/`([^`\n]+)`/g, (m) => syn('`') + `<span class="tok-mdcode">${esc(m[1])}</span>` + syn('`')],
    [/\*\*([^*\n]+)\*\*/g, (m) => syn('**') + `<b>${esc(m[1])}</b>` + syn('**')],
    [/\*([^*\n]+)\*/g, (m) => syn('*') + `<i>${esc(m[1])}</i>` + syn('*')],
    [/~~([^~\n]+)~~/g, (m) => syn('~~') + `<s>${esc(m[1])}</s>` + syn('~~')],
    [/(!?\[)([^\]\n]*)(\]\()([^)\s]+)(\))/g, (m) =>
      syn(m[1]) + `<span class="tok-mdlink">${esc(m[2])}</span>` + syn(m[3]) + `<span class="tok-mdurl">${esc(m[4])}</span>` + syn(m[5])],
    [/\|/g, 'mdsyn'],
  ],
};

/** Escaped, span-wrapped HTML for `src` in `lang`. Earliest match wins; ties go
 *  to the first (more specific) rule, so comments/strings beat keywords. */
export function highlightCode(src: string, lang: CodeLang): string {
  const rules = RULES[lang];
  let i = 0;
  let out = '';
  while (i < src.length) {
    let best: RegExpExecArray | null = null;
    let bestIdx = src.length;
    let bestCls: Rule[1] = '';
    for (const [re, cls] of rules) {
      re.lastIndex = i;
      const m = re.exec(src);
      if (m && m.index < bestIdx) { best = m; bestIdx = m.index; bestCls = cls; }
    }
    if (!best || !best[0]) { out += esc(src.slice(i, bestIdx > i ? bestIdx : i + 1)); i = bestIdx > i ? bestIdx : i + 1; continue; }
    if (bestIdx > i) out += esc(src.slice(i, bestIdx));
    out += typeof bestCls === 'function' ? bestCls(best) : `<span class="tok-${bestCls}">${esc(best[0])}</span>`;
    i = bestIdx + best[0].length;
  }
  return out;
}

/** Wrap raw source in a self-contained document the preview iframe can render.
 *  `mediaBase` (the app origin) makes `/__media/…` note media resolve from the
 *  static server even in the opaque-origin sandbox. */
export function buildPreviewDoc(content: string, lang: CodeLang, mediaBase = ''): string {
  const withMedia = mediaBase ? content.replace(/\/__media\//g, `${mediaBase}/__media/`) : content;
  if (lang === 'html') return withMedia;
  if (lang === 'css') {
    return `<!doctype html><meta charset="utf-8"><style>${withMedia}</style>` +
      `<body><h1>Heading</h1><p>Paragraph with a <a href="#">link</a> and <strong>bold</strong> text.</p>` +
      `<button>Button</button><ul><li>One</li><li>Two</li></ul></body>`;
  }
  // js: run it, mirror console output onto the page so it's visible without devtools.
  return `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;margin:12px">` +
    `<pre id="__log" style="white-space:pre-wrap;margin:0"></pre>` +
    `<script>(function(){var o=document.getElementById('__log');['log','error','warn','info'].forEach(function(k){var f=console[k];console[k]=function(){o.textContent+=Array.from(arguments).map(String).join(' ')+'\\n';f.apply(console,arguments);};});window.onerror=function(m){o.textContent+='Error: '+m+'\\n';};})();</script>` +
    `<script>${withMedia}</script></body>`;
}
