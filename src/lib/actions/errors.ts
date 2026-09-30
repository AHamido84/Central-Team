/** Error codes returned by actions. Each has a translation under `errors.<code>`. */
export const actionErrorCodes = [
  'unauthenticated',
  'forbidden',
  'validation',
  'not_found',
  'conflict',
  'rate_limited',
  'already_member',
  'invitation_invalid',
  'invitation_expired',
  'last_super_admin',
  'last_client_owner',
  'cannot_deactivate_self',
  'cannot_modify_self',
  'cannot_grant_unheld_permission',
  'role_locked',
  'system_role_not_deletable',
  'role_in_use',
  'file_too_large',
  'file_type_not_allowed',
  'upload_failed',
  'weak_password',
  'invalid_credentials',
  'invalid_transition',
  'invalid_assignee',
  'request_type_inactive',
  'reason_required',
  'request_field_restricted',
  'dependency_cycle',
  'invalid_dependency',
  'version_empty',
  'version_locked',
  'version_not_current',
  'comment_required',
  'status_in_use',
  'status_done_required',
  'already_converted',
  'workflow_empty',
  'invalid_status',
  'invalid_parent',
  'invalid_file',
  'report_published',
  'import_empty',
  'campaign_not_deletable',
  'channel_has_metrics',
  'invalid_stage',
  'invalid_merge',
  'deal_not_won',
  'already_converted_deal',
  'onboarding_not_configured',
  'onboarding_not_permitted',
  'integration_not_configured',
  'integration_auth_failed',
  'integration_permission_denied',
  'integration_rate_limited',
  'integration_unavailable',
  'connection_not_connected',
  'channel_client_mismatch',
  'invalid_phone',
  'template_not_approved',
  'no_phone',
  'webhook_url_blocked',
  'ai_disabled',
  'ai_not_configured',
  'ai_budget_exceeded',
  'ai_refused',
  'ai_unavailable',
  'in_use',
  'reassign_required',
  'parent_deleted',
  'reset_locked',
  'field_forbidden',
  'ai_key_invalid',
  'invalid_password',
  'confirmation_mismatch',
  'unknown',
] as const;

export type ActionErrorCode = (typeof actionErrorCodes)[number];

export type ActionError = {
  code: ActionErrorCode;
  fieldErrors?: Record<string, string[]>;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

/** Throw from a handler to return a specific, translatable error code. */
export class ActionFailure extends Error {
  constructor(
    public readonly code: ActionErrorCode,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(code);
  }
}

type PgLikeError = { code?: string; message?: string; cause?: unknown };

function findPgError(error: unknown): PgLikeError | null {
  let current: unknown = error;
  for (let i = 0; i < 4 && current; i++) {
    const e = current as PgLikeError;
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e;
    current = e.cause;
  }
  return null;
}

const raisedCodes = new Set<ActionErrorCode>([
  'last_super_admin',
  'cannot_deactivate_self',
  'cannot_modify_self',
  'cannot_grant_unheld_permission',
  'role_locked',
  'system_role_not_deletable',
  'invalid_transition',
  'invalid_assignee',
  'request_type_inactive',
  'reason_required',
  'request_field_restricted',
  'dependency_cycle',
  'invalid_dependency',
  'version_empty',
  'version_locked',
  'version_not_current',
  'comment_required',
  'status_done_required',
  'invalid_status',
  'invalid_parent',
  'invalid_file',
  'report_published',
  'invalid_stage',
  'invalid_merge',
  'connection_not_connected',
  'channel_client_mismatch',
  'template_not_approved',
  'in_use',
  'reassign_required',
  'parent_deleted',
  'reset_locked',
  'field_forbidden',
]);

/** Maps thrown errors (ActionFailure, Postgres errors raised by RLS/triggers) to a safe error code. */
export function toActionError(error: unknown): ActionError {
  if (error instanceof ActionFailure) return { code: error.code, fieldErrors: error.fieldErrors };
  const pg = findPgError(error);
  if (pg) {
    const message = pg.message ?? '';
    const raised = [...raisedCodes].find((c) => message === c);
    if (raised) return { code: raised };
    if (pg.code === '42501') return { code: 'forbidden' };
    if (pg.code === 'P0002') return { code: 'not_found' };
    if (pg.code === '23505') return { code: 'conflict' };
    if (pg.code === '23503' && message.includes('task_statuses')) return { code: 'status_in_use' };
    if (pg.code === '23503' && message.includes('delete')) return { code: 'role_in_use' };
    if (pg.code === '23503' || pg.code === '22023' || pg.code === '23514') return { code: 'validation' };
  }
  if ((error as Error)?.message === 'unauthenticated') return { code: 'unauthenticated' };
  return { code: 'unknown' };
}
