import 'server-only';

import { form, isoDate, num, requestJson } from '@/modules/integrations/providers/http';
import {
  ProviderError,
  type ConnectionContext,
  type DailyMetric,
  type ExternalAccount,
  type IntegrationProvider,
  type TokenSet,
} from '@/modules/integrations/providers/types';
import type { ProviderErrorCode } from '@/modules/integrations/constants';

export type MetaConfig = { appId: string; appSecret: string; version: string };

const SCOPES = ['ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'];

/** Graph API errors → our codes (https://developers.facebook.com/docs/graph-api/guides/error-handling). */
export function classifyMeta(status: number, body: unknown): ProviderErrorCode | null {
  const err = (body as { error?: { code?: number; error_subcode?: number } } | null)?.error;
  if (!err) return status === 401 ? 'auth_expired' : null;
  if (err.code === 190) return err.error_subcode === 458 || err.error_subcode === 460 ? 'auth_revoked' : 'auth_expired';
  if (err.code === 102) return 'auth_expired';
  if (err.code === 10 || (err.code !== undefined && err.code >= 200 && err.code < 300)) return 'permission_denied';
  if ([4, 17, 32, 613, 80000, 80004].includes(err.code ?? -1)) return 'rate_limited';
  return 'platform_error';
}

type Paged<T> = { data: T[]; paging?: { next?: string } };

/** Meta Marketing + Pages + Lead Ads (Graph API). Lead ads deliver an id by webhook; answers come from `fetchLead`. */
export function metaProvider(config: MetaConfig): IntegrationProvider {
  const graph = `https://graph.facebook.com/${config.version}`;
  const get = <T>(path: string, token: string, params: Record<string, string> = {}) =>
    requestJson<T>(`${graph}${path}?${form({ ...params, access_token: token })}`, { classify: classifyMeta });

  async function all<T>(path: string, token: string, params: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    let page = await get<Paged<T>>(path, token, params);
    for (let i = 0; i < 50; i++) {
      out.push(...page.data);
      if (!page.paging?.next) break;
      page = await requestJson<Paged<T>>(page.paging.next, { classify: classifyMeta });
    }
    return out;
  }

  async function longLived(shortToken: string): Promise<TokenSet> {
    const res = await requestJson<{ access_token: string; expires_in?: number }>(
      `${graph}/oauth/access_token?${form({
        grant_type: 'fb_exchange_token',
        client_id: config.appId,
        client_secret: config.appSecret,
        fb_exchange_token: shortToken,
      })}`,
      { classify: classifyMeta },
    );
    return {
      accessToken: res.access_token,
      refreshToken: null,
      expiresAt: new Date(Date.now() + (res.expires_in ?? 60 * 86_400) * 1000).toISOString(),
      scopes: SCOPES,
    };
  }

  return {
    key: 'meta',
    mode: 'live',
    authorizeUrl: ({ state, redirectUri }) =>
      `https://www.facebook.com/${config.version}/dialog/oauth?${form({
        client_id: config.appId,
        redirect_uri: redirectUri,
        state,
        response_type: 'code',
        scope: SCOPES.join(','),
      })}`,
    async exchangeCode({ code, redirectUri }) {
      const short = await requestJson<{ access_token: string }>(
        `${graph}/oauth/access_token?${form({ client_id: config.appId, client_secret: config.appSecret, redirect_uri: redirectUri, code })}`,
        { classify: classifyMeta },
      );
      return longLived(short.access_token);
    },
    // Meta has no refresh token: a still-valid long-lived token is exchanged for a fresh 60-day one.
    refresh: (tokens) => longLived(tokens.accessToken),
    async identify(ctx) {
      const me = await get<{ id: string; name: string }>('/me', ctx.tokens.accessToken, { fields: 'id,name' });
      const perms = await get<{ data: { permission: string; status: string }[] }>('/me/permissions', ctx.tokens.accessToken);
      return { externalUserId: me.id, name: me.name, scopes: perms.data.filter((p) => p.status === 'granted').map((p) => p.permission) };
    },
    async listAccounts(ctx) {
      const token = ctx.tokens.accessToken;
      const ads = await all<{ id: string; name: string; currency: string; timezone_name: string }>('/me/adaccounts', token, {
        fields: 'id,name,currency,timezone_name',
        limit: '100',
      });
      const pages = await all<{ id: string; name: string; category?: string; access_token?: string }>('/me/accounts', token, {
        fields: 'id,name,category,access_token',
        limit: '100',
      });
      // Lead ads webhooks arrive only for pages subscribed to the app (the page token is used once, never stored).
      for (const p of pages) {
        if (!p.access_token) continue;
        await requestJson(`${graph}/${p.id}/subscribed_apps`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form({ subscribed_fields: 'leadgen', access_token: p.access_token }),
          classify: classifyMeta,
        }).catch((error) => console.warn('[integrations] meta page subscribe failed', p.id, (error as Error).message));
      }
      const accounts: ExternalAccount[] = [
        ...ads.map((a) => ({
          kind: 'ad_account' as const,
          externalId: a.id,
          name: a.name,
          currency: a.currency,
          timezone: a.timezone_name,
        })),
        ...pages.map((p) => ({
          kind: 'page' as const,
          externalId: p.id,
          name: p.name,
          metadata: p.category ? { category: p.category } : ({} as Record<string, string>),
        })),
      ];
      return accounts;
    },
    async listCampaigns(ctx, account) {
      if (account.kind !== 'ad_account') return [];
      const rows = await all<{ id: string; name: string; effective_status: string }>(
        `/${account.externalId}/campaigns`,
        ctx.tokens.accessToken,
        {
          fields: 'id,name,effective_status',
          limit: '200',
        },
      );
      return rows.map((r) => ({ externalId: r.id, name: r.name, status: r.effective_status }));
    },
    async fetchDailyMetrics(ctx, account, { campaignIds, from, to }) {
      if (!campaignIds.length) return [];
      type Action = { action_type: string; value: string };
      const rows = await all<{
        campaign_id: string;
        date_start: string;
        impressions?: string;
        reach?: string;
        clicks?: string;
        spend?: string;
        actions?: Action[];
        action_values?: Action[];
      }>(`/${account.externalId}/insights`, ctx.tokens.accessToken, {
        level: 'campaign',
        time_increment: '1',
        time_range: JSON.stringify({ since: isoDate(from), until: isoDate(to) }),
        filtering: JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: campaignIds }]),
        fields: 'campaign_id,impressions,reach,clicks,spend,actions,action_values',
        limit: '500',
      });
      const sum = (list: Action[] | undefined, types: string[]) =>
        (list ?? []).filter((a) => types.includes(a.action_type)).reduce((s, a) => s + num(a.value), 0);
      return rows.map((r): DailyMetric => ({
        externalCampaignId: r.campaign_id,
        date: r.date_start,
        impressions: num(r.impressions),
        reach: num(r.reach),
        clicks: num(r.clicks),
        spend: num(r.spend),
        conversions: sum(r.actions, ['purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase']),
        leads: sum(r.actions, ['lead', 'onsite_conversion.lead_grouped']),
        videoViews: sum(r.actions, ['video_view']),
        engagements: sum(r.actions, ['post_engagement']),
        revenue: sum(r.action_values, ['purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase']),
      }));
    },
    async fetchLead(ctx: ConnectionContext, leadId: string) {
      if (!/^\d{5,30}$/.test(leadId)) throw new ProviderError('invalid_response', 'bad lead id');
      const lead = await get<{ field_data?: { name: string; values: string[] }[] }>(`/${leadId}`, ctx.tokens.accessToken, {
        fields: 'field_data,created_time,form_id,campaign_name',
      });
      return Object.fromEntries((lead.field_data ?? []).map((f) => [f.name, f.values?.[0] ?? '']));
    },
    async revoke(ctx) {
      await requestJson(`${graph}/me/permissions?${form({ access_token: ctx.tokens.accessToken })}`, {
        method: 'DELETE',
        classify: classifyMeta,
      });
    },
  };
}
