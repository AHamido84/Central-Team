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
  // Operations & SLA (Phase 5)
  'sla_policy.saved': { policyId: string };
  'sla_policy.deleted': { policyId: string };
  'business_hours.updated': { start: number; end: number };
  'holiday.saved': { holidayId: string; date: string };
  'holiday.deleted': { holidayId: string; date: string };
  /** Recorded once per request × kind by the SLA sweep. */
  'sla.at_risk': { breachId: string; requestId: string; clientId: string; kind: 'response' | 'resolution'; dueAt: string };
  'sla.breached': { breachId: string; requestId: string; clientId: string; kind: 'response' | 'resolution'; dueAt: string };
  'sla_breach.acknowledged': { breachId: string; requestId: string; clientId: string };
  // CRM & capacity (Phase 6)
  'lead.created': { leadId: string; source: string; ownerId: string | null; via: 'manual' | 'import' | 'form' | 'webhook' | 'lead_ad' };
  'lead.updated': { leadId: string; fields: string[] };
  'lead.assigned': { leadId: string; ownerId: string | null; previousOwnerId: string | null; ruleId: string | null };
  'lead.resubmitted': { leadId: string; via: 'form' | 'webhook' | 'lead_ad' };
  'lead.merged': { leadId: string; mergedId: string };
  'lead.converted': { leadId: string; dealId: string };
  'leads.imported': { count: number; skipped: number; source: string };
  'deal.created': { dealId: string; leadId: string | null; ownerId: string | null };
  'deal.updated': { dealId: string; fields: string[] };
  'deal.stage_changed': { dealId: string; fromStageId: string; toStageId: string; status: string };
  'deal.won': { dealId: string; valueMinor: number; ownerId: string | null };
  'deal.lost': { dealId: string; reason: string };
  'deal.converted': { dealId: string; clientId: string; requestId: string | null; invitationId: string | null };
  'deal.stale': { dealId: string; ownerId: string | null; days: number };
  'crm_activity.created': { activityId: string; leadId: string | null; dealId: string | null; type: string };
  'crm_activity.completed': { activityId: string; leadId: string | null; dealId: string | null };
  'crm_activity.due': { activityId: string; ownerId: string; dueAt: string };
  'quote.saved': { quoteId: string; dealId: string; totalMinor: number };
  'quote.status_changed': { quoteId: string; dealId: string; status: string };
  'crm_settings.updated': { area: string; id: string | null };
  'capacity.updated': { area: 'member' | 'time_off' | 'effort'; id: string };
  // Integrations & automation (Phase 7)
  'integration.connected': { connectionId: string; provider: string; mode: 'live' | 'sandbox' };
  'integration.reconnected': { connectionId: string; provider: string };
  'integration.disconnected': { connectionId: string; provider: string };
  'integration.updated': { connectionId: string; fields: string[] };
  /** The token expired or was revoked: someone with `integrations:manage` has to reconnect. */
  'integration.connection_expired': { connectionId: string; provider: string; errorCode: string };
  'integration.account_mapped': { accountId: string; clientId: string | null; syncEnabled: boolean };
  'integration.campaign_linked': { linkId: string; channelId: string | null };
  'integration.sync_requested': { runId: string; connectionId: string; from: string; to: string };
  /** A sync run gave up after its last retry. */
  'integration.sync_failed': { runId: string; connectionId: string; provider: string; errorCode: string };
  /** One campaign got fresh numbers from a platform sync. */
  'metrics.synced': { campaignId: string; clientId: string; runId: string; rows: number; from: string; to: string };
  'whatsapp.templates_synced': { connectionId: string; count: number };
  'whatsapp.template_updated': { templateId: string; isNotification: boolean };
  'whatsapp.message_sent': {
    messageId: string;
    purpose: 'notification' | 'lead' | 'automation';
    leadId: string | null;
    dealId: string | null;
  };
  'whatsapp.message_failed': { messageId: string; errorCode: string };
  'whatsapp.opt_in_changed': { userId: string; optedIn: boolean };
  'automation.saved': { automationId: string; created: boolean };
  'automation.toggled': { automationId: string; isActive: boolean };
  'automation.deleted': { automationId: string };
  /** A run failed after the dispatcher's last retry. */
  'automation.failed': { automationId: string; runId: string; error: string };
  // AI intelligence (Phase 8)
  /** A detector found something new on a campaign, or a cleared condition came back (`reopened`). */
  'ai_insight.detected': {
    insightId: string;
    campaignId: string;
    clientId: string;
    insightKind: string;
    severity: 'info' | 'warning' | 'critical';
    metric: string | null;
    reopened: boolean;
  };
  'ai_insight.status_changed': { insightId: string; campaignId: string; clientId: string; from: string; to: string };
  'ai_recommendation.decided': {
    recommendationId: string;
    insightId: string;
    campaignId: string;
    clientId: string;
    decision: 'accepted' | 'dismissed';
    taskId: string | null;
  };
  'ai_settings.updated': { fields: string[] };
  'ai_report.drafted': { reportId: string; clientId: string; section: 'commentary' | 'next_steps' };
};

export type DomainEventType = keyof DomainEventPayloads;
