'use client';

import { Building2, CalendarDays, Globe, Mail, MapPin, MessageCircle, StickyNote } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Bdi, SectionTitle } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Avatar, Card } from '@/components/ui/primitives';
import { publicAssetUrl } from '@/lib/storage';
import { cities, industries, socialNetworks, socialUrl, type SocialNetwork } from '@/modules/clients/constants';

export function whatsappLink(phone: string) {
  return `https://wa.me/${phone.replace(/[^\d]/g, '')}`;
}

function Row({ icon: Icon, label, children }: { icon: typeof Globe; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-subtle-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-subtle-foreground">{label}</p>
        <div className="text-sm">{children}</div>
      </div>
    </div>
  );
}

export function CompanyInfoCard({
  industry,
  city,
  website,
  social,
  startDate,
}: {
  industry: string | null;
  city: string | null;
  website: string | null;
  social: Record<string, string>;
  startDate?: string | null;
}) {
  const t = useTranslations('clients');
  const f = useFormat();
  const handles = socialNetworks.filter((n) => social[n]);
  return (
    <Card className="px-5 py-2">
      <Row icon={Building2} label={t('industry')}>
        {industry && (industries as readonly string[]).includes(industry) ? t(`industries.${industry as (typeof industries)[number]}`) : '—'}
      </Row>
      <Row icon={MapPin} label={t('city')}>
        {city && (cities as readonly string[]).includes(city) ? t(`cities.${city as (typeof cities)[number]}`) : '—'}
      </Row>
      <Row icon={Globe} label={t('websiteLabel')}>
        {website ? (
          <a href={website} target="_blank" rel="noreferrer noopener" className="text-link hover:underline">
            <Bdi>{website.replace(/^https?:\/\//, '')}</Bdi>
          </a>
        ) : (
          '—'
        )}
      </Row>
      {startDate !== undefined ? (
        <Row icon={CalendarDays} label={t('startDate')}>
          {startDate ? f.date(startDate, 'long') : '—'}
        </Row>
      ) : null}
      {handles.length ? (
        <div className="flex flex-wrap gap-2 py-3">
          {handles.map((n: SocialNetwork) => (
            <a
              key={n}
              href={socialUrl[n](social[n]!)}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs hover:bg-surface-muted"
            >
              <span className="font-medium">{t(`social.${n}`)}</span>
              <Bdi className="text-subtle-foreground">@{social[n]}</Bdi>
            </a>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

export function AccountManagerCard({
  manager,
  title,
}: {
  manager: { name: string; email: string; phone: string | null; whatsapp: string | null; avatarPath: string | null } | null;
  title?: string;
}) {
  const t = useTranslations('clients');
  if (!manager) {
    return (
      <Card className="p-5 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{title ?? t('accountManager')}</p>
        <p className="mt-1">{t('noAccountManager')}</p>
      </Card>
    );
  }
  const wa = manager.whatsapp ?? manager.phone;
  return (
    <Card className="p-5" data-testid="account-manager-card">
      <p className="text-xs font-medium text-subtle-foreground">{title ?? t('accountManager')}</p>
      <div className="mt-3 flex items-center gap-3">
        <Avatar name={manager.name} src={publicAssetUrl(manager.avatarPath)} size="lg" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{manager.name}</p>
          <p className="truncate text-xs text-subtle-foreground">
            <Bdi>{manager.email}</Bdi>
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {wa ? (
          <Button asChild variant="outline" size="sm" className="border-[#25D366]/40 text-[#128C7E] hover:bg-[#25D366]/10 dark:text-[#4ade80]">
            <a href={whatsappLink(wa)} target="_blank" rel="noreferrer noopener" data-testid="am-whatsapp">
              <MessageCircle />
              {t('whatsapp')}
            </a>
          </Button>
        ) : null}
        <Button asChild variant="outline" size="sm" className={wa ? '' : 'col-span-2'}>
          <a href={`mailto:${manager.email}`} data-testid="am-email">
            <Mail />
            {t('email')}
          </a>
        </Button>
      </div>
    </Card>
  );
}

export function InternalNotesCard({ notes }: { notes: string }) {
  const t = useTranslations('clients');
  return (
    <section>
      <SectionTitle title={t('notes')} />
      <Card className="border-dashed border-warning/50 bg-warning-soft/40 p-4">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-warning">
          <StickyNote className="size-3.5" aria-hidden />
          {t('internalOnly')}
        </p>
        <p className="text-sm whitespace-pre-wrap">{notes || t('noNotes')}</p>
      </Card>
    </section>
  );
}
