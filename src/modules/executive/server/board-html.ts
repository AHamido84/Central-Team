import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { BoardChart, BoardKpi, BoardModel, BoardTable } from '@/modules/executive/board';

/**
 * The board report as a self-contained HTML document for headless Chromium (FR7, ADR-097): fonts embedded (the
 * Lambda Chromium has no Arabic fonts), charts as inline SVG, one section per page, `dir` from the locale so Arabic
 * is shaped and laid out by the browser engine itself (ADR-049's reason for browser printing still holds).
 */

const FONT_DIR = path.join(process.cwd(), 'node_modules/@fontsource/ibm-plex-sans-arabic/files');
let fontCss: Promise<string> | null = null;

function loadFonts(): Promise<string> {
  fontCss ??= (async () => {
    const faces = await Promise.all(
      (['arabic', 'latin'] as const).flatMap((subset) =>
        ([400, 600] as const).map(async (weight) => {
          const data = await readFile(path.join(FONT_DIR, `ibm-plex-sans-arabic-${subset}-${weight}-normal.woff2`));
          const range =
            subset === 'arabic'
              ? 'U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF, U+200C-200F, U+066A-066D'
              : 'U+0000-024F, U+2000-206F, U+20AC, U+2212, U+00D7';
          return `@font-face{font-family:'Plex';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2');unicode-range:${range};}`;
        }),
      ),
    );
    return faces.join('\n');
  })().catch((error) => {
    fontCss = null;
    throw error;
  });
  return fontCss;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PALETTE = ['#4f46e5', '#0d9488', '#d97706', '#db2777', '#2563eb', '#65a30d'];

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const n = max / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

/** A line chart; time runs in the reading direction (right → left in Arabic). */
export function chartSvg(c: BoardChart, rtl: boolean, formatTick: (v: number) => string): string {
  // Wide and short: an A4 landscape page fits the KPIs, one chart and a table.
  const w = 1000;
  const h = 180;
  const pad = { top: 10, bottom: 26, axis: 76, side: 44 };
  const plotW = w - pad.axis - pad.side;
  const plotH = h - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...c.series.flatMap((s) => s.values)));
  const n = c.labels.length;
  const x0 = rtl ? w - pad.axis : pad.axis;
  const px = (i: number) => {
    const d = n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW;
    return rtl ? x0 - d : x0 + d;
  };
  const py = (v: number) => pad.top + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.max(1, Math.ceil(n / 6));
  const grid = ticks
    .map(
      (v) =>
        `<line x1="${rtl ? x0 - plotW : x0}" x2="${rtl ? x0 : x0 + plotW}" y1="${py(v)}" y2="${py(v)}" stroke="#e5e7eb"/><text x="${rtl ? x0 + 8 : x0 - 8}" y="${py(v) + 4}" font-size="10" fill="#6b7280" text-anchor="${rtl ? 'start' : 'end'}">${esc(formatTick(v))}</text>`,
    )
    .join('');
  const labels = c.labels
    .map((l, i) =>
      i % every === 0 || i === n - 1
        ? `<text x="${px(i)}" y="${h - 8}" font-size="10" fill="#6b7280" text-anchor="middle">${esc(l)}</text>`
        : '',
    )
    .join('');
  const lines = c.series
    .map((s, si) => {
      const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join('');
      return `<path d="${d}" fill="none" stroke="${PALETTE[si % PALETTE.length]}" stroke-width="2" stroke-linejoin="round"/>`;
    })
    .join('');
  const legend =
    c.series.length > 1
      ? `<div class="legend">${c.series.map((s, i) => `<span><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(s.name)}</span>`).join('')}</div>`
      : '';
  return `<figure class="chart"><figcaption>${esc(c.title)}</figcaption><svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(c.title)}">${grid}${labels}${lines}</svg>${legend}</figure>`;
}

function kpiGrid(kpis: BoardKpi[]): string {
  return `<div class="kpis">${kpis
    .map(
      (k) =>
        `<div class="kpi"><div class="name">${esc(k.name)}</div><div class="value">${esc(k.value)}</div>${
          k.delta ? `<div class="delta ${k.tone}">${esc(k.delta)}</div>` : ''
        }${k.target ? `<div class="target">${esc(k.target)}${k.progress ? ` · ${esc(k.progress)}` : ''}</div>` : ''}</div>`,
    )
    .join('')}</div>`;
}

function table(tb: BoardTable, empty: string): string {
  if (!tb.rows.length) return `<section class="table"><h3>${esc(tb.title)}</h3><p class="muted">${esc(empty)}</p></section>`;
  const head = tb.head.map((h, i) => `<th class="${tb.numeric[i] ? 'num' : ''}">${esc(h)}</th>`).join('');
  const rows = tb.rows
    .map((r) => `<tr>${r.map((c, i) => `<td class="${tb.numeric[i] ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<section class="table"><h3>${esc(tb.title)}</h3><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></section>`;
}

export async function boardReportHtml(
  m: BoardModel,
  opts: {
    logoDataUrl: string | null;
    brandColor: string;
    labels: { confidential: string; brief: string; attention: string; filters: string; empty: string };
    formatTick: (unit: BoardChart['unit']) => (v: number) => string;
  },
): Promise<string> {
  const fonts = await loadFonts();
  const rtl = m.dir === 'rtl';
  const brand = /^#[0-9a-f]{6}$/i.test(opts.brandColor) ? opts.brandColor : '#4f46e5';
  const cover = `<section class="page cover">
    ${opts.logoDataUrl ? `<img class="logo" src="${opts.logoDataUrl}" alt=""/>` : ''}
    <p class="org">${esc(m.organization)}</p>
    <h1>${esc(m.title)}</h1>
    <p class="period">${esc(m.period)}</p>
    ${m.comparison ? `<p class="muted">${esc(m.comparison)}</p>` : ''}
    ${m.filters.length ? `<p class="muted">${esc(opts.labels.filters)}: ${esc(m.filters.join(' · '))}</p>` : ''}
    <div class="two">
      <section><h3>${esc(opts.labels.brief)}</h3><ul>${m.brief.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></section>
      <section><h3>${esc(opts.labels.attention)}</h3>${m.attention.length ? `<ul>${m.attention.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : `<p class="muted">${esc(opts.labels.empty)}</p>`}</section>
    </div>
    <p class="foot">${esc(m.generatedAt)} · ${esc(opts.labels.confidential)}</p>
  </section>`;
  const pages = m.slides
    .map(
      (s) => `<section class="page">
    <header><span>${esc(m.organization)} · ${esc(m.title)}</span><span>${esc(m.period)}</span></header>
    <h2>${esc(s.title)}</h2>
    ${kpiGrid(s.kpis)}
    ${s.charts.map((c) => chartSvg(c, rtl, opts.formatTick(c.unit))).join('')}
    ${s.tables.map((tb) => table(tb, opts.labels.empty)).join('')}
  </section>`,
    )
    .join('');
  return `<!doctype html><html lang="${m.locale}" dir="${m.dir}"><head><meta charset="utf-8"/><title>${esc(m.title)}</title><style>
${fonts}
@page{size:A4 landscape;margin:14mm 14mm 16mm}
*{box-sizing:border-box}
body{font-family:'Plex',Arial,sans-serif;color:#111827;font-size:11px;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{page-break-after:always;break-after:page}
.page:last-child{page-break-after:auto;break-after:auto}
header{display:flex;justify-content:space-between;color:#6b7280;font-size:9px;border-bottom:2px solid ${brand};padding-bottom:4px;margin-bottom:10px}
h1{font-size:30px;margin:6px 0 4px;color:${brand}}
h2{font-size:18px;margin:0 0 10px}
h3{font-size:12px;margin:12px 0 6px}
.cover .org{font-weight:600;font-size:14px;margin:0}
.cover .period{font-size:14px;margin:4px 0}
.logo{max-height:48px;max-width:180px;margin-bottom:12px}
.muted{color:#6b7280}
.two{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:18px}
ul{margin:0;padding-inline-start:16px}li{margin-bottom:4px;line-height:1.5}
.foot{margin-top:28px;color:#9ca3af;font-size:9px}
.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:10px}
.kpi{border:1px solid #e5e7eb;border-radius:8px;padding:8px;break-inside:avoid}
.kpi .name{color:#6b7280;font-size:10px;min-height:26px}
.kpi .value{font-size:17px;font-weight:600;margin-top:2px;font-variant-numeric:tabular-nums}
.kpi .delta{font-size:10px;margin-top:2px}.good{color:#15803d}.bad{color:#b91c1c}.flat{color:#6b7280}
.kpi .target{font-size:9px;color:#6b7280;margin-top:2px}
.chart{margin:6px 0 4px;break-inside:avoid}.chart figcaption{font-weight:600;font-size:11px;margin-bottom:4px}
.legend{display:flex;gap:12px;font-size:10px;color:#4b5563}.legend i{display:inline-block;width:10px;height:3px;margin-inline-end:4px;vertical-align:middle}
table{width:100%;border-collapse:collapse;font-size:10px}th,td{padding:4px 6px;border-bottom:1px solid #f3f4f6;text-align:start}
th{color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb}.num{text-align:end;font-variant-numeric:tabular-nums}
.table{break-inside:avoid}
</style></head><body>${cover}${pages}</body></html>`;
}
