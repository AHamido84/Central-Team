import { createHash, randomBytes } from 'node:crypto';

import type { AccountKind, ProviderKey } from '@/modules/integrations/constants';
import {
  ProviderError,
  type ConnectionContext,
  type DailyMetric,
  type ExternalAccount,
  type ExternalCampaign,
  type ExternalTemplate,
  type IntegrationProvider,
  type TokenSet,
} from '@/modules/integrations/providers/types';

/** Deterministic 0..1 from a string: the same campaign and day always give the same numbers (sync idempotency). */
export function unit(seed: string): number {
  return createHash('sha256').update(seed).digest().readUInt32BE(0) / 0xffffffff;
}

const between = (seed: string, min: number, max: number) => Math.round(min + unit(seed) * (max - min));

const SANDBOX_ACCOUNTS: Record<ProviderKey, (ExternalAccount & { kind: AccountKind })[]> = {
  meta: [
    { kind: 'ad_account', externalId: 'act_sbx_1001', name: 'Sandbox Ads · Najd', currency: 'SAR', timezone: 'Asia/Riyadh' },
    { kind: 'ad_account', externalId: 'act_sbx_1002', name: 'Sandbox Ads · Qahwa', currency: 'SAR', timezone: 'Asia/Riyadh' },
    { kind: 'page', externalId: 'sbx_page_2001', name: 'Sandbox Page', metadata: { category: 'Marketing agency' } },
  ],
  tiktok: [{ kind: 'ad_account', externalId: 'sbx_tt_3001', name: 'Sandbox TikTok Advertiser', currency: 'SAR', timezone: 'Asia/Riyadh' }],
  snapchat: [
    { kind: 'ad_account', externalId: 'sbx_snap_4001', name: 'Sandbox Snap Ad Account', currency: 'SAR', timezone: 'Asia/Riyadh' },
  ],
  google: [
    { kind: 'ad_account', externalId: 'sbx_gads_5001', name: 'Sandbox Google Ads', currency: 'SAR', timezone: 'Asia/Riyadh' },
    { kind: 'analytics_property', externalId: 'sbx_ga4_6001', name: 'Sandbox GA4 property', timezone: 'Asia/Riyadh' },
  ],
  whatsapp: [{ kind: 'whatsapp_number', externalId: 'sbx_wa_7001', name: '+966 55 000 7001', metadata: { displayPhone: '+966550007001' } }],
};

const CAMPAIGN_NAMES = ['Awareness · Always on', 'Lead generation · Riyadh', 'Retargeting · Website visitors'];

export const SANDBOX_TEMPLATES: ExternalTemplate[] = [
  { name: 'central_notification', language: 'ar', category: 'utility', status: 'approved', body: '{{1}}\n{{2}}' },
  { name: 'central_notification', language: 'en', category: 'utility', status: 'approved', body: '{{1}}\n{{2}}' },
  {
    name: 'lead_welcome',
    language: 'ar',
    category: 'marketing',
    status: 'approved',
    body: 'أهلًا {{1}}، شكرًا لتواصلك مع {{2}}. سيتواصل معك أحد مستشارينا قريبًا.',
  },
  {
    name: 'lead_welcome',
    language: 'en',
    category: 'marketing',
    status: 'approved',
    body: 'Hi {{1}}, thanks for contacting {{2}}. One of our consultants will be in touch shortly.',
  },
  { name: 'meeting_reminder', language: 'ar', category: 'utility', status: 'approved', body: 'تذكير بموعدنا يوم {{1}} الساعة {{2}}.' },
  {
    name: 'meeting_reminder',
    language: 'en',
    category: 'utility',
    status: 'approved',
    body: 'A reminder of our meeting on {{1}} at {{2}}.',
  },
  { name: 'ramadan_offer', language: 'ar', category: 'marketing', status: 'pending', body: 'عرض رمضان: {{1}}' },
];

function assertLive(tokens: TokenSet) {
  if (tokens.accessToken.startsWith('sbx_revoked')) throw new ProviderError('auth_revoked', 'sandbox token revoked');
  if (tokens.expiresAt && new Date(tokens.expiresAt).getTime() <= Date.now())
    throw new ProviderError('auth_expired', 'sandbox token expired');
}

/**
 * The sandbox platform (ADR-068): same interface, no network. Accounts, campaigns and templates are fixed; daily
 * numbers are a pure function of (campaign, day); WhatsApp sends always succeed for valid E.164 numbers.
 */
export function sandboxProvider(key: ProviderKey, appUrl: string): IntegrationProvider {
  const provider: IntegrationProvider = {
    key,
    mode: 'sandbox',
    async identify(ctx: ConnectionContext) {
      assertLive(ctx.tokens);
      return { externalUserId: `sbx_user_${key}`, name: `Sandbox ${key}`, scopes: ctx.tokens.scopes ?? ['sandbox'] };
    },
    async refresh(tokens) {
      if (!tokens.refreshToken) throw new ProviderError('auth_expired', 'no refresh token');
      return {
        accessToken: `sbx_${randomBytes(16).toString('base64url')}`,
        refreshToken: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
        scopes: tokens.scopes,
      };
    },
    async listAccounts(ctx) {
      assertLive(ctx.tokens);
      return SANDBOX_ACCOUNTS[key];
    },
    async revoke() {},
  };

  if (key === 'whatsapp') {
    provider.connectWithToken = async (input) => {
      const token = input.accessToken?.trim() ?? '';
      if (!token.startsWith('sbx_')) throw new ProviderError('auth_revoked', 'sandbox tokens start with sbx_');
      return {
        tokens: { accessToken: token, expiresAt: null, scopes: ['whatsapp_business_messaging'] },
        settings: { phoneNumberId: input.phoneNumberId || 'sbx_wa_7001', wabaId: input.wabaId || 'sbx_waba_7000' },
      };
    };
    provider.listTemplates = async (ctx) => {
      assertLive(ctx.tokens);
      return SANDBOX_TEMPLATES;
    };
    provider.sendTemplate = async (ctx, message) => {
      assertLive(ctx.tokens);
      if (!/^\+[1-9]\d{7,14}$/.test(message.to)) throw new ProviderError('invalid_phone', message.to);
      return { externalId: `wamid.sbx.${randomBytes(12).toString('hex')}` };
    };
    return provider;
  }

  provider.authorizeUrl = ({ state, redirectUri }) => {
    const url = new URL('/integrations/sandbox/authorize', appUrl);
    url.searchParams.set('provider', key);
    url.searchParams.set('state', state);
    url.searchParams.set('redirect_uri', redirectUri);
    return url.toString();
  };
  provider.exchangeCode = async ({ code }) => {
    const m = code.match(/^sbx\.([ls])\.[A-Za-z0-9_-]{8,}$/);
    if (!m) throw new ProviderError('auth_revoked', 'invalid sandbox code');
    const short = m[1] === 's';
    return {
      accessToken: `sbx_${randomBytes(16).toString('base64url')}`,
      refreshToken: short ? null : `sbxr_${randomBytes(16).toString('base64url')}`,
      expiresAt: new Date(Date.now() + (short ? 2 * 60_000 : 60 * 86_400_000)).toISOString(),
      scopes: ['ads_read', 'leads_retrieval'],
    };
  };
  provider.listCampaigns = async (ctx, account): Promise<ExternalCampaign[]> => {
    assertLive(ctx.tokens);
    if (account.kind !== 'ad_account') return [];
    return CAMPAIGN_NAMES.map((name, i) => ({
      externalId: `${account.externalId}_c${i + 1}`,
      name,
      status: i === 2 ? 'PAUSED' : 'ACTIVE',
    }));
  };
  provider.fetchDailyMetrics = async (ctx, _account, { campaignIds, from, to }): Promise<DailyMetric[]> => {
    assertLive(ctx.tokens);
    const rows: DailyMetric[] = [];
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
      const date = d.toISOString().slice(0, 10);
      for (const id of campaignIds) {
        const s = `${id}:${date}`;
        const impressions = between(`${s}:imp`, 2_000, 12_000);
        const clicks = Math.round(impressions * (0.008 + unit(`${s}:ctr`) * 0.022));
        const leads = Math.round(clicks * (0.02 + unit(`${s}:cvr`) * 0.06));
        rows.push({
          externalCampaignId: id,
          date,
          impressions,
          reach: Math.round(impressions * (0.6 + unit(`${s}:reach`) * 0.25)),
          clicks,
          spend: between(`${s}:spend`, 15_000, 90_000) / 100,
          conversions: Math.round(leads * 0.4),
          leads,
          videoViews: Math.round(impressions * 0.3),
          engagements: Math.round(impressions * (0.02 + unit(`${s}:eng`) * 0.04)),
          revenue: between(`${s}:rev`, 0, 250_000) / 100,
        });
      }
    }
    return rows;
  };
  provider.fetchLead = async (ctx, leadId) => {
    assertLive(ctx.tokens);
    const digits = String(between(`${leadId}:phone`, 10_000_000, 99_999_999));
    return {
      full_name: `Sandbox Lead ${leadId.slice(-4)}`,
      phone_number: `+9665${digits}`,
      email: `lead-${leadId.slice(-6).toLowerCase()}@sandbox.test`,
      city: 'riyadh',
    };
  };
  return provider;
}
