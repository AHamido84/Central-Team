import { NextResponse } from 'next/server';

import { getAppContext } from '@/lib/auth/context';
import { buildBackup } from '@/modules/data/server/backup';

export const dynamic = 'force-dynamic';

/** Backup ZIP download for the organization's Super Admin (ADR-081). */
export async function GET() {
  const ctx = await getAppContext();
  if (!ctx || ctx.side !== 'agency' || !ctx.isSuperAdmin) return new NextResponse(null, { status: 403 });
  const zip = await buildBackup(ctx.organization.id, ctx.session.userId);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(zip), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="backup-${ctx.organization.slug}-${stamp}.zip"`,
      'cache-control': 'no-store',
    },
  });
}
