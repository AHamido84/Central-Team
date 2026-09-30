import { NextResponse, type NextRequest } from 'next/server';

import { getAppContext } from '@/lib/auth/context';
import { env } from '@/lib/env';
import { scheduleEventDispatch } from '@/lib/events/schedule';
import { can } from '@/lib/permissions/can';
import { OAUTH_NONCE_COOKIE, providerKeys, type ProviderKey } from '@/modules/integrations/constants';
import { callbackUrl, getProvider, signingSecret } from '@/modules/integrations/providers';
import { ProviderError } from '@/modules/integrations/providers/types';
import { verifyState } from '@/modules/integrations/signatures';
import { saveConnection } from '@/modules/integrations/server/connections';

export const dynamic = 'force-dynamic';

/**
 * OAuth callback (ADR-067). Accepts the code only when the signed `state` verifies, matches the nonce cookie set when
 * the flow started, has not expired, names the same provider, and belongs to the signed-in user — who must still
 * hold `integrations:manage` in that organization. Tokens go straight to Vault through `saveConnection()`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: raw } = await params;
  const base = env().NEXT_PUBLIC_APP_URL;
  const back = (path: string) => {
    const response = NextResponse.redirect(new URL(path, base));
    response.cookies.delete({ name: OAUTH_NONCE_COOKIE, path: '/api/integrations' });
    return response;
  };
  if (!(providerKeys as readonly string[]).includes(raw)) return back('/admin/integrations?error=validation');
  const provider = raw as ProviderKey;

  const url = request.nextUrl;
  const state = verifyState(url.searchParams.get('state') ?? '', signingSecret(), request.cookies.get(OAUTH_NONCE_COOKIE)?.value);
  const ctx = await getAppContext();
  if (
    !state ||
    state.provider !== provider ||
    !ctx ||
    ctx.side !== 'agency' ||
    ctx.session.userId !== state.userId ||
    ctx.organization.id !== state.organizationId
  )
    return back('/admin/integrations?error=oauth_state');
  if (!can(ctx.permissions, 'integrations:manage')) return back('/admin/integrations?error=forbidden');

  const denied = url.searchParams.get('error');
  const code = url.searchParams.get('code') ?? url.searchParams.get('auth_code');
  if (denied || !code) return back(`/admin/integrations?error=${denied === 'access_denied' ? 'oauth_denied' : 'oauth_failed'}`);

  try {
    const p = getProvider(provider, state.mode);
    const tokens = await p.exchangeCode!({ code, redirectUri: callbackUrl(provider) });
    const { connectionId } = await saveConnection({
      organizationId: state.organizationId,
      actorId: state.userId,
      provider,
      mode: state.mode,
      tokens,
      connectionId: state.connectionId,
    });
    scheduleEventDispatch();
    return back(`/admin/integrations/${connectionId}?connected=1`);
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : 'platform_error';
    console.warn('[integrations] oauth callback failed', provider, error instanceof Error ? error.message : error);
    return back(`/admin/integrations?error=${code}`);
  }
}
