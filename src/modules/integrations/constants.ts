export const providerKeys = ['meta', 'whatsapp', 'tiktok', 'snapchat', 'google'] as const;
export type ProviderKey = (typeof providerKeys)[number];

export const connectionModes = ['live', 'sandbox'] as const;
export type ConnectionMode = (typeof connectionModes)[number];

export const connectionStatuses = ['connected', 'expired', 'error', 'disconnected'] as const;
export type ConnectionStatus = (typeof connectionStatuses)[number];

/** What the UI shows: `expiring` is derived from the token expiry (ADR-068). */
export type ConnectionHealth = ConnectionStatus | 'expiring';

export const accountKinds = ['ad_account', 'page', 'whatsapp_number', 'analytics_property'] as const;
export type AccountKind = (typeof accountKinds)[number];

export type Capability = 'ads' | 'pages' | 'lead_ads' | 'whatsapp' | 'analytics';

/**
 * Per platform: how it connects, what it brings, and the environment variables a live connection needs.
 * WhatsApp connects with a system-user token (Meta Business settings) rather than a browser OAuth dance.
 */
export const providerCatalog: Record<
  ProviderKey,
  { auth: 'oauth' | 'token'; capabilities: readonly Capability[]; env: readonly string[]; campaignPlatform: string | null }
> = {
  meta: {
    auth: 'oauth',
    capabilities: ['ads', 'pages', 'lead_ads'],
    env: ['META_APP_ID', 'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN'],
    campaignPlatform: 'meta',
  },
  whatsapp: { auth: 'token', capabilities: ['whatsapp'], env: ['META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN'], campaignPlatform: null },
  tiktok: { auth: 'oauth', capabilities: ['ads', 'lead_ads'], env: ['TIKTOK_APP_ID', 'TIKTOK_APP_SECRET'], campaignPlatform: 'tiktok' },
  snapchat: {
    auth: 'oauth',
    capabilities: ['ads', 'lead_ads'],
    env: ['SNAPCHAT_CLIENT_ID', 'SNAPCHAT_CLIENT_SECRET', 'SNAPCHAT_WEBHOOK_SECRET'],
    campaignPlatform: 'snapchat',
  },
  google: {
    auth: 'oauth',
    capabilities: ['ads', 'analytics', 'lead_ads'],
    env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_LEAD_WEBHOOK_KEY'],
    campaignPlatform: 'google',
  },
};

/** Campaign channel platforms an ad account of this provider may feed (Meta covers Facebook and Instagram). */
export const channelPlatformsFor: Record<ProviderKey, readonly string[]> = {
  meta: ['meta', 'facebook', 'instagram'],
  whatsapp: [],
  tiktok: ['tiktok'],
  snapchat: ['snapchat'],
  google: ['google', 'youtube'],
};

/** Translated error codes shown on connections, sync runs and messages (`integrations.errors.<code>`). */
export const providerErrorCodes = [
  'auth_expired',
  'auth_revoked',
  'permission_denied',
  'rate_limited',
  'not_configured',
  'network',
  'invalid_response',
  'platform_error',
  'invalid_phone',
  'template_not_approved',
  'no_connection',
  'not_opted_in',
] as const;
export type ProviderErrorCode = (typeof providerErrorCodes)[number];

/** Errors that end a sync or send right away (retrying cannot help until someone reconnects). */
export const terminalErrors: readonly ProviderErrorCode[] = [
  'auth_expired',
  'auth_revoked',
  'permission_denied',
  'not_configured',
  'invalid_phone',
  'template_not_approved',
  'no_connection',
  'not_opted_in',
];

export const SYNC = {
  /** Scheduled runs re-pull this many days back (platforms restate recent days as attribution settles). */
  scheduledDays: 3,
  maxBackfillDays: 90,
  maxAttempts: 3,
  /** Retry delays in minutes after attempt 1, 2. */
  retryMinutes: [15, 60] as readonly number[],
} as const;

/** OAuth: the nonce cookie the signed `state` is bound to, and how long a consent round-trip may take. */
export const OAUTH_NONCE_COOKIE = 'ct_oauth_nonce';
export const OAUTH_TTL_MS = 10 * 60_000;

/** A token that expires within this many days is shown as "expiring". */
export const EXPIRING_DAYS = 7;

export function connectionHealth(
  c: { status: ConnectionStatus; tokenExpiresAt: Date | string | null },
  now = new Date(),
): ConnectionHealth {
  if (c.status !== 'connected') return c.status;
  if (!c.tokenExpiresAt) return 'connected';
  const expires = new Date(c.tokenExpiresAt).getTime();
  if (expires <= now.getTime()) return 'expired';
  return expires - now.getTime() < EXPIRING_DAYS * 86_400_000 ? 'expiring' : 'connected';
}

export const healthTone: Record<ConnectionHealth, 'success' | 'warning' | 'danger' | 'neutral'> = {
  connected: 'success',
  expiring: 'warning',
  expired: 'danger',
  error: 'danger',
  disconnected: 'neutral',
};

export const syncStatuses = ['queued', 'running', 'succeeded', 'failed'] as const;
export type SyncStatus = (typeof syncStatuses)[number];

export const messageStatuses = ['queued', 'sent', 'delivered', 'read', 'failed'] as const;
export type MessageStatus = (typeof messageStatuses)[number];

/** Replaces `{{1}}`, `{{2}}` … with the parameters (WhatsApp template syntax). */
export function renderTemplateBody(body: string, params: readonly string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (m, n: string) => params[Number(n) - 1] ?? m);
}

export function countTemplateParams(body: string): number {
  const numbers = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return numbers.length ? Math.max(...numbers) : 0;
}
