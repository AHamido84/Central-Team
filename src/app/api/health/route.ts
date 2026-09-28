import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { dbAdmin } from '@/lib/db/client';

export async function GET() {
  try {
    await dbAdmin.execute(sql`select 1`);
    return NextResponse.json({ status: 'ok' });
  } catch {
    return NextResponse.json({ status: 'degraded' }, { status: 503 });
  }
}
