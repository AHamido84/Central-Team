import { describe, expect, it } from 'vitest';

import { readAppClaims } from '@/lib/auth/claims';

const org = '00000000-0000-4000-8000-000000000001';

describe('readAppClaims', () => {
  it('reads the access token hook claims', () => {
    expect(readAppClaims({ app: { org_id: org, user_type: 'agency', onboarded: true } })).toEqual({
      org_id: org,
      user_type: 'agency',
      onboarded: true,
    });
  });

  it('falls back to app_metadata when the hook is not enabled (ADR-046)', () => {
    expect(readAppClaims({ app_metadata: { provider: 'email', app: { org_id: org, user_type: 'client', onboarded: false } } })).toEqual({
      org_id: org,
      user_type: 'client',
      onboarded: false,
    });
  });

  it('prefers the hook claims over the mirrored metadata', () => {
    const claims = {
      app: { org_id: org, user_type: 'agency', onboarded: true },
      app_metadata: { app: { org_id: org, user_type: 'client', onboarded: false } },
    };
    expect(readAppClaims(claims).user_type).toBe('agency');
  });

  it('rejects unknown user types and missing claims', () => {
    expect(readAppClaims({ app: { user_type: 'admin' } }).user_type).toBeNull();
    expect(readAppClaims(null)).toEqual({ org_id: null, user_type: null, onboarded: false });
  });
});
