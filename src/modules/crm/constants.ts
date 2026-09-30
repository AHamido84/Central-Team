/** CRM enums and small pure helpers shared by server, UI and tests. */
export const leadSources = ['website_form', 'whatsapp', 'instagram', 'referral', 'event', 'lead_ad', 'manual', 'other'] as const;
export type LeadSource = (typeof leadSources)[number];

export const leadStatuses = ['new', 'contacted', 'qualified', 'unqualified', 'converted', 'merged'] as const;
export type LeadStatus = (typeof leadStatuses)[number];
export const openLeadStatuses: readonly LeadStatus[] = ['new', 'contacted', 'qualified'];

export const leadStatusTone = {
  new: 'info',
  contacted: 'brand',
  qualified: 'success',
  unqualified: 'neutral',
  converted: 'accent',
  merged: 'outline',
} as const satisfies Record<LeadStatus, string>;

export const budgetRanges = ['under_5k', '5k_15k', '15k_50k', '50k_plus', 'unknown'] as const;
export type BudgetRange = (typeof budgetRanges)[number];

/** Services a lead can be interested in (drive assignment rules and scoring). */
export const crmServices = ['social_media', 'content', 'design', 'video', 'photography', 'ads', 'branding', 'web', 'influencers'] as const;
export type CrmService = (typeof crmServices)[number];

export const activityTypes = ['call', 'meeting', 'email', 'whatsapp', 'note', 'task'] as const;
export type ActivityType = (typeof activityTypes)[number];

export const lostReasons = ['price', 'timing', 'competitor', 'no_response', 'not_fit', 'other'] as const;
export type LostReason = (typeof lostReasons)[number];

export const dealStatuses = ['open', 'won', 'lost'] as const;
export type DealStatus = (typeof dealStatuses)[number];
export type StageKind = DealStatus;

export const quoteStatuses = ['draft', 'sent', 'accepted', 'declined'] as const;
export type QuoteStatus = (typeof quoteStatuses)[number];
export const quoteStatusTone = { draft: 'outline', sent: 'info', accepted: 'success', declined: 'danger' } as const satisfies Record<
  QuoteStatus,
  string
>;

export const followUpBuckets = ['overdue', 'today', 'upcoming'] as const;
export type FollowUpBucket = (typeof followUpBuckets)[number];

export const salesPeriods = ['month', 'quarter', 'year'] as const;
export type SalesPeriod = (typeof salesPeriods)[number];

export const leadReference = (n: number) => `L-${n}`;
export const dealReference = (n: number) => `D-${n}`;
export const quoteReference = (n: number) => `Q-${n}`;

/** Leads shown per list page; CRM volumes stay small for an agency. */
export const LEADS_LIMIT = 1000;
/** Minimum seconds between loading the public form and submitting it (bots submit instantly). */
export const FORM_MIN_SECONDS = 3;
/** The signed form token expires after this many seconds (a stale tab must reload). */
export const FORM_MAX_SECONDS = 60 * 60 * 6;
