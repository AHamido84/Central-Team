'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { DirIcon } from '@/components/patterns';

type Labels = Record<string, string>;
const BreadcrumbContext = createContext<{ labels: Labels; setLabel: (segment: string, label: string) => void } | null>(null);

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [labels, setLabels] = useState<Labels>({});
  const setLabel = (segment: string, label: string) =>
    setLabels((prev) => (prev[segment] === label ? prev : { ...prev, [segment]: label }));
  return <BreadcrumbContext.Provider value={{ labels, setLabel }}>{children}</BreadcrumbContext.Provider>;
}

/** Lets a page name a dynamic segment (e.g. a client id) in the breadcrumb trail. */
export function BreadcrumbLabel({ segment, label }: { segment: string; label: string }) {
  const ctx = useContext(BreadcrumbContext);
  useEffect(() => {
    ctx?.setLabel(segment, label);
  }, [ctx, segment, label]);
  return null;
}

const segmentKeys: Record<string, string> = {
  dashboard: 'nav.dashboard',
  notifications: 'nav.inbox',
  clients: 'nav.clients',
  messages: 'nav.messages',
  admin: 'nav.sectionAdmin',
  users: 'nav.users',
  roles: 'nav.roles',
  departments: 'nav.departments',
  packages: 'nav.packages',
  features: 'nav.features',
  audit: 'nav.audit',
  organization: 'nav.organization',
  settings: 'nav.settings',
  profile: 'common.profile',
  preferences: 'nav.preferences',
  new: 'common.create',
  edit: 'common.edit',
  dev: 'nav.designSystem',
  'design-system': 'nav.designSystem',
};

export function Breadcrumbs() {
  const t = useTranslations();
  const pathname = usePathname();
  const ctx = useContext(BreadcrumbContext);
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length <= 1) return null;
  const crumbs = segments.map((segment, i) => {
    const href = `/${segments.slice(0, i + 1).join('/')}`;
    const key = segmentKeys[segment];
    const label = ctx?.labels[segment] ?? (key ? t(key as never) : null);
    return { href, label, segment };
  });
  return (
    <nav aria-label={t('common.breadcrumbs')} className="hidden min-w-0 items-center text-sm md:flex">
      <ol className="flex min-w-0 items-center gap-1.5">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          if (!c.label) return null;
          return (
            <li key={c.href} className="flex min-w-0 items-center gap-1.5">
              {i > 0 ? <DirIcon icon={ChevronRight} className="size-3.5 shrink-0 text-subtle-foreground" /> : null}
              {last ? (
                <span aria-current="page" className="truncate font-medium text-foreground">
                  {c.label}
                </span>
              ) : (
                <Link href={c.href} className="truncate text-muted-foreground transition-colors hover:text-foreground">
                  {c.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
