import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

import { localized, type Locale } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { PublicLeadForm } from '@/modules/crm/components/public-lead-form';
import { publicFormByToken, publicOrganization, signFormTicket } from '@/modules/crm/server/intake';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('crm.publicForm');
  return { title: t('title') };
}

/** Public, embeddable (iframe) lead form — no session; the ticket signs the load time for spam protection. */
export default async function PublicFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations('crm.publicForm');
  const locale = (await getLocale()) as Locale;
  const form = await publicFormByToken(token);
  if (!form) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p className="text-muted-foreground">{t('notFound')}</p>
      </main>
    );
  }
  const org = await publicOrganization(form.organizationId);
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex items-center gap-3">
        {org?.logoPath ? (
          // eslint-disable-next-line @next/next/no-img-element -- public asset URL, sized by CSS
          <img src={publicAssetUrl(org.logoPath)!} alt="" className="size-10 rounded-lg object-contain" />
        ) : null}
        <p className="font-semibold">{org ? localized(org.name, locale) : ''}</p>
      </div>
      <h1 className="text-h2 font-semibold">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      <PublicLeadForm
        token={form.token}
        ticket={signFormTicket(form.id)}
        services={form.services}
        thankYou={localized(form.thankYou, locale)}
      />
    </main>
  );
}
