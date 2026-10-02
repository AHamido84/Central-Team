import 'server-only';

import { ActionFailure, type ActionErrorCode } from '@/lib/actions/errors';
import type { ProviderErrorCode } from '@/modules/integrations/constants';
import { ProviderError } from '@/modules/integrations/providers/types';

/** Platform failures → translated action errors (the detail stays in the server log). */
export function providerFailure(error: unknown): ActionFailure {
  if (error instanceof ActionFailure) return error;
  if (!(error instanceof ProviderError)) throw error;
  const map: Partial<Record<ProviderErrorCode, ActionErrorCode>> = {
    not_configured: 'integration_not_configured',
    auth_expired: 'integration_auth_failed',
    auth_revoked: 'integration_auth_failed',
    permission_denied: 'integration_permission_denied',
    rate_limited: 'integration_rate_limited',
    invalid_phone: 'invalid_phone',
    template_not_approved: 'template_not_approved',
    no_connection: 'connection_not_connected',
  };
  console.warn('[integrations] provider error', error.code, error.detail);
  return new ActionFailure(map[error.code] ?? 'integration_unavailable');
}
