'use server';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import type { AppContext } from '@/lib/auth/context';
import {
  clientAssignments,
  clientNotes,
  clientPackages,
  clientUsers,
  clients,
  fileFolders,
  packageItems,
  packageUsageEntries,
  packages,
  roles,
  threads,
} from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { can } from '@/lib/permissions/can';
import { localizedText, optionalText, url } from '@/lib/validation';
import { cities, clientRoleKeys, clientStatuses, industries, packageItemTypes, socialNetworks } from '@/modules/clients/constants';

const logoPath = z
  .string()
  .regex(/^org\/[0-9a-f-]{36}\/clients\/[0-9a-f-]{36}\/logo\/[0-9a-f-]{36}\.(png|jpg|webp)$/)
  .nullable();

const handle = z
  .string()
  .trim()
  .max(80)
  .transform((v) =>
    v
      .replace(/^@/, '')
      .replace(/^https?:\/\/[^/]+\//, '')
      .replace(/\/$/, ''),
  )
  .refine((v) => v === '' || /^[\w.-]{1,60}$/.test(v), { message: 'too_long' });

const social = z.object(
  Object.fromEntries(socialNetworks.map((n) => [n, handle.optional()])) as Record<
    (typeof socialNetworks)[number],
    z.ZodOptional<typeof handle>
  >,
);

const clientFields = z.object({
  name: localizedText(120),
  industry: z.enum(industries).nullable(),
  city: z.enum(cities).nullable(),
  website: url,
  social,
  logoPath,
});

const agencyClientFields = clientFields.extend({
  status: z.enum(clientStatuses),
  accountManagerId: z.uuid().nullable(),
  startDate: z.iso.date().nullable(),
  notes: optionalText(4000),
  teamIds: z.array(z.uuid()).max(50),
});

function cleanSocial(input: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v)) as Record<string, string>;
}

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

export const createClientAction = defineAction({
  input: agencyClientFields,
  side: 'agency',
  permission: 'clients:create',
  async handler({ input, tx, ctx }) {
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
      social: cleanSocial(input.social),
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
  },
  revalidate: ['/clients'],
});

export const updateClientAction = defineAction({
  input: agencyClientFields.extend({ clientId: z.uuid() }),
  side: 'agency',
  permission: 'clients:update',
  async handler({ input, tx, ctx }) {
    if (input.logoPath && !input.logoPath.includes(`/clients/${input.clientId}/`)) throw new ActionFailure('forbidden');
    const [row] = await tx
      .update(clients)
      .set({
        name: input.name,
        industry: input.industry,
        city: input.city,
        website: input.website,
        social: cleanSocial(input.social),
        logoPath: input.logoPath,
        status: input.status,
        accountManagerId: input.accountManagerId,
        startDate: input.startDate,
      })
      .where(eq(clients.id, input.clientId))
      .returning({ id: clients.id });
    if (!row) throw new ActionFailure('not_found');
    await tx
      .insert(clientNotes)
      .values({ clientId: input.clientId, organizationId: ctx.organization.id, body: input.notes ?? '', updatedBy: ctx.session.userId })
      .onConflictDoUpdate({ target: clientNotes.clientId, set: { body: input.notes ?? '', updatedBy: ctx.session.userId } });
    const current = await tx
      .select({ userId: clientAssignments.userId })
      .from(clientAssignments)
      .where(eq(clientAssignments.clientId, input.clientId));
    const currentIds = current.map((c) => c.userId);
    const toRemove = currentIds.filter((id) => !input.teamIds.includes(id));
    const toAdd = input.teamIds.filter((id) => !currentIds.includes(id));
    if (toRemove.length)
      await tx
        .delete(clientAssignments)
        .where(and(eq(clientAssignments.clientId, input.clientId), inArray(clientAssignments.userId, toRemove)));
    if (toAdd.length)
      await tx
        .insert(clientAssignments)
        .values(toAdd.map((userId) => ({ clientId: input.clientId, userId, organizationId: ctx.organization.id })));
    await emitEvent(tx, {
      type: 'client.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'client', id: input.clientId },
      clientId: input.clientId,
      payload: { clientId: input.clientId, fields: Object.keys(input) },
    });
    return { clientId: input.clientId };
  },
  revalidate: (input) => ['/clients', `/clients/${input.clientId}`],
});

/** Company profile edited by a Client Owner from the portal (agency-managed fields are blocked by a trigger). */
export const updateCompanyProfileAction = defineAction({
  input: clientFields,
  side: 'client',
  permission: 'portal_company:update',
  async handler({ input, tx, ctx }) {
    if (input.logoPath && !input.logoPath.includes(`/clients/${ctx.client.id}/`)) throw new ActionFailure('forbidden');
    const [row] = await tx
      .update(clients)
      .set({
        name: input.name,
        industry: input.industry,
        city: input.city,
        website: input.website,
        social: cleanSocial(input.social),
        logoPath: input.logoPath,
      })
      .where(eq(clients.id, ctx.client.id))
      .returning({ id: clients.id });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'client.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'client', id: ctx.client.id },
      clientId: ctx.client.id,
      payload: { clientId: ctx.client.id, fields: ['name', 'industry', 'city', 'website', 'social', 'logoPath'] },
    });
    return null;
  },
  revalidate: ['/portal'],
});

/* -------------------------------------------------------------------------- */
/* Portal users (agency `client_users:manage` or Client Owner `portal_users:manage`) */
/* -------------------------------------------------------------------------- */

function assertManagesClient(ctx: AppContext, clientId: string) {
  if (ctx.side === 'agency' && can(ctx.permissions, 'client_users:manage')) return;
  if (ctx.side === 'client' && ctx.client.id === clientId && can(ctx.permissions, 'portal_users:manage')) return;
  throw new ActionFailure('forbidden');
}

export const updateClientUserAction = defineAction({
  input: z.object({
    clientUserId: z.uuid(),
    clientId: z.uuid(),
    roleKey: z.enum(clientRoleKeys),
    canApprove: z.boolean(),
    status: z.enum(['active', 'deactivated']),
  }),
  side: 'any',
  async handler({ input, tx, ctx }) {
    assertManagesClient(ctx, input.clientId);
    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, ctx.organization.id), eq(roles.key, input.roleKey)));
    if (!role) throw new ActionFailure('not_found');
    const [row] = await tx
      .update(clientUsers)
      .set({ roleId: role.id, canApprove: input.canApprove, status: input.status })
      .where(and(eq(clientUsers.id, input.clientUserId), eq(clientUsers.clientId, input.clientId)))
      .returning({ userId: clientUsers.userId });
    if (!row) throw new ActionFailure('not_found');
    // A client must always keep at least one active owner.
    const [owners] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from public.client_users cu join public.roles r on r.id = cu.role_id
      where cu.client_id = ${input.clientId} and cu.status = 'active' and r.key = 'client_owner'`);
    if ((owners?.n ?? 0) === 0) throw new ActionFailure('last_client_owner');
    await emitEvent(tx, {
      type: 'client_user.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'client_user', id: input.clientUserId },
      clientId: input.clientId,
      payload: { clientId: input.clientId, userId: row.userId, fields: ['role', 'canApprove', 'status'] },
    });
    return null;
  },
  revalidate: (input) => [`/clients/${input.clientId}`, '/portal/company'],
});

/* -------------------------------------------------------------------------- */
/* Packages                                                                   */
/* -------------------------------------------------------------------------- */

const packageFields = z.object({
  name: localizedText(80),
  description: z.object({ ar: z.string().trim().max(200), en: z.string().trim().max(200) }),
  priceSar: z.number().min(0).max(10_000_000).nullable(),
  isActive: z.boolean(),
  items: z
    .array(z.object({ itemType: z.enum(packageItemTypes), quantity: z.number().int().min(1).max(1000) }))
    .min(1, { message: 'min_one' })
    .refine((items) => new Set(items.map((i) => i.itemType)).size === items.length, { message: 'conflict' }),
});

export const savePackageAction = defineAction({
  input: packageFields.extend({ packageId: z.uuid().nullable() }),
  side: 'agency',
  permission: 'packages:manage',
  async handler({ input, tx, ctx }) {
    const values = {
      name: input.name,
      description: input.description,
      priceMinor: input.priceSar === null ? null : Math.round(input.priceSar * 100),
      isActive: input.isActive,
    };
    let packageId = input.packageId;
    if (packageId) {
      const [row] = await tx.update(packages).set(values).where(eq(packages.id, packageId)).returning({ id: packages.id });
      if (!row) throw new ActionFailure('not_found');
      await tx.delete(packageItems).where(eq(packageItems.packageId, packageId));
    } else {
      const [row] = await tx
        .insert(packages)
        .values({ ...values, organizationId: ctx.organization.id })
        .returning({ id: packages.id });
      packageId = row!.id;
    }
    await tx.insert(packageItems).values(
      input.items.map((item, i) => ({
        organizationId: ctx.organization.id,
        packageId: packageId!,
        itemType: item.itemType,
        quantity: item.quantity,
        sortOrder: i,
      })),
    );
    await emitEvent(tx, {
      type: input.packageId ? 'package.updated' : 'package.created',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'package', id: packageId },
      payload: { packageId: packageId! },
    });
    return { packageId };
  },
  revalidate: ['/admin/packages'],
});

export const assignClientPackageAction = defineAction({
  input: z
    .object({ clientId: z.uuid(), packageId: z.uuid(), periodStart: z.iso.date(), periodEnd: z.iso.date() })
    .refine((v) => v.periodEnd >= v.periodStart, { message: 'period_end_before_start', path: ['periodEnd'] }),
  side: 'agency',
  permission: 'packages:assign',
  async handler({ input, tx, ctx }) {
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
  },
  revalidate: (input) => [`/clients/${input.clientId}`],
});

/** Manual usage logging until Phase 3 deliverables feed the ledger automatically. */
export const recordPackageUsageAction = defineAction({
  input: z.object({
    clientId: z.uuid(),
    clientPackageId: z.uuid(),
    itemType: z.enum(packageItemTypes),
    quantity: z
      .number()
      .int()
      .min(-100)
      .max(100)
      .refine((n) => n !== 0),
    note: optionalText(200),
  }),
  side: 'agency',
  permission: 'packages:assign',
  async handler({ input, tx, ctx }) {
    await tx.insert(packageUsageEntries).values({
      organizationId: ctx.organization.id,
      clientId: input.clientId,
      clientPackageId: input.clientPackageId,
      itemType: input.itemType,
      quantity: input.quantity,
      sourceType: 'manual',
      note: input.note,
      createdBy: ctx.session.userId,
    });
    return null;
  },
  revalidate: (input) => [`/clients/${input.clientId}`],
});
