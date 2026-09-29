export const deliverableStatuses = [
  'in_progress',
  'internal_review',
  'internal_changes',
  'client_review',
  'client_changes',
  'approved',
] as const;
export type DeliverableStatus = (typeof deliverableStatuses)[number];

export const versionStatuses = [
  'draft',
  'internal_review',
  'internal_changes',
  'client_review',
  'client_changes',
  'approved',
  'superseded',
] as const;
export type VersionStatus = (typeof versionStatuses)[number];

export const approvalStages = ['internal', 'client'] as const;
export type ApprovalStage = (typeof approvalStages)[number];
export const approvalDecisions = ['approved', 'changes_requested'] as const;
export type ApprovalDecision = (typeof approvalDecisions)[number];

/** What the task's status category becomes when the deliverable enters a state (ADR-038). */
export const taskCategoryFor: Record<DeliverableStatus, 'active' | 'review' | 'changes' | 'done'> = {
  in_progress: 'active',
  internal_review: 'review',
  internal_changes: 'changes',
  client_review: 'review',
  client_changes: 'changes',
  approved: 'done',
};

type Flags = { requiresInternalReview: boolean; requiresClientApproval: boolean };

/** Status a freshly submitted version enters. Mirrors `app.tg_deliverable_versions_submit`. */
export function submitTarget(flags: Flags): 'internal_review' | 'client_review' | 'approved' {
  if (flags.requiresInternalReview) return 'internal_review';
  if (flags.requiresClientApproval) return 'client_review';
  return 'approved';
}

/**
 * The approval state machine (mirrors `app.tg_approvals_apply`): which stage may decide in which version status,
 * and where each decision leads. Returns null when the decision isn't allowed now.
 */
export function applyDecision(status: VersionStatus, stage: ApprovalStage, decision: ApprovalDecision, flags: Flags): VersionStatus | null {
  if (stage === 'internal') {
    if (status !== 'internal_review') return null;
    if (decision === 'changes_requested') return 'internal_changes';
    return flags.requiresClientApproval ? 'client_review' : 'approved';
  }
  if (status !== 'client_review') return null;
  return decision === 'changes_requested' ? 'client_changes' : 'approved';
}

/** The client's view of a deliverable status (internal stages after a first send read as "in revision"). */
export type ClientDeliverableState = 'awaiting' | 'revising' | 'approved';
export function clientState(status: DeliverableStatus): ClientDeliverableState {
  if (status === 'client_review') return 'awaiting';
  if (status === 'approved') return 'approved';
  return 'revising';
}

export const annotationKinds = ['point', 'timestamp', 'general'] as const;
export type AnnotationKind = (typeof annotationKinds)[number];

/** Upload limits for deliverable files (bigger than the library: finished videos). */
const MB = 1024 * 1024;
export const deliverableMaxBytes = {
  image: 50 * MB,
  video: 2048 * MB,
  pdf: 100 * MB,
  document: 100 * MB,
  archive: 1024 * MB,
  other: 1024 * MB,
} as const;

/** Resumable (TUS) chunk size: Supabase Storage requires exactly 6 MB chunks. */
export const TUS_CHUNK_SIZE = 6 * MB;
