import 'server-only';

import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db/client';
import { clientPackages, packageItems, packageUsageEntries, packages } from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';

export type PackageUsageItem = { itemType: string; allowed: number; used: number; remaining: number; ratio: number };

export type PackageUsage = {
  clientPackageId: string;
  packageId: string;
  packageName: LocalizedText;
  priceMinor: number | null;
  currency: string;
  periodStart: string;
  periodEnd: string;
  items: PackageUsageItem[];
  totals: { allowed: number; used: number; ratio: number };
  /** Share of the period elapsed (0–1), to compare pace against usage. */
  elapsed: number;
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Package usage service: allowed vs used per item type for a client package. `used` comes from the
 * `package_usage_entries` ledger that later phases (deliverables, revisions) append to.
 * Runs inside the caller's RLS transaction, so a client only ever sees their own package.
 */
export async function getPackageUsage(tx: Tx, clientPackageId: string): Promise<PackageUsage | null> {
  const [cp] = await tx
    .select({ cp: clientPackages, pkg: packages })
    .from(clientPackages)
    .innerJoin(packages, eq(packages.id, clientPackages.packageId))
    .where(eq(clientPackages.id, clientPackageId));
  if (!cp) return null;
  const allowed = await tx
    .select({ itemType: packageItems.itemType, quantity: packageItems.quantity })
    .from(packageItems)
    .where(eq(packageItems.packageId, cp.pkg.id))
    .orderBy(asc(packageItems.sortOrder));
  const used = await tx
    .select({ itemType: packageUsageEntries.itemType, total: sql<number>`sum(${packageUsageEntries.quantity})::int` })
    .from(packageUsageEntries)
    .where(eq(packageUsageEntries.clientPackageId, clientPackageId))
    .groupBy(packageUsageEntries.itemType);
  const items = allowed.map((a) => {
    const u = used.find((x) => x.itemType === a.itemType)?.total ?? 0;
    return { itemType: a.itemType, allowed: a.quantity, used: u, remaining: Math.max(0, a.quantity - u), ratio: a.quantity ? Math.min(1, u / a.quantity) : 0 };
  });
  const totalAllowed = items.reduce((n, i) => n + i.allowed, 0);
  const totalUsed = items.reduce((n, i) => n + Math.min(i.used, i.allowed), 0);
  const start = new Date(cp.cp.periodStart).getTime();
  const end = new Date(cp.cp.periodEnd).getTime() + 86_400_000;
  const elapsed = Math.min(1, Math.max(0, (Date.now() - start) / (end - start)));
  return {
    clientPackageId: cp.cp.id,
    packageId: cp.pkg.id,
    packageName: cp.pkg.name,
    priceMinor: cp.pkg.priceMinor,
    currency: cp.pkg.currency,
    periodStart: cp.cp.periodStart,
    periodEnd: cp.cp.periodEnd,
    items,
    totals: { allowed: totalAllowed, used: totalUsed, ratio: totalAllowed ? totalUsed / totalAllowed : 0 },
    elapsed,
  };
}

/** The client's package for today (latest start wins), or the most recent past one. */
export async function getCurrentClientPackageId(tx: Tx, clientId: string): Promise<string | null> {
  const d = today();
  const [current] = await tx
    .select({ id: clientPackages.id })
    .from(clientPackages)
    .where(and(eq(clientPackages.clientId, clientId), lte(clientPackages.periodStart, d), gte(clientPackages.periodEnd, d)))
    .orderBy(desc(clientPackages.periodStart))
    .limit(1);
  if (current) return current.id;
  const [latest] = await tx
    .select({ id: clientPackages.id })
    .from(clientPackages)
    .where(eq(clientPackages.clientId, clientId))
    .orderBy(desc(clientPackages.periodStart))
    .limit(1);
  return latest?.id ?? null;
}

export async function getCurrentPackageUsage(tx: Tx, clientId: string): Promise<PackageUsage | null> {
  const id = await getCurrentClientPackageId(tx, clientId);
  return id ? getPackageUsage(tx, id) : null;
}
