'use server';

import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import {
  crmFiles,
  crmSettings,
  dealContacts,
  deals,
  packages,
  quoteItems,
  quotes,
  requests,
  requestTypes,
  workflowTemplateSteps,
} from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import type { Permission } from '@/lib/permissions/catalog';
import { can } from '@/lib/permissions/can';
import { CRM_FILES_BUCKET, classifyUpload, storagePaths } from '@/lib/storage';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { assignClientPackage, createClientRecord } from '@/modules/clients/server/services';
import { convertDealSchema, idSchema, quoteSchema, quoteStatusSchema } from '@/modules/crm/schemas';
import { createClientInvitation, sendInvitationEmail } from '@/modules/invitations/server/services';
import { addDays, dayInZone } from '@/modules/tasks/constants';
import { convertRequest } from '@/modules/workflows/server/services';

const dealPaths = (id: string) => ['/crm/pipeline', '/crm/dashboard', `/crm/deals/${id}`];

/* -------------------------------------------------------------------------- */
/* Files: signed upload to a server-chosen path, then an RLS-checked insert    */
/* -------------------------------------------------------------------------- */

const uploadSchema = z.object({
  dealId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  mimeType: z.string().min(1).max(120),
  size: z.number().int().positive(),
});

export const requestDealFileUploadAction = defineAction({
  input: uploadSchema,
  side: 'agency',
  permission: 'deals:manage',
  rateLimit: { key: 'upload', max: 200, windowSeconds: 3600 },
  async handler({ input, tx, ctx }) {
    const rule = classifyUpload(input.mimeType, input.size);
    if (!rule.ok) throw new ActionFailure(rule.code);
    const [write] = await tx.execute<{ ok: boolean }>(sql`select app.can_write_deal(${input.dealId}::uuid) as ok`);
    if (!write?.ok) throw new ActionFailure('forbidden');
    const fileId = crypto.randomUUID();
    const path = storagePaths.dealFile(ctx.organization.id, input.dealId, fileId, input.name);
    // Service client only signs the upload for the path chosen here, after the RLS check above.
    const { data, error } = await supabaseAdmin().storage.from(CRM_FILES_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new ActionFailure('upload_failed');
    return { fileId, path, token: data.token, signedUrl: data.signedUrl };
  },
});

export const finalizeDealFileAction = defineAction({
  input: uploadSchema.extend({ fileId: z.uuid() }),
  side: 'agency',
  permission: 'deals:manage',
  async handler({ input, tx, ctx }) {
    const rule = classifyUpload(input.mimeType, input.size);
    if (!rule.ok) throw new ActionFailure(rule.code);
    const path = storagePaths.dealFile(ctx.organization.id, input.dealId, input.fileId, input.name);
    const dir = path.slice(0, path.lastIndexOf('/'));
    const fileName = path.slice(path.lastIndexOf('/') + 1);
    const { data: listed } = await supabaseAdmin().storage.from(CRM_FILES_BUCKET).list(dir, { search: fileName, limit: 1 });
    const object = listed?.find((o) => o.name === fileName);
    if (!object) throw new ActionFailure('upload_failed');
    const size = Number((object.metadata as { size?: number } | null)?.size ?? input.size);
    const [row] = await tx
      .insert(crmFiles)
      .values({
        id: input.fileId,
        organizationId: ctx.organization.id,
        dealId: input.dealId,
        storagePath: path,
        name: input.name,
        mimeType: input.mimeType,
        sizeBytes: size,
        uploadedBy: ctx.session.userId,
      })
      .returning({ id: crmFiles.id });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'deal.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'deal', id: input.dealId },
      payload: { dealId: input.dealId, fields: ['files'] },
    });
    return { fileId: row.id };
  },
  revalidate: (i) => dealPaths(i.dealId),
});

export const getDealFileUrlAction = defineAction({
  input: idSchema,
  side: 'agency',
  permission: 'deals:read',
  async handler({ input, tx }) {
    const [file] = await tx.select().from(crmFiles).where(eq(crmFiles.id, input.id));
    if (!file) throw new ActionFailure('not_found');
    // Signed only for a row the caller can SELECT (RLS above).
    const { data, error } = await supabaseAdmin()
      .storage.from(CRM_FILES_BUCKET)
      .createSignedUrl(file.storagePath, 600, { download: file.name });
    if (error || !data) throw new ActionFailure('not_found');
    return { url: data.signedUrl };
  },
});

/* -------------------------------------------------------------------------- */
/* Quotes                                                                     */
/* -------------------------------------------------------------------------- */

export const saveQuoteAction = defineAction({
  input: quoteSchema,
  side: 'agency',
  permission: 'deals:manage',
  async handler({ input, tx, ctx }) {
    const orgId = ctx.organization.id;
    const values = {
      title: input.title,
      locale: input.locale,
      validUntil: input.validUntil,
      discountMinor: Math.round(input.discountSar * 100),
      notes: input.notes,
    };
    let quoteId = input.quoteId;
    if (quoteId) {
      const [row] = await tx
        .update(quotes)
        .set(values)
        .where(and(eq(quotes.id, quoteId), eq(quotes.dealId, input.dealId), eq(quotes.status, 'draft')))
        .returning({ id: quotes.id });
      if (!row) throw new ActionFailure('forbidden');
      await tx.delete(quoteItems).where(eq(quoteItems.quoteId, quoteId));
    } else {
      const [row] = await tx
        .insert(quotes)
        .values({ ...values, organizationId: orgId, dealId: input.dealId })
        .returning({ id: quotes.id });
      if (!row) throw new ActionFailure('forbidden');
      quoteId = row.id;
    }
    await tx.insert(quoteItems).values(
      input.items.map((item, i) => ({
        organizationId: orgId,
        quoteId: quoteId!,
        packageId: item.packageId,
        description: item.description,
        quantity: item.quantity,
        unitPriceMinor: Math.round(item.unitPriceSar * 100),
        sortOrder: i,
      })),
    );
    const [saved] = await tx.select({ total: quotes.totalMinor }).from(quotes).where(eq(quotes.id, quoteId));
    await emitEvent(tx, {
      type: 'quote.saved',
      organizationId: orgId,
      actorId: ctx.session.userId,
      aggregate: { type: 'deal', id: input.dealId },
      payload: { quoteId, dealId: input.dealId, totalMinor: saved?.total ?? 0 },
    });
    return { quoteId, dealId: input.dealId };
  },
  revalidate: (i, r) => [...dealPaths(i.dealId), `/crm/quotes/${r.quoteId}`],
});

export const setQuoteStatusAction = defineAction({
  input: quoteStatusSchema,
  side: 'agency',
  permission: 'deals:manage',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .update(quotes)
      .set({ status: input.status })
      .where(eq(quotes.id, input.quoteId))
      .returning({ id: quotes.id, dealId: quotes.dealId });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'quote.status_changed',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'deal', id: row.dealId },
      payload: { quoteId: row.id, dealId: row.dealId, status: input.status },
    });
    return row;
  },
  revalidate: (_i, r) => [...dealPaths(r.dealId), `/crm/quotes/${r.id}`],
});

/* -------------------------------------------------------------------------- */
/* Won → client                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One transaction, as the signed-in user (ADR-061): client (+ AM, team, folders, general thread) → package for the current
 * period → portal invitation for the chosen contact → onboarding request converted to tasks through the configured
 * workflow → deal linked to the client. Needs the same permissions as doing each step by hand (the Sales Manager role
 * has them). The invitation email goes out after commit.
 */
export const convertDealToClientAction = defineAction({
  input: convertDealSchema,
  side: 'agency',
  permission: 'clients:create',
  async handler({ input, tx, ctx }) {
    const orgId = ctx.organization.id;
    const [deal] = await tx
      .select()
      .from(deals)
      .where(and(eq(deals.id, input.dealId), eq(deals.organizationId, orgId)));
    if (!deal) throw new ActionFailure('not_found');
    if (deal.status !== 'won') throw new ActionFailure('deal_not_won');
    if (deal.convertedAt) throw new ActionFailure('already_converted_deal');
    if (input.packageId && !can(ctx.permissions, 'packages:assign')) throw new ActionFailure('forbidden');
    if (input.inviteContactId && !can(ctx.permissions, 'client_users:manage')) throw new ActionFailure('forbidden');
    // Starting the onboarding workflow is a triage conversion done by the caller: check up front for what the
    // template needs (tasks, plus deliverables when a step produces one) so the answer is specific, not "forbidden".
    const [settings] = input.onboarding ? await tx.select().from(crmSettings).where(eq(crmSettings.organizationId, orgId)) : [];
    if (input.onboarding) {
      if (!settings?.onboardingRequestTypeId || !settings.onboardingTemplateId) throw new ActionFailure('onboarding_not_configured');
      const steps = await tx
        .select({ deliverableType: workflowTemplateSteps.deliverableType })
        .from(workflowTemplateSteps)
        .where(eq(workflowTemplateSteps.templateId, settings.onboardingTemplateId));
      const needed: Permission[] = ['requests:triage', 'tasks:create', 'tasks:update'];
      if (steps.some((st) => st.deliverableType)) needed.push('deliverables:manage');
      if (!needed.every((perm) => can(ctx.permissions, perm))) throw new ActionFailure('onboarding_not_permitted');
    }

    const today = dayInZone(new Date(), ctx.organization.defaultTimezone);
    const teamIds = [...new Set(input.teamIds.filter((id) => id !== input.accountManagerId))];
    const { clientId } = await createClientRecord(tx, ctx, {
      name: input.clientName,
      industry: null,
      city: input.city,
      website: null,
      social: {},
      status: 'onboarding',
      accountManagerId: input.accountManagerId,
      startDate: today,
      notes: null,
      teamIds,
    });

    let clientPackageId: string | null = null;
    if (input.packageId) {
      const [pkg] = await tx
        .select({ id: packages.id })
        .from(packages)
        .where(and(eq(packages.id, input.packageId), eq(packages.organizationId, orgId)));
      if (!pkg) throw new ActionFailure('not_found');
      ({ clientPackageId } = await assignClientPackage(tx, ctx, {
        clientId,
        packageId: pkg.id,
        periodStart: today,
        periodEnd: addDays(today, 29),
      }));
    }

    let invitation: Awaited<ReturnType<typeof createClientInvitation>> | null = null;
    if (input.inviteContactId) {
      const [contact] = await tx
        .select()
        .from(dealContacts)
        .where(and(eq(dealContacts.id, input.inviteContactId), eq(dealContacts.dealId, deal.id)));
      if (!contact?.email) throw new ActionFailure('validation', { inviteContactId: ['invalid_email'] });
      invitation = await createClientInvitation(tx, ctx, {
        clientId,
        email: contact.email,
        fullName: contact.fullName,
        clientRoleKey: 'client_owner',
        canApprove: true,
        jobTitle: contact.jobTitle,
        locale: input.inviteLocale,
      });
    }

    let requestId: string | null = null;
    if (input.onboarding) {
      if (!settings?.onboardingRequestTypeId || !settings.onboardingTemplateId) throw new ActionFailure('onboarding_not_configured');
      const [type] = await tx
        .select({ id: requestTypes.id, name: requestTypes.name })
        .from(requestTypes)
        .where(eq(requestTypes.id, settings.onboardingRequestTypeId));
      if (!type) throw new ActionFailure('onboarding_not_configured');
      const title =
        `${(ctx.organization.defaultLocale === 'en' ? input.clientName.en : input.clientName.ar) || input.clientName.ar || input.clientName.en}`.slice(
          0,
          100,
        );
      const [req] = await tx
        .insert(requests)
        .values({
          organizationId: orgId,
          clientId,
          requestTypeId: type.id,
          title: `${type.name[ctx.organization.defaultLocale === 'en' ? 'en' : 'ar'] || type.name.ar || type.name.en} · ${title}`.slice(
            0,
            140,
          ),
          status: 'submitted',
          priority: 'high',
          createdBy: ctx.session.userId,
        })
        .returning({ id: requests.id });
      if (!req) throw new ActionFailure('forbidden');
      requestId = req.id;
      await convertRequest(tx, ctx, { requestId: req.id, templateId: settings.onboardingTemplateId, startDate: today });
    }

    await tx.update(deals).set({ clientId, convertedAt: new Date() }).where(eq(deals.id, deal.id));
    await emitEvent(tx, {
      type: 'deal.converted',
      organizationId: orgId,
      actorId: ctx.session.userId,
      aggregate: { type: 'deal', id: deal.id },
      clientId,
      payload: { dealId: deal.id, clientId, requestId, invitationId: invitation?.invitation.id ?? null },
    });
    return { clientId, clientPackageId, requestId, invitation };
  },
  async after({ result, ctx }) {
    if (result.invitation) await sendInvitationEmail(result.invitation.invitation, result.invitation.token, ctx);
  },
  revalidate: (i, r) => [...dealPaths(i.dealId), '/clients', `/clients/${r.clientId}`, '/requests', '/tasks'],
});
