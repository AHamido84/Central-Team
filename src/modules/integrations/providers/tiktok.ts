import 'server-only';

import { form, isoDate, num, requestJson } from '@/modules/integrations/providers/http';
import { ProviderError, type DailyMetric, type IntegrationProvider } from '@/modules/integrations/providers/types';
import type { ProviderErrorCode } from '@/modules/integrations/constants';

type TikTokConfig = { appId: string; appSecret: string };

const API = 'https://business-api.tiktok.com/open_api/v1.3';

/** TikTok answers HTTP 200 with `{ code, message, data }`; `code` 0 is success. */
export function classifyTikTok(_status: number, body: unknown): ProviderErrorCode | null {
  const code = (body as { code?: number } | null)?.code;
  if (code === undefined || code === 0) return null;
  if ([40100, 40101, 40102, 40104, 40105].includes(code)) return 'auth_expired';
  if (code === 40001 || code === 40002 || code === 40003) return 'permission_denied';
  if (code === 40016 || code === 51021) return 'rate_limited';
  return 'platform_error';
}

type Envelope<T> = { code: number; message: string; data: T };

/** TikTok for Business (Marketing API v1.3): advertiser authorization, campaigns and the integrated report. */
export function tiktokProvider(config: TikTokConfig): IntegrationProvider {
  const get = async <T>(path: string, token: string, params: Record<string, string>) =>
    (await requestJson<Envelope<T>>(`${API}${path}?${form(params)}`, { headers: { 'Access-Token': token }, classify: classifyTikTok }))
      .data;

  return {
    key: 'tiktok',
    mode: 'live',
    authorizeUrl: ({ state, redirectUri }) =>
      `https://business-api.tiktok.com/portal/auth?${form({ app_id: config.appId, state, redirect_uri: redirectUri })}`,
    async exchangeCode({ code }) {
      const res = await requestJson<Envelope<{ access_token: string; scope?: number[] }>>(`${API}/oauth2/access_token/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app_id: config.appId, secret: config.appSecret, auth_code: code }),
        classify: classifyTikTok,
      });
      if (!res.data?.access_token) throw new ProviderError('invalid_response', 'no access token');
      // Advertiser tokens don't expire; they stop working when the advertiser revokes the app.
      return { accessToken: res.data.access_token, refreshToken: null, expiresAt: null, scopes: (res.data.scope ?? []).map(String) };
    },
    async identify(ctx) {
      const me = await get<{ core_user_id?: string; display_name?: string; email?: string }>('/user/info/', ctx.tokens.accessToken, {});
      return {
        externalUserId: me.core_user_id ?? 'tiktok',
        name: me.display_name ?? me.email ?? 'TikTok',
        scopes: ctx.tokens.scopes ?? [],
      };
    },
    async listAccounts(ctx) {
      const list = await get<{ list: { advertiser_id: string; advertiser_name: string }[] }>(
        '/oauth2/advertiser/get/',
        ctx.tokens.accessToken,
        {
          app_id: config.appId,
          secret: config.appSecret,
        },
      );
      if (!list.list.length) return [];
      const info = await get<{ list: { advertiser_id: string; currency?: string; timezone?: string }[] }>(
        '/advertiser/info/',
        ctx.tokens.accessToken,
        {
          advertiser_ids: JSON.stringify(list.list.map((a) => a.advertiser_id)),
          fields: JSON.stringify(['advertiser_id', 'currency', 'timezone']),
        },
      );
      return list.list.map((a) => {
        const extra = info.list.find((i) => i.advertiser_id === a.advertiser_id);
        return {
          kind: 'ad_account' as const,
          externalId: a.advertiser_id,
          name: a.advertiser_name,
          currency: extra?.currency ?? null,
          timezone: extra?.timezone ?? null,
        };
      });
    },
    async listCampaigns(ctx, account) {
      const data = await get<{ list: { campaign_id: string; campaign_name: string; operation_status?: string }[] }>(
        '/campaign/get/',
        ctx.tokens.accessToken,
        { advertiser_id: account.externalId, page_size: '1000' },
      );
      return data.list.map((c) => ({ externalId: c.campaign_id, name: c.campaign_name, status: c.operation_status ?? null }));
    },
    async fetchDailyMetrics(ctx, account, { campaignIds, from, to }) {
      if (!campaignIds.length) return [];
      const out: DailyMetric[] = [];
      for (let page = 1; page <= 20; page++) {
        const data = await get<{
          list: { dimensions: { campaign_id: string; stat_time_day: string }; metrics: Record<string, string> }[];
          page_info?: { total_page?: number };
        }>('/report/integrated/get/', ctx.tokens.accessToken, {
          advertiser_id: account.externalId,
          report_type: 'BASIC',
          data_level: 'AUCTION_CAMPAIGN',
          dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
          metrics: JSON.stringify([
            'spend',
            'impressions',
            'reach',
            'clicks',
            'conversion',
            'video_play_actions',
            'likes',
            'comments',
            'shares',
            'follows',
          ]),
          start_date: isoDate(from),
          end_date: isoDate(to),
          filtering: JSON.stringify([{ field_name: 'campaign_ids', filter_type: 'IN', filter_value: JSON.stringify(campaignIds) }]),
          page: String(page),
          page_size: '1000',
        });
        for (const r of data.list) {
          const m = r.metrics;
          out.push({
            externalCampaignId: r.dimensions.campaign_id,
            date: r.dimensions.stat_time_day.slice(0, 10),
            impressions: num(m.impressions),
            reach: num(m.reach),
            clicks: num(m.clicks),
            spend: num(m.spend),
            conversions: num(m.conversion),
            leads: 0,
            videoViews: num(m.video_play_actions),
            engagements: num(m.likes) + num(m.comments) + num(m.shares) + num(m.follows),
            revenue: 0,
          });
        }
        if (page >= (data.page_info?.total_page ?? 1)) break;
      }
      return out;
    },
  };
}
