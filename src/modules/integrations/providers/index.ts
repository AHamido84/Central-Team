import 'server-only';

import { env } from '@/lib/env';
import { providerCatalog, type ConnectionMode, type ProviderKey } from '@/modules/integrations/constants';
import { googleProvider } from '@/modules/integrations/providers/google';
import { linkedinProvider } from '@/modules/integrations/providers/linkedin';
import { metaProvider } from '@/modules/integrations/providers/meta';
import { sandboxProvider } from '@/modules/integrations/providers/sandbox';
import { snapchatProvider } from '@/modules/integrations/providers/snapchat';
import { tiktokProvider } from '@/modules/integrations/providers/tiktok';
import { ProviderError, type IntegrationProvider } from '@/modules/integrations/providers/types';
import { whatsappProvider } from '@/modules/integrations/providers/whatsapp';
import { xProvider } from '@/modules/integrations/providers/x';

/** Sandbox providers are always available outside production, and in production with `INTEGRATIONS_SANDBOX=1`. */
export function sandboxEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || env().INTEGRATIONS_SANDBOX === '1';
}

/** Which environment variables a live connection to this platform still needs (empty = configured). */
export function missingEnv(key: ProviderKey): string[] {
  const e = env() as Record<string, unknown>;
  return providerCatalog[key].env.filter((name) => !e[name]);
}

/** HMAC key for OAuth state and sandbox webhook signatures. */
export function signingSecret(): string {
  return env().INTEGRATIONS_SIGNING_SECRET || env().SUPABASE_SECRET_KEY;
}

export function getProvider(key: ProviderKey, mode: ConnectionMode): IntegrationProvider {
  const e = env();
  if (mode === 'sandbox') {
    if (!sandboxEnabled()) throw new ProviderError('not_configured', 'sandbox disabled');
    return sandboxProvider(key, e.NEXT_PUBLIC_APP_URL);
  }
  const missing = missingEnv(key);
  if (missing.length) throw new ProviderError('not_configured', missing.join(', '));
  switch (key) {
    case 'meta':
      return metaProvider({ appId: e.META_APP_ID!, appSecret: e.META_APP_SECRET!, version: e.META_GRAPH_VERSION });
    case 'whatsapp':
      return whatsappProvider({ version: e.META_GRAPH_VERSION });
    case 'tiktok':
      return tiktokProvider({ appId: e.TIKTOK_APP_ID!, appSecret: e.TIKTOK_APP_SECRET! });
    case 'snapchat':
      return snapchatProvider({ clientId: e.SNAPCHAT_CLIENT_ID!, clientSecret: e.SNAPCHAT_CLIENT_SECRET! });
    case 'google':
      return googleProvider({
        clientId: e.GOOGLE_CLIENT_ID!,
        clientSecret: e.GOOGLE_CLIENT_SECRET!,
        developerToken: e.GOOGLE_ADS_DEVELOPER_TOKEN!,
        loginCustomerId: e.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
        adsVersion: e.GOOGLE_ADS_API_VERSION,
      });
    case 'x':
      return xProvider();
    case 'linkedin':
      return linkedinProvider();
  }
}

/**
 * Provider for a personal connection with a pasted token (FR1.6). Reads need only the person's token for Meta, X and
 * LinkedIn; TikTok, Snapchat and Google Ads calls also need the agency's app credentials (the platform requires them),
 * so those use the configured app and report `not_configured` without it.
 */
export function getPersonalProvider(key: ProviderKey, mode: ConnectionMode): IntegrationProvider {
  if (mode === 'sandbox') return getProvider(key, mode);
  const e = env();
  if (key === 'meta')
    return metaProvider({ appId: e.META_APP_ID ?? '', appSecret: e.META_APP_SECRET ?? '', version: e.META_GRAPH_VERSION });
  return getProvider(key, mode);
}

/** The OAuth callback URL registered with each platform. */
export function callbackUrl(key: ProviderKey): string {
  return new URL(`/api/integrations/callback/${key}`, env().NEXT_PUBLIC_APP_URL).toString();
}
