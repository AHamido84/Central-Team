/**
 * Typed registry of domain events. Add an entry when a module starts emitting a new event type.
 * Naming: `resource.past_tense_verb`.
 */
export type DomainEventPayloads = {
  // Identity & invitations
  'invitation.created': { email: string; userType: 'agency' | 'client'; clientId?: string | null };
  'invitation.resent': { email: string };
  'invitation.revoked': { email: string };
  'invitation.accepted': { email: string; userId: string; userType: 'agency' | 'client' };
  'user.onboarded': { userId: string };
  'user.profile_updated': { userId: string; fields: string[] };
  'user.deactivated': { userId: string };
  'user.reactivated': { userId: string };
  // RBAC
  'role.created': { roleId: string };
  'role.updated': { roleId: string; fields: string[] };
  'role.deleted': { roleId: string };
  'role.permissions_updated': { roleId: string; added: string[]; removed: string[] };
  'user.roles_changed': { userId: string; added: string[]; removed: string[] };
  'user.permission_override_set': { userId: string; permissionKey: string; effect: 'grant' | 'deny' | 'none' };
  // Organization
  'department.created': { departmentId: string };
  'department.updated': { departmentId: string };
  'department.members_changed': { departmentId: string; added: string[]; removed: string[] };
  'feature_flag.toggled': { flagKey: string; enabled: boolean };
  'organization.updated': { fields: string[] };
  // Clients (Phase 1)
  'client.created': { clientId: string };
  'client.updated': { clientId: string; fields: string[] };
  'client_user.updated': { clientId: string; userId: string; fields: string[] };
  'client_package.assigned': { clientId: string; clientPackageId: string; packageId: string };
  'package.created': { packageId: string };
  'package.updated': { packageId: string };
  // Files & messaging (Phase 1)
  'file.uploaded': { fileId: string; clientId: string; visibility: 'internal' | 'client'; name: string };
  'file.updated': { fileId: string; fields: string[] };
  'file.deleted': { fileId: string };
  'folder.created': { folderId: string; clientId: string };
  'thread.created': { threadId: string; clientId: string };
  'comment.created': {
    commentId: string;
    threadId: string;
    clientId: string;
    visibility: 'internal' | 'client';
    mentions: string[];
  };
  // Requests (Phase 2)
  'request_type.created': { typeId: string };
  'request_type.updated': { typeId: string; fields: string[] };
  'request.submitted': { requestId: string; clientId: string; reference: string; typeId: string; isExtra: boolean };
  'request.status_changed': { requestId: string; clientId: string; from: string; to: string; reason: string | null };
  'request.brief_updated': { requestId: string; clientId: string };
  'request.assigned': { requestId: string; clientId: string; assigneeId: string | null; previousAssigneeId: string | null };
  'request.triaged': { requestId: string; clientId: string; fields: string[] };
  'request.converted': { requestId: string; clientId: string; templateId: string; taskIds: string[] };
  // Workflows, tasks & time (Phase 3)
  'workflow_template.created': { templateId: string };
  'workflow_template.updated': { templateId: string; fields: string[] };
  'workflow_template.deleted': { templateId: string };
  'task_statuses.updated': { statusIds: string[] };
  'task.created': { taskId: string; clientId: string; parentId: string | null };
  'task.updated': { taskId: string; clientId: string; fields: string[] };
  'task.deleted': { taskId: string; clientId: string };
  'task.assigned': { taskId: string; clientId: string; userIds: string[] };
  'task.status_changed': { taskId: string; clientId: string; from: string; to: string };
  'task.due_soon': { taskId: string; clientId: string; dueDate: string };
  'task.overdue': { taskId: string; clientId: string; dueDate: string };
  'time_entry.recorded': { taskId: string; clientId: string; minutes: number };
  // Deliverables & approvals (Phase 3)
  'deliverable.created': { deliverableId: string; clientId: string; taskId: string | null };
  'deliverable.updated': { deliverableId: string; clientId: string; fields: string[] };
  'deliverable.version_created': { deliverableId: string; clientId: string; versionId: string; number: number };
  /** A version entered a review stage (`internal_review`, `client_review`) or was approved without review. */
  'deliverable.submitted': { deliverableId: string; clientId: string; versionId: string; status: string };
  'deliverable.decided': {
    deliverableId: string;
    clientId: string;
    versionId: string;
    stage: 'internal' | 'client';
    decision: 'approved' | 'changes_requested';
    status: string;
    approvalId: string;
  };
  'deliverable.approval_reminder': { deliverableId: string; clientId: string; versionId: string; days: number };
  'annotation.created': {
    annotationId: string;
    deliverableId: string;
    clientId: string;
    visibility: 'internal' | 'client';
    side: 'agency' | 'client';
  };
  // Campaigns, metrics & reports (Phase 4)
  'campaign.created': { campaignId: string; clientId: string };
  'campaign.updated': { campaignId: string; clientId: string; fields: string[] };
  'campaign.status_changed': { campaignId: string; clientId: string; from: string; to: string };
  'campaign.deleted': { campaignId: string; clientId: string };
  /** Health got worse than what the owner was last told (at risk / off track). */
  'campaign.health_changed': { campaignId: string; clientId: string; from: string; to: string };
  'campaign.metrics_stale': { campaignId: string; clientId: string; lastDate: string | null; days: number };
  'metrics.recorded': { campaignId: string; clientId: string; days: number };
  'metrics.imported': { campaignId: string; clientId: string; importId: string; rows: number; preset: string };
  'report.created': { reportId: string; clientId: string; scheduleId: string | null };
  'report.updated': { reportId: string; clientId: string };
  /** A scheduled report was generated as a draft and waits for the team. */
  'report.draft_ready': { reportId: string; clientId: string; scheduleId: string };
  'report.published': { reportId: string; clientId: string };
  'report.unpublished': { reportId: string; clientId: string };
  'report.deleted': { reportId: string; clientId: string };
  'report_schedule.saved': { scheduleId: string; clientId: string };
  'report_schedule.deleted': { scheduleId: string; clientId: string };
};

export type DomainEventType = keyof DomainEventPayloads;
