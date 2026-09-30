/**
 * Pure lead logic: contact normalisation, duplicate matching, scoring, merging and assignment rules.
 * Shared by the server (actions, public form, webhook, CSV import), the UI (duplicate warnings) and tests.
 */
import type { BudgetRange, LeadSource, LeadStatus } from '@/modules/crm/constants';

/** Arabic-Indic (٠-٩) and Eastern Arabic-Indic (۰-۹) digits → 0-9. */
const toLatin = (v: string) =>
  v
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/**
 * Normalises a phone number to E.164, Saudi-first: 05XXXXXXXX, 5XXXXXXXX, 9665XXXXXXXX, 009665…, +9665… and Arabic-Indic
 * digits. Saudi numbers must be a mobile (+9665 + 8 digits) or a landline (+9661x + 7 digits); other countries any
 * valid E.164. Returns null when it can't be a phone number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = toLatin(raw).replace(/[\s().\-\u200e\u200f]/g, '');
  if (!v) return null;
  if (/^00\d+$/.test(v)) v = `+${v.slice(2)}`;
  else if (/^05\d{8}$/.test(v)) v = `+966${v.slice(1)}`;
  else if (/^5\d{8}$/.test(v)) v = `+966${v}`;
  else if (/^01[1-7]\d{7}$/.test(v)) v = `+966${v.slice(1)}`;
  else if (/^966\d{8,9}$/.test(v)) v = `+${v}`;
  if (!/^\+[1-9]\d{7,14}$/.test(v)) return null;
  if (v.startsWith('+966') && !/^\+966(5\d{8}|1[1-7]\d{7})$/.test(v)) return null;
  return v;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

export type LeadContact = { id: string; phone: string | null; email: string | null; status: LeadStatus };

/** Open or converted leads sharing a phone or email (merged leads are never duplicates). */
export function findDuplicates<T extends LeadContact>(
  lead: { id?: string; phone: string | null; email: string | null },
  pool: readonly T[],
): T[] {
  return pool.filter(
    (other) =>
      other.id !== lead.id &&
      other.status !== 'merged' &&
      ((lead.phone && other.phone === lead.phone) || (lead.email && other.email && other.email === lead.email.toLowerCase())),
  );
}

export type ScoreInput = {
  phone: string | null;
  email: string | null;
  company: string | null;
  source: LeadSource;
  services: readonly string[];
  budgetRange: BudgetRange;
  city: string | null;
};

const budgetPoints: Record<BudgetRange, number> = { under_5k: 5, '5k_15k': 15, '15k_50k': 25, '50k_plus': 35, unknown: 0 };
const sourcePoints: Record<LeadSource, number> = {
  referral: 20,
  event: 12,
  website_form: 12,
  whatsapp: 10,
  lead_ad: 8,
  instagram: 8,
  manual: 6,
  other: 4,
};

/**
 * 0–100 fit score: budget (≤35), source quality (≤20), reachability (phone 10, email 5), company named (10),
 * services asked for (5 each, ≤15), city known (5). Simple and explainable — sales can see why a lead ranks high.
 */
export function leadScore(l: ScoreInput): number {
  const score =
    budgetPoints[l.budgetRange] +
    sourcePoints[l.source] +
    (l.phone ? 10 : 0) +
    (l.email ? 5 : 0) +
    (l.company?.trim() ? 10 : 0) +
    Math.min(15, new Set(l.services).size * 5) +
    (l.city ? 5 : 0);
  return Math.max(0, Math.min(100, score));
}

export type MergeableLead = ScoreInput & {
  id: string;
  fullName: string;
  sourceDetail: string | null;
  ownerId: string | null;
  status: LeadStatus;
  tags: readonly string[];
  notes: string;
};

const statusRank: Record<LeadStatus, number> = { converted: 5, qualified: 4, contacted: 3, new: 2, unqualified: 1, merged: 0 };

/**
 * The surviving lead after merging `other` into `primary`: the primary's values win, empty fields are filled from the
 * other, services and tags are united, notes appended, the more advanced status kept.
 */
export function mergeLeads<P extends MergeableLead>(primary: P, other: MergeableLead): P & { score: number } {
  const pick = <K extends keyof MergeableLead>(k: K) => (primary[k] === null || primary[k] === '' ? other[k] : primary[k]);
  const merged = {
    ...primary,
    company: pick('company'),
    phone: pick('phone'),
    email: pick('email'),
    city: pick('city'),
    sourceDetail: pick('sourceDetail'),
    ownerId: pick('ownerId'),
    budgetRange: primary.budgetRange === 'unknown' ? other.budgetRange : primary.budgetRange,
    services: [...new Set([...primary.services, ...other.services])],
    tags: [...new Set([...primary.tags, ...other.tags])],
    notes: [primary.notes, other.notes].filter((n) => n.trim()).join('\n\n'),
    status: statusRank[other.status] > statusRank[primary.status] ? other.status : primary.status,
  };
  return { ...merged, score: leadScore(merged) } as P & { score: number };
}

export type AssignmentRule = {
  id: string;
  isActive: boolean;
  sortOrder: number;
  matchServices: readonly string[];
  matchCities: readonly string[];
  matchSources: readonly string[];
  memberIds: readonly string[];
  cursor: number;
};

export type AssignmentResult = { ruleId: string; ownerId: string; nextCursor: number } | null;

/**
 * First active rule (by sort order) whose non-empty criteria all match the lead, then round-robin over the rule's
 * members who are still eligible (`eligible` = active agency members with `leads:manage`). The caller stores
 * `nextCursor` so the next lead goes to the next person.
 */
export function pickAssignee(
  rules: readonly AssignmentRule[],
  lead: { services: readonly string[]; city: string | null; source: string },
  eligible: ReadonlySet<string>,
): AssignmentResult {
  const ordered = [...rules].filter((r) => r.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  for (const rule of ordered) {
    if (rule.matchServices.length && !lead.services.some((s) => rule.matchServices.includes(s))) continue;
    if (rule.matchCities.length && !(lead.city && rule.matchCities.includes(lead.city))) continue;
    if (rule.matchSources.length && !rule.matchSources.includes(lead.source)) continue;
    const members = rule.memberIds.filter((id) => eligible.has(id));
    if (!members.length) continue;
    const index = ((rule.cursor % members.length) + members.length) % members.length;
    return { ruleId: rule.id, ownerId: members[index]!, nextCursor: (index + 1) % members.length };
  }
  return null;
}
