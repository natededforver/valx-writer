(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/lib/format.ts
  var format_exports = {};
  __export(format_exports, {
    ATTACH_DIR: () => ATTACH_DIR,
    FILE_FORMATS: () => FILE_FORMATS,
    MEDIA_URL_PREFIX: () => MEDIA_URL_PREFIX,
    contentFromDisk: () => contentFromDisk,
    extractFirstMedia: () => extractFirstMedia,
    folderDepth: () => folderDepth,
    formatKind: () => formatKind,
    hasEmbeddedMedia: () => hasEmbeddedMedia,
    htmlToMarkdown: () => htmlToMarkdown,
    markdownToHtml: () => markdownToHtml,
    rewriteMediaFromDisk: () => rewriteMediaFromDisk,
    rewriteMediaToDisk: () => rewriteMediaToDisk,
    tableHtmlToMarkdown: () => tableHtmlToMarkdown
  });
  var FILE_FORMATS = [".md", ".txt", ".html"];
  var MEDIA_URL_PREFIX = "/__media/";
  var ATTACH_DIR = ".attachments";
  function rewriteMediaToDisk(text, depth = 0) {
    if (!text) return text;
    const up = "../".repeat(Math.max(0, depth));
    return text.replace(/\/__media\/(\.?attachments\/[^"')\s]+)/g, (_m, rel) => `${up}${rel}`);
  }
  function rewriteMediaFromDisk(text) {
    if (!text) return text;
    return text.replace(
      /(["'(])((?:\.\.\/)*)(\.?attachments\/[^"')\s]+)/g,
      (_m, delim, _up, rel) => `${delim}${MEDIA_URL_PREFIX}${rel.replace(/^attachments\//, `${ATTACH_DIR}/`)}`
    );
  }
  var folderDepth = (dir) => dir ? dir.split("/").filter(Boolean).length : 0;
  var IMG_STYLE = "max-width: 100%; max-height: 500px; border-radius: 0.375rem; margin-top: 1rem; margin-bottom: 1rem; object-fit: contain;";
  var makeStash = () => {
    const key = `VX${Math.random().toString(36).slice(2, 10)}`;
    const items = [];
    return {
      put(tag, value) {
        items.push(value);
        return `@@${key}:${tag}${items.length - 1}@@`;
      },
      restore(text, tag, render) {
        return text.replace(
          new RegExp(`@@${key}:${tag}(\\d+)@@`, "g"),
          (_m, i) => render(items[Number(i)], Number(i))
        );
      }
    };
  };
  var mediaTagRe = () => /<(audio|video)[^>]*>[\s\S]*?<\/\1>|<(?:audio|video)[^>]*\/?>/gi;
  var LEGACY_HTML_RE = /<\s*(br|div|p|span|img|h[1-6]|b|strong|i|em|u|s|del|strike|ul|ol|li|a|blockquote|code|pre)\b[^>]*\/?>/i;
  var decodeEntities = (s) => s.replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  var escapeText = (s) => s.replace(/&(?!(?:lt|gt|amp|quot|nbsp|#\d+);)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  var escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  var cellToText = (h) => decodeEntities(
    h.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
  ).replace(/\|/g, "\\|");
  function tableHtmlToMarkdown(tableHtml) {
    const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(
      (r) => [...r[1].matchAll(/<(t[hd])[^>]*>([\s\S]*?)<\/\1>/gi)].map((c) => cellToText(c[2]))
    ).filter((r) => r.length);
    if (!rows.length) return "";
    const cols = Math.max(...rows.map((r) => r.length));
    const pad = (r) => {
      const a = r.slice();
      while (a.length < cols) a.push("");
      return a;
    };
    const line = (cells) => `| ${pad(cells).join(" | ")} |`;
    const sep = `| ${Array(cols).fill("---").join(" | ")} |`;
    return [line(rows[0]), sep, ...rows.slice(1).map(line)].join("\n");
  }
  var isTableSeparator = (line) => !!line && /-/.test(line) && /\|/.test(line) && /^[\s|:\-]+$/.test(line);
  var splitRow = (line) => {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  };
  function markdownTableToHtml(block) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return block;
    const header = splitRow(lines[0]);
    const cols = header.length;
    const body = lines.slice(2).map(splitRow);
    const th = header.map((c) => `<th>${escapeText(c)}</th>`).join("");
    const trs = body.map((r) => `<tr>${Array.from({ length: cols }, (_, k) => `<td>${escapeText(r[k] || "")}</td>`).join("")}</tr>`).join("");
    return `<table class="vx-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
  }
  function htmlToMarkdown(html) {
    if (!html) return "";
    const stash = makeStash();
    let md = html.replace(mediaTagRe(), (m) => stash.put("P", m));
    md = md.replace(/<table[\s\S]*?<\/table>/gi, (m) => stash.put("P", tableHtmlToMarkdown(m)));
    md = md.replace(/<img[^>]*src=["']([^"']+)["'][^>]*\/?>/gi, (m, src) => {
      const alt = (/alt=["']([^"']*)["']/i.exec(m)?.[1] || "image").replace(/[[\]]/g, "");
      return `![${alt}](${src})`;
    });
    md = md.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, text) => {
      return `${"#".repeat(Number(level))} ${text.replace(/<[^>]+>/g, "").trim()}
`;
    });
    md = md.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
      const label = inner.replace(/<[^>]+>/g, "").trim() || href;
      return `[${label.replace(/[[\]]/g, "")}](${href})`;
    });
    md = md.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
    md = md.replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
    md = md.replace(/<(s|del|strike)[^>]*>([\s\S]*?)<\/\1>/gi, "~~$2~~");
    md = md.replace(/<br\s*\/?>/gi, "\n");
    md = md.replace(/<li[^>]*>/gi, "\n- ");
    md = md.replace(/<(?:div|p|ul|ol|blockquote)[^>]*>/gi, "\n");
    md = md.replace(/<\/(?:p|div|li|ul|ol|blockquote)>/gi, "");
    md = md.replace(/<[^>]+>/g, "");
    md = decodeEntities(md);
    md = md.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
    md = stash.restore(md, "P", (tag) => `
${tag}
`);
    return md;
  }
  function markdownToHtml(raw) {
    if (!raw) return "";
    const stash = makeStash();
    let text = raw.replace(mediaTagRe(), (m) => stash.put("P", m));
    if (LEGACY_HTML_RE.test(text)) return raw;
    {
      const lines = text.split("\n");
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("|") && isTableSeparator(lines[i + 1])) {
          let j = i + 2;
          const block = [lines[i], lines[i + 1]];
          while (j < lines.length && lines[j].includes("|") && lines[j].trim() !== "") {
            block.push(lines[j]);
            j++;
          }
          out.push(stash.put("P", markdownTableToHtml(block.join("\n"))));
          i = j - 1;
        } else {
          out.push(lines[i]);
        }
      }
      text = out.join("\n");
    }
    text = text.replace(
      /!\[([^\]]*)\]\(([^)\s]+)\)/g,
      (_m, alt, src) => stash.put("I", JSON.stringify({ alt, src }))
    );
    text = text.replace(
      /(^|[^!])\[([^\]]+)\]\(([^)\s]+)\)/g,
      (_m, pre, label, src) => `${pre}${stash.put("L", JSON.stringify({ label, src }))}`
    );
    text = escapeText(text);
    text = text.replace(/^(#{1,6})[ \t]+(.+)$/gm, (_m, hashes, body) => {
      const level = hashes.length;
      return `<h${level}>${body.trim()}</h${level}>`;
    });
    text = text.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
    text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<i>$2</i>");
    text = text.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
    text = text.replace(/\n/g, "<br>");
    text = text.replace(/<\/h([1-6])><br>/g, "</h$1>");
    text = stash.restore(text, "I", (value) => {
      const img = JSON.parse(value);
      return `<img src="${img.src}" alt="${escapeAttr(img.alt)}" style="${IMG_STYLE}" />`;
    });
    text = stash.restore(text, "L", (value) => {
      const link = JSON.parse(value);
      return `<a href="${escapeAttr(link.src)}">${escapeText(link.label)}</a>`;
    });
    text = stash.restore(text, "P", (tag) => tag);
    text = text.replace(/<br>\s*(<table)/gi, "$1").replace(/(<\/table>)\s*<br>/gi, "$1");
    return text;
  }
  var MARKDOWN_EXT_RE = /\.(md|markdown|mdown|mkd)$/i;
  function formatKind(ext) {
    const e = ext.toLowerCase();
    if (/\.(md|markdown|mdown|mkd)$/.test(e)) return "md";
    if (/\.(txt|text)$/.test(e)) return "txt";
    return "html";
  }
  function contentFromDisk(fileName, raw) {
    const withMedia = rewriteMediaFromDisk(raw);
    return MARKDOWN_EXT_RE.test(fileName) ? markdownToHtml(withMedia) : withMedia;
  }
  function extractFirstMedia(content) {
    if (!content) return null;
    const tag = /<(img|audio|video)[^>]*?src=["']([^"']+)["']/i.exec(content);
    if (tag) {
      const name = tag[1].toLowerCase();
      return { kind: name === "img" ? "image" : name, src: tag[2] };
    }
    const attach = /<a[^>]*class=["'][^"']*vx-attach[^"']*["'][^>]*>/i.exec(content);
    if (attach) {
      const src = /href=["']([^"']+)["']/i.exec(attach[0])?.[1] || "";
      const name = /data-name=["']([^"']*)["']/i.exec(attach[0])?.[1] || "file";
      return { kind: "file", src, name };
    }
    const mdImg = /!\[[^\]]*\]\(([^)\s]+)\)/.exec(content);
    if (mdImg) return { kind: "image", src: mdImg[1] };
    return null;
  }
  var hasEmbeddedMedia = (content) => extractFirstMedia(content) !== null;

  // src/lib/tableEditing.ts
  var tableEditing_exports = {};
  __export(tableEditing_exports, {
    addColumn: () => addColumn,
    addRow: () => addRow,
    buildTableHtml: () => buildTableHtml,
    deleteColumn: () => deleteColumn,
    deleteRow: () => deleteRow,
    deleteTable: () => deleteTable,
    getCellFromSelection: () => getCellFromSelection,
    isTableEmpty: () => isTableEmpty,
    moveCell: () => moveCell,
    placeCaret: () => placeCaret
  });
  function buildTableHtml(rows, cols) {
    const th = Array.from({ length: cols }, () => "<th><br></th>").join("");
    const body = Array.from(
      { length: Math.max(0, rows - 1) },
      () => `<tr>${Array.from({ length: cols }, () => "<td><br></td>").join("")}</tr>`
    ).join("");
    return `<p><br></p><table class="vx-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table><p><br></p>`;
  }
  function getCellFromSelection(editor) {
    if (!editor) return null;
    const sel = window.getSelection();
    const node = sel?.focusNode;
    if (!node) return null;
    const el = node.nodeType === 1 ? node : node.parentElement;
    const cell = el?.closest("th,td");
    return cell && editor.contains(cell) ? cell : null;
  }
  function placeCaret(target) {
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  var allCells = (table) => Array.from(table.querySelectorAll("th,td"));
  var colIndexOf = (cell) => Array.from(cell.parentElement?.children || []).indexOf(cell);
  function moveCell(cell, back, onChange) {
    const table = cell.closest("table");
    if (!table) return;
    const cells = allCells(table);
    const idx = cells.indexOf(cell);
    if (back) {
      if (idx > 0) placeCaret(cells[idx - 1]);
      return;
    }
    if (idx < cells.length - 1) {
      placeCaret(cells[idx + 1]);
      return;
    }
    addRow(cell, true, onChange);
  }
  function addRow(cell, below, onChange) {
    const row = cell.closest("tr");
    const table = cell.closest("table");
    if (!row || !table) return;
    const cols = row.children.length || 1;
    const tr = document.createElement("tr");
    for (let i = 0; i < cols; i++) {
      const td = document.createElement("td");
      td.innerHTML = "<br>";
      tr.appendChild(td);
    }
    if (row.parentElement?.tagName === "THEAD") {
      const tbody = table.querySelector("tbody") || table;
      tbody.insertBefore(tr, tbody.firstChild);
    } else {
      row.parentElement?.insertBefore(tr, below ? row.nextSibling : row);
    }
    placeCaret(tr.firstElementChild || tr);
    onChange();
  }
  function addColumn(cell, after, onChange) {
    const table = cell.closest("table");
    if (!table) return;
    const col = colIndexOf(cell);
    for (const row of Array.from(table.querySelectorAll("tr"))) {
      const isHead = row.parentElement?.tagName === "THEAD";
      const el = document.createElement(isHead ? "th" : "td");
      el.innerHTML = "<br>";
      const ref = row.children[col];
      if (ref) row.insertBefore(el, after ? ref.nextSibling : ref);
      else row.appendChild(el);
    }
    placeCaret(cell);
    onChange();
  }
  function deleteRow(cell, editor, onChange) {
    const row = cell.closest("tr");
    const table = cell.closest("table");
    if (!row || !table) return;
    if (table.querySelectorAll("tr").length <= 1) {
      deleteTable(table, editor, onChange);
      return;
    }
    const cells = allCells(table);
    const idx = cells.indexOf(cell);
    row.remove();
    const rest = allCells(table);
    if (rest.length) placeCaret(rest[Math.min(idx, rest.length - 1)]);
    onChange();
  }
  function deleteColumn(cell, editor, onChange) {
    const table = cell.closest("table");
    if (!table) return;
    const col = colIndexOf(cell);
    const firstRow = table.querySelector("tr");
    if (!firstRow || firstRow.children.length <= 1) {
      deleteTable(table, editor, onChange);
      return;
    }
    for (const row of Array.from(table.querySelectorAll("tr"))) {
      const target = row.children[col];
      if (target) target.remove();
    }
    onChange();
  }
  function isTableEmpty(table) {
    return allCells(table).every((c) => c.textContent?.trim() === "");
  }
  function deleteTable(table, editor, onChange) {
    const p = document.createElement("p");
    p.innerHTML = "<br>";
    table.parentElement?.replaceChild(p, table);
    placeCaret(p);
    onChange();
    void editor;
  }

  // dev/harness-entry.ts
  window.VXFormat = format_exports;
  window.VXTable = tableEditing_exports;
})();
