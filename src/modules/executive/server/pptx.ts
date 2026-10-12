import 'server-only';

import type { BoardModel } from '@/modules/executive/board';

/**
 * The board report as PowerPoint (FR7): a title slide with the brief and what needs attention, then one slide per tab
 * with its KPIs, a native (editable) chart and the key table. Right-to-left text for Arabic; Arial renders Arabic in
 * every Office install.
 */
export async function boardPptx(
  m: BoardModel,
  opts: {
    logoDataUrl: string | null;
    brandColor: string;
    labels: { brief: string; attention: string; indicator: string; value: string; change: string; target: string; empty: string };
  },
): Promise<Buffer> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.rtlMode = m.dir === 'rtl';
  pptx.title = `${m.organization} — ${m.title}`;
  pptx.company = m.organization;
  const rtl = m.dir === 'rtl';
  const brand = (/^#([0-9a-f]{6})$/i.exec(opts.brandColor)?.[1] ?? '4F46E5').toUpperCase();
  const font = 'Arial';
  const text = {
    fontFace: font,
    rtlMode: rtl,
    lang: m.locale === 'ar' ? 'ar-SA' : 'en-US',
    align: (rtl ? 'right' : 'left') as 'right' | 'left',
  };

  const cover = pptx.addSlide();
  if (opts.logoDataUrl)
    cover.addImage({ data: opts.logoDataUrl, x: rtl ? 11.2 : 0.5, y: 0.4, w: 1.6, h: 0.8, sizing: { type: 'contain', w: 1.6, h: 0.8 } });
  cover.addText(m.organization, { ...text, x: 0.5, y: 1.3, w: 12.3, h: 0.4, fontSize: 16, bold: true, color: '374151' });
  cover.addText(m.title, { ...text, x: 0.5, y: 1.7, w: 12.3, h: 0.8, fontSize: 36, bold: true, color: brand });
  cover.addText([m.period, m.comparison, ...m.filters].filter(Boolean).join('\n'), {
    ...text,
    x: 0.5,
    y: 2.5,
    w: 12.3,
    h: 0.9,
    fontSize: 13,
    color: '4B5563',
  });
  cover.addText(opts.labels.brief, { ...text, x: rtl ? 6.9 : 0.5, y: 3.5, w: 5.9, h: 0.4, fontSize: 14, bold: true });
  cover.addText(
    m.brief.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
    { ...text, x: rtl ? 6.9 : 0.5, y: 3.9, w: 5.9, h: 3.2, fontSize: 11, valign: 'top', color: '111827' },
  );
  cover.addText(opts.labels.attention, { ...text, x: rtl ? 0.5 : 6.9, y: 3.5, w: 5.9, h: 0.4, fontSize: 14, bold: true });
  cover.addText(
    m.attention.length ? m.attention.map((a) => ({ text: a, options: { bullet: true, breakLine: true } })) : opts.labels.empty,
    {
      ...text,
      x: rtl ? 0.5 : 6.9,
      y: 3.9,
      w: 5.9,
      h: 3.2,
      fontSize: 11,
      valign: 'top',
      color: '111827',
    },
  );
  cover.addText(m.generatedAt, { ...text, x: 0.5, y: 7.0, w: 12.3, h: 0.3, fontSize: 9, color: '9CA3AF' });

  for (const s of m.slides) {
    const slide = pptx.addSlide();
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.08, fill: { color: brand }, line: { color: brand } });
    slide.addText(s.title, { ...text, x: 0.5, y: 0.25, w: 9, h: 0.6, fontSize: 24, bold: true, color: '111827' });
    slide.addText(m.period, { ...text, x: 0.5, y: 0.8, w: 12.3, h: 0.3, fontSize: 11, color: '6B7280' });
    const hasVisual = s.charts.length > 0 || s.tables.length > 0;
    const tableW = hasVisual ? 5.6 : 12.3;
    const header = [opts.labels.indicator, opts.labels.value, opts.labels.change, opts.labels.target].map((h) => ({
      text: h,
      options: { bold: true, color: '6B7280', fontSize: 10, ...text },
    }));
    const rows = s.kpis.map((k) => [
      { text: k.name, options: { fontSize: 10, ...text } },
      { text: k.value, options: { fontSize: 11, bold: true, ...text } },
      {
        text: k.delta ?? '—',
        options: { fontSize: 10, color: k.tone === 'good' ? '15803D' : k.tone === 'bad' ? 'B91C1C' : '6B7280', ...text },
      },
      { text: k.target ? `${k.target}${k.progress ? ` · ${k.progress}` : ''}` : '—', options: { fontSize: 9, color: '6B7280', ...text } },
    ]);
    slide.addTable([header, ...rows], {
      x: rtl ? 13.33 - 0.5 - tableW : 0.5,
      y: 1.2,
      w: tableW,
      colW: [tableW * 0.4, tableW * 0.2, tableW * 0.2, tableW * 0.2],
      border: { type: 'solid', pt: 0.5, color: 'E5E7EB' },
      rowH: 0.3,
      autoPage: false,
    });
    const vx = rtl ? 0.5 : 6.4;
    const chart = s.charts[0];
    if (chart && chart.labels.length) {
      slide.addChart(
        pptx.ChartType.line,
        chart.series.map((x) => ({
          name: x.name,
          labels: chart.labels,
          values: x.values.map((v) => (chart.unit === 'currency' ? Math.round(v / 100) : v)),
        })),
        {
          x: vx,
          y: 1.2,
          w: 6.4,
          h: 3.1,
          showTitle: true,
          title: chart.title,
          titleFontFace: font,
          titleFontSize: 12,
          showLegend: chart.series.length > 1,
          legendPos: 'b',
          legendFontFace: font,
          catAxisLabelFontFace: font,
          catAxisLabelFontSize: 8,
          valAxisLabelFontFace: font,
          valAxisLabelFontSize: 8,
          // pptxgenjs supports 'maxMin' (time running right → left) but its type only lists the default.
          catAxisOrientation: (rtl ? 'maxMin' : 'minMax') as 'minMax',
          valAxisLabelFormatCode: '#,##0',
          lineSize: 2,
          lineDataSymbol: 'none',
          chartColors: [brand, '0D9488', 'D97706', 'DB2777'],
        },
      );
    }
    const tb = s.tables[0];
    if (tb) {
      const y = chart ? 4.45 : 1.2;
      slide.addText(tb.title, { ...text, x: vx, y, w: 6.4, h: 0.3, fontSize: 12, bold: true });
      const body = tb.rows.slice(0, chart ? 6 : 14);
      slide.addTable(
        [
          tb.head.map((h) => ({ text: h, options: { bold: true, color: '6B7280', fontSize: 9, ...text } })),
          ...(body.length ? body : [[opts.labels.empty, ...tb.head.slice(1).map(() => '')]]).map((r) =>
            r.map((c, i) => ({
              text: c,
              options: { fontSize: 9, ...text, align: (tb.numeric[i] ? (rtl ? 'left' : 'right') : text.align) as 'left' | 'right' },
            })),
          ),
        ],
        { x: vx, y: y + 0.32, w: 6.4, border: { type: 'solid', pt: 0.5, color: 'E5E7EB' }, rowH: 0.26, autoPage: false },
      );
    }
  }
  const out = await pptx.write({ outputType: 'nodebuffer' });
  return out as Buffer;
}
