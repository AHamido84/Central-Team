'use client';

import { Bell, Link2, Settings2, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils/cn';

export function SettingsNav({ base, showConnections = false }: { base: '/settings' | '/portal/settings'; showConnections?: boolean }) {
  const t = useTranslations();
  const pathname = usePathname();
  const items = [
    { href: `${base}/profile`, label: t('common.profile'), icon: UserRound },
    { href: `${base}/preferences`, label: t('nav.preferences'), icon: Settings2 },
    { href: `${base}/notifications`, label: t('nav.notificationSettings'), icon: Bell },
    ...(showConnections ? [{ href: `${base}/connections`, label: t('nav.myConnections'), icon: Link2 }] : []),
  ];
  return (
    <nav className="-mx-(--gutter) overflow-x-auto px-(--gutter)" aria-label={t('nav.settings')}>
      <ul className="flex gap-1 border-b border-border">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors',
                  active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
