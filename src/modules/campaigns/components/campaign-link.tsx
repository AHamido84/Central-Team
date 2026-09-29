'use client';

import { Megaphone } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

import { NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { linkDeliverableAction, linkRequestAction } from '@/modules/campaigns/server/actions';
import type { CampaignOption } from '@/modules/campaigns/server/queries';

/** Links a request (or a deliverable) to one of its client's campaigns; read-only without `campaigns:manage`. */
export function CampaignLinkField({
  subject,
  campaignId,
  options,
  canManage,
}: {
  subject: { type: 'request' | 'deliverable'; id: string };
  campaignId: string | null;
  options: CampaignOption[];
  canManage: boolean;
}) {
  const t = useTranslations('campaigns');
  const id = useId();
  const linkRequest = useAction(linkRequestAction, { successMessage: t('link.saved') });
  const linkDeliverable = useAction(linkDeliverableAction, { successMessage: t('link.saved') });
  const current = options.find((o) => o.id === campaignId);
  const onChange = (value: string) => {
    const next = value || null;
    if (subject.type === 'request') void linkRequest.run({ requestId: subject.id, campaignId: next });
    else void linkDeliverable.run({ deliverableId: subject.id, campaignId: next });
  };
  return (
    <div className="grid gap-1.5" data-testid="campaign-link">
      <label htmlFor={id} className="inline-flex items-center gap-1.5 text-sm font-medium">
        <Megaphone className="size-4 text-subtle-foreground" aria-hidden />
        {t('link.label')}
      </label>
      {canManage ? (
        <NativeSelect
          id={id}
          value={campaignId ?? ''}
          disabled={linkRequest.pending || linkDeliverable.pending}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={`${id}-hint`}
          data-testid="campaign-link-select"
        >
          <option value="">{t('link.none')}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </NativeSelect>
      ) : current ? (
        <Link id={id} href={`/campaigns/${current.id}`} className="text-sm text-link hover:underline">
          {current.name}
        </Link>
      ) : (
        <span id={id} className="text-sm text-subtle-foreground">
          {t('link.none')}
        </span>
      )}
      {canManage ? (
        <p id={`${id}-hint`} className="text-xs text-subtle-foreground">
          {t('link.hint')}
        </p>
      ) : null}
    </div>
  );
}
