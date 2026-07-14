// ---------------------------------------------------------------------------
// DOM helpers for editing tables inside a contentEditable surface. Kept free of
// React so the same logic drives the editor (RichTextEditor) and the dev visual
// harness (dev/harness.html). Every mutating op calls onChange() so callers can
// re-sync their model. Round-trips to markdown pipe tables via src/lib/format.ts.
// ---------------------------------------------------------------------------

export type Onchange = () => void;

/** Fresh table markup for insertion. rows includes the header row. */
export function buildTableHtml(rows: number, cols: number): string {
  const th = Array.from({ length: cols }, () => '<th><br></th>').join('');
  const body = Array.from({ length: Math.max(0, rows - 1) }, () =>
    `<tr>${Array.from({ length: cols }, () => '<td><br></td>').join('')}</tr>`
  ).join('');
  // Escape paragraphs before and after so the caret can always leave the table
  // (and the whole block can be deleted from either side).
  return `<p><br></p><table class="vx-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table><p><br></p>`;
}

/** The th/td the selection sits in, if it's inside `editor`. */
export function getCellFromSelection(editor: HTMLElement | null): HTMLElement | null {
  if (!editor) return null;
  const sel = window.getSelection();
  const node = sel?.focusNode;
  if (!node) return null;
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  const cell = el?.closest('th,td') as HTMLElement | null;
  return cell && editor.contains(cell) ? cell : null;
}

export function placeCaret(target: Element): void {
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

const allCells = (table: HTMLTableElement): HTMLElement[] =>
  Array.from(table.querySelectorAll('th,td'));

const colIndexOf = (cell: HTMLElement): number =>
  Array.from(cell.parentElement?.children || []).indexOf(cell);

/** Tab / Shift+Tab between cells; Tab past the last cell grows a new row. */
export function moveCell(cell: HTMLElement, back: boolean, onChange: Onchange): void {
  const table = cell.closest('table') as HTMLTableElement | null;
  if (!table) return;
  const cells = allCells(table);
  const idx = cells.indexOf(cell);
  if (back) {
    if (idx > 0) placeCaret(cells[idx - 1]);
    return;
  }
  if (idx < cells.length - 1) { placeCaret(cells[idx + 1]); return; }
  addRow(cell, true, onChange);
}

/** Insert a row above/below the given cell's row. */
export function addRow(cell: HTMLElement, below: boolean, onChange: Onchange): void {
  const row = cell.closest('tr');
  const table = cell.closest('table') as HTMLTableElement | null;
  if (!row || !table) return;
  const cols = row.children.length || 1;
  const tr = document.createElement('tr');
  for (let i = 0; i < cols; i++) {
    const td = document.createElement('td');
    td.innerHTML = '<br>';
    tr.appendChild(td);
  }
  // New rows are body rows: if the current row is the header, drop into tbody.
  if (row.parentElement?.tagName === 'THEAD') {
    const tbody = table.querySelector('tbody') || table;
    tbody.insertBefore(tr, tbody.firstChild);
  } else {
    row.parentElement?.insertBefore(tr, below ? row.nextSibling : row);
  }
  placeCaret(tr.firstElementChild || tr);
  onChange();
}

/** Insert a column left/right of the given cell across every row. */
export function addColumn(cell: HTMLElement, after: boolean, onChange: Onchange): void {
  const table = cell.closest('table') as HTMLTableElement | null;
  if (!table) return;
  const col = colIndexOf(cell);
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    const isHead = row.parentElement?.tagName === 'THEAD';
    const el = document.createElement(isHead ? 'th' : 'td');
    el.innerHTML = '<br>';
    const ref = row.children[col];
    if (ref) row.insertBefore(el, after ? ref.nextSibling : ref);
    else row.appendChild(el);
  }
  placeCaret(cell);
  onChange();
}

/** Delete the cell's row (removes the whole table if it was the last row). */
export function deleteRow(cell: HTMLElement, editor: HTMLElement | null, onChange: Onchange): void {
  const row = cell.closest('tr');
  const table = cell.closest('table') as HTMLTableElement | null;
  if (!row || !table) return;
  if (table.querySelectorAll('tr').length <= 1) { deleteTable(table, editor, onChange); return; }
  const cells = allCells(table);
  const idx = cells.indexOf(cell);
  row.remove();
  const rest = allCells(table);
  if (rest.length) placeCaret(rest[Math.min(idx, rest.length - 1)]);
  onChange();
}

/** Delete the cell's column (removes the whole table if it was the last one). */
export function deleteColumn(cell: HTMLElement, editor: HTMLElement | null, onChange: Onchange): void {
  const table = cell.closest('table') as HTMLTableElement | null;
  if (!table) return;
  const col = colIndexOf(cell);
  const firstRow = table.querySelector('tr');
  if (!firstRow || firstRow.children.length <= 1) { deleteTable(table, editor, onChange); return; }
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    const target = row.children[col];
    if (target) target.remove();
  }
  onChange();
}

export function isTableEmpty(table: HTMLTableElement): boolean {
  return allCells(table).every((c) => c.textContent?.trim() === '');
}

/** Remove the whole table, leaving an empty paragraph with the caret in it. */
export function deleteTable(table: HTMLTableElement, editor: HTMLElement | null, onChange: Onchange): void {
  const p = document.createElement('p');
  p.innerHTML = '<br>';
  table.parentElement?.replaceChild(p, table);
  placeCaret(p);
  onChange();
  void editor;
}
