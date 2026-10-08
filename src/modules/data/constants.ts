import type { Permission } from '@/lib/permissions/catalog';

/** Everything that goes to the Trash (ADR-080). The SQL functions `app.trash_*` accept exactly these. */
export const trashTypes = [
  'client',
  'client_user',
  'member',
  'package',
  'request_type',
  'workflow_template',
  'request',
  'task',
  'folder',
  'file',
  'deliverable',
  'deliverable_version',
  'comment',
  'lead',
] as const;
export type TrashType = (typeof trashTypes)[number];

/** The permission family behind each type (`<resource>:delete` / `<resource>:purge`). */
export const trashResource: Record<TrashType, string> = {
  client: 'clients',
  client_user: 'client_users',
  member: 'users',
  package: 'packages',
  request_type: 'request_types',
  workflow_template: 'workflows',
  request: 'requests',
  task: 'tasks',
  folder: 'files',
  file: 'files',
  deliverable: 'deliverables',
  deliverable_version: 'deliverables',
  comment: 'messages',
  lead: 'leads',
};

export const deletePermission = (type: TrashType) => `${trashResource[type]}:delete` as Permission;
export const purgePermission = (type: TrashType) => `${trashResource[type]}:purge` as Permission;

/** Deletes that ask you to type the item's name (they take a lot with them or remove a person). */
export const alwaysTypeToConfirm: readonly TrashType[] = ['client', 'member', 'client_user'];

export type TrashImpact = {
  title: string;
  /** What goes with it (e.g. tasks: 48). */
  counts: Record<string, number>;
  /** Why it can't be deleted (e.g. requests: 3 still use this type). */
  blockers: Record<string, number>;
  /** A team member's open work that needs a new owner. */
  openWork: Record<string, number>;
};

export const resetModes = ['demo', 'operational', 'factory'] as const;
export type ResetMode = (typeof resetModes)[number];

/** Typed on the reset screen before anything is deleted. */
export const RESET_PHRASE = 'DELETE ALL DATA';
