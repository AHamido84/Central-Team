import { NextResponse, type NextRequest } from 'next/server';

import { safePortalPath } from '@/modules/clients/portal-links';
import { activatePortalClient } from '@/modules/clients/server/portal-switch';

/**
 * `/portal/switch?client=<id>&next=<portal path>` — used by notification links and emails (FR4.3): opens `next` as that
 * client. A client the user doesn't belong to (or an invalid id) lands on the portal home without switching.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const client = url.searchParams.get('client') ?? '';
  const next = safePortalPath(url.searchParams.get('next'));
  const ok = /^[0-9a-f-]{36}$/i.test(client) && (await activatePortalClient(client));
  return NextResponse.redirect(new URL(ok ? next : '/portal', url.origin));
}
