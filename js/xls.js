// Выгрузка в Excel: библиотека SheetJS подгружается только при нажатии кнопки
const LIB_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
let libPromise = null;
function loadLib() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!libPromise) libPromise = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = LIB_URL;
    s.onload = () => (window.XLSX ? res(window.XLSX) : rej(new Error('библиотека Excel не загрузилась')));
    s.onerror = () => { libPromise = null; s.remove(); rej(new Error('библиотека Excel не загрузилась, проверьте интернет')); };
    document.head.appendChild(s);
  });
  return libPromise;
}

const NUM = '#,##0.00;-#,##0.00;"-"', PCT = '0.0%', DATE = 'dd.mm.yyyy';
const clean = t => String(t ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

// «1 234,5» → 1234.5; «-» → 0; «12,3%» → 0.123 (процент). Не число → null
export function parseCell(text) {
  let t = clean(text).replace(/ /g, '');
  if (t === '') return null;
  if (t === '-') return { v: 0 };
  const pct = t.endsWith('%'); if (pct) t = t.slice(0, -1);
  t = t.replace(',', '.').replace(/^−/, '-');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const v = Number(t);
  return pct ? { v: v / 100, pct: true } : { v };
}

// Строки листа: массив строк, каждая ячейка { v, z? } или строка
function tableRows(table) {
  const head = [...(table.tHead?.rows[0]?.cells || [])];
  const skip = head.map(h => clean(h.textContent) === '');          // колонка с кнопками
  const out = [head.filter((_, i) => !skip[i]).map(h => clean(h.textContent))];
  for (const tr of table.tBodies[0]?.rows || []) {
    const cells = [...tr.cells];
    if (cells.length === 1 && cells[0].colSpan > 1) { out.push([clean(cells[0].textContent)]); continue; }  // раздел или «нет данных»
    const indent = tr.classList.contains('article');          // статья внутри группы: с отступом, как на экране
    out.push(cells.filter((_, i) => !skip[i]).map((td, i) => {
      const txt = clean(td.textContent);
      if (i === 0 && indent) return '    ' + txt;
      if (td.classList.contains('num')) { const p = parseCell(txt); if (p) return { v: p.v, z: p.pct ? PCT : NUM }; }
      return txt;
    }));
  }
  return out;
}
function summaryRows(el) {
  return [...el.querySelectorAll(':scope > span')].map(s => {
    const b = s.querySelector('b'); if (!b) return [clean(s.textContent)];
    const label = clean(s.textContent.slice(0, s.textContent.lastIndexOf(b.textContent))).replace(/:$/, '');
    const p = parseCell(b.textContent);
    return [label, p ? { v: p.v, z: p.pct ? PCT : NUM } : clean(b.textContent)];
  });
}
// Собирает всё, что видно на вкладке: заголовки, итоги и таблицы, в порядке появления
export function rowsFromScreen(root) {
  const rows = [];
  root.querySelectorAll('.card').forEach(card => {
    card.querySelectorAll('h3, .summary, table').forEach(el => {
      if (el.tagName === 'H3') { if (rows.length) rows.push([]); rows.push([clean(el.textContent)]); }
      else if (el.tagName === 'TABLE') { rows.push(...tableRows(el)); }
      else rows.push(...summaryRows(el));
    });
  });
  return rows;
}

// meta: строки шапки (название, филиал, период); rows: строки таблицы
export async function downloadXlsx(fileName, sheetName, meta, rows) {
  const XLSX = await loadLib();
  const all = [...meta.map(m => [m]), [], ...rows];
  const plain = all.map(r => r.map(c => (c && typeof c === 'object' && !(c instanceof Date) ? c.v : c)));
  const ws = XLSX.utils.aoa_to_sheet(plain, { cellDates: true });
  let widths = [];
  all.forEach((r, R) => r.forEach((c, C) => {
    const ref = XLSX.utils.encode_cell({ r: R, c: C }), cell = ws[ref];
    if (!cell) return;
    if (c instanceof Date) cell.z = DATE;
    else if (c && typeof c === 'object' && c.z) cell.z = c.z;
    else if (typeof c === 'number') cell.z = NUM;
    if (R >= meta.length + 1) {               // ширину считаем только по таблице
      const len = c instanceof Date ? 10 : typeof c === 'object' && c ? 14 : String(c ?? '').length;
      widths[C] = Math.min(Math.max(widths[C] || 8, len + 2), 70);
    }
  }));
  ws['!cols'] = widths.map(w => ({ wch: w || 10 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, fileName.replace(/[\\/:*?"<>|]+/g, ' ').trim());
}
