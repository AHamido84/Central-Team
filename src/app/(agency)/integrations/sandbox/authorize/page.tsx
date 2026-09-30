import { FlaskConical, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { requireAgency } from '@/lib/auth/context';
import { providerKeys, type ProviderKey } from '@/modules/integrations/constants';
import { callbackUrl, sandboxEnabled } from '@/modules/integrations/providers';
import { sandboxCode } from '@/modules/integrations/providers/sandbox-code';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('integrations.sandboxConsent');
  return { title: t('title') };
}

/**
 * The sandbox platform's consent screen (ADR-068): plays the part of Meta / TikTok / Snapchat / Google's OAuth
 * dialog so the whole connect flow (signed state → consent → callback → Vault) runs without live credentials. It only
 * ever sends the browser back to our own callback URL for that provider.
 */
export default async function SandboxAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; state?: string; redirect_uri?: string }>;
}) {
  await requireAgency('integrations:manage');
  if (!sandboxEnabled()) notFound();
  const { provider, state, redirect_uri: redirectUri } = await searchParams;
  if (!provider || !(providerKeys as readonly string[]).includes(provider) || provider === 'whatsapp' || !state) notFound();
  const key = provider as ProviderKey;
  if (redirectUri !== callbackUrl(key)) notFound();
  const t = await getTranslations('integrations');

  const back = (params: Record<string, string>) => {
    const url = new URL(redirectUri);
    for (const [k, v] of Object.entries({ ...params, state })) url.searchParams.set(k, v);
    return url.toString();
  };

  return (
    <div className="mx-auto max-w-md py-8">
      <Card className="space-y-5 p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-warning-soft text-warning">
            <FlaskConical className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="font-semibold">{t('sandboxConsent.heading', { provider: t(`providers.${key}.name`) })}</h1>
            <p className="text-sm text-muted-foreground">{t('sandboxConsent.body')}</p>
          </div>
        </div>
        <ul className="space-y-2 text-sm">
          {(['ads', 'leads', 'pages'] as const).map((s) => (
            <li key={s} className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-success" aria-hidden />
              {t(`sandboxConsent.scopes.${s}`)}
            </li>
          ))}
        </ul>
        <div className="grid gap-2">
          <Button asChild>
            <a href={back({ code: sandboxCode(false) })} data-testid="sandbox-allow">
              {t('sandboxConsent.allow')}
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={back({ code: sandboxCode(true) })} data-testid="sandbox-allow-short">
              {t('sandboxConsent.allowShort')}
            </a>
          </Button>
          <Button asChild variant="ghost">
            <a href={back({ error: 'access_denied' })} data-testid="sandbox-deny">
              {t('sandboxConsent.deny')}
            </a>
          </Button>
        </div>
        <p className="text-xs text-subtle-foreground">{t('sandboxConsent.shortHint')}</p>
      </Card>
    </div>
  );
}
