'use client';

import { Blocks, Rocket } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useOptimistic, useTransition } from 'react';

import { SectionTitle } from '@/components/patterns';
import { Badge, Card, Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { toggleFeatureAction } from '@/modules/organizations/server/actions';

export type FeatureRow = { key: string; module: string; description: LocalizedText; enabled: boolean; upcoming: boolean };

export function FeatureToggles({ features }: { features: FeatureRow[] }) {
  const t = useTranslations('admin.features');
  const locale = useLocale() as Locale;
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(features, (state, update: { key: string; enabled: boolean }) =>
    state.map((f) => (f.key === update.key ? { ...f, enabled: update.enabled } : f)),
  );
  const toggle = useAction(toggleFeatureAction, { successMessage: t('saved') });
  const groups = [
    { key: 'live', icon: Blocks, items: optimistic.filter((f) => !f.upcoming) },
    { key: 'upcoming', icon: Rocket, items: optimistic.filter((f) => f.upcoming) },
  ] as const;
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.key}>
          <SectionTitle title={t(`${g.key}Title`)} />
          <p className="-mt-2 mb-3 text-sm text-muted-foreground">{t(`${g.key}Hint`)}</p>
          <Card className="divide-y divide-border">
            {g.items.map((f) => (
              <label key={f.key} className="flex cursor-pointer items-center gap-4 px-5 py-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-muted text-muted-foreground">
                  <g.icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{localized(f.description, locale)}</span>
                  <code className="text-xs text-subtle-foreground" dir="ltr">
                    {f.key}
                  </code>
                </span>
                {f.upcoming ? <Badge tone="accent">{t('upcomingBadge')}</Badge> : null}
                <Switch
                  checked={f.enabled}
                  onCheckedChange={(enabled) =>
                    startTransition(async () => {
                      setOptimistic({ key: f.key, enabled });
                      await toggle.run({ flagKey: f.key, enabled });
                    })
                  }
                  data-testid={`flag-${f.key}`}
                />
              </label>
            ))}
          </Card>
        </section>
      ))}
    </div>
  );
}
