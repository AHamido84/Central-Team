import { describe, expect, it, vi } from 'vitest';

import { emailChangeFailure } from '@/modules/identity/server/email-change';

/** FR1.7 — GoTrue errors become codes the user can act on, never a generic "conflict". */
describe('emailChangeFailure', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const code = (e: { status?: number; code?: string; message: string }) => emailChangeFailure(e).code;

  it('maps rate limits', () => {
    expect(code({ status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' })).toBe('rate_limited');
    expect(code({ status: 429, message: 'For security purposes, you can only request this after 1 seconds.' })).toBe('rate_limited');
  });
  it('maps an address in use', () => {
    expect(code({ status: 422, code: 'email_exists', message: 'Email address already registered' })).toBe('email_in_use');
    expect(code({ status: 422, message: 'A user with this email address has already been registered' })).toBe('email_in_use');
  });
  it('maps invalid addresses', () => {
    expect(code({ status: 400, code: 'email_address_invalid', message: 'Email address "x@example.com" is invalid' })).toBe('email_invalid');
    expect(code({ status: 400, code: 'validation_failed', message: 'Unable to validate email address' })).toBe('email_invalid');
  });
  it('maps mail server failures, including Supabase Cloud without custom SMTP', () => {
    expect(code({ status: 500, code: 'unexpected_failure', message: 'Error sending email change email' })).toBe('email_send_failed');
    expect(code({ status: 400, code: 'email_address_not_authorized', message: 'Email address not authorized' })).toBe('email_send_failed');
  });
  it('anything else is unknown', () => {
    expect(code({ status: 400, code: 'something_new', message: 'nope' })).toBe('unknown');
  });
});
