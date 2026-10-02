import 'server-only';

import { form, isoDate, num, requestJson } from '@/modules/integrations/providers/http';
import type { DailyMetric, ExternalAccount, IntegrationProvider, TokenSet } from '@/modules/integrations/providers/types';

type GoogleConfig = { clientId: string; clientSecret: string; developerToken: string; loginCustomerId?: string; adsVersion: string };

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/adwords', 'https://www.googleapis.com/auth/analytics.readonly'];

/** Google Ads (GAQL over REST) + Analytics Admin (GA4 properties). OAuth with offline access (refresh token). */
export function googleProvider(config: GoogleConfig): IntegrationProvider {
  const ads = `https://googleads.googleapis.com/${config.adsVersion}`;
  const headers = (token: string) => ({
    authorization: `Bearer ${token}`,
    'developer-token': config.developerToken,
    'content-type': 'application/json',
    ...(config.loginCustomerId ? { 'login-customer-id': config.loginCustomerId } : {}),
  });

  async function token(params: Record<string, string>, previous?: TokenSet): Promise<TokenSet> {
    const res = await requestJson<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({ client_id: config.clientId, client_secret: config.clientSecret, ...params }),
        classify: (status, body) =>
          status === 400 && (body as { error?: string } | null)?.error === 'invalid_grant' ? 'auth_revoked' : null,
      },
    );
    return {
      accessToken: res.access_token,
      refreshToken: res.refresh_token ?? previous?.refreshToken ?? null,
      expiresAt: new Date(Date.now() + (res.expires_in ?? 3600) * 1000).toISOString(),
      scopes: res.scope?.split(' ') ?? SCOPES,
    };
  }

  const search = <T>(tokenValue: string, customerId: string, query: string) =>
    requestJson<{ results?: T[] }[]>(`${ads}/customers/${customerId}/googleAds:searchStream`, {
      method: 'POST',
      headers: headers(tokenValue),
      body: JSON.stringify({ query }),
    }).then((chunks) => chunks.flatMap((c) => c.results ?? []));

  return {
    key: 'google',
    mode: 'live',
    authorizeUrl: ({ state, redirectUri }) =>
      `https://accounts.google.com/o/oauth2/v2/auth?${form({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
      })}`,
    exchangeCode: ({ code, redirectUri }) => token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    refresh: (tokens) => token({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken ?? '' }, tokens),
    async identify(ctx) {
      const me = await requestJson<{ sub: string; email?: string; name?: string }>('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { authorization: `Bearer ${ctx.tokens.accessToken}` },
      });
      return { externalUserId: me.sub, name: me.email ?? me.name ?? me.sub, scopes: ctx.tokens.scopes ?? [] };
    },
    async listAccounts(ctx) {
      const tokenValue = ctx.tokens.accessToken;
      const accessible = await requestJson<{ resourceNames?: string[] }>(`${ads}/customers:listAccessibleCustomers`, {
        headers: headers(tokenValue),
      });
      const accounts: ExternalAccount[] = [];
      for (const resource of (accessible.resourceNames ?? []).slice(0, 50)) {
        const id = resource.split('/')[1]!;
        const [row] = await search<{
          customer: { id: string; descriptiveName?: string; currencyCode?: string; timeZone?: string; manager?: boolean };
        }>(
          tokenValue,
          id,
          'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer',
        ).catch(() => []);
        if (!row || row.customer.manager) continue;
        accounts.push({
          kind: 'ad_account',
          externalId: id,
          name: row.customer.descriptiveName || id,
          currency: row.customer.currencyCode ?? null,
          timezone: row.customer.timeZone ?? null,
        });
      }
      const ga = await requestJson<{
        accountSummaries?: { displayName: string; propertySummaries?: { property: string; displayName: string }[] }[];
      }>('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', {
        headers: { authorization: `Bearer ${tokenValue}` },
      }).catch(() => ({ accountSummaries: [] }));
      for (const a of ga.accountSummaries ?? [])
        for (const p of a.propertySummaries ?? [])
          accounts.push({
            kind: 'analytics_property',
            externalId: p.property.replace('properties/', ''),
            name: `${a.displayName} · ${p.displayName}`,
          });
      return accounts;
    },
    async listCampaigns(ctx, account) {
      if (account.kind !== 'ad_account') return [];
      const rows = await search<{ campaign: { id: string; name: string; status: string } }>(
        ctx.tokens.accessToken,
        account.externalId,
        "SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.status != 'REMOVED'",
      );
      return rows.map((r) => ({ externalId: r.campaign.id, name: r.campaign.name, status: r.campaign.status }));
    },
    async fetchDailyMetrics(ctx, account, { campaignIds, from, to }) {
      const ids = campaignIds.filter((id) => /^\d+$/.test(id));
      if (!ids.length || account.kind !== 'ad_account') return [];
      const rows = await search<{
        campaign: { id: string };
        segments: { date: string };
        metrics: Record<string, string | number | undefined>;
      }>(
        ctx.tokens.accessToken,
        account.externalId,
        `SELECT campaign.id, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions,
                metrics.conversions_value, metrics.video_views, metrics.engagements
         FROM campaign
         WHERE segments.date BETWEEN '${isoDate(from)}' AND '${isoDate(to)}' AND campaign.id IN (${ids.join(',')})`,
      );
      return rows.map((r): DailyMetric => ({
        externalCampaignId: r.campaign.id,
        date: r.segments.date,
        impressions: num(r.metrics.impressions),
        // Google Ads doesn't report daily reach per campaign.
        reach: 0,
        clicks: num(r.metrics.clicks),
        spend: num(r.metrics.costMicros) / 1_000_000,
        conversions: Math.round(num(r.metrics.conversions)),
        leads: 0,
        videoViews: num(r.metrics.videoViews),
        engagements: num(r.metrics.engagements),
        revenue: num(r.metrics.conversionsValue),
      }));
    },
    async revoke(ctx) {
      await requestJson(`https://oauth2.googleapis.com/revoke?${form({ token: ctx.tokens.refreshToken ?? ctx.tokens.accessToken })}`, {
        method: 'POST',
      });
    },
  };
}
