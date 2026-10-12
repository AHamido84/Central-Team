import 'server-only';

import type { BoardModel } from '@/modules/executive/board';

/** The board report's tables as Excel (FR7): a KPI sheet, then one sheet per table, numbers kept as numbers. */
export async function boardXlsx(
  m: BoardModel,
  labels: { kpis: string; indicator: string; value: string; change: string; target: string; progress: string },
): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = m.organization;
  wb.created = new Date();
  const rtl = m.dir === 'rtl';
  const sheetName = (name: string, used: Set<string>) => {
    const base = name.replace(/[\\/*?:[\]]/g, ' ').slice(0, 28) || 'Sheet';
    let n = base;
    for (let i = 2; used.has(n); i++) n = `${base.slice(0, 25)} ${i}`;
    used.add(n);
    return n;
  };
  const used = new Set<string>();

  const kpiSheet = wb.addWorksheet(sheetName(labels.kpis, used), { views: [{ rightToLeft: rtl, state: 'frozen', ySplit: 4 }] });
  kpiSheet.addRow([`${m.organization} — ${m.title}`]).font = { bold: true, size: 14 };
  kpiSheet.addRow([m.period, m.comparison ?? '', ...m.filters]);
  kpiSheet.addRow([]);
  const head = kpiSheet.addRow(['', labels.indicator, labels.value, labels.change, labels.target, labels.progress]);
  head.font = { bold: true };
  for (const s of m.slides) {
    for (const k of s.kpis) {
      const raw = k.raw === null ? null : k.unit === 'currency' ? k.raw / 100 : k.raw;
      const row = kpiSheet.addRow([s.title, k.name, raw, k.delta ?? '', k.target ?? '', k.progress ?? '']);
      const cell = row.getCell(3);
      cell.numFmt = k.unit === 'percent' ? '0.0%' : k.unit === 'currency' ? '#,##0 "SAR"' : k.unit === 'count' ? '#,##0' : '#,##0.0';
    }
  }
  kpiSheet.columns.forEach((c, i) => (c.width = [18, 30, 16, 18, 18, 12][i] ?? 14));

  for (const s of m.slides) {
    for (const tb of s.tables) {
      const ws = wb.addWorksheet(sheetName(tb.title, used), { views: [{ rightToLeft: rtl, state: 'frozen', ySplit: 1 }] });
      ws.addRow(tb.head).font = { bold: true };
      for (const r of tb.raw ?? tb.rows) ws.addRow(r);
      ws.columns.forEach((c, i) => (c.width = i === 0 ? 32 : 16));
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
