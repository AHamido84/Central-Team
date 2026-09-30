import 'server-only';

import { ActionFailure } from '@/lib/actions/errors';

/**
 * GoTrue errors → codes the UI can explain (ADR-087). The raw message stays in the server log (no address in it).
 * `email_address_not_authorized` is what Supabase Cloud returns while it has no custom SMTP: it only mails the
 * project's team — the "sends nothing" of FR1.7.
 */
export function emailChangeFailure(error: { status?: number; code?: string; message: string }): ActionFailure {
  console.warn('[auth] email change failed', error.status, error.code, error.message);
  const code = error.code ?? '';
  if (error.status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit')
    return new ActionFailure('rate_limited');
  if (code === 'email_exists' || /already been registered/i.test(error.message)) return new ActionFailure('email_in_use');
  if (code === 'email_address_invalid' || code === 'validation_failed') return new ActionFailure('email_invalid');
  if (code === 'email_address_not_authorized' || (error.status ?? 500) >= 500 || /sending .*email/i.test(error.message))
    return new ActionFailure('email_send_failed');
  return new ActionFailure('unknown');
}
