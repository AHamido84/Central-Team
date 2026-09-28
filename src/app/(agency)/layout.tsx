import { cookies } from 'next/headers';
import { getLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { AgencyShell } from '@/components/shell/agency-shell';
import { toShellData } from '@/components/shell/shell-data';
import { requireAgency } from '@/lib/auth/context';

/** Layer 2 of side separation: re-validates an active agency membership against the database. */
export default async function AgencyLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAgency();
  const locale = await getLocale();
  const collapsed = (await cookies()).get('sidebar_collapsed')?.value === '1';
  return (
    <AgencyShell data={toShellData(ctx, locale)} initialCollapsed={collapsed}>
      {children}
    </AgencyShell>
  );
}
