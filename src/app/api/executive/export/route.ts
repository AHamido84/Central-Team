import { getLocale } from 'next-intl/server';

import { getAppContext } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseViewConfig } from '@/modules/executive/config';
import { logExecutiveEvent } from '@/modules/executive/server/audit';
import { boardFormats, renderBoardFile, type BoardFormat } from '@/modules/executive/server/board-export';

export const runtime = 'nodejs';
// Headless Chromium needs a few seconds on a cold start.
export const maxDuration = 60;

/** Board report download (FR7): PDF, PowerPoint or Excel of the view in the query string. Audited. */
export async function GET(request: Request) {
  const ctx = await getAppContext();
  if (!ctx) return new Response(null, { status: 401 });
  if (ctx.side !== 'agency' || !can(ctx.permissions, 'executive:export')) return new Response(null, { status: 403 });
  const url = new URL(request.url);
  const format = boardFormats.find((f) => f === url.searchParams.get('format')) as BoardFormat | undefined;
  if (!format) return new Response(null, { status: 400 });
  if (!(await checkRateLimit(`executive_export:${ctx.session.userId}`, 20, 300))) return new Response(null, { status: 429 });
  const config = parseViewConfig(url.searchParams);
  const locale = (await getLocale()) === 'en' ? 'en' : 'ar';
  try {
    const file = await renderBoardFile(ctx, config, format, locale);
    await logExecutiveEvent(
      'executive_export',
      { format, tab: config.tab, preset: config.preset, from: file.report.period.from, to: file.report.period.to, filters: config.filters },
      ctx.session,
    );
    return new Response(new Uint8Array(file.data), {
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[executive] export failed', error);
    return new Response(null, { status: 500 });
  }
}
