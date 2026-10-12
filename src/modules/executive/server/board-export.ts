import 'server-only';

import type { AgencyContext } from '@/lib/auth/context';
import { localized, type Locale } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { boardModel } from '@/modules/executive/board';
import type { KpiUnit } from '@/modules/executive/catalog';
import { executiveKit } from '@/modules/executive/kit';
import { boardReportHtml } from '@/modules/executive/server/board-html';
import { getExecutiveReport } from '@/modules/executive/server/data';
import { htmlToPdf } from '@/modules/executive/server/pdf';
import { boardPptx } from '@/modules/executive/server/pptx';
import { boardXlsx } from '@/modules/executive/server/xlsx';
import { formatValue } from '@/modules/executive/text';
import type { ExecutiveViewConfig } from '@/modules/executive/types';

export const boardFormats = ['pdf', 'pptx', 'xlsx'] as const;
export type BoardFormat = (typeof boardFormats)[number];

export const contentTypes: Record<BoardFormat, string> = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** The organization's logo as a data URL (public bucket, images only); null when there is none or it can't be read. */
async function logoDataUrl(path: string | null): Promise<string | null> {
  const url = publicAssetUrl(path);
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const type = res.headers.get('content-type')?.split(';')[0] ?? '';
    if (!res.ok || !LOGO_TYPES.has(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > 2_000_000 ? null : `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

export type BoardFile = { data: Buffer; filename: string; contentType: string; report: Awaited<ReturnType<typeof getExecutiveReport>> };

/**
 * One board report file for a view, read as `ctx` (RLS): the same numbers as the Executive Center. The PDF is
 * server-rendered HTML printed by headless Chromium; PowerPoint and Excel are built from the same model.
 */
export async function renderBoardFile(
  ctx: AgencyContext,
  config: ExecutiveViewConfig,
  format: BoardFormat,
  locale: Locale,
): Promise<BoardFile> {
  const report = await getExecutiveReport(ctx, config);
  const kit = executiveKit(locale, ctx.organization.defaultTimezone);
  const { t } = kit;
  const organization = localized(ctx.organization.name, locale);
  const model = boardModel(kit, report, { organization, generatedAt: new Date() });
  const brandColor = ctx.organization.brand?.primaryColor ?? '#4f46e5';
  const filename = `board-report-${report.period.from}-${report.period.to}.${format}`;
  let data: Buffer;
  if (format === 'pdf') {
    const html = await boardReportHtml(model, {
      logoDataUrl: await logoDataUrl(ctx.organization.logoPath),
      brandColor,
      labels: {
        confidential: t('board.confidential'),
        brief: t('brief.title'),
        attention: t('attention.title'),
        filters: t('board.filters'),
        empty: t('board.noRows'),
      },
      formatTick: (unit: KpiUnit) => (v: number) => formatValue(kit, unit, v, { compact: true }),
    });
    data = await htmlToPdf(html, { left: `${organization} · ${model.title} · ${t('board.confidential')}`, dir: model.dir });
  } else if (format === 'pptx') {
    data = await boardPptx(model, {
      logoDataUrl: await logoDataUrl(ctx.organization.logoPath),
      brandColor,
      labels: {
        brief: t('brief.title'),
        attention: t('attention.title'),
        indicator: t('board.indicator'),
        value: t('board.value'),
        change: t('board.change'),
        target: t('board.target'),
        empty: t('board.noRows'),
      },
    });
  } else {
    data = await boardXlsx(model, {
      kpis: t('board.sheetKpis'),
      indicator: t('board.indicator'),
      value: t('board.value'),
      change: t('board.change'),
      target: t('board.target'),
      progress: t('board.progress'),
    });
  }
  return { data, filename, contentType: contentTypes[format], report };
}
