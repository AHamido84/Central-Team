'use client';

import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/primitives';
import { healthTone, type ConnectionHealth, type MessageStatus, type SyncStatus } from '@/modules/integrations/constants';

export function HealthBadge({ health }: { health: ConnectionHealth }) {
  const t = useTranslations('integrations.health');
  return (
    <Badge tone={healthTone[health]} dot data-testid="connection-health">
      {t(health)}
    </Badge>
  );
}

const syncTone: Record<SyncStatus, 'neutral' | 'info' | 'success' | 'danger'> = {
  queued: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
};

export function SyncStatusBadge({ status }: { status: SyncStatus }) {
  const t = useTranslations('integrations.syncStatus');
  return (
    <Badge tone={syncTone[status]} dot>
      {t(status)}
    </Badge>
  );
}

const messageTone: Record<MessageStatus, 'neutral' | 'info' | 'success' | 'danger' | 'brand'> = {
  queued: 'neutral',
  sent: 'info',
  delivered: 'success',
  read: 'brand',
  failed: 'danger',
};

export function MessageStatusBadge({ status }: { status: MessageStatus }) {
  const t = useTranslations('integrations.messageStatus');
  return (
    <Badge tone={messageTone[status]} dot data-testid="message-status">
      {t(status)}
    </Badge>
  );
}

export function ModeBadge({ mode }: { mode: 'live' | 'sandbox' }) {
  const t = useTranslations('integrations');
  return mode === 'sandbox' ? <Badge tone="warning">{t('sandbox')}</Badge> : null;
}
