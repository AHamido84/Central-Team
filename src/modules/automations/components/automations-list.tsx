'use client';

import { ChevronRight, Copy, Plus, Workflow } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { DirIcon, EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Badge, Card, Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { labelKey } from '@/modules/automations/components/labels';
import { duplicateAutomationAction, toggleAutomationAction } from '@/modules/automations/server/actions';
import type { AutomationListItem } from '@/modules/automations/server/queries';

export function AutomationsList({ items, canManage }: { items: AutomationListItem[]; canManage: boolean }) {
  const t = useTranslations('automations');
  const format = useFormat();
  const router = useRouter();
  const toggle = useAction(toggleAutomationAction);
  const duplicate = useAction(duplicateAutomationAction, { onSuccess: (r) => router.push(`/admin/automations/${r.id}`) });

  if (!items.length)
    return (
      <Card>
        <EmptyState
          icon={Workflow}
          title={t('emptyTitle')}
          description={t('emptyBody')}
          action={
            canManage ? (
              <Button asChild>
                <Link href="/admin/automations/new">
                  <Plus aria-hidden />
                  {t('new')}
                </Link>
              </Button>
            ) : undefined
          }
        />
      </Card>
    );

  return (
    <Card>
      <ul className="divide-y divide-border">
        {items.map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-5 py-4" data-testid="automation-row">
            {canManage ? (
              <Switch
                checked={a.isActive}
                onCheckedChange={(v) => void toggle.run({ id: a.id, isActive: v })}
                aria-label={`${a.name} · ${t('active')}`}
              />
            ) : (
              <Badge tone={a.isActive ? 'success' : 'neutral'}>{a.isActive ? t('active') : t('inactive')}</Badge>
            )}
            <Link href={`/admin/automations/${a.id}`} className="group min-w-0 flex-1 focus-visible:outline-none">
              <p className="truncate text-sm font-medium group-hover:underline group-focus-visible:underline">
                <bdi>{a.name}</bdi>
              </p>
              <p className="mt-0.5 text-xs text-subtle-foreground">
                {t('whenThen', {
                  trigger: t(`triggers.${labelKey(a.triggerType)}` as never),
                  actions: format.list(a.actions.map((x) => t(`actionTypes.${x}` as never))),
                })}
              </p>
              <p className="mt-0.5 text-xs text-subtle-foreground">
                {t('stats', { runs: a.runCount, failures: a.failureCount })}
                {a.lastRunAt ? <> · {t('lastRun', { when: format.relative(a.lastRunAt) })}</> : null}
              </p>
            </Link>
            {canManage ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`${a.name} · ${t('duplicate')}`}
                onClick={() => void duplicate.run({ id: a.id })}
              >
                <Copy aria-hidden />
              </Button>
            ) : null}
            <DirIcon icon={ChevronRight} className="size-4 text-subtle-foreground" />
          </li>
        ))}
      </ul>
    </Card>
  );
}
