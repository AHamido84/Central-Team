import { CheckCircle2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { LanguageSwitcher } from '@/components/shell/preferences-menu';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations();
  const points = [t('auth.panelPoint1'), t('auth.panelPoint2'), t('auth.panelPoint3')];
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,34rem)]">
      <div className="flex flex-col px-(--gutter) py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground">
              {t('common.appName').charAt(0)}
            </span>
            <span className="font-semibold">{t('common.appName')}</span>
          </div>
          <LanguageSwitcher variant="full" />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm animate-fade-in">{children}</div>
        </div>
      </div>
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-end">
        <div
          aria-hidden
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, rgb(255 255 255 / 0.35) 0, transparent 40%), radial-gradient(circle at 80% 60%, rgb(223 188 127 / 0.6) 0, transparent 45%)',
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(45deg, currentColor 25%, transparent 25%, transparent 75%, currentColor 75%), linear-gradient(45deg, currentColor 25%, transparent 25%, transparent 75%, currentColor 75%)',
            backgroundSize: '28px 28px',
            backgroundPosition: '0 0, 14px 14px',
          }}
        />
        <div className="relative p-12">
          <p className="text-display font-semibold text-balance">{t('auth.panelTitle')}</p>
          <p className="mt-3 max-w-md text-primary-foreground/80">{t('auth.panelBody')}</p>
          <ul className="mt-8 space-y-3">
            {points.map((p) => (
              <li key={p} className="flex items-center gap-3 text-sm">
                <CheckCircle2 className="size-5 text-[var(--sand-300)]" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
