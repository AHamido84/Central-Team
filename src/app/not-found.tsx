import { SearchX } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/button';

export default async function NotFound() {
  const t = await getTranslations('common');
  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <EmptyState
        icon={SearchX}
        title={t('notFoundTitle')}
        description={t('notFoundBody')}
        action={
          <Button asChild>
            <Link href="/">{t('goHome')}</Link>
          </Button>
        }
      />
    </div>
  );
}
