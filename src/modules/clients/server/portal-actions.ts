'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/errors';
import { ACTIVE_CLIENT_COOKIE, getAppContext } from '@/lib/auth/context';

/** Switches the active client for portal users who belong to more than one client. */
export async function switchClientAction(input: { clientId: string }): Promise<ActionResult<null>> {
  const parsed = z.object({ clientId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: 'validation' } };
  const ctx = await getAppContext();
  if (!ctx || ctx.side !== 'client') return { ok: false, error: { code: 'forbidden' } };
  if (!ctx.clients.some((c) => c.id === parsed.data.clientId)) return { ok: false, error: { code: 'forbidden' } };
  (await cookies()).set(ACTIVE_CLIENT_COOKIE, parsed.data.clientId, { path: '/', sameSite: 'lax', maxAge: 31536000 });
  return { ok: true, data: null };
}
