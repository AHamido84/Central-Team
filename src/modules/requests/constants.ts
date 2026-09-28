/** Request lifecycle, priorities and form metadata shared by UI, actions and tests. Mirrors the SQL guards. */
export const requestStatuses = ['submitted', 'in_review', 'in_progress', 'waiting_client', 'completed', 'declined', 'cancelled'] as const;
export type RequestStatus = (typeof requestStatuses)[number];

export const openStatuses: readonly RequestStatus[] = ['submitted', 'in_review', 'in_progress', 'waiting_client'];
export const closedStatuses: readonly RequestStatus[] = ['completed', 'declined', 'cancelled'];

export const requestPriorities = ['low', 'normal', 'high', 'urgent'] as const;
export type RequestPriority = (typeof requestPriorities)[number];

/** Priorities a client may pick when submitting (urgent is an agency decision). */
export const clientPriorities: readonly RequestPriority[] = ['normal', 'high'];

/** Agency transitions — keep identical to `app.request_transition_allowed()` in SQL. */
export const agencyTransitions: Record<RequestStatus, readonly RequestStatus[]> = {
  submitted: ['in_review', 'in_progress', 'declined'],
  in_review: ['in_progress', 'waiting_client', 'declined'],
  in_progress: ['waiting_client', 'completed', 'in_review'],
  waiting_client: ['in_progress', 'completed', 'declined'],
  completed: ['in_progress'],
  declined: ['in_review'],
  cancelled: ['in_review'],
};

/** Client users may only cancel, and only before work is under way (or while the agency waits on them). */
export const clientCancellable: readonly RequestStatus[] = ['submitted', 'in_review', 'waiting_client'];

export function canTransition(side: 'agency' | 'client', from: RequestStatus, to: RequestStatus): boolean {
  if (side === 'client') return to === 'cancelled' && clientCancellable.includes(from);
  return agencyTransitions[from].includes(to);
}

export const requestStatusTone = {
  submitted: 'info',
  in_review: 'brand',
  in_progress: 'warning',
  waiting_client: 'danger',
  completed: 'success',
  declined: 'neutral',
  cancelled: 'neutral',
} as const satisfies Record<RequestStatus, string>;

export const requestPriorityTone = {
  low: 'neutral',
  normal: 'info',
  high: 'warning',
  urgent: 'danger',
} as const satisfies Record<RequestPriority, string>;

/** The steps a client sees in the status tracker (terminal off-ramps are shown separately). */
export const trackerSteps = ['submitted', 'in_review', 'in_progress', 'completed'] as const satisfies readonly RequestStatus[];

export const formCategories = ['design', 'video', 'content', 'ads', 'social', 'other'] as const;
export type FormCategory = (typeof formCategories)[number];

export const formStatuses = ['draft', 'published', 'archived'] as const;
export type FormStatus = (typeof formStatuses)[number];

/** Icons a form can use (lucide names); the UI maps them to components. */
export const formIcons = [
  'clipboard-list',
  'image',
  'clapperboard',
  'pen-line',
  'megaphone',
  'camera',
  'palette',
  'sparkles',
  'calendar',
  'repeat',
] as const;
export type FormIcon = (typeof formIcons)[number];

export type SlaState = 'none' | 'met' | 'on_track' | 'at_risk' | 'breached';

/**
 * SLA state for display. The next milestone is the first response until one happens, then resolution.
 * "At risk" = less than a quarter of the window (or 4 hours) left.
 */
export function slaState(
  r: {
    status: RequestStatus;
    createdAt: string;
    responseDueAt: string | null;
    resolutionDueAt: string | null;
    firstResponseAt: string | null;
    resolvedAt: string | null;
  },
  now: Date = new Date(),
): { state: SlaState; dueAt: string | null; milestone: 'response' | 'resolution' | null } {
  if (r.status === 'cancelled') return { state: 'none', dueAt: null, milestone: null };
  const milestone = !r.firstResponseAt && r.responseDueAt ? 'response' : r.resolutionDueAt ? 'resolution' : null;
  if (!milestone) return { state: 'none', dueAt: null, milestone: null };
  const dueAt = milestone === 'response' ? r.responseDueAt! : r.resolutionDueAt!;
  const doneAt = milestone === 'response' ? r.firstResponseAt : r.resolvedAt;
  if (doneAt) return { state: doneAt <= dueAt ? 'met' : 'breached', dueAt, milestone };
  if (closedStatuses.includes(r.status)) return { state: 'none', dueAt, milestone };
  const due = new Date(dueAt).getTime();
  const left = due - now.getTime();
  if (left < 0) return { state: 'breached', dueAt, milestone };
  const windowMs = due - new Date(r.createdAt).getTime();
  const risk = Math.min(Math.max(windowMs * 0.25, 0), 4 * 3600_000);
  return { state: left <= Math.max(risk, 3600_000) ? 'at_risk' : 'on_track', dueAt, milestone };
}

export const slaTone = {
  none: 'neutral',
  met: 'success',
  on_track: 'success',
  at_risk: 'warning',
  breached: 'danger',
} as const satisfies Record<SlaState, string>;

export function formatRequestNumber(n: number): string {
  return `REQ-${String(n).padStart(4, '0')}`;
}

/** Agency inbox views (saved filters). */
export const inboxViews = ['open', 'mine', 'unassigned', 'closed', 'all'] as const;
export type InboxView = (typeof inboxViews)[number];
