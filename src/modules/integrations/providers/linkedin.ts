import 'server-only';

import { requestJson } from '@/modules/integrations/providers/http';
import type { IntegrationProvider } from '@/modules/integrations/providers/types';

const API = 'https://api.linkedin.com';
/** Versioned Marketing API (docs/INTEGRATIONS.md); bump with the platform's deprecation schedule. */
const VERSION = '202509';

/**
 * LinkedIn with a pasted member access token (FR1.6): OpenID Connect `/v2/userinfo` identifies the person (scope
 * `openid profile`), `/rest/adAccounts` lists Campaign Manager accounts (scope `r_ads`), `/rest/adCampaigns` their
 * campaigns. Numbers are not synced yet.
 */
export function linkedinProvider(): IntegrationProvider {
  const headers = (token: string) => ({
    authorization: `Bearer ${token}`,
    'linkedin-version': VERSION,
    'x-restli-protocol-version': '2.0.0',
  });
  const classify = (status: number) => (status === 401 ? 'auth_expired' : status === 403 ? 'auth_revoked' : null);
  return {
    key: 'linkedin',
    mode: 'live',
    async identify(ctx) {
      const me = await requestJson<{ sub: string; name?: string; email?: string }>(`${API}/v2/userinfo`, {
        headers: headers(ctx.tokens.accessToken),
        classify,
      });
      return { externalUserId: me.sub, name: me.name ?? me.email ?? me.sub, scopes: ctx.tokens.scopes ?? [] };
    },
    async listAccounts(ctx) {
      const res = await requestJson<{ elements: { id: number; name: string; currency?: string; status?: string }[] }>(
        `${API}/rest/adAccounts?q=search`,
        { headers: headers(ctx.tokens.accessToken), classify },
      );
      return res.elements.map((a) => ({
        kind: 'ad_account' as const,
        externalId: String(a.id),
        name: a.name,
        currency: a.currency ?? null,
        metadata: (a.status ? { status: a.status } : {}) as Record<string, string>,
      }));
    },
    async listCampaigns(ctx, account) {
      const res = await requestJson<{ elements: { id: number; name: string; status?: string }[] }>(
        `${API}/rest/adAccounts/${encodeURIComponent(account.externalId)}/adCampaigns?q=search`,
        { headers: headers(ctx.tokens.accessToken), classify },
      );
      return res.elements.map((c) => ({ externalId: String(c.id), name: c.name, status: c.status ?? null }));
    },
  };
}
