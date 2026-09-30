import 'server-only';

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';

import type { AgencyContext } from '@/lib/auth/context';
import { withRls } from '@/lib/db/rls';
import {
  clients,
  crmActivities,
  crmFiles,
  crmSettings,
  crmWebhookTokens,
  dealContacts,
  dealStageHistory,
  deals,
  leadAssignmentRules,
  leadForms,
  leads,
  packageItems,
  packages,
  pipelineStages,
  pipelines,
  profiles,
  quoteItems,
  quotes,
  requestTypes,
  salesTargets,
  workflowTemplates,
} from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';
import { can } from '@/lib/permissions/can';
import type {
  ActivityType,
  BudgetRange,
  DealStatus,
  LeadSource,
  LeadStatus,
  LostReason,
  QuoteStatus,
  StageKind,
} from '@/modules/crm/constants';
import { findDuplicateLeads } from '@/modules/crm/server/intake';
import { dayInZone } from '@/modules/tasks/constants';

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export type Person = { id: string; name: string; avatarPath: string | null };

async function peopleById(tx: Parameters<Parameters<typeof withRls>[0]>[0], ids: (string | null)[]) {
  const unique = [...new Set(ids.filter(Boolean) as string[])];
  if (!unique.length) return new Map<string, Person>();
  const rows = await tx
    .select({ id: profiles.id, name: profiles.fullName, avatarPath: profiles.avatarPath })
    .from(profiles)
    .where(inArray(profiles.id, unique));
  return new Map(rows.map((r) => [r.id, r]));
}

/* -------------------------------------------------------------------------- */
/* Options                                                                    */
/* -------------------------------------------------------------------------- */

export type CrmOptions = {
  owners: { id: string; name: string }[];
  agencyPeople: { id: string; name: string }[];
  packages: { id: string; name: LocalizedText; priceMinor: number | null; items: { itemType: string; quantity: number }[] }[];
  pipelines: PipelineWithStages[];
  staleDays: number;
  onboardingReady: boolean;
};

export type PipelineWithStages = {
  id: string;
  name: LocalizedText;
  isDefault: boolean;
  stages: { id: string; name: LocalizedText; kind: StageKind; probability: number; sortOrder: number }[];
};

export async function listPipelinesTx(tx: Parameters<Parameters<typeof withRls>[0]>[0], orgId: string): Promise<PipelineWithStages[]> {
  const ps = await tx
    .select()
    .from(pipelines)
    .where(eq(pipelines.organizationId, orgId))
    .orderBy(desc(pipelines.isDefault), asc(pipelines.sortOrder));
  const st = await tx.select().from(pipelineStages).where(eq(pipelineStages.organizationId, orgId)).orderBy(asc(pipelineStages.sortOrder));
  return ps.map((p) => ({
    id: p.id,
    name: p.name,
    isDefault: p.isDefault,
    stages: st
      .filter((s) => s.pipelineId === p.id)
      .map((s) => ({ id: s.id, name: s.name, kind: s.kind as StageKind, probability: s.probability, sortOrder: s.sortOrder })),
  }));
}

export async function getCrmOptions(ctx: AgencyContext): Promise<CrmOptions> {
  const orgId = ctx.organization.id;
  return withRls(async (tx) => {
    const owners = await tx.execute<{ id: string; name: string }>(sql`
      select p.id, p.full_name as name from public.profiles p
      where p.id in (select app.crm_eligible_owners(${orgId}::uuid)) order by p.full_name`);
    const people = await tx.execute<{ id: string; name: string }>(sql`
      select p.id, p.full_name as name from public.organization_members m join public.profiles p on p.id = m.user_id
      where m.organization_id = ${orgId} and m.user_type = 'agency' and m.status = 'active' order by p.full_name`);
    const pkgs = await tx
      .select({ id: packages.id, name: packages.name, priceMinor: packages.priceMinor })
      .from(packages)
      .where(and(eq(packages.organizationId, orgId), eq(packages.isActive, true)))
      .orderBy(asc(packages.priceMinor));
    const items = await tx.select().from(packageItems).where(eq(packageItems.organizationId, orgId)).orderBy(asc(packageItems.sortOrder));
    const [settings] = await tx.select().from(crmSettings).where(eq(crmSettings.organizationId, orgId));
    return {
      owners: [...owners],
      agencyPeople: [...people],
      packages: pkgs.map((p) => ({
        ...p,
        items: items.filter((i) => i.packageId === p.id).map((i) => ({ itemType: i.itemType, quantity: i.quantity })),
      })),
      pipelines: await listPipelinesTx(tx, orgId),
      staleDays: settings?.staleDays ?? 7,
      onboardingReady: Boolean(settings?.onboardingRequestTypeId && settings.onboardingTemplateId),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Leads                                                                      */
/* -------------------------------------------------------------------------- */

export type LeadListItem = {
  id: string;
  number: number;
  fullName: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  source: LeadSource;
  services: string[];
  budgetRange: BudgetRange;
  city: string | null;
  owner: Person | null;
  status: LeadStatus;
  score: number;
  tags: string[];
  lastActivityAt: string;
  createdAt: string;
  deals: number;
  duplicates: number;
};

export async function listLeads(ctx: AgencyContext): Promise<LeadListItem[]> {
  return withRls(async (tx) => {
    const rows = await tx
      .select({
        l: leads,
        deals: sql<number>`(select count(*)::int from public.deals d where d.lead_id = leads.id)`,
        duplicates: sql<number>`(select count(*)::int from public.leads o where o.organization_id = leads.organization_id and o.id <> leads.id and o.status <> 'merged' and ((leads.phone is not null and o.phone = leads.phone) or (leads.email is not null and lower(o.email) = lower(leads.email))))`,
      })
      .from(leads)
      .where(and(eq(leads.organizationId, ctx.organization.id), ne(leads.status, 'merged')))
      .orderBy(desc(leads.lastActivityAt))
      .limit(1000);
    const people = await peopleById(
      tx,
      rows.map((r) => r.l.ownerId),
    );
    return rows.map(({ l, deals: d, duplicates }) => ({
      id: l.id,
      number: l.number,
      fullName: l.fullName,
      company: l.company,
      phone: l.phone,
      email: l.email,
      source: l.source as LeadSource,
      services: l.services,
      budgetRange: l.budgetRange as BudgetRange,
      city: l.city,
      owner: l.ownerId ? (people.get(l.ownerId) ?? null) : null,
      status: l.status as LeadStatus,
      score: l.score,
      tags: l.tags,
      lastActivityAt: l.lastActivityAt.toISOString(),
      createdAt: l.createdAt.toISOString(),
      deals: d,
      duplicates,
    }));
  });
}

export type ActivityItem = {
  id: string;
  leadId: string | null;
  dealId: string | null;
  type: ActivityType;
  subject: string;
  body: string;
  dueAt: string | null;
  completedAt: string | null;
  owner: Person | null;
  createdBy: Person | null;
  createdAt: string;
};

async function activitiesFor(tx: Parameters<Parameters<typeof withRls>[0]>[0], where: ReturnType<typeof eq>) {
  const rows = await tx
    .select()
    .from(crmActivities)
    .where(where)
    .orderBy(desc(sql`coalesce(${crmActivities.completedAt}, ${crmActivities.dueAt}, ${crmActivities.createdAt})`))
    .limit(300);
  const people = await peopleById(tx, [...rows.map((r) => r.ownerId), ...rows.map((r) => r.createdBy)]);
  return rows.map((a): ActivityItem => ({
    id: a.id,
    leadId: a.leadId,
    dealId: a.dealId,
    type: a.type as ActivityType,
    subject: a.subject,
    body: a.body,
    dueAt: iso(a.dueAt),
    completedAt: iso(a.completedAt),
    owner: a.ownerId ? (people.get(a.ownerId) ?? null) : null,
    createdBy: a.createdBy ? (people.get(a.createdBy) ?? null) : null,
    createdAt: a.createdAt.toISOString(),
  }));
}

export type LeadDetail = LeadListItem & {
  sourceDetail: string | null;
  externalRef: string | null;
  notes: string;
  formName: string | null;
  mergedIntoId: string | null;
  activities: ActivityItem[];
  duplicateLeads: { id: string; number: number; fullName: string; status: LeadStatus; phone: string | null; email: string | null }[];
  dealList: { id: string; number: number; title: string; status: DealStatus; valueMinor: number; stageName: LocalizedText }[];
  canWrite: boolean;
};

export async function getLead(ctx: AgencyContext, leadId: string): Promise<LeadDetail | null> {
  const [item] = (await listLeadsById(ctx, [leadId])) ?? [];
  if (!item) return null;
  return withRls(async (tx) => {
    const [l] = await tx.select().from(leads).where(eq(leads.id, leadId));
    if (!l) return null;
    const [form] = l.formId ? await tx.select({ name: leadForms.name }).from(leadForms).where(eq(leadForms.id, l.formId)) : [];
    const dup = await findDuplicateLeads(tx, ctx.organization.id, l, l.id);
    const dealRows = await tx
      .select({
        id: deals.id,
        number: deals.number,
        title: deals.title,
        status: deals.status,
        valueMinor: deals.valueMinor,
        stageName: pipelineStages.name,
      })
      .from(deals)
      .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
      .where(eq(deals.leadId, leadId))
      .orderBy(desc(deals.createdAt));
    const [write] = await tx.execute<{ ok: boolean }>(sql`select app.can_write_lead(${leadId}::uuid) as ok`);
    return {
      ...item,
      sourceDetail: l.sourceDetail,
      externalRef: l.externalRef,
      notes: l.notes,
      formName: form?.name ?? null,
      mergedIntoId: l.mergedIntoId,
      activities: await activitiesFor(tx, eq(crmActivities.leadId, leadId)),
      duplicateLeads: dup.map((d) => ({ ...d, status: d.status as LeadStatus })),
      dealList: dealRows.map((d) => ({ ...d, status: d.status as DealStatus })),
      canWrite: Boolean(write?.ok),
    };
  });
}

/** Same shape as the list, for a few ids (merged leads included, e.g. to follow a redirect). */
async function listLeadsById(ctx: AgencyContext, ids: string[]): Promise<LeadListItem[]> {
  return withRls(async (tx) => {
    const rows = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.organizationId, ctx.organization.id), inArray(leads.id, ids)));
    const people = await peopleById(
      tx,
      rows.map((r) => r.ownerId),
    );
    return rows.map((l) => ({
      id: l.id,
      number: l.number,
      fullName: l.fullName,
      company: l.company,
      phone: l.phone,
      email: l.email,
      source: l.source as LeadSource,
      services: l.services,
      budgetRange: l.budgetRange as BudgetRange,
      city: l.city,
      owner: l.ownerId ? (people.get(l.ownerId) ?? null) : null,
      status: l.status as LeadStatus,
      score: l.score,
      tags: l.tags,
      lastActivityAt: l.lastActivityAt.toISOString(),
      createdAt: l.createdAt.toISOString(),
      deals: 0,
      duplicates: 0,
    }));
  });
}

/* -------------------------------------------------------------------------- */
/* Deals                                                                      */
/* -------------------------------------------------------------------------- */

export type DealCard = {
  id: string;
  number: number;
  title: string;
  company: string | null;
  stageId: string;
  status: DealStatus;
  valueMinor: number;
  probability: number;
  expectedCloseDate: string | null;
  owner: Person | null;
  packageId: string | null;
  lastActivityAt: string;
  nextActivityAt: string | null;
  wonAt: string | null;
  lostAt: string | null;
  clientId: string | null;
  createdAt: string;
};

/** Open deals of a pipeline plus the ones closed in the last 30 days (so Won / Lost columns aren't endless). */
export async function getBoard(ctx: AgencyContext, pipelineId: string): Promise<DealCard[]> {
  return withRls(async (tx) => {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await tx
      .select({
        d: deals,
        next: sql<
          string | null
        >`(select min(a.due_at) from public.crm_activities a where a.deal_id = deals.id and a.completed_at is null and a.due_at is not null)`,
      })
      .from(deals)
      .where(
        and(
          eq(deals.organizationId, ctx.organization.id),
          eq(deals.pipelineId, pipelineId),
          or(eq(deals.status, 'open'), gte(deals.wonAt, since), gte(deals.lostAt, since)),
        ),
      )
      .orderBy(asc(deals.expectedCloseDate), desc(deals.valueMinor));
    const people = await peopleById(
      tx,
      rows.map((r) => r.d.ownerId),
    );
    return rows.map(({ d, next }) => toCard(d, next, people));
  });
}

function toCard(d: typeof deals.$inferSelect, next: string | null, people: Map<string, Person>): DealCard {
  return {
    id: d.id,
    number: d.number,
    title: d.title,
    company: d.company,
    stageId: d.stageId,
    status: d.status as DealStatus,
    valueMinor: d.valueMinor,
    probability: d.probability,
    expectedCloseDate: d.expectedCloseDate,
    owner: d.ownerId ? (people.get(d.ownerId) ?? null) : null,
    packageId: d.packageId,
    lastActivityAt: d.lastActivityAt.toISOString(),
    nextActivityAt: iso(next),
    wonAt: iso(d.wonAt),
    lostAt: iso(d.lostAt),
    clientId: d.clientId,
    createdAt: d.createdAt.toISOString(),
  };
}

export type DealDetail = DealCard & {
  pipelineId: string;
  leadId: string | null;
  lead: { id: string; number: number; fullName: string; phone: string | null; email: string | null; city: string | null } | null;
  lostReason: LostReason | null;
  lostNote: string | null;
  source: string | null;
  convertedAt: string | null;
  clientName: LocalizedText | null;
  contacts: { id: string; fullName: string; jobTitle: string | null; phone: string | null; email: string | null; isPrimary: boolean }[];
  activities: ActivityItem[];
  files: { id: string; name: string; mimeType: string; sizeBytes: number; createdAt: string; uploadedBy: string | null }[];
  quotes: {
    id: string;
    number: number;
    title: string;
    status: QuoteStatus;
    totalMinor: number;
    validUntil: string | null;
    createdAt: string;
  }[];
  history: { id: string; toStageId: string; fromStageId: string | null; actorName: string | null; createdAt: string }[];
  canWrite: boolean;
};

export async function getDeal(ctx: AgencyContext, dealId: string): Promise<DealDetail | null> {
  return withRls(async (tx) => {
    const [d] = await tx
      .select()
      .from(deals)
      .where(and(eq(deals.id, dealId), eq(deals.organizationId, ctx.organization.id)));
    if (!d) return null;
    const people = await peopleById(tx, [d.ownerId]);
    const [lead] = d.leadId
      ? await tx
          .select({
            id: leads.id,
            number: leads.number,
            fullName: leads.fullName,
            phone: leads.phone,
            email: leads.email,
            city: leads.city,
          })
          .from(leads)
          .where(eq(leads.id, d.leadId))
      : [];
    const [client] = d.clientId ? await tx.select({ name: clients.name }).from(clients).where(eq(clients.id, d.clientId)) : [];
    const contacts = await tx
      .select()
      .from(dealContacts)
      .where(eq(dealContacts.dealId, dealId))
      .orderBy(desc(dealContacts.isPrimary), asc(dealContacts.createdAt));
    const files = await tx.select().from(crmFiles).where(eq(crmFiles.dealId, dealId)).orderBy(desc(crmFiles.createdAt));
    const quoteRows = await tx.select().from(quotes).where(eq(quotes.dealId, dealId)).orderBy(desc(quotes.createdAt));
    const history = await tx
      .select({ h: dealStageHistory, actorName: profiles.fullName })
      .from(dealStageHistory)
      .leftJoin(profiles, eq(profiles.id, dealStageHistory.actorId))
      .where(eq(dealStageHistory.dealId, dealId))
      .orderBy(asc(dealStageHistory.createdAt));
    const [next] = await tx.execute<{ next: string | null }>(
      sql`select min(a.due_at) as next from public.crm_activities a where a.deal_id = ${dealId} and a.completed_at is null and a.due_at is not null`,
    );
    const [write] = await tx.execute<{ ok: boolean }>(sql`select app.can_write_deal(${dealId}::uuid) as ok`);
    return {
      ...toCard(d, next?.next ?? null, people),
      pipelineId: d.pipelineId,
      leadId: d.leadId,
      lead: lead ?? null,
      lostReason: d.lostReason as LostReason | null,
      lostNote: d.lostNote,
      source: d.source,
      convertedAt: iso(d.convertedAt),
      clientName: client?.name ?? null,
      contacts: contacts.map((c) => ({
        id: c.id,
        fullName: c.fullName,
        jobTitle: c.jobTitle,
        phone: c.phone,
        email: c.email,
        isPrimary: c.isPrimary,
      })),
      activities: await activitiesFor(tx, eq(crmActivities.dealId, dealId)),
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        createdAt: f.createdAt.toISOString(),
        uploadedBy: f.uploadedBy,
      })),
      quotes: quoteRows.map((q) => ({
        id: q.id,
        number: q.number,
        title: q.title,
        status: q.status as QuoteStatus,
        totalMinor: q.totalMinor,
        validUntil: q.validUntil,
        createdAt: q.createdAt.toISOString(),
      })),
      history: history.map(({ h, actorName }) => ({
        id: h.id,
        toStageId: h.toStageId,
        fromStageId: h.fromStageId,
        actorName,
        createdAt: h.createdAt.toISOString(),
      })),
      canWrite: Boolean(write?.ok),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Quotes                                                                     */
/* -------------------------------------------------------------------------- */

export type QuoteDetail = {
  id: string;
  number: number;
  dealId: string;
  dealTitle: string;
  company: string | null;
  contactName: string | null;
  title: string;
  locale: 'ar' | 'en';
  status: QuoteStatus;
  validUntil: string | null;
  currency: string;
  discountMinor: number;
  subtotalMinor: number;
  totalMinor: number;
  notes: string;
  sentAt: string | null;
  createdAt: string;
  createdByName: string | null;
  items: { id: string; packageId: string | null; description: string; quantity: number; unitPriceMinor: number }[];
  canWrite: boolean;
};

export async function getQuote(ctx: AgencyContext, quoteId: string): Promise<QuoteDetail | null> {
  return withRls(async (tx) => {
    const [row] = await tx
      .select({ q: quotes, dealTitle: deals.title, company: deals.company, createdByName: profiles.fullName })
      .from(quotes)
      .innerJoin(deals, eq(deals.id, quotes.dealId))
      .leftJoin(profiles, eq(profiles.id, quotes.createdBy))
      .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, ctx.organization.id)));
    if (!row) return null;
    const items = await tx.select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId)).orderBy(asc(quoteItems.sortOrder));
    const [contact] = await tx
      .select({ name: dealContacts.fullName })
      .from(dealContacts)
      .where(and(eq(dealContacts.dealId, row.q.dealId), eq(dealContacts.isPrimary, true)));
    const [write] = await tx.execute<{ ok: boolean }>(sql`select app.can_write_deal(${row.q.dealId}::uuid) as ok`);
    return {
      id: row.q.id,
      number: row.q.number,
      dealId: row.q.dealId,
      dealTitle: row.dealTitle,
      company: row.company,
      contactName: contact?.name ?? null,
      title: row.q.title,
      locale: row.q.locale === 'en' ? 'en' : 'ar',
      status: row.q.status as QuoteStatus,
      validUntil: row.q.validUntil,
      currency: row.q.currency,
      discountMinor: row.q.discountMinor,
      subtotalMinor: row.q.subtotalMinor,
      totalMinor: row.q.totalMinor,
      notes: row.q.notes,
      sentAt: iso(row.q.sentAt),
      createdAt: row.q.createdAt.toISOString(),
      createdByName: row.createdByName,
      items: items.map((i) => ({
        id: i.id,
        packageId: i.packageId,
        description: i.description,
        quantity: i.quantity,
        unitPriceMinor: i.unitPriceMinor,
      })),
      canWrite: Boolean(write?.ok),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Follow-ups                                                                 */
/* -------------------------------------------------------------------------- */

export type FollowUp = ActivityItem & { parentTitle: string; parentRef: string; href: string };

/** Open activities with a due date: mine, or everyone's with `crm:manage_all` and `all`. */
export async function listFollowUps(ctx: AgencyContext, scope: 'mine' | 'all'): Promise<{ items: FollowUp[]; today: string; now: string }> {
  const everyone = scope === 'all' && can(ctx.permissions, 'crm:manage_all');
  return withRls(async (tx) => {
    const rows = await tx
      .select({
        a: crmActivities,
        leadNumber: leads.number,
        leadName: leads.fullName,
        dealNumber: deals.number,
        dealTitle: deals.title,
      })
      .from(crmActivities)
      .leftJoin(leads, eq(leads.id, crmActivities.leadId))
      .leftJoin(deals, eq(deals.id, crmActivities.dealId))
      .where(
        and(
          eq(crmActivities.organizationId, ctx.organization.id),
          isNull(crmActivities.completedAt),
          isNotNull(crmActivities.dueAt),
          everyone ? undefined : eq(crmActivities.ownerId, ctx.session.userId),
        ),
      )
      .orderBy(asc(crmActivities.dueAt))
      .limit(300);
    const people = await peopleById(tx, [...rows.map((r) => r.a.ownerId), ...rows.map((r) => r.a.createdBy)]);
    return {
      today: dayInZone(new Date(), ctx.profile.timezone),
      now: new Date().toISOString(),
      items: rows.map(({ a, leadNumber, leadName, dealNumber, dealTitle }) => ({
        id: a.id,
        leadId: a.leadId,
        dealId: a.dealId,
        type: a.type as ActivityType,
        subject: a.subject,
        body: a.body,
        dueAt: iso(a.dueAt),
        completedAt: null,
        owner: a.ownerId ? (people.get(a.ownerId) ?? null) : null,
        createdBy: a.createdBy ? (people.get(a.createdBy) ?? null) : null,
        createdAt: a.createdAt.toISOString(),
        parentTitle: (a.dealId ? dealTitle : leadName) ?? '',
        parentRef: a.dealId ? `D-${dealNumber}` : `L-${leadNumber}`,
        href: a.dealId ? `/crm/deals/${a.dealId}` : `/crm/leads/${a.leadId}`,
      })),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export type CrmSettingsData = {
  pipelines: PipelineWithStages[];
  stageUsage: Record<string, number>;
  forms: { id: string; name: string; token: string; isActive: boolean; services: string[]; thankYou: LocalizedText; submissions: number }[];
  rules: (typeof leadAssignmentRules.$inferSelect)[];
  tokens: { id: string; name: string; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }[];
  targets: { id: string; ownerId: string | null; month: string; amountMinor: number }[];
  settings: { staleDays: number; onboardingRequestTypeId: string | null; onboardingTemplateId: string | null };
  requestTypes: { id: string; name: LocalizedText }[];
  templates: { id: string; name: LocalizedText; requestTypeId: string | null }[];
};

export async function getCrmSettings(ctx: AgencyContext): Promise<CrmSettingsData> {
  const orgId = ctx.organization.id;
  return withRls(async (tx) => {
    const usage = await tx
      .select({ stageId: deals.stageId, n: sql<number>`count(*)::int` })
      .from(deals)
      .where(eq(deals.organizationId, orgId))
      .groupBy(deals.stageId);
    const [settings] = await tx.select().from(crmSettings).where(eq(crmSettings.organizationId, orgId));
    const tokens = can(ctx.permissions, 'crm:admin')
      ? await tx.select().from(crmWebhookTokens).where(eq(crmWebhookTokens.organizationId, orgId)).orderBy(desc(crmWebhookTokens.createdAt))
      : [];
    return {
      pipelines: await listPipelinesTx(tx, orgId),
      stageUsage: Object.fromEntries(usage.map((u) => [u.stageId, u.n])),
      forms: (await tx.select().from(leadForms).where(eq(leadForms.organizationId, orgId)).orderBy(asc(leadForms.createdAt))).map((f) => ({
        id: f.id,
        name: f.name,
        token: f.token,
        isActive: f.isActive,
        services: f.services,
        thankYou: f.thankYou,
        submissions: f.submissions,
      })),
      rules: await tx
        .select()
        .from(leadAssignmentRules)
        .where(eq(leadAssignmentRules.organizationId, orgId))
        .orderBy(asc(leadAssignmentRules.sortOrder)),
      tokens: tokens.map((x) => ({
        id: x.id,
        name: x.name,
        lastUsedAt: iso(x.lastUsedAt),
        revokedAt: iso(x.revokedAt),
        createdAt: x.createdAt.toISOString(),
      })),
      targets: (await tx.select().from(salesTargets).where(eq(salesTargets.organizationId, orgId)).orderBy(desc(salesTargets.month))).map(
        (x) => ({
          id: x.id,
          ownerId: x.ownerId,
          month: x.month,
          amountMinor: x.amountMinor,
        }),
      ),
      settings: {
        staleDays: settings?.staleDays ?? 7,
        onboardingRequestTypeId: settings?.onboardingRequestTypeId ?? null,
        onboardingTemplateId: settings?.onboardingTemplateId ?? null,
      },
      requestTypes: await tx
        .select({ id: requestTypes.id, name: requestTypes.name })
        .from(requestTypes)
        .where(eq(requestTypes.organizationId, orgId))
        .orderBy(asc(requestTypes.sortOrder)),
      templates: await tx
        .select({ id: workflowTemplates.id, name: workflowTemplates.name, requestTypeId: workflowTemplates.requestTypeId })
        .from(workflowTemplates)
        .where(and(eq(workflowTemplates.organizationId, orgId), eq(workflowTemplates.isActive, true))),
    };
  });
}
