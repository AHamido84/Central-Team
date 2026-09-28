export type UserType = 'agency' | 'client';

export type AppClaims = {
  org_id: string | null;
  user_type: UserType | null;
  onboarded: boolean;
};

/** Reads the claims added by `public.custom_access_token_hook` (ADR-014). */
export function readAppClaims(claims: Record<string, unknown> | undefined | null): AppClaims {
  const app = (claims?.app ?? {}) as Partial<AppClaims>;
  return {
    org_id: app.org_id ?? null,
    user_type: app.user_type === 'agency' || app.user_type === 'client' ? app.user_type : null,
    onboarded: Boolean(app.onboarded),
  };
}
