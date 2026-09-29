-- Supabase Cloud: the Auth server calls public.custom_access_token_hook as `supabase_auth_admin`, which needs USAGE on
-- the schema to resolve the function (local Supabase grants it by default, hosted projects may not). See ADR-014.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
