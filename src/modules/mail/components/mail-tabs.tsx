'use client';

import { Inbox, Mail } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils/cn';

export function MailTabs() {
  const t = useTranslations('mail.tabs');
  const pathname = usePathname();
  const items = [
    { href: '/admin/mail', label: t('settings'), icon: Mail },
    { href: '/admin/mail/log', label: t('log'), icon: Inbox },
  ];
  return (
    <nav className="-mx-(--gutter) mb-6 overflow-x-auto px-(--gutter)" aria-label={t('settings')}>
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
                data-testid={`mail-tab-${item.href.endsWith('log') ? 'log' : 'settings'}`}
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

/** Development only: everything lands in Mailpit unless real sending is switched on. */
export function DevMailNotice({ mailbox }: { mailbox: string }) {
  const t = useTranslations('mail');
  return (
    <p className="mb-6 rounded-lg border border-info/40 bg-info/5 p-3 text-sm" role="note" data-testid="mail-dev-notice">
      {t.rich('devNotice', {
        link: (chunks) => (
          <a href={mailbox} target="_blank" rel="noreferrer" className="font-medium text-primary underline">
            {chunks}
          </a>
        ),
      })}
    </p>
  );
}
