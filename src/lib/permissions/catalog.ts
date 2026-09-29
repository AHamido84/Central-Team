/**
 * Permission keys (resource:action). Must match `public.permissions` (seeded by the migrations in
 * supabase/migrations); a unit test checks the two stay in sync.
 */
export const agencyPermissions = [
  'organization:read',
  'organization:update',
  'users:read',
  'users:update',
  'users:deactivate',
  'invitations:read',
  'invitations:create',
  'invitations:resend',
  'invitations:revoke',
  'roles:read',
  'roles:create',
  'roles:update',
  'roles:delete',
  'roles:assign',
  'permissions:override',
  'departments:read',
  'departments:manage',
  'feature_flags:manage',
  'audit_log:read',
  'design_system:view',
  'clients:read_all',
  'clients:read_assigned',
  'clients:create',
  'clients:update',
  'client_users:manage',
  'packages:manage',
  'packages:assign',
  'files:upload',
  'files:manage',
  'messages:send',
  'requests:read',
  'requests:update',
  'requests:triage',
  'request_types:manage',
  'tasks:read',
  'tasks:create',
  'tasks:update',
  'tasks:delete',
  'workflows:manage',
  'deliverables:manage',
  'deliverables:review',
  'time:read_all',
] as const;

export const clientPermissions = [
  'portal:access',
  'portal_files:upload',
  'portal_messages:send',
  'portal_users:read',
  'portal_users:manage',
  'portal_company:update',
  'portal_requests:create',
] as const;

export type AgencyPermission = (typeof agencyPermissions)[number];
export type ClientPermission = (typeof clientPermissions)[number];
export type Permission = AgencyPermission | ClientPermission;

export const allPermissions: readonly Permission[] = [...agencyPermissions, ...clientPermissions];
