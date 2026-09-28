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
  'request_form.created': { formId: string };
  'request_form.updated': { formId: string; fields: string[] };
  'request_form.draft_saved': { formId: string; versionId: string; version: number };
  'request_form.published': { formId: string; versionId: string; version: number };
  'request_form.archived': { formId: string; archived: boolean };
  'request.submitted': { requestId: string; clientId: string; number: number; formId: string; side: 'agency' | 'client' };
  'request.status_changed': { requestId: string; clientId: string; from: string; to: string; commentId?: string | null };
  'request.assigned': { requestId: string; clientId: string; assigneeId: string | null; previousAssigneeId: string | null };
  'request.priority_changed': { requestId: string; clientId: string; from: string; to: string };
};

export type DomainEventType = keyof DomainEventPayloads;
