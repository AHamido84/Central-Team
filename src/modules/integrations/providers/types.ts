import type { AccountKind, ConnectionMode, ProviderErrorCode, ProviderKey } from '@/modules/integrations/constants';

/** What Vault stores for a connection (JSON). Never leaves the server. */
export type TokenSet = {
  accessToken: string;
  refreshToken?: string | null;
  /** ISO time; null = long-lived / no expiry reported. */
  expiresAt?: string | null;
  scopes?: string[];
};

export type Identity = { externalUserId: string; name: string; scopes: string[] };

export type ExternalAccount = {
  kind: AccountKind;
  externalId: string;
  name: string;
  currency?: string | null;
  timezone?: string | null;
  metadata?: Record<string, string>;
};

export type ExternalCampaign = { externalId: string; name: string; status: string | null };

/** One platform campaign's numbers for one day. Money in the account's major unit (e.g. 125.40). */
export type DailyMetric = {
  externalCampaignId: string;
  date: string;
  impressions: number;
  reach: number;
  clicks: number;
  spend: number;
  conversions: number;
  leads: number;
  videoViews: number;
  engagements: number;
  revenue: number;
};

export type ExternalTemplate = {
  name: string;
  language: 'ar' | 'en';
  /** The platform's exact code (`en_US`); sends must use it. Defaults to `language`. */
  languageCode?: string;
  category: 'utility' | 'marketing' | 'authentication';
  status: 'approved' | 'pending' | 'rejected' | 'paused';
  body: string;
};

export type ConnectionContext = {
  connectionId: string;
  mode: ConnectionMode;
  tokens: TokenSet;
  settings: Record<string, string>;
};

export type AccountRef = { externalId: string; kind: AccountKind; metadata: Record<string, string> };

/**
 * One platform behind one interface (ADR-068). Live adapters call the platform's HTTP API; the sandbox adapter
 * returns deterministic data so everything above it (connect, sync, webhooks, WhatsApp, automations) runs and is
 * tested without credentials. Methods a platform doesn't support are absent.
 */
export interface IntegrationProvider {
  key: ProviderKey;
  mode: ConnectionMode;
  /** OAuth: the consent URL for `state` (signed by us) and our callback. */
  authorizeUrl?(input: { state: string; redirectUri: string }): string;
  exchangeCode?(input: { code: string; redirectUri: string }): Promise<TokenSet>;
  /** Token connections (WhatsApp): validate what the admin pasted and split secret from settings. */
  connectWithToken?(input: Record<string, string>): Promise<{ tokens: TokenSet; settings: Record<string, string> }>;
  refresh?(tokens: TokenSet): Promise<TokenSet>;
  identify(ctx: ConnectionContext): Promise<Identity>;
  listAccounts(ctx: ConnectionContext): Promise<ExternalAccount[]>;
  listCampaigns?(ctx: ConnectionContext, account: AccountRef): Promise<ExternalCampaign[]>;
  fetchDailyMetrics?(
    ctx: ConnectionContext,
    account: AccountRef,
    input: { campaignIds: string[]; from: string; to: string },
  ): Promise<DailyMetric[]>;
  /** Meta lead ads deliver only an id: the lead's answers are fetched with the page's token. */
  fetchLead?(ctx: ConnectionContext, leadId: string): Promise<Record<string, string>>;
  listTemplates?(ctx: ConnectionContext): Promise<ExternalTemplate[]>;
  sendTemplate?(
    ctx: ConnectionContext,
    message: { to: string; template: string; language: 'ar' | 'en'; languageCode?: string; params: string[] },
  ): Promise<{ externalId: string }>;
  /** Best effort on disconnect; the Vault secret is dropped regardless. */
  revoke?(ctx: ConnectionContext): Promise<void>;
}

/** A classified platform failure: the code is translated for users, the detail goes to the log. */
export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly detail = '',
  ) {
    super(`${code}${detail ? `: ${detail}` : ''}`);
  }
}
