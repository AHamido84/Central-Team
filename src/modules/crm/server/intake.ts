import 'server-only';

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { and, asc, eq, ne, or, sql } from 'drizzle-orm';

import { dbAdmin, type Tx } from '@/lib/db/client';
import { crmActivities, crmWebhookTokens, leadAssignmentRules, leadForms, leads, organizations } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { env } from '@/lib/env';
import { FORM_MAX_SECONDS, FORM_MIN_SECONDS, type BudgetRange, type LeadSource, type LeadStatus } from '@/modules/crm/constants';
import { leadScore, pickAssignee } from '@/modules/crm/leads';

export type LeadValues = {
  fullName: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  source: LeadSource;
  sourceDetail: string | null;
  externalRef?: string | null;
  services: string[];
  budgetRange: BudgetRange;
  city: string | null;
  ownerId: string | null;
  tags: string[];
  notes: string;
  formId?: string | null;
};

/** Leads sharing the phone or email (not merged), newest first. Runs under the caller's connection (RLS or service). */
export async function findDuplicateLeads(
  tx: Tx,
  orgId: string,
  contact: { phone: string | null; email: string | null },
  excludeId?: string,
) {
  const match = [
    contact.phone ? eq(leads.phone, contact.phone) : undefined,
    contact.email ? sql`lower(${leads.email}) = ${contact.email.toLowerCase()}` : undefined,
  ].filter(Boolean);
  if (!match.length) return [];
  return tx
    .select({
      id: leads.id,
      number: leads.number,
      fullName: leads.fullName,
      status: leads.status,
      ownerId: leads.ownerId,
      phone: leads.phone,
      email: leads.email,
    })
    .from(leads)
    .where(and(eq(leads.organizationId, orgId), ne(leads.status, 'merged'), excludeId ? ne(leads.id, excludeId) : undefined, or(...match)))
    .orderBy(sql`${leads.createdAt} desc`)
    .limit(10);
}

/** Assignment rules → owner (round-robin cursor advanced through `app.crm_advance_rule`). */
export async function assignByRules(tx: Tx, orgId: string, lead: { services: string[]; city: string | null; source: string }) {
  const rules = await tx
    .select()
    .from(leadAssignmentRules)
    .where(eq(leadAssignmentRules.organizationId, orgId))
    .orderBy(asc(leadAssignmentRules.sortOrder));
  if (!rules.length) return null;
  const eligible = await tx.execute<{ id: string }>(sql`select app.crm_eligible_owners(${orgId}::uuid) as id`);
  const picked = pickAssignee(rules, lead, new Set([...eligible].map((r) => r.id)));
  if (picked) await tx.execute(sql`select app.crm_advance_rule(${picked.ruleId}::uuid, ${picked.nextCursor}::int)`);
  return picked;
}

/**
 * Inserts a lead (score computed here, owner from the rules when none is given) and emits `lead.created` (+
 * `lead.assigned`). Used by the manual form and CSV import (RLS transaction) and by public intake (service connection).
 */
export async function insertLead(
  tx: Tx,
  orgId: string,
  actorId: string | null,
  values: LeadValues,
  opts: { via: 'manual' | 'import' | 'form' | 'webhook'; useRules: boolean; status?: LeadStatus },
): Promise<{ leadId: string; ownerId: string | null }> {
  let ownerId = values.ownerId;
  let ruleId: string | null = null;
  if (!ownerId && opts.useRules) {
    const picked = await assignByRules(tx, orgId, values);
    if (picked) {
      ownerId = picked.ownerId;
      ruleId = picked.ruleId;
    }
  }
  const [row] = await tx
    .insert(leads)
    .values({
      organizationId: orgId,
      fullName: values.fullName,
      company: values.company,
      phone: values.phone,
      email: values.email,
      source: values.source,
      sourceDetail: values.sourceDetail,
      externalRef: values.externalRef ?? null,
      services: values.services,
      budgetRange: values.budgetRange,
      city: values.city,
      ownerId,
      tags: values.tags,
      notes: values.notes,
      formId: values.formId ?? null,
      status: opts.status ?? 'new',
      score: leadScore(values),
      createdBy: actorId,
    })
    .returning({ id: leads.id });
  const leadId = row!.id;
  await emitEvent(tx, {
    type: 'lead.created',
    organizationId: orgId,
    actorId,
    aggregate: { type: 'lead', id: leadId },
    payload: { leadId, source: values.source, ownerId, via: opts.via },
  });
  if (ownerId && ownerId !== actorId)
    await emitEvent(tx, {
      type: 'lead.assigned',
      organizationId: orgId,
      actorId,
      aggregate: { type: 'lead', id: leadId },
      payload: { leadId, ownerId, previousOwnerId: null, ruleId },
    });
  return { leadId, ownerId };
}

export type IntakeResult = { leadId: string; duplicate: boolean };

/**
 * Public form and webhook intake, with the service connection (listed service path, CLAUDE.md §6): the caller is not a
 * user, so the checks happen before this runs (spam protection / Bearer token). Idempotent on `external_ref`; a repeat
 * submission from a known phone or email becomes an activity on that lead instead of a duplicate.
 */
export async function ingestLead(orgId: string, values: LeadValues & { message: string }, via: 'form' | 'webhook'): Promise<IntakeResult> {
  return dbAdmin.transaction(async (tx) => {
    if (values.externalRef) {
      const [same] = await tx
        .select({ id: leads.id })
        .from(leads)
        .where(and(eq(leads.organizationId, orgId), eq(leads.source, values.source), eq(leads.externalRef, values.externalRef)));
      if (same) return { leadId: same.id, duplicate: true };
    }
    const [existing] = await findDuplicateLeads(tx, orgId, values);
    if (existing) {
      await tx.insert(crmActivities).values({
        organizationId: orgId,
        leadId: existing.id,
        type: 'note',
        subject: via === 'form' ? 'resubmitted_form' : 'resubmitted_webhook',
        body: [values.message, values.services.length ? `services: ${values.services.join(', ')}` : ''].filter(Boolean).join('\n'),
        ownerId: existing.ownerId,
        completedAt: new Date(),
      });
      await emitEvent(tx, {
        type: 'lead.resubmitted',
        organizationId: orgId,
        actorId: null,
        aggregate: { type: 'lead', id: existing.id },
        payload: { leadId: existing.id, via },
      });
      return { leadId: existing.id, duplicate: true };
    }
    const { leadId } = await insertLead(
      tx,
      orgId,
      null,
      { ...values, notes: [values.message, values.notes].filter(Boolean).join('\n\n') },
      { via, useRules: true },
    );
    if (values.formId)
      await tx
        .update(leadForms)
        .set({ submissions: sql`${leadForms.submissions} + 1` })
        .where(eq(leadForms.id, values.formId));
    return { leadId, duplicate: false };
  });
}

/* -------------------------------------------------------------------------- */
/* Public form: signed load-time token (bots submit instantly or replay forever) */
/* -------------------------------------------------------------------------- */

const signingKey = () => env().FORM_SIGNING_SECRET || env().SUPABASE_SECRET_KEY;

export function signFormTicket(formId: string, issuedAt = Date.now()): string {
  const payload = `${formId}.${issuedAt}`;
  const sig = createHmac('sha256', signingKey()).update(payload).digest('base64url');
  return `${issuedAt}.${sig}`;
}

export type TicketCheck = 'ok' | 'invalid' | 'too_fast' | 'expired';

export function checkFormTicket(formId: string, ticket: string, now = Date.now()): TicketCheck {
  const [issued, sig] = ticket.split('.');
  const issuedAt = Number(issued);
  if (!issued || !sig || !Number.isFinite(issuedAt)) return 'invalid';
  const expected = createHmac('sha256', signingKey()).update(`${formId}.${issuedAt}`).digest('base64url');
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return 'invalid';
  const age = (now - issuedAt) / 1000;
  if (age < FORM_MIN_SECONDS) return 'too_fast';
  if (age > FORM_MAX_SECONDS) return 'expired';
  return 'ok';
}

export async function publicFormByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [form] = await dbAdmin
    .select()
    .from(leadForms)
    .where(and(eq(leadForms.token, token), eq(leadForms.isActive, true)));
  return form ?? null;
}

/** Name, logo and brand colour for the public form header (no other organization data). */
export async function publicOrganization(orgId: string) {
  const [org] = await dbAdmin
    .select({ name: organizations.name, logoPath: organizations.logoPath, brand: organizations.brand })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return org ?? null;
}

/* -------------------------------------------------------------------------- */
/* Webhook tokens: random 32 bytes, stored hashed (CLAUDE.md §8.7)             */
/* -------------------------------------------------------------------------- */

export function generateWebhookToken(): { token: string; hash: string } {
  const token = `ctw_${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashWebhookToken(token) };
}

export const hashWebhookToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function webhookOrganization(bearer: string | null): Promise<{ organizationId: string; tokenId: string } | null> {
  const token = bearer?.match(/^Bearer\s+(ctw_[A-Za-z0-9_-]{20,})$/)?.[1];
  if (!token) return null;
  const [row] = await dbAdmin
    .select({ id: crmWebhookTokens.id, organizationId: crmWebhookTokens.organizationId, revokedAt: crmWebhookTokens.revokedAt })
    .from(crmWebhookTokens)
    .where(eq(crmWebhookTokens.tokenHash, hashWebhookToken(token)));
  if (!row || row.revokedAt) return null;
  await dbAdmin.update(crmWebhookTokens).set({ lastUsedAt: new Date() }).where(eq(crmWebhookTokens.id, row.id));
  return { organizationId: row.organizationId, tokenId: row.id };
}
