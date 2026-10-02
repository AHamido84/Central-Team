export type UserType = 'agency' | 'client';

export type AppClaims = {
  org_id: string | null;
  user_type: UserType | null;
  onboarded: boolean;
};

/**
 * Reads the app claims (ADR-014). `public.custom_access_token_hook` puts them at `claims.app`; the database also
 * mirrors them into `auth.users.raw_app_meta_data.app` (ADR-046), which every Supabase token carries as
 * `app_metadata.app` — so routing still works on a hosted project whose hook hasn't been enabled yet.
 */
export function readAppClaims(claims: Record<string, unknown> | undefined | null): AppClaims {
  const metadata = (claims?.app_metadata ?? {}) as { app?: unknown };
  const app = (claims?.app ?? metadata.app ?? {}) as Partial<AppClaims>;
  return {
    org_id: app.org_id ?? null,
    user_type: app.user_type === 'agency' || app.user_type === 'client' ? app.user_type : null,
    onboarded: Boolean(app.onboarded),
  };
}
