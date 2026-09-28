/** Request lifecycle, priorities and request-type metadata shared by UI, actions and tests. Mirrors the SQL guards. */
export const requestStatuses = [
  'draft',
  'submitted',
  'under_review',
  'needs_info',
  'accepted',
  'in_progress',
  'in_review',
  'delivered',
  'closed',
  'rejected',
  'cancelled',
] as const;
export type RequestStatus = (typeof requestStatuses)[number];

/** Waiting on the agency's decision. */
export const pendingStatuses: readonly RequestStatus[] = ['submitted', 'under_review', 'needs_info'];
/** Accepted work under way. */
export const activeStatuses: readonly RequestStatus[] = ['accepted', 'in_progress', 'in_review'];
/** Everything not finished (excludes drafts). */
export const openStatuses: readonly RequestStatus[] = [...pendingStatuses, ...activeStatuses, 'delivered'];
export const closedStatuses: readonly RequestStatus[] = ['closed', 'rejected', 'cancelled'];
/** Statuses in which the package item is consumed. */
export const consumingStatuses: readonly RequestStatus[] = ['accepted', 'in_progress', 'in_review', 'delivered', 'closed'];

export type Side = 'agency' | 'client';

/**
 * Allowed transitions per side — keep identical to `app.request_transition_allowed()` in SQL
 * (a unit test compares the two).
 */
export const requestTransitions: Record<Side, Record<RequestStatus, readonly RequestStatus[]>> = {
  client: {
    draft: ['submitted'],
    submitted: ['cancelled'],
    under_review: ['cancelled'],
    needs_info: ['under_review', 'cancelled'],
    accepted: [],
    in_progress: [],
    in_review: [],
    delivered: ['closed'],
    closed: [],
    rejected: [],
    cancelled: [],
  },
  agency: {
    draft: [],
    submitted: ['under_review', 'needs_info', 'accepted', 'rejected'],
    under_review: ['needs_info', 'accepted', 'rejected'],
    needs_info: ['under_review'],
    accepted: ['in_progress'],
    in_progress: ['in_review', 'delivered'],
    in_review: ['in_progress', 'delivered'],
    delivered: ['closed', 'in_progress'],
    closed: [],
    rejected: ['under_review'],
    cancelled: [],
  },
};

/** Transitions that must carry a reason (shown to the client). */
export const reasonRequired: readonly RequestStatus[] = ['needs_info', 'rejected'];

/** Transitions only `requests:triage` may make; the assignee with `requests:update` may make the rest. */
export const triageOnlyTargets: readonly RequestStatus[] = ['under_review', 'needs_info', 'accepted', 'rejected'];

export function canTransition(side: Side, from: RequestStatus, to: RequestStatus): boolean {
  return requestTransitions[side][from].includes(to);
}

/** Client users may edit the brief only while drafting or when the agency asked for more information. */
export const clientEditableStatuses: readonly RequestStatus[] = ['draft', 'needs_info'];

export const requestPriorities = ['low', 'normal', 'high', 'urgent'] as const;
export type RequestPriority = (typeof requestPriorities)[number];
/** Priorities a client may pick (urgent is an agency decision). */
export const clientPriorities: readonly RequestPriority[] = ['low', 'normal', 'high'];

export const requestStatusTone = {
  draft: 'outline',
  submitted: 'info',
  under_review: 'brand',
  needs_info: 'danger',
  accepted: 'accent',
  in_progress: 'warning',
  in_review: 'warning',
  delivered: 'success',
  closed: 'neutral',
  rejected: 'neutral',
  cancelled: 'neutral',
} as const satisfies Record<RequestStatus, string>;

export const requestPriorityTone = {
  low: 'neutral',
  normal: 'info',
  high: 'warning',
  urgent: 'danger',
} as const satisfies Record<RequestPriority, string>;

/** The steps a client sees in the tracker; off-ramps (needs info, rejected, cancelled) are called out separately. */
export const trackerSteps = [
  'submitted',
  'under_review',
  'accepted',
  'in_progress',
  'delivered',
  'closed',
] as const satisfies readonly RequestStatus[];

export function trackerIndex(status: RequestStatus): number {
  switch (status) {
    case 'draft':
      return -1;
    case 'needs_info':
      return 1;
    case 'in_review':
      return 3;
    default:
      return (trackerSteps as readonly RequestStatus[]).indexOf(status);
  }
}

export const typeCategories = ['design', 'video', 'content', 'ads', 'web', 'branding', 'other'] as const;
export type TypeCategory = (typeof typeCategories)[number];

/** Icons a request type can use (lucide names); the UI maps them to components. */
export const typeIcons = [
  'image',
  'gallery-horizontal',
  'clapperboard',
  'smartphone',
  'megaphone',
  'camera',
  'globe',
  'palette',
  'pen-line',
  'clipboard-list',
] as const;
export type TypeIcon = (typeof typeIcons)[number];

/** Platform picker options (fixed list; labels come from translations). */
export const platforms = ['instagram', 'tiktok', 'snapchat', 'x', 'linkedin', 'youtube', 'facebook'] as const;
export type Platform = (typeof platforms)[number];

/** Aspect-ratio presets for the dimensions field (`custom` takes width × height in px). */
export const aspectRatios = ['1:1', '4:5', '9:16', '16:9', '1.91:1', 'custom'] as const;
export type AspectRatio = (typeof aspectRatios)[number];

/** Agency inbox views (saved filters). */
export const inboxViews = ['new', 'pending', 'active', 'delivered', 'closed', 'mine', 'all'] as const;
export type InboxView = (typeof inboxViews)[number];

export function inInboxView(r: { status: RequestStatus; assigneeId: string | null }, view: InboxView, me: string): boolean {
  switch (view) {
    case 'new':
      return r.status === 'submitted';
    case 'pending':
      return r.status === 'under_review' || r.status === 'needs_info';
    case 'active':
      return activeStatuses.includes(r.status);
    case 'delivered':
      return r.status === 'delivered';
    case 'closed':
      return closedStatuses.includes(r.status);
    case 'mine':
      return r.assigneeId === me && !closedStatuses.includes(r.status);
    case 'all':
      return true;
  }
}

export type SlaState = 'none' | 'met' | 'missed' | 'on_track' | 'at_risk' | 'overdue';

const DAY = 86_400_000;

/**
 * SLA state from the due date (a calendar date, due by the end of that day in Riyadh).
 * At risk = one day or less left, or under a quarter of the window.
 */
export function slaState(
  r: { status: RequestStatus; submittedAt: string | null; dueDate: string | null; deliveredAt: string | null },
  now: Date = new Date(),
): SlaState {
  if (!r.dueDate || !r.submittedAt || r.status === 'draft' || r.status === 'cancelled' || r.status === 'rejected') return 'none';
  const dueEnd = new Date(`${r.dueDate}T23:59:59+03:00`).getTime();
  if (r.deliveredAt) return new Date(r.deliveredAt).getTime() <= dueEnd ? 'met' : 'missed';
  if (r.status === 'closed') return 'none';
  const left = dueEnd - now.getTime();
  if (left < 0) return 'overdue';
  const window = dueEnd - new Date(r.submittedAt).getTime();
  return left <= Math.max(DAY, window * 0.25) ? 'at_risk' : 'on_track';
}

export const slaTone = {
  none: 'neutral',
  met: 'success',
  missed: 'danger',
  on_track: 'success',
  at_risk: 'warning',
  overdue: 'danger',
} as const satisfies Record<SlaState, string>;

/** Adds working days (Sunday–Thursday) to a date string — mirrors `app.add_working_days()` for previews. */
export function addWorkingDays(from: string, days: number): string {
  const d = new Date(`${from}T12:00:00Z`);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 5 && dow !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

/** Default reference prefix for a client (mirrors the SQL default): first slug word, letters/digits, max 6, upper-case. */
export function defaultPrefix(slug: string): string {
  const word = (slug.split('-')[0] ?? '')
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 6)
    .toUpperCase();
  return word || 'REQ';
}
