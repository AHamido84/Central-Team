import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

import { DirIcon, PageHeader } from '@/components/patterns';
import { Avatar, Badge, Card } from '@/components/ui/primitives';
import { requirePortalChooser } from '@/lib/auth/context';
import { localized, type Locale } from '@/lib/i18n/localized';
import { getFormatters } from '@/lib/i18n/server-format';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('portal.accounts');
  return { title: t('chooseTitle') };
}

/** "Choose an account" (FR4.3): every client the user belongs to; picking one goes through the switch route. */
export default async function ChooseAccountPage() {
  const ctx = await requirePortalChooser();
  const t = await getTranslations('portal.accounts');
  const locale = (await getLocale()) as Locale;
  const f = await getFormatters();
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <PageHeader title={t('chooseTitle')} description={t('chooseDescription')} />
      <ul className="flex flex-col gap-3" data-testid="account-list">
        {ctx.clients.map((c) => {
          const current = !ctx.needsChoice && c.id === ctx.client.id;
          return (
            <li key={c.id}>
              <Card className={cn('transition-colors hover:bg-surface-muted', current && 'border-primary')}>
                {/* A full navigation (not <Link>): the shell is re-rendered for the chosen client. */}
                <a
                  href={`/portal/switch?client=${c.id}&next=/portal`}
                  className="flex items-center gap-4 rounded-xl p-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  data-testid="account-option"
                  data-client-id={c.id}
                  aria-current={current ? 'true' : undefined}
                >
                  <Avatar name={localized(c.name, locale)} src={publicAssetUrl(c.logoPath)} size="lg" square />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate font-semibold">{localized(c.name, locale)}</span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-subtle-foreground">
                      <span>{localized(c.roleName, locale)}</span>
                      {c.canApprove ? <span>· {t('canApprove')}</span> : null}
                      {current ? <Badge tone="brand">{t('current')}</Badge> : null}
                    </span>
                  </span>
                  {c.pendingApprovals > 0 ? <Badge tone="warning">{t('pendingApprovals', { count: c.pendingApprovals })}</Badge> : null}
                  <DirIcon icon={ChevronRight} className="size-4 shrink-0 text-subtle-foreground" />
                </a>
              </Card>
            </li>
          );
        })}
      </ul>
      <p className="text-center text-xs text-subtle-foreground">{t('switchHint', { count: f.number(ctx.clients.length) })}</p>
    </div>
  );
}
