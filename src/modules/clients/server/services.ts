import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { ActionFailure } from '@/lib/actions/errors';
import type { AgencyContext } from '@/lib/auth/context';
import type { Tx } from '@/lib/db/client';
import { clientAssignments, clientNotes, clientPackages, clients, fileFolders, threads } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import type { LocalizedText } from '@/lib/i18n/localized';

/** Shared by the client form and the won-deal conversion (CRM); both run in the caller's RLS transaction. */
export type NewClient = {
  name: LocalizedText;
  industry: string | null;
  city: string | null;
  website: string | null;
  social: Record<string, string>;
  status: string;
  accountManagerId: string | null;
  startDate: string | null;
  notes: string | null;
  teamIds: string[];
};

function slugify(name: string) {
  const base = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
  return base || 'client';
}

/** Default folder structure every new client starts with. */
function defaultFolders(orgId: string, clientId: string, userId: string) {
  return [
    { name: 'الهوية البصرية · Brand assets', kind: 'brand', visibility: 'client' },
    { name: 'التقارير · Reports', kind: 'type', visibility: 'client' },
    { name: 'مسودات داخلية · Internal drafts', kind: 'custom', visibility: 'internal' },
  ].map((f) => ({ ...f, organizationId: orgId, clientId, createdBy: userId }));
}

export async function createClientRecord(tx: Tx, ctx: AgencyContext, input: NewClient): Promise<{ clientId: string }> {
  const base = slugify(input.name.en || input.name.ar || '');
  const existing = await tx
    .select({ slug: clients.slug })
    .from(clients)
    .where(and(eq(clients.organizationId, ctx.organization.id), sql`${clients.slug} like ${`${base}%`}`));
  const taken = new Set(existing.map((e) => e.slug));
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  const clientId = crypto.randomUUID();
  await tx.insert(clients).values({
    id: clientId,
    organizationId: ctx.organization.id,
    name: input.name,
    slug,
    industry: input.industry,
    city: input.city,
    website: input.website,
    social: input.social,
    status: input.status,
    accountManagerId: input.accountManagerId,
    startDate: input.startDate,
    createdBy: ctx.session.userId,
  });
  if (input.notes)
    await tx
      .insert(clientNotes)
      .values({ clientId, organizationId: ctx.organization.id, body: input.notes, updatedBy: ctx.session.userId });
  if (input.teamIds.length) {
    await tx.insert(clientAssignments).values(input.teamIds.map((userId) => ({ clientId, userId, organizationId: ctx.organization.id })));
  }
  await tx.insert(fileFolders).values(defaultFolders(ctx.organization.id, clientId, ctx.session.userId));
  await tx.insert(threads).values({
    organizationId: ctx.organization.id,
    clientId,
    title: 'عام · General',
    visibility: 'client',
    createdBy: ctx.session.userId,
  });
  await emitEvent(tx, {
    type: 'client.created',
    organizationId: ctx.organization.id,
    actorId: ctx.session.userId,
    aggregate: { type: 'client', id: clientId },
    clientId,
    payload: { clientId },
  });
  return { clientId };
}

export async function assignClientPackage(
  tx: Tx,
  ctx: AgencyContext,
  input: { clientId: string; packageId: string; periodStart: string; periodEnd: string },
): Promise<{ clientPackageId: string }> {
  const [row] = await tx
    .insert(clientPackages)
    .values({
      organizationId: ctx.organization.id,
      clientId: input.clientId,
      packageId: input.packageId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      createdBy: ctx.session.userId,
    })
    .returning({ id: clientPackages.id });
  if (!row) throw new ActionFailure('forbidden');
  await emitEvent(tx, {
    type: 'client_package.assigned',
    organizationId: ctx.organization.id,
    actorId: ctx.session.userId,
    aggregate: { type: 'client_package', id: row.id },
    clientId: input.clientId,
    payload: { clientId: input.clientId, clientPackageId: row.id, packageId: input.packageId },
  });
  return { clientPackageId: row.id };
}
