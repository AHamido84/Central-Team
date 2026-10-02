import 'server-only';

import { form, isoDate, num, requestJson } from '@/modules/integrations/providers/http';
import type { DailyMetric, IntegrationProvider, TokenSet } from '@/modules/integrations/providers/types';

type SnapConfig = { clientId: string; clientSecret: string };

const ADS = 'https://adsapi.snapchat.com/v1';
const TOKEN_URL = 'https://accounts.snapchat.com/login/oauth2/access_token';

/** Midnight of `date` in the ad account's time zone as an ISO string with offset (the stats API requires it). */
export function zonedMidnight(date: string, timeZone: string | undefined): string {
  const tz = timeZone || 'UTC';
  const probe = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(probe);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const offset = name === 'GMT' ? '+00:00' : name.replace('GMT', '');
  return `${date}T00:00:00.000${offset}`;
}

const addDay = (date: string) => new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

/** Snapchat Marketing API: OAuth with 30-minute access tokens and a refresh token; stats per campaign per day. */
export function snapchatProvider(config: SnapConfig): IntegrationProvider {
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function token(params: Record<string, string>): Promise<TokenSet> {
    const res = await requestJson<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: config.clientId, client_secret: config.clientSecret, ...params }),
      classify: (status) => (status === 400 || status === 401 ? 'auth_expired' : null),
    });
    return {
      accessToken: res.access_token,
      refreshToken: res.refresh_token ?? params.refresh_token ?? null,
      expiresAt: new Date(Date.now() + (res.expires_in ?? 1800) * 1000).toISOString(),
      scopes: res.scope ? res.scope.split(' ') : ['snapchat-marketing-api'],
    };
  }

  return {
    key: 'snapchat',
    mode: 'live',
    authorizeUrl: ({ state, redirectUri }) =>
      `https://accounts.snapchat.com/login/oauth2/authorize?${form({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'snapchat-marketing-api',
        state,
      })}`,
    exchangeCode: ({ code, redirectUri }) => token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    refresh: (tokens) => token({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken ?? '' }),
    async identify(ctx) {
      const res = await requestJson<{ me: { id: string; display_name?: string; email?: string } }>(`${ADS}/me`, {
        headers: auth(ctx.tokens.accessToken),
      });
      return { externalUserId: res.me.id, name: res.me.display_name ?? res.me.email ?? res.me.id, scopes: ctx.tokens.scopes ?? [] };
    },
    async listAccounts(ctx) {
      const res = await requestJson<{
        organizations: { organization: { ad_accounts?: { id: string; name: string; currency?: string; timezone?: string }[] } }[];
      }>(`${ADS}/me/organizations?with_ad_accounts=true`, { headers: auth(ctx.tokens.accessToken) });
      return res.organizations.flatMap((o) =>
        (o.organization.ad_accounts ?? []).map((a) => ({
          kind: 'ad_account' as const,
          externalId: a.id,
          name: a.name,
          currency: a.currency ?? null,
          timezone: a.timezone ?? null,
          metadata: a.timezone ? { timezone: a.timezone } : ({} as Record<string, string>),
        })),
      );
    },
    async listCampaigns(ctx, account) {
      const res = await requestJson<{ campaigns: { campaign: { id: string; name: string; status?: string } }[] }>(
        `${ADS}/adaccounts/${encodeURIComponent(account.externalId)}/campaigns`,
        { headers: auth(ctx.tokens.accessToken) },
      );
      return res.campaigns.map((c) => ({ externalId: c.campaign.id, name: c.campaign.name, status: c.campaign.status ?? null }));
    },
    async fetchDailyMetrics(ctx, account, { campaignIds, from, to }) {
      const out: DailyMetric[] = [];
      const tz = account.metadata.timezone;
      for (const id of campaignIds) {
        const params = form({
          granularity: 'DAY',
          start_time: zonedMidnight(isoDate(from), tz),
          end_time: zonedMidnight(addDay(isoDate(to)), tz),
          fields: 'impressions,swipes,spend,video_views,conversion_purchases,conversion_purchases_value,conversion_sign_ups,uniques',
        });
        const res = await requestJson<{
          timeseries_stats: { timeseries_stat: { timeseries: { start_time: string; stats: Record<string, number> }[] } }[];
        }>(`${ADS}/campaigns/${encodeURIComponent(id)}/stats?${params}`, { headers: auth(ctx.tokens.accessToken) });
        for (const point of res.timeseries_stats?.[0]?.timeseries_stat.timeseries ?? []) {
          const s = point.stats;
          out.push({
            externalCampaignId: id,
            date: point.start_time.slice(0, 10),
            impressions: num(s.impressions),
            reach: num(s.uniques),
            clicks: num(s.swipes),
            // Snap reports money in micro-currency.
            spend: num(s.spend) / 1_000_000,
            conversions: num(s.conversion_purchases),
            leads: num(s.conversion_sign_ups),
            videoViews: num(s.video_views),
            engagements: num(s.swipes),
            revenue: num(s.conversion_purchases_value) / 1_000_000,
          });
        }
      }
      return out;
    },
  };
}
