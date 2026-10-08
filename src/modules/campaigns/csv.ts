/**
 * CSV import of ad-platform exports (Meta Ads Manager, TikTok Ads, Snapchat Ads, Google Ads) into daily metrics.
 * Pure and dependency-free: the browser parses and previews, the server re-validates the parsed rows (Zod).
 * Exports differ in delimiter, header wording, number formatting, date format and extra rows (report titles,
 * totals), so detection is by header synonyms and every value goes through a tolerant parser.
 */
import { IMPORT_MAX_ROWS, type BaseMetric, type ImportPreset } from '@/modules/campaigns/constants';

export type ColumnMapping = Partial<Record<'date' | BaseMetric, number>>;

export type ParsedMetricRow = { date: string } & Record<BaseMetric, number>;

export type DateOrder = 'ymd' | 'dmy' | 'mdy';

export type CsvParseResult = {
  preset: ImportPreset;
  headers: string[];
  mapping: ColumnMapping;
  dateOrder: DateOrder;
  /** One row per day (rows of the same day — e.g. one per ad set — are summed). */
  rows: ParsedMetricRow[];
  /** Data rows skipped because the date column wasn't a date (totals, blank lines). */
  skipped: number;
  errors: { line: number; code: 'invalid_number' | 'too_many_rows' }[];
  /**
   * Set when rows are totals for a period (start ≠ end), e.g. an Ads Manager export without "Breakdown → Day". Their
   * numbers are not daily, so nothing is imported (ADR-095); the preview explains how to export by day.
   */
  period: { from: string; to: string; rows: number; totals: Record<BaseMetric, number> } | null;
};

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

function detectDelimiter(sample: string): string {
  const lines = sample.split(/\r?\n/).slice(0, 12);
  let best = ',';
  let bestScore = -1;
  for (const d of [',', ';', '\t']) {
    // Consistent, non-trivial column counts win (quoted delimiters are rare enough in these exports' first lines).
    const counts = lines.map((l) => l.split(d).length).filter((n) => n > 1);
    const score = counts.length ? Math.min(...counts) * counts.length : 0;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF/LF, BOM. */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, '');
  const delimiter = detectDelimiter(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

// ---------------------------------------------------------------------------
// Header detection
// ---------------------------------------------------------------------------

const norm = (h: string) => h.toLowerCase().replace(/\s+/g, ' ').replace(/[“”"]/g, '').trim();

type Synonyms = Record<'date' | BaseMetric, readonly (string | RegExp)[]>;

/** Header wording per column, most specific first. Shared by every preset; presets only differ in distinctive headers. */
const synonyms: Synonyms = {
  date: ['day', 'date', 'reporting starts', 'start time', 'by day', 'stat time day', /^date\b/, 'التاريخ', 'اليوم'],
  impressions: ['impressions', 'impr.', 'paid impressions', 'impr', 'مرات الظهور'],
  reach: ['reach', 'uniques', 'paid reach', 'الوصول'],
  clicks: ['link clicks', 'clicks (destination)', 'swipe ups', 'swipes', 'clicks', 'clicks (all)', 'النقرات'],
  spend: [/^amount spent/, 'cost', 'spend', 'total cost', /^cost \(/, /^spend \(/, 'المبلغ المنفق', 'التكلفة'],
  conversions: ['results', 'conversions', 'purchases', 'total conversions', 'conversions (all)', 'التحويلات', 'النتائج'],
  leads: ['leads', 'form submissions', 'lead form submissions', 'sign ups', 'العملاء المحتملون'],
  video_views: ['3-second video plays', 'thruplays', 'video views', 'views', '2-second video views', 'مشاهدات الفيديو'],
  engagements: ['post engagement', 'engagements', 'interactions', 'التفاعل'],
  revenue: [
    'purchases conversion value',
    'website purchases conversion value',
    'conv. value',
    'conversion value',
    'total purchase value',
    'purchases value',
    'total complete payment value',
    'الإيرادات',
  ],
};

/** The end of a row's period, next to its start ("Reporting starts / ends", "Start / End time"). */
const endSynonyms: readonly (string | RegExp)[] = ['reporting ends', 'end time', 'end date', 'stat time end', /^end\b/, 'تاريخ الانتهاء'];

/** Headers that only one platform uses. */
const distinctive: Record<Exclude<ImportPreset, 'custom'>, readonly (string | RegExp)[]> = {
  meta: [/^amount spent/, 'reporting starts', 'thruplays', 'link clicks', 'post engagement', '3-second video plays'],
  tiktok: ['clicks (destination)', 'total complete payment value', 'stat time day', 'by day'],
  snapchat: ['swipe ups', 'paid impressions', 'start time', 'uniques'],
  google: ['impr.', 'conv. value', 'interactions', 'avg. cpc'],
};

const matches = (header: string, pattern: string | RegExp) => (typeof pattern === 'string' ? header === pattern : pattern.test(header));

export function mapHeaders(headers: readonly string[]): ColumnMapping {
  const normalized = headers.map(norm);
  const mapping: ColumnMapping = {};
  const taken = new Set<number>();
  for (const key of Object.keys(synonyms) as (keyof Synonyms)[]) {
    for (const pattern of synonyms[key]) {
      const idx = normalized.findIndex((h, i) => !taken.has(i) && matches(h, pattern));
      if (idx >= 0) {
        mapping[key] = idx;
        taken.add(idx);
        break;
      }
    }
  }
  return mapping;
}

export function detectPreset(headers: readonly string[]): ImportPreset {
  const normalized = headers.map(norm);
  let best: ImportPreset = 'custom';
  let bestScore = 0;
  for (const [preset, patterns] of Object.entries(distinctive) as [Exclude<ImportPreset, 'custom'>, readonly (string | RegExp)[]][]) {
    const score = patterns.filter((p) => normalized.some((h) => matches(h, p))).length;
    if (score > bestScore) {
      best = preset;
      bestScore = score;
    }
  }
  return best;
}

/** Google Ads puts a report title and date range above the header row; take the first row that maps ≥ 3 columns incl. a date. */
function findHeaderRow(table: string[][]): number {
  for (let i = 0; i < Math.min(table.length, 10); i++) {
    const m = mapHeaders(table[i]!);
    if (m.date !== undefined && Object.keys(m).length >= 3) return i;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** Arabic-Indic (٠–٩) and Persian (۰–۹) digits → Latin, so exports from Arabic-locale accounts parse too. */
const toLatin = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/**
 * "1,234.56", "1.234,56", "SAR 1,234", "12%", "—", "" → number (NaN when it isn't one). Empty/dash → 0: exports
 * leave cells blank for "none".
 */
export function parseNumber(raw: string | undefined): number {
  if (raw === undefined) return 0;
  let s = toLatin(raw).trim().replace(/[٬]/g, ',').replace(/[٫]/g, '.');
  if (s === '' || s === '-' || s === '—' || s === '--') return 0;
  s = s.replace(/[^\d.,\-]/g, '');
  if (s === '') return Number.NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    // Decimal comma if exactly 1–2 digits follow the last comma ("1.234,56"); otherwise thousands separators.
    s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

const months: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Parses one date cell to ISO, or null. Numeric day/month order comes from `order` (see `detectDateOrder`). */
export function parseDate(raw: string, order: DateOrder): string | null {
  const s = toLatin(raw).trim();
  // "2026-09-01", "2026/09/01", "2026-09-01 00:00:00" (Snapchat start time)
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  // "01/09/2026", "9/1/26"
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return order === 'mdy' ? validDate(y, a, b) : validDate(y, b, a);
  }
  // "Sep 1, 2026", "1 Sep 2026", "Tue, Sep 1, 2026"
  m = /([a-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/i.exec(s);
  if (m && months[m[1]!.toLowerCase()]) return validDate(Number(m[3]), months[m[1]!.toLowerCase()]!, Number(m[2]));
  m = /(\d{1,2}) ([a-z]{3})[a-z]*\.?,? (\d{4})/i.exec(s);
  if (m && months[m[2]!.toLowerCase()]) return validDate(Number(m[3]), months[m[2]!.toLowerCase()]!, Number(m[1]));
  return null;
}

/**
 * Day/month order for numeric dates: a first part above 12 means day-first, a second part above 12 month-first;
 * otherwise day-first (the Saudi convention) unless the export is from a US-default platform (Google/Snapchat).
 */
export function detectDateOrder(values: readonly string[], preset: ImportPreset): DateOrder {
  let dayFirst = false;
  let monthFirst = false;
  for (const v of values) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(toLatin(v).trim());
    if (!m) {
      if (/^\d{4}[-/.]/.test(v.trim())) return 'ymd';
      continue;
    }
    if (Number(m[1]) > 12) dayFirst = true;
    if (Number(m[2]) > 12) monthFirst = true;
  }
  if (dayFirst && !monthFirst) return 'dmy';
  if (monthFirst && !dayFirst) return 'mdy';
  return preset === 'google' || preset === 'snapchat' ? 'mdy' : 'dmy';
}

const moneyKeys: readonly BaseMetric[] = ['spend', 'revenue'];

const zeroMetrics = (): Record<BaseMetric, number> => ({
  impressions: 0,
  reach: 0,
  clicks: 0,
  spend: 0,
  conversions: 0,
  leads: 0,
  video_views: 0,
  engagements: 0,
  revenue: 0,
});

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parses a whole export. `override` lets the user fix the detected mapping; money columns are in major units
 * (SAR) in exports and come out in minor units (halalas).
 */
export function parseMetricsCsv(text: string, override?: { mapping?: ColumnMapping; dateOrder?: DateOrder }): CsvParseResult {
  const table = parseCsv(text);
  const headerIdx = findHeaderRow(table);
  const headers = (table[headerIdx] ?? []).map((h) => h.trim());
  const preset = detectPreset(headers);
  const mapping = override?.mapping ?? mapHeaders(headers);
  const body = table.slice(headerIdx + 1);
  const dateCol = mapping.date;
  const dateOrder = override?.dateOrder ?? detectDateOrder(dateCol === undefined ? [] : body.map((r) => r[dateCol] ?? ''), preset);
  const normalized = headers.map(norm);
  const endCol = endSynonyms.map((p) => normalized.findIndex((h, i) => i !== dateCol && matches(h, p))).find((i) => i >= 0);
  let period: CsvParseResult['period'] = null;

  const byDay = new Map<string, ParsedMetricRow>();
  const errors: CsvParseResult['errors'] = [];
  let skipped = 0;
  body.forEach((cells, i) => {
    const line = headerIdx + i + 2;
    const date = dateCol === undefined ? null : parseDate(cells[dateCol] ?? '', dateOrder);
    if (!date) {
      skipped++;
      return;
    }
    const end = endCol === undefined ? null : parseDate(cells[endCol] ?? '', dateOrder);
    const isPeriod = end !== null && end !== date;
    if (isPeriod) {
      period ??= { from: date, to: end, rows: 0, totals: zeroMetrics() };
      period.rows++;
      if (date < period.from) period.from = date;
      if (end > period.to) period.to = end;
    }
    const row = isPeriod
      ? ({ date, ...period!.totals } as ParsedMetricRow)
      : (byDay.get(date) ?? ({ date, ...zeroMetrics() } as ParsedMetricRow));
    let bad = false;
    for (const key of Object.keys(mapping) as (keyof ColumnMapping)[]) {
      if (key === 'date') continue;
      const col = mapping[key]!;
      const value = parseNumber(cells[col]);
      if (Number.isNaN(value) || value < 0) {
        bad = true;
        continue;
      }
      row[key] += moneyKeys.includes(key) ? Math.round(value * 100) : Math.round(value);
    }
    if (bad) errors.push({ line, code: 'invalid_number' });
    if (isPeriod) {
      const { date: _start, ...totals } = row;
      period!.totals = totals;
      return;
    }
    byDay.set(date, row);
  });

  let rows = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (rows.length > IMPORT_MAX_ROWS) {
    errors.push({ line: 0, code: 'too_many_rows' });
    rows = rows.slice(0, IMPORT_MAX_ROWS);
  }
  // Period totals can't be split into days: nothing from this file is imported (the preview explains why).
  if (period) rows = [];
  return { preset, headers, mapping, dateOrder, rows, skipped, errors, period };
}
