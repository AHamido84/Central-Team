'use client';

import { Check, ChevronsUpDown, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { BreadcrumbProvider } from '@/components/shell/breadcrumbs';
import { isActive, isNavItemVisible, portalNav } from '@/components/shell/nav';
import { LanguageSwitcher, ThemeToggle } from '@/components/shell/preferences-menu';
import type { ShellData } from '@/components/shell/shell-data';
import { UserMenu } from '@/components/shell/user-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/overlays';
import { Avatar, Badge } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { cn } from '@/lib/utils/cn';
import { NotificationBell } from '@/modules/notifications/components/notification-bell';
import { switchClientAction } from '@/modules/clients/server/portal-actions';

function ClientSwitcher({ data }: { data: ShellData }) {
  const t = useTranslations('nav');
  const tp = useTranslations('portal.accounts');
  const router = useRouter();
  const switchTo = useAction(switchClientAction, { refresh: false });
  if (!data.client) return null;
  const label = (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={data.client.name} src={data.client.logoUrl} size="xs" square />
      <span className="max-w-[9rem] truncate text-sm font-medium sm:max-w-[14rem]">{data.client.name}</span>
    </span>
  );
  if (data.clients.length <= 1) return <div className="hidden min-w-0 sm:block">{label}</div>;
  // Approvals waiting in the *other* clients: a dot on the trigger so they aren't missed.
  const elsewhere = data.clients.filter((c) => c.id !== data.client?.id).reduce((n, c) => n + c.pendingApprovals, 0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative flex min-w-0 items-center gap-1 rounded-md px-2 py-1 hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={t('switchClient')}
        data-testid="client-switcher"
      >
        {label}
        <ChevronsUpDown className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden />
        {elsewhere > 0 ? (
          <span
            className="absolute end-0 -top-0.5 size-2 rounded-full bg-warning"
            aria-label={tp('pendingElsewhere', { count: elsewhere })}
          />
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>{t('switchClient')}</DropdownMenuLabel>
        {data.clients.map((c) => {
          const current = c.id === data.client?.id;
          return (
            <DropdownMenuItem
              key={c.id}
              aria-current={current ? 'true' : undefined}
              data-testid="client-switcher-item"
              data-client-id={c.id}
              className={cn(current && 'bg-primary-soft text-primary-soft-foreground')}
              onSelect={async () => {
                if (current) return;
                const res = await switchTo.run({ clientId: c.id });
                if (res.ok) {
                  router.push('/portal');
                  router.refresh();
                }
              }}
            >
              <Avatar name={c.name} src={c.logoUrl} size="xs" square />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{c.name}</span>
                <span className="truncate text-xs text-subtle-foreground">{c.roleName}</span>
              </span>
              {c.pendingApprovals > 0 ? (
                <Badge tone="warning" aria-label={tp('pendingApprovals', { count: c.pendingApprovals })}>
                  {c.pendingApprovals}
                </Badge>
              ) : null}
              {current ? <Check className="text-primary!" aria-hidden /> : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/portal/choose" data-testid="client-switcher-all">
            {tp('allAccounts')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PortalShell({ data, children }: { data: ShellData; children: ReactNode }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = portalNav.filter((i) => isNavItemVisible(i, data.permissions, data.flags));
  // Bottom bar holds at most 5 slots; extra items move into a "More" sheet.
  const bottomItems = items.length > 5 ? items.slice(0, 4) : items;
  const overflowItems = items.length > 5 ? items.slice(4) : [];

  return (
    <BreadcrumbProvider>
      <div className="flex min-h-dvh flex-col bg-background">
        <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/75">
          <div className="mx-auto flex h-16 w-full max-w-[1080px] items-center gap-3 px-(--gutter)">
            <Link href="/portal" className="flex shrink-0 items-center gap-2.5">
              {data.organization.logoUrl ? (
                <Avatar name={data.organization.name} src={data.organization.logoUrl} size="sm" square />
              ) : (
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                  {data.organization.name.charAt(0)}
                </span>
              )}
              <span className="hidden text-sm font-semibold md:inline">{data.organization.name}</span>
            </Link>
            <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />
            <ClientSwitcher data={data} />
            <nav className="ms-4 hidden flex-1 items-center gap-1 lg:flex" aria-label={t('nav.clientPortal')}>
              {items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary-soft text-primary-soft-foreground'
                        : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
                    )}
                  >
                    {t(`nav.${item.key}` as never)}
                  </Link>
                );
              })}
            </nav>
            <div className="ms-auto flex items-center gap-1">
              <LanguageSwitcher />
              <span className="hidden sm:inline-flex">
                <ThemeToggle />
              </span>
              <NotificationBell userId={data.user.id} inboxHref="/portal/notifications" />
              <span className="ms-1">
                <UserMenu user={data.user} settingsBase="/portal/settings" compact subtitle={data.client?.roleName} />
              </span>
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-[1080px] flex-1 px-(--gutter) pt-6 pb-28 md:pt-10 lg:pb-12">
          {children}
        </main>

        <footer className="hidden pb-8 text-center text-xs text-subtle-foreground lg:block">{t('common.poweredBy')}</footer>

        <nav
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
          aria-label={t('nav.clientPortal')}
          data-testid="portal-bottom-nav"
        >
          <ul className="mx-auto flex max-w-lg items-stretch justify-around">
            {bottomItems.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href} className="flex-1">
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium transition-colors',
                      active ? 'text-primary' : 'text-subtle-foreground',
                    )}
                  >
                    <item.icon className={cn('size-5', active && 'stroke-[2.25]')} aria-hidden />
                    {t(`nav.${item.key}` as never)}
                  </Link>
                </li>
              );
            })}
            {overflowItems.length > 0 ? (
              <li className="flex-1">
                <button
                  type="button"
                  onClick={() => setMoreOpen(true)}
                  className="flex h-16 w-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-subtle-foreground"
                >
                  <MoreHorizontal className="size-5" aria-hidden />
                  {t('nav.more')}
                </button>
              </li>
            ) : null}
          </ul>
        </nav>
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent closeLabel={t('common.close')} className="p-4">
            <SheetTitle className="mb-4">{t('nav.more')}</SheetTitle>
            <ul className="space-y-1">
              {overflowItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className="flex items-center gap-3 rounded-md px-3 py-3 hover:bg-surface-muted"
                  >
                    <item.icon className="size-5 text-subtle-foreground" aria-hidden />
                    {t(`nav.${item.key}` as never)}
                  </Link>
                </li>
              ))}
            </ul>
          </SheetContent>
        </Sheet>
      </div>
    </BreadcrumbProvider>
  );
}
