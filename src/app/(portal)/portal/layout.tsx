import { getLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { PortalShell } from '@/components/shell/portal-shell';
import { toShellData } from '@/components/shell/shell-data';
import { requirePortalChooser } from '@/lib/auth/context';

/** Layer 2 of side separation: re-validates an active client membership against the database. */
export default async function PortalLayout({ children }: { children: ReactNode }) {
  // Pages that show a client's data call requirePortal() (which asks to choose an account first when needed).
  const ctx = await requirePortalChooser();
  const locale = await getLocale();
  const data = toShellData(ctx, locale);
  const brand = data.organization.brandColor;
  return (
    <>
      {brand && /^#[0-9a-fA-F]{6}$/.test(brand) ? <style>{`:root{--brand:${brand}}`}</style> : null}
      <PortalShell data={data}>{children}</PortalShell>
    </>
  );
}
