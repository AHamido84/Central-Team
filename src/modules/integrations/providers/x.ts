import 'server-only';

import { requestJson } from '@/modules/integrations/providers/http';
import type { IntegrationProvider } from '@/modules/integrations/providers/types';

const API = 'https://api.x.com/2';
const ADS = 'https://ads-api.x.com/12';

/**
 * X (Twitter) with a pasted user access token (FR1.6, docs/INTEGRATIONS.md): the X API v2 `/users/me` identifies the
 * person; ad accounts come from the X Ads API `/accounts`, which needs Ads API access for the app that issued the token
 * — without it the connection still works and shows no ad accounts. Numbers are not synced yet.
 */
export function xProvider(): IntegrationProvider {
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  return {
    key: 'x',
    mode: 'live',
    async identify(ctx) {
      const res = await requestJson<{ data: { id: string; name: string; username: string } }>(`${API}/users/me`, {
        headers: auth(ctx.tokens.accessToken),
        classify: (status) => (status === 401 ? 'auth_expired' : status === 403 ? 'auth_revoked' : null),
      });
      return { externalUserId: res.data.id, name: `${res.data.name} (@${res.data.username})`, scopes: ctx.tokens.scopes ?? [] };
    },
    async listAccounts(ctx) {
      try {
        const res = await requestJson<{ data: { id: string; name: string; timezone?: string; currency?: string }[] }>(`${ADS}/accounts`, {
          headers: auth(ctx.tokens.accessToken),
        });
        return res.data.map((a) => ({
          kind: 'ad_account' as const,
          externalId: a.id,
          name: a.name,
          timezone: a.timezone ?? null,
          currency: a.currency ?? null,
        }));
      } catch (error) {
        console.warn('[integrations] x ads accounts unavailable', (error as Error).message);
        return [];
      }
    },
  };
}
