'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/button';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('common');
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <EmptyState
        icon={TriangleAlert}
        title={t('errorTitle')}
        description={t('errorBody')}
        action={<Button onClick={reset}>{t('retry')}</Button>}
      />
    </div>
  );
}
